import { describe, it, expect } from 'vitest'
import {
  parseCProgram,
  extractCConstants, extractCIncludes, extractCGlobalVars,
  extractCModes, extractCServiceCalls, extractCDbCalls, extractCErrors,
  extractCCallGraph, findCPreDispatch, extractUDeps,
} from '../../src/parser/cParser.js'

const SIMPLE_C = `
#define PGM_NM "testpgm"

int testpgm(TPSVCINFO *rqst)
{
  pvtInitVars(rqst);
  return 0;
}

static void pvtInitVars(TPSVCINFO *rqst)
{
  pvtiRtnSts = 0;
  return;
}

static void pvtBusinessLogic(void)
{
  pvtValidate();
  pvtProgramLogic();
  return;
}
`.trim()

describe('parseCProgram', () => {
  it('returns empty array for empty input', () => {
    expect(parseCProgram('')).toEqual([])
  })

  it('extracts public entry point as entry_point chunk', () => {
    const chunks = parseCProgram(SIMPLE_C)
    const ep = chunks.find(c => c.chunk_type === 'entry_point')
    expect(ep).toBeDefined()
    expect(ep.chunk_name).toBe('testpgm')
  })

  it('extracts static functions as function chunks', () => {
    const chunks = parseCProgram(SIMPLE_C)
    const fns = chunks.filter(c => c.chunk_type === 'function')
    expect(fns.map(f => f.chunk_name)).toContain('pvtInitVars')
    expect(fns.map(f => f.chunk_name)).toContain('pvtBusinessLogic')
  })

  it('does not include function prototypes as chunks', () => {
    const src = `static void pvtHelper(void);\nint main(TPSVCINFO *r)\n{\n  return 0;\n}`
    const chunks = parseCProgram(src)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].chunk_name).toBe('main')
  })

  it('sets start_line and end_line (1-indexed)', () => {
    const chunks = parseCProgram(SIMPLE_C)
    const ep = chunks.find(c => c.chunk_name === 'testpgm')
    expect(ep.start_line).toBeGreaterThan(0)
    expect(ep.end_line).toBeGreaterThan(ep.start_line)
  })

  it('stores function body text in cobol_text', () => {
    const chunks = parseCProgram(SIMPLE_C)
    const fn = chunks.find(c => c.chunk_name === 'pvtInitVars')
    expect(fn.cobol_text).toContain('pvtiRtnSts = 0')
  })

  it('sets order_index sequentially', () => {
    const chunks = parseCProgram(SIMPLE_C)
    chunks.forEach((c, i) => expect(c.order_index).toBe(i))
  })

  it('handles nested braces inside function body', () => {
    const src = `int fn(TPSVCINFO *r)\n{\n  if (x) {\n    if (y) {\n      z();\n    }\n  }\n  return 0;\n}`
    const chunks = parseCProgram(src)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].cobol_text).toContain('if (y)')
  })
})

describe('extractCConstants', () => {
  it('returns empty array for no defines', () => {
    expect(extractCConstants('int main() {}')).toEqual([])
  })

  it('extracts char literal constants', () => {
    const src = `#define PRS_MD_FETCH 'F'\n#define PRS_MD_UPDATE 'U'`
    const result = extractCConstants(src)
    expect(result).toContainEqual({ name: 'PRS_MD_FETCH', value: "'F'" })
    expect(result).toContainEqual({ name: 'PRS_MD_UPDATE', value: "'U'" })
  })

  it('extracts string constants', () => {
    const src = `#define PGM_NM "exbdli"`
    const result = extractCConstants(src)
    expect(result).toContainEqual({ name: 'PGM_NM', value: '"exbdli"' })
  })

  it('extracts numeric constants', () => {
    const src = `#define PAGE_SIZE 10`
    expect(extractCConstants(src)).toContainEqual({ name: 'PAGE_SIZE', value: '10' })
  })

  it('skips include guards (all-caps single token without quotes/digits)', () => {
    const src = `#define EXBDLI_H\n#define PRS_MD 'F'`
    const result = extractCConstants(src)
    expect(result.find(c => c.name === 'EXBDLI_H')).toBeUndefined()
    expect(result.find(c => c.name === 'PRS_MD')).toBeDefined()
  })
})

describe('extractCIncludes', () => {
  it('returns empty array for no includes', () => {
    expect(extractCIncludes('int x = 1;')).toEqual([])
  })

  it('extracts local includes (quoted)', () => {
    const src = `#include "syscom.h"\n#include "exbdli.h"\n#include <stdio.h>`
    expect(extractCIncludes(src)).toEqual(['syscom.h', 'exbdli.h'])
  })

  it('does not include system headers (angle brackets)', () => {
    expect(extractCIncludes('#include <stdlib.h>')).toEqual([])
  })
})

describe('extractCGlobalVars', () => {
  it('returns empty array for no static globals', () => {
    expect(extractCGlobalVars('int main() { return 0; }')).toEqual([])
  })

  it('extracts static char arrays', () => {
    const src = `static char pvtsName[NAME_SIZE + 1] = "";`
    const result = extractCGlobalVars(src)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ type: 'char', name: 'pvtsName' })
  })

  it('extracts static int globals', () => {
    const src = `static int pvtiLicCnt = 0;`
    const result = extractCGlobalVars(src)
    expect(result).toContainEqual({ type: 'int', name: 'pvtiLicCnt' })
  })

  it('does not include static function declarations', () => {
    const src = `static void pvtHelper(void);\nstatic int pvtiCount = 0;`
    const result = extractCGlobalVars(src)
    expect(result.find(v => v.name === 'pvtHelper')).toBeUndefined()
    expect(result).toHaveLength(1)
  })
})

describe('extractCModes', () => {
  it('returns empty array when no switch on prs_md', () => {
    expect(extractCModes('int main() { switch(x) { case 1: break; } }')).toEqual([])
  })

  it('extracts switch on prs_md with case constants', () => {
    const src = `
static void pvtProgramLogic(void) {
  switch (exbdliInpRec.prs_md[0]) {
    case PRS_MD_FETCH:
      pvtDoFetch();
      break;
    case PRS_MD_UPDATE:
      pvtDoUpdate();
      break;
    default:
      break;
  }
}`
    const result = extractCModes(src)
    expect(result).toHaveLength(1)
    expect(result[0].switchVar).toBe('prs_md')
    expect(result[0].cases).toHaveLength(2)
    expect(result[0].cases[0]).toEqual({ constant: 'PRS_MD_FETCH', callTarget: 'pvtDoFetch' })
    expect(result[0].cases[1]).toEqual({ constant: 'PRS_MD_UPDATE', callTarget: 'pvtDoUpdate' })
  })

  it('handles if-based single mode validation (no switch → returns [])', () => {
    const src = `
static void pvtValidateInput(void) {
  if (exbdliInpRec.prs_md[0] != PRS_MD_POPL) {
    svcLogErrMsg(1, 1, "0000001500", "PRS-MD");
    MAIN_LOGIC_RETURN
  }
}`
    expect(extractCModes(src)).toEqual([])
  })

  it('extracts call target for fall-through cases', () => {
    const src = `
static void pvtProgramLogic(void) {
  switch (rec.prs_md[0]) {
    case PRS_MD_A:
    case PRS_MD_B:
      pvtHandleAB();
      break;
  }
}`
    const result = extractCModes(src)
    expect(result[0].cases[0]).toEqual({ constant: 'PRS_MD_A', callTarget: 'pvtHandleAB' })
    expect(result[0].cases[1]).toEqual({ constant: 'PRS_MD_B', callTarget: 'pvtHandleAB' })
  })
})

describe('extractCServiceCalls', () => {
  it('returns empty array when no svcCallSvc', () => {
    expect(extractCServiceCalls('int main() { return 0; }')).toEqual([])
  })

  it('extracts service name from svcCallSvc', () => {
    const src = `svcCallSvc("exydli", sInp, INP_SIZE, sOut, OUT_SIZE, "");`
    expect(extractCServiceCalls(src)).toEqual(['exydli'])
  })

  it('deduplicates repeated calls to same service', () => {
    const src = `svcCallSvc("exydli", a, 1, b, 2, "");\nsvcCallSvc("exydli", c, 1, d, 2, "");`
    expect(extractCServiceCalls(src)).toEqual(['exydli'])
  })

  it('extracts multiple distinct services', () => {
    const src = `svcCallSvc("exydli", a, 1, b, 2, "");\nsvcCallSvc("exylui", c, 1, d, 2, "");`
    expect(extractCServiceCalls(src)).toEqual(['exydli', 'exylui'])
  })
})

describe('extractCDbCalls', () => {
  it('returns empty array when no svcCallPlnsqlio', () => {
    expect(extractCDbCalls('int main() {}')).toEqual([])
  })

  it('extracts table name and operation', () => {
    const src = `svcCallPlnsqlio(TRACE_INFO, "exrmgd", "1", "2", RDN, &rec, ssizeRec, STXCONT, 0);`
    const result = extractCDbCalls(src)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ table: 'exrmgd', operation: 'RDN' })
  })

  it('deduplicates same table+operation', () => {
    const src = [
      `svcCallPlnsqlio(TRACE_INFO, "exrmgd", "1", "2", INL, &r, s, STXCONT, 0);`,
      `svcCallPlnsqlio(TRACE_INFO, "exrmgd", "1", "2", RDN, &r, s, STXCONT, 0);`,
      `svcCallPlnsqlio(TRACE_INFO, "exrmgd", "1", "2", RDN, &r, s, STXCONT, 0);`,
    ].join('\n')
    const result = extractCDbCalls(src)
    expect(result).toHaveLength(2)
  })

  it('groups multiple operations on same table', () => {
    const src = [
      `svcCallPlnsqlio(TRACE_INFO, "custbl", "1", "2", SGE, &r, s, STXCONT, 0);`,
      `svcCallPlnsqlio(TRACE_INFO, "custbl", "1", "2", RDN, &r, s, STXCONT, 0);`,
    ].join('\n')
    const tables = extractCDbCalls(src).map(e => e.table)
    expect(tables.filter(t => t === 'custbl')).toHaveLength(2)
  })
})

describe('extractCErrors', () => {
  it('returns empty array when no svcLogErrMsg', () => {
    expect(extractCErrors('int main() {}')).toEqual([])
  })

  it('extracts error code and field name', () => {
    const src = `svcLogErrMsg(1, 1, "0000001500", "PRS-MD");`
    const result = extractCErrors(src)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ code: 1500, field: 'PRS-MD' })
  })

  it('strips leading zeros from code', () => {
    const src = `svcLogErrMsg(1, 1, "0000002169", "REF-PFX");`
    expect(extractCErrors(src)[0].code).toBe(2169)
  })

  it('deduplicates same error code', () => {
    const src = [
      `svcLogErrMsg(1, 1, "0000001500", "PRS-MD");`,
      `svcLogErrMsg(1, 1, "0000001500", "PRS-MD");`,
    ].join('\n')
    expect(extractCErrors(src)).toHaveLength(1)
  })

  it('sorts by code ascending', () => {
    const src = [
      `svcLogErrMsg(1, 1, "0000002000", "A");`,
      `svcLogErrMsg(1, 1, "0000001000", "B");`,
    ].join('\n')
    expect(extractCErrors(src).map(e => e.code)).toEqual([1000, 2000])
  })
})

describe('extractCCallGraph', () => {
  it('returns empty Map for empty chunks', () => {
    expect(extractCCallGraph([])).toEqual(new Map())
  })

  it('maps function to pvtXxx functions it calls', () => {
    const chunks = [
      { chunk_name: 'pvtBusinessLogic', chunk_type: 'function', cobol_text: 'pvtBusinessLogic(void) {\n  pvtValidate();\n  pvtProgramLogic();\n}' },
      { chunk_name: 'pvtValidate', chunk_type: 'function', cobol_text: 'pvtValidate(void) {\n  return;\n}' },
    ]
    const graph = extractCCallGraph(chunks)
    expect(graph.get('pvtBusinessLogic')).toEqual(new Set(['pvtValidate', 'pvtProgramLogic']))
    expect(graph.get('pvtValidate')).toEqual(new Set())
  })

  it('does not include non-pvt calls like svcCallSvc', () => {
    const chunks = [
      { chunk_name: 'pvtDoFetch', chunk_type: 'function', cobol_text: 'pvtDoFetch(void) {\n  svcCallSvc("x", a, 1, b, 2, "");\n}' },
    ]
    const graph = extractCCallGraph(chunks)
    expect(graph.get('pvtDoFetch').has('svcCallSvc')).toBe(false)
  })
})

describe('findCPreDispatch', () => {
  it('returns empty array when no switch on prs_md', () => {
    const chunks = [
      { chunk_name: 'pvtBusinessLogic', chunk_type: 'function', cobol_text: 'pvtBusinessLogic(void) {\n  pvtValidate();\n}' },
    ]
    expect(findCPreDispatch(chunks)).toEqual([])
  })

  it('returns functions called before the dispatch function', () => {
    const chunks = [
      {
        chunk_name: 'pvtProgramLogic',
        chunk_type: 'function',
        cobol_text: 'pvtProgramLogic(void) {\n  switch (rec.prs_md[0]) {\n    case MODE_A:\n      pvtDoA();\n      break;\n  }\n}',
      },
      {
        chunk_name: 'pvtBusinessLogic',
        chunk_type: 'function',
        cobol_text: 'pvtBusinessLogic(void) {\n  pvtValidateInput();\n  pvtInitSetup();\n  pvtProgramLogic();\n}',
      },
    ]
    const preDispatch = findCPreDispatch(chunks)
    expect(preDispatch).toContain('pvtValidateInput')
    expect(preDispatch).toContain('pvtInitSetup')
    expect(preDispatch).not.toContain('pvtProgramLogic')
  })
})

describe('extractUDeps', () => {
  it('returns empty array for empty input', () => {
    expect(extractUDeps('')).toEqual([])
  })

  it('extracts header names from .u file lines', () => {
    const uText = [
      'exbdli.o: exbdli.c',
      'exbdli.o: ${ICM_SOURCE}/include/syscom.h',
      'exbdli.o: ${ICM_SOURCE}/include/exydli.h',
      'exbdli.o: ${ICM_SOURCE}/include/exbdli.h',
    ].join('\n')
    const result = extractUDeps(uText)
    expect(result).toContain('syscom.h')
    expect(result).toContain('exydli.h')
    expect(result).toContain('exbdli.h')
  })

  it('does not include .c source file', () => {
    const uText = 'exbdli.o: exbdli.c\nexbdli.o: ${ICM_SOURCE}/include/exbdli.h'
    expect(extractUDeps(uText)).not.toContain('exbdli.c')
  })

  it('deduplicates headers', () => {
    const uText = [
      'exbdli.o: ${ICM_SOURCE}/include/syscom.h',
      'exbdli.o: ${ICM_SOURCE}/include/syscom.h',
    ].join('\n')
    expect(extractUDeps(uText)).toHaveLength(1)
  })
})
