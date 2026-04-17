// Estimate tokens: ~1 token per 4 chars
function tokenEstimate(text) {
  return Math.ceil(text.length / 4)
}

// Returns true if the line looks like a function DEFINITION (has opening brace
// on same line or next non-empty line), not a prototype (ends with ;).
function isFunctionDef(lines, sigIdx) {
  for (let i = sigIdx; i < Math.min(sigIdx + 4, lines.length); i++) {
    const t = lines[i].trim()
    if (t.endsWith(';')) return false   // prototype
    if (t.includes('{')) return true
  }
  return false
}

export function parseCProgram(cText) {
  if (!cText.trim()) return []

  const lines = cText.split('\n')
  // Regex: optional static, return type (void/int/char*/bool), function name, open paren
  const sigRe = /^(?:static\s+)?(?:void|int|char\s*\*|bool)\s+([a-zA-Z_]\w*)\s*\(/

  const chunks = []
  let i = 0

  while (i < lines.length) {
    const m = lines[i].match(sigRe)
    if (m && isFunctionDef(lines, i)) {
      const funcName = m[1]
      const isStatic = lines[i].trimStart().startsWith('static')
      const chunkType = !isStatic ? 'entry_point' : 'function'
      const startLine = i + 1  // 1-indexed

      // Find opening brace
      let braceStart = i
      while (braceStart < lines.length && !lines[braceStart].includes('{')) braceStart++

      // Count braces to find closing brace
      let depth = 0
      let endLine = braceStart
      for (let j = braceStart; j < lines.length; j++) {
        for (const ch of lines[j]) {
          if (ch === '{') depth++
          else if (ch === '}') { depth--; if (depth === 0) { endLine = j; break } }
        }
        if (depth === 0) break
      }

      const bodyLines = lines.slice(i, endLine + 1)
      chunks.push({
        chunk_type: chunkType,
        chunk_name: funcName,
        start_line: startLine,
        end_line: endLine + 1,   // 1-indexed
        cobol_text: bodyLines.join('\n'),
        token_estimate: tokenEstimate(bodyLines.join('\n')),
        order_index: 0,  // set below
      })
      i = endLine + 1
    } else {
      i++
    }
  }

  return chunks.map((c, idx) => ({ ...c, order_index: idx }))
}

export function extractCConstants(cText) {
  // Match: #define NAME 'x'  OR  #define NAME "str"  OR  #define NAME 123
  const re = /^#define\s+([A-Z_][A-Z0-9_]*)\s+('.'|"[^"]*"|\d+)/gm
  const result = []
  let m
  while ((m = re.exec(cText)) !== null) {
    result.push({ name: m[1], value: m[2] })
  }
  return result
}

export function extractCIncludes(cText) {
  const re = /^#include\s+"([^"]+)"/gm
  const result = []
  let m
  while ((m = re.exec(cText)) !== null) result.push(m[1])
  return result
}

export function extractCGlobalVars(cText) {
  // Match static variable declarations (not function prototypes)
  // static <type> <name>[, static <type> <name>;, static <type> <name> = ...
  // NOT static <type> <name>(
  const re = /^static\s+(char|int|double|float|long|bool)\s+(\w+)\s*[\[;=]/gm
  const result = []
  let m
  while ((m = re.exec(cText)) !== null) {
    result.push({ type: m[1], name: m[2] })
  }
  return result
}

export function extractCModes(cText) {
  const result = []
  // Find switch on something.prs_md[0]
  const switchRe = /switch\s*\(\s*\w+\.prs_md\s*(?:\[\s*0\s*\])?\s*\)/gi
  let m

  while ((m = switchRe.exec(cText)) !== null) {
    const switchVar = 'prs_md'
    // Extract the switch body (brace-counted)
    let depth = 0
    let bodyStart = m.index + m[0].length
    while (bodyStart < cText.length && cText[bodyStart] !== '{') bodyStart++
    let bodyEnd = bodyStart
    for (let i = bodyStart; i < cText.length; i++) {
      if (cText[i] === '{') depth++
      else if (cText[i] === '}') { depth--; if (depth === 0) { bodyEnd = i; break } }
    }
    const body = cText.slice(bodyStart, bodyEnd + 1)

    // Parse cases inside body
    const cases = []
    const lines = body.split('\n')
    let pendingCases = []
    let callTarget = null

    for (const line of lines) {
      const caseM = line.match(/^\s*case\s+([A-Z_][A-Z0-9_]*)/)
      if (caseM) {
        pendingCases.push(caseM[1])
        callTarget = null
        continue
      }
      if (/^\s*default\b/.test(line)) { pendingCases = []; continue }

      if (pendingCases.length > 0 && !callTarget) {
        const callM = line.match(/\b(pvt[A-Z]\w+)\s*\(/)
        if (callM) {
          callTarget = callM[1]
          for (const c of pendingCases) cases.push({ constant: c, callTarget })
          pendingCases = []
        }
      }

      if (/^\s*break\b/.test(line)) { pendingCases = []; callTarget = null }
    }

    if (cases.length > 0) result.push({ switchVar, cases })
  }

  return result
}

export function extractCServiceCalls(cText) {
  const re = /svcCallSvc\s*\(\s*"([^"]+)"/g
  const seen = new Set()
  const result = []
  let m
  while ((m = re.exec(cText)) !== null) {
    if (!seen.has(m[1])) { seen.add(m[1]); result.push(m[1]) }
  }
  return result
}

export function extractCDbCalls(cText) {
  // svcCallPlnsqlio(TRACE_INFO, "tablename", "1", "2", OPERATION, ...)
  const re = /svcCallPlnsqlio\s*\([^,]+,\s*"([^"]+)"[^,]*,[^,]*,[^,]*,\s*([A-Z]+)/g
  const seen = new Set()
  const result = []
  let m
  while ((m = re.exec(cText)) !== null) {
    const key = `${m[1]}:${m[2]}`
    if (!seen.has(key)) {
      seen.add(key)
      result.push({ table: m[1], operation: m[2] })
    }
  }
  return result
}

export function extractCErrors(cText) {
  // svcLogErrMsg(severity, type, "0000001500", "FIELD-NAME")
  const re = /svcLogErrMsg\s*\([^,]+,[^,]+,\s*"0*(\d{4,5})"[^,]*,\s*"([^"]+)"/g
  const seen = new Set()
  const result = []
  let m
  while ((m = re.exec(cText)) !== null) {
    const code = parseInt(m[1], 10)
    if (!seen.has(code)) {
      seen.add(code)
      result.push({ code, field: m[2] })
    }
  }
  return result.sort((a, b) => a.code - b.code)
}

export function extractCCallGraph(chunks) {
  const graph = new Map()
  const pvtCallRe = /\b(pvt[A-Z]\w+)\s*\(/g

  for (const chunk of chunks) {
    const called = new Set()
    const re = new RegExp(pvtCallRe.source, pvtCallRe.flags)
    // Skip the function's own name in its signature line
    const bodyLines = chunk.cobol_text.split('\n').slice(1)
    const body = bodyLines.join('\n')
    let m
    while ((m = re.exec(body)) !== null) {
      if (m[1] !== chunk.chunk_name) called.add(m[1])
    }
    graph.set(chunk.chunk_name, called)
  }

  return graph
}

export function findCPreDispatch(chunks) {
  // Find the function that contains the switch on prs_md
  const dispatchChunk = chunks.find(c => /switch\s*\(\s*\w+\.prs_md/i.test(c.cobol_text))
  if (!dispatchChunk) return []

  // Find the function that calls the dispatch function
  const callerChunk = chunks.find(c =>
    c.chunk_name !== dispatchChunk.chunk_name &&
    new RegExp(`\\b${dispatchChunk.chunk_name}\\s*\\(`).test(c.cobol_text)
  )
  if (!callerChunk) return []

  // Collect pvtXxx calls in caller BEFORE the dispatch function call
  const preDispatch = []
  const lines = callerChunk.cobol_text.split('\n')

  for (const line of lines) {
    if (new RegExp(`\\b${dispatchChunk.chunk_name}\\s*\\(`).test(line)) break
    const m = line.match(/\b(pvt[A-Z]\w+)\s*\(/)
    if (m && m[1] !== callerChunk.chunk_name && !preDispatch.includes(m[1])) {
      preDispatch.push(m[1])
    }
  }

  return preDispatch
}

export function extractUDeps(uText) {
  if (!uText.trim()) return []
  // Lines like: exbdli.o: ${ICM_SOURCE}/include/exydli.h
  const re = /\/include\/([^/\s]+\.h)/g
  const seen = new Set()
  let m
  while ((m = re.exec(uText)) !== null) {
    seen.add(m[1])
  }
  return [...seen]
}
