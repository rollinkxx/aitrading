-- Detailed collector errors are operational diagnostics and must not be publicly readable.
-- The application reads a sanitized latest-run projection through market-collector GET.
drop policy if exists collector_runs_public_read on public.collector_runs;
