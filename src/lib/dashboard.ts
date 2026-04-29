import { get, ref, runTransaction, set, update } from 'firebase/database'
import { rtdb } from './firebase'
import {
  CONFIG_VERSIONS_COLLECTION,
  MARKET_SESSIONS_COLLECTION,
  MARKET_SNAPSHOTS_COLLECTION,
  SIGNAL_EVENTS_COLLECTION,
  WINDOW_OPTIMIZATIONS_COLLECTION,
  TRADE_WINDOWS_COLLECTION,
} from './schema'
import {
  configFields,
  classifySignal,
  type AdminSignal,
  type ConfigField,
  type ConfigFieldValue,
  type WindowOptimizationSnapshot,
  type WindowOptimizationRecord,
} from './engine'
import { currentMarketDayKey, marketDayBounds, marketDayKeyForTimestamp } from './market-day'

export type DashboardSource = 'live' | 'empty'

export type ConfigVersionRecord = {
  id: string
  version: string
  status: string
  updatedAt: string
  summary: string
  fields: ConfigField[]
}

export type DashboardSnapshot = {
  metrics: Array<{ label: string; value: string }>
  sessionOverview: {
    sessionId: string
    status: string
    updatedAt: string
    configVersion: string
    openWindows: number
    summary: string
  }
  selectedSignal: AdminSignal | null
  signals: AdminSignal[]
  windows: TradeWindowRecord[]
  marketSnapshots: MarketSnapshotRecord[]
  windowOptimizations: WindowOptimizationRecord[]
  configFields: ConfigField[]
  configVersions: ConfigVersionRecord[]
}

export type TradeWindowRecord = {
  id: string
  sessionId: string
  symbol: string
  status: string
  openedAt: string
  closedAt: string | null
  entryDecisionId: string
  exitDecisionId: string
  entryScore: number
  exitScore: number
  updatedAt: string
}

export type MarketSnapshotRecord = {
  id: string
  sessionId: string
  windowId: string
  symbol: string
  timeframe: string
  timestamp: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  smaFast: number | null
  smaSlow: number | null
  emaFast: number | null
  emaSlow: number | null
  vwap: number | null
  rsi: number | null
  atr: number | null
  plusDi: number | null
  minusDi: number | null
  adx: number | null
  macd: number | null
  macdSignal: number | null
  macdHistogram: number | null
  stochasticK: number | null
  stochasticD: number | null
  bollingerMiddle: number | null
  bollingerUpper: number | null
  bollingerLower: number | null
  obv: number | null
  relativeVolume: number | null
  volumeProfile: number | null
  entryScore: number
  exitScore: number
  eventType: string
  signalAction: string
  signalTier?: string | null
  signalState: string
  signalRegime: string
  benchmarkSymbol: string
  reasons: string[]
}

export type DashboardSnapshotResult = {
  snapshot: DashboardSnapshot
  source: DashboardSource
  warning: string | null
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function normalizeTimeframeLabel(value: unknown): string {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) {
    return '1m'
  }
  const plainNumberMatch = /^(\d+)$/.exec(raw)
  if (plainNumberMatch) {
    return `${plainNumberMatch[1]}m`
  }
  const match = /^(\d+)\s*(m|min|minutes?)$/.exec(raw)
  if (match) {
    return `${match[1]}m`
  }
  const hourMatch = /^(\d+)\s*(h|hr|hour|hours?)$/.exec(raw)
  if (hourMatch) {
    return `${Number(hourMatch[1]) * 60}m`
  }
  return raw
}

type RealtimeCollectionDoc<T = Record<string, unknown>> = {
  id: string
  data: () => T
}

async function loadRealtimeCollection<T extends Record<string, unknown>>(
  collectionPath: string,
): Promise<Array<RealtimeCollectionDoc<T>>> {
  const snapshot = await get(ref(rtdb, collectionPath))
  const value = snapshot.val()
  if (!value || typeof value !== 'object') {
    return []
  }
  return Object.entries(value as Record<string, T>).map(([id, item]) => ({
    id,
    data: () => item,
  }))
}

function formatRealtimeTimestamp(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) {
    return value
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString()
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString()
  }
  return fallback
}

function cloneConfigFields(fields: ConfigField[]): ConfigField[] {
  return fields.map((field) => ({
    ...field,
    value: Array.isArray(field.value) ? [...field.value] : field.value,
    options: field.options ? [...field.options] : undefined,
  }))
}

function configNumberValue(fields: ConfigField[] | undefined, key: string, fallback: number) {
  if (!fields || fields.length === 0) {
    return fallback
  }
  const match = fields.find((field) => field.key === key)
  if (!match || typeof match.value !== 'number' || !Number.isFinite(match.value)) {
    return fallback
  }
  return match.value
}

function isConfigFieldValue(value: unknown): value is ConfigFieldValue {
  return typeof value === 'number' || typeof value === 'string' || Array.isArray(value)
}

function buildEmptySnapshot(): DashboardSnapshot {
  return {
    metrics: [
      { label: 'Buy signals today', value: '0' },
      { label: 'Sell signals today', value: '0' },
      { label: 'Open windows', value: '0' },
      { label: 'Closed windows today', value: '0' },
    ],
    sessionOverview: {
      sessionId: 'nasdaq-live',
      status: 'waiting',
      updatedAt: new Date().toISOString(),
      configVersion: 'draft',
      openWindows: 0,
      summary: 'No live records are available yet.',
    },
    selectedSignal: null,
    signals: [],
    windows: [],
    marketSnapshots: [],
    windowOptimizations: [],
    configFields: cloneConfigFields(configFields),
    configVersions: [],
  }
}

function normalizeConfigFields(value: unknown, fallback: ConfigField[]): ConfigField[] {
  if (!Array.isArray(value)) {
    return cloneConfigFields(fallback)
  }

  const fallbackByKey = new Map(fallback.map((field) => [field.key, field]))
  const fields = value
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null
      }
      const raw = item as Record<string, unknown>
      const key = String(raw.key ?? '').trim()
      if (!key) {
        return null
      }
      const fallbackField = fallbackByKey.get(key)
      const normalizedValue = normalizeConfigFieldValue(raw.value, fallbackField?.value)
      if (normalizedValue === null) {
        return null
      }
      const rawOptions = Array.isArray((raw as Record<string, unknown>).options)
        ? ((raw as Record<string, unknown>).options as unknown[])
        : null
      return {
        key,
        label: String(raw.label ?? fallbackField?.label ?? key),
        value: normalizedValue,
        description: String(raw.description ?? fallbackField?.description ?? ''),
        group: String(raw.group ?? fallbackField?.group ?? 'Legacy config'),
        inputType: (String(raw.inputType ?? fallbackField?.inputType ?? (Array.isArray(normalizedValue) ? 'symbols' : typeof normalizedValue === 'number' ? 'number' : 'text')) as ConfigField['inputType']),
        ...(fallbackField?.step !== undefined ? { step: fallbackField.step } : {}),
        ...(fallbackField?.placeholder !== undefined ? { placeholder: fallbackField.placeholder } : {}),
        ...(rawOptions !== null
          ? { options: rawOptions.map((item: unknown) => String(item).trim().toUpperCase()).filter(Boolean) }
          : fallbackField?.options !== undefined
            ? { options: [...fallbackField.options] }
            : {}),
      }
    })
    .filter((field): field is ConfigField => field !== null)

  return fields
}

function normalizeConfigFieldValue(rawValue: unknown, fallbackValue: ConfigFieldValue | undefined): ConfigFieldValue | null {
  if (Array.isArray(fallbackValue)) {
    if (Array.isArray(rawValue)) {
      return rawValue.map((item) => String(item).trim().toUpperCase()).filter(Boolean)
    }
    if (typeof rawValue === 'string') {
      return rawValue
        .split(/[\n,]/)
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean)
    }
    return [...fallbackValue]
  }

  if (typeof fallbackValue === 'number') {
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      return rawValue
    }
    if (typeof rawValue === 'string' && rawValue.trim() && Number.isFinite(Number(rawValue))) {
      return Number(rawValue)
    }
    return fallbackValue
  }

  if (typeof fallbackValue === 'string') {
    if (typeof rawValue === 'string') {
      return rawValue.trim() || fallbackValue
    }
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      return String(rawValue)
    }
    if (rawValue === null || rawValue === undefined) {
      return fallbackValue
    }
    return String(rawValue)
  }

  if (isConfigFieldValue(rawValue)) {
    return Array.isArray(rawValue) ? rawValue.map((item) => String(item).trim()).filter(Boolean) : rawValue
  }

  return null
}

function nextVersionLabel(baseVersion: string, existingVersions: Iterable<string>) {
  const base = baseVersion.trim()
  const used = new Set(Array.from(existingVersions, (value) => value.trim()))
  const match = /^v(\d+)$/.exec(base)
  if (match) {
    let next = Number(match[1]) + 1
    while (used.has(`v${next}`)) {
      next += 1
    }
    return `v${next}`
  }

  let suffix = 1
  let candidate = `${base}-1`
  while (used.has(candidate)) {
    suffix += 1
    candidate = `${base}-${suffix}`
  }
  return candidate
}

export async function saveConfigCandidate(sessionId: string, baseVersion: string, fields: ConfigField[], summary: string) {
  const now = new Date().toISOString()
  const versionDocs = await loadRealtimeCollection<Record<string, unknown>>(`${CONFIG_VERSIONS_COLLECTION}/${sessionId}`)
  const existingVersions = versionDocs
    .flatMap((docSnap) => [docSnap.id, String(docSnap.data().version ?? '')])
  const versionPrefix = nextVersionLabel(baseVersion, existingVersions)
  const sessionRef = ref(rtdb, `${MARKET_SESSIONS_COLLECTION}/${sessionId}`)
  let nextSequence = 0
  await runTransaction(sessionRef, (sessionState) => {
    const currentSession = (sessionState as Record<string, unknown> | null) ?? {}
    const currentSequence = Number(currentSession.config_candidate_sequence ?? 0)
    nextSequence = currentSequence + 1
    return {
      ...currentSession,
      config_candidate_sequence: nextSequence,
      updated_at: now,
    }
  })
  const version = `${versionPrefix}-${nextSequence}`
  const id = `${sessionId}:${version}`
  const payload = {
    version,
    status: 'candidate',
    summary,
    fields,
    base_version: baseVersion,
    session_id: sessionId,
    created_at: now,
    updated_at: now,
  }
  await set(ref(rtdb, `${CONFIG_VERSIONS_COLLECTION}/${sessionId}/${id}`), payload)
  return {
    id,
    version,
    status: 'candidate',
    updatedAt: now,
    summary,
    fields,
  } satisfies ConfigVersionRecord
}

export async function applyConfigVersion(sessionId: string, currentVersion: string, targetVersion: string) {
  const now = new Date().toISOString()
  const updates: Record<string, unknown> = {
    [`${CONFIG_VERSIONS_COLLECTION}/${sessionId}/${sessionId}:${targetVersion}/status`]: 'active',
    [`${CONFIG_VERSIONS_COLLECTION}/${sessionId}/${sessionId}:${targetVersion}/updated_at`]: now,
    [`${MARKET_SESSIONS_COLLECTION}/${sessionId}/config_version`]: targetVersion,
    [`${MARKET_SESSIONS_COLLECTION}/${sessionId}/updated_at`]: now,
  }
  if (currentVersion && currentVersion !== targetVersion) {
    updates[`${CONFIG_VERSIONS_COLLECTION}/${sessionId}/${sessionId}:${currentVersion}/status`] = 'archived'
    updates[`${CONFIG_VERSIONS_COLLECTION}/${sessionId}/${sessionId}:${currentVersion}/updated_at`] = now
  }
  await update(ref(rtdb), updates)
}

export async function saveWindowOptimization(
  sessionId: string,
  review: TradeWindowRecord,
  entrySnapshot: MarketSnapshotRecord,
  exitSnapshot: MarketSnapshotRecord,
  notes: string,
  currentConfigFields: ConfigField[],
  currentOptimizations: WindowOptimizationRecord[],
  now = new Date().toISOString(),
): Promise<WindowOptimizationRecord> {
  const id = `${sessionId}:${review.id}:${entrySnapshot.id}:${exitSnapshot.id}`
  const changePct = calculateWindowChangePct(entrySnapshot, exitSnapshot)
  const optimizerLearningRate = configNumberValue(currentConfigFields, 'optimizer_learning_rate', 0.12)
  const optimizerBiasCap = configNumberValue(currentConfigFields, 'optimizer_bias_cap', 0.08)
  const normalizedRecord: WindowOptimizationRecord = {
    id,
    sessionId,
    windowId: review.id,
    symbol: review.symbol,
    day: marketDayKeyForTimestamp(review.openedAt) || currentMarketDayKey(),
    entrySnapshot: snapshotToOptimizationPayload(entrySnapshot),
    exitSnapshot: snapshotToOptimizationPayload(exitSnapshot),
    entryScore: entrySnapshot.entryScore,
    exitScore: exitSnapshot.exitScore,
    changePct,
    notes: notes.trim(),
    requestedBy: 'admin',
    createdAt: now,
    updatedAt: now,
  }
  const payload = {
    id,
    session_id: sessionId,
    window_id: review.id,
    symbol: review.symbol,
    day: normalizedRecord.day,
    entry_snapshot: snapshotToOptimizationPayload(entrySnapshot),
    exit_snapshot: snapshotToOptimizationPayload(exitSnapshot),
    entry_score: entrySnapshot.entryScore,
    exit_score: exitSnapshot.exitScore,
    change_pct: changePct,
    notes: notes.trim(),
    requested_by: 'admin',
    created_at: now,
    updated_at: now,
  }
  const summary = summarizeWindowOptimizations(
    sessionId,
    [...currentOptimizations.filter((item) => item.id !== id), normalizedRecord],
    optimizerLearningRate,
    optimizerBiasCap,
    now,
  )
  await update(ref(rtdb), {
    [`${WINDOW_OPTIMIZATIONS_COLLECTION}/${sessionId}/${id}`]: payload,
    [`${MARKET_SESSIONS_COLLECTION}/${sessionId}/optimization_summary`]: summary,
    [`${MARKET_SESSIONS_COLLECTION}/${sessionId}/updated_at`]: now,
  })
  return normalizedRecord
}

function summarizeWindowOptimizations(
  sessionId: string,
  optimizations: WindowOptimizationRecord[],
  optimizerLearningRate: number,
  optimizerBiasCap: number,
  updatedAt: string,
) {
  const entryTotals = new Map<string, number>()
  const entryCounts = new Map<string, number>()
  const exitTotals = new Map<string, number>()
  const exitCounts = new Map<string, number>()
  const symbols = new Set<string>()
  let totalChangePct = 0
  let totalEntryScore = 0
  let totalExitScore = 0
  for (const optimization of optimizations) {
    totalChangePct += optimization.changePct
    totalEntryScore += optimization.entryScore
    totalExitScore += optimization.exitScore
    if (optimization.symbol) {
      symbols.add(optimization.symbol)
    }
    accumulateOptimizationProfile(entryTotals, entryCounts, optimization.entrySnapshot)
    accumulateOptimizationProfile(exitTotals, exitCounts, optimization.exitSnapshot)
  }

  const sampleCount = optimizations.length
  return {
    session_id: sessionId,
    sample_count: sampleCount,
    average_change_pct: sampleCount > 0 ? totalChangePct / sampleCount : 0,
    average_entry_score: sampleCount > 0 ? totalEntryScore / sampleCount : 0,
    average_exit_score: sampleCount > 0 ? totalExitScore / sampleCount : 0,
    symbols: Array.from(symbols).sort(),
    entry_profile: finalizeOptimizationProfile(entryTotals, entryCounts),
    exit_profile: finalizeOptimizationProfile(exitTotals, exitCounts),
    optimizer_learning_rate: optimizerLearningRate,
    optimizer_bias_cap: optimizerBiasCap,
    updated_at: updatedAt,
  }
}

function accumulateOptimizationProfile(
  totals: Map<string, number>,
  counts: Map<string, number>,
  snapshot: WindowOptimizationSnapshot,
) {
  const profile = {
    close: snapshot.close,
    sma_fast: snapshot.sma_fast,
    sma_slow: snapshot.sma_slow,
    ema_fast: snapshot.ema_fast,
    ema_slow: snapshot.ema_slow,
    vwap: snapshot.vwap,
    rsi: snapshot.rsi,
    atr: snapshot.atr,
    plus_di: snapshot.plus_di,
    minus_di: snapshot.minus_di,
    adx: snapshot.adx,
    macd: snapshot.macd,
    macd_signal: snapshot.macd_signal,
    macd_histogram: snapshot.macd_histogram,
    stochastic_k: snapshot.stochastic_k,
    stochastic_d: snapshot.stochastic_d,
    bollinger_middle: snapshot.bollinger_middle,
    bollinger_upper: snapshot.bollinger_upper,
    bollinger_lower: snapshot.bollinger_lower,
    obv: snapshot.obv,
    relative_volume: snapshot.relative_volume,
    volume_profile: snapshot.volume_profile,
    entry_score: snapshot.entry_score,
    exit_score: snapshot.exit_score,
  } satisfies Record<string, number | null>
  for (const [key, value] of Object.entries(profile)) {
    if (value === null || value === undefined || Number.isNaN(value) || !Number.isFinite(value)) {
      continue
    }
    totals.set(key, (totals.get(key) ?? 0) + value)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
}

function finalizeOptimizationProfile(totals: Map<string, number>, counts: Map<string, number>) {
  const profile: Record<string, number> = {}
  for (const [key, total] of totals.entries()) {
    const count = counts.get(key) ?? 0
    if (count > 0) {
      profile[key] = total / count
    }
  }
  return profile
}

export async function loadDashboardSnapshot(options: { allowLiveData?: boolean; marketDayKey?: string } = {}): Promise<DashboardSnapshotResult> {
  if (options.allowLiveData === false) {
    return {
      source: 'empty',
      warning: 'Live data is unavailable, so the dashboard is showing an empty live state.',
      snapshot: buildEmptySnapshot(),
    }
  }

  try {
    const sessionDocs = await loadRealtimeCollection<Record<string, unknown>>(MARKET_SESSIONS_COLLECTION)

    const latestSessionDoc = selectLatestRealtimeDoc(sessionDocs, ['updated_at', 'updatedAt'])
    const latestSession = latestSessionDoc?.data() as Record<string, unknown> | undefined
    const latestSessionId = String(
      latestSessionDoc?.id ??
        latestSession?.session_id ??
        'nasdaq-live',
    )
    const marketDayKey = options.marketDayKey ?? new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
    const signalDocs = await loadRealtimeCollection<Record<string, unknown>>(`${SIGNAL_EVENTS_COLLECTION}/${latestSessionId}`)
    const versionDocs = await loadRealtimeCollection<Record<string, unknown>>(`${CONFIG_VERSIONS_COLLECTION}/${latestSessionId}`)
    const windowDocs = await loadRealtimeCollection<Record<string, unknown>>(`${TRADE_WINDOWS_COLLECTION}/${latestSessionId}`)
    const optimizationDocs = await loadRealtimeCollection<Record<string, unknown>>(`${WINDOW_OPTIMIZATIONS_COLLECTION}/${latestSessionId}`)
    const selectedDaySignalDocs = signalDocs.filter((doc) => {
      const data = doc.data() as Record<string, unknown>
      const timestamp =
        data.timestamp ??
        data.updatedAt ??
        data.updated_at ??
        data.created_at ??
        data.createdAt
      return marketDayKeyForTimestamp(timestamp) === marketDayKey
    })
    const latestSignalDoc = selectLatestRealtimeDoc(selectedDaySignalDocs, ['timestamp', 'updated_at', 'updatedAt'])
    const latestSignal = latestSignalDoc?.data() as Record<string, unknown> | undefined
    const latestVersionDoc = selectLatestRealtimeDoc(versionDocs, ['updatedAt', 'updated_at', 'created_at'])
    const latestVersion = latestVersionDoc?.data() as Record<string, unknown> | undefined

    const sessionWindows = windowDocs.filter((doc) => {
      const data = doc.data()
      const sessionId = String(data.session_id ?? data.sessionId ?? latestSessionId)
      return sessionId === latestSessionId
    })
    const windows = [...sessionWindows]
      .sort((left, right) => compareRealtimeDoc(left, right, ['updated_at', 'updatedAt', 'opened_at', 'openedAt', 'closed_at', 'closedAt']))
      .map((doc) => {
        const data = doc.data() as Record<string, unknown>
        return {
          id: doc.id,
          sessionId: String(data.session_id ?? data.sessionId ?? latestSessionId),
          windowId: String(data.window_id ?? data.windowId ?? ''),
          symbol: String(data.symbol ?? doc.id),
          status: String(data.status ?? 'open'),
          openedAt: formatRealtimeTimestamp(data.opened_at ?? data.openedAt ?? data.created_at ?? data.timestamp, new Date().toISOString()),
          closedAt: formatNullableRealtimeTimestamp(data.closed_at ?? data.closedAt),
          entryDecisionId: String(data.entry_decision_id ?? data.entryDecisionId ?? ''),
          exitDecisionId: String(data.exit_decision_id ?? data.exitDecisionId ?? ''),
          entryScore: Number(data.entry_score ?? data.entryScore ?? 0),
          exitScore: Number(data.exit_score ?? data.exitScore ?? 0),
          updatedAt: formatRealtimeTimestamp(data.updated_at ?? data.updatedAt ?? data.opened_at ?? data.openedAt, new Date().toISOString()),
        }
      })

    const selectedDaySignals = selectedDaySignalDocs
      .sort((left, right) => compareRealtimeDoc(right, left, ['timestamp', 'updated_at', 'updatedAt']))
      .map((doc) => {
        const data = doc.data()
        const rawSignalTier = data.signal_tier ?? data.signalTier
        return {
          symbol: String(data.symbol ?? doc.id),
          windowId: String(data.window_id ?? data.windowId ?? ''),
          signalAction: String(data.signal_action ?? data.signalAction ?? data.action ?? ''),
          signalTier: rawSignalTier == null || rawSignalTier === 'null' ? null : String(rawSignalTier),
          state: (data.state as AdminSignal['state']) ?? 'ENTRY_SIGNALLED',
          entryScore: Number(data.entryScore ?? data.entry_score ?? 0),
          exitScore: Number(data.exitScore ?? data.exit_score ?? 0),
          regime: String(data.regime ?? 'Live market session'),
          updatedAt: formatRealtimeTimestamp(data.updatedAt ?? data.timestamp, new Date().toISOString()),
          reasons: Array.isArray(data.reasons) ? data.reasons.map(String) : [],
        } satisfies AdminSignal
      })
    const decisionSignals = selectedDaySignals.filter((signal) => classifySignal(signal) !== 'hold')

    const marketSnapshots = (await loadRealtimeCollection<Record<string, unknown>>(
      `${MARKET_SNAPSHOTS_COLLECTION}/${latestSessionId}/${marketDayKey}`,
    ))
      .map((doc) => {
        const data = doc.data()
        const rawSignalTier = data.signal_tier ?? data.signalTier
        return {
          id: doc.id,
          sessionId: String(data.session_id ?? data.sessionId ?? latestSessionId),
          windowId: String(data.window_id ?? data.windowId ?? ''),
          symbol: String(data.symbol ?? doc.id),
          timeframe: normalizeTimeframeLabel(data.timeframe ?? data.interval ?? '1m'),
          timestamp: formatRealtimeTimestamp(data.timestamp ?? data.created_at ?? data.updated_at, new Date().toISOString()),
          open: Number(data.open ?? 0),
          high: Number(data.high ?? 0),
          low: Number(data.low ?? 0),
          close: Number(data.close ?? 0),
          volume: Number(data.volume ?? 0),
          smaFast: toNullableNumber(data.sma_fast),
          smaSlow: toNullableNumber(data.sma_slow),
          emaFast: toNullableNumber(data.ema_fast),
          emaSlow: toNullableNumber(data.ema_slow),
          vwap: toNullableNumber(data.vwap),
          rsi: toNullableNumber(data.rsi),
          atr: toNullableNumber(data.atr),
          plusDi: toNullableNumber(data.plus_di),
          minusDi: toNullableNumber(data.minus_di),
          adx: toNullableNumber(data.adx),
          macd: toNullableNumber(data.macd),
          macdSignal: toNullableNumber(data.macd_signal),
          macdHistogram: toNullableNumber(data.macd_histogram),
          stochasticK: toNullableNumber(data.stochastic_k),
          stochasticD: toNullableNumber(data.stochastic_d),
          bollingerMiddle: toNullableNumber(data.bollinger_middle ?? data.bollinger_mid),
          bollingerUpper: toNullableNumber(data.bollinger_upper),
          bollingerLower: toNullableNumber(data.bollinger_lower),
          obv: toNullableNumber(data.obv),
          relativeVolume: toNullableNumber(data.relative_volume ?? data.relativeVolume),
          volumeProfile: toNullableNumber(data.volume_profile ?? data.volumeProfile),
          entryScore: Number(data.entry_score ?? 0),
          exitScore: Number(data.exit_score ?? 0),
          eventType: String(data.event_type ?? ''),
          signalAction: String(data.signal_action ?? data.action ?? 'HOLD'),
          signalTier: rawSignalTier == null || rawSignalTier === 'null' ? null : String(rawSignalTier),
          signalState: String(data.signal_state ?? data.state ?? 'FLAT'),
          signalRegime: String(data.signal_regime ?? data.regime ?? 'Live market session'),
          benchmarkSymbol: String(data.benchmark_symbol ?? ''),
          reasons: Array.isArray(data.reasons) ? data.reasons.map(String) : [],
        }
      })
      .sort((left, right) => {
        const leftTimestamp = Date.parse(left.timestamp)
        const rightTimestamp = Date.parse(right.timestamp)
        if (leftTimestamp !== rightTimestamp) {
          return leftTimestamp - rightTimestamp
        }
        if (left.symbol !== right.symbol) {
          return left.symbol.localeCompare(right.symbol)
        }
        return left.id.localeCompare(right.id)
      })
    const windowOptimizations = optimizationDocs
      .sort((left, right) => compareRealtimeDoc(left, right, ['updated_at', 'updatedAt', 'created_at', 'createdAt']))
      .map((doc) => {
        const data = doc.data()
        return {
          id: doc.id,
          sessionId: String(data.session_id ?? data.sessionId ?? latestSessionId),
          windowId: String(data.window_id ?? data.windowId ?? ''),
          symbol: String(data.symbol ?? doc.id),
          day: String(data.day ?? (marketDayKeyForTimestamp(data.created_at ?? data.createdAt) || marketDayKey)),
          entrySnapshot: toWindowOptimizationSnapshot(data.entry_snapshot ?? data.entrySnapshot),
          exitSnapshot: toWindowOptimizationSnapshot(data.exit_snapshot ?? data.exitSnapshot),
          entryScore: Number(data.entry_score ?? data.entryScore ?? 0),
          exitScore: Number(data.exit_score ?? data.exitScore ?? 0),
          changePct: Number(data.change_pct ?? data.changePct ?? 0),
          notes: String(data.notes ?? ''),
          requestedBy: String(data.requested_by ?? data.requestedBy ?? ''),
          createdAt: formatRealtimeTimestamp(data.created_at ?? data.createdAt, new Date().toISOString()),
          updatedAt: formatRealtimeTimestamp(data.updated_at ?? data.updatedAt ?? data.created_at ?? data.createdAt, new Date().toISOString()),
        } satisfies WindowOptimizationRecord
      })

    const selectedDayRange = marketDayBounds(marketDayKey)
    const selectedDayWindows = windows.filter((window) => {
      const openedAt = Date.parse(window.openedAt)
      const closedAt = window.closedAt ? Date.parse(window.closedAt) : Number.NaN
      const inOpenedRange =
        selectedDayRange !== null &&
        Number.isFinite(openedAt) &&
        openedAt >= selectedDayRange.start.getTime() &&
        openedAt < selectedDayRange.end.getTime()
      const inClosedRange =
        selectedDayRange !== null &&
        Number.isFinite(closedAt) &&
        closedAt >= selectedDayRange.start.getTime() &&
        closedAt < selectedDayRange.end.getTime()
      return inOpenedRange || inClosedRange
    })
    const selectedDaySnapshots = marketSnapshots
    // These counters reflect signal events, not window lifecycle events, so they stay aligned with the buy/sell labels in the UI.
    const buySignalCount = selectedDaySignals.filter((signal) => classifySignal(signal) === 'buy').length
    const sellSignalCount = selectedDaySignals.filter((signal) => classifySignal(signal) === 'sell').length
    const openWindows = selectedDayWindows.filter((window) => window.status === 'open').length
    const closedWindows = selectedDayWindows.filter((window) => window.status === 'closed').length
    const latestVersionDocs = [...versionDocs].sort((left, right) => compareRealtimeDoc(left, right, ['updatedAt', 'updated_at', 'created_at']))
    const signals = decisionSignals
    const configVersion = String(latestSession?.config_version ?? latestVersion?.version ?? 'draft')
    const configVersions = latestVersionDocs.map((doc) => {
      const data = doc.data() as Record<string, unknown>
      return {
        id: doc.id,
        version: String(data.version ?? doc.id),
        status: String(data.status ?? 'candidate'),
        updatedAt: formatRealtimeTimestamp(data.updatedAt ?? data.updated_at ?? data.created_at, new Date().toISOString()),
        summary: String(data.summary ?? data.notes ?? 'Session-scoped config snapshot'),
        fields: normalizeConfigFields(data.fields, configFields),
      }
    })

    const hasLiveData =
      sessionDocs.length > 0 ||
      selectedDaySignalDocs.length > 0 ||
      versionDocs.length > 0 ||
      windowDocs.length > 0 ||
      selectedDaySnapshots.length > 0
    const source = hasLiveData ? 'live' : 'empty'
    const warning = hasLiveData
      ? selectedDaySnapshots.length === 0
        ? 'No live trading snapshots are available for the selected day yet.'
        : signals.length === 0
          ? 'No live trading decisions have been written for the selected day yet.'
          : null
      : 'Live trading data is unavailable, so the dashboard is showing an empty state for this day.'

    return {
      source,
      warning,
      snapshot: {
        metrics: [
          { label: 'Buy signals today', value: String(buySignalCount) },
          { label: 'Sell signals today', value: String(sellSignalCount) },
          { label: 'Open windows now', value: String(openWindows) },
          { label: 'Closed windows today', value: String(closedWindows) },
        ],
        sessionOverview: {
          sessionId: latestSessionId,
          status: String(latestSession?.status ?? (hasLiveData ? 'live' : 'waiting')),
        updatedAt: formatRealtimeTimestamp(
            latestSession?.updatedAt ??
              latestSession?.updated_at ??
              latestSignal?.updatedAt ??
              latestSignal?.updated_at ??
              latestSignal?.timestamp ??
              latestVersion?.updatedAt ??
              latestVersion?.updated_at ??
              latestVersion?.created_at,
            new Date().toISOString(),
          ),
          configVersion,
          openWindows,
          summary: latestSession
            ? 'Live session snapshot loaded for the selected day.'
            : hasLiveData
              ? 'Live records are available for the selected day.'
              : 'No live records are available for the selected day yet.',
        },
        selectedSignal: signals[0] ?? null,
        signals,
        windows,
        marketSnapshots: selectedDaySnapshots,
        windowOptimizations,
        configFields:
          configVersions.find((version) => version.version === configVersion)?.fields ??
          configVersions.at(-1)?.fields ??
          cloneConfigFields(configFields),
        configVersions,
      },
    }
  } catch (error) {
    console.error('Failed to load dashboard snapshot:', error)
    return {
      source: 'empty',
      warning: 'Live dashboard data is unavailable.',
      snapshot: buildEmptySnapshot(),
    }
  }
}

function compareRealtimeDoc(left: { data: () => unknown }, right: { data: () => unknown }, timestampKeys: string[]): number {
  const leftData = left.data() as Record<string, unknown>
  const rightData = right.data() as Record<string, unknown>
  const leftTimestamp = timestampKeys.map((key) => formatComparableTimestamp(leftData[key])).find((value) => value !== null)
  const rightTimestamp = timestampKeys.map((key) => formatComparableTimestamp(rightData[key])).find((value) => value !== null)

  if (leftTimestamp !== undefined && rightTimestamp !== undefined && leftTimestamp !== rightTimestamp) {
    return leftTimestamp - rightTimestamp
  }
  if (leftTimestamp !== undefined && rightTimestamp === undefined) {
    return -1
  }
  if (leftTimestamp === undefined && rightTimestamp !== undefined) {
    return 1
  }
  return 0
}

function formatNullableRealtimeTimestamp(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null
  }
  return formatRealtimeTimestamp(value, new Date().toISOString())
}

function toWindowOptimizationSnapshot(value: unknown): WindowOptimizationSnapshot {
  const fallback = {
    timestamp: new Date().toISOString(),
    close: 0,
    sma_fast: null,
    sma_slow: null,
    ema_fast: null,
    ema_slow: null,
    vwap: null,
    rsi: null,
    atr: null,
    plus_di: null,
    minus_di: null,
    adx: null,
    macd: null,
    macd_signal: null,
    macd_histogram: null,
    stochastic_k: null,
    stochastic_d: null,
    bollinger_middle: null,
    bollinger_upper: null,
    bollinger_lower: null,
    obv: null,
    relative_volume: null,
    volume_profile: null,
    entry_score: 0,
    exit_score: 0,
  }
  if (!value || typeof value !== 'object') {
    return fallback
  }
  const data = value as Record<string, unknown>
  return {
    timestamp: formatRealtimeTimestamp(data.timestamp ?? data.created_at ?? data.updated_at, fallback.timestamp),
    close: Number(data.close ?? 0),
    sma_fast: toNullableNumber(data.sma_fast),
    sma_slow: toNullableNumber(data.sma_slow),
    ema_fast: toNullableNumber(data.ema_fast),
    ema_slow: toNullableNumber(data.ema_slow),
    vwap: toNullableNumber(data.vwap),
    rsi: toNullableNumber(data.rsi),
    atr: toNullableNumber(data.atr),
    plus_di: toNullableNumber(data.plus_di),
    minus_di: toNullableNumber(data.minus_di),
    adx: toNullableNumber(data.adx),
    macd: toNullableNumber(data.macd),
    macd_signal: toNullableNumber(data.macd_signal),
    macd_histogram: toNullableNumber(data.macd_histogram),
    stochastic_k: toNullableNumber(data.stochastic_k),
    stochastic_d: toNullableNumber(data.stochastic_d),
    bollinger_middle: toNullableNumber(data.bollinger_middle ?? data.bollinger_mid),
    bollinger_upper: toNullableNumber(data.bollinger_upper),
    bollinger_lower: toNullableNumber(data.bollinger_lower),
    obv: toNullableNumber(data.obv),
    relative_volume: toNullableNumber(data.relative_volume ?? data.relativeVolume),
    volume_profile: toNullableNumber(data.volume_profile ?? data.volumeProfile),
    entry_score: Number(data.entry_score ?? data.entryScore ?? 0),
    exit_score: Number(data.exit_score ?? data.exitScore ?? 0),
  }
}

function snapshotToOptimizationPayload(snapshot: MarketSnapshotRecord) {
  return {
    timestamp: snapshot.timestamp,
    close: snapshot.close,
    sma_fast: snapshot.smaFast,
    sma_slow: snapshot.smaSlow,
    ema_fast: snapshot.emaFast,
    ema_slow: snapshot.emaSlow,
    vwap: snapshot.vwap,
    rsi: snapshot.rsi,
    atr: snapshot.atr,
    plus_di: snapshot.plusDi,
    minus_di: snapshot.minusDi,
    adx: snapshot.adx,
    macd: snapshot.macd,
    macd_signal: snapshot.macdSignal,
    macd_histogram: snapshot.macdHistogram,
    stochastic_k: snapshot.stochasticK,
    stochastic_d: snapshot.stochasticD,
    bollinger_middle: snapshot.bollingerMiddle,
    bollinger_upper: snapshot.bollingerUpper,
    bollinger_lower: snapshot.bollingerLower,
    obv: snapshot.obv,
    relative_volume: snapshot.relativeVolume,
    volume_profile: snapshot.volumeProfile,
    entry_score: snapshot.entryScore,
    exit_score: snapshot.exitScore,
  }
}

function calculateWindowChangePct(entrySnapshot: MarketSnapshotRecord, exitSnapshot: MarketSnapshotRecord) {
  if (entrySnapshot.close <= 0 || !Number.isFinite(entrySnapshot.close) || !Number.isFinite(exitSnapshot.close)) {
    return 0
  }
  return ((exitSnapshot.close - entrySnapshot.close) / entrySnapshot.close) * 100
}

function selectLatestRealtimeDoc<T extends { data: () => unknown }>(docs: readonly T[], timestampKeys: string[]): T | undefined {
  const timestampedDocs = docs.filter((doc) => {
    const data = doc.data() as Record<string, unknown>
    return timestampKeys.some((key) => formatComparableTimestamp(data[key]) !== null)
  })

  if (timestampedDocs.length > 0) {
    return [...timestampedDocs].sort((left, right) => compareRealtimeDoc(left, right, timestampKeys)).at(-1)
  }

  return docs.at(-1)
}

function formatComparableTimestamp(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  if (value instanceof Date) {
    return value.getTime()
  }
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().getTime()
  }
  return null
}
