export type SignalState = 'FLAT' | 'ENTRY_SIGNALLED' | 'ACCEPTED_OPEN' | 'EXIT_SIGNALLED' | 'CLOSED'

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
  },
  {
    key: 'benchmark_symbol',
    label: 'Benchmark symbol',
    value: 'QQQ',
    description: 'Nasdaq benchmark used to compare the live regime.',
    group: 'Trading universe',
    inputType: 'text',
    placeholder: 'QQQ',
  },
  {
    key: 'session_timezone',
    label: 'Session timezone',
    value: 'America/New_York',
    description: 'Timezone used to anchor the active trading day.',
    group: 'Trading universe',
    inputType: 'text',
    placeholder: 'America/New_York',
  },
  {
    key: 'entry_score_threshold',
    label: 'Entry score threshold',
    value: 0.65,
    description: 'Minimum aggregated score required to emit an entry alert.',
    group: 'Trade decisions',
    inputType: 'number',
    step: 0.01,
  },
  {
    key: 'exit_score_threshold',
    label: 'Exit score threshold',
    value: 0.55,
    description: 'Minimum aggregated score required to emit an exit alert.',
    group: 'Trade decisions',
    inputType: 'number',
    step: 0.01,
  },
  {
    key: 'weight_sma',
    label: 'SMA trend weight',
    value: 1.6,
    description: 'Contribution of the SMA stack to the entry and exit score.',
    group: 'Indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'weight_ema',
    label: 'EMA trend weight',
    value: 1.4,
    description: 'Contribution of the EMA stack to the entry and exit score.',
    group: 'Indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'weight_vwap',
    label: 'VWAP alignment weight',
    value: 1.1,
    description: 'Weight applied when price trades above or below VWAP.',
    group: 'Indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'weight_rsi',
    label: 'RSI momentum weight',
    value: 1.0,
    description: 'Weight used to score the momentum oscillator.',
    group: 'Indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'weight_atr',
    label: 'ATR volatility weight',
    value: 0.7,
    description: 'Weight assigned to volatility expansion and compression.',
    group: 'Indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'weight_dm',
    label: 'Directional movement weight',
    value: 0.8,
    description: 'Weight assigned to the DMI and ADX trend regime.',
    group: 'Indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'weight_macd',
    label: 'MACD momentum weight',
    value: 1.2,
    description: 'Weight assigned to the MACD line, signal and histogram.',
    group: 'Indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'weight_stochastic',
    label: 'Stochastic turning-point weight',
    value: 0.8,
    description: 'Weight assigned to the stochastic oscillator.',
    group: 'Indicator weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'weight_1m',
    label: '1-minute window weight',
    value: 1.0,
    description: 'Weight used when the engine scores the base 1-minute window.',
    group: 'Window weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'weight_5m',
    label: '5-minute window weight',
    value: 0.75,
    description: 'Weight reserved for the 5-minute window in the signal stack.',
    group: 'Window weights',
    inputType: 'number',
    step: 0.1,
  },
  {
    key: 'weight_15m',
    label: '15-minute window weight',
    value: 0.5,
    description: 'Weight reserved for the 15-minute window in the signal stack.',
    group: 'Window weights',
    inputType: 'number',
    step: 0.1,
  },
]

export function classifySignal(signal: AdminSignal): 'entry' | 'exit' | 'hold' {
  if (signal.state === 'EXIT_SIGNALLED' || signal.exitScore >= 0.7) {
    return 'exit'
  }
  if (signal.state === 'ENTRY_SIGNALLED' || signal.entryScore >= 0.7) {
    return 'entry'
  }
  return 'hold'
}
