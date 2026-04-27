import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import app from '../../src/app.js'

vi.mock('../../src/services/analysisService.js', () => ({
  uploadAndStartAnalysis: vi.fn().mockResolvedValue({ id: 'prog-123', name: 'TESTPROG', status: 'analyzing' }),
  reanalyze: vi.fn().mockResolvedValue(undefined),
  deleteProgram: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../src/models/programs.js', () => ({
  getAllPrograms: vi.fn().mockResolvedValue([{ id: 'p1', name: 'PROG1', status: 'analyzed' }]),
  findProgramById: vi.fn().mockResolvedValue({ id: 'p1', name: 'PROG1', status: 'analyzed' }),
}))
vi.mock('../../src/models/programEdges.js', () => ({
  getAllEdges: vi.fn().mockResolvedValue([]),
  getEdgesForProgram: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../src/models/programAnalysis.js', () => ({
  getAnalysisByProgramId: vi.fn().mockResolvedValue(null),
  updateFlag: vi.fn().mockResolvedValue({ "FUNC='INS'": 'warning' }),
}))
vi.mock('../../src/models/programChunks.js', () => ({
  getChunksByProgramId: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../src/models/programCalls.js', () => ({
  getCallersOf: vi.fn().mockResolvedValue([{ id: 'p1', name: 'CALLER', call_context: '' }]),
  getCallsFromProgram: vi.fn().mockResolvedValue([{ callee_name: 'ARCUSACS', callee_program_id: null, call_context: '' }]),
}))

describe('GET /api/programs', () => {
  it('returns programs and edges', async () => {
    const res = await request(app).get('/api/programs')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('programs')
    expect(res.body).toHaveProperty('edges')
    expect(res.body.programs[0].name).toBe('PROG1')
  })
})

describe('POST /api/programs/upload', () => {
  it('accepts a .cbl file and returns program id', async () => {
    const res = await request(app)
      .post('/api/programs/upload')
      .attach('file', Buffer.from('IDENTIFICATION DIVISION.'), 'TEST.cbl')
    expect(res.status).toBe(202)
    expect(res.body.id).toBe('prog-123')
    expect(res.body.status).toBe('analyzing')
  })
})

describe('DELETE /api/programs/:id', () => {
  it('deletes program and returns 204', async () => {
    const res = await request(app).delete('/api/programs/p1')
    expect(res.status).toBe(204)
  })

  it('returns service error status and message', async () => {
    const { deleteProgram } = await import('../../src/services/analysisService.js')
    deleteProgram.mockRejectedValueOnce(Object.assign(new Error('Cannot delete program while analyzing'), { status: 409 }))

    const res = await request(app).delete('/api/programs/p1')
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('Cannot delete program while analyzing')
  })
})

describe('PATCH /api/programs/:id/flags', () => {
  it('sets a warning flag and returns updated flags', async () => {
    const res = await request(app)
      .patch('/api/programs/p1/flags')
      .send({ condition: "FUNC='INS'", flag: 'warning' })
    expect(res.status).toBe(200)
    expect(res.body["FUNC='INS'"]).toBe('warning')
  })

  it('returns 400 when condition is missing', async () => {
    const res = await request(app)
      .patch('/api/programs/p1/flags')
      .send({ flag: 'warning' })
    expect(res.status).toBe(400)
  })

  it('accepts null flag to clear', async () => {
    const { updateFlag } = await import('../../src/models/programAnalysis.js')
    updateFlag.mockResolvedValueOnce({})
    const res = await request(app)
      .patch('/api/programs/p1/flags')
      .send({ condition: "FUNC='INS'", flag: null })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({})
  })
})

describe('GET /api/programs/callers/:name', () => {
  it('returns callers list', async () => {
    const res = await request(app).get('/api/programs/callers/ARCUSACS')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('callers')
    expect(Array.isArray(res.body.callers)).toBe(true)
  })
})

describe('GET /api/programs/:id/calls', () => {
  it('returns calls list', async () => {
    const res = await request(app).get('/api/programs/p1/calls')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('calls')
    expect(Array.isArray(res.body.calls)).toBe(true)
  })
})
