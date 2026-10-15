ALTER TABLE audit_log ADD COLUMN event_id integer REFERENCES events(id);
CREATE INDEX audit_log_event_cursor ON audit_log(event_id,id DESC);
