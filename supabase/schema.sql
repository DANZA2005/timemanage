-- TimeGuard schema — idempotente: puede re-ejecutarse sin errores.
create extension if not exists pgcrypto;

create table if not exists public.profiles (id uuid primary key references auth.users(id) on delete cascade, display_name text not null default '', role text not null default 'parent' check (role in ('parent','child')), created_at timestamptz not null default now());
create table if not exists public.families (id uuid primary key default gen_random_uuid(), name text not null default 'Mi familia', owner_id uuid not null references auth.users(id) on delete cascade, created_at timestamptz not null default now());
create table if not exists public.family_members (family_id uuid not null references public.families(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade, member_role text not null default 'parent' check (member_role in ('parent','child')), primary key (family_id, user_id));
create table if not exists public.devices (id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families(id) on delete cascade, name text not null, profile_name text not null, platform text not null default 'android', online boolean not null default false, blocked boolean not null default false, pairing_code text, last_seen_at timestamptz, created_at timestamptz not null default now());
create table if not exists public.device_sessions (id uuid primary key default gen_random_uuid(), device_id uuid not null references public.devices(id) on delete cascade, started_at timestamptz not null, ended_at timestamptz, duration_minutes integer not null default 0 check (duration_minutes >= 0));
create table if not exists public.app_usage (id uuid primary key default gen_random_uuid(), device_id uuid not null references public.devices(id) on delete cascade, app_name text not null, minutes integer not null default 0 check (minutes >= 0), usage_date date not null default current_date);
create table if not exists public.device_limits (id uuid primary key default gen_random_uuid(), device_id uuid not null references public.devices(id) on delete cascade, daily_minutes integer not null default 120 check (daily_minutes >= 0), enabled boolean not null default true, unique(device_id));
create table if not exists public.managed_apps (id uuid primary key default gen_random_uuid(), device_id uuid not null references public.devices(id) on delete cascade, app_name text not null, allowed boolean not null default true, unique(device_id, app_name));
create table if not exists public.schedules (id uuid primary key default gen_random_uuid(), device_id uuid not null references public.devices(id) on delete cascade, label text not null, starts_at time not null, ends_at time not null, enabled boolean not null default true);
create table if not exists public.extra_time_requests (id uuid primary key default gen_random_uuid(), device_id uuid not null references public.devices(id) on delete cascade, minutes integer not null check (minutes > 0), reason text, status text not null default 'pending' check (status in ('pending','approved','denied')), created_at timestamptz not null default now());
create table if not exists public.notifications (id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families(id) on delete cascade, title text not null, body text not null, read boolean not null default false, created_at timestamptz not null default now());

create or replace function public.is_family_member(target_family uuid) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.family_members where family_id=target_family and user_id=auth.uid()); $$;
create or replace function public.is_device_member(target_device uuid) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.devices d join public.family_members m on m.family_id=d.family_id where d.id=target_device and m.user_id=auth.uid()); $$;
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$ begin insert into public.profiles(id, display_name) values (new.id, coalesce(new.raw_user_meta_data->>'display_name','')) on conflict (id) do nothing; return new; end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

do $$ declare t text; begin foreach t in array array['profiles','families','family_members','devices','device_sessions','app_usage','device_limits','managed_apps','schedules','extra_time_requests','notifications'] loop execute format('alter table public.%I enable row level security', t); end loop; end $$;

drop policy if exists "profile self" on public.profiles;
create policy "profile self" on public.profiles for all using (id=auth.uid()) with check (id=auth.uid());
drop policy if exists "family access" on public.families;
create policy "family access" on public.families for all using (public.is_family_member(id) or owner_id=auth.uid()) with check (owner_id=auth.uid());
drop policy if exists "member access" on public.family_members;
create policy "member access" on public.family_members for select using (user_id=auth.uid() or public.is_family_member(family_id));
drop policy if exists "owner adds members" on public.family_members;
create policy "owner adds members" on public.family_members for insert with check (exists(select 1 from public.families where id=family_id and owner_id=auth.uid()));
drop policy if exists "device access" on public.devices;
create policy "device access" on public.devices for all using (public.is_family_member(family_id)) with check (public.is_family_member(family_id));
drop policy if exists "session access" on public.device_sessions;
create policy "session access" on public.device_sessions for all using (public.is_device_member(device_id)) with check (public.is_device_member(device_id));
drop policy if exists "usage access" on public.app_usage;
create policy "usage access" on public.app_usage for all using (public.is_device_member(device_id)) with check (public.is_device_member(device_id));
drop policy if exists "limit access" on public.device_limits;
create policy "limit access" on public.device_limits for all using (public.is_device_member(device_id)) with check (public.is_device_member(device_id));
drop policy if exists "managed app access" on public.managed_apps;
create policy "managed app access" on public.managed_apps for all using (public.is_device_member(device_id)) with check (public.is_device_member(device_id));
drop policy if exists "schedule access" on public.schedules;
create policy "schedule access" on public.schedules for all using (public.is_device_member(device_id)) with check (public.is_device_member(device_id));
drop policy if exists "request access" on public.extra_time_requests;
create policy "request access" on public.extra_time_requests for all using (public.is_device_member(device_id)) with check (public.is_device_member(device_id));
drop policy if exists "notification access" on public.notifications;
create policy "notification access" on public.notifications for all using (public.is_family_member(family_id)) with check (public.is_family_member(family_id));

-- Column-idempotency: repara tablas creadas por migraciones parciales previas.
alter table public.devices add column if not exists name text not null default 'Dispositivo';
alter table public.devices add column if not exists profile_name text not null default 'Perfil infantil';
alter table public.devices add column if not exists platform text not null default 'android';
alter table public.devices add column if not exists online boolean not null default false;
alter table public.devices add column if not exists blocked boolean not null default false;
alter table public.devices add column if not exists pairing_code text;
alter table public.devices add column if not exists last_seen_at timestamptz;
alter table public.extra_time_requests add column if not exists minutes integer not null default 30;
alter table public.extra_time_requests add column if not exists reason text;
alter table public.extra_time_requests add column if not exists status text not null default 'pending';

alter table public.devices add column if not exists profile_type text not null default 'nino';

-- Emparejamiento: códigos de un solo uso + caducidad
create table if not exists public.pairing_codes (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  code text not null unique,
  device_name text not null default 'Dispositivo',
  profile_name text not null default 'Perfil infantil',
  profile_type text not null default 'nino',
  created_by uuid not null default auth.uid(),
  device_id uuid references public.devices(id) on delete set null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.pairing_codes enable row level security;
drop policy if exists "pairing owner" on public.pairing_codes;
create policy "pairing owner" on public.pairing_codes for all using (public.is_family_member(family_id)) with check (public.is_family_member(family_id));

-- RPC seguro: el dispositivo monitorizado canjea el código y se une a la familia
create or replace function public.redeem_pairing_code(p_code text)
returns table(device_id uuid, family_id uuid, profile_name text, profile_type text)
language plpgsql security definer set search_path=public as $$
#variable_conflict use_column
declare rec public.pairing_codes; dev uuid;
begin
  select * into rec from public.pairing_codes where code = upper(p_code) for update;
  if rec.id is null then raise exception 'CODE_NOT_FOUND'; end if;
  if rec.consumed_at is not null then raise exception 'CODE_USED'; end if;
  if rec.expires_at < now() then raise exception 'CODE_EXPIRED'; end if;
  insert into public.devices(family_id, name, profile_name, profile_type, platform, online)
    values(rec.family_id, rec.device_name, rec.profile_name, rec.profile_type, 'android', true)
    returning id into dev;
  update public.pairing_codes set consumed_at = now(), device_id = dev where id = rec.id;
  insert into public.family_members(family_id, user_id, member_role)
    values(rec.family_id, auth.uid(), 'child') on conflict (family_id, user_id) do nothing;
  insert into public.device_limits(device_id, daily_minutes) values(dev, 120) on conflict (device_id) do nothing;
  return query select dev, rec.family_id, rec.profile_name, rec.profile_type;
end; $$;
grant execute on function public.redeem_pairing_code(text) to authenticated, anon;

do $$ declare t text; begin foreach t in array array['devices','device_limits','extra_time_requests','notifications','schedules'] loop begin execute format('alter publication supabase_realtime add table public.%I', t); exception when duplicate_object then null; end; end loop; end $$;

notify pgrst, 'reload schema';
