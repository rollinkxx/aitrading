# AITrading Paper Trading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared, server-side, paper-only trading bot and auditable win/loss history to AItrading without creating any live-order path.

**Architecture:** Keep market-data and signal generation on the existing official Indodax public-data path. Run one coordinated paper engine from a Supabase Edge Function and persist its shared cash, positions, fees, transitions and closed trades in the separate project `aitrading-paper` (`xkhsxjyleqnhuptesepg`), never in the existing market/signal database. The browser reads a public-safe shared dashboard/history view; bot controls are intentionally unauthenticated because the user explicitly chose no login. No service-role key, private exchange credential, or order endpoint may enter frontend code. Activate the paper scheduler only in its isolated backend after checks; leave the public Cloudflare site unchanged.

**Tech Stack:** Existing React 18, TypeScript, Vite, `@supabase/supabase-js`, Supabase Postgres/Edge Functions/pg_cron, official Indodax public REST/TradingView data, and the repository's Node test runner. No additional runtime dependency is planned.

**Spec:** User-approved intake in the AItrading task; existing signal behavior and design in this repository. This plan marks unresolved choices explicitly below.

## Global Constraints

- One shared paper portfolio begins with **Rp100.000.000 IDR**.
- One shared bot pair follows the owner-selected pair. Changing the pair while browsing markets must not silently mutate the global bot configuration.
- Reuse the existing multi-timeframe signal engine. Model long-only entries on fresh, validated BUY signals; SELL closes an existing long and never opens a short. HOLD, WAIT, stale, invalid, expired or incomplete inputs cannot open a position.
- Use the entry BUY's stop-loss and take-profit for that position. Close on a fresh SELL, stop-loss or take-profit; continue managing open positions even if the owner changes the next-entry pair.
- Allow at most one open position per pair. Cap each position's notional at the approved value, and available shared cash.
- Set the daily-loss limit to **2% of start-of-day equity**; on breach reject new entries for that day while continuing exit monitoring.
- Model only the official IDR-market **CFX 0,00555% per side** (0.0000555 × each buy/sell notional). Use fresh official bid/ask quotes for paper fills so spread is visible; add no invented slippage rate. Label costs **“CFX saja; tidak termasuk service fee dan pajak”**; never present them as all-in fees.
- Classify only closed trades: net realized P&L after modeled CFX above zero is win, below zero is loss, exactly zero is breakeven. Open positions are not included in win/loss counts. Preserve signal/event, price source/time, notional, entry/exit, fees and close reason.
- Pause/resume/stop controls affect new entries but never erase history or abandon monitoring of open-position risk. Public visitors can read shared paper status/history and change only the narrowly scoped shared pair/status controls; they cannot write positions, events or trades.
- There are no live-trading credentials, private account APIs, or order-placement code. Source publication and Cloudflare release are separate controlled steps; this takeover completes them only after the full local release gate passes.

## Approved Implementation Defaults and Access Decision

The user approved the 10% position cap, entry only when a fresh ask is within the signal range, and daily loss calculation using realized plus unrealized P&L net of CFX, resetting in Asia/Jakarta. The user also explicitly chose **controls without login**. Therefore any visitor who discovers the public application URL can change the shared pair and pause/resume/stop the shared bot. This can disrupt paper runs and history but cannot access live trading; implement exactly this public mutability, and keep all access paper-only.

## Design

**Design movement:** Retain the existing luminous dark market cockpit: Bloomberg-terminal discipline reinterpreted through modern data visualization.

**Core principles:** Dense but calm; every number has context; risk is visible before action; mobile thumb reach.

**Color philosophy:** Ink navy reduces glare, mint marks healthy data and bullish momentum, coral marks risk, and violet highlights the signal engine.

**Layout paradigm:** Keep the asymmetric dashboard with live market rail, stacked signal cards, and fixed bottom navigation; use a compact Paper Bot card on Dashboard and put detail/history in Signals and controls in Settings. Do not add a sixth tab.

**Signature elements:** Existing signal pulse ring, vertical confidence meter, and mono-spaced source/freshness labels.

**Interaction philosophy:** Tap to drill down, never hide the reason behind a signal, and use explicit status chips for freshness and paper-only state. Browsing a pair does not silently reconfigure the shared bot.

**Animation:** Preserve short 180 ms transitions, subtle pulse only on live status, and no motion on data values.

**Typography system:** Inter/system sans for reading and IBM Plex Mono fallback for prices and metadata.

**Brand essence:** A transparent Indodax market compass for disciplined retail traders; precise, calm, accountable.

**Brand voice:** Direct, transparent Indonesian microcopy. Examples: “Simulasi saja. Tidak ada order ke akun Indodax.” and “Biaya yang dimodelkan hanya CFX; service fee dan pajak belum termasuk.”

**Wordmark & logo:** Keep the compact violet-to-mint pulse mark joined to the AITrading wordmark.

**Signature brand color:** Electric violet `#8B7CFF`.

## Project Structure

- `src/App.tsx` and `src/styles.css`: integrate dashboard summary, active paper position, paper history, public bot controls without conflating them with live signal history.
- `src/lib/paper-trading.ts`: create the dedicated paper-project Supabase client from `VITE_PAPER_SUPABASE_URL` and `VITE_PAPER_SUPABASE_ANON_KEY`; expose only public-safe state/history reads and narrowly scoped unauthenticated paper-control RPCs. Preserve existing market-data endpoints and existing production-project references.
- `supabase/functions/_shared/paper-engine.ts`: deterministic pure entry/exit/accounting decisions, quote freshness, CFX fee math, position/daily limits, and event idempotency inputs.
- `supabase-paper/functions/paper-engine/index.ts`: server-only official market fetch and signal calculation through the shared strategy; pass events to atomic ledger RPCs. No order APIs.
- `supabase-paper/migrations/<timestamp>_paper_trading.sql`: portfolio/config/event/position/trade state, constraints/indexes, scoped public control RPCs, atomic/idempotent transition RPCs, public-safe reads/RLS. Apply only to `aitrading-paper` and keep outside the default production Supabase directory.
- `tests/paper-engine.test.mjs` and focused DB/function checks: cover accounting, fails-closed inputs and idempotency using existing test conventions.
- `.env.example` and `README.md`: document only public Preview variables and operating boundaries; never contain secret values.

## Review Focus

- Entry and exit use ask/bid respectively on a fresh quote; an ask outside the BUY entry range does not fill.
- Repeated or concurrent signal processing cannot duplicate entries, exits or fees; at most one open position exists per pair.
- Jakarta date rollover resets the daily basis once; the drawdown guard includes modeled costs, blocks new entries, and does not stop exits.
- Price gaps beyond SL/TP record the fresh executable-side quote as fill and keep trigger/actual fill distinct; if both levels appear hit in one sample, choose SL conservatively.
- Missing paper-project configuration, expired/stale data, failed auth or unavailable backend never falls back to the existing production database or a live exchange endpoint.

---

## Planned Implementation Tasks

### Task 1: Deterministic paper engine

**Files:** Create `supabase/functions/_shared/paper-engine.ts`; create `tests/paper-engine.test.mjs`.

**Interfaces:** Input is a typed portfolio snapshot, paper configuration, signal `{id, type, quality, expiresAt, entryLow, entryHigh, stopLoss, takeProfit}`, and quote `{marketId, bid, ask, last, sourceTime}`. The server derives signal ID from market, latest closed 15-minute candle time and signal type. Export `evaluatePaperTick(input): PaperDecision[]`; decisions are `open`, `close`, `hold` or `reject` and carry `eventKey = marketId + "|" + signalId + "|" + action + "|" + quote.sourceTime`, price, notional, fee, reason and resulting net P&L where applicable. Persist state-changing and first/new signal decisions; do not write a repeated idle no-op for every poll. This function remains pure; database locking/idempotency is Task 2.

- [x] Write focused tests for entry-range fill, long-only SELL close, SL/TP exit and no-op for HOLD/WAIT/stale/expired/invalid signals.
- [x] Run the focused engine tests (6 tests pass; all 11 focused engine and migration tests pass).
- [x] Implement sizing, fee and risk arithmetic: CFX rate `0.0000555` on entry and exit notional; cap from the approved percentage and cash; net trade result; daily guard; conservative stop-first collision handling.
- [x] Test 10%/cash caps, 2% daily threshold, fee arithmetic, win/loss/breakeven, stale data, duplicate event key and price-gap fills; rerun the focused test file.

### Task 2: Isolated database ledger and authorization

**Files:** Keep the forward migrations under `supabase-paper/migrations/`, outside the default production migration directory; add a focused migration/security test under `tests/`.

**Interfaces:** Add singleton `paper_config` and `paper_portfolio`, plus `paper_positions`, idempotent `paper_events`, closed `paper_trades`, and `paper_control_events` audit. Server-only RPCs verify the Vault trigger secret, claim/release a fenced lease, and atomically process each tick via `process_paper_tick`; public-safe reads use `get_paper_public_state`, `get_paper_public_stats`, and `paper_public_history`. `set_paper_control` permits only the narrow pair/status actions without login, by explicit user choice.

- [x] Write tests for intended DDL/RLS/grants and unique constraints, ensuring raw ledger tables remain protected while only the narrowly scoped paper-control RPC is public.
- [x] Run focused migration tests and review SQL grants/search paths before applying remotely.
- [x] Apply the migration only to Supabase project `xkhsxjyleqnhuptesepg`; do not apply it to `hlxiyprvygakfwreynvn`.
- [x] Verify paper table/state metadata and anonymous public reads; raw ledger mutations and state-changing engine RPCs remain service-role-only.

### Task 3: Server-only paper engine and scheduled run

**Files:** `supabase-paper/functions/paper-engine/index.ts` and the isolated schedule migration under `supabase-paper/migrations/`.

**Interfaces:** The scheduled request accepts no caller-provided order, market or price. It requires a server-only Vault trigger secret (the function has `verify_jwt=false` only for this custom server-to-server authentication), reads the server-side active pair/config, fetches only official public Indodax market data, invokes the existing `buildSignal`, marks open positions, and submits idempotent events to atomic RPCs. It uses Supabase's server environment for database access; never logs the trigger secret.

- [ ] Add dedicated runtime tests for missing/wrong trigger secret and unsupported methods; current release coverage verifies these guards at source level and covers stale/invalid quote behavior in the pure engine.
- [ ] Run function guard tests to confirm failure before implementation.
- [x] Implement the server-only data/strategy/ledger path with explicit timeouts and no private exchange/order endpoints.
- [x] Deploy/test the Edge Function only in `aitrading-paper`; direct POST without the trigger secret returns HTTP 401.
- [x] Schedule one-minute paper-only checks only after database and function checks; observed successful HTTP 200 calls and a fresh `last_tick_at` with no live order capability.

### Task 4: Dashboard, history and public controls

**Files:** `src/lib/paper-trading.ts`; modified `src/App.tsx`, `src/styles.css`, `.env.example`; paper browser source remains read-only except for its explicitly approved narrow public-control RPCs.

**Interfaces:** `getPaperState()` calls `get_paper_public_state`; `getPaperStats()` calls `get_paper_public_stats`; `getPaperHistory(limit)` reads `paper_public_history` in deterministic order; `setPaperControl(action, value)` calls the public paper-only control RPC without login, as explicitly requested. This allows any visitor with the URL to change the global shared bot state. Browser code can never call direct table writes for portfolio state.

- [x] Verify migration tests limit anonymous controls to pair/status RPCs and public reads; exercise state/stats/history reads with the publishable key and run browser smoke for panel rendering.
- [x] Implement the Dashboard summary, separate open-position and closed-trade history, win/loss/breakeven counts, explicit fee/daily-limit labels, and public controls under Settings.
- [x] Update `.env.example` with public paper-project URL/publishable-key names only; never add service-role or trigger secrets.
- [x] Run unit tests, TypeScript typecheck and `npm run build`; browser smoke asserts the paper panel is rendered.
- [x] Verify responsive paper layout through the production bundle and Chromium smoke after the release build.

### Task 5: Documentation and final handoff

**Files:** Modify `README.md` and `TODO.md` after plan approval; review final `git diff`.

**Interfaces:** Documentation must state paper-only behavior, shared balance, how the public controls the bot, CFX-only cost limitation, official public data, Preview configuration, and that public production deployment has not occurred.

- [x] Update documentation and mark only evidenced outcomes complete in `TODO.md`.
- [x] Run the repository's full `npm test`, `npm run typecheck`, `npm run build`, dependency audit, Deno check, disposable PostgreSQL migration replay, browser smoke, and Wrangler dry-run.
- [x] Keep the paper migrations/functions outside default production directories; publish the verified source to GitHub `main` and deploy the verified Cloudflare Worker build.
