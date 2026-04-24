import { classifySignal, sampleSignals } from './engine'

describe('signal classification', () => {
  it('marks entry signals as entry', () => {
    expect(classifySignal(sampleSignals[0])).toBe('entry')
  })

  it('marks exit signals as exit', () => {
    expect(classifySignal(sampleSignals[2])).toBe('exit')
  })

  it('counts accepted windows as entry signals', () => {
    expect(classifySignal({ ...sampleSignals[0], state: 'ACCEPTED_OPEN' })).toBe('entry')
  })

  it('marks rejected signals as hold', () => {
    expect(classifySignal({ ...sampleSignals[0], state: 'REJECTED' })).toBe('hold')
  })

  it('marks expired signals as hold', () => {
    expect(classifySignal({ ...sampleSignals[0], state: 'EXPIRED' })).toBe('hold')
  })
})
