import http from "node:http";
import { glob, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { askDirs, expandAskNames, resolveConfig } from "./config.ts";
import { isRecord } from "./guards.ts";
import { buildMatrixData, buildTreeData, loadAllManifests, type MatrixQuery } from "./matrix.ts";
import { historyDir as getHistoryDir, readPair, type PairRecord, type RunManifest } from "./history.ts";
import { renderReportHtml } from "./report.ts";
import { runAsk, type RunResult } from "./run.ts";
import { isRunnable, newAskTemplate, parseAsk } from "./askfile.ts";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
};

export interface ServerOptions {
  cwd?: string;
  port?: number;
  host?: string;
  initialManifests?: RunManifest[];
  /** Judge transport seam for /api/run; tests inject a stub. */
  fetchImpl?: typeof fetch;
  /** Notified when a dashboard-triggered run completes; `ask serve` prints the result to its terminal. */
  onRun?: (result: RunResult) => void;
}

export interface RunningServer {
  server: http.Server;
  port: number;
  url: string;
  close: () => Promise<void>;
}

/** All files matching a glob under cwd, directories skipped, sorted (expandInputs rejects dirs). */
async function filesUnder(pattern: string, cwd: string): Promise<string[]> {
  const out: string[] = [];
  for await (const entry of glob(pattern, { cwd })) {
    if (entry.startsWith(".git/") || entry.includes("/.git/") || entry.startsWith("node_modules/") || entry.includes("/node_modules/")) continue;
    if (!(await stat(path.resolve(cwd, entry))).isDirectory()) out.push(entry.split(path.sep).join("/"));
  }
  return out.sort();
}

/** Normalize and validate a path inside a .questions directory to prevent traversal. */
function safeQuestionPath(dir: string, input: string): { fullPath: string; relPath: string } | null {
  if (!input || typeof input !== "string") return null;
  let clean = input.trim().split(path.sep).join("/");
  if (!clean.toLowerCase().endsWith(".md")) clean += ".md";
  clean = clean.replace(/^\/+/, "");
  const parts = clean.split("/");
  if (parts.some((p) => p === ".." || p === "." || p === "")) return null;
  if (parts[0] === "history") return null;
  const fullPath = path.resolve(dir, clean);
  const rel = path.relative(dir, fullPath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return { fullPath, relPath: clean };
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

export function createServer(options: ServerOptions = {}): http.Server {
  const cwd = options.cwd ?? process.cwd();
  const historyDir = getHistoryDir(cwd);
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const webDir = path.resolve(currentDir, "web");

  let cachedManifests: RunManifest[] | null = options.initialManifests ?? null;
  let cacheTimestamp = options.initialManifests ? Date.now() : 0;

  async function getManifests(): Promise<RunManifest[]> {
    const now = Date.now();
    if (cachedManifests && now - cacheTimestamp < 2000) {
      return cachedManifests;
    }
    cachedManifests = await loadAllManifests(historyDir);
    cacheTimestamp = now;
    return cachedManifests;
  }

  function sendJson(res: http.ServerResponse, statusCode: number, data: unknown): void {
    const payload = JSON.stringify(data);
    res.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(payload),
      "Cache-Control": "no-cache",
    });
    res.end(payload);
  }

  return http.createServer(async (req, res) => {
    try {
      const host = req.headers.host || "localhost";
      const parsedUrl = new URL(req.url || "/", `http://${host}`);
      const pathname = parsedUrl.pathname;
      const isQuestions = pathname === "/api/questions" || pathname.startsWith("/api/questions/");

      if (
        !isQuestions &&
        req.method !== "GET" &&
        req.method !== "HEAD" &&
        !(req.method === "POST" && pathname === "/api/run")
      ) {
        sendJson(res, 405, { error: "Method not allowed" });
        return;
      }

      if (isQuestions) {
        const { folder, profile } = askDirs(cwd);

        // GET /api/questions or GET /api/questions?name=... or ?path=...
        if (req.method === "GET") {
          const target = parsedUrl.searchParams.get("name") || parsedUrl.searchParams.get("path");
          if (target) {
            const folderTarget = safeQuestionPath(folder, target);
            const profileTarget = safeQuestionPath(profile, target);
            if (!folderTarget) {
              sendJson(res, 400, { error: `invalid question name or path: ${target}` });
              return;
            }
            let targetPath = folderTarget.fullPath;
            let targetRel = folderTarget.relPath;
            let source: "folder" | "profile" = "folder";
            try {
              await stat(targetPath);
            } catch {
              if (profileTarget) {
                try {
                  await stat(profileTarget.fullPath);
                  targetPath = profileTarget.fullPath;
                  targetRel = profileTarget.relPath;
                  source = "profile";
                } catch {
                  sendJson(res, 404, { error: `question not found: ${target}` });
                  return;
                }
              } else {
                sendJson(res, 404, { error: `question not found: ${target}` });
                return;
              }
            }
            const content = await readFile(targetPath, "utf8");
            let meta = {};
            let schema = null;
            let runnable = false;
            let parseError: string | null = null;
            try {
              const parsed = parseAsk(content, targetRel);
              meta = parsed.meta;
              schema = parsed.schema;
              runnable = isRunnable(parsed);
            } catch (err: unknown) {
              parseError = err instanceof Error ? err.message : String(err);
            }
            sendJson(res, 200, {
              name: targetRel.replace(/\.md$/i, ""),
              path: targetRel,
              content,
              meta,
              schema,
              isRunnable: runnable,
              source,
              parseError,
            });
            return;
          }

          // List questions
          const questionsMap = new Map<string, {
            name: string;
            path: string;
            description: string;
            model: string;
            args: Record<string, unknown>;
            isRunnable: boolean;
            source: "folder" | "profile";
            mtime: number;
          }>();

          for (const [dir, source] of [[profile, "profile"], [folder, "folder"]] as const) {
            let entries: string[];
            try {
              entries = (await readdir(dir, { recursive: true }))
                .map((f) => f.split(path.sep).join("/"))
                .filter((f) => f.toLowerCase().endsWith(".md") && !f.startsWith("history/") && !/(^|\/)\.[^/]+/.test(f));
            } catch {
              continue;
            }
            for (const entry of entries) {
              const fullPath = path.join(dir, entry);
              const name = entry.replace(/\.md$/i, "");
              try {
                const st = await stat(fullPath);
                const text = await readFile(fullPath, "utf8");
                let parsed = null;
                let runnable = false;
                try {
                  parsed = parseAsk(text, fullPath);
                  runnable = isRunnable(parsed);
                } catch {}
                questionsMap.set(name, {
                  name,
                  path: entry,
                  description: parsed?.meta.description ?? "",
                  model: parsed?.meta.model ?? "-",
                  args: (parsed?.meta.args as Record<string, unknown>) ?? {},
                  isRunnable: runnable,
                  source,
                  mtime: st.mtimeMs,
                });
              } catch {}
            }
          }
          const questions = Array.from(questionsMap.values()).sort((a, b) => a.name.localeCompare(b.name));
          sendJson(res, 200, { questions });
          return;
        }

        // POST /api/questions or POST /api/questions/move
        if (req.method === "POST") {
          let body: unknown;
          try {
            body = await readJsonBody(req);
          } catch {
            sendJson(res, 400, { error: "invalid JSON body" });
            return;
          }
          if (!isRecord(body)) {
            sendJson(res, 400, { error: "body must be an object" });
            return;
          }

          if (pathname === "/api/questions/move") {
            const fromStr = typeof body.from === "string" ? body.from : "";
            const toStr = typeof body.to === "string" ? body.to : "";
            const fromTarget = safeQuestionPath(folder, fromStr);
            const toTarget = safeQuestionPath(folder, toStr);
            if (!fromTarget || !toTarget) {
              sendJson(res, 400, { error: "invalid 'from' or 'to' path" });
              return;
            }
            try {
              await stat(fromTarget.fullPath);
            } catch {
              sendJson(res, 404, { error: `source question not found: ${fromStr}` });
              return;
            }
            const dstExists = await stat(toTarget.fullPath).then(() => true).catch(() => false);
            if (dstExists) {
              sendJson(res, 409, { error: `destination already exists: ${toTarget.relPath}` });
              return;
            }
            await mkdir(path.dirname(toTarget.fullPath), { recursive: true });
            await rename(fromTarget.fullPath, toTarget.fullPath);
            cacheTimestamp = 0;
            sendJson(res, 200, { success: true, from: fromTarget.relPath, to: toTarget.relPath });
            return;
          }

          // Create new question
          const nameStr = typeof body.name === "string" ? body.name : "";
          const target = safeQuestionPath(folder, nameStr);
          if (!target) {
            sendJson(res, 400, { error: `invalid question name: ${nameStr}` });
            return;
          }
          const exists = await stat(target.fullPath).then(() => true).catch(() => false);
          if (exists && !body.overwrite) {
            sendJson(res, 409, { error: `question already exists: ${target.relPath}` });
            return;
          }
          const content = typeof body.content === "string"
            ? body.content
            : newAskTemplate(target.relPath.replace(/\.md$/i, ""));
          await mkdir(path.dirname(target.fullPath), { recursive: true });
          await writeFile(target.fullPath, content, "utf8");
          cacheTimestamp = 0;
          let meta = {};
          let schema = null;
          let runnable = false;
          let parseError: string | null = null;
          try {
            const parsed = parseAsk(content, target.relPath);
            meta = parsed.meta;
            schema = parsed.schema;
            runnable = isRunnable(parsed);
          } catch (err: unknown) {
            parseError = err instanceof Error ? err.message : String(err);
          }
          sendJson(res, 201, {
            name: target.relPath.replace(/\.md$/i, ""),
            path: target.relPath,
            content,
            meta,
            schema,
            isRunnable: runnable,
            parseError,
          });
          return;
        }

        // PUT /api/questions - Save/update question content
        if (req.method === "PUT") {
          let body: unknown;
          try {
            body = await readJsonBody(req);
          } catch {
            sendJson(res, 400, { error: "invalid JSON body" });
            return;
          }
          if (!isRecord(body) || typeof body.content !== "string") {
            sendJson(res, 400, { error: "body must include content string" });
            return;
          }
          const nameStr = typeof body.name === "string" ? body.name : typeof body.path === "string" ? body.path : "";
          const target = safeQuestionPath(folder, nameStr);
          if (!target) {
            sendJson(res, 400, { error: `invalid question name or path: ${nameStr}` });
            return;
          }
          await mkdir(path.dirname(target.fullPath), { recursive: true });
          await writeFile(target.fullPath, body.content, "utf8");
          cacheTimestamp = 0;
          let meta = {};
          let schema = null;
          let runnable = false;
          let parseError: string | null = null;
          try {
            const parsed = parseAsk(body.content, target.relPath);
            meta = parsed.meta;
            schema = parsed.schema;
            runnable = isRunnable(parsed);
          } catch (err: unknown) {
            parseError = err instanceof Error ? err.message : String(err);
          }
          sendJson(res, 200, {
            name: target.relPath.replace(/\.md$/i, ""),
            path: target.relPath,
            meta,
            schema,
            isRunnable: runnable,
            parseError,
            saved: true,
          });
          return;
        }

        // DELETE /api/questions - Delete question
        if (req.method === "DELETE") {
          let targetStr = parsedUrl.searchParams.get("name") || parsedUrl.searchParams.get("path") || "";
          if (!targetStr) {
            try {
              const body = await readJsonBody(req);
              if (isRecord(body)) {
                if (typeof body.name === "string") targetStr = body.name;
                else if (typeof body.path === "string") targetStr = body.path;
              }
            } catch {}
          }
          const target = safeQuestionPath(folder, targetStr);
          if (!target) {
            sendJson(res, 400, { error: `invalid question name or path: ${targetStr}` });
            return;
          }
          try {
            await unlink(target.fullPath);
          } catch (err: unknown) {
            if (typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT") {
              sendJson(res, 404, { error: `question not found: ${target.relPath}` });
              return;
            }
            throw err;
          }
          cacheTimestamp = 0;
          sendJson(res, 200, { deleted: true, name: target.relPath.replace(/\.md$/i, ""), path: target.relPath });
          return;
        }

        sendJson(res, 405, { error: "Method not allowed" });
        return;
      }
      if (pathname === "/api/runs") {
        const manifests = await getManifests();
        sendJson(res, 200, {
          runs: manifests.map((m) => ({
            runId: m.runId,
            timestamp: m.timestamp,
            ask: m.ask,
            model: m.model,
            pairCount: m.pairs.length,
          })),
        });
        return;
      }

      const reportMatch = pathname.match(/^\/api\/runs\/([A-Za-z0-9_-]+)\/report$/);
      if (reportMatch) {
        const runId = reportMatch[1]!;
        const manifest = (await getManifests()).find((m) => m.runId === runId);
        if (!manifest) {
          sendJson(res, 404, { error: `run not found: ${runId}` });
          return;
        }
        const dir = path.join(historyDir, runId);
        const pairs: { rec: PairRecord; request: string; response: unknown }[] = [];
        for (const rec of manifest.pairs) pairs.push({ rec, ...(await readPair(dir, rec)) });
        const html = renderReportHtml(manifest, pairs);
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Length": Buffer.byteLength(html),
          "Cache-Control": "no-cache",
        });
        res.end(html);
        return;
      }

      if (pathname === "/api/tree") {
        const manifests = await getManifests();
        const tree = await buildTreeData(historyDir, manifests);
        sendJson(res, 200, tree);
        return;
      }
      if (pathname === "/api/files") {
        const manifests = await getManifests();
        const diskFiles = await filesUnder("**/*", cwd);
        const fileSet = new Set<string>(diskFiles);
        for (const m of manifests) {
          for (const f of m.files) fileSet.add(f);
        }
        sendJson(res, 200, { files: Array.from(fileSet).sort() });
        return;
      }


      if (pathname === "/api/matrix") {
        const query: MatrixQuery = {};

        const p = parsedUrl.searchParams.get("path");
        if (p) query.path = p;

        const ask = parsedUrl.searchParams.get("ask");
        if (ask) query.ask = ask;

        const from = parsedUrl.searchParams.get("from");
        if (from) query.from = from;

        const to = parsedUrl.searchParams.get("to");
        if (to) query.to = to;

        const grep = parsedUrl.searchParams.get("grep");
        if (grep) query.grep = grep;

        const qParam = parsedUrl.searchParams.getAll("questions");
        if (qParam.length > 0) {
          query.questions = qParam.flatMap((val) => val.split(",").map((s) => s.trim()).filter(Boolean));
        }

        const manifests = await getManifests();
        const matrix = await buildMatrixData(historyDir, manifests, query);
        sendJson(res, 200, matrix);
        return;
      }

      if (pathname === "/api/run") {
        if (req.method !== "POST") {
          sendJson(res, 405, { error: "Method not allowed" });
          return;
        }
        let raw = "";
        for await (const chunk of req) raw += chunk;
        let body: unknown;
        try {
          body = JSON.parse(raw);
        } catch {
          sendJson(res, 400, { error: "invalid JSON body" });
          return;
        }
        if (!isRecord(body)) {
          sendJson(res, 400, { error: "body must be an object" });
          return;
        }
        let asks: string[] = [];
        if (Array.isArray(body.asks)) asks = body.asks.filter((x): x is string => typeof x === "string");
        else if (Array.isArray(body.questions)) asks = body.questions.filter((x): x is string => typeof x === "string");
        else if (Array.isArray(body.ask)) asks = body.ask.filter((x): x is string => typeof x === "string");
        else if (typeof body.ask === "string") asks = [body.ask];

        if (asks.length === 0) {
          sendJson(res, 400, { error: "body must specify ask, asks, or questions" });
          return;
        }
        const expandedAsks = await expandAskNames(asks, cwd);
        if (expandedAsks.length === 0) {
          sendJson(res, 400, { error: "no questions matched" });
          return;
        }

        let files: string[];
        if (Array.isArray(body.files)) {
          files = body.files.filter((x): x is string => typeof x === "string");
        } else if (body.path !== undefined && typeof body.path !== "string") {
          sendJson(res, 400, { error: "path must be a string" });
          return;
        } else {
          const rel = typeof body.path === "string" ? body.path : "";
          if (/^https?:\/\//.test(rel)) {
            files = [rel];
          } else if (rel === "" || rel === "/" || rel === ".") {
            files = await filesUnder("**/*", cwd);
          } else {
            const st = await stat(path.resolve(cwd, rel)).catch(() => null);
            if (!st) {
              sendJson(res, 400, { error: `no such path: ${rel}` });
              return;
            }
            files = st.isDirectory() ? await filesUnder(`${rel.replace(/\/+$/, "")}/**/*`, cwd) : [rel];
          }
        }
        if (files.length === 0) {
          sendJson(res, 400, { error: "no files matched" });
          return;
        }
        const key = (await resolveConfig(cwd)).apiKey;
        if (!key) {
          sendJson(res, 400, { error: "TYPESAFE_API_KEY is not set — put it in .questions/.env or export it" });
          return;
        }
        const batch = body.batch === true;
        const results: RunResult[] = [];
        for (const askName of expandedAsks) {
          const result = await runAsk({
            name: askName,
            cwd,
            argv: [askName, ...(batch ? ["--batch"] : []), ...files.flatMap((f) => ["-f", f])],
            files,
            tokens: {},
            batch,
            key,
            fetchImpl: options.fetchImpl,
          });
          cacheTimestamp = 0; // the next /api/* request re-reads the just-recorded run
          options.onRun?.(result);
          results.push(result);
        }
        sendJson(res, 200, {
          runId: results[results.length - 1]!.manifest.runId,
          model: results[results.length - 1]!.model,
          pairs: results.flatMap((r) => r.pairs.map((p) => ({ file: p.file, answers: p.response.answers }))),
          runs: results.map((r) => ({
            runId: r.manifest.runId,
            ask: r.manifest.ask,
            model: r.model,
            pairs: r.pairs.map((p) => ({ file: p.file, answers: p.response.answers })),
          })),
        });
        return;
      }

      let reqPath = pathname;
      if (reqPath === "/" || reqPath === "") {
        reqPath = "/index.html";
      }

      const safePath = path.normalize(reqPath).replace(/^(\.\.[/\\])+/, "");
      const fullPath = path.join(webDir, safePath);

      const rel = path.relative(webDir, fullPath);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        sendJson(res, 403, { error: "Forbidden" });
        return;
      }

      try {
        const fileStat = await stat(fullPath);
        if (!fileStat.isFile()) {
          sendJson(res, 404, { error: "Not found" });
          return;
        }

        const ext = path.extname(fullPath).toLowerCase();
        const contentType = MIME_TYPES[ext] || "application/octet-stream";
        const content = await readFile(fullPath);

        res.writeHead(200, {
          "Content-Type": contentType,
          "Content-Length": content.length,
          "Cache-Control": "no-store, no-cache, must-revalidate",
        });
        if (req.method === "HEAD") {
          res.end();
        } else {
          res.end(content);
        }
      } catch (err: unknown) {
        if (typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT") {
          sendJson(res, 404, { error: "Not found" });
        } else {
          throw err;
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Internal server error";
      sendJson(res, 500, { error: msg });
    }
  });
}

export async function startServer(options: ServerOptions = {}): Promise<RunningServer> {
  const cwd = options.cwd ?? process.cwd();
  const historyDir = getHistoryDir(cwd);
  const initialManifests = options.initialManifests ?? (await loadAllManifests(historyDir));
  const server = createServer({ cwd, initialManifests, fetchImpl: options.fetchImpl, onRun: options.onRun });
  const host = options.host || "127.0.0.1";
  const preferredPort = options.port ?? 3000;

  const { promise, resolve, reject } = Promise.withResolvers<RunningServer>();

  function tryListen(port: number): void {
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE" && options.port === undefined && port < preferredPort + 20) {
        tryListen(port + 1);
      } else {
        reject(err);
      }
    });

    server.listen(port, host, () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;
      const url = `http://${host === "127.0.0.1" ? "localhost" : host}:${actualPort}`;
      resolve({
        server,
        port: actualPort,
        url,
        close: () => {
          const closeResolvers = Promise.withResolvers<void>();
          server.close((err) => (err ? closeResolvers.reject(err) : closeResolvers.resolve()));
          return closeResolvers.promise;
        },
      });
    });
  }

  tryListen(preferredPort);
  return promise;
}
