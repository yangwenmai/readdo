package engine

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

// GeminiClient implements ModelClient using the Google Generative AI REST API.
type GeminiClient struct {
	apiKey     string
	model      string
	httpClient *http.Client
}

// GeminiOption configures the Gemini client.
type GeminiOption func(*GeminiClient)

// WithGeminiModel sets the model name.
func WithGeminiModel(model string) GeminiOption {
	return func(c *GeminiClient) { c.model = model }
}

// NewGeminiClient creates a new Google Gemini model client.
func NewGeminiClient(apiKey string, opts ...GeminiOption) *GeminiClient {
	c := &GeminiClient{
		apiKey: apiKey,
		model:  "gemini-2.0-flash",
		httpClient: &http.Client{
			Timeout: 60 * time.Second,
		},
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

type geminiRequest struct {
	Contents         []geminiContent  `json:"contents"`
	GenerationConfig geminiGenConfig  `json:"generationConfig"`
}

type geminiContent struct {
	Parts []geminiPart `json:"parts"`
}

type geminiPart struct {
	Text string `json:"text"`
}

type geminiGenConfig struct {
	Temperature float64 `json:"temperature"`
	MaxOutputTokens int `json:"maxOutputTokens"`
}

type geminiResponse struct {
	Candidates []struct {
		Content struct {
			Parts []struct {
				Text string `json:"text"`
			} `json:"parts"`
		} `json:"content"`
	} `json:"candidates"`
	Error *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

// Complete sends a prompt to the Gemini API and returns the response text.
func (c *GeminiClient) Complete(ctx context.Context, prompt string) (string, error) {
	reqBody := geminiRequest{
		Contents: []geminiContent{
			{Parts: []geminiPart{{Text: prompt}}},
		},
		GenerationConfig: geminiGenConfig{
			Temperature:     0.3,
			MaxOutputTokens: 4096,
		},
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("marshal request: %w", err)
	}

	const maxAttempts = 2
	var lastErr error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		result, err := c.doRequest(ctx, body)
		if err == nil {
			return result, nil
		}
		lastErr = err

		var ae *apiError
		if errors.As(err, &ae) && !ae.isRetryable() {
			return "", fmt.Errorf("gemini: %w", err)
		}

		if attempt < maxAttempts-1 {
			backoff := time.Duration(attempt+1) * 2 * time.Second
			select {
			case <-ctx.Done():
				return "", ctx.Err()
			case <-time.After(backoff):
			}
		}
	}
	return "", fmt.Errorf("gemini: %w", lastErr)
}

func (c *GeminiClient) doRequest(ctx context.Context, body []byte) (string, error) {
	url := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent", c.model)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-goog-api-key", c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", &apiError{StatusCode: resp.StatusCode, Body: string(respBody)}
	}

	var geminiResp geminiResponse
	if err := json.Unmarshal(respBody, &geminiResp); err != nil {
		return "", fmt.Errorf("unmarshal response: %w", err)
	}

	if geminiResp.Error != nil {
		return "", fmt.Errorf("api error: %s", geminiResp.Error.Message)
	}

	if len(geminiResp.Candidates) > 0 && len(geminiResp.Candidates[0].Content.Parts) > 0 {
		return geminiResp.Candidates[0].Content.Parts[0].Text, nil
	}

	return "", fmt.Errorf("no content in response")
}
