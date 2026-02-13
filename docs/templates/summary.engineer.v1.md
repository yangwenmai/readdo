# Template: summary.engineer.v1
Purpose: Produce a concise, actionable summary aligned with the user's intent.
Output: JSON ONLY (must satisfy docs/contracts/schemas/summary.schema.json)

## Inputs
- intent_text (string)
- extracted_text (string)

## Rules
- Do NOT invent facts. Use only extracted_text.
- bullets: 3–5 short, factual takeaways, non-redundant.
- insight: 1 sentence that connects the content to intent_text (or a generalizable principle).
- evidence (optional): up to 3 short quotes that support key bullets/insight; keep privacy-friendly.

## Output JSON Schema (shape)
{
  "bullets": ["...", "...", "..."],
  "insight": "...",
  "evidence": [{"quote":"...", "source_hint":"..."}]
}

## Generate
Given:
- intent_text: {{intent_text}}
- extracted_text: {{extracted_text}}

Return JSON only.
