package model

import (
	"testing"
)

func TestNewItem(t *testing.T) {
	item := NewItem("id-1", "https://example.com", "Example", "example.com", "web", "learn stuff")

	if item.ID != "id-1" {
		t.Errorf("ID = %q, want %q", item.ID, "id-1")
	}
	if item.Status != StatusCaptured {
		t.Errorf("Status = %q, want %q", item.Status, StatusCaptured)
	}
	if item.SaveCount != 1 {
		t.Errorf("SaveCount = %d, want 1", item.SaveCount)
	}
	if item.CreatedAt == "" {
		t.Error("CreatedAt should not be empty")
	}
	if item.CreatedAt != item.UpdatedAt {
		t.Error("CreatedAt and UpdatedAt should be equal for new items")
	}
	if item.Priority != nil {
		t.Error("Priority should be nil for new items")
	}
	if item.MatchScore != nil {
		t.Error("MatchScore should be nil for new items")
	}
}

func TestMergeIntent(t *testing.T) {
	t.Run("empty intent increments count only", func(t *testing.T) {
		item := NewItem("id-1", "https://example.com", "Example", "example.com", "web", "first intent")
		item.MergeIntent("")
		if item.SaveCount != 2 {
			t.Errorf("SaveCount = %d, want 2", item.SaveCount)
		}
		if item.IntentText != "first intent" {
			t.Errorf("IntentText = %q, want %q", item.IntentText, "first intent")
		}
	})

	t.Run("merge into empty intent", func(t *testing.T) {
		item := NewItem("id-1", "https://example.com", "Example", "example.com", "web", "")
		item.MergeIntent("new intent")
		if item.IntentText != "new intent" {
			t.Errorf("IntentText = %q, want %q", item.IntentText, "new intent")
		}
		if item.SaveCount != 2 {
			t.Errorf("SaveCount = %d, want 2", item.SaveCount)
		}
	})

	t.Run("merge appends with separator", func(t *testing.T) {
		item := NewItem("id-1", "https://example.com", "Example", "example.com", "web", "first")
		item.MergeIntent("second")
		want := "first\n---\nsecond"
		if item.IntentText != want {
			t.Errorf("IntentText = %q, want %q", item.IntentText, want)
		}
		if item.SaveCount != 2 {
			t.Errorf("SaveCount = %d, want 2", item.SaveCount)
		}
	})
}

func TestValidateTransition(t *testing.T) {
	tests := []struct {
		name    string
		from    string
		to      string
		wantErr bool
	}{
		{"READY to ARCHIVED", StatusReady, StatusArchived, false},
		{"FAILED to ARCHIVED", StatusFailed, StatusArchived, false},
		{"ARCHIVED to READY", StatusArchived, StatusReady, false},

		{"PROCESSING blocks transition", StatusProcessing, StatusArchived, true},
		{"CAPTURED to ARCHIVED forbidden", StatusCaptured, StatusArchived, true},
		{"READY to READY forbidden", StatusReady, StatusReady, true},
		{"invalid target status", StatusReady, StatusProcessing, true},
		{"READY to CAPTURED forbidden", StatusReady, StatusCaptured, true},
		{"FAILED to CAPTURED not user-settable", StatusFailed, StatusCaptured, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			item := &Item{Status: tt.from}
			err := item.ValidateTransition(tt.to)
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidateTransition(%q→%q) error = %v, wantErr %v", tt.from, tt.to, err, tt.wantErr)
			}
		})
	}
}

func TestNewIntent(t *testing.T) {
	intent := NewIntent("int-1", "item-1", "learn Go context")
	if intent.ID != "int-1" {
		t.Errorf("ID = %q, want %q", intent.ID, "int-1")
	}
	if intent.ItemID != "item-1" {
		t.Errorf("ItemID = %q, want %q", intent.ItemID, "item-1")
	}
	if intent.CreatedAt == "" {
		t.Error("CreatedAt should not be empty")
	}
}

func TestNewArtifact(t *testing.T) {
	a := NewArtifact("a-1", "item-1", ArtifactSynthesis, `{"points":[],"insight":""}`)
	if a.CreatedBy != CreatedBySystem {
		t.Errorf("CreatedBy = %q, want %q", a.CreatedBy, CreatedBySystem)
	}
	if a.ArtifactType != ArtifactSynthesis {
		t.Errorf("ArtifactType = %q, want %q", a.ArtifactType, ArtifactSynthesis)
	}
	if a.CreatedAt == "" {
		t.Error("CreatedAt should not be empty")
	}
}

func TestErrorInfoToJSON(t *testing.T) {
	info := ErrorInfo{
		FailedStep: "extract",
		Message:    "timeout",
		Retryable:  true,
		FailedAt:   "2026-01-01T00:00:00Z",
	}
	j := info.ToJSON()
	if j == "" {
		t.Error("ToJSON should not return empty string")
	}
	if !contains(j, `"failed_step":"extract"`) {
		t.Errorf("ToJSON missing failed_step, got %s", j)
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && searchStr(s, substr)
}

func searchStr(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
