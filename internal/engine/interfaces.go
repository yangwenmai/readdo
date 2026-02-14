package engine

import "context"

// ModelClient abstracts LLM calls. Implementations can wrap OpenAI, local models, etc.
type ModelClient interface {
	Complete(ctx context.Context, prompt string) (string, error)
}

// ContentExtractor abstracts web content extraction.
type ContentExtractor interface {
	Extract(ctx context.Context, url string) (*ExtractedContent, error)
}

// ExtractedContent holds the result of content extraction.
type ExtractedContent struct {
	NormalizedText string       `json:"normalized_text"`
	Meta           ContentMeta  `json:"content_meta"`
}

// ContentMeta holds metadata about the extracted content.
type ContentMeta struct {
	Author      string `json:"author,omitempty"`
	PublishDate string `json:"publish_date,omitempty"`
	WordCount   int    `json:"word_count"`
}

// SummaryResult is the structured output of the summarize step.
type SummaryResult struct {
	Bullets []string `json:"bullets"`
	Insight string   `json:"insight"`
}

// ScoreResult is the structured output of the score step.
type ScoreResult struct {
	MatchScore float64  `json:"match_score"`
	Priority   string   `json:"priority"`
	Reasons    []string `json:"reasons"`
}

// TodoItem represents a single actionable task.
type TodoItem struct {
	Title string `json:"title"`
	ETA   string `json:"eta"`
	Type  string `json:"type"`
}

// TodosResult is the structured output of the todo step.
type TodosResult struct {
	Todos []TodoItem `json:"todos"`
}
