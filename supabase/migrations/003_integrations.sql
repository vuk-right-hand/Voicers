-- User Integrations (SwitchBot and future third-party integrations)
--
-- Security model:
-- * Users can INSERT and UPDATE their own credentials (to save SwitchBot config).
-- * Users deliberately CANNOT SELECT their own row from the browser.
--   The switchbot_secret is a signing key that belongs on the server only.
--   The wake-host Edge Function reads credentials via service role key (bypasses RLS)
--   so the secret is never exposed to the browser, even to the owner.
-- * If you need a UI to show "SwitchBot is configured" without exposing the secret,
--   query the row count or add a separate boolean flag column.

create table public.user_integrations (
  id                  uuid        default gen_random_uuid() primary key,
  user_id             uuid        references public.profiles on delete cascade not null,
  switchbot_token     text,       -- SwitchBot Cloud API access token
  switchbot_secret    text,       -- SwitchBot Cloud API secret (HMAC signing key — server-side only)
  switchbot_device_id text,       -- SwitchBot Bot device ID to press the power button
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),
  -- One row per user
  constraint user_integrations_user_id_unique unique (user_id)
);

alter table public.user_integrations enable row level security;

-- No SELECT policy — credentials are read server-side only (service role key).
-- Intentional: prevents XSS / malicious extensions from reading the signing secret
-- via the anon key even if the attacker has a valid session token.

create policy "Users can insert own integrations"
  on public.user_integrations for insert
  with check (auth.uid() = user_id);

create policy "Users can update own integrations"
  on public.user_integrations for update
  using (auth.uid() = user_id);

create policy "Users can delete own integrations"
  on public.user_integrations for delete
  using (auth.uid() = user_id);
