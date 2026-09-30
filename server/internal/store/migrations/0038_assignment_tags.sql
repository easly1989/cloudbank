-- The tags a rule adds to the transactions it matches (#566). A rule only ever
-- adds tags, never removes one. Deleting a tag drops it from every rule; a
-- merge moves it (see ReassignAssignmentTag).
CREATE TABLE assignment_tags (
    assignment_id INTEGER NOT NULL REFERENCES assignments (id) ON DELETE CASCADE,
    tag_id        INTEGER NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
    PRIMARY KEY (assignment_id, tag_id)
);

CREATE INDEX idx_assignment_tags_tag ON assignment_tags (tag_id);
