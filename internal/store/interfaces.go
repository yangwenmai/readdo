package store

import (
	"context"

	"github.com/yangwenmai/readdo/internal/model"
)

// StatusCounts holds the number of items per logical group.
type StatusCounts struct {
	Inbox   int `json:"inbox"`
	Archive int `json:"archive"`
}

// ItemReader provides read access to items.
type ItemReader interface {
	GetItem(ctx context.Context, id string) (*model.ItemWithArtifacts, error)
	ListItems(ctx context.Context, f model.ItemFilter) ([]model.Item, error)
	FindItemByURL(ctx context.Context, url string) (*model.Item, error)
	CountByStatus(ctx context.Context) (StatusCounts, error)
}

// ItemWriter provides write access to items.
type ItemWriter interface {
	CreateItem(ctx context.Context, item model.Item) error
	UpdateItemStatus(ctx context.Context, id, newStatus string, errorInfo *string) error
	UpdateItemScoreAndPriority(ctx context.Context, id string, score float64, priority string) error
	UpdateItemForReprocess(ctx context.Context, id, intentText string, saveCount int) error
	DeleteItem(ctx context.Context, id string) error
	BatchUpdateStatus(ctx context.Context, ids []string, status string) (int64, error)
	BatchDeleteItems(ctx context.Context, ids []string) (int64, error)
}

// ItemClaimer provides atomic claim operations for background processing.
type ItemClaimer interface {
	ClaimNextCaptured(ctx context.Context) (*model.Item, error)
	ResetStaleProcessing(ctx context.Context) (int64, error)
}

// ArtifactStore provides access to artifact persistence.
type ArtifactStore interface {
	UpsertArtifact(ctx context.Context, a model.Artifact) error
}

// IntentStore provides access to intent persistence.
type IntentStore interface {
	CreateIntent(ctx context.Context, intent model.Intent) error
}

// ItemRepository combines all item-related operations for the API layer.
type ItemRepository interface {
	ItemReader
	ItemWriter
	ArtifactStore
	IntentStore
}
