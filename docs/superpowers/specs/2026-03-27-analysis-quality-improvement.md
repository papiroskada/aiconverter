# Analysis Quality Improvement

**Goal:** Improve JS rewrite accuracy by (1) extracting WORKING-STORAGE shared state deterministically and (2) sending full paragraph text for complex paragraphs so the AI produces per-paragraph business rules instead of just a one-sentence purpose.

**Background:** The current pipeline sends only the first 5 lines of each paragraph as context. This is sufficient for simple paragraphs but loses critical business rules in paragraphs with `EVALUATE`, nested `IF`, or complex branching. Additionally, WORKING-STORAGE variables (shared state) are not analysed — AI doing the JS rewrite cannot distinguish module-level state from local variables.

---

## What Changes

### 1. Deterministic WORKING-STORAGE Extraction

A new `extractWorkingStorage(cobolText)` function in `cobolParser.js` parses the WORKING-STORAGE SECTION and returns structured variable definitions.

**Variable Capture Rules:**
- Capture all levels (01 through 49, plus 77) within WORKING-STORAGE
- Return: `name`, `pic` (if present on this line, else `null`), `level`
- Capture 88-level condition names and their VALUE (as a string, including `THRU` ranges as-is)
- Stop at the next SECTION or DIVISION keyword
- Return `[]` if no WORKING-STORAGE SECTION or on parse error

**Output shape:**
```js
[
  {
    level: "01",
    name: "WS-USER-STATUS",
    pic: "X(2)",
    conditions: [
      { name: "STATUS-OK",        value: "\"00\"" },
      { name: "STATUS-NOT-FOUND", value: "\"04\"" }
    ]
  },
  {
    level: "01",
    name: "WS-RETRY-COUNT",
    pic: "9(3)",
    conditions: []
  },
  {
    level: "05",
    name: "WS-ADDR-LINE-1",
    pic: "X(40)",
    conditions: []
  }
]
```

**AI context format** (added as a new section in `buildInterfaceContext()`):
```
WORKING-STORAGE VARIABLES:
  01 WS-USER-STATUS (X(2))
     88 STATUS-OK = "00"
     88 STATUS-NOT-FOUND = "04"
  01 WS-RETRY-COUNT (9(3))
  05 WS-ADDR-LINE-1 (X(40))
```

This tells the AI what shared state exists so it can decide: local variable vs. module-level state vs. returned value.

`wsVars` is **in-memory only** — passed to the AI context, not stored as a new DB column.

`buildInterfaceContext()` gains a `wsVars` parameter (7th argument after the existing 6). The WORKING-STORAGE section appears **before** the PARAGRAPHS section in the context string.

---

### 2. Paragraph Classification

A new `isComplex(chunk)` function (in `orchestrator.js`) determines whether a paragraph needs full text or a 5-line snippet.

**A paragraph is complex if ANY of:**
- Contains `EVALUATE` keyword
- Contains 2 or more `IF` keywords (nested branching)
- Has more than 30 lines

```js
function isComplex(chunk) {
  const text = chunk.cobol_text.toUpperCase()
  const lines = text.split('\n')
  if (lines.length > 30) return true
  if (text.includes('EVALUATE')) return true
  const ifCount = (text.match(/\bIF\b/g) ?? []).length
  if (ifCount >= 2) return true
  return false
}
```

Applied only to `paragraph` and `sub_paragraph` chunk types. `data_summary` chunks are never included in context (unchanged from current behaviour).

`buildInterfaceContext()` sends:
- Complex paragraph → full `cobol_text`
- Simple paragraph → first 5 lines of `cobol_text`

---

### 3. Context Size Check and Two-Pass Decision

After building the interface context string, estimate its token count:

```js
function estimateTokens(text) {
  return Math.ceil(text.length / 4)
}
```

**Threshold: 80 000 tokens**

Rationale: Claude context limit is 128k. Reserve ~20k for prompt template + output. ~80k for content is conservative and leaves headroom for LINKAGE, calls, SQL sections.

- `estimateTokens(context) ≤ 80 000` → **single-pass** (proceed normally)
- `estimateTokens(context) > 80 000` → **two-pass fallback** (see Section 5)

---

### 4. Updated AI Output: `rules` Per Section (Single-Pass)

In single-pass mode, `INTERFACE_PROMPT` is updated so `sections` includes `rules`:

```json
"sections": [
  {
    "name": "VALIDATE-ORDER",
    "purpose": "Validates order status, amount, and credit limit",
    "rules": [
      "IF amount > 10000 AND credit insufficient → reject with CREDIT_EXCEEDED",
      "IF status is PENDING AND retries > 3 → set status ABANDONED",
      "IF status is unrecognised → set INVALID_STATUS"
    ]
  },
  {
    "name": "GET-USER-NAME",
    "purpose": "Copies user name to display variable",
    "rules": []
  }
]
```

**AI instructions for `rules`:**
- Each entry is one business rule in `IF … → …` format
- Cover ALL branches of `EVALUATE` / `IF` trees
- Include status codes, error paths, rejection reasons
- For simple paragraphs (MOVE / PERFORM only): return `rules: []`
- Limit: maximum 10 rules per paragraph

If the AI returns a section without the `rules` field, the orchestrator defaults to `rules: []` — backward compatible with providers that do not yet support the updated schema.

---

### 5. Two-Pass Fallback (Large Programs)

Triggered automatically when context > 80 000 tokens.

**Pass 1 — Interface spec:**
Uses 5-line snippets for ALL paragraphs (same as current behaviour). Calls `provider.extractInterface(context)` with the standard `INTERFACE_PROMPT`. The AI may return non-empty `rules` arrays for some sections based on what it can infer from snippets — this is acceptable. Pass 1 rules for **complex** paragraphs are discarded during the merge (overwritten by pass 2 results). Pass 1 rules for **simple** paragraphs are kept as-is (since simple paragraphs are never sent to pass 2, their pass 1 rules — typically `[]` — are the final value). Returns full spec including `purpose` per section.

**Pass 2 — Business rules for complex paragraphs only:**
A second `RULES_PROMPT` call. Input: batched full text of complex paragraphs only.

Input format:
```
[VALIDATE-ORDER]
<full cobol_text>

[PROCESS-PAYMENT]
<full cobol_text>
```

Output schema (returned by `extractRules()`):
```js
[
  {
    name: "VALIDATE-ORDER",
    rules: [
      "IF amount > 10000 AND credit insufficient → reject with CREDIT_EXCEEDED",
      "IF status is PENDING AND retries > 3 → set status ABANDONED"
    ]
  },
  {
    name: "PROCESS-PAYMENT",
    rules: [
      "IF payment method is CREDIT → call external authorisation service",
      "IF authorisation fails → set WS-PAY-ERROR and abort"
    ]
  }
]
```

`RULES_PROMPT` instructions to the AI:
- Return ONLY valid JSON — an array of objects with `name` (paragraph name) and `rules` (array of strings)
- Each rule: one business decision or action in `IF … → …` format
- Cover EVERY branch of IF/EVALUATE trees
- Include status codes, error paths, side effects
- Return `rules: []` for paragraphs with no conditional logic

**Merge logic** (after both passes complete):

Complex paragraphs are identified before pass 1 (`complexNames = new Set(complexChunks.map(c => c.chunk_name))`). The merge uses pass 2 rules for complex paragraphs, pass 1 rules for simple paragraphs:

```js
// Build lookup from pass 2 results
const rulesMap = new Map(pass2Results.map(r => [r.name, r.rules]))

// Merge: for complex paragraphs use pass 2 rules; for simple use pass 1 rules
const mergedSections = pass1Spec.sections.map(section => ({
  ...section,
  rules: complexNames.has(section.name)
    ? (rulesMap.get(section.name) ?? [])   // complex: pass 2 wins (or [] if pass 2 missed it)
    : (section.rules ?? [])                 // simple:  keep pass 1 rules
}))
// pass 2 results for names not in pass 1 → ignored
```

**Pass 2 is non-fatal:** any exception or JSON parse error → log warning, treat pass2Results as `[]` (so all complex chunks get rules from the merge formula above, which gives `rulesMap.get(...) ?? []` = `[]`). Pass 1 data is never lost. No retry.

---

### 6. Storage: `updateChunkPurpose` Updated Signature

`updateChunkPurpose` in `programChunks.js` is updated to accept both `purpose` and `rules`:

```js
export async function updateChunkPurpose(id, purpose, rules = []) {
  await pool.query(
    `UPDATE program_chunks SET analysis = $1, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify({ purpose, rules }), id]
  )
}
```

The orchestrator calls it as:
```js
await updateChunkPurpose(chunkId, section.purpose, section.rules ?? [])
```

`program_chunks.analysis` column shape changes from `{ "purpose": "..." }` to `{ "purpose": "...", "rules": ["...", "..."] }`. Existing rows with old shape are not migrated — frontend must handle missing `rules` field gracefully (default to `[]`).

---

## Data Flow

```
cobolText, chunks
  ↓
extractWorkingStorage()       → wsVars     (in-memory)
extractLinkage()              → linkage    (in-memory)
extractCalls()                → calls      (in-memory)
extractExecSql()              → sqlTables  (in-memory)
extractConstructs()           → constructs (in-memory)
extractSelectFiles()          → files      (in-memory)
  ↓
classify chunks → { complex[], simple[] }  (isComplex())
complexNames = new Set(complex.map(c => c.chunk_name))
  ↓
buildInterfaceContext(linkage, paragraphChunks, calls, sqlTables, selectFiles, constructs, wsVars)
  → context string  (WS section first, then PARAGRAPHS with adaptive snippets)
  ↓
estimateTokens(context)
  ├─ ≤ 80k → single-pass:
  │     provider.extractInterface(context) → spec (sections include rules)
  │
  └─ > 80k → two-pass:
        snippetContext = buildInterfaceContext(..., allSnippets)
        provider.extractInterface(snippetContext) → pass1Spec
        complexContext = complex paragraphs batched as [NAME]\n<full text>
        provider.extractRules(complexContext)     → pass2Results (or [] on failure)
        merge using complexNames + rulesMap       → mergedSections
        spec = { ...pass1Spec, sections: mergedSections }
  ↓
for each section in spec.sections:
  updateChunkPurpose(chunkId, section.purpose, section.rules ?? [])
  ↓
updateAnalysisFields(...)   (unchanged)
updateGraphAfterAnalysis()  (unchanged)
generateDiagram(...)        (unchanged)
```

---

## Files to Change

| File | Change |
|---|---|
| `server/src/parser/cobolParser.js` | Add `extractWorkingStorage()` |
| `server/src/ai/prompts.js` | Update `INTERFACE_PROMPT` sections schema (add `rules`). Add `RULES_PROMPT`. |
| `server/src/ai/providers/base.js` | Add `extractRules(context)` abstract method |
| `server/src/ai/providers/openai.js` | Implement `extractRules()` |
| `server/src/ai/providers/claude.js` | Implement `extractRules()` |
| `server/src/ai/orchestrator.js` | Add `isComplex()`, `estimateTokens()`, `extractSelectFiles()` already exists, update `buildInterfaceContext()` to include WS + smart sizing, add two-pass logic |
| `server/src/models/programChunks.js` | Update `updateChunkPurpose(id, purpose, rules = [])` |
| `server/tests/parser/cobolParser.test.js` | Add tests for `extractWorkingStorage` |
| `server/tests/ai/orchestrator.test.js` | Add tests for `isComplex`, smart context, two-pass merge |

---

## What Does Not Change

- `parseCobol()` — chunk creation unchanged
- `analysisService.js` — no changes (orchestrator output shape unchanged: still returns `sections`)
- `program_analysis` table — no new columns
- `graphService.js` — unchanged
- Frontend — reads `analysis.purpose` from chunk; `analysis.rules` is new but frontend can ignore it until a future UI change

---

## Token Cost Impact

| Scenario | Input tokens | Output tokens | Cost (Claude Sonnet ~$3/$15 per M) |
|---|---|---|---|
| Current (snippets only) | ~5k | ~3k | ~$0.07 |
| Single-pass, smart context | ~20k | ~6k | ~$0.16 |
| Two-pass fallback | ~70k | ~11k | ~$0.37 |

Single-pass covers the vast majority of programs. Two-pass is automatic fallback only.

---

## Error Handling

- `extractWorkingStorage` returns `[]` on parse error (non-fatal, logged)
- `isComplex` never throws — worst case returns `false` (treats as simple)
- Two-pass: pass 2 failure → `rules: []` for all complex chunks, log warning, overall analysis continues
- AI returns section without `rules` field → `rules: []` default (backward compatible)
- AI returns `rules` for unknown paragraph name → ignored in merge
