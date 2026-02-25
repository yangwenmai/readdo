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
	_ IntentStore   = (*Store)(nil)
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
const currentSchemaVersion = 4

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
		s.migrateV2, // v1 → v2: add save_count column
		s.migrateV3, // v2 → v3: add intents table, migrate existing intent_text
		s.migrateV4, // v3 → v4: rename priority values (READ_NEXT→DO_FIRST, etc.)
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

// migrateV2 adds the save_count column (v1 → v2).
func (s *Store) migrateV2() error {
	_, err := s.db.Exec(`ALTER TABLE items ADD COLUMN save_count INTEGER NOT NULL DEFAULT 1`)
	return err
}

// migrateV3 adds the intents table and migrates existing intent_text data (v2 → v3).
func (s *Store) migrateV3() error {
	// Create intents table.
	if _, err := s.db.Exec(`
		CREATE TABLE IF NOT EXISTS intents (
			id         TEXT PRIMARY KEY,
			item_id    TEXT NOT NULL REFERENCES items(id),
			text       TEXT NOT NULL,
			created_at TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_intents_item ON intents(item_id, created_at ASC);
	`); err != nil {
		return fmt.Errorf("create intents table: %w", err)
	}

	// Migrate existing intent_text into individual intent records.
	rows, err := s.db.Query(`SELECT id, intent_text, created_at FROM items WHERE intent_text != ''`)
	if err != nil {
		return fmt.Errorf("read items for intent migration: %w", err)
	}
	defer rows.Close()

	stmt, err := s.db.Prepare(`INSERT INTO intents (id, item_id, text, created_at) VALUES (?, ?, ?, ?)`)
	if err != nil {
		return fmt.Errorf("prepare intent insert: %w", err)
	}
	defer stmt.Close()

	for rows.Next() {
		var itemID, intentText, createdAt string
		if err := rows.Scan(&itemID, &intentText, &createdAt); err != nil {
			return fmt.Errorf("scan item: %w", err)
		}
		// Split by the old separator.
		parts := strings.Split(intentText, "\n---\n")
		for _, part := range parts {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			id := fmt.Sprintf("migrated-%s-%d", itemID, len(part))
			if _, err := stmt.Exec(id, itemID, part, createdAt); err != nil {
				return fmt.Errorf("insert migrated intent: %w", err)
			}
		}
	}
	return rows.Err()
}

// migrateV4 renames priority values from the old naming to the new action-oriented naming (v3 → v4).
// Also updates the priority field inside score artifact JSON payloads.
func (s *Store) migrateV4() error {
	renames := [][2]string{
		{"READ_NEXT", "DO_FIRST"},
		{"WORTH_IT", "PLAN_IT"},
		{"IF_TIME", "SKIM_IT"},
		{"SKIP", "LET_GO"},
	}

	for _, r := range renames {
		if _, err := s.db.Exec(`UPDATE items SET priority = ? WHERE priority = ?`, r[1], r[0]); err != nil {
			return fmt.Errorf("rename priority %s→%s: %w", r[0], r[1], err)
		}
		if _, err := s.db.Exec(
			`UPDATE artifacts SET payload = REPLACE(payload, ?, ?) WHERE artifact_type = 'score' AND payload LIKE ?`,
			`"priority":"`+r[0]+`"`, `"priority":"`+r[1]+`"`, `%`+r[0]+`%`,
		); err != nil {
			return fmt.Errorf("rename score artifact priority %s→%s: %w", r[0], r[1], err)
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

// CreateItem inserts a new item.
func (s *Store) CreateItem(ctx context.Context, item model.Item) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO items (id, url, title, domain, source_type, intent_text, status, priority, match_score, error_info, save_count, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		item.ID, item.URL, item.Title, item.Domain, item.SourceType, item.IntentText,
		item.Status, item.Priority, item.MatchScore, item.ErrorInfo, item.SaveCount,
		item.CreatedAt, item.UpdatedAt,
	)
	return err
}

// GetItem returns an item together with its artifacts and intents.
func (s *Store) GetItem(ctx context.Context, id string) (*model.ItemWithArtifacts, error) {
	row := s.db.QueryRowContext(ctx, `SELECT id, url, title, domain, source_type, intent_text, status, priority, match_score, error_info, save_count, created_at, updated_at FROM items WHERE id = ?`, id)
	item, err := scanItem(row)
	if err != nil {
		return nil, err
	}

	artifacts, err := s.listArtifacts(ctx, id)
	if err != nil {
		return nil, err
	}

	// Intents may not exist yet if migration v3 hasn't run; treat as empty.
	intents, _ := s.listIntents(ctx, id)

	return &model.ItemWithArtifacts{Item: *item, Artifacts: artifacts, Intents: intents}, nil
}

// ListItems returns items matching the given filter, ordered by priority/score.
func (s *Store) ListItems(ctx context.Context, f model.ItemFilter) ([]model.Item, error) {
	query := `SELECT id, url, title, domain, source_type, intent_text, status, priority, match_score, error_info, save_count, created_at, updated_at FROM items`
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
	if f.Query != "" {
		like := "%" + f.Query + "%"
		conditions = append(conditions, "(title LIKE ? OR domain LIKE ? OR intent_text LIKE ?)")
		args = append(args, like, like, like)
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
		if err := rows.Scan(&item.ID, &item.URL, &item.Title, &item.Domain, &item.SourceType, &item.IntentText, &item.Status, &item.Priority, &item.MatchScore, &item.ErrorInfo, &item.SaveCount, &item.CreatedAt, &item.UpdatedAt); err != nil {
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
		RETURNING id, url, title, domain, source_type, intent_text, status, priority, match_score, error_info, save_count, created_at, updated_at`,
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
		`SELECT id, url, title, domain, source_type, intent_text, status, priority, match_score, error_info, save_count, created_at, updated_at
		 FROM items WHERE url = ? AND status != ? ORDER BY created_at DESC LIMIT 1`,
		url, model.StatusArchived,
	)
	item, err := scanItem(row)
	if err != nil {
		return nil, err
	}
	return item, nil
}

// UpdateItemForReprocess merges the new intent, increments save_count, and resets the
// item to CAPTURED status so it will be re-processed by the pipeline.
func (s *Store) UpdateItemForReprocess(ctx context.Context, id, intentText string, saveCount int) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := s.db.ExecContext(ctx,
		`UPDATE items SET intent_text = ?, save_count = ?, status = ?, error_info = NULL, updated_at = ? WHERE id = ?`,
		intentText, saveCount, model.StatusCaptured, now, id,
	)
	return err
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

// DeleteItem removes an item and its associated artifacts and intents.
func (s *Store) DeleteItem(ctx context.Context, id string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `DELETE FROM intents WHERE item_id = ?`, id); err != nil {
		return fmt.Errorf("delete intents: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM artifacts WHERE item_id = ?`, id); err != nil {
		return fmt.Errorf("delete artifacts: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM items WHERE id = ?`, id); err != nil {
		return fmt.Errorf("delete item: %w", err)
	}

	return tx.Commit()
}

// BatchUpdateStatus changes the status of multiple items at once.
func (s *Store) BatchUpdateStatus(ctx context.Context, ids []string, status string) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	now := time.Now().UTC().Format(time.RFC3339)
	placeholders := make([]string, len(ids))
	args := make([]interface{}, 0, len(ids)+2)
	args = append(args, status, now)
	for i, id := range ids {
		placeholders[i] = "?"
		args = append(args, id)
	}
	query := fmt.Sprintf(`UPDATE items SET status = ?, updated_at = ? WHERE id IN (%s)`, strings.Join(placeholders, ","))
	res, err := s.db.ExecContext(ctx, query, args...)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// BatchDeleteItems removes multiple items and their associated data.
func (s *Store) BatchDeleteItems(ctx context.Context, ids []string) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	placeholders := make([]string, len(ids))
	args := make([]interface{}, len(ids))
	for i, id := range ids {
		placeholders[i] = "?"
		args[i] = id
	}
	inClause := strings.Join(placeholders, ",")

	if _, err := tx.ExecContext(ctx, fmt.Sprintf(`DELETE FROM intents WHERE item_id IN (%s)`, inClause), args...); err != nil {
		return 0, fmt.Errorf("delete intents: %w", err)
	}
	if _, err := tx.ExecContext(ctx, fmt.Sprintf(`DELETE FROM artifacts WHERE item_id IN (%s)`, inClause), args...); err != nil {
		return 0, fmt.Errorf("delete artifacts: %w", err)
	}
	res, err := tx.ExecContext(ctx, fmt.Sprintf(`DELETE FROM items WHERE id IN (%s)`, inClause), args...)
	if err != nil {
		return 0, fmt.Errorf("delete items: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// CountByStatus returns the number of inbox (non-ARCHIVED) and archived items.
func (s *Store) CountByStatus(ctx context.Context) (StatusCounts, error) {
	var counts StatusCounts
	row := s.db.QueryRowContext(ctx, `
		SELECT
			COALESCE(SUM(CASE WHEN status != ? THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN status  = ? THEN 1 ELSE 0 END), 0)
		FROM items`, model.StatusArchived, model.StatusArchived)
	if err := row.Scan(&counts.Inbox, &counts.Archive); err != nil {
		return counts, err
	}
	return counts, nil
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
// Intents
// ---------------------------------------------------------------------------

// CreateIntent inserts a new intent record.
func (s *Store) CreateIntent(ctx context.Context, intent model.Intent) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO intents (id, item_id, text, created_at) VALUES (?, ?, ?, ?)`,
		intent.ID, intent.ItemID, intent.Text, intent.CreatedAt,
	)
	return err
}

// listIntents returns all intents for an item, ordered by creation time.
func (s *Store) listIntents(ctx context.Context, itemID string) ([]model.Intent, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, item_id, text, created_at FROM intents WHERE item_id = ? ORDER BY created_at ASC`, itemID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var intents []model.Intent
	for rows.Next() {
		var i model.Intent
		if err := rows.Scan(&i.ID, &i.ItemID, &i.Text, &i.CreatedAt); err != nil {
			return nil, err
		}
		intents = append(intents, i)
	}
	return intents, rows.Err()
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

type scanner interface {
	Scan(dest ...interface{}) error
}

func scanItem(row scanner) (*model.Item, error) {
	var item model.Item
	err := row.Scan(&item.ID, &item.URL, &item.Title, &item.Domain, &item.SourceType, &item.IntentText, &item.Status, &item.Priority, &item.MatchScore, &item.ErrorInfo, &item.SaveCount, &item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &item, nil
}
