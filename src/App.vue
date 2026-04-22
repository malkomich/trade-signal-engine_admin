<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
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
} from './lib/dashboard'
import {
  probeLiveSignalNotifications,
  setupLiveSignalNotifications,
  stopLiveSignalNotifications,
  type NotificationSetupState,
} from './lib/notifications'

const snapshot = ref<DashboardSnapshot | null>(null)
const selectedSignal = ref<DashboardSnapshot['selectedSignal'] | null>(null)
const selectedMarketSymbol = ref<string>('')
const fallbackSessionOverview: DashboardSnapshot['sessionOverview'] = {
  sessionId: 'local-session',
  status: 'live',
  updatedAt: new Date().toISOString(),
  configVersion: 'v18',
  openWindows: 0,
  rejectedEntries: 0,
  summary: 'Firebase-hosted shell is running with sample data until a live session is available.',
}
const loading = ref(true)
const authState = ref<'booting' | 'authenticating' | 'authenticated' | 'offline'>('booting')
const snapshotSource = ref<DashboardSource>('sample')
const snapshotWarning = ref<string | null>(null)
const firestoreAvailable = ref(true)
const notificationState = ref<NotificationSetupState>('unsupported')
const notificationMessage = ref<string | null>(null)
let notificationSetupGeneration = 0
let isMounted = true
let dashboardRefreshTimer: number | null = null
const triageFilter = ref<'all' | 'entry' | 'exit' | 'hold'>('all')
const triageFilters = ['all', 'entry', 'exit', 'hold'] as const
const selectedConfigVersionId = ref<string>('current')
const configDraft = reactive<Record<string, number>>({})
const sessionOverview = computed(() => snapshot.value?.sessionOverview ?? fallbackSessionOverview)
const marketSnapshots = computed(() => snapshot.value?.marketSnapshots ?? [])
const marketSymbols = computed(() => {
  const symbols = new Set<string>()
  for (const snapshotRecord of marketSnapshots.value) {
    if (snapshotRecord.symbol) {
      symbols.add(snapshotRecord.symbol)
    }
  }
  return Array.from(symbols).sort()
})
const selectedMarketSnapshots = computed(() => {
  if (!selectedMarketSymbol.value) {
    return marketSnapshots.value
  }
  return marketSnapshots.value.filter((record) => record.symbol === selectedMarketSymbol.value)
})
const latestMarketSnapshots = computed(() => selectedMarketSnapshots.value.slice(-6).reverse())
const marketChartViews = computed(() =>
  marketCharts.map((chart) => ({
    chart,
    view: buildChartView(selectedMarketSnapshots.value, chart),
  })),
)

const sourceDisplay = computed(() => {
  if (snapshotSource.value === 'firestore') {
    return {
      title: 'Authenticated read model',
      description: 'Firestore access is gated by Firebase Auth and the dashboard is reading live operational data.',
    }
  }

  return {
    title: 'Sample fallback',
    description: 'Firestore was unavailable, so the dashboard is showing sample data instead of live operational data.',
  }
})

function signalKey(signal: DashboardSnapshot['selectedSignal']) {
  return `${signal.symbol}:${signal.updatedAt}`
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
  return selectedConfigVersion.value?.fields ?? snapshot.value?.configFields ?? []
})

const editableConfigFields = computed(() => selectedConfigFields.value)

function syncConfigDraft(fields: DashboardSnapshot['configFields']) {
  for (const key of Object.keys(configDraft)) {
    delete configDraft[key]
  }
  for (const field of fields) {
    configDraft[field.key] = field.value
  }
}

function sameDraft(fields: DashboardSnapshot['configFields']) {
  if (fields.length !== Object.keys(configDraft).length) {
    return false
  }
  return fields.every((field) => configDraft[field.key] === field.value)
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
      const closeValue = readSeriesValue(record, 'close')
      if (closeValue === null) {
        return null
      }
      const point = toPoint(closeValue, index)
      return {
        ...point,
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

function selectConfigVersion(version: ConfigVersionRecord | null) {
  if (!version) {
    selectedConfigVersionId.value = 'current'
    return
  }

  selectedConfigVersionId.value = version.id
}

const triageSignals = computed(() => {
  const signals = snapshot.value?.signals ?? []
  if (triageFilter.value === 'all') {
    return signals
  }
  return signals.filter((signal) => classifySignal(signal) === triageFilter.value)
})

const triageCounts = computed(() => {
  const signals = snapshot.value?.signals ?? []
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
      return
    }

    const activeSignal = selectedSignal.value
    if (!activeSignal || !signals.some((signal) => signalKey(signal) === signalKey(activeSignal))) {
      selectedSignal.value = signals[0]
    }
  },
  { immediate: true },
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

watch(
  marketSymbols,
  (symbols) => {
    if (symbols.length === 0) {
      return
    }
    if (!selectedMarketSymbol.value || !symbols.includes(selectedMarketSymbol.value)) {
      selectedMarketSymbol.value = symbols.includes(selectedSignal.value?.symbol ?? '')
        ? (selectedSignal.value?.symbol ?? symbols[0])
        : symbols[0]
    }
  },
  { immediate: true },
)

watch(
  selectedSignal,
  (signal) => {
    if (!selectedMarketSymbol.value && signal && marketSymbols.value.includes(signal.symbol)) {
      selectedMarketSymbol.value = signal.symbol
    }
  },
  { immediate: true },
)

function setTriageFilter(filter: (typeof triageFilters)[number]) {
  triageFilter.value = filter
}

function handleConfigVersionClick(version: ConfigVersionRecord) {
  if (isConfigDraftDirty.value && selectedConfigVersion.value?.id !== version.id) {
    return
  }
  selectConfigVersion(version)
}

async function refreshDashboard() {
  if (!firestoreAvailable.value) {
    return
  }
  const result = await loadDashboardSnapshot({ allowFirestore: true })
  snapshot.value = result.snapshot
  selectedSignal.value = result.snapshot.selectedSignal
  snapshotSource.value = result.source
  snapshotWarning.value = result.warning
  selectConfigVersion(result.snapshot.configVersions.find((version) => version.version === result.snapshot.sessionOverview.configVersion) ?? result.snapshot.configVersions[0] ?? null)
}

async function refreshOnRelevantSignal(payload: MessagePayload) {
  const type = payload.data?.type?.trim().toLowerCase()
  if (type === 'decision.accepted' || type === 'decision.exited') {
    await refreshDashboard()
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
  if (!snapshot.value || snapshotSource.value !== 'firestore') {
    return
  }

  try {
    const fields = editableConfigFields.value.map((field) => ({
      ...field,
      value: Number.isFinite(configDraft[field.key]) ? configDraft[field.key] : field.value,
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
  if (!snapshot.value || snapshotSource.value !== 'firestore') {
    return
  }

  try {
    await applyConfigVersion(
      sessionOverview.value.sessionId,
      currentConfigVersion.value,
      version.version,
    )
    await refreshDashboard()
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
  const result = await loadDashboardSnapshot({ allowFirestore })
  snapshot.value = result.snapshot
  selectedSignal.value = result.snapshot.selectedSignal
  snapshotSource.value = result.source
  snapshotWarning.value = result.warning
  selectConfigVersion(result.snapshot.configVersions.find((version) => version.version === result.snapshot.sessionOverview.configVersion) ?? result.snapshot.configVersions[0] ?? null)
  void initializeNotifications(false)
  if (dashboardRefreshTimer !== null) {
    window.clearInterval(dashboardRefreshTimer)
  }
  dashboardRefreshTimer = window.setInterval(() => {
    void refreshDashboard()
  }, 30_000)
  loading.value = false
})

onUnmounted(() => {
  isMounted = false
  if (dashboardRefreshTimer !== null) {
    window.clearInterval(dashboardRefreshTimer)
    dashboardRefreshTimer = null
  }
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
            <h2>Session overview</h2>
            <span>{{ sessionOverview.configVersion }}</span>
          </div>
          <div class="overview-copy">
            <div>
              <span>Session ID</span>
              <strong>{{ sessionOverview.sessionId }}</strong>
            </div>
            <div>
              <span>Updated</span>
              <strong>{{ sessionOverview.updatedAt }}</strong>
            </div>
            <div>
              <span>Open windows</span>
              <strong>{{ sessionOverview.openWindows }}</strong>
            </div>
            <div>
              <span>Rejected entries</span>
              <strong>{{ sessionOverview.rejectedEntries }}</strong>
            </div>
          </div>
        </article>

        <article class="panel shell-placeholder" data-slot="chart">
          <div class="panel-header">
            <h2>Live market charts</h2>
            <span>{{ selectedMarketSymbol || 'No symbol selected' }}</span>
          </div>
          <p>
            Close price and indicators update in real time for the selected symbol. Entry and exit points are marked on the time axis.
          </p>
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
          <div v-if="marketChartViews.length" class="chart-grid">
            <article v-for="item in marketChartViews" :key="item.chart.id" class="chart-card">
              <div class="chart-card-header">
                <div>
                  <strong>{{ item.chart.title }}</strong>
                  <p>{{ item.chart.subtitle }}</p>
                </div>
                <span>{{ item.view.latestTimestamp ?? 'waiting for live data' }}</span>
              </div>
              <div class="chart-legend">
                <span v-for="line in item.view.lines" :key="line.label">
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
                <g v-for="marker in item.view.markers" :key="`${item.chart.id}-${marker.kind}-${marker.x}-${marker.y}`">
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
            </article>
          </div>
        </article>

        <article class="panel shell-placeholder" data-slot="table">
          <div class="panel-header">
            <h2>Live snapshot ledger</h2>
            <span>{{ selectedMarketSnapshots.length }} points</span>
          </div>
          <p>
            This ledger highlights the latest marker state for the selected symbol. It refreshes alongside the charts so the graph and the decision trail stay aligned.
          </p>
          <div class="signal-list compact">
            <div v-for="snapshotPoint in latestMarketSnapshots" :key="snapshotPoint.id" class="signal-row ledger-row">
              <div>
                <strong>{{ snapshotPoint.timestamp }}</strong>
                <p>{{ snapshotPoint.signalAction }} · {{ snapshotPoint.signalState }} · {{ snapshotPoint.signalRegime }}</p>
              </div>
              <div class="scores">
                <span>{{ snapshotPoint.entryScore.toFixed(2) }}</span>
                <span>{{ snapshotPoint.exitScore.toFixed(2) }}</span>
              </div>
            </div>
          </div>
        </article>
      </section>

      <section class="grid">
        <article class="panel">
          <div class="panel-header">
            <h2>Triage view</h2>
            <span>Firestore read model</span>
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
              <span>{{ filter }}</span>
              <strong>{{ triageCounts[filter] }}</strong>
            </button>
          </div>
          <div class="signal-list">
            <button
              v-for="signal in triageSignals"
              :key="signalKey(signal)"
              class="signal-row"
              :class="classifySignal(signal)"
              @click="selectedSignal = signal"
            >
              <div>
                <strong>{{ signal.symbol }}</strong>
                <p>{{ signal.regime }}</p>
              </div>
              <div class="scores">
                <span>{{ signal.entryScore.toFixed(2) }}</span>
                <span>{{ signal.exitScore.toFixed(2) }}</span>
              </div>
            </button>
          </div>
        </article>

        <article class="panel">
          <div class="panel-header">
            <h2>Selected signal</h2>
            <span>{{ selectedSignal?.symbol ?? 'No signal selected' }}</span>
          </div>
          <div class="detail-card" v-if="selectedSignal">
            <div class="detail-title">
              <strong>{{ selectedSignal.state }}</strong>
              <span>Updated {{ selectedSignal.updatedAt }}</span>
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
            <ul class="reason-list">
              <li v-for="reason in selectedSignal.reasons" :key="reason">{{ reason }}</li>
            </ul>
          </div>
        </article>
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
          <button type="button" class="action-button" :disabled="snapshotSource !== 'firestore'" @click="saveConfigVersion">
            Save candidate
          </button>
        </div>
        <p v-if="isConfigDraftDirty" class="status-warning config-dirty-warning">
          Unsaved draft changes are active. Save before switching versions.
        </p>
        <div class="config-grid">
          <article v-for="field in editableConfigFields" :key="field.key" class="config-card">
            <label :for="field.key">{{ field.key }}</label>
            <input :id="field.key" v-model.number="configDraft[field.key]" type="number" step="0.01" />
            <p>{{ field.description }}</p>
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
              <span>{{ version.updatedAt }}</span>
              <button
                v-if="version.status !== 'active'"
                type="button"
                class="action-button ghost"
                :disabled="snapshotSource !== 'firestore'"
                @click.stop="applySelectedVersion(version)"
              >
                {{ version.status === 'candidate' ? 'Promote' : version.status === 'archived' ? 'Rollback' : 'Apply' }}
              </button>
            </div>
          </article>
        </div>
      </section>
    </template>
  </main>
</template>
