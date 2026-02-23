package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"time"

	"github.com/google/uuid"
	"github.com/yangwenmai/readdo/internal/model"
)

// ---------------------------------------------------------------------------
// POST /api/capture
// ---------------------------------------------------------------------------

type captureRequest struct {
	URL        string `json:"url"`
	Title      string `json:"title"`
	Domain     string `json:"domain"`
	SourceType string `json:"source_type"`
	IntentText string `json:"intent_text"`
}

func (s *Server) handleCapture(w http.ResponseWriter, r *http.Request) {
	var req captureRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.URL == "" {
		writeError(w, http.StatusBadRequest, "url is required")
		return
	}
	if req.SourceType == "" {
		req.SourceType = "web"
	}
	// Auto-extract domain if not provided.
	if req.Domain == "" {
		if u, err := url.Parse(req.URL); err == nil {
			req.Domain = u.Hostname()
		}
	}

	// Check if an active (non-ARCHIVED) item already exists for this URL.
	// If so, merge the new intent and re-queue for processing instead of rejecting.
	existing, err := s.store.FindItemByURL(r.Context(), req.URL)
	if err == nil && existing != nil {
		existing.MergeIntent(req.IntentText)
		if err := s.store.UpdateItemForReprocess(r.Context(), existing.ID, existing.IntentText, existing.SaveCount); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to update item")
			return
		}
		// Record the intent as a separate timestamped entry.
		if req.IntentText != "" {
			intent := model.NewIntent(uuid.New().String(), existing.ID, req.IntentText)
			_ = s.store.CreateIntent(r.Context(), intent) // best-effort
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"id":         existing.ID,
			"status":     model.StatusCaptured,
			"merged":     true,
			"save_count": existing.SaveCount,
			"message":    "intent merged, item re-queued for processing",
		})
		return
	}

	item := model.NewItem(
		uuid.New().String(),
		req.URL,
		req.Title,
		req.Domain,
		req.SourceType,
		req.IntentText,
	)

	if err := s.store.CreateItem(r.Context(), item); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create item")
		return
	}

	// Record the initial intent as a separate timestamped entry.
	if req.IntentText != "" {
		intent := model.NewIntent(uuid.New().String(), item.ID, req.IntentText)
		_ = s.store.CreateIntent(r.Context(), intent) // best-effort
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"id":         item.ID,
		"status":     item.Status,
		"merged":     false,
		"save_count": item.SaveCount,
	})
}

// ---------------------------------------------------------------------------
// GET /api/items
// ---------------------------------------------------------------------------

func (s *Server) handleListItems(w http.ResponseWriter, r *http.Request) {
	filter := model.ItemFilter{
		Status:   splitComma(r.URL.Query().Get("status")),
		Priority: splitComma(r.URL.Query().Get("priority")),
		Query:    r.URL.Query().Get("q"),
	}

	items, err := s.store.ListItems(r.Context(), filter)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list items")
		return
	}
	if items == nil {
		items = []model.Item{}
	}
	writeJSON(w, http.StatusOK, items)
}

// ---------------------------------------------------------------------------
// GET /api/items/{id}
// ---------------------------------------------------------------------------

func (s *Server) handleGetItem(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "id is required")
		return
	}

	item, err := s.store.GetItem(r.Context(), id)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "item not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get item")
		return
	}

	writeJSON(w, http.StatusOK, item)
}

// ---------------------------------------------------------------------------
// DELETE /api/items/{id}
// ---------------------------------------------------------------------------

func (s *Server) handleDeleteItem(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	item, err := s.store.GetItem(r.Context(), id)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "item not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get item")
		return
	}

	if item.Status == model.StatusProcessing {
		writeError(w, http.StatusConflict, "cannot delete while PROCESSING")
		return
	}

	if err := s.store.DeleteItem(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete item")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"id": id, "deleted": "true"})
}

// ---------------------------------------------------------------------------
// POST /api/items/{id}/retry
// ---------------------------------------------------------------------------

func (s *Server) handleRetry(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	item, err := s.store.GetItem(r.Context(), id)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "item not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get item")
		return
	}

	if item.Status != model.StatusFailed {
		writeError(w, http.StatusConflict, "only FAILED items can be retried")
		return
	}

	if err := s.store.UpdateItemStatus(r.Context(), id, model.StatusCaptured, nil); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update status")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"id": id, "status": model.StatusCaptured})
}

// ---------------------------------------------------------------------------
// POST /api/items/{id}/reprocess
// ---------------------------------------------------------------------------

func (s *Server) handleReprocess(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	item, err := s.store.GetItem(r.Context(), id)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "item not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get item")
		return
	}

	// Allow reprocessing for READY and FAILED items.
	if item.Status != model.StatusReady && item.Status != model.StatusFailed {
		writeError(w, http.StatusConflict, "only READY or FAILED items can be reprocessed")
		return
	}

	if err := s.store.UpdateItemStatus(r.Context(), id, model.StatusCaptured, nil); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update status")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"id": id, "status": model.StatusCaptured})
}

// ---------------------------------------------------------------------------
// PATCH /api/items/{id}/status
// ---------------------------------------------------------------------------

type statusRequest struct {
	Status string `json:"status"` // "ARCHIVED" or "READY" (restore)
}

func (s *Server) handleUpdateStatus(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	var req statusRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	item, err := s.store.GetItem(r.Context(), id)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "item not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get item")
		return
	}

	// Validate transition using domain model.
	if err := item.ValidateTransition(req.Status); err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}

	if err := s.store.UpdateItemStatus(r.Context(), id, req.Status, nil); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update status")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"id": id, "status": req.Status})
}

// ---------------------------------------------------------------------------
// PUT /api/items/{id}/artifacts/{type}
// ---------------------------------------------------------------------------

type editArtifactRequest struct {
	Payload json.RawMessage `json:"payload"`
}

func (s *Server) handleEditArtifact(w http.ResponseWriter, r *http.Request) {
	itemID := r.PathValue("id")
	artifactType := r.PathValue("type")

	// Validate artifact type.
	validTypes := map[string]bool{
		model.ArtifactSynthesis: true,
		model.ArtifactTodos:     true,
	}
	if !validTypes[artifactType] {
		writeError(w, http.StatusBadRequest, "only synthesis and todos can be edited")
		return
	}

	item, err := s.store.GetItem(r.Context(), itemID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "item not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get item")
		return
	}
	if item.Status != model.StatusReady {
		writeError(w, http.StatusConflict, "can only edit artifacts of READY items")
		return
	}

	var req editArtifactRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	artifact := model.Artifact{
		ID:           uuid.New().String(),
		ItemID:       itemID,
		ArtifactType: artifactType,
		Payload:      string(req.Payload),
		CreatedBy:    model.CreatedByUser,
		CreatedAt:    time.Now().UTC().Format(time.RFC3339),
	}

	if err := s.store.UpsertArtifact(r.Context(), artifact); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save artifact")
		return
	}

	writeJSON(w, http.StatusOK, artifact)
}

// ---------------------------------------------------------------------------
// POST /api/items/batch/status
// ---------------------------------------------------------------------------

type batchStatusRequest struct {
	IDs    []string `json:"ids"`
	Status string   `json:"status"`
}

func (s *Server) handleBatchStatus(w http.ResponseWriter, r *http.Request) {
	var req batchStatusRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if len(req.IDs) == 0 {
		writeError(w, http.StatusBadRequest, "ids is required")
		return
	}
	if req.Status != model.StatusArchived && req.Status != model.StatusReady {
		writeError(w, http.StatusBadRequest, "status must be ARCHIVED or READY")
		return
	}

	n, err := s.store.BatchUpdateStatus(r.Context(), req.IDs, req.Status)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update items")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"updated": n})
}

// ---------------------------------------------------------------------------
// POST /api/items/batch/delete
// ---------------------------------------------------------------------------

type batchDeleteRequest struct {
	IDs []string `json:"ids"`
}

func (s *Server) handleBatchDelete(w http.ResponseWriter, r *http.Request) {
	var req batchDeleteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if len(req.IDs) == 0 {
		writeError(w, http.StatusBadRequest, "ids is required")
		return
	}

	n, err := s.store.BatchDeleteItems(r.Context(), req.IDs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete items")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"deleted": n})
}
