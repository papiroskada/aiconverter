export class BaseProvider {
  async extractBusinessAnalysis(context, signal) { throw new Error('Not implemented') }
  async analyzeEntryPoint(condition, businessName, context, signal) { throw new Error('Not implemented') }
  async generateCode(context, signal) { throw new Error('Not implemented') }
}

export async function getProvider(config = {}) {
  const provider = config.ai_provider || process.env.AI_PROVIDER || 'claude'
  if (provider === 'openai') {
    const { OpenAIProvider } = await import('./openai.js')
    return new OpenAIProvider(config)
  }
  const { ClaudeProvider } = await import('./claude.js')
  return new ClaudeProvider(config)
}
