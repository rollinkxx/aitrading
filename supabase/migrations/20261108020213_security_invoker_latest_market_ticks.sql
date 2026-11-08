-- Keep the latest-tick projection subject to the caller's table privileges and RLS.
create or replace view public.latest_market_ticks
with (security_invoker = true)
as
select distinct on (market_id)
  market_id,
  last_price,
  best_bid,
  best_ask,
  volume_24h,
  high_24h,
  low_24h,
  source_timestamp,
  received_at,
  data_status
from public.market_ticks
order by market_id, received_at desc, id desc;
