import OpenAI from 'openai'
import { BaseProvider } from './base.js'
import { INTERFACE_PROMPT, RULES_PROMPT, DIAGRAM_PROMPT } from '../prompts.js'

export class OpenAIProvider extends BaseProvider {
  constructor(config = {}) {
    super()
    const apiKey = config.openai_api_key || process.env.OPENAI_API_KEY
    this.client = new OpenAI({ apiKey })
    this.modelInterface = config.openai_model_interface || process.env.OPENAI_MODEL_INTERFACE || 'gpt-4o'
    this.modelRules     = config.openai_model_rules    || process.env.OPENAI_MODEL_RULES    || 'gpt-4o-mini'
    this.modelDiagram   = config.openai_model_diagram  || process.env.OPENAI_MODEL_DIAGRAM  || 'gpt-4o-mini'
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
    return this.#callOpenAI(INTERFACE_PROMPT(context), 4096, this.modelInterface)
  }

  async extractRules(context) {
    const result = await this.#callOpenAI(RULES_PROMPT(context), 4096, this.modelRules)
    return result.paragraphRules ?? []
  }

  async generateDiagram(summary) {
    const completion = await this.client.chat.completions.create({
      model: this.modelDiagram,
      max_tokens: 1024,
      messages: [{ role: 'user', content: DIAGRAM_PROMPT(summary) }],
    })
    return completion.choices[0].message.content.trim()
  }
}
