import { useState, useEffect } from 'react'
import { patchFlags, patchEntryPoints } from '../../api/programs.js'

const sectionStyle = { marginBottom: 20 }
const labelStyle = { fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: 8 }
const cardStyle = { background: '#0f172a', borderRadius: 6, padding: '12px 14px', marginBottom: 8 }
const tagStyle = { display: 'inline-block', background: '#1e3a5f', color: '#93c5fd', borderRadius: 4, padding: '2px 7px', fontSize: 11 }
const subLabelStyle = { color: '#475569', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4, marginTop: 8 }
const FLAG_COLORS = { warning: '#f59e0b', deprecated: '#f87171' }
const FLAG_LABELS = { warning: '⚠ Warning', deprecated: '🗑 Deprecated' }

function opColor(op = '') {
  const hasRead  = /SELECT|READ|SGE|RDN/.test(op)
  const hasWrite = /INSERT|UPDATE|DELETE|UPD|DEL|INL|WRITE|WRT/.test(op)
  if (hasRead && hasWrite) return '#f59e0b'
  if (hasRead) return '#4ade80'
  return '#f87171'
}

function stepIcon(text = '') {
  if (/SELECT|INSERT|UPDATE|DELETE|READ|SGE|RDN|UPD|DEL|INL/i.test(text)) return { icon: '⬡', color: '#60a5fa' }
  if (/if not found|not found|returns? error|error \d{4}|return.*\d{4}/i.test(text)) return { icon: '⤷', color: '#f59e0b' }
  if (/validates?|checks?|ensures?|verifies?|is (not )?spaces?|is (not )?zero/i.test(text)) return { icon: '✓', color: '#4ade80' }
  return { icon: '·', color: '#475569' }
}

function enrichStepText(text, catalog) {
  if (!catalog?.size) return text
  const parts = text.split(/(\berror\s+\d+|\breturns?\s+\d{4}|\b\d{4}\b)/gi)
  return parts.map((part, i) => {
    const codeMatch = part.match(/\d{4,}/)
    if (codeMatch) {
      const entry = catalog.get(codeMatch[0])
      if (entry) {
        return (
          <span key={i} title={entry.businessMeaning ?? ''} style={{
            background: '#3b0f0f', color: '#f87171', borderRadius: 3,
            padding: '0 4px', fontFamily: 'monospace', fontSize: 11,
            cursor: 'help', borderBottom: '1px dashed #f87171',
          }}>
            {part}
          </span>
        )
      }
    }
    return part
  })
}

function NotFoundBadge({ nfa }) {
  if (!nfa || nfa === 'n/a') return null
  if (typeof nfa === 'string') {
    return <span style={{ color: '#f59e0b', marginLeft: 'auto', fontSize: 10 }}>→ {nfa}</span>
  }
  if (nfa.type === 'skip') return null
  if (nfa.type === 'error') {
    return <span style={{ color: '#f87171', marginLeft: 'auto', fontSize: 10 }}>→ error {nfa.code}</span>
  }
  if (nfa.type === 'defaults') {
    const fields = nfa.fields ? Object.entries(nfa.fields).map(([k, v]) => `${k}=${v}`).join(', ') : ''
    return (
      <span style={{ color: '#f59e0b', marginLeft: 'auto', fontSize: 10 }}>
        → defaults{fields ? ` (${fields})` : ''}{nfa.logError ? ' ⚡log' : ''}
      </span>
    )
  }
  if (nfa.type === 'continue') {
    return <span style={{ color: '#64748b', marginLeft: 'auto', fontSize: 10 }}>→ continue</span>
  }
  return null
}

function DbOpRow({ op }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '3px 0', fontSize: 11 }}>
      <span style={{ color: '#e2e8f0', fontFamily: 'monospace', minWidth: 90 }}>{op.table}</span>
      <span style={{ color: opColor(op.operation), fontFamily: 'monospace', minWidth: 65 }}>{op.operation}</span>
      {op.keyFields?.length > 0 && (
        <span style={{ color: '#60a5fa', fontFamily: 'monospace' }}>key: {op.keyFields.join(', ')}</span>
      )}
      <NotFoundBadge nfa={op.notFoundAction} />
    </div>
  )
}

const dropdownItemStyle = {
  display: 'block', width: '100%', background: 'none', border: 'none',
  color: '#e2e8f0', padding: '7px 12px', textAlign: 'left', cursor: 'pointer', fontSize: 12,
}

function FlagButton({ condition, currentFlag, programId, onFlagsChange }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  async function setFlag(flag) {
    setSaving(true)
    setOpen(false)
    try {
      const updated = await patchFlags(programId, condition, flag)
      onFlagsChange?.(updated)
    } catch (e) {
      console.error('Flag update failed', e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'relative', marginLeft: 'auto' }}>
      <button
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        disabled={saving}
        style={{
          background: currentFlag ? `${FLAG_COLORS[currentFlag]}22` : '#1e293b',
          border: `1px solid ${currentFlag ? FLAG_COLORS[currentFlag] : '#334155'}`,
          color: currentFlag ? FLAG_COLORS[currentFlag] : '#64748b',
          borderRadius: 4, padding: '2px 8px', fontSize: 11, cursor: 'pointer',
        }}
      >
        {saving ? '…' : currentFlag ? FLAG_LABELS[currentFlag] : '⚑ Flag'}
      </button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '110%', background: '#1e293b',
          border: '1px solid #334155', borderRadius: 6, zIndex: 20, minWidth: 130,
          boxShadow: '0 4px 12px #00000066',
        }}>
          <button onClick={() => setFlag('warning')} style={dropdownItemStyle}>⚠ Warning</button>
          <button onClick={() => setFlag('deprecated')} style={dropdownItemStyle}>🗑 Deprecated</button>
          {currentFlag && (
            <button onClick={() => setFlag(null)} style={{ ...dropdownItemStyle, color: '#64748b' }}>✕ Clear flag</button>
          )}
        </div>
      )}
    </div>
  )
}

export default function LogicTab({ analysis, programId, onFlagsChange }) {
  const entryPoints  = analysis?.entry_points  ?? []
  const errorCatalog = analysis?.error_catalog  ?? []
  const preDispatch  = analysis?.pre_dispatch   ?? []
  const flags        = analysis?.flags          ?? {}

  const [openEPs, setOpenEPs]   = useState(() => new Set(entryPoints.length === 1 ? [0] : []))
  const [localEPs, setLocalEPs] = useState(entryPoints)
  const [editing, setEditing]   = useState(null) // { epIndex, stepIndex }
  const [editText, setEditText] = useState('')
  const [saving, setSaving]     = useState(false)

  useEffect(() => { setLocalEPs(entryPoints) }, [analysis])

  const catalogMap = new Map((errorCatalog).map(e => [String(e.code), e]))

  function toggleEP(i) {
    setOpenEPs(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  function startEdit(epIndex, stepIndex, text) {
    setEditing({ epIndex, stepIndex })
    setEditText(text)
  }

  async function saveStep(epIndex, stepIndex) {
    const updated = localEPs.map((ep, i) =>
      i !== epIndex ? ep : { ...ep, steps: ep.steps.map((s, j) => j === stepIndex ? editText : s) }
    )
    setLocalEPs(updated)
    setEditing(null)
    setSaving(true)
    try {
      await patchEntryPoints(programId, updated)
    } catch (e) {
      console.error('Step save failed', e)
    } finally {
      setSaving(false)
    }
  }

  if (!preDispatch.length && !localEPs.length && !errorCatalog.length) {
    return <p style={{ color: '#64748b', margin: 0 }}>No business logic extracted yet.</p>
  }

  return (
    <div>
      {preDispatch.length > 0 && (
        <div style={sectionStyle}>
          <label style={labelStyle}>Pre-Dispatch (runs before every mode)</label>
          <div style={{ ...cardStyle, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {preDispatch.map((name, i) => (
              <span key={i} style={{ background: '#172554', color: '#93c5fd', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontFamily: 'monospace' }}>
                {name}
              </span>
            ))}
          </div>
        </div>
      )}

      {localEPs.length > 0 && (
        <div style={sectionStyle}>
          <label style={labelStyle}>
            Entry Points
            {saving && <span style={{ color: '#475569', fontWeight: 400, marginLeft: 8 }}>saving…</span>}
          </label>
          {localEPs.map((ep, i) => {
            const epFlag  = flags[ep.condition]
            const isOpen  = openEPs.has(i)
            const summary = [
              ep.steps?.length       ? `${ep.steps.length} steps`       : null,
              ep.dbOperations?.length ? `${ep.dbOperations.length} tables` : null,
              ep.errors?.length      ? `${ep.errors.length} errors`      : null,
            ].filter(Boolean).join(' · ')

            return (
              <div key={i} style={{ ...cardStyle, borderLeft: epFlag ? `3px solid ${FLAG_COLORS[epFlag]}` : '3px solid transparent' }}>

                {/* Header — завжди видимий */}
                <div
                  onClick={() => toggleEP(i)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: isOpen ? 8 : 0, cursor: 'pointer', userSelect: 'none' }}
                >
                  <span style={{ color: '#475569', fontSize: 10, flexShrink: 0 }}>{isOpen ? '▾' : '▸'}</span>
                  <div style={tagStyle}>{ep.condition}</div>
                  <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 13 }}>{ep.businessName}</div>
                  {!isOpen && summary && (
                    <span style={{ color: '#475569', fontSize: 11 }}>{summary}</span>
                  )}
                  <FlagButton condition={ep.condition} currentFlag={epFlag} programId={programId} onFlagsChange={onFlagsChange} />
                </div>

                {/* Body */}
                {isOpen && (
                  <>
                    {/* Параграфи-джерела */}
                    {ep.paragraphNames?.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
                        {ep.paragraphNames.map((name, k) => (
                          <span key={k} style={{
                            background: '#0f2744', color: '#475569', borderRadius: 3,
                            padding: '1px 6px', fontSize: 10, fontFamily: 'monospace',
                          }}>
                            {name}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Steps */}
                    {ep.steps?.length > 0 && (
                      <div style={{ marginBottom: 8 }}>
                        <div style={subLabelStyle}>Steps</div>
                        {ep.steps.map((s, j) => {
                          const isEditing = editing?.epIndex === i && editing?.stepIndex === j
                          const { icon, color } = stepIcon(s)
                          return (
                            <div key={j} style={{ display: 'flex', gap: 8, marginBottom: 4, alignItems: 'flex-start' }}>
                              <span style={{ color, fontSize: 11, flexShrink: 0, minWidth: 16, textAlign: 'center', paddingTop: 2 }}>{icon}</span>
                              {isEditing ? (
                                <div style={{ flex: 1 }}>
                                  <textarea
                                    autoFocus
                                    value={editText}
                                    onChange={e => setEditText(e.target.value)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveStep(i, j) }
                                      if (e.key === 'Escape') setEditing(null)
                                    }}
                                    style={{
                                      width: '100%', background: '#0a1628', color: '#e2e8f0',
                                      border: '1px solid #3b82f6', borderRadius: 4,
                                      padding: '4px 6px', fontSize: 12, resize: 'vertical',
                                      fontFamily: 'inherit', lineHeight: 1.5, boxSizing: 'border-box',
                                    }}
                                    rows={Math.max(2, Math.ceil(editText.length / 80))}
                                  />
                                  <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                                    <button
                                      onClick={() => saveStep(i, j)}
                                      style={{ background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 3, padding: '2px 10px', fontSize: 11, cursor: 'pointer' }}
                                    >
                                      Save
                                    </button>
                                    <button
                                      onClick={() => setEditing(null)}
                                      style={{ background: 'none', color: '#64748b', border: 'none', fontSize: 11, cursor: 'pointer' }}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <span
                                  style={{ color: '#cbd5e1', fontSize: 12, flex: 1, cursor: 'text', lineHeight: 1.5 }}
                                  onClick={() => startEdit(i, j, s)}
                                  title="Click to edit"
                                >
                                  {enrichStepText(s, catalogMap)}
                                </span>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {ep.dbOperations?.length > 0 && (
                      <div style={{ marginBottom: 8 }}>
                        <div style={subLabelStyle}>DB Operations</div>
                        <div style={{ background: '#0a1628', borderRadius: 4, padding: '6px 8px' }}>
                          {ep.dbOperations.map((op, j) => <DbOpRow key={j} op={op} />)}
                        </div>
                      </div>
                    )}

                    {ep.sideEffects?.length > 0 && (
                      <div style={{ marginBottom: 8 }}>
                        <div style={subLabelStyle}>Side Effects</div>
                        {ep.sideEffects.map((s, j) => (
                          <div key={j} style={{ color: '#fbbf24', fontSize: 11, marginBottom: 2 }}>⚡ {s}</div>
                        ))}
                      </div>
                    )}

                    {ep.returns && (
                      <div style={{ marginBottom: 8 }}>
                        <div style={subLabelStyle}>Returns</div>
                        <div style={{ color: '#4ade80', fontSize: 12 }}>✓ {ep.returns}</div>
                      </div>
                    )}

                    {ep.errors?.length > 0 && (
                      <div>
                        <div style={subLabelStyle}>Errors</div>
                        {ep.errors.map((e, j) => (
                          <div key={j} style={{ color: '#f87171', fontSize: 11, marginBottom: 2 }}>✗ {e}</div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}

      {errorCatalog.length > 0 && (
        <div style={sectionStyle}>
          <label style={labelStyle}>Error Catalog</label>
          {errorCatalog.map((e, i) => (
            <div key={i} style={cardStyle}>
              <div style={{ color: '#f87171', fontWeight: 600, fontSize: 12, marginBottom: 4 }}>{e.code}</div>
              <div style={{ color: '#cbd5e1', fontSize: 12, marginBottom: 4 }}>{e.businessMeaning}</div>
              {e.systemAction && <div style={{ color: '#94a3b8', fontSize: 11 }}>→ {e.systemAction}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
