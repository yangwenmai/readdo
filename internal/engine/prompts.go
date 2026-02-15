package engine

import (
	"encoding/json"
	"fmt"
	"unicode/utf8"
)

func buildSummarizePrompt(text, intent string) string {
	return fmt.Sprintf(`You are a reading assistant. Summarize the following article for a user whose intent is: "%s"

Output ONLY valid JSON with this exact structure (no markdown, no explanation):
{"bullets": ["point 1", "point 2", "point 3"], "insight": "one key insight sentence"}

Rules:
- Exactly 3 bullet points, each 1-2 sentences
- 1 insight that connects to the user's intent
- Keep it concise and actionable

Article text:
%s`, intent, truncateRunes(text, 12000))
}

func buildScorePrompt(intent string, summary *SummaryResult, extraction *ExtractedContent) string {
	summaryJSON := mustJSON(summary)
	return fmt.Sprintf(`You are a content relevance scorer. Rate how well this article matches the user's intent.

User intent: "%s"
Summary: %s
Word count: %d

Output ONLY valid JSON with this exact structure:
{"match_score": 75, "priority": "WORTH_IT", "reasons": ["reason 1", "reason 2", "reason 3"]}

Rules:
- match_score: integer 0-100
- priority: one of "READ_NEXT" (>=80), "WORTH_IT" (60-79), "IF_TIME" (40-59), "SKIP" (<40)
- reasons: at least 3 reasons explaining the score, referencing the intent or content
- Be specific, not generic`, intent, summaryJSON, extraction.Meta.WordCount)
}

func buildTodoPrompt(intent string, summary *SummaryResult, score *ScoreResult) string {
	summaryJSON := mustJSON(summary)
	return fmt.Sprintf(`You are a task planner. Create actionable TODO items for a user who saved this article.

User intent: "%s"
Priority: %s
Summary: %s

Output ONLY valid JSON with this exact structure:
{"todos": [{"title": "Read the section on X", "eta": "20m", "type": "READ"}, ...]}

Rules:
- 3 to 7 TODO items
- Each title starts with a verb (Read, Write, Compare, Summarize, etc.)
- eta: one of "10m", "20m", "30m", "45m", "1h", "2h", "3h+"
- type: one of "READ", "WRITE", "BUILD", "SHARE"
- At least 1 item must be type "WRITE" or "SHARE" (output-oriented task)
- Align tasks with the user's intent`, intent, score.Priority, summaryJSON)
}

// truncateRunes truncates s to maxRunes runes (Unicode-safe).
func truncateRunes(s string, maxRunes int) string {
	if utf8.RuneCountInString(s) <= maxRunes {
		return s
	}
	runes := []rune(s)
	return string(runes[:maxRunes]) + "\n... [truncated]"
}

// mustJSON marshals v to a JSON string. It panics on error because callers
// only pass known struct types that are guaranteed to be serializable.
func mustJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		panic(fmt.Sprintf("engine: json.Marshal failed on known type: %v", err))
	}
	return string(b)
}
