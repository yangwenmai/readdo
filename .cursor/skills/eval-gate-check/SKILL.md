---
name: eval-gate-check
description: 检查 Evals 门禁定义是否可执行且互相一致，覆盖 cases 路径、CLI 默认参数、P0/P1/P2 阈值与断言语义。用于 eval 规范评审、质量门禁调整、CI 准入检查；检测到 eval/rubric/runner 任务时应主动应用。
---

# Eval Gate Check

## 检查范围
- `docs/05-Quality-Evals.md`
- `docs/06-eval-runner-spec.md`
- `docs/evals/rubric.md`
- `docs/evals/cases/*.json`（存在性与规模）

## 核查步骤
1. 校验路径：cases/rubric/reports 是否都指向 `docs/evals/...`。
2. 校验门禁：P0/P1 是否“必须通过”，P2 容忍度是否一致。
3. 校验断言：schema、reasons、priority、todos、card 的规则是否互相兼容。
4. 标注缺口：有规则但无 case 覆盖、或有 case 但无规则承接。

## 输出格式
- Critical：会导致门禁误判或无法执行。
- Suggestion：会导致歧义或成本上升。
- Next step：建议补的最小 case 或文档项。
