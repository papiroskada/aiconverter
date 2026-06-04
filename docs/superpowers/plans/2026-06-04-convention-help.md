# Convention Help Expandable Sections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an expandable "Show example" toggle below each Code conventions textarea in SettingsPage that reveals a concrete code example and a placeholder reference table.

**Architecture:** Add a `FIELD_HELP` config constant and a local `ConventionHelp` component directly in `SettingsPage.jsx`. Each of the four convention field divs gets a `<ConventionHelp field="code_*" />` inserted after its `<Textarea>`. No new files needed.

**Tech Stack:** React, Tailwind CSS, Vitest + React Testing Library

---

### Task 1: Add ConventionHelp component and wire up all four fields

**Files:**
- Modify: `client/src/pages/admin/SettingsPage.jsx`
- Create: `client/tests/components/ConventionHelp.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `client/tests/components/ConventionHelp.test.jsx`:

```jsx
import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'

vi.mock('@/api/client.js', () => ({
  apiFetch: vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({
      ai_provider: 'claude',
      claude_api_key: null,
      openai_api_key: null,
      claude_model_interface: 'claude-sonnet-4-6',
      claude_model_rules: 'claude-haiku-4-5-20251001',
      openai_model_interface: 'gpt-4o',
      openai_model_rules: 'gpt-4o-mini',
      code_db_read: '',
      code_db_write: '',
      code_error_convention: '',
      code_external_call: '',
      code_language: 'typescript',
      code_source_mode: 'with_source',
    }),
  }),
  apiJson: vi.fn(),
}))

import SettingsPage from '../../src/pages/admin/SettingsPage.jsx'

test('renders Show example button for each of the 4 convention fields', async () => {
  render(<SettingsPage />)
  const buttons = await screen.findAllByText(/show example/i)
  expect(buttons).toHaveLength(4)
})

test('clicking Show example reveals example code and placeholder table', async () => {
  render(<SettingsPage />)
  const buttons = await screen.findAllByText(/show example/i)

  // DB read field — first button
  expect(screen.queryByText('Table name, e.g. EMPLOYEES')).not.toBeInTheDocument()
  fireEvent.click(buttons[0])
  expect(screen.getByText('Table name, e.g. EMPLOYEES')).toBeInTheDocument()
  expect(screen.getByText('{table}')).toBeInTheDocument()
})

test('clicking Hide example collapses the panel', async () => {
  render(<SettingsPage />)
  const showBtn = (await screen.findAllByText(/show example/i))[0]
  fireEvent.click(showBtn)
  expect(screen.getByText('Table name, e.g. EMPLOYEES')).toBeInTheDocument()

  fireEvent.click(screen.getByText(/hide example/i))
  expect(screen.queryByText('Table name, e.g. EMPLOYEES')).not.toBeInTheDocument()
})

test('each field shows its own placeholders', async () => {
  render(<SettingsPage />)
  const buttons = await screen.findAllByText(/show example/i)

  // DB write (index 1) has {$params}
  fireEvent.click(buttons[1])
  expect(screen.getByText('{$params}')).toBeInTheDocument()
  fireEvent.click(screen.getByText(/hide example/i))

  // Error convention (index 2) has {rtnStsField}
  fireEvent.click(buttons[2])
  expect(screen.getByText('{rtnStsField}')).toBeInTheDocument()
  fireEvent.click(screen.getByText(/hide example/i))

  // External call (index 3) has {name}
  fireEvent.click(buttons[3])
  expect(screen.getByText('{name}')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd client && npx vitest run tests/components/ConventionHelp.test.jsx
```

Expected: FAIL — `ConventionHelp` buttons not found (component doesn't exist yet)

- [ ] **Step 3: Add FIELD_HELP constant after the model constants (line 20)**

In `client/src/pages/admin/SettingsPage.jsx`, insert after line 20 (after `const CLAUDE_RULES_MODELS = ...`):

```jsx
const FIELD_HELP = {
  code_db_read: {
    example:
`const { rows: [employee] } = await pool.query(
  'SELECT id, name FROM EMPLOYEES WHERE EMP_ID = $1',
  [empId]
)
// if (!employee) { /* not found */ }`,
    placeholders: [
      { token: '{table}',     desc: 'Table name, e.g. EMPLOYEES' },
      { token: '{key}',       desc: 'Primary key field, e.g. EMP_ID' },
      { token: '{value}',     desc: 'Key variable name, e.g. empId' },
      { token: '{resultVar}', desc: 'Result variable name, e.g. employee' },
      { token: '{cols}',      desc: 'Selected columns, e.g. id, name' },
    ],
  },
  code_db_write: {
    example:
`await pool.query(
  'INSERT INTO EMPLOYEES (name, dept) VALUES ($1, $2)',
  [name, dept]
)
// UPDATE: await pool.query(
//   'UPDATE EMPLOYEES SET name = $1 WHERE EMP_ID = $2',
//   [name, empId]
// )`,
    placeholders: [
      { token: '{table}',   desc: 'Table name, e.g. EMPLOYEES' },
      { token: '{cols}',    desc: 'Column list, e.g. name, dept' },
      { token: '{key}',     desc: 'Primary key field, e.g. EMP_ID' },
      { token: '{$params}', desc: 'Positional params, e.g. $1, $2' },
      { token: '{values}',  desc: 'Value variables, e.g. name, dept' },
    ],
  },
  code_error_convention: {
    example: `output.RETURN_STATUS = 'ERR001'; return output`,
    placeholders: [
      { token: '{rtnStsField}', desc: 'Return status field, e.g. RETURN_STATUS' },
      { token: '{code}',        desc: 'Error code value, e.g. ERR001' },
      { token: '{field}',       desc: 'Field name related to the error (optional)' },
    ],
  },
  code_external_call: {
    example: `await callProgram('VALIDATE_USER', input)`,
    placeholders: [
      { token: '{name}', desc: 'Called program name, e.g. VALIDATE_USER' },
    ],
  },
}
```

- [ ] **Step 4: Add ConventionHelp component after MaskedInput (before SettingsPage function)**

In `client/src/pages/admin/SettingsPage.jsx`, insert after the closing `}` of `MaskedInput` and before `export default function SettingsPage()`:

```jsx
function ConventionHelp({ field }) {
  const [open, setOpen] = useState(false)
  const help = FIELD_HELP[field]
  if (!help) return null
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mt-1"
      >
        ⓘ {open ? 'Hide example ▴' : 'Show example ▾'}
      </button>
      {open && (
        <div className="mt-2 rounded-md border border-border bg-muted/30 p-3 space-y-3 text-xs">
          <pre className="font-mono whitespace-pre-wrap break-all leading-relaxed">
            {help.example}
          </pre>
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="pr-4 pb-1 font-medium">Placeholder</th>
                <th className="pb-1 font-medium">Description</th>
              </tr>
            </thead>
            <tbody>
              {help.placeholders.map(({ token, desc }) => (
                <tr key={token}>
                  <td className="pr-4 py-0.5 font-mono text-foreground">{token}</td>
                  <td className="py-0.5 text-muted-foreground">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Add `<ConventionHelp />` after each Textarea in the Code conventions card**

In `client/src/pages/admin/SettingsPage.jsx`, add `<ConventionHelp field="code_db_read" />` immediately after the DB read `<Textarea ... />`, and repeat for all four fields.

The four field divs should look like this after the change:

```jsx
            <div className="space-y-2">
              <Label htmlFor="code-db-read">DB read pattern</Label>
              <p className="text-xs text-muted-foreground">Placeholders: <code>{'{table}'}</code> <code>{'{key}'}</code> <code>{'{value}'}</code> <code>{'{resultVar}'}</code> <code>{'{cols}'}</code></p>
              <Textarea
                id="code-db-read"
                rows={2}
                value={settings?.code_db_read ?? ''}
                onChange={setEv('code_db_read')}
                className="font-mono text-sm"
              />
              <ConventionHelp field="code_db_read" />
            </div>
            <Separator />
            <div className="space-y-2">
              <Label htmlFor="code-db-write">DB write pattern</Label>
              <p className="text-xs text-muted-foreground">Placeholders: <code>{'{table}'}</code> <code>{'{cols}'}</code> <code>{'{key}'}</code> <code>{'{$params}'}</code> <code>{'{values}'}</code></p>
              <Textarea
                id="code-db-write"
                rows={2}
                value={settings?.code_db_write ?? ''}
                onChange={setEv('code_db_write')}
                className="font-mono text-sm"
              />
              <ConventionHelp field="code_db_write" />
            </div>
            <Separator />
            <div className="space-y-2">
              <Label htmlFor="code-error-convention">Error handling pattern</Label>
              <p className="text-xs text-muted-foreground">Placeholders: <code>{'{code}'}</code> <code>{'{field}'}</code> <code>{'{rtnStsField}'}</code></p>
              <Textarea
                id="code-error-convention"
                rows={2}
                value={settings?.code_error_convention ?? ''}
                onChange={setEv('code_error_convention')}
                className="font-mono text-sm"
              />
              <ConventionHelp field="code_error_convention" />
            </div>
            <Separator />
            <div className="space-y-2">
              <Label htmlFor="code-external-call">External call pattern</Label>
              <p className="text-xs text-muted-foreground">Placeholders: <code>{'{name}'}</code></p>
              <Textarea
                id="code-external-call"
                rows={2}
                value={settings?.code_external_call ?? ''}
                onChange={setEv('code_external_call')}
                className="font-mono text-sm"
              />
              <ConventionHelp field="code_external_call" />
            </div>
```

- [ ] **Step 6: Run tests to confirm they pass**

```bash
cd client && npx vitest run tests/components/ConventionHelp.test.jsx
```

Expected: 4 tests PASS

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/admin/SettingsPage.jsx client/tests/components/ConventionHelp.test.jsx
git commit -m "feat(settings): add expandable example panels to convention fields"
```
