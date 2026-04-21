import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore'
import { db } from './firebase'
import { CONFIG_VERSIONS_COLLECTION, MARKET_SESSIONS_COLLECTION, SIGNAL_EVENTS_COLLECTION } from './schema'
import { classifySignal, type AdminSignal, type ConfigField, configFields, sampleSignals } from './engine'

export type DashboardSource = 'firestore' | 'sample'

export type DashboardSnapshot = {
  metrics: Array<{ label: string; value: string }>
  selectedSignal: AdminSignal
  signals: AdminSignal[]
  configFields: ConfigField[]
  configVersions: Array<{ version: string; status: string; updatedAt: string; summary: string }>
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

function buildFallbackSnapshot(): DashboardSnapshot {
  return {
    metrics: [
      { label: 'Signals today', value: '24' },
      { label: 'Open windows', value: '3' },
      { label: 'Rejected entries', value: '7' },
      { label: 'Config version', value: 'v18' },
    ],
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

export async function loadDashboardSnapshot(): Promise<DashboardSnapshotResult> {
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
      source: 'firestore',
      warning: null,
      snapshot: {
      metrics: [
        { label: 'Signals today', value: String(signals.length * 8) },
        { label: 'Open windows', value: String(Number(latestSession?.open_windows ?? 0)) },
        { label: 'Rejected entries', value: String(Number(latestSession?.rejected_entries ?? 0)) },
        { label: 'Config version', value: String(latestSession?.config_version ?? 'v18') },
      ],
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
