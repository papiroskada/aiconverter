# Code Conventions Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Code conventions" card to `SettingsPage.jsx` with four editable textarea fields for DB read/write patterns, error handling, and external call conventions.

**Architecture:** Create a thin `Textarea` UI component matching existing `Input` styling, then add a new `<Card>` section to `SettingsPage` that binds the four `code_*` settings fields. No new API endpoints — the existing `PUT /api/settings` already handles these fields.

**Tech Stack:** React, Tailwind CSS, shadcn-style components, Vitest + React Testing Library

---

### Task 1: Create Textarea component

**Files:**
- Create: `client/src/components/ui/textarea.jsx`
- Create: `client/tests/components/Textarea.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `client/tests/components/Textarea.test.jsx`:

```jsx
import { render, screen } from '@testing-library/react'
import { Textarea } from '../../src/components/ui/textarea.jsx'

test('renders a textarea element', () => {
  render(<Textarea placeholder="Enter pattern" />)
  expect(screen.getByRole('textbox')).toBeInTheDocument()
})

test('displays passed value', () => {
  render(<Textarea value="await db.select()" onChange={() => {}} />)
  expect(screen.getByRole('textbox')).toHaveValue('await db.select()')
})

test('applies extra className', () => {
  const { container } = render(<Textarea className="font-mono" />)
  expect(container.querySelector('textarea')).toHaveClass('font-mono')
})

test('forwards rows prop', () => {
  const { container } = render(<Textarea rows={3} />)
  expect(container.querySelector('textarea')).toHaveAttribute('rows', '3')
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd client && npx vitest run tests/components/Textarea.test.jsx
```

Expected: FAIL — `Cannot find module '../../src/components/ui/textarea.jsx'`

- [ ] **Step 3: Create the Textarea component**

Create `client/src/components/ui/textarea.jsx`:

```jsx
import * as React from "react"
import { cn } from "@/lib/utils"

function Textarea({ className, ...props }) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 md:text-sm dark:bg-input/30",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd client && npx vitest run tests/components/Textarea.test.jsx
```

Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/components/ui/textarea.jsx client/tests/components/Textarea.test.jsx
git commit -m "feat(ui): add Textarea component"
```

---

### Task 2: Add Code conventions card to SettingsPage

**Files:**
- Modify: `client/src/pages/admin/SettingsPage.jsx`

- [ ] **Step 1: Add Textarea import**

In `client/src/pages/admin/SettingsPage.jsx`, add `Textarea` to the imports at the top of the file. The current imports block ends at line 12. Add after the existing component imports:

```jsx
import { Textarea } from '@/components/ui/textarea'
```

Full imports block after the change:

```jsx
import { useState, useEffect } from 'react'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { apiFetch, apiJson } from '@/api/client.js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
```

- [ ] **Step 2: Add Code conventions Card before the Save button**

In `client/src/pages/admin/SettingsPage.jsx`, insert the new card between the closing `</Card>` of the OpenAI section (line 198) and the Save button `<div>` (line 201).

Add this block:

```jsx
        {/* Code conventions */}
        <Card>
          <CardHeader><CardTitle className="text-base">Code conventions</CardTitle></CardHeader>
          <CardContent className="space-y-4">
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
            </div>
            <Separator />
            <div className="space-y-2">
              <Label htmlFor="code-db-write">DB write pattern</Label>
              <p className="text-xs text-muted-foreground">Placeholders: <code>{'{table}'}</code> <code>{'{cols}'}</code> <code>{'{key}'}</code> <code>{'{\$params}'}</code> <code>{'{values}'}</code></p>
              <Textarea
                id="code-db-write"
                rows={2}
                value={settings?.code_db_write ?? ''}
                onChange={setEv('code_db_write')}
                className="font-mono text-sm"
              />
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
            </div>
          </CardContent>
        </Card>
```

- [ ] **Step 3: Run full test suite to confirm no regressions**

```bash
cd client && npx vitest run
```

Expected: all existing tests PASS

- [ ] **Step 4: Start dev server and verify visually**

```bash
cd client && npm run dev
```

Open the Settings page (Admin → Settings). Verify:
- "Code conventions" card appears below OpenAI card
- All four textareas show the default values from the server
- Placeholder hint text is visible below each label
- Editing a textarea and clicking Save persists the value (reload page to confirm)

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/admin/SettingsPage.jsx
git commit -m "feat(settings): add code conventions section"
```
