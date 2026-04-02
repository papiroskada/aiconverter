import { describe, it, expect, vi } from 'vitest'
import { BaseProvider } from '../../src/ai/providers/base.js'
import { runAnalysis, isComplex, estimateTokens } from '../../src/ai/orchestrator.js'

describe('BaseProvider', () => {
  it('throws NotImplemented on extractInterface', async () => {
    await expect(new BaseProvider().extractInterface('')).rejects.toThrow('Not implemented')
  })

  it('throws NotImplemented on generateDiagram', async () => {
    await expect(new BaseProvider().generateDiagram('')).rejects.toThrow('Not implemented')
  })

  it('throws NotImplemented on extractRules', async () => {
    await expect(new BaseProvider().extractRules('')).rejects.toThrow('Not implemented')
  })
})

describe('isComplex', () => {
  it('returns false for simple paragraph', () => {
    expect(isComplex({ cobol_text: 'PARA.\n   MOVE A TO B.\n   STOP RUN.' })).toBe(false)
  })

  it('returns true when EVALUATE is present', () => {
    expect(isComplex({ cobol_text: 'PARA.\n   EVALUATE WS-S\n   WHEN 1 MOVE A TO B\n   END-EVALUATE.' })).toBe(true)
  })

  it('returns true when 2 or more IF keywords are present', () => {
    expect(isComplex({ cobol_text: 'PARA.\n   IF A > 0\n     IF B > 0\n       MOVE X TO Y\n     END-IF\n   END-IF.' })).toBe(true)
  })

  it('returns false for exactly one IF keyword', () => {
    expect(isComplex({ cobol_text: 'PARA.\n   IF A > 0\n     MOVE X TO Y\n   END-IF.' })).toBe(false)
  })

  it('returns true for paragraph over 30 lines', () => {
    const text = Array(32).fill('   MOVE A TO B.').join('\n')
    expect(isComplex({ cobol_text: text })).toBe(true)
  })
})

describe('estimateTokens', () => {
  it('returns ceil(length / 4)', () => {
    expect(estimateTokens('a'.repeat(100))).toBe(25)
    expect(estimateTokens('a'.repeat(101))).toBe(26)
  })
})

const makeProvider = (overrides = {}) => ({
  extractInterface: vi.fn().mockResolvedValue({
    programType: 'subroutine',
    description: 'Test program description.',
    flow_narrative: 'Entry → process → exit.',
    parameters: [{ name: 'userInfo', cobolName: 'WGET-USR-INFO', type: 'object', direction: 'inout' }],
    fileIO: [{ file: 'USR-FILE', operations: ['READ', 'WRITE'] }],
    externalCalls: [{ program: 'C_BEGCOM', using: 'WBCR-VARS' }],
    dbTables: [{ table: 'USER_TABLE', operation: 'SELECT', fields: ['USR_ID'] }],
    sections: [
      { name: 'VALIDATE-ORDER', purpose: 'Validates order status', rules: [] },
      { name: 'SIMPLE-PARA', purpose: 'Moves A to B', rules: [] },
    ],
  }),
  extractRules: vi.fn().mockResolvedValue([
    { name: 'VALIDATE-ORDER', rules: ['IF WS-STATUS = 1 → approve', 'IF other → reject'] },
  ]),
  generateDiagram: vi.fn().mockResolvedValue('flowchart TD\n  A --> B'),
  ...overrides,
})

// VALIDATE-ORDER has EVALUATE → complex; SIMPLE-PARA has no conditions → simple
const makeChunks = () => [
  {
    id: 'c1',
    chunk_name: 'VALIDATE-ORDER',
    chunk_type: 'paragraph',
    cobol_text: 'VALIDATE-ORDER.\n   EVALUATE WS-STATUS\n   WHEN 1 MOVE A TO B\n   WHEN OTHER MOVE C TO D\n   END-EVALUATE.',
  },
  {
    id: 'c2',
    chunk_name: 'SIMPLE-PARA',
    chunk_type: 'paragraph',
    cobol_text: 'SIMPLE-PARA.\n   MOVE A TO B.',
  },
  {
    id: 'c3',
    chunk_name: 'WS-DATA',
    chunk_type: 'data_summary',
    cobol_text: '01 WS-VAR PIC X.',
  },
]

describe('runAnalysis', () => {
  it('calls extractInterface once with context string', async () => {
    const provider = makeProvider()
    await runAnalysis({ cobolText: 'PROCEDURE DIVISION.', chunks: makeChunks(), provider, emit: () => {}, programName: 'TEST' })
    expect(provider.extractInterface).toHaveBeenCalledTimes(1)
    expect(typeof provider.extractInterface.mock.calls[0][0]).toBe('string')
  })

  it('does NOT have analyzeChunk or synthesize (old methods removed)', async () => {
    const provider = makeProvider()
    await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    expect(provider.analyzeChunk).toBeUndefined()
    expect(provider.synthesize).toBeUndefined()
  })

  it('calls generateDiagram with flow_narrative', async () => {
    const provider = makeProvider()
    await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    expect(provider.generateDiagram).toHaveBeenCalledWith('Entry → process → exit.', undefined)
  })

  it('returns description and flow_narrative from interface spec', async () => {
    const provider = makeProvider()
    const result = await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    expect(result.description).toBe('Test program description.')
    expect(result.flow_narrative).toBe('Entry → process → exit.')
  })

  it('maps externalCalls to snake_case external_calls with empty string for null using', async () => {
    const provider = makeProvider({
      extractInterface: vi.fn().mockResolvedValue({
        externalCalls: [{ program: 'PROG-A', using: 'PARAM-1' }, { program: 'PROG-B', using: null }],
        description: 'd', flow_narrative: 'f', parameters: [], fileIO: [], dbTables: [], sections: [],
      }),
    })
    const result = await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    expect(result.external_calls).toEqual([
      { program: 'PROG-A', using: 'PARAM-1' },
      { program: 'PROG-B', using: '' },
    ])
  })

  it('returns sections array including rules', async () => {
    const provider = makeProvider()
    const result = await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    expect(result.sections[0]).toHaveProperty('rules')
    expect(Array.isArray(result.sections[0].rules)).toBe(true)
  })

  it('context does NOT include data_summary chunks in PARAGRAPHS section', async () => {
    const provider = makeProvider()
    await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    const context = provider.extractInterface.mock.calls[0][0]
    expect(context).toContain('VALIDATE-ORDER')
    expect(context).not.toContain('WS-DATA')
  })

  it('context includes WORKING-STORAGE VARIABLES section', async () => {
    const cobolText = 'WORKING-STORAGE SECTION.\n 01 WS-FLAG PIC X.\nPROCEDURE DIVISION.'
    const provider = makeProvider()
    await runAnalysis({ cobolText, chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    const context = provider.extractInterface.mock.calls[0][0]
    expect(context).toContain('WORKING-STORAGE VARIABLES')
  })

  it('single-pass: complex paragraph gets full text in context', async () => {
    const provider = makeProvider()
    await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    const context = provider.extractInterface.mock.calls[0][0]
    // VALIDATE-ORDER has EVALUATE → complex → full text (more than 5 lines worth)
    expect(context).toContain('END-EVALUATE')
  })

  it('single-pass: simple paragraph gets snippet (first 5 lines) in context', async () => {
    const longSimpleText = Array(20).fill('   MOVE A TO B.').join('\n')
    const chunks = [
      { id: 'c1', chunk_name: 'SIMPLE-PARA', chunk_type: 'paragraph', cobol_text: longSimpleText },
    ]
    const provider = makeProvider({
      extractInterface: vi.fn().mockResolvedValue({
        description: 'd', flow_narrative: 'f', parameters: [], fileIO: [], externalCalls: [], dbTables: [], sections: [],
      }),
    })
    await runAnalysis({ cobolText: '', chunks, provider, emit: () => {}, programName: 'T' })
    const context = provider.extractInterface.mock.calls[0][0]
    const paraSection = context.split('[SIMPLE-PARA]')[1] ?? ''
    const linesInPara = paraSection.split('\n\n')[0].split('\n').filter(Boolean)
    expect(linesInPara.length).toBeLessThanOrEqual(5)
  })

  it('single-pass: extractRules is NOT called', async () => {
    const provider = makeProvider()
    await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    expect(provider.extractRules).not.toHaveBeenCalled()
  })

  it('two-pass: extractRules called when tokenLimit exceeded', async () => {
    const provider = makeProvider()
    await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T', tokenLimit: 1 })
    expect(provider.extractRules).toHaveBeenCalledTimes(1)
  })

  it('two-pass: extractRules called only with complex paragraphs', async () => {
    const provider = makeProvider()
    await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T', tokenLimit: 1 })
    const rulesContext = provider.extractRules.mock.calls[0][0]
    expect(rulesContext).toContain('VALIDATE-ORDER')  // complex
    expect(rulesContext).not.toContain('SIMPLE-PARA') // simple
  })

  it('two-pass: merges pass 2 rules into complex sections', async () => {
    const provider = makeProvider()
    const result = await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T', tokenLimit: 1 })
    const validateSection = result.sections.find(s => s.name === 'VALIDATE-ORDER')
    expect(validateSection.rules).toEqual(['IF WS-STATUS = 1 → approve', 'IF other → reject'])
  })

  it('two-pass: keeps pass 1 rules for simple sections', async () => {
    const provider = makeProvider({
      extractInterface: vi.fn().mockResolvedValue({
        description: 'd', flow_narrative: 'f', parameters: [], fileIO: [], externalCalls: [], dbTables: [],
        sections: [
          { name: 'VALIDATE-ORDER', purpose: 'Validates order', rules: ['pass1-rule'] },
          { name: 'SIMPLE-PARA', purpose: 'Moves A to B', rules: ['simple-rule'] },
        ],
      }),
    })
    const result = await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T', tokenLimit: 1 })
    const simpleSection = result.sections.find(s => s.name === 'SIMPLE-PARA')
    expect(simpleSection.rules).toEqual(['simple-rule'])
  })

  it('two-pass: pass 2 failure is non-fatal — sections still returned', async () => {
    const provider = makeProvider({ extractRules: vi.fn().mockRejectedValue(new Error('timeout')) })
    const result = await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T', tokenLimit: 1 })
    expect(result.sections).toBeDefined()
    expect(result.sections.length).toBeGreaterThan(0)
  })

  it('diagram failure is non-fatal — result.diagram is null', async () => {
    const provider = makeProvider({ generateDiagram: vi.fn().mockRejectedValue(new Error('timeout')) })
    const result = await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    expect(result.diagram).toBeNull()
  })

  it('emits progress events for interface and diagram stages', async () => {
    const provider = makeProvider()
    const events = []
    const emit = (e, d) => events.push({ e, d })
    await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit, programName: 'T' })
    const stages = events.map(ev => ev.d?.stage)
    expect(stages).toContain('interface')
    expect(stages).toContain('diagram')
  })
})
