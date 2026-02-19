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

// ClaudeClient implements ModelClient using the Anthropic Messages API.
type ClaudeClient struct {
	apiKey     string
	model      string
	httpClient *http.Client
}

// ClaudeOption configures the Claude client.
type ClaudeOption func(*ClaudeClient)

// WithClaudeModel sets the model name.
func WithClaudeModel(model string) ClaudeOption {
	return func(c *ClaudeClient) { c.model = model }
}

// NewClaudeClient creates a new Anthropic Claude model client.
func NewClaudeClient(apiKey string, opts ...ClaudeOption) *ClaudeClient {
	c := &ClaudeClient{
		apiKey: apiKey,
		model:  "claude-sonnet-4-20250514",
		httpClient: &http.Client{
			Timeout: 60 * time.Second,
		},
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

type claudeRequest struct {
	Model       string           `json:"model"`
	MaxTokens   int              `json:"max_tokens"`
	Temperature float64          `json:"temperature"`
	Messages    []claudeMessage  `json:"messages"`
}

type claudeMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type claudeResponse struct {
	Content []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
	Error *struct {
		Type    string `json:"type"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

// Complete sends a prompt to the Anthropic Messages API and returns the response text.
func (c *ClaudeClient) Complete(ctx context.Context, prompt string) (string, error) {
	reqBody := claudeRequest{
		Model:       c.model,
		MaxTokens:   4096,
		Temperature: 0.3,
		Messages: []claudeMessage{
			{Role: "user", Content: prompt},
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
			return "", fmt.Errorf("claude: %w", err)
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
	return "", fmt.Errorf("claude: %w", lastErr)
}

func (c *ClaudeClient) doRequest(ctx context.Context, body []byte) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.anthropic.com/v1/messages", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", c.apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")

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

	var claudeResp claudeResponse
	if err := json.Unmarshal(respBody, &claudeResp); err != nil {
		return "", fmt.Errorf("unmarshal response: %w", err)
	}

	if claudeResp.Error != nil {
		return "", fmt.Errorf("api error: %s", claudeResp.Error.Message)
	}

	for _, block := range claudeResp.Content {
		if block.Type == "text" {
			return block.Text, nil
		}
	}

	return "", fmt.Errorf("no text content in response")
}
