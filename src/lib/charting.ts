import type { EChartsOption, SeriesOption } from 'echarts'
import type { MarketSnapshotRecord } from './dashboard'
import type { ChartDefinition, ChartSeries } from './chart-definitions'

type AggregatedSnapshot = {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  values: Partial<Record<keyof MarketSnapshotRecord, number | null | undefined>>
  snapshotId: string
  signalAction: string | null
  signalState: string
}

type SignalMarkerKind = 'buy' | 'sell'
type SignalMarkerDatum = { value: [number, number] }

export type ChartZoom = {
  x: number
  y: number
}

const CHART_AXIS_MIN_PADDING_RATIO = 0.06
const CHART_AXIS_MIN_PADDING_INTERVAL_MULTIPLIER = 1.5
const CHART_AXIS_MIN_DURATION_MS = 5 * 60 * 1000
const CHART_AXIS_FOCUS_MULTIPLIERS = [
  { maxDurationMs: 5 * 60 * 1000, visibleSpanMs: 10 * 60 * 1000 },
  { maxDurationMs: 15 * 60 * 1000, visibleSpanMs: 18 * 60 * 1000 },
  { maxDurationMs: 30 * 60 * 1000, visibleSpanMs: 30 * 60 * 1000 },
  { maxDurationMs: 60 * 60 * 1000, visibleSpanMs: 60 * 60 * 1000 },
] as const
const CHART_Y_PADDING_RATIO = {
  price: 0.035,
  line: 0.055,
  oscillator: 0.035,
  histogram: 0.08,
} as const

function parseTimestamp(value: string) {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function readSeriesValue(record: MarketSnapshotRecord, key: ChartSeries['key']) {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function formatTooltipValue(value: number | null, decimals = 2) {
  if (value === null) {
    return '--'
  }
  return value.toFixed(decimals)
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function buildSnapshotValues(record: MarketSnapshotRecord) {
  return {
    close: record.close,
    smaFast: record.smaFast,
    smaSlow: record.smaSlow,
    emaFast: record.emaFast,
    emaSlow: record.emaSlow,
    vwap: record.vwap,
    rsi: record.rsi,
    atr: record.atr,
    plusDi: record.plusDi,
    minusDi: record.minusDi,
    adx: record.adx,
    macd: record.macd,
    macdSignal: record.macdSignal,
    macdHistogram: record.macdHistogram,
    stochasticK: record.stochasticK,
    stochasticD: record.stochasticD,
    bollingerMiddle: record.bollingerMiddle,
    bollingerUpper: record.bollingerUpper,
    bollingerLower: record.bollingerLower,
    obv: record.obv,
    relativeVolume: record.relativeVolume,
    volumeProfile: record.volumeProfile,
  } satisfies AggregatedSnapshot['values']
}

function mergeSnapshotValues(
  current: AggregatedSnapshot['values'],
  next: AggregatedSnapshot['values'],
): AggregatedSnapshot['values'] {
  const merged: AggregatedSnapshot['values'] = { ...current }
  for (const key of Object.keys(next) as Array<keyof AggregatedSnapshot['values']>) {
    const value = next[key]
    if (value !== null && value !== undefined && Number.isFinite(value)) {
      merged[key] = value
    }
  }
  return merged
}

function aggregateSnapshots(records: MarketSnapshotRecord[], intervalMinutes: number): AggregatedSnapshot[] {
  const sortedRecords = records
    .map((record) => ({
      record,
      timestamp: parseTimestamp(record.timestamp) ?? 0,
    }))
    .sort((left, right) => {
      if (left.timestamp !== right.timestamp) {
        return left.timestamp - right.timestamp
      }
      if (left.record.symbol !== right.record.symbol) {
        return left.record.symbol.localeCompare(right.record.symbol)
      }
      return left.record.id.localeCompare(right.record.id)
    })
    .map((item) => item.record)

  if (intervalMinutes <= 1 || sortedRecords.length <= 1) {
    return sortedRecords
      .map<AggregatedSnapshot | null>((record) => {
        const timestamp = parseTimestamp(record.timestamp)
        if (timestamp === null) {
          return null
        }
        return {
          timestamp,
          open: record.open,
          high: record.high,
          low: record.low,
          close: record.close,
          volume: record.volume,
          values: buildSnapshotValues(record),
          snapshotId: record.id,
          signalAction: record.signalAction?.trim().toUpperCase() ?? null,
          signalState: record.signalState,
        } satisfies AggregatedSnapshot
      })
      .filter((value): value is AggregatedSnapshot => value !== null)
  }

  const intervalMs = intervalMinutes * 60 * 1000
  const buckets = new Map<number, AggregatedSnapshot>()
  for (const record of sortedRecords) {
    const timestamp = parseTimestamp(record.timestamp)
    if (timestamp === null) {
      continue
    }
    const bucketKey = Math.floor(timestamp / intervalMs)
    const bucketTimestamp = bucketKey * intervalMs
    const current = buckets.get(bucketKey)
    const values = buildSnapshotValues(record)
    if (!current) {
      buckets.set(bucketKey, {
        timestamp: bucketTimestamp,
        open: record.open,
        high: record.high,
        low: record.low,
        close: record.close,
        volume: record.volume,
        values,
        snapshotId: record.id,
        signalAction: record.signalAction?.trim().toUpperCase() ?? null,
        signalState: record.signalState,
      })
      continue
    }
    current.timestamp = bucketTimestamp
    current.high = Math.max(current.high, record.high)
    current.low = Math.min(current.low, record.low)
    current.close = record.close
    current.volume += record.volume
    current.values = mergeSnapshotValues(current.values, values)
    current.snapshotId = record.id
    current.signalAction = record.signalAction?.trim().toUpperCase() ?? current.signalAction
    current.signalState = record.signalState
  }

  return Array.from(buckets.values()).sort((left, right) => left.timestamp - right.timestamp)
}

function buildSeriesData(points: AggregatedSnapshot[], seriesKey: ChartSeries['key']): Array<[number, number]> {
  return points
    .map((point) => {
      const value = point.values[seriesKey]
      if (value === null || value === undefined || !Number.isFinite(value)) {
        return null
      }
      return [point.timestamp, value] as [number, number]
    })
    .filter((value): value is [number, number] => value !== null)
}

function chartMarkerValue(record: MarketSnapshotRecord, chart: ChartDefinition) {
  if (chart.kind === 'price') {
    return record.close
  }
  const primarySeries = chart.series[0]
  if (primarySeries) {
    const value = readSeriesValue(record, primarySeries.key)
    if (value !== null) {
      return value
    }
  }
  const fallbackSeries = chart.series
    .map((series) => readSeriesValue(record, series.key))
    .find((value): value is number => typeof value === 'number')
  return fallbackSeries ?? record.close
}

function axisRange(points: AggregatedSnapshot[], intervalMinutes: number, zoomX = 1) {
  if (points.length === 0) {
    return null
  }
  const timestamps = points.map((point) => point.timestamp).filter((value) => Number.isFinite(value))
  if (timestamps.length === 0) {
    return null
  }
  let min = timestamps[0]
  let max = timestamps[0]
  for (let index = 1; index < timestamps.length; index += 1) {
    const value = timestamps[index]
    if (value < min) {
      min = value
    }
    if (value > max) {
      max = value
    }
  }
  const span = Math.max(max - min, CHART_AXIS_MIN_DURATION_MS)
  const padding = Math.max(
    span * CHART_AXIS_MIN_PADDING_RATIO,
    intervalMinutes * 60 * 1000 * CHART_AXIS_MIN_PADDING_INTERVAL_MULTIPLIER,
  )
  const visibleSpan = Math.max(span + (padding * 2), intervalMinutes * 60 * 1000 * 4) * Math.max(zoomX, 0.1)
  const center = min + (span / 2)
  return {
    min: center - (visibleSpan / 2),
    max: center + (visibleSpan / 2),
  }
}

function visibleSpanForDuration(durationMs: number, zoomX = 1) {
  const preset = CHART_AXIS_FOCUS_MULTIPLIERS.find((item) => durationMs <= item.maxDurationMs)
  const baseVisibleSpan = preset ? preset.visibleSpanMs : Math.max(durationMs * 1.5, 75 * 60 * 1000)
  return Math.max(baseVisibleSpan * Math.max(zoomX, 0.1), CHART_AXIS_MIN_DURATION_MS)
}

function signalMarkerSeries(
  chart: ChartDefinition,
  snapshots: MarketSnapshotRecord[],
  windowId?: string | null,
): SeriesOption[] {
  const markers: Array<{ kind: SignalMarkerKind; snapshot: MarketSnapshotRecord }> = snapshots
    .filter((snapshot) => {
      if (windowId && snapshot.windowId !== windowId) {
        return false
      }
      return snapshot.signalAction?.toUpperCase() === 'BUY_ALERT' || snapshot.signalAction?.toUpperCase() === 'SELL_ALERT'
    })
    .map((snapshot) => ({
      kind: snapshot.signalAction?.toUpperCase() === 'BUY_ALERT' ? 'buy' : 'sell',
      snapshot,
    }))

  return markers.flatMap((marker) => {
    const timestamp = parseTimestamp(marker.snapshot.timestamp)
    const value = chartMarkerValue(marker.snapshot, chart)
    const data: SignalMarkerDatum[] = timestamp === null ? [] : [{ value: [timestamp, value] }]
    const color = marker.kind === 'buy' ? '#22c55e' : '#ef4444'
    return [
      {
        type: 'scatter',
        name: marker.kind === 'buy' ? 'Buy' : 'Sell',
        data,
        symbol: marker.kind === 'buy' ? 'triangle' : 'diamond',
        symbolSize: 14,
        itemStyle: {
          color,
          borderColor: '#ffffff',
          borderWidth: 1,
        },
        emphasis: { scale: 1.1 },
        z: 20,
        markLine: timestamp === null ? undefined : {
          label: { show: false },
          symbol: 'none',
          silent: false,
          lineStyle: {
            type: 'dashed',
            color,
            width: 1.5,
          },
          data: [{ xAxis: timestamp }],
        },
      } as SeriesOption,
    ]
  })
}

function lineSeries(series: ChartSeries, points: AggregatedSnapshot[], smooth = false): SeriesOption {
  return {
    type: 'line',
    name: series.label,
    showSymbol: false,
    smooth,
    data: buildSeriesData(points, series.key),
    lineStyle: { width: 2, color: series.color },
    itemStyle: { color: series.color },
    emphasis: { focus: 'series' },
  }
}

function candleSeries(points: AggregatedSnapshot[]): SeriesOption {
  return {
    type: 'candlestick',
    name: 'Price',
    data: points.map((point) => [point.timestamp, point.open, point.close, point.low, point.high]),
    barWidth: 6,
    barMaxWidth: 10,
    barMinWidth: 3,
    itemStyle: {
      color: '#16a34a',
      color0: '#dc2626',
      borderColor: '#16a34a',
      borderColor0: '#dc2626',
    },
  } satisfies SeriesOption
}

function histogramSeries(series: ChartSeries, points: AggregatedSnapshot[]): SeriesOption {
  return {
    type: 'bar',
    name: series.label,
    data: buildSeriesData(points, series.key).map(([timestamp, value]) => ({
      value: [timestamp, value],
      itemStyle: {
        color: value >= 0 ? series.color : '#ef4444',
      },
    })),
    itemStyle: { color: series.color },
    barMaxWidth: 14,
  } satisfies SeriesOption
}

function buildTooltipFormatter(chart: ChartDefinition) {
  return (params: unknown) => {
    const items = Array.isArray(params) ? params : [params]
    const first = items[0] as { axisValue?: number; data?: unknown } | undefined
    const timestamp = typeof first?.axisValue === 'number' ? first.axisValue : null
    let rows = ''
    let signalLabel: string | null = null

    for (const item of items as Array<{ seriesName?: string; data?: unknown }>) {
      const data = item.data
      if (item.seriesName === 'Price' && Array.isArray(data)) {
        const [, open, close, low, high] = data as [number, number, number, number, number]
        rows += `<tr><th>${escapeHtml('Open')}</th><td>${escapeHtml(open.toFixed(2))}</td></tr>`
        rows += `<tr><th>${escapeHtml('High')}</th><td>${escapeHtml(high.toFixed(2))}</td></tr>`
        rows += `<tr><th>${escapeHtml('Low')}</th><td>${escapeHtml(low.toFixed(2))}</td></tr>`
        rows += `<tr><th>${escapeHtml('Close')}</th><td>${escapeHtml(close.toFixed(2))}</td></tr>`
        continue
      }
      if (item.seriesName === 'Buy' || item.seriesName === 'Sell') {
        signalLabel = item.seriesName
        continue
      }
      if (item.seriesName && Array.isArray(data) && data.length >= 2 && typeof data[1] === 'number') {
        const series = chart.series.find((seriesItem) => seriesItem.label === item.seriesName)
        rows += `<tr><th>${escapeHtml(item.seriesName)}</th><td>${escapeHtml(formatTooltipValue(data[1], series?.decimals ?? 2))}</td></tr>`
        continue
      }
      if (item.seriesName && typeof data === 'object' && data !== null && 'value' in data) {
        const value = (data as { value?: unknown }).value
        if (Array.isArray(value) && value.length >= 2 && typeof value[1] === 'number') {
          const series = chart.series.find((seriesItem) => seriesItem.label === item.seriesName)
          rows += `<tr><th>${escapeHtml(item.seriesName)}</th><td>${escapeHtml(formatTooltipValue(value[1], series?.decimals ?? 2))}</td></tr>`
        }
      }
    }

    const title = signalLabel ? `${signalLabel} signal` : chart.title
    const timeLabel = timestamp
      ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(timestamp))
      : 'Current value'
    return `
      <div class="chart-tooltip">
        <div class="chart-tooltip__title">${escapeHtml(title)}</div>
        <div class="chart-tooltip__time">${escapeHtml(timeLabel)}</div>
        <table class="chart-tooltip__table">
          <tbody>${rows}</tbody>
        </table>
      </div>
    `
  }
}

function windowFocusRange(
  records: MarketSnapshotRecord[],
  windowId: string | null | undefined,
  intervalMinutes: number,
  zoomX = 1,
) {
  if (!windowId) {
    return null
  }
  const timestamps = records
    .filter((record) => record.windowId === windowId)
    .map((record) => parseTimestamp(record.timestamp))
    .filter((value): value is number => value !== null)
  if (timestamps.length === 0) {
    return null
  }
  let min = timestamps[0]
  let max = timestamps[0]
  for (let index = 1; index < timestamps.length; index += 1) {
    const value = timestamps[index]
    if (value < min) {
      min = value
    }
    if (value > max) {
      max = value
    }
  }
  const duration = Math.max(max - min, intervalMinutes * 60 * 1000)
  const visibleSpan = visibleSpanForDuration(duration, zoomX)
  const center = min + (duration / 2)
  return {
    min: center - (visibleSpan / 2),
    max: center + (visibleSpan / 2),
  }
}

function collectChartValues(chart: ChartDefinition, points: AggregatedSnapshot[]) {
  const values: number[] = []
  for (const point of points) {
    if (chart.kind === 'price') {
      values.push(point.open, point.high, point.low, point.close)
    }
    for (const series of chart.series) {
      const value = point.values[series.key]
      if (typeof value === 'number' && Number.isFinite(value)) {
        values.push(value)
      }
    }
  }
  return values.filter((value) => Number.isFinite(value))
}

function yAxisRange(chart: ChartDefinition, points: AggregatedSnapshot[], zoomY = 1) {
  const values = collectChartValues(chart, points)
  if (values.length === 0) {
    return null
  }

  let min = values[0]
  let max = values[0]
  for (let index = 1; index < values.length; index += 1) {
    const value = values[index]
    if (value < min) {
      min = value
    }
    if (value > max) {
      max = value
    }
  }

  if (chart.kind === 'oscillator') {
    const lower = Math.max(0, Math.min(min, 0) - 4 * Math.max(zoomY, 0.1))
    const upper = Math.min(100, Math.max(max, 100) + 4 * Math.max(zoomY, 0.1))
    return { min: lower, max: upper }
  }

  const span = Math.max(max - min, 1)
  const kindPadding = CHART_Y_PADDING_RATIO[chart.kind]
  const padding = Math.max(span * kindPadding * Math.max(zoomY, 0.1), span * 0.02)
  const center = min + (span / 2)
  return {
    min: center - (span / 2) - padding,
    max: center + (span / 2) + padding,
  }
}

export function buildChartOption(
  chart: ChartDefinition,
  snapshots: MarketSnapshotRecord[],
  intervalMinutes: number,
  windowId?: string | null,
  zoom: ChartZoom = { x: 1, y: 1 },
): EChartsOption {
  const points = aggregateSnapshots(snapshots, intervalMinutes)
  const range = windowFocusRange(snapshots, windowId, intervalMinutes, zoom.x) ?? axisRange(points, intervalMinutes, zoom.x)
  const valueRange = yAxisRange(chart, points, zoom.y)
  const axisLabelFormatter = (value: number) =>
    new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(value))

  if (points.length === 0) {
    return {
      animation: false,
      grid: { left: 52, right: 24, top: 24, bottom: 42, containLabel: true },
      title: {
        text: 'No chart data available',
        left: 'center',
        top: 'center',
        textStyle: { color: '#94a3b8', fontSize: 13, fontWeight: 500 },
      },
      xAxis: { type: 'time' },
      yAxis: { type: 'value' },
      series: [],
    }
  }

  const baseOption: EChartsOption = {
    animation: false,
    grid: { left: 70, right: 40, top: 38, bottom: 64, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      backgroundColor: 'rgba(15, 23, 42, 0.96)',
      borderColor: '#1e293b',
      textStyle: { color: '#e2e8f0' },
      confine: true,
      extraCssText: 'border-radius: 12px; padding: 0;',
      formatter: buildTooltipFormatter(chart),
    },
    legend: { show: false },
    xAxis: {
      type: 'time',
      boundaryGap: ['2%', '2%'],
      name: 'Time',
      nameLocation: 'middle',
      nameGap: 28,
      axisLabel: {
        formatter: axisLabelFormatter,
        color: '#94a3b8',
        hideOverlap: true,
        showMinLabel: true,
        showMaxLabel: true,
      },
      axisLine: { lineStyle: { color: '#334155' } },
      axisTick: { lineStyle: { color: '#334155' } },
      splitLine: { show: false },
      min: range?.min,
      max: range?.max,
    },
    yAxis: {
      type: 'value',
      scale: true,
      min: valueRange?.min,
      max: valueRange?.max,
      name: chart.kind === 'price' ? 'Price' : 'Value',
      nameLocation: 'middle',
      nameGap: 42,
      axisLabel: { color: '#94a3b8' },
      axisLine: { lineStyle: { color: '#334155' } },
      splitLine: { lineStyle: { color: '#1e293b' } },
    },
    dataZoom: [
      {
        type: 'inside',
        xAxisIndex: 0,
        filterMode: 'none',
      startValue: range?.min,
      endValue: range?.max,
      },
      {
        type: 'slider',
        xAxisIndex: 0,
        height: 18,
        bottom: 8,
        borderColor: '#334155',
        fillerColor: 'rgba(56, 189, 248, 0.2)',
        textStyle: { color: '#cbd5e1' },
        startValue: range?.min,
        endValue: range?.max,
      },
    ],
    series: [],
  }

  if (chart.kind === 'price') {
    return {
      ...baseOption,
      series: [
        candleSeries(points),
        ...chart.series.map((series) => lineSeries(series, points, true)),
        ...signalMarkerSeries(chart, snapshots, windowId),
      ],
    }
  }

  if (chart.kind === 'oscillator') {
    const mainSeries = chart.series[0]
    return {
      ...baseOption,
      yAxis: {
        min: 0,
        max: 100,
        type: 'value',
        axisLabel: { color: '#94a3b8' },
        splitLine: { lineStyle: { color: '#1e293b' } },
      },
      series: [
        {
          ...lineSeries(mainSeries, points, true),
          markArea: {
            silent: true,
            itemStyle: { opacity: 0.18 },
            data: [
              [
                { yAxis: 70, itemStyle: { color: '#7f1d1d' } },
                { yAxis: 100, itemStyle: { color: '#7f1d1d' } },
              ],
              [
                { yAxis: 0, itemStyle: { color: '#14532d' } },
                { yAxis: 30, itemStyle: { color: '#14532d' } },
              ],
            ],
          },
          markLine: {
            symbol: 'none',
            silent: true,
            lineStyle: { type: 'dashed', color: '#94a3b8' },
            data: [{ yAxis: 30 }, { yAxis: 70 }],
          },
        },
        ...signalMarkerSeries(chart, snapshots, windowId),
      ],
    }
  }

  if (chart.kind === 'histogram') {
    const macd = chart.series.find((series) => series.key === 'macd')
    const signal = chart.series.find((series) => series.key === 'macdSignal')
    const histogram = chart.series.find((series) => series.key === 'macdHistogram')
    if (!macd || !signal || !histogram) {
      return {
        ...baseOption,
        series: [
          ...chart.series.map((series) => lineSeries(series, points, false)),
          ...signalMarkerSeries(chart, snapshots, windowId),
        ],
      }
    }
    return {
      ...baseOption,
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: { color: '#94a3b8' },
        splitLine: { lineStyle: { color: '#1e293b' } },
      },
      series: [
        histogramSeries(histogram, points),
        lineSeries(macd, points, false),
        lineSeries(signal, points, false),
        ...signalMarkerSeries(chart, snapshots, windowId),
      ],
    }
  }

  return {
    ...baseOption,
    series: [
      ...chart.series.map((series) => lineSeries(series, points, false)),
      ...signalMarkerSeries(chart, snapshots, windowId),
    ],
  }
}
