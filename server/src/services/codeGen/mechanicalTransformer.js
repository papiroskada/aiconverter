import { resolveTransitive } from '../../parser/cobolParser.js'
import { toPascal, getPatterns } from './utils.js'

function cobolToCamel(name) {
  if (!name) return 'unknown'
  // If already camelCase (no hyphens, contains uppercase), return as-is
  if (!name.includes('-') && /[A-Z]/.test(name)) return name
  return name.toLowerCase().replace(/[^a-z0-9]+(.)/g, (_, c) => c.toUpperCase())
}

function picToTs(pic, comp) {
  if (!pic) return 'unknown'
  if (comp === 'COMP-3') return 'string'  // Decimal as string (financial)
  if (comp === 'COMP-5' || comp === 'COMP') return 'number'
  if (/^X/i.test(pic)) return 'string'
  if (/^[S9]/i.test(pic)) return 'number'
  return 'string'
}

function defaultForType(tsType) {
  if (tsType === 'number') return '0'
  if (tsType === 'string') return "''"
  return 'undefined'
}

function buildInterfaces(programName, linkageVars, picTypes) {
  const inputName  = toPascal(programName) + 'Input'
  const outputName = toPascal(programName) + 'Output'
  const inputs  = linkageVars.filter(v => v.direction === 'in'  && v.pic)
  const outputs = linkageVars.filter(v => v.direction === 'out' && v.pic)

  const inputFields  = inputs.map(v => {
    const t = picTypes[v.name] ?? picToTs(v.pic, v.comp)
    return `  ${cobolToCamel(v.name)}: ${t}  // ${v.name}`
  })
  const outputFields = outputs.map(v => {
    const t = picTypes[v.name] ?? picToTs(v.pic, v.comp)
    return `  ${cobolToCamel(v.name)}?: ${t}  // ${v.name}`
  })

  const parts = []
  if (inputFields.length)  parts.push(`export interface ${inputName} {\n${inputFields.join('\n')}\n}`)
  if (outputFields.length) parts.push(`export interface ${outputName} {\n${outputFields.join('\n')}\n}`)
  return parts.join('\n\n')
}

function buildDefaultOutput(programName, linkageVars, picTypes) {
  const outputName = toPascal(programName) + 'Output'
  const outputs = linkageVars.filter(v => v.direction === 'out' && v.pic)
  const fields = outputs.map(v => {
    const t = picTypes[v.name] ?? picToTs(v.pic, v.comp)
    return `    ${cobolToCamel(v.name)}: ${defaultForType(t)},`
  })
  return `function createDefaultOutput(): ${outputName} {\n  return {\n${fields.join('\n')}\n  }\n}`
}

function resolveHoleNames(ep, performGraph, preDispatchNames) {
  const allNames = new Set([...preDispatchNames, ...(ep.paragraphNames ?? [])])
  for (const name of [...allNames]) {
    for (const dep of resolveTransitive(name, performGraph)) allNames.add(dep)
  }
  return allNames
}

function buildHoleId(ep) {
  const raw = ep.condition ?? ep.businessName ?? 'ep'
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function buildHoleBlock(ep, allNames, dataFlow) {
  const reads  = new Set()
  const writes = new Set()
  for (const n of allNames) {
    const flow = dataFlow[n]
    if (!flow) continue
    flow.reads.forEach(r => reads.add(r))
    flow.writes.forEach(w => writes.add(w))
  }

  const id        = buildHoleId(ep)
  const paraList  = [...allNames].join(', ')
  const readList  = [...reads].slice(0, 10).join(', ')  || 'none'
  const writeList = [...writes].slice(0, 10).join(', ') || 'none'
  const pattern   = [...allNames].some(n => n.endsWith('-LOOP')) ? 'cursor loop (SCCLOOP)' : 'sequential'

  return { id, paraList, readList, writeList, pattern }
}

// ─── Public API ────────────────────────────────────────────────────────────────

export function generateSkeleton(program, analysis, chunks, structuralCache, settings, wsConstants = []) {
  const cache  = structuralCache ?? {}
  const lv     = cache.linkageVars ?? []
  const pt     = cache.picTypes    ?? {}
  const disp   = cache.evaluateDispatch ?? []
  const df     = cache.dataFlow    ?? {}
  const pre    = cache.preDispatchNames ?? []
  const wsConstMap = new Map((wsConstants ?? []).map(c => [c.name.toUpperCase(), c.value]))
  const pg     = cache.performGraph
    ? new Map(Object.entries(cache.performGraph).map(([k, v]) => [k, new Set(v)]))
    : new Map()

  const name      = program.name
  const pascal    = toPascal(name)
  const inputType = pascal + 'Input'
  const outputType = pascal + 'Output'
  const eps        = analysis.entry_points ?? []

  const interfaces    = buildInterfaces(name, lv, pt)
  const defaultOutput = buildDefaultOutput(name, lv, pt)

  // Entry point functions — each body is one AI hole
  const functions = eps.map(ep => {
    const funcName = cobolToCamel(ep.businessName ?? ep.condition)
    const allNames = resolveHoleNames(ep, pg, pre)
    const { id, paraList, readList, writeList, pattern } = buildHoleBlock(ep, allNames, df)

    return [
      `// [MECHANICAL] entry point: ${ep.condition}`,
      `async function ${funcName}(input: ${inputType}): Promise<${outputType}> {`,
      `  const output = createDefaultOutput()`,
      ``,
      `  // [AI_HOLE id="${id}"]`,
      `  // paragraphs: ${paraList}`,
      `  // reads: ${readList}`,
      `  // writes: ${writeList}`,
      `  // pattern: ${pattern}`,
      `  throw new Error('not implemented')`,
      `  // [/AI_HOLE]`,
      ``,
      `  return output`,
      `}`,
    ].join('\n')
  })

  // Dispatcher
  const dispatchField = disp.length > 0 ? cobolToCamel(disp[0].evaluateSubject) : null
  let dispatcherBody
  if (dispatchField && disp[0].entries?.length) {
    const cases = disp[0].entries.map((e, i) => {
      const ep = eps[i] ?? eps[eps.length - 1]
      const fn = cobolToCamel(ep?.businessName ?? ep?.condition ?? `ep${i}`)
      // Resolve WS constant references (WHEN WS-PRS-MD-SMRY → 'S')
      const raw = wsConstMap.get(e.whenValue.toUpperCase()) ?? e.whenValue
      const caseVal = raw.startsWith('"') ? raw.slice(1, -1) : raw
      return `    case '${caseVal}': return ${fn}(input)`
    })
    dispatcherBody = [
      `  switch (input.${dispatchField}) {`,
      ...cases,
      `    default: return createDefaultOutput()  // unhandled mode`,
      `  }`,
    ].join('\n')
  } else if (eps.length === 1) {
    const fn = cobolToCamel(eps[0].businessName ?? eps[0].condition)
    dispatcherBody = `  return ${fn}(input)`
  } else {
    dispatcherBody = `  throw new Error('no dispatch rule configured')`
  }

  const dispatcher = [
    `// [MECHANICAL] dispatcher`,
    `export async function ${cobolToCamel(name)}Dispatcher(input: ${inputType}): Promise<${outputType}> {`,
    dispatcherBody,
    `}`,
  ].join('\n')

  return [
    `// [MECHANICAL] skeleton — ${name}`,
    `// Generated ${new Date().toISOString().slice(0, 10)} — fill the [AI_HOLE] sections`,
    ``,
    interfaces || `// No typed linkage interface found for ${name}`,
    ``,
    defaultOutput,
    ``,
    ...functions,
    ``,
    dispatcher,
  ].join('\n')
}

// Parse [AI_HOLE] markers from a skeleton string
export function extractHoles(skeleton) {
  const holes = []
  const re = /\/\/ \[AI_HOLE id="([^"]+)"\]\n([\s\S]*?)\/\/ \[\/AI_HOLE\]/g
  let m
  while ((m = re.exec(skeleton)) !== null) {
    const id   = m[1]
    const body = m[2]
    const paragraphs = (body.match(/\/\/ paragraphs: (.+)/) ?? [])[1]?.split(', ').map(s => s.trim()).filter(Boolean) ?? []
    const reads      = (body.match(/\/\/ reads: (.+)/)      ?? [])[1]?.split(', ').map(s => s.trim()).filter(s => s !== 'none') ?? []
    const writes     = (body.match(/\/\/ writes: (.+)/)     ?? [])[1]?.split(', ').map(s => s.trim()).filter(s => s !== 'none') ?? []
    const pattern    = (body.match(/\/\/ pattern: (.+)/)    ?? [])[1]?.trim() ?? ''
    holes.push({ id, paragraphs, reads, writes, pattern, startIndex: m.index, endIndex: m.index + m[0].length, fullMatch: m[0] })
  }
  return holes
}

// Build focused context object for AI to fill one hole
export function holeToContext(hole, chunks, skeleton, settings, tableSchemas = {}) {
  const relevantChunks = chunks.filter(c => hole.paragraphs.includes(c.chunk_name))

  // Grab ~20 lines before and 10 lines after the hole marker for surrounding code
  const markerIdx = skeleton.indexOf(`// [AI_HOLE id="${hole.id}"]`)
  const before = skeleton.slice(0, markerIdx).split('\n').slice(-20).join('\n')
  const endMarker = `// [/AI_HOLE]`
  const afterIdx = skeleton.indexOf(endMarker, markerIdx) + endMarker.length
  const after = skeleton.slice(afterIdx).split('\n').slice(0, 10).join('\n')
  const surroundingCode = before + '\n  // ← fill this section\n' + after

  const cobolText = relevantChunks.length
    ? relevantChunks.map(c => `[${c.chunk_name}]\n${c.cobol_text}`).join('\n\n')
    : '// (no COBOL source chunks found for these paragraphs)'

  // Include field schemas only for tables referenced in this hole
  const relevantTables = [...new Set([...hole.reads, ...hole.writes])]
    .filter(t => tableSchemas[t])
    .map(t => {
      const fields = tableSchemas[t].map(f => `  ${f.camelName}: ${f.type}`).join('\n')
      return `${t}:\n${fields}`
    })
    .join('\n\n')

  const patterns = getPatterns(settings ?? {})

  return { id: hole.id, surroundingCode, cobolText, reads: hole.reads, writes: hole.writes, pattern: hole.pattern, tableSchemas: relevantTables, patterns }
}

// Replace [AI_HOLE] blocks in skeleton with filled code (reverse order to preserve indices)
export function assembleSkeleton(skeleton, filledHoles) {
  const filledMap = new Map(filledHoles.map(f => [f.id, f.code]))
  const holes = extractHoles(skeleton).reverse()
  let result = skeleton
  for (const hole of holes) {
    const code = filledMap.get(hole.id)
    if (!code) continue
    result = result.slice(0, hole.startIndex) + code + result.slice(hole.endIndex)
  }
  return result
}
