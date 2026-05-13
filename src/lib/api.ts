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
  tradingAccountError: string | null
  tradingUpdatedAt: string | null
  updatedAt: string
}

export type TradingSettingsPayload = {
  mode: TradingMode
  allocations: Record<SignalTier, number>
  stop_loss_percent: number
}

export const DEFAULT_TRADING_ALLOCATION = 1000
export const DEFAULT_TRADING_STOP_LOSS_PERCENT = 0.2

function resolveApiBaseUrl() {
  const baseUrl = import.meta.env.VITE_API_BASE_URL?.trim()
  if (baseUrl) {
    return baseUrl.replace(/\/$/, '')
  }
  if (import.meta.env.DEV || import.meta.env.MODE === 'test') {
    return 'http://127.0.0.1:8080/api'
  }
  throw new Error('VITE_API_BASE_URL is required')
}

function parseFiniteNumber(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function parsePositiveNumber(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
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
    conviction_buy: DEFAULT_TRADING_ALLOCATION,
    balanced_buy: DEFAULT_TRADING_ALLOCATION,
    opportunistic_buy: DEFAULT_TRADING_ALLOCATION,
    speculative_buy: DEFAULT_TRADING_ALLOCATION,
  }
  if (!value || typeof value !== 'object') {
    return defaults
  }
  const allocations = { ...defaults }
  for (const tier of Object.keys(defaults) as SignalTier[]) {
    const raw = (value as Record<string, unknown>)[tier]
    const parsed = Number(raw)
    if (Number.isFinite(parsed) && parsed >= 0) {
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
    buyingPower: parseFiniteNumber(raw.buying_power, 0),
    cash: parseFiniteNumber(raw.cash, 0),
    equity: parseFiniteNumber(raw.equity, 0),
    portfolioValue: parseFiniteNumber(raw.portfolio_value, 0),
    updatedAt: String(raw.updated_at ?? '').trim(),
  }
}

export async function loadTradingSettings(
  sessionId: string,
  nowIso: string,
): Promise<TradingSettingsSnapshot> {
  const payload = await requestJson<Record<string, unknown>>(`/v1/sessions/${encodeURIComponent(sessionId)}/trading`)
  if (!payload) {
    throw new Error('Unexpected empty response from server')
  }
  return {
    sessionId: String(payload.session_id ?? sessionId),
    tradingMode: parseTradingMode(payload.trading_mode),
    tradingAllocations: parseTradingAllocations(payload.trading_allocations),
    tradingStopLossPercent: parsePositiveNumber(payload.trading_stop_loss_percent, DEFAULT_TRADING_STOP_LOSS_PERCENT),
    tradingAccount: parseTradingAccount(payload.trading_account),
    tradingAccountError: payload.trading_account_error ? String(payload.trading_account_error) : null,
    tradingUpdatedAt: payload.trading_updated_at ? String(payload.trading_updated_at) : null,
    updatedAt: String(payload.updated_at ?? nowIso),
  }
}

export async function loadTradingAccount(
  sessionId: string,
  mode: TradingMode,
  nowIso: string,
): Promise<TradingAccountSnapshot | null> {
  const queryMode = parseTradingMode(mode)
  const payload = await requestJson<Record<string, unknown>>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/trading/account?mode=${encodeURIComponent(queryMode)}`,
  )
  if (!payload) {
    return null
  }
  const tradingAccount =
    payload.trading_account && typeof payload.trading_account === 'object'
      ? (payload.trading_account as Record<string, unknown>)
      : null
  if (payload.trading_account_error) {
    throw new Error(String(payload.trading_account_error))
  }
  if (!tradingAccount) {
    return null
  }
  return parseTradingAccount({
    ...tradingAccount,
    mode: queryMode,
    updated_at: payload.trading_updated_at ?? payload.updated_at ?? tradingAccount.updated_at ?? nowIso,
  })
}

export async function saveTradingSettings(
  sessionId: string,
  settings: TradingSettingsPayload,
  nowIso: string,
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
  if (!payload) {
    throw new Error('Unexpected empty response from server')
  }
  return {
    sessionId: String(payload.session_id ?? sessionId),
    tradingMode: parseTradingMode(payload.trading_mode),
    tradingAllocations: parseTradingAllocations(payload.trading_allocations),
    tradingStopLossPercent: parsePositiveNumber(payload.trading_stop_loss_percent, settings.stop_loss_percent),
    tradingAccount: parseTradingAccount(payload.trading_account),
    tradingAccountError: payload.trading_account_error ? String(payload.trading_account_error) : null,
    tradingUpdatedAt: payload.trading_updated_at ? String(payload.trading_updated_at) : null,
    updatedAt: String(payload.updated_at ?? nowIso),
  }
}
