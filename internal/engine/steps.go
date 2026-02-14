package engine

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
	"github.com/yangwenmai/readdo/internal/model"
)

// ---------------------------------------------------------------------------
// Step 1: Extract
// ---------------------------------------------------------------------------

func (p *Pipeline) runExtract(ctx context.Context, item *model.Item) (*ExtractedContent, error) {
	content, err := p.extractor.Extract(ctx, item.URL)
	if err != nil {
		return nil, err
	}

	payload, _ := json.Marshal(content)
	artifact := model.NewArtifact(uuid.New().String(), item.ID, model.ArtifactExtraction, string(payload))
	if err := p.store.UpsertArtifact(artifact); err != nil {
		return nil, err
	}
	return content, nil
}

// ---------------------------------------------------------------------------
// Step 2: Summarize
// ---------------------------------------------------------------------------

func (p *Pipeline) runSummarize(ctx context.Context, item *model.Item, extraction *ExtractedContent) (*SummaryResult, error) {
	prompt := buildSummarizePrompt(extraction.NormalizedText, item.IntentText)
	raw, err := p.model.Complete(ctx, prompt)
	if err != nil {
		return nil, err
	}

	var result SummaryResult
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		return nil, err
	}

	payload, _ := json.Marshal(result)
	artifact := model.NewArtifact(uuid.New().String(), item.ID, model.ArtifactSummary, string(payload))
	if err := p.store.UpsertArtifact(artifact); err != nil {
		return nil, err
	}
	return &result, nil
}

// ---------------------------------------------------------------------------
// Step 3: Score
// ---------------------------------------------------------------------------

func (p *Pipeline) runScore(ctx context.Context, item *model.Item, summary *SummaryResult, extraction *ExtractedContent) (*ScoreResult, error) {
	prompt := buildScorePrompt(item.IntentText, summary, extraction)
	raw, err := p.model.Complete(ctx, prompt)
	if err != nil {
		return nil, err
	}

	var result ScoreResult
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		return nil, err
	}

	payload, _ := json.Marshal(result)
	artifact := model.NewArtifact(uuid.New().String(), item.ID, model.ArtifactScore, string(payload))
	if err := p.store.UpsertArtifact(artifact); err != nil {
		return nil, err
	}
	return &result, nil
}

// ---------------------------------------------------------------------------
// Step 4: Todo
// ---------------------------------------------------------------------------

func (p *Pipeline) runTodo(ctx context.Context, item *model.Item, summary *SummaryResult, score *ScoreResult) (*TodosResult, error) {
	prompt := buildTodoPrompt(item.IntentText, summary, score)
	raw, err := p.model.Complete(ctx, prompt)
	if err != nil {
		return nil, err
	}

	var result TodosResult
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		return nil, err
	}

	payload, _ := json.Marshal(result)
	artifact := model.NewArtifact(uuid.New().String(), item.ID, model.ArtifactTodos, string(payload))
	if err := p.store.UpsertArtifact(artifact); err != nil {
		return nil, err
	}
	return &result, nil
}
