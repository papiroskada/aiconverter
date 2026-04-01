import { describe, it, expect, vi, beforeEach } from 'vitest'
import { startBatchAnalysis } from '../../src/services/batchService.js'

vi.mock('../../src/models/applications.js', () => ({
  getApplicationPrograms: vi.fn(),
  updateApplicationStatus: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../src/models/settings.js', () => ({
  getSettings: vi.fn().mockResolvedValue({ ai_provider: 'claude' }),
}))
vi.mock('../../src/services/analysisService.js', () => ({
  runProgramFromFile: vi.fn().mockResolvedValue(undefined),
}))

import { getApplicationPrograms } from '../../src/models/applications.js'
import { runProgramFromFile } from '../../src/services/analysisService.js'

describe('startBatchAnalysis — sequential', () => {
  beforeEach(() => vi.clearAllMocks())

  it('processes programs one at a time', async () => {
    getApplicationPrograms.mockResolvedValue([
      { id: 'p1', name: 'PROG1', status: 'pending' },
      { id: 'p2', name: 'PROG2', status: 'pending' },
    ])
    const emitters = new Map()
    await startBatchAnalysis('app-1', 'sequential', emitters)
    expect(runProgramFromFile).toHaveBeenCalledTimes(2)
  })

  it('skips already-analyzed programs', async () => {
    getApplicationPrograms.mockResolvedValue([
      { id: 'p1', name: 'PROG1', status: 'analyzed' },
      { id: 'p2', name: 'PROG2', status: 'pending' },
    ])
    const emitters = new Map()
    await startBatchAnalysis('app-1', 'sequential', emitters)
    expect(runProgramFromFile).toHaveBeenCalledTimes(1)
  })
})

describe('startBatchAnalysis — parallel', () => {
  beforeEach(() => vi.clearAllMocks())

  it('processes up to 3 programs concurrently', async () => {
    getApplicationPrograms.mockResolvedValue([
      { id: 'p1', status: 'pending' },
      { id: 'p2', status: 'pending' },
      { id: 'p3', status: 'pending' },
      { id: 'p4', status: 'pending' },
    ])
    const emitters = new Map()
    await startBatchAnalysis('app-1', 'parallel', emitters)
    expect(runProgramFromFile).toHaveBeenCalledTimes(4)
  })
})
