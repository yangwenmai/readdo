# Template: todos.v1
Purpose: Turn reading into executable actions (Read→Do).
Output: JSON ONLY (must satisfy docs/contracts/schemas/todos.schema.json)

## Inputs
- intent_text (string)
- summary (JSON from summary schema)
- score (JSON from score schema)

## Rules
- todos count: 3–7
- Each todo.title must start with an imperative verb (e.g., Draft, Skim, Compare, Extract, Implement / 写、整理、对比、实现、制定).
- Each todo must include eta from: 10m, 20m, 30m, 45m, 1h, 2h, 3h+
- At least ONE todo should be output-oriented: type in {WRITE, SHARE, BUILD, DECIDE}
- Avoid vague items like “Learn more” / “看看就好” / “了解一下”.
- Keep todo titles crisp; put rationale in `why` if needed.

## Output JSON Schema (shape)
{
  "todos": [
    {"title":"...", "eta":"30m", "type":"READ", "why":"..."},
    {"title":"...", "eta":"1h", "type":"WRITE", "why":"..."}
  ]
}

## Generate
Given:
- intent_text: {{intent_text}}
- summary: {{summary_json}}
- score: {{score_json}}

Return JSON only.
