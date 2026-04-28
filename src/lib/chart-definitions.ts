import type { MarketSnapshotRecord } from './dashboard'

export type ChartSeriesKey = keyof Pick<
  MarketSnapshotRecord,
  | 'close'
  | 'smaFast'
  | 'smaSlow'
  | 'emaFast'
  | 'emaSlow'
  | 'vwap'
  | 'rsi'
  | 'atr'
  | 'plusDi'
  | 'minusDi'
  | 'adx'
  | 'macd'
  | 'macdSignal'
  | 'macdHistogram'
  | 'stochasticK'
  | 'stochasticD'
>

export type ChartSeries = {
  key: ChartSeriesKey
  label: string
  color: string
  decimals?: number
}

export type ChartKind = 'price' | 'line' | 'oscillator' | 'histogram'

export type ChartDefinition = {
  id: string
  title: string
  subtitle: string
  kind: ChartKind
  series: ChartSeries[]
}

export const chartIntervals = [1, 5, 10, 30, 60] as const

export const marketCharts: ChartDefinition[] = [
  {
    id: 'price',
    title: 'Price action',
    subtitle: 'Candles with moving averages and VWAP overlay',
    kind: 'price',
    series: [
      { key: 'smaFast', label: 'Fast SMA', color: '#34d399', decimals: 2 },
      { key: 'smaSlow', label: 'Slow SMA', color: '#f59e0b', decimals: 2 },
      { key: 'emaFast', label: 'Fast EMA', color: '#60a5fa', decimals: 2 },
      { key: 'emaSlow', label: 'Slow EMA', color: '#c084fc', decimals: 2 },
      { key: 'vwap', label: 'VWAP', color: '#22d3ee', decimals: 2 },
    ],
  },
  {
    id: 'rsi',
    title: 'RSI',
    subtitle: 'Momentum oscillator with overbought and oversold zones',
    kind: 'oscillator',
    series: [{ key: 'rsi', label: 'RSI', color: '#fb7185', decimals: 1 }],
  },
  {
    id: 'atr',
    title: 'ATR',
    subtitle: 'Average true range for volatility monitoring',
    kind: 'line',
    series: [{ key: 'atr', label: 'ATR', color: '#f97316', decimals: 2 }],
  },
  {
    id: 'dmi',
    title: 'DMI / ADX',
    subtitle: 'Directional movement and trend strength',
    kind: 'line',
    series: [
      { key: 'plusDi', label: '+DI', color: '#22c55e', decimals: 1 },
      { key: 'minusDi', label: '-DI', color: '#ef4444', decimals: 1 },
      { key: 'adx', label: 'ADX', color: '#f59e0b', decimals: 1 },
    ],
  },
  {
    id: 'macd',
    title: 'MACD',
    subtitle: 'Momentum spread, signal line, and histogram',
    kind: 'histogram',
    series: [
      { key: 'macd', label: 'MACD', color: '#38bdf8', decimals: 3 },
      { key: 'macdSignal', label: 'Signal', color: '#c084fc', decimals: 3 },
      { key: 'macdHistogram', label: 'Histogram', color: '#34d399', decimals: 3 },
    ],
  },
  {
    id: 'stochastic',
    title: 'Stochastic',
    subtitle: 'Momentum turning points',
    kind: 'line',
    series: [
      { key: 'stochasticK', label: '%K', color: '#f472b6', decimals: 1 },
      { key: 'stochasticD', label: '%D', color: '#fbbf24', decimals: 1 },
    ],
  },
]
