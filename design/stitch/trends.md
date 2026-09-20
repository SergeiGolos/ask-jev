# Stitch Project 1 of 3 — "ask · Trends" (trend matrix screen)

Generate one high-fidelity web app screen, desktop 1440×900. Dark theme, GitHub Primer
palette (`--bg:#0d1117 --subtle:#151b23 --border:#30363d --fg:#f0f6fc --muted:#8b949e
--accent:#2f81f7 --ok:#238636 --warn:#9e6a03 --bad:#f85149 --purp:#a371f7`), system sans
+ `ui-monospace` for IDs/numbers.

GOAL: a dashboard that tracks how judged answers to "asks" (prompt templates) evolve per
source file across recorded runs. Every data element listed under "MUST PRESERVE" below is
present in the current UI and must remain reachable — the redesign only reorganizes it for
readability. This is a real developer tool; dense, calm, no marketing chrome.

================================================================
LAYOUT (three regions)
================================================================

┌────────────────────────────────────────────────────────────────┐
│ SIDEBAR 264px                                                  │
│  ask ▸ trends        [Trends|Runs|Questions]  ← segmented ctl  │
│  ┌────────Filter files…────────┐                               │
│  📁 / (All Files)            47 │                              │
│  ▾ 📁 src/                   31 │      MAIN                    │
│      📄 serve.ts             12 │  breadcrumb + type badge     │
│      📄 matrix.ts             9 │  filter bar                  │
│      📄 report.ts             7 │  ┌ matrix table ──────────┐  │
│    📁 .questions/             9 │  │ Question │ 09-20 14:32│  │
│      📄 solid-review.md       5 │  │          │ 09-18 …    │  │
│  (selected row = accent-tinted) │  └────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘

1. SIDEBAR — file tree of every file/dir that has ever been judged, each row showing a
   run-count badge. Root pseudo-row "/ (All Files)" = whole repo. Folders are collapsible
   `<details>`; the selected row is highlighted. Filter input hides non-matching rows.
   Clicking any row is a NAVIGATION to `#/trends/<path>` (deep-linkable, back button works).

2. CONTROL BAR (top of main, two rows):
   Row A — target identity: type chip `directory` or `file`, then breadcrumb of the
   selected path (`/ › src › serve.ts`; `/ (All Files)` at root), full path in tooltip.
   Row B — filter bar, left→right:
     • Ask        select: "All Asks" + one option per distinct ask file (e.g.
                  `security-audit`, `reviews/code-quality`, `solid-review`).
     • Question   select: "All Questions" + one option per distinct schema question id.
     • Date Range two `datetime-local` inputs with → between; min/max bounded by data range.
     • Grep       text input, live validation chip: green ✓ when valid regex, amber
                  "⚠ invalid regex (fallback to text)" otherwise; debounced 200 ms.
     • Reset      ghost button clearing all filters.
     • Right side, Run group: Ask select + solid accent `Run` button.

3. MATRIX — the core. Wide table, sticky header, sticky first column.
   • Corner header: `Question (N)` where N = row count.
   • One column per run, NEWEST FIRST. Column header cell, top→bottom:
       – timestamp `YYYY-MM-DD HH:MM:SS`
       – ask name (link → `#/questions/<ask>`)
       – `·`
       – run id first 8 chars (link → `#/runs/<runId>`) + external `↗` to
         `<repo>/commit/<sha>` when repo+sha exist.
   • One row per question id. Row header = question id (truncated, full id in tooltip).
   • Cells, per (question, run):
       – `display` value, color-coded by tone: ok=green, warn=amber, bad=red, mut=muted.
         Numeric averages (e.g. `8.4`) or categorical labels (e.g. `defect`).
       – delta badge vs the PREVIOUS (older) run: green `+n`, red `-n`, gray `0`, or a
         `changed` chip for categorical flips.
       – when the cell `changed` and both runs have shas: `↗` link to
         `<repo>/compare/<prevSha>...<sha>`.
       – no cell: muted `—`.
   • Below the table a one-line legend: tone swatches + "delta = vs previous run (older
     column to the right)". Run count summary per selected target lives in the tree badges.

================================================================
PROGRESSIVE DISCLOSURE (hover tooltips — keep, they carry extra data)
================================================================

• Hover a question row header → floating card: question id + a 260×80 sparkline (SVG
  polyline + dots, min/max labels) of that question's numeric history, oldest→newest.
• Hover any populated cell → floating card with rows: Run (short id + ask), Time, Value,
  Previous (if any), Delta (signed), Files (n) [min, max] (when the value aggregates files).

================================================================
STATUS LINE (above the table, replaces loading text)
================================================================

States: `Loading matrix…` · `Error loading matrix: <msg>` · empty result → centered muted
"No runs found matching query criteria." / "No questions matching filters." · after a run:
`Run <a href="#/runs/<runId>">a1b2c3d4</a> recorded (N pairs)`. Run button disables while
running, status shows `Running '<ask>' on <path> …`.

================================================================
DEEP-LINK CONTRACT (must be reflected as real <a href> links in the design)
================================================================

Route `#/trends[/<path>]` selects that file/folder on boot (tree state, badge, matrix).
Cross-links: matrix ask name → `#/questions/<ask>`; matrix run id → `#/runs/<runId>`;
runs empty state → `#/trends`. Tabs switch the three views (`#/trends`, `#/runs`,
`#/questions`). Browser back/forward must traverse every selection.

================================================================
SAMPLE DATA TO RENDER
================================================================

Sidebar: / (All Files) 47 · src/ 31 (serve.ts 12, matrix.ts 9, report.ts 7, cli.ts 3)
· .questions/ 9 (solid-review.md 5, gut-feeling.md 4) · docs/ 7.
Filters: asks = security-audit, reviews/code-quality, solid-review; questions =
severity, category, flag.
Columns (newest→oldest): 2026-09-20 14:32:11 · solid-review · a1b2c3d4 ↗ |
2026-09-18 09:05:47 · solid-review · e5f6a7b8 ↗ | 2026-09-15 22:41:03 · security-audit ·
9c8b7a6d ↗.
Rows: severity → 8.4 +1.2 | 7.2 +0.4 | — ; category → defect "changed" ↗ | style
"changed" ↗ | defect ↗ ; flag → true 0 | true | false.
Selected target: src/serve.ts (chip `file`, breadcrumb / › src › serve.ts).
