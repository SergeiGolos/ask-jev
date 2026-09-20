import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isRecord } from "./guards.ts";
import { findRun, latestRun, readPair, type PairRecord, type RunManifest } from "./history.ts";
import { parseAnswer, toneOf, gradeOf, type ParsedAnswer as Answer, type Tone } from "./answers.ts";

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// ── Scoring Model ────────────────────────────────────────────────────────────


interface FileScore {
  rec: PairRecord;
  request: string;
  response: unknown;
  answers: Answer[];
  total: number | null;
  grade: string;
  tone: Tone;
  rank: number;
}

const fmt = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(1));


function scoreFiles(pairs: { rec: PairRecord; request: string; response: unknown }[]): FileScore[] {
  const scored = pairs.map((p) => {
    const answers: Answer[] =
      isRecord(p.response) && isRecord(p.response.answers)
        ? Object.entries(p.response.answers).map(([q, a]) => parseAnswer(q, a))
        : [];
    const nums = answers.map((a) => a.v).filter((v): v is number => v !== null);
    const total = nums.length ? nums.reduce((s, v) => s + v, 0) / nums.length : null;
    return {
      rec: p.rec,
      request: p.request,
      response: p.response,
      answers,
      total,
      grade: gradeOf(total),
      tone: total === null ? ("mut" as const) : toneOf(total),
      rank: 0,
    };
  });

  const sorted = [...scored].sort((a, b) => (b.total ?? -1) - (a.total ?? -1) || a.rec.n - b.rec.n);
  sorted.forEach((item, idx) => {
    item.rank = idx + 1;
  });
  return scored;
}

// ── File Tree ────────────────────────────────────────────────────────────────

interface TreeNode {
  dirs: Map<string, TreeNode>;
  files: { name: string; f: FileScore }[];
}

function buildTree(items: FileScore[]): TreeNode {
  const root: TreeNode = { dirs: new Map(), files: [] };
  for (const it of items) {
    const parts = it.rec.file.split("/").filter(Boolean);
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i]!;
      let next = node.dirs.get(seg);
      if (!next) {
        next = { dirs: new Map(), files: [] };
        node.dirs.set(seg, next);
      }
      node = next;
    }
    node.files.push({ name: parts.at(-1) ?? it.rec.file, f: it });
  }
  return root;
}

function renderTree(node: TreeNode): string {
  const dirs = [...node.dirs.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([name, child]) =>
        `<details open class="tdir"><summary><span class="fld">▸</span> ${esc(name)}/</summary><div class="tchildren">${renderTree(child)}</div></details>`,
    );

  const files = node.files
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(
      ({ name, f }) =>
        `<a class="tfile" href="#pair-${f.rec.n}" title="${esc(f.rec.file)}"><i class="dot ${f.tone}"></i><span class="tname">${esc(name)}</span><span class="tsc ${f.tone}">${f.total === null ? "—" : fmt(f.total)}</span></a>`,
    );

  return dirs.join("") + files.join("");
}

// ── Principle Averages ───────────────────────────────────────────────────────

interface PrincipleSummary {
  q: string;
  avg: number;
  count: number;
  lowCount: number;
}

function summarizePrinciples(files: FileScore[]): PrincipleSummary[] {
  const map = new Map<string, { sum: number; count: number; lowCount: number }>();
  for (const f of files) {
    for (const a of f.answers) {
      if (a.v === null) continue;
      const cur = map.get(a.q) ?? { sum: 0, count: 0, lowCount: 0 };
      cur.sum += a.v;
      cur.count += 1;
      if (a.v < 4) cur.lowCount += 1;
      map.set(a.q, cur);
    }
  }
  return [...map.entries()]
    .map(([q, s]) => ({ q, avg: s.sum / s.count, count: s.count, lowCount: s.lowCount }))
    .sort((a, b) => b.avg - a.avg);
}

// ── HTML Components ──────────────────────────────────────────────────────────

function heatStrip(probs: [number, number][]): string {
  const cells = probs
    .map(([k, p]) => {
      const pct = Math.round(p * 100);
      const op = (0.08 + p * 0.92).toFixed(2);
      return `<i title="Level ${k}: ${pct}%" style="opacity:${op}"></i>`;
    })
    .join("");
  return `<div class="qheat" title="Probability distribution">${cells}</div>`;
}

function answerRow(a: Answer): string {
  const bar =
    a.v !== null
      ? `<span class="qbar"><i class="${a.tone}" style="width:${Math.max(4, Math.min(100, (a.v / 10) * 100))}%"></i></span>`
      : `<span class="qbar empty"></span>`;
  const conf = a.conf !== null ? `<span class="qc" title="Judge confidence">${a.conf}%</span>` : `<span class="qc"></span>`;
  const heat = a.probs ? heatStrip(a.probs) : "";
  return `<div class="pq" data-q="${esc(a.q)}">
    <span class="qn" title="${esc(a.q)}">${esc(a.q)}</span>
    ${bar}
    <b class="qv ${a.tone}">${esc(a.label)}</b>
    ${conf}
    ${heat}
  </div>`;
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
  return `<div class="console"><div class="codehead">console output</div><pre class="conpre">${esc(lines.join("\n"))}</pre></div>`;
}

function pairHtml(f: FileScore): string {
  const json = JSON.stringify(f.response, null, 2);
  const rankClass = f.rank <= 3 ? ` r${f.rank}` : "";
  const grid =
    f.answers.length > 0
      ? `<div class="grid">${f.answers.map(answerRow).join("\n")}</div>`
      : `<div class="empty-ans">(no structured answers)</div>`;

  return `<article class="pair" id="pair-${f.rec.n}" data-view="result">
  <header class="pbar">
    <span class="rank${rankClass}" title="Rank #${f.rank}">#${f.rank}</span>
    <span class="pfile"><b>${String(f.rec.n).padStart(3, "0")}</b> · ${esc(f.rec.file)}</span>
    <span class="pmetrics">
      <span class="grade ${f.tone}">${f.grade}</span>
      <span class="tot ${f.tone}">${f.total === null ? "—" : fmt(f.total)}<small>/10</small></span>
    </span>
    <nav class="views">
      <button type="button" data-v="result" onclick="setView(this,'result')">Result</button>
      <button type="button" data-v="extended" onclick="setView(this,'extended')">Extended</button>
      <button type="button" data-v="verbose" onclick="setView(this,'verbose')">Verbose</button>
    </nav>
  </header>
  ${grid}
  <div class="full">
    <div class="codeblock">
      <div class="codehead">request — ${esc(f.rec.request)}</div>
      <pre>${esc(f.request)}</pre>
    </div>
    <div class="codeblock">
      <div class="codehead">response — ${esc(f.rec.response)}</div>
      <pre>${esc(json)}</pre>
    </div>
  </div>
  ${consolePanel(f.rec.notes)}
</article>`;
}

export function renderReportHtml(
  m: RunManifest,
  pairs: { rec: PairRecord; request: string; response: unknown }[],
): string {
  const scored = scoreFiles(pairs);
  const tree = buildTree(scored);
  const principles = summarizePrinciples(scored);

  const numericTotals = scored.map((s) => s.total).filter((v): v is number => v !== null);
  const overallAvg = numericTotals.length ? numericTotals.reduce((a, b) => a + b, 0) / numericTotals.length : null;
  const overallGrade = gradeOf(overallAvg);
  const overallTone = overallAvg === null ? "mut" : toneOf(overallAvg);

  const withScores = scored.filter((s): s is FileScore & { total: number } => s.total !== null);
  const best = withScores.find((s) => s.rank === 1);
  const maxRank = Math.max(0, ...withScores.map((s) => s.rank));
  const worst = withScores.length > 1 ? withScores.find((s) => s.rank === maxRank) : undefined;

  let totalRework = 0;
  for (const f of scored) {
    for (const a of f.answers) {
      if (a.tone === "bad" && a.label.startsWith("rework")) totalRework += 1;
    }
  }

  const principleRows = principles
    .map((p) => {
      const tone = toneOf(p.avg);
      const warn = p.lowCount > 0 ? `<span class="tag-warn" title="${p.lowCount} file(s) scored <4">⚠ ${p.lowCount} low</span>` : "";
      return `<div class="pq">
        <span class="qn" title="${esc(p.q)}">${esc(p.q)}</span>
        <span class="qbar"><i class="${tone}" style="width:${Math.max(4, Math.min(100, (p.avg / 10) * 100))}%"></i></span>
        <b class="qv ${tone}">${fmt(p.avg)}</b>
        ${warn}
      </div>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ask-jev report — ${esc(m.runId.slice(0, 8))} (${esc(m.ask)})</title>
<style>
  :root {
    --bg: #ffffff;
    --subtle: #f6f8fa;
    --inset: #f6f8fa;
    --border: #d0d7de;
    --border-muted: #d8dee4;
    --fg: #1f2328;
    --muted: #59636e;
    --accent: #0969da;
    --accent-subtle: #ddf4ff;
    --ok: #1a7f37;
    --ok-subtle: #dafbe1;
    --warn: #9a6700;
    --warn-subtle: #fff8c5;
    --bad: #cf222e;
    --bad-subtle: #ffebe9;
    --purp: #8250df;
    --purp-subtle: #fbefff;
    --font: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0d1117;
      --subtle: #151b23;
      --inset: #010409;
      --border: #30363d;
      --border-muted: #21262d;
      --fg: #f0f6fc;
      --muted: #8b949e;
      --accent: #2f81f7;
      --accent-subtle: #0d2d6b;
      --ok: #238636;
      --ok-subtle: #12341e;
      --warn: #d29922;
      --warn-subtle: #392b10;
      --bad: #f85149;
      --bad-subtle: #3c1618;
      --purp: #a371f7;
      --purp-subtle: #271052;
    }
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font: 14px/1.5 var(--font);
    background: var(--bg);
    color: var(--fg);
    min-height: 100vh;
  }

  /* Header */
  .top {
    border-bottom: 1px solid var(--border);
    background: var(--subtle);
    padding: 16px 24px;
    position: sticky;
    top: 0;
    z-index: 10;
    backdrop-filter: blur(8px);
  }
  .top-row { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; flex-wrap: wrap; }
  h1 { font-size: 18px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
  h1 .app { color: var(--muted); font-weight: 400; }
  h1 .sep { color: var(--muted); }
  .meta { color: var(--muted); font-size: 12px; margin-top: 4px; display: flex; gap: 8px; flex-wrap: wrap; }
  .meta code { font-family: var(--mono); background: var(--bg); padding: 1px 4px; border-radius: 4px; border: 1px solid var(--border-muted); }

  /* Layout */
  .shell { max-width: 1360px; margin: 0 auto; padding: 24px; }
  .cols { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 24px; align-items: start; }
  @media (max-width: 960px) {
    .cols { grid-template-columns: 1fr; }
    .side { position: static; max-height: none; }
  }

  /* Sidebar file tree */
  .side {
    position: sticky;
    top: 96px;
    max-height: calc(100vh - 120px);
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--subtle);
  }
  .side-hdr {
    padding: 10px 14px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: .5px;
    color: var(--muted);
    border-bottom: 1px solid var(--border);
    background: var(--bg);
    display: flex;
    justify-content: space-between;
  }
  .side-body { padding: 8px; font-size: 13px; }
  .tdir { margin: 2px 0; }
  .tdir summary {
    cursor: pointer;
    padding: 3px 6px;
    border-radius: 4px;
    font-weight: 600;
    color: var(--fg);
    user-select: none;
    list-style: none;
  }
  .tdir summary::-webkit-details-marker { display: none; }
  .tdir summary:hover { background: var(--bg); }
  .tdir .fld { display: inline-block; transition: transform .15s; font-size: 10px; color: var(--muted); width: 12px; }
  .tdir[open] > summary .fld { transform: rotate(90deg); }
  .tchildren { padding-left: 12px; border-left: 1px solid var(--border-muted); margin-left: 8px; }
  .tfile {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 6px;
    border-radius: 4px;
    text-decoration: none;
    color: var(--fg);
    margin: 1px 0;
  }
  .tfile:hover { background: var(--bg); color: var(--accent); }
  .tfile .tname { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--mono); font-size: 12px; }
  .tfile .tsc { font-weight: 600; font-size: 11px; padding: 0 4px; border-radius: 3px; }

  /* Dots and tones */
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .ok { color: var(--ok); }
  .warn { color: var(--warn); }
  .bad { color: var(--bad); }
  .mut { color: var(--muted); }
  i.dot.ok, b.ok, i.ok { background: var(--ok); }
  i.dot.warn, b.warn, i.warn { background: var(--warn); }
  i.dot.bad, b.bad, i.bad { background: var(--bad); }
  i.dot.mut { background: var(--border); }
  .tsc.ok { background: var(--ok-subtle); color: var(--ok); }
  .tsc.warn { background: var(--warn-subtle); color: var(--warn); }
  .tsc.bad { background: var(--bad-subtle); color: var(--bad); }
  .tsc.mut { background: var(--border-muted); color: var(--muted); }

  /* Summary cards */
  .summary { margin-bottom: 24px; display: flex; flex-direction: column; gap: 16px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
  .stat-card {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 12px 16px;
    background: var(--subtle);
  }
  .stat-card .lbl { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .5px; font-weight: 500; }
  .stat-card .val { font-size: 24px; font-weight: 700; margin-top: 4px; display: flex; align-items: baseline; gap: 8px; }
  .stat-card .val small { font-size: 13px; font-weight: 400; color: var(--muted); }
  .stat-card .sub { font-size: 12px; color: var(--muted); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* Grade badge */
  .grade {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 12px;
    padding: 1px 7px;
    border-radius: 12px;
    border: 1px solid currentColor;
  }
  .grade.ok { background: var(--ok-subtle); color: var(--ok); }
  .grade.warn { background: var(--warn-subtle); color: var(--warn); }
  .grade.bad { background: var(--bad-subtle); color: var(--bad); }
  .grade.mut { background: var(--subtle); color: var(--muted); }

  /* Principle overview box */
  .panel {
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    overflow: hidden;
  }
  .panel-hdr {
    padding: 10px 16px;
    font-size: 13px;
    font-weight: 600;
    background: var(--subtle);
    border-bottom: 1px solid var(--border);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .panel-body { padding: 12px 16px; }
  .legend { font-size: 11px; color: var(--muted); }
  .tag-warn {
    font-size: 11px;
    padding: 1px 6px;
    background: var(--warn-subtle);
    color: var(--warn);
    border-radius: 10px;
    font-weight: 600;
  }

  /* Principle grid rows */
  .pq {
    display: grid;
    grid-template-columns: 140px 1fr 40px 48px;
    align-items: center;
    gap: 12px;
    padding: 6px 0;
    border-bottom: 1px solid var(--border-muted);
    font-size: 13px;
  }
  .pq:last-child { border-bottom: none; }
  .qn { font-family: var(--mono); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .qbar {
    height: 8px;
    background: var(--inset);
    border: 1px solid var(--border-muted);
    border-radius: 4px;
    overflow: hidden;
    position: relative;
    display: block;
  }
  .qbar i { display: block; height: 100%; border-radius: 3px; }
  .qbar.empty { background: transparent; border-style: dashed; }
  .qv { font-weight: 600; text-align: right; font-family: var(--mono); font-size: 12px; }
  .qc { font-size: 11px; color: var(--muted); text-align: right; }
  .qheat {
    grid-column: 2 / -1;
    display: flex;
    gap: 2px;
    height: 5px;
    margin-top: -2px;
    margin-bottom: 4px;
  }
  .qheat i {
    flex: 1;
    background: var(--accent);
    border-radius: 1px;
    min-width: 4px;
  }

  /* Pair cards */
  .pairs-list { display: flex; flex-direction: column; gap: 16px; }
  .pair {
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    overflow: hidden;
    transition: box-shadow .2s;
  }
  .pair.flash {
    box-shadow: 0 0 0 3px var(--accent);
  }
  .pbar {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 10px 14px;
    background: var(--subtle);
    border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
  }
  .rank {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 22px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 700;
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--muted);
  }
  .rank.r1 { background: var(--warn-subtle); color: var(--warn); border-color: var(--warn); }
  .rank.r2 { background: var(--subtle); color: var(--fg); border-color: var(--muted); }
  .rank.r3 { background: var(--purp-subtle); color: var(--purp); border-color: var(--purp); }
  .pfile { font-family: var(--mono); font-size: 13px; flex: 1; min-width: 160px; }
  .pmetrics { display: flex; align-items: center; gap: 8px; }
  .tot { font-weight: 700; font-size: 14px; }
  .tot small { font-size: 11px; font-weight: 400; color: var(--muted); }

  /* Segmented view controls */
  .views {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
    background: var(--bg);
  }
  .views button {
    border: none;
    background: transparent;
    padding: 3px 10px;
    font-size: 12px;
    font-family: inherit;
    color: var(--muted);
    cursor: pointer;
    border-right: 1px solid var(--border);
  }
  .views button:last-child { border-right: none; }
  .views button:hover { background: var(--subtle); color: var(--fg); }
  .pair[data-view="result"] .views button[data-v="result"],
  .pair[data-view="extended"] .views button[data-v="extended"],
  .pair[data-view="verbose"] .views button[data-v="verbose"] {
    background: var(--accent);
    color: #fff;
    font-weight: 600;
  }

  .grid { padding: 12px 16px; }
  .empty-ans { padding: 16px; color: var(--muted); font-style: italic; }

  /* View level visibility: Result = grid only; Extended = full; Verbose = full + console */
  .pair[data-view="result"] .full,
  .pair[data-view="result"] .console { display: none; }
  .pair[data-view="extended"] .console { display: none; }

  /* Code blocks */
  .full { padding: 16px; border-top: 1px solid var(--border); background: var(--subtle); }
  .codeblock {
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
    margin-bottom: 16px;
    background: var(--bg);
  }
  .codeblock:last-child { margin-bottom: 0; }
  .codehead {
    background: var(--subtle);
    border-bottom: 1px solid var(--border);
    padding: 6px 12px;
    font-family: var(--mono);
    font-size: 12px;
    color: var(--muted);
  }
  pre {
    padding: 12px;
    font-family: var(--mono);
    font-size: 12px;
    line-height: 1.5;
    max-height: 420px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .console {
    border-top: 1px solid var(--border);
    background: #010409;
    color: #e6edf3;
  }
  .console .codehead {
    background: #0d1117;
    border-bottom: 1px solid #30363d;
    color: #8b949e;
  }
  .conpre {
    color: #e6edf3;
    background: transparent;
  }
</style>
</head>
<body>

<header class="top">
  <div class="top-row">
    <h1>
      <span class="app">ask-jev</span>
      <span class="sep">/</span>
      <span>${esc(m.ask)}</span>
    </h1>
    <span class="grade ${overallTone}" title="Run overall grade">${overallGrade}</span>
  </div>
  <div class="meta">
    <span>run <code>${esc(m.runId.slice(0, 8))}</code></span>
    <span>·</span>
    <span>${esc(m.timestamp)}</span>
    <span>·</span>
    <span>model <code>${esc(m.model)}</code></span>
    <span>·</span>
    <span><b>${m.pairs.length}</b> file(s)</span>
    <span>·</span>
    <span>argv: <code>${esc(m.argv.join(" "))}</code></span>
  </div>
</header>

<div class="shell">
  <div class="cols">
    <aside class="side">
      <div class="side-hdr">
        <span>Files</span>
        <span>${scored.length}</span>
      </div>
      <div class="side-body">
        ${renderTree(tree)}
      </div>
    </aside>

    <main class="main">
      <section class="summary">
        <div class="stats">
          <div class="stat-card">
            <div class="lbl">Run Average</div>
            <div class="val ${overallTone}">${overallAvg === null ? "—" : fmt(overallAvg)}<small>/10</small></div>
            <div class="sub">Grade ${overallGrade} across ${numericTotals.length} scored files</div>
          </div>
          ${
            best
              ? `<div class="stat-card">
            <div class="lbl">Top Performer</div>
            <div class="val ok">${fmt(best.total!)}<small>/10</small></div>
            <div class="sub" title="${esc(best.rec.file)}">#1 ${esc(best.rec.file)}</div>
          </div>`
              : ""
          }
          ${
            worst && worst !== best
              ? `<div class="stat-card">
            <div class="lbl">Lowest Score</div>
            <div class="val ${worst.tone}">${fmt(worst.total!)}<small>/10</small></div>
            <div class="sub" title="${esc(worst.rec.file)}">#${worst.rank} ${esc(worst.rec.file)}</div>
          </div>`
              : ""
          }
          <div class="stat-card">
            <div class="lbl">Rework Flags</div>
            <div class="val ${totalRework > 0 ? "bad" : "ok"}">${totalRework}</div>
            <div class="sub">${totalRework > 0 ? "Files needing attention" : "All clean"}</div>
          </div>
        </div>

        ${
          principles.length > 0
            ? `<div class="panel">
          <div class="panel-hdr">
            <span>Principles Overview</span>
            <span class="legend">Mean across all judged files</span>
          </div>
          <div class="panel-body">
            ${principleRows}
          </div>
        </div>`
            : ""
        }
      </section>

      <section class="pairs-list">
        ${scored.map(pairHtml).join("\n")}
      </section>
    </main>
  </div>
</div>

<script>
  function setView(btn, view) {
    const row = btn.closest('.pair');
    row.dataset.view = view;
  }

  document.querySelectorAll('a.tfile').forEach(function(a) {
    a.addEventListener('click', function(e) {
      e.preventDefault();
      var id = a.getAttribute('href').slice(1);
      var target = document.getElementById(id);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        target.classList.add('flash');
        setTimeout(function() { target.classList.remove('flash'); }, 1200);
      }
    });
  });
</script>
</body>
</html>
`;
}

/** Write the report for a run (default: latest). Returns the path written. */
export async function writeReport(cwd: string, prefix: string | undefined, out: string | undefined): Promise<string> {
  let manifest: RunManifest;
  let dir: string;
  if (prefix === undefined) ({ manifest, dir } = await latestRun(cwd));
  else ({ manifest, dir } = await findRun(cwd, prefix));
  const pairs = [];
  for (const rec of manifest.pairs) pairs.push({ rec, ...(await readPair(dir, rec)) });
  const outPath = out ?? `ask-jev-report-${manifest.runId.slice(0, 8)}.html`;
  const abs = resolve(cwd, outPath);
  await writeFile(abs, renderReportHtml(manifest, pairs));
  return abs;
}
