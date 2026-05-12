export class BaseProvider {
  async extractBusinessAnalysis(context, signal) { throw new Error('Not implemented') }
  async analyzeEntryPoint(condition, businessName, context, signal) { throw new Error('Not implemented') }
  async generateCode(context, signal) { throw new Error('Not implemented') }
  async generateProgram(context, patterns, signal) { throw new Error('Not implemented') }
  async generateTests(context, signal) { throw new Error('Not implemented') }
}

export async function getProvider(config = {}) {
  // Explicit AI_PROVIDER in .env overrides DB (Settings UI persists ai_provider to DB).
  const provider =
    process.env.AI_PROVIDER?.trim() || config.ai_provider || 'claude'
  if (provider === 'openai') {
    const { OpenAIProvider } = await import('./openai.js')
    return new OpenAIProvider(config)
  }
  const { ClaudeProvider } = await import('./claude.js')
  return new ClaudeProvider(config)
}
