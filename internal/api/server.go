package api

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"

	"github.com/yangwenmai/readdo/internal/store"
)

// maxRequestBody is the maximum allowed request body size (1 MB).
const maxRequestBody int64 = 1 << 20

// Server holds the HTTP handlers and dependencies.
type Server struct {
	store store.ItemRepository
	mux   *http.ServeMux
}

// New creates a new API server.
func New(s store.ItemRepository) *Server {
	srv := &Server{store: s, mux: http.NewServeMux()}
	srv.routes()
	return srv
}

// Handler returns the root http.Handler with middleware applied.
func (s *Server) Handler() http.Handler {
	return corsMiddleware(limitBody(jsonContent(s.mux)))
}

func (s *Server) routes() {
	s.mux.HandleFunc("POST /api/capture", s.handleCapture)
	s.mux.HandleFunc("GET /api/items", s.handleListItems)
	s.mux.HandleFunc("GET /api/items/{id}", s.handleGetItem)
	s.mux.HandleFunc("POST /api/items/{id}/retry", s.handleRetry)
	s.mux.HandleFunc("POST /api/items/{id}/reprocess", s.handleReprocess)
	s.mux.HandleFunc("PATCH /api/items/{id}/status", s.handleUpdateStatus)
	s.mux.HandleFunc("PUT /api/items/{id}/artifacts/{type}", s.handleEditArtifact)
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// corsMiddleware sets CORS headers. The allowed origin is configurable via the
// CORS_ORIGIN environment variable; defaults to "*" for development.
func corsMiddleware(next http.Handler) http.Handler {
	origin := os.Getenv("CORS_ORIGIN")
	if origin == "" {
		origin = "*" // TODO: restrict in production
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// limitBody restricts the request body to maxRequestBody bytes.
func limitBody(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxRequestBody)
		next.ServeHTTP(w, r)
	})
}

func jsonContent(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		next.ServeHTTP(w, r)
	})
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func splitComma(s string) []string {
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}
