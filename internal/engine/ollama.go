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

// OllamaClient implements ModelClient using the local Ollama API.
type OllamaClient struct {
	baseURL    string
	model      string
	httpClient *http.Client
}

// OllamaOption configures the Ollama client.
type OllamaOption func(*OllamaClient)

// WithOllamaModel sets the model name.
func WithOllamaModel(model string) OllamaOption {
	return func(c *OllamaClient) { c.model = model }
}

// NewOllamaClient creates a new Ollama model client.
func NewOllamaClient(baseURL string, opts ...OllamaOption) *OllamaClient {
	if baseURL == "" {
		baseURL = "http://localhost:11434"
	}
	c := &OllamaClient{
		baseURL: baseURL,
		model:   "llama3",
		httpClient: &http.Client{
			Timeout: 120 * time.Second,
		},
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

type ollamaRequest struct {
	Model   string          `json:"model"`
	Prompt  string          `json:"prompt"`
	Stream  bool            `json:"stream"`
	Options ollamaOptions   `json:"options"`
}

type ollamaOptions struct {
	Temperature float64 `json:"temperature"`
}

type ollamaResponse struct {
	Response string `json:"response"`
	Error    string `json:"error,omitempty"`
}

// Complete sends a prompt to the Ollama API and returns the response text.
func (c *OllamaClient) Complete(ctx context.Context, prompt string) (string, error) {
	reqBody := ollamaRequest{
		Model:  c.model,
		Prompt: prompt,
		Stream: false,
		Options: ollamaOptions{
			Temperature: 0.3,
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
			return "", fmt.Errorf("ollama: %w", err)
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
	return "", fmt.Errorf("ollama: %w", lastErr)
}

func (c *OllamaClient) doRequest(ctx context.Context, body []byte) (string, error) {
	url := c.baseURL + "/api/generate"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

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

	var ollamaResp ollamaResponse
	if err := json.Unmarshal(respBody, &ollamaResp); err != nil {
		return "", fmt.Errorf("unmarshal response: %w", err)
	}

	if ollamaResp.Error != "" {
		return "", fmt.Errorf("ollama error: %s", ollamaResp.Error)
	}

	if ollamaResp.Response == "" {
		return "", fmt.Errorf("empty response from ollama")
	}

	return ollamaResp.Response, nil
}
