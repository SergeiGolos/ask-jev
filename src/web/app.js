// ask-jev trend matrix client application

let treeData = null;
let currentPath = "";
let currentIsFolder = true;
let debounceTimer = null;

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
  askSel.innerHTML = `<option value="">All Asks</option>`;
  for (const ask of treeData.availableAsks || []) {
    const opt = document.createElement("option");
    opt.value = ask;
    opt.textContent = ask;
    askSel.appendChild(opt);
  }

  const qSel = $("questionSelect");
  qSel.innerHTML = `<option value="">All Questions</option>`;
  for (const q of treeData.availableQuestions || []) {
    const opt = document.createElement("option");
    opt.value = q;
    opt.textContent = q;
    qSel.appendChild(opt);
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

function renderMatrix(data) {
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
          <span>${r.runId.slice(0, 8)}</span>
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
    row.appendChild(qTh);

    for (const r of data.runs) {
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

        td.innerHTML = `
          <div class="cell-content">
            <span class="cell-val ${cell.tone}">${cell.display}</span>
            ${deltaHtml}
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

// Tooltip handler
document.addEventListener("mouseover", (e) => {
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
  if (!e.relatedTarget || !e.relatedTarget.closest("td[data-tooltip]")) {
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

// Initialize
async function init() {
  try {
    treeData = await fetchJson("/api/tree");
    renderTree();
    populateFilters();
    await loadMatrix();
  } catch (err) {
    $("matrixStatus").style.display = "block";
    $("matrixStatus").textContent = `Failed to initialize: ${err.message}`;
  }
}

init();
