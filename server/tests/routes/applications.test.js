import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import app from '../../src/app.js'

vi.mock('../../src/models/applications.js', () => ({
  createApplication: vi.fn().mockResolvedValue({ id: 'app-1', name: 'MY APP', status: 'pending' }),
  getAllApplications: vi.fn().mockResolvedValue([
    { id: 'app-1', name: 'MY APP', status: 'pending', program_count: '3' },
  ]),
  findApplicationById: vi.fn().mockResolvedValue({ id: 'app-1', name: 'MY APP', status: 'pending' }),
  getApplicationPrograms: vi.fn().mockResolvedValue([
    { id: 'p1', name: 'PROG1', status: 'analyzed' },
  ]),
  updateApplicationStatus: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../src/services/batchService.js', () => ({
  startBatchAnalysis: vi.fn().mockResolvedValue(undefined),
}))

describe('POST /api/applications', () => {
  it('creates application and returns 201', async () => {
    const res = await request(app).post('/api/applications').send({ name: 'MY APP' })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe('app-1')
    expect(res.body.name).toBe('MY APP')
  })
})

describe('GET /api/applications', () => {
  it('returns list with programCount', async () => {
    const res = await request(app).get('/api/applications')
    expect(res.status).toBe(200)
    expect(res.body[0].programCount).toBe(3)
  })
})

describe('GET /api/applications/:id', () => {
  it('returns application with programs array', async () => {
    const res = await request(app).get('/api/applications/app-1')
    expect(res.status).toBe(200)
    expect(res.body.programs).toHaveLength(1)
    expect(res.body.programs[0].name).toBe('PROG1')
  })
})

describe('POST /api/applications/:id/analyze', () => {
  it('accepts mode and returns 202', async () => {
    const res = await request(app)
      .post('/api/applications/app-1/analyze')
      .send({ mode: 'sequential' })
    expect(res.status).toBe(202)
  })
})
