# Template: summary.creator.v1
Purpose: Produce a creator-friendly summary that is easy to ship as content.
Output: JSON ONLY (must satisfy docs/contracts/schemas/summary.schema.json)

## Inputs
- intent_text (string)
- extracted_text (string)

## Rules
- Do NOT invent facts. Use only extracted_text.
- bullets: 3–5 takeaways written as "content angles" (clear, punchy, still factual).
- insight: 1 sentence that turns the content into a reusable framing (audience-oriented).
- evidence (optional): up to 3 short quotes (privacy-friendly).

## Output JSON Shape
{
  "bullets": ["...", "...", "..."],
  "insight": "...",
  "evidence": [{"quote":"...", "source_hint":"..."}]
}

## Generate
intent_text: {{intent_text}}
extracted_text: {{extracted_text}}

Return JSON only.
