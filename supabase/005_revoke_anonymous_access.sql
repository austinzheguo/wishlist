-- 2026-10-06 production cutover: retire the former public/anonymous client.
-- Keep tables, rows, functions, RLS, and authenticated policies intact.

begin;

revoke all privileges on table public.wishlist_items, public.wishlist_data from anon;
revoke execute on function public.replace_wishlist_items(uuid, bigint, jsonb) from anon, public;

drop policy if exists "Anonymous visitors read public wishlist items" on public.wishlist_items;
drop policy if exists "Anonymous visitors create public wishlist items" on public.wishlist_items;
drop policy if exists "Anonymous visitors update public wishlist items" on public.wishlist_items;
drop policy if exists "Anonymous visitors delete public wishlist items" on public.wishlist_items;

drop policy if exists "Anonymous visitors read public wishlist" on public.wishlist_data;
drop policy if exists "Anonymous visitors create public wishlist" on public.wishlist_data;
drop policy if exists "Anonymous visitors update public wishlist" on public.wishlist_data;

commit;
