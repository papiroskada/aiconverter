export class BaseProvider {
  async extractInterface(context) {
    throw new Error('Not implemented')
  }

  async extractRules(context) {
    throw new Error('Not implemented')
  }

  async generateDiagram(summary) {
    throw new Error('Not implemented')
  }
}

export async function getProvider() {
  const name = process.env.AI_PROVIDER || 'claude'
  if (name === 'openai') {
    const { OpenAIProvider } = await import('./openai.js')
    return new OpenAIProvider()
  }
  const { ClaudeProvider } = await import('./claude.js')
  return new ClaudeProvider()
}
