<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { signInAnonymously } from 'firebase/auth'
import { classifySignal } from './lib/engine'
import { auth } from './lib/firebase'
import {
  applyConfigVersion,
  loadDashboardSnapshot,
  saveConfigCandidate,
  type ConfigVersionRecord,
  type DashboardSnapshot,
  type DashboardSource,
} from './lib/dashboard'

const snapshot = ref<DashboardSnapshot | null>(null)
const selectedSignal = ref<DashboardSnapshot['selectedSignal'] | null>(null)
const sessionOverview = ref<DashboardSnapshot['sessionOverview']>({
  sessionId: 'local-session',
  status: 'live',
  updatedAt: new Date().toISOString(),
  configVersion: 'v18',
  openWindows: 0,
  rejectedEntries: 0,
  summary: 'Firebase-hosted shell is running with sample data until a live session is available.',
})
const loading = ref(true)
const authState = ref<'booting' | 'authenticating' | 'authenticated' | 'offline'>('booting')
const snapshotSource = ref<DashboardSource>('sample')
const snapshotWarning = ref<string | null>(null)
const firestoreAvailable = ref(true)
const triageFilter = ref<'all' | 'entry' | 'exit' | 'hold'>('all')
const triageFilters = ['all', 'entry', 'exit', 'hold'] as const
const selectedConfigVersionId = ref<string>('current')
const configDraft = reactive<Record<string, number>>({})

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

const currentConfigVersion = computed(() => snapshot.value?.sessionOverview.configVersion ?? 'v18')

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

const editableConfigFields = computed(() => {
  if (selectedConfigVersion.value?.fields?.length) {
    return selectedConfigVersion.value.fields
  }
  return snapshot.value?.configFields ?? []
})

function syncConfigDraft(fields: DashboardSnapshot['configFields']) {
  for (const key of Object.keys(configDraft)) {
    delete configDraft[key]
  }
  for (const field of fields) {
    configDraft[field.key] = field.value
  }
}

function selectConfigVersion(version: ConfigVersionRecord | null) {
  if (!version) {
    selectedConfigVersionId.value = 'current'
    syncConfigDraft(snapshot.value?.configFields ?? [])
    return
  }

  selectedConfigVersionId.value = version.id
  syncConfigDraft(version.fields.length > 0 ? version.fields : snapshot.value?.configFields ?? [])
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
    syncConfigDraft(version?.fields.length ? version.fields : snapshot.value.configFields)
  },
  { immediate: true },
)

function setTriageFilter(filter: (typeof triageFilters)[number]) {
  triageFilter.value = filter
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
  const activeVersion = result.snapshot.configVersions.find(
    (version) => version.version === result.snapshot.sessionOverview.configVersion,
  )
  selectConfigVersion(activeVersion ?? result.snapshot.configVersions[0] ?? null)
}

async function saveConfigVersion() {
  if (!snapshot.value || snapshotSource.value !== 'firestore') {
    return
  }

  const fields = editableConfigFields.value.map((field) => ({
    ...field,
    value: configDraft[field.key] ?? field.value,
  }))
  const candidate = await saveConfigCandidate(
    snapshot.value.sessionOverview.sessionId,
    currentConfigVersion.value,
    fields,
    `Draft snapshot derived from ${currentConfigVersion.value}`,
  )

  snapshot.value = {
    ...snapshot.value,
    configVersions: [candidate, ...snapshot.value.configVersions],
    configFields: fields,
  }
  selectConfigVersion(candidate)
}

async function applySelectedVersion(version: ConfigVersionRecord) {
  if (!snapshot.value || snapshotSource.value !== 'firestore') {
    return
  }

  await applyConfigVersion(
    snapshot.value.sessionOverview.sessionId,
    currentConfigVersion.value,
    version.version,
  )
  await refreshDashboard()
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
  loading.value = false
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
          <p v-if="snapshotWarning" class="status-warning">
            {{ snapshotWarning }}
          </p>
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
            <span>{{ sessionOverview?.configVersion }}</span>
          </div>
          <div class="overview-copy">
            <div>
              <span>Session ID</span>
              <strong>{{ sessionOverview?.sessionId }}</strong>
            </div>
            <div>
              <span>Updated</span>
              <strong>{{ sessionOverview?.updatedAt }}</strong>
            </div>
            <div>
              <span>Open windows</span>
              <strong>{{ sessionOverview?.openWindows }}</strong>
            </div>
            <div>
              <span>Rejected entries</span>
              <strong>{{ sessionOverview?.rejectedEntries }}</strong>
            </div>
          </div>
        </article>

        <article class="panel shell-placeholder" data-slot="chart">
          <div class="panel-header">
            <h2>Chart slot</h2>
            <span>Reserved for later wiring</span>
          </div>
          <p>
            This panel is intentionally left as a shell so a live chart can be wired without changing the page structure.
          </p>
        </article>

        <article class="panel shell-placeholder" data-slot="table">
          <div class="panel-header">
            <h2>Table slot</h2>
            <span>Reserved for triage data</span>
          </div>
          <p>
            Session rows and audit tables will plug into this area in the next story without reshaping the layout.
          </p>
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
          <span>{{ selectedConfigVersion?.status ?? 'draft' }}</span>
        </div>
        <div class="config-editor-bar">
          <p>
            Current session version: <strong>{{ sessionOverview?.configVersion }}</strong>
            <span v-if="selectedConfigVersion">Selected: {{ selectedConfigVersion.version }}</span>
          </p>
          <button type="button" class="action-button" :disabled="snapshotSource !== 'firestore'" @click="saveConfigVersion">
            Save candidate
          </button>
        </div>
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
            :class="{ active: selectedConfigVersion?.id === version.id }"
            @click="selectConfigVersion(version)"
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
                {{ version.status === 'candidate' ? 'Promote' : 'Rollback' }}
              </button>
            </div>
          </article>
        </div>
      </section>
    </template>
  </main>
</template>
