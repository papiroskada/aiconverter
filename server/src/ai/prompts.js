export const BUSINESS_ANALYSIS_PROMPT = (context) => `
You are a COBOL expert analyzing a legacy program to document its business logic for JavaScript rewrite.

${context}

Return ONLY valid JSON matching this schema exactly:
{
  "businessPurpose": "one sentence: what business problem this program solves",
  "parameters": [
    {
      "name": "camelCaseName",
      "cobolName": "ORIGINAL-COBOL-NAME",
      "type": "string|number|boolean|object",
      "direction": "in|out|inout",
      "description": "business meaning of this parameter"
    }
  ],
  "entryPoints": [
    {
      "condition": "parameter condition that activates this mode e.g. FUNC='INS', or 'always' if no dispatch",
      "businessName": "human-readable operation name e.g. Create Record",
      "paragraphNames": ["PARAGRAPH-NAME-1", "PARAGRAPH-NAME-2"],
      "steps": ["ordered business action 1", "ordered business action 2"],
      "sideEffects": ["what changes in the system: inserts into TABLE-X", "increments COUNTER-Y"],
      "returns": "what is set or returned on success",
      "errors": ["ERROR-CODE-OR-CONDITION: business meaning and consequence"],
      "dbOperations": [
        {
          "table": "TABLE-NAME",
          "operation": "SELECT|INSERT|UPDATE|DELETE",
          "keyFields": ["KEY-FIELD-USED-IN-WHERE-OR-INDEX"],
          "notFoundAction": { "type": "error", "code": 1500 }
        }
      ]
    }
  ],
  "errorCatalog": [
    {
      "code": "error code, status value, or COBOL condition name",
      "businessMeaning": "what this error means for the business process",
      "systemAction": "what the program does when this error occurs"
    }
  ],
  "externalDependencies": [
    {
      "program": "CALLED-PROGRAM-NAME",
      "purpose": "why this program is called in business terms",
      "dataIn": "what data is passed to it",
      "dataOut": "what data comes back from it"
    }
  ],
  "dbTables": [
    {
      "table": "TABLE-NAME",
      "operation": "SELECT|INSERT|UPDATE|DELETE",
      "fields": ["FIELD-NAME"],
      "keyFields": ["KEY-FIELD-USED-IN-WHERE-OR-INDEX"],
      "notFoundAction": { "type": "error", "code": 1500 }
    }
  ],
  "fileIO": [
    { "file": "FILE-NAME", "operations": ["OPEN", "READ", "WRITE", "CLOSE"] }
  ]
}

Rules:
- businessPurpose: one sentence, business domain language, not code language
- parameters: use LINKAGE SECTION VARIABLES — field names, PIC types, and direction labels [in]/[out] are pre-analyzed; infer JS type: PIC X = string, PIC 9 = number, group level (no PIC) = object; direction null means infer from context; every parameter MUST have a non-empty description — for group fields (no PIC, type=object) write what sub-fields they contain and their collective purpose; for FILLER fields write "Reserved padding field, not used in business logic"; for Tuxedo middleware fields (SVC-NM, TRS, service routing) write "Tuxedo middleware field — [purpose]"; for fields not directly referenced in the paragraphs write at minimum what their name implies in business terms
- entryPoints: use ENTRY POINT DISPATCH as the starting point — each WHEN entry is one entry point; if ENTRY POINT DISPATCH is (none), look for EVALUATE or IF blocks dispatching on a linkage parameter; if no dispatch create one entry with condition "always"
- entryPoints[].paragraphNames: list ALL paragraph names relevant to this entry point including PRE-DISPATCH PARAGRAPHS (for large-file second-pass use)
- entryPoints[].steps: include PRE-DISPATCH PARAGRAPHS logic first (validation, access checks, initial setup) — these run before every mode; then mode-specific steps; each step must name the specific fields, values, and conditions involved so a developer can implement it without reading the COBOL — e.g. "Reads EXREUR with key EUR-EXEC-LGN-ID; if not found, returns error 1500" not "validates user access"; include actual error codes, field names, and conditional branches; each step that reads a DB table must reference the notFoundAction behavior inline — e.g. "SELECT exrcdv WHERE CDV-MACADDR = EXIRI-MACADDR; if not found: set EXIRO-INSYNC-ACTV=0, EXIRO-UPD-AUTH-REQD=1 and continue (log error)" not "Read CDV record"
- entryPoints[].sideEffects: every data change, record creation/update/deletion, counter change, external call triggered
- errorCatalog: use ERROR ENTRIES as the canonical list — each entry has seqNo and dataElement pre-extracted; populate code=seqNo, add businessMeaning and systemAction from context; include every entry listed; include ONLY codes explicitly set in the COBOL source (MOVE <literal-number> TO output-status-field or equivalent) — never include generic codes like 9999 unless they appear literally in the COBOL
- externalDependencies: only CALLS representing meaningful business operations; EXCLUDE calls starting with C_ (C_WRITELNKAREA, C_GETPLENV, C_GETDATETM, C_HIGHLOW, C_ISOLATION, C_COMPRESS) — middleware boilerplate
- dbTables: combine DATABASE OPERATIONS (EXEC SQL) and DATABASE OPERATIONS (TUX MIDDLEWARE); if you see PREFIX2 operating on the same table as PREFIX in the paragraph text, that is a second buffer for the same table (not a different table) — the parser already deduplicates these; for each table also capture: keyFields = fields used in the WHERE clause or key lookup (e.g. primary key field); notFoundAction = structured object — read the COBOL paragraph to determine which applies: { "type": "error", "code": N } COBOL sets error output and stops; { "type": "defaults", "fields": { "FIELD-NAME": value }, "logError": bool } COBOL sets specific fields and continues (logError true when COBOL also logs/calls an error paragraph before continuing); { "type": "continue" } COBOL falls through, absence is acceptable business logic; { "type": "skip" } operation is conditionally skipped; do NOT guess from the error catalog — read the actual paragraph; INSERT/UPDATE/DELETE → notFoundAction null; if no key info is available use []; return [] if none; table name: use the EXACT name from DATABASE OPERATIONS sections above — never invent, generalize, or translate to English; if you see a table access in paragraph code that is not listed in DATABASE OPERATIONS, write the COBOL prefix as-is (e.g. "eur-unknown") rather than guessing
- fileIO: file I/O from FILE I/O (SELECT statements) and OPEN/READ/WRITE/CLOSE in paragraphs; return [] if none
- entryPoints[].dbOperations: for each entry point list ONLY the db tables actually touched by that entry point's paragraphs (including pre-dispatch); use the same notFoundAction structured object logic as top-level dbTables; INSERT/UPDATE/DELETE → notFoundAction null; return [] if none

Analysis discipline (from CAPI_RULES.md):
- Paragraph names are labels, not contracts — do NOT infer behavior from the name alone (VALIDATE-ACCESS in one program checks branches, in another it reads entirely different tables); always base analysis on the actual code content of each paragraph provided
- For each table read found in paragraphs, consider what happens after: are there conditional errors (not found = error?), fallback reads with different keys, or field derivation from the result?
- The pre-dispatch paragraphs listed in PRE-DISPATCH PARAGRAPHS run before every mode — their validation and setup logic applies to ALL entry points
`

export const ANALYZE_ENTRY_POINT_PROMPT = (condition, businessName, context) => `
You are a COBOL expert analyzing one specific operation of a legacy program for JavaScript rewrite documentation.

Operation: ${businessName} (triggered when ${condition})

${context}

Return ONLY valid JSON matching this schema exactly:
{
  "steps": ["ordered business action 1", "ordered business action 2"],
  "sideEffects": ["what changes in the system: inserts into TABLE-X", "increments COUNTER-Y"],
  "returns": "what is set or returned on success",
  "errors": ["ERROR-CODE-OR-CONDITION: business meaning and consequence"],
  "dbOperations": [
    {
      "table": "TABLE-NAME",
      "operation": "SELECT|INSERT|UPDATE|DELETE",
      "keyFields": ["KEY-FIELD-USED-IN-WHERE-OR-INDEX"],
      "notFoundAction": { "type": "error", "code": 1500 }
    }
  ]
}

Rules:
- steps: start with PRE-DISPATCH PARAGRAPHS logic (validation, access, setup listed in context) — these run before this operation too; then describe the operation-specific logic; each step must name the specific fields, values, and conditions involved so a developer can implement it without reading the COBOL — e.g. "Reads EXREUR with key EUR-EXEC-LGN-ID; if not found, returns error 1500" not "validates user access"; include actual error codes, field names, and conditional branches; each step that reads a DB table must reference the notFoundAction behavior inline — e.g. "SELECT exrcdv WHERE CDV-MACADDR = EXIRI-MACADDR; if not found: set EXIRO-INSYNC-ACTV=0 and continue (log error)" not "Read CDV record"
- sideEffects: every data change, record creation/update/deletion, counter change, external call triggered
- returns: what output parameters or status values are set on success
- errors: reference ERROR ENTRIES from context — format as "seqNo (dataElement): business meaning"; use actual seq numbers from the list, not generic descriptions
- dbOperations: list ONLY tables touched by this entry point's paragraphs (including pre-dispatch); keyFields = fields in WHERE clause or key lookup; notFoundAction = structured object — read the paragraph to determine which applies: { "type": "error", "code": N } stops with error; { "type": "defaults", "fields": { "FIELD": value }, "logError": bool } sets fields and continues; { "type": "continue" } falls through; { "type": "skip" } conditionally skipped; do NOT guess from error catalog; INSERT/UPDATE/DELETE → notFoundAction null; return [] if none; table name: use the EXACT name from DATABASE OPERATIONS sections above — never invent, generalize, or translate to English; if you see a table access in paragraph code that is not listed in DATABASE OPERATIONS, write the COBOL prefix as-is (e.g. "eur-unknown") rather than guessing
- Paragraph names are labels: do NOT infer behavior from name alone — base analysis on actual paragraph code provided
- For table reads: describe what happens after (conditional errors, fallback reads, field derivation)
`

export const PROGRAM_GENERATION_PROMPT = (context, patterns) => `
You are a legacy COBOL/C to ${patterns.language} expert. Generate a complete ${patterns.language} module for the program described below.

${context}

TARGET PATTERNS — use these exact patterns, no substitutions:
DB read:       ${patterns.dbRead}
DB write:      ${patterns.dbWrite}
Error:         ${patterns.errorConvention}
External call: ${patterns.externalCall}

Return ONLY valid JSON matching this schema exactly:
{
  "sharedTypes": "TypeScript interface/type declarations used across entry points (input, output, shared structures)",
  "functions": [
    {
      "condition": "entry point condition e.g. FUNC='INS'",
      "name": "camelCase function name",
      "code": "complete ${patterns.language} async function — self-contained, no placeholders"
    }
  ],
  "dispatcher": "main exported async function that reads the dispatch field and calls the matching entry point function",
  "imports": ["import statement 1", "import statement 2"],
  "notes": ["assumption or decision worth explaining to a reviewer"]
}

Rules:
- sharedTypes: declare interfaces for input, output parameters and any shared structures; use camelCase field names (EUR-EXEC-LGN-ID → eurExecLgnId)
- dispatcher: reads the mode/function field from input (derive field name from INPUT PARAMETERS) and delegates to the matching function; handle unknown mode with error from ERROR CATALOG or a sensible default
- Each function: implement every branch from its STEPS exactly — do not skip, summarize, or reorder
- DB operations: use TARGET PATTERNS above; handle notFoundAction exactly — { type: error } → return/throw error; { type: defaults } → set specified fields and continue; { type: continue } → continue; { type: skip } → skip
- WS CONSTANTS: use exact values — never invent placeholders
- Errors: use ONLY codes from ERROR CATALOG — never invent codes not listed
- Boolean conditions: translate literally — AND stays AND, OR stays OR
- COBOL SOURCE PARAGRAPHS may or may not be present; if absent, implement strictly from STEPS and DB OPERATIONS
- Do not add try/catch not present in the source
- imports: include only what the generated code actually uses
`

export const HOLE_FILL_PROMPT = (ctx) => `
You are converting COBOL business logic to TypeScript. Fill in ONE missing section of an already-generated TypeScript skeleton.

SURROUNDING TYPESCRIPT CONTEXT (do not change — for reference only):
\`\`\`typescript
${ctx.surroundingCode}
\`\`\`

RELEVANT COBOL SOURCE (only paragraphs for this section):
\`\`\`cobol
${ctx.cobolText}
\`\`\`

SECTION METADATA:
- Pattern: ${ctx.pattern}
- Reads from: ${ctx.reads.join(', ') || 'none'}
- Writes to:  ${ctx.writes.join(', ') || 'none'}
${ctx.steps?.length ? `\nBUSINESS STEPS — implement these in order (authoritative description of this section's logic):\n${ctx.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n` : ''}
${ctx.wsConstants ? `\nWORKING STORAGE CONSTANTS (use exact values, do not invent alternatives):\n${ctx.wsConstants}\n` : ''}
${ctx.tableSchemas ? `\nDB TABLE FIELDS (camelCase names to use in queries):\n${ctx.tableSchemas}` : ''}
TARGET PATTERNS — use exactly:
- DB read:  ${ctx.patterns.dbRead}
- DB write: ${ctx.patterns.dbWrite}
- Error:    ${ctx.patterns.errorConvention}

Return ONLY valid JSON:
{
  "code": "the TypeScript statements to place inside the function body (no function wrapper, no return output at the end)"
}

Rules:
- Implement the COBOL logic from the source above — do not invent logic not present in the source
- If BUSINESS STEPS are provided, treat them as the primary implementation guide (they clarify intent where COBOL is hard to read)
- For shared helper functions (returning boolean): set the return status field in output (e.g. output.rtnSts = code), then return false; caller returns output immediately
- For DB reads: use pool.query() with parameterized SQL ($1, $2, ...); use actual column names from DB TABLE FIELDS when available
- Use async/await for all DB operations
- Use camelCase field names (e.g. CLURI-PRS-MD → cluriPrsMd)
- Do not wrap in a function definition — return only the body statements
- Do not add the final \`return output\` — it already exists in the skeleton
- No try/catch unless explicitly in the COBOL source
`
