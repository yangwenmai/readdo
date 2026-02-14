package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/yangwenmai/readdo/internal/api"
	"github.com/yangwenmai/readdo/internal/engine"
	"github.com/yangwenmai/readdo/internal/store"
	"github.com/yangwenmai/readdo/internal/worker"
)

func main() {
	port := envOr("PORT", "8080")
	dbPath := envOr("DB_PATH", "readdo.db")

	// Open SQLite.
	db, err := store.OpenSQLite(dbPath)
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	defer db.Close()

	// Initialize store.
	s, err := store.New(db)
	if err != nil {
		log.Fatalf("init store: %v", err)
	}

	// Reset stale PROCESSING items from previous run.
	if n, err := s.ResetStaleProcessing(); err != nil {
		log.Printf("warning: reset stale processing: %v", err)
	} else if n > 0 {
		log.Printf("reset %d stale PROCESSING items to CAPTURED", n)
	}

	// Build pipeline dependencies.
	var extractor engine.ContentExtractor
	var modelClient engine.ModelClient

	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey != "" {
		log.Println("using OpenAI model client")
		modelClient = engine.NewOpenAIClient(apiKey)
		extractor = engine.NewHTTPExtractor()
	} else {
		log.Println("OPENAI_API_KEY not set, using stub pipeline")
		modelClient = &engine.StubModelClient{}
		extractor = &engine.StubExtractor{}
	}

	pipeline := engine.NewPipeline(s, extractor, modelClient)

	// Start worker in background.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	w := worker.New(s, pipeline, 3*time.Second)
	go w.Start(ctx)

	// Start API server.
	srv := api.New(s)
	httpServer := &http.Server{
		Addr:    ":" + port,
		Handler: srv.Handler(),
	}

	// Graceful shutdown.
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		log.Println("shutting down...")
		cancel()
		httpServer.Shutdown(context.Background())
	}()

	fmt.Printf("readdo server listening on http://localhost:%s\n", port)
	if err := httpServer.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatalf("server error: %v", err)
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
