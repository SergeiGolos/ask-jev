import assert from "node:assert/strict";
import { test } from "node:test";
import { startServer } from "../src/serve.ts";

test("startServer serves static assets and API routes", async () => {
  const instance = await startServer({ cwd: process.cwd() });
  try {
    // 1. Static asset: index.html
    const rootRes = await fetch(`${instance.url}/`);
    assert.equal(rootRes.status, 200);
    assert.ok(rootRes.headers.get("content-type")?.includes("text/html"));
    const html = await rootRes.text();
    assert.ok(html.includes("ask"));
    assert.ok(html.includes("treeContainer"));

    // 2. Static asset: style.css
    const cssRes = await fetch(`${instance.url}/style.css`);
    assert.equal(cssRes.status, 200);
    assert.ok(cssRes.headers.get("content-type")?.includes("text/css"));

    // 3. Static asset: app.js
    const jsRes = await fetch(`${instance.url}/app.js`);
    assert.equal(jsRes.status, 200);
    assert.ok(jsRes.headers.get("content-type")?.includes("javascript"));

    // 4. API route: /api/tree
    const treeRes = await fetch(`${instance.url}/api/tree`);
    assert.equal(treeRes.status, 200);
    assert.ok(treeRes.headers.get("content-type")?.includes("application/json"));
    const tree = await treeRes.json();
    assert.ok(typeof tree === "object" && tree !== null);
    assert.ok("root" in tree);
    assert.ok("availableAsks" in tree);

    // 5. API route: /api/matrix
    const matrixRes = await fetch(`${instance.url}/api/matrix?path=src/uuid7.ts`);
    assert.equal(matrixRes.status, 200);
    const matrix = await matrixRes.json();
    assert.ok(typeof matrix === "object" && matrix !== null);
    assert.equal((matrix as { path: string }).path, "src/uuid7.ts");
    assert.ok(Array.isArray((matrix as { runs: unknown[] }).runs));

    // 6. 404 for non-existent file
    const notFoundRes = await fetch(`${instance.url}/nonexistent-file.xyz`);
    assert.equal(notFoundRes.status, 404);

    // 7. 403 for directory traversal
    const forbiddenRes = await fetch(`${instance.url}/../../package.json`);
    assert.ok(forbiddenRes.status === 403 || forbiddenRes.status === 404);
  } finally {
    await instance.close();
  }
});
