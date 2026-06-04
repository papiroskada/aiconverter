# Code Conventions Settings — Design Spec

## Overview

Add a "Code conventions" card to `SettingsPage.jsx` so admins can configure the four code-generation patterns stored in `settings`:

- `code_db_read` — pattern for DB read queries
- `code_db_write` — pattern for DB write queries
- `code_error_convention` — error handling return pattern
- `code_external_call` — inter-program call pattern

## Architecture

No new API endpoints or schema changes required. The existing `PUT /api/settings` endpoint already accepts all four fields (they are in `DEFAULTS` in `server/src/models/settings.js`). The frontend `SettingsPage` already loads and saves all settings fields generically.

## UI Component

**Location:** new `<Card>` in `client/src/pages/admin/SettingsPage.jsx`, placed after the OpenAI card and before the Save button.

**New component needed:** `client/src/components/ui/textarea.jsx` — a thin wrapper around a native `<textarea>` with the same Tailwind classes as the existing `<Input>` component (border, rounded, bg-transparent, focus ring, etc.). No external dependency needed.

## Field Layout

Each of the four fields uses this structure:

```
<Label>{field label}</Label>
<p className="text-xs text-muted-foreground mb-1">Placeholders: {x}, {y}, ...</p>
<Textarea rows={2} value={settings?.code_db_read ?? ''} onChange={setEv('code_db_read')} className="font-mono text-sm" />
```

| Field | Label | Available placeholders |
|-------|-------|----------------------|
| `code_db_read` | DB read pattern | `{table}` `{key}` `{value}` `{resultVar}` `{cols}` |
| `code_db_write` | DB write pattern | `{table}` `{cols}` `{key}` `{$params}` `{values}` |
| `code_error_convention` | Error handling pattern | `{code}` `{field}` `{rtnStsField}` |
| `code_external_call` | External call pattern | `{name}` |

## Data Flow

1. `SettingsPage` loads all settings via `GET /api/settings` on mount — fields already included in response.
2. User edits a textarea → `setEv(key)` updates local `settings` state.
3. User clicks Save → existing `handleSave` sends `PUT /api/settings` with the full `settings` object — no changes needed to save logic.
4. Server validates against `DEFAULTS` keys whitelist and persists.

## Files Changed

| File | Change |
|------|--------|
| `client/src/components/ui/textarea.jsx` | Create — shadcn-style Textarea component |
| `client/src/pages/admin/SettingsPage.jsx` | Add import + "Code conventions" Card section |
