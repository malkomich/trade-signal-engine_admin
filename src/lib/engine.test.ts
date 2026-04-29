import { classifySignal, classifySignalTier, sampleSignals } from './engine'

describe('signal classification', () => {
  it('marks entry signals as buy', () => {
    expect(classifySignal(sampleSignals[0])).toBe('buy')
  })

  it('marks exit signals as sell', () => {
    expect(classifySignal(sampleSignals[2])).toBe('sell')
  })

  it('counts accepted windows as entry signals', () => {
    expect(classifySignal({ ...sampleSignals[0], state: 'ACCEPTED_OPEN' })).toBe('buy')
  })

  it('marks rejected signals as hold', () => {
    expect(classifySignal({ ...sampleSignals[0], state: 'REJECTED' })).toBe('hold')
  })

  it('marks expired signals as hold', () => {
    expect(classifySignal({ ...sampleSignals[0], state: 'EXPIRED' })).toBe('hold')
  })

  it('accepts explicit buy and sell signal labels', () => {
    expect(
      classifySignal({ ...sampleSignals[0], signalAction: 'BUY' }),
    ).toBe('buy')
    expect(
      classifySignal({ ...sampleSignals[2], signalAction: 'SELL' }),
    ).toBe('sell')
  })

  it('treats missing signal state as hold', () => {
    expect(
      classifySignal({ ...sampleSignals[0], state: undefined as never }),
    ).toBe('hold')
  })

  it('ignores stale buy tiers on sell signals', () => {
    expect(
      classifySignalTier({ ...sampleSignals[2], signalTier: 'conviction_buy' }),
    ).toBeNull()
  })

  it('infers buy tiers from score bands when the backend tier is absent', () => {
    expect(
      classifySignalTier({ ...sampleSignals[0], signalTier: null }),
    ).toBe('conviction_buy')
    expect(
      classifySignalTier({
        ...sampleSignals[0],
        signalTier: null,
        entryScore: 0.72,
        exitScore: 0.32,
      }),
    ).toBe('balanced_buy')
    expect(
      classifySignalTier({
        ...sampleSignals[0],
        signalTier: null,
        entryScore: 0.62,
        exitScore: 0.4,
      }),
    ).toBe('opportunistic_buy')
    expect(
      classifySignalTier({
        ...sampleSignals[0],
        signalTier: null,
        entryScore: 0.55,
        exitScore: 0.5,
      }),
    ).toBe('speculative_buy')
  })
})
