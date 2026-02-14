package engine

import (
	"context"

	"github.com/yangwenmai/readdo/internal/model"
	"github.com/yangwenmai/readdo/internal/store"
)

// Pipeline orchestrates the execution of all processing steps for an item.
type Pipeline struct {
	store     *store.Store
	extractor ContentExtractor
	model     ModelClient
}

// NewPipeline creates a pipeline with the given dependencies.
func NewPipeline(s *store.Store, extractor ContentExtractor, mc ModelClient) *Pipeline {
	return &Pipeline{store: s, extractor: extractor, model: mc}
}

// Run executes all pipeline steps for the given item.
// On success it saves all artifacts and returns nil.
// On failure it returns a *StepError indicating which step failed.
func (p *Pipeline) Run(ctx context.Context, item *model.Item) error {
	// Step 1: Extract
	extraction, err := p.runExtract(ctx, item)
	if err != nil {
		return &StepError{Step: "extract", Err: err}
	}

	// Step 2: Summarize
	summary, err := p.runSummarize(ctx, item, extraction)
	if err != nil {
		return &StepError{Step: "summarize", Err: err}
	}

	// Step 3: Score
	score, err := p.runScore(ctx, item, summary, extraction)
	if err != nil {
		return &StepError{Step: "score", Err: err}
	}

	// Step 4: Todos
	_, err = p.runTodo(ctx, item, summary, score)
	if err != nil {
		return &StepError{Step: "todo", Err: err}
	}

	// Update item score/priority from the score result.
	if err := p.store.UpdateItemScoreAndPriority(item.ID, score.MatchScore, score.Priority); err != nil {
		return &StepError{Step: "score_update", Err: err}
	}

	return nil
}

// StepError wraps an error with the step name that failed.
type StepError struct {
	Step string
	Err  error
}

func (e *StepError) Error() string {
	return e.Step + ": " + e.Err.Error()
}

func (e *StepError) Unwrap() error {
	return e.Err
}
