package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/yangwenmai/readdo/internal/api"
	"github.com/yangwenmai/readdo/internal/config"
	"github.com/yangwenmai/readdo/internal/engine"
	"github.com/yangwenmai/readdo/internal/store"
	"github.com/yangwenmai/readdo/internal/worker"
)

func main() {
	// Initialize structured logger.
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))

	cfg := config.Load()

	// Open SQLite.
	db, err := store.OpenSQLite(cfg.DBPath)
	if err != nil {
		slog.Error("failed to open database", "path", cfg.DBPath, "error", err)
		os.Exit(1)
	}
	defer db.Close()

	// Initialize store.
	s, err := store.New(db)
	if err != nil {
		slog.Error("failed to initialize store", "error", err)
		os.Exit(1)
	}

	// Reset stale PROCESSING items from previous run.
	if n, err := s.ResetStaleProcessing(context.Background()); err != nil {
		slog.Warn("reset stale processing failed", "error", err)
	} else if n > 0 {
		slog.Info("reset stale PROCESSING items to CAPTURED", "count", n)
	}

	// Build pipeline dependencies.
	var extractor engine.ContentExtractor
	var modelClient engine.ModelClient

	if cfg.UseStubs() {
		slog.Info("OPENAI_API_KEY not set, using stub pipeline")
		modelClient = &engine.StubModelClient{}
		extractor = &engine.StubExtractor{}
	} else {
		slog.Info("using OpenAI model client", "model", cfg.OpenAIModel)
		modelClient = engine.NewOpenAIClient(cfg.OpenAIKey, engine.WithModel(cfg.OpenAIModel))
		extractor = engine.NewHTTPExtractor()
	}

	// Build pipeline with pluggable steps.
	pipeline := engine.NewPipeline(
		&engine.ExtractStep{Extractor: extractor, Artifacts: s},
		&engine.SummarizeStep{Model: modelClient, Artifacts: s},
		&engine.ScoreStep{Model: modelClient, Artifacts: s, Scores: s},
		&engine.TodoStep{Model: modelClient, Artifacts: s},
	)

	// Start worker in background.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	w := worker.New(s, pipeline, cfg.WorkerInterval)
	go w.Start(ctx)

	// Start API server.
	srv := api.New(s)
	httpServer := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: srv.Handler(),
	}

	// Graceful shutdown.
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		slog.Info("shutting down...")
		cancel()
		httpServer.Shutdown(context.Background())
	}()

	slog.Info("readdo server listening", "addr", "http://localhost:"+cfg.Port)
	if err := httpServer.ListenAndServe(); err != http.ErrServerClosed {
		slog.Error("server error", "error", err)
		os.Exit(1)
	}
}
