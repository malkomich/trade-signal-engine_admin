import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadTradingAccount, loadTradingSettings, saveTradingSettings } from './api'

function createJsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => body,
  } as Response
}

describe('trading settings api', () => {
  const nowIso = '2026-05-12T10:00:00Z'

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects empty load responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => createJsonResponse(204, null)))

    await expect(loadTradingSettings('session-1', nowIso)).rejects.toThrow('Unexpected empty response from server')
  })

  it('rejects empty save responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => createJsonResponse(204, null)))

    await expect(
      saveTradingSettings('session-1', {
        mode: 'paper',
        allocations: {
          conviction_buy: 1000,
          balanced_buy: 1000,
          opportunistic_buy: 1000,
          speculative_buy: 1000,
        },
        stop_loss_percent: 0.2,
      }, nowIso),
    ).rejects.toThrow('Unexpected empty response from server')
  })

  it('preserves zero allocations and falls back on invalid numeric values', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        createJsonResponse(200, {
          session_id: 'session-1',
          trading_mode: 'live',
          trading_allocations: {
            conviction_buy: 0,
            balanced_buy: 'NaN',
            opportunistic_buy: 1500,
          speculative_buy: 0,
          },
          trading_stop_loss_percent: 'NaN',
          trading_account: {
            mode: 'live',
            status: 'active',
            buying_power: 'not-a-number',
            cash: '1000.5',
            equity: 'NaN',
            portfolio_value: '2000.75',
            updated_at: '2026-05-12T10:00:00Z',
          },
          updated_at: '2026-05-12T10:00:00Z',
        }),
      ),
    )

    const settings = await loadTradingSettings('session-1', nowIso)

    expect(settings.tradingMode).toBe('live')
    expect(settings.tradingAllocations.conviction_buy).toBe(0)
    expect(settings.tradingAllocations.balanced_buy).toBe(1000)
    expect(settings.tradingAllocations.opportunistic_buy).toBe(1500)
    expect(settings.tradingAllocations.speculative_buy).toBe(0)
    expect(settings.tradingStopLossPercent).toBe(0.2)
    expect(settings.tradingAccount).toEqual({
      mode: 'live',
      status: 'active',
      buyingPower: 0,
      cash: 1000.5,
      equity: 0,
      portfolioValue: 2000.75,
      updatedAt: '2026-05-12T10:00:00Z',
    })
  })

  it('loads trading accounts by mode', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        createJsonResponse(200, {
          session_id: 'session-1',
          trading_mode: 'live',
          trading_account: {
            mode: 'live',
            status: 'active',
            buying_power: '4321.00',
            cash: '100.50',
            equity: '5000.00',
            portfolio_value: '5100.50',
            updated_at: '2026-05-12T10:00:00Z',
          },
          trading_updated_at: '2026-05-12T10:00:00Z',
        }),
      ),
    )

    const account = await loadTradingAccount('session-1', 'live', nowIso)

    expect(account).toEqual({
      mode: 'live',
      status: 'active',
      buyingPower: 4321,
      cash: 100.5,
      equity: 5000,
      portfolioValue: 5100.5,
      updatedAt: '2026-05-12T10:00:00Z',
    })
  })

  it('returns null when trading account payload is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        createJsonResponse(200, {
          session_id: 'session-1',
          trading_mode: 'live',
          trading_account: null,
          trading_updated_at: null,
        }),
      ),
    )

    const account = await loadTradingAccount('session-1', 'live', nowIso)

    expect(account).toBeNull()
  })
})
