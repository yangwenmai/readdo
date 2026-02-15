package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/yangwenmai/readdo/internal/model"
)

// Verify at compile time that Store implements all interfaces.
var (
	_ ItemReader    = (*Store)(nil)
	_ ItemWriter    = (*Store)(nil)
	_ ItemClaimer   = (*Store)(nil)
	_ ArtifactStore = (*Store)(nil)
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

// currentSchemaVersion is bumped whenever the schema changes.
// Add a new migration function in the migrations slice below.
const currentSchemaVersion = 1

func (s *Store) migrate() error {
	// Ensure the schema_version table exists.
	if _, err := s.db.Exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`); err != nil {
		return fmt.Errorf("create schema_version table: %w", err)
	}

	var version int
	err := s.db.QueryRow(`SELECT version FROM schema_version LIMIT 1`).Scan(&version)
	if errors.Is(err, sql.ErrNoRows) {
		// Fresh database: initialize to version 0.
		if _, err := s.db.Exec(`INSERT INTO schema_version (version) VALUES (0)`); err != nil {
			return fmt.Errorf("init schema version: %w", err)
		}
		version = 0
	} else if err != nil {
		return fmt.Errorf("read schema version: %w", err)
	}

	// migrations is an ordered list of migration functions.
	// Index 0 = migration from v0 to v1, etc.
	migrations := []func() error{
		s.migrateV1, // v0 → v1: initial schema
	}

	for i := version; i < len(migrations); i++ {
		if err := migrations[i](); err != nil {
			return fmt.Errorf("migration v%d→v%d: %w", i, i+1, err)
		}
		if _, err := s.db.Exec(`UPDATE schema_version SET version = ?`, i+1); err != nil {
			return fmt.Errorf("update schema version to %d: %w", i+1, err)
		}
	}

	return nil
}

// migrateV1 creates the initial schema (v0 → v1).
func (s *Store) migrateV1() error {
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
func (s *Store) CreateItem(ctx context.Context, item model.Item) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO items (id, url, title, domain, source_type, intent_text, status, priority, match_score, error_info, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		item.ID, item.URL, item.Title, item.Domain, item.SourceType, item.IntentText,
		item.Status, item.Priority, item.MatchScore, item.ErrorInfo,
		item.CreatedAt, item.UpdatedAt,
	)
	return err
}

// GetItem returns an item together with its artifacts.
func (s *Store) GetItem(ctx context.Context, id string) (*model.ItemWithArtifacts, error) {
	row := s.db.QueryRowContext(ctx, `SELECT id, url, title, domain, source_type, intent_text, status, priority, match_score, error_info, created_at, updated_at FROM items WHERE id = ?`, id)
	item, err := scanItem(row)
	if err != nil {
		return nil, err
	}

	artifacts, err := s.listArtifacts(ctx, id)
	if err != nil {
		return nil, err
	}
	return &model.ItemWithArtifacts{Item: *item, Artifacts: artifacts}, nil
}

// ListItems returns items matching the given filter, ordered by priority/score.
func (s *Store) ListItems(ctx context.Context, f model.ItemFilter) ([]model.Item, error) {
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

	rows, err := s.db.QueryContext(ctx, query, args...)
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

// UpdateItemStatus changes the status of an item.
func (s *Store) UpdateItemStatus(ctx context.Context, id, newStatus string, errorInfo *string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := s.db.ExecContext(ctx, `UPDATE items SET status = ?, error_info = ?, updated_at = ? WHERE id = ?`, newStatus, errorInfo, now, id)
	return err
}

// UpdateItemScoreAndPriority sets the AI-derived score and priority.
func (s *Store) UpdateItemScoreAndPriority(ctx context.Context, id string, score float64, priority string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := s.db.ExecContext(ctx, `UPDATE items SET match_score = ?, priority = ?, updated_at = ? WHERE id = ?`, score, priority, now, id)
	return err
}

// ClaimNextCaptured atomically picks the oldest CAPTURED item and sets it to PROCESSING.
// Returns nil if no item is available.
func (s *Store) ClaimNextCaptured(ctx context.Context) (*model.Item, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	row := s.db.QueryRowContext(ctx, `
		UPDATE items SET status = ?, updated_at = ?
		WHERE id = (SELECT id FROM items WHERE status = ? ORDER BY created_at ASC LIMIT 1)
		RETURNING id, url, title, domain, source_type, intent_text, status, priority, match_score, error_info, created_at, updated_at`,
		model.StatusProcessing, now, model.StatusCaptured,
	)
	item, err := scanItem(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return item, err
}

// FindItemByURL returns an active (non-ARCHIVED) item with the given URL, or nil if not found.
func (s *Store) FindItemByURL(ctx context.Context, url string) (*model.Item, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT id, url, title, domain, source_type, intent_text, status, priority, match_score, error_info, created_at, updated_at
		 FROM items WHERE url = ? AND status != ? ORDER BY created_at DESC LIMIT 1`,
		url, model.StatusArchived,
	)
	item, err := scanItem(row)
	if err != nil {
		return nil, err
	}
	return item, nil
}

// ResetStaleProcessing resets any PROCESSING items back to CAPTURED (for server restart).
func (s *Store) ResetStaleProcessing(ctx context.Context) (int64, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	res, err := s.db.ExecContext(ctx, `UPDATE items SET status = ?, updated_at = ? WHERE status = ?`, model.StatusCaptured, now, model.StatusProcessing)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

// UpsertArtifact inserts or replaces an artifact (one per item per type).
func (s *Store) UpsertArtifact(ctx context.Context, a model.Artifact) error {
	_, err := s.db.ExecContext(ctx, `
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

func (s *Store) listArtifacts(ctx context.Context, itemID string) ([]model.Artifact, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, item_id, artifact_type, payload, created_by, created_at FROM artifacts WHERE item_id = ? ORDER BY created_at ASC`, itemID)
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
