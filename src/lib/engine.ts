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

export type ConfigField = {
  key: string
  value: number
  description: string
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
  { key: 'entryThreshold', value: 0.65, description: 'Minimum score to emit an entry alert.' },
  { key: 'exitThreshold', value: 0.55, description: 'Exit veto threshold. If the exit score is close, suppress the buy alert.' },
  { key: 'cooldownMinutes', value: 8, description: 'Cooldown after rejected signals.' },
  { key: 'maxSymbolsPerSession', value: 120, description: 'Symbol universe cap for the session worker.' },
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

