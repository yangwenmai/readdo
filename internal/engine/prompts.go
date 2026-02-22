package engine

import (
	"encoding/json"
	"fmt"
	"unicode/utf8"
)

func buildSummarizePrompt(text, intent string) string {
	return fmt.Sprintf(`你是一位专业的阅读助手。请根据用户的阅读意图，对以下文章进行总结。

用户的阅读意图："%s"

请仅输出合法的 JSON（不要 markdown、不要额外解释），结构如下：
{"bullets": ["要点1", "要点2", "要点3"], "insight": "一句话核心洞察"}

规则：
- 恰好 3 个要点（bullets），每个 1-2 句话，需紧扣文章核心内容
- 1 条洞察（insight），必须将文章内容与用户的阅读意图关联起来
- 使用中文输出
- 保持简洁、可操作

文章内容：
%s`, intent, truncateRunes(text, 12000))
}

func buildScorePrompt(intent string, summary *SummaryResult, extraction *ExtractedContent, saveCount int) string {
	summaryJSON := mustJSON(summary)
	saveCountHint := ""
	if saveCount > 1 {
		saveCountHint = fmt.Sprintf(`
- 重要：这篇文章被用户保存了 %d 次（带有不同的意图），表明用户对此非常感兴趣。请在基础分数上加 %d 分（上限 100 分）。`, saveCount, min(saveCount*5, 20))
	}
	return fmt.Sprintf(`你是一位内容相关性评估专家。请评估这篇文章与用户阅读意图的匹配程度。

用户的阅读意图："%s"
文章摘要：%s
字数：%d
保存次数：%d

请仅输出合法的 JSON（不要 markdown、不要额外解释），结构如下：
{"match_score": 75, "priority": "WORTH_IT", "reasons": ["原因1", "原因2", "原因3"]}

规则：
- match_score：0-100 的整数
- priority：根据分数选择 "READ_NEXT"（≥80）、"WORTH_IT"（60-79）、"IF_TIME"（40-59）、"SKIP"（<40）
- reasons：至少 3 条中文理由，解释为什么这篇文章值得/不值得阅读
- 每条理由必须具体引用文章内容或用户意图，不要泛泛而谈
- 理由应回答"为什么我现在应该读这篇文章"这个问题%s`, intent, summaryJSON, extraction.Meta.WordCount, saveCount, saveCountHint)
}

func buildTodoPrompt(intent string, summary *SummaryResult, score *ScoreResult) string {
	summaryJSON := mustJSON(summary)
	return fmt.Sprintf(`你是一位任务规划专家。请为保存了这篇文章的用户创建可执行的待办事项。

用户的阅读意图："%s"
文章优先级：%s
文章摘要：%s

请仅输出合法的 JSON（不要 markdown、不要额外解释），结构如下：
{"todos": [{"title": "阅读关于 X 的章节", "eta": "20m", "type": "READ"}, ...]}

规则：
- 3 到 7 个待办事项
- 每个标题以动词开头（阅读、总结、对比、实践、分享、记录、搜索等）
- eta：从 "10m"、"20m"、"30m"、"45m"、"1h"、"2h"、"3h+" 中选择
- type：从 "READ"、"WRITE"、"BUILD"、"SHARE" 中选择
- 至少 1 个事项的 type 必须是 "WRITE" 或 "SHARE"（输出导向型任务）
- 所有任务必须与用户的阅读意图和文章实际内容紧密结合
- 使用中文输出`, intent, score.Priority, summaryJSON)
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
