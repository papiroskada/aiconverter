import { useState } from 'react'
import { patchFlags } from '../../api/programs.js'

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

function DbOpRow({ op }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '3px 0', fontSize: 11 }}>
      <span style={{ color: '#e2e8f0', fontFamily: 'monospace', minWidth: 90 }}>{op.table}</span>
      <span style={{ color: opColor(op.operation), fontFamily: 'monospace', minWidth: 65 }}>{op.operation}</span>
      {op.keyFields?.length > 0 && (
        <span style={{ color: '#60a5fa', fontFamily: 'monospace' }}>key: {op.keyFields.join(', ')}</span>
      )}
      {op.notFoundAction && op.notFoundAction !== 'n/a' && (
        <span style={{ color: '#f59e0b', marginLeft: 'auto', fontSize: 10 }}>→ {op.notFoundAction}</span>
      )}
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
        onClick={() => setOpen(o => !o)}
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

  if (!preDispatch.length && !entryPoints.length && !errorCatalog.length) {
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

      {entryPoints.length > 0 && (
        <div style={sectionStyle}>
          <label style={labelStyle}>Entry Points</label>
          {entryPoints.map((ep, i) => {
            const epFlag = flags[ep.condition]
            return (
              <div key={i} style={{ ...cardStyle, borderLeft: epFlag ? `3px solid ${FLAG_COLORS[epFlag]}` : '3px solid transparent' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div style={tagStyle}>{ep.condition}</div>
                  <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 13 }}>{ep.businessName}</div>
                  <FlagButton condition={ep.condition} currentFlag={epFlag} programId={programId} onFlagsChange={onFlagsChange} />
                </div>

                {ep.steps?.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={subLabelStyle}>Steps</div>
                    {ep.steps.map((s, j) => (
                      <div key={j} style={{ display: 'flex', gap: 8, marginBottom: 3 }}>
                        <span style={{ color: '#475569', fontSize: 11, flexShrink: 0 }}>{j + 1}.</span>
                        <span style={{ color: '#cbd5e1', fontSize: 12 }}>{s}</span>
                      </div>
                    ))}
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
