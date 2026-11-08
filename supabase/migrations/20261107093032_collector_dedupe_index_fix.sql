drop index if exists public.signals_dedupe_key_unique;
create unique index signals_dedupe_key_unique on public.signals(dedupe_key);
