# Template: card.v1
Purpose: Create a shareable content card that ships an output.
Output: JSON ONLY (must satisfy docs/contracts/schemas/card.schema.json)

## Inputs
- intent_text (string)
- summary (JSON)
- todos (JSON)
- score (JSON)
- title (optional string)
- domain (optional string)

## Rules
- headline: 10–90 chars, specific (avoid generic headlines).
- points: EXACTLY 3 points; each concise, non-redundant.
- insight: 1 sentence, higher-level takeaway.
- action: 1 sentence, specific next action (not vague).
- render_spec: must be present; use HTML_V1; include content duplicated inside render_spec.payload.content for deterministic rendering.
- watermark: use "Read→Do" (MVP default).
- layout.variant: use CARD_4x5_V1 (default), theme: LIGHT (default).

## Output JSON Schema (shape)
{
  "headline": "...",
  "points": ["...", "...", "..."],
  "insight": "...",
  "action": "...",
  "hashtags": ["#..."],
  "caption": "...",
  "render_spec": {
    "format": "HTML_V1",
    "width": 1080,
    "height": 1350,
    "theme": "LIGHT",
    "payload": {
      "brand": {"watermark":"Read→Do"},
      "layout": {"variant":"CARD_4x5_V1","padding":48},
      "content": {
        "headline":"...",
        "points":["...","...","..."],
        "insight":"...",
        "action":"..."
      }
    }
  }
}

## Generate
Given:
- intent_text: {{intent_text}}
- summary: {{summary_json}}
- todos: {{todos_json}}
- score: {{score_json}}
- title: {{title}}
- domain: {{domain}}

Return JSON only.
