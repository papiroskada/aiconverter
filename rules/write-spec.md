# Skill: Write or Update a Spec File

Create or update a language-neutral `*_english.md` spec file from COBOL source.

## Usage
```
/write-spec <name> [source-file]
```

## Rules

1. Read `CAPI_RULES.md` first — especially Rules 20-25
2. Specs describe **business logic only**:
   - No memory management (no "delete", "free", "cleanup")
   - No C types (no "cJSON", "char *", "NULL")
   - No language-specific patterns
3. SQL patterns:
   - Existence checks: `SELECT 1 ... LIMIT 1` (Rule 25)
   - Never `count(*)` unless the count value itself is needed
   - `EXISTS` subqueries use `SELECT 1`
4. String constants: verify every value against the COBOL MOVE statement (Rule 22e)
5. Table names: verify via SYTABLEW declarations (Rule 22c)
6. Key sources: trace the MOVE that sets each key before the read (Rule 22g)
7. External calls: document as "call X with args", don't reimplement (Rule 20)

## Spec Structure

```markdown
# Spec: <Name> — <Short Description>

## 1. Purpose
## 2. Function Signature
## 3. Parameters (Inputs / Outputs)
## 4. Logic (step-by-step business logic)
## 5. Private Functions (internal helpers)
## 6. Exact String Constants
## 7. Tables Reference
```

Specs must be usable to generate code in C, Node.js, or any other language.
