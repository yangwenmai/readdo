package store

import (
	"context"

	"github.com/yangwenmai/readdo/internal/model"
)

// ItemReader provides read access to items.
type ItemReader interface {
	GetItem(ctx context.Context, id string) (*model.ItemWithArtifacts, error)
	ListItems(ctx context.Context, f model.ItemFilter) ([]model.Item, error)
}

// ItemWriter provides write access to items.
type ItemWriter interface {
	CreateItem(ctx context.Context, item model.Item) error
	UpdateItemStatus(ctx context.Context, id, newStatus string, errorInfo *string) error
	UpdateItemScoreAndPriority(ctx context.Context, id string, score float64, priority string) error
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

// ItemRepository combines all item-related operations for the API layer.
type ItemRepository interface {
	ItemReader
	ItemWriter
	ArtifactStore
}
