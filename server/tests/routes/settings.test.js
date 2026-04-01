import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import app from '../../src/app.js'

vi.mock('../../src/models/settings.js', () => ({
  getSettings: vi.fn().mockResolvedValue({
    ai_provider: 'claude',
    claude_api_key: 'sk-ant-api03-abcdefgh1234',
    openai_api_key: null,
    claude_model_interface: 'claude-sonnet-4-6',
    claude_model_rules: 'claude-haiku-4-5-20251001',
    claude_model_diagram: 'claude-haiku-4-5-20251001',
    openai_model_interface: 'gpt-4o',
    openai_model_rules: 'gpt-4o-mini',
    openai_model_diagram: 'gpt-4o-mini',
  }),
  upsertSettings: vi.fn().mockResolvedValue(undefined),
}))

describe('GET /api/settings', () => {
  it('returns settings with masked api key', async () => {
    const res = await request(app).get('/api/settings')
    expect(res.status).toBe(200)
    expect(res.body.ai_provider).toBe('claude')
    expect(res.body.claude_api_key).toMatch(/••••/)
    expect(res.body.claude_api_key).toMatch(/1234$/)
    expect(res.body.openai_api_key).toBeNull()
  })

  it('returns model fields', async () => {
    const res = await request(app).get('/api/settings')
    expect(res.body.claude_model_interface).toBe('claude-sonnet-4-6')
    expect(res.body.openai_model_rules).toBe('gpt-4o-mini')
  })
})

describe('PUT /api/settings', () => {
  it('calls upsertSettings and returns 204', async () => {
    const res = await request(app)
      .put('/api/settings')
      .send({ ai_provider: 'openai', openai_api_key: 'sk-newkey' })
    expect(res.status).toBe(204)
  })
})

describe('PUT /api/settings — invalid body', () => {
  it('returns 400 when no valid fields provided', async () => {
    const { upsertSettings } = await import('../../src/models/settings.js')
    upsertSettings.mockResolvedValueOnce(false)
    const res = await request(app).put('/api/settings').send({ unknown_field: 'value' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('No valid fields provided')
  })
})
