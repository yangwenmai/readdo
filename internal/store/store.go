package store

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/yangwenmai/readdo/internal/model"
)

// Store provides data access to the SQLite database.
type Store struct {
	db *sql.DB
}

// New creates a new Store and initialises the schema.
func New(db *sql.DB) (*Store, error) {
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return s, nil
}

func (s *Store) migrate() error {
	schema := `
	CREATE TABLE IF NOT EXISTS items (
		id          TEXT PRIMARY KEY,
		url         TEXT NOT NULL,
		title       TEXT,
		domain      TEXT,
		source_type TEXT NOT NULL,
		intent_text TEXT,
		status      TEXT NOT NULL,
		priority    TEXT,
		match_score REAL,
		error_info  TEXT,
		created_at  TEXT NOT NULL,
		updated_at  TEXT NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_items_status ON items(status, updated_at);
	CREATE INDEX IF NOT EXISTS idx_items_priority ON items(priority, match_score DESC);

	CREATE TABLE IF NOT EXISTS artifacts (
		id            TEXT PRIMARY KEY,
		item_id       TEXT NOT NULL REFERENCES items(id),
		artifact_type TEXT NOT NULL,
		payload       TEXT NOT NULL,
		created_by    TEXT NOT NULL,
		created_at    TEXT NOT NULL
	);
	CREATE UNIQUE INDEX IF NOT EXISTS idx_artifacts_unique ON artifacts(item_id, artifact_type);
	`
	_, err := s.db.Exec(schema)
	return err
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

// CreateItem inserts a new item.
func (s *Store) CreateItem(item model.Item) error {
	_, err := s.db.Exec(`
		INSERT INTO items (id, url, title, domain, source_type, intent_text, status, priority, match_score, error_info, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		item.ID, item.URL, item.Title, item.Domain, item.SourceType, item.IntentText,
		item.Status, item.Priority, item.MatchScore, item.ErrorInfo,
		item.CreatedAt, item.UpdatedAt,
	)
	return err
}

// GetItem returns an item together with its artifacts.
func (s *Store) GetItem(id string) (*model.ItemWithArtifacts, error) {
	row := s.db.QueryRow(`SELECT id, url, title, domain, source_type, intent_text, status, priority, match_score, error_info, created_at, updated_at FROM items WHERE id = ?`, id)
	item, err := scanItem(row)
	if err != nil {
		return nil, err
	}

	artifacts, err := s.listArtifacts(id)
	if err != nil {
		return nil, err
	}
	return &model.ItemWithArtifacts{Item: *item, Artifacts: artifacts}, nil
}

// ListItems returns items matching the given filter, ordered by priority/score.
func (s *Store) ListItems(f model.ItemFilter) ([]model.Item, error) {
	query := `SELECT id, url, title, domain, source_type, intent_text, status, priority, match_score, error_info, created_at, updated_at FROM items`
	var conditions []string
	var args []interface{}

	if len(f.Status) > 0 {
		placeholders := make([]string, len(f.Status))
		for i, st := range f.Status {
			placeholders[i] = "?"
			args = append(args, st)
		}
		conditions = append(conditions, "status IN ("+strings.Join(placeholders, ",")+") ")
	}
	if len(f.Priority) > 0 {
		placeholders := make([]string, len(f.Priority))
		for i, p := range f.Priority {
			placeholders[i] = "?"
			args = append(args, p)
		}
		conditions = append(conditions, "priority IN ("+strings.Join(placeholders, ",")+") ")
	}

	if len(conditions) > 0 {
		query += " WHERE " + strings.Join(conditions, " AND ")
	}
	query += " ORDER BY CASE status WHEN 'PROCESSING' THEN 0 WHEN 'CAPTURED' THEN 1 WHEN 'FAILED' THEN 2 WHEN 'READY' THEN 3 ELSE 4 END, COALESCE(match_score, 0) DESC, updated_at DESC"

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []model.Item
	for rows.Next() {
		var item model.Item
		if err := rows.Scan(&item.ID, &item.URL, &item.Title, &item.Domain, &item.SourceType, &item.IntentText, &item.Status, &item.Priority, &item.MatchScore, &item.ErrorInfo, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// UpdateItemStatus changes the status of an item with validation.
func (s *Store) UpdateItemStatus(id, newStatus string, errorInfo *string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := s.db.Exec(`UPDATE items SET status = ?, error_info = ?, updated_at = ? WHERE id = ?`, newStatus, errorInfo, now, id)
	return err
}

// UpdateItemScoreAndPriority sets the AI-derived score and priority.
func (s *Store) UpdateItemScoreAndPriority(id string, score float64, priority string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := s.db.Exec(`UPDATE items SET match_score = ?, priority = ?, updated_at = ? WHERE id = ?`, score, priority, now, id)
	return err
}

// ClaimNextCaptured atomically picks the oldest CAPTURED item and sets it to PROCESSING.
// Returns nil if no item is available.
func (s *Store) ClaimNextCaptured() (*model.Item, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	row := s.db.QueryRow(`
		UPDATE items SET status = ?, updated_at = ?
		WHERE id = (SELECT id FROM items WHERE status = ? ORDER BY created_at ASC LIMIT 1)
		RETURNING id, url, title, domain, source_type, intent_text, status, priority, match_score, error_info, created_at, updated_at`,
		model.StatusProcessing, now, model.StatusCaptured,
	)
	item, err := scanItem(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return item, err
}

// ResetStaleProcessing resets any PROCESSING items back to CAPTURED (for server restart).
func (s *Store) ResetStaleProcessing() (int64, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	res, err := s.db.Exec(`UPDATE items SET status = ?, updated_at = ? WHERE status = ?`, model.StatusCaptured, now, model.StatusProcessing)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

// UpsertArtifact inserts or replaces an artifact (one per item per type).
func (s *Store) UpsertArtifact(a model.Artifact) error {
	_, err := s.db.Exec(`
		INSERT INTO artifacts (id, item_id, artifact_type, payload, created_by, created_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(item_id, artifact_type) DO UPDATE SET
			id = excluded.id,
			payload = excluded.payload,
			created_by = excluded.created_by,
			created_at = excluded.created_at`,
		a.ID, a.ItemID, a.ArtifactType, a.Payload, a.CreatedBy, a.CreatedAt,
	)
	return err
}

func (s *Store) listArtifacts(itemID string) ([]model.Artifact, error) {
	rows, err := s.db.Query(`SELECT id, item_id, artifact_type, payload, created_by, created_at FROM artifacts WHERE item_id = ? ORDER BY created_at ASC`, itemID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var artifacts []model.Artifact
	for rows.Next() {
		var a model.Artifact
		if err := rows.Scan(&a.ID, &a.ItemID, &a.ArtifactType, &a.Payload, &a.CreatedBy, &a.CreatedAt); err != nil {
			return nil, err
		}
		artifacts = append(artifacts, a)
	}
	return artifacts, rows.Err()
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

type scanner interface {
	Scan(dest ...interface{}) error
}

func scanItem(row scanner) (*model.Item, error) {
	var item model.Item
	err := row.Scan(&item.ID, &item.URL, &item.Title, &item.Domain, &item.SourceType, &item.IntentText, &item.Status, &item.Priority, &item.MatchScore, &item.ErrorInfo, &item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &item, nil
}
