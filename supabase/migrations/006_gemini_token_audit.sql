-- Audit log for Pro-tier Gemini ephemeral token mints.
-- Tokens cost real money — we need a queryable abuse signal,
-- not just Vercel logs. Service role writes only; RLS denies all client access.
-- Run this in your Supabase SQL Editor.

create table if not exists public.gemini_token_mints (
  id          bigserial primary key,
  user_id     uuid not null,
  ip          text,
  outcome     text not null,    -- 'ok' | 'rate_limited' | 'forbidden' | 'mint_failed'
  created_at  timestamptz not null default now()
);

create index if not exists gemini_token_mints_user_created_idx
  on public.gemini_token_mints (user_id, created_at desc);

create index if not exists gemini_token_mints_failures_idx
  on public.gemini_token_mints (created_at desc)
  where outcome <> 'ok';

alter table public.gemini_token_mints enable row level security;
-- No policies = no client access. Service role bypasses RLS.
