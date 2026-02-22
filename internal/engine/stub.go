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
	if strings.Contains(prompt, "阅读助手") {
		result := SummaryResult{
			Bullets: []string{
				"文章介绍了关键的架构决策和技术取舍方案。",
				"提供了基于真实项目的实践模式和具体实现细节。",
				"包含性能基准测试数据，证明了新方案相比旧方案的显著提升。",
			},
			Insight: "核心启示：经过充分测试的简单方案，往往比过度设计的复杂方案表现更好。",
		}
		b, _ := json.Marshal(result)
		return string(b), nil
	}

	if strings.Contains(prompt, "相关性评估") {
		result := ScoreResult{
			MatchScore: 82,
			Priority:   "READ_NEXT",
			Reasons: []string{
				"[Stub] 文章内容与用户意图高度相关，提供了可直接应用的解决方案。",
				"[Stub] 包含具体的实现步骤和代码示例，不仅是理论讨论。",
				"[Stub] 附带真实的性能数据，有助于做出技术决策。",
			},
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
