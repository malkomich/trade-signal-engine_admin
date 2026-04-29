export type SignalState = 'FLAT' | 'ENTRY_SIGNALLED' | 'ACCEPTED_OPEN' | 'EXIT_SIGNALLED' | 'CLOSED' | 'REJECTED' | 'EXPIRED'

export type AdminSignal = {
  symbol: string
  windowId?: string
  signalAction?: string
  signalTier?: string | null
  state: SignalState
  entryScore: number
  exitScore: number
  regime: string
  updatedAt: string
  reasons: string[]
}

export type SignalTier =
  | 'conviction_buy'
  | 'balanced_buy'
  | 'opportunistic_buy'
  | 'speculative_buy'

export type SignalTierMeta = {
  tier: SignalTier
  label: string
  icon: string
  description: string
}

export type ConfigFieldValue = number | string | string[]

export type ConfigFieldInputType = 'number' | 'text' | 'symbols'

export type ConfigField = {
  key: string
  label: string
  value: ConfigFieldValue
  description: string
  group: string
  inputType: ConfigFieldInputType
  step?: number
  placeholder?: string
  options?: string[]
}

export type WindowOptimizationSnapshot = {
  timestamp: string
  close: number
  sma_fast: number | null
  sma_slow: number | null
  ema_fast: number | null
  ema_slow: number | null
  vwap: number | null
  rsi: number | null
  atr: number | null
  plus_di: number | null
  minus_di: number | null
  adx: number | null
  macd: number | null
  macd_signal: number | null
  macd_histogram: number | null
  stochastic_k: number | null
  stochastic_d: number | null
  bollinger_middle: number | null
  bollinger_upper: number | null
  bollinger_lower: number | null
  obv: number | null
  relative_volume: number | null
  volume_profile: number | null
  entry_score: number
  exit_score: number
}

export type WindowOptimizationRecord = {
  id: string
  sessionId: string
  windowId: string
  symbol: string
  day: string
  entrySnapshot: WindowOptimizationSnapshot
  exitSnapshot: WindowOptimizationSnapshot
  entryScore: number
  exitScore: number
  changePct: number
  notes: string
  requestedBy: string
  createdAt: string
  updatedAt: string
}

export const sampleSignals: AdminSignal[] = [
  {
    symbol: 'NVDA',
    state: 'ENTRY_SIGNALLED',
    entryScore: 0.84,
    exitScore: 0.22,
    signalTier: 'conviction_buy',
    regime: 'Trend + Volume confirmation',
    updatedAt: '2026-04-20 15:41 UTC',
    reasons: ['SMA stack aligned', 'MACD positive', 'VWAP support'],
  },
  {
    symbol: 'MSFT',
    state: 'ACCEPTED_OPEN',
    entryScore: 0.77,
    exitScore: 0.31,
    signalTier: 'balanced_buy',
    regime: 'Low volatility trend',
    updatedAt: '2026-04-20 15:42 UTC',
    reasons: ['EMA continuation', 'RSI mid-range'],
  },
  {
    symbol: 'TSLA',
    state: 'EXIT_SIGNALLED',
    entryScore: 0.51,
    exitScore: 0.74,
    signalTier: null,
    regime: 'Volatility expansion',
    updatedAt: '2026-04-20 15:43 UTC',
    reasons: ['ATR elevated', 'Stochastic stretched'],
  },
]

export const signalTierLegend: Record<SignalTier, SignalTierMeta> = {
  conviction_buy: {
    tier: 'conviction_buy',
    label: 'Conviction buy',
    icon: '▲',
    description: 'High-confidence long setup with strong alignment and lower risk.',
  },
  balanced_buy: {
    tier: 'balanced_buy',
    label: 'Balanced buy',
    icon: '◆',
    description: 'Solid long setup with healthy trend, momentum, and participation.',
  },
  opportunistic_buy: {
    tier: 'opportunistic_buy',
    label: 'Opportunistic buy',
    icon: '●',
    description: 'Valid long setup with acceptable risk and still usable upside.',
  },
  speculative_buy: {
    tier: 'speculative_buy',
    label: 'Speculative buy',
    icon: '◌',
    description: 'Weaker long setup that still clears the minimum risk-adjusted floor.',
  },
}

export const configFields: ConfigField[] = [
  {
    key: 'monitored_symbols',
    label: 'Tracked symbols',
    value: ['AAPL', 'AMZN', 'GOOGL', 'META', 'MSFT', 'NVDA', 'PLTR', 'TSLA'],
    description: 'Symbols scanned in real time by the edge worker.',
    group: 'Trading universe',
    inputType: 'symbols',
    placeholder: 'One symbol per line',
    options: ['AAPL', 'AMZN', 'GOOGL', 'META', 'MSFT', 'NVDA', 'PLTR', 'TSLA'],
  },
  {
    key: 'benchmark_symbol',
    label: 'Market reference',
    value: 'QQQ',
    description: 'Reference used to compare the tracked stock against broader market movement.',
    group: 'Trading universe',
    inputType: 'text',
    placeholder: 'QQQ',
  },
  {
    key: 'session_timezone',
    label: 'Trading day timezone',
    value: 'America/New_York',
    description: 'Timezone used to anchor the active trading day and the market calendar.',
    group: 'Trading universe',
    inputType: 'text',
    placeholder: 'America/New_York',
  },
  {
    key: 'buy_score_threshold',
    label: 'Buy score threshold',
    value: 0.7,
    description: 'Minimum aggregated score required to emit a buy cue. Raise it to make buys stricter; lower it to allow more buys.',
    group: 'Buy rules',
    inputType: 'number',
    step: 0.01,
  },
  {
    key: 'sell_score_threshold',
    label: 'Sell score threshold',
    value: 0.6,
    description: 'Minimum aggregated score required to emit a sell cue. Raise it to require stronger sell evidence; lower it to close positions sooner.',
    group: 'Sell rules',
    inputType: 'number',
    step: 0.01,
  },
  {
    key: 'entry_exit_margin',
    label: 'Buy-sell margin',
    value: 0.1,
    description: 'Extra distance the buy score must keep above sell pressure before a flat-state buy is allowed. Lower values admit more signals; higher values make buys stricter.',
    group: 'Buy rules',
    inputType: 'number',
    step: 0.01,
  },
  {
    key: 'buy_weight_sma',
    label: 'Buy SMA weight',
    value: 0.6,
    description: 'How much the SMA stack contributes to buy decisions. Increase it if trend alignment should matter more for buys.',
    group: 'Buy indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'buy_weight_ema',
    label: 'Buy EMA weight',
    value: 1.0,
    description: 'How much the EMA stack contributes to buy decisions.',
    group: 'Buy indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'buy_weight_vwap',
    label: 'Buy VWAP weight',
    value: 1.2,
    description: 'How much VWAP alignment influences buy decisions.',
    group: 'Buy indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'buy_weight_bollinger',
    label: 'Buy Bollinger weight',
    value: 0.7,
    description: 'How much Bollinger band structure contributes to buy decisions.',
    group: 'Buy indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'buy_weight_rsi',
    label: 'Buy RSI weight',
    value: 0.9,
    description: 'How much RSI momentum influences buy decisions.',
    group: 'Buy indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'buy_weight_atr',
    label: 'Buy ATR weight',
    value: 0.5,
    description: 'How much ATR volatility contributes to buy decisions.',
    group: 'Buy indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'buy_weight_dm',
    label: 'Buy directional movement weight',
    value: 0.6,
    description: 'How much DMI and ADX influence buy decisions.',
    group: 'Buy indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'buy_weight_macd',
    label: 'Buy MACD weight',
    value: 1.0,
    description: 'How much MACD momentum influences buy decisions.',
    group: 'Buy indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'buy_weight_stochastic',
    label: 'Buy stochastic weight',
    value: 0.5,
    description: 'How much stochastic turning points influence buy decisions.',
    group: 'Buy indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'buy_weight_obv',
    label: 'Buy OBV weight',
    value: 0.9,
    description: 'How much on-balance volume supports buy decisions.',
    group: 'Buy indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'buy_weight_relative_volume',
    label: 'Buy relative volume weight',
    value: 1.2,
    description: 'How much volume expansion supports buy decisions.',
    group: 'Buy indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'buy_weight_volume_profile',
    label: 'Buy volume profile weight',
    value: 0.8,
    description: 'How much volume concentration around the active price zone supports buys.',
    group: 'Buy indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'buy_weight_1m',
    label: 'Buy 1-minute weight',
    value: 1.0,
    description: 'How much the 1-minute window contributes to buy scoring.',
    group: 'Buy timeframe weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'buy_weight_5m',
    label: 'Buy 5-minute weight',
    value: 0.85,
    description: 'How much the 5-minute window contributes to buy scoring.',
    group: 'Buy timeframe weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'buy_weight_10m',
    label: 'Buy 10-minute weight',
    value: 0.75,
    description: 'How much the 10-minute window contributes to buy scoring.',
    group: 'Buy timeframe weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'buy_weight_15m',
    label: 'Buy 15-minute weight',
    value: 0.6,
    description: 'How much the 15-minute window contributes to buy scoring.',
    group: 'Buy timeframe weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'buy_weight_30m',
    label: 'Buy 30-minute weight',
    value: 0.45,
    description: 'How much the 30-minute window contributes to buy scoring.',
    group: 'Buy timeframe weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'buy_weight_60m',
    label: 'Buy 60-minute weight',
    value: 0.3,
    description: 'How much the 60-minute window contributes to buy scoring.',
    group: 'Buy timeframe weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'sell_weight_sma',
    label: 'Sell SMA weight',
    value: 0.5,
    description: 'How much the SMA stack contributes to sell decisions.',
    group: 'Sell indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'sell_weight_ema',
    label: 'Sell EMA weight',
    value: 1.0,
    description: 'How much the EMA stack contributes to sell decisions.',
    group: 'Sell indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'sell_weight_vwap',
    label: 'Sell VWAP weight',
    value: 1.2,
    description: 'How much VWAP alignment influences sell decisions.',
    group: 'Sell indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'sell_weight_bollinger',
    label: 'Sell Bollinger weight',
    value: 1.0,
    description: 'How much Bollinger band stretch or mean reversion contributes to sell decisions.',
    group: 'Sell indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'sell_weight_rsi',
    label: 'Sell RSI weight',
    value: 0.9,
    description: 'How much RSI momentum influences sell decisions.',
    group: 'Sell indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'sell_weight_atr',
    label: 'Sell ATR weight',
    value: 0.6,
    description: 'How much ATR volatility contributes to sell decisions.',
    group: 'Sell indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'sell_weight_dm',
    label: 'Sell directional movement weight',
    value: 0.7,
    description: 'How much DMI and ADX influence sell decisions.',
    group: 'Sell indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'sell_weight_macd',
    label: 'Sell MACD weight',
    value: 1.0,
    description: 'How much MACD momentum influences sell decisions.',
    group: 'Sell indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'sell_weight_stochastic',
    label: 'Sell stochastic weight',
    value: 0.5,
    description: 'How much stochastic turning points influence sell decisions.',
    group: 'Sell indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'sell_weight_obv',
    label: 'Sell OBV weight',
    value: 0.8,
    description: 'How much weakening accumulation or distribution influences sell decisions.',
    group: 'Sell indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'sell_weight_relative_volume',
    label: 'Sell relative volume weight',
    value: 1.1,
    description: 'How much drying participation supports sell decisions.',
    group: 'Sell indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'sell_weight_volume_profile',
    label: 'Sell volume profile weight',
    value: 0.8,
    description: 'How much poor volume acceptance around price supports sell decisions.',
    group: 'Sell indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'sell_weight_1m',
    label: 'Sell 1-minute weight',
    value: 1.0,
    description: 'How much the 1-minute window contributes to sell scoring.',
    group: 'Sell timeframe weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'sell_weight_5m',
    label: 'Sell 5-minute weight',
    value: 0.85,
    description: 'How much the 5-minute window contributes to sell scoring.',
    group: 'Sell timeframe weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'sell_weight_10m',
    label: 'Sell 10-minute weight',
    value: 0.75,
    description: 'How much the 10-minute window contributes to sell scoring.',
    group: 'Sell timeframe weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'sell_weight_15m',
    label: 'Sell 15-minute weight',
    value: 0.6,
    description: 'How much the 15-minute window contributes to sell scoring.',
    group: 'Sell timeframe weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'sell_weight_30m',
    label: 'Sell 30-minute weight',
    value: 0.45,
    description: 'How much the 30-minute window contributes to sell scoring.',
    group: 'Sell timeframe weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'sell_weight_60m',
    label: 'Sell 60-minute weight',
    value: 0.3,
    description: 'How much the 60-minute window contributes to sell scoring.',
    group: 'Sell timeframe weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'optimizer_learning_rate',
    label: 'Optimizer learning rate',
    value: 0.12,
    description: 'How strongly saved window reviews should nudge future scores. Keep it low for stability.',
    group: 'Optimization controls',
    inputType: 'number',
    step: 0.01,
  },
  {
    key: 'optimizer_bias_cap',
    label: 'Optimizer bias cap',
    value: 0.08,
    description: 'Maximum per-run adjustment applied from the saved review history. Smaller values keep the engine steadier.',
    group: 'Optimization controls',
    inputType: 'number',
    step: 0.01,
  },
]

/**
 * Classify a signal for the dashboard triage and live stream.
 *
 * `signalAction` takes precedence when available because it reflects the
 * explicit buy/sell action emitted by the backend. We fall back to the
 * stored state for older or partial records.
 */
export function classifySignal(signal: AdminSignal): 'buy' | 'sell' | 'hold' {
  const action = signal.signalAction?.toUpperCase()
  if (action === 'BUY_ALERT' || action === 'BUY' || action === 'ACCEPT') {
    return 'buy'
  }
  if (action === 'SELL_ALERT' || action === 'SELL' || action === 'EXIT') {
    return 'sell'
  }
  const state = signal.state?.toUpperCase() ?? ''
  if (state === 'ENTRY_SIGNALLED' || state === 'ACCEPTED_OPEN' || state === 'ENTRY' || state === 'OPEN') {
    return 'buy'
  }
  if (state === 'EXIT_SIGNALLED' || state === 'EXIT' || state === 'CLOSE') {
    return 'sell'
  }
  return 'hold'
}

export function classifySignalTier(signal: AdminSignal): SignalTier | null {
  const explicitTier = signal.signalTier?.trim().toLowerCase()
  if (
    explicitTier === 'conviction_buy' ||
    explicitTier === 'balanced_buy' ||
    explicitTier === 'opportunistic_buy' ||
    explicitTier === 'speculative_buy'
  ) {
    return explicitTier
  }

  if (classifySignal(signal) !== 'buy') {
    return null
  }
  if (signal.entryScore >= 0.78 && signal.exitScore <= 0.28) {
    return 'conviction_buy'
  }
  if (signal.entryScore >= 0.68 && signal.exitScore <= 0.35) {
    return 'balanced_buy'
  }
  if (signal.entryScore >= 0.58 && signal.exitScore <= 0.45) {
    return 'opportunistic_buy'
  }
  return 'speculative_buy'
}
