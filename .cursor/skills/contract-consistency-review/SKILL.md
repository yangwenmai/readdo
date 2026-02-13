---
name: contract-consistency-review
description: 审查 docs/contracts、docs/templates、docs/contracts/schemas 的跨文档一致性，识别状态机、字段、枚举、路径冲突并输出修复建议。用于契约审查、一致性检查、查漏补缺场景；检测到 contract/schema/template 相关任务时应主动应用。
---

# Contract Consistency Review

## 适用场景
- 用户提到：契约检查、查漏补缺、文档一致性、schema 对齐。
- 变更涉及 `docs/contracts` / `docs/templates` / `docs/contracts/schemas`。

## 工作流
1. 列出变更或目标文件，按 API / State / Pipeline / Schema / Template 分组。
2. 逐组核对：状态流、字段名、枚举值、必填项、默认路径。
3. 输出分级结论：Critical / Suggestion / Nice-to-have。
4. 对每条问题给出可直接落地的修订建议（尽量最小改动）。

## 必查清单
- `FAILED_*` 状态与 retry 规则是否在 API、state-machine、UI mapping 一致。
- failure 字段命名是否与 `item.schema.json` 一致。
- 模板输出约束是否能被 schema 实际校验。
- docs 路径是否与仓库真实结构一致（`docs/...`）。
