import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies before importing the module under test
const programsModel = {
  findProgramByName: vi.fn(),
  createProgram: vi.fn(),
  updateProgramStatus: vi.fn(),
}
const edgesModel = {
  upsertEdge: vi.fn(),
  backfillPhantomEdges: vi.fn(),
}
const callsModel = {
  backfillCallTargets: vi.fn(),
}

vi.mock('../../src/models/programs.js', () => programsModel)
vi.mock('../../src/models/programEdges.js', () => edgesModel)
vi.mock('../../src/models/programCalls.js', () => callsModel)

const { updateGraphAfterAnalysis, backfillEdgesForNewProgram } = await import('../../src/services/graphService.js')

describe('updateGraphAfterAnalysis', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    programsModel.updateProgramStatus.mockResolvedValue({})
    callsModel.backfillCallTargets.mockResolvedValue({})
  })

  it('creates a pending program node for an unknown program name', async () => {
    programsModel.findProgramByName.mockResolvedValue(null)
    programsModel.createProgram.mockResolvedValue({ id: 'new-id' })
    edgesModel.upsertEdge.mockResolvedValue({})

    await updateGraphAfterAnalysis('from-id', [{ program: 'NEW-PROG', using: 'WS-PARAM' }])

    expect(programsModel.createProgram).toHaveBeenCalledWith({ name: 'NEW-PROG', status: 'pending' })
    expect(edgesModel.upsertEdge).toHaveBeenCalledWith({
      from_program_id: 'from-id',
      to_program_name: 'NEW-PROG',
      to_program_id: 'new-id',
      context: 'WS-PARAM',
    })
  })

  it('uses existing program id when program already exists', async () => {
    programsModel.findProgramByName.mockResolvedValue({ id: 'existing-id', name: 'PROG' })
    edgesModel.upsertEdge.mockResolvedValue({})

    await updateGraphAfterAnalysis('prog-id', [
      { program: 'PROG', using: '' }
    ])

    expect(programsModel.createProgram).not.toHaveBeenCalled()
    expect(edgesModel.upsertEdge).toHaveBeenCalledWith({
      from_program_id: 'prog-id',
      to_program_name: 'PROG',
      to_program_id: 'existing-id',
      context: '',
    })
  })

  it('calls updateProgramStatus with analyzed after processing all calls', async () => {
    programsModel.findProgramByName.mockResolvedValue({ id: 'existing-id', name: 'PROG' })
    edgesModel.upsertEdge.mockResolvedValue({})

    await updateGraphAfterAnalysis('prog-id', [
      { program: 'PROG', using: '' }
    ])

    expect(programsModel.updateProgramStatus).toHaveBeenCalledWith('prog-id', 'analyzed', { analyzed_at: true })
  })

  it('skips entries with missing program name', async () => {
    await updateGraphAfterAnalysis('prog-id', [
      { program: '', using: 'X' },
      { using: 'Y' },
    ])

    expect(programsModel.findProgramByName).not.toHaveBeenCalled()
    expect(edgesModel.upsertEdge).not.toHaveBeenCalled()
  })

  it('includes all calls — no is_system_call filter', async () => {
    programsModel.findProgramByName.mockResolvedValue(null)
    programsModel.createProgram.mockResolvedValue({ id: 'sys-id' })
    edgesModel.upsertEdge.mockResolvedValue({})

    // Call with no is_system_call field — should still be processed
    await updateGraphAfterAnalysis('prog-id', [
      { program: 'c_writelnkarea', using: 'PGM-NM' },
    ])

    // name is normalized to uppercase before lookup
    expect(programsModel.findProgramByName).toHaveBeenCalledWith('C_WRITELNKAREA')
    expect(edgesModel.upsertEdge).toHaveBeenCalled()
  })
})

describe('backfillEdgesForNewProgram', () => {
  it('calls backfillPhantomEdges with program name and id', async () => {
    await backfillEdgesForNewProgram({ id: 'p-id', name: 'NEWPROG' })
    expect(edgesModel.backfillPhantomEdges).toHaveBeenCalledWith('NEWPROG', 'p-id')
  })

  it('backfillEdgesForNewProgram also calls backfillCallTargets', async () => {
    await backfillEdgesForNewProgram({ id: 'p-id', name: 'NEWPROG' })
    expect(edgesModel.backfillPhantomEdges).toHaveBeenCalledWith('NEWPROG', 'p-id')
    expect(callsModel.backfillCallTargets).toHaveBeenCalledWith('NEWPROG', 'p-id')
  })
})
