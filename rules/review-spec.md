# Skill: Review Spec Against COBOL Source

Validate a spec file against its COBOL source to catch errors and omissions.

## Usage
```
/review-spec <spec-file.md> <cobol-source.cbl|.f>
```

## Checks

### Completeness
- [ ] All shared paragraphs (pre-dispatch) are covered
- [ ] All PERFORMs traced transitively — no missing logic
- [ ] Output-building paragraph fully traced (MOVEs and PERFORMs)
- [ ] All external program calls documented (Rule 20)

### Correctness
- [ ] Every string constant verified against exact COBOL MOVE statement (Rule 22e)
- [ ] Every table name verified via SYTABLEW declaration (Rule 22c)
- [ ] Every read key source traced to its MOVE statement (Rule 22g)
- [ ] Second-structure names confirmed as same-table buffers (Rule 22f)
- [ ] Post-read conditional logic from caller traced (Rule 22d)
- [ ] Request parameters limited to those actually used by this mode (Rule 21)

### Language Neutrality (Rule 24)
- [ ] No memory management instructions
- [ ] No C-specific types or function names in logic
- [ ] No "delete row/object", "free", "set pointer to NULL"

### SQL (Rule 25)
- [ ] No `count(*)` for existence checks — uses `SELECT 1 ... LIMIT 1`
- [ ] `EXISTS` subqueries use `SELECT 1`, not `SELECT *`

### Output
Report findings as a checklist with pass/fail for each item. For failures,
quote the problematic text from the spec and the correct COBOL source.
