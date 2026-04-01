import OpenAI from 'openai'
import { BaseProvider } from './base.js'
import { INTERFACE_PROMPT, RULES_PROMPT, DIAGRAM_PROMPT } from '../prompts.js'

export class OpenAIProvider extends BaseProvider {
  constructor() {
    super()
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }

  #model(envVar, defaultModel) {
    return process.env[envVar] || defaultModel
  }

  async #callOpenAI(prompt, maxTokens, model) {
    const completion = await this.client.chat.completions.create({
      model,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    })
    return JSON.parse(completion.choices[0].message.content)
  }

  async extractInterface(context) {
    const model = this.#model('OPENAI_MODEL_INTERFACE', 'gpt-4o')
    return this.#callOpenAI(INTERFACE_PROMPT(context), 4096, model)
  }

  async extractRules(context) {
    const model = this.#model('OPENAI_MODEL_RULES', 'gpt-4o-mini')
    const result = await this.#callOpenAI(RULES_PROMPT(context), 4096, model)
    return result.paragraphRules ?? []
  }

  async generateDiagram(summary) {
    const model = this.#model('OPENAI_MODEL_DIAGRAM', 'gpt-4o-mini')
    const completion = await this.client.chat.completions.create({
      model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: DIAGRAM_PROMPT(summary) }],
    })
    return completion.choices[0].message.content.trim()
  }
}
