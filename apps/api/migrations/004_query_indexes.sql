-- Availability probes a zone and the live expiry range; the worker separately
-- uses the global expiry-first partial index introduced by migration 001.
CREATE INDEX reservations_zone_active ON reservations(zone_id,expires_at) INCLUDE(quantity) WHERE state='active';
CREATE INDEX purchases_user_cursor ON purchases(user_id,id);
CREATE INDEX scanner_devices_event_cursor ON scanner_devices(event_id,id);
