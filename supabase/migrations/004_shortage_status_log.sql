-- =============================================================================
-- Migration 004: shortage_status_log
-- Tracks status and severity changes to shortage_events so alert dispatchers
-- can notify watchlist users about meaningful changes.
-- =============================================================================

CREATE TABLE shortage_status_log (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    shortage_event_id   UUID        NOT NULL REFERENCES shortage_events(id) ON DELETE CASCADE,
    drug_id             UUID        NOT NULL,
    old_status          TEXT,
    new_status          TEXT        NOT NULL,
    old_severity        TEXT,
    new_severity        TEXT,
    changed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    alert_sent          BOOLEAN     NOT NULL DEFAULT FALSE
);

COMMENT ON TABLE shortage_status_log IS
    'Immutable log of status/severity changes to shortage_events. '
    'Rows with alert_sent=FALSE are picked up by the alert dispatcher.';

CREATE INDEX idx_shortage_status_log_drug_alert
    ON shortage_status_log (drug_id, alert_sent);

CREATE INDEX idx_shortage_status_log_changed_at
    ON shortage_status_log (changed_at DESC);
