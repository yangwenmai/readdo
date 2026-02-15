package worker

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/yangwenmai/readdo/internal/model"
)

// Processor runs the processing pipeline for a single item.
type Processor interface {
	Run(ctx context.Context, item *model.Item) error
}

// ItemClaimer provides atomic claim and status update operations.
type ItemClaimer interface {
	ClaimNextCaptured(ctx context.Context) (*model.Item, error)
	UpdateItemStatus(ctx context.Context, id, newStatus string, errorInfo *string) error
}

// Worker polls for CAPTURED items and runs the pipeline.
type Worker struct {
	claimer   ItemClaimer
	processor Processor
	interval  time.Duration
}

// New creates a new Worker.
func New(claimer ItemClaimer, processor Processor, interval time.Duration) *Worker {
	return &Worker{claimer: claimer, processor: processor, interval: interval}
}

// Start begins the polling loop. It blocks until ctx is cancelled.
func (w *Worker) Start(ctx context.Context) {
	slog.Info("worker started", "interval", w.interval.String())
	for {
		select {
		case <-ctx.Done():
			slog.Info("worker stopped")
			return
		default:
		}

		item, err := w.claimer.ClaimNextCaptured(ctx)
		if err != nil {
			slog.Error("worker claim error", "error", err)
			w.sleep(ctx)
			continue
		}
		if item == nil {
			w.sleep(ctx)
			continue
		}

		slog.Info("processing item", "item_id", item.ID, "title", item.Title)
		if err := w.processor.Run(ctx, item); err != nil {
			slog.Error("pipeline failed", "item_id", item.ID, "error", err)
			errInfo := w.buildErrorInfo(err)
			if sErr := w.claimer.UpdateItemStatus(ctx, item.ID, model.StatusFailed, &errInfo); sErr != nil {
				slog.Error("failed to set FAILED status", "item_id", item.ID, "error", sErr)
			}
			continue
		}

		if err := w.claimer.UpdateItemStatus(ctx, item.ID, model.StatusReady, nil); err != nil {
			slog.Error("failed to set READY status", "item_id", item.ID, "error", err)
		} else {
			slog.Info("item is now READY", "item_id", item.ID)
		}
	}
}

func (w *Worker) sleep(ctx context.Context) {
	select {
	case <-ctx.Done():
	case <-time.After(w.interval):
	}
}

// stepNamer is implemented by errors that carry a pipeline step name.
type stepNamer interface {
	StepName() string
}

func (w *Worker) buildErrorInfo(err error) string {
	step := "unknown"
	var sn stepNamer
	if errors.As(err, &sn) {
		step = sn.StepName()
	}
	info := model.ErrorInfo{
		FailedStep: step,
		Message:    err.Error(),
		Retryable:  true,
		FailedAt:   time.Now().UTC().Format(time.RFC3339),
	}
	return info.ToJSON()
}
