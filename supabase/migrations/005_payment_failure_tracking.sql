-- Track payment failures for dunning emails
-- Run this in your Supabase SQL Editor

alter table public.subscriptions
  add column if not exists payment_failed_at timestamptz,
  add column if not exists payment_reminder_sent boolean default false;
