# Read→Do 执行规划（Execution Plan）
Repo: readdo
Location: docs/04-Execution-Plan.md
Version: 0.1 (MVP)
Last Updated: 2026-02-13

---

## 0. 目的

本规划用于把 Read→Do MVP 变成一个**可持续打磨**的产品基座：
- 每个里程碑都交付可用闭环（Capture → Decide → Do → Ship）
- 每一步都有明确验收标准（功能 + 质量）
- 风险可控：抓取、导出、模型漂移都有降级路径
- 治理可运行：schemas + templates + evals 在每次变更中保持有效

---

## 1. 里程碑总览（M0 → M5）

> 时间不硬绑定，你可按节奏推进。关键是按依赖关系逐步闭环。

### M0：Repo 基座 + 契约落地（Docs/Contracts/Evals）
交付物：
- docs/00-PRD.md
- docs/02-System-Design.md
- docs/03-Tech-Spec.md
- docs/05-Quality-Evals.md
- docs/contracts/schemas/{summary,score,todos,card,extraction,export}.schema.json
- docs/templates/{summary.engineer.v1,summary.creator.v1,score.v1,todos.v1,card.v1}.md
- docs/contracts/{state-machine,api,artifact-meta,pipeline-contract,status-mapping,template-governance}.md
- docs/evals/rubric.md + docs/evals/cases (10)

验收：
- 文档与契约齐全（可作为 Cursor 上下文）
- schemas 与 templates 命名一致
- docs/evals/cases 文件存在且结构一致（可被 runner 读取）

风险：
- 无（纯资产落地）

---

### M1：Capture 端到端（Extension → API → SQLite）
交付物：
- POST /capture 可用（幂等）
- items 表可写入 CAPTURED
- GET /items 列表可见（至少显示 url/title/intent/status）

验收（功能）：
- 点击 Extension → 输入 intent → 保存成功
- Web Inbox 能看到该 item（status=CAPTURED 或 QUEUED）

验收（质量）：
- capture 请求重复发送不产生重复 item（Idempotency-Key 或 capture_id）

降级：
- 若 Extension CORS/访问失败：提供临时 bookmarklet 或手动粘贴 url 到 Web（只作为应急，不是主路径）

---

### M2：最小 Pipeline（Extract + Summary）
交付物：
- sqlite-backed queue + worker lease 可用
- ExtractStep 可跑：url → normalized_text（存 extraction artifact）
- SummarizeStep 可跑：生成 summary artifact（schema 校验）
- 状态转移：CAPTURED → QUEUED → PROCESSING →（成功则 partial READY 或暂用 PROCESSING+artifacts）

验收（功能）：
- 新 capture 的 item 最终能生成 summary
- 失败时进入 FAILED_EXTRACTION 或 FAILED_AI，可在 UI 看到错误并重试

验收（质量）：
- summary payload 100% 通过 summary.schema.json

降级：
- 抓取失败：允许手动粘贴正文（manual content）作为 extraction 输入（若暂未实现 UI，可作为 CLI/DB 注入）

---

### M3：Decide 能力闭环（Score + Inbox 排序 + Reasons）
交付物：
- ScoreStep 输出 score artifact（schema 校验）
- items 表同步更新 priority/match_score（用于列表排序）
- Inbox 默认排序实现 priority_score_desc
- Detail 展示 reasons（至少 3 条）

验收（功能）：
- READY（或准 READY）列表按 priority+score 排序
- reasons 清晰解释“为什么建议读/跳过”
- 匹配分区间与 priority 一致（见 rubric P0-3）

验收（质量）：
- score payload 100% 通过 score.schema.json
- reasons >= 3，且至少 2 条非泛化（rubric P1-1）

降级：
- 若 scoring 一开始不稳定：先用可解释的规则/启发式（仍产出 reasons），再引入模型

---

### M4：Do 能力闭环（Todos + 可编辑版本）
交付物：
- TodoStep 输出 todos artifact（schema 校验）
- UI 支持编辑 todos（生成 created_by=user 的新版本）
- Regenerate 支持生成 system 新版本但不覆盖 user 版本

验收（功能）：
- todos 3–7 条，含 ETA
- 至少 1 条输出型任务（WRITE/SHARE/BUILD/DECIDE）或启发式满足
- 用户编辑后，刷新仍保留编辑版本（version++）

验收（质量）：
- todos payload 100% 通过 todos.schema.json
- P1-2（动词开头 + 可执行）通过

降级：
- 若类型/动词规则难稳定：先保证 ETA 与数量，动词开头作为 P1（可先放宽），但保持可编辑

---

### M5：Ship 闭环（Card + Export）
交付物：
- CardStep 输出 card artifact（schema 校验）
- Export：
  - 主路径：HTML_V1 → PNG（Playwright）
  - 降级：导出 Markdown + caption
- export 成功后进入 SHIPPED

验收（功能）：
- 卡片可导出（至少 md/caption 必达）
- png 若失败不阻断“交付”（仍能 ship）
- SHIPPED 列表可见，支持再次导出（幂等）

验收（质量）：
- card payload 100% 通过 card.schema.json
- action 不空泛（rubric P1-3）

降级：
- PNG 渲染失败：只 ship md/caption，并记录 FAILED_EXPORT 供重试渲染（可选）

---

## 2. 质量门禁（持续）

### 2.1 何时必须跑 eval
- docs/templates/ 任意变更
- engine step 逻辑变更
- schema 变更
- scoring/todo/card 相关规则变更

### 2.2 通过门槛（MVP）
- P0：必须 100% 通过
- P1：必须 100% 通过（若你阶段性要放宽，必须在 PR 里声明）
- P2：允许少量失败（<=2/10），并记录 TODO

---

## 3. 风险清单与对策

### 3.1 抓取/解析不稳定
风险：站点差异、反爬、动态渲染  
对策：
- readability 为主，必要时增加 user-agent/timeout
- manual content fallback
- 失败原因可见 + retryable 标记

### 3.2 导出渲染复杂
风险：Playwright 依赖、字体、截图尺寸  
对策：
- 先保证 md/caption
- PNG 作为增强：失败可重试，不阻断 ship

### 3.3 模型输出漂移
风险：模型升级、prompt 变更导致质量下降  
对策：
- schemas 强约束
- evals 回归
- meta 记录 engine/template/model 版本

### 3.4 并发与卡死
风险：worker 崩溃导致 PROCESSING 卡住  
对策：
- sqlite queue + lease_expires_at
- 超时回收 QUEUED

---

## 4. 交付验收 Checklist（MVP Done Definition）

### 功能（必须）
- [ ] Extension 一键 capture + intent
- [ ] Inbox 可见队列（含 priority/score/intent）
- [ ] Detail 展示 summary/score/todos/card
- [ ] Retry 可用（FAILED_* → QUEUED）
- [ ] Todos 可编辑且版本保留
- [ ] Export 至少 md/caption 可用
- [ ] SHIPPED 状态可见

### 治理（必须）
- [ ] 所有 artifacts 写入前 schema 校验
- [ ] meta 必填字段齐全（run_id/engine_version/template_version/created_by/created_at）
- [ ] eval runner 能跑 10 cases（至少本地）
- [ ] 模板变更触发回归

---

## 5. “演示友好但不为演示而做”的清单（可选）

> 仅用于你自测/展示流程顺畅，不影响产品目标。

- [ ] 从一个真实网页一键 capture（<3s）
- [ ] 30–60s 内 READY（可展示 progress）
- [ ] reasons 一眼让人信服（对齐 intent）
- [ ] todos 至少 1 条是“能立刻做的输出动作”
- [ ] 一键导出卡片（或 md/caption），能马上发到群里/朋友圈/视频号配文

---

## 6. 下一步（开工前最后一步）

建议你在 Cursor 开工前，补一个极小但关键的工程资产：
- `README.md`：如何启动 api/web/extension，如何跑 eval
- `CONTRIBUTING.md`：模板/契约变更必须跑 eval 的规则

这样仓库从第一天起就具备“可持续打磨”的工程文化。

---
