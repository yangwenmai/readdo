package engine

import (
	"encoding/json"
	"fmt"
	"unicode/utf8"
)

func buildSynthesisPrompt(text, intent string) string {
	return fmt.Sprintf(`你是一位专业的阅读顾问。用户保存了一篇文章，并留下了阅读意图。请以用户的意图为锚点，从文章中提取对用户最有价值的内容。

用户的阅读意图："%s"

请仅输出合法的 JSON（不要 markdown、不要额外解释），结构如下：
{"points": ["要点1", "要点2", "要点3"], "insight": "一句话核心洞察"}

规则：
- 恰好 3 个要点（points），每个 1-2 句话
- 每个要点必须同时说明「文章讲了什么」和「这对用户意味着什么」，而不是单纯的文章摘要
- 要点的筛选标准是「与用户意图的相关性」，而非文章自身的重要性排序
- 1 条洞察（insight）：用一句话说明这篇文章对用户最独特的价值
- 特殊情况：如果文章质量很高（内容深度、权威性、原创性突出）但与用户意图关联度不强，请在 insight 中主动提示，例如"这篇文章与你的意图关联度不高，但它在 X 领域的深度值得一看"
- 使用中文输出
- 保持简洁、可操作

文章内容：
%s`, intent, truncateRunes(text, 12000))
}

func buildScorePrompt(intent string, synthesis *SynthesisResult, extraction *ExtractedContent, saveCount int) string {
	synthesisJSON := mustJSON(synthesis)
	saveCountHint := ""
	if saveCount > 1 {
		saveCountHint = fmt.Sprintf(`
- 重要：这篇文章被用户保存了 %d 次（带有不同的意图），表明用户对此非常感兴趣。请在 intent_score 基础上加 %d 分（上限 100 分）。`, saveCount, min(saveCount*5, 20))
	}
	return fmt.Sprintf(`你是一位内容评估专家。请从两个维度评估这篇文章。

用户的阅读意图："%s"
文章结合解答：%s
字数：%d
保存次数：%d

请仅输出合法的 JSON（不要 markdown、不要额外解释），结构如下：
{"intent_score": 70, "quality_score": 90, "final_score": 78, "priority": "PLAN_IT"}

规则：
- intent_score（0-100）：文章与用户阅读意图的匹配程度。完全不相关为 0，完美回答用户问题为 100
- quality_score（0-100）：文章本身的客观质量，包括内容深度、原创性、权威性、实用性。与用户意图无关，纯粹评价文章本身
- final_score：加权综合分，建议权重为 intent_score × 0.6 + quality_score × 0.4，但你可以根据具体情况微调（例如文章质量极高时适当提升 quality 权重）
- priority：根据 final_score 选择 "DO_FIRST"（≥80）、"PLAN_IT"（60-79）、"SKIM_IT"（40-59）、"LET_GO"（<40）
- 所有分数必须为 0-100 的整数%s`, intent, synthesisJSON, extraction.Meta.WordCount, saveCount, saveCountHint)
}

func buildTodoPrompt(intent string, synthesis *SynthesisResult, score *ScoreResult) string {
	synthesisJSON := mustJSON(synthesis)
	return fmt.Sprintf(`你是一位任务规划专家。请为保存了这篇文章的用户创建可执行的待办事项。

用户的阅读意图："%s"
文章优先级：%s
文章结合解答：%s

请仅输出合法的 JSON（不要 markdown、不要额外解释），结构如下：
{"todos": [{"title": "阅读关于 X 的章节", "eta": "20m", "type": "READ"}, ...]}

规则：
- 3 到 7 个待办事项
- 每个标题以动词开头（阅读、总结、对比、实践、分享、记录、搜索等）
- eta：从 "10m"、"20m"、"30m"、"45m"、"1h"、"2h"、"3h+" 中选择
- type：从 "READ"、"WRITE"、"BUILD"、"SHARE" 中选择
- 至少 1 个事项的 type 必须是 "WRITE" 或 "SHARE"（输出导向型任务）
- 所有任务必须与用户的阅读意图和文章结合解答紧密结合
- 使用中文输出`, intent, score.Priority, synthesisJSON)
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
