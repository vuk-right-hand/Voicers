-- Voicer Foundation Schema
-- Run this in your Supabase SQL Editor

-- ============================================================
-- Profiles (extends auth.users)
-- ============================================================
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text not null,
  display_name text,
  plan text check (plan in ('free', 'byok', 'pro')) default 'free',
  stripe_customer_id text unique,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- ============================================================
-- Sessions (WebRTC Signaling via Supabase Realtime)
-- ============================================================
create table public.sessions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles on delete cascade not null,
  pc_status text default 'offline' check (pc_status in ('offline', 'waiting', 'connected')),
  signaling_data jsonb,
  last_ping timestamptz default now(),
  created_at timestamptz default now()
);

alter table public.sessions enable row level security;

create policy "Users can view own sessions"
  on public.sessions for select
  using (auth.uid() = user_id);

create policy "Users can insert own sessions"
  on public.sessions for insert
  with check (auth.uid() = user_id);

create policy "Users can update own sessions"
  on public.sessions for update
  using (auth.uid() = user_id);

create policy "Users can delete own sessions"
  on public.sessions for delete
  using (auth.uid() = user_id);

-- Enable Realtime on sessions table for WebRTC signaling
alter publication supabase_realtime add table public.sessions;

-- ============================================================
-- Auto-create profile on user signup
-- ============================================================
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- Phase 2: Subscriptions (uncomment when wiring Stripe)
-- ============================================================
-- create table public.subscriptions (
--   id uuid default gen_random_uuid() primary key,
--   user_id uuid references public.profiles on delete cascade not null,
--   stripe_subscription_id text unique not null,
--   stripe_price_id text not null,
--   status text not null,
--   current_period_start timestamptz,
--   current_period_end timestamptz,
--   created_at timestamptz default now(),
--   updated_at timestamptz default now()
-- );
-- alter table public.subscriptions enable row level security;
-- create policy "Users own their subscriptions"
--   on public.subscriptions for select
--   using (auth.uid() = user_id);
