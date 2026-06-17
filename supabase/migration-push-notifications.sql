-- Push bildirim abonelikleri ve profil tercihi
-- Supabase Dashboard > SQL Editor'da çalıştırın.

alter table public.profiles
  add column if not exists push_enabled boolean not null default false;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subscriptions: read own" on public.push_subscriptions;
create policy "push_subscriptions: read own"
on public.push_subscriptions for select to authenticated
using (user_id = auth.uid());

drop policy if exists "push_subscriptions: insert own" on public.push_subscriptions;
create policy "push_subscriptions: insert own"
on public.push_subscriptions for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "push_subscriptions: update own" on public.push_subscriptions;
create policy "push_subscriptions: update own"
on public.push_subscriptions for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "push_subscriptions: delete own" on public.push_subscriptions;
create policy "push_subscriptions: delete own"
on public.push_subscriptions for delete to authenticated
using (user_id = auth.uid());
