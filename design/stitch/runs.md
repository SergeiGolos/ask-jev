# Stitch Project 2 of 3 — "ask · Runs" (run browser + report screen)

Generate one high-fidelity web app screen, desktop 1440×900. Dark theme, GitHub Primer
palette (`--bg:#0d1117 --subtle:#151b23 --border:#30363d --fg:#f0f6fc --muted:#8b949e
--accent:#2f81f7 --ok:#238636 --warn:#9e6a03 --bad:#f85149`), system sans + `ui-monospace`
for run ids/timestamps.

GOAL: browse every recorded run of every ask and read a full run report. This screen is
currently a bare list + raw iframe; the redesign must make run selection scannable and give
the embedded report a proper header context — WITHOUT dropping any data element. Real
developer tool: dense, quiet, navigable by URL.

================================================================
LAYOUT (sidebar list + report surface)
================================================================

┌────────────────────────────────────────────────────────────────┐
│ SIDEBAR 264px                                                  │
│  ask ▸ runs          [Trends|Runs|Questions]                   │
│  ┌────────Filter runs…────────┐                                │
│  ▾ 🏃 security-audit        12 │     MAIN                     │
│      🏃 09-20 14:32:11    24*│  ┌ run header bar ──────────┐  │
│      🏃 09-14 08:12:56    18 │  │ a1b2c3d4 · security-audit│  │
│  ▾ 🏃 solid-review           9 │  │ jev-latest · 2026-… ↗  │  │
│      🏃 09-18 09:05:47    31 │  └──────────────────────────┘  │
│      🏃 09-11 19:22:08    27 │  ┌ report document ────────┐   │
│  (*selected = accent-tinted)   │  │ (existing HTML report,  │   │
│                                │  │  scrollable, fills rest)│   │
│                                │  └─────────────────────────┘   │
└────────────────────────────────────────────────────────────────┘

1. SIDEBAR — runs grouped by ASK FILE, newest run first inside each group, groups ordered
   by their newest run. Filter input matches ask name, run id substring, or timestamp.
   • Group header: ▸ folder affordance, ask name rendered as a LINK to
     `#/questions/<ask>` (opens that ask in the editor), count badge = runs in group.
   • Run row: 🏃 icon, local timestamp `YYYY-MM-DD HH:MM:SS`, pair-count badge.
     Row tooltip = full run id + `model: <model>`. Clicking a row navigates to
     `#/runs/<runId>`; the selected row is highlighted.
   • Empty states, keep both: zero runs → "No runs recorded yet. Run an ask from the
     Trends view." with `Trends view` linking to `#/trends`; filter miss → "No matching
     runs."

2. MAIN — two states:
   a) NO SELECTION (route `#/runs`): centered empty state — 🏃 icon, "No Run Selected",
      "Select a recorded run from the sidebar to view its report."
   b) SELECTION (route `#/runs/<runId>`):
      • Run header bar pinned above the report, left→right:
          – run id (first 8 chars, full id tooltip)
          – `·` ask name as LINK to `#/questions/<ask>`
          – model badge (e.g. `jev-latest`)
          – local timestamp
          – pair count (`N pairs`)
          – when repo+sha exist, external `↗` link to `<repo>/commit/<sha>`
      • Report surface below: the server's full report document in a bordered, rounded
        panel that fills all remaining space and scrolls independently. It MUST keep every
        section of the current report:
          – Summary header (run metadata, model)
          – Principles summary: one row per question — question id, average bar
            (0–10, tone-colored), average value, `⚠ N low` tag when files scored <4
          – File tree: folders collapsible, per-file dot (tone) + name + score
          – Per-file pair cards: rank `#N`, `NNN · <file path>`, grade chip, total `/10`,
            request code block, response code block, per-question answer rows
            (id, probability heatmap, bar, value label, judge-confidence %,
            `model: <judge>` tooltip), console output block.

================================================================
DEEP-LINK CONTRACT (real <a href> links in the design)
================================================================

`#/runs/<runId>` opens that run's report directly (selected row + header bar + report).
Ask links (group header, header bar) → `#/questions/<ask>`. Runs empty state → `#/trends`.
Trends matrix run-id cells and "Run recorded" status elsewhere link INTO this route.
Tabs switch views (`#/trends`, `#/runs`, `#/questions`); back/forward traverses selections.

================================================================
SAMPLE DATA TO RENDER
================================================================

Sidebar: security-audit ×12 → [2026-09-20 14:32:11 · 24 pairs · jev-latest (selected)],
[2026-09-14 08:12:56 · 18 pairs · jev-latest]; solid-review ×9 → [2026-09-18 09:05:47 ·
31 pairs · jev-latest], [2026-09-11 19:22:08 · 27 pairs · jev-2026-08].
Header bar: `a1b2c3d4 · security-audit · jev-latest · 2026-09-20 14:32:11 · 24 pairs ↗`.
Report panel: principles rows `severity 8.4` (ok bar), `category 6.1` (warn bar,
`⚠ 3 low`), `flag 9.0` (ok bar); file tree `src/` (serve.ts ● 8.2, matrix.ts ● 6.1,
report.ts ● 9.4); one visible pair card `#1 · 001 · src/serve.ts` grade B+, `8.4/10`,
request block `solid-review on src/serve.ts`, answer row `severity` heatmap + bar +
bold `8` + `94%` confidence.
