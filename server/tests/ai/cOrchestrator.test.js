import { describe, it, expect, vi } from 'vitest'
import { runCAnalysis, estimateCTokens } from '../../src/ai/cOrchestrator.js'

function makeProvider(overrides = {}) {
  return {
    extractBusinessAnalysis: vi.fn().mockResolvedValue({
      businessPurpose: 'Test purpose',
      parameters: [],
      entryPoints: [],
      errorCatalog: [],
      externalDependencies: [],
      dbTables: [],
      fileIO: [],
    }),
    analyzeEntryPoint: vi.fn().mockResolvedValue({
      steps: [], sideEffects: [], returns: '', errors: [],
    }),
    ...overrides,
  }
}

const MINIMAL_C = `
#define PGM_NM "testpgm"
#define PRS_MD_FETCH 'F'

static char pvtsName[10 + 1] = "";

int testpgm(TPSVCINFO *rqst)
{
  pvtInitVars(rqst);
  pvtBusinessLogic();
  return 0;
}

static void pvtBusinessLogic(void)
{
  pvtValidateInput();
  pvtProgramLogic();
  return;
}

static void pvtValidateInput(void)
{
  if (testpgmInpRec.prs_md[0] != PRS_MD_FETCH) {
    svcLogErrMsg(1, 1, "0000001500", "PRS-MD");
  }
  return;
}

static void pvtProgramLogic(void)
{
  switch (testpgmInpRec.prs_md[0]) {
    case PRS_MD_FETCH:
      pvtDoFetch();
      break;
    default:
      break;
  }
  return;
}

static void pvtDoFetch(void)
{
  svcCallSvc("exydli", sInp, INP_SIZE, sOut, OUT_SIZE, "");
  return;
}
`.trim()

function makeChunks() {
  return [
    { chunk_name: 'testpgm',          chunk_type: 'entry_point', cobol_text: 'int testpgm(TPSVCINFO *rqst) { pvtInitVars(rqst); pvtBusinessLogic(); }' },
    { chunk_name: 'pvtBusinessLogic', chunk_type: 'function',    cobol_text: 'pvtBusinessLogic(void) { pvtValidateInput(); pvtProgramLogic(); }' },
    { chunk_name: 'pvtValidateInput', chunk_type: 'function',    cobol_text: 'pvtValidateInput(void) { svcLogErrMsg(1,1,"0000001500","PRS-MD"); }' },
    { chunk_name: 'pvtProgramLogic',  chunk_type: 'function',    cobol_text: 'pvtProgramLogic(void) { switch (rec.prs_md[0]) { case PRS_MD_FETCH: pvtDoFetch(); break; } }' },
    { chunk_name: 'pvtDoFetch',       chunk_type: 'function',    cobol_text: 'pvtDoFetch(void) { svcCallSvc("exydli", sInp, INP_SIZE, sOut, OUT_SIZE, ""); }' },
  ]
}

describe('estimateCTokens', () => {
  it('returns ceil(length / 4)', () => {
    expect(estimateCTokens('a'.repeat(100))).toBe(25)
    expect(estimateCTokens('a'.repeat(101))).toBe(26)
  })
})

describe('runCAnalysis', () => {
  it('calls provider.extractBusinessAnalysis once for small file', async () => {
    const provider = makeProvider()
    await runCAnalysis({ cText: MINIMAL_C, uText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    expect(provider.extractBusinessAnalysis).toHaveBeenCalledOnce()
  })

  it('returns mapResult-shaped object', async () => {
    const provider = makeProvider()
    const result = await runCAnalysis({ cText: MINIMAL_C, uText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    expect(result).toHaveProperty('business_purpose')
    expect(result).toHaveProperty('entry_points')
    expect(result).toHaveProperty('error_catalog')
    expect(result).toHaveProperty('input_contract')
    expect(result).toHaveProperty('output_contract')
    expect(result).toHaveProperty('db_tables')
    expect(result).toHaveProperty('file_ops')
    expect(result.file_ops).toEqual([])
  })

  it('includes MODE DISPATCH in context when switch present', async () => {
    const provider = makeProvider()
    await runCAnalysis({ cText: MINIMAL_C, uText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    const ctx = provider.extractBusinessAnalysis.mock.calls[0][0]
    expect(ctx).toContain('MODE DISPATCH')
  })

  it('includes ERROR CALLS in context', async () => {
    const provider = makeProvider()
    await runCAnalysis({ cText: MINIMAL_C, uText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    const ctx = provider.extractBusinessAnalysis.mock.calls[0][0]
    expect(ctx).toContain('ERROR CALLS')
    expect(ctx).toContain('1500')
  })

  it('includes PRE-DISPATCH FUNCTIONS in context', async () => {
    const provider = makeProvider()
    await runCAnalysis({ cText: MINIMAL_C, uText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    const ctx = provider.extractBusinessAnalysis.mock.calls[0][0]
    expect(ctx).toContain('PRE-DISPATCH FUNCTIONS')
    expect(ctx).toContain('pvtValidateInput')
  })

  it('includes SERVICE CALLS in context', async () => {
    const provider = makeProvider()
    await runCAnalysis({ cText: MINIMAL_C, uText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    const ctx = provider.extractBusinessAnalysis.mock.calls[0][0]
    expect(ctx).toContain('SERVICE CALLS')
    expect(ctx).toContain('exydli')
  })

  it('passes lang=c to provider.extractBusinessAnalysis', async () => {
    const provider = makeProvider()
    await runCAnalysis({ cText: MINIMAL_C, uText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    expect(provider.extractBusinessAnalysis.mock.calls[0][2]).toBe('c')
  })

  it('returns analysis_two_step: false for small file', async () => {
    const provider = makeProvider()
    const result = await runCAnalysis({ cText: MINIMAL_C, uText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    expect(result.analysis_two_step).toBe(false)
  })

  it('returns pre_dispatch as array', async () => {
    const provider = makeProvider()
    const result = await runCAnalysis({ cText: MINIMAL_C, uText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    expect(Array.isArray(result.pre_dispatch)).toBe(true)
  })

  it('keeps paragraphNames in entry_points', async () => {
    const provider = makeProvider({
      extractBusinessAnalysis: vi.fn().mockResolvedValue({
        businessPurpose: 'Test',
        parameters: [],
        entryPoints: [{ condition: 'always', businessName: 'Run', paragraphNames: ['pvtFoo'], steps: [], sideEffects: [], returns: '', errors: [] }],
        errorCatalog: [], externalDependencies: [], dbTables: [], fileIO: [],
      }),
    })
    const result = await runCAnalysis({ cText: MINIMAL_C, uText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    expect(Array.isArray(result.entry_points[0].paragraphNames)).toBe(true)
  })

  it('two-step for large file: calls extractBusinessAnalysis once and analyzeEntryPoint per entry point', async () => {
    const hugeChunks = Array.from({ length: 5 }, (_, i) => ({
      chunk_name: `pvtFunc${i}`,
      chunk_type: 'function',
      cobol_text: 'x'.repeat(80000),
    }))
    const provider = makeProvider({
      extractBusinessAnalysis: vi.fn().mockResolvedValue({
        businessPurpose: 'Big program',
        parameters: [],
        entryPoints: [
          { condition: "prs_md='F'", businessName: 'Fetch', paragraphNames: ['pvtFunc0'], steps: [], sideEffects: [], returns: '', errors: [] },
        ],
        errorCatalog: [],
        externalDependencies: [],
        dbTables: [],
        fileIO: [],
      }),
    })
    await runCAnalysis({ cText: '', uText: '', chunks: hugeChunks, provider, emit: () => {}, programName: 'T' })
    expect(provider.extractBusinessAnalysis).toHaveBeenCalledTimes(1)
    expect(provider.analyzeEntryPoint).toHaveBeenCalledTimes(1)
  })
})
