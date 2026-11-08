-- Cover foreign keys used by ownership-related child tables.
create index if not exists alert_rules_market_id_idx on public.alert_rules (market_id);
create index if not exists watchlists_market_id_idx on public.watchlists (market_id);

-- Preserve the existing policy scope while allowing PostgreSQL to evaluate auth.uid() once per statement.
drop policy if exists alerts_owner_all on public.alert_rules;
create policy alerts_owner_all on public.alert_rules
  for all to public
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists watchlists_owner_all on public.watchlists;
create policy watchlists_owner_all on public.watchlists
  for all to public
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
