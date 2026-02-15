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

	// OpenAIKey is the API key for the OpenAI service. Empty means stub mode.
	OpenAIKey string

	// OpenAIModel is the model identifier for OpenAI completions.
	OpenAIModel string

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
		OpenAIKey:      os.Getenv("OPENAI_API_KEY"),
		OpenAIModel:    envOr("OPENAI_MODEL", "gpt-4o-mini"),
		WorkerInterval: envDuration("WORKER_INTERVAL", 3*time.Second),
		HTTPTimeout:    envDuration("HTTP_TIMEOUT", 60*time.Second),
		MaxTextLength:  envInt("MAX_TEXT_LENGTH", 15000),
		CORSOrigin:     envOr("CORS_ORIGIN", "*"),
	}
}

// UseStubs returns true when no OpenAI key is configured.
func (c Config) UseStubs() bool {
	return c.OpenAIKey == ""
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
