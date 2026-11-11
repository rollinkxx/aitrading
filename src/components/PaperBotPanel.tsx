import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Pause, Play, RefreshCw, Square, WalletCards } from 'lucide-react'
import {
  getPaperHistory,
  getPaperState,
  getPaperStats,
  paperSupabase,
  setPaperControl,
  type PaperState,
  type PaperStats,
  type PaperTrade,
  type PaperControlAction,
} from '../lib/paper-trading'
import { formatIdr as idr, formatIdrPrice } from '../lib/formatting'
import type { Pair } from '../lib/indodax'

type Mode = 'summary' | 'history' | 'controls'

const timestamp = (value: string | null) => value
  ? new Date(value).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
  : 'belum tersedia'

function statusLabel(status: PaperState['bot_status'], locked: boolean) {
  if (locked) return 'BATAS RUGI HARIAN'
  if (status === 'active') return 'AKTIF · PAPER'
  if (status === 'paused') return 'DIJEDA'
  return 'DIHENTIKAN'
}

function pnlClass(value: number) {
  return value > 0 ? 'paper-positive' : value < 0 ? 'paper-negative' : 'paper-neutral'
}

export default function PaperBotPanel({
  mode,
  pairs = [],
  onActivePair,
}: {
  mode: Mode
  pairs?: Pair[]
  onActivePair?: (pair: string) => void
}) {
  const [state, setState] = useState<PaperState | null>(null)
  const [trades, setTrades] = useState<PaperTrade[]>([])
  const [stats, setStats] = useState<PaperStats | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [refreshed, setRefreshed] = useState(0)
  const controlInFlight = useRef(false)
  const requestSequence = useRef(0)

  const refresh = useCallback(async () => {
    if (controlInFlight.current) return
    const requestId = ++requestSequence.current
    if (!paperSupabase) {
      if (requestSequence.current === requestId) setError('Supabase paper belum dikonfigurasi untuk build ini.')
      return
    }
    try {
      const [nextState, nextTrades, nextStats] = await Promise.all([
        getPaperState(),
        mode === 'history' ? getPaperHistory(50) : Promise.resolve([]),
        mode === 'history' ? getPaperStats() : Promise.resolve(null),
      ])
      if (controlInFlight.current || requestSequence.current !== requestId) return
      setState(nextState)
      setTrades(nextTrades)
      setStats(nextStats)
      setError('')
      setRefreshed(Date.now())
    } catch {
      if (controlInFlight.current || requestSequence.current !== requestId) return
      setError('Data paper belum dapat dimuat. Bot paper tetap berjalan di server jika terjadwal.')
    }
  }, [mode])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), mode === 'history' ? 30_000 : 15_000)
    return () => window.clearInterval(timer)
  }, [mode, refresh])

  useEffect(() => {
    if (state?.active_pair) onActivePair?.(state.active_pair)
  }, [state?.active_pair, onActivePair])

  const control = async (action: PaperControlAction, value?: string) => {
    if (controlInFlight.current) return
    controlInFlight.current = true
    const requestId = ++requestSequence.current
    setBusy(true)
    setError('')
    try {
      const nextState = await setPaperControl(action, value)
      if (requestSequence.current !== requestId) return
      setState(nextState)
      setRefreshed(Date.now())
    } catch {
      if (requestSequence.current === requestId) setError('Perubahan kontrol gagal disimpan. Muat ulang status sebelum mencoba lagi.')
    } finally {
      if (requestSequence.current === requestId) {
        controlInFlight.current = false
        setBusy(false)
      }
    }
  }

  const validPairs = pairs.filter(pair => /^[a-z0-9]{2,20}idr$/.test(pair.id) && !pair.is_maintenance && !pair.is_market_suspended)
  const workerAge = state?.last_tick_at ? Date.now() - new Date(state.last_tick_at).getTime() : Number.NaN
  const workerFresh = Number.isFinite(workerAge) && workerAge >= 0 && workerAge < 120_000
  const botStatus = state ? statusLabel(state.bot_status, state.daily_loss_locked) : 'MEMUAT'

  if (mode === 'summary') return <section className="paper-panel paper-summary" aria-label="Paper trading">
    <div className="paper-head">
      <div><p className="eyebrow">SHARED PAPER PORTFOLIO</p><h2><WalletCards size={18}/> Auto-trading simulasi</h2></div>
      <span className={`paper-status ${state?.bot_status === 'active' && workerFresh && !state.daily_loss_locked ? 'on' : ''}`}>{botStatus}</span>
    </div>
    {error && <p className="paper-error" role="status">{error}</p>}
    {state ? <>
      <div className="paper-grid">
        <div><small>EQUITY</small><b>{idr(state.equity)}</b></div>
        <div><small>SALDO KAS</small><b>{idr(state.cash_balance)}</b></div>
        <div><small>PAIR BOT BERSAMA</small><b>{state.active_pair.toUpperCase()}</b></div>
      </div>
      <div className="paper-risk-row">
        <span>Hari ini · {timestamp(state.daily_date + 'T00:00:00+07:00').split(' ')[0]}</span>
        <b className={pnlClass(state.daily_pnl)}>{idr(state.daily_pnl)}</b>
        <small>{idr(state.daily_loss_amount)} / batas {idr(state.daily_loss_limit_amount)}</small>
      </div>
      {state.open_positions.length > 0 ? <div className="paper-open-list">
        {state.open_positions.map(position => {
          const pnl = position.quantity * position.mark_price - position.entry_notional - position.entry_fee
          return <div className="paper-open-row" key={position.market_id}>
            <span><b>{position.market_id.toUpperCase()}</b><small>Masuk {formatIdrPrice(position.entry_price)} · SL {formatIdrPrice(position.stop_loss)} · TP {formatIdrPrice(position.take_profit)}</small></span>
            <strong className={pnlClass(pnl)}>{idr(pnl)}</strong>
          </div>
        })}
      </div> : <p className="paper-empty">Belum ada posisi terbuka. Bot memantau sinyal BUY tervalidasi dan rentang entry.</p>}
      <small className="paper-footnote">{workerFresh ? `Worker terakhir berjalan ${timestamp(state.last_tick_at)}` : 'Worker belum melaporkan tick baru dalam 2 menit.'} · Maks. posisi {Math.round(state.position_size_pct * 100)}% equity · CFX saja.</small>
    </> : <p className="paper-empty">{paperSupabase ? 'Memuat status paper…' : 'Konfigurasi Preview belum tersedia.'}</p>}
    <p className="paper-warning">PAPER ONLY — tidak ada order ke akun Indodax. Fee yang dimodelkan hanya CFX; service fee dan pajak belum termasuk.</p>
  </section>

  if (mode === 'history') return <section className="paper-panel" aria-label="Riwayat transaksi paper">
    <div className="paper-head"><div><p className="eyebrow">PAPER TRADE LEDGER</p><h2>Hasil menang / kalah</h2></div><button className="paper-refresh" onClick={() => void refresh()} aria-label="Muat ulang histori"><RefreshCw size={15}/></button></div>
    {error && <p className="paper-error" role="status">{error}</p>}
    {stats && <div className="paper-stats">
      <div><small>MENANG</small><b className="paper-positive">{stats.wins}</b></div>
      <div><small>KALAH</small><b className="paper-negative">{stats.losses}</b></div>
      <div><small>IMPAS</small><b>{stats.breakeven}</b></div>
      <div><small>REALIZED NET</small><b className={pnlClass(stats.realized_net_pnl)}>{idr(stats.realized_net_pnl)}</b></div>
    </div>}
    <p className="paper-footnote">Total {stats?.closed_trades ?? 0} trade tertutup · menampilkan hingga 50 terbaru · P&L net setelah CFX dua sisi.</p>
    <div className="paper-trades">
      {trades.map(trade => <article className="paper-trade" key={trade.id}>
        <div className="paper-trade-top"><span className={`paper-outcome ${trade.outcome}`}>{trade.outcome === 'win' ? 'MENANG' : trade.outcome === 'loss' ? 'KALAH' : 'IMPAS'}</span><b>{trade.market_id.toUpperCase()}</b><strong className={pnlClass(trade.realized_net_pnl)}>{idr(trade.realized_net_pnl)}</strong></div>
        <div className="paper-trade-detail"><span>Entry {formatIdrPrice(trade.entry_price)} → Exit {formatIdrPrice(trade.exit_price)}</span><span>{trade.close_reason === 'signal_sell' ? 'Sinyal SELL' : trade.close_reason === 'stop_loss' ? 'Stop loss' : 'Take profit'}</span></div>
        <div className="paper-trade-detail"><span>Fee CFX {idr(trade.entry_fee + trade.exit_fee)}</span><span>{timestamp(trade.exit_at)}</span></div>
        <small className="paper-footnote">Harga Indodax public API · quote {timestamp(trade.exit_source_at)}</small>
      </article>)}
      {!trades.length && !error && <p className="paper-empty">Belum ada trade tertutup. Posisi yang masih terbuka tidak dihitung sebagai menang atau kalah.</p>}
    </div>
    <p className="paper-warning">Simulasi saja. Biaya yang dimodelkan hanya CFX; tidak termasuk service fee dan pajak.</p>
  </section>

  return <section className="paper-panel" aria-label="Kontrol bot paper">
    <div className="paper-head"><div><p className="eyebrow">SHARED BOT CONTROLS</p><h2>Kontrol paper bot</h2></div><span className={`paper-status ${state?.bot_status === 'active' && workerFresh ? 'on' : ''}`}>{botStatus}</span></div>
    {error && <p className="paper-error" role="alert">{error}</p>}
    {state && <>
      <label className="paper-select-label" htmlFor="paper-pair">Pair bot bersama</label>
      <select id="paper-pair" className="paper-select" value={state.active_pair} disabled={busy} onChange={event => void control('pair', event.target.value)}>
        {validPairs.map(pair => <option key={pair.id} value={pair.id}>{pair.symbol} · {pair.id.toUpperCase()}</option>)}
        {!validPairs.some(pair => pair.id === state.active_pair) && <option value={state.active_pair}>{state.active_pair.toUpperCase()}</option>}
      </select>
      <div className="paper-control-buttons">
        {state.bot_status === 'active' ? <button disabled={busy} onClick={() => void control('pause')}><Pause size={15}/> Jeda</button> : <button disabled={busy} onClick={() => void control('resume')}><Play size={15}/> Lanjutkan</button>}
        <button className="stop" disabled={busy || state.bot_status === 'stopped'} onClick={() => void control('stop')}><Square size={13}/> Hentikan</button>
      </div>
      <div className="paper-settings-grid">
        <div><small>MODAL BERSAMA</small><b>{idr(state.initial_balance)}</b></div>
        <div><small>MAKS. POSISI</small><b>{Math.round(state.position_size_pct * 100)}% equity</b></div>
        <div><small>BATAS RUGI HARIAN</small><b>{Math.round(state.daily_loss_limit_pct * 100)}% · Asia/Jakarta</b></div>
        <div><small>FEE SIMULASI</small><b>CFX 0,00555% / sisi</b></div>
      </div>
    </>}
    {!state && <p className="paper-empty">{paperSupabase ? 'Memuat konfigurasi…' : 'Konfigurasi Preview belum tersedia.'}</p>}
    <div className="paper-public-risk"><AlertTriangle size={16}/><p>Kontrol ini tanpa login sesuai pilihan Anda. Siapa pun yang mengetahui URL aplikasi dapat mengubah pair, menjeda, melanjutkan, atau menghentikan bot bersama. Perubahan dicatat di audit log.</p></div>
    <p className="paper-warning">Jeda/hentikan hanya memblokir posisi baru. Bot tetap memantau stop loss/take profit untuk posisi terbuka. Tidak ada order live.</p>
    <small className="paper-footnote">{refreshed ? `Status diperbarui ${timestamp(new Date(refreshed).toISOString())}` : 'Status belum dimuat'} · Pair yang dipilih berlaku untuk seluruh portfolio bersama.</small>
  </section>
}
