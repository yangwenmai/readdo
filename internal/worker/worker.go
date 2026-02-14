package worker

import (
	"context"
	"log"
	"time"

	"github.com/yangwenmai/readdo/internal/engine"
	"github.com/yangwenmai/readdo/internal/model"
	"github.com/yangwenmai/readdo/internal/store"
)

// Worker polls for CAPTURED items and runs the pipeline.
type Worker struct {
	store    *store.Store
	pipeline *engine.Pipeline
	interval time.Duration
}

// New creates a new Worker.
func New(s *store.Store, p *engine.Pipeline, interval time.Duration) *Worker {
	return &Worker{store: s, pipeline: p, interval: interval}
}

// Start begins the polling loop. It blocks until ctx is cancelled.
func (w *Worker) Start(ctx context.Context) {
	log.Printf("[worker] started, polling every %s", w.interval)
	for {
		select {
		case <-ctx.Done():
			log.Println("[worker] stopped")
			return
		default:
		}

		item, err := w.store.ClaimNextCaptured()
		if err != nil {
			log.Printf("[worker] claim error: %v", err)
			w.sleep(ctx)
			continue
		}
		if item == nil {
			w.sleep(ctx)
			continue
		}

		log.Printf("[worker] processing item %s (%s)", item.ID, item.Title)
		if err := w.pipeline.Run(ctx, item); err != nil {
			log.Printf("[worker] pipeline failed for %s: %v", item.ID, err)
			errInfo := w.buildErrorInfo(err)
			if sErr := w.store.UpdateItemStatus(item.ID, model.StatusFailed, &errInfo); sErr != nil {
				log.Printf("[worker] failed to set FAILED status: %v", sErr)
			}
			continue
		}

		if err := w.store.UpdateItemStatus(item.ID, model.StatusReady, nil); err != nil {
			log.Printf("[worker] failed to set READY status: %v", err)
		} else {
			log.Printf("[worker] item %s is now READY", item.ID)
		}
	}
}

func (w *Worker) sleep(ctx context.Context) {
	select {
	case <-ctx.Done():
	case <-time.After(w.interval):
	}
}

func (w *Worker) buildErrorInfo(err error) string {
	step := "unknown"
	if se, ok := err.(*engine.StepError); ok {
		step = se.Step
	}
	info := model.ErrorInfo{
		FailedStep: step,
		Message:    err.Error(),
		Retryable:  true,
		FailedAt:   time.Now().UTC().Format(time.RFC3339),
	}
	return info.ToJSON()
}
