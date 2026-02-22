package engine

import (
	"context"

	"github.com/yangwenmai/readdo/internal/model"
)

// ModelClient abstracts LLM calls. Implementations can wrap OpenAI, local models, etc.
type ModelClient interface {
	Complete(ctx context.Context, prompt string) (string, error)
}

// ContentExtractor abstracts web content extraction.
type ContentExtractor interface {
	Extract(ctx context.Context, url string) (*ExtractedContent, error)
}

// ArtifactStore abstracts artifact persistence so that the engine package
// does not depend on the store package directly.
type ArtifactStore interface {
	UpsertArtifact(ctx context.Context, a model.Artifact) error
}

// ItemScoreUpdater abstracts updating the AI-derived score and priority on an item.
type ItemScoreUpdater interface {
	UpdateItemScoreAndPriority(ctx context.Context, id string, score float64, priority string) error
}

// ExtractedContent holds the result of content extraction.
type ExtractedContent struct {
	NormalizedText string      `json:"normalized_text"`
	Meta           ContentMeta `json:"content_meta"`
}

// ContentMeta holds metadata about the extracted content.
type ContentMeta struct {
	Author      string `json:"author,omitempty"`
	PublishDate string `json:"publish_date,omitempty"`
	WordCount   int    `json:"word_count"`
	ImageURL    string `json:"image_url,omitempty"`
	Language    string `json:"language,omitempty"`
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

// StepContext carries data between pipeline steps.
// Each step reads inputs from previous steps and writes its own output.
type StepContext struct {
	Item       *model.Item
	SaveCount  int // how many times this URL has been saved; used as a scoring boost signal
	Extraction *ExtractedContent
	Summary    *SummaryResult
	Score      *ScoreResult
	Todos      *TodosResult
}

// Step represents a single pipeline processing step.
type Step interface {
	Name() string
	Run(ctx context.Context, sc *StepContext) error
}
