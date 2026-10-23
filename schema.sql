-- AGRESSIVE LIFT — esquema completo e IDEMPOTENTE: se puede ejecutar varias veces sin error,
-- tanto en un proyecto nuevo como en uno donde ya corriste una parte.

-- ===== Tablas =====
create table if not exists public.licenses(
  user_id uuid primary key references auth.users on delete cascade,
  status text not null default 'inactive' check (status in ('active','inactive','suspended')),
  expires_at timestamptz);
create table if not exists public.set_logs(
  id bigserial primary key, user_id uuid not null references auth.users on delete cascade,
  exercise text not null, weight numeric, reps int, rir int, failure text, devil boolean default false,
  created_at timestamptz default now());
create table if not exists public.body_logs(
  id bigserial primary key, user_id uuid not null references auth.users on delete cascade,
  weight numeric not null, created_at timestamptz default now());
create table if not exists public.ai_usage(
  user_id uuid not null references auth.users on delete cascade, created_at timestamptz default now());
create index if not exists ai_usage_user_created on public.ai_usage(user_id, created_at);

alter table public.licenses enable row level security;
alter table public.set_logs enable row level security;
alter table public.body_logs enable row level security;
alter table public.ai_usage enable row level security;

-- ===== Licencia válida (usada por las políticas) =====
create or replace function public.is_licensed() returns boolean language sql security definer stable as
$$select exists(select 1 from public.licenses where user_id=auth.uid() and status='active' and (expires_at is null or expires_at>now()))$$;

-- ===== Políticas =====
-- El usuario solo LEE su licencia; únicamente el administrador (SQL / service role) la modifica.
drop policy if exists "lee su licencia" on public.licenses;
create policy "lee su licencia" on public.licenses for select using (auth.uid()=user_id);

drop policy if exists "sus series" on public.set_logs;
drop policy if exists "series con licencia" on public.set_logs;
create policy "series con licencia" on public.set_logs for all
  using (auth.uid()=user_id and public.is_licensed()) with check (auth.uid()=user_id and public.is_licensed());

drop policy if exists "peso con licencia" on public.body_logs;
create policy "peso con licencia" on public.body_logs for all
  using (auth.uid()=user_id and public.is_licensed()) with check (auth.uid()=user_id and public.is_licensed());

drop policy if exists "uso propio" on public.ai_usage;
create policy "uso propio" on public.ai_usage for all
  using (auth.uid()=user_id and public.is_licensed()) with check (auth.uid()=user_id and public.is_licensed());

-- ===== Cada usuario nuevo nace con licencia 'inactive' =====
create or replace function public.new_license() returns trigger language plpgsql security definer as
$$begin insert into public.licenses(user_id) values(new.id) on conflict do nothing; return new; end$$;
drop trigger if exists on_signup on auth.users;
create trigger on_signup after insert on auth.users for each row execute function public.new_license();

-- Usuarios que ya existían antes del trigger:
insert into public.licenses(user_id) select id from auth.users on conflict do nothing;

-- ===== Activar a un usuario (cambia el correo) =====
-- update public.licenses set status='active' where user_id=(select id from auth.users where email='tu@correo.com');
