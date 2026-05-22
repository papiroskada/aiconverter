import OpenAI from 'openai'
import { BaseProvider } from './base.js'
import { BUSINESS_ANALYSIS_PROMPT, ANALYZE_ENTRY_POINT_PROMPT, PROGRAM_GENERATION_PROMPT, HOLE_FILL_PROMPT } from '../prompts.js'

export class OpenAIProvider extends BaseProvider {
  constructor(config = {}) {
    super()
    const apiKey = config.openai_api_key || process.env.OPENAI_API_KEY
    this.client = new OpenAI({ apiKey })
    this.modelMain   = config.openai_model_interface || process.env.OPENAI_MODEL_INTERFACE || 'gpt-4o'
    this.modelDetail = config.openai_model_rules     || process.env.OPENAI_MODEL_RULES     || 'gpt-4o-mini'
  }

  async #callOpenAI(prompt, maxTokens, model, signal, temperature) {
    const params = { model, max_tokens: maxTokens, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] }
    if (temperature !== undefined) params.temperature = temperature
    const completion = await this.client.chat.completions.create(params, { signal })
    return JSON.parse(completion.choices[0].message.content)
  }

  async extractBusinessAnalysis(context, signal) {
    return this.#callOpenAI(BUSINESS_ANALYSIS_PROMPT(context), 8000, this.modelMain, signal)
  }

  async analyzeEntryPoint(condition, businessName, context, signal) {
    return this.#callOpenAI(ANALYZE_ENTRY_POINT_PROMPT(condition, businessName, context), 4096, this.modelDetail, signal)
  }

  async generateProgram(context, patterns, signal) {
    return this.#callOpenAI(PROGRAM_GENERATION_PROMPT(context, patterns), 16000, this.modelMain, signal)
  }

  async fillHole(holeContext, signal) {
    return this.#callOpenAI(HOLE_FILL_PROMPT(holeContext), 4096, this.modelMain, signal, 0.2)
  }
}
