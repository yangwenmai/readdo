# Template: score.v1
Purpose: Score the match between content and user's intent, and decide priority with explainable reasons.
Output: JSON ONLY (must satisfy docs/contracts/schemas/score.schema.json)

## Inputs
- intent_text (string)
- extracted_text (string)
- summary (JSON from summary schema)  // optional but recommended

## Hard Rules
- Return JSON only.
- match_score must be 0..100 (number).
- priority must be one of: READ_NEXT, WORTH_IT, IF_TIME, SKIP
- reasons must be 3..6 items.
- Reasons MUST be specific and grounded in extracted_text and/or summary; do NOT use generic praise.
- Priority must align with score buckets:
  - READ_NEXT: >= 80
  - WORTH_IT: 60-79.999
  - IF_TIME: 40-59.999
  - SKIP: < 40
  (If unsure, prefer the lower bucket.)

## Guidance (to produce non-generic reasons)
At least 2 reasons should reference one of:
- A keyword/constraint from intent_text
- A concrete feature of the content: steps, checklist, template, comparison, data, example
- Effort/value tradeoff: time cost, depth required, immediate applicability

Optional: provide confidence (0..1) and signals breakdown.

## Output JSON Shape
{
  "match_score": 72.5,
  "priority": "WORTH_IT",
  "reasons": [
    "Reason 1 ...",
    "Reason 2 ...",
    "Reason 3 ..."
  ],
  "confidence": 0.74,
  "signals": {
    "intent_match": 75,
    "content_signal": 70,
    "novelty": 40,
    "effort_fit": 65
  }
}

## Generate
intent_text: {{intent_text}}
extracted_text: {{extracted_text}}
summary: {{summary_json}}

Return JSON only.
