<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch, type Ref } from 'vue'
import { signInAnonymously } from 'firebase/auth'
import { onValue, ref as databaseRef, type Unsubscribe } from 'firebase/database'
import { type MessagePayload } from 'firebase/messaging'
import { classifySignal } from './lib/engine'
import { auth, rtdb } from './lib/firebase'
import {
  applyConfigVersion,
  loadDashboardSnapshot,
  saveWindowOptimization,
  saveConfigCandidate,
  type ConfigVersionRecord,
  type DashboardSnapshot,
  type DashboardSource,
  type MarketSnapshotRecord,
  type TradeWindowRecord,
} from './lib/dashboard'
import { currentMarketDayKey, formatMarketDayLabel, marketDayKeyForTimestamp } from './lib/market-day'
import {
  CONFIG_VERSIONS_COLLECTION,
  MARKET_SESSIONS_COLLECTION,
  MARKET_SNAPSHOTS_COLLECTION,
  SIGNAL_EVENTS_COLLECTION,
  TRADE_WINDOWS_COLLECTION,
  WINDOW_OPTIMIZATIONS_COLLECTION,
} from './lib/schema'
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
const selectedDecisionSymbol = ref<string>('')
const selectedMarketDay = ref<string>(currentMarketDayKey())
const chartIntervalMinutes = ref<1 | 5 | 10 | 30 | 60>(1)
const marketWindowPage = ref(0)
const selectedMarketWindowReviewId = ref<string>('')
const selectedWindowSymbol = ref<string>('')
const selectedOptimizationSymbol = ref<string>('')
const loading = ref(true)
const authState = ref<'booting' | 'authenticating' | 'authenticated' | 'offline'>('booting')
const snapshotSource = ref<DashboardSource>('empty')
const snapshotWarning = ref<string | null>(null)
const liveDataAvailable = ref(true)
const notificationState = ref<NotificationSetupState>('unsupported')
const notificationMessage = ref<string | null>(null)
const selectedLedgerSnapshotId = ref<string>('')
const selectedWindowReviewId = ref<string>('')
const selectedOptimizationReviewId = ref<string>('')
const liveSignalPage = ref(0)
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
let realtimeUnsubscribers: Unsubscribe[] = []
let realtimeListenerKey = ''
const triageFilter = ref<'all' | 'entry' | 'exit'>('all')
const triageFilters = ['all', 'entry', 'exit'] as const
const selectedConfigVersionId = ref<string>('current')
const configDraft = reactive<Record<string, string | number>>({})
const symbolAddDrafts = reactive<Record<string, string>>({})
const optimizationEntrySnapshotId = ref<string>('')
const optimizationExitSnapshotId = ref<string>('')
const optimizationNotes = ref('')
const optimizationSaving = ref(false)
const optimizationError = ref<string | null>(null)
const DASHBOARD_REFRESH_INTERVAL_MS = 30_000
const LIVE_SIGNAL_PAGE_SIZE = 20
const getMarketDayKey = (value: string | Date) => marketDayKeyForTimestamp(value) || currentMarketDayKey()
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
const selectedDaySignals = computed(() => {
  const signals = snapshot.value?.signals ?? []
  return signals.filter((signal) => getMarketDayKey(signal.updatedAt) === selectedMarketDay.value)
})
const marketSymbols = computed(() => {
  const symbols = new Set<string>()
  const monitoredSymbols = snapshot.value?.configFields.find((field) => field.key === 'monitored_symbols')?.value
  if (Array.isArray(monitoredSymbols)) {
    for (const symbol of monitoredSymbols) {
      const normalized = String(symbol).trim().toUpperCase()
      if (normalized) {
        symbols.add(normalized)
      }
    }
  }
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
const decisionSymbols = computed(() => {
  const symbols = new Set<string>()
  for (const signal of selectedDaySignals.value) {
    if (classifySignal(signal) === 'hold') {
      continue
    }
    if (signal.symbol) {
      symbols.add(signal.symbol)
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
const marketWindowReviews = computed(() => {
  return tradeWindows.value
    .filter((window) => getMarketDayKey(window.openedAt) === selectedMarketDay.value || (window.closedAt ? getMarketDayKey(window.closedAt) === selectedMarketDay.value : false))
    .filter((window) => !selectedMarketSymbol.value || window.symbol === selectedMarketSymbol.value)
    .slice()
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .map((window) => decorateWindowReview(window))
})
const selectedMarketWindowReviews = computed(() => {
  const start = marketWindowPage.value * windowReviewPageSize
  const end = start + windowReviewPageSize
  return marketWindowReviews.value.slice(start, end)
})
const marketWindowPageCount = computed(() => {
  return Math.max(1, Math.ceil(marketWindowReviews.value.length / windowReviewPageSize))
})
const selectedMarketWindowReview = computed<WindowReviewView | null>(() => {
  if (!marketWindowReviews.value.length) {
    return null
  }
  return marketWindowReviews.value.find((review) => review.id === selectedMarketWindowReviewId.value) ?? marketWindowReviews.value[0]
})
const selectedMarketWindowSnapshots = computed(() => {
  const review = selectedMarketWindowReview.value
  if (!review) {
    return []
  }
  return findWindowSnapshots(review)
})
const selectedChartSnapshots = computed(() => {
  return resampleSnapshots(selectedMarketWindowSnapshots.value, chartIntervalMinutes.value)
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
const liveSignals = computed(() => {
  return selectedDaySignals.value
    .filter((signal) => classifySignal(signal) !== 'hold')
    .reverse()
})
const liveSignalPageSignals = computed(() => {
  const start = liveSignalPage.value * LIVE_SIGNAL_PAGE_SIZE
  const end = start + LIVE_SIGNAL_PAGE_SIZE
  return liveSignals.value.slice(start, end)
})
const liveSignalPageCount = computed(() => Math.max(1, Math.ceil(liveSignals.value.length / LIVE_SIGNAL_PAGE_SIZE)))
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
    .filter((window) => !selectedWindowSymbol.value || window.symbol === selectedWindowSymbol.value)
    .slice()
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .map((window) => decorateWindowReview(window))
})
const allOptimizationReviews = computed(() => {
  return tradeWindows.value
    .filter((window) => getMarketDayKey(window.openedAt) === selectedMarketDay.value || (window.closedAt ? getMarketDayKey(window.closedAt) === selectedMarketDay.value : false))
    .filter((window) => !selectedOptimizationSymbol.value || window.symbol === selectedOptimizationSymbol.value)
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
const selectedOptimizationReview = computed<WindowReviewView | null>(() => {
  if (!allOptimizationReviews.value.length) {
    return null
  }
  return allOptimizationReviews.value.find((review) => review.id === selectedOptimizationReviewId.value) ?? allOptimizationReviews.value[0]
})
const selectedOptimizationSnapshots = computed(() => {
  const review = selectedOptimizationReview.value
  if (!review) {
    return []
  }
  return findWindowSnapshots(review)
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
    view: buildChartView(selectedChartSnapshots.value, chart, selectedMarketWindowSnapshots.value),
  })),
)

const windowChartMarkers = computed(() => {
  const review = selectedOptimizationReview.value
  if (!review) {
    return 'Select a window to inspect its buy and sell markers.'
  }
  if (selectedOptimizationSnapshots.value.length === 0) {
    return 'No market snapshots are linked to this window yet.'
  }
  return review.closedAt
    ? 'Buy and sell markers are visible for this closed window.'
    : 'This window is still open, so the sell marker may be missing until the position closes.'
})

const windowOptimizationHistory = computed(() => {
  const optimizations = snapshot.value?.windowOptimizations ?? []
  return optimizations
    .filter((item) => item.day === selectedMarketDay.value)
    .filter((item) => !selectedOptimizationSymbol.value || item.symbol === selectedOptimizationSymbol.value)
    .slice()
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
})

const selectedWindowOptimization = computed(() => {
  if (!selectedOptimizationReview.value) {
    return null
  }
  return windowOptimizationHistory.value.find((optimization) => optimization.windowId === selectedOptimizationReview.value?.id) ?? null
})

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
  if (snapshotSource.value === 'live') {
    return {
      title: 'Live market view',
      description: 'The dashboard is connected and showing live session, signal, config, and chart data.',
    }
  }

  return {
    title: 'Waiting for live view',
    description: 'The dashboard is connected, but the selected session has not produced live records yet.',
  }
})

function emptySessionOverview(): DashboardSnapshot['sessionOverview'] {
  return {
    sessionId: 'nasdaq-live',
    status: 'waiting',
    updatedAt: new Date().toISOString(),
    configVersion: 'draft',
    openWindows: 0,
    summary: 'No live records are available for the selected day yet.',
  }
}

function signalKey(signal: AdminSignal | null) {
  if (!signal) {
    return ''
  }
  return `${signal.symbol}:${signal.windowId || 'no-window'}:${signal.updatedAt}`
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
      return 'Buy signal'
    case 'SELL_ALERT':
      return 'Sell signal'
    case 'HOLD':
      return 'Monitoring'
    default:
      return action || 'Signal'
  }
}

function formatSignalStateLabel(state: string) {
  switch (state) {
    case 'FLAT':
      return 'Waiting'
    case 'ENTRY_SIGNALLED':
      return 'Buy signal'
    case 'ACCEPTED_OPEN':
      return 'Buy window open'
    case 'EXIT_SIGNALLED':
      return 'Sell signal'
    case 'CLOSED':
      return 'Window closed'
    case 'REJECTED':
      return 'Rejected'
    case 'EXPIRED':
      return 'Expired'
    default:
      return state || 'Unknown'
  }
}

function formatSignalQueueLabel(signal: AdminSignal) {
  switch (classifySignal(signal)) {
    case 'entry':
      return 'Buy signal'
    case 'exit':
      return 'Sell signal'
    default:
      return 'Signal'
  }
}

function formatSignalRegimeLabel(signal: AdminSignal | MarketSnapshotRecord | null) {
  if (!signal) {
    return 'Live market view'
  }
  const regime = 'regime' in signal ? signal.regime : signal.signalRegime
  if (!regime) {
    return 'Live market view'
  }
  if (regime === 'Live market session' || regime === 'benchmark snapshot') {
    return 'Live market view'
  }
  if (regime.includes('aligned')) {
    return 'Reference aligned'
  }
  if (regime.includes('pressure')) {
    return 'Reference under pressure'
  }
  if (regime.includes('mixed')) {
    return 'Mixed reference view'
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
    return 'Buy criteria met'
  }
  if (trimmed === 'exit-qualified') {
    return 'Sell criteria met'
  }
  if (trimmed === 'exit-pressure') {
    return 'Sell pressure detected'
  }
  if (trimmed === 'market-closed') {
    return 'Market closed'
  }
  if (trimmed === 'session-close exit') {
    return 'Forced exit at market close'
  }
  if (trimmed === 'benchmark snapshot') {
    return 'Reference snapshot'
  }
  if (trimmed === 'live market session') {
    return 'Live market view'
  }
  const benchmarkMatch = /^([A-Z]{1,6})\s+(market context aligned|market context under pressure|mixed market context)$/.exec(trimmed)
  if (benchmarkMatch) {
    const label = benchmarkMatch[2]
    if (label === 'market context aligned') {
      return 'Reference aligned'
    }
    if (label === 'market context under pressure') {
      return 'Reference under pressure'
    }
    return 'Mixed reference view'
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

  if (!selectedMarketSymbol.value) {
    return
  }

  if (symbols.includes(selectedMarketSymbol.value)) {
    return
  }

  selectedMarketSymbol.value = symbols[0] ?? ''
}

function syncSelectedDecisionSymbol(symbols: string[]) {
  if (symbols.length === 0) {
    selectedDecisionSymbol.value = ''
    return
  }

  if (!selectedDecisionSymbol.value) {
    return
  }

  if (symbols.includes(selectedDecisionSymbol.value)) {
    return
  }

  selectedDecisionSymbol.value = symbols[0] ?? ''
}

function syncSelectedSymbol(selection: Ref<string>, symbols: string[]) {
  if (symbols.length === 0) {
    selection.value = ''
    return
  }

  if (!selection.value) {
    return
  }

  if (symbols.includes(selection.value)) {
    return
  }

  selection.value = symbols[0]
}

function syncSelectedWindowSymbol(symbols: string[]) {
  syncSelectedSymbol(selectedWindowSymbol, symbols)
}

function syncSelectedOptimizationSymbol(symbols: string[]) {
  syncSelectedSymbol(selectedOptimizationSymbol, symbols)
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
  const versionFields = selectedConfigVersion.value?.fields
  if (versionFields && versionFields.length > 0) {
    return versionFields
  }
  return snapshot.value?.configFields ?? configFields
})

const editableConfigFields = computed(() => selectedConfigFields.value)
const configFieldGroups = computed(() => groupConfigFields(editableConfigFields.value))

function stringifyConfigValue(value: ConfigFieldValue): string {
  if (Array.isArray(value)) {
    return value.map((item) => item.toUpperCase()).join('\n')
  }
  return String(value)
}

function parseConfigDraftValue(field: ConfigField, rawValue: string | number): ConfigFieldValue {
  if (field.inputType === 'symbols') {
    return String(rawValue)
      .split(/[\n,]/)
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean)
  }
  if (field.inputType === 'number') {
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      return rawValue
    }
    const trimmed = String(rawValue).trim()
    const parsed = trimmed ? Number(trimmed) : Number.NaN
    return Number.isFinite(parsed) ? parsed : field.value
  }
  return String(rawValue).trim()
}

function configFieldBounds(field: ConfigField) {
  const key = field.key.toLowerCase()
  const step = field.step ?? (key.includes('threshold') || key.includes('optimizer') ? 0.01 : 0.05)
  if (key.includes('threshold')) {
    return { min: 0, max: 1, step }
  }
  if (key.includes('margin')) {
    return { min: 0, max: 0.5, step }
  }
  if (key.includes('optimizer')) {
    return { min: 0, max: 1, step }
  }
  if (key.includes('weight') || key.includes('bias')) {
    return { min: 0, max: 4, step }
  }
  if (key.includes('bars')) {
    return { min: 1, max: 500, step: 1 }
  }
  if (typeof field.value === 'number' && Number.isFinite(field.value)) {
    const min = Math.min(Math.floor(field.value * 0.25), field.value)
    const max = Math.max(field.value * 2, field.value + 1, min + step)
    return { min, max, step }
  }
  return { min: 0, max: 100, step }
}

function isConfigValueOutsideBounds(field: ConfigField) {
  if (field.inputType !== 'number') {
    return false
  }
  const bounds = configFieldBounds(field)
  const draftValue = configDraft[field.key]
  const value = typeof draftValue === 'number'
    ? draftValue
    : typeof draftValue === 'string' && draftValue.trim()
      ? Number(draftValue)
      : typeof field.value === 'number'
        ? field.value
        : Number.NaN
  if (!Number.isFinite(value)) {
    return false
  }
  return value < bounds.min || value > bounds.max
}

function draftNumberValue(field: ConfigField) {
  const draftValue = configDraft[field.key]
  if (typeof draftValue === 'number' && Number.isFinite(draftValue)) {
    return draftValue
  }
  if (typeof draftValue === 'string' && draftValue.trim()) {
    const parsed = Number(draftValue)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return typeof field.value === 'number' ? field.value : 0
}

function readDraftSymbols(field: ConfigField) {
  const raw = configDraft[field.key] ?? stringifyConfigValue(field.value)
  return String(raw)
    .split(/[\n,]/)
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean)
}

function symbolChipOptions(field: ConfigField) {
  return Array.from(new Set([...(field.options ?? []), ...readDraftSymbols(field)]))
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

function addDraftSymbol(field: ConfigField) {
  const normalized = (symbolAddDrafts[field.key] ?? '').trim().toUpperCase()
  if (!normalized) {
    return
  }

  const current = readDraftSymbols(field)
  if (!current.includes(normalized)) {
    configDraft[field.key] = [...current, normalized].join('\n')
  }
  symbolAddDrafts[field.key] = ''
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
  const validKeys = new Set(fields.map((field) => field.key))
  for (const key of Object.keys(configDraft)) {
    if (!validKeys.has(key)) {
      delete configDraft[key]
    }
  }
  for (const key of Object.keys(symbolAddDrafts)) {
    if (!validKeys.has(key)) {
      delete symbolAddDrafts[key]
    }
  }
  for (const field of fields) {
    if (!(field.key in configDraft)) {
      configDraft[field.key] = typeof field.value === 'number' ? field.value : stringifyConfigValue(field.value)
    }
  }
}

function sameDraft(fields: ConfigField[]) {
  if (fields.length !== Object.keys(configDraft).length) {
    return false
  }
  return fields.every((field) => {
    const draftValue = configDraft[field.key]
    if (field.inputType === 'number' && typeof field.value === 'number') {
      const value = typeof draftValue === 'number' ? draftValue : Number(draftValue)
      return Number.isFinite(value) && value === field.value
    }
    if (field.inputType === 'symbols') {
      const parsed = parseConfigDraftValue(field, draftValue ?? stringifyConfigValue(field.value))
      return Array.isArray(parsed) && stringifyConfigValue(parsed) === stringifyConfigValue(field.value)
    }
    return String(draftValue ?? '').trim() === stringifyConfigValue(field.value)
  })
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
  snapshotId: string
  tooltip: string
}

type ChartView = {
  lines: Array<{
    label: string
    color: string
    latestValue: string
    points: string
  }>
  markers: ChartMarker[]
  firstTimestamp: string | null
  latestTimestamp: string | null
  minValue: number
  maxValue: number
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
    subtitle: 'Close price with simple and exponential moving averages',
    series: [
      { key: 'close', label: 'Close', color: '#7dd3fc', decimals: 2 },
      { key: 'smaFast', label: 'Fast SMA', color: '#34d399', decimals: 2 },
      { key: 'smaSlow', label: 'Slow SMA', color: '#f59e0b', decimals: 2 },
      { key: 'emaFast', label: 'Fast EMA', color: '#60a5fa', decimals: 2 },
      { key: 'emaSlow', label: 'Slow EMA', color: '#c084fc', decimals: 2 },
    ],
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

const chartIntervals = [1, 5, 10, 30, 60] as const

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

function buildChartView(records: MarketSnapshotRecord[], chart: ChartDefinition, markerRecords: MarketSnapshotRecord[] = records): ChartView {
  const usableRecords = records.length > 0 ? records : []
  const firstTimestamp = usableRecords.at(0)?.timestamp ?? null
  const latestTimestamp = usableRecords.at(-1)?.timestamp ?? null
  const timestampValues = usableRecords
    .map((record) => Date.parse(record.timestamp))
    .filter((value) => Number.isFinite(value))
  const firstTimestampValue = timestampValues.at(0) ?? null
  const latestTimestampValue = timestampValues.at(-1) ?? null
  const values = chart.series
    .flatMap((series) => usableRecords.map((record) => readSeriesValue(record, series.key)))
    .filter((value): value is number => typeof value === 'number')
  const minValue = values.length > 0 ? Math.min(...values) : 0
  const maxValue = values.length > 0 ? Math.max(...values) : 1
  const spread = maxValue - minValue || 1
  const valuePadding = Math.max(spread * 0.08, Math.abs(maxValue) * 0.02, 0.5)
  const paddedMinValue = minValue - valuePadding
  const paddedMaxValue = maxValue + valuePadding
  const paddedSpread = paddedMaxValue - paddedMinValue || 1
  const xMin = firstTimestampValue ?? 0
  const xMax = latestTimestampValue ?? xMin + 1
  const xSpan = xMax - xMin || 1
  const xPadding = Math.max(xSpan * 0.08, 60_000)
  const paddedXMin = xMin - xPadding
  const paddedXMax = xMax + xPadding
  const paddedXSpan = paddedXMax - paddedXMin || 1
  const leftPad = 6
  const rightPad = 94
  const topPad = 8
  const bottomPad = 92
  const plotWidth = rightPad - leftPad
  const plotHeight = bottomPad - topPad

  const toPoint = (timestamp: number, value: number): ChartPoint => {
    const x = usableRecords.length > 1 ? leftPad + ((timestamp - paddedXMin) / paddedXSpan) * plotWidth : 50
    const y = bottomPad - ((value - paddedMinValue) / paddedSpread) * plotHeight
    return {
      x: Number.isFinite(x) ? Math.min(rightPad, Math.max(leftPad, x)) : 50,
      y: Number.isFinite(y) ? Math.min(bottomPad, Math.max(topPad, y)) : 50,
    }
  }

  const lines = chart.series.map((series) => {
    const coords: ChartPoint[] = []
    usableRecords.forEach((record) => {
      const value = readSeriesValue(record, series.key)
      if (value === null) {
        return
      }
      const timestamp = Date.parse(record.timestamp)
      if (!Number.isFinite(timestamp)) {
        return
      }
      coords.push(toPoint(timestamp, value))
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

  const markers: ChartMarker[] = []
  const entrySnapshot = [...markerRecords].find((record) => record.signalAction === 'BUY_ALERT') ?? null
  const exitSnapshot = [...markerRecords].reverse().find((record) => record.signalAction === 'SELL_ALERT') ?? null

  if (entrySnapshot) {
    const entryTimestamp = Date.parse(entrySnapshot.timestamp)
    const entryValue = chartMarkerValue(entrySnapshot, chart)
    markers.push({
      id: `${entrySnapshot.id}:entry`,
      snapshotId: entrySnapshot.id,
      x: Number.isFinite(entryTimestamp) ? toPoint(entryTimestamp, entryValue).x : 50,
      y: Number.isFinite(entryTimestamp) ? toPoint(entryTimestamp, entryValue).y : 50,
      kind: 'entry',
      tooltip: [
        'Buy signal',
        formatLocaleTimestamp(entrySnapshot.timestamp),
        `Value ${formatChartValue(entryValue, chart.series[0]?.decimals ?? 2)}`,
        ...chart.series.map(
          (series) => `${series.label} ${formatChartValue(readSeriesValue(entrySnapshot, series.key), series.decimals ?? 2)}`,
        ),
      ].join(' · '),
    })
  }

  if (exitSnapshot) {
    const exitTimestamp = Date.parse(exitSnapshot.timestamp)
    const exitValue = chartMarkerValue(exitSnapshot, chart)
    markers.push({
      id: `${exitSnapshot.id}:exit`,
      snapshotId: exitSnapshot.id,
      x: Number.isFinite(exitTimestamp) ? toPoint(exitTimestamp, exitValue).x : 50,
      y: Number.isFinite(exitTimestamp) ? toPoint(exitTimestamp, exitValue).y : 50,
      kind: 'exit',
      tooltip: [
        'Sell signal',
        formatLocaleTimestamp(exitSnapshot.timestamp),
        `Value ${formatChartValue(exitValue, chart.series[0]?.decimals ?? 2)}`,
        ...chart.series.map(
          (series) => `${series.label} ${formatChartValue(readSeriesValue(exitSnapshot, series.key), series.decimals ?? 2)}`,
        ),
      ].join(' · '),
    })
  }

  return {
    lines,
    markers,
    firstTimestamp,
    latestTimestamp,
    minValue,
    maxValue,
  }
}

function chartMarkerValue(record: MarketSnapshotRecord, chart: ChartDefinition) {
  const values = chart.series
    .map((series) => readSeriesValue(record, series.key))
    .filter((value): value is number => typeof value === 'number')
  if (values.length === 0) {
    return record.close
  }
  return values.reduce((total, value) => total + value, 0) / values.length
}

function resampleSnapshots(records: MarketSnapshotRecord[], intervalMinutes: number) {
  if (intervalMinutes <= 1 || records.length <= 1) {
    return records
  }
  const intervalMs = intervalMinutes * 60 * 1000
  const buckets = new Map<number, MarketSnapshotRecord>()
  // Expects ascending timestamps and keeps the latest sample per interval bucket.
  for (const record of records) {
    const timestamp = Date.parse(record.timestamp)
    if (!Number.isFinite(timestamp)) {
      continue
    }
    const bucketKey = Math.floor(timestamp / intervalMs)
    buckets.set(bucketKey, record)
  }
  return Array.from(buckets.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([, record]) => record)
}

function decorateWindowReview(window: TradeWindowRecord): WindowReviewView {
  const snapshots = findWindowSnapshots(window)
  const entrySnapshot =
    snapshots.find((snapshot) => snapshot.signalAction === 'BUY_ALERT') ??
    snapshots[0] ??
    null
  const exitSnapshot = window.closedAt
    ? snapshots.slice().reverse().find((snapshot) => snapshot.signalAction === 'SELL_ALERT') ??
      snapshots.at(-1) ??
      null
    : null
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
    entrySummary: entrySnapshot ? summarizeSnapshotReason(entrySnapshot) : 'Buy snapshot unavailable',
    exitSummary: exitSnapshot ? summarizeSnapshotReason(exitSnapshot) : 'Sell snapshot unavailable',
    benchmarkLabel: 'Reference view',
  }
}

function findWindowSnapshots(window: TradeWindowRecord) {
  const byWindowId = selectedDaySnapshots.value.filter((snapshot) => snapshot.windowId === window.id)
  if (byWindowId.length > 0) {
    return byWindowId
  }

  const openedAt = Date.parse(window.openedAt)
  const closedAt = window.closedAt ? Date.parse(window.closedAt) : Number.POSITIVE_INFINITY
  return selectedDaySnapshots.value.filter((snapshot) => {
    if (snapshot.symbol !== window.symbol) {
      return false
    }
    const timestamp = Date.parse(snapshot.timestamp)
    return Number.isFinite(timestamp) && timestamp >= openedAt && timestamp <= closedAt
  })
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

const triageSignals = computed(() => {
  const signals = selectedDaySignals.value
    .filter((signal) => classifySignal(signal) !== 'hold')
    .filter((signal) => !selectedDecisionSymbol.value || signal.symbol === selectedDecisionSymbol.value)
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
  const signals = selectedDaySignals.value
    .filter((signal) => classifySignal(signal) !== 'hold')
    .filter((signal) => !selectedDecisionSymbol.value || signal.symbol === selectedDecisionSymbol.value)
  const counts: Record<(typeof triageFilters)[number], number> = {
    all: signals.length,
    entry: 0,
    exit: 0,
  }

  for (const signal of signals) {
    const classification = classifySignal(signal)
    if (classification === 'hold') {
      continue
    }
    counts[classification] += 1
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
    marketWindowPage.value = 0
    selectedLedgerSnapshotId.value = ''
    selectedMarketWindowReviewId.value = ''
  },
)

watch(selectedMarketDay, () => {
  marketWindowPage.value = 0
  selectedMarketWindowReviewId.value = ''
  selectedWindowSymbol.value = ''
  selectedOptimizationSymbol.value = ''
})

watch(selectedMarketSymbol, () => {
  marketWindowPage.value = 0
  selectedMarketWindowReviewId.value = ''
})

watch(selectedWindowSymbol, () => {
  windowReviewPage.value = 0
  selectedWindowReviewId.value = ''
})

watch(
  [selectedMarketDay, selectedDecisionSymbol],
  ([nextDay, nextSymbol], [previousDay, previousSymbol]) => {
    if (nextDay !== previousDay) {
      liveSignalPage.value = 0
      triagePage.value = 0
      void requestDashboardRefresh()
    }
    if (nextSymbol !== previousSymbol) {
      triagePage.value = 0
    }
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

watch(marketLedgerPageCount, (pageCount) => {
  clampPage(marketLedgerPage, pageCount)
})

watch(windowReviewPageCount, (pageCount) => {
  clampPage(windowReviewPage, pageCount)
})

watch(marketWindowPageCount, (pageCount) => {
  clampPage(marketWindowPage, pageCount)
})

watch(marketSymbols, (symbols) => {
  syncSelectedMarketSymbol(symbols)
}, { immediate: true })

watch([marketSymbols, selectedWindowSymbol], ([symbols]) => {
  syncSelectedWindowSymbol(symbols)
}, { immediate: true })

watch([marketSymbols, selectedOptimizationSymbol], ([symbols]) => {
  syncSelectedOptimizationSymbol(symbols)
}, { immediate: true })

watch(selectedOptimizationSymbol, () => {
  selectedOptimizationReviewId.value = ''
})

watch([decisionSymbols, selectedSignal], ([symbols]) => {
  syncSelectedDecisionSymbol(symbols)
}, { immediate: true })

watch(
  liveSignals,
  (signals) => {
    if (signals.length === 0) {
      liveSignalPage.value = 0
      return
    }
    const maxPage = Math.max(0, Math.ceil(signals.length / LIVE_SIGNAL_PAGE_SIZE) - 1)
    liveSignalPage.value = Math.min(liveSignalPage.value, maxPage)
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

watch(
  selectedWindowReviews,
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

watch(
  marketWindowReviews,
  (reviews) => {
    if (!reviews.length) {
      selectedMarketWindowReviewId.value = ''
      return
    }
    if (!selectedMarketWindowReviewId.value || !reviews.some((review) => review.id === selectedMarketWindowReviewId.value)) {
      selectedMarketWindowReviewId.value = reviews[0].id
    }
  },
  { immediate: true },
)

watch(
  selectedMarketWindowReviews,
  (reviews) => {
    if (!reviews.length) {
      selectedMarketWindowReviewId.value = ''
      return
    }
    if (!selectedMarketWindowReviewId.value || !reviews.some((review) => review.id === selectedMarketWindowReviewId.value)) {
      selectedMarketWindowReviewId.value = reviews[0].id
    }
  },
  { immediate: true },
)

watch(
  allOptimizationReviews,
  (reviews) => {
    if (!reviews.length) {
      selectedOptimizationReviewId.value = ''
      return
    }
    if (!selectedOptimizationReviewId.value || !reviews.some((review) => review.id === selectedOptimizationReviewId.value)) {
      selectedOptimizationReviewId.value = reviews[0].id
    }
  },
  { immediate: true },
)

watch(
  selectedOptimizationSnapshots,
  (snapshots) => {
    if (!snapshots.length) {
      optimizationEntrySnapshotId.value = ''
      optimizationExitSnapshotId.value = ''
      return
    }
    if (!optimizationEntrySnapshotId.value || !snapshots.some((snapshot) => snapshot.id === optimizationEntrySnapshotId.value)) {
      optimizationEntrySnapshotId.value = snapshots.find((snapshot) => snapshot.signalAction === 'BUY_ALERT')?.id ?? snapshots[0].id
    }
    if (!optimizationExitSnapshotId.value || !snapshots.some((snapshot) => snapshot.id === optimizationExitSnapshotId.value)) {
      optimizationExitSnapshotId.value = snapshots.find((snapshot) => snapshot.signalAction === 'SELL_ALERT')?.id ?? snapshots.at(-1)?.id ?? ''
    }
  },
  { immediate: true },
)

function setTriageFilter(filter: (typeof triageFilters)[number]) {
  triageFilter.value = filter
}

function setLedgerSnapshot(snapshotPoint: MarketSnapshotRecord) {
  selectedLedgerSnapshotId.value = snapshotPoint.id
  selectedMarketSymbol.value = snapshotPoint.symbol
  const matchingWindow = findWindowReviewForSymbolAndTimestamp(snapshotPoint.symbol, snapshotPoint.timestamp, snapshotPoint.windowId)
  if (matchingWindow) {
    selectedMarketWindowReviewId.value = matchingWindow.id
    selectedWindowReviewId.value = matchingWindow.id
    selectedOptimizationReviewId.value = matchingWindow.id
    selectedWindowSymbol.value = matchingWindow.symbol
    selectedOptimizationSymbol.value = matchingWindow.symbol
    marketWindowPage.value = pageForWindowId(marketWindowReviews.value, matchingWindow.id, windowReviewPageSize)
    windowReviewPage.value = pageForWindowId(allWindowReviews.value, matchingWindow.id, windowReviewPageSize)
  }
}

function setWindowReview(review: WindowReviewView) {
  selectedMarketSymbol.value = review.symbol
  selectedMarketWindowReviewId.value = review.id
  selectedWindowReviewId.value = review.id
  selectedOptimizationReviewId.value = review.id
  selectedWindowSymbol.value = review.symbol
  selectedOptimizationSymbol.value = review.symbol
  marketWindowPage.value = pageForWindowId(marketWindowReviews.value, review.id, windowReviewPageSize)
  windowReviewPage.value = pageForWindowId(allWindowReviews.value, review.id, windowReviewPageSize)
}

function setSelectedSignal(signal: AdminSignal) {
  selectedSignal.value = signal
  selectedMarketSymbol.value = signal.symbol
  const matchingWindow = findWindowReviewForSymbolAndTimestamp(signal.symbol, signal.updatedAt, signal.windowId)
  if (matchingWindow) {
    selectedMarketWindowReviewId.value = matchingWindow.id
    selectedWindowReviewId.value = matchingWindow.id
    selectedOptimizationReviewId.value = matchingWindow.id
    selectedWindowSymbol.value = matchingWindow.symbol
    selectedOptimizationSymbol.value = matchingWindow.symbol
    marketWindowPage.value = pageForWindowId(marketWindowReviews.value, matchingWindow.id, windowReviewPageSize)
    windowReviewPage.value = pageForWindowId(allWindowReviews.value, matchingWindow.id, windowReviewPageSize)
  }
}

function pageForWindowId(reviews: WindowReviewView[], windowId: string, pageSize: number) {
  const index = reviews.findIndex((review) => review.id === windowId)
  if (index < 0 || pageSize <= 0) {
    return 0
  }
  return Math.floor(index / pageSize)
}

function findWindowReviewForSymbolAndTimestamp(symbol: string, timestamp: string, preferredWindowId = '') {
  const reviewPool = tradeWindows.value
    .filter((window) => getMarketDayKey(window.openedAt) === selectedMarketDay.value || (window.closedAt ? getMarketDayKey(window.closedAt) === selectedMarketDay.value : false))
    .slice()
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .map((window) => decorateWindowReview(window))

  if (preferredWindowId) {
    const directMatch = reviewPool.find((review) => review.id === preferredWindowId)
    if (directMatch) {
      return directMatch
    }
  }
  const fallbackTimestamp = Date.parse(timestamp)
  return reviewPool.find(
    (review) =>
      review.symbol === symbol &&
      Number.isFinite(fallbackTimestamp) &&
      fallbackTimestamp >= Date.parse(review.openedAt) &&
      (!review.closedAt || fallbackTimestamp <= Date.parse(review.closedAt)),
  )
}

function selectOptimizationPoint(kind: 'entry' | 'exit', snapshotPoint: MarketSnapshotRecord) {
  if (kind === 'entry') {
    optimizationEntrySnapshotId.value = snapshotPoint.id
    return
  }
  optimizationExitSnapshotId.value = snapshotPoint.id
}

function selectOptimizationPointById(kind: 'entry' | 'exit', snapshotId: string) {
  const snapshotPoint = selectedOptimizationSnapshots.value.find((snapshot) => snapshot.id === snapshotId)
  if (snapshotPoint) {
    selectOptimizationPoint(kind, snapshotPoint)
  }
}

function selectedOptimizationSnapshot(kind: 'entry' | 'exit') {
  const snapshotId = kind === 'entry' ? optimizationEntrySnapshotId.value : optimizationExitSnapshotId.value
  return selectedOptimizationSnapshots.value.find((snapshot) => snapshot.id === snapshotId) ?? null
}

function selectedOptimizationSnapshotIndex(kind: 'entry' | 'exit') {
  const snapshotId = kind === 'entry' ? optimizationEntrySnapshotId.value : optimizationExitSnapshotId.value
  return selectedOptimizationSnapshots.value.findIndex((snapshot) => snapshot.id === snapshotId)
}

function shiftOptimizationPoint(kind: 'entry' | 'exit', delta: number) {
  const snapshots = selectedOptimizationSnapshots.value
  if (!snapshots.length) {
    return
  }
  const currentIndex = selectedOptimizationSnapshotIndex(kind)
  const fallbackIndex = kind === 'entry'
    ? snapshots.findIndex((snapshot) => snapshot.signalAction === 'BUY_ALERT')
    : snapshots.findIndex((snapshot) => snapshot.signalAction === 'SELL_ALERT')
  const baseIndex = currentIndex >= 0 ? currentIndex : (fallbackIndex >= 0 ? fallbackIndex : 0)
  const nextIndex = Math.min(Math.max(baseIndex + delta, 0), snapshots.length - 1)
  selectOptimizationPoint(kind, snapshots[nextIndex])
}

function optimizationSnapshotLabel(snapshotPoint: MarketSnapshotRecord | null) {
  if (!snapshotPoint) {
    return 'Not selected'
  }
  const action = snapshotPoint.signalAction === 'BUY_ALERT' ? 'Buy' : snapshotPoint.signalAction === 'SELL_ALERT' ? 'Sell' : 'Market'
  return `${action} · ${formatLocaleTimestamp(snapshotPoint.timestamp)}`
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

function nextMarketWindowPage() {
  marketWindowPage.value = Math.min(marketWindowPage.value + 1, marketWindowPageCount.value - 1)
}

function previousMarketWindowPage() {
  marketWindowPage.value = Math.max(marketWindowPage.value - 1, 0)
}

function formatWindowOptimizationChange(changePct: number) {
  if (!Number.isFinite(changePct)) {
    return '0.00%'
  }
  const sign = changePct >= 0 ? '+' : ''
  return `${sign}${changePct.toFixed(2)}%`
}

async function saveWindowReviewOptimization() {
  if (!snapshot.value || !liveDataAvailable.value) {
    return
  }
  const review = selectedOptimizationReview.value
  const entrySnapshot = selectedOptimizationSnapshot('entry')
  const exitSnapshot = selectedOptimizationSnapshot('exit')
  if (!review || !entrySnapshot || !exitSnapshot) {
    return
  }

  optimizationSaving.value = true
  optimizationError.value = null
  try {
    const now = new Date().toISOString()
    const record = await saveWindowOptimization(
      sessionOverview.value.sessionId,
      review,
      entrySnapshot,
      exitSnapshot,
      optimizationNotes.value,
      snapshot.value?.configFields ?? configFields,
      snapshot.value.windowOptimizations ?? [],
      now,
    )
    snapshot.value = {
      ...snapshot.value,
      windowOptimizations: [record, ...(snapshot.value.windowOptimizations ?? []).filter((item) => item.id !== record.id)],
    }
    optimizationNotes.value = ''
  } catch (error) {
    console.error('Failed to save window optimization:', error)
    optimizationError.value = error instanceof Error ? error.message : 'Failed to save window optimization.'
  } finally {
    optimizationSaving.value = false
  }
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
  if (!liveDataAvailable.value) {
    return
  }
  if (dashboardRefreshInFlight) {
    dashboardRefreshQueued = true
    return
  }

  dashboardRefreshInFlight = true
  const preserveSelectedConfig = selectedConfigVersionId.value
  try {
    const result = await loadDashboardSnapshot({ allowLiveData: true, marketDayKey: selectedMarketDay.value })
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

function stopRealtimeDashboardListeners() {
  for (const unsubscribe of realtimeUnsubscribers) {
    unsubscribe()
  }
  realtimeUnsubscribers = []
  realtimeListenerKey = ''
}

function startRealtimeDashboardListeners(sessionId: string, marketDayKey: string) {
  const listenerKey = `${sessionId}:${marketDayKey}`
  if (!liveDataAvailable.value || !sessionId || listenerKey === realtimeListenerKey) {
    return
  }

  stopRealtimeDashboardListeners()
  realtimeListenerKey = listenerKey
  const paths = [
    `${MARKET_SESSIONS_COLLECTION}/${sessionId}`,
    `${SIGNAL_EVENTS_COLLECTION}/${sessionId}/${marketDayKey}`,
    `${TRADE_WINDOWS_COLLECTION}/${sessionId}`,
    `${WINDOW_OPTIMIZATIONS_COLLECTION}/${sessionId}`,
    `${MARKET_SNAPSHOTS_COLLECTION}/${sessionId}/${marketDayKey}`,
    `${CONFIG_VERSIONS_COLLECTION}/${sessionId}`,
  ]

  for (const path of paths) {
    const unsubscribe = onValue(databaseRef(rtdb, path), () => {
      if (!isMounted || !liveDataAvailable.value || realtimeListenerKey !== listenerKey) {
        return
      }
      void requestDashboardRefresh()
    })
    realtimeUnsubscribers.push(unsubscribe)
  }
}

async function refreshOnRelevantSignal(payload: MessagePayload) {
  const type = payload.data?.type?.trim().toLowerCase()
  if (type === 'decision.accepted' || type === 'decision.exited') {
    await requestDashboardRefresh()
  }
}

async function initializeNotifications(promptForPermission: boolean) {
  if (!liveDataAvailable.value) {
    notificationState.value = 'failed'
    notificationMessage.value = 'Cannot enable live updates: live data is unavailable.'
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
  if (!snapshot.value || !liveDataAvailable.value) {
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
  if (!snapshot.value || !liveDataAvailable.value) {
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
  let allowLiveData = true
  try {
    authState.value = 'authenticating'
    await signInAnonymously(auth)
    authState.value = 'authenticated'
  } catch {
    authState.value = 'offline'
    allowLiveData = false
  }

  liveDataAvailable.value = allowLiveData
  try {
    const result = await loadDashboardSnapshot({ allowLiveData, marketDayKey: selectedMarketDay.value })
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
    if (!isMounted || !liveDataAvailable.value || document.hidden) {
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
        if (isMounted && liveDataAvailable.value && !document.hidden) {
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

watch(
  () => snapshot.value?.sessionOverview.sessionId ?? '',
  (sessionId) => {
    startRealtimeDashboardListeners(sessionId, selectedMarketDay.value)
  },
  { immediate: true },
)

watch(selectedMarketDay, (marketDayKey) => {
  if (snapshot.value?.sessionOverview.sessionId) {
    startRealtimeDashboardListeners(snapshot.value.sessionOverview.sessionId, marketDayKey)
  }
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
  stopRealtimeDashboardListeners()
  stopLiveSignalNotifications()
})
</script>

<template>
  <main class="shell">
    <section class="hero">
      <div>
        <p class="eyebrow">Trade Signal Engine</p>
        <h1>Live signal control room</h1>
        <p class="lede">
          Monitor live windows, tune strategy settings, and inspect signal state without coupling the admin UI to market-data logic.
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
                ? 'Authentication completed successfully.'
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
            <h2>Live market view</h2>
            <span>{{ formatMarketDayLabel(selectedMarketDay) }}</span>
          </div>
          <div class="overview-copy">
            <div>
              <span>Last update</span>
              <strong>{{ formatLocaleTimestamp(sessionOverview.updatedAt) }}</strong>
            </div>
            <div>
              <span>Chart focus</span>
              <strong>{{ selectedMarketSymbol || 'All tracked stocks' }}</strong>
            </div>
            <div>
              <span>Selected day</span>
              <strong>{{ formatMarketDayLabel(selectedMarketDay) }}</strong>
            </div>
            <div>
              <span>Active windows</span>
              <strong>{{ sessionOverview.openWindows }}</strong>
            </div>
          </div>
          <p class="overview-note">
            {{ sessionOverview.summary }}
          </p>
        </article>

        <article class="panel shell-placeholder" data-slot="chart">
          <div class="panel-header">
            <h2>Live market charts</h2>
            <div class="panel-header-actions chart-header-actions">
              <span>{{ formatMarketDayLabel(selectedMarketDay) }} · {{ selectedMarketSymbol || 'All tracked stocks' }}</span>
              <div class="chart-legend chart-legend-inline">
                <span><i class="entry"></i>Buy</span>
                <span><i class="exit"></i>Sell</span>
              </div>
            </div>
          </div>
          <p>
            Switch the day and stock filters, then page through windows to inspect price, indicators, and the two markers that belong to each trade window.
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
          <div class="chart-resolution-toolbar">
            <button
              v-for="interval in chartIntervals"
              :key="interval"
              type="button"
              class="symbol-tab"
              :class="{ active: chartIntervalMinutes === interval }"
              @click="chartIntervalMinutes = interval"
            >
              {{ interval }}m
            </button>
          </div>
          <div v-if="selectedMarketWindowReviews.length" class="ledger-toolbar window-toolbar">
            <button type="button" class="action-button ghost compact" :disabled="marketWindowPage === 0" @click="previousMarketWindowPage">
              Previous window
            </button>
            <span class="pager-label">{{ marketWindowPage + 1 }} / {{ marketWindowPageCount }}</span>
            <button
              type="button"
              class="action-button ghost compact"
              :disabled="marketWindowPage >= marketWindowPageCount - 1"
              @click="nextMarketWindowPage"
            >
              Next window
            </button>
            <div class="window-toolbar-legend">
              <span><i class="entry"></i>Buy</span>
              <span><i class="exit"></i>Sell</span>
            </div>
          </div>
          <div v-if="selectedMarketWindowReview" class="window-context-bar">
            <div>
              <strong>{{ selectedMarketWindowReview.symbol }}</strong>
              <p>{{ formatWindowStatusLabel(selectedMarketWindowReview.status) }} · {{ describeWindowOutcome(selectedMarketWindowReview.changePct) }}</p>
            </div>
            <div>
              <span>Window</span>
              <strong>{{ formatLocaleTimestamp(selectedMarketWindowReview.openedAt) }} → {{ selectedMarketWindowReview.closedAt ? formatLocaleTimestamp(selectedMarketWindowReview.closedAt) : 'Open' }}</strong>
            </div>
            <div>
              <span>Marker guide</span>
              <strong>{{ windowChartMarkers }}</strong>
            </div>
          </div>
          <div v-if="selectedMarketWindowSnapshots.length" class="chart-grid">
            <article v-for="item in marketChartViews" :key="`${selectedMarketWindowReview?.id ?? 'window'}-${item.chart.id}`" class="chart-card">
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
                <g
                  v-for="marker in item.view.markers"
                  :key="`${item.chart.id}-${marker.id}`"
                  @click.stop="selectOptimizationPointById(marker.kind, marker.snapshotId)"
                >
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
                  <title>{{ marker.tooltip }}</title>
                </g>
              </svg>
              <div class="chart-axis">
                <span>X start: {{ formatLocaleTimestamp(item.view.firstTimestamp) }}</span>
                <span>X end: {{ formatLocaleTimestamp(item.view.latestTimestamp) }}</span>
                <span>Y range: {{ formatChartValue(item.view.maxValue, 2) }} / {{ formatChartValue(item.view.minValue, 2) }}</span>
              </div>
              <div class="chart-axis chart-axis-values">
                <span>Y high: {{ formatChartValue(item.view.maxValue, 2) }}</span>
                <span>Y mid: {{ formatChartValue((item.view.maxValue + item.view.minValue) / 2, 2) }}</span>
                <span>Y low: {{ formatChartValue(item.view.minValue, 2) }}</span>
              </div>
            </article>
          </div>
          <p v-else class="empty-state">Select a market window to inspect its chart set.</p>
        </article>

        <article class="panel shell-placeholder" data-slot="table">
          <div class="panel-header">
            <h2>Live signal stream</h2>
            <div class="panel-header-actions">
              <span>{{ liveSignals.length }} signals</span>
              <span>{{ liveSignalPage + 1 }} / {{ liveSignalPageCount }}</span>
            </div>
          </div>
          <p>
            This stream shows buy and sell signals across all tracked stocks in real time. Click a signal to open its linked window above.
          </p>
          <div v-if="liveSignalPageCount > 1" class="ledger-toolbar">
            <button type="button" class="action-button ghost compact" :disabled="liveSignalPage === 0" @click="liveSignalPage = Math.max(liveSignalPage - 1, 0)">
              Previous
            </button>
            <button type="button" class="action-button ghost compact" :disabled="liveSignalPage >= liveSignalPageCount - 1" @click="liveSignalPage = Math.min(liveSignalPage + 1, liveSignalPageCount - 1)">
              Next
            </button>
          </div>
          <div v-if="liveSignalPageSignals.length" class="signal-list compact ledger-list live-signal-list">
            <button
              v-for="signal in liveSignalPageSignals"
              :key="signalKey(signal)"
              type="button"
              class="signal-row ledger-row"
              :class="{ active: signalKey(selectedSignal) === signalKey(signal) }"
              @click="setSelectedSignal(signal)"
            >
              <div>
                <strong>{{ signal.symbol }}</strong>
                <p>{{ formatLocaleTimestamp(signal.updatedAt) }} · {{ formatSignalQueueLabel(signal) }} · {{ signal.windowId ? 'Linked window' : 'Window pending' }}</p>
              </div>
              <div class="scores">
                <span>{{ signal.entryScore.toFixed(2) }}</span>
                <span>{{ signal.exitScore.toFixed(2) }}</span>
              </div>
            </button>
          </div>
          <div v-else class="empty-state">No live buy or sell signals have been written for the selected day yet.</div>
        </article>
      </section>

      <section class="grid">
        <article class="panel">
          <div class="panel-header">
            <h2>Decision queue</h2>
            <span>{{ formatMarketDayLabel(selectedMarketDay) }} · {{ selectedDecisionSymbol || 'All tracked stocks' }}</span>
          </div>
          <div class="symbol-tabs">
            <button
              type="button"
              class="symbol-tab"
              :class="{ active: !selectedDecisionSymbol }"
              @click="selectedDecisionSymbol = ''"
            >
              All
            </button>
            <button
              v-for="symbol in decisionSymbols"
              :key="symbol"
              type="button"
              class="symbol-tab"
              :class="{ active: selectedDecisionSymbol === symbol }"
              @click="selectedDecisionSymbol = symbol"
            >
              {{ symbol }}
            </button>
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
              <span>{{ filter === 'all' ? 'All decisions' : filter === 'entry' ? 'Buy' : 'Sell' }}</span>
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
              @click="setSelectedSignal(signal)"
            >
              <div>
                <strong>{{ signal.symbol }}</strong>
                <p>{{ formatSignalRegimeLabel(signal) }} · {{ signal.windowId ? 'Linked window' : 'Window pending' }}</p>
              </div>
              <div class="scores">
                <span>{{ signal.entryScore.toFixed(2) }}</span>
                <span>{{ signal.exitScore.toFixed(2) }}</span>
              </div>
            </button>
          </div>
          <p v-else class="empty-state">No buy or sell decisions have been written for the selected day.</p>
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
                <span>Buy score</span>
                <strong>{{ selectedSignal.entryScore.toFixed(2) }}</strong>
              </div>
              <div>
                <span>Sell score</span>
                <strong>{{ selectedSignal.exitScore.toFixed(2) }}</strong>
              </div>
              <div>
                <span>Window</span>
                <strong>{{ selectedSignal.windowId ? 'Linked window' : 'Window pending' }}</strong>
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
        <div class="symbol-tabs">
          <button
            type="button"
            class="symbol-tab"
            :class="{ active: !selectedWindowSymbol }"
            @click="selectedWindowSymbol = ''"
          >
            All
          </button>
          <button
            v-for="symbol in marketSymbols"
            :key="`window-${symbol}`"
            type="button"
            class="symbol-tab"
            :class="{ active: selectedWindowSymbol === symbol }"
            @click="selectedWindowSymbol = symbol"
          >
            {{ symbol }}
          </button>
        </div>
        <p>
          Each window shows the buy and sell decision, the change in price, and the context that pushed the engine into the trade.
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
                <span>Buy price</span>
                <strong>{{ selectedWindowReview.entryPrice === null ? '--' : selectedWindowReview.entryPrice.toFixed(2) }}</strong>
              </div>
              <div>
                <span>Sell price</span>
                <strong>{{ selectedWindowReview.exitPrice === null ? '--' : selectedWindowReview.exitPrice.toFixed(2) }}</strong>
              </div>
            </div>
            <p>{{ selectedWindowReview.benchmarkLabel }}</p>
            <div class="window-summary-grid">
              <div>
                <span>Buy context</span>
                <p>{{ selectedWindowReview.entrySummary }}</p>
              </div>
              <div>
                <span>Sell context</span>
                <p>{{ selectedWindowReview.exitSummary }}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-header">
          <h2>Window optimizer</h2>
          <span>{{ selectedOptimizationReview?.symbol ?? 'No window selected' }}</span>
        </div>
        <div class="symbol-tabs optimizer-symbol-tabs">
          <button
            type="button"
            class="symbol-tab"
            :class="{ active: !selectedOptimizationSymbol }"
            @click="selectedOptimizationSymbol = ''"
          >
            All
          </button>
          <button
            v-for="symbol in marketSymbols"
            :key="`optimization-${symbol}`"
            type="button"
            class="symbol-tab"
            :class="{ active: selectedOptimizationSymbol === symbol }"
            @click="selectedOptimizationSymbol = symbol"
          >
            {{ symbol }}
          </button>
        </div>
        <p>
          Pick the most informative buy and sell points for the selected window. You can click the markers on the charts or the points below, then save the review so the engine can reuse the sample later.
        </p>
        <div v-if="selectedOptimizationReview" class="optimizer-layout">
          <div class="detail-card">
            <div class="detail-title">
              <strong>{{ selectedOptimizationReview.symbol }}</strong>
              <span>{{ formatWindowStatusLabel(selectedOptimizationReview.status) }}</span>
            </div>
              <div class="score-grid">
                <div>
                  <span>Change</span>
                  <strong>{{ describeWindowOutcome(selectedOptimizationReview.changePct) }}</strong>
                </div>
                <div>
                  <span>Duration</span>
                  <strong>{{ selectedOptimizationReview.durationMinutes === null ? 'Open' : `${selectedOptimizationReview.durationMinutes} min` }}</strong>
                </div>
                <div>
                  <span>Buy pick</span>
                  <strong>{{ optimizationSnapshotLabel(selectedOptimizationSnapshot('entry')) }}</strong>
                </div>
                <div>
                  <span>Sell pick</span>
                  <strong>{{ optimizationSnapshotLabel(selectedOptimizationSnapshot('exit')) }}</strong>
                </div>
              </div>
            <p class="optimization-status" :class="{ saved: !!selectedWindowOptimization }">
              {{
                selectedWindowOptimization
                  ? `Optimization saved on ${formatLocaleTimestamp(selectedWindowOptimization.updatedAt)}`
                  : 'This window has not been optimized yet.'
              }}
            </p>
            <div class="optimizer-actions-inline">
              <button type="button" class="action-button ghost compact" :disabled="selectedOptimizationSnapshotIndex('entry') <= 0" @click="shiftOptimizationPoint('entry', -1)">
                Previous buy point
              </button>
              <button
                type="button"
                class="action-button ghost compact"
                :disabled="selectedOptimizationSnapshotIndex('entry') < 0 || selectedOptimizationSnapshotIndex('entry') >= selectedOptimizationSnapshots.length - 1"
                @click="shiftOptimizationPoint('entry', 1)"
              >
                Next buy point
              </button>
              <button type="button" class="action-button ghost compact" :disabled="selectedOptimizationSnapshotIndex('exit') <= 0" @click="shiftOptimizationPoint('exit', -1)">
                Previous sell point
              </button>
              <button
                type="button"
                class="action-button ghost compact"
                :disabled="selectedOptimizationSnapshotIndex('exit') < 0 || selectedOptimizationSnapshotIndex('exit') >= selectedOptimizationSnapshots.length - 1"
                @click="shiftOptimizationPoint('exit', 1)"
              >
                Next sell point
              </button>
            </div>
            <p>{{ windowChartMarkers }}</p>
          </div>
          <div class="optimizer-point-list">
            <div
              v-for="snapshotPoint in selectedOptimizationSnapshots"
              :key="`${selectedOptimizationReview.id}:${snapshotPoint.id}`"
              class="signal-row ledger-row optimizer-row"
              :class="{ active: optimizationEntrySnapshotId === snapshotPoint.id || optimizationExitSnapshotId === snapshotPoint.id }"
            >
              <div>
                <strong>{{ formatLocaleTimestamp(snapshotPoint.timestamp) }}</strong>
                <p>
                  {{ formatSignalActionLabel(snapshotPoint.signalAction) }} ·
                  {{ formatSignalRegimeLabel(snapshotPoint) }}
                </p>
              </div>
              <div class="optimizer-actions-inline">
                <button type="button" class="action-button ghost compact" @click.stop="selectOptimizationPoint('entry', snapshotPoint)">
                  Buy
                </button>
                <button type="button" class="action-button ghost compact" @click.stop="selectOptimizationPoint('exit', snapshotPoint)">
                  Sell
                </button>
              </div>
            </div>
          </div>
          <div class="optimizer-footer">
            <textarea
              v-model="optimizationNotes"
              rows="3"
              placeholder="Optional notes for this review"
            />
            <p v-if="optimizationError" class="status-warning">{{ optimizationError }}</p>
            <button
              type="button"
              class="action-button"
              :disabled="optimizationSaving || !selectedOptimizationSnapshots.length"
              @click="saveWindowReviewOptimization"
            >
              {{ optimizationSaving ? 'Saving...' : selectedWindowOptimization ? 'Update optimization' : 'Save optimization' }}
            </button>
          </div>
        </div>
        <div v-else class="empty-state">Select a window to review its optimal points.</div>
        <div v-if="windowOptimizationHistory.length" class="history-strip">
          <article v-for="optimization in windowOptimizationHistory" :key="optimization.id" class="history-row optimization-history-row">
            <div>
              <strong>{{ optimization.symbol }}</strong>
              <p>{{ formatLocaleTimestamp(optimization.updatedAt) }} · {{ formatWindowOptimizationChange(optimization.changePct) }}</p>
            </div>
            <div class="history-actions">
              <span>{{ optimization.windowId ? 'Linked window' : 'Window pending' }}</span>
              <span>{{ optimization.day }}</span>
            </div>
          </article>
        </div>
      </section>

      <section class="panel">
        <div class="panel-header">
          <h2>Strategy settings</h2>
          <span>{{ configEditorStatus }}</span>
        </div>
        <div class="config-editor-bar">
          <p>
            Active profile: <strong>{{ currentConfigVersion }}</strong>
            <span v-if="selectedConfigVersion">Viewing: {{ selectedConfigVersion.version }}</span>
          </p>
          <button type="button" class="action-button" :disabled="!liveDataAvailable" @click="saveConfigVersion">
            Save candidate
          </button>
        </div>
        <p v-if="isConfigDraftDirty" class="status-warning config-dirty-warning">
          Unsaved draft changes are active. Save before switching versions.
        </p>
        <p class="config-helper-text">
          Tune buy and sell weights independently. Hover each label to see why the current value exists and use the review history above to keep the strategy moving in small, stable steps.
        </p>
        <div class="config-section-list">
          <article v-for="group in configFieldGroups" :key="group.label" class="config-group">
            <div class="panel-header compact">
              <h3>{{ group.label }}</h3>
              <span>{{ group.fields.length }} fields</span>
            </div>
            <div class="config-grid">
              <article v-for="field in group.fields" :key="field.key" class="config-card" :class="{ warning: isConfigValueOutsideBounds(field) }">
                <label :for="field.key" :title="field.description">{{ field.label }}</label>
                <p class="config-current-value">
                  Current value:
                  <strong>{{ stringifyConfigValue(field.value) }}</strong>
                </p>
                <div v-if="field.inputType === 'symbols'" class="symbol-chip-list">
                  <button
                    v-for="option in symbolChipOptions(field)"
                    :key="option"
                    type="button"
                    class="symbol-chip"
                    :class="{ active: isDraftSymbolSelected(field, option) }"
                    @click="toggleDraftSymbol(field, option)"
                  >
                    {{ option }}
                  </button>
                </div>
                <div v-if="field.inputType === 'symbols'" class="symbol-add-row">
                  <input
                    :id="field.key"
                    v-model="symbolAddDrafts[field.key]"
                    type="text"
                    :placeholder="field.placeholder"
                    :title="field.description"
                    @keydown.enter.prevent="addDraftSymbol(field)"
                  />
                  <button type="button" class="action-button ghost compact" @click="addDraftSymbol(field)">
                    Add symbol
                  </button>
                </div>
                <template v-else-if="field.inputType === 'number'">
                  <div class="config-slider-shell">
                    <input
                      :id="field.key"
                      v-model.number="configDraft[field.key]"
                      type="range"
                      :min="configFieldBounds(field).min"
                      :max="configFieldBounds(field).max"
                      :step="configFieldBounds(field).step"
                      :title="field.description"
                      class="config-slider"
                    />
                    <input
                      v-model.number="configDraft[field.key]"
                      type="number"
                      :min="configFieldBounds(field).min"
                      :max="configFieldBounds(field).max"
                      :step="configFieldBounds(field).step"
                      :placeholder="field.placeholder"
                      :title="field.description"
                      class="config-number-input"
                      :class="{ outOfRange: isConfigValueOutsideBounds(field) }"
                    />
                  </div>
                  <p class="config-range-note" :class="{ outOfRange: isConfigValueOutsideBounds(field) }">
                    Range {{ configFieldBounds(field).min }} - {{ configFieldBounds(field).max }} · Current draft {{ draftNumberValue(field).toFixed(2) }}
                    <span v-if="isConfigValueOutsideBounds(field)">Outside the recommended range.</span>
                  </p>
                </template>
                <input
                  v-else
                  :id="field.key"
                  v-model="configDraft[field.key]"
                  type="text"
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
          <h2>Version history</h2>
          <span>Strategy snapshots</span>
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
                :disabled="!liveDataAvailable"
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
            <g
              v-for="marker in expandedChartView.view.markers"
              :key="`expanded-${expandedChartView.chart.id}-${marker.id}`"
              @click.stop="selectOptimizationPointById(marker.kind, marker.snapshotId)"
            >
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
              <title>{{ marker.kind === 'entry' ? 'Click to use as the buy point' : 'Click to use as the sell point' }}</title>
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
