import { describe, it, expect, vi } from 'vitest'
import { BaseProvider } from '../../src/ai/providers/base.js'
import { runAnalysis, estimateTokens, validateDbTables, serializePerformGraph, deserializePerformGraph, filterEntryPoints } from '../../src/ai/orchestrator.js'

describe('BaseProvider', () => {
  it('throws NotImplemented on extractBusinessAnalysis', async () => {
    await expect(new BaseProvider().extractBusinessAnalysis('')).rejects.toThrow('Not implemented')
  })

  it('throws NotImplemented on analyzeEntryPoint', async () => {
    await expect(new BaseProvider().analyzeEntryPoint('', '', '')).rejects.toThrow('Not implemented')
  })
})

describe('estimateTokens', () => {
  it('returns ceil(length / 4)', () => {
    expect(estimateTokens('a'.repeat(100))).toBe(25)
    expect(estimateTokens('a'.repeat(101))).toBe(26)
  })
})

const MOCK_SPEC = {
  businessPurpose: 'Manages user record lifecycle.',
  parameters: [
    { name: 'userInfo', cobolName: 'WGET-USR-INFO', type: 'object', direction: 'inout', description: 'User record' },
  ],
  entryPoints: [
    {
      condition: "FUNC='RD'",
      businessName: 'Read User',
      paragraphNames: ['READ-USER'],
      steps: ['Reads user from USER-FILE'],
      sideEffects: [],
      returns: 'WGET-USR-INFO populated',
      errors: ['STATUS-35: file not found'],
    },
  ],
  errorCatalog: [
    { code: 'STATUS-35', businessMeaning: 'File not found', systemAction: 'Sets error flag and returns' },
  ],
  externalDependencies: [
    { program: 'C_CURPID', purpose: 'Gets current process ID', dataIn: 'none', dataOut: 'process ID' },
  ],
  dbTables: [{ table: 'USER_TABLE', operation: 'SELECT', fields: ['USR_ID'] }],
  fileIO: [{ file: 'USR-FILE', operations: ['OPEN', 'READ', 'CLOSE'] }],
}

const makeProvider = (overrides = {}) => ({
  extractBusinessAnalysis: vi.fn().mockResolvedValue(MOCK_SPEC),
  analyzeEntryPoint: vi.fn().mockResolvedValue({
    steps: ['detailed step'],
    sideEffects: ['updates counter'],
    returns: 'OK',
    errors: [],
  }),
  ...overrides,
})

const makeChunks = () => [
  { id: 'c1', chunk_name: 'READ-USER',   chunk_type: 'paragraph',     cobol_text: 'READ-USER.\n   READ USR-FILE.' },
  { id: 'c2', chunk_name: 'WS-DATA',     chunk_type: 'data_summary',  cobol_text: '01 WS-VAR PIC X.' },
]

describe('runAnalysis — small file', () => {
  it('calls extractBusinessAnalysis once', async () => {
    const provider = makeProvider()
    await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    expect(provider.extractBusinessAnalysis).toHaveBeenCalledTimes(1)
  })

  it('does NOT call analyzeEntryPoint for small files', async () => {
    const provider = makeProvider()
    await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    expect(provider.analyzeEntryPoint).not.toHaveBeenCalled()
  })

  it('context includes paragraph code but not data_summary chunks', async () => {
    const provider = makeProvider()
    await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    const ctx = provider.extractBusinessAnalysis.mock.calls[0][0]
    expect(ctx).toContain('READ-USER')
    expect(ctx).not.toContain('WS-DATA')
  })

  it('returns business_purpose from spec', async () => {
    const provider = makeProvider()
    const { result } = await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    expect(result.business_purpose).toBe('Manages user record lifecycle.')
  })

  it('derives contract types from parsed PIC, not AI spec', async () => {
    const provider = makeProvider()
    const cobolText = [
      'DATA DIVISION.',
      'LINKAGE SECTION.',
      ' 01 CPSRI-PART-ID PIC X(8).',
      ' 01 CPSRO-RTN-STS PIC 9(4).',
      ' 01 CPSRI-COUNT    PIC S9(7).',
      ' 01 CPSRI-GROUP.',
      '    05 CPSRI-SUB PIC X(3).',
      'PROCEDURE DIVISION.',
    ].join('\n')
    const { result } = await runAnalysis({ cobolText, chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    const input  = JSON.parse(result.input_contract)
    const output = JSON.parse(result.output_contract)

    // input must not contain direction:out fields
    expect(input.every(p => p.direction !== 'out')).toBe(true)
    // output must not contain direction:in fields
    expect(output.every(p => p.direction !== 'in')).toBe(true)

    // types are derived from PIC
    const partId = input.find(p => p.cobolName === 'CPSRI-PART-ID')
    expect(partId.type).toBe('string')   // PIC X(8) → string

    const rtnSts = output.find(p => p.cobolName === 'CPSRO-RTN-STS')
    expect(rtnSts.type).toBe('number')   // PIC 9(4) → number

    const count = input.find(p => p.cobolName === 'CPSRI-COUNT')
    expect(count.type).toBe('number')    // PIC S9(7) → number

    const group = input.find(p => p.cobolName === 'CPSRI-GROUP')
    expect(group.type).toBe('object')    // no PIC → object
  })

  it('returns entry_points array', async () => {
    const provider = makeProvider()
    const { result } = await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    expect(Array.isArray(result.entry_points)).toBe(true)
    expect(result.entry_points[0].businessName).toBe('Read User')
  })

  it('returns error_catalog array', async () => {
    const provider = makeProvider()
    const { result } = await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    expect(result.error_catalog[0].code).toBe('STATUS-35')
  })

  it('returns external_dependencies array', async () => {
    const provider = makeProvider()
    const { result } = await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    expect(result.external_dependencies[0].program).toBe('C_CURPID')
    expect(result.external_dependencies[0].purpose).toBeDefined()
  })

  it('maps fileIO to file_ops', async () => {
    const provider = makeProvider()
    const { result } = await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    expect(result.file_ops[0]).toEqual({ file: 'USR-FILE', operations: ['OPEN', 'READ', 'CLOSE'] })
  })

  it('emits progress events', async () => {
    const provider = makeProvider()
    const events = []
    await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: (e, d) => events.push({ e, d }), programName: 'T' })
    const stages = events.map(ev => ev.d?.stage)
    expect(stages).toContain('analysis')
  })

  it('returns analysis_two_step: false for small file', async () => {
    const provider = makeProvider()
    const { result } = await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    expect(result.analysis_two_step).toBe(false)
  })

  it('returns pre_dispatch as array', async () => {
    const provider = makeProvider()
    const { result } = await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    expect(Array.isArray(result.pre_dispatch)).toBe(true)
  })

  it('returns { result, structuralCache } object', async () => {
    const provider = makeProvider()
    const analysis = await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    expect(analysis).toHaveProperty('result')
    expect(analysis).toHaveProperty('structuralCache')
    expect(typeof analysis.structuralCache).toBe('object')
  })
})

describe('runAnalysis — large file two-step', () => {
  const hugeChunks = Array.from({ length: 5 }, (_, i) => ({
    id: `c${i}`,
    chunk_name: `PARA-${i}`,
    chunk_type: 'paragraph',
    cobol_text: 'x'.repeat(80000),
  }))

  it('calls extractBusinessAnalysis once then analyzeEntryPoint per entry point', async () => {
    const provider = makeProvider()
    await runAnalysis({ cobolText: '', chunks: hugeChunks, provider, emit: () => {}, programName: 'T' })
    expect(provider.extractBusinessAnalysis).toHaveBeenCalledTimes(1)
    expect(provider.analyzeEntryPoint).toHaveBeenCalledTimes(1) // MOCK_SPEC has 1 entry point
  })

  it('analyzeEntryPoint failure is non-fatal — entry point still returned', async () => {
    const provider = makeProvider({
      analyzeEntryPoint: vi.fn().mockRejectedValue(new Error('timeout')),
    })
    const { result } = await runAnalysis({ cobolText: '', chunks: hugeChunks, provider, emit: () => {}, programName: 'T' })
    expect(result.entry_points.length).toBe(1)
    expect(result.entry_points[0].businessName).toBe('Read User')
  })

  it('merges detail steps into entry_points', async () => {
    const provider = makeProvider()
    const { result } = await runAnalysis({ cobolText: '', chunks: hugeChunks, provider, emit: () => {}, programName: 'T' })
    expect(result.entry_points[0].steps).toEqual(['detailed step'])
    expect(result.entry_points[0].sideEffects).toEqual(['updates counter'])
  })

  it('keeps paragraphNames in final entry_points', async () => {
    const provider = makeProvider()
    const { result } = await runAnalysis({ cobolText: '', chunks: hugeChunks, provider, emit: () => {}, programName: 'T' })
    expect(Array.isArray(result.entry_points[0].paragraphNames)).toBe(true)
  })

  it('returns analysis_two_step: true for large file', async () => {
    const provider = makeProvider()
    const { result } = await runAnalysis({ cobolText: '', chunks: hugeChunks, provider, emit: () => {}, programName: 'T' })
    expect(result.analysis_two_step).toBe(true)
  })
})

describe('serializePerformGraph / deserializePerformGraph', () => {
  it('round-trips a Map<string, Set<string>>', () => {
    const original = new Map([
      ['MAIN', new Set(['INIT', 'CLEANUP'])],
      ['INIT', new Set(['SUB-A'])],
      ['CLEANUP', new Set()],
    ])
    const serialized = serializePerformGraph(original)
    expect(typeof serialized).toBe('object')
    expect(Array.isArray(serialized['MAIN'])).toBe(true)
    expect(serialized['MAIN']).toContain('INIT')

    const restored = deserializePerformGraph(serialized)
    expect(restored).toBeInstanceOf(Map)
    expect(restored.get('MAIN')).toBeInstanceOf(Set)
    expect(restored.get('MAIN').has('INIT')).toBe(true)
    expect(restored.get('CLEANUP').size).toBe(0)
  })
})

describe('validateDbTables', () => {
  it('flags table not in known set with ai_hallucinated: true', () => {
    const execSql = [{ table: 'CUSTOMER' }]
    const tux = []
    const result = validateDbTables(
      [{ table: 'CUSTOMER', operation: 'SELECT' }, { table: 'GHOST_TABLE', operation: 'INSERT' }],
      execSql, tux
    )
    expect(result[0].ai_hallucinated).toBeUndefined()
    expect(result[1].ai_hallucinated).toBe(true)
  })

  it('comparison is case-insensitive', () => {
    const execSql = [{ table: 'customer_tbl' }]
    const result = validateDbTables([{ table: 'CUSTOMER_TBL', operation: 'SELECT' }], execSql, [])
    expect(result[0].ai_hallucinated).toBeUndefined()
  })

  it('skips validation when no structural tables found', () => {
    const result = validateDbTables([{ table: 'ANYTHING', operation: 'SELECT' }], [], [])
    expect(result[0].ai_hallucinated).toBeUndefined()
  })

  it('returns empty array when dbTables is empty', () => {
    expect(validateDbTables([], [{ table: 'X' }], [])).toEqual([])
  })
})

describe('runAnalysis — context content', () => {
  it('includes LINKAGE SECTION VARIABLES with direction in context', async () => {
    const provider = makeProvider()
    const cobolText = 'DATA DIVISION.\nLINKAGE SECTION.\n 01 CPSRI-PART-ID PIC X(8).\n 01 CPSRO-RTN-STS PIC 9(4).\nPROCEDURE DIVISION.'
    await runAnalysis({ cobolText, chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    const ctx = provider.extractBusinessAnalysis.mock.calls[0][0]
    expect(ctx).toContain('LINKAGE SECTION VARIABLES')
    expect(ctx).toContain('CPSRI-PART-ID')
    expect(ctx).toContain('[in]')
    expect(ctx).toContain('[out]')
  })

  it('includes ENTRY POINT DISPATCH in context when EVALUATE present', async () => {
    const cobolText = `PROCEDURE DIVISION.\nDISPATCH.\n  EVALUATE WS-MODE\n    WHEN "1"\n      PERFORM DO-ONE\n  END-EVALUATE.`
    const chunks = [
      { chunk_name: 'DISPATCH', chunk_type: 'paragraph', cobol_text: 'EVALUATE WS-MODE\n  WHEN "1"\n    PERFORM DO-ONE\nEND-EVALUATE' },
    ]
    const provider = makeProvider()
    await runAnalysis({ cobolText, chunks, provider, emit: () => {}, programName: 'T' })
    const ctx = provider.extractBusinessAnalysis.mock.calls[0][0]
    expect(ctx).toContain('ENTRY POINT DISPATCH')
    expect(ctx).toContain('WS-MODE')
  })

  it('includes ERROR ENTRIES with data elements in context', async () => {
    const cobolText = `PROCEDURE DIVISION.\nMAIN.\n  MOVE "PRS-MD" TO SCCGTERR-DATA-EL.\n  MOVE 1500 TO SCCGTERR-SEQ-NO.`
    const provider = makeProvider()
    await runAnalysis({ cobolText, chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    const ctx = provider.extractBusinessAnalysis.mock.calls[0][0]
    expect(ctx).toContain('ERROR ENTRIES')
    expect(ctx).toContain('1500')
    expect(ctx).toContain('PRS-MD')
  })

  it('includes PRE-DISPATCH PARAGRAPHS in context when present', async () => {
    const cobolText = 'PROCEDURE DIVISION.'
    const chunks = [
      {
        chunk_name: 'BUSINESS-LOGIC',
        chunk_type: 'paragraph',
        cobol_text: 'BUSINESS-LOGIC.\n  PERFORM VALIDATE-LINKAGE.\n  PERFORM INITIAL-SETUP.\n  EVALUATE WS-MODE\n    WHEN "1"\n      PERFORM DO-ONE\n  END-EVALUATE.',
      },
      { chunk_name: 'VALIDATE-LINKAGE', chunk_type: 'paragraph', cobol_text: 'VALIDATE-LINKAGE.\n  IF WS-MODE = SPACES MOVE 1500 TO WS-SEQ-NO.' },
      { chunk_name: 'INITIAL-SETUP', chunk_type: 'paragraph', cobol_text: 'INITIAL-SETUP.\n  MOVE SPACES TO WS-OUT.' },
    ]
    const provider = makeProvider()
    await runAnalysis({ cobolText, chunks, provider, emit: () => {}, programName: 'T' })
    const ctx = provider.extractBusinessAnalysis.mock.calls[0][0]
    expect(ctx).toContain('PRE-DISPATCH PARAGRAPHS')
    expect(ctx).toContain('VALIDATE-LINKAGE')
    expect(ctx).toContain('INITIAL-SETUP')
  })
})

describe('filterEntryPoints', () => {
  const dispatch = [{
    evaluateSubject: 'WS-FUNC',
    entries: [
      { whenValue: '"INS"', performParagraph: 'INSERT-RECORD' },
      { whenValue: '"UPD"', performParagraph: 'UPDATE-RECORD' },
    ],
  }]

  it('keeps entry points whose paragraphNames overlap with dispatch targets', () => {
    const eps = [
      { condition: 'FUNC="INS"', paragraphNames: ['INSERT-RECORD', 'VALIDATE-INPUT'] },
      { condition: 'FUNC="UPD"', paragraphNames: ['UPDATE-RECORD'] },
    ]
    expect(filterEntryPoints(eps, dispatch)).toHaveLength(2)
  })

  it('removes entry points with no overlap with dispatch targets', () => {
    const eps = [
      { condition: 'FUNC="INS"', paragraphNames: ['INSERT-RECORD'] },
      { condition: 'SCCGTERR-NBR-REPL', paragraphNames: ['SCCGTERR-GET-ERR', 'SCCGTERR-REPL-1'] },
    ]
    const result = filterEntryPoints(eps, dispatch)
    expect(result).toHaveLength(1)
    expect(result[0].condition).toBe('FUNC="INS"')
  })

  it('always keeps entry points with condition "always"', () => {
    const eps = [{ condition: 'always', paragraphNames: ['MAIN-LOGIC'] }]
    expect(filterEntryPoints(eps, dispatch)).toHaveLength(1)
  })

  it('returns all entry points when evaluateDispatch is empty', () => {
    const eps = [
      { condition: 'X', paragraphNames: ['PARA-A'] },
      { condition: 'Y', paragraphNames: ['PARA-B'] },
    ]
    expect(filterEntryPoints(eps, [])).toHaveLength(2)
  })

  it('matching is case-insensitive', () => {
    const eps = [{ condition: 'X', paragraphNames: ['insert-record'] }]
    expect(filterEntryPoints(eps, dispatch)).toHaveLength(1)
  })
})
