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
}))
vi.mock('../../src/models/programChunks.js', () => ({
  getChunksByProgramId: vi.fn().mockResolvedValue([]),
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
