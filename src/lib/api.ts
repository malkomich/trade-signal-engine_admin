import type { SignalTier } from './engine'

export type TradingMode = 'paper' | 'live'

export type TradingAccountSnapshot = {
  mode: TradingMode
  status: string
  buyingPower: number
  cash: number
  equity: number
  portfolioValue: number
  updatedAt: string
}

export type TradingSettingsSnapshot = {
  sessionId: string
  tradingMode: TradingMode
  tradingAllocations: Record<SignalTier, number>
  tradingStopLossPercent: number
  tradingAccount: TradingAccountSnapshot | null
  tradingUpdatedAt: string | null
  updatedAt: string
}

export type TradingSettingsPayload = {
  mode: TradingMode
  allocations: Record<SignalTier, number>
  stop_loss_percent: number
}

const DEFAULT_API_BASE_URL = 'https://tradesignalengine.backend.synapsesea.com/api'

function resolveApiBaseUrl() {
  return (import.meta.env.VITE_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL).replace(/\/$/, '')
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${resolveApiBaseUrl()}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  })
  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new Error(message.trim() || `Request failed with status ${response.status}`)
  }
  if (response.status === 204) {
    return null as T
  }
  return (await response.json()) as T
}

function parseTradingMode(value: unknown): TradingMode {
  const normalized = String(value ?? '').trim().toLowerCase()
  return normalized === 'live' ? 'live' : 'paper'
}

function parseTradingAllocations(value: unknown): Record<SignalTier, number> {
  const defaults: Record<SignalTier, number> = {
    conviction_buy: 1000,
    balanced_buy: 1000,
    opportunistic_buy: 1000,
    speculative_buy: 1000,
  }
  if (!value || typeof value !== 'object') {
    return defaults
  }
  const allocations = { ...defaults }
  for (const tier of Object.keys(defaults) as SignalTier[]) {
    const raw = (value as Record<string, unknown>)[tier]
    const parsed = Number(raw)
    if (Number.isFinite(parsed) && parsed > 0) {
      allocations[tier] = parsed
    }
  }
  return allocations
}

function parseTradingAccount(value: unknown): TradingAccountSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const raw = value as Record<string, unknown>
  const mode = parseTradingMode(raw.mode)
  return {
    mode,
    status: String(raw.status ?? '').trim(),
    buyingPower: Number(raw.buying_power ?? 0),
    cash: Number(raw.cash ?? 0),
    equity: Number(raw.equity ?? 0),
    portfolioValue: Number(raw.portfolio_value ?? 0),
    updatedAt: String(raw.updated_at ?? '').trim(),
  }
}

export async function loadTradingSettings(sessionId: string): Promise<TradingSettingsSnapshot> {
  const payload = await requestJson<Record<string, unknown>>(`/v1/sessions/${encodeURIComponent(sessionId)}/trading`)
  return {
    sessionId: String(payload.session_id ?? sessionId),
    tradingMode: parseTradingMode(payload.trading_mode),
    tradingAllocations: parseTradingAllocations(payload.trading_allocations),
    tradingStopLossPercent: Number(payload.trading_stop_loss_percent ?? 0.1),
    tradingAccount: parseTradingAccount(payload.trading_account),
    tradingUpdatedAt: payload.trading_updated_at ? String(payload.trading_updated_at) : null,
    updatedAt: String(payload.updated_at ?? new Date().toISOString()),
  }
}

export async function saveTradingSettings(
  sessionId: string,
  settings: TradingSettingsPayload,
): Promise<TradingSettingsSnapshot> {
  const payload = await requestJson<Record<string, unknown>>(`/v1/sessions/${encodeURIComponent(sessionId)}/trading`, {
    method: 'PUT',
    body: JSON.stringify({
      session_id: sessionId,
      mode: settings.mode,
      allocations: settings.allocations,
      stop_loss_percent: settings.stop_loss_percent,
    }),
  })
  return {
    sessionId: String(payload.session_id ?? sessionId),
    tradingMode: parseTradingMode(payload.trading_mode),
    tradingAllocations: parseTradingAllocations(payload.trading_allocations),
    tradingStopLossPercent: Number(payload.trading_stop_loss_percent ?? settings.stop_loss_percent),
    tradingAccount: parseTradingAccount(payload.trading_account),
    tradingUpdatedAt: payload.trading_updated_at ? String(payload.trading_updated_at) : null,
    updatedAt: String(payload.updated_at ?? new Date().toISOString()),
  }
}
