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
  | 'bollingerMiddle'
  | 'bollingerUpper'
  | 'bollingerLower'
  | 'obv'
  | 'relativeVolume'
  | 'volumeProfile'
>

export type ChartSeries = {
  key: ChartSeriesKey
  label: string
  color: string
  decimals?: number
  description?: string
}

export type ChartKind = 'price' | 'line' | 'oscillator' | 'histogram'

export type ChartDefinition = {
  id: string
  title: string
  subtitle: string
  kind: ChartKind
  series: ChartSeries[]
}

export type ChartGroup = {
  id: string
  title: string
  description: string
  charts: ChartDefinition[]
}

export const chartIntervals = [1, 5, 10, 30, 60] as const

const trendCharts: ChartDefinition[] = [
  {
    id: 'price-sma',
    title: 'Price + SMA',
    subtitle: 'Candles with fast and slow simple moving averages',
    kind: 'price',
    series: [
      {
        key: 'smaFast',
        label: 'Fast SMA',
        color: '#34d399',
        decimals: 2,
        description: 'Fast simple moving average used to confirm short-term trend alignment.',
      },
      {
        key: 'smaSlow',
        label: 'Slow SMA',
        color: '#f59e0b',
        decimals: 2,
        description: 'Slow simple moving average used to confirm broader trend direction.',
      },
    ],
  },
  {
    id: 'price-ema',
    title: 'Price + EMA',
    subtitle: 'Candles with fast and slow exponential moving averages',
    kind: 'price',
    series: [
      {
        key: 'emaFast',
        label: 'Fast EMA',
        color: '#60a5fa',
        decimals: 2,
        description: 'Fast exponential moving average for short-term momentum confirmation.',
      },
      {
        key: 'emaSlow',
        label: 'Slow EMA',
        color: '#c084fc',
        decimals: 2,
        description: 'Slow exponential moving average for medium-term trend structure.',
      },
    ],
  },
  {
    id: 'price-vwap',
    title: 'Price + VWAP',
    subtitle: 'Candles with volume-weighted average price overlay',
    kind: 'price',
    series: [
      {
        key: 'vwap',
        label: 'VWAP',
        color: '#22d3ee',
        decimals: 2,
        description: 'Volume-weighted average price used as a fairness and reclaim reference.',
      },
    ],
  },
  {
    id: 'bollinger',
    title: 'Bollinger Bands',
    subtitle: 'Price with the Bollinger middle, upper, and lower bands',
    kind: 'price',
    series: [
      {
        key: 'bollingerMiddle',
        label: 'Middle band',
        color: '#38bdf8',
        decimals: 2,
        description: 'Bollinger middle band, often used as a dynamic mean reference.',
      },
      {
        key: 'bollingerUpper',
        label: 'Upper band',
        color: '#f97316',
        decimals: 2,
        description: 'Upper Bollinger band used to detect stretched moves and breakout rejection.',
      },
      {
        key: 'bollingerLower',
        label: 'Lower band',
        color: '#22c55e',
        decimals: 2,
        description: 'Lower Bollinger band used to detect oversold rejection and expansion.',
      },
    ],
  },
]

const momentumCharts: ChartDefinition[] = [
  {
    id: 'rsi',
    title: 'RSI',
    subtitle: 'Momentum oscillator with overbought and oversold zones',
    kind: 'oscillator',
    series: [
      {
        key: 'rsi',
        label: 'RSI',
        color: '#fb7185',
        decimals: 1,
        description: 'Relative strength index oscillator with 30/70 reference zones.',
      },
    ],
  },
  {
    id: 'macd',
    title: 'MACD',
    subtitle: 'Momentum spread, signal line, and histogram',
    kind: 'histogram',
    series: [
      {
        key: 'macd',
        label: 'MACD',
        color: '#38bdf8',
        decimals: 3,
        description: 'MACD line highlighting trend momentum.',
      },
      {
        key: 'macdSignal',
        label: 'Signal',
        color: '#c084fc',
        decimals: 3,
        description: 'MACD signal line used to detect crossovers.',
      },
      {
        key: 'macdHistogram',
        label: 'Histogram',
        color: '#34d399',
        decimals: 3,
        description: 'MACD histogram showing momentum spread between the MACD and signal lines.',
      },
    ],
  },
  {
    id: 'stochastic',
    title: 'Stochastic',
    subtitle: 'Fast and slow momentum turning points',
    kind: 'oscillator',
    series: [
      {
        key: 'stochasticK',
        label: '%K',
        color: '#f472b6',
        decimals: 1,
        description: 'Fast stochastic line used to spot momentum turns.',
      },
      {
        key: 'stochasticD',
        label: '%D',
        color: '#fbbf24',
        decimals: 1,
        description: 'Slow stochastic line used to confirm turns.',
      },
    ],
  },
]

const volatilityCharts: ChartDefinition[] = [
  {
    id: 'atr',
    title: 'ATR',
    subtitle: 'Average true range for volatility monitoring',
    kind: 'line',
    series: [
      {
        key: 'atr',
        label: 'ATR',
        color: '#f97316',
        decimals: 2,
        description: 'Average true range used to measure volatility expansion.',
      },
    ],
  },
]

const trendStrengthCharts: ChartDefinition[] = [
  {
    id: 'dmi',
    title: 'DMI / ADX',
    subtitle: 'Directional movement and trend strength',
    kind: 'line',
    series: [
      {
        key: 'plusDi',
        label: '+DI',
        color: '#22c55e',
        decimals: 1,
        description: 'Positive directional index showing bullish directional movement.',
      },
      {
        key: 'minusDi',
        label: '-DI',
        color: '#ef4444',
        decimals: 1,
        description: 'Negative directional index showing bearish directional movement.',
      },
      {
        key: 'adx',
        label: 'ADX',
        color: '#f59e0b',
        decimals: 1,
        description: 'Average directional index measuring trend strength.',
      },
    ],
  },
]

const volumeCharts: ChartDefinition[] = [
  {
    id: 'obv',
    title: 'OBV',
    subtitle: 'On-balance volume confirms trend participation',
    kind: 'line',
    series: [
      {
        key: 'obv',
        label: 'OBV',
        color: '#7dd3fc',
        decimals: 0,
        description: 'On-balance volume accumulation / distribution line.',
      },
    ],
  },
  {
    id: 'relative-volume',
    title: 'Relative volume',
    subtitle: 'Current volume compared with its recent average',
    kind: 'line',
    series: [
      {
        key: 'relativeVolume',
        label: 'Relative volume',
        color: '#a78bfa',
        decimals: 2,
        description: 'Current volume versus its rolling average.',
      },
    ],
  },
  {
    id: 'volume-profile',
    title: 'Volume profile',
    subtitle: 'Relative acceptance of the current price inside the recent trading range',
    kind: 'line',
    series: [
      {
        key: 'volumeProfile',
        label: 'Volume profile',
        color: '#f43f5e',
        decimals: 2,
        description: 'Relative volume acceptance at the current price area.',
      },
    ],
  },
]

export const marketChartGroups: ChartGroup[] = [
  {
    id: 'trend',
    title: 'Trend',
    description: 'Price action and trend overlays used to confirm long setups.',
    charts: trendCharts,
  },
  {
    id: 'momentum',
    title: 'Momentum',
    description: 'Momentum oscillators and divergence checks for entry timing.',
    charts: momentumCharts,
  },
  {
    id: 'volatility',
    title: 'Volatility',
    description: 'Range expansion and volatility regime context.',
    charts: volatilityCharts,
  },
  {
    id: 'trend-strength',
    title: 'Trend strength',
    description: 'Directional movement and ADX support for trend-following setups.',
    charts: trendStrengthCharts,
  },
  {
    id: 'volume-flow',
    title: 'Volume / flow',
    description: 'Participation and accumulation pressure during the setup.',
    charts: volumeCharts,
  },
]

export const marketCharts = marketChartGroups.flatMap((group) => group.charts)
