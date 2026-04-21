import { collection, doc, getDocs, limit, orderBy, query, runTransaction, where, writeBatch } from 'firebase/firestore'
import { db } from './firebase'
import { CONFIG_VERSIONS_COLLECTION, MARKET_SESSIONS_COLLECTION, SIGNAL_EVENTS_COLLECTION } from './schema'
import { classifySignal, type AdminSignal, type ConfigField, configFields, sampleSignals } from './engine'

export type DashboardSource = 'firestore' | 'sample'

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
  configFields: ConfigField[]
  configVersions: ConfigVersionRecord[]
}

export type DashboardSnapshotResult = {
  snapshot: DashboardSnapshot
  source: DashboardSource
  warning: string | null
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
    const openWindows = Number(latestSession?.open_windows ?? 0)
    const rejectedEntries = Number(latestSession?.rejected_entries ?? 0)
    const configVersion = String(latestSession?.config_version ?? 'v18')
    const hasLiveDashboardData = sessionDocs.docs.length > 0 && signalDocs.docs.length > 0 && versionDocs.docs.length > 0
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
      source: hasLiveDashboardData ? 'firestore' : 'sample',
      warning: hasLiveDashboardData
        ? null
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
