import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isRecord } from "./guards.ts";
import { findRun, listRuns, readPair, type PairRecord, type RunManifest } from "./history.ts";

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Compact result chips from a judge response: one per answer (score / choice / noul value). */
function chips(response: unknown): string {
  if (!isRecord(response) || !isRecord(response.answers)) return "";
  return Object.entries(response.answers)
    .map(([id, a]) => {
      if (!isRecord(a)) return "";
      const v = typeof a.score === "number" ? a.score.toFixed(1) : (a.choice ?? a.noul ?? "?");
      return `<span class="chip">${esc(id)}&nbsp;<b>${esc(String(v))}</b></span>`;
    })
    .join(" ");
}

function consolePanel(notes: PairRecord["notes"]): string {
  const lines: string[] = [];
  for (const t of notes?.tools ?? []) lines.push(`$ ${t.command}`);
  const j = notes?.judge;
  if (j) {
    const bits = [`model: ${j.model ?? "?"}`];
    if (j.usage !== undefined) bits.push(`usage: ${JSON.stringify(j.usage)}`);
    if (j.latencyMs !== undefined) bits.push(`${j.latencyMs} ms`);
    lines.push(`# judge — ${bits.join(", ")}`);
  }
  if (lines.length === 0) lines.push("(no console records for this pair)");
  return `<div class="console"><h4>console output</h4><pre>${esc(lines.join("\n"))}</pre></div>`;
}

function pairHtml(p: { rec: PairRecord; request: string; response: unknown }): string {
  const json = JSON.stringify(p.response, null, 2);
  return `<div class="pair" data-view="result">
  <div class="bar">
    <span class="file">${String(p.rec.n).padStart(3, "0")}&nbsp;${esc(p.rec.file)}</span>
    <span class="chips">${chips(p.response)}</span>
    <button type="button" onclick="setView(this,'result')">Result</button>
    <button type="button" onclick="setView(this,'extended')">Extended</button>
    <label class="chk"><input type="checkbox" onchange="verbose(this)"> verbose</label>
  </div>
  <div class="full">
    <h4>request — ${esc(p.rec.request)}</h4>
    <pre>${esc(p.request)}</pre>
    <h4>response — ${esc(p.rec.response)}</h4>
    <pre>${esc(json)}</pre>
  </div>
  ${consolePanel(p.rec.notes)}
</div>`;
}

export function renderReportHtml(m: RunManifest, pairs: { rec: PairRecord; request: string; response: unknown }[]): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>ask-jev report — ${esc(m.runId.slice(0, 8))} (${esc(m.ask)})</title>
<style>
  body { font: 14px/1.45 system-ui, sans-serif; margin: 24px; color: #1a1a1a; }
  h1 { font-size: 18px; } .meta { color: #555; margin-bottom: 16px; }
  .pair { border: 1px solid #ccc; border-radius: 6px; margin: 10px 0; overflow: hidden; }
  .bar { display: flex; gap: 10px; align-items: center; padding: 8px 10px; background: #f3f3f3; }
  .bar .file { font-weight: 600; } .chips { flex: 1; }
  .chip { display: inline-block; background: #e8eefc; border-radius: 10px; padding: 1px 8px; font-size: 12px; }
  button { cursor: pointer; }
  pre { background: #fafafa; border: 1px solid #eee; padding: 8px; max-height: 380px; overflow: auto; white-space: pre-wrap; }
  h4 { margin: 10px 10px 4px; font-size: 12px; color: #555; }
  .full pre { margin: 0 10px 10px; }
  .console pre { margin: 0 10px 10px; background: #101418; color: #d5d5d5; }
  .pair[data-view="result"] .full, .pair[data-view="result"] .console { display: none; }
  .pair[data-view="extended"] .console { display: none; }
</style>
</head>
<body>
<h1>ask-jev report — ${esc(m.ask)}</h1>
<div class="meta">run <b>${esc(m.runId)}</b> · ${esc(m.timestamp)} · model ${esc(m.model)} · ${m.pairs.length} pair(s) · argv: ${esc(m.argv.join(" "))}</div>
${pairs.map(pairHtml).join("\n")}
<script>
  function setView(btn, view) {
    const row = btn.closest('.pair');
    row.dataset.view = view;
    const chk = row.querySelector('.chk input');
    if (chk) chk.checked = view === 'verbose';
  }
  function verbose(chk) { chk.closest('.pair').dataset.view = chk.checked ? 'verbose' : 'extended'; }
</script>
</body>
</html>
`;
}

/** Write the report for a run (default: latest). Returns the path written. */
export async function writeReport(cwd: string, prefix: string | undefined, out: string | undefined): Promise<string> {
  let manifest: RunManifest;
  let dir: string;
  if (prefix === undefined) {
    const runs = await listRuns(cwd);
    if (runs.length === 0) throw new Error("no runs recorded yet — run an ask first");
    const latest = runs[runs.length - 1]!;
    manifest = (await findRun(cwd, latest.runId)).manifest;
    dir = latest.dir;
  } else {
    ({ manifest, dir } = await findRun(cwd, prefix));
  }
  const pairs = [];
  for (const rec of manifest.pairs) pairs.push({ rec, ...(await readPair(dir, rec)) });
  const outPath = out ?? `ask-jev-report-${manifest.runId.slice(0, 8)}.html`;
  const abs = resolve(cwd, outPath);
  await writeFile(abs, renderReportHtml(manifest, pairs));
  return abs;
}
