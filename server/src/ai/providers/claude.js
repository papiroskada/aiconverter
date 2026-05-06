import Anthropic from '@anthropic-ai/sdk'
import { BaseProvider } from './base.js'
import { BUSINESS_ANALYSIS_PROMPT, ANALYZE_ENTRY_POINT_PROMPT, C_BUSINESS_ANALYSIS_PROMPT, C_ANALYZE_ENTRY_POINT_PROMPT, CODE_GENERATION_PROMPT, PROGRAM_GENERATION_PROMPT } from '../prompts.js'

export class ClaudeProvider extends BaseProvider {
  constructor(config = {}) {
    super()
    const apiKey = config.claude_api_key || process.env.ANTHROPIC_API_KEY
    this.client = new Anthropic({ apiKey })
    this.modelMain   = config.claude_model_interface || process.env.CLAUDE_MODEL_INTERFACE || 'claude-sonnet-4-6'
    this.modelDetail = config.claude_model_rules     || process.env.CLAUDE_MODEL_RULES     || 'claude-haiku-4-5-20251001'
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

  async extractBusinessAnalysis(context, signal, lang = 'cobol') {
    const prompt = lang === 'c' ? C_BUSINESS_ANALYSIS_PROMPT(context) : BUSINESS_ANALYSIS_PROMPT(context)
    return this.#callClaude(prompt, 8000, this.modelMain, signal)
  }

  async analyzeEntryPoint(condition, businessName, context, signal, lang = 'cobol') {
    const prompt = lang === 'c'
      ? C_ANALYZE_ENTRY_POINT_PROMPT(condition, businessName, context)
      : ANALYZE_ENTRY_POINT_PROMPT(condition, businessName, context)
    return this.#callClaude(prompt, 4096, this.modelDetail, signal)
  }

  async generateCode(context, signal) {
    return this.#callClaude(CODE_GENERATION_PROMPT(context), 8000, this.modelMain, signal)
  }

  async generateProgram(context, patterns, signal) {
    return this.#callClaude(PROGRAM_GENERATION_PROMPT(context, patterns), 16000, this.modelMain, signal)
  }
}
