# Convention Help Expandable Sections — Design Spec

## Overview

Add inline expandable help sections to each of the four Code conventions fields in `SettingsPage.jsx`. A "Show example" toggle appears below each `<Textarea>`. Clicking it reveals a block with a concrete code example (placeholder values substituted) and a table explaining each available placeholder token.

## Architecture

All changes are confined to `client/src/pages/admin/SettingsPage.jsx`:

1. A `FIELD_HELP` constant — maps each field key to its example + placeholder descriptions.
2. A `ConventionHelp({ field })` local component — owns open/close state, renders the toggle button and expandable block.
3. A `<ConventionHelp field="code_*" />` call beneath each `<Textarea>` in the Code conventions card.

No new files, no new UI primitives needed.

## FIELD_HELP Constant

```js
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
      { token: '{table}',    desc: 'Table name, e.g. EMPLOYEES' },
      { token: '{cols}',     desc: 'Column list, e.g. name, dept' },
      { token: '{key}',      desc: 'Primary key field, e.g. EMP_ID' },
      { token: '{$params}',  desc: 'Positional params, e.g. $1, $2' },
      { token: '{values}',   desc: 'Value variables, e.g. name, dept' },
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

## ConventionHelp Component

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

## Usage in SettingsPage

Each of the four field divs gets `<ConventionHelp field="code_*" />` inserted after its `<Textarea>`:

```jsx
<div className="space-y-2">
  <Label htmlFor="code-db-read">DB read pattern</Label>
  <p className="text-xs text-muted-foreground">Placeholders: ...</p>
  <Textarea ... />
  <ConventionHelp field="code_db_read" />
</div>
```

## Files Changed

| File | Change |
|------|--------|
| `client/src/pages/admin/SettingsPage.jsx` | Add `FIELD_HELP` constant, `ConventionHelp` component, 4 usages |
