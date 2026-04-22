import { parseCobol, extractLinkage, extractWorkingStorage, extractLinkageVars, extractEvaluateDispatch, extractPerformGraph, resolveTransitive } from '../../src/parser/cobolParser.js'

const MINI_COBOL = `
 IDENTIFICATION DIVISION.
 PROGRAM-ID. TEST.
 DATA DIVISION.
 WORKING-STORAGE SECTION.
 01 WS-VAR PIC X.
 PROCEDURE DIVISION.
 MAIN-PARA.
     MOVE "A" TO WS-VAR.
     STOP RUN.
`.trim()

describe('parseCobol', () => {
  test('returns array of chunks', () => {
    const chunks = parseCobol(MINI_COBOL)
    expect(Array.isArray(chunks)).toBe(true)
    expect(chunks.length).toBeGreaterThan(0)
  })

  test('each chunk has required fields', () => {
    const chunks = parseCobol(MINI_COBOL)
    for (const chunk of chunks) {
      expect(chunk).toHaveProperty('chunk_type')
      expect(chunk).toHaveProperty('chunk_name')
      expect(chunk).toHaveProperty('start_line')
      expect(chunk).toHaveProperty('end_line')
      expect(chunk).toHaveProperty('cobol_text')
      expect(chunk).toHaveProperty('token_estimate')
      expect(chunk).toHaveProperty('order_index')
      expect(chunk).toHaveProperty('status', 'pending')
      expect(typeof chunk.chunk_name).toBe('string')
      expect(chunk.chunk_name.length).toBeGreaterThan(0)
    }
  })

  test('identifies WORKING-STORAGE section as data_summary chunk', () => {
    const chunks = parseCobol(MINI_COBOL)
    const ws = chunks.find(c => c.chunk_name === 'WORKING-STORAGE')
    expect(ws).toBeDefined()
    expect(ws.chunk_type).toBe('data_summary')
  })

  test('identifies MAIN-PARA as paragraph chunk', () => {
    const chunks = parseCobol(MINI_COBOL)
    const para = chunks.find(c => c.chunk_name === 'MAIN-PARA')
    expect(para).toBeDefined()
    expect(para.chunk_type).toBe('paragraph')
  })

  test('token_estimate is positive integer', () => {
    const chunks = parseCobol(MINI_COBOL)
    for (const chunk of chunks) {
      expect(Number.isInteger(chunk.token_estimate)).toBe(true)
      expect(chunk.token_estimate).toBeGreaterThan(0)
    }
  })

  test('splits large sections into sub-chunks with [N] naming', () => {
    const lines = [
      ' IDENTIFICATION DIVISION.',
      ' PROGRAM-ID. BIG.',
      ' DATA DIVISION.',
      ' WORKING-STORAGE SECTION.',
    ]
    for (let i = 0; i < 350; i++) lines.push(` 01 VAR-${i} PIC X.`)
    lines.push(' PROCEDURE DIVISION.')
    lines.push(' MAIN. STOP RUN.')

    const chunks = parseCobol(lines.join('\n'))
    const ws1 = chunks.find(c => c.chunk_name === 'WORKING-STORAGE')
    const ws2 = chunks.find(c => c.chunk_name === 'WORKING-STORAGE [2]')
    expect(ws1).toBeDefined()
    expect(ws2).toBeDefined()
    expect(ws1.end_line - ws1.start_line).toBeLessThanOrEqual(300)
  })

  test('splits large paragraphs into sub_paragraph chunks', () => {
    const lines = [
      ' IDENTIFICATION DIVISION.',
      ' PROGRAM-ID. BIG.',
      ' PROCEDURE DIVISION.',
      ' LONG-PARA.',
    ]
    for (let i = 0; i < 350; i++) lines.push(`     MOVE ${i} TO WS-X.`)
    lines.push(' END-PARA. EXIT.')

    const chunks = parseCobol(lines.join('\n'))
    const sub = chunks.filter(c => c.chunk_type === 'sub_paragraph')
    expect(sub.length).toBeGreaterThan(1)
    // First window uses plain name (consistent with data section naming)
    expect(sub[0].chunk_name).toBe('LONG-PARA')
    // Subsequent windows use [N] suffix
    expect(sub[1].chunk_name).toMatch(/LONG-PARA \[/)
  })

  test('order_index is sequential starting at 0', () => {
    const chunks = parseCobol(MINI_COBOL)
    chunks.forEach((c, i) => expect(c.order_index).toBe(i))
  })

  it('detects mixed-case paragraph names', () => {
    const cobol = `       IDENTIFICATION DIVISION.
       PROGRAM-ID. TEST.
       PROCEDURE DIVISION.
       main-para.
         MOVE 1 TO WS-X.
       Calc-Total.
         ADD 1 TO WS-X.
`;
    const chunks = parseCobol(cobol);
    const names = chunks.map(c => c.chunk_name);
    expect(names).toContain('MAIN-PARA');
    expect(names).toContain('CALC-TOTAL');
  });

  it('does not exclude END-prefixed user paragraph names', () => {
    const cobol = `       IDENTIFICATION DIVISION.
       PROGRAM-ID. TEST.
       PROCEDURE DIVISION.
       END-OF-FILE-PARA.
         STOP RUN.
`;
    const chunks = parseCobol(cobol);
    const names = chunks.map(c => c.chunk_name);
    expect(names).toContain('END-OF-FILE-PARA');
  });

  test('handles fixed-format COBOL with sequence numbers in columns 1-6', () => {
    // Fixed-format COBOL has 6-digit sequence numbers at start of each line
    const fixedFormat = [
      '000010 IDENTIFICATION DIVISION.',
      '000020 PROGRAM-ID. FIXED.',
      '000030 DATA DIVISION.',
      '000040 WORKING-STORAGE SECTION.',
      '000050 01 WS-X PIC X.',
      '000060 PROCEDURE DIVISION.',
      '000070 MAIN-PARA.',
      '000080     MOVE "X" TO WS-X.',
      '000090     STOP RUN.',
    ].join('\n')

    const chunks = parseCobol(fixedFormat)
    expect(chunks.length).toBeGreaterThan(0)
    const ws = chunks.find(c => c.chunk_name === 'WORKING-STORAGE')
    expect(ws).toBeDefined()
    const para = chunks.find(c => c.chunk_name === 'MAIN-PARA')
    expect(para).toBeDefined()
  })
})

describe('extractLinkage', () => {
  it('returns empty string when no LINKAGE SECTION', () => {
    expect(extractLinkage('PROCEDURE DIVISION.\n PARA.\n   STOP RUN.')).toBe('')
  })

  it('extracts LINKAGE SECTION up to PROCEDURE DIVISION', () => {
    const src = `
 DATA DIVISION.
 LINKAGE SECTION.
 01 PARAM PIC X(8).
 PROCEDURE DIVISION USING PARAM.
 MAIN.
   STOP RUN.`.trim()
    const result = extractLinkage(src)
    expect(result).toContain('LINKAGE SECTION')
    expect(result).toContain('PARAM PIC X(8)')
    expect(result).not.toContain('PROCEDURE DIVISION')
  })

  it('stops at WORKING-STORAGE SECTION if it comes before PROCEDURE DIVISION', () => {
    const src = `LINKAGE SECTION.\n 01 A PIC X.\nWORKING-STORAGE SECTION.\n 01 B PIC X.`
    const result = extractLinkage(src)
    expect(result).toContain('01 A')
    expect(result).not.toContain('01 B')
  })
})

describe('extractWorkingStorage', () => {
  it('returns empty array when no WORKING-STORAGE SECTION', () => {
    expect(extractWorkingStorage('PROCEDURE DIVISION.\n PARA.\n   STOP RUN.')).toEqual([])
  })

  it('returns empty array for empty input', () => {
    expect(extractWorkingStorage('')).toEqual([])
  })

  it('extracts 01-level variable with PIC', () => {
    const src = `DATA DIVISION.\nWORKING-STORAGE SECTION.\n 01 WS-FLAG PIC X.\nPROCEDURE DIVISION.`
    const result = extractWorkingStorage(src)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ level: '01', name: 'WS-FLAG', pic: 'X', conditions: [] })
  })

  it('extracts 88-level conditions attached to parent variable', () => {
    const src = `WORKING-STORAGE SECTION.\n 01 WS-STATUS PIC X(2).\n    88 STATUS-OK VALUE '00'.\n    88 STATUS-ERR VALUE '99'.`
    const result = extractWorkingStorage(src)
    expect(result[0].conditions).toHaveLength(2)
    expect(result[0].conditions[0]).toEqual({ name: 'STATUS-OK', value: "'00'" })
    expect(result[0].conditions[1]).toEqual({ name: 'STATUS-ERR', value: "'99'" })
  })

  it('stops at PROCEDURE DIVISION', () => {
    const src = `WORKING-STORAGE SECTION.\n 01 WS-A PIC X.\nPROCEDURE DIVISION.\n 01 NOT-WS PIC X.`
    const result = extractWorkingStorage(src)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('WS-A')
  })

  it('stops at LINKAGE SECTION', () => {
    const src = `WORKING-STORAGE SECTION.\n 01 WS-A PIC X.\nLINKAGE SECTION.\n 01 LP-B PIC X.`
    const result = extractWorkingStorage(src)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('WS-A')
  })

  it('extracts group level variable (no PIC) with nested fields', () => {
    const src = `WORKING-STORAGE SECTION.\n 01 WS-GROUP.\n    05 WS-A PIC X.\n    05 WS-B PIC 9.`
    const result = extractWorkingStorage(src)
    const group = result.find(v => v.name === 'WS-GROUP')
    expect(group.pic).toBeNull()
    expect(result.find(v => v.name === 'WS-A').pic).toBe('X')
    expect(result.find(v => v.name === 'WS-B').pic).toBe('9')
  })

  it('normalises variable names to uppercase', () => {
    const src = `WORKING-STORAGE SECTION.\n 01 ws-flag PIC X.`
    const result = extractWorkingStorage(src)
    expect(result[0].name).toBe('WS-FLAG')
  })
})

describe('extractLinkageVars', () => {
  it('returns empty array when no LINKAGE SECTION', () => {
    expect(extractLinkageVars('PROCEDURE DIVISION.\n PARA.\n   STOP RUN.')).toEqual([])
  })

  it('extracts 01-level parameter with PIC and direction in', () => {
    const src = `DATA DIVISION.\nLINKAGE SECTION.\n 01 CPSRI-PART-ID PIC X(8).\nPROCEDURE DIVISION.`
    const result = extractLinkageVars(src)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ level: '01', name: 'CPSRI-PART-ID', pic: 'X(8)', conditions: [], direction: 'in' })
  })

  it('detects direction out from RO pattern', () => {
    const src = `LINKAGE SECTION.\n 01 CPSRO-RTN-STS PIC 9(4).\nPROCEDURE DIVISION.`
    const result = extractLinkageVars(src)
    expect(result[0].direction).toBe('out')
  })

  it('detects direction in from UI pattern (z-programs)', () => {
    const src = `LINKAGE SECTION.\n 01 CHGUI-REF-PFX PIC X(2).\nPROCEDURE DIVISION.`
    const result = extractLinkageVars(src)
    expect(result[0].direction).toBe('in')
  })

  it('detects direction out from UO pattern (z-programs)', () => {
    const src = `LINKAGE SECTION.\n 01 CHGUO-RTN-STS PIC 9(4).\nPROCEDURE DIVISION.`
    const result = extractLinkageVars(src)
    expect(result[0].direction).toBe('out')
  })

  it('returns direction null for fields not matching naming convention', () => {
    const src = `LINKAGE SECTION.\n 01 LP-INPUT PIC X(8).\nPROCEDURE DIVISION.`
    const result = extractLinkageVars(src)
    expect(result[0].direction).toBeNull()
  })

  it('extracts group with nested 05-level fields', () => {
    const src = `LINKAGE SECTION.\n 01 LP-GROUP.\n    05 VLLRI-CODE PIC X(2).\n    05 VLLRO-STATUS PIC 9.\nPROCEDURE DIVISION.`
    const result = extractLinkageVars(src)
    expect(result.find(v => v.name === 'VLLRI-CODE').direction).toBe('in')
    expect(result.find(v => v.name === 'VLLRO-STATUS').direction).toBe('out')
  })

  it('extracts 88-level conditions on linkage field', () => {
    const src = `LINKAGE SECTION.\n 01 VLLRI-FUNC PIC X(2).\n    88 FUNC-READ   VALUE "RD".\n    88 FUNC-INSERT VALUE "INS".`
    const result = extractLinkageVars(src)
    expect(result[0].conditions).toHaveLength(2)
    expect(result[0].conditions[0]).toEqual({ name: 'FUNC-READ', value: '"RD"' })
  })

  it('stops at WORKING-STORAGE SECTION', () => {
    const src = `LINKAGE SECTION.\n 01 LP-A PIC X.\nWORKING-STORAGE SECTION.\n 01 WS-B PIC X.`
    const result = extractLinkageVars(src)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('LP-A')
  })
})

describe('extractEvaluateDispatch', () => {
  it('returns empty array when no EVALUATE', () => {
    expect(extractEvaluateDispatch('PROCEDURE DIVISION.\n PARA.\n   MOVE 1 TO X.')).toEqual([])
  })

  it('returns empty array when EVALUATE has no PERFORM entries', () => {
    const cobol = `
      EVALUATE WS-FLAG
        WHEN "Y"
          MOVE 1 TO WS-X
        WHEN OTHER
          MOVE 0 TO WS-X
      END-EVALUATE
    `
    expect(extractEvaluateDispatch(cobol)).toEqual([])
  })

  it('extracts single EVALUATE with two WHEN-PERFORM entries', () => {
    const cobol = `
      EVALUATE VLLRI-PRS-MD
        WHEN "1"
          PERFORM PROCESS-CREATE
        WHEN "2"
          PERFORM PROCESS-READ
      END-EVALUATE
    `
    const result = extractEvaluateDispatch(cobol)
    expect(result).toHaveLength(1)
    expect(result[0].evaluateSubject).toBe('VLLRI-PRS-MD')
    expect(result[0].entries).toHaveLength(2)
    expect(result[0].entries[0]).toEqual({ whenValue: '"1"', performParagraph: 'PROCESS-CREATE' })
    expect(result[0].entries[1]).toEqual({ whenValue: '"2"', performParagraph: 'PROCESS-READ' })
  })

  it('includes WHEN OTHER entries', () => {
    const cobol = `
      EVALUATE WS-MODE
        WHEN "A"
          PERFORM DO-A
        WHEN OTHER
          PERFORM DO-DEFAULT
      END-EVALUATE
    `
    const result = extractEvaluateDispatch(cobol)
    expect(result[0].entries.find(e => e.whenValue === 'OTHER')).toBeDefined()
    expect(result[0].entries.find(e => e.whenValue === 'OTHER').performParagraph).toBe('DO-DEFAULT')
  })

  it('extracts multiple separate EVALUATE blocks', () => {
    const cobol = `
      EVALUATE WS-FUNC
        WHEN "RD"
          PERFORM READ-RECORD
      END-EVALUATE
      EVALUATE WS-STATUS
        WHEN "OK"
          PERFORM FINISH-OK
      END-EVALUATE
    `
    const result = extractEvaluateDispatch(cobol)
    expect(result).toHaveLength(2)
    expect(result[0].evaluateSubject).toBe('WS-FUNC')
    expect(result[1].evaluateSubject).toBe('WS-STATUS')
  })

  it('handles fixed-format COBOL with sequence numbers', () => {
    const cobol = [
      '000010 EVALUATE WS-MODE',
      '000020   WHEN "1"',
      '000030     PERFORM MODE-ONE',
      '000040 END-EVALUATE',
    ].join('\n')
    const result = extractEvaluateDispatch(cobol)
    expect(result).toHaveLength(1)
    expect(result[0].entries[0].performParagraph).toBe('MODE-ONE')
  })

  it('nested EVALUATE does not corrupt outer block WHEN entries', () => {
    const cobol = `
      EVALUATE WS-OUTER
        WHEN "A"
          PERFORM DO-A
        WHEN "B"
          EVALUATE WS-INNER
            WHEN "X"
              PERFORM DO-X
          END-EVALUATE
        WHEN "C"
          PERFORM DO-C
      END-EVALUATE
    `
    const result = extractEvaluateDispatch(cobol)
    expect(result).toHaveLength(1)
    expect(result[0].evaluateSubject).toBe('WS-OUTER')
    const values = result[0].entries.map(e => e.whenValue)
    expect(values).toContain('"A"')
    expect(values).toContain('"C"')
  })

  it('strips trailing period from EVALUATE subject', () => {
    const cobol = `
      EVALUATE WS-FLAG.
        WHEN "Y"
          PERFORM DO-YES
      END-EVALUATE
    `
    const result = extractEvaluateDispatch(cobol)
    expect(result).toHaveLength(1)
    expect(result[0].evaluateSubject).toBe('WS-FLAG')
  })

  it('preserves case of quoted string literal in WHEN value', () => {
    const cobol = `
      EVALUATE WS-ACTION
        WHEN "create"
          PERFORM DO-CREATE
        WHEN "delete"
          PERFORM DO-DELETE
      END-EVALUATE
    `
    const result = extractEvaluateDispatch(cobol)
    expect(result).toHaveLength(1)
    const values = result[0].entries.map(e => e.whenValue)
    expect(values).toContain('"create"')
    expect(values).toContain('"delete"')
  })
})

describe('extractPerformGraph', () => {
  it('returns empty Map for empty chunks array', () => {
    const graph = extractPerformGraph([])
    expect(graph.size).toBe(0)
  })

  it('maps paragraph to directly PERFORMed paragraphs', () => {
    const chunks = [
      { chunk_name: 'MAIN-PARA', chunk_type: 'paragraph', cobol_text: 'MAIN-PARA.\n  PERFORM VALIDATE.\n  PERFORM PROCESS.' },
      { chunk_name: 'VALIDATE', chunk_type: 'paragraph', cobol_text: 'VALIDATE.\n  IF X > 0 MOVE 1 TO Y.' },
      { chunk_name: 'PROCESS', chunk_type: 'paragraph', cobol_text: 'PROCESS.\n  PERFORM SAVE-DATA.' },
    ]
    const graph = extractPerformGraph(chunks)
    expect(graph.get('MAIN-PARA')).toEqual(new Set(['VALIDATE', 'PROCESS']))
    expect(graph.get('VALIDATE')).toEqual(new Set())
    expect(graph.get('PROCESS')).toEqual(new Set(['SAVE-DATA']))
  })

  it('ignores PERFORM UNTIL / VARYING / TIMES keywords', () => {
    const chunks = [
      { chunk_name: 'LOOP-PARA', chunk_type: 'paragraph', cobol_text: 'LOOP-PARA.\n  PERFORM UNTIL WS-DONE = "Y"\n    MOVE 1 TO X\n  END-PERFORM.' },
    ]
    const graph = extractPerformGraph(chunks)
    expect(graph.get('LOOP-PARA').has('UNTIL')).toBe(false)
  })

  it('ignores data_summary chunks', () => {
    const chunks = [
      { chunk_name: 'WORKING-STORAGE', chunk_type: 'data_summary', cobol_text: '01 WS-PERFORM PIC X.' },
      { chunk_name: 'REAL-PARA', chunk_type: 'paragraph', cobol_text: 'REAL-PARA.\n  PERFORM OTHER-PARA.' },
    ]
    const graph = extractPerformGraph(chunks)
    expect(graph.has('WORKING-STORAGE')).toBe(false)
    expect(graph.has('REAL-PARA')).toBe(true)
  })

  it('normalises windowed chunk names by stripping [N] suffix', () => {
    const chunks = [
      { chunk_name: 'MAIN-PARA', chunk_type: 'paragraph', cobol_text: 'MAIN-PARA.\n  PERFORM LOOP-PARA.' },
      { chunk_name: 'LOOP-PARA [1]', chunk_type: 'paragraph', cobol_text: 'LOOP-PARA.\n  PERFORM INNER.' },
      { chunk_name: 'LOOP-PARA [2]', chunk_type: 'paragraph', cobol_text: '  CONTINUE.' },
      { chunk_name: 'INNER', chunk_type: 'paragraph', cobol_text: 'INNER.\n  MOVE 1 TO X.' },
    ]
    const graph = extractPerformGraph(chunks)
    expect(graph.has('LOOP-PARA')).toBe(true)
    expect(graph.has('LOOP-PARA [1]')).toBe(false)
    expect(graph.has('LOOP-PARA [2]')).toBe(false)
    // resolveTransitive from MAIN-PARA should reach LOOP-PARA and INNER
    const reached = resolveTransitive('MAIN-PARA', graph)
    expect(reached).toEqual(new Set(['MAIN-PARA', 'LOOP-PARA', 'INNER']))
  })
})

describe('resolveTransitive', () => {
  it('returns Set containing only start when start has no outgoing edges', () => {
    const graph = new Map([['LEAF', new Set()]])
    expect(resolveTransitive('LEAF', graph)).toEqual(new Set(['LEAF']))
  })

  it('resolves direct dependencies', () => {
    const graph = new Map([
      ['A', new Set(['B', 'C'])],
      ['B', new Set()],
      ['C', new Set()],
    ])
    expect(resolveTransitive('A', graph)).toEqual(new Set(['A', 'B', 'C']))
  })

  it('resolves transitive chain A→B→C→D', () => {
    const graph = new Map([
      ['A', new Set(['B'])],
      ['B', new Set(['C'])],
      ['C', new Set(['D'])],
      ['D', new Set()],
    ])
    expect(resolveTransitive('A', graph)).toEqual(new Set(['A', 'B', 'C', 'D']))
  })

  it('handles cycles without infinite loop', () => {
    const graph = new Map([
      ['A', new Set(['B'])],
      ['B', new Set(['A'])],
    ])
    expect(resolveTransitive('A', graph)).toEqual(new Set(['A', 'B']))
  })

  it('returns Set with only start when start not in graph', () => {
    const graph = new Map([['OTHER', new Set()]])
    expect(resolveTransitive('UNKNOWN', graph)).toEqual(new Set(['UNKNOWN']))
  })
})
