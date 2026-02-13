# Read→Do 技术方案（Tech Spec）
Repo: readdo
Location: docs/03-Tech-Spec.md
Version: 0.1 (MVP)
Last Updated: 2026-02-13

---

## 0. 目标与原则

### 0.1 MVP 目标
- **一键 Capture（Chrome Extension）**
- **本地优先**：local backend + SQLite
- **异步 pipeline**：extract → summarize → score → todos → card → export
- **可治理**：schemas + templates + evals 可跑回归
- **可迁移**：Core Engine 可复用到未来 Tauri（UI 可替换）

### 0.2 核心原则（工程约束）
- 状态机由 Orchestrator 统一管理（单一真相）
- Artifacts 版本化 + meta 统一（run_id / engine_version / template_version）
- 任意 AI 输出必须结构化、必须 schema 校验
- 变更必须跑 eval（至少 10 cases）

---

## 1. MVP 技术选型建议（偏保守、利于快速打磨）

> 你后续可改，但这个组合能最快跑通并减少 OS 坑。

### 1.1 运行形态
- 本地后台服务（Local API Server）：
  - 提供 /api（供 Web UI 与 Extension 调用）
  - 管理 worker（可同进程）
- Web App：
  - 访问 local API
- Chrome Extension：
  - 通过 fetch 调用 local API（需处理 CORS/permissions）

### 1.2 推荐栈（建议）
- Backend/Orchestrator：Node.js + TypeScript（轻量，生态好）
  - Framework：Fastify / Hono / Express（任一）
- SQLite：better-sqlite3 或 sqlite3（任选，优先稳定）
- Core Engine：TypeScript 模块（纯函数 + 接口注入）
- Extraction：Readability（Mozilla readability）+ HTML fetch
- Export：
  - MVP 优先：HTML render spec → headless chromium 截图（Playwright）生成 PNG
  - 降级：导出 Markdown + caption（不阻断 shipped）
- LLM client：
  - 抽象为 ModelClient interface（可接 OpenAI/本地模型/其它）
  - 模型与密钥仅存在 backend，不进入 extension

> 这套组合的关键收益：实现成本低、兼容性问题少、后续迁移 Tauri 时 Core Engine 不动。

---

## 2. 模块分解与边界（按 System Design 落地）

### 2.1 模块清单
1) `capture`（API）
- /capture 入库 + enqueue

2) `orchestrator`
- 状态机转移
- run_id 生成
- job enqueue/lease
- artifacts 写入（含 schema 校验）

3) `engine`（Core Engine）
- steps：extract/summarize/score/todos/card/export
- 通过 interface 注入外部依赖（model/template/store/clock/logger）

4) `store`
- SQLite repo：items/artifacts/decisions/jobs
- 文件存储（exports）

5) `webapp`
- Inbox/Detail/Edit/Export

6) `extension`
- popup：intent 输入 + capture

### 2.2 目录结构（建议）
```
/apps
  /api        # local backend + orchestrator + worker
  /web        # web app
  /extension  # chrome extension

/packages
  /core       # core engine (steps + interfaces)
  /contracts  # schemas loader/validator (runtime)
  /evals      # eval runner (cli)
  /shared     # shared types (DTOs), constants

/docs
  /contracts
    /schemas  # json schemas (source of truth)
    api.md
    state-machine.md
    artifact-meta.md
  /templates  # prompt templates
  /evals
    /cases
    rubric.md
  00-PRD.md
  02-System-Design.md
  03-Tech-Spec.md
  04-Execution-Plan.md
  05-Quality-Evals.md
```

---

## 3. 数据存储（SQLite）设计（MVP）

> 目标：简单、可回归、支撑版本化与状态机。

### 3.1 表：items
- id TEXT PRIMARY KEY
- url TEXT NOT NULL
- title TEXT
- domain TEXT
- source_type TEXT NOT NULL
- intent_text TEXT NOT NULL
- status TEXT NOT NULL
- priority TEXT NULL
- match_score REAL NULL
- failure_json TEXT NULL (nullable)
- created_at TEXT NOT NULL
- updated_at TEXT NOT NULL

索引：
- idx_items_status_updated (status, updated_at)
- idx_items_priority_score (priority, match_score)

### 3.2 表：artifacts
- id TEXT PRIMARY KEY
- item_id TEXT NOT NULL
- artifact_type TEXT NOT NULL
- version INTEGER NOT NULL
- created_by TEXT NOT NULL (system/user)
- created_at TEXT NOT NULL
- meta_json TEXT NOT NULL
- payload_json TEXT NOT NULL
- run_id TEXT NOT NULL

约束/索引：
- UNIQUE(item_id, artifact_type, version)
- idx_artifacts_item_type (item_id, artifact_type, version DESC)
- idx_artifacts_run (run_id)

### 3.3 表：decisions（可选但推荐）
- id TEXT PRIMARY KEY
- item_id TEXT NOT NULL
- action TEXT NOT NULL
- reason TEXT NULL
- created_at TEXT NOT NULL

### 3.4 表：jobs（队列/worker）
- id TEXT PRIMARY KEY
- item_id TEXT NOT NULL
- kind TEXT NOT NULL (PROCESS/EXPORT)
- status TEXT NOT NULL (QUEUED/LEASED/DONE/FAILED)
- run_id TEXT NOT NULL
- attempts INTEGER NOT NULL
- lease_owner TEXT NULL
- lease_expires_at TEXT NULL
- created_at TEXT NOT NULL
- updated_at TEXT NOT NULL
- last_error TEXT NULL

索引：
- idx_jobs_status_created (status, created_at)
- idx_jobs_item_kind (item_id, kind)

---

## 4. Worker / Queue 实现（MVP）

### 4.1 最简可用方案：SQLite-backed queue
- enqueue：插入 jobs(status=QUEUED)
- worker loop：
  1) 选取最早 QUEUED job
  2) 原子更新为 LEASED（lease_owner + lease_expires_at）
  3) 执行 pipeline
  4) 成功 DONE；失败 FAILED 并写 last_error
  5) 若 lease 超时可回收为 QUEUED

优势：
- 不依赖外部组件
- 可靠、易调试
- 满足 state-machine 的 lease 要求

### 4.2 幂等点
- process：同 item 同一 run_id 只应存在一个 PROCESS job
- export：同 export_key 只生成一次（或返回同结果）

---

## 5. Pipeline 具体落地（MVP）

### 5.1 PROCESS job 执行顺序
1) 状态：QUEUED → PROCESSING（写 items.status）
2) ExtractStep
- fetch HTML + Readability → normalized_text + meta
- 写 artifact: extraction vN (schema 可后补，MVP 可存结构但不强校验)
3) SummarizeStep（template: summary.engineer.v1）
- 输出 summary payload → schema 校验 → 入库
4) ScoreStep（可用内置模板或同 summary 模板扩展；MVP 也可用一个 score prompt）
- 输出 score → schema 校验 → 入库
- 同步更新 items.priority/items.match_score（便于列表）
5) TodoStep（template: todos.v1）
- 输出 todos → schema 校验 → 入库
6) CardStep（template: card.v1）
- 输出 card → schema 校验 → 入库
7) READY gate
- 若 summary/score/todos/card 均存在且 run_id 一致 → items.status=READY
- 否则失败进入 FAILED_AI，并记录 failed_step

### 5.2 ExportStep（EXPORT job 或同步）
- 读取指定 card_version 的 render_spec
- 生成文件写入 `exports/itm_xxx/`
- 写 export artifact（可后补 export schema）
- items.status=SHIPPED

---

## 6. Schema 校验与 Contracts 使用方式

### 6.1 写入前校验
- Orchestrator 在写 artifacts 前执行 JSON schema validation
- 校验失败：
  - 作为 FAILED_AI
  - error_code = AI_SCHEMA_INVALID
  - 保存 raw output（仅 debug，注意隐私；可选）

### 6.2 运行时加载
- schemas 作为 repo 内文件加载
- templates_version 与 schema 版本绑定（见 artifact-meta.md）

---

## 7. 抓取（Extraction）策略与降级

### 7.1 主路径：fetch + readability
- 对 url 做 GET
- 解析 DOM
- Readability 提取正文
- 规范化：
  - 去多余空白
  - 保留段落分隔
  - 限制长度（例如 12k–20k chars），超长截断并记录

### 7.2 降级策略
- fetch 失败：FAILED_EXTRACTION（可重试）
- readability 失败：
  - 提供 UI fallback：用户手动粘贴正文（manual content）
  - Orchestrator 支持 `POST /items/:id/manual_content`（MVP 可后补）

---

## 8. 导出（Export）策略与降级

### 8.1 主路径：HTML render spec → PNG
- 使用 Playwright/Chromium 渲染 HTML
- 固定 viewport = render_spec.width/height
- 截图保存为 PNG

### 8.2 降级路径：MD + caption
- 若 PNG 渲染失败：
  - 仍生成 markdown 与 caption
  - 标记为 SHIPPED 或提示 “partial shipped”（MVP 可直接 SHIPPED）

---

## 9. Web App（Experience）实现要点（MVP）

### 9.1 Inbox（决策队列）
- 默认排序：priority_score_desc（见 api.md）
- 每条显示：
  - title/domain
  - intent_text（必须可见）
  - match_score + priority
  - reasons（可在 hover/展开）

### 9.2 Detail（解释 + 编辑 + 导出）
- Tabs：Summary / Todos / Card / History（History 可后置）
- 编辑：
  - 编辑保存产生 created_by=user 的新 artifact version
- Regenerate：
  - 触发 /process mode=REGENERATE

---

## 10. Chrome Extension（MVP）

### 10.1 权限与调用
- popup 中获取当前 tab url/title
- 输入 intent_text
- 调用 POST /capture（本地服务）
- 成功提示 + “Open Inbox” 链接

### 10.2 兼容性风险
- 本地服务端口不可达：提示用户先启动 readdo 服务
- CORS：backend 需允许 extension origin（或使用 native messaging/bridge，后续再做）

---

## 11. 安全与隐私（MVP）

- 密钥只保存在 backend（环境变量/本地配置文件）
- artifacts evidence 默认关闭或最小化
- 允许用户一键删除 item 与相关 artifacts（后续补充）

---

## 12. 验收清单（MVP）

功能验收：
- Extension：一键 capture + intent
- Inbox：列表可见（含 intent/priority/score）
- Pipeline：可将 CAPTURED → READY
- READY：存在 summary/score/todos/card（schema 通过）
- Detail：可编辑 todos/card（新 version）
- Export：至少能导出 md/caption；png 作为主路径
- 失败：FAILED_* 可见 + Retry 可用

质量验收：
- `evals` 能跑通（10 cases）
- P0/P1 全通过（见 rubric）
- 变更 templates 后能触发回归并发现问题

---

## 13. 风险与对应策略（MVP）

- 抓取不稳定 → 引入 manual content fallback
- 导出渲染复杂 → 先保证 md/caption，再补 png
- 模型漂移 → schemas + evals gate
- 并发与卡死 → sqlite queue + lease 超时回收

---
