package model

import "time"

// Artifact type constants
const (
	ArtifactExtraction = "extraction"
	ArtifactSummary    = "summary"
	ArtifactScore      = "score"
	ArtifactTodos      = "todos"
)

// Created-by constants
const (
	CreatedBySystem = "system"
	CreatedByUser   = "user"
)

// Artifact represents an AI-generated or user-edited output for an Item.
type Artifact struct {
	ID           string `json:"id"`
	ItemID       string `json:"item_id"`
	ArtifactType string `json:"artifact_type"`
	Payload      string `json:"payload"` // JSON string
	CreatedBy    string `json:"created_by"`
	CreatedAt    string `json:"created_at"`
}

// NewArtifact creates a new system-generated Artifact.
func NewArtifact(id, itemID, artifactType, payload string) Artifact {
	return Artifact{
		ID:           id,
		ItemID:       itemID,
		ArtifactType: artifactType,
		Payload:      payload,
		CreatedBy:    CreatedBySystem,
		CreatedAt:    time.Now().UTC().Format(time.RFC3339),
	}
}
