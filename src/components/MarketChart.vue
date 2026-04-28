<script setup lang="ts">
import * as echarts from 'echarts'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { EChartsOption } from 'echarts'
import type { MarketSnapshotRecord } from '../lib/dashboard'
import type { ChartDefinition } from '../lib/chart-definitions'
import { buildChartOption } from '../lib/charting'

const props = defineProps<{
  chart: ChartDefinition
  snapshots: MarketSnapshotRecord[]
  intervalMinutes: 1 | 5 | 10 | 30 | 60
  windowId?: string | null
  height?: number
}>()

const chartHost = ref<HTMLDivElement | null>(null)
let chartInstance: echarts.ECharts | null = null
let resizeObserver: ResizeObserver | null = null

function renderChart() {
  if (!chartInstance) {
    return
  }
  const option: EChartsOption = buildChartOption(
    props.chart,
    props.snapshots,
    props.intervalMinutes,
    props.windowId,
  )
  chartInstance.setOption(option, true)
}

onMounted(() => {
  if (!chartHost.value) {
    return
  }
  chartInstance = echarts.init(chartHost.value, undefined, {
    renderer: 'canvas',
  })
  renderChart()
  resizeObserver = new ResizeObserver(() => {
    chartInstance?.resize()
  })
  resizeObserver.observe(chartHost.value)
})

watch(
  () => [props.chart.id, props.intervalMinutes, props.windowId, props.snapshots],
  () => {
    renderChart()
  },
  { deep: true },
)

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  chartInstance?.dispose()
  chartInstance = null
})
</script>

<template>
  <div ref="chartHost" class="market-chart" :style="{ height: `${height ?? 360}px` }" />
</template>
