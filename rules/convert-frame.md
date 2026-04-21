# Skill: Convert Netron Frame to Spec + C

Convert a Netron `.f` frame file into a language-neutral spec and C implementation.

## Usage
```
/convert-frame <frame-file.f>
```

## Steps

### Phase 1: Analyze the Frame
1. Read the `.f` file completely
2. Read `CAPI_RULES.md` (especially Rules 23, 24, 25)
3. Identify:
   - Input work area fields (become function parameters)
   - Output work area fields (become return values / output pointers)
   - Logic paragraphs and their flow
   - Any sub-frames (inline COPY members)
   - Any external service calls (SYCALPGM-* paragraphs)
   - All table reads and their key sources
   - All string constants (error sequences, data element names)
4. Run checklist 23d against the frame

### Phase 2: Write the Spec
1. Create `<framename>_english.md` in the same directory
2. Include:
   - Purpose
   - Function signature (C-style but logic is language-neutral)
   - Parameters table (COBOL field → C parameter mapping)
   - Step-by-step logic (business logic only, no memory management)
   - Sub-frame logic (inlined)
   - Exact string constants table
   - Tables reference
3. SQL existence checks use `SELECT 1 ... LIMIT 1`, not `count(*)`
4. No language-specific cleanup instructions (Rule 24)

### Phase 3: Write the C Implementation
1. Create `<framename>.c` in the same directory
2. Follow all CAPI_RULES.md patterns
3. Internal helper functions use `pvt` prefix and are `static`
4. Single public function matching the spec signature
5. Proper cJSON cleanup, pool memory usage, SQL escaping

### Phase 4: Update Callers
1. Find all `.c` files that previously inlined this frame's logic
2. Replace inline implementations with `extern` declaration + direct call
3. Remove dead code (old pvt functions that are no longer needed)
