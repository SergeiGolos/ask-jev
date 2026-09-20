// ask trend matrix & question editor client application
import CodeMirror from "./vendor/codemirror.js";
let treeData = null;
let currentPath = "";
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

function selectNode(path) {
  navigate("#/trends" + (path ? "/" + path : ""));
}

/** Resolve a tree node by path to label it file/directory. */
function findTreeNode(path, node = treeData?.root) {
  if (!node || path === "") return node ?? null;
  for (const child of node.children || []) {
    if (child.path === path) return child;
    const hit = findTreeNode(path, child);
    if (hit && hit.path === path) return hit;
  }
  return null;
}

function updateTargetBadge() {
  const node = findTreeNode(currentPath);
  const isFolder = !currentPath || (node ? node.type === "directory" : true);
  $("targetType").textContent = isFolder ? "directory" : "file";
  $("targetPath").textContent = currentPath === "" ? "/ (All Files)" : currentPath;
  $("targetPath").title = currentPath === "" ? "All Files" : currentPath;
}

/** Apply a trends target from the route; deep links boot before treeData exists. */
function setTrendsTarget(path) {
  currentPath = path;
  updateTargetBadge();
  if (treeData) {
    renderTree();
    loadMatrix();
  }
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
  if (runSel) {
    const prevRun = runSel.value;
    runSel.innerHTML = "";
    for (const ask of treeData.availableAsks || []) {
      const opt = document.createElement("option");
      opt.value = ask;
      opt.textContent = ask;
      runSel.appendChild(opt);
    }
    if (prevRun) runSel.value = prevRun;
  }

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

/** Compact run-ask label: one ask links through; many collapse to shared prefix + count badge.
 *  Individual ask links live in the grid's group subheader rows. */
function runAsksHtml(asks) {
  if (asks.length === 1) {
    const a = asks[0];
    return `<a href="#/questions/${encodeURIComponent(a)}" title="Open question">${a}</a>`;
  }
  const parts = asks.map((a) => a.split("/"));
  let prefix = "";
  if (parts.every((p) => p.length > 1)) {
    const first = parts[0];
    let i = 0;
    while (i < first.length - 1 && parts.every((p) => p[i] === first[i])) i++;
    if (i > 0) prefix = first.slice(0, i).join("/") + "/";
  }
  const full = asks.join("\n");
  return `${prefix ? `<span title="${full}">${prefix}</span> ` : ""}<span class="asks-summary" title="${full}">${asks.length} asks</span>`;
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
          <span>${runAsksHtml(r.asks)}</span>
          <span>·</span>
          <span>${
            `<a href="#/runs/${r.runId}" title="Open run report">${r.runId.slice(0, 8)}</a>` +
            (r.repo && r.sha ? ` <a href="${r.repo}/commit/${r.sha}" target="_blank" rel="noopener" title="git commit">↗</a>` : "")
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

  // Build tbody: rows grouped by ask with a subheader row per group linking back to the question.
  const groups = new Map();
  for (const q of data.questions) {
    if (!groups.has(q.ask)) groups.set(q.ask, []);
    groups.get(q.ask).push(q);
  }

  for (const [ask, rows] of groups) {
    const gTr = document.createElement("tr");
    gTr.className = "group-row";
    const gTh = document.createElement("th");
    gTh.colSpan = data.runs.length + 1;
    gTh.setAttribute("data-askinfo", JSON.stringify({ ask, questions: rows.map((r) => r.id) }));
    gTh.innerHTML = `📂 <a class="group-link" href="#/questions/${encodeURIComponent(ask)}" title="Open question in editor">${ask}</a><span class="group-count">${rows.length} question${rows.length === 1 ? "" : "s"}</span><span class="group-open">hover for detail · name links to editor ↗</span>`;
    gTr.appendChild(gTh);
    tbody.appendChild(gTr);

    for (const q of rows) {
    const row = document.createElement("tr");
    const qTh = document.createElement("th");
    const leaf = q.id.startsWith(ask + "/") ? q.id.slice(ask.length + 1) : q.id;
    qTh.textContent = leaf;
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
          asks: r.asks,
          models: r.models,
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
  const gTh = e.target.closest("th[data-askinfo]");
  if (gTh) {
    try {
      const info = JSON.parse(gTh.getAttribute("data-askinfo"));
      tooltip.innerHTML = `
        <div class="tooltip-title">${info.ask}</div>
        <div class="tooltip-row"><span class="k">Questions:</span><span class="v">${info.questions.length}</span></div>
        ${info.questions.map((q) => `<div class="tooltip-row"><span class="k">·</span><span class="v">${q.startsWith(info.ask + "/") ? q.slice(info.ask.length + 1) : q}</span></div>`).join("")}
        <div class="tooltip-row"><span class="k">Open:</span><span class="v">#/questions/${info.ask} ↗</span></div>
      `;
      tooltip.style.display = "block";
    } catch {}
    return;
  }

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
      <div class="tooltip-row"><span class="k">Run:</span><span class="v">${info.runId.slice(0, 8)} (${info.asks.join(", ")})</span></div>
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
  if (!e.relatedTarget || !e.relatedTarget.closest("td[data-tooltip], th[data-graph], th[data-askinfo]")) {
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

// Run Dialog State
let runDialogAsks = [];
let runDialogFiles = [];
let selectedRunAsks = new Set();
let selectedRunFiles = new Set();

function updateRunDialogCounts() {
  $("runAsksCount").textContent = String(selectedRunAsks.size);
  $("runFilesCount").textContent = String(selectedRunFiles.size);
  const btn = $("btnRunModalExecute");
  const isBatch = $("runBatchOption").checked;
  const aCount = selectedRunAsks.size;
  const fCount = selectedRunFiles.size;
  if (aCount === 0 || fCount === 0) {
    btn.disabled = true;
    btn.textContent = "Run";
  } else {
    btn.disabled = false;
    const askLabel = `${aCount} ask${aCount === 1 ? "" : "s"}`;
    const fileLabel = `${fCount} file${fCount === 1 ? "" : "s"}`;
    btn.textContent = isBatch ? `Run Batch (${askLabel}, ${fileLabel})` : `Run (${askLabel} × ${fileLabel})`;
  }
}

function filterRunFiles() {
  const filter = $("runFileGrep").value.trim();
  let re = null;
  if (filter) {
    try { re = new RegExp(filter, "i"); } catch { /* fallback to substring */ }
  }
  const items = $("runFilesList").querySelectorAll(".run-list-item");
  let matchCount = 0;
  for (const item of items) {
    const file = item.dataset.file || "";
    const matches = !filter || (re ? re.test(file) : file.toLowerCase().includes(filter.toLowerCase()));
    item.style.display = matches ? "" : "none";
    if (matches) matchCount++;
  }
  $("runFileGrepStatus").textContent = filter ? `${matchCount} / ${items.length}` : "";
}

function closeRunDialog() {
  $("runModalBackdrop").style.display = "none";
}

async function openRunDialog(options = {}) {
  $("runModalError").textContent = "";

  const batchChecked = options.batch !== undefined ? options.batch : ($("quickBatchCheck")?.checked ?? false);
  $("runBatchOption").checked = batchChecked;

  try {
    const qData = await fetchJson("/api/questions");
    runDialogAsks = (qData.questions || []).filter((q) => q.isRunnable !== false);
  } catch {
    runDialogAsks = (treeData?.availableAsks || []).map((name) => ({ name, description: "" }));
  }

  try {
    const fData = await fetchJson("/api/files");
    runDialogFiles = fData.files || [];
  } catch {
    const files = [];
    const walk = (node) => {
      if (!node) return;
      if (node.type === "file") files.push(node.path);
      for (const c of node.children || []) walk(c);
    };
    walk(treeData?.root);
    runDialogFiles = files;
  }

  selectedRunAsks = new Set();
  if (options.initialAsks?.length) {
    for (const a of options.initialAsks) selectedRunAsks.add(a);
  } else if (runDialogAsks.length === 1) {
    selectedRunAsks.add(runDialogAsks[0].name);
  }

  selectedRunFiles = new Set();
  const initPath = options.initialPath || currentPath;
  if (initPath) {
    for (const f of runDialogFiles) {
      if (f === initPath || f.startsWith(initPath.replace(/\/+$/, "") + "/")) {
        selectedRunFiles.add(f);
      }
    }
  }

  const asksContainer = $("runAsksList");
  asksContainer.innerHTML = "";
  for (const q of runDialogAsks) {
    const label = document.createElement("label");
    label.className = "run-list-item";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = q.name;
    cb.checked = selectedRunAsks.has(q.name);
    cb.onchange = () => {
      if (cb.checked) selectedRunAsks.add(q.name);
      else selectedRunAsks.delete(q.name);
      updateRunDialogCounts();
    };
    const nameSpan = document.createElement("span");
    nameSpan.className = "run-list-item-name";
    nameSpan.textContent = q.name;
    label.appendChild(cb);
    label.appendChild(nameSpan);
    if (q.description) {
      const descSpan = document.createElement("span");
      descSpan.className = "run-list-item-desc";
      descSpan.textContent = q.description;
      label.appendChild(descSpan);
    }
    asksContainer.appendChild(label);
  }

  const filesContainer = $("runFilesList");
  filesContainer.innerHTML = "";
  for (const f of runDialogFiles) {
    const label = document.createElement("label");
    label.className = "run-list-item";
    label.dataset.file = f;
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = f;
    cb.checked = selectedRunFiles.has(f);
    cb.onchange = () => {
      if (cb.checked) selectedRunFiles.add(f);
      else selectedRunFiles.delete(f);
      updateRunDialogCounts();
    };
    const nameSpan = document.createElement("span");
    nameSpan.className = "run-list-item-name";
    nameSpan.textContent = f;
    label.appendChild(cb);
    label.appendChild(nameSpan);
    filesContainer.appendChild(label);
  }

  $("runFileGrep").value = "";
  $("runFileGrepStatus").textContent = "";
  updateRunDialogCounts();
  $("runModalBackdrop").style.display = "flex";
}

$("btnRunSelectAllAsks").onclick = () => {
  for (const q of runDialogAsks) selectedRunAsks.add(q.name);
  $("runAsksList").querySelectorAll("input[type=checkbox]").forEach((cb) => (cb.checked = true));
  updateRunDialogCounts();
};

$("btnRunClearAsks").onclick = () => {
  selectedRunAsks.clear();
  $("runAsksList").querySelectorAll("input[type=checkbox]").forEach((cb) => (cb.checked = false));
  updateRunDialogCounts();
};

$("btnRunSelectMatchingFiles").onclick = () => {
  const items = $("runFilesList").querySelectorAll(".run-list-item");
  for (const item of items) {
    if (item.style.display !== "none") {
      const cb = item.querySelector("input[type=checkbox]");
      if (cb) {
        cb.checked = true;
        selectedRunFiles.add(item.dataset.file);
      }
    }
  }
  updateRunDialogCounts();
};

$("btnRunSelectAllFiles").onclick = () => {
  for (const f of runDialogFiles) selectedRunFiles.add(f);
  $("runFilesList").querySelectorAll("input[type=checkbox]").forEach((cb) => (cb.checked = true));
  updateRunDialogCounts();
};

$("btnRunClearFiles").onclick = () => {
  selectedRunFiles.clear();
  $("runFilesList").querySelectorAll("input[type=checkbox]").forEach((cb) => (cb.checked = false));
  updateRunDialogCounts();
};

$("runFileGrep").addEventListener("input", filterRunFiles);

$("runBatchOption").addEventListener("change", () => {
  if ($("quickBatchCheck")) $("quickBatchCheck").checked = $("runBatchOption").checked;
  updateRunDialogCounts();
});

$("quickBatchCheck")?.addEventListener("change", () => {
  $("runBatchOption").checked = $("quickBatchCheck").checked;
  updateRunDialogCounts();
});

$("btnRunModalClose").onclick = closeRunDialog;
$("btnRunModalCancel").onclick = closeRunDialog;

$("runModalBackdrop").onclick = (e) => {
  if (e.target === $("runModalBackdrop")) closeRunDialog();
};

$("btnRunModalExecute").onclick = async () => {
  if (selectedRunAsks.size === 0) {
    $("runModalError").textContent = "Select at least one question.";
    return;
  }
  if (selectedRunFiles.size === 0) {
    $("runModalError").textContent = "Select at least one file.";
    return;
  }
  const btn = $("btnRunModalExecute");
  btn.disabled = true;
  btn.textContent = "Running…";
  $("runModalError").textContent = "";

  const asks = Array.from(selectedRunAsks);
  const files = Array.from(selectedRunFiles);
  const batch = $("runBatchOption").checked;

  try {
    const res = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ asks, files, batch }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const out = await res.json();
    closeRunDialog();
    await refreshAll(true);
    const status = $("matrixStatus");
    status.style.display = "block";
    const asksCount = out.asks?.length || 1;
    const pairsCount = out.pairs?.length || 0;
    status.innerHTML = `Run complete: ${asksCount} ask${asksCount === 1 ? "" : "s"} (${pairsCount} pair${pairsCount === 1 ? "" : "s"}) grouped in one run.`;
  } catch (err) {
    $("runModalError").textContent = `Run failed: ${err.message}`;
    btn.disabled = false;
    updateRunDialogCounts();
  }
};

$("btnRun").addEventListener("click", () => {
  openRunDialog({
    initialAsks: $("askSelect")?.value ? [$("askSelect").value] : [],
    initialPath: currentPath,
    batch: $("quickBatchCheck")?.checked,
  });
});

/** Fetch fresh tree data; re-render tree + filters + matrix when it changed (or force is set). */
async function refreshAll(force = false) {
  const fresh = await fetchJson("/api/tree");
  if (!force && JSON.stringify(fresh) === JSON.stringify(treeData)) return false;
  treeData = fresh;
  renderTree();
  populateFilters();
  updateTargetBadge();
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
    if (currentView === "runs") await loadRuns();
  } catch {}
}, 30000);

/* =========================================================================
 * Question Manager & CodeMirror Editor
 * ========================================================================= */

const VIEWS = {
  trends: { tab: "tabTrends", search: "trendsSearchWrap", nav: "treeContainer", main: "trendsView" },
  runs: { tab: "tabRuns", search: "runsSearchWrap", nav: "runsContainer", main: "runsView" },
  questions: { tab: "tabQuestions", search: "questionsSearchWrap", nav: "questionsContainer", main: "questionsView" },
};

function switchView(view) {
  currentView = view;
  for (const [name, v] of Object.entries(VIEWS)) {
    const on = name === view;
    $(v.tab).classList.toggle("active", on);
    $(v.search).style.display = on ? "" : "none";
    $(v.nav).style.display = on ? "" : "none";
    $(v.main).style.display = on ? "" : "none";
  }
  $("crumbView").textContent = view;
  if (view === "runs") {
    loadRuns();
  } else if (view === "questions") {
    loadQuestions();
    if (editorInstance) {
      setTimeout(() => editorInstance.refresh(), 20);
    }
  }
}

$("tabTrends").addEventListener("click", () => navigate("#/trends"));
$("tabRuns").addEventListener("click", () => navigate("#/runs"));
$("tabQuestions").addEventListener("click", () => navigate("#/questions"));

/* Theme: manual dark/light override persisted in localStorage; unset follows prefers-color-scheme. */
const savedTheme = localStorage.getItem("ask-theme");
if (savedTheme === "dark" || savedTheme === "light") document.documentElement.dataset.theme = savedTheme;
$("themeBtn").addEventListener("click", () => {
  const current = document.documentElement.dataset.theme
    || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("ask-theme", next);
});

/* =========================================================================
 * Hash Router: #/trends[/<path>] · #/runs[/<runId>] · #/questions[/<name>]
 * ========================================================================= */

function navigate(hash) {
  if (location.hash === hash) applyRoute();
  else location.hash = hash; // hashchange → applyRoute
}

function parseRoute() {
  const seg = decodeURIComponent(location.hash.replace(/^#\/?/, "")).split("/");
  const view = VIEWS[seg[0]] ? seg[0] : "trends";
  return { view, param: seg.slice(1).join("/") };
}

/** Reflect the route param in the top-bar breadcrumb (trends path · run id · question name). */
function setCrumbTarget(text, title = text) {
  $("crumbTargetWrap").style.display = text ? "" : "none";
  if (text) {
    $("crumbTarget").textContent = text;
    $("crumbTarget").title = title;
  }
}

/** Single source of truth: renders whatever the URL describes. */
function applyRoute() {
  const { view, param } = parseRoute();
  switchView(view);
  if (view === "trends") {
    setCrumbTarget(param);
    if (param !== currentPath) setTrendsTarget(param);
  } else if (view === "runs") {
    setCrumbTarget(param ? param.slice(0, 8) : "", param);
    if (param && param !== currentRunId) showRun(param);
  } else if (view === "questions") {
    setCrumbTarget(param);
    if (param && currentQuestion?.name !== param) selectQuestion(param);
  }
}

window.addEventListener("hashchange", applyRoute);

/* =========================================================================
 * Runs Browser
 * ========================================================================= */

let runsList = [];
let currentRunId = null;

async function loadRuns() {
  try {
    const data = await fetchJson("/api/runs");
    runsList = data.runs || [];
    renderRunsTree($("runsFilter").value);
    // Deep link may have opened a run before the list arrived; fill its header now.
    if (currentRunId) fillRunHeader(currentRunId);
  } catch (err) {
    console.error("Failed to load runs:", err);
  }
}

/** Run instances grouped by ask file, newest first. */
function renderRunsTree(filter = "") {
  const container = $("runsContainer");
  container.innerHTML = "";

  const filt = filter.trim().toLowerCase();
  const groups = new Map();
  for (const r of runsList) {
    if (
      filt &&
      !(r.asks.some((a) => a.toLowerCase().includes(filt)) || r.runId.toLowerCase().includes(filt) || r.timestamp.toLowerCase().includes(filt))
    ) {
      continue;
    }
    // A multi-ask run appears under every ask it executed.
    for (const ask of r.asks) {
      if (!groups.has(ask)) groups.set(ask, []);
      groups.get(ask).push(r);
    }
  }

  if (groups.size === 0) {
    const empty = document.createElement("div");
    empty.className = "tree-empty";
    empty.style.padding = "12px 8px";
    empty.style.color = "var(--muted)";
    empty.style.fontSize = "12px";
    empty.innerHTML = runsList.length === 0
      ? `No runs recorded yet. <a href="#/trends">Run an ask from the Trends view</a>.`
      : "No matching runs.";
    container.appendChild(empty);
    return;
  }

  for (const [ask, list] of groups) {
    const details = document.createElement("details");
    details.className = "tree-dir";
    details.open = true;

    const summary = document.createElement("summary");
    summary.innerHTML = `
      <span class="tree-icon">▸</span>
      <span class="tree-label"><a href="#/questions/${encodeURIComponent(ask)}" title="Open question">${ask}</a></span>
      <span class="tree-badge">${list.length}</span>
    `;

    const children = document.createElement("div");
    children.className = "tree-children";
    for (const r of list) {
      const item = document.createElement("div");
      item.className = `tree-item ${r.runId === currentRunId ? "active" : ""}`;
      item.dataset.runId = r.runId;
      item.title = `${r.runId}\nmodels: ${r.models.join(", ")}`;
      item.innerHTML = `
        <span class="tree-icon">🏃</span>
        <span class="tree-label">${formatIsoLocal(r.timestamp)}</span>
        <span class="tree-badge">${r.pairCount}</span>
      `;
      item.onclick = () => navigate("#/runs/" + r.runId);
      children.appendChild(item);
    }

    details.appendChild(summary);
    details.appendChild(children);
    container.appendChild(details);
  }
}

/** Pinned header above the report iframe: run id, asks, models, time, pairs, commit link. */
function fillRunHeader(runId) {
  const bar = $("runHeaderBar");
  const r = runsList.find((x) => x.runId === runId);
  if (!r) {
    bar.style.display = "none";
    return;
  }
  const models = [...new Set(r.models || [])];
  bar.innerHTML = `
    <div class="rb-ids">
      <span class="runid-chip" title="Full run id: ${r.runId}">${r.runId.slice(0, 8)}</span>
      <span class="rb-sep">·</span>
      <span>${runAsksHtml(r.asks)}</span>
      <span class="rb-sep">·</span>
      ${models.map((m) => `<span class="model-chip">${m}</span>`).join(" ")}
      <span class="rb-sep">·</span>
      <span class="rb-meta">${formatIsoLocal(r.timestamp)}</span>
      <span class="rb-sep">·</span>
      <span class="rb-meta">${r.pairCount} pair${r.pairCount === 1 ? "" : "s"}</span>
    </div>
    ${r.repo && r.sha ? `<a class="commit-link" href="${r.repo}/commit/${r.sha}" target="_blank" rel="noopener" title="git commit ${r.sha}">commit ${r.sha.slice(0, 7)} ↗</a>` : ""}
  `;
  bar.style.display = "flex";
}

function showRun(runId) {
  currentRunId = runId;
  document.querySelectorAll("#runsContainer .tree-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.runId === runId);
  });
  $("runEmptyState").style.display = "none";
  fillRunHeader(runId);
  const frame = $("runReportFrame");
  frame.style.display = "";
  frame.src = `/api/runs/${encodeURIComponent(runId)}/report`;
}

$("runsFilter").addEventListener("input", (e) => {
  renderRunsTree(e.target.value);
});

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
        ${q.isRunnable ? "" : '<span class="warn-chip">⚠ no schema</span>'}
      `;
      item.onclick = () => routeToQuestion(q.name);
      frag.appendChild(item);
    }
    return frag;
  }

  container.appendChild(createTreeDom(tree));
}

$("questionsContainer").addEventListener("click", (e) => {
  const item = e.target.closest(".tree-item");
  if (item && item.dataset.name) {
    routeToQuestion(item.dataset.name);
  }
});

/** Click-boundary navigation with the unsaved-changes guard; routes bypass it. */
function routeToQuestion(name) {
  if (isDirty && currentQuestion && currentQuestion.name !== name && !window.confirm("You have unsaved changes in the current question. Discard them?")) return;
  navigate("#/questions/" + name);
}


async function selectQuestion(name) {
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
    } else {
      editorInstance.setValue(data.content);
      editorInstance.clearHistory();
      setTimeout(() => editorInstance.refresh(), 10);
    }
    window.editorInstance = editorInstance;
    $("editorContainer").editor = editorInstance;
    $("editorContainer").CodeMirror = editorInstance;
    editorInstance.getWrapperElement().CodeMirror = editorInstance;
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

  // Schema ```schema block lines
  let inSchemaFence = false;
  let schemaFenceStart = -1;
  let hasFencedSchema = false;

  for (let i = 0; i < lineCount; i++) {
    const text = cm.getLine(i);
    const m = /^\s*```(.*)$/.exec(text);
    if (m) {
      const tag = m[1].trim().toLowerCase().split(/\s+/)[0];
      if (!inSchemaFence && (tag === "schema" || (tag === "yaml" && m[1].includes("schema")))) {
        inSchemaFence = true;
        schemaFenceStart = i;
        hasFencedSchema = true;
      } else if (inSchemaFence) {
        inSchemaFence = false;
        for (let j = schemaFenceStart; j <= i; j++) {
          cm.addLineClass(j, "background", "cm-schema-line");
        }
        cm.addLineClass(schemaFenceStart, "wrap", "cm-schema-start");
        cm.addLineClass(i, "wrap", "cm-schema-end");
        schemaFenceStart = -1;
      }
    } else if (inSchemaFence) {
      cm.addLineClass(i, "background", "cm-schema-line");
    }
  }

  // Fallback: section after the last standalone '---' if no ```schema fence exists
  if (!hasFencedSchema) {
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
}

/** Fast client-side extractor to keep visual summary card in sync with typing. */
function parseAndUpdateSummary(text) {
  const lines = text.split("\n");
  let description = "";
  let model = "";
  const args = [];
  let inArgs = false;
  let inSchema = false;
  const schemaQuestions = [];

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
        inSchema = false;
        continue;
      }
      if (/^(?:schema|questions):\s*$/.test(line)) {
        inSchema = true;
        inArgs = false;
        continue;
      }
      if (inArgs) {
        const mArg = /^\s+([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
        if (mArg) args.push(`${mArg[1]}=${mArg[2].trim()}`);
        else if (/^[^\s]/.test(line)) inArgs = false;
      }
      if (inSchema) {
        const qMatch = /^\s{2}([A-Za-z0-9_-]+):\s*$/.exec(line);
        if (qMatch) {
          const qId = qMatch[1];
          let qType = "";
          for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
            if (/^\s{2}[A-Za-z0-9_-]+:\s*$/.test(lines[j]) || lines[j].trim() === "---") break;
            const tMatch = /^\s+type:\s*(\w+)/.exec(lines[j]);
            if (tMatch) {
              qType = tMatch[1];
              break;
            }
          }
          schemaQuestions.push(qType ? `${qId} (${qType})` : qId);
        } else if (/^[^\s]/.test(line)) {
          inSchema = false;
        }
      }
    }
  }

  // 1. Check for ```schema code block (primary)
  let inSchemaFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = /^\s*```(.*)$/.exec(line);
    if (fenceMatch) {
      const tag = fenceMatch[1].trim().toLowerCase().split(/\s+/)[0];
      if (!inSchemaFence && (tag === "schema" || (tag === "yaml" && fenceMatch[1].includes("schema")))) {
        inSchemaFence = true;
      } else {
        inSchemaFence = false;
      }
      continue;
    }
    if (inSchemaFence) {
      const qMatch = /^(?: {0,2})([A-Za-z0-9_-]+):\s*$/.exec(line);
      if (qMatch) {
        const qId = qMatch[1];
        if (qId === "type" || qId === "instructions" || qId === "criteria") continue;
        let qType = "";
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const tMatch = /^\s+type:\s*(\w+)/.exec(lines[j]);
          if (tMatch) { qType = tMatch[1]; break; }
        }
        schemaQuestions.push(qType ? `${qId} (${qType})` : qId);
      }
    }
  }

  // 2. Fallback: section after last standalone '---'
  if (schemaQuestions.length === 0) {
    let lastSep = -1;
    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*```/.test(lines[i])) inFence = !inFence;
      else if (!inFence && lines[i].trim() === "---" && i > 0) lastSep = i;
    }
    if (lastSep > 0) {
      for (let i = lastSep + 1; i < lines.length; i++) {
        const qMatch = /^(?: {0,2})([A-Za-z0-9_-]+):\s*$/.exec(lines[i]);
        if (qMatch) {
          const qId = qMatch[1];
          if (qId === "type" || qId === "instructions" || qId === "criteria") continue;
          let qType = "";
          for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
            const tMatch = /^\s+type:\s*(\w+)/.exec(lines[j]);
            if (tMatch) { qType = tMatch[1]; break; }
          }
          schemaQuestions.push(qType ? `${qId} (${qType})` : qId);
        }
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

function addQuestionCategory(type) {
  if (!editorInstance) return;
  const cm = editorInstance;
  const text = cm.getValue();
  const lines = text.split("\n");

  const templates = {
    score: `severity:\n  type: score\n  instructions: "Rate the severity or quality of the input"\n  criteria:\n    - "No issues"\n    - "Minor issues"\n    - "Serious issues that need fixing"\n`,
    choice: `category:\n  type: choice\n  instructions: "Which category best classifies this input?"\n  criteria:\n    defect: "Functional bug or broken behavior"\n    style: "Stylistic or readability issue"\n    performance: "Resource or execution efficiency issue"\n`,
    noul: `flag:\n  type: noul\n  instructions: "Does this input require immediate rework?"\n  criteria:\n    true: "Immediate rework required"\n    false: "Acceptable as is"\n`,
  };

  const snippet = templates[type] || templates.score;

  let schemaStart = -1;
  let schemaEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim().toLowerCase();
    if (/^```(?:schema|yaml\s+schema)/.test(trimmed)) {
      schemaStart = i;
    } else if (schemaStart !== -1 && trimmed === "```") {
      schemaEnd = i;
      break;
    }
  }

  if (schemaStart !== -1 && schemaEnd !== -1) {
    const pos = { line: schemaEnd, ch: 0 };
    cm.replaceRange(snippet, pos);
    cm.focus();
    cm.setCursor({ line: schemaEnd + 1, ch: 2 });
  } else {
    const appendText = `\n\`\`\`schema\n${snippet}\`\`\`\n`;
    const lastLine = cm.lineCount();
    cm.replaceRange(appendText, { line: lastLine, ch: 0 });
    cm.focus();
    cm.setCursor({ line: cm.lineCount() - 2, ch: 2 });
  }
}

$("btnAddScore").addEventListener("click", () => addQuestionCategory("score"));
$("btnAddChoice").addEventListener("click", () => addQuestionCategory("choice"));
$("btnAddNoul").addEventListener("click", () => addQuestionCategory("noul"));

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
      navigate("#/questions/" + created.name);
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
      navigate("#/questions/" + moved.to.replace(/\.md$/i, ""));
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
      navigate("#/questions/" + created.name);
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
    navigate("#/questions");
  } catch (err) {
    alert(`Failed to delete question: ${err.message}`);
  }
});

$("btnRunQuestion").addEventListener("click", async () => {
  if (!currentQuestion) return;
  if (isDirty) {
    await saveCurrentQuestion();
  }
  openRunDialog({
    initialAsks: [currentQuestion.name],
    initialPath: currentPath,
    batch: $("quickBatchCheck")?.checked,
  });
});

window.switchView = switchView;
window.selectQuestion = selectQuestion;
window.saveCurrentQuestion = saveCurrentQuestion;

// Initialize routing last: resolve the deep link once every declaration exists.
applyRoute();
