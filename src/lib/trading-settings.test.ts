import { describe, expect, it } from 'vitest'
import { tradingSettingsSignature, isTradingSettingsDirty, tradingTierKeys } from './trading-settings'

const allocations = {
  conviction_buy: 1200,
  balanced_buy: 1000,
  opportunistic_buy: 800,
  speculative_buy: 600,
}

describe('trading settings helpers', () => {
  it('builds signatures from the configured tier keys', () => {
    expect(tradingTierKeys).toEqual([
      'conviction_buy',
      'balanced_buy',
      'opportunistic_buy',
      'speculative_buy',
    ])
    expect(tradingSettingsSignature('paper', allocations, 0.1)).toBe(
      '{"mode":"paper","allocations":{"conviction_buy":1200,"balanced_buy":1000,"opportunistic_buy":800,"speculative_buy":600},"stopLossPercent":0.1}',
    )
  })

  it('detects dirty state and clears it on revert', () => {
    const baseline = tradingSettingsSignature('paper', allocations, 0.1)
    const modified = tradingSettingsSignature('live', { ...allocations, speculative_buy: 650 }, 0.1)

    expect(isTradingSettingsDirty(true, baseline, baseline)).toBe(false)
    expect(isTradingSettingsDirty(true, baseline, modified)).toBe(true)
    expect(isTradingSettingsDirty(false, baseline, modified)).toBe(false)
  })
})
