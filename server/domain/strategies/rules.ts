import { DEFAULT_MIN_REWARD_RISK, type Candle, type StrategyId, type StrategyRules } from '../../../shared/types/investment'
import { benchmarkNeed, benchmarkWindowIssues } from '../market/dependencies'
import { computeMetrics, type MarketMetrics } from '../market/indicators'

export const DEFAULT_RULES: Record<StrategyId, StrategyRules> = {
  swing: {
    horizonDays: 10,
    trendSma: 50,
    slowSma: 200,
    rsiPeriod: 14,
    rsiMin: 38,
    rsiMax: 62,
    breakoutLookback: 20,
    momentumLookback: 20,
    minMomentum: -0.05,
    atrPeriod: 14,
    stopAtr: 2,
    targetAtr: 3,
    minAvgTurnover: 50_000_000,
    entryValidDays: 3,
    maxVolatility: 0.6,
    allowPullback: true,
    minRewardRisk: 1.2,
    regimeSma: 0,
  },
  position: {
    horizonDays: 60,
    trendSma: 50,
    slowSma: 200,
    rsiPeriod: 14,
    rsiMin: 40,
    rsiMax: 72,
    breakoutLookback: 55,
    momentumLookback: 120,
    minMomentum: 0.03,
    atrPeriod: 14,
    stopAtr: 3.5,
    targetAtr: 7,
    minAvgTurnover: 30_000_000,
    entryValidDays: 5,
    maxVolatility: 0.5,
    minRewardRisk: 1.2,
    regimeSma: 0,
  },
}

export const STRATEGY_INFO: Record<StrategyId, {
  name: string
  description: string
}> = {
  swing: {
    name: 'Swing',
    description: 'Сделки на дни: откат или пробой в направлении среднесрочного тренда, стоп по ATR, горизонт ~2 недели.',
  },
  position: {
    name: 'Position',
    description: 'Позиции на недели/месяцы: долгосрочный восходящий тренд, положительный моментум, широкий стоп по ATR.',
  },
}

export interface Signal {
  setup: boolean
  setupType: 'pullback' | 'breakout' | 'trend' | 'none'
  reasons: string[]
  failures: string[]
  entry: number | null
  stopLoss: number | null
  takeProfit: number | null
  rewardRisk: number | null
  metrics: MarketMetrics
}

function round(value: number) {
  return Math.round(value * 10_000) / 10_000
}

/**
 * Deterministic screen. LLMs never compute these numbers: they only interpret them.
 * Long-only; no leverage.
 */
export function evaluateSignal(strategy: StrategyId, rules: StrategyRules, candles: Candle[], benchmark: Candle[] = []): Signal {
  const metrics = computeMetrics(candles)
  const failures: string[] = []
  const reasons: string[] = []
  const closes = candles.map(c => c.close)
  const close = metrics.close
  const fast = smaOf(closes, rules.trendSma)
  const slow = smaOf(closes, rules.slowSma)
  const rsiValue = metrics.rsi14
  const mom = closes.length > rules.momentumLookback ? closes.at(-1)! / closes.at(-1 - rules.momentumLookback)! - 1 : null
  const breakoutLevel = highestHigh(candles, rules.breakoutLookback)
  const atrValue = metrics.atr14
  if (close === null || fast === null || atrValue === null) {
    return {
      setup: false,
      setupType: 'none',
      reasons,
      failures: ['Недостаточно истории котировок для расчёта индикаторов'],
      entry: null,
      stopLoss: null,
      takeProfit: null,
      rewardRisk: null,
      metrics,
    }
  }
  if (benchmarkNeed(rules) === 'required_for_signal') {
    // Point-in-time: never look at index bars after the instrument's last bar.
    const lastTs = candles.at(-1)!.ts
    const index = benchmark.filter(c => c.ts <= lastTs).map(c => c.close)
    const regime = smaOf(index, rules.regimeSma!)
    const dependencyIssues = benchmarkWindowIssues(candles, benchmark, rules.regimeSma!)
    if (dependencyIssues.length) {
      failures.push(`Нет данных индекса на полной сопоставимой оси фильтра режима: ${dependencyIssues.join('; ')}`)
    } else if (regime === null) {
      failures.push(`Нет данных индекса для фильтра режима (нужно ${rules.regimeSma} дн.)`)
    } else if (index.at(-1)! <= regime) {
      failures.push(`Рыночный режим: индекс ${fmt(index.at(-1))} не выше SMA${rules.regimeSma} ${fmt(regime)}`)
    } else {
      reasons.push(`Рыночный режим: индекс выше SMA${rules.regimeSma} (${fmt(index.at(-1))} > ${fmt(regime)})`)
    }
  }
  if ((metrics.avgTurnover20 ?? 0) < rules.minAvgTurnover) {
    failures.push(`Ликвидность ниже порога: средний оборот ${fmt(metrics.avgTurnover20)} < ${fmt(rules.minAvgTurnover)}`)
  }
  if ((metrics.volatility60 ?? 0) > rules.maxVolatility) {
    failures.push(`Волатильность ${pct(metrics.volatility60)} выше допустимой ${pct(rules.maxVolatility)}`)
  }
  if (mom === null || mom < rules.minMomentum) {
    failures.push(`Моментум ${pct(mom)} за ${rules.momentumLookback} дн. ниже порога ${pct(rules.minMomentum)}`)
  } else {
    reasons.push(`Моментум ${pct(mom)} за ${rules.momentumLookback} дн.`)
  }
  let setupType: Signal['setupType'] = 'none'
  if (strategy === 'swing') {
    if (close < fast) {
      failures.push(`Цена ${fmt(close)} ниже SMA${rules.trendSma} ${fmt(fast)}: нет восходящего тренда`)
    } else {
      reasons.push(`Цена выше SMA${rules.trendSma}`)
    }
    if (breakoutLevel !== null && close > breakoutLevel) {
      setupType = 'breakout'
      reasons.push(rules.allowPullback === false
        ? `Пробой максимума ${rules.breakoutLookback} дн. (${fmt(breakoutLevel)}); RSI в этой версии правил не используется`
        : `Пробой максимума ${rules.breakoutLookback} дн. (${fmt(breakoutLevel)}); по правилам Swing RSI-фильтр ${rules.rsiMin}–${rules.rsiMax} применяется только к откату, не к пробою`)
    } else if (rules.allowPullback === false) {
      failures.push(`Нет пробоя максимума ${rules.breakoutLookback} дн.; сетап «откат» отключён в этой версии правил`)
    } else if (rsiValue !== null && rsiValue >= rules.rsiMin && rsiValue <= rules.rsiMax) {
      setupType = 'pullback'
      reasons.push(`RSI14 ${rsiValue.toFixed(1)} в зоне отката ${rules.rsiMin}–${rules.rsiMax}`)
    } else {
      failures.push(`Нет сетапа: RSI14 ${rsiValue?.toFixed(1) ?? '—'} вне ${rules.rsiMin}–${rules.rsiMax} и нет пробоя`)
    }
  } else {
    if (slow === null) {
      failures.push(`Недостаточно истории для SMA${rules.slowSma}`)
    } else if (close < slow || fast < slow) {
      failures.push(`Нет долгосрочного тренда: цена/SMA${rules.trendSma} ниже SMA${rules.slowSma}`)
    } else {
      setupType = 'trend'
      reasons.push(`Цена и SMA${rules.trendSma} выше SMA${rules.slowSma}`)
    }
    if (rsiValue !== null && (rsiValue < rules.rsiMin || rsiValue > rules.rsiMax)) {
      failures.push(`RSI14 ${rsiValue.toFixed(1)} вне ${rules.rsiMin}–${rules.rsiMax} (перегрев или слабость)`)
    }
  }
  const entry = close
  const stopLoss = Math.max(entry - rules.stopAtr * atrValue, entry * 0.5)
  const takeProfit = entry + rules.targetAtr * atrValue
  const rewardRisk = round((takeProfit - entry) / (entry - stopLoss))
  const minRewardRisk = rules.minRewardRisk ?? DEFAULT_MIN_REWARD_RISK
  if (rewardRisk + 1e-9 < minRewardRisk) {
    failures.push(`Прибыль/риск ${rewardRisk.toFixed(2)} ниже минимума версии ${minRewardRisk}`)
  }
  return {
    setup: failures.length === 0 && setupType !== 'none',
    setupType,
    reasons,
    failures,
    entry: round(entry),
    stopLoss: round(stopLoss),
    takeProfit: round(takeProfit),
    rewardRisk,
    metrics,
  }
}

function smaOf(values: number[], period: number) {
  if (values.length < period) {
    return null
  }
  return values.slice(-period).reduce((a, b) => a + b, 0) / period
}

function highestHigh(candles: Candle[], lookback: number) {
  if (candles.length <= lookback) {
    return null
  }
  return Math.max(...candles.slice(-lookback - 1, -1).map(c => c.high))
}

export function fmt(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—'
  }
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2 }).format(value)
}

export function pct(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—'
  }
  return `${(value * 100).toFixed(1)}%`
}
