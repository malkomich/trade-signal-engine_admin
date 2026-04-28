import { classifySignal, sampleSignals } from './engine'

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
})
