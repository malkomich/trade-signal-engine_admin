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
type SignalMarkerDatum = { value: [number, number]; tooltipValue: string }

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
  const sortedRecords = [...records].sort((left, right) => {
    const leftTimestamp = parseTimestamp(left.timestamp) ?? 0
    const rightTimestamp = parseTimestamp(right.timestamp) ?? 0
    if (leftTimestamp !== rightTimestamp) {
      return leftTimestamp - rightTimestamp
    }
    if (left.symbol !== right.symbol) {
      return left.symbol.localeCompare(right.symbol)
    }
    return left.id.localeCompare(right.id)
  })

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

function markerTooltip(record: MarketSnapshotRecord, chart: ChartDefinition, kind: SignalMarkerKind) {
  const label = kind === 'buy' ? 'Buy signal' : 'Sell signal'
  const value = chartMarkerValue(record, chart)
  const parts = [
    label,
    new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(record.timestamp)),
    `Value ${formatTooltipValue(value, chart.series[0]?.decimals ?? 2)}`,
  ]
  for (const series of chart.series) {
    parts.push(`${series.label} ${formatTooltipValue(readSeriesValue(record, series.key), series.decimals ?? 2)}`)
  }
  return parts.join(' · ')
}

function axisRange(points: AggregatedSnapshot[]) {
  if (points.length === 0) {
    return null
  }
  const timestamps = points.map((point) => point.timestamp).filter((value) => Number.isFinite(value))
  if (timestamps.length === 0) {
    return null
  }
  const min = Math.min(...timestamps)
  const max = Math.max(...timestamps)
  const span = Math.max(max - min, 60 * 1000)
  const padding = Math.max(span * 0.15, 2 * 60 * 1000)
  return {
    min: min - padding,
    max: max + padding,
  }
}

function signalMarkerSeries(chart: ChartDefinition, snapshots: MarketSnapshotRecord[]): SeriesOption[] {
  const markers: Array<{ kind: SignalMarkerKind; snapshot: MarketSnapshotRecord }> = snapshots
    .filter((snapshot) => snapshot.signalAction?.toUpperCase() === 'BUY_ALERT' || snapshot.signalAction?.toUpperCase() === 'SELL_ALERT')
    .map((snapshot) => ({
      kind: snapshot.signalAction?.toUpperCase() === 'BUY_ALERT' ? 'buy' : 'sell',
      snapshot,
    }))

  return markers.flatMap((marker) => {
    const timestamp = parseTimestamp(marker.snapshot.timestamp)
    const value = chartMarkerValue(marker.snapshot, chart)
    const data: SignalMarkerDatum[] = timestamp === null ? [] : [{
      value: [timestamp, value],
      tooltipValue: markerTooltip(marker.snapshot, chart, marker.kind),
    }]
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
          symbol: 'none',
          silent: false,
          lineStyle: {
            type: 'dashed',
            color,
            width: 1.5,
          },
          label: {
            show: true,
            color,
            formatter: marker.kind === 'buy' ? 'Buy' : 'Sell',
            position: 'insideEndTop',
          },
          data: [{ xAxis: timestamp }],
        },
      } as SeriesOption,
    ]
  })
}

function lineSeries(series: ChartSeries, points: AggregatedSnapshot[], smooth = false, withExtrema = true): SeriesOption {
  return {
    type: 'line',
    name: series.label,
    showSymbol: false,
    smooth,
    data: buildSeriesData(points, series.key),
    lineStyle: { width: 2, color: series.color },
    itemStyle: { color: series.color },
    emphasis: { focus: 'series' },
    markPoint: withExtrema
      ? {
          data: [{ type: 'max', name: 'Max' }, { type: 'min', name: 'Min' }],
          symbolSize: 40,
          label: { color: '#e2e8f0' },
        }
      : undefined,
  }
}

function candleSeries(points: AggregatedSnapshot[]): SeriesOption {
  return {
    type: 'candlestick',
    name: 'Price',
    data: points.map((point) => [point.timestamp, point.open, point.close, point.low, point.high]),
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
    markPoint: {
      data: [{ type: 'max', name: 'Max' }, { type: 'min', name: 'Min' }],
      symbolSize: 36,
      label: { color: '#e2e8f0' },
    },
  } satisfies SeriesOption
}

function buildTooltipFormatter(chart: ChartDefinition) {
  return (params: unknown) => {
    const items = Array.isArray(params) ? params : [params]
    const first = items[0] as { axisValue?: number; data?: unknown } | undefined
    const timestamp = typeof first?.axisValue === 'number' ? first.axisValue : null
    const lines = [`<strong>${timestamp ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(timestamp)) : chart.title}</strong>`]

    for (const item of items as Array<{ seriesName?: string; data?: unknown }>) {
      const data = item.data
      if (item.seriesName === 'Price' && Array.isArray(data)) {
        const [, open, close, low, high] = data as [number, number, number, number, number]
        lines.push(`Open ${open.toFixed(2)} · Close ${close.toFixed(2)} · Low ${low.toFixed(2)} · High ${high.toFixed(2)}`)
        continue
      }
      if (item.seriesName === 'Buy' || item.seriesName === 'Sell') {
        const markerData = data as { value?: [number, number]; tooltipValue?: string } | undefined
        const markerValue = markerData?.value?.[1]
        if (markerData?.tooltipValue) {
          lines.push(markerData.tooltipValue)
        } else if (typeof markerValue === 'number') {
          lines.push(`${item.seriesName} ${formatTooltipValue(markerValue, chart.series[0]?.decimals ?? 2)}`)
        }
        continue
      }
      if (item.seriesName && typeof data === 'object' && data !== null && 'value' in data) {
        const value = (data as { value?: unknown }).value
        if (Array.isArray(value) && value.length >= 2 && typeof value[1] === 'number') {
          const series = chart.series.find((seriesItem) => seriesItem.label === item.seriesName)
          lines.push(`${item.seriesName} ${formatTooltipValue(value[1], series?.decimals ?? 2)}`)
        }
      }
    }

    return lines.join('<br/>')
  }
}

export function buildChartOption(chart: ChartDefinition, snapshots: MarketSnapshotRecord[], intervalMinutes: number): EChartsOption {
  const points = aggregateSnapshots(snapshots, intervalMinutes)
  const range = axisRange(points)
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
      formatter: buildTooltipFormatter(chart),
    },
    legend: { show: false },
    xAxis: {
      type: 'time',
      min: range?.min,
      max: range?.max,
      name: 'Time',
      nameLocation: 'middle',
      nameGap: 28,
      axisLabel: { formatter: axisLabelFormatter, color: '#94a3b8' },
      axisLine: { lineStyle: { color: '#334155' } },
      axisTick: { lineStyle: { color: '#334155' } },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      scale: true,
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
        start: 0,
        end: 100,
      },
      {
        type: 'slider',
        xAxisIndex: 0,
        height: 18,
        bottom: 8,
        borderColor: '#334155',
        fillerColor: 'rgba(56, 189, 248, 0.2)',
        textStyle: { color: '#cbd5e1' },
        start: 0,
        end: 100,
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
        ...signalMarkerSeries(chart, snapshots),
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
        ...signalMarkerSeries(chart, snapshots),
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
          ...signalMarkerSeries(chart, snapshots),
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
        ...signalMarkerSeries(chart, snapshots),
      ],
    }
  }

  return {
    ...baseOption,
    series: [
      ...chart.series.map((series) => lineSeries(series, points, false)),
      ...signalMarkerSeries(chart, snapshots),
    ],
  }
}
