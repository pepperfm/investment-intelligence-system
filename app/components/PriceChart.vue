<script setup lang="ts">
import type { Candle } from '#shared/types/investment'

const props = withDefaults(defineProps<{
  candles: Candle[]
  levels?: {
    label: string
    value: number
    color: 'error' | 'success' | 'info' | 'primary'
  }[]
  markers?: {
    ts: string
    label: string
  }[]
  height?: number
  /** Show the 1M/3M/6M/1Y selector. */
  ranges?: boolean
  indicators?: boolean
  defaultRange?: number
}>(), {
  levels: () => [],
  markers: () => [],
  height: 280,
  ranges: true,
  indicators: true,
  defaultRange: 126,
})

const RANGES = [
  {
    label: '1М',
    value: 21,
  },
  {
    label: '3М',
    value: 63,
  },
  {
    label: '6М',
    value: 126,
  },
  {
    label: '1Г',
    value: 250,
  },
]
const range = ref(props.defaultRange)
const width = 800
const pad = {
  top: 14,
  right: 64,
  bottom: 22,
  left: 4,
}
const hover = ref<number | null>(null)
const svg = useTemplateRef<SVGSVGElement>('svg')

const COLORS = {
  error: 'var(--ui-error)',
  success: 'var(--ui-success)',
  info: 'var(--ui-info)',
  primary: 'var(--ui-primary)',
}

const data = computed(() => {
  const all = props.candles
  if (!props.ranges) {
    return all
  }
  // Always keep marked dates (e.g. the idea date) inside the window.
  const firstMarker = props.markers.map(m => all.findIndex(c => c.ts >= m.ts)).filter(i => i >= 0).sort((a, b) => a - b)[0]
  const start = Math.max(0, Math.min(all.length - range.value, firstMarker !== undefined ? firstMarker - 10 : Infinity))
  return all.slice(start)
})

const view = computed(() => {
  const rows = data.value
  if (rows.length < 2) {
    return null
  }
  const values = [...rows.flatMap(c => [c.high, c.low]), ...props.levels.map(l => l.value)]
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = (max - min) || 1
  const h = props.height - pad.top - pad.bottom
  const w = width - pad.left - pad.right
  const x = (i: number) => pad.left + (i / (rows.length - 1)) * w
  const y = (v: number) => pad.top + (1 - (v - min) / span) * h
  const line = rows.map((c, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(c.close).toFixed(1)}`).join('')
  const sma = (period: number) => {
    const source = props.candles
    const offset = source.length - rows.length
    const points: string[] = []
    rows.forEach((_, i) => {
      const end = offset + i
      if (end + 1 < period) {
        return
      }
      let sum = 0
      for (let j = end - period + 1; j <= end; j++) {
        sum += source[j]!.close
      }
      points.push(`${points.length ? 'L' : 'M'}${x(i).toFixed(1)},${y(sum / period).toFixed(1)}`)
    })
    return points.join('')
  }
  const up = rows.at(-1)!.close >= rows[0]!.close
  return {
    x,
    y,
    line,
    area: `${line}L${x(rows.length - 1).toFixed(1)},${pad.top + h}L${x(0).toFixed(1)},${pad.top + h}Z`,
    sma20: props.indicators ? sma(20) : '',
    sma50: props.indicators ? sma(50) : '',
    up,
    // Axis labels give way to level pills so the two never overlap.
    ticks: [0, 0.25, 0.5, 0.75, 1].map(t => min + span * t).map(v => ({
      y: y(v),
      label: fmtNum(v),
    })).filter(t => props.levels.every(l => Math.abs(y(l.value) - t.y) > 14)),
    levels: props.levels.map(l => ({
      ...l,
      y: y(l.value),
      stroke: COLORS[l.color],
    })),
    markers: props.markers.map((m) => {
      const i = rows.findIndex(c => c.ts >= m.ts)
      return i >= 0
        ? {
            x: x(i),
            label: m.label,
          }
        : null
    }).filter(Boolean) as {
      x: number
      label: string
    }[],
    change: rows.at(-1)!.close / rows[0]!.close - 1,
    bottom: pad.top + h,
  }
})

const hovered = computed(() => hover.value === null ? null : data.value[hover.value] ?? null)
const lastCandle = computed(() => data.value.at(-1) ?? null)
const shown = computed(() => hovered.value ?? lastCandle.value)

function onMove(event: PointerEvent) {
  const el = svg.value
  if (!el || data.value.length < 2) {
    return
  }
  const rect = el.getBoundingClientRect()
  const px = ((event.clientX - rect.left) / rect.width) * width
  const ratio = (px - pad.left) / (width - pad.left - pad.right)
  hover.value = Math.max(0, Math.min(data.value.length - 1, Math.round(ratio * (data.value.length - 1))))
}
</script>

<template>
  <div class="w-full">
    <div class="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      <template v-if="shown">
        <span class="text-muted">{{ fmtDate(shown.ts) }}</span>
        <span><span class="text-muted">O</span> <span class="num">{{ fmtNum(shown.open) }}</span></span>
        <span><span class="text-muted">H</span> <span class="num">{{ fmtNum(shown.high) }}</span></span>
        <span><span class="text-muted">L</span> <span class="num">{{ fmtNum(shown.low) }}</span></span>
        <span><span class="text-muted">C</span> <span class="num text-highlighted">{{ fmtNum(shown.close) }}</span></span>
        <DeltaValue v-if="view && !hovered" :value="view.change" />
      </template>
      <div v-if="ranges && candles.length > 30" class="ml-auto flex gap-0.5 rounded-md bg-elevated p-0.5">
        <button
          v-for="r in RANGES"
          :key="r.value"
          type="button"
          class="rounded px-2 py-0.5 text-[11px] font-medium transition-colors"
          :class="range === r.value ? 'bg-default text-highlighted shadow-xs' : 'text-muted hover:text-default'"
          @click="range = r.value"
        >
          {{ r.label }}
        </button>
      </div>
    </div>
    <svg
      v-if="view"
      ref="svg"
      :viewBox="`0 0 ${width} ${height}`"
      class="h-auto w-full touch-none select-none"
      role="img"
      aria-label="График цены закрытия"
      @pointermove="onMove"
      @pointerleave="hover = null"
    >
      <defs>
        <linearGradient
          id="price-fill"
          x1="0"
          x2="0"
          y1="0"
          y2="1"
        >
          <stop
            offset="0%"
            :stop-color="view.up ? 'var(--ui-success)' : 'var(--ui-error)'"
            stop-opacity="0.22"
          />
          <stop
            offset="100%"
            :stop-color="view.up ? 'var(--ui-success)' : 'var(--ui-error)'"
            stop-opacity="0"
          />
        </linearGradient>
      </defs>
      <line
        v-for="t in view.ticks"
        :key="t.y"
        :x1="pad.left"
        :x2="width - pad.right"
        :y1="t.y"
        :y2="t.y"
        stroke="var(--ui-border)"
        stroke-dasharray="2 4"
      />
      <text
        v-for="t in view.ticks"
        :key="`t${t.y}`"
        :x="width - pad.right + 8"
        :y="t.y + 4"
        class="num fill-(--ui-text-dimmed) text-[10px]"
      >{{ t.label }}</text>
      <path :d="view.area" fill="url(#price-fill)" />
      <path
        v-if="indicators"
        :d="view.sma50"
        fill="none"
        stroke="var(--ui-warning)"
        stroke-width="1"
        opacity="0.55"
      />
      <path
        v-if="indicators"
        :d="view.sma20"
        fill="none"
        stroke="var(--ui-info)"
        stroke-width="1"
        opacity="0.55"
      />
      <path
        :d="view.line"
        fill="none"
        :stroke="view.up ? 'var(--ui-success)' : 'var(--ui-error)'"
        stroke-width="1.75"
        stroke-linejoin="round"
      />
      <g v-for="m in view.markers" :key="m.label">
        <line
          :x1="m.x"
          :x2="m.x"
          :y1="pad.top"
          :y2="view.bottom"
          stroke="var(--ui-text-muted)"
          stroke-dasharray="3 3"
        />
        <text
          :x="m.x + 4"
          :y="pad.top + 9"
          class="fill-(--ui-text-muted) text-[10px]"
        >{{ m.label }}</text>
      </g>
      <g v-for="l in view.levels" :key="l.label">
        <line
          :x1="pad.left"
          :x2="width - pad.right"
          :y1="l.y"
          :y2="l.y"
          :stroke="l.stroke"
          stroke-dasharray="5 4"
          stroke-width="1.2"
        />
        <rect
          :x="width - pad.right + 2"
          :y="l.y - 8"
          :width="pad.right - 4"
          height="16"
          rx="3"
          :fill="l.stroke"
        />
        <text
          :x="width - pad.right / 2"
          :y="l.y + 3.5"
          text-anchor="middle"
          class="num fill-(--ui-bg) text-[10px] font-semibold"
        >{{ fmtNum(l.value) }}</text>
      </g>
      <g v-if="hover !== null && hovered">
        <line
          :x1="view.x(hover)"
          :x2="view.x(hover)"
          :y1="pad.top"
          :y2="view.bottom"
          stroke="var(--ui-text-dimmed)"
        />
        <circle
          :cx="view.x(hover)"
          :cy="view.y(hovered.close)"
          r="3.5"
          fill="var(--ui-bg)"
          :stroke="view.up ? 'var(--ui-success)' : 'var(--ui-error)'"
          stroke-width="2"
        />
      </g>
      <text
        :x="pad.left"
        :y="height - 6"
        class="fill-(--ui-text-dimmed) text-[10px]"
      >{{ fmtDate(data[0]!.ts) }}</text>
      <text
        :x="width - pad.right"
        :y="height - 6"
        text-anchor="end"
        class="fill-(--ui-text-dimmed) text-[10px]"
      >{{ fmtDate(data.at(-1)!.ts) }}</text>
    </svg>
    <UEmpty
      v-else
      icon="i-lucide-chart-no-axes-combined"
      title="Нет котировок"
      description="Обновите данные, чтобы построить график."
      size="sm"
    />
    <div v-if="view" class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
      <span class="flex items-center gap-1.5"><span class="h-0.5 w-3 rounded" :class="view.up ? 'bg-success' : 'bg-error'" />Закрытие</span>
      <span v-if="indicators" class="flex items-center gap-1.5"><span class="h-0.5 w-3 rounded bg-info" />SMA20</span>
      <span v-if="indicators" class="flex items-center gap-1.5"><span class="h-0.5 w-3 rounded bg-warning" />SMA50</span>
      <span
        v-for="l in levels"
        :key="l.label"
        class="flex items-center gap-1.5"
      ><span class="h-0.5 w-3 rounded" :style="{ background: COLORS[l.color] }" />{{ l.label }}</span>
    </div>
  </div>
</template>
