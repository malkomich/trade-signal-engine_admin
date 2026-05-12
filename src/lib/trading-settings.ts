import type { TradingMode } from './api'
import type { SignalTier } from './engine'

export const tradingTierKeys: SignalTier[] = [
  'conviction_buy',
  'balanced_buy',
  'opportunistic_buy',
  'speculative_buy',
]

export function tradingSettingsSignature(
  mode: TradingMode,
  allocations: Record<SignalTier, number>,
  stopLossPercent: number,
) {
  const normalizedAllocations: Record<string, number> = {}
  for (const tier of tradingTierKeys) {
    normalizedAllocations[tier] = Number(allocations[tier]) || 0
  }
  return JSON.stringify({
    mode,
    allocations: normalizedAllocations,
    stopLossPercent: Number(stopLossPercent) || 0,
  })
}

export function isTradingSettingsDirty(
  loaded: boolean,
  baselineSignature: string,
  currentSignature: string,
) {
  return loaded && currentSignature !== baselineSignature
}
