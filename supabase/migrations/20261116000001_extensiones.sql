-- Extensiones necesarias. Si alguna falla al hacer `supabase db push`,
-- actívala en Supabase → Database → Extensions y vuelve a ejecutar.
create schema if not exists extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
