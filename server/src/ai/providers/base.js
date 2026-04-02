export class BaseProvider {
  async extractInterface(context, signal) { throw new Error('Not implemented') }
  async extractRules(context, signal) { throw new Error('Not implemented') }
  async generateDiagram(summary, signal) { throw new Error('Not implemented') }
}

/**
 * @param {object} config - from settings table row
 * @param {string} config.ai_provider
 * @param {string|null} config.claude_api_key
 * @param {string|null} config.openai_api_key
 * @param {string} config.claude_model_interface
 * @param {string} config.claude_model_rules
 * @param {string} config.claude_model_diagram
 * @param {string} config.openai_model_interface
 * @param {string} config.openai_model_rules
 * @param {string} config.openai_model_diagram
 */
export async function getProvider(config = {}) {
  const provider = config.ai_provider || process.env.AI_PROVIDER || 'claude'
  if (provider === 'openai') {
    const { OpenAIProvider } = await import('./openai.js')
    return new OpenAIProvider(config)
  }
  const { ClaudeProvider } = await import('./claude.js')
  return new ClaudeProvider(config)
}
