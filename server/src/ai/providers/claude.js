import Anthropic from '@anthropic-ai/sdk'
import { BaseProvider } from './base.js'
import { INTERFACE_PROMPT, RULES_PROMPT, DIAGRAM_PROMPT } from '../prompts.js'

export class ClaudeProvider extends BaseProvider {
  constructor() {
    super()
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }

  #model(envVar, defaultModel) {
    return process.env[envVar] || defaultModel
  }

  async #callClaude(prompt, maxTokens, model) {
    const message = await this.client.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = message.content[0].text.trim()
    const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    return JSON.parse(cleaned)
  }

  async extractInterface(context) {
    const model = this.#model('CLAUDE_MODEL_INTERFACE', 'claude-sonnet-4-6')
    return this.#callClaude(INTERFACE_PROMPT(context), 4096, model)
  }

  async extractRules(context) {
    const model = this.#model('CLAUDE_MODEL_RULES', 'claude-haiku-4-5-20251001')
    const result = await this.#callClaude(RULES_PROMPT(context), 4096, model)
    return result.paragraphRules ?? []
  }

  async generateDiagram(summary) {
    const model = this.#model('CLAUDE_MODEL_DIAGRAM', 'claude-haiku-4-5-20251001')
    const message = await this.client.messages.create({
      model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: DIAGRAM_PROMPT(summary) }],
    })
    return message.content[0].text.trim()
  }
}
