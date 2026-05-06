# Business Logic UX Improvements

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Зробити intermediate layer (бізнес-логіку) більш зручним для перегляду та верифікації людиною.

**Контекст:** Проєкт генерує бізнес-логіку як intermediate layer між старим COBOL/C кодом та новим TypeScript. Ключовий сценарій: людина читає бізнес-логіку, виправляє помилки AI, підтверджує — і тільки після цього запускає генерацію коду.

**Зміни:**
1. Entry points — колапс за замовчуванням
2. Іконки типів кроків
3. Параграфи-джерела під заголовком entry point
4. Коди помилок в steps — inline badges з підказками
5. Редагування кроків inline (frontend + backend)

---

## File Map

| Файл | Зміна |
|------|-------|
| `client/src/components/Panel/LogicTab.jsx` | Tasks 1–5 (UI) |
| `server/src/routes/programs.js` | Task 5 — новий PATCH endpoint |
| `server/src/models/programAnalysis.js` | Task 5 — нова функція `patchEntryPoints` |
| `client/src/api/programs.js` | Task 5 — новий API метод `patchEntryPoints` |

---

## Task 1: Entry points — колапс за замовчуванням

**Файл:** `client/src/components/Panel/LogicTab.jsx`

Програми з 5+ режимами зараз показують стіну розгорнутого тексту. Потрібно показувати тільки `condition + businessName + summary` і розкривати по кліку.

- [ ] **Крок 1:** додати `useState` для трекінгу відкритих entry points

На початку компонента `LogicTab` додати:
```js
const [openEPs, setOpenEPs] = useState(() => new Set(entryPoints.length === 1 ? [0] : []))

function toggleEP(i) {
  setOpenEPs(prev => {
    const next = new Set(prev)
    next.has(i) ? next.delete(i) : next.add(i)
    return next
  })
}
```

- [ ] **Крок 2:** замінити рендеринг entry point картки

Знайти `{entryPoints.map((ep, i) => {` і замінити вміст картки:

```jsx
const isOpen = openEPs.has(i)
const summary = [
  ep.steps?.length ? `${ep.steps.length} steps` : null,
  ep.dbOperations?.length ? `${ep.dbOperations.length} tables` : null,
  ep.errors?.length ? `${ep.errors.length} errors` : null,
].filter(Boolean).join(' · ')

return (
  <div key={i} style={{ ...cardStyle, borderLeft: epFlag ? `3px solid ${FLAG_COLORS[epFlag]}` : '3px solid transparent' }}>
    {/* Header — завжди видимий, клік розкриває */}
    <div
      onClick={() => toggleEP(i)}
      style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: isOpen ? 8 : 0, cursor: 'pointer' }}
    >
      <span style={{ color: '#475569', fontSize: 10, userSelect: 'none' }}>{isOpen ? '▾' : '▸'}</span>
      <div style={tagStyle}>{ep.condition}</div>
      <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 13 }}>{ep.businessName}</div>
      {!isOpen && summary && (
        <span style={{ color: '#475569', fontSize: 11, marginLeft: 4 }}>{summary}</span>
      )}
      <FlagButton condition={ep.condition} currentFlag={epFlag} programId={programId} onFlagsChange={onFlagsChange} />
    </div>

    {/* Body — показується тільки якщо open */}
    {isOpen && (
      <>
        {/* ... весь існуючий вміст (steps, dbOperations, sideEffects, returns, errors) ... */}
      </>
    )}
  </div>
)
```

- [ ] **Крок 3:** якщо тільки один entry point — відкритий за замовчуванням (вже враховано в `useState` ініціалізації вище)

---

## Task 2: Іконки типів кроків

**Файл:** `client/src/components/Panel/LogicTab.jsx`

Візуальне розрізнення типів кроків дозволяє за секунду зрозуміти структуру логіки не читаючи текст.

- [ ] **Крок 1:** додати функцію визначення типу кроку

```js
function stepIcon(text = '') {
  if (/SELECT|INSERT|UPDATE|DELETE|READ|SGE|RDN|UPD|DEL|INL/i.test(text)) return { icon: '⬡', color: '#60a5fa' }
  if (/if not found|not found|returns? error|error \d{4}|return.*\d{4}/i.test(text)) return { icon: '⤷', color: '#f59e0b' }
  if (/validates?|checks?|ensures?|verifies?|is (not )?spaces?|is (not )?zero/i.test(text)) return { icon: '✓', color: '#4ade80' }
  return { icon: '·', color: '#475569' }
}
```

- [ ] **Крок 2:** оновити рендеринг steps

Замінити існуючий рендеринг кроку:
```jsx
// БУЛО:
<span style={{ color: '#475569', fontSize: 11, flexShrink: 0 }}>{j + 1}.</span>
<span style={{ color: '#cbd5e1', fontSize: 12 }}>{s}</span>

// СТАЛО:
const { icon, color } = stepIcon(s)
<span style={{ color, fontSize: 11, flexShrink: 0, minWidth: 16, textAlign: 'center' }}>{icon}</span>
<span style={{ color: '#cbd5e1', fontSize: 12 }}>{s}</span>
```

---

## Task 3: Параграфи-джерела під заголовком entry point

**Файл:** `client/src/components/Panel/LogicTab.jsx`

`paragraphNames` вже є в даних але ніде не рендериться. Показати їх як маленькі monospace чіпи — дає трейсабіліті: видно звідки AI взяв цю логіку.

- [ ] **Крок 1:** додати рендеринг під заголовком entry point (всередині `isOpen` блоку, перед steps):

```jsx
{ep.paragraphNames?.length > 0 && (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
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
```

---

## Task 4: Коди помилок в steps — inline enrichment

**Файл:** `client/src/components/Panel/LogicTab.jsx`

Якщо step містить "error 1500" — показати це як кольоровий badge. При наведенні (або одразу під текстом) показати `businessMeaning` з `errorCatalog`. Нікуди не скролити.

- [ ] **Крок 1:** додати функцію `enrichStepText` яка знаходить коди помилок і повертає React елементи

```jsx
function enrichStepText(text, errorCatalog) {
  const catalog = new Map((errorCatalog ?? []).map(e => [String(e.code), e]))
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
```

- [ ] **Крок 2:** використати в рендерингу steps

```jsx
// Передати errorCatalog в рендеринг steps — він вже доступний в LogicTab scope
<span style={{ color: '#cbd5e1', fontSize: 12 }}>
  {enrichStepText(s, errorCatalog)}
</span>
```

---

## Task 5: Редагування кроків inline

**Файл:** `client/src/components/Panel/LogicTab.jsx`, `server/src/routes/programs.js`, `server/src/models/programAnalysis.js`, `client/src/api/programs.js`

Це найважливіша зміна. Без можливості виправити step — review пасивний. Кожен step повинен бути клікабельним і редагованим.

### 5a. Backend — модель

- [ ] **Крок 1:** додати `patchEntryPoints` в `server/src/models/programAnalysis.js`

```js
export async function patchEntryPoints(program_id, entry_points) {
  const { rows } = await pool.query(
    `UPDATE program_analysis
     SET entry_points = $2, updated_at = NOW()
     WHERE program_id = $1
     RETURNING entry_points`,
    [program_id, JSON.stringify(entry_points)]
  )
  return rows[0]?.entry_points
}
```

### 5b. Backend — route

- [ ] **Крок 2:** додати endpoint в `server/src/routes/programs.js`

Після існуючого `router.patch('/:id/flags', ...)` додати:

```js
router.patch('/:id/entry-points', async (req, res) => {
  const { entry_points } = req.body
  if (!Array.isArray(entry_points)) return res.status(400).json({ error: 'entry_points must be array' })
  try {
    const updated = await patchEntryPoints(req.params.id, entry_points)
    res.json({ entry_points: updated })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})
```

- [ ] **Крок 3:** додати імпорт в routes/programs.js

```js
import { getAnalysisByProgramId, updateFlag, patchEntryPoints } from '../models/programAnalysis.js'
```

### 5c. Frontend — API

- [ ] **Крок 4:** додати в `client/src/api/programs.js`

```js
export async function patchEntryPoints(programId, entryPoints) {
  const res = await fetch(`/api/programs/${programId}/entry-points`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entry_points: entryPoints }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}
```

### 5d. Frontend — UI

- [ ] **Крок 5:** додати `useState` для стану редагування в `LogicTab`

```js
// editing: { epIndex, stepIndex } | null
const [editing, setEditing] = useState(null)
const [editText, setEditText] = useState('')
const [localEPs, setLocalEPs] = useState(entryPoints)

// синхронізувати якщо analysis оновився
useEffect(() => { setLocalEPs(entryPoints) }, [analysis])
```

- [ ] **Крок 6:** додати функцію збереження

```js
async function saveStep(epIndex, stepIndex) {
  const updated = localEPs.map((ep, i) =>
    i !== epIndex ? ep : {
      ...ep,
      steps: ep.steps.map((s, j) => j === stepIndex ? editText : s)
    }
  )
  setLocalEPs(updated)
  setEditing(null)
  try {
    await patchEntryPoints(programId, updated)
    onFlagsChange?.() // тригерить refetch аналізу в батьківському компоненті
  } catch (e) {
    console.error('Step save failed', e)
  }
}
```

- [ ] **Крок 7:** замінити рендеринг step на клікабельний/редагований

```jsx
{localEPs[i].steps?.map((s, j) => {
  const isEditing = editing?.epIndex === i && editing?.stepIndex === j
  const { icon, color } = stepIcon(s)
  return (
    <div key={j} style={{ display: 'flex', gap: 8, marginBottom: 3, alignItems: 'flex-start' }}>
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
              fontFamily: 'inherit', lineHeight: 1.5,
            }}
            rows={Math.max(2, Math.ceil(editText.length / 80))}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button onClick={() => saveStep(i, j)} style={{ background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 3, padding: '2px 10px', fontSize: 11, cursor: 'pointer' }}>Save</button>
            <button onClick={() => setEditing(null)} style={{ background: 'none', color: '#64748b', border: 'none', fontSize: 11, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      ) : (
        <span
          style={{ color: '#cbd5e1', fontSize: 12, flex: 1, cursor: 'text' }}
          onClick={() => { setEditing({ epIndex: i, stepIndex: j }); setEditText(s) }}
          title="Click to edit"
        >
          {enrichStepText(s, errorCatalog)}
        </span>
      )}
    </div>
  )
})}
```

- [ ] **Крок 8:** переконатись що `onFlagsChange` (або окремий callback) тригерить рефреш analysis в батьківському компоненті. Перевірити що після save — оновлені steps відображаються без повного ре-аналізу.

---

## Порядок виконання

Tasks 1–4 незалежні, можна в будь-якому порядку. Task 5 залежить від Tasks 2 і 4 (використовує `stepIcon` і `enrichStepText`), тому виконувати останнім.

Рекомендований порядок: **3 → 1 → 2 → 4 → 5** (від найпростішого до найскладнішого).
