import crypto from 'crypto'

const ALGO  = 'aes-256-gcm'
const KEY   = Buffer.from(process.env.ENCRYPTION_KEY ?? '', 'hex')
const VALID = KEY.length === 32

export function encrypt(text) {
  if (!VALID || !text) return text
  const iv         = crypto.randomBytes(12)
  const cipher     = crypto.createCipheriv(ALGO, KEY, iv)
  const encrypted  = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const authTag    = cipher.getAuthTag()
  return JSON.stringify({
    iv:        iv.toString('hex'),
    authTag:   authTag.toString('hex'),
    ciphertext: encrypted.toString('hex'),
  })
}

export function decrypt(stored) {
  if (!VALID || !stored) return stored
  try {
    const { iv, authTag, ciphertext } = JSON.parse(stored)
    const decipher = crypto.createDecipheriv(ALGO, KEY, Buffer.from(iv, 'hex'))
    decipher.setAuthTag(Buffer.from(authTag, 'hex'))
    return decipher.update(Buffer.from(ciphertext, 'hex')) + decipher.final('utf8')
  } catch {
    return stored // fallback — likely plaintext from before encryption was added
  }
}
