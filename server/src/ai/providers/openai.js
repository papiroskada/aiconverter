import OpenAI from 'openai'
import { BaseProvider } from './base.js'
import { BUSINESS_ANALYSIS_PROMPT, ANALYZE_ENTRY_POINT_PROMPT, C_BUSINESS_ANALYSIS_PROMPT, C_ANALYZE_ENTRY_POINT_PROMPT } from '../prompts.js'

export class OpenAIProvider extends BaseProvider {
  constructor(config = {}) {
    super()
    const apiKey = config.openai_api_key || process.env.OPENAI_API_KEY
    this.client = new OpenAI({ apiKey })
    this.modelMain   = config.openai_model_interface || process.env.OPENAI_MODEL_INTERFACE || 'gpt-4o'
    this.modelDetail = config.openai_model_rules     || process.env.OPENAI_MODEL_RULES     || 'gpt-4o-mini'
  }

  async #callOpenAI(prompt, maxTokens, model, signal) {
    const completion = await this.client.chat.completions.create(
      { model, max_tokens: maxTokens, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] },
      { signal }
    )
    return JSON.parse(completion.choices[0].message.content)
  }

  async extractBusinessAnalysis(context, signal, lang = 'cobol') {
    const prompt = lang === 'c' ? C_BUSINESS_ANALYSIS_PROMPT(context) : BUSINESS_ANALYSIS_PROMPT(context)
    return this.#callOpenAI(prompt, 8000, this.modelMain, signal)
  }

  async analyzeEntryPoint(condition, businessName, context, signal, lang = 'cobol') {
    const prompt = lang === 'c'
      ? C_ANALYZE_ENTRY_POINT_PROMPT(condition, businessName, context)
      : ANALYZE_ENTRY_POINT_PROMPT(condition, businessName, context)
    return this.#callOpenAI(prompt, 4096, this.modelDetail, signal)
  }
}
