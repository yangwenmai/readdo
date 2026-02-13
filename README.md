# Read→Do (readdo)
Save links less. Ship outputs more.

Read→Do is an AI-native “Read → Decide → Do → Ship” system:
- Capture links with a one-line intent
- Auto-generate structured artifacts (Summary / Score / Todos / Card)
- Export shareable outputs (PNG/MD/caption)
- Local-first by default (SQLite)

## What’s inside
- `apps/api`        Local backend (API + orchestrator + worker)
- `apps/web`        Web app (Inbox / Detail / Status Actions)
- `apps/extension`  Chrome extension (one-click capture)
- `packages/core`   Core engine (summary/score/todos/card generation)
- `packages/contracts` Runtime schema validators (AJV)
- `packages/eval-runner` Eval CLI (`pnpm eval`)
- `docs/contracts/schemas` JSON schemas (source of truth)
- `docs/templates`  Prompt templates (versioned)
- `docs/evals`      Regression cases + rubric + reports
- `docs`            PRD / System Design / Tech Spec / Execution Plan

---

## Quick start (MVP)
> This repo is designed to run locally first.

### 1) Install
```bash
pnpm install
````

### 2) Start API

```bash
pnpm dev:api
```

Default:

* API: `http://localhost:8787/api` (example)

> If you use a different port, update the web app + extension config accordingly.

### 3) Start Web

```bash
pnpm dev:web
```

Open `http://localhost:5173` in your browser.

### 4) Load Chrome Extension

1. Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select `apps/extension`
4. Pin the extension to the toolbar

### 5) Capture a link

* Open any webpage
* Click the extension
* Enter `Why save this?` (intent)
* Save → Open Inbox

---

## Run evals (quality gate)

Evals ensure schema + key behaviors don’t drift.

```bash
pnpm eval
```

Quality gates:

* P0 must be 100% passing
* P1 must be 100% passing (unless you explicitly relax it)
* P2 allows small slack

See:

* `docs/05-Quality-Evals.md`
* `docs/evals/rubric.md`
* `docs/evals/cases/*`

---

## Contracts & governance

Artifacts are the source of truth. Any AI output must:

1. Match schema in `docs/contracts/schemas/*`
2. Carry required meta fields (run_id / engine_version / template_version / created_by / created_at)
3. Pass eval gates when templates/engine change

Key docs:

* `docs/contracts/state-machine.md`
* `docs/contracts/api.md`
* `docs/contracts/artifact-meta.md`

---

## Export formats

MVP export targets:

* Markdown + caption（已落地）
* PNG（下一步补齐，基于 HTML render_spec）

See `docs/contracts/schemas/card.schema.json` for `render_spec`.

---

## Roadmap

* More sources: YouTube transcript, newsletters, PDFs
* More templates: engineer/creator/manager cards
* More exports: Notion/Obsidian/Todoist/Linear
* Desktop shell (Tauri) as a replaceable experience layer

---

## License

TBD
