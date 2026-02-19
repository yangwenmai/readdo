// Package config provides centralized configuration for the readdo server.
// All configurable values are loaded from environment variables with sensible defaults.
package config

import (
	"os"
	"strconv"
	"time"
)

// Config holds all server configuration values.
type Config struct {
	// Port is the HTTP server listen port.
	Port string

	// DBPath is the path to the SQLite database file.
	DBPath string

	// LLMProvider selects which LLM backend to use: "openai", "claude", "gemini", "ollama".
	LLMProvider string

	// OpenAIKey is the API key for the OpenAI service.
	OpenAIKey string

	// OpenAIModel is the model identifier for OpenAI completions.
	OpenAIModel string

	// AnthropicKey is the API key for the Anthropic Claude service.
	AnthropicKey string

	// AnthropicModel is the model identifier for Claude completions.
	AnthropicModel string

	// GeminiKey is the API key for the Google Gemini service.
	GeminiKey string

	// GeminiModel is the model identifier for Gemini completions.
	GeminiModel string

	// OllamaURL is the base URL for the local Ollama server.
	OllamaURL string

	// OllamaModel is the model identifier for Ollama completions.
	OllamaModel string

	// WorkerInterval is the polling interval for the background worker.
	WorkerInterval time.Duration

	// HTTPTimeout is the timeout for outgoing HTTP requests (extract, LLM).
	HTTPTimeout time.Duration

	// MaxTextLength is the maximum number of runes to keep from extracted text.
	MaxTextLength int

	// CORSOrigin is the allowed CORS origin. Defaults to "*".
	CORSOrigin string
}

// Load reads configuration from environment variables, applying defaults.
func Load() Config {
	return Config{
		Port:           envOr("PORT", "8080"),
		DBPath:         envOr("DB_PATH", "readdo.db"),
		LLMProvider:    envOr("LLM_PROVIDER", "openai"),
		OpenAIKey:      os.Getenv("OPENAI_API_KEY"),
		OpenAIModel:    envOr("OPENAI_MODEL", "gpt-4o-mini"),
		AnthropicKey:   os.Getenv("ANTHROPIC_API_KEY"),
		AnthropicModel: envOr("ANTHROPIC_MODEL", "claude-sonnet-4-20250514"),
		GeminiKey:      os.Getenv("GEMINI_API_KEY"),
		GeminiModel:    envOr("GEMINI_MODEL", "gemini-2.0-flash"),
		OllamaURL:      envOr("OLLAMA_URL", "http://localhost:11434"),
		OllamaModel:    envOr("OLLAMA_MODEL", "llama3"),
		WorkerInterval: envDuration("WORKER_INTERVAL", 3*time.Second),
		HTTPTimeout:    envDuration("HTTP_TIMEOUT", 60*time.Second),
		MaxTextLength:  envInt("MAX_TEXT_LENGTH", 15000),
		CORSOrigin:     envOr("CORS_ORIGIN", "*"),
	}
}

// UseStubs returns true when no LLM API key is configured for the selected provider.
func (c Config) UseStubs() bool {
	switch c.LLMProvider {
	case "claude":
		return c.AnthropicKey == ""
	case "gemini":
		return c.GeminiKey == ""
	case "ollama":
		return false // Ollama runs locally, no key needed
	default:
		return c.OpenAIKey == ""
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envDuration(key string, fallback time.Duration) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return fallback
	}
	return d
}

func envInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return n
}
