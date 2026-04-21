import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore'
import { db } from './firebase'
import { CONFIG_VERSIONS_COLLECTION, MARKET_SESSIONS_COLLECTION, SIGNAL_EVENTS_COLLECTION } from './schema'
import { classifySignal, type AdminSignal, type ConfigField, configFields, sampleSignals } from './engine'

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
  configVersions: Array<{ version: string; status: string; updatedAt: string; summary: string }>
}

function toSignalState(signal: AdminSignal): AdminSignal {
  return {
    ...signal,
    state: classifySignal(signal) === 'exit' ? 'EXIT_SIGNALLED' : classifySignal(signal) === 'entry' ? 'ENTRY_SIGNALLED' : signal.state,
  }
}

function formatFirestoreValue(value: unknown, fallback = new Date().toISOString()): string {
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

export async function loadDashboardSnapshot(): Promise<DashboardSnapshot> {
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
            updatedAt: String(data.updatedAt ?? data.timestamp ?? new Date().toISOString()),
            reasons: Array.isArray(data.reasons) ? data.reasons.map(String) : [],
          })
        })
      : sampleSignals

    const selectedSignal = signals[0] ?? sampleSignals[0]
    const latestSession = sessionDocs.docs[0]?.data() as Record<string, unknown> | undefined
    const configVersions = versionDocs.docs.length
      ? versionDocs.docs.map((doc) => {
          const data = doc.data() as Record<string, unknown>
          return {
            version: String(data.version ?? doc.id),
            status: String(data.status ?? 'candidate'),
            updatedAt: String(data.updatedAt ?? data.created_at ?? new Date().toISOString()),
            summary: String(data.summary ?? data.notes ?? 'Session-scoped config snapshot'),
          }
        })
      : [
          {
            version: 'v18',
            status: 'active',
            updatedAt: '2026-04-20 15:45 UTC',
            summary: 'Frozen session config for the current market window.',
          },
          {
            version: 'v17',
            status: 'archived',
            updatedAt: '2026-04-19 15:45 UTC',
            summary: 'Previous replay-approved config candidate.',
          },
        ]

    return {
      metrics: [
        { label: 'Signals today', value: String(signals.length * 8) },
        { label: 'Open windows', value: String(Number(latestSession?.open_windows ?? 0)) },
        { label: 'Rejected entries', value: String(Number(latestSession?.rejected_entries ?? 0)) },
        { label: 'Config version', value: String(latestSession?.config_version ?? 'v18') },
      ],
      sessionOverview: {
        sessionId: String(sessionDocs.docs[0]?.id ?? 'local-session'),
        status: String(latestSession?.status ?? 'live'),
        updatedAt: formatFirestoreValue(latestSession?.updated_at),
        configVersion: String(latestSession?.config_version ?? 'v18'),
        openWindows: Number(latestSession?.open_windows ?? 0),
        rejectedEntries: Number(latestSession?.rejected_entries ?? 0),
        summary: latestSession
          ? 'Latest Firestore session snapshot is loaded and ready for triage.'
          : 'Firebase-hosted shell is running with sample data until a live session is available.',
      },
      selectedSignal,
      signals,
      configFields,
      configVersions,
    }
  } catch {
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
          version: 'v18',
          status: 'active',
          updatedAt: '2026-04-20 15:45 UTC',
          summary: 'Frozen session config for the current market window.',
        },
      ],
    }
  }
}
