-- Per-user, opt-in AI settings (bring-your-own-key). The client speaks the
-- OpenAI-compatible chat API, so base_url can point at a cloud provider or a
-- local runtime (Ollama/LM Studio). The api_key is stored server-side and never
-- returned to the browser.
CREATE TABLE ai_settings (
    user_id    INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    enabled    INTEGER NOT NULL DEFAULT 0,
    base_url   TEXT    NOT NULL DEFAULT '',
    model      TEXT    NOT NULL DEFAULT '',
    api_key    TEXT    NOT NULL DEFAULT '',
    updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
