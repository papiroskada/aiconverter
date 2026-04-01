import { parseCobol, extractLinkage, extractCalls, extractExecSql, extractConstructs, extractWorkingStorage } from '../../src/parser/cobolParser.js'

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

describe('extractCalls', () => {
  it('returns empty array when no CALL statements', () => {
    expect(extractCalls('PROCEDURE DIVISION.\n PARA.\n   MOVE A TO B.')).toEqual([])
  })

  it('extracts CALL with USING', () => {
    const src = `PROCEDURE DIVISION.\n PARA.\n   CALL 'C_BEGCOM' USING WBCR-VARS.`
    const result = extractCalls(src)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ program: 'C_BEGCOM', using: 'WBCR-VARS' })
  })

  it('extracts CALL without USING', () => {
    const src = `PROCEDURE DIVISION.\n PARA.\n   CALL 'SYS-UTIL'.`
    const result = extractCalls(src)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ program: 'SYS-UTIL', using: null })
  })

  it('normalises program name to uppercase', () => {
    const src = `CALL 'getuser' USING WGET-USR-INFO.`
    expect(extractCalls(src)[0].program).toBe('GETUSER')
  })

  it('deduplicates calls to the same program', () => {
    const src = `CALL 'PROG-A' USING P1.\nCALL 'PROG-A' USING P2.\nCALL 'PROG-B' USING P3.`
    const result = extractCalls(src)
    expect(result.filter(c => c.program === 'PROG-A')).toHaveLength(1)
    expect(result.filter(c => c.program === 'PROG-B')).toHaveLength(1)
  })

  it('strips trailing punctuation from using value', () => {
    const src = `CALL 'PROG' USING PARAM-A,`
    const result = extractCalls(src)
    expect(result[0].using).toBe('PARAM-A')
  })
})

describe('extractExecSql', () => {
  it('returns empty array when no EXEC SQL', () => {
    expect(extractExecSql('PROCEDURE DIVISION.\n PARA.\n   MOVE A TO B.')).toEqual([])
  })

  it('extracts SELECT table', () => {
    const src = `EXEC SQL\n  SELECT USR_ID FROM USER_TABLE\nEND-EXEC.`
    const result = extractExecSql(src)
    expect(result).toHaveLength(1)
    expect(result[0].table).toBe('USER_TABLE')
    expect(result[0].operation).toBe('SELECT')
  })

  it('extracts INSERT INTO table', () => {
    const src = `EXEC SQL INSERT INTO LOG_TABLE (COL1) VALUES (:V1) END-EXEC.`
    const result = extractExecSql(src)
    expect(result[0].table).toBe('LOG_TABLE')
    expect(result[0].operation).toBe('INSERT')
  })

  it('merges operations for the same table', () => {
    const src = `EXEC SQL SELECT A FROM ORDERS END-EXEC.\nEXEC SQL UPDATE ORDERS SET A=1 END-EXEC.`
    const result = extractExecSql(src)
    expect(result).toHaveLength(1)
    expect(result[0].operation).toContain('SELECT')
    expect(result[0].operation).toContain('UPDATE')
  })
})

describe('extractConstructs', () => {
  it('returns empty array for empty source', () => {
    expect(extractConstructs('')).toEqual([])
  })

  it('detects PERFORM and IF', () => {
    const src = `PARA.\n  PERFORM OTHER-PARA.\n  IF X > 0 MOVE 1 TO Y.`
    const result = extractConstructs(src)
    expect(result).toContain('PERFORM')
    expect(result).toContain('IF')
  })

  it('does not false-positive on partial word match', () => {
    const src = `01 SUPERFORM PIC X.`
    expect(extractConstructs(src)).not.toContain('PERFORM')
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
