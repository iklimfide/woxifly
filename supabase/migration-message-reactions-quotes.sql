-- Mesaj alıntılama ve emoji tepkileri
-- Supabase Dashboard > SQL Editor'da bir kez çalıştırın.

alter table public.messages
  add column if not exists client_id text;

alter table public.messages
  add column if not exists quote jsonb;

create index if not exists messages_client_id_idx
  on public.messages (client_id)
  where client_id is not null;

create table if not exists public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 8),
  created_at timestamptz not null default now(),
  unique (message_id, user_id)
);

create index if not exists message_reactions_message_idx
  on public.message_reactions (message_id);

alter table public.message_reactions enable row level security;

-- Tepkileri okuma: mesajı okuyabildiğin sohbetteki tepkiler
drop policy if exists "reactions: read dm if member" on public.message_reactions;
create policy "reactions: read dm if member"
on public.message_reactions for select to authenticated
using (
  exists (
    select 1 from public.messages m
    where m.id = message_reactions.message_id
      and public.is_dm_participant(m.conversation_id)
  )
);

drop policy if exists "reactions: read group if matches district" on public.message_reactions;
create policy "reactions: read group if matches district"
on public.message_reactions for select to authenticated
using (
  exists (
    select 1 from public.messages m
    where m.id = message_reactions.message_id
      and public.is_group_conversation_for_user(m.conversation_id)
  )
);

drop policy if exists "reactions: anon read group" on public.message_reactions;
create policy "reactions: anon read group"
on public.message_reactions for select to anon
using (
  exists (
    select 1
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where m.id = message_reactions.message_id
      and c.type = 'group'
  )
);

-- Kendi tepkini ekle / güncelle / sil
drop policy if exists "reactions: insert own" on public.message_reactions;
create policy "reactions: insert own"
on public.message_reactions for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.messages m
    where m.id = message_reactions.message_id
      and (
        public.is_dm_participant(m.conversation_id)
        or public.is_group_conversation_for_user(m.conversation_id)
      )
  )
);

drop policy if exists "reactions: update own" on public.message_reactions;
create policy "reactions: update own"
on public.message_reactions for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "reactions: delete own" on public.message_reactions;
create policy "reactions: delete own"
on public.message_reactions for delete to authenticated
using (user_id = auth.uid());
