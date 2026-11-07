# AITrading — Implementation Plan

## Approach
AITrading is a mobile-first signal-only web app using official Indodax public REST endpoints. The frontend fetches live summaries, order books, and OHLC history; the strategy engine computes deterministic EMA, RSI, MACD, ATR, volume and liquidity checks. Signals fail closed when data is stale or incomplete. Supabase stores the production schema for future authenticated watchlists and signal audit history. Cloudflare Pages hosts the static build, with the repository as source.

## Design
Three possible directions: editorial terminal minimalism (0.07); luminous dark market cockpit (0.91); soft fintech card stack (0.02). Chosen: luminous dark market cockpit.

**Design movement:** Bloomberg-terminal discipline reinterpreted through modern neon data visualization.
**Core principles:** dense but calm; every number has context; risk is visible before action; mobile thumb reach.
**Color philosophy:** ink navy reduces glare, mint marks healthy data and bullish momentum, coral marks risk, and violet highlights the signal engine.
**Layout paradigm:** asymmetric dashboard with a live market rail, stacked signal cards, and a fixed bottom navigation rather than a centered grid.
**Signature elements:** signal pulse ring, vertical confidence meter, and mono-spaced source/freshness labels.
**Interaction philosophy:** tap to drill down, never hide the reason behind a signal, and use status chips for data quality.
**Animation:** short 180ms transitions, subtle pulse only on live status, no motion on data values.
**Typography:** Inter/system sans for reading, IBM Plex Mono fallback for prices and metadata.
**Brand essence:** a transparent Indodax market compass for disciplined retail traders; precise, calm, accountable.
**Brand voice:** “Data resmi. Keputusan lebih disiplin.” and “Tidak ada sinyal jika data tidak layak.”
**Wordmark:** a compact violet-to-mint pulse mark joined to the word AITrading.
**Signature brand color:** electric violet #8B7CFF.

## Structure
`src/lib/indodax.ts` owns official API retrieval and freshness checks. `src/lib/strategy.ts` owns deterministic indicators and scoring. `src/App.tsx` owns navigation and mobile UI. `supabase/migrations` owns schema and RLS. Cloudflare Pages serves the Vite build.
