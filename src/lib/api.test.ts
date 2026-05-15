import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_TRADING_POSITION_MODE,
  DEFAULT_TRADING_REBUY_MAX_COUNT,
  DEFAULT_TRADING_REBUY_MIN_DROP_PERCENT,
  loadTradingAccount,
  loadTradingSettings,
  saveTradingSettings,
} from './api'

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
        trading_position_mode: 'stop_loss',
        allocations: {
          conviction_buy: 1000,
          balanced_buy: 1000,
          opportunistic_buy: 1000,
          speculative_buy: 1000,
        },
        stop_loss_percent: 0.2,
        rebuy_min_drop_percent: 0.5,
        rebuy_max_rebuys: 2,
      }, nowIso),
    ).rejects.toThrow('Unexpected empty response from server')
  })

  it('exposes default trading constants', () => {
    expect(DEFAULT_TRADING_POSITION_MODE).toBe('stop_loss')
    expect(DEFAULT_TRADING_REBUY_MIN_DROP_PERCENT).toBe(0.5)
    expect(DEFAULT_TRADING_REBUY_MAX_COUNT).toBe(2)
  })

  it('sends trading settings payload with position management fields', async () => {
    let capturedBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input, init) => {
        capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        return createJsonResponse(200, {
          session_id: 'session-1',
          trading_mode: 'live',
          trading_position_mode: 'rebuy',
          trading_allocations: {
            conviction_buy: 1000,
            balanced_buy: 1000,
            opportunistic_buy: 1000,
            speculative_buy: 1000,
          },
          trading_stop_loss_percent: 0.2,
          trading_rebuy_min_drop_percent: 1.25,
          trading_rebuy_max_rebuys: 4,
          trading_account: null,
          trading_account_error: null,
          trading_updated_at: null,
          updated_at: nowIso,
        })
      }),
    )

    const snapshot = await saveTradingSettings('session-1', {
      mode: 'live',
      trading_position_mode: 'rebuy',
      allocations: {
        conviction_buy: 1000,
        balanced_buy: 1000,
        opportunistic_buy: 1000,
        speculative_buy: 1000,
      },
      stop_loss_percent: 0.2,
      rebuy_min_drop_percent: 1.25,
      rebuy_max_rebuys: 4,
    }, nowIso)

    expect(capturedBody).toEqual({
      session_id: 'session-1',
      mode: 'live',
      trading_position_mode: 'rebuy',
      allocations: {
        conviction_buy: 1000,
        balanced_buy: 1000,
        opportunistic_buy: 1000,
        speculative_buy: 1000,
      },
      stop_loss_percent: 0.2,
      rebuy_min_drop_percent: 1.25,
      rebuy_max_rebuys: 4,
    })
    expect(snapshot.tradingPositionMode).toBe('rebuy')
    expect(snapshot.tradingRebuyMinDropPercent).toBe(1.25)
    expect(snapshot.tradingRebuyMaxCount).toBe(4)
  })

  it('preserves zero allocations and falls back on invalid numeric values', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        createJsonResponse(200, {
          session_id: 'session-1',
          trading_mode: 'live',
          trading_position_mode: 'rebuy',
          trading_allocations: {
            conviction_buy: 0,
            balanced_buy: 'NaN',
            opportunistic_buy: 1500,
          speculative_buy: 0,
          },
          trading_stop_loss_percent: 'NaN',
          trading_rebuy_min_drop_percent: '1.5',
          trading_rebuy_max_rebuys: '3',
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
    expect(settings.tradingPositionMode).toBe('rebuy')
    expect(settings.tradingAllocations.conviction_buy).toBe(0)
    expect(settings.tradingAllocations.balanced_buy).toBe(1000)
    expect(settings.tradingAllocations.opportunistic_buy).toBe(1500)
    expect(settings.tradingAllocations.speculative_buy).toBe(0)
    expect(settings.tradingStopLossPercent).toBe(0.2)
    expect(settings.tradingRebuyMinDropPercent).toBe(1.5)
    expect(settings.tradingRebuyMaxCount).toBe(3)
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
          trading_position_mode: 'stop_loss',
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

  it('returns the account when the payload includes both an error and a snapshot', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        createJsonResponse(200, {
          session_id: 'session-1',
          trading_mode: 'live',
          trading_position_mode: 'stop_loss',
          trading_account: {
            mode: 'live',
            status: 'active',
            buying_power: '4321.00',
            cash: '100.50',
            equity: '5000.00',
            portfolio_value: '5100.50',
            updated_at: '2026-05-12T10:00:00Z',
          },
          trading_account_error: 'alpaca live trading credentials not configured',
          trading_updated_at: '2026-05-12T10:00:00Z',
        }),
      ),
    )

    await expect(loadTradingAccount('session-1', 'live', nowIso)).resolves.toEqual({
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
          trading_position_mode: 'stop_loss',
          trading_account: null,
          trading_updated_at: null,
        }),
      ),
    )

    const account = await loadTradingAccount('session-1', 'live', nowIso)

    expect(account).toBeNull()
  })
})
