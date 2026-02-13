# Read→Do (readdo)
Save links less. Ship outputs more.

Read→Do is an AI-native “Read → Decide → Do → Ship” system:
- Capture links with a one-line intent
- Auto-generate structured artifacts (Summary / Score / Todos / Card)
- Export shareable outputs (PNG/MD/caption)
- Local-first by default (SQLite)

## What’s inside
- `apps/api`        Local backend (API + orchestrator + worker)
- `apps/web`        Web app (Inbox / Detail / Edit / Export)
- `apps/extension`  Chrome extension (one-click capture)
- `packages/core`   Core engine (pipeline steps, interfaces)
- `contracts/schemas` JSON schemas (source of truth)
- `templates`       Prompt templates (versioned)
- `evals`           Regression cases + rubric
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
pnpm -C apps/api dev
```

Default:

* API: `http://localhost:8787/api` (example)

> If you use a different port, update the web app + extension config accordingly.

### 3) Start Web

```bash
pnpm -C apps/web dev
```

Open the Inbox in your browser.

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
* `evals/rubric.md`
* `evals/cases/*`

---

## Contracts & governance

Artifacts are the source of truth. Any AI output must:

1. Match schema in `contracts/schemas/*`
2. Carry required meta fields (run_id / engine_version / template_version / created_by / created_at)
3. Pass eval gates when templates/engine change

Key docs:

* `docs/contracts/state-machine.md`
* `docs/contracts/api.md`
* `docs/contracts/artifact-meta.md`

---

## Export formats

MVP export targets:

* PNG (preferred, via HTML render_spec)
* Markdown + caption (fallback)

See `contracts/schemas/card.schema.json` for `render_spec`.

---

## Roadmap

* More sources: YouTube transcript, newsletters, PDFs
* More templates: engineer/creator/manager cards
* More exports: Notion/Obsidian/Todoist/Linear
* Desktop shell (Tauri) as a replaceable experience layer

---

## License

TBD
