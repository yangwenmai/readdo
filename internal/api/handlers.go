package api

import (
	"database/sql"
	"encoding/json"
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

	item := model.NewItem(
		uuid.New().String(),
		req.URL,
		req.Title,
		req.Domain,
		req.SourceType,
		req.IntentText,
	)

	if err := s.store.CreateItem(item); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create item")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]string{
		"id":     item.ID,
		"status": item.Status,
	})
}

// ---------------------------------------------------------------------------
// GET /api/items
// ---------------------------------------------------------------------------

func (s *Server) handleListItems(w http.ResponseWriter, r *http.Request) {
	filter := model.ItemFilter{
		Status:   splitComma(r.URL.Query().Get("status")),
		Priority: splitComma(r.URL.Query().Get("priority")),
	}

	items, err := s.store.ListItems(filter)
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

	item, err := s.store.GetItem(id)
	if err == sql.ErrNoRows {
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
// POST /api/items/{id}/retry
// ---------------------------------------------------------------------------

func (s *Server) handleRetry(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	item, err := s.store.GetItem(id)
	if err == sql.ErrNoRows {
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

	if err := s.store.UpdateItemStatus(id, model.StatusCaptured, nil); err != nil {
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

	item, err := s.store.GetItem(id)
	if err == sql.ErrNoRows {
		writeError(w, http.StatusNotFound, "item not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get item")
		return
	}

	// Validate transition.
	if item.Status == model.StatusProcessing {
		writeError(w, http.StatusConflict, "cannot change status while PROCESSING")
		return
	}

	switch req.Status {
	case model.StatusArchived:
		if item.Status != model.StatusReady && item.Status != model.StatusFailed {
			writeError(w, http.StatusConflict, "can only archive READY or FAILED items")
			return
		}
	case model.StatusReady:
		if item.Status != model.StatusArchived {
			writeError(w, http.StatusConflict, "can only restore ARCHIVED items to READY")
			return
		}
	default:
		writeError(w, http.StatusBadRequest, "status must be ARCHIVED or READY")
		return
	}

	if err := s.store.UpdateItemStatus(id, req.Status, nil); err != nil {
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
		model.ArtifactSummary: true,
		model.ArtifactTodos:   true,
	}
	if !validTypes[artifactType] {
		writeError(w, http.StatusBadRequest, "only summary and todos can be edited")
		return
	}

	item, err := s.store.GetItem(itemID)
	if err == sql.ErrNoRows {
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

	if err := s.store.UpsertArtifact(artifact); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save artifact")
		return
	}

	writeJSON(w, http.StatusOK, artifact)
}
