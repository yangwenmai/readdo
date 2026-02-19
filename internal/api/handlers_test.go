package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/yangwenmai/readdo/internal/model"
	"github.com/yangwenmai/readdo/internal/store"
)

func newTestServer(t *testing.T) (*Server, *store.Store) {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "test.db")
	db, err := store.OpenSQLite(dbPath)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	s, err := store.New(db)
	if err != nil {
		t.Fatalf("new store: %v", err)
	}

	srv := New(s)
	return srv, s
}

func doRequest(t *testing.T, handler http.Handler, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	var bodyReader *strings.Reader
	if body != "" {
		bodyReader = strings.NewReader(body)
	} else {
		bodyReader = strings.NewReader("")
	}
	req := httptest.NewRequest(method, path, bodyReader)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	return rr
}

func decodeJSON(t *testing.T, rr *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var result map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode JSON: %v\nbody: %s", err, rr.Body.String())
	}
	return result
}

func TestCapture(t *testing.T) {
	srv, _ := newTestServer(t)
	h := srv.Handler()

	rr := doRequest(t, h, "POST", "/api/capture", `{"url":"https://example.com","title":"Test","intent_text":"learn stuff"}`)
	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d, body: %s", rr.Code, http.StatusCreated, rr.Body.String())
	}

	result := decodeJSON(t, rr)
	if result["status"] != model.StatusCaptured {
		t.Errorf("status = %v, want CAPTURED", result["status"])
	}
	if result["merged"] != false {
		t.Errorf("merged = %v, want false", result["merged"])
	}
}

func TestCapture_MissingURL(t *testing.T) {
	srv, _ := newTestServer(t)
	h := srv.Handler()

	rr := doRequest(t, h, "POST", "/api/capture", `{"title":"Test"}`)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rr.Code, http.StatusBadRequest)
	}
}

func TestCapture_DuplicateMerge(t *testing.T) {
	srv, _ := newTestServer(t)
	h := srv.Handler()

	doRequest(t, h, "POST", "/api/capture", `{"url":"https://example.com","intent_text":"first"}`)
	rr := doRequest(t, h, "POST", "/api/capture", `{"url":"https://example.com","intent_text":"second"}`)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	result := decodeJSON(t, rr)
	if result["merged"] != true {
		t.Errorf("merged = %v, want true", result["merged"])
	}
}

func TestListItems(t *testing.T) {
	srv, _ := newTestServer(t)
	h := srv.Handler()

	doRequest(t, h, "POST", "/api/capture", `{"url":"https://example.com/1","title":"One"}`)
	doRequest(t, h, "POST", "/api/capture", `{"url":"https://example.com/2","title":"Two"}`)

	rr := doRequest(t, h, "GET", "/api/items?status=CAPTURED", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusOK)
	}

	var items []map[string]any
	json.Unmarshal(rr.Body.Bytes(), &items)
	if len(items) != 2 {
		t.Errorf("items = %d, want 2", len(items))
	}
}

func TestListItems_Search(t *testing.T) {
	srv, _ := newTestServer(t)
	h := srv.Handler()

	doRequest(t, h, "POST", "/api/capture", `{"url":"https://go.dev","title":"Go Blog"}`)
	doRequest(t, h, "POST", "/api/capture", `{"url":"https://rust-lang.org","title":"Rust"}`)

	rr := doRequest(t, h, "GET", "/api/items?q=Go", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	var items []map[string]any
	json.Unmarshal(rr.Body.Bytes(), &items)
	if len(items) != 1 {
		t.Errorf("search 'Go' items = %d, want 1", len(items))
	}
}

func TestGetItem(t *testing.T) {
	srv, _ := newTestServer(t)
	h := srv.Handler()

	rr := doRequest(t, h, "POST", "/api/capture", `{"url":"https://example.com","title":"Test"}`)
	capture := decodeJSON(t, rr)
	id := capture["id"].(string)

	rr = doRequest(t, h, "GET", "/api/items/"+id, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusOK)
	}
}

func TestGetItem_NotFound(t *testing.T) {
	srv, _ := newTestServer(t)
	h := srv.Handler()

	rr := doRequest(t, h, "GET", "/api/items/nonexistent", "")
	if rr.Code != http.StatusNotFound {
		t.Errorf("status = %d, want %d", rr.Code, http.StatusNotFound)
	}
}

func TestDeleteItem(t *testing.T) {
	srv, _ := newTestServer(t)
	h := srv.Handler()

	rr := doRequest(t, h, "POST", "/api/capture", `{"url":"https://example.com","title":"Test"}`)
	id := decodeJSON(t, rr)["id"].(string)

	rr = doRequest(t, h, "DELETE", "/api/items/"+id, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("delete status = %d, want %d, body: %s", rr.Code, http.StatusOK, rr.Body.String())
	}

	rr = doRequest(t, h, "GET", "/api/items/"+id, "")
	if rr.Code != http.StatusNotFound {
		t.Errorf("after delete, get status = %d, want %d", rr.Code, http.StatusNotFound)
	}
}

func TestDeleteItem_NotFound(t *testing.T) {
	srv, _ := newTestServer(t)
	h := srv.Handler()

	rr := doRequest(t, h, "DELETE", "/api/items/nonexistent", "")
	if rr.Code != http.StatusNotFound {
		t.Errorf("status = %d, want %d", rr.Code, http.StatusNotFound)
	}
}

func TestBatchStatus(t *testing.T) {
	srv, st := newTestServer(t)
	h := srv.Handler()

	rr1 := doRequest(t, h, "POST", "/api/capture", `{"url":"https://example.com/1","title":"One"}`)
	rr2 := doRequest(t, h, "POST", "/api/capture", `{"url":"https://example.com/2","title":"Two"}`)
	id1 := decodeJSON(t, rr1)["id"].(string)
	id2 := decodeJSON(t, rr2)["id"].(string)

	// Make them READY so they can be archived
	ctx := context.Background()
	st.UpdateItemStatus(ctx, id1, model.StatusReady, nil)
	st.UpdateItemStatus(ctx, id2, model.StatusReady, nil)

	body := `{"ids":["` + id1 + `","` + id2 + `"],"status":"ARCHIVED"}`
	rr := doRequest(t, h, "POST", "/api/items/batch/status", body)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body: %s", rr.Code, http.StatusOK, rr.Body.String())
	}
	result := decodeJSON(t, rr)
	if result["updated"] != float64(2) {
		t.Errorf("updated = %v, want 2", result["updated"])
	}
}

func TestBatchStatus_InvalidStatus(t *testing.T) {
	srv, _ := newTestServer(t)
	h := srv.Handler()

	rr := doRequest(t, h, "POST", "/api/items/batch/status", `{"ids":["x"],"status":"PROCESSING"}`)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rr.Code, http.StatusBadRequest)
	}
}

func TestBatchDelete(t *testing.T) {
	srv, _ := newTestServer(t)
	h := srv.Handler()

	rr1 := doRequest(t, h, "POST", "/api/capture", `{"url":"https://example.com/1","title":"One"}`)
	rr2 := doRequest(t, h, "POST", "/api/capture", `{"url":"https://example.com/2","title":"Two"}`)
	id1 := decodeJSON(t, rr1)["id"].(string)
	id2 := decodeJSON(t, rr2)["id"].(string)

	body := `{"ids":["` + id1 + `","` + id2 + `"]}`
	rr := doRequest(t, h, "POST", "/api/items/batch/delete", body)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body: %s", rr.Code, http.StatusOK, rr.Body.String())
	}
	result := decodeJSON(t, rr)
	if result["deleted"] != float64(2) {
		t.Errorf("deleted = %v, want 2", result["deleted"])
	}

	// Verify items are gone
	rr = doRequest(t, h, "GET", "/api/items", "")
	var items []map[string]any
	json.Unmarshal(rr.Body.Bytes(), &items)
	if len(items) != 0 {
		t.Errorf("remaining items = %d, want 0", len(items))
	}
}
