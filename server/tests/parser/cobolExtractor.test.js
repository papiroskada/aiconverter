import { describe, it, expect } from 'vitest'
import { extractCalls, extractExecSql, extractConstructs, extractTuxTables, extractErrorEntries, extractErrorSeqNos } from '../../src/parser/cobolExtractor.js'

describe('extractCalls', () => {
  it('returns empty array for no CALL statements', () => {
    expect(extractCalls('MOVE X TO Y.')).toEqual([])
  })

  it('extracts CALL with single quotes', () => {
    const cobol = "  CALL 'ARCUSACS' USING WS-AREA."
    const result = extractCalls(cobol)
    expect(result).toHaveLength(1)
    expect(result[0].program).toBe('ARCUSACS')
    expect(result[0].using).toBe('WS-AREA')
  })

  it('extracts CALL with double quotes', () => {
    const cobol = '  CALL "PROGRAM1".'
    const result = extractCalls(cobol)
    expect(result[0].program).toBe('PROGRAM1')
    expect(result[0].using).toBeNull()
  })

  it('deduplicates repeated CALLs to same program', () => {
    const cobol = "  CALL 'PROG' USING A.\n  CALL 'PROG' USING B."
    expect(extractCalls(cobol)).toHaveLength(1)
  })
})

describe('extractExecSql', () => {
  it('returns empty array when no EXEC SQL blocks', () => {
    expect(extractExecSql('MOVE X TO Y.')).toEqual([])
  })

  it('extracts SELECT operation and table', () => {
    const cobol = `
      EXEC SQL
        SELECT EUR-ENBL-FLG
        INTO :EUR-ENBL-FLG
        FROM EXREUR
        WHERE EUR-EXEC-LGN-ID = :EUR-EXEC-LGN-ID
      END-EXEC
    `
    const result = extractExecSql(cobol)
    expect(result).toHaveLength(1)
    expect(result[0].table).toBe('EXREUR')
    expect(result[0].operation).toBe('SELECT')
  })

  it('extracts INSERT operation', () => {
    const cobol = `
      EXEC SQL
        INSERT INTO EXRLOG (COL1) VALUES (:VAL1)
      END-EXEC
    `
    const result = extractExecSql(cobol)
    expect(result[0].operation).toBe('INSERT')
    expect(result[0].table).toBe('EXRLOG')
  })
})

describe('extractConstructs', () => {
  it('returns empty array for empty text', () => {
    expect(extractConstructs('')).toEqual([])
  })

  it('detects PERFORM and IF', () => {
    const result = extractConstructs('PERFORM SOMETHING.\nIF X > 0 MOVE Y TO Z.')
    expect(result).toContain('PERFORM')
    expect(result).toContain('IF')
  })
})

describe('extractTuxTables', () => {
  it('returns empty array when no TUX tables', () => {
    expect(extractTuxTables('PROCEDURE DIVISION.\n  MOVE 1 TO X.')).toEqual([])
  })

  it('extracts table with single operation (MOVE-FUNC strategy)', () => {
    const cobol = `
      10  EXREUR-TABNAM  PIC X(6)  VALUE "exreur".
      10  EXREUR-FUNC    PIC X(3)  VALUE "OPN".
      MOVE "RD"  TO EXREUR-FUNC.
    `
    const result = extractTuxTables(cobol)
    expect(result).toHaveLength(1)
    expect(result[0].table).toBe('exreur')
    expect(result[0].operation).toBe('READ')
  })

  it('merges multiple operations on same table', () => {
    const cobol = `
      10  EXTCNS-TABNAM  PIC X(6)  VALUE "extcns".
      10  EXTCNS-FUNC    PIC X(3)  VALUE "OPN".
      MOVE "RD"  TO EXTCNS-FUNC.
      MOVE "DEL" TO EXTCNS-FUNC.
    `
    const result = extractTuxTables(cobol)
    expect(result[0].operation).toBe('READ/DELETE')
  })

  it('maps CTN/NXT/FWD to READ', () => {
    const cobol = `
      10  EXRPDA-TABNAM  PIC X(6)  VALUE "exrpda".
      10  EXRPDA-FUNC    PIC X(3)  VALUE "OPN".
      MOVE "CTN" TO EXRPDA-FUNC.
      MOVE "NXT" TO EXRPDA-FUNC.
    `
    const result = extractTuxTables(cobol)
    expect(result[0].operation).toBe('READ')
  })

  it('handles multiple tables', () => {
    const cobol = `
      10  EXREUR-TABNAM  PIC X(6)  VALUE "exreur".
      10  EXREUR-FUNC    PIC X(3)  VALUE "OPN".
      10  EXRSEI-TABNAM  PIC X(6)  VALUE "exrsei".
      10  EXRSEI-FUNC    PIC X(3)  VALUE "OPN".
      MOVE "RD"  TO EXREUR-FUNC.
      MOVE "RD"  TO EXRSEI-FUNC.
      MOVE "INS" TO EXREUR-FUNC.
    `
    const result = extractTuxTables(cobol)
    expect(result).toHaveLength(2)
    const eur = result.find(t => t.table === 'exreur')
    expect(eur.operation).toBe('READ/INSERT')
  })

  it('includes empty keyFields array on every result entry', () => {
    const cobol = `
      10  EXREUR-TABNAM  PIC X(6)  VALUE "exreur".
      MOVE "RD"  TO EXREUR-FUNC.
    `
    const result = extractTuxTables(cobol)
    expect(result[0]).toHaveProperty('keyFields')
    expect(Array.isArray(result[0].keyFields)).toBe(true)
  })
})

describe('extractErrorEntries', () => {
  it('returns empty for no error entries', () => {
    expect(extractErrorEntries('MOVE X TO Y.')).toEqual([])
  })

  it('extracts seq number and data element', () => {
    const cobol = `
      MOVE 1500 TO WS-SEQ-NO.
      MOVE "EUR-EXEC-LGN-ID" TO WS-DATA-EL.
    `
    const result = extractErrorEntries(cobol)
    expect(result).toHaveLength(1)
    expect(result[0].seqNo).toBe(1500)
    expect(result[0].dataElement).toBe('EUR-EXEC-LGN-ID')
  })
})

describe('extractErrorSeqNos', () => {
  it('returns only seq numbers', () => {
    const cobol = `
      MOVE 1500 TO WS-SEQ-NO.
      MOVE 1600 TO WS-SEQ-NO.
    `
    expect(extractErrorSeqNos(cobol)).toEqual([1500, 1600])
  })
})
