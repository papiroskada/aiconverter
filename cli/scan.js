#!/usr/bin/env node
import { readdirSync, statSync, readFileSync } from 'fs'
import { join, extname, basename } from 'path'
import { parseArgs } from 'util'

const { values } = parseArgs({
  options: {
    dir:       { type: 'string' },
    name:      { type: 'string' },
    mode:      { type: 'string', default: 'sequential' },
    'api-url': { type: 'string', default: 'http://localhost:3001' },
  },
})

const dir    = values['dir']
const name   = values['name'] || basename(dir || '.')
const mode   = values['mode']
const apiUrl = values['api-url']

if (!dir) {
  console.error('Usage: node cli/scan.js --dir /path/to/cobol [--name "My App"] [--mode sequential|parallel]')
  process.exit(1)
}

function collectFiles(directory) {
  return readdirSync(directory)
    .filter(f => ['.cbl', '.cob'].includes(extname(f).toLowerCase()))
    .map(f => join(directory, f))
}

async function post(path, body) {
  const res = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status} ${await res.text()}`)
  return res.json()
}

async function uploadFile(filePath, applicationId) {
  const form = new FormData()
  const content = readFileSync(filePath)
  form.append('file', new Blob([content]), basename(filePath))
  form.append('application_id', applicationId)

  const res = await fetch(`${apiUrl}/api/programs/upload`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`Upload ${filePath} failed: ${res.status}`)
  return res.json()
}

async function pollUntilDone(applicationId) {
  const delay = ms => new Promise(r => setTimeout(r, ms))
  while (true) {
    const res = await fetch(`${apiUrl}/api/applications/${applicationId}`)
    const app = await res.json()
    console.clear()
    console.log(`Application: ${app.name}  [${app.status}]\n`)
    for (const p of app.programs) {
      const bar = p.status === 'analyzed' ? '████████████' : p.status === 'analyzing' ? '██░░░░░░░░░░' : '░░░░░░░░░░░░'
      console.log(`  ${p.name.padEnd(20)} ${bar}  ${p.status}`)
    }
    if (app.status === 'analyzed' || app.status === 'failed') break
    await delay(2000)
  }
}

async function main() {
  const files = collectFiles(dir)
  if (files.length === 0) {
    console.error(`No .cbl or .cob files found in ${dir}`)
    process.exit(1)
  }

  console.log(`Found ${files.length} files in ${dir}`)
  const { id: applicationId } = await post('/api/applications', { name })
  console.log(`Created application: ${name} (${applicationId})`)

  console.log('Uploading files...')
  for (const filePath of files) {
    process.stdout.write(`  ${basename(filePath)}... `)
    await uploadFile(filePath, applicationId)
    console.log('done')
  }

  console.log(`\nStarting ${mode} analysis...`)
  await post(`/api/applications/${applicationId}/analyze`, { mode })

  await pollUntilDone(applicationId)
  console.log('\nDone.')
}

main().catch(err => { console.error(err.message); process.exit(1) })
