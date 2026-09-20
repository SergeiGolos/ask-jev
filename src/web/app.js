// ask trend matrix & question editor client application
import CodeMirror from "./vendor/codemirror.js";
let treeData = null;
let currentPath = "";
let currentIsFolder = true;
let debounceTimer = null;
let currentView = "trends";
let questionsList = [];
let currentQuestion = null;
let editorInstance = null;
let isDirty = false;
let savedContent = "";

const $ = (id) => document.getElementById(id);
const tooltip = $("tooltip");

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

function formatIsoLocal(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function renderTree() {
  const container = $("treeContainer");
  container.innerHTML = "";

  // Root node for viewing all files
  const rootItem = document.createElement("div");
  rootItem.className = `tree-item ${currentPath === "" ? "active" : ""}`;
  rootItem.innerHTML = `
    <span class="tree-icon">📁</span>
    <span class="tree-label">/ (All Files)</span>
    <span class="tree-badge">${treeData.root.runCount}</span>
  `;
  rootItem.onclick = () => selectNode("", true);
  container.appendChild(rootItem);

  function createNodeEl(node) {
    if (node.type === "directory") {
      const dirDiv = document.createElement("div");
      dirDiv.className = "tree-dir";

      const details = document.createElement("details");
      details.open = true;

      const summary = document.createElement("summary");
      summary.className = currentPath === node.path ? "active" : "";
      summary.innerHTML = `
        <span class="tree-icon">▸</span>
        <span class="tree-label">${node.name}/</span>
        <span class="tree-badge">${node.runCount}</span>
      `;
      summary.onclick = (e) => {
        // Only trigger selection if clicking label/badge, or toggle folder
        selectNode(node.path, true);
      };

      const childrenDiv = document.createElement("div");
      childrenDiv.className = "tree-children";

      if (node.children) {
        for (const child of node.children) {
          childrenDiv.appendChild(createNodeEl(child));
        }
      }

      details.appendChild(summary);
      details.appendChild(childrenDiv);
      dirDiv.appendChild(details);
      return dirDiv;
    } else {
      const fileDiv = document.createElement("div");
      fileDiv.className = `tree-item ${currentPath === node.path ? "active" : ""}`;
      fileDiv.setAttribute("data-path", node.path.toLowerCase());
      fileDiv.innerHTML = `
        <span class="tree-icon">📄</span>
        <span class="tree-label">${node.name}</span>
        <span class="tree-badge">${node.runCount}</span>
      `;
      fileDiv.onclick = () => selectNode(node.path, false);
      return fileDiv;
    }
  }

  if (treeData.root.children) {
    for (const child of treeData.root.children) {
      container.appendChild(createNodeEl(child));
    }
  }
}

function selectNode(path, isFolder) {
  currentPath = path;
  currentIsFolder = isFolder;

  // Update active class in tree
  document.querySelectorAll(".tree-item, .tree-dir summary").forEach((el) => {
    el.classList.remove("active");
  });

  $("targetType").textContent = isFolder ? "directory" : "file";
  $("targetPath").textContent = path === "" ? "/ (All Files)" : path;
  $("targetPath").title = path === "" ? "All Files" : path;

  loadMatrix();
}

function populateFilters() {
  const askSel = $("askSelect");
  const prevAsk = askSel.value;
  askSel.innerHTML = `<option value="">All Asks</option>`;
  for (const ask of treeData.availableAsks || []) {
    const opt = document.createElement("option");
    opt.value = ask;
    opt.textContent = ask;
    askSel.appendChild(opt);
  }
  askSel.value = prevAsk; // keep the user's filter across auto-refreshes

  const qSel = $("questionSelect");
  const prevQ = qSel.value;
  qSel.innerHTML = `<option value="">All Questions</option>`;
  for (const q of treeData.availableQuestions || []) {
    const opt = document.createElement("option");
    opt.value = q;
    opt.textContent = q;
    qSel.appendChild(opt);
  }
  qSel.value = prevQ;

  const runSel = $("runAskSelect");
  const prevRun = runSel.value;
  runSel.innerHTML = "";
  for (const ask of treeData.availableAsks || []) {
    const opt = document.createElement("option");
    opt.value = ask;
    opt.textContent = ask;
    runSel.appendChild(opt);
  }
  if (prevRun) runSel.value = prevRun;

  if (treeData.timeRange) {
    // Optionally set min/max
    if (treeData.timeRange.min) $("dateFrom").min = treeData.timeRange.min.slice(0, 16);
    if (treeData.timeRange.max) $("dateTo").max = treeData.timeRange.max.slice(0, 16);
  }
}

async function loadMatrix() {
  const status = $("matrixStatus");
  status.style.display = "block";
  status.textContent = "Loading matrix...";

  const params = new URLSearchParams();
  if (currentPath) params.set("path", currentPath);

  const ask = $("askSelect").value;
  if (ask) params.set("ask", ask);

  const q = $("questionSelect").value;
  if (q) params.set("questions", q);

  const fromVal = $("dateFrom").value;
  if (fromVal) params.set("from", new Date(fromVal).toISOString());

  const toVal = $("dateTo").value;
  if (toVal) params.set("to", new Date(toVal).toISOString());

  const grepVal = $("grepInput").value.trim();
  if (grepVal) params.set("grep", grepVal);

  try {
    const data = await fetchJson(`/api/matrix?${params.toString()}`);
    status.style.display = "none";
    renderMatrix(data);
  } catch (err) {
    status.style.display = "block";
    status.textContent = `Error loading matrix: ${err.message}`;
  }
}

function renderMatrix(data) {
  tooltip.style.display = "none";
  const thead = $("matrixHead");
  const tbody = $("matrixBody");
  thead.innerHTML = "";
  tbody.innerHTML = "";

  if (!data.runs || data.runs.length === 0) {
    thead.innerHTML = `<tr><th>Question</th></tr>`;
    tbody.innerHTML = `<tr><td style="padding: 24px; color: var(--muted); text-align: center;">No runs found matching query criteria.</td></tr>`;
    return;
  }

  // Build thead
  const headRow = document.createElement("tr");
  const cornerTh = document.createElement("th");
  cornerTh.textContent = `Question (${data.questions.length})`;
  headRow.appendChild(cornerTh);

  for (const r of data.runs) {
    const th = document.createElement("th");
    th.innerHTML = `
      <div class="col-run-head">
        <span class="col-run-time">${formatIsoLocal(r.timestamp)}</span>
        <div class="col-run-meta">
          <span>${r.ask}</span>
          <span>·</span>
          <span>${
            r.repo && r.sha
              ? `<a href="${r.repo}/commit/${r.sha}" target="_blank" rel="noopener">${r.runId.slice(0, 8)}</a>`
              : r.runId.slice(0, 8)
          }</span>
        </div>
      </div>
    `;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);

  if (data.questions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${data.runs.length + 1}" style="padding: 24px; color: var(--muted); text-align: center;">No questions matching filters.</td></tr>`;
    return;
  }

  // Build tbody
  for (const q of data.questions) {
    const row = document.createElement("tr");
    const qTh = document.createElement("th");
    qTh.textContent = q.id;
    qTh.title = q.id;
    // Series for the hover graph, oldest→newest (chart time axis runs left→right, unlike the table).
    const points = [];
    for (let i = data.runs.length - 1; i >= 0; i--) {
      const c = q.cells[data.runs[i].runId];
      if (c && c.value !== null && c.value !== undefined) {
        points.push({ t: data.runs[i].timestamp, v: c.value });
      }
    }
    qTh.setAttribute("data-graph", JSON.stringify({ question: q.id, points }));
    row.appendChild(qTh);

    for (let i = 0; i < data.runs.length; i++) {
      const r = data.runs[i];
      const td = document.createElement("td");
      const cell = q.cells[r.runId];

      if (cell) {
        let deltaHtml = "";
        if (cell.delta !== null && cell.delta !== undefined) {
          if (cell.delta > 0) {
            deltaHtml = `<span class="delta-badge pos">+${cell.delta}</span>`;
          } else if (cell.delta < 0) {
            deltaHtml = `<span class="delta-badge neg">${cell.delta}</span>`;
          } else {
            deltaHtml = `<span class="delta-badge zero">0</span>`;
          }
        } else if (cell.changed) {
          deltaHtml = `<span class="delta-badge changed">changed</span>`;
        }

        const prevRun = i < data.runs.length - 1 ? data.runs[i + 1] : null; // older run is one column right
        const diffUrl = cell.changed && prevRun?.sha && r.sha && r.repo
          ? `${r.repo}/compare/${prevRun.sha}...${r.sha}`
          : null;

        td.innerHTML = `
          <div class="cell-content">
            <span class="cell-val ${cell.tone}">${cell.display}</span>
            ${deltaHtml}
            ${diffUrl ? `<a class="diff-link" href="${diffUrl}" target="_blank" rel="noopener" title="git diff ${prevRun.sha.slice(0, 8)}…${r.sha.slice(0, 8)}">↗</a>` : ""}
          </div>
        `;

        // Store cell info for tooltip
        td.setAttribute("data-tooltip", JSON.stringify({
          question: q.id,
          runId: r.runId,
          timestamp: r.timestamp,
          ask: r.ask,
          model: r.model,
          value: cell.display,
          delta: cell.delta,
          changed: cell.changed,
          prevDisplay: cell.prevDisplay,
          fileCount: cell.fileCount,
          min: cell.min,
          max: cell.max
        }));
      } else {
        td.innerHTML = `<span style="color: var(--muted); opacity: 0.4;">—</span>`;
      }

      row.appendChild(td);
    }

    tbody.appendChild(row);
  }
}

function sparklineSvg(points) {
  const W = 260, H = 80, P = 12;
  if (points.length === 0) return `<div class="tooltip-graph-empty">no numeric history</div>`;
  const vals = points.map((p) => p.v);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i) => (points.length === 1 ? W / 2 : P + (i / (points.length - 1)) * (W - 2 * P));
  const y = (v) => H - P - ((v - min) / span) * (H - 2 * P);
  const dots = points
    .map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="2.5"><title>${formatIsoLocal(p.t)} — ${p.v}</title></circle>`)
    .join("");
  const line = points.length > 1
    ? `<polyline points="${points.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ")}"/>`
    : "";
  return `<svg class="tooltip-graph" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><text x="${P}" y="9">${max}</text><text x="${P}" y="${H - 2}">${min}</text>${line}${dots}</svg>`;
}

// Tooltip handler
document.addEventListener("mouseover", (e) => {
  const qTh = e.target.closest("th[data-graph]");
  if (qTh) {
    try {
      const info = JSON.parse(qTh.getAttribute("data-graph"));
      tooltip.innerHTML = `
        <div class="tooltip-title">${info.question}</div>
        ${sparklineSvg(info.points)}
      `;
      tooltip.style.display = "block";
    } catch {}
    return;
  }

  const td = e.target.closest("td[data-tooltip]");
  if (!td) {
    tooltip.style.display = "none";
    return;
  }

  try {
    const info = JSON.parse(td.getAttribute("data-tooltip"));
    tooltip.innerHTML = `
      <div class="tooltip-title">${info.question}</div>
      <div class="tooltip-row"><span class="k">Run:</span><span class="v">${info.runId.slice(0, 8)} (${info.ask})</span></div>
      <div class="tooltip-row"><span class="k">Time:</span><span class="v">${formatIsoLocal(info.timestamp)}</span></div>
      <div class="tooltip-row"><span class="k">Value:</span><span class="v">${info.value}</span></div>
      ${info.prevDisplay ? `<div class="tooltip-row"><span class="k">Previous:</span><span class="v">${info.prevDisplay}</span></div>` : ""}
      ${info.delta !== null && info.delta !== undefined ? `<div class="tooltip-row"><span class="k">Delta:</span><span class="v">${info.delta > 0 ? "+" + info.delta : info.delta}</span></div>` : ""}
      ${info.fileCount ? `<div class="tooltip-row"><span class="k">Files (n):</span><span class="v">${info.fileCount} [min: ${info.min}, max: ${info.max}]</span></div>` : ""}
    `;
    tooltip.style.display = "block";
  } catch {}
});

document.addEventListener("mousemove", (e) => {
  if (tooltip.style.display === "block") {
    const x = e.clientX + 14;
    const y = e.clientY + 14;
    tooltip.style.left = `${Math.min(window.innerWidth - 340, x)}px`;
    tooltip.style.top = `${Math.min(window.innerHeight - 200, y)}px`;
  }
});

document.addEventListener("mouseout", (e) => {
  if (!e.relatedTarget || !e.relatedTarget.closest("td[data-tooltip], th[data-graph]")) {
    tooltip.style.display = "none";
  }
});

// Event Listeners for Filters
$("treeFilter").addEventListener("input", (e) => {
  const q = e.target.value.toLowerCase().trim();
  document.querySelectorAll(".tree-item[data-path]").forEach((el) => {
    const path = el.getAttribute("data-path");
    el.style.display = !q || path.includes(q) ? "flex" : "none";
  });
});

$("askSelect").addEventListener("change", () => loadMatrix());
$("questionSelect").addEventListener("change", () => loadMatrix());
$("dateFrom").addEventListener("change", () => loadMatrix());
$("dateTo").addEventListener("change", () => loadMatrix());

$("grepInput").addEventListener("input", (e) => {
  const val = e.target.value.trim();
  const statusEl = $("grepStatus");

  if (val) {
    try {
      new RegExp(val);
      statusEl.textContent = "✓";
      statusEl.className = "grep-status";
    } catch {
      statusEl.textContent = "⚠ invalid regex (fallback to text)";
      statusEl.className = "grep-status error";
    }
  } else {
    statusEl.textContent = "";
  }

  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => loadMatrix(), 200);
});

$("btnReset").addEventListener("click", () => {
  $("askSelect").value = "";
  $("questionSelect").value = "";
  $("dateFrom").value = "";
  $("dateTo").value = "";
  $("grepInput").value = "";
  $("grepStatus").textContent = "";
  $("treeFilter").value = "";
  document.querySelectorAll(".tree-item[data-path]").forEach((el) => el.style.display = "flex");
  loadMatrix();
});

// Run the selected ask against the current tree target.
$("btnRun").addEventListener("click", async () => {
  const ask = $("runAskSelect").value;
  const status = $("matrixStatus");
  if (!ask) {
    status.style.display = "block";
    status.textContent = "No asks available — create one with `ask new <name>`.";
    return;
  }
  const btn = $("btnRun");
  btn.disabled = true;
  status.style.display = "block";
  status.textContent = `Running '${ask}' on ${currentPath || "/ (All Files)"} …`;
  try {
    const res = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ask, path: currentPath }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const out = await res.json();
    await refreshAll(true);
    status.textContent = `Run ${out.runId.slice(0, 8)} recorded (${out.pairs.length} pair${out.pairs.length === 1 ? "" : "s"})`;
  } catch (err) {
    status.textContent = `Run failed: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
});

/** Fetch fresh tree data; re-render tree + filters + matrix when it changed (or force is set). */
async function refreshAll(force = false) {
  const fresh = await fetchJson("/api/tree");
  if (!force && JSON.stringify(fresh) === JSON.stringify(treeData)) return false;
  treeData = fresh;
  renderTree();
  populateFilters();
  await loadMatrix();
  return true;
}

// Initialize
async function init() {
  try {
    await refreshAll(true);
  } catch (err) {
    $("matrixStatus").style.display = "block";
    $("matrixStatus").textContent = `Failed to initialize: ${err.message}`;
  }
}

init();

// Poll for newly recorded runs; refresh the view when history changed.
setInterval(async () => {
  if (document.hidden || !treeData) return;
  try {
    await refreshAll();
  } catch {}
}, 30000);

/* =========================================================================
 * Question Manager & CodeMirror Editor
 * ========================================================================= */

function switchView(view) {
  currentView = view;
  if (view === "trends") {
    $("brandSub").textContent = "trends";
    $("tabTrends").classList.add("active");
    $("tabQuestions").classList.remove("active");
    $("trendsSearchWrap").style.display = "";
    $("treeContainer").style.display = "";
    $("questionsSearchWrap").style.display = "none";
    $("questionsContainer").style.display = "none";
    $("trendsView").style.display = "";
    $("questionsView").style.display = "none";
  } else {
    $("brandSub").textContent = "questions";
    $("tabQuestions").classList.add("active");
    $("tabTrends").classList.remove("active");
    $("trendsSearchWrap").style.display = "none";
    $("treeContainer").style.display = "none";
    $("questionsSearchWrap").style.display = "";
    $("questionsContainer").style.display = "";
    $("trendsView").style.display = "none";
    $("questionsView").style.display = "";
    loadQuestions();
    if (editorInstance) {
      setTimeout(() => editorInstance.refresh(), 20);
    }
  }
}

$("tabTrends").addEventListener("click", () => switchView("trends"));
$("tabQuestions").addEventListener("click", () => switchView("questions"));

async function loadQuestions() {
  try {
    const data = await fetchJson("/api/questions");
    questionsList = data.questions || [];
    renderQuestionsTree($("questionsFilter").value);
  } catch (err) {
    console.error("Failed to load questions:", err);
  }
}

$("questionsFilter").addEventListener("input", (e) => {
  renderQuestionsTree(e.target.value);
});

function renderQuestionsTree(filter = "") {
  const container = $("questionsContainer");
  container.innerHTML = "";

  const qFilt = filter.trim().toLowerCase();
  const filtered = questionsList.filter((q) => {
    if (!qFilt) return true;
    return q.name.toLowerCase().includes(qFilt) || (q.description && q.description.toLowerCase().includes(qFilt));
  });

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "tree-empty";
    empty.style.padding = "12px 8px";
    empty.style.color = "var(--muted)";
    empty.style.fontSize = "12px";
    empty.textContent = questionsList.length === 0 ? "No questions found. Click '＋ New' to create one." : "No matching questions.";
    container.appendChild(empty);
    return;
  }

  // Group into folders and root files
  const tree = { folders: {}, files: [] };
  for (const q of filtered) {
    const parts = q.name.split("/");
    if (parts.length > 1) {
      let curr = tree;
      for (let i = 0; i < parts.length - 1; i++) {
        const f = parts[i];
        if (!curr.folders[f]) curr.folders[f] = { folders: {}, files: [] };
        curr = curr.folders[f];
      }
      curr.files.push(q);
    } else {
      tree.files.push(q);
    }
  }

  function createTreeDom(node, folderPath = "") {
    const frag = document.createDocumentFragment();

    // Folders first
    for (const [fName, subNode] of Object.entries(node.folders)) {
      const dirDiv = document.createElement("div");
      dirDiv.className = "tree-dir";
      const details = document.createElement("details");
      details.open = true;
      const summary = document.createElement("summary");
      const curPath = folderPath ? `${folderPath}/${fName}` : fName;
      summary.innerHTML = `
        <span class="tree-icon">▾</span>
        <span class="tree-label">📁 ${fName}/</span>
      `;
      const childrenDiv = document.createElement("div");
      childrenDiv.className = "tree-children";
      childrenDiv.appendChild(createTreeDom(subNode, curPath));
      details.appendChild(summary);
      details.appendChild(childrenDiv);
      dirDiv.appendChild(details);
      frag.appendChild(dirDiv);
    }

    // Files
    for (const q of node.files) {
      const item = document.createElement("div");
      const isAct = currentQuestion && currentQuestion.name === q.name;
      item.className = `tree-item ${isAct ? "active" : ""}`;
      item.setAttribute("data-name", q.name);
      const shortName = q.name.split("/").pop();
      item.innerHTML = `
        <span class="status-dot ${q.isRunnable ? "ok" : "warn"}" title="${q.isRunnable ? "Runnable" : "Missing schema"}"></span>
        <span class="tree-label" title="${q.name} - ${q.description || "No description"}">${shortName}</span>
      `;
      item.onclick = () => selectQuestion(q.name);
      frag.appendChild(item);
    }
    return frag;
  }

  container.appendChild(createTreeDom(tree));
}

$("questionsContainer").addEventListener("click", (e) => {
  const item = e.target.closest(".tree-item");
  if (item && item.dataset.name) {
    selectQuestion(item.dataset.name);
  }
});


async function selectQuestion(name, force = false) {
  if (isDirty && !force) {
    const ok = window.confirm("You have unsaved changes in the current question. Discard them?");
    if (!ok) return;
  }

  try {
    const data = await fetchJson(`/api/questions?name=${encodeURIComponent(name)}`);
    currentQuestion = data;
    savedContent = data.content;
    isDirty = false;

    $("questionEmptyState").style.display = "none";
    $("questionEditorSurface").style.display = "flex";

    $("qTitle").textContent = data.path || data.name;
    $("qModelBadge").textContent = data.meta?.model || "-";
    $("qStatusBadge").textContent = data.isRunnable ? "runnable" : "no schema";
    $("qStatusBadge").className = `badge ${data.isRunnable ? "badge-ok" : "badge-warn"}`;
    $("qSaveStatus").textContent = "Saved";
    $("qSaveStatus").classList.remove("dirty");

    updateSummaryCard(data.meta, data.schema);

    if (!editorInstance) {
      const cmFactory = CodeMirror || window.CodeMirror;
      editorInstance = cmFactory($("editorContainer"), {
        value: data.content,
        mode: { name: "yaml-frontmatter", base: "gfm" },
        lineNumbers: true,
        styleActiveLine: true,
        matchBrackets: true,
        autoCloseBrackets: true,
        lineWrapping: true,
        tabSize: 2,
      });

      editorInstance.on("change", () => {
        const val = editorInstance.getValue();
        isDirty = val !== savedContent;
        $("qSaveStatus").textContent = isDirty ? "Unsaved changes ●" : "Saved";
        $("qSaveStatus").classList.toggle("dirty", isDirty);
        updateVisualHighlights(editorInstance);
        parseAndUpdateSummary(val);
      });
      editorInstance.getWrapperElement().CodeMirror = editorInstance;
      window.editorInstance = editorInstance;
    } else {
      editorInstance.setValue(data.content);
      editorInstance.clearHistory();
      setTimeout(() => editorInstance.refresh(), 10);
    }
    window.editorInstance = editorInstance;

    updateVisualHighlights(editorInstance);
    renderQuestionsTree($("questionsFilter").value);
  } catch (err) {
    window.__last_error = (err && err.stack) || String(err);
    console.error("Failed to load question:", err);
  }
}

/** Highlight frontmatter and trailing schema lines visually in CodeMirror. */
function updateVisualHighlights(cm) {
  const lineCount = cm.lineCount();
  for (let i = 0; i < lineCount; i++) {
    cm.removeLineClass(i, "background", "cm-frontmatter-line");
    cm.removeLineClass(i, "wrap", "cm-frontmatter-start");
    cm.removeLineClass(i, "wrap", "cm-frontmatter-end");
    cm.removeLineClass(i, "background", "cm-schema-line");
    cm.removeLineClass(i, "wrap", "cm-schema-start");
  }

  // Frontmatter lines (line 0 '---' to closing '---')
  const line0 = cm.getLine(0)?.trim();
  if (line0 === "---") {
    let close = -1;
    for (let i = 1; i < lineCount; i++) {
      if (cm.getLine(i).trim() === "---") {
        close = i;
        break;
      }
    }
    if (close > 0) {
      for (let i = 0; i <= close; i++) {
        cm.addLineClass(i, "background", "cm-frontmatter-line");
      }
      cm.addLineClass(0, "wrap", "cm-frontmatter-start");
      cm.addLineClass(close, "wrap", "cm-frontmatter-end");
    }
  }

  // Schema lines (after the last standalone '---' outside code fences)
  let lastSeparator = -1;
  let inFence = false;
  for (let i = 0; i < lineCount; i++) {
    const text = cm.getLine(i);
    if (/^\s*```/.test(text)) {
      inFence = !inFence;
    } else if (!inFence && text.trim() === "---" && i > 0) {
      lastSeparator = i;
    }
  }

  if (lastSeparator > 0 && lastSeparator < lineCount - 1) {
    for (let i = lastSeparator; i < lineCount; i++) {
      cm.addLineClass(i, "background", "cm-schema-line");
    }
    cm.addLineClass(lastSeparator, "wrap", "cm-schema-start");
  }
}

/** Fast client-side extractor to keep visual summary card in sync with typing. */
function parseAndUpdateSummary(text) {
  const lines = text.split("\n");
  let description = "";
  let model = "";
  const args = [];
  let inArgs = false;

  // Parse frontmatter
  if (lines[0]?.trim() === "---") {
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === "---") break;
      const mDesc = /^description:\s*["']?(.*?)["']?\s*$/.exec(line);
      if (mDesc) description = mDesc[1];
      const mMod = /^model:\s*(.+)$/.exec(line);
      if (mMod) model = mMod[1].trim();
      if (/^args:\s*$/.test(line)) {
        inArgs = true;
        continue;
      }
      if (inArgs) {
        const mArg = /^\s+([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
        if (mArg) args.push(`${mArg[1]}=${mArg[2].trim()}`);
        else if (/^[^\s]/.test(line)) inArgs = false;
      }
    }
  }

  // Find schema section after last standalone '---'
  let lastSep = -1;
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) inFence = !inFence;
    else if (!inFence && lines[i].trim() === "---" && i > 0) lastSep = i;
  }

  const schemaQuestions = [];
  if (lastSep > 0) {
    for (let i = lastSep + 1; i < lines.length; i++) {
      const qMatch = /^([A-Za-z0-9_-]+):\s*$/.exec(lines[i]);
      if (qMatch) {
        const qId = qMatch[1];
        let qType = "";
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const tMatch = /^\s+type:\s*(\w+)/.exec(lines[j]);
          if (tMatch) {
            qType = tMatch[1];
            break;
          }
        }
        schemaQuestions.push(qType ? `${qId} (${qType})` : qId);
      }
    }
  }

  const runnable = schemaQuestions.length > 0;
  $("qModelBadge").textContent = model || "-";
  $("qStatusBadge").textContent = runnable ? "runnable" : "no schema";
  $("qStatusBadge").className = `badge ${runnable ? "badge-ok" : "badge-warn"}`;

  $("fmDesc").textContent = description || "(none)";
  $("fmModelVal").textContent = model || "(none)";

  const argsWrap = $("fmArgsPills");
  argsWrap.innerHTML = "";
  if (args.length > 0) {
    for (const a of args) {
      const span = document.createElement("span");
      span.className = "fm-pill";
      span.textContent = a;
      argsWrap.appendChild(span);
    }
    $("fmArgsGroup").style.display = "flex";
  } else {
    $("fmArgsGroup").style.display = "none";
  }

  const schemaWrap = $("fmSchemaPills");
  schemaWrap.innerHTML = "";
  if (schemaQuestions.length > 0) {
    for (const sq of schemaQuestions) {
      const span = document.createElement("span");
      span.className = "fm-pill";
      span.textContent = sq;
      schemaWrap.appendChild(span);
    }
    $("fmSchemaGroup").style.display = "flex";
  } else {
    $("fmSchemaGroup").style.display = "none";
  }
}

function updateSummaryCard(meta = {}, schema = null) {
  $("fmDesc").textContent = meta.description || "(none)";
  $("fmModelVal").textContent = meta.model || "(none)";

  const argsWrap = $("fmArgsPills");
  argsWrap.innerHTML = "";
  const args = Object.entries(meta.args || {});
  if (args.length > 0) {
    for (const [k, v] of args) {
      const span = document.createElement("span");
      span.className = "fm-pill";
      span.textContent = `${k}=${v}`;
      argsWrap.appendChild(span);
    }
    $("fmArgsGroup").style.display = "flex";
  } else {
    $("fmArgsGroup").style.display = "none";
  }

  const schemaWrap = $("fmSchemaPills");
  schemaWrap.innerHTML = "";
  const qs = Object.entries(schema || {});
  if (qs.length > 0) {
    for (const [k, v] of qs) {
      const span = document.createElement("span");
      span.className = "fm-pill";
      span.textContent = `${k} (${v?.type || "question"})`;
      schemaWrap.appendChild(span);
    }
    $("fmSchemaGroup").style.display = "flex";
  } else {
    $("fmSchemaGroup").style.display = "none";
  }
}

async function saveCurrentQuestion() {
  if (!currentQuestion || !editorInstance) return;
  $("qSaveStatus").textContent = "Saving...";
  try {
    const res = await fetch("/api/questions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: currentQuestion.name,
        path: currentQuestion.path,
        content: editorInstance.getValue(),
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const out = await res.json();
    savedContent = editorInstance.getValue();
    isDirty = false;
    $("qSaveStatus").textContent = "Saved";
    $("qSaveStatus").classList.remove("dirty");
    currentQuestion.meta = out.meta;
    currentQuestion.schema = out.schema;
    currentQuestion.isRunnable = out.isRunnable;
    updateSummaryCard(out.meta, out.schema);
    loadQuestions();
  } catch (err) {
    $("qSaveStatus").textContent = "Save failed";
    alert(`Failed to save question: ${err.message}`);
  }
}

$("btnSaveQuestion").addEventListener("click", saveCurrentQuestion);

// Keyboard shortcut: Ctrl+S / Cmd+S
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
    if (currentView === "questions") {
      e.preventDefault();
      saveCurrentQuestion();
    }
  }
});

/* =========================================================================
 * Modals & Organizing (New, Move, Duplicate, Delete, Run)
 * ========================================================================= */

let activeModalHandler = null;

function showModal({ title, label, initialValue = "", confirmText = "Confirm", onConfirm }) {
  $("modalTitle").textContent = title;
  $("modalLabel").textContent = label;
  $("modalInput").value = initialValue;
  $("modalError").textContent = "";
  $("btnModalConfirm").textContent = confirmText;
  $("modalBackdrop").style.display = "flex";
  $("modalInput").focus();
  $("modalInput").select();

  activeModalHandler = async () => {
    const val = $("modalInput").value.trim();
    if (!val) {
      $("modalError").textContent = "Field cannot be empty.";
      return;
    }
    try {
      $("btnModalConfirm").disabled = true;
      await onConfirm(val);
      hideModal();
    } catch (err) {
      $("modalError").textContent = err.message;
    } finally {
      $("btnModalConfirm").disabled = false;
    }
  };
}

function hideModal() {
  $("modalBackdrop").style.display = "none";
  activeModalHandler = null;
}

$("btnModalCancel").addEventListener("click", hideModal);
$("btnModalConfirm").addEventListener("click", () => activeModalHandler && activeModalHandler());
$("modalInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") activeModalHandler && activeModalHandler();
  else if (e.key === "Escape") hideModal();
});

function promptNewQuestion() {
  showModal({
    title: "Create New Question",
    label: "Question Name or Path (e.g. security-audit or reviews/code-quality)",
    initialValue: "",
    confirmText: "Create",
    onConfirm: async (val) => {
      const res = await fetch("/api/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: val }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const created = await res.json();
      await loadQuestions();
      await selectQuestion(created.name, true);
    },
  });
}

$("btnNewQuestion").addEventListener("click", promptNewQuestion);
$("btnEmptyNewQuestion").addEventListener("click", promptNewQuestion);

$("btnMoveQuestion").addEventListener("click", () => {
  if (!currentQuestion) return;
  showModal({
    title: "Rename / Move Question",
    label: "Destination Path inside .questions (e.g. subfolder/name.md)",
    initialValue: currentQuestion.path,
    confirmText: "Move",
    onConfirm: async (val) => {
      const res = await fetch("/api/questions/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: currentQuestion.path, to: val }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const moved = await res.json();
      await loadQuestions();
      await selectQuestion(moved.to.replace(/\.md$/i, ""), true);
    },
  });
});

$("btnDuplicateQuestion").addEventListener("click", () => {
  if (!currentQuestion || !editorInstance) return;
  const base = currentQuestion.name.replace(/\.md$/i, "");
  showModal({
    title: "Duplicate Question",
    label: "New Question Name",
    initialValue: `${base}-copy`,
    confirmText: "Duplicate",
    onConfirm: async (val) => {
      const res = await fetch("/api/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: val, content: editorInstance.getValue() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const created = await res.json();
      await loadQuestions();
      await selectQuestion(created.name, true);
    },
  });
});

$("btnDeleteQuestion").addEventListener("click", async () => {
  if (!currentQuestion) return;
  const ok = window.confirm(`Permanently delete question "${currentQuestion.path || currentQuestion.name}"?`);
  if (!ok) return;
  try {
    const res = await fetch(`/api/questions?name=${encodeURIComponent(currentQuestion.name)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    currentQuestion = null;
    savedContent = "";
    isDirty = false;
    $("questionEditorSurface").style.display = "none";
    $("questionEmptyState").style.display = "flex";
    await loadQuestions();
  } catch (err) {
    alert(`Failed to delete question: ${err.message}`);
  }
});

$("btnRunQuestion").addEventListener("click", async () => {
  if (!currentQuestion) return;
  if (isDirty) {
    await saveCurrentQuestion();
  }
  const targetFile = prompt(
    `Run ask '${currentQuestion.name}' against file or directory:`,
    currentPath || "src/serve.ts",
  );
  if (targetFile === null) return;
  const btn = $("btnRunQuestion");
  btn.disabled = true;
  btn.textContent = "Running...";
  try {
    const res = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ask: currentQuestion.name, path: targetFile }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const out = await res.json();
    const jump = window.confirm(`Run recorded (${out.pairs?.length || 0} pairs judged).\n\nSwitch to Trends to see matrix results?`);
    if (jump) {
      switchView("trends");
      await refreshAll(true);
    }
  } catch (err) {
    alert(`Run failed: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "▶ Run";
  }
});

window.switchView = switchView;
window.selectQuestion = selectQuestion;
window.saveCurrentQuestion = saveCurrentQuestion;
