<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { classifySignal } from './lib/engine'
import { loadDashboardSnapshot, type DashboardSnapshot } from './lib/dashboard'

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
const error = ref<string | null>(null)

onMounted(async () => {
  try {
    snapshot.value = await loadDashboardSnapshot()
    const loaded = snapshot.value
    selectedSignal.value = loaded.selectedSignal
    sessionOverview.value = loaded.sessionOverview
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
          <strong>{{ sessionOverview?.status ?? 'Session live' }}</strong>
          <p>{{ sessionOverview?.summary ?? 'Next market window runs with frozen config version v18.' }}</p>
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

        <article class="panel shell-placeholder">
          <div class="panel-header">
            <h2>Chart slot</h2>
            <span>Reserved for later wiring</span>
          </div>
          <p>
            This panel is intentionally left as a shell so a live chart can be wired without changing the page structure.
          </p>
        </article>

        <article class="panel shell-placeholder">
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
            <h2>Active signals</h2>
            <span>Live triage</span>
          </div>
          <div class="signal-list">
            <button
              v-for="signal in snapshot?.signals ?? []"
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
            <span>{{ snapshot?.selectedSignal.symbol }}</span>
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
