export type SignalState = 'FLAT' | 'ENTRY_SIGNALLED' | 'ACCEPTED_OPEN' | 'EXIT_SIGNALLED' | 'CLOSED' | 'REJECTED' | 'EXPIRED'

export type AdminSignal = {
  symbol: string
  windowId?: string
  state: SignalState
  entryScore: number
  exitScore: number
  regime: string
  updatedAt: string
  reasons: string[]
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
    regime: 'Trend + Volume confirmation',
    updatedAt: '2026-04-20 15:41 UTC',
    reasons: ['SMA stack aligned', 'MACD positive', 'VWAP support'],
  },
  {
    symbol: 'MSFT',
    state: 'ACCEPTED_OPEN',
    entryScore: 0.77,
    exitScore: 0.31,
    regime: 'Low volatility trend',
    updatedAt: '2026-04-20 15:42 UTC',
    reasons: ['EMA continuation', 'RSI mid-range'],
  },
  {
    symbol: 'TSLA',
    state: 'EXIT_SIGNALLED',
    entryScore: 0.51,
    exitScore: 0.74,
    regime: 'Volatility expansion',
    updatedAt: '2026-04-20 15:43 UTC',
    reasons: ['ATR elevated', 'Stochastic stretched'],
  },
]

export const configFields: ConfigField[] = [
  {
    key: 'monitored_symbols',
    label: 'Monitored symbols',
    value: ['AAPL', 'AMZN', 'GOOGL', 'META', 'MSFT', 'NVDA', 'PLTR', 'TSLA'],
    description: 'Stocks scanned in real time by the edge worker.',
    group: 'Trading universe',
    inputType: 'symbols',
    placeholder: 'One symbol per line',
    options: ['AAPL', 'AMZN', 'GOOGL', 'META', 'MSFT', 'NVDA', 'PLTR', 'TSLA'],
  },
  {
    key: 'benchmark_symbol',
    label: 'Market reference',
    value: 'QQQ',
    description: 'Reference index or proxy used to compare the tracked stock against broader market movement.',
    group: 'Trading universe',
    inputType: 'text',
    placeholder: 'QQQ',
  },
  {
    key: 'session_timezone',
    label: 'Market day timezone',
    value: 'America/New_York',
    description: 'Timezone used to anchor the active trading day and the market calendar.',
    group: 'Trading universe',
    inputType: 'text',
    placeholder: 'America/New_York',
  },
  {
    key: 'buy_score_threshold',
    label: 'Entry score threshold',
    value: 0.65,
    description: 'Minimum aggregated score required to emit an entry cue. Raise it to make entries stricter; lower it to allow more entries.',
    group: 'Entry rules',
    inputType: 'number',
    step: 0.01,
  },
  {
    key: 'sell_score_threshold',
    label: 'Exit score threshold',
    value: 0.55,
    description: 'Minimum aggregated score required to emit an exit cue. Raise it to require stronger exit evidence; lower it to close positions sooner.',
    group: 'Exit rules',
    inputType: 'number',
    step: 0.01,
  },
  {
    key: 'buy_weight_sma',
    label: 'Entry SMA weight',
    value: 1.6,
    description: 'How much the SMA stack contributes to entry decisions. Increase it if trend alignment should matter more for entries.',
    group: 'Entry indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'buy_weight_ema',
    label: 'Entry EMA weight',
    value: 1.4,
    description: 'How much the EMA stack contributes to entry decisions.',
    group: 'Entry indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'buy_weight_vwap',
    label: 'Entry VWAP weight',
    value: 1.1,
    description: 'How much VWAP alignment influences entry decisions.',
    group: 'Entry indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'buy_weight_rsi',
    label: 'Entry RSI weight',
    value: 1.0,
    description: 'How much RSI momentum influences entry decisions.',
    group: 'Entry indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'buy_weight_atr',
    label: 'Entry ATR weight',
    value: 0.7,
    description: 'How much ATR volatility contributes to entry decisions.',
    group: 'Entry indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'buy_weight_dm',
    label: 'Entry directional movement weight',
    value: 0.8,
    description: 'How much DMI and ADX influence entry decisions.',
    group: 'Entry indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'buy_weight_macd',
    label: 'Entry MACD weight',
    value: 1.2,
    description: 'How much MACD momentum influences entry decisions.',
    group: 'Entry indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'buy_weight_stochastic',
    label: 'Entry stochastic weight',
    value: 0.8,
    description: 'How much stochastic turning points influence entry decisions.',
    group: 'Entry indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'buy_weight_1m',
    label: 'Entry 1-minute weight',
    value: 1.0,
    description: 'How much the 1-minute window contributes to entry scoring.',
    group: 'Entry timeframe weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'buy_weight_5m',
    label: 'Entry 5-minute weight',
    value: 0.75,
    description: 'How much the 5-minute window contributes to entry scoring.',
    group: 'Entry timeframe weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'buy_weight_15m',
    label: 'Entry 15-minute weight',
    value: 0.5,
    description: 'How much the 15-minute window contributes to entry scoring.',
    group: 'Entry timeframe weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'sell_weight_sma',
    label: 'Exit SMA weight',
    value: 1.6,
    description: 'How much the SMA stack contributes to exit decisions.',
    group: 'Exit indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'sell_weight_ema',
    label: 'Exit EMA weight',
    value: 1.4,
    description: 'How much the EMA stack contributes to exit decisions.',
    group: 'Exit indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'sell_weight_vwap',
    label: 'Exit VWAP weight',
    value: 1.1,
    description: 'How much VWAP alignment influences exit decisions.',
    group: 'Exit indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'sell_weight_rsi',
    label: 'Exit RSI weight',
    value: 1.0,
    description: 'How much RSI momentum influences exit decisions.',
    group: 'Exit indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'sell_weight_atr',
    label: 'Exit ATR weight',
    value: 0.7,
    description: 'How much ATR volatility contributes to exit decisions.',
    group: 'Exit indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'sell_weight_dm',
    label: 'Exit directional movement weight',
    value: 0.8,
    description: 'How much DMI and ADX influence exit decisions.',
    group: 'Exit indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'sell_weight_macd',
    label: 'Exit MACD weight',
    value: 1.2,
    description: 'How much MACD momentum influences exit decisions.',
    group: 'Exit indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'sell_weight_stochastic',
    label: 'Exit stochastic weight',
    value: 0.8,
    description: 'How much stochastic turning points influence exit decisions.',
    group: 'Exit indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'sell_weight_1m',
    label: 'Exit 1-minute weight',
    value: 1.0,
    description: 'How much the 1-minute window contributes to exit scoring.',
    group: 'Exit timeframe weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'sell_weight_5m',
    label: 'Exit 5-minute weight',
    value: 0.75,
    description: 'How much the 5-minute window contributes to exit scoring.',
    group: 'Exit timeframe weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'sell_weight_15m',
    label: 'Exit 15-minute weight',
    value: 0.5,
    description: 'How much the 15-minute window contributes to exit scoring.',
    group: 'Exit timeframe weights',
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

export function classifySignal(signal: AdminSignal): 'entry' | 'exit' | 'hold' {
  switch (signal.state) {
    case 'ENTRY_SIGNALLED':
      return 'entry'
    case 'EXIT_SIGNALLED':
      return 'exit'
    default:
      return 'hold'
  }
}
