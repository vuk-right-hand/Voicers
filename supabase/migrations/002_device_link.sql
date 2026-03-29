-- Add device_b_linked_at to profiles
-- Used by the cross-device auth Realtime handshake:
-- Device B writes this timestamp after passing the Hard Gate,
-- Device A's Waiting Room listener detects the update and redirects to /dashboard.

alter table public.profiles
  add column if not exists device_b_linked_at timestamptz;
