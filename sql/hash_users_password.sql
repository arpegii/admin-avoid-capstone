-- Automatically hash public.users.password before insert/update.
-- Run this in Supabase SQL Editor.

create extension if not exists pgcrypto;

create or replace function public.hash_users_password()
returns trigger
language plpgsql
as $$
begin
  if new.password is null or length(new.password) = 0 then
    return new;
  end if;

  -- Avoid double-hashing if value already looks like bcrypt hash.
  if new.password ~ '^\$2[aby]\$' then
    return new;
  end if;

  new.password := crypt(new.password, gen_salt('bf', 10));
  return new;
end;
$$;

drop trigger if exists users_hash_password_before_write on public.users;

create trigger users_hash_password_before_write
before insert or update of password on public.users
for each row
execute function public.hash_users_password();
