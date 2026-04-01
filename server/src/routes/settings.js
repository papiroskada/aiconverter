import { Router } from 'express'
import { getSettings, upsertSettings } from '../models/settings.js'

const router = Router()

function maskKey(key) {
  if (!key) return null
  const dashIdx = key.indexOf('-', key.indexOf('-') + 1)
  const prefix = dashIdx > 0 ? key.slice(0, dashIdx + 1) : key.slice(0, 6)
  const suffix = key.slice(-4)
  return `${prefix}••••${suffix}`
}

router.get('/', async (req, res, next) => {
  try {
    const s = await getSettings()
    res.json({
      ...s,
      claude_api_key: maskKey(s.claude_api_key),
      openai_api_key: maskKey(s.openai_api_key),
    })
  } catch (err) {
    next(err)
  }
})

router.put('/', async (req, res, next) => {
  try {
    await upsertSettings(req.body)
    res.status(204).send()
  } catch (err) {
    next(err)
  }
})

export default router
