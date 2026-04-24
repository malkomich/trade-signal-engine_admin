<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { signInAnonymously } from 'firebase/auth'
import { type MessagePayload } from 'firebase/messaging'
import { classifySignal } from './lib/engine'
import { auth } from './lib/firebase'
import {
  applyConfigVersion,
  loadDashboardSnapshot,
  saveConfigCandidate,
  type ConfigVersionRecord,
  type DashboardSnapshot,
  type DashboardSource,
  type MarketSnapshotRecord,
  type TradeWindowRecord,
} from './lib/dashboard'
import {
  probeLiveSignalNotifications,
  setupLiveSignalNotifications,
  stopLiveSignalNotifications,
  type NotificationSetupState,
} from './lib/notifications'
import { configFields, type AdminSignal, type ConfigField, type ConfigFieldValue } from './lib/engine'

const snapshot = ref<DashboardSnapshot | null>(null)
const selectedSignal = ref<DashboardSnapshot['selectedSignal'] | null>(null)
const selectedMarketSymbol = ref<string>('')
const selectedMarketDay = ref<string>(currentMarketDayKey())
const loading = ref(true)
const authState = ref<'booting' | 'authenticating' | 'authenticated' | 'offline'>('booting')
const snapshotSource = ref<DashboardSource>('empty')
const snapshotWarning = ref<string | null>(null)
const firestoreAvailable = ref(true)
const notificationState = ref<NotificationSetupState>('unsupported')
const notificationMessage = ref<string | null>(null)
const selectedLedgerSnapshotId = ref<string>('')
const selectedWindowReviewId = ref<string>('')
const expandedChartId = ref<string | null>(null)
const chartModalCardRef = ref<HTMLElement | null>(null)
const chartModalCloseButton = ref<HTMLButtonElement | null>(null)
let chartModalPreviousFocus: HTMLElement | null = null
let notificationSetupGeneration = 0
let isMounted = true
let dashboardRefreshTimer: number | null = null
let dashboardRefreshInFlight = false
let dashboardRefreshQueued = false
let dashboardVisibilityChangeHandler: (() => void) | null = null
const triageFilter = ref<'all' | 'entry' | 'exit' | 'hold'>('all')
const triageFilters = ['all', 'entry', 'exit', 'hold'] as const
const selectedConfigVersionId = ref<string>('current')
const configDraft = reactive<Record<string, string>>({})
const DASHBOARD_REFRESH_INTERVAL_MS = 30_000
const sessionOverview = computed(() => snapshot.value?.sessionOverview ?? emptySessionOverview())
const marketSnapshots = computed(() => snapshot.value?.marketSnapshots ?? [])
const tradeWindows = computed(() => snapshot.value?.windows ?? [])
const availableMarketDays = computed(() => {
  const days = new Set<string>()
  for (const signal of snapshot.value?.signals ?? []) {
    days.add(getMarketDayKey(signal.updatedAt))
  }
  for (const window of tradeWindows.value) {
    days.add(getMarketDayKey(window.openedAt))
    if (window.closedAt) {
      days.add(getMarketDayKey(window.closedAt))
    }
  }
  for (const marketSnapshot of marketSnapshots.value) {
    days.add(getMarketDayKey(marketSnapshot.timestamp))
  }
  days.add(currentMarketDayKey())
  return Array.from(days).sort((left, right) => right.localeCompare(left))
})
const selectedDaySnapshots = computed(() => {
  return marketSnapshots.value.filter((record) => getMarketDayKey(record.timestamp) === selectedMarketDay.value)
})
const marketSymbols = computed(() => {
  const symbols = new Set<string>()
  const benchmarkSymbol = String(
    snapshot.value?.configFields.find((field) => field.key === 'benchmark_symbol')?.value ?? 'QQQ',
  )
    .trim()
    .toUpperCase()
  for (const signal of selectedDaySignals.value) {
    if (signal.symbol && signal.symbol !== benchmarkSymbol) {
      symbols.add(signal.symbol)
    }
  }
  for (const snapshotRecord of selectedDaySnapshots.value) {
    if (snapshotRecord.symbol && snapshotRecord.symbol !== benchmarkSymbol) {
      symbols.add(snapshotRecord.symbol)
    }
  }
  for (const window of tradeWindows.value) {
    if (getMarketDayKey(window.openedAt) === selectedMarketDay.value || (window.closedAt ? getMarketDayKey(window.closedAt) === selectedMarketDay.value : false)) {
      if (window.symbol && window.symbol !== benchmarkSymbol) {
        symbols.add(window.symbol)
      }
    }
  }
  return Array.from(symbols).sort()
})
const selectedMarketSnapshots = computed(() => {
  if (!selectedMarketSymbol.value) {
    return selectedDaySnapshots.value
  }
  return selectedDaySnapshots.value.filter((record) => record.symbol === selectedMarketSymbol.value)
})
const marketLedgerPageSize = 12
const marketLedgerPage = ref(0)
const triagePageSize = 12
const triagePage = ref(0)
const windowReviewPageSize = 6
const windowReviewPage = ref(0)
const latestMarketSnapshots = computed(() => {
  const start = marketLedgerPage.value * marketLedgerPageSize
  const end = start + marketLedgerPageSize
  return selectedMarketSnapshots.value.slice(-50).reverse().slice(start, end)
})
const marketLedgerPageCount = computed(() => Math.max(1, Math.ceil(Math.min(50, selectedMarketSnapshots.value.length) / marketLedgerPageSize)))
const selectedLedgerSnapshot = computed(() => {
  const snapshotId = selectedLedgerSnapshotId.value
  if (!snapshotId) {
    return latestMarketSnapshots.value[0] ?? null
  }
  return selectedMarketSnapshots.value.find((record) => record.id === snapshotId) ?? latestMarketSnapshots.value[0] ?? null
})
const allWindowReviews = computed(() => {
  return tradeWindows.value
    .filter((window) => getMarketDayKey(window.openedAt) === selectedMarketDay.value || (window.closedAt ? getMarketDayKey(window.closedAt) === selectedMarketDay.value : false))
    .filter((window) => !selectedMarketSymbol.value || window.symbol === selectedMarketSymbol.value)
    .slice()
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .map((window) => decorateWindowReview(window))
})
const selectedWindowReview = computed<WindowReviewView | null>(() => {
  if (!allWindowReviews.value.length) {
    return null
  }
  return allWindowReviews.value.find((review) => review.id === selectedWindowReviewId.value) ?? allWindowReviews.value[0]
})
const selectedWindowReviews = computed(() => {
  const start = windowReviewPage.value * windowReviewPageSize
  const end = start + windowReviewPageSize
  return allWindowReviews.value.slice(start, end)
})
const windowReviewPageCount = computed(() => {
  return Math.max(1, Math.ceil(allWindowReviews.value.length / windowReviewPageSize))
})
const marketChartViews = computed(() =>
  marketCharts.map((chart) => ({
    chart,
    view: buildChartView(selectedMarketSnapshots.value, chart),
  })),
)

const expandedChartView = computed(() => {
  if (!expandedChartId.value) {
    return null
  }
  return marketChartViews.value.find((item) => item.chart.id === expandedChartId.value) ?? null
})

function clampPage(page: { value: number }, pageCount: number) {
  page.value = Math.min(page.value, Math.max(0, pageCount - 1))
}

const sourceDisplay = computed(() => {
  if (snapshotSource.value === 'firestore') {
    return {
      title: 'Live Firestore data',
      description: 'Firestore is feeding live session, signal, config, and chart data into the dashboard.',
    }
  }

  return {
    title: 'Waiting for live data',
    description: 'Firestore is connected, but the selected session has not produced live records yet.',
  }
})

function currentMarketDayKey(reference = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(reference)
}

function getMarketDayKey(value: string | Date) {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) {
    return currentMarketDayKey()
  }
  return currentMarketDayKey(date)
}

function formatMarketDayLabel(value: string) {
  const parsed = new Date(`${value}T12:00:00Z`)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat(undefined, {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(parsed)
}

function emptySessionOverview(): DashboardSnapshot['sessionOverview'] {
  return {
    sessionId: 'nasdaq-live',
    status: 'waiting',
    updatedAt: new Date().toISOString(),
    configVersion: 'draft',
    openWindows: 0,
    rejectedEntries: 0,
    summary: 'Firestore is connected, but the live session has not produced records for this day yet.',
  }
}

function signalKey(signal: AdminSignal | null) {
  if (!signal) {
    return ''
  }
  return `${signal.symbol}:${signal.updatedAt}`
}

function windowKey(window: TradeWindowRecord | null) {
  if (!window) {
    return ''
  }
  return `${window.id}:${window.updatedAt}`
}

function formatSignalActionLabel(action: string) {
  switch (action) {
    case 'BUY_ALERT':
      return 'Entry signal'
    case 'SELL_ALERT':
      return 'Exit signal'
    case 'HOLD':
      return 'Monitoring'
    default:
      return action || 'Unknown'
  }
}

function formatSignalStateLabel(state: string) {
  switch (state) {
    case 'FLAT':
      return 'Flat'
    case 'ENTRY_SIGNALLED':
      return 'Entry queued'
    case 'ACCEPTED_OPEN':
      return 'Open position'
    case 'EXIT_SIGNALLED':
      return 'Exit queued'
    case 'CLOSED':
      return 'Closed'
    case 'REJECTED':
      return 'Rejected'
    case 'EXPIRED':
      return 'Expired'
    default:
      return state || 'Unknown'
  }
}

function formatSignalRegimeLabel(signal: AdminSignal | MarketSnapshotRecord | null) {
  if (!signal) {
    return 'Live market context'
  }
  const regime = 'regime' in signal ? signal.regime : signal.signalRegime
  if (!regime) {
    return 'Live market context'
  }
  if (regime === 'Live market session' || regime === 'benchmark snapshot') {
    return 'Live market context'
  }
  if (regime.includes('aligned')) {
    return 'Market context aligned'
  }
  if (regime.includes('pressure')) {
    return 'Market context under pressure'
  }
  if (regime.includes('mixed')) {
    return 'Mixed market context'
  }
  return regime
}

function formatWindowStatusLabel(status: string) {
  switch (status) {
    case 'open':
      return 'Open'
    case 'closed':
      return 'Closed'
    default:
      return status || 'Unknown'
  }
}

function describeWindowOutcome(changePct: number | null) {
  if (changePct === null) {
    return 'Pending price change'
  }
  if (changePct > 0) {
    return `Up ${changePct.toFixed(2)}%`
  }
  if (changePct < 0) {
    return `Down ${Math.abs(changePct).toFixed(2)}%`
  }
  return 'Flat'
}

function humanizeReason(reason: string) {
  const trimmed = reason.trim()
  if (!trimmed) {
    return 'Unknown context'
  }
  if (trimmed === 'entry-qualified') {
    return 'Entry criteria met'
  }
  if (trimmed === 'exit-qualified') {
    return 'Exit criteria met'
  }
  if (trimmed === 'exit-pressure') {
    return 'Exit pressure detected'
  }
  if (trimmed === 'market-closed') {
    return 'Market closed'
  }
  if (trimmed === 'session-close exit') {
    return 'Forced exit at market close'
  }
  if (trimmed === 'benchmark snapshot') {
    return 'Benchmark snapshot'
  }
  if (trimmed === 'live market session') {
    return 'Live market context'
  }
  if (trimmed.includes('market context')) {
    return trimmed.replace(/-/g, ' ')
  }
  const timeframeMatch = /^([0-9]+m):(.*)$/.exec(trimmed)
  if (timeframeMatch) {
    return `${timeframeMatch[1]} timeframe · ${timeframeMatch[2].replace(/-/g, ' ').trim()}`
  }
  return trimmed.replace(/-/g, ' ')
}

function syncSelectedMarketSymbol(symbols: string[]) {
  if (symbols.length === 0) {
    selectedMarketSymbol.value = ''
    return
  }

  if (selectedMarketSymbol.value && symbols.includes(selectedMarketSymbol.value)) {
    return
  }

  const preferredSymbol = selectedSignal.value?.symbol ?? ''
  selectedMarketSymbol.value = symbols.includes(preferredSymbol) ? preferredSymbol : symbols[0]
}

const currentConfigVersion = computed(() => sessionOverview.value.configVersion)

const configVersions = computed(() => snapshot.value?.configVersions ?? [])

const selectedConfigVersion = computed<ConfigVersionRecord | null>(() => {
  if (!snapshot.value) {
    return null
  }
  if (selectedConfigVersionId.value === 'current') {
    return configVersions.value.find((version) => version.version === currentConfigVersion.value) ?? configVersions.value[0] ?? null
  }
  return configVersions.value.find((version) => version.id === selectedConfigVersionId.value) ?? null
})

const selectedConfigFields = computed(() => {
  return selectedConfigVersion.value?.fields ?? snapshot.value?.configFields ?? configFields
})

const editableConfigFields = computed(() => selectedConfigFields.value)
const configFieldGroups = computed(() => groupConfigFields(editableConfigFields.value))

function stringifyConfigValue(value: ConfigFieldValue): string {
  if (Array.isArray(value)) {
    return value.map((item) => item.toUpperCase()).join('\n')
  }
  return String(value)
}

function parseConfigDraftValue(field: ConfigField, rawValue: string): ConfigFieldValue {
  if (field.inputType === 'symbols') {
    return rawValue
      .split(/[\n,]/)
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean)
  }
  if (field.inputType === 'number') {
    const trimmed = rawValue.trim()
    const parsed = trimmed ? Number(trimmed) : Number.NaN
    return Number.isFinite(parsed) ? parsed : field.value
  }
  return rawValue.trim()
}

function readDraftSymbols(field: ConfigField) {
  const raw = configDraft[field.key] ?? stringifyConfigValue(field.value)
  return raw
    .split(/[\n,]/)
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean)
}

function toggleDraftSymbol(field: ConfigField, symbol: string) {
  const current = readDraftSymbols(field)
  const normalized = symbol.trim().toUpperCase()
  if (!normalized) {
    return
  }

  const next = current.includes(normalized)
    ? current.filter((item) => item !== normalized)
    : [...current, normalized]
  configDraft[field.key] = next.join('\n')
}

function isDraftSymbolSelected(field: ConfigField, symbol: string) {
  return readDraftSymbols(field).includes(symbol.trim().toUpperCase())
}

function groupConfigFields(fields: ConfigField[]) {
  const groups = new Map<string, { label: string; fields: ConfigField[] }>()
  for (const field of fields) {
    const group = groups.get(field.group)
    if (group) {
      group.fields.push(field)
    } else {
      groups.set(field.group, { label: field.group, fields: [field] })
    }
  }
  return Array.from(groups.values())
}

function syncConfigDraft(fields: ConfigField[]) {
  for (const key of Object.keys(configDraft)) {
    delete configDraft[key]
  }
  for (const field of fields) {
    configDraft[field.key] = stringifyConfigValue(field.value)
  }
}

function sameDraft(fields: ConfigField[]) {
  if (fields.length !== Object.keys(configDraft).length) {
    return false
  }
  return fields.every((field) => configDraft[field.key] === stringifyConfigValue(field.value))
}

const isConfigDraftDirty = computed(() => {
  return !sameDraft(selectedConfigFields.value)
})

const configEditorStatus = computed(() => {
  if (isConfigDraftDirty.value) {
    return 'draft'
  }
  return selectedConfigVersion.value?.status ?? 'draft'
})

type ChartSeriesKey = keyof Pick<
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

type ChartSeries = {
  key: ChartSeriesKey
  label: string
  color: string
  decimals?: number
}

type ChartDefinition = {
  id: string
  title: string
  subtitle: string
  series: ChartSeries[]
}

type ChartPoint = {
  x: number
  y: number
}

type ChartMarker = ChartPoint & {
  id: string
  kind: 'entry' | 'exit'
}

type ChartView = {
  lines: Array<{
    label: string
    color: string
    latestValue: string
    points: string
  }>
  markers: ChartMarker[]
  latestTimestamp: string | null
}

type WindowReviewView = TradeWindowRecord & {
  entryPrice: number | null
  exitPrice: number | null
  changePct: number | null
  durationMinutes: number | null
  entrySummary: string
  exitSummary: string
  benchmarkLabel: string
}

const marketCharts: ChartDefinition[] = [
  {
    id: 'price',
    title: 'Price',
    subtitle: 'Close price with market signals',
    series: [{ key: 'close', label: 'Close', color: '#7dd3fc', decimals: 2 }],
  },
  {
    id: 'sma',
    title: 'SMA',
    subtitle: 'Fast and slow simple moving averages',
    series: [
      { key: 'smaFast', label: 'Fast SMA', color: '#34d399', decimals: 2 },
      { key: 'smaSlow', label: 'Slow SMA', color: '#f59e0b', decimals: 2 },
    ],
  },
  {
    id: 'ema',
    title: 'EMA',
    subtitle: 'Fast and slow exponential moving averages',
    series: [
      { key: 'emaFast', label: 'Fast EMA', color: '#60a5fa', decimals: 2 },
      { key: 'emaSlow', label: 'Slow EMA', color: '#c084fc', decimals: 2 },
    ],
  },
  {
    id: 'vwap',
    title: 'VWAP',
    subtitle: 'Volume weighted price reference',
    series: [{ key: 'vwap', label: 'VWAP', color: '#22d3ee', decimals: 2 }],
  },
  {
    id: 'rsi',
    title: 'RSI',
    subtitle: 'Momentum oscillator',
    series: [{ key: 'rsi', label: 'RSI', color: '#fb7185', decimals: 1 }],
  },
  {
    id: 'atr',
    title: 'ATR',
    subtitle: 'Volatility range',
    series: [{ key: 'atr', label: 'ATR', color: '#f97316', decimals: 2 }],
  },
  {
    id: 'dmi',
    title: 'DMI / ADX',
    subtitle: 'Directional movement and trend strength',
    series: [
      { key: 'plusDi', label: '+DI', color: '#22c55e', decimals: 1 },
      { key: 'minusDi', label: '-DI', color: '#ef4444', decimals: 1 },
      { key: 'adx', label: 'ADX', color: '#f59e0b', decimals: 1 },
    ],
  },
  {
    id: 'macd',
    title: 'MACD',
    subtitle: 'Trend momentum and histogram',
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
    series: [
      { key: 'stochasticK', label: '%K', color: '#f472b6', decimals: 1 },
      { key: 'stochasticD', label: '%D', color: '#fbbf24', decimals: 1 },
    ],
  },
]

function readSeriesValue(record: MarketSnapshotRecord, key: ChartSeriesKey): number | null {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function formatChartValue(value: number | null, decimals = 2) {
  if (value === null) {
    return '--'
  }
  return value.toFixed(decimals)
}

function formatLocaleTimestamp(value: string | null | undefined) {
  if (!value) {
    return 'waiting for live data'
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(parsed)
}

function buildChartView(records: MarketSnapshotRecord[], chart: ChartDefinition): ChartView {
  const usableRecords = records.length > 0 ? records : []
  const latestTimestamp = usableRecords.at(-1)?.timestamp ?? null
  const values = chart.series
    .flatMap((series) => usableRecords.map((record) => readSeriesValue(record, series.key)))
    .filter((value): value is number => typeof value === 'number')
  const minValue = values.length > 0 ? Math.min(...values) : 0
  const maxValue = values.length > 0 ? Math.max(...values) : 1
  const spread = maxValue - minValue || 1
  const width = usableRecords.length > 1 ? usableRecords.length - 1 : 1

  const toPoint = (value: number, index: number): ChartPoint => {
    const x = usableRecords.length > 1 ? (index / width) * 100 : 50
    const y = 100 - ((value - minValue) / spread) * 100
    return { x, y }
  }

  const lines = chart.series.map((series) => {
    const coords: ChartPoint[] = []
    usableRecords.forEach((record, index) => {
      const value = readSeriesValue(record, series.key)
      if (value === null) {
        return
      }
      coords.push(toPoint(value, index))
    })
    const points = coords.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ')
    const latestRecord = usableRecords.at(-1)
    return {
      label: series.label,
      color: series.color,
      latestValue: formatChartValue(latestRecord ? readSeriesValue(latestRecord, series.key) : null, series.decimals ?? 2),
      points,
    }
  })

  const markers: ChartMarker[] = usableRecords
    .map((record, index) => {
      if (record.signalAction !== 'BUY_ALERT' && record.signalAction !== 'SELL_ALERT') {
        return null
      }
      return {
        id: record.id,
        x: usableRecords.length > 1 ? (index / width) * 100 : 50,
        y: record.signalAction === 'BUY_ALERT' ? 12 : 88,
        kind: record.signalAction === 'BUY_ALERT' ? 'entry' : 'exit',
      }
    })
    .filter((marker): marker is ChartMarker => marker !== null)

  return {
    lines,
    markers,
    latestTimestamp,
  }
}

function decorateWindowReview(window: TradeWindowRecord): WindowReviewView {
  const entrySnapshot = findNearestSnapshot(window.symbol, window.openedAt, 'before')
  const exitSnapshot = window.closedAt ? findNearestSnapshot(window.symbol, window.closedAt, 'before') : null
  const entryPrice = entrySnapshot?.close ?? null
  const exitPrice = exitSnapshot?.close ?? null
  const changePct = entryPrice !== null && exitPrice !== null && entryPrice > 0 ? ((exitPrice - entryPrice) / entryPrice) * 100 : null
  const durationMinutes = window.closedAt
    ? Math.max(0, Math.round((Date.parse(window.closedAt) - Date.parse(window.openedAt)) / 60000))
    : null

  return {
    ...window,
    entryPrice,
    exitPrice,
    changePct,
    durationMinutes,
    entrySummary: entrySnapshot ? summarizeSnapshotReason(entrySnapshot) : 'Entry snapshot unavailable',
    exitSummary: exitSnapshot ? summarizeSnapshotReason(exitSnapshot) : 'Exit snapshot unavailable',
    benchmarkLabel: 'Benchmark proxy',
  }
}

function findNearestSnapshot(symbol: string, timestamp: string, direction: 'before' | 'after') {
  const target = Date.parse(timestamp)
  if (!Number.isFinite(target)) {
    return null
  }
  const snapshots = selectedDaySnapshots.value.filter((snapshot) => snapshot.symbol === symbol)
  if (snapshots.length === 0) {
    return null
  }

  const ordered = snapshots.slice().sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
  if (direction === 'before') {
    for (let index = ordered.length - 1; index >= 0; index -= 1) {
      if (Date.parse(ordered[index].timestamp) <= target) {
        return ordered[index]
      }
    }
    return null
  }

  for (const snapshot of ordered) {
    if (Date.parse(snapshot.timestamp) >= target) {
      return snapshot
    }
  }
  return ordered.at(-1) ?? null
}

function summarizeSnapshotReason(snapshot: MarketSnapshotRecord) {
  const reasons = snapshot.reasons.slice(0, 2)
  if (reasons.length > 0) {
    return reasons.map(humanizeReason).join(' · ')
  }
  return formatSignalRegimeLabel(snapshot)
}

function selectConfigVersion(version: ConfigVersionRecord | null) {
  if (!version) {
    selectedConfigVersionId.value = 'current'
    return
  }

  selectedConfigVersionId.value = version.id
}

const selectedDaySignals = computed(() => {
  const signals = snapshot.value?.signals ?? []
  return signals.filter((signal) => getMarketDayKey(signal.updatedAt) === selectedMarketDay.value)
})

const triageSignals = computed(() => {
  const signals = selectedDaySignals.value.filter((signal) => !selectedMarketSymbol.value || signal.symbol === selectedMarketSymbol.value)
  if (triageFilter.value === 'all') {
    return signals
  }
  return signals.filter((signal) => classifySignal(signal) === triageFilter.value)
})
const triagePageSignals = computed(() => {
  const start = triagePage.value * triagePageSize
  const end = start + triagePageSize
  return triageSignals.value.slice(start, end)
})
const triagePageCount = computed(() => Math.max(1, Math.ceil(triageSignals.value.length / triagePageSize)))

const triageCounts = computed(() => {
  const signals = selectedDaySignals.value.filter((signal) => !selectedMarketSymbol.value || signal.symbol === selectedMarketSymbol.value)
  const counts: Record<(typeof triageFilters)[number], number> = {
    all: signals.length,
    entry: 0,
    exit: 0,
    hold: 0,
  }

  for (const signal of signals) {
    counts[classifySignal(signal)] += 1
  }

  return counts
})

watch(
  triageSignals,
  (signals) => {
    if (signals.length === 0) {
      selectedSignal.value = null
      triagePage.value = 0
      return
    }

    const activeSignal = selectedSignal.value
    if (!activeSignal || !signals.some((signal) => signalKey(signal) === signalKey(activeSignal))) {
      selectedSignal.value = signals.at(-1) ?? null
    }
    triagePage.value = Math.min(triagePage.value, Math.max(0, Math.ceil(signals.length / triagePageSize) - 1))
  },
  { immediate: true },
)

watch(
  [selectedMarketDay, selectedMarketSymbol],
  () => {
    marketLedgerPage.value = 0
    windowReviewPage.value = 0
    selectedLedgerSnapshotId.value = ''
    selectedWindowReviewId.value = ''
  },
)

watch(
  selectedConfigVersion,
  (version) => {
    if (!snapshot.value) {
      return
    }
    syncConfigDraft(version?.fields ?? snapshot.value.configFields)
  },
  { immediate: true },
)

watch(selectedMarketDay, () => {
  void requestDashboardRefresh()
})

watch(marketLedgerPageCount, (pageCount) => {
  clampPage(marketLedgerPage, pageCount)
})

watch(windowReviewPageCount, (pageCount) => {
  clampPage(windowReviewPage, pageCount)
})

watch(
  [marketSymbols, selectedSignal],
  ([symbols]) => {
    syncSelectedMarketSymbol(symbols)
  },
  { immediate: true },
)

watch(
  latestMarketSnapshots,
  (snapshots) => {
    if (!snapshots.length) {
      selectedLedgerSnapshotId.value = ''
      return
    }
    if (!selectedLedgerSnapshotId.value || !snapshots.some((snapshot) => snapshot.id === selectedLedgerSnapshotId.value)) {
      selectedLedgerSnapshotId.value = snapshots[0].id
    }
  },
  { immediate: true },
)

watch(
  allWindowReviews,
  (reviews) => {
    if (!reviews.length) {
      selectedWindowReviewId.value = ''
      return
    }
    if (!selectedWindowReviewId.value || !reviews.some((review) => review.id === selectedWindowReviewId.value)) {
      selectedWindowReviewId.value = reviews[0].id
    }
  },
  { immediate: true },
)

function setTriageFilter(filter: (typeof triageFilters)[number]) {
  triageFilter.value = filter
}

function setLedgerSnapshot(snapshotPoint: MarketSnapshotRecord) {
  selectedLedgerSnapshotId.value = snapshotPoint.id
}

function setWindowReview(review: WindowReviewView) {
  selectedWindowReviewId.value = review.id
}

function nextLedgerPage() {
  marketLedgerPage.value = Math.min(marketLedgerPage.value + 1, marketLedgerPageCount.value - 1)
}

function previousLedgerPage() {
  marketLedgerPage.value = Math.max(marketLedgerPage.value - 1, 0)
}

function nextWindowPage() {
  windowReviewPage.value = Math.min(windowReviewPage.value + 1, windowReviewPageCount.value - 1)
}

function previousWindowPage() {
  windowReviewPage.value = Math.max(windowReviewPage.value - 1, 0)
}

function openExpandedChart(chartId: string) {
  chartModalPreviousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  expandedChartId.value = chartId
}

function closeExpandedChart() {
  expandedChartId.value = null
}

function getFocusableElements(root: HTMLElement) {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute('disabled') && element.tabIndex >= 0)
}

function handleGlobalKeydown(event: KeyboardEvent) {
  if (!expandedChartId.value) {
    return
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    closeExpandedChart()
    return
  }

  if (event.key !== 'Tab') {
    return
  }

  const modalCard = chartModalCardRef.value
  if (!modalCard) {
    return
  }

  const focusable = getFocusableElements(modalCard)
  if (focusable.length === 0) {
    event.preventDefault()
    chartModalCloseButton.value?.focus()
    return
  }

  const currentIndex = focusable.findIndex((element) => element === document.activeElement)
  const nextIndex = event.shiftKey
    ? currentIndex <= 0
      ? focusable.length - 1
      : currentIndex - 1
    : currentIndex === -1 || currentIndex === focusable.length - 1
      ? 0
      : currentIndex + 1

  event.preventDefault()
  focusable[nextIndex]?.focus()
}

watch(
  expandedChartId,
  async (chartId) => {
    if (chartId) {
      await nextTick()
      chartModalCloseButton.value?.focus()
      return
    }

    chartModalPreviousFocus?.focus?.()
    chartModalPreviousFocus = null
  },
  { immediate: true },
)

function handleConfigVersionClick(version: ConfigVersionRecord) {
  if (isConfigDraftDirty.value && selectedConfigVersion.value?.id !== version.id) {
    return
  }
  selectConfigVersion(version)
}

async function requestDashboardRefresh() {
  if (!firestoreAvailable.value) {
    return
  }
  if (dashboardRefreshInFlight) {
    dashboardRefreshQueued = true
    return
  }

  dashboardRefreshInFlight = true
  const preserveSelectedConfig = selectedConfigVersionId.value
  try {
    const result = await loadDashboardSnapshot({ allowFirestore: true, marketDayKey: selectedMarketDay.value })
    snapshot.value = result.snapshot
    selectedSignal.value = result.snapshot.selectedSignal
    snapshotSource.value = result.source
    snapshotWarning.value = result.warning
    if (preserveSelectedConfig === 'current') {
      selectConfigVersion(
        result.snapshot.configVersions.find((version) => version.version === result.snapshot.sessionOverview.configVersion) ??
          result.snapshot.configVersions[0] ??
          null,
      )
    }
  } catch (error) {
    console.error('Failed to refresh dashboard:', error)
  } finally {
    dashboardRefreshInFlight = false
    if (dashboardRefreshQueued) {
      dashboardRefreshQueued = false
      void requestDashboardRefresh()
    }
  }
}

async function refreshOnRelevantSignal(payload: MessagePayload) {
  const type = payload.data?.type?.trim().toLowerCase()
  if (type === 'decision.accepted' || type === 'decision.exited') {
    await requestDashboardRefresh()
  }
}

async function initializeNotifications(promptForPermission: boolean) {
  if (!firestoreAvailable.value) {
    notificationState.value = 'failed'
    notificationMessage.value = 'Cannot enable live updates: Firestore is unavailable.'
    return
  }

  const generation = ++notificationSetupGeneration
  stopLiveSignalNotifications()
  const setup = promptForPermission ? setupLiveSignalNotifications : probeLiveSignalNotifications
  const result = await setup(refreshOnRelevantSignal)
  if (!isMounted || generation !== notificationSetupGeneration) {
    result.stop?.()
    return
  }
  notificationState.value = result.state
  notificationMessage.value = result.error
}

async function enableLiveNotifications() {
  await initializeNotifications(true)
}

async function saveConfigVersion() {
  if (!snapshot.value || !firestoreAvailable.value) {
    return
  }

  try {
    const fields = editableConfigFields.value.map((field) => ({
      ...field,
      value: parseConfigDraftValue(field, configDraft[field.key] ?? stringifyConfigValue(field.value)),
    }))
    const baseVersion = selectedConfigVersion.value?.version ?? currentConfigVersion.value
    const candidate = await saveConfigCandidate(
      sessionOverview.value.sessionId,
      baseVersion,
      fields,
      `Draft snapshot derived from ${baseVersion}`,
    )

    snapshot.value = {
      ...snapshot.value,
      configVersions: [candidate, ...snapshot.value.configVersions.filter((version) => version.id !== candidate.id)],
    }
    selectConfigVersion(candidate)
  } catch (error) {
    console.error('Failed to save config candidate:', error)
  }
}

async function applySelectedVersion(version: ConfigVersionRecord) {
  if (!snapshot.value || !firestoreAvailable.value) {
    return
  }

  try {
    await applyConfigVersion(
      sessionOverview.value.sessionId,
      currentConfigVersion.value,
      version.version,
    )
    await requestDashboardRefresh()
  } catch (error) {
    console.error('Failed to apply config version:', error)
  }
}

onMounted(async () => {
  let allowFirestore = true
  try {
    authState.value = 'authenticating'
    await signInAnonymously(auth)
    authState.value = 'authenticated'
  } catch {
    authState.value = 'offline'
    allowFirestore = false
  }

  firestoreAvailable.value = allowFirestore
  try {
    const result = await loadDashboardSnapshot({ allowFirestore, marketDayKey: selectedMarketDay.value })
    snapshot.value = result.snapshot
    selectedSignal.value = result.snapshot.selectedSignal
    snapshotSource.value = result.source
    snapshotWarning.value = result.warning
    selectConfigVersion(result.snapshot.configVersions.find((version) => version.version === result.snapshot.sessionOverview.configVersion) ?? result.snapshot.configVersions[0] ?? null)
  } catch (error) {
    console.error('Failed to load dashboard snapshot:', error)
  }
  void initializeNotifications(false)
  const scheduleDashboardRefresh = () => {
    if (!isMounted || !firestoreAvailable.value || document.hidden) {
      return
    }

    if (dashboardRefreshTimer !== null) {
      window.clearTimeout(dashboardRefreshTimer)
    }

    dashboardRefreshTimer = window.setTimeout(async () => {
      dashboardRefreshTimer = null
      try {
        await requestDashboardRefresh()
      } finally {
        if (isMounted && firestoreAvailable.value && !document.hidden) {
          scheduleDashboardRefresh()
        }
      }
    }, DASHBOARD_REFRESH_INTERVAL_MS)
  }

  const handleVisibilityChange = () => {
    if (dashboardRefreshTimer !== null) {
      window.clearTimeout(dashboardRefreshTimer)
      dashboardRefreshTimer = null
    }
    if (!document.hidden) {
      scheduleDashboardRefresh()
    }
  }

  dashboardVisibilityChangeHandler = handleVisibilityChange
  document.addEventListener('visibilitychange', dashboardVisibilityChangeHandler)
  window.addEventListener('keydown', handleGlobalKeydown)
  scheduleDashboardRefresh()
  loading.value = false
})

onUnmounted(() => {
  isMounted = false
  if (dashboardRefreshTimer !== null) {
    window.clearTimeout(dashboardRefreshTimer)
    dashboardRefreshTimer = null
  }
  if (dashboardVisibilityChangeHandler) {
    document.removeEventListener('visibilitychange', dashboardVisibilityChangeHandler)
    dashboardVisibilityChangeHandler = null
  }
  window.removeEventListener('keydown', handleGlobalKeydown)
  stopLiveSignalNotifications()
})
</script>

<template>
  <main class="shell">
    <section class="hero">
      <div>
        <p class="eyebrow">Trade Signal Engine</p>
        <h1>Firebase control room for the Raspberry Pi signal stack</h1>
        <p class="lede">
          Monitor the session worker, tune thresholds, and inspect signal state without coupling the admin UI to market-data logic.
        </p>
      </div>

      <div class="hero-status">
        <span class="status-dot"></span>
        <div>
          <strong>{{ sourceDisplay.title }}</strong>
          <p>{{ sourceDisplay.description }}</p>
          <p>
            {{
              authState === 'authenticated'
                ? 'Firebase Auth completed successfully.'
                : authState === 'offline'
                  ? 'Offline fallback'
                  : 'Signing in'
            }}
          </p>
          <p>
            Browser alerts:
            <strong>{{ notificationState }}</strong>
          </p>
          <p v-if="snapshotWarning" class="status-warning">
            {{ snapshotWarning }}
          </p>
          <p v-if="notificationMessage" class="status-warning">
            {{ notificationMessage }}
          </p>
          <button
            type="button"
            class="action-button ghost"
            :disabled="notificationState === 'ready'"
            @click="enableLiveNotifications"
          >
            {{ notificationState === 'ready' ? 'Live notifications enabled' : 'Enable live notifications' }}
          </button>
        </div>
      </div>
    </section>

    <section v-if="loading" class="panel">
      Loading dashboard data...
    </section>

    <template v-else>
      <section class="metrics">
        <article v-for="metric in snapshot?.metrics ?? []" :key="metric.label" class="metric-card">
          <span>{{ metric.label }}</span>
          <strong>{{ metric.value }}</strong>
        </article>
      </section>

      <section class="overview-grid">
        <article class="panel overview-panel">
          <div class="panel-header">
            <h2>Market context</h2>
            <span>{{ sessionOverview.configVersion }}</span>
          </div>
          <div class="overview-copy">
            <div>
              <span>Session ID</span>
              <strong>{{ sessionOverview.sessionId }}</strong>
            </div>
            <div>
              <span>Updated</span>
              <strong>{{ formatLocaleTimestamp(sessionOverview.updatedAt) }}</strong>
            </div>
            <div>
              <span>Open windows today</span>
              <strong>{{ sessionOverview.openWindows }}</strong>
            </div>
            <div>
              <span>Rejected entries today</span>
              <strong>{{ sessionOverview.rejectedEntries }}</strong>
            </div>
          </div>
          <p class="overview-note">
            {{ sessionOverview.summary }}
          </p>
        </article>

        <article class="panel shell-placeholder" data-slot="chart">
          <div class="panel-header">
            <h2>Live market charts</h2>
            <span>{{ formatMarketDayLabel(selectedMarketDay) }} · {{ selectedMarketSymbol || 'No symbol selected' }}</span>
          </div>
          <p>
            Close price and indicators update in real time for the selected symbol and market day. Hover the markers for the signal context, and expand any chart for a larger view.
          </p>
          <div class="day-tabs">
            <button
              v-for="day in availableMarketDays"
              :key="day"
              type="button"
              class="symbol-tab"
              :class="{ active: selectedMarketDay === day }"
              @click="selectedMarketDay = day"
            >
              {{ day === currentMarketDayKey() ? 'Today' : formatMarketDayLabel(day) }}
            </button>
          </div>
          <div class="symbol-tabs">
            <button
              v-for="symbol in marketSymbols"
              :key="symbol"
              type="button"
              class="symbol-tab"
              :class="{ active: selectedMarketSymbol === symbol }"
              @click="selectedMarketSymbol = symbol"
            >
              {{ symbol }}
            </button>
          </div>
          <div v-if="selectedMarketSnapshots.length" class="chart-grid">
            <article v-for="item in marketChartViews" :key="item.chart.id" class="chart-card">
              <div class="chart-card-header">
                <div>
                  <strong>{{ item.chart.title }}</strong>
                  <p>{{ item.chart.subtitle }}</p>
                </div>
                <div class="chart-header-actions">
                  <span>{{ formatLocaleTimestamp(item.view.latestTimestamp) }}</span>
                  <button type="button" class="action-button ghost compact" @click="openExpandedChart(item.chart.id)">Expand</button>
                </div>
              </div>
              <div class="chart-legend">
                <span v-for="line in item.view.lines" :key="line.label" :title="`${line.label}: ${line.latestValue}`">
                  <i :style="{ background: line.color }"></i>
                  {{ line.label }} {{ line.latestValue }}
                </span>
              </div>
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" class="chart-svg" aria-hidden="true">
                <g v-for="line in item.view.lines" :key="`${item.chart.id}-${line.label}`">
                  <polyline
                    v-if="line.points"
                    :points="line.points"
                    fill="none"
                    :stroke="line.color"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </g>
                <g v-for="marker in item.view.markers" :key="`${item.chart.id}-${marker.id}`">
                  <line
                    :x1="marker.x"
                    y1="0"
                    :x2="marker.x"
                    y2="100"
                    :class="marker.kind"
                    class="signal-marker-line"
                  />
                  <circle
                    :cx="marker.x"
                    :cy="marker.y"
                    r="1.9"
                    :class="marker.kind"
                    class="signal-marker-dot"
                  />
                  <title>{{ marker.kind === 'entry' ? 'Entry signal marker' : 'Exit signal marker' }}</title>
                </g>
              </svg>
            </article>
          </div>
          <p v-else class="empty-state">No live market snapshots are available for the selected stock and day yet.</p>
        </article>

        <article class="panel shell-placeholder" data-slot="table">
          <div class="panel-header">
            <h2>Live snapshot ledger</h2>
            <div class="panel-header-actions">
              <span>{{ selectedMarketSnapshots.length }} points</span>
              <span>{{ marketLedgerPage + 1 }} / {{ marketLedgerPageCount }}</span>
            </div>
          </div>
          <p>
            This ledger is the raw time-ordered market tape for the selected stock. Use it to inspect the latest snapshot, then open the trade windows section below for the actual trade outcomes.
          </p>
          <div v-if="latestMarketSnapshots.length" class="ledger-toolbar">
            <button type="button" class="action-button ghost compact" :disabled="marketLedgerPage === 0" @click="previousLedgerPage">
              Previous
            </button>
            <button type="button" class="action-button ghost compact" :disabled="marketLedgerPage >= marketLedgerPageCount - 1" @click="nextLedgerPage">
              Next
            </button>
          </div>
          <div v-if="latestMarketSnapshots.length" class="signal-list compact ledger-list">
            <button
              v-for="snapshotPoint in latestMarketSnapshots"
              :key="snapshotPoint.id"
              type="button"
              class="signal-row ledger-row"
              :class="{ active: selectedLedgerSnapshot?.id === snapshotPoint.id }"
              @click="setLedgerSnapshot(snapshotPoint)"
            >
              <div>
                <strong>{{ snapshotPoint.symbol }}</strong>
                <p>
                  {{ formatLocaleTimestamp(snapshotPoint.timestamp) }} ·
                  {{ formatSignalActionLabel(snapshotPoint.signalAction) }} ·
                  {{ formatSignalStateLabel(snapshotPoint.signalState) }} ·
                  {{ formatSignalRegimeLabel(snapshotPoint) }}
                </p>
              </div>
              <div class="scores">
                <span>{{ snapshotPoint.entryScore.toFixed(2) }}</span>
                <span>{{ snapshotPoint.exitScore.toFixed(2) }}</span>
              </div>
            </button>
          </div>
          <div v-else class="empty-state">No live snapshots have been written for the selected day.</div>
          <div v-if="selectedLedgerSnapshot" class="detail-card ledger-detail">
            <div class="detail-title">
              <strong>{{ selectedLedgerSnapshot.symbol }}</strong>
              <span>{{ formatLocaleTimestamp(selectedLedgerSnapshot.timestamp) }}</span>
            </div>
            <div class="score-grid">
              <div>
                <span>Action</span>
                <strong>{{ formatSignalActionLabel(selectedLedgerSnapshot.signalAction) }}</strong>
              </div>
              <div>
                <span>State</span>
                <strong>{{ formatSignalStateLabel(selectedLedgerSnapshot.signalState) }}</strong>
              </div>
              <div>
                <span>Entry score</span>
                <strong>{{ selectedLedgerSnapshot.entryScore.toFixed(2) }}</strong>
              </div>
              <div>
                <span>Exit score</span>
                <strong>{{ selectedLedgerSnapshot.exitScore.toFixed(2) }}</strong>
              </div>
            </div>
            <p>{{ formatSignalRegimeLabel(selectedLedgerSnapshot) }}</p>
            <ul class="reason-list">
              <li v-for="reason in selectedLedgerSnapshot.reasons" :key="reason">{{ humanizeReason(reason) }}</li>
            </ul>
          </div>
        </article>
      </section>

      <section class="grid">
        <article class="panel">
          <div class="panel-header">
            <h2>Decision queue</h2>
            <span>{{ formatMarketDayLabel(selectedMarketDay) }} · {{ selectedMarketSymbol || 'All tracked stocks' }}</span>
          </div>
          <div class="triage-toolbar">
            <button
              v-for="filter in triageFilters"
              :key="filter"
              type="button"
              class="triage-pill"
              :class="{ active: triageFilter === filter }"
              :aria-pressed="triageFilter === filter"
              @click="setTriageFilter(filter)"
            >
              <span>{{ filter === 'all' ? 'All decisions' : filter === 'entry' ? 'Entry' : filter === 'exit' ? 'Exit' : 'Hold' }}</span>
              <strong>{{ triageCounts[filter] }}</strong>
            </button>
          </div>
          <div v-if="triagePageSignals.length" class="ledger-toolbar">
            <button type="button" class="action-button ghost compact" :disabled="triagePage === 0" @click="triagePage = Math.max(triagePage - 1, 0)">
              Previous
            </button>
            <span class="pager-label">{{ triagePage + 1 }} / {{ triagePageCount }}</span>
            <button
              type="button"
              class="action-button ghost compact"
              :disabled="triagePage >= triagePageCount - 1"
              @click="triagePage = Math.min(triagePage + 1, triagePageCount - 1)"
            >
              Next
            </button>
          </div>
          <div v-if="triagePageSignals.length" class="signal-list">
            <button
              v-for="signal in triagePageSignals"
              :key="signalKey(signal)"
              class="signal-row"
              :class="classifySignal(signal)"
              @click="selectedSignal = signal"
            >
              <div>
                <strong>{{ signal.symbol }}</strong>
                <p>{{ formatSignalRegimeLabel(signal) }}</p>
              </div>
              <div class="scores">
                <span>{{ signal.entryScore.toFixed(2) }}</span>
                <span>{{ signal.exitScore.toFixed(2) }}</span>
              </div>
            </button>
          </div>
          <p v-else class="empty-state">No live signals have been written for the selected day.</p>
        </article>

        <article class="panel">
          <div class="panel-header">
            <h2>Selected signal</h2>
            <span>{{ selectedSignal?.symbol ?? 'No signal selected' }}</span>
          </div>
          <div class="detail-card" v-if="selectedSignal">
            <div class="detail-title">
              <strong>{{ formatSignalStateLabel(selectedSignal.state) }}</strong>
              <span>Updated {{ formatLocaleTimestamp(selectedSignal.updatedAt) }}</span>
            </div>
            <div class="score-grid">
              <div>
                <span>Entry score</span>
                <strong>{{ selectedSignal.entryScore.toFixed(2) }}</strong>
              </div>
              <div>
                <span>Exit score</span>
                <strong>{{ selectedSignal.exitScore.toFixed(2) }}</strong>
              </div>
            </div>
            <p>{{ formatSignalRegimeLabel(selectedSignal) }}</p>
            <ul class="reason-list">
              <li v-for="reason in selectedSignal.reasons" :key="reason">{{ humanizeReason(reason) }}</li>
            </ul>
          </div>
        </article>
      </section>

      <section class="panel two-column">
        <div class="panel-header">
          <h2>Trade windows</h2>
          <span>{{ allWindowReviews.length }} windows · {{ formatMarketDayLabel(selectedMarketDay) }}</span>
        </div>
        <p>
          Each window shows the entry and exit decision, the change in price, and the context that pushed the engine into the trade.
          This is the section to use when checking profitability and signal quality.
        </p>
        <div v-if="selectedWindowReviews.length" class="ledger-toolbar">
          <button type="button" class="action-button ghost compact" :disabled="windowReviewPage === 0" @click="previousWindowPage">
            Previous
          </button>
          <span class="pager-label">{{ windowReviewPage + 1 }} / {{ windowReviewPageCount }}</span>
          <button
            type="button"
            class="action-button ghost compact"
            :disabled="windowReviewPage >= windowReviewPageCount - 1"
            @click="nextWindowPage"
          >
            Next
          </button>
        </div>
        <div class="two-column-body">
          <div v-if="selectedWindowReviews.length" class="signal-list compact window-list">
            <button
              v-for="review in selectedWindowReviews"
              :key="windowKey(review)"
              type="button"
              class="signal-row ledger-row"
              :class="{ active: selectedWindowReview?.id === review.id }"
              @click="setWindowReview(review)"
            >
              <div>
                <strong>{{ review.symbol }}</strong>
                <p>
                  {{ formatWindowStatusLabel(review.status) }} · {{ describeWindowOutcome(review.changePct) }} ·
                  {{ review.durationMinutes === null ? 'Open' : `${review.durationMinutes} min` }}
                </p>
              </div>
              <div class="scores">
                <span>{{ review.entryScore.toFixed(2) }}</span>
                <span>{{ review.exitScore.toFixed(2) }}</span>
              </div>
            </button>
          </div>
          <div v-else class="empty-state">No trade windows available for the selected symbol and day.</div>
          <div v-if="selectedWindowReview" class="detail-card window-detail">
            <div class="detail-title">
              <strong>{{ selectedWindowReview.symbol }}</strong>
              <span>{{ formatWindowStatusLabel(selectedWindowReview.status) }}</span>
            </div>
            <div class="score-grid">
              <div>
                <span>Change</span>
                <strong>{{ describeWindowOutcome(selectedWindowReview.changePct) }}</strong>
              </div>
              <div>
                <span>Duration</span>
                <strong>{{ selectedWindowReview.durationMinutes === null ? 'Open' : `${selectedWindowReview.durationMinutes} min` }}</strong>
              </div>
              <div>
                <span>Entry price</span>
                <strong>{{ selectedWindowReview.entryPrice === null ? '--' : selectedWindowReview.entryPrice.toFixed(2) }}</strong>
              </div>
              <div>
                <span>Exit price</span>
                <strong>{{ selectedWindowReview.exitPrice === null ? '--' : selectedWindowReview.exitPrice.toFixed(2) }}</strong>
              </div>
            </div>
            <p>{{ selectedWindowReview.benchmarkLabel }}</p>
            <div class="window-summary-grid">
              <div>
                <span>Entry context</span>
                <p>{{ selectedWindowReview.entrySummary }}</p>
              </div>
              <div>
                <span>Exit context</span>
                <p>{{ selectedWindowReview.exitSummary }}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-header">
          <h2>Config editor</h2>
          <span>{{ configEditorStatus }}</span>
        </div>
        <div class="config-editor-bar">
          <p>
            Current session version: <strong>{{ currentConfigVersion }}</strong>
            <span v-if="selectedConfigVersion">Selected: {{ selectedConfigVersion.version }}</span>
          </p>
          <button type="button" class="action-button" :disabled="!firestoreAvailable" @click="saveConfigVersion">
            Save candidate
          </button>
        </div>
        <p v-if="isConfigDraftDirty" class="status-warning config-dirty-warning">
          Unsaved draft changes are active. Save before switching versions.
        </p>
        <div class="config-section-list">
          <article v-for="group in configFieldGroups" :key="group.label" class="config-group">
            <div class="panel-header compact">
              <h3>{{ group.label }}</h3>
              <span>{{ group.fields.length }} fields</span>
            </div>
            <div class="config-grid">
              <article v-for="field in group.fields" :key="field.key" class="config-card">
                <label :for="field.key" :title="field.description">{{ field.label }}</label>
                <p class="config-current-value">
                  Current value:
                  <strong>{{ stringifyConfigValue(field.value) }}</strong>
                </p>
                <div v-if="field.inputType === 'symbols'" class="symbol-chip-list">
                  <button
                    v-for="option in field.options ?? []"
                    :key="option"
                    type="button"
                    class="symbol-chip"
                    :class="{ active: isDraftSymbolSelected(field, option) }"
                    @click="toggleDraftSymbol(field, option)"
                  >
                    {{ option }}
                  </button>
                </div>
                <textarea
                  v-if="field.inputType === 'symbols'"
                  :id="field.key"
                  v-model="configDraft[field.key]"
                  rows="4"
                  :placeholder="field.placeholder"
                  :title="field.description"
                />
                <input
                  v-else
                  :id="field.key"
                  v-model="configDraft[field.key]"
                  :type="field.inputType === 'number' ? 'number' : 'text'"
                  :step="field.inputType === 'number' ? field.step ?? 0.01 : undefined"
                  :placeholder="field.placeholder"
                  :title="field.description"
                />
                <p>{{ field.description }}</p>
              </article>
            </div>
          </article>
        </div>
      </section>

      <section class="panel">
        <div class="panel-header">
          <h2>Config history</h2>
          <span>Versioned snapshots</span>
        </div>
        <div class="signal-list">
          <article
            v-for="version in configVersions"
            :key="version.id"
            class="signal-row history-row"
            :class="{ active: selectedConfigVersion?.id === version.id, disabled: isConfigDraftDirty && selectedConfigVersion?.id !== version.id }"
            @click="handleConfigVersionClick(version)"
          >
            <div>
              <strong>{{ version.version }}</strong>
              <p>{{ version.summary }}</p>
            </div>
            <div class="history-actions">
              <span>{{ version.status }}</span>
              <span>{{ formatLocaleTimestamp(version.updatedAt) }}</span>
              <button
                v-if="version.status !== 'active'"
                type="button"
                class="action-button ghost"
                :disabled="!firestoreAvailable"
                @click.stop="applySelectedVersion(version)"
              >
                {{ version.status === 'candidate' ? 'Promote' : version.status === 'archived' ? 'Rollback' : 'Apply' }}
              </button>
            </div>
          </article>
        </div>
      </section>

      <div v-if="expandedChartView" class="chart-modal" @click.self="closeExpandedChart">
        <article
          ref="chartModalCardRef"
          class="panel chart-modal-card"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="`expanded-chart-title-${expandedChartView.chart.id}`"
          :aria-describedby="`expanded-chart-desc-${expandedChartView.chart.id}`"
          tabindex="-1"
        >
          <div class="panel-header">
            <div>
              <h2 :id="`expanded-chart-title-${expandedChartView.chart.id}`">{{ expandedChartView.chart.title }}</h2>
              <p>{{ expandedChartView.chart.subtitle }}</p>
            </div>
            <button ref="chartModalCloseButton" type="button" class="action-button ghost compact" @click="closeExpandedChart">
              Close
            </button>
          </div>
          <div class="chart-legend">
            <span v-for="line in expandedChartView.view.lines" :key="line.label" :title="`${line.label}: ${line.latestValue}`">
              <i :style="{ background: line.color }"></i>
              {{ line.label }} {{ line.latestValue }}
            </span>
          </div>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" class="chart-svg chart-svg-expanded" aria-hidden="true">
            <g v-for="line in expandedChartView.view.lines" :key="`expanded-${expandedChartView.chart.id}-${line.label}`">
              <polyline
                v-if="line.points"
                :points="line.points"
                fill="none"
                :stroke="line.color"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </g>
            <g v-for="marker in expandedChartView.view.markers" :key="`expanded-${expandedChartView.chart.id}-${marker.id}`">
              <line
                :x1="marker.x"
                y1="0"
                :x2="marker.x"
                y2="100"
                :class="marker.kind"
                class="signal-marker-line"
              />
              <circle
                :cx="marker.x"
                :cy="marker.y"
                r="1.9"
                :class="marker.kind"
                class="signal-marker-dot"
              />
            </g>
          </svg>
          <p :id="`expanded-chart-desc-${expandedChartView.chart.id}`" class="status-warning">
            {{ formatLocaleTimestamp(expandedChartView.view.latestTimestamp) }}
          </p>
        </article>
      </div>
    </template>
  </main>
</template>
