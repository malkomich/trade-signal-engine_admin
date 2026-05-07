import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  loadPersistedChoice,
  loadPersistedString,
  persistChoice,
} from './persistence'

describe('persistence', () => {
  afterEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('loads persisted strings when available', () => {
    window.localStorage.setItem('admin.selectedDecisionSymbol', 'NVDA')

    expect(loadPersistedString('admin.selectedDecisionSymbol', 'ALL')).toBe('NVDA')
  })

  it('falls back when persisted choice is invalid', () => {
    window.localStorage.setItem('admin.displayTimezone', 'utc')

    expect(
      loadPersistedChoice('admin.displayTimezone', 'new_york', ['local', 'new_york']),
    ).toBe('new_york')
  })

  it('persists values to localStorage', () => {
    persistChoice('admin.selectedWindowSymbol', 'TSLA')

    expect(window.localStorage.getItem('admin.selectedWindowSymbol')).toBe('TSLA')
  })
})
