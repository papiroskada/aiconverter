import Anthropic from '@anthropic-ai/sdk'
import { BaseProvider } from './base.js'
import { BUSINESS_ANALYSIS_PROMPT, ANALYZE_ENTRY_POINT_PROMPT, PROGRAM_GENERATION_PROMPT, HOLE_FILL_PROMPT } from '../prompts.js'

export class ClaudeProvider extends BaseProvider {
  constructor(config = {}) {
    super()
    const apiKey = config.claude_api_key || process.env.ANTHROPIC_API_KEY
    this.client = new Anthropic({ apiKey })
    this.modelMain   = config.claude_model_interface || process.env.CLAUDE_MODEL_INTERFACE || 'claude-sonnet-4-6'
    this.modelDetail = config.claude_model_rules     || process.env.CLAUDE_MODEL_RULES     || 'claude-haiku-4-5-20251001'
  }

  async #callClaude(action, prompt, maxTokens, model, signal, temperature) {
    const params = { model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }
    if (temperature !== undefined) params.temperature = temperature
    const message = await this.client.messages.create(params, { signal })
    this._recordUsage(action, model, message.usage?.input_tokens ?? 0, message.usage?.output_tokens ?? 0)
    const text = message.content[0].text.trim()
    const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    return JSON.parse(cleaned)
  }

  async extractBusinessAnalysis(context, signal) {
    return this.#callClaude('analysis', BUSINESS_ANALYSIS_PROMPT(context), 8000, this.modelMain, signal)
  }

  async analyzeEntryPoint(condition, businessName, context, signal) {
    return this.#callClaude('analysis', ANALYZE_ENTRY_POINT_PROMPT(condition, businessName, context), 4096, this.modelDetail, signal)
  }

  async generateProgram(context, patterns, signal) {
    return this.#callClaude('generation', PROGRAM_GENERATION_PROMPT(context, patterns), 16000, this.modelMain, signal)
  }

  async fillHole(holeContext, signal) {
    return this.#callClaude('generation', HOLE_FILL_PROMPT(holeContext), 4096, this.modelMain, signal, 0.2)
  }
}
