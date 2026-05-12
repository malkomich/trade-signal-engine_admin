import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadTradingSettings, saveTradingSettings } from './api'

function createJsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => body,
  } as Response
}

describe('trading settings api', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects empty load responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => createJsonResponse(204, null)))

    await expect(loadTradingSettings('session-1')).rejects.toThrow('Unexpected empty response from server')
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
        stop_loss_percent: 0.1,
      }),
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

    const settings = await loadTradingSettings('session-1')

    expect(settings.tradingMode).toBe('live')
    expect(settings.tradingAllocations.conviction_buy).toBe(0)
    expect(settings.tradingAllocations.balanced_buy).toBe(1000)
    expect(settings.tradingAllocations.opportunistic_buy).toBe(1500)
    expect(settings.tradingAllocations.speculative_buy).toBe(0)
    expect(settings.tradingStopLossPercent).toBe(0.1)
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
})
