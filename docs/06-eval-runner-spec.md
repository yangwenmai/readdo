# Read→Do Eval Runner 规范（Spec）
Location: docs/06-eval-runner-spec.md
Version: 0.1
Last Updated: 2026-02-13

本规范定义 Eval Runner 的最小接口与回归门禁，用于防止 AI 输出漂移。
它描述“应当如何评估”，不绑定具体实现位置（apps/api/scripts 或 tools/）。

---

## 1. CLI 合约

### 1.1 命令
- `pnpm eval`（默认）
- 可选：`pnpm eval:watch`

### 1.2 Flags（MVP）
- `--cases <glob>` 默认：`docs/evals/cases/*.json`（相对 repo root）
- `--out <path>` 默认：`docs/evals/reports/latest.json`（相对 repo root）
- `--format json|text` 默认：`text`
- `--fail-on P0|P1|P2` 默认：`P1`
- `--profile engineer|creator|manager` 默认：`engineer`

### 1.3 Exit code
- 0：通过门禁
- 1：门禁失败（P0/P1 或配置阈值）
- 2：Runner 自身错误（IO/schema 缺失等）

---

## 2. Case 输入格式

每个 case 位于 `docs/evals/cases/*.json`，不依赖网络。

必填：
```json
{
  "id": "case_001",
  "source_type": "web|youtube|newsletter|other",
  "intent_text": "string",
  "extracted_text": "string"
}
````

可选：

* title, domain, notes

约束：

* 不放 raw HTML
* 文本应代表真实场景但保持隐私友好

---

## 3. Runner ↔ Core Engine 接口

Runner 只做：喂稳定输入、收结构化输出、做校验与断言。

### 3.1 输入

* intent_text
* extracted_text
* profile（engineer/creator/manager）
* engine_version（用于 meta）

### 3.2 输出（payload 级）

Runner 必须拿到 4 个 artifacts payload：

* summary（summary.schema.json）
* score（score.schema.json）
* todos（todos.schema.json）
* card（card.schema.json）

同时建议返回用于 debug 的 meta：

* run_id / engine_version / template_version(s) / model_id

---

## 4. 校验流水线（每个 case）

1. 读取 case
2. 调用 generator
3. JSON schema 校验（4 个 artifacts）
4. rubric 断言（P0/P1/P2）
5. 聚合输出报告
6. 应用门禁策略并退出

---

## 5. Rubric（实现要点）

P0（阻断）：

* schema 全过
* reasons>=3
* priority 与 score 区间一致（±0.5）
* todos 3..7 且每条有 eta/title
* card points == 3，headline/insight/action 非空

P1（默认阻断）：

* reasons 至少 2 条含具体线索（对齐 intent 或内容结构特征）
* todo 至少 2 条动词开头（中英启发式）
* card.action 不空泛（必须是“明确动作+对象/约束”）

P2（可容忍少量失败）：

* bullets 不高重复
* insight 不只是 bullets 复述
* headline 不泛化

---

## 6. 报告格式

输出 `docs/evals/reports/latest.json`：

* run 信息（profile/engine/template/model）
* 汇总（p0/p1/p2 失败数）
* 每 case 的 checks 列表 + preview（reasons/todos/headline）

同时 console 输出按 P0/P1/P2 分组列失败。

---
