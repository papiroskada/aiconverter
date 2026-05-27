export class BaseProvider {
  constructor() { this._onUsage = null }

  setUsageCallback(fn) { this._onUsage = fn }

  _recordUsage(action, model, tokensIn, tokensOut) {
    this._onUsage?.({ action, model, tokensIn, tokensOut })
  }

  async extractBusinessAnalysis(context, signal) { throw new Error('Not implemented') }
  async analyzeEntryPoint(condition, businessName, context, signal) { throw new Error('Not implemented') }
  async generateProgram(context, patterns, signal) { throw new Error('Not implemented') }
  async fillHole(holeContext, signal) { throw new Error('Not implemented') }
}

export async function getProvider(config = {}) {
  const provider =
    process.env.AI_PROVIDER?.trim() || config.ai_provider || 'claude'
  if (provider === 'openai') {
    const { OpenAIProvider } = await import('./openai.js')
    return new OpenAIProvider(config)
  }
  const { ClaudeProvider } = await import('./claude.js')
  return new ClaudeProvider(config)
}
