# Skill: Convert COBOL Program to Spec + C API

Convert a COBOL `.cbl` program (or a specific processing mode within it) into a
language-neutral spec and C API implementation.

## Usage
```
/convert-cobol <program.cbl> [mode-number]
```

If mode-number is provided, only that processing mode is converted. Otherwise,
analyze the program and list available modes for the user to choose.

## Steps

### Phase 1: Full COBOL Analysis
1. Read the `.cbl` file completely
2. Read `CAPI_RULES.md` (all 25 rules)
3. Start from BUSINESS-LOGIC / main PERFORM sequence (Rule 22)
4. Trace the complete execution path:
   - Pre-dispatch shared logic (VALIDATE-LINKAGE, INITIAL-SETUP, VALIDATE-ACCESS)
   - Mode dispatch (EVALUATE PRS-MD)
   - Mode-specific paragraphs and every PERFORM within them (transitively)
   - Output-building paragraphs — every MOVE and every PERFORM
   - Post-processing paragraphs
5. Run full checklist 23d
6. For each table read:
   - Verify table name via SYTABLEW declarations (Rule 22c)
   - Trace key source via MOVE statements (Rule 22g)
   - Check for second-structure patterns (Rule 22f)
   - Trace post-read conditional logic in caller (Rule 22d)
7. Verify all string constants against exact COBOL MOVE statements (Rule 22e)
8. Identify only the request parameters used by this mode (Rule 21)

### Phase 2: Write the Spec
1. Create `<apiname>_english.md`
2. Describe business logic only — no language-specific details (Rule 24)
3. SQL existence checks use `SELECT 1 ... LIMIT 1` (Rule 25)
4. External program calls follow Rule 20
5. Include: purpose, function signature, parameters, step-by-step logic,
   private functions, exact string constants, tables reference

### Phase 3: Write the C Implementation
1. Create `<apiname>.c`
2. Follow all CAPI_RULES.md patterns exactly
3. Use existing frame functions where available (e.g., `arcusacsValidateAccess`)
4. Stub unavailable external programs with TODO comments (Rule 20)

### Phase 4: Review
1. Cross-check spec against COBOL source for completeness
2. Verify all error codes, table names, and string constants
3. Ensure no `count(*)` for existence checks
4. Ensure no language-specific details leaked into spec
