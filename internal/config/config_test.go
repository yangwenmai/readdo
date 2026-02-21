package config

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLoadEnvFile(t *testing.T) {
	dir := t.TempDir()
	envFile := filepath.Join(dir, ".env.local")

	content := `# comment line
FOO_TEST_KEY=hello
BAR_TEST_KEY="quoted value"
BAZ_TEST_KEY='single quoted'

EMPTY_LINE_ABOVE=works
NO_VALUE_LINE
`
	if err := os.WriteFile(envFile, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	for _, k := range []string{"FOO_TEST_KEY", "BAR_TEST_KEY", "BAZ_TEST_KEY", "EMPTY_LINE_ABOVE"} {
		os.Unsetenv(k)
	}

	loadEnvFile(envFile)
	t.Cleanup(func() {
		for _, k := range []string{"FOO_TEST_KEY", "BAR_TEST_KEY", "BAZ_TEST_KEY", "EMPTY_LINE_ABOVE"} {
			os.Unsetenv(k)
		}
	})

	tests := []struct {
		key  string
		want string
	}{
		{"FOO_TEST_KEY", "hello"},
		{"BAR_TEST_KEY", "quoted value"},
		{"BAZ_TEST_KEY", "single quoted"},
		{"EMPTY_LINE_ABOVE", "works"},
	}
	for _, tt := range tests {
		if got := os.Getenv(tt.key); got != tt.want {
			t.Errorf("os.Getenv(%q) = %q, want %q", tt.key, got, tt.want)
		}
	}
}

func TestLoadEnvFile_RealEnvTakesPrecedence(t *testing.T) {
	dir := t.TempDir()
	envFile := filepath.Join(dir, ".env.local")

	if err := os.WriteFile(envFile, []byte("PRECEDENCE_TEST=from-file\n"), 0644); err != nil {
		t.Fatal(err)
	}

	os.Setenv("PRECEDENCE_TEST", "from-env")
	t.Cleanup(func() { os.Unsetenv("PRECEDENCE_TEST") })

	loadEnvFile(envFile)

	if got := os.Getenv("PRECEDENCE_TEST"); got != "from-env" {
		t.Errorf("env var = %q, want %q (real env should take precedence)", got, "from-env")
	}
}

func TestLoadEnvFile_MissingFile(t *testing.T) {
	loadEnvFile("/nonexistent/path/.env.local")
}

func TestLoad_Defaults(t *testing.T) {
	envKeys := []string{
		"LOG_LEVEL", "PORT", "DB_PATH", "LLM_PROVIDER",
		"OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL",
		"ANTHROPIC_API_KEY", "ANTHROPIC_MODEL",
		"GEMINI_API_KEY", "GEMINI_MODEL",
		"OLLAMA_URL", "OLLAMA_MODEL",
		"WORKER_INTERVAL", "HTTP_TIMEOUT", "MAX_TEXT_LENGTH", "CORS_ORIGIN",
	}
	saved := make(map[string]string)
	for _, k := range envKeys {
		saved[k] = os.Getenv(k)
		os.Unsetenv(k)
	}
	t.Cleanup(func() {
		for _, k := range envKeys {
			if v := saved[k]; v != "" {
				os.Setenv(k, v)
			} else {
				os.Unsetenv(k)
			}
		}
	})

	cfg := Load()

	if cfg.Port != "8080" {
		t.Errorf("Port = %q, want %q", cfg.Port, "8080")
	}
	if cfg.LLMProvider != "openai" {
		t.Errorf("LLMProvider = %q, want %q", cfg.LLMProvider, "openai")
	}
	if cfg.OpenAIBaseURL != "https://api.openai.com/v1" {
		t.Errorf("OpenAIBaseURL = %q, want default", cfg.OpenAIBaseURL)
	}
	if cfg.OpenAIModel != "gpt-4o-mini" {
		t.Errorf("OpenAIModel = %q, want %q", cfg.OpenAIModel, "gpt-4o-mini")
	}
	if cfg.WorkerInterval != 3*time.Second {
		t.Errorf("WorkerInterval = %v, want 3s", cfg.WorkerInterval)
	}
	if cfg.MaxTextLength != 15000 {
		t.Errorf("MaxTextLength = %d, want 15000", cfg.MaxTextLength)
	}
}

func TestLoad_EnvOverride(t *testing.T) {
	os.Setenv("OPENAI_BASE_URL", "https://aiberm.com/v1")
	os.Setenv("OPENAI_MODEL", "google/gemini-2.5-flash")
	os.Setenv("OPENAI_API_KEY", "sk-test-key")
	t.Cleanup(func() {
		os.Unsetenv("OPENAI_BASE_URL")
		os.Unsetenv("OPENAI_MODEL")
		os.Unsetenv("OPENAI_API_KEY")
	})

	cfg := Load()

	if cfg.OpenAIBaseURL != "https://aiberm.com/v1" {
		t.Errorf("OpenAIBaseURL = %q, want Aiberm URL", cfg.OpenAIBaseURL)
	}
	if cfg.OpenAIModel != "google/gemini-2.5-flash" {
		t.Errorf("OpenAIModel = %q, want %q", cfg.OpenAIModel, "google/gemini-2.5-flash")
	}
	if cfg.OpenAIKey != "sk-test-key" {
		t.Errorf("OpenAIKey = %q, want %q", cfg.OpenAIKey, "sk-test-key")
	}
}

func TestUseStubs(t *testing.T) {
	tests := []struct {
		name     string
		cfg      Config
		wantStub bool
	}{
		{"openai without key", Config{LLMProvider: "openai"}, true},
		{"openai with key", Config{LLMProvider: "openai", OpenAIKey: "sk-x"}, false},
		{"claude without key", Config{LLMProvider: "claude"}, true},
		{"claude with key", Config{LLMProvider: "claude", AnthropicKey: "sk-x"}, false},
		{"gemini without key", Config{LLMProvider: "gemini"}, true},
		{"gemini with key", Config{LLMProvider: "gemini", GeminiKey: "key"}, false},
		{"ollama always false", Config{LLMProvider: "ollama"}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.cfg.UseStubs(); got != tt.wantStub {
				t.Errorf("UseStubs() = %v, want %v", got, tt.wantStub)
			}
		})
	}
}

func TestEnvDuration_Invalid(t *testing.T) {
	os.Setenv("TEST_DUR_INVALID", "not-a-duration")
	t.Cleanup(func() { os.Unsetenv("TEST_DUR_INVALID") })

	got := envDuration("TEST_DUR_INVALID", 5*time.Second)
	if got != 5*time.Second {
		t.Errorf("envDuration with invalid value = %v, want fallback 5s", got)
	}
}

func TestEnvInt_Invalid(t *testing.T) {
	os.Setenv("TEST_INT_INVALID", "abc")
	t.Cleanup(func() { os.Unsetenv("TEST_INT_INVALID") })

	got := envInt("TEST_INT_INVALID", 42)
	if got != 42 {
		t.Errorf("envInt with invalid value = %d, want fallback 42", got)
	}
}
