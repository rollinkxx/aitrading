import { createClient } from '@supabase/supabase-js'

export type PaperPosition = {
  market_id: string
  signal_id: string
  quantity: number
  entry_price: number
  entry_notional: number
  entry_fee: number
  stop_loss: number
  take_profit: number
  mark_price: number
  opened_at: string
  entry_source_at: string
  mark_updated_at: string
}

export type PaperState = {
  initial_balance: number
  active_pair: string
  bot_status: 'active' | 'paused' | 'stopped'
  position_size_pct: number
  daily_loss_limit_pct: number
  cfx_fee_rate: number
  cash_balance: number
  daily_date: string
  daily_start_equity: number
  daily_loss_locked: boolean
  realized_pnl: number
  last_tick_at: string | null
  updated_at: string
  equity: number
  daily_pnl: number
  daily_loss_amount: number
  daily_loss_limit_amount: number
  unrealized_pnl: number
  open_positions: PaperPosition[]
}

export type PaperTrade = {
  id: string
  market_id: string
  entry_signal_id: string
  exit_signal_id: string
  entry_price: number
  exit_price: number
  quantity: number
  entry_notional: number
  exit_notional: number
  entry_fee: number
  exit_fee: number
  realized_net_pnl: number
  outcome: 'win' | 'loss' | 'breakeven'
  close_reason: 'signal_sell' | 'stop_loss' | 'take_profit'
  price_source: 'indodax_public_api'
  entry_at: string
  exit_at: string
  entry_source_at: string
  exit_source_at: string
}

export type PaperStats = {
  closed_trades: number
  wins: number
  losses: number
  breakeven: number
  realized_net_pnl: number
  fees_total: number
}

export type PaperControlAction = 'pair' | 'pause' | 'resume' | 'stop'

const url = import.meta.env.VITE_PAPER_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_PAPER_SUPABASE_ANON_KEY as string | undefined
export const paperSupabase = url && key
  ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  : null

function requireClient() {
  if (!paperSupabase) throw new Error('Konfigurasi Supabase paper belum diisi.')
  return paperSupabase
}

export async function getPaperState(): Promise<PaperState> {
  const { data, error } = await requireClient().rpc('get_paper_public_state')
  if (error) throw new Error(error.message)
  return data as unknown as PaperState
}

export async function getPaperStats(): Promise<PaperStats> {
  const { data, error } = await requireClient().rpc('get_paper_public_stats')
  if (error) throw new Error(error.message)
  return data as unknown as PaperStats
}

export async function getPaperHistory(limit = 50): Promise<PaperTrade[]> {
  const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)))
  const { data, error } = await requireClient()
    .from('paper_public_history')
    .select('*')
    .order('exit_at', { ascending: false })
    .limit(safeLimit)
  if (error) throw new Error(error.message)
  return (data ?? []) as PaperTrade[]
}

export async function setPaperControl(action: PaperControlAction, value?: string): Promise<PaperState> {
  const { data, error } = await requireClient().rpc('set_paper_control', {
    p_action: action,
    p_value: value ?? null,
  })
  if (error) throw new Error(error.message)
  return data as unknown as PaperState
}
