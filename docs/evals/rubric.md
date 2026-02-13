# Read→Do Eval Rubric（MVP）
Location: docs/evals/rubric.md
Version: 0.1
Last Updated: 2026-02-13

---

## 0. 输入/输出约定

每个 case 提供：
- intent_text
- extracted_text
- (optional) source_type、title

Runner 生成 artifacts：
- summary (schema: summary.schema.json)
- score (schema: score.schema.json)
- todos (schema: todos.schema.json)
- card (schema: card.schema.json)

---

## 1. P0 断言（必须全部通过）

### P0-1 Schema Valid
- summary/score/todos/card payload 必须通过各自 JSON Schema 校验。

### P0-2 Score Reasons Count
- score.reasons.length >= 3

### P0-3 Priority Range Consistency
priority 与 match_score 的区间一致：
- READ_NEXT: score >= 80
- WORTH_IT: 60..79.999
- IF_TIME: 40..59.999
- SKIP: < 40

允许浮点边界误差：±0.5

### P0-4 Todos Count & ETA
- todos.todos.length 在 [3, 7]
- 每条 todo 必须包含 `eta`
- 每条 todo.title 非空且长度 >= 8

### P0-5 Card Points
- card.points.length == 3
- headline/insight/action 非空

---

## 2. P1 断言（必须全部通过，除非你明确降级）

### P1-1 Reasons Non-Generic
对 reasons 做“反泛化”检查（启发式）：
- 不得全部落入泛化句式（例如：很有用、值得一读、信息量大、讲得很好）
- 至少 2 条 reasons 应包含具体线索（以下任意之一）：
  - 引用 intent 的关键词/短语（例如 intent 中的“架构/落地/复盘/提效”等）
  - 提及内容结构特征（例如“给出步骤/对比/框架/数据/清单/示例”）
  - 提及代价与收益（例如“20 分钟可读完/适合快速实践/需要较深背景”）

### P1-2 Todo Verb-led Heuristic
每条 todo.title 应以动词开头（启发式）：
- 允许英文动词或中文动词
- 至少 2 条是“产出型/行动型”：WRITE/SHARE/BUILD/DECIDE 等（若类型缺失，可用关键词启发式：写/发/整理/实现/对比/制定）

### P1-3 Card Action Specificity
card.action 不应过于空泛（启发式）：
- 不应只是“去做/去试试/去看看”
- 应包含一个明确对象或动作（例如“写一段对比说明/列 3 条 TODO/实现一个小原型”）

---

## 3. P2 断言（可容忍少量失败）

### P2-1 Summary Bullets Non-Redundant
bullets 不应高度重复（启发式：Jaccard/关键词重叠过高）

### P2-2 Insight Adds Value
insight 不应只是 bullets 的同义复述（启发式：过多重复词）

### P2-3 Card Headline Specific
headline 不应完全泛化（例如“关于效率的思考”）

---

## 4. 评估输出建议

Runner 输出：
- 每个 case 的 pass/fail
- 失败项标注 P0/P1/P2
- 输出简短 diff（例如 reasons 过泛化的具体原因）

---
