<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { signInAnonymously } from 'firebase/auth'
import { classifySignal } from './lib/engine'
import { auth } from './lib/firebase'
import { loadDashboardSnapshot, type DashboardSnapshot } from './lib/dashboard'

const snapshot = ref<DashboardSnapshot | null>(null)
const selectedSignal = ref<DashboardSnapshot['selectedSignal'] | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const authState = ref<'booting' | 'authenticating' | 'authenticated' | 'offline'>('booting')
const triageFilter = ref<'all' | 'entry' | 'exit' | 'hold'>('all')
const triageFilters = ['all', 'entry', 'exit', 'hold'] as const

const triageSignals = computed(() => {
  const signals = snapshot.value?.signals ?? []
  if (triageFilter.value === 'all') {
    return signals
  }
  return signals.filter((signal) => classifySignal(signal) === triageFilter.value)
})

watch(
  triageSignals,
  (signals) => {
    if (signals.length === 0) {
      selectedSignal.value = snapshot.value?.selectedSignal ?? null
      return
    }

    if (!selectedSignal.value || !signals.some((signal) => signal.symbol === selectedSignal.value?.symbol)) {
      selectedSignal.value = signals[0]
    }
  },
  { immediate: true },
)

function setTriageFilter(filter: (typeof triageFilters)[number]) {
  triageFilter.value = filter
}

function triageCount(filter: (typeof triageFilters)[number]) {
  const signals = snapshot.value?.signals ?? []
  if (filter === 'all') {
    return signals.length
  }
  return signals.filter((signal) => classifySignal(signal) === filter).length
}

onMounted(async () => {
  try {
    authState.value = 'authenticating'
    await signInAnonymously(auth)
    authState.value = 'authenticated'
  } catch {
    authState.value = 'offline'
  }

  try {
    snapshot.value = await loadDashboardSnapshot()
    selectedSignal.value = snapshot.value.selectedSignal
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load dashboard'
  } finally {
    loading.value = false
  }
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
          <strong>
            {{
              authState === 'authenticated'
                ? 'Authenticated read model'
                : authState === 'offline'
                  ? 'Offline fallback'
                  : 'Signing in'
            }}
          </strong>
          <p>
            {{
              authState === 'authenticated'
                ? 'Firestore access is gated by Firebase Auth before the dashboard reads live operational data.'
                : 'The dashboard is preparing an authenticated Firestore session and falling back to sample data if required.'
            }}
          </p>
        </div>
      </div>
    </section>

    <section v-if="loading" class="panel">
      Loading dashboard data...
    </section>

    <section v-else-if="error" class="panel">
      <strong>Dashboard unavailable</strong>
      <p>{{ error }}</p>
    </section>

    <template v-else>
      <section class="metrics">
        <article v-for="metric in snapshot?.metrics ?? []" :key="metric.label" class="metric-card">
          <span>{{ metric.label }}</span>
          <strong>{{ metric.value }}</strong>
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
              @click="setTriageFilter(filter)"
            >
              <span>{{ filter }}</span>
              <strong>{{ triageCount(filter) }}</strong>
            </button>
          </div>
          <div class="signal-list">
            <button
              v-for="signal in triageSignals"
              :key="signal.symbol"
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
          <span>Session-scoped weights</span>
        </div>
        <div class="config-grid">
          <article v-for="field in snapshot?.configFields ?? []" :key="field.key" class="config-card">
            <label :for="field.key">{{ field.key }}</label>
            <input :id="field.key" type="number" :value="field.value" step="0.01" />
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
          <article v-for="version in snapshot?.configVersions ?? []" :key="version.version" class="signal-row history-row">
            <div>
              <strong>{{ version.version }}</strong>
              <p>{{ version.summary }}</p>
            </div>
            <div class="scores">
              <span>{{ version.status }}</span>
              <span>{{ version.updatedAt }}</span>
            </div>
          </article>
        </div>
      </section>
    </template>
  </main>
</template>
