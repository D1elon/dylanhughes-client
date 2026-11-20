-- The client portal's database, for Supabase. Paste the whole file into the SQL editor and run it once. It is safe to
-- run again after an update: nothing here drops data.
--
-- How access works
--   * Every visitor's browser holds a Supabase session. A client's is anonymous (no email, no password): the portal
--     signs them in silently. The owner's is an ordinary email-and-password account listed in portal_admins.
--   * A client opens a space with its address and a code. portal_redeem() checks the code against a hash, throttles
--     wrong guesses, and on success records that this session may read that one space for 30 days (portal_access).
--   * Row-level security does the rest: a session reads a space's rows and files only while it has a live
--     portal_access row for it. The owner reads and writes everything. Codes are checked against a hash, in a table
--     nothing but these functions can read; the code is kept beside it so the owner can look it up again, and only
--     the owner's account can ask for it.

create extension if not exists pgcrypto with schema extensions;

-- --- Tables ---------------------------------------------------------------------------------------------------------

create table if not exists public.portal_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.portal_clients (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  intro text not null default '',
  notes text not null default '',
  active boolean not null default true,
  has_code boolean not null default false,
  code_set_at timestamptz,
  last_opened_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint portal_clients_slug check (slug ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$' and slug not in ('admin', 'demo', 'assets', 'css', 'js', 'fonts', 'index', '404')),
  constraint portal_clients_name check (char_length(name) between 1 and 120)
);

-- A space's code. No policy grants any role a row of this table: only the functions below read or write it.
create table if not exists public.portal_codes (
  client_id uuid primary key references public.portal_clients (id) on delete cascade,
  code_hash text not null,
  code text
);
alter table public.portal_codes add column if not exists code text;

create table if not exists public.portal_sections (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.portal_clients (id) on delete cascade,
  title text not null default '',
  description text not null default '',
  notes text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists portal_sections_client on public.portal_sections (client_id, position);

create table if not exists public.portal_items (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.portal_clients (id) on delete cascade,
  section_id uuid not null references public.portal_sections (id) on delete cascade,
  kind text not null check (kind in ('image', 'video', 'model', 'site', 'file', 'text')),
  title text not null default '',
  description text not null default '',
  notes text not null default '',
  path text,                       -- the file in the "portal" storage bucket: <client id>/<item id>/<file name>
  url text,                        -- a site to preview, or a video hosted elsewhere
  meta jsonb not null default '{}'::jsonb,
  allow_download boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists portal_items_section on public.portal_items (section_id, position);
create index if not exists portal_items_client on public.portal_items (client_id);

-- Notes from clients and replies from the owner. item_id is null for a note on the space as a whole. anchor says what
-- a note points at: {"type":"pin","x":0.4,"y":0.2} on an image, {"type":"time","t":12.5} in a video,
-- {"type":"view",...} a camera position on a 3D model, {"type":"device","device":"phone"} on a site preview.
create table if not exists public.portal_comments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.portal_clients (id) on delete cascade,
  item_id uuid references public.portal_items (id) on delete cascade,
  user_id uuid not null default auth.uid(),
  author text not null default '',
  is_owner boolean not null default false,
  body text not null check (char_length(body) between 1 and 4000),
  anchor jsonb,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists portal_comments_client on public.portal_comments (client_id, created_at);
create index if not exists portal_comments_item on public.portal_comments (item_id);

create table if not exists public.portal_access (
  user_id uuid not null references auth.users (id) on delete cascade,
  client_id uuid not null references public.portal_clients (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (user_id, client_id)
);

create table if not exists public.portal_attempts (
  id bigint generated always as identity primary key,
  slug text not null,
  user_id uuid,
  ok boolean not null,
  at timestamptz not null default now()
);
create index if not exists portal_attempts_recent on public.portal_attempts (at);

-- --- Who is asking --------------------------------------------------------------------------------------------------

create or replace function public.portal_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from portal_admins where user_id = auth.uid());
$$;

create or replace function public.portal_has_access(p_client uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from portal_access a join portal_clients c on c.id = a.client_id
    where a.user_id = auth.uid() and a.client_id = p_client and a.expires_at > now() and c.active
  );
$$;

-- A file's first folder is its space's id. Anything else is nobody's.
create or replace function public.portal_uuid(p_text text) returns uuid
language plpgsql immutable as $$
begin
  return p_text::uuid;
exception when others then
  return null;
end $$;

-- --- Row-level security ---------------------------------------------------------------------------------------------

alter table public.portal_admins enable row level security;
alter table public.portal_clients enable row level security;
alter table public.portal_codes enable row level security;
alter table public.portal_sections enable row level security;
alter table public.portal_items enable row level security;
alter table public.portal_comments enable row level security;
alter table public.portal_access enable row level security;
alter table public.portal_attempts enable row level security;

drop policy if exists portal_clients_read on public.portal_clients;
create policy portal_clients_read on public.portal_clients for select to authenticated
  using (public.portal_is_admin() or public.portal_has_access(id));
drop policy if exists portal_clients_write on public.portal_clients;
create policy portal_clients_write on public.portal_clients for all to authenticated
  using (public.portal_is_admin()) with check (public.portal_is_admin());

drop policy if exists portal_sections_read on public.portal_sections;
create policy portal_sections_read on public.portal_sections for select to authenticated
  using (public.portal_is_admin() or public.portal_has_access(client_id));
drop policy if exists portal_sections_write on public.portal_sections;
create policy portal_sections_write on public.portal_sections for all to authenticated
  using (public.portal_is_admin()) with check (public.portal_is_admin());

drop policy if exists portal_items_read on public.portal_items;
create policy portal_items_read on public.portal_items for select to authenticated
  using (public.portal_is_admin() or public.portal_has_access(client_id));
drop policy if exists portal_items_write on public.portal_items;
create policy portal_items_write on public.portal_items for all to authenticated
  using (public.portal_is_admin()) with check (public.portal_is_admin());

drop policy if exists portal_comments_read on public.portal_comments;
create policy portal_comments_read on public.portal_comments for select to authenticated
  using (public.portal_is_admin() or public.portal_has_access(client_id));
drop policy if exists portal_comments_add on public.portal_comments;
create policy portal_comments_add on public.portal_comments for insert to authenticated
  with check (public.portal_is_admin() or public.portal_has_access(client_id));
drop policy if exists portal_comments_edit on public.portal_comments;
create policy portal_comments_edit on public.portal_comments for update to authenticated
  using (public.portal_is_admin()) with check (public.portal_is_admin());
drop policy if exists portal_comments_remove on public.portal_comments;
create policy portal_comments_remove on public.portal_comments for delete to authenticated
  using (public.portal_is_admin() or (user_id = auth.uid() and public.portal_has_access(client_id)));

drop policy if exists portal_access_read on public.portal_access;
create policy portal_access_read on public.portal_access for select to authenticated
  using (public.portal_is_admin() or user_id = auth.uid());
drop policy if exists portal_access_leave on public.portal_access;
create policy portal_access_leave on public.portal_access for delete to authenticated
  using (public.portal_is_admin() or user_id = auth.uid());

-- A note is stamped with who really wrote it, whatever the browser sent, and must sit on an item of its own space.
create or replace function public.portal_comment_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_admin boolean := public.portal_is_admin();
begin
  new.user_id := auth.uid();
  new.is_owner := v_admin;
  new.resolved := false;
  new.created_at := now();
  new.body := btrim(new.body);
  if new.item_id is not null and not exists (select 1 from portal_items i where i.id = new.item_id and i.client_id = new.client_id) then
    raise exception 'That item is not part of this space';
  end if;
  if v_admin then
    new.author := 'Dylan';
  else
    new.author := left(coalesce(nullif(btrim(new.author), ''), (select display_name from portal_access where user_id = auth.uid() and client_id = new.client_id), 'Guest'), 60);
  end if;
  return new;
end $$;
drop trigger if exists portal_comment_stamp on public.portal_comments;
create trigger portal_comment_stamp before insert on public.portal_comments
  for each row execute function public.portal_comment_stamp();

create or replace function public.portal_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists portal_clients_touch on public.portal_clients;
create trigger portal_clients_touch before update on public.portal_clients
  for each row execute function public.portal_touch();

-- --- Opening a space with a code ------------------------------------------------------------------------------------

-- Codes are compared without case, spaces or dashes, so "k7m2 9qxd" opens what "K7M2-9QXD" does.
create or replace function public.portal_code_key(p_code text) returns text
language sql immutable as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

create or replace function public.portal_redeem(p_slug text, p_code text, p_name text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_key text := public.portal_code_key(p_code);
  v_client portal_clients;
  v_hash text;
  v_mine integer;
  v_space integer;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;
  delete from portal_attempts where at < now() - interval '1 day';
  -- Wrong guesses are counted per visitor and per space, so neither one browser nor many can hammer a code.
  select count(*) into v_mine from portal_attempts where not ok and user_id = v_uid and at > now() - interval '15 minutes';
  select count(*) into v_space from portal_attempts where not ok and slug = v_slug and at > now() - interval '1 hour';
  if v_mine >= 8 or v_space >= 40 then
    return jsonb_build_object('ok', false, 'error', 'locked');
  end if;
  select * into v_client from portal_clients where slug = v_slug;
  if found and v_client.active then
    select code_hash into v_hash from portal_codes where client_id = v_client.id;
  end if;
  -- One answer for a wrong code, a space that doesn't exist and one that is switched off.
  if v_hash is null or char_length(v_key) < 6 or crypt(v_key, v_hash) <> v_hash then
    insert into portal_attempts (slug, user_id, ok) values (v_slug, v_uid, false);
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  insert into portal_access (user_id, client_id, display_name, expires_at)
    values (v_uid, v_client.id, nullif(left(btrim(coalesce(p_name, '')), 60), ''), now() + interval '30 days')
    on conflict (user_id, client_id) do update
      set expires_at = excluded.expires_at, display_name = coalesce(excluded.display_name, portal_access.display_name);
  insert into portal_attempts (slug, user_id, ok) values (v_slug, v_uid, true);
  update portal_clients set last_opened_at = now() where id = v_client.id;
  return jsonb_build_object('ok', true, 'client_id', v_client.id, 'slug', v_client.slug);
end $$;

-- The owner sets or replaces a space's code. Replacing it shuts out everyone who came in with the old one.
create or replace function public.portal_set_code(p_client uuid, p_code text, p_revoke boolean default true) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_key text := public.portal_code_key(p_code);
begin
  if not public.portal_is_admin() then
    raise exception 'Not allowed';
  end if;
  if char_length(v_key) < 6 then
    raise exception 'A code needs at least six letters or digits';
  end if;
  insert into portal_codes (client_id, code_hash, code) values (p_client, crypt(v_key, gen_salt('bf', 10)), upper(btrim(p_code)))
    on conflict (client_id) do update set code_hash = excluded.code_hash, code = excluded.code;
  if p_revoke then
    delete from portal_access where client_id = p_client;
  end if;
  update portal_clients set has_code = true, code_set_at = now() where id = p_client;
end $$;

create or replace function public.portal_clear_code(p_client uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.portal_is_admin() then
    raise exception 'Not allowed';
  end if;
  delete from portal_codes where client_id = p_client;
  delete from portal_access where client_id = p_client;
  update portal_clients set has_code = false, code_set_at = null where id = p_client;
end $$;

-- The owner looks a space's code up again, to send it to someone else.
create or replace function public.portal_get_code(p_client uuid) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.portal_is_admin() then
    raise exception 'Not allowed';
  end if;
  return (select code from portal_codes where client_id = p_client);
end $$;

-- The name a visitor's notes are signed with.
create or replace function public.portal_set_name(p_client uuid, p_name text) returns void
language sql security definer set search_path = public as $$
  update portal_access set display_name = nullif(left(btrim(coalesce(p_name, '')), 60), '')
  where user_id = auth.uid() and client_id = p_client;
$$;

create or replace function public.portal_whoami() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'is_admin', public.portal_is_admin(),
    'spaces', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'slug', c.slug, 'name', c.name, 'display_name', a.display_name) order by c.name)
      from portal_access a join portal_clients c on c.id = a.client_id
      where a.user_id = auth.uid() and a.expires_at > now() and c.active), '[]'::jsonb));
$$;

-- --- Who may call what ----------------------------------------------------------------------------------------------

revoke all on public.portal_admins, public.portal_clients, public.portal_codes, public.portal_sections, public.portal_items,
  public.portal_comments, public.portal_access, public.portal_attempts from anon, authenticated;
grant select, insert, update, delete on public.portal_clients, public.portal_sections, public.portal_items, public.portal_comments to authenticated;
grant select, delete on public.portal_access to authenticated;

revoke execute on function public.portal_redeem(text, text, text), public.portal_set_code(uuid, text, boolean), public.portal_clear_code(uuid),
  public.portal_get_code(uuid), public.portal_set_name(uuid, text), public.portal_whoami(), public.portal_comment_stamp() from public, anon;
grant execute on function public.portal_redeem(text, text, text), public.portal_set_code(uuid, text, boolean), public.portal_clear_code(uuid),
  public.portal_get_code(uuid), public.portal_set_name(uuid, text), public.portal_whoami(), public.portal_is_admin(), public.portal_has_access(uuid), public.portal_uuid(text),
  public.portal_code_key(text) to authenticated;

-- --- Files ----------------------------------------------------------------------------------------------------------
-- One private bucket. A file lives at <client id>/<item id>/<file name>; whoever may read the space may read its
-- files, and only the owner may add, replace or remove them.

insert into storage.buckets (id, name, public, file_size_limit)
  values ('portal', 'portal', false, 52428800)
  on conflict (id) do update set public = false;

drop policy if exists portal_files_read on storage.objects;
create policy portal_files_read on storage.objects for select to authenticated
  using (bucket_id = 'portal' and (public.portal_is_admin() or public.portal_has_access(public.portal_uuid((storage.foldername(name))[1]))));
drop policy if exists portal_files_add on storage.objects;
create policy portal_files_add on storage.objects for insert to authenticated
  with check (bucket_id = 'portal' and public.portal_is_admin());
drop policy if exists portal_files_change on storage.objects;
create policy portal_files_change on storage.objects for update to authenticated
  using (bucket_id = 'portal' and public.portal_is_admin()) with check (bucket_id = 'portal' and public.portal_is_admin());
drop policy if exists portal_files_remove on storage.objects;
create policy portal_files_remove on storage.objects for delete to authenticated
  using (bucket_id = 'portal' and public.portal_is_admin());

-- --- Making yourself the owner --------------------------------------------------------------------------------------
-- After creating your own user (Authentication > Users > Add user), run this once with your sign-in email:
--
--   insert into public.portal_admins (user_id) select id from auth.users where email = 'you@example.com';
