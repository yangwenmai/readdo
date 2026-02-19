package store

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/yangwenmai/readdo/internal/model"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "test.db")
	db, err := OpenSQLite(dbPath)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	s, err := New(db)
	if err != nil {
		t.Fatalf("new store: %v", err)
	}
	return s
}

func makeItem(id, url string) model.Item {
	now := time.Now().UTC().Format(time.RFC3339)
	return model.Item{
		ID:         id,
		URL:        url,
		Title:      "Title " + id,
		Domain:     "example.com",
		SourceType: "web",
		IntentText: "intent for " + id,
		Status:     model.StatusCaptured,
		SaveCount:  1,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
}

func TestCreateAndGetItem(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	item := makeItem("item-1", "https://example.com/1")

	if err := s.CreateItem(ctx, item); err != nil {
		t.Fatalf("CreateItem: %v", err)
	}

	got, err := s.GetItem(ctx, "item-1")
	if err != nil {
		t.Fatalf("GetItem: %v", err)
	}
	if got.ID != "item-1" {
		t.Errorf("ID = %q, want %q", got.ID, "item-1")
	}
	if got.Status != model.StatusCaptured {
		t.Errorf("Status = %q, want %q", got.Status, model.StatusCaptured)
	}
	if len(got.Artifacts) != 0 {
		t.Errorf("Artifacts len = %d, want 0", len(got.Artifacts))
	}
}

func TestGetItem_NotFound(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	_, err := s.GetItem(ctx, "nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent item")
	}
}

func TestListItems(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	for i := 0; i < 3; i++ {
		item := makeItem(
			"item-"+string(rune('a'+i)),
			"https://example.com/"+string(rune('a'+i)),
		)
		if i == 2 {
			item.Status = model.StatusReady
		}
		if err := s.CreateItem(ctx, item); err != nil {
			t.Fatalf("CreateItem: %v", err)
		}
	}

	// List all
	all, err := s.ListItems(ctx, model.ItemFilter{})
	if err != nil {
		t.Fatalf("ListItems: %v", err)
	}
	if len(all) != 3 {
		t.Errorf("ListItems all = %d, want 3", len(all))
	}

	// Filter by status
	captured, err := s.ListItems(ctx, model.ItemFilter{Status: []string{model.StatusCaptured}})
	if err != nil {
		t.Fatalf("ListItems captured: %v", err)
	}
	if len(captured) != 2 {
		t.Errorf("ListItems captured = %d, want 2", len(captured))
	}
}

func TestUpdateItemStatus(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	item := makeItem("item-1", "https://example.com/1")
	s.CreateItem(ctx, item)

	if err := s.UpdateItemStatus(ctx, "item-1", model.StatusProcessing, nil); err != nil {
		t.Fatalf("UpdateItemStatus: %v", err)
	}

	got, _ := s.GetItem(ctx, "item-1")
	if got.Status != model.StatusProcessing {
		t.Errorf("Status = %q, want %q", got.Status, model.StatusProcessing)
	}
}

func TestUpdateItemScoreAndPriority(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	item := makeItem("item-1", "https://example.com/1")
	s.CreateItem(ctx, item)

	if err := s.UpdateItemScoreAndPriority(ctx, "item-1", 85.0, model.PriorityReadNext); err != nil {
		t.Fatalf("UpdateItemScoreAndPriority: %v", err)
	}

	got, _ := s.GetItem(ctx, "item-1")
	if got.MatchScore == nil || *got.MatchScore != 85.0 {
		t.Errorf("MatchScore = %v, want 85.0", got.MatchScore)
	}
	if got.Priority == nil || *got.Priority != model.PriorityReadNext {
		t.Errorf("Priority = %v, want %q", got.Priority, model.PriorityReadNext)
	}
}

func TestClaimNextCaptured(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	// No items → nil
	got, err := s.ClaimNextCaptured(ctx)
	if err != nil {
		t.Fatalf("ClaimNextCaptured: %v", err)
	}
	if got != nil {
		t.Error("expected nil when no items")
	}

	// Create items
	item1 := makeItem("item-1", "https://example.com/1")
	item2 := makeItem("item-2", "https://example.com/2")
	s.CreateItem(ctx, item1)
	time.Sleep(10 * time.Millisecond) // ensure different created_at
	s.CreateItem(ctx, item2)

	// Claim should get the oldest
	claimed, err := s.ClaimNextCaptured(ctx)
	if err != nil {
		t.Fatalf("ClaimNextCaptured: %v", err)
	}
	if claimed == nil || claimed.ID != "item-1" {
		t.Errorf("claimed = %v, want item-1", claimed)
	}
	if claimed.Status != model.StatusProcessing {
		t.Errorf("claimed status = %q, want PROCESSING", claimed.Status)
	}
}

func TestFindItemByURL(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	// Not found
	got, err := s.FindItemByURL(ctx, "https://example.com/1")
	if err == nil && got != nil {
		t.Error("expected nil for nonexistent URL")
	}

	item := makeItem("item-1", "https://example.com/1")
	s.CreateItem(ctx, item)

	got, err = s.FindItemByURL(ctx, "https://example.com/1")
	if err != nil {
		t.Fatalf("FindItemByURL: %v", err)
	}
	if got.ID != "item-1" {
		t.Errorf("ID = %q, want %q", got.ID, "item-1")
	}

	// Archived items should not be found
	s.UpdateItemStatus(ctx, "item-1", model.StatusArchived, nil)
	got, err = s.FindItemByURL(ctx, "https://example.com/1")
	if err == nil && got != nil {
		t.Error("archived item should not be found by FindItemByURL")
	}
}

func TestUpdateItemForReprocess(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	item := makeItem("item-1", "https://example.com/1")
	item.Status = model.StatusReady
	s.CreateItem(ctx, item)

	err := s.UpdateItemForReprocess(ctx, "item-1", "new intent", 2)
	if err != nil {
		t.Fatalf("UpdateItemForReprocess: %v", err)
	}

	got, _ := s.GetItem(ctx, "item-1")
	if got.Status != model.StatusCaptured {
		t.Errorf("Status = %q, want CAPTURED", got.Status)
	}
	if got.SaveCount != 2 {
		t.Errorf("SaveCount = %d, want 2", got.SaveCount)
	}
}

func TestResetStaleProcessing(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	item1 := makeItem("item-1", "https://example.com/1")
	item1.Status = model.StatusProcessing
	s.CreateItem(ctx, item1)

	item2 := makeItem("item-2", "https://example.com/2")
	s.CreateItem(ctx, item2)

	n, err := s.ResetStaleProcessing(ctx)
	if err != nil {
		t.Fatalf("ResetStaleProcessing: %v", err)
	}
	if n != 1 {
		t.Errorf("reset count = %d, want 1", n)
	}

	got, _ := s.GetItem(ctx, "item-1")
	if got.Status != model.StatusCaptured {
		t.Errorf("Status = %q, want CAPTURED", got.Status)
	}
}

func TestUpsertArtifact(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	item := makeItem("item-1", "https://example.com/1")
	s.CreateItem(ctx, item)

	a1 := model.NewArtifact("a-1", "item-1", model.ArtifactSummary, `{"bullets":[],"insight":"test"}`)
	if err := s.UpsertArtifact(ctx, a1); err != nil {
		t.Fatalf("UpsertArtifact: %v", err)
	}

	got, _ := s.GetItem(ctx, "item-1")
	if len(got.Artifacts) != 1 {
		t.Fatalf("Artifacts len = %d, want 1", len(got.Artifacts))
	}
	if got.Artifacts[0].ArtifactType != model.ArtifactSummary {
		t.Errorf("ArtifactType = %q, want %q", got.Artifacts[0].ArtifactType, model.ArtifactSummary)
	}

	// Upsert replaces
	a2 := model.NewArtifact("a-2", "item-1", model.ArtifactSummary, `{"bullets":["new"],"insight":"updated"}`)
	if err := s.UpsertArtifact(ctx, a2); err != nil {
		t.Fatalf("UpsertArtifact replace: %v", err)
	}

	got, _ = s.GetItem(ctx, "item-1")
	if len(got.Artifacts) != 1 {
		t.Fatalf("Artifacts len after upsert = %d, want 1", len(got.Artifacts))
	}
	if got.Artifacts[0].ID != "a-2" {
		t.Errorf("artifact ID = %q, want %q", got.Artifacts[0].ID, "a-2")
	}
}

func TestCreateIntent(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	item := makeItem("item-1", "https://example.com/1")
	s.CreateItem(ctx, item)

	intent := model.NewIntent("int-1", "item-1", "learn Go")
	if err := s.CreateIntent(ctx, intent); err != nil {
		t.Fatalf("CreateIntent: %v", err)
	}

	got, _ := s.GetItem(ctx, "item-1")
	if len(got.Intents) != 1 {
		t.Fatalf("Intents len = %d, want 1", len(got.Intents))
	}
	if got.Intents[0].Text != "learn Go" {
		t.Errorf("Intent text = %q, want %q", got.Intents[0].Text, "learn Go")
	}
}

func TestListItems_Search(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	items := []model.Item{
		makeItem("1", "https://go.dev/blog"),
		makeItem("2", "https://rust-lang.org"),
		makeItem("3", "https://python.org"),
	}
	items[0].Title = "Go Blog"
	items[0].Domain = "go.dev"
	items[1].Title = "Rust Language"
	items[1].Domain = "rust-lang.org"
	items[2].Title = "Python Home"
	items[2].Domain = "python.org"
	items[2].IntentText = "learn Go interop"

	for _, item := range items {
		s.CreateItem(ctx, item)
	}

	// Search by title
	results, err := s.ListItems(ctx, model.ItemFilter{Query: "Go"})
	if err != nil {
		t.Fatalf("ListItems search: %v", err)
	}
	if len(results) != 2 { // "Go Blog" + "learn Go interop"
		t.Errorf("search 'Go' results = %d, want 2", len(results))
	}

	// Search by domain
	results, _ = s.ListItems(ctx, model.ItemFilter{Query: "rust"})
	if len(results) != 1 {
		t.Errorf("search 'rust' results = %d, want 1", len(results))
	}

	// No results
	results, _ = s.ListItems(ctx, model.ItemFilter{Query: "javascript"})
	if len(results) != 0 {
		t.Errorf("search 'javascript' results = %d, want 0", len(results))
	}
}

func TestDeleteItem(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	item := makeItem("item-1", "https://example.com/1")
	s.CreateItem(ctx, item)

	a := model.NewArtifact("a-1", "item-1", model.ArtifactSummary, `{}`)
	s.UpsertArtifact(ctx, a)

	intent := model.NewIntent("int-1", "item-1", "learn Go")
	s.CreateIntent(ctx, intent)

	if err := s.DeleteItem(ctx, "item-1"); err != nil {
		t.Fatalf("DeleteItem: %v", err)
	}

	_, err := s.GetItem(ctx, "item-1")
	if err == nil {
		t.Error("expected error after delete")
	}
}

func TestBatchUpdateStatus(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	for _, id := range []string{"a", "b", "c"} {
		item := makeItem(id, "https://example.com/"+id)
		item.Status = model.StatusReady
		s.CreateItem(ctx, item)
	}

	n, err := s.BatchUpdateStatus(ctx, []string{"a", "b"}, model.StatusArchived)
	if err != nil {
		t.Fatalf("BatchUpdateStatus: %v", err)
	}
	if n != 2 {
		t.Errorf("updated = %d, want 2", n)
	}

	got, _ := s.GetItem(ctx, "a")
	if got.Status != model.StatusArchived {
		t.Errorf("item a status = %q, want ARCHIVED", got.Status)
	}
	got, _ = s.GetItem(ctx, "c")
	if got.Status != model.StatusReady {
		t.Errorf("item c status = %q, want READY", got.Status)
	}
}

func TestBatchDeleteItems(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	for _, id := range []string{"a", "b", "c"} {
		item := makeItem(id, "https://example.com/"+id)
		s.CreateItem(ctx, item)
	}

	n, err := s.BatchDeleteItems(ctx, []string{"a", "b"})
	if err != nil {
		t.Fatalf("BatchDeleteItems: %v", err)
	}
	if n != 2 {
		t.Errorf("deleted = %d, want 2", n)
	}

	all, _ := s.ListItems(ctx, model.ItemFilter{})
	if len(all) != 1 {
		t.Errorf("remaining items = %d, want 1", len(all))
	}
}

func TestMigration(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "migrate.db")
	db, err := OpenSQLite(dbPath)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer db.Close()

	s, err := New(db)
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	// Verify schema version is at current.
	var version int
	if err := db.QueryRow("SELECT version FROM schema_version").Scan(&version); err != nil {
		t.Fatalf("read version: %v", err)
	}
	if version != currentSchemaVersion {
		t.Errorf("schema version = %d, want %d", version, currentSchemaVersion)
	}

	// Running New again should be idempotent.
	s2, err := New(db)
	if err != nil {
		t.Fatalf("New (second time): %v", err)
	}
	_ = s
	_ = s2
}
