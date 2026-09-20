# Stitch Project 3 of 3 — "ask · Questions" (ask manager + editor screen)

Generate one high-fidelity web app screen, desktop 1440×900. Dark theme, GitHub Primer
palette (`--bg:#0d1117 --subtle:#151b23 --border:#30363d --fg:#f0f6fc --muted:#8b949e
--accent:#2f81f7 --ok:#238636 --warn:#9e6a03 --bad:#f85149 --purp:#a371f7`), system sans
+ `ui-monospace` for code/ids. Code editor is CodeMirror-like: line numbers, GFM markdown
mode, subtle active-line highlight.

GOAL: manage the `.questions/` markdown library and edit one ask at a time — frontmatter
(description, model, args) plus a trailing ```schema block of judge questions. Current UI
already has a live summary card; the redesign must keep EVERY data element, make the
runnable/missing-schema state obvious at a glance, and keep the whole screen URL-addressable.

================================================================
LAYOUT (sidebar library + editor)
================================================================

┌────────────────────────────────────────────────────────────────┐
│ SIDEBAR 264px                                                  │
│  ask ▸ questions     [Trends|Runs|Questions]                   │
│  ┌Filter questions…┐ ┌＋ New┐                                  │
│  ▾ 📁 reviews/            │      MAIN (editor)                 │
│      ● code-quality       │  ┌ toolbar ────────────────────┐   │
│  ▾ 📁 security/           │  │ 📝 security-audit.md        │   │
│      ● auth-check     ⚠*  │  │ [jev-latest][runnable] Saved│   │
│  ● solid-review       ●   │  │ +Score +Choice +True/False  │   │
│  ● gut-feeling        ●   │  │      ▶Run Rename/Move Dup…  │   │
│  (● green=runnable,       │  └─────────────────────────────┘   │
│   ⚠ amber=no schema;      │  ┌ frontmatter card ───────────┐   │
│   *selected=accent)        │  │ YAML Front Matter           │   │
│                            │  │ Description … Model … Args… │   │
│                            │  └─────────────────────────────┘   │
│                            │  ┌ code editor (fills rest) ────┐  │
│                            │  │ 1  ---                        │  │
│                            │  │ 2  description: "…"           │  │
│                            │  │  … ```schema fenced block     │  │
│                            │  └───────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘

1. SIDEBAR — library tree. Search row = filter input + primary `＋ New` button.
   Questions grouped by folder path segments; folders collapsible. Each leaf row:
   status dot (green `Runnable` / amber `Missing schema`, dot tooltip says which),
   short name (basename), full `name — description` tooltip. Selected row highlighted.
   Empty states, keep both: none exist → "No questions found. Click '＋ New' to create
   one."; filter miss → "No matching questions." Clicking a leaf navigates to
   `#/questions/<name>` (an unsaved-changes confirm guards CLICK navigation only).

2. EDITOR — two states:
   a) NO SELECTION (`#/questions`): centered empty state — 📝 icon, "No Question
      Selected", "Select a question from the sidebar or create a new one to begin
      editing.", `＋ New Question` button.
   b) SELECTED (`#/questions/<name>`):
      • TOOLBAR, left→right groups:
          – 📝 icon + file path title (e.g. `security/security-audit.md`)
          – model badge (`jev-latest` or `-`)
          – state badge: green `runnable` or amber `no schema`
          – save state: `Saved` / amber `Unsaved changes ●` / `Saving…` / `Save failed`
          – "+ Category:" label + three template buttons: `+ Score` (ordinal ≥2 levels),
            `+ Choice` (categorical rubric), `+ True/False` (noul rework flag)
          – right-aligned actions: `▶ Run`, `Rename/Move`, `Duplicate`, `Delete` (danger),
            `Save` (primary; tooltip "Ctrl+S / Cmd+S")
      • FRONTMATTER SUMMARY CARD (labelled `YAML Front Matter`):
          – Description row (or `(none)`)
          – Model chip (accent badge, or `(none)`)
          – Args: one pill per `key=value` (hidden when empty)
          – Questions: one pill per schema question `id (type)` (hidden when empty)
        The card re-parses live while typing and refreshes from the server after save.
      • CODE EDITOR filling remaining height: line numbers, wraps lines, highlights the
        frontmatter block and the trailing ```schema fence (tinted backgrounds), GFM
        markdown highlighting for the prompt body. Show realistic markdown:
        `---` frontmatter (description, model, args map), prompt text, then a fenced
        ```schema block with three questions (`severity` type score with criteria list,
        `category` type choice with labelled options, `flag` type noul true/false).

================================================================
MODALS & GUARDS (render as overlay components, they are part of the screen)
================================================================

• Single reusable modal (backdrop + dialog): Create New Question (label "Question Name or
  Path (e.g. security-audit or reviews/code-quality)", confirm `Create`); Rename/Move
  (initial = current path, confirm `Move`); Duplicate (initial `<name>-copy`, confirm
  `Duplicate`). Empty input → inline error "Field cannot be empty."; Enter confirms,
  Escape cancels; server errors shown inline.
• Delete → native confirm "Permanently delete question "<path>"?".
• Run from toolbar → saves first if dirty, then a path prompt (default = last trends
  target or `src/serve.ts`), then navigates straight to `#/runs/<newRunId>`.
  After create/move/duplicate the app navigates to the new question's route.

================================================================
DEEP-LINK CONTRACT (real <a href> links in the design)
================================================================

`#/questions/<name>` loads that ask into the editor on boot. Links INTO this route:
trends matrix ask names, runs group headers, runs header-bar ask name. The questions
sidebar tree itself is the navigation. Tabs switch views; back/forward traverses
selections; routes bypass the unsaved-changes guard (guard is click-boundary only).

================================================================
SAMPLE DATA TO RENDER
================================================================

Sidebar: reviews/ → code-quality ●; security/ → auth-check ⚠ (selected, amber);
root: solid-review ●, gut-feeling ●.
Toolbar: `security/auth-check.md` · `[jev-latest]` · amber `[no schema]` · `Saved` ·
`+ Score + Choice + True/False` · `▶ Run  Rename/Move  Duplicate  Delete  Save`.
Frontmatter card: Description "Checks auth flows for session and token flaws" ·
Model `jev-latest` · Args `strict=true` `max_files=20` · Questions `severity (score)`
`category (choice)` `flag (noul)`.
Editor: frontmatter lines tinted; body markdown; ```schema fence tinted with the three
question definitions and their criteria.
