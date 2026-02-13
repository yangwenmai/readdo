# Read→Do 质量与评估方案（Quality & Evals）
Location: docs/05-Quality-Evals.md
Version: 0.1 (MVP)
Last Updated: 2026-02-13

---

## 0. 目的

Read→Do 是 AI-native 系统：输出存在不确定性与漂移风险。质量体系的目的不是追求“完美内容”，而是确保：

1) **结构不漂**：产物始终符合 schema（Summary/Score/Todos/Card）
2) **行为不漂**：关键产品约束稳定（reasons ≥ 3、todos 可执行、priority 映射合理）
3) **可回归**：模板/引擎/实现变更后可自动检测退化
4) **可解释**：评分与优先级必须提供具体 reasons，避免泛化废话

---

## 1. 测试金字塔（MVP）

### 1.1 Schema Validation（必须）
- 对所有 artifacts payload 执行 JSON Schema 校验：
  - docs/contracts/schemas/summary.schema.json
  - docs/contracts/schemas/score.schema.json
  - docs/contracts/schemas/todos.schema.json
  - docs/contracts/schemas/card.schema.json

### 1.2 Behavioral Assertions（必须）
对核心约束做断言（见 docs/evals/rubric.md）：
- score.reasons ≥ 3 且非空泛
- priority 与 match_score 区间一致（READ_NEXT/WORTH_IT/IF_TIME/SKIP）
- todos 数量 3..7，title 动词开头，含 ETA
- card points 必为 3 条且可读

### 1.3 Golden Cases（MVP=10 条）
- 固定输入：intent + extracted_text（不依赖网络抓取）
- 固定断言：结构与关键行为
- 不要求“文本逐字一致”，只要求满足质量门槛

---

## 2. 质量门槛（Quality Gates）

每次以下变更必须跑 eval：
- docs/templates/ 下任何模板变化
- core engine 逻辑变化（summarize/score/todo/card）
- docs/contracts/schemas 变化（尤其破坏性变更）
- Orchestrator 的 pipeline 顺序/合并规则变化

**门槛（MVP）**
- Schema：100% 通过（任何一条失败直接失败）
- Behavioral：每个 case 必须通过 P0/P1 断言
- P2 断言：允许少量失败（例如 10 case 中最多 2 个）

---

## 3. Rubric 分级（用于快速定位问题）

- **P0（阻断）**：系统不可用/结构不合法
  - schema 不通过
  - reasons 少于 3
  - todos 少于 3 或超过 7
  - card points 不等于 3
- **P1（严重）**：体验与信任崩坏
  - reasons 过于泛化（例如“内容很有启发”）
  - priority 与 score 区间不一致
  - todos 不可执行（无动词/无 ETA/全是“了解一下”）
- **P2（一般）**：质量可用但可优化
  - insight 太长或重复
  - points 重复或信息量不足
  - card action 不够具体

---

## 4. 回归输入设计（为什么用 extracted_text）

MVP 阶段，抓取与解析存在不稳定性，会污染评估结果。
因此 eval 用例固定使用 `extracted_text` 作为 pipeline 输入，确保：
- 引擎与模板质量可测
- 变更导致的退化可定位

抓取/解析单独作为 integration test（后续补充）。

---

## 5. 运行方式（实现建议，不强绑技术栈）

评估 runner 需要做：
1) 读取 docs/evals/cases/*.json
2) 调用 Core Engine 生成 summary/score/todos/card
3) schema 校验
4) rubric 断言
5) 输出 report（json + console）

MVP 推荐：
- 本地命令：`npm run eval` 或 `make eval`
- CI：每次 PR 必跑

---

## 6. 观测与线上质量（后续）

当系统开始真实使用，建议补充：
- 处理耗时 p50/p95
- 各 step 失败率
- 用户行为：archive/skip 比例、export 比例
- 用户对 score 的“纠偏”行为（调高/调低优先级）

这些数据将反哺 scoring 与模板迭代。

---
