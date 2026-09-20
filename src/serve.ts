import http from "node:http";
import { glob, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expandAskNames } from "./config.ts";
import { isRecord } from "./guards.ts";
import { buildMatrixData, buildTreeData, githubRepoUrl, type MatrixQuery } from "./matrix.ts";
import { cachedManifests, historyDir as getHistoryDir, readPair, type PairRecord } from "./history.ts";
import { renderReportHtml } from "./report.ts";
import { MissingKeyError, invokeRun, type RunResult } from "./run.ts";
import { startWatcher, type RunningWatcher } from "./watch.ts";
import { AskExistsError, AskNotFoundError, InvalidAskNameError, openAskStore, type AskDetail } from "./askstore.ts";

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
  /** Judge transport seam for /api/run; tests inject a stub. */
  fetchImpl?: typeof fetch;
  /** Notified when a dashboard-triggered run completes; `ask serve` prints the result to its terminal. */
  onRun?: (result: RunResult) => void;
  /** Watch cwd for file changes and run questions whose front-matter grep matches (ask serve --watch). */
  watch?: boolean;
  /** Watch-event sink ([watch] lines); silent when omitted. */
  log?: (line: string) => void;
  /** Profile .questions home override; tests point it at a tmp dir. */
  home?: string;
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

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
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

/** Read a JSON object body or respond 400; null means the response is already sent. */
async function readObjectBody(req: http.IncomingMessage, res: http.ServerResponse): Promise<Record<string, unknown> | null> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "invalid JSON body" });
    return null;
  }
  if (!isRecord(body)) {
    sendJson(res, 400, { error: "body must be an object" });
    return null;
  }
  return body;
}

/** Map store errors to status codes; false means the error is not a store error — rethrow. */
function sendStoreError(res: http.ServerResponse, err: unknown): boolean {
  if (err instanceof InvalidAskNameError) sendJson(res, 400, { error: err.message });
  else if (err instanceof AskNotFoundError) sendJson(res, 404, { error: err.message });
  else if (err instanceof AskExistsError) sendJson(res, 409, { error: err.message });
  else return false;
  return true;
}

/** Wire shape for one ask, shared by GET/POST/PUT question endpoints. */
function questionPayload(d: AskDetail): Record<string, unknown> {
  return {
    name: d.name,
    path: d.path,
    content: d.content,
    meta: d.parsed?.meta ?? {},
    schema: d.parsed?.schema ?? null,
    isRunnable: d.isRunnable,
    source: d.source,
    parseError: d.parseError,
  };
}

export function createServer(options: ServerOptions = {}): http.Server {
  const cwd = options.cwd ?? process.cwd();
  const historyDir = getHistoryDir(cwd);
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const webDir = path.resolve(currentDir, "web");

  const store = openAskStore(cwd);
  const getManifests = () => cachedManifests(historyDir);

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
        // GET /api/questions or GET /api/questions?name=... or ?path=...
        if (req.method === "GET") {
          const target = parsedUrl.searchParams.get("name") || parsedUrl.searchParams.get("path");
          if (target) {
            try {
              sendJson(res, 200, questionPayload(await store.read(target)));
            } catch (err) {
              if (!sendStoreError(res, err)) throw err;
            }
            return;
          }
          sendJson(res, 200, { questions: await store.list() });
          return;
        }

        // POST /api/questions/move
        if (req.method === "POST" && pathname === "/api/questions/move") {
          const body = await readObjectBody(req, res);
          if (body === null) return;
          const from = typeof body.from === "string" ? body.from : "";
          const to = typeof body.to === "string" ? body.to : "";
          try {
            sendJson(res, 200, { success: true, ...(await store.move(from, to)) });
          } catch (err) {
            if (!sendStoreError(res, err)) throw err;
          }
          return;
        }

        // POST /api/questions — create
        if (req.method === "POST") {
          const body = await readObjectBody(req, res);
          if (body === null) return;
          const name = typeof body.name === "string" ? body.name : "";
          try {
            const detail = await store.create(name, {
              content: typeof body.content === "string" ? body.content : undefined,
              overwrite: Boolean(body.overwrite),
            });
            sendJson(res, 201, questionPayload(detail));
          } catch (err) {
            if (!sendStoreError(res, err)) throw err;
          }
          return;
        }

        // PUT /api/questions — save/update content
        if (req.method === "PUT") {
          const body = await readObjectBody(req, res);
          if (body === null) return;
          if (typeof body.content !== "string") {
            sendJson(res, 400, { error: "body must include content string" });
            return;
          }
          const name = typeof body.name === "string" ? body.name : typeof body.path === "string" ? body.path : "";
          try {
            sendJson(res, 200, { ...questionPayload(await store.save(name, body.content)), saved: true });
          } catch (err) {
            if (!sendStoreError(res, err)) throw err;
          }
          return;
        }

        // DELETE /api/questions
        if (req.method === "DELETE") {
          let name = parsedUrl.searchParams.get("name") || parsedUrl.searchParams.get("path") || "";
          if (!name) {
            try {
              const body = await readJsonBody(req);
              if (isRecord(body)) {
                if (typeof body.name === "string") name = body.name;
                else if (typeof body.path === "string") name = body.path;
              }
            } catch {}
          }
          try {
            sendJson(res, 200, { deleted: true, ...(await store.delete(name)) });
          } catch (err) {
            if (!sendStoreError(res, err)) throw err;
          }
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
            asks: m.asks.map((a) => a.ask),
            models: m.asks.map((a) => a.model),
            pairCount: m.pairs.length,
            sha: m.git?.sha,
            repo: githubRepoUrl(m.git?.remote),
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
        const batch = body.batch === true;
        let result: RunResult;
        try {
          result = await invokeRun({
            names: expandedAsks,
            cwd,
            home: options.home,
            argv: [...expandedAsks, ...(batch ? ["--batch"] : []), ...files.flatMap((f) => ["-f", f])],
            files,
            batch,
            fetchImpl: options.fetchImpl,
            onRun: options.onRun,
          });
        } catch (err) {
          if (err instanceof MissingKeyError) {
            sendJson(res, 400, { error: err.message });
            return;
          }
          throw err;
        }
        sendJson(res, 200, {
          runId: result.manifest.runId,
          asks: result.manifest.asks.map((a) => ({ ask: a.ask, model: a.model })),
          pairs: result.pairs.map((p) => ({ ask: p.ask, file: p.file, answers: p.response.answers })),
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
  const server = createServer({ cwd, fetchImpl: options.fetchImpl, onRun: options.onRun });
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
      const watcherReady: Promise<RunningWatcher | undefined> = options.watch
        ? startWatcher({ cwd, home: options.home, fetchImpl: options.fetchImpl, log: options.log, onRun: options.onRun })
        : Promise.resolve(undefined);
      watcherReady.then(
        (watcher) =>
          resolve({
            server,
            port: actualPort,
            url,
            close: () => {
              watcher?.close();
              const closeResolvers = Promise.withResolvers<void>();
              server.close((err) => (err ? closeResolvers.reject(err) : closeResolvers.resolve()));
              return closeResolvers.promise;
            },
          }),
        reject,
      );
    });
  }

  tryListen(preferredPort);
  return promise;
}
