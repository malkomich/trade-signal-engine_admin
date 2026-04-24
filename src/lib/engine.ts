export type SignalState = 'FLAT' | 'ENTRY_SIGNALLED' | 'ACCEPTED_OPEN' | 'EXIT_SIGNALLED' | 'CLOSED' | 'REJECTED' | 'EXPIRED'

export type AdminSignal = {
  symbol: string
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
    label: 'Benchmark proxy',
    value: 'QQQ',
    description: 'Benchmark proxy used to compare the live market context. QQQ is the default live proxy.',
    group: 'Trading universe',
    inputType: 'text',
    placeholder: 'QQQ',
  },
  {
    key: 'session_timezone',
    label: 'Market timezone',
    value: 'America/New_York',
    description: 'Timezone used to anchor the active trading day and the market calendar.',
    group: 'Trading universe',
    inputType: 'text',
    placeholder: 'America/New_York',
  },
  {
    key: 'buy_score_threshold',
    label: 'Buy score threshold',
    value: 0.65,
    description: 'Minimum aggregated score required to emit a buy alert. Raise it to make entries stricter; lower it to allow more entries.',
    group: 'Buy decision rules',
    inputType: 'number',
    step: 0.01,
  },
  {
    key: 'sell_score_threshold',
    label: 'Sell score threshold',
    value: 0.55,
    description: 'Minimum aggregated score required to emit a sell alert. Raise it to require stronger exit evidence; lower it to close positions sooner.',
    group: 'Sell decision rules',
    inputType: 'number',
    step: 0.01,
  },
  {
    key: 'buy_weight_sma',
    label: 'Buy SMA weight',
    value: 1.6,
    description: 'How much the SMA stack contributes to buy decisions. Increase it if trend alignment should matter more for entries.',
    group: 'Buy indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'buy_weight_ema',
    label: 'Buy EMA weight',
    value: 1.4,
    description: 'How much the EMA stack contributes to buy decisions.',
    group: 'Buy indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'buy_weight_vwap',
    label: 'Buy VWAP weight',
    value: 1.1,
    description: 'How much VWAP alignment influences buy decisions.',
    group: 'Buy indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'buy_weight_rsi',
    label: 'Buy RSI weight',
    value: 1.0,
    description: 'How much RSI momentum influences buy decisions.',
    group: 'Buy indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'buy_weight_atr',
    label: 'Buy ATR weight',
    value: 0.7,
    description: 'How much ATR volatility contributes to buy decisions.',
    group: 'Buy indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'buy_weight_dm',
    label: 'Buy directional movement weight',
    value: 0.8,
    description: 'How much DMI and ADX influence buy decisions.',
    group: 'Buy indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'buy_weight_macd',
    label: 'Buy MACD weight',
    value: 1.2,
    description: 'How much MACD momentum influences buy decisions.',
    group: 'Buy indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'buy_weight_stochastic',
    label: 'Buy stochastic weight',
    value: 0.8,
    description: 'How much stochastic turning points influence buy decisions.',
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
    value: 0.75,
    description: 'How much the 5-minute window contributes to buy scoring.',
    group: 'Buy timeframe weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'buy_weight_15m',
    label: 'Buy 15-minute weight',
    value: 0.5,
    description: 'How much the 15-minute window contributes to buy scoring.',
    group: 'Buy timeframe weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'sell_weight_sma',
    label: 'Sell SMA weight',
    value: 1.6,
    description: 'How much the SMA stack contributes to sell decisions.',
    group: 'Sell indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'sell_weight_ema',
    label: 'Sell EMA weight',
    value: 1.4,
    description: 'How much the EMA stack contributes to sell decisions.',
    group: 'Sell indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'sell_weight_vwap',
    label: 'Sell VWAP weight',
    value: 1.1,
    description: 'How much VWAP alignment influences sell decisions.',
    group: 'Sell indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'sell_weight_rsi',
    label: 'Sell RSI weight',
    value: 1.0,
    description: 'How much RSI momentum influences sell decisions.',
    group: 'Sell indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'sell_weight_atr',
    label: 'Sell ATR weight',
    value: 0.7,
    description: 'How much ATR volatility contributes to sell decisions.',
    group: 'Sell indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'sell_weight_dm',
    label: 'Sell directional movement weight',
    value: 0.8,
    description: 'How much DMI and ADX influence sell decisions.',
    group: 'Sell indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'sell_weight_macd',
    label: 'Sell MACD weight',
    value: 1.2,
    description: 'How much MACD momentum influences sell decisions.',
    group: 'Sell indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'sell_weight_stochastic',
    label: 'Sell stochastic weight',
    value: 0.8,
    description: 'How much stochastic turning points influence sell decisions.',
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
    value: 0.75,
    description: 'How much the 5-minute window contributes to sell scoring.',
    group: 'Sell timeframe weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'sell_weight_15m',
    label: 'Sell 15-minute weight',
    value: 0.5,
    description: 'How much the 15-minute window contributes to sell scoring.',
    group: 'Sell timeframe weights',
    inputType: 'number',
    step: 0.1,
  },
]

export function classifySignal(signal: AdminSignal): 'entry' | 'exit' | 'hold' {
  if (signal.state === 'REJECTED' || signal.state === 'EXPIRED') {
    return 'hold'
  }
  if (signal.state === 'EXIT_SIGNALLED' || signal.exitScore >= 0.7) {
    return 'exit'
  }
  if (signal.state === 'ENTRY_SIGNALLED' || signal.entryScore >= 0.7) {
    return 'entry'
  }
  return 'hold'
}
