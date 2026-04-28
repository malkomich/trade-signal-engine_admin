import { vi } from 'vitest'
import { describe, expect, it } from 'vitest'

vi.mock('./firebase', () => ({
  rtdb: {},
}))

import { normalizeTimeframeLabel } from './dashboard'

describe('dashboard', () => {
  it('normalizes numeric and hour timeframe labels to canonical minute labels', () => {
    expect(normalizeTimeframeLabel('5')).toBe('5m')
    expect(normalizeTimeframeLabel('10 min')).toBe('10m')
    expect(normalizeTimeframeLabel('2 h')).toBe('120m')
  })

  it('preserves unknown timeframe labels as-is', () => {
    expect(normalizeTimeframeLabel('1d')).toBe('1d')
    expect(normalizeTimeframeLabel('')).toBe('1m')
  })
})
