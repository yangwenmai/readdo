package engine

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestNewOpenAIClient_Defaults(t *testing.T) {
	c := NewOpenAIClient("sk-test")

	if c.apiKey != "sk-test" {
		t.Errorf("apiKey = %q, want %q", c.apiKey, "sk-test")
	}
	if c.model != "gpt-4o-mini" {
		t.Errorf("model = %q, want %q", c.model, "gpt-4o-mini")
	}
	if c.baseURL != "https://api.openai.com/v1" {
		t.Errorf("baseURL = %q, want default OpenAI URL", c.baseURL)
	}
}

func TestNewOpenAIClient_WithOptions(t *testing.T) {
	c := NewOpenAIClient("sk-test",
		WithModel("google/gemini-2.5-flash"),
		WithBaseURL("https://aiberm.com/v1"),
	)

	if c.model != "google/gemini-2.5-flash" {
		t.Errorf("model = %q, want %q", c.model, "google/gemini-2.5-flash")
	}
	if c.baseURL != "https://aiberm.com/v1" {
		t.Errorf("baseURL = %q, want %q", c.baseURL, "https://aiberm.com/v1")
	}
}

func TestWithBaseURL_TrimsTrailingSlash(t *testing.T) {
	c := NewOpenAIClient("sk-test", WithBaseURL("https://aiberm.com/v1/"))
	if c.baseURL != "https://aiberm.com/v1" {
		t.Errorf("baseURL = %q, trailing slash should be trimmed", c.baseURL)
	}
}

func TestComplete_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer sk-mock" {
			t.Errorf("Authorization = %q, want %q", got, "Bearer sk-mock")
		}

		var req chatRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if req.Model != "test-model" {
			t.Errorf("request model = %q, want %q", req.Model, "test-model")
		}

		resp := chatResponse{
			Choices: []struct {
				Message struct {
					Content string `json:"content"`
				} `json:"message"`
			}{
				{Message: struct {
					Content string `json:"content"`
				}{Content: "Hello from mock!"}},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	c := NewOpenAIClient("sk-mock", WithModel("test-model"), WithBaseURL(srv.URL))
	got, err := c.Complete(context.Background(), "hi")
	if err != nil {
		t.Fatalf("Complete: %v", err)
	}
	if got != "Hello from mock!" {
		t.Errorf("Complete = %q, want %q", got, "Hello from mock!")
	}
}

func TestComplete_APIError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error":{"message":"invalid api key"}}`))
	}))
	defer srv.Close()

	c := NewOpenAIClient("bad-key", WithBaseURL(srv.URL))
	_, err := c.Complete(context.Background(), "hi")
	if err == nil {
		t.Fatal("expected error for 401 response")
	}
}

func TestComplete_EmptyChoices(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(chatResponse{})
	}))
	defer srv.Close()

	c := NewOpenAIClient("sk-test", WithBaseURL(srv.URL))
	_, err := c.Complete(context.Background(), "hi")
	if err == nil {
		t.Fatal("expected error for empty choices")
	}
}

func TestComplete_RetryOnServerError(t *testing.T) {
	attempts := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		attempts++
		if attempts == 1 {
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte("server error"))
			return
		}
		resp := chatResponse{
			Choices: []struct {
				Message struct {
					Content string `json:"content"`
				} `json:"message"`
			}{
				{Message: struct {
					Content string `json:"content"`
				}{Content: "recovered"}},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	c := NewOpenAIClient("sk-test", WithBaseURL(srv.URL))
	got, err := c.Complete(context.Background(), "hi")
	if err != nil {
		t.Fatalf("Complete: %v", err)
	}
	if got != "recovered" {
		t.Errorf("Complete = %q, want %q", got, "recovered")
	}
	if attempts != 2 {
		t.Errorf("attempts = %d, want 2", attempts)
	}
}

func TestComplete_NoRetryOn4xx(t *testing.T) {
	attempts := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		attempts++
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte("bad request"))
	}))
	defer srv.Close()

	c := NewOpenAIClient("sk-test", WithBaseURL(srv.URL))
	_, err := c.Complete(context.Background(), "hi")
	if err == nil {
		t.Fatal("expected error")
	}
	if attempts != 1 {
		t.Errorf("attempts = %d, want 1 (should not retry 4xx)", attempts)
	}
}

// loadTestEnvFile is a test helper that loads KEY=VALUE pairs from a file
// into env vars (only if not already set). Returns true if the file was found.
func loadTestEnvFile(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		k = strings.TrimSpace(k)
		v = strings.TrimSpace(v)
		v = strings.Trim(v, `"'`)
		if os.Getenv(k) == "" {
			os.Setenv(k, v)
		}
	}
	return true
}

// TestIntegration_Aiberm makes a real API call to Aiberm using .env.local config.
// Run explicitly:  go test ./internal/engine/ -run TestIntegration -v
func TestIntegration_Aiberm(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}

	if !loadTestEnvFile("../../.env.local") {
		t.Skip("skipping: ../../.env.local not found")
	}

	apiKey := os.Getenv("OPENAI_API_KEY")
	baseURL := os.Getenv("OPENAI_BASE_URL")
	model := os.Getenv("OPENAI_MODEL")

	if apiKey == "" {
		t.Skip("skipping: OPENAI_API_KEY not set")
	}
	if baseURL == "" {
		baseURL = "https://api.openai.com/v1"
	}
	if model == "" {
		model = "gpt-4o-mini"
	}

	t.Logf("base_url=%s  model=%s", baseURL, model)

	c := NewOpenAIClient(apiKey, WithBaseURL(baseURL), WithModel(model))
	got, err := c.Complete(context.Background(), "Say hello in one short sentence.")
	if err != nil {
		t.Fatalf("Complete failed: %v", err)
	}

	t.Logf("Response: %s", got)

	if len(got) == 0 {
		t.Error("expected non-empty response")
	}
}
