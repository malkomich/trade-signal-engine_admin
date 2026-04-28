import { describe, expect, it } from 'vitest'
import { buildChartOption } from './charting'
import { marketCharts, type ChartDefinition } from './chart-definitions'
import type { MarketSnapshotRecord } from './dashboard'

function makeSnapshot(overrides: Partial<MarketSnapshotRecord>): MarketSnapshotRecord {
  return {
    id: overrides.id ?? 'snapshot-1',
    sessionId: overrides.sessionId ?? 'nasdaq-live',
    windowId: overrides.windowId ?? 'window-1',
    symbol: overrides.symbol ?? 'AAPL',
    timeframe: overrides.timeframe ?? '1m',
    timestamp: overrides.timestamp ?? '2026-04-24T13:30:00.000Z',
    open: overrides.open ?? 100,
    high: overrides.high ?? 101,
    low: overrides.low ?? 99,
    close: overrides.close ?? 100.5,
    volume: overrides.volume ?? 1_000,
    smaFast: overrides.smaFast ?? 100.2,
    smaSlow: overrides.smaSlow ?? 99.8,
    emaFast: overrides.emaFast ?? 100.3,
    emaSlow: overrides.emaSlow ?? 99.7,
    vwap: overrides.vwap ?? 100.1,
    rsi: overrides.rsi ?? 55,
    atr: overrides.atr ?? 0.8,
    plusDi: overrides.plusDi ?? 22,
    minusDi: overrides.minusDi ?? 18,
    adx: overrides.adx ?? 24,
    macd: overrides.macd ?? 0.2,
    macdSignal: overrides.macdSignal ?? 0.15,
    macdHistogram: overrides.macdHistogram ?? 0.05,
    stochasticK: overrides.stochasticK ?? 48,
    stochasticD: overrides.stochasticD ?? 45,
    bollingerMiddle: overrides.bollingerMiddle ?? 100,
    bollingerUpper: overrides.bollingerUpper ?? 101.5,
    bollingerLower: overrides.bollingerLower ?? 98.5,
    obv: overrides.obv ?? 1_500,
    relativeVolume: overrides.relativeVolume ?? 1.2,
    volumeProfile: overrides.volumeProfile ?? 0.22,
    entryScore: overrides.entryScore ?? 0.7,
    exitScore: overrides.exitScore ?? 0.3,
    eventType: overrides.eventType ?? 'market.snapshot',
    signalAction: overrides.signalAction ?? 'BUY_ALERT',
    signalState: overrides.signalState ?? 'FLAT',
    signalRegime: overrides.signalRegime ?? 'live market session',
    benchmarkSymbol: overrides.benchmarkSymbol ?? 'QQQ',
    reasons: overrides.reasons ?? [],
  }
}

describe('charting', () => {
  it('keeps stochastic charts in oscillator mode', () => {
    expect(marketCharts.find((chart) => chart.id === 'stochastic')?.kind).toBe('oscillator')
  })

  it('preserves non-null indicator values when resampling the same bucket', () => {
    const chart = marketCharts.find((item) => item.id === 'rsi')!
    const option = buildChartOption(chart, [
      makeSnapshot({ id: 'snapshot-a', timestamp: '2026-04-24T13:30:00.000Z', rsi: 55 }),
      makeSnapshot({ id: 'snapshot-b', timestamp: '2026-04-24T13:31:00.000Z', rsi: null, signalAction: 'SELL_ALERT' }),
    ], 5)

    const series = option.series as Array<{ name?: string; data?: Array<[number, number]> }>
    expect(series[0]?.name).toBe('RSI')
    expect(series[0]?.data).toEqual([[Date.parse('2026-04-24T13:30:00.000Z'), 55]])
  })

  it('renders histogram charts by series key rather than positional order', () => {
    const chart: ChartDefinition = {
      id: 'macd-scrambled',
      title: 'MACD',
      subtitle: 'Trend momentum and histogram',
      kind: 'histogram',
      series: [
        { key: 'macdSignal', label: 'Signal', color: '#c084fc', decimals: 3 },
        { key: 'macdHistogram', label: 'Histogram', color: '#34d399', decimals: 3 },
        { key: 'macd', label: 'MACD', color: '#38bdf8', decimals: 3 },
      ],
    }
    const option = buildChartOption(chart, [
      makeSnapshot({ id: 'snapshot-a', timestamp: '2026-04-24T13:30:00.000Z', macd: 0.42, macdSignal: 0.31, macdHistogram: 0.11 }),
    ], 1)

    const series = option.series as Array<{ name?: string }>
    expect(series[0]?.name).toBe('Histogram')
    expect(series[1]?.name).toBe('MACD')
    expect(series[2]?.name).toBe('Signal')
  })

  it('filters signal markers to the selected window', () => {
    const chart = marketCharts.find((item) => item.id === 'price-ema')!
    const option = buildChartOption(
      chart,
      [
        makeSnapshot({
          id: 'snapshot-a',
          windowId: 'window-1',
          timestamp: '2026-04-24T13:30:00.000Z',
          signalAction: 'BUY_ALERT',
        }),
        makeSnapshot({
          id: 'snapshot-b',
          windowId: 'window-2',
          timestamp: '2026-04-24T13:35:00.000Z',
          signalAction: 'SELL_ALERT',
        }),
      ],
      1,
      'window-1',
    )

    const series = option.series as Array<{ type?: string; name?: string }>
    const markerSeries = series.filter((item) => item.type === 'scatter')
    expect(markerSeries).toHaveLength(1)
    expect(markerSeries[0]?.name).toBe('Buy')
  })

  it('centers the visible range around the selected window duration', () => {
    const chart = marketCharts.find((item) => item.id === 'price-vwap')!
    const option = buildChartOption(
      chart,
      [
        makeSnapshot({
          id: 'snapshot-a',
          windowId: 'window-1',
          timestamp: '2026-04-24T13:30:00.000Z',
          signalAction: 'BUY_ALERT',
        }),
        makeSnapshot({
          id: 'snapshot-b',
          windowId: 'window-1',
          timestamp: '2026-04-24T13:34:00.000Z',
          signalAction: 'SELL_ALERT',
        }),
        makeSnapshot({
          id: 'snapshot-c',
          windowId: 'window-2',
          timestamp: '2026-04-24T14:10:00.000Z',
          signalAction: 'BUY_ALERT',
        }),
      ],
      1,
      'window-1',
    )

    const dataZoom = Array.isArray(option.dataZoom)
      ? (option.dataZoom[0] as { startValue?: number; endValue?: number } | undefined)
      : null
    expect(typeof dataZoom?.startValue).toBe('number')
    expect(typeof dataZoom?.endValue).toBe('number')
    expect((dataZoom?.endValue ?? 0) - (dataZoom?.startValue ?? 0)).toBeGreaterThanOrEqual(15 * 60 * 1000)
    expect(dataZoom?.startValue ?? 0).toBeLessThan(Date.parse('2026-04-24T13:30:00.000Z'))
    expect(dataZoom?.endValue ?? 0).toBeGreaterThan(Date.parse('2026-04-24T13:34:00.000Z'))
  })

  it('escapes tooltip content before rendering HTML', () => {
    const chart = marketCharts.find((item) => item.id === 'price-ema')!
    const option = buildChartOption(
      chart,
      [
        makeSnapshot({
          id: 'snapshot-a',
          timestamp: '2026-04-24T13:30:00.000Z',
          signalAction: 'BUY_ALERT',
          reasons: ['<img src=x onerror=alert(1)>'],
        }),
      ],
      1,
      'window-1',
    )

    const tooltip = option.tooltip && typeof option.tooltip === 'object' ? option.tooltip as { formatter?: unknown } : null
    const formatter = tooltip?.formatter
    const html = typeof formatter === 'function'
      ? formatter([
          {
            seriesName: 'Buy',
            axisValue: Date.parse('2026-04-24T13:30:00.000Z'),
            data: {
              value: [Date.parse('2026-04-24T13:30:00.000Z'), 100],
              tooltipValue: '<img src=x onerror=alert(1)>',
            },
          },
        ])
      : ''

    expect(String(html)).not.toContain('<img src=x onerror=alert(1)>')
  })

  it('escapes tooltip content before rendering HTML', () => {
    const chart = marketCharts.find((item) => item.id === 'price-ema')!
    const option = buildChartOption(
      chart,
      [
        makeSnapshot({
          id: 'snapshot-a',
          timestamp: '2026-04-24T13:30:00.000Z',
          signalAction: 'BUY_ALERT',
          reasons: ['<img src=x onerror=alert(1)>'],
        }),
      ],
      1,
      'window-1',
    )

    const tooltip = option.tooltip && typeof option.tooltip === 'object' ? option.tooltip as { formatter?: unknown } : null
    const formatter = tooltip?.formatter
    const html = typeof formatter === 'function'
      ? formatter([
          {
            seriesName: 'Buy',
            axisValue: Date.parse('2026-04-24T13:30:00.000Z'),
            data: {
              value: [Date.parse('2026-04-24T13:30:00.000Z'), 100],
              tooltipValue: '<img src=x onerror=alert(1)>',
            },
          },
        ])
      : ''

    expect(String(html)).not.toContain('<img src=x onerror=alert(1)>')
  })
})
