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
    token:     { type: 'string' },
    email:     { type: 'string' },
    password:  { type: 'string' },
  },
})

const dir      = values['dir']
const name     = values['name'] || basename(dir || '.')
const mode     = values['mode']
const apiUrl   = values['api-url']
const cliToken = values['token']
const email    = values['email']
const password = values['password']

if (!dir) {
  console.error('Usage: node cli/scan.js --dir /path/to/cobol [--name "My App"] [--mode sequential|parallel] [--token <jwt> | --email <email> --password <password>]')
  process.exit(1)
}

if (!cliToken && !(email && password)) {
  console.error('Error: authentication required. Provide --token or --email + --password')
  process.exit(1)
}

function collectFiles(directory) {
  return readdirSync(directory)
    .filter(f => ['.cbl', '.cob'].includes(extname(f).toLowerCase()))
    .map(f => join(directory, f))
}

async function getToken() {
  if (cliToken) return cliToken
  const res = await fetch(`${apiUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) throw new Error(`Login failed: ${res.status} ${await res.text()}`)
  const { accessToken } = await res.json()
  return accessToken
}

async function post(path, body, token) {
  const res = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status} ${await res.text()}`)
  return res.json()
}

async function uploadFile(filePath, applicationId, token) {
  const form = new FormData()
  const content = readFileSync(filePath)
  form.append('file', new Blob([content]), basename(filePath))
  form.append('application_id', applicationId)

  const res = await fetch(`${apiUrl}/api/programs/upload`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: form,
  })
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

  const token = await getToken()

  console.log(`Found ${files.length} files in ${dir}`)
  const { id: applicationId } = await post('/api/applications', { name }, token)
  console.log(`Created application: ${name} (${applicationId})`)

  console.log('Uploading files...')
  for (const filePath of files) {
    process.stdout.write(`  ${basename(filePath)}... `)
    await uploadFile(filePath, applicationId, token)
    console.log('done')
  }

  console.log(`\nStarting ${mode} analysis...`)
  await post(`/api/applications/${applicationId}/analyze`, { mode }, token)

  await pollUntilDone(applicationId)
  console.log('\nDone.')
}

main().catch(err => { console.error(err.message); process.exit(1) })
