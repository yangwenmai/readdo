package engine

import (
	"context"
	"encoding/json"
	"strings"
)

// StubExtractor returns mock extraction results (for development/testing).
type StubExtractor struct{}

func (e *StubExtractor) Extract(_ context.Context, url string) (*ExtractedContent, error) {
	return &ExtractedContent{
		NormalizedText: "This is a stub extracted article about " + url + ". It contains useful information about software engineering, system design, and best practices.",
		Meta: ContentMeta{
			Author:    "Stub Author",
			WordCount: 1500,
		},
	}, nil
}

// StubModelClient returns mock LLM responses (for development/testing).
type StubModelClient struct{}

func (m *StubModelClient) Complete(_ context.Context, prompt string) (string, error) {
	// Detect which step is calling based on prompt content.
	if strings.Contains(prompt, "Summarize the following") {
		result := SummaryResult{
			Bullets: []string{
				"The article covers key architectural decisions and trade-offs.",
				"It presents practical implementation patterns with real-world examples.",
				"Performance benchmarks show significant improvements over previous approaches.",
			},
			Insight: "The core insight is that simple, well-tested patterns consistently outperform complex over-engineered solutions.",
		}
		b, _ := json.Marshal(result)
		return string(b), nil
	}

	if strings.Contains(prompt, "content relevance scorer") {
		result := ScoreResult{
			MatchScore: 82,
			Priority:   "READ_NEXT",
			Reasons: []string{
				"Directly relevant to the user's interest in system design patterns.",
				"Contains actionable implementation details, not just theory.",
				"Includes performance data that can inform real decisions.",
			},
		}
		b, _ := json.Marshal(result)
		return string(b), nil
	}

	if strings.Contains(prompt, "task planner") {
		result := TodosResult{
			Todos: []TodoItem{
				{Title: "Read the architecture overview section", ETA: "20m", Type: "READ"},
				{Title: "Compare the proposed patterns with current system", ETA: "30m", Type: "READ"},
				{Title: "Extract reusable design patterns into notes", ETA: "30m", Type: "WRITE"},
				{Title: "Write a summary for the team", ETA: "45m", Type: "SHARE"},
			},
		}
		b, _ := json.Marshal(result)
		return string(b), nil
	}

	return "{}", nil
}
