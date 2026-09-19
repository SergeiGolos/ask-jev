import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildMatrixData, buildTreeData, loadAllManifests, type MatrixQuery } from "./matrix.ts";
import { historyDir as getHistoryDir, type RunManifest } from "./history.ts";

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
}

export interface RunningServer {
  server: http.Server;
  port: number;
  url: string;
  close: () => Promise<void>;
}

export function createServer(options: { cwd?: string; initialManifests?: RunManifest[] } = {}): http.Server {
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
      if (req.method !== "GET" && req.method !== "HEAD") {
        sendJson(res, 405, { error: "Method not allowed" });
        return;
      }

      const host = req.headers.host || "localhost";
      const parsedUrl = new URL(req.url || "/", `http://${host}`);
      const pathname = parsedUrl.pathname;

      if (pathname === "/api/tree") {
        const manifests = await getManifests();
        const tree = await buildTreeData(historyDir, manifests);
        sendJson(res, 200, tree);
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
          "Cache-Control": "no-cache",
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
  const server = createServer({ cwd, initialManifests });
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
