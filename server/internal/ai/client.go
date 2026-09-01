// Package ai adds opt-in, bring-your-own-key AI features. The client speaks the
// OpenAI-compatible /chat/completions API, so a user can point it at a cloud
// provider or a local runtime (Ollama, LM Studio). Everything is off unless the
// user configures and enables it.
package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// httpDoer is the subset of *http.Client the client needs; injectable for tests.
type httpDoer interface {
	Do(*http.Request) (*http.Response, error)
}

// client calls an OpenAI-compatible chat endpoint.
type client struct {
	baseURL string
	apiKey  string
	model   string
	hc      httpDoer
}

func newClient(baseURL, apiKey, model string, hc httpDoer) *client {
	if hc == nil {
		hc = &http.Client{Timeout: 30 * time.Second}
	}
	return &client{baseURL: strings.TrimRight(baseURL, "/"), apiKey: apiKey, model: model, hc: hc}
}

type chatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

// chat sends a system+user prompt and returns the assistant's reply text.
func (c *client) chat(ctx context.Context, system, user string) (string, error) {
	body, err := json.Marshal(map[string]any{
		"model": c.model,
		"messages": []map[string]string{
			{"role": "system", "content": system},
			{"role": "user", "content": user},
		},
		"temperature": 0,
		"max_tokens":  64,
	})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
	}
	resp, err := c.hc.Do(req)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return "", fmt.Errorf("ai: provider returned %d: %s", resp.StatusCode, strings.TrimSpace(string(msg)))
	}
	var out chatResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&out); err != nil {
		return "", fmt.Errorf("ai: could not read provider response: %w", err)
	}
	if len(out.Choices) == 0 {
		return "", fmt.Errorf("ai: empty response from provider")
	}
	return strings.TrimSpace(out.Choices[0].Message.Content), nil
}
