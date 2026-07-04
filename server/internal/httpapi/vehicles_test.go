package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"
)

func decodeVehicle(t *testing.T, resp *http.Response) map[string]any {
	t.Helper()
	defer resp.Body.Close()
	var v map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
		t.Fatalf("decode vehicle: %v", err)
	}
	return v
}

func TestVehicleCrudAndIsolation(t *testing.T) {
	c := newTestAPI(t)
	wid := createWalletWithBase(t, c, "EUR")
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10) + "/vehicles"

	// Create.
	resp := c.do(http.MethodPost, base, map[string]any{"name": "Car", "plate": "AB123CD", "notes": "diesel"}, true)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create = %d, want 201", resp.StatusCode)
	}
	car := decodeVehicle(t, resp)
	id := int64(car["id"].(float64))
	if car["name"] != "Car" || car["plate"] != "AB123CD" || car["notes"] != "diesel" {
		t.Fatalf("vehicle = %+v", car)
	}

	// Empty name → 400.
	if r := c.do(http.MethodPost, base, map[string]any{"name": ""}, true); r.StatusCode != http.StatusBadRequest {
		t.Fatalf("empty name = %d, want 400", r.StatusCode)
	} else {
		r.Body.Close()
	}

	// Duplicate name → 409.
	if r := c.do(http.MethodPost, base, map[string]any{"name": "Car"}, true); r.StatusCode != http.StatusConflict {
		t.Fatalf("duplicate = %d, want 409", r.StatusCode)
	} else {
		r.Body.Close()
	}

	// List has exactly one.
	lresp := c.do(http.MethodGet, base, nil, false)
	var list []map[string]any
	json.NewDecoder(lresp.Body).Decode(&list)
	lresp.Body.Close()
	if len(list) != 1 {
		t.Fatalf("list len = %d, want 1", len(list))
	}

	// Update.
	uresp := c.do(http.MethodPatch, base+"/"+strconv.FormatInt(id, 10),
		map[string]any{"name": "Van", "plate": "ZZ999ZZ", "notes": "work"}, true)
	if uresp.StatusCode != http.StatusOK {
		t.Fatalf("update = %d, want 200", uresp.StatusCode)
	}
	if v := decodeVehicle(t, uresp); v["name"] != "Van" {
		t.Fatalf("updated name = %v", v["name"])
	}

	// Update a non-existent vehicle → 404.
	if r := c.do(http.MethodPatch, base+"/999999", map[string]any{"name": "Nope"}, true); r.StatusCode != http.StatusNotFound {
		t.Fatalf("update missing = %d, want 404", r.StatusCode)
	} else {
		r.Body.Close()
	}

	// Cross-user isolation: a non-member sees every vehicle route as 404.
	c.do(http.MethodPost, "/api/v1/admin/users", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()
	bob := c.fork()
	bob.do(http.MethodPost, "/api/v1/auth/login", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()
	if r := bob.do(http.MethodGet, base, nil, false); r.StatusCode != http.StatusNotFound {
		t.Fatalf("bob list = %d, want 404", r.StatusCode)
	} else {
		r.Body.Close()
	}
	if r := bob.do(http.MethodDelete, base+"/"+strconv.FormatInt(id, 10), nil, true); r.StatusCode != http.StatusNotFound {
		t.Fatalf("bob delete = %d, want 404", r.StatusCode)
	} else {
		r.Body.Close()
	}

	// Owner delete → 204, then a repeat delete → 404.
	if r := c.do(http.MethodDelete, base+"/"+strconv.FormatInt(id, 10), nil, true); r.StatusCode != http.StatusNoContent {
		t.Fatalf("delete = %d, want 204", r.StatusCode)
	} else {
		r.Body.Close()
	}
	if r := c.do(http.MethodDelete, base+"/"+strconv.FormatInt(id, 10), nil, true); r.StatusCode != http.StatusNotFound {
		t.Fatalf("delete again = %d, want 404", r.StatusCode)
	} else {
		r.Body.Close()
	}
}
