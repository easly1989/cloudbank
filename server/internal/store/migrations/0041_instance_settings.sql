-- Settings of the whole installation, chosen by an admin (#582): one row per
-- key. The first is whether the server looks for new CloudBank versions.
CREATE TABLE instance_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
