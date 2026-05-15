import type { TradingMode } from './api'
import type { TradingPositionMode } from './api'
import type { SignalTier } from './engine'

export const tradingTierKeys: SignalTier[] = [
  'conviction_buy',
  'balanced_buy',
  'opportunistic_buy',
  'speculative_buy',
]

export function tradingSettingsSignature(
  mode: TradingMode,
  positionMode: TradingPositionMode,
  allocations: Record<SignalTier, number>,
  stopLossPercent: number,
  rebuyMinDropPercent: number,
  rebuyMaxCount: number,
) {
  const normalizedAllocations: Record<string, number> = {}
  for (const tier of tradingTierKeys) {
    normalizedAllocations[tier] = Number(allocations[tier]) || 0
  }
  return JSON.stringify({
    mode,
    positionMode,
    allocations: normalizedAllocations,
    stopLossPercent: Number(stopLossPercent) || 0,
    rebuyMinDropPercent: Number(rebuyMinDropPercent) || 0,
    rebuyMaxCount: Number(rebuyMaxCount) || 0,
  })
}

export function isTradingSettingsDirty(
  loaded: boolean,
  baselineSignature: string,
  currentSignature: string,
) {
  return loaded && currentSignature !== baselineSignature
}
