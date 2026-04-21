import { classifySignal, sampleSignals } from './engine'

describe('signal classification', () => {
  it('marks entry signals as entry', () => {
    expect(classifySignal(sampleSignals[0])).toBe('entry')
  })

  it('marks exit signals as exit', () => {
    expect(classifySignal(sampleSignals[2])).toBe('exit')
  })
})

