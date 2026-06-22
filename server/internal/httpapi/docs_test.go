package httpapi

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestDocsAndVersionArePublic(t *testing.T) {
	c := newTestAPI(t)

	// The OpenAPI spec is served without authentication.
	resp := c.do(http.MethodGet, "/api/openapi.yaml", nil, false)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("openapi.yaml = %d, want 200", resp.StatusCode)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if !strings.Contains(string(body), "openapi:") {
		t.Fatalf("spec does not look like OpenAPI:\n%.80s", body)
	}

	// Swagger UI page.
	resp = c.do(http.MethodGet, "/api/docs", nil, false)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("docs = %d, want 200", resp.StatusCode)
	}
	html, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if !strings.Contains(string(html), "swagger-ui") {
		t.Fatalf("docs page is not Swagger UI")
	}

	// Version endpoint.
	resp = c.do(http.MethodGet, "/api/v1/version", nil, false)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("version = %d, want 200", resp.StatusCode)
	}
	var v struct {
		Version string `json:"version"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&v)
	resp.Body.Close()
	if v.Version == "" {
		t.Fatalf("version is empty")
	}
}
