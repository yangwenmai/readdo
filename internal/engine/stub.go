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
	if strings.Contains(prompt, "阅读顾问") {
		result := SynthesisResult{
			Points: []string{
				"[Stub] 文章介绍了关键的架构决策——这直接回应了你对技术选型的关注，可以帮你避免常见的设计陷阱。",
				"[Stub] 提供了基于真实项目的实践模式——你可以将这些模式与当前项目对比，快速判断适用性。",
				"[Stub] 包含性能基准测试数据——为你正在做的技术决策提供了客观的数据支撑。",
			},
			Insight: "这篇文章的独特价值在于：用真实案例证明了简单方案的优越性，正好回应了你对架构取舍的关切。",
		}
		b, _ := json.Marshal(result)
		return string(b), nil
	}

	if strings.Contains(prompt, "内容评估") {
		result := ScoreResult{
			IntentScore:  78,
			QualityScore: 88,
			FinalScore:   82,
			Priority:     "DO_FIRST",
		}
		b, _ := json.Marshal(result)
		return string(b), nil
	}

	if strings.Contains(prompt, "任务规划") {
		result := TodosResult{
			Todos: []TodoItem{
				{Title: "阅读文章核心章节，理解主要观点", ETA: "20m", Type: "READ"},
				{Title: "对比文章方案与当前项目的异同", ETA: "30m", Type: "READ"},
				{Title: "提取可复用的设计模式，整理为笔记", ETA: "30m", Type: "WRITE"},
				{Title: "撰写总结分享给团队", ETA: "45m", Type: "SHARE"},
			},
		}
		b, _ := json.Marshal(result)
		return string(b), nil
	}

	return "{}", nil
}
