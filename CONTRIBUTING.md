# Contributing to Read→Do

This repo is AI-native by design: artifacts + contracts + evals are the backbone.
We optimize for long-term product quality, not one-off demos.

---

## 1) Core principles
1) **Artifacts are source of truth**
   - Summary / Score / Todos / Card are versioned artifacts
2) **Contracts first**
   - Any AI output must be schema-valid
3) **Evals prevent drift**
   - Template/engine changes must pass regression gates
4) **Orchestrator owns state**
   - Item state transitions are centralized and explicit
5) **Local-first**
   - Default data lives locally (SQLite)

---

## 2) Required checks for changes

### If you change templates (`/templates`)
You MUST:
- bump `template_version` (e.g. v1 → v2 when behavior meaningfully changes)
- run evals:
  ```bash
  pnpm eval
````

* ensure P0/P1 gates pass

### If you change schemas (`/contracts/schemas`)

You MUST:

* consider compatibility (breaking vs additive)
* update:

  * related templates
  * `docs/contracts/api.md` (if payload shape affects API)
  * `evals/rubric.md` (if assertions depend on fields)
* run evals and ensure gates pass

### If you change engine/orchestrator (`/packages/core` or `apps/api`)

You MUST:

* bump `engine_version` when behavior changes
* run evals and ensure gates pass
* ensure state machine rules remain consistent:

  * `docs/contracts/state-machine.md`

---

## 3) Governance rules (non-negotiable)

### 3.1 State machine

* Do not add implicit transitions.
* Any new status/transition must update:

  * `docs/contracts/state-machine.md`
  * `docs/contracts/api.md`
  * related UI mappings

### 3.2 Artifact meta

All artifacts MUST carry meta fields:

* run_id
* engine_version
* template_version
* created_by
* created_at

See `docs/contracts/artifact-meta.md`.

### 3.3 Versioning

* system regenerate → new artifact version
* user edit → new artifact version
* never overwrite a user-edited artifact unless explicitly requested

---

## 4) Quality gates (MVP)

* P0: 100% pass (blocking)
* P1: 100% pass (blocking by default)
* P2: allow small slack (<=2 failures / 10 cases)

See:

* `docs/05-Quality-Evals.md`
* `evals/rubric.md`

---

## 5) Commit discipline (recommended)

* Small commits per milestone:

  * capture
  * pipeline step
  * schema/template changes
  * eval additions
* Every milestone should produce an end-to-end usable slice.

---

## 6) Adding new eval cases

* Add a new file in `evals/cases/`
* Keep it stable and self-contained (intent + extracted_text)
* Prefer cases that represent real product decisions:

  * high relevance / low relevance
  * high signal / low signal
  * long form / short form

---

## 7) Security & privacy

* Do not commit secrets
* Do not store full raw web pages in eval cases
* Keep evidence snippets minimal and privacy-friendly

---
