import Anthropic from '@anthropic-ai/sdk'
import { BaseProvider } from './base.js'
import { INTERFACE_PROMPT, RULES_PROMPT, DIAGRAM_PROMPT } from '../prompts.js'

export class ClaudeProvider extends BaseProvider {
  constructor(config = {}) {
    super()
    const apiKey = config.claude_api_key || process.env.ANTHROPIC_API_KEY
    this.client = new Anthropic({ apiKey })
    this.modelInterface = config.claude_model_interface || process.env.CLAUDE_MODEL_INTERFACE || 'claude-sonnet-4-6'
    this.modelRules     = config.claude_model_rules    || process.env.CLAUDE_MODEL_RULES    || 'claude-haiku-4-5-20251001'
    this.modelDiagram   = config.claude_model_diagram  || process.env.CLAUDE_MODEL_DIAGRAM  || 'claude-haiku-4-5-20251001'
  }

  async #callClaude(prompt, maxTokens, model, signal) {
    const message = await this.client.messages.create(
      { model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] },
      { signal }
    )
    const text = message.content[0].text.trim()
    const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    return JSON.parse(cleaned)
  }

  async extractInterface(context, signal) {
    return this.#callClaude(INTERFACE_PROMPT(context), 4096, this.modelInterface, signal)
  }

  async extractRules(context, signal) {
    const result = await this.#callClaude(RULES_PROMPT(context), 4096, this.modelRules, signal)
    return result.paragraphRules ?? []
  }

  async generateDiagram(summary, signal) {
    const message = await this.client.messages.create(
      { model: this.modelDiagram, max_tokens: 1024, messages: [{ role: 'user', content: DIAGRAM_PROMPT(summary) }] },
      { signal }
    )
    return message.content[0].text.trim()
  }
}
