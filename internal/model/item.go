package model

import (
	"fmt"
	"time"
)

// Item status constants
const (
	StatusCaptured   = "CAPTURED"
	StatusProcessing = "PROCESSING"
	StatusReady      = "READY"
	StatusFailed     = "FAILED"
	StatusArchived   = "ARCHIVED"
)

// Priority constants
const (
	PriorityReadNext = "READ_NEXT"
	PriorityWorthIt  = "WORTH_IT"
	PriorityIfTime   = "IF_TIME"
	PrioritySkip     = "SKIP"
)

// Item represents a captured content item.
type Item struct {
	ID         string   `json:"id"`
	URL        string   `json:"url"`
	Title      string   `json:"title"`
	Domain     string   `json:"domain"`
	SourceType string   `json:"source_type"`
	IntentText string   `json:"intent_text"`
	Status     string   `json:"status"`
	Priority   *string  `json:"priority,omitempty"`
	MatchScore *float64 `json:"match_score,omitempty"`
	ErrorInfo  *string  `json:"error_info,omitempty"`
	CreatedAt  string   `json:"created_at"`
	UpdatedAt  string   `json:"updated_at"`
}

// ItemWithArtifacts is an Item together with its associated artifacts.
type ItemWithArtifacts struct {
	Item
	Artifacts []Artifact `json:"artifacts"`
}

// ItemFilter holds query parameters for listing items.
type ItemFilter struct {
	Status   []string
	Priority []string
}

// allowedTransitions defines which status transitions are valid for user-initiated actions.
var allowedTransitions = map[string]map[string]bool{
	StatusReady:    {StatusArchived: true},
	StatusFailed:   {StatusCaptured: true, StatusArchived: true},
	StatusArchived: {StatusReady: true},
}

// userSettableStatuses are the statuses a user can directly set via the API.
var userSettableStatuses = map[string]bool{
	StatusArchived: true,
	StatusReady:    true,
}

// ValidateTransition checks whether transitioning from the item's current status
// to target is allowed. Returns nil if the transition is valid.
func (i *Item) ValidateTransition(target string) error {
	if !userSettableStatuses[target] {
		return fmt.Errorf("status must be ARCHIVED or READY")
	}
	if i.Status == StatusProcessing {
		return fmt.Errorf("cannot change status while PROCESSING")
	}
	allowed, ok := allowedTransitions[i.Status]
	if !ok || !allowed[target] {
		return fmt.Errorf("cannot transition from %s to %s", i.Status, target)
	}
	return nil
}

// NewItem creates a new Item with CAPTURED status.
func NewItem(id, url, title, domain, sourceType, intentText string) Item {
	now := time.Now().UTC().Format(time.RFC3339)
	return Item{
		ID:         id,
		URL:        url,
		Title:      title,
		Domain:     domain,
		SourceType: sourceType,
		IntentText: intentText,
		Status:     StatusCaptured,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
}
