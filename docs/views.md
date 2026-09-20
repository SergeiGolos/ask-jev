# Web UI — Views, Routes, and Components

Working reference for restructuring the display layer. Describes the **target route scheme**
(agreed 2026-09-20) and, per route, what the left navigation renders and from which data, the
main-content components, and how they compose. Content is annotated:

- **[today]** — traced from current code (`src/web/index.html`, `app.js`, `serve.ts`).
- **➕ filled** — new/changed behavior specified by the route update, inferred from the
  route description and sibling views. Spec, not yet code.

Source of truth: `src/web/index.html`, `src/web/app.js`, `src/web/style.css`, served by
`src/serve.ts`. No framework, no build step — one ES module plus a static shell today.

## 1. App shell and layout

```
body (100vh, column flex, overflow hidden)
├─ header.topbar                ← 46px, pinned above all scrolling content
│  ├─ .crumbs                   ← ask ▸ <view> ▸ <target>
│  ├─ nav.view-tabs             ← Trends / Runs / Questions
│  └─ .topbar-utils             ← theme toggle
├─ .layout (flex row, fills rest)
│  ├─ aside.sidebar (290px)     ← per-view search + navigation container
│  └─ main.main-content ×N      ← one main section per view
├─ #modalBackdrop               ← generic text-input modal
├─ #runModalBackdrop            ← run composer dialog
└─ #tooltip                     ← singleton floating tooltip
```

**[today]** Nothing inside `body` scrolls except designated panes: `.tree-nav` (sidebar
lists), `.table-scroll-container` (matrix), the report iframe, and the editor container.
View switching is visibility toggling of 4 slots per view — `{tab, search, nav, main}` —
driven by the `VIEWS` map in `app.js` (`switchView`).

➕ filled: the sidebar navigation converges on **one shared file-tree component** used by
Trends, Runs, and Questions (see §3). The runs list and questions list become main-content
pages instead of sidebar lists.

## 2. Header (sticky topbar)

Structurally sticky: fixed 46px row above the scroll panes, never scrolls. **[today]**

| Piece | Elements | Behavior |
|---|---|---|
| Breadcrumb | `#crumbView`, `#crumbTarget(Wrap)` | `setCrumbTarget` shows the route param (trends/runs path · run id (8 chars) · question name); hidden when no param |
| View tabs | `#tabTrends` `#tabRuns` `#tabQuestions` | Listener → `navigate("#/…")`; `.active` class set by `switchView`. Tab targets unchanged: Trends → `#/trends`, Runs → `#/runs`, Questions → `#/questions` |
| Utilities | `#themeBtn` | Dark/light override → `localStorage["ask-theme"]`; unset follows `prefers-color-scheme` |

## 3. Router (target scheme)

Hash-based; `applyRoute()` is the single source of truth (runs on load for deep links + on
`hashchange`; `navigate()` re-applies when the hash is unchanged). **[today]** mechanism,
➕ filled route table:

```
#/trends[/<path>]      path = file-or-directory path (may contain "/")
#/runs[/<path>]        recent runs; optional path filter; file-tree nav like trends
#/run/<runId>          runId = UUIDv7 from history — run report (detail)
#/questions            recently run questions, filtered by file
#/questions/<name>/p/<path>   one ask's values across runs — trends-style drill-down
#/edit/<name>          the ask editor — the currently selected question
unknown first segment → runs          (was: trends)
```

Notes:

- Plural segments are **list/data** views (`#/runs`, `#/questions`, incl. the
  `#/questions/<name>/p/<path>` drill-down); `#/run/<runId>` and `#/edit/<name>` are the
  detail/editor views. The old `#/runs[/<runId>]` and `#/questions[/<name>]` double-duty
  splits into `#/run` + `#/runs`; editing lives only at `#/edit/<name>`.
- `#/run/<runId>` and `#/edit/<name>` are param-required: opened without a param they show
  their view's empty state. `#/questions/<name>/p/<path>` requires `<name>`; the `/p/<path>`
  suffix is optional and defaults to all files (mirroring `#/trends` with no param).
- `router.js` splits `#/questions/<name>/p/<path>` on the **first** `/p/` segment:
  everything before is the ask name (may contain `/`), everything after is the path.
- Per-route param handling mirrors today: switch slots → set crumb target → apply param,
  skipping work when the param is unchanged.

## 4. Views by route

### 4.1 `#/trends[/<path>]` — Trend matrix  **[today, unchanged]**

One view regardless of param; `path` selects the target (file or directory) and filters the
matrix. Data domains: file tree, matrix.

**Left navigation** — the file tree, which becomes the shared nav component (§1):

| Grouping | Item | Data source |
|---|---|---|
| Root: "/ (All Files)" | always first | `/api/tree` → `treeData.root` |
| Directory nodes | `<details>` collapsible, ▸ icon, `name/` | same tree, `children` |
| File nodes | 📄 name | same tree |
| Every node badge | run count | node.`runCount` |

- Search box `#treeFilter`: client-side, hides non-matching file items.
- Clicking any node → `navigate("#/trends/<path>")` → matrix reloads scoped to that path.
- Tree data also feeds the trends filter dropdowns (`availableAsks`, `availableQuestions`,
  `timeRange`).

**Main content**

| Component | Elements | Data / behavior |
|---|---|---|
| Control bar | `#targetType` badge (`directory`/`file`), `#targetPath`; filters `#askSelect`, `#questionSelect`, `#dateFrom`/`#dateTo`, `#grepInput` + `#grepStatus`; `#btnReset`; `#btnRun` + `#quickBatchCheck` | Each filter change → `loadMatrix()`; grep validates regex, 200ms debounce; run dialog prefilled with current ask filter + path |
| Matrix table | `#matrixStatus`, `#matrixTable`, `#matrixLegend` | `GET /api/matrix?path&ask&questions&from&to&grep` → rows = questions grouped per ask, columns = runs (newest left); cells: tone, delta badge, compare link, tooltip payload |

Auto-refresh: 30s poll → tree re-fetch (JSON-compare no-op), re-render tree + filters +
matrix. Hover tooltips: document-level delegation over `data-tooltip` (cell), `data-graph`
(sparkline), `data-askinfo` (ask group).

---

### 4.2 `#/runs[/<path>]` — Recent runs list  **➕ reworked**

Data domain: run manifests. *"List of recent runs with the same navigation as trends."*

**Left navigation** ➕ — the shared file-tree component (same data, behavior, and badges as
§4.1's tree; one component, three consumers). Clicking a node → `navigate("#/runs/<path>")`.

**Main content** ➕ — the runs list becomes a page-level list (today it lives in the
sidebar; that ask-grouped sidebar tree is retired):

| Component | Behavior |
|---|---|
| List header | Target label (path or "/ (All Files)"), mirroring the trends control bar's selection info |
| Runs list | Chronological, newest first. Row per run: timestamp, asks (`runAsksHtml` — 1 ask links `#/questions/<ask>/p/<path>` at the list's current scope, many collapse to prefix + count), model chips, pair count, commit ↗. Row click → `#/run/<runId>` |
| Empty state | "No runs recorded yet" with a link into Trends to run an ask (today's wording) |

Data: `GET /api/runs[?path=<path>]` — ➕ `path` param filled, mirroring `/api/matrix`'s
`path`: server filters manifests whose recorded files intersect the path (manifests already
carry `files`). Row shape is today's `/api/runs` payload (`runId, timestamp, asks, models,
pairCount, sha, repo`).

---

### 4.3 `#/run/<runId>` — Run report (detail)  **[today, renamed route]**

Same content as today's `#/runs/<runId>`; only the route segment changed.

**Left navigation**: the shared file tree; the run's target path is `.active` when the route
was entered through `#/runs/<path>` (➕: today's sidebar run-item highlight is retired with
the sidebar list).

**Main content**

| Component | Elements | Data / behavior |
|---|---|---|
| Run bar | runId chip (8 chars), asks, model chips, timestamp, pair count, commit ↗ | `fillRunHeader(runId)` from the runs list data |
| Report frame | iframe | `src = /api/runs/<runId>/report` — server-rendered HTML (`renderReportHtml`); the client never parses report content |

Deep-link order preserved: the route may resolve before the runs list loads; the list load
re-fills the run bar.

---

### 4.4 `#/questions` — Recently run questions  **➕ new view**

Data domains: run history + ask store listing. *"List of recently run questions filtered by
file."*

**Left navigation** ➕ — the shared file-tree component (as §4.2). Clicking a node →
`navigate("#/questions")` with the tree selection scoping the list ➕: the selected path is
list state shared with the tree component (same pattern as the run-dialog prefill today).
The old folder tree built from `/` in ask names is retired.

**Main content** ➕ — one list, all asks, ordered by recency:

| Component | Behavior |
|---|---|
| List header | Target label; **＋ New** button (moved from today's sidebar) → generic modal → `POST /api/questions` → `#/edit/<name>` |
| Questions list | Row per ask: name (→ its drill-down `#/questions/<name>/p/<path>` at the list's current scope), description, status dot (runnable / ⚠ no schema), last-run timestamp, run count, model chips. Rows sorted by last run desc; asks never run sort last with a "never run" badge (keeps unrung asks reachable now that the name-folder tree is gone) |
| Filter box | Client-side on name + description (today's `#questionsFilter` behavior, relocated to the list header) |

Data (filled, no new endpoint): group `GET /api/runs?path=` by ask → last timestamp + run
count; enrich from `GET /api/questions` (`description`, `isRunnable`). Row click →
`#/edit/<name>` (edit the selected question); the ask's name links to its drill-down
`#/questions/<name>/p/<path>` (§4.5).

---

### 4.5 `#/questions/<name>/p/<path>` — Question drill-down  **➕ new view**

Data domain: matrix scoped to one ask. *"Works like the trend but drilling down only to a
specific question and its values."*

**Left navigation** ➕ — the shared file tree. Clicking a node stays inside the drill-down:
`#/questions/<name>/p/<newpath>` (same ask, new scope).

**Main content** ➕ — the trends matrix rendering, scoped by the route:

| Component | Behavior |
|---|---|
| Header | Ask name, status dot, description; **Edit** → `#/edit/<name>`; **▶ Run…** → run dialog prefilled with this ask + path |
| Values matrix | Same table component as §4.1: columns = runs (newest left, runId → `#/run/<runId>`, commit ↗), rows = this ask's schema questions (no ask-group subheader — there is only one ask), cells = tone + delta + compare link + tooltips, question row headers keep the sparkline hover |

No filter bar — the route is the filter (ask + path fixed in the URL). Filled decision;
date-range controls can slot in later without a route change.

Data: the existing `GET /api/matrix?path=<path>&ask=<name>` — no server change, same
payload (`ask` and `path` params both exist today). Omitting `/p/<path>` defaults the scope
to all files, mirroring `#/trends`.

Empty states: no runs at this path → today's matrix "No runs found matching query
criteria."; unknown ask name → not-found state with a link back to `#/questions`.

---

### 4.6 `#/edit/<name>` — Ask editor  **[today's editor surface; the only editor route]**

The editing route. The editor role the old `#/questions/<name>` played moves here —
`#/questions/<name>/p/<path>` (§4.5) is the data view instead. Opening it selects `<name>`
(questions-list highlight + crumb target) and shows the editor surface, unchanged from
today. Reached from the questions-list Edit action, the drill-down's Edit button, and deep
links.

| Component | Elements | Data / behavior |
|---|---|---|
| Toolbar | `#qTitle`, `#qModelBadge`, `#qStatusBadge`, `#qSaveStatus`; `#btnAddScore`/`#btnAddChoice`/`#btnAddNoul`; `#btnRunQuestion` (saves when dirty → run dialog), `#btnMoveQuestion`, `#btnDuplicateQuestion`, `#btnDeleteQuestion`, `#btnSaveQuestion` + Ctrl/Cmd+S | from `GET /api/questions?name=` |
| Frontmatter card | `#fmDesc`, `#fmModelVal`, `#fmArgsPills`, `#fmSchemaPills` | server `meta`/`schema` on load/save; client regex parse while typing |
| Editor | CodeMirror (`yaml-frontmatter`/gfm) | visual highlights for frontmatter + ```schema; dirty tracking |

CRUD flows unchanged: New / Duplicate (POST `/api/questions`), Move (POST
`/api/questions/move`), Delete (DELETE + confirm) via the generic modal.

## 5. Cross-view components

| Component | Used by | Notes |
|---|---|---|
| File tree nav ➕ | Trends, Runs, Questions (list + drill-down) | Extracted from today's `renderTree`; one data source (`/api/tree`), click → view's route prefix (the drill-down re-navigates with the same ask, new path), selection highlight |
| Run composer | Trends, Questions editor, (runs list ➕ optional) | Two checkbox columns (asks × files), grep bar, batch toggle, `POST /api/run`, then refresh. Explicit prefill args `{asks, files, batch, initialPath}` |
| Generic modal | Questions CRUD | One active `onConfirm` handler at a time |
| Tooltip | Trends matrix | Document-level hover delegation over `data-*` JSON |
| Theme toggle | all | `documentElement.dataset.theme` + localStorage |
| 30s poller | Trends tree/matrix + Runs list | Single interval, skipped when `document.hidden` |

## 6. Server data endpoints (src/serve.ts)

| Endpoint | Consumed by |
|---|---|
| `GET /api/tree` | Shared file-tree nav + trends filters |
| `GET /api/matrix?path&ask&questions&from&to&grep` | Trends matrix; question drill-down (`?ask=` + `?path=`) ➕ |
| `GET /api/runs[?path=]` ➕ | Runs list (path-filtered), recent-questions derivation, run bar |
| `GET /api/runs/<id>/report` (HTML) | Run detail iframe |
| `GET /api/questions` · `GET /api/questions?name=` | Questions list, editor, run dialog asks |
| `POST/PUT/DELETE /api/questions`, `POST /api/questions/move` | Questions CRUD |
| `POST /api/run` | Run composer |
| `GET /api/files` | Run composer files column |

## 7. Known seams and gotchas (carried from the trace)

- Adding a view today means 4 scattered edits: index.html slots, `VIEWS` entry, `applyRoute`
  branch, tab listener. §8's registry is the fix.
- The dirty guard is asymmetric: sidebar clicks confirm; tabs and manual hash edits discard
  silently. With the new scheme it applies to `#/edit/<name>`, the only editing route.
- `currentPath` (trends state) leaks into the run dialog's file preselect from the Questions
  view — replaced by explicit prefill args in §8.
- One global tooltip handler couples three producers via JSON-in-attributes.
- `treeFilter` filtering is lost when the poller re-renders the tree.
- Dead code: `populateFilters` fills a `#runAskSelect` dropdown that does not exist in
  index.html (null-guarded, silent) — delete during the split.
- The `/p/` delimiter in `#/questions/<name>/p/<path>` splits on first occurrence; an ask
  with a `/p/` segment in its own name followed by more segments would mis-parse. Accepted —
  such names are pathological, and the ask store already rejects invalid names.
- ➕ The shared tree component must let each view own click-routing (trends → `#/trends/…`,
  runs → `#/runs/…`) and re-render without losing the filter text (today's gotcha, fixed by
  the component owning its filter state).

## 8. Target structure — component decomposition

Synthesized from two candidates — A: *registry-first shell*, B: *data-flow-first stores* —
screened against the design-red-flags rubric. Base: A; ownership rules grafted from B.
Candidate records: `/tmp/arena-ask-ask-jev-ui/candidate-{a,b}/design.md`.

### 8.1 Component map (target)

| # | Module | Owns | DOM roots | Data |
|---|---|---|---|---|
| 1 | `shell.js` | Topbar: tab wiring, crumbs, theme | `.topbar` | — |
| 2 | `router.js` | `navigate` / `parseRoute` / `applyRoute` over the registry; unknown → `runs` | — | — |
| 3 | `views/registry.js` | `registerViews`, slot switching, crumb dispatch | the 4 slot kinds per view | — |
| 4 | `components/file-tree.js` ➕ | Shared tree nav (from `renderTree` + `treeFilter`) | per-view nav container | `/api/tree` |
| 5 | `components/matrix-table.js` ➕ | Matrix table rendering (from `renderMatrix`): runs columns, question rows, cells, tooltip payloads | per-view container | `/api/matrix` payload |
| 6 | `views/trends.js` | Filter bar, tooltip producers, poller wiring | `#trendsView` | `/api/matrix` |
| 7 | `views/runs.js` | Recent-runs list (main content) | `#runsView` | `/api/runs?path=` |
| 8 | `views/run-detail.js` | Run bar + report iframe | `#runView` | `/api/runs`, `/api/runs/:id/report` |
| 9 | `views/questions.js` | Recently-run questions list | `#questionsView` | `/api/runs?path=`, `/api/questions` |
| 10 | `views/question-detail.js` ➕ | Drill-down: header + one-ask values matrix | `#questionDetailView` | `/api/matrix?ask=&path=` |
| 11 | `views/question-editor.js` | Editor surface — the `#/edit/<name>` descriptor | `#questionEditView` | `/api/questions*` |
| 12 | `services/run-dialog.js` | Run composer | `#runModalBackdrop` | `/api/questions`, `/api/files`, `POST /api/run` |
| 13 | `services/modal.js` | Generic prompt/confirm modal | `#modalBackdrop` | — |
| 14 | `services/tooltip.js` | Hover delegation; producers register `(selector, renderer)` | `#tooltip` | — |
| 15 | `services/poller.js` | 30s interval, hidden-tab skip; refreshers register | — | — |
| 16 | `lib.js` | `$`, `fetchJson`, `formatIsoLocal`, `runAsksHtml` (matrix headers + runs list + run bar) | — | — |

Theme stays inside `shell.js` (~8 lines). Tabs remain three (Trends/Runs/Questions);
`#/run`, `#/questions/<name>/p/<path>`, and `#/edit` are nested routes of those tabs, not
new tabs.

### 8.2 The seam: view descriptor

```js
// views/registry.js
export function registerViews(...views) { /* store descriptors; wire hashchange once */ }

// one descriptor per route (six registrations, five modules — editor serves two routes)
{
  id: "runs",                 // route segment: #/runs[/<param>]
  tabId: "tabRuns",           // owning header tab
  slots: { search: "runsSearchWrap", nav: "runsNavContainer", main: "runsView" },
  nav: "file-tree",           // ➕ nav kind; trends/runs/questions share the component
  crumbParam: (p) => ({ text: p }),
  requiresParam: false,       // #/run and #/edit set true → empty state without param;
                              // #/questions/<name> requires the name, /p/<path> is optional
  show(param) { /* apply route; idempotent — no-op when param unchanged */ },
}
```

Adding a view = one module + one `registerViews(...)` argument + tab/slots in index.html.
Zero edits to router, shell, or registry internals. `parseRoute` defaults unknown segments
to `runs`; param joining (`/`-containing paths and names) stays in `router.js`.

### 8.3 Ownership rules (grafted from candidate B)

- A view module owns its state; views never import views. Run-dialog prefill is explicit
  args; the questions list owns its selected path via the tree component's selection API.
- `isDirty` is derived (`content !== savedContent`), never stored alongside both inputs.
- Single writer per piece of state; cross-view needs go through a service's explicit API.
- A shared module earns existence only at its second consumer (`file-tree` qualifies at
  three; `lib.js` holds exactly its four helpers).

### 8.4 Migration table (every function gets exactly one home)

| Today (all in `app.js`) | New home |
|---|---|
| `$`, `fetchJson`, `formatIsoLocal`, `runAsksHtml` | `lib.js` |
| `renderTree`, `findTreeNode`, tree filter logic | `components/file-tree.js` |
| `selectNode`, `updateTargetBadge`, `setTrendsTarget`, `populateFilters`, `loadMatrix`, `sparklineSvg`, trends filter/grep listeners, `refreshAll`, `init` | `views/trends.js` |
| `renderMatrix` + cell/tooltip payload building | `components/matrix-table.js` (shared with the drill-down) |
| `VIEWS`, `switchView`, tab listeners, theme block, `setCrumbTarget` | `shell.js` + `views/registry.js` |
| `navigate`, `parseRoute`, `applyRoute` | `router.js` |
| `loadRuns`, runs filter logic | `views/runs.js` (list re-render is new) |
| `fillRunHeader`, `showRun` | `views/run-detail.js` |
| `loadQuestions`, question filter logic | `views/questions.js` (list is new) |
| `renderQuestionsTree` | **retired** — replaced by the list view + shared tree (folder grouping dies) |
| `routeToQuestion` (retargeted to `#/edit/<name>`), `selectQuestion`, `updateVisualHighlights`, `parseAndUpdateSummary`, `updateSummaryCard`, `addQuestionCategory`, `saveCurrentQuestion`, editor listeners, CRUD modal flows | `views/question-editor.js` |
| `openRunDialog`, `filterRunFiles`, `updateRunDialogCounts`, `closeRunDialog`, execute handler, dialog state | `services/run-dialog.js` |
| `showModal`, `hideModal`, `activeModalHandler` | `services/modal.js` |
| document-level `mouseover/mousemove/mouseout` trio | `services/tooltip.js` |
| 30s `setInterval` poll | `services/poller.js` |
| `#runAskSelect` block inside `populateFilters` | **deleted** (dead — id absent from index.html) |
| `window.switchView/selectQuestion/saveCurrentQuestion` debug exports | `main.js` (composition root) |

### 8.5 Synthesis decision

- **Base: A (registry-first).** The descriptor hides slot toggling, crumb policy, and
  lifecycle behind one small interface. B's store layer would create single-consumer
  modules — the shallow-module red flag — with subscription machinery and no second
  subscriber.
- **Grafted from B:** the ownership rules (§8.3).
- **Rejected:** store/EventTarget layer; generic reactive renderer; extracting theme.
- **Tradeoffs accepted:** manual visibility toggling (no framework); `show()` idempotence by
  convention; extra views still need index.html slots; two route registrations sharing the
  editor module.

### 8.6 Invariants to preserve during the split

- `applyRoute()` runs once at boot (deep links) and on `hashchange`; `navigate()` re-applies
  on unchanged hash. Unknown first segment → `runs` (changed from `trends`).
- Param-required routes (`#/run/<runId>`, `#/edit/<name>`) show their empty state without a
  param — never a broken fetch. `#/questions/<name>` requires the name; `/p/<path>` defaults
  to all files.
- `router.js` splits `#/questions/<name>/p/<path>` at the first `/p/` segment — the one
  place that convention lives.
- The dirty guard protects navigation away from editor routes on sidebar clicks; tab switches
  and manual hash edits bypass. Current semantics — keep, or change consciously.
- Poller: skipped when `document.hidden`; trends refresh no-ops when tree JSON is unchanged;
  runs-list refresh only while the runs view is visible.
- Run dialog prefills: current ask filter / current ask + current target path;
  `#quickBatchCheck` ↔ `#runBatchOption` stay synced.
- Run deep link may resolve before the runs list loads; the list load re-fills the run bar.
- Reports stay server-rendered; the iframe is the seam.
- `/api/runs?path=` mirrors `/api/matrix`'s path semantics (file or directory prefix).

### 8.7 Open questions

- **Drill-down filters**: `#/questions/<name>/p/<path>` is spec'd without a filter bar (the
  route is the filter); date-range controls can be added later without a route change.
- **Runs list ordering/grouping**: spec'd chronological (newest first). If ask-grouping is
  missed, add it as a display toggle in the list, not a nav change.
- **Tree selection across views**: `#/questions` keeps its selected path in view state
  (route stays param-less per the agreed table). If deep-linkable filtered question lists
  are wanted, promote it to `#/questions/<path>` later — the registry makes that a
  descriptor edit, not a redesign.

**Next implementation step:** extract `router.js` + `views/registry.js` with the six route
descriptors (default `runs`, param-required empty states) around the existing behaviors —
zero behavior change beyond the route renames, verified by deep-linking every route shape.
