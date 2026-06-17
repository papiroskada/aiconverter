import jwt from 'jsonwebtoken'

const SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-in-production'

export function signAccessToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: '15m' })
}

export function verifyAccessToken(token) {
  return jwt.verify(token, SECRET)
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization
  // EventSource cannot send headers — allow token via query param for SSE endpoints
  const token = header?.startsWith('Bearer ') ? header.slice(7) : req.query.token
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' })
  }
  try {
    req.user = verifyAccessToken(token)
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' })
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' })
    }
    next()
  }
}
