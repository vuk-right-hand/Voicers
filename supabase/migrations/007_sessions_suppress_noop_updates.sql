-- 007: Drop no-op UPDATEs on public.sessions at the database level.
--
-- Hosts <= v1.0.4 rewrite pc_status + signaling_data every 30 s while idle,
-- with identical values. Each one costs a new tuple, WAL, index write and a
-- Realtime decode, which drained the project's Disk IO budget (2026-10-27).
-- v1.0.5 fixes the host, but old installs keep running until updated.
--
-- Postgres's built-in suppress_redundant_updates_trigger() skips any UPDATE
-- whose new row is identical to the old one: nothing is written, no WAL, no
-- Realtime event. Real changes (offer, answer, ICE, status flips) pass
-- through untouched, so this protects every host version with no behaviour
-- change. Triggers fire alphabetically; the z_ prefix keeps this one last.

create trigger z_sessions_suppress_noop_updates
  before update on public.sessions
  for each row execute function suppress_redundant_updates_trigger();
