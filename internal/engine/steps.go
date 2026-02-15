package engine

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/yangwenmai/readdo/internal/model"
)

// ---------------------------------------------------------------------------
// Helper: run an LLM step and persist the result as an artifact.
// ---------------------------------------------------------------------------

func runLLMStep[T any](ctx context.Context, mc ModelClient, as ArtifactStore, itemID, artifactType, prompt string) (*T, error) {
	raw, err := mc.Complete(ctx, prompt)
	if err != nil {
		return nil, err
	}

	var result T
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		return nil, fmt.Errorf("unmarshal %s: %w", artifactType, err)
	}

	payload, err := json.Marshal(result)
	if err != nil {
		return nil, fmt.Errorf("marshal %s artifact: %w", artifactType, err)
	}

	artifact := model.NewArtifact(uuid.New().String(), itemID, artifactType, string(payload))
	if err := as.UpsertArtifact(ctx, artifact); err != nil {
		return nil, err
	}
	return &result, nil
}

// ---------------------------------------------------------------------------
// Step 1: Extract
// ---------------------------------------------------------------------------

// ExtractStep fetches and extracts web content.
type ExtractStep struct {
	Extractor ContentExtractor
	Artifacts ArtifactStore
}

func (s *ExtractStep) Name() string { return "extract" }

func (s *ExtractStep) Run(ctx context.Context, sc *StepContext) error {
	content, err := s.Extractor.Extract(ctx, sc.Item.URL)
	if err != nil {
		return err
	}

	payload, err := json.Marshal(content)
	if err != nil {
		return fmt.Errorf("marshal extraction artifact: %w", err)
	}

	artifact := model.NewArtifact(uuid.New().String(), sc.Item.ID, model.ArtifactExtraction, string(payload))
	if err := s.Artifacts.UpsertArtifact(ctx, artifact); err != nil {
		return err
	}

	sc.Extraction = content
	return nil
}

// ---------------------------------------------------------------------------
// Step 2: Summarize
// ---------------------------------------------------------------------------

// SummarizeStep generates a summary using an LLM.
type SummarizeStep struct {
	Model     ModelClient
	Artifacts ArtifactStore
}

func (s *SummarizeStep) Name() string { return "summarize" }

func (s *SummarizeStep) Run(ctx context.Context, sc *StepContext) error {
	prompt := buildSummarizePrompt(sc.Extraction.NormalizedText, sc.Item.IntentText)
	result, err := runLLMStep[SummaryResult](ctx, s.Model, s.Artifacts, sc.Item.ID, model.ArtifactSummary, prompt)
	if err != nil {
		return err
	}
	sc.Summary = result
	return nil
}

// ---------------------------------------------------------------------------
// Step 3: Score
// ---------------------------------------------------------------------------

// ScoreStep scores content relevance using an LLM.
type ScoreStep struct {
	Model     ModelClient
	Artifacts ArtifactStore
	Scores    ItemScoreUpdater
}

func (s *ScoreStep) Name() string { return "score" }

func (s *ScoreStep) Run(ctx context.Context, sc *StepContext) error {
	prompt := buildScorePrompt(sc.Item.IntentText, sc.Summary, sc.Extraction)
	result, err := runLLMStep[ScoreResult](ctx, s.Model, s.Artifacts, sc.Item.ID, model.ArtifactScore, prompt)
	if err != nil {
		return err
	}

	// Persist the score and priority on the item itself.
	if err := s.Scores.UpdateItemScoreAndPriority(ctx, sc.Item.ID, result.MatchScore, result.Priority); err != nil {
		return err
	}

	sc.Score = result
	return nil
}

// ---------------------------------------------------------------------------
// Step 4: Todo
// ---------------------------------------------------------------------------

// TodoStep generates actionable TODO items using an LLM.
type TodoStep struct {
	Model     ModelClient
	Artifacts ArtifactStore
}

func (s *TodoStep) Name() string { return "todo" }

func (s *TodoStep) Run(ctx context.Context, sc *StepContext) error {
	prompt := buildTodoPrompt(sc.Item.IntentText, sc.Summary, sc.Score)
	result, err := runLLMStep[TodosResult](ctx, s.Model, s.Artifacts, sc.Item.ID, model.ArtifactTodos, prompt)
	if err != nil {
		return err
	}
	sc.Todos = result
	return nil
}
