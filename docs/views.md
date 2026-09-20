# Web UI — Views, Routes, and Components

Working reference for restructuring the display layer. Describes what exists today: every
route, what the left navigation renders and from which data, the main-content components per
route, and the sticky header. Ends with the target component decomposition (clean seams for
composable views).

Source of truth: `src/web/index.html`, `src/web/app.js`, `src/web/style.css`, served by
`src/serve.ts`. No framework, no build step — one ES module (`app.js`) plus a static shell.

## 1. App shell and layout

```
body (100vh, column flex, overflow hidden)
├─ header.topbar                ← 46px, pinned above all scrolling content
│  ├─ .crumbs                   ← ask ▸ <view> ▸ <target>
│  ├─ nav.view-tabs             ← Trends / Runs / Questions
│  └─ .topbar-utils             ← theme toggle
├─ .layout (flex row, fills rest)
│  ├─ aside.sidebar (290px)     ← 3 search headers + 3 nav containers (one pair per view)
│  └─ main.main-content ×3      ← #trendsView / #questionsView / #runsView
├─ #modalBackdrop               ← generic text-input modal
├─ #runModalBackdrop            ← run composer dialog
└─ #tooltip                     ← singleton floating tooltip
```

- Nothing inside `body` scrolls except designated panes: `.tree-nav` (sidebar lists),
  `.table-scroll-container` (matrix), the report iframe, and the editor container.
- View switching is pure visibility toggling of 4 slots per view — `{tab, search, nav, main}` —
  driven by the `VIEWS` map in `app.js` (`switchView`).

## 2. Header (sticky topbar)

Structurally sticky: fixed 46px row above the scroll panes, never scrolls.

| Piece | Elements | Behavior |
|---|---|---|
| Breadcrumb | `#crumbView`, `#crumbTarget(Wrap)` | `setCrumbTarget` shows the route param (trends path · run id (8 chars) · question name); hidden when no param |
| View tabs | `#tabTrends` `#tabRuns` `#tabQuestions` | Each is a hard-wired listener → `navigate("#/…")`; `.active` class set by `switchView` |
| Utilities | `#themeBtn` | Dark/light override → `localStorage["ask-theme"]`; unset follows `prefers-color-scheme` |

## 3. Router

Hash-based; `applyRoute()` is the single source of truth (runs on load for deep links + on
`hashchange`; `navigate()` re-applies when the hash is unchanged).

```
#/trends[/<path>]      path = file-or-directory path (may contain "/")
#/runs[/<runId>]       runId = UUIDv7 from history
#/questions[/<name>]   name = ask name (may contain "/")
unknown first segment → trends
```
> Change


```
#/runs[/<path>]       List of recent runs with teh same navigation as trends
#/run[/<runId>]       runId = UUIDv7 from history 
#/trends[/<path>]      path = file-or-directory path (may contain "/")
#/questions           list of recently run questions filtered by file  
#/question[/<name>]   name = ask name (may contain "/") editor page
#/edit/<name>         the current question selected view.
unknown first segment → runs
```


Per-route param handling (`parseRoute` → `applyRoute`):

| View | Param effect | Guard |
|---|---|---|
| trends | `setTrendsTarget(param)` when changed; badge + matrix reload | none |
| runs | `showRun(param)` when changed | none |
| questions | `selectQuestion(param)` when changed | **bypasses** the dirty guard (only sidebar clicks confirm unsaved changes) |

## 4. Views by route

Each section = one route (or route-with/without-param where the rendered view differs),
covering: left navigation (groupings, items, data), and main content components.

---

### 4.1 `#/trends[/<path>]` — Trend matrix

One view regardless of param; `path` selects the target (file or directory) and filters the
matrix. Data domains: file tree, matrix.

**Left navigation**

| Grouping | Item | Data source |
|---|---|---|
| Root: "/ (All Files)" | always first | `/api/tree` → `treeData.root` |
| Directory nodes | `<details>` collapsible, ▸ icon, `name/` | same tree, `children` |
| File nodes | 📄 name | same tree |
| Every node badge | run count | node.`runCount` |

- Search box `#treeFilter`: client-side, hides `.tree-item[data-path]` not matching (files only).
- Clicking any node → `navigate("#/trends/<path>")` → matrix reloads scoped to that path.
- Tree data also feeds the filter dropdowns (`availableAsks`, `availableQuestions`,
  `timeRange`) — one fetch powers nav + filters.

**Main content**

| Component | Elements | Data / behavior |
|---|---|---|
| Control bar (`header.control-bar`) | `#targetType` badge (`directory`/`file`), `#targetPath` | `findTreeNode(currentPath)` |
| | Filters: `#askSelect`, `#questionSelect`, `#dateFrom`/`#dateTo`, `#grepInput` + `#grepStatus` | Each change → `loadMatrix()`; grep validates regex, 200ms debounce; date min/max from `timeRange` |
| | `#btnReset` | Clears all filters + tree filter, reloads |
| | `#btnRun` + `#quickBatchCheck` | Opens run dialog prefilled with current ask filter + `currentPath` |
| Matrix (`section.matrix-wrapper`) | `#matrixStatus`, `#matrixTable`, `#matrixLegend` | `loadMatrix()` → `/api/matrix?path&ask&questions&from&to&grep` → `renderMatrix()` |

Matrix table shape (rows = questions, columns = runs, newest left):

- Column headers: timestamp, `runAsksHtml` (1 ask → link `#/questions/<ask>`; many → shared
  prefix + "N asks" badge), runId link → `#/runs/<id>`, commit ↗ link.
- Row groups per ask: full-width `group-row` th (ask link → editor, question count,
  `data-askinfo` for hover tooltip).
- Question rows: leaf id in sticky first column, `data-graph` (sparkline points).
- Cells: tone class (`ok/warn/bad/mut`), delta badge (`+n`/`-n`/`0`/`changed`), optional
  compare link when `changed` + both shas known, `data-tooltip` JSON payload.
- Empty states for "no runs" / "no questions".

Auto-refresh: 30s poll → `refreshAll()` (skipped when tab hidden; JSON-compares `/api/tree`,
no-op when unchanged) → re-renders tree + filters + matrix.

Hover system: one global `mouseover/mousemove/mouseout` trio on `document`, keyed by three
`data-*` JSON blobs: cell detail, question sparkline (`sparklineSvg`), ask-group contents.

---

### 4.2 `#/runs` — Run browser (list state)

Data domain: run manifests.

**Left navigation**

| Grouping | Item | Data source |
|---|---|---|
| Ask group headers (`<details>`, newest first) | link → `#/questions/<ask>` | `/api/runs` → grouped by ask; multi-ask runs listed under every ask |
| Run items | 🏃 timestamp, badge = pair count, title = runId + models | run entry; click → `#/runs/<runId>` |

- Search box `#runsFilter`: client-side re-render, matches ask / runId / timestamp.

**Main content**: `#runEmptyState` ("No Run Selected") only. The list state has no main panel
beyond the empty prompt.

---

### 4.3 `#/runs/<runId>` — Run report (detail state)

Data domains: run manifest (header bar) + server-rendered report (iframe).

**Left navigation**: same as 4.2; selected run gets `.active`.

**Main content**

| Component | Elements | Data / behavior |
|---|---|---|
| Run bar (`#runHeaderBar`) | runId chip (8 chars), asks (`runAsksHtml`), model chips, timestamp, pair count, commit ↗ | `fillRunHeader(runId)` from `runsList` |
| Report frame (`#runReportFrame`) | iframe | `src = /api/runs/<runId>/report` — full HTML from `renderReportHtml` (src/report.ts); app.js never parses report content |

`showRun(runId)` hides the empty state and fills both. Deep-link note: the route can select a
run before `/api/runs` returns; `loadRuns` re-fills the header once the list arrives.

---

### 4.4 `#/questions` — Question browser (list state)

Data domain: ask store listing.

**Left navigation**

| Grouping | Item | Data source |
|---|---|---|
| Folder nodes | built client-side from `/` in names | `questionsList` from `/api/questions` |
| Question items | status dot (`ok`/`warn` = runnable/no schema), short name, "⚠ no schema" chip | item.`isRunnable` |

- Search box `#questionsFilter` (name + description) and `#btnNewQuestion` live in the
  sidebar header — the only sidebar with an action button.
- Click → `routeToQuestion(name)`: the dirty guard (`confirm()` when `isDirty`) applies here
  and only here.

**Main content**: `#questionEmptyState` with `#btnEmptyNewQuestion`.

---

### 4.5 `#/questions/<name>` — Question editor (detail state)

Data domains: single ask detail, ask CRUD.

**Left navigation**: same as 4.4; active question `.active`.

**Main content** (`#questionEditorSurface`)

| Component | Elements | Data / behavior |
|---|---|---|
| Toolbar (`header.q-toolbar`) | `#qTitle`, `#qModelBadge`, `#qStatusBadge`, `#qSaveStatus` | from `/api/questions?name=<name>` detail |
| | `#btnAddScore` / `#btnAddChoice` / `#btnAddNoul` | insert schema templates into the editor |
| | `#btnRunQuestion` | saves when dirty → run dialog with this ask |
| | `#btnMoveQuestion`, `#btnDuplicateQuestion`, `#btnDeleteQuestion`, `#btnSaveQuestion` + Ctrl/Cmd+S | generic modal / confirm / `PUT /api/questions` |
| Frontmatter card (`#frontmatterCard`) | `#fmDesc`, `#fmModelVal`, `#fmArgsPills`, `#fmSchemaPills` | server `meta`/`schema` on load/save (`updateSummaryCard`); client regex parse while typing (`parseAndUpdateSummary`) |
| Editor (`#editorContainer`) | CodeMirror (`yaml-frontmatter`/gfm) | `updateVisualHighlights` marks frontmatter + ```schema fence (fallback: after last `---`); `change` → dirty state + live summary |

CRUD flows: New / Duplicate (POST `/api/questions`), Move (POST `/api/questions/move`),
Delete (DELETE + `confirm`) — all via the generic text-input modal, then list reload +
navigate to the affected ask.

## 5. Cross-view components

| Component | Used by | Notes |
|---|---|---|
| Run composer (`#runModalBackdrop`) | Trends (`#btnRun`), Questions (`#btnRunQuestion`) | Two checkbox columns (asks × files, `/api/questions` + `/api/files`), grep bar, batch toggle (synced with `#quickBatchCheck`), `POST /api/run`, then `refreshAll(true)` |
| Generic modal (`#modalBackdrop`) | Questions CRUD | One active `onConfirm` handler at a time |
| Tooltip (`#tooltip`) | Trends matrix | Document-level hover delegation over `data-*` JSON |
| Theme toggle | all | `documentElement.dataset.theme` + localStorage |
| 30s poller | Trends tree/matrix + Runs list | Single interval, skipped when `document.hidden` |

## 6. Server data endpoints (src/serve.ts)

| Endpoint | Consumed by |
|---|---|
| `GET /api/tree` | Trends nav + filters |
| `GET /api/matrix?path&ask&questions&from&to&grep` | Trends matrix |
| `GET /api/runs` | Runs nav + run bar |
| `GET /api/runs/<id>/report` (HTML) | Runs iframe |
| `GET /api/questions` · `GET /api/questions?name=` | Questions nav; editor; run dialog asks |
| `POST/PUT/DELETE /api/questions`, `POST /api/questions/move` | Questions CRUD |
| `POST /api/run` | Run composer |
| `GET /api/files` | Run composer files column |

## 7. Known seams and gotchas (inputs to the restructure)

- Adding a view today means 4 scattered edits: index.html slots, `VIEWS` entry, `applyRoute`
  branch, tab listener. The `VIEWS` map is the seam to grow.
- The dirty guard is asymmetric: sidebar clicks confirm; tabs and manual hash edits discard
  silently.
- `currentPath` (trends state) leaks into the run dialog's file preselect from the Questions
  view.
- One global tooltip handler couples three producers via JSON-in-attributes.
- `treeFilter` filtering is lost when the poller re-renders the tree (input keeps its text,
  items reset to visible until the next input event).
- Section 8 defines the target component structure that resolves these.

## 8. Target structure — component decomposition

*(pending synthesis — filled in below)*
