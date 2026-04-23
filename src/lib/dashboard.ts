import { collection, doc, getDocs, limit, orderBy, query, runTransaction, where, writeBatch } from 'firebase/firestore'
import { db } from './firebase'
import {
  CONFIG_VERSIONS_COLLECTION,
  MARKET_SESSIONS_COLLECTION,
  MARKET_SNAPSHOTS_COLLECTION,
  SIGNAL_EVENTS_COLLECTION,
} from './schema'
import { classifySignal, type AdminSignal, type ConfigField, configFields, sampleSignals } from './engine'

export type DashboardSource = 'firestore' | 'partial' | 'sample'

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
  selectedSignal: AdminSignal
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

function buildFallbackSnapshot(): DashboardSnapshot {
  return {
    metrics: [
      { label: 'Signals today', value: '24' },
      { label: 'Open windows', value: '3' },
      { label: 'Rejected entries', value: '7' },
      { label: 'Config version', value: 'v18' },
    ],
    sessionOverview: {
      sessionId: 'local-session',
      status: 'live',
      updatedAt: new Date().toISOString(),
      configVersion: 'v18',
      openWindows: 3,
      rejectedEntries: 7,
      summary: 'Firebase-hosted shell is running with sample data until a live session is available.',
    },
    selectedSignal: sampleSignals[0],
    signals: sampleSignals,
    marketSnapshots: buildFallbackMarketSnapshots(),
    configFields,
    configVersions: [
      {
        id: 'v18',
        version: 'v18',
        status: 'active',
        updatedAt: '2026-04-20 15:45 UTC',
        summary: 'Frozen session config for the current market window.',
        fields: configFields,
      },
    ],
  }
}

function buildFallbackMarketSnapshots(): MarketSnapshotRecord[] {
  const symbols = ['AAPL', 'NVDA']
  const snapshots: MarketSnapshotRecord[] = []
  const now = Date.now()
  for (const [symbolIndex, symbol] of symbols.entries()) {
    for (let index = 0; index < 24; index += 1) {
      const price = 180 + symbolIndex * 8 + index * 0.75 + Math.sin(index / 3) * 2
      const timestamp = new Date(now - (23 - index) * 60_000).toISOString()
      snapshots.push({
        id: `${symbol}:${index}`,
        sessionId: 'local-session',
        symbol,
        timestamp,
        open: price - 0.4,
        high: price + 0.8,
        low: price - 1.0,
        close: price,
        volume: 1_000 + index * 20,
        smaFast: price - 0.6,
        smaSlow: price - 1.1,
        emaFast: price - 0.3,
        emaSlow: price - 0.9,
        vwap: price - 0.8,
        rsi: Math.min(85, 48 + index * 1.6),
        atr: 1.2 + index * 0.03,
        plusDi: 24 + index * 0.4,
        minusDi: 18 - index * 0.1,
        adx: 21 + index * 0.35,
        macd: 0.15 + index * 0.03,
        macdSignal: 0.1 + index * 0.025,
        macdHistogram: 0.05 + index * 0.005,
        stochasticK: 32 + index * 1.1,
        stochasticD: 30 + index * 1.0,
        entryScore: Math.min(0.96, 0.48 + index * 0.02),
        exitScore: Math.max(0.12, 0.38 - index * 0.006),
        eventType: index % 12 === 0 ? 'buy_alert' : 'market.snapshot',
        signalAction: index % 12 === 0 ? 'BUY_ALERT' : 'HOLD',
        signalState: index % 12 === 0 ? 'ENTRY_SIGNALLED' : 'FLAT',
        signalRegime: 'Sample live market window',
        benchmarkSymbol: 'IXIC',
        reasons: index % 12 === 0 ? ['entry-qualified'] : [],
      })
    }
  }
  return snapshots
}

function normalizeConfigFields(value: unknown, fallback: ConfigField[]): ConfigField[] {
  if (!Array.isArray(value)) {
    return fallback
  }

  const fallbackByKey = new Map(fallback.map((field) => [field.key, field.value]))
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
      const fallbackValue = fallbackByKey.get(key)
      const numericValue =
        typeof raw.value === 'number' && Number.isFinite(raw.value)
          ? raw.value
          : typeof raw.value === 'string' && raw.value.trim() && Number.isFinite(Number(raw.value))
            ? Number(raw.value)
            : fallbackValue
      if (typeof numericValue !== 'number' || !Number.isFinite(numericValue)) {
        return null
      }
      return {
        key,
        value: numericValue,
        description: String(raw.description ?? ''),
      }
    })
    .filter((field): field is ConfigField => field !== null)

  return fields
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

export async function loadDashboardSnapshot(options: { allowFirestore?: boolean } = {}): Promise<DashboardSnapshotResult> {
  if (options.allowFirestore === false) {
    return {
      source: 'sample',
      warning: 'Anonymous auth is unavailable, so the dashboard is using sample data.',
      snapshot: buildFallbackSnapshot(),
    }
  }

  try {
    const sessionDocs = await getDocs(
      query(collection(db, MARKET_SESSIONS_COLLECTION), orderBy('updated_at', 'desc'), limit(1)),
    )
    const signalDocs = await getDocs(
      query(collection(db, SIGNAL_EVENTS_COLLECTION), orderBy('timestamp', 'desc'), limit(3)),
    )
    const versionDocs = await getDocs(
      query(collection(db, CONFIG_VERSIONS_COLLECTION), orderBy('created_at', 'desc'), limit(5)),
    )

    const signals = signalDocs.docs.length
      ? signalDocs.docs.map((doc) => {
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
      : sampleSignals

    const selectedSignal = signals[0] ?? sampleSignals[0]
    const latestSession = sessionDocs.docs[0]?.data() as Record<string, unknown> | undefined
    const latestSessionId = String(sessionDocs.docs[0]?.id ?? latestSession?.session_id ?? 'local-session')
    const marketSnapshotDocs = await getDocs(
      query(
        collection(db, MARKET_SNAPSHOTS_COLLECTION),
        where('session_id', '==', latestSessionId),
        limit(240),
      ),
    )
    const marketSnapshots = marketSnapshotDocs.docs.length
      ? marketSnapshotDocs.docs
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
      : buildFallbackMarketSnapshots()
    const openWindows = Number(latestSession?.open_windows ?? 0)
    const rejectedEntries = Number(latestSession?.rejected_entries ?? 0)
    const configVersion = String(latestSession?.config_version ?? 'v18')
    const hasCoreDashboardData = sessionDocs.docs.length > 0 && signalDocs.docs.length > 0 && versionDocs.docs.length > 0
    const hasLiveMarketData = marketSnapshotDocs.docs.length > 0
    const configVersions = versionDocs.docs.length
      ? versionDocs.docs.map((doc) => {
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
      : [
          {
            id: 'v18',
            version: 'v18',
            status: 'active',
            updatedAt: '2026-04-20 15:45 UTC',
            summary: 'Frozen session config for the current market window.',
            fields: configFields,
          },
          {
            id: 'v17',
            version: 'v17',
            status: 'archived',
            updatedAt: '2026-04-19 15:45 UTC',
            summary: 'Previous replay-approved config candidate.',
            fields: configFields,
          },
        ]

    return {
      source: hasCoreDashboardData ? (hasLiveMarketData ? 'firestore' : 'partial') : 'sample',
      warning: hasCoreDashboardData
        ? hasLiveMarketData
          ? null
          : 'Firestore returned live session data, but no market snapshots were available so the dashboard is showing sample chart data.'
        : 'Firestore returned incomplete dashboard data, so the dashboard is using sample values for the missing sections.',
      snapshot: {
        metrics: [
          { label: 'Signals today', value: String(signals.length * 8) },
          { label: 'Open windows', value: String(openWindows) },
          { label: 'Rejected entries', value: String(rejectedEntries) },
          { label: 'Config version', value: configVersion },
        ],
        sessionOverview: {
          sessionId: String(sessionDocs.docs[0]?.id ?? 'local-session'),
          status: String(latestSession?.status ?? 'live'),
          updatedAt: formatFirestoreTimestamp(latestSession?.updated_at, new Date().toISOString()),
          configVersion,
          openWindows,
          rejectedEntries,
          summary: latestSession
            ? 'Latest Firestore session snapshot is loaded and ready for triage.'
            : 'Firebase-hosted shell is running with sample data until a live session is available.',
        },
        selectedSignal,
        signals,
        marketSnapshots,
        configFields,
        configVersions,
      },
    }
  } catch (error) {
    return {
      source: 'sample',
      warning: error instanceof Error ? error.message : 'Firestore dashboard data is unavailable.',
      snapshot: buildFallbackSnapshot(),
    }
  }
}
