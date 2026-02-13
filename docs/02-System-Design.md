# Read→Do（readdo）系统设计稿（System Design）
Version: 0.1 (MVP)
Last Updated: 2026-02-13
Scope: MVP + Chrome Extension + Web App + Local-first backend + SQLite

---

## 0. 设计目标与约束

### 0.1 系统设计目标（AI-Native）
Read→Do 不仅要“跑通功能”，还要满足 AI-Native 的系统性要求：

- **可解释（Explainable）**：score/priority 必须有 reasons，可指向 intent 与内容特征
- **可控（Controllable）**：输出受 schema + templates 约束；支持人工编辑与版本保留
- **可复现（Reproducible）**：每次 AI 产出可追踪输入、模板版本、引擎版本
- **可评估（Evaluable）**：存在 eval 用例集与断言，防止质量漂移
- **可演进（Evolvable）**：扩展 source/extractor/template/export 时不破坏核心

### 0.2 MVP 约束
- Capture 在 Chrome Extension 端完成：仅提交事实（url/title/source/intent）
- 抓取/摘要/评分/TODO/卡片生成均在后台执行（异步）
- 本地优先：SQLite 作为默认存储（可替换）
- UI 与 Core Engine 解耦：未来可替换为 Tauri 不重写核心

---

## 1. 系统架构总览

### 1.1 分层架构（强边界）
Read→Do 采用四层结构，目标是“核心可迁移、外壳可替换”。

1) **Capture Layer（Chrome Extension）**
- 收集：url/title/domain/source_type + intent
- 发送：POST /capture
- 不做：正文抓取、AI、评分、业务状态变更

2) **Orchestrator Layer（Backend API + 状态机 + 任务调度）**
- 单一真相来源（Single Source of Truth）：
  - 维护 Item 状态机
  - 调度 pipeline steps
  - 版本化写入 artifacts
- 对外提供：items list/detail、重试、导出、归档

3) **Core Engine Layer（业务核心，可迁移）**
- 实现 pipeline steps 的纯业务逻辑：
  - extract/normalize、summarize、score、todo、card、render spec
- 通过接口注入：Extractor、ModelClient、TemplateStore、Clock、Logger
- 不直接依赖：Web 框架、数据库、前端

4) **Experience Layer（Web App / Future Tauri App）**
- 展示：Inbox（决策队列）、详情、编辑、导出
- 触发：process/retry、export、archive
- 不内置：评分逻辑、pipeline 逻辑

### 1.2 部署形态（MVP 推荐）
- Local backend（localhost）+ SQLite file
- Web app 通过 API 访问 local backend
- Extension 通过 API 访问 local backend（或经由本地桥接）

> 注：具体实现形态在 Tech Spec 中定。System Design 只定义契约与行为。

---

## 2. 核心领域对象（Domain Model）

### 2.1 Item（内容条目）
Item 表示一个被 Capture 的“内容意图单元”。

**核心字段**
- id
- url, title, domain, source_type
- intent_text
- status（状态机）
- created_at, updated_at

### 2.2 Artifact（AI 产物，版本化）
Artifact 表示某次 pipeline 运行（或人工编辑）产生的结构化结果。

**核心字段**
- id, item_id
- artifact_type: extraction | summary | score | todos | card | export
- version: int（递增）
- payload: json（必须通过 schema）
- meta:
  - engine_version
  - template_version
  - model_id（若适用）
  - prompt_hash（可选）
  - created_at
  - created_by: system | user
- provenance:
  - input_hash（如 extraction_hash）
  - upstream_artifact_versions（可选）

### 2.3 Decision（用户决策事件）
记录用户对条目的显式动作，用于后续个性化与可解释性增强。

- item_id
- action: read_now | queue | skip | ship | archive | unarchive | regenerate
- reason（可选）
- created_at

---

## 3. 状态机（State Machine）

### 3.1 状态定义（MVP）
- `CAPTURED`：已入库（事实+intent）
- `QUEUED`：等待处理
- `PROCESSING`：pipeline 执行中
- `READY`：产物齐备（至少 summary+score+todos+card）
- `FAILED_EXTRACTION`：抓取/抽取失败
- `FAILED_AI`：AI 生成失败（summary/score/todo/card 任一步）
- `FAILED_EXPORT`：导出失败
- `SHIPPED`：已导出卡片或完成关键行动闭环
- `ARCHIVED`：用户归档（含从 SKIP 进入）

### 3.2 状态转移规则（核心）
- CAPTURED → QUEUED（自动）
- QUEUED → PROCESSING（worker 领取任务）
- PROCESSING → READY（所有必需 artifacts 写入成功）
- PROCESSING → FAILED_*（任一步失败，记录失败原因与可重试信息）
- READY → SHIPPED（export 成功或用户显式标记）
- READY → ARCHIVED（用户归档）
- FAILED_* → QUEUED（用户重试/系统重试策略触发）
- ARCHIVED ↔ READY（用户恢复/重新进入队列）

### 3.3 幂等与并发控制
- 同一 item 不应同时被多个 worker PROCESSING（需锁或租约）
- process/retry/export 接口必须幂等：
  - 重复调用不会产生冲突状态
  - 通过 run_id 或 artifact versioning 保证一致性

### 3.4 失败原因可见性
FAILED 状态必须附带：
- failed_step
- error_code
- message（对用户友好）
- retryable（bool）
- last_attempt_at

---

## 4. Pipeline 设计（Step Registry）

### 4.1 Pipeline 原则
- 每一步有明确输入输出契约
- 每一步输出必须 schema 校验通过才能落库
- 允许部分产物先落地（例如 extraction 成功但 summary 失败）
- 支持“再生成”（regenerate）：新版本 artifacts，不覆盖旧版本

### 4.2 Steps（MVP）
#### Step 1: ExtractStep
输入：url, source_type, (optional) html_snapshot  
输出：extraction artifact
- normalized_text
- content_meta（author, publish_date, duration, etc.）
- extraction_hash（用于缓存/复现）

失败：FAILED_EXTRACTION（可重试）

#### Step 2: SummarizeStep
输入：normalized_text + intent_text + summary_template  
输出：summary artifact
- bullets[3..5]
- insight

失败：FAILED_AI（可重试）

#### Step 3: ScoreStep
输入：intent_text + summary + content_meta + (optional) recent_items_digest  
输出：score artifact
- match_score (0..100)
- priority enum
- reasons[>=3]
- (optional) confidence

失败：FAILED_AI（可重试）

#### Step 4: TodoStep
输入：intent_text + summary + score/priority + todo_template  
输出：todos artifact
- todos[3..7]（含 ETA、动词开头、至少 1 输出型任务）

失败：FAILED_AI（可重试）

#### Step 5: CardStep
输入：summary + todos + card_template  
输出：card artifact
- headline
- points[3]
- insight
- action
- (optional) hashtags
- render_spec（HTML/CSS 或抽象布局结构）

失败：FAILED_AI（可重试）

#### Step 6: ExportStep（可异步）
输入：render_spec  
输出：export artifact
- files（png/md/caption）或 content blobs
失败：FAILED_EXPORT（可重试）

### 4.3 Step 接口（实现约束）
每个 Step 需实现：
- run(input) -> output
- validate(output) -> ok/error（schema）
- fingerprint(input) -> hash（用于缓存/复现）
- depends_on（上游 artifacts 类型与版本）

---

## 5. 数据版本化策略（Artifacts as Source of Truth）

### 5.1 版本递增规则
- artifact_type + item_id 形成序列：version 从 1 开始递增
- regenerate/人工编辑都生成新 version
- UI 默认展示“最新 system 或 user 版本”（按策略）

### 5.2 人工编辑与系统生成的冲突策略
- 人工编辑（created_by=user）的 artifact 不应被 system regenerate 覆盖
- regenerate 默认生成新 system 版本，并保留 user 版本
- UI 提供“切换版本/对比”能力（MVP 可后置，但数据结构需支持）

---

## 6. Contracts（契约）与治理资产的系统位置

### 6.1 Schemas（强制）
所有 artifacts payload 必须通过 JSON Schema 校验：
- docs/contracts/schemas/*.schema.json

校验位置：
- Orchestrator 在写入 artifacts 前校验
- CI 在 evals 运行时校验

### 6.2 Templates（可版本化）
模板作为“可控输出方向盘”：
- docs/templates/summary.*.v1.md
- docs/templates/todos.v1.md
- docs/templates/card.v1.md

模板版本变化需触发 eval 回归。

### 6.3 Evals（回归）
- docs/evals/cases：固定输入（intent + extracted_text）
- docs/evals/rubric：断言规则与阈值

Orchestrator/Core Engine 的任何变更若影响 artifacts 结构或逻辑，必须跑 eval。

---

## 7. API 契约（系统层面）

### 7.1 关键 API（MVP）
- POST /capture
  - input: url, title, domain, source_type, intent_text
  - output: item_id, status=CAPTURED

- GET /items
  - filters: status, priority, score_range, source_type
  - output: list items + latest score summary

- GET /items/:id
  - output: item + latest artifacts + artifact version refs

- POST /items/:id/process
  - purpose: trigger pipeline (or retry)
  - idempotent

- POST /items/:id/export
  - purpose: render card into png/md/caption
  - idempotent with export_key

- POST /items/:id/archive / unarchive

### 7.2 路由与状态机关系
- /capture 只创建 item，不直接进入 READY
- /process 触发 QUEUED → PROCESSING
- /export 只允许在 READY、SHIPPED 或 FAILED_EXPORT（重试导出）状态执行
- /archive 可在任何非 PROCESSING 状态执行（MVP）

---

## 8. 观测与可运维性（MVP 最小集合）

### 8.1 日志（per pipeline run）
必须记录：
- item_id
- run_id
- step_name
- duration_ms
- status（ok/fail）
- error_code（若失败）

### 8.2 指标（可选，但推荐）
- capture_count
- processing_latency_p50/p95
- failure_rate_by_step
- retries_count

### 8.3 可调试性
- 保留 extraction normalized_text（可选脱敏策略）
- 保留 reasons 与关键 evidence（MVP 可仅 reasons）

---

## 9. 安全与隐私（系统层面约束）

- 本地优先：默认 SQLite 存储在用户机器上
- 任何外部模型调用必须可配置/可关闭，并明确数据流向（在 Tech Spec 细化）
- tokens/keys 不进入 extension（由 backend 管理）

---

## 10. 扩展点（Extension Points）

Read→Do 从 MVP 起即预留以下扩展点：

### 10.1 Sources / Extractors
- web article extractor
- YouTube transcript extractor
- newsletter email extractor
以 `Extractor` 接口扩展，不影响下游 steps

### 10.2 Templates
- summary templates（engineer/creator/manager）
- card templates（insight card / tutorial card / decision memo）
通过 TemplateStore 版本化管理

### 10.3 Exports
- PNG/MD/caption（MVP）
- Notion/Obsidian/Todoist（后续）
通过 Exporter 接口扩展

### 10.4 Personalization（后续）
- user_profile（阅读偏好、时间预算、主题）
- ranking tuning
必须以“可解释、可控”为约束，不允许黑箱替换 reasons

---

## 11. MVP 实施建议（从系统角度的最短路径）

按系统风险从低到高推进：
1) /capture + items list（CAPTURED 可见）
2) ExtractStep（READY partial，至少能展示 extracted_text/summary）
3) Summary + Score（能做 Decide）
4) Todos + Card（能做 Do + Ship）
5) Export（png 优先，md 降级）
6) Failure states + Retry（保证可靠）

---

## 12. 待定项（留给 Tech Spec 的决策）
- 任务队列实现：in-process queue vs sqlite-backed queue vs external
- 抓取方式：server-side fetch + readability vs headless browser
- 导出方式：HTML→PNG 的具体渲染器选择
- 模型调用方式：本地模型/远程 API/可插拔 client
- 端到端打包形态：local daemon + web, 或 electron/tauri

System Design 的契约不依赖这些实现细节，但要求它们满足：幂等、版本化、可评估。

---
