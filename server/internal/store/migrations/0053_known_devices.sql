-- The devices each person has signed in from (#690): a sign-in from one not
-- listed is announced. A device is the browser and the system, not the whole
-- user agent, so a browser update is not a new device.
CREATE TABLE known_devices (
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    device     TEXT    NOT NULL,
    first_seen TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (user_id, device)
);
