package engine

import (
	"context"
	"errors"
	"testing"

	"github.com/yangwenmai/readdo/internal/model"
)

// mockArtifactStore records all upserted artifacts.
type mockArtifactStore struct {
	artifacts []model.Artifact
}

func (m *mockArtifactStore) UpsertArtifact(_ context.Context, a model.Artifact) error {
	m.artifacts = append(m.artifacts, a)
	return nil
}

// mockScoreUpdater records score update calls.
type mockScoreUpdater struct {
	calls []scoreCall
}

type scoreCall struct {
	ID       string
	Score    float64
	Priority string
}

func (m *mockScoreUpdater) UpdateItemScoreAndPriority(_ context.Context, id string, score float64, priority string) error {
	m.calls = append(m.calls, scoreCall{ID: id, Score: score, Priority: priority})
	return nil
}

func TestPipeline_FullRun(t *testing.T) {
	as := &mockArtifactStore{}
	su := &mockScoreUpdater{}
	stub := &StubModelClient{}
	extractor := &StubExtractor{}

	pipeline := NewPipeline(
		&ExtractStep{Extractor: extractor, Artifacts: as},
		&SummarizeStep{Model: stub, Artifacts: as},
		&ScoreStep{Model: stub, Artifacts: as, Scores: su},
		&TodoStep{Model: stub, Artifacts: as},
	)

	item := &model.Item{
		ID:         "item-1",
		URL:        "https://example.com/article",
		IntentText: "learn Go patterns",
		SaveCount:  1,
	}

	err := pipeline.Run(context.Background(), item)
	if err != nil {
		t.Fatalf("Pipeline.Run: %v", err)
	}

	// 4 steps should produce 4 artifacts (extraction, summary, score, todos).
	if len(as.artifacts) != 4 {
		t.Errorf("artifacts count = %d, want 4", len(as.artifacts))
	}

	types := map[string]bool{}
	for _, a := range as.artifacts {
		types[a.ArtifactType] = true
	}
	for _, expected := range []string{model.ArtifactExtraction, model.ArtifactSummary, model.ArtifactScore, model.ArtifactTodos} {
		if !types[expected] {
			t.Errorf("missing artifact type %q", expected)
		}
	}

	// Score should have been persisted.
	if len(su.calls) != 1 {
		t.Fatalf("score update calls = %d, want 1", len(su.calls))
	}
	if su.calls[0].ID != "item-1" {
		t.Errorf("score update ID = %q, want %q", su.calls[0].ID, "item-1")
	}
}

// failingStep always returns an error.
type failingStep struct {
	name string
}

func (s *failingStep) Name() string { return s.name }
func (s *failingStep) Run(_ context.Context, _ *StepContext) error {
	return errors.New("intentional failure")
}

func TestPipeline_StepError(t *testing.T) {
	pipeline := NewPipeline(
		&failingStep{name: "bad-step"},
	)

	item := &model.Item{ID: "item-1", SaveCount: 1}
	err := pipeline.Run(context.Background(), item)
	if err == nil {
		t.Fatal("expected error")
	}

	var se *StepError
	if !errors.As(err, &se) {
		t.Fatalf("error is not *StepError: %T", err)
	}
	if se.StepName() != "bad-step" {
		t.Errorf("StepName = %q, want %q", se.StepName(), "bad-step")
	}
}

func TestPipeline_StopsOnFirstError(t *testing.T) {
	as := &mockArtifactStore{}
	extractor := &StubExtractor{}

	pipeline := NewPipeline(
		&ExtractStep{Extractor: extractor, Artifacts: as},
		&failingStep{name: "fail-step"},
		&SummarizeStep{Model: &StubModelClient{}, Artifacts: as},
	)

	item := &model.Item{
		ID:         "item-1",
		URL:        "https://example.com",
		IntentText: "test",
		SaveCount:  1,
	}

	err := pipeline.Run(context.Background(), item)
	if err == nil {
		t.Fatal("expected error from failing step")
	}

	// Only extraction artifact should be saved (step before the failure).
	if len(as.artifacts) != 1 {
		t.Errorf("artifacts count = %d, want 1 (only extraction)", len(as.artifacts))
	}
}

func TestStepError_Unwrap(t *testing.T) {
	inner := errors.New("root cause")
	se := &StepError{Step: "extract", Err: inner}

	if se.Error() != "extract: root cause" {
		t.Errorf("Error() = %q", se.Error())
	}
	if !errors.Is(se, inner) {
		t.Error("Unwrap should make inner error accessible via errors.Is")
	}
}
