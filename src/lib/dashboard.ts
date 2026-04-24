import { collection, doc, getDocs, query, runTransaction, Timestamp, where, writeBatch } from 'firebase/firestore'
import { db } from './firebase'
import {
  CONFIG_VERSIONS_COLLECTION,
  MARKET_SESSIONS_COLLECTION,
  MARKET_SNAPSHOTS_COLLECTION,
  SIGNAL_EVENTS_COLLECTION,
} from './schema'
import { classifySignal, configFields, type AdminSignal, type ConfigField, type ConfigFieldValue } from './engine'

export type DashboardSource = 'firestore' | 'empty'

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
    rejectedEntries: number
    summary: string
  }
  selectedSignal: AdminSignal | null
  signals: AdminSignal[]
  marketSnapshots: MarketSnapshotRecord[]
  configFields: ConfigField[]
  configVersions: ConfigVersionRecord[]
}

export type MarketSnapshotRecord = {
  id: string
  sessionId: string
  symbol: string
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
  entryScore: number
  exitScore: number
  eventType: string
  signalAction: string
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

function toSignalState(signal: AdminSignal): AdminSignal {
  return {
    ...signal,
    state: classifySignal(signal) === 'exit' ? 'EXIT_SIGNALLED' : classifySignal(signal) === 'entry' ? 'ENTRY_SIGNALLED' : signal.state,
  }
}

function formatFirestoreTimestamp(value: unknown, fallback: string): string {
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
  }))
}

function isConfigFieldValue(value: unknown): value is ConfigFieldValue {
  return typeof value === 'number' || typeof value === 'string' || Array.isArray(value)
}

function marketDayBounds(dayKey: string) {
  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey)
  if (!parsed) {
    return null
  }

  const year = Number(parsed[1])
  const month = Number(parsed[2])
  const day = Number(parsed[3])
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null
  }

  const start = zonedTimeToUtc(year, month, day, 0, 0, 0, 'America/New_York')
  const end = zonedTimeToUtc(year, month, day + 1, 0, 0, 0, 'America/New_York')
  return { start, end }
}

function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second)
  const offset = timezoneOffset(new Date(utcGuess), timeZone)
  return new Date(utcGuess - offset)
}

function timezoneOffset(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = formatter.formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  ) - date.getTime()
}

function buildEmptySnapshot(): DashboardSnapshot {
  return {
    metrics: [
      { label: 'Signals today', value: '0' },
      { label: 'Open windows', value: '0' },
      { label: 'Rejected entries', value: '0' },
      { label: 'Config version', value: 'draft' },
    ],
    sessionOverview: {
      sessionId: 'nasdaq-live',
      status: 'waiting',
      updatedAt: new Date().toISOString(),
      configVersion: 'draft',
      openWindows: 0,
      rejectedEntries: 0,
      summary: 'No live Firestore records are available yet.',
    },
    selectedSignal: null,
    signals: [],
    marketSnapshots: [],
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
      return {
        key,
        label: String(raw.label ?? fallbackField?.label ?? key),
        value: normalizedValue,
        description: String(raw.description ?? fallbackField?.description ?? ''),
        group: String(raw.group ?? fallbackField?.group ?? 'Legacy config'),
        inputType: (String(raw.inputType ?? fallbackField?.inputType ?? (Array.isArray(normalizedValue) ? 'symbols' : typeof normalizedValue === 'number' ? 'number' : 'text')) as ConfigField['inputType']),
        ...(fallbackField?.step !== undefined ? { step: fallbackField.step } : {}),
        ...(fallbackField?.placeholder !== undefined ? { placeholder: fallbackField.placeholder } : {}),
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
  const versionDocs = await getDocs(query(collection(db, CONFIG_VERSIONS_COLLECTION), where('session_id', '==', sessionId)))
  const existingVersions = versionDocs.docs.flatMap((docSnap) => {
    const data = docSnap.data() as Record<string, unknown>
    return [docSnap.id, String(data.version ?? '')]
  })
  const versionPrefix = nextVersionLabel(baseVersion, existingVersions)
  const sessionRef = doc(db, MARKET_SESSIONS_COLLECTION, sessionId)
  return runTransaction(db, async (transaction) => {
    const sessionSnap = await transaction.get(sessionRef)
    const currentSequence = Number((sessionSnap.data() as Record<string, unknown> | undefined)?.config_candidate_sequence ?? 0)
    const nextSequence = currentSequence + 1
    const version = `${versionPrefix}-${nextSequence}`
    const id = `${sessionId}:${version}`
    transaction.set(doc(db, CONFIG_VERSIONS_COLLECTION, id), {
      version,
      status: 'candidate',
      summary,
      fields,
      base_version: baseVersion,
      session_id: sessionId,
      created_at: now,
      updated_at: now,
    })
    transaction.set(sessionRef, { config_candidate_sequence: nextSequence, updated_at: now }, { merge: true })
    return {
      id,
      version,
      status: 'candidate',
      updatedAt: now,
      summary,
      fields,
    } satisfies ConfigVersionRecord
  })
}

export async function applyConfigVersion(sessionId: string, currentVersion: string, targetVersion: string) {
  const now = new Date().toISOString()
  const batch = writeBatch(db)
  const currentRef = doc(db, CONFIG_VERSIONS_COLLECTION, `${sessionId}:${currentVersion}`)
  const targetRef = doc(db, CONFIG_VERSIONS_COLLECTION, `${sessionId}:${targetVersion}`)
  if (currentVersion && currentVersion !== targetVersion) {
    batch.set(currentRef, {
      status: 'archived',
      updated_at: now,
    }, { merge: true })
  }
  batch.update(targetRef, {
    status: 'active',
    updated_at: now,
  })
  batch.set(
    doc(db, MARKET_SESSIONS_COLLECTION, sessionId),
    {
      config_version: targetVersion,
      updated_at: now,
    },
    { merge: true },
  )
  await batch.commit()
}

export async function loadDashboardSnapshot(options: { allowFirestore?: boolean; marketDayKey?: string } = {}): Promise<DashboardSnapshotResult> {
  if (options.allowFirestore === false) {
    return {
      source: 'empty',
      warning: 'Anonymous auth is unavailable, so the dashboard is showing an empty live state.',
      snapshot: buildEmptySnapshot(),
    }
  }

  try {
    const sessionDocs = await getDocs(collection(db, MARKET_SESSIONS_COLLECTION))
    const signalDocs = await getDocs(collection(db, SIGNAL_EVENTS_COLLECTION))
    const versionDocs = await getDocs(collection(db, CONFIG_VERSIONS_COLLECTION))

    const latestSessionDoc = selectLatestFirestoreDoc(sessionDocs.docs, ['updated_at', 'updatedAt'])
    const latestSession = latestSessionDoc?.data() as Record<string, unknown> | undefined
    const latestSignalDoc = selectLatestFirestoreDoc(signalDocs.docs, ['timestamp', 'updated_at', 'updatedAt'])
    const latestSignal = latestSignalDoc?.data() as Record<string, unknown> | undefined
    const latestVersionDoc = selectLatestFirestoreDoc(versionDocs.docs, ['updatedAt', 'updated_at', 'created_at'])
    const latestVersion = latestVersionDoc?.data() as Record<string, unknown> | undefined
    const latestSessionId = String(
      latestSessionDoc?.id ??
        latestSession?.session_id ??
        latestSignal?.session_id ??
        latestVersion?.session_id ??
        'nasdaq-live',
    )
    const marketDayKey = options.marketDayKey ?? new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
    const marketBounds = marketDayBounds(marketDayKey)
    const marketSnapshotDocs = marketBounds
      ? await getDocs(
          query(
            collection(db, MARKET_SNAPSHOTS_COLLECTION),
            where('session_id', '==', latestSessionId),
            where('timestamp', '>=', Timestamp.fromDate(marketBounds.start)),
            where('timestamp', '<', Timestamp.fromDate(marketBounds.end)),
          ),
        )
      : await getDocs(query(collection(db, MARKET_SNAPSHOTS_COLLECTION), where('session_id', '==', latestSessionId)))
    const latestVersionDocs = [...versionDocs.docs].sort((left, right) => compareFirestoreDoc(left, right, ['created_at', 'updated_at', 'updatedAt']))
    const signals = [...signalDocs.docs]
      .sort((left, right) => compareFirestoreDoc(left, right, ['timestamp', 'updated_at', 'updatedAt']))
      .map((doc) => {
        const data = doc.data() as Record<string, unknown>
        return toSignalState({
          symbol: String(data.symbol ?? doc.id),
          state: (data.state as AdminSignal['state']) ?? 'ENTRY_SIGNALLED',
          entryScore: Number(data.entryScore ?? data.entry_score ?? 0),
          exitScore: Number(data.exitScore ?? data.exit_score ?? 0),
          regime: String(data.regime ?? 'Live market session'),
          updatedAt: formatFirestoreTimestamp(data.updatedAt ?? data.timestamp, new Date().toISOString()),
          reasons: Array.isArray(data.reasons) ? data.reasons.map(String) : [],
        })
      })
    const marketSnapshots = marketSnapshotDocs.docs
      .map((doc) => {
        const data = doc.data() as Record<string, unknown>
        return {
          id: doc.id,
          sessionId: String(data.session_id ?? data.sessionId ?? latestSessionId),
          symbol: String(data.symbol ?? doc.id),
          timestamp: formatFirestoreTimestamp(data.timestamp ?? data.created_at ?? data.updated_at, new Date().toISOString()),
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
          entryScore: Number(data.entry_score ?? 0),
          exitScore: Number(data.exit_score ?? 0),
          eventType: String(data.event_type ?? ''),
          signalAction: String(data.signal_action ?? data.action ?? 'HOLD'),
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
    const openWindows = Number(latestSession?.open_windows ?? 0)
    const rejectedEntries = Number(latestSession?.rejected_entries ?? 0)
    const configVersion = String(latestSession?.config_version ?? latestVersion?.version ?? 'draft')
    const configVersions = latestVersionDocs.map((doc) => {
      const data = doc.data() as Record<string, unknown>
      return {
        id: doc.id,
        version: String(data.version ?? doc.id),
        status: String(data.status ?? 'candidate'),
        updatedAt: formatFirestoreTimestamp(data.updatedAt ?? data.updated_at ?? data.created_at, new Date().toISOString()),
        summary: String(data.summary ?? data.notes ?? 'Session-scoped config snapshot'),
        fields: normalizeConfigFields(data.fields, configFields),
      }
    })

    const hasLiveData = sessionDocs.docs.length > 0 || signalDocs.docs.length > 0 || versionDocs.docs.length > 0 || marketSnapshotDocs.docs.length > 0
    const source = hasLiveData ? 'firestore' : 'empty'
    const warning = hasLiveData
      ? marketSnapshots.length === 0
        ? 'Firestore is connected, but no live market snapshots are available for the selected session yet.'
        : signalDocs.docs.length === 0
          ? 'Firestore is connected, but no live signals have been written for the selected session yet.'
          : null
      : 'Firestore is connected, but the live session has not produced records for this day yet.'

    return {
      source,
      warning,
      snapshot: {
        metrics: [
          { label: 'Signals today', value: String(signals.length) },
          { label: 'Open windows', value: String(openWindows) },
          { label: 'Rejected entries', value: String(rejectedEntries) },
          { label: 'Config version', value: configVersion },
        ],
        sessionOverview: {
          sessionId: latestSessionId,
          status: String(latestSession?.status ?? (hasLiveData ? 'live' : 'waiting')),
          updatedAt: formatFirestoreTimestamp(
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
          rejectedEntries,
          summary: latestSession
            ? 'Latest Firestore session snapshot is loaded and ready for triage.'
            : hasLiveData
              ? 'Firestore live records are available and ready for triage.'
              : 'Firestore is connected and waiting for the live session to publish records.',
        },
        selectedSignal: signals.at(-1) ?? null,
        signals,
        marketSnapshots,
        configFields:
          configVersions.find((version) => version.version === configVersion)?.fields ??
          configVersions.at(-1)?.fields ??
          cloneConfigFields(configFields),
        configVersions,
      },
    }
  } catch (error) {
    return {
      source: 'empty',
      warning: error instanceof Error ? error.message : 'Firestore dashboard data is unavailable.',
      snapshot: buildEmptySnapshot(),
    }
  }
}

function compareFirestoreDoc(left: { data: () => unknown }, right: { data: () => unknown }, timestampKeys: string[]): number {
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

function selectLatestFirestoreDoc<T extends { data: () => unknown }>(docs: readonly T[], timestampKeys: string[]): T | undefined {
  const timestampedDocs = docs.filter((doc) => {
    const data = doc.data() as Record<string, unknown>
    return timestampKeys.some((key) => formatComparableTimestamp(data[key]) !== null)
  })

  if (timestampedDocs.length > 0) {
    return [...timestampedDocs].sort((left, right) => compareFirestoreDoc(left, right, timestampKeys)).at(-1)
  }

  return docs.at(-1)
}

function formatComparableTimestamp(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
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
