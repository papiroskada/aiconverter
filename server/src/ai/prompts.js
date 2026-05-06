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

export const C_BUSINESS_ANALYSIS_PROMPT = (context) => `
You are a C expert analyzing a legacy CAPI service module to document its business logic for TypeScript/JavaScript rewrite.

${context}

Return ONLY valid JSON matching this schema exactly:
{
  "businessPurpose": "one sentence: what business problem this service solves",
  "parameters": [
    {
      "name": "camelCaseName",
      "cobolName": "ORIGINAL_FIELD_NAME",
      "type": "string|number|boolean|object",
      "direction": "in|out|inout",
      "description": "business meaning of this parameter"
    }
  ],
  "entryPoints": [
    {
      "condition": "mode value that activates this operation e.g. prs_md='F', or 'always'",
      "businessName": "human-readable operation name e.g. Fetch Records",
      "paragraphNames": ["FUNCTION_NAME_1", "FUNCTION_NAME_2"],
      "steps": ["ordered business action 1", "ordered business action 2"],
      "sideEffects": ["what changes: updates TABLE-X", "calls service Y"],
      "returns": "what output fields are populated on success",
      "errors": ["ERROR-CODE: business meaning and consequence"],
      "dbOperations": [
        {
          "table": "table-name",
          "operation": "SGE|RDN|UPD|DEL|INL",
          "keyFields": ["key-field-used-in-lookup"],
          "notFoundAction": { "type": "error", "code": 1500 }
        }
      ]
    }
  ],
  "errorCatalog": [
    {
      "code": "numeric error code as string",
      "businessMeaning": "what this error means for the business process",
      "systemAction": "what the service does when this error occurs"
    }
  ],
  "externalDependencies": [
    {
      "program": "CALLED-SERVICE-NAME",
      "purpose": "why this service is called in business terms",
      "dataIn": "what data is passed to it",
      "dataOut": "what data comes back"
    }
  ],
  "dbTables": [
    {
      "table": "table-name",
      "operation": "SGE|RDN|UPD|DEL|INL",
      "fields": ["field-name"],
      "keyFields": ["key-field-used-in-lookup"],
      "notFoundAction": { "type": "error", "code": 1500 }
    }
  ],
  "fileIO": []
}

Rules:
- businessPurpose: one sentence, business domain language, not C code terms
- parameters: use INPUT FIELDS and OUTPUT FIELDS sections — derive direction from field name suffix (InpRec = in, OutRec = out); infer JS type: char array = string, int = number
- entryPoints: use MODE DISPATCH — each case is one entry point; if MODE DISPATCH is (none) create one entry with condition "always"
- entryPoints[].paragraphNames: list ALL function names for this mode including PRE-DISPATCH FUNCTIONS
- entryPoints[].steps: start with PRE-DISPATCH FUNCTIONS logic (validation, init — listed in context), then mode-specific steps; each step must name the specific fields, values, and conditions involved — e.g. "Reads exreur with key eur_exec_lgn_id; if not found, returns error 1500" not "validates user"; include actual error codes, field names, and conditional branches; each step that reads a DB table must reference the notFoundAction behavior inline — e.g. "RDN exrcdv with key cdv_macaddr; if not found: set defaults and continue (log error)" not "Read CDV record"
- errorCatalog: use ERROR CALLS — each entry has code and field pre-extracted; add businessMeaning and systemAction from code context; include ONLY codes explicitly set in the C source (assignment to output status field with a literal number) — never include generic codes like 9999 unless they appear literally in the code
- externalDependencies: use SERVICE CALLS — only meaningful business calls; exclude c_xxx utility calls (c_writelnkarea, c_fmtShrtDate, c_getdatetm etc.)
- dbTables: use DATABASE CALLS (svcCallPlnsqlio) — table and operations pre-extracted; for each call also capture: keyFields = fields passed as lookup key; notFoundAction = structured object — read the function to determine which applies: { "type": "error", "code": N } stops with error; { "type": "defaults", "fields": { "field": value }, "logError": bool } sets fields and continues; { "type": "continue" } falls through; { "type": "skip" } conditionally skipped; do NOT guess from error catalog; INL/UPD/DEL → notFoundAction null
- entryPoints[].dbOperations: list ONLY tables touched by this entry point's functions (including pre-dispatch); same notFoundAction structured object logic as dbTables; INL/UPD/DEL → notFoundAction null; return [] if none
- fileIO: always []

Analysis discipline:
- Function names are labels — pvtValidateAccess in one service checks branches, in another reads different tables; always base analysis on actual function code
- For each DB table read (RDN), consider what happens after: conditional error? fallback read? field derivation?
- PRE-DISPATCH FUNCTIONS run before every mode — their logic applies to ALL entry points
`

export const CODE_GENERATION_PROMPT = (context) => `
You are a legacy COBOL/C to TypeScript expert. Convert the operation described below into a modern async function.

${context}

Return ONLY valid JSON matching this schema exactly:
{
  "functionName": "camelCase function name derived from the operation name",
  "code": "complete async function — self-contained, no placeholders",
  "notes": ["any assumption or decision worth explaining to a reviewer"]
}

Rules:
- Derive logic from STEPS and DB OPERATIONS — COBOL SOURCE PARAGRAPHS may or may not be present; if absent, implement strictly from steps, dbOperations, and notFoundAction
- Implement every branch, condition, and error case from the steps — do not skip or summarize
- Parameters: use camelCase names matching INPUT/OUTPUT PARAMETERS (EUR-EXEC-LGN-ID → eurExecLgnId)
- WS CONSTANTS: use the exact values listed — never invent placeholder strings
- DB reads: use the DB READ pattern from context; use field names from DB TABLE SCHEMAS; handle not-found exactly per notFoundAction — { type: error } → return/throw error; { type: defaults } → set the specified fields and continue; { type: continue } → continue normally; { type: skip } → skip operation
- DB writes: use the DB WRITE pattern from context
- External calls: use the EXTERNAL CALL pattern from context — destructure result
- Errors: use the ERROR pattern from context; use ONLY codes from ERROR CATALOG — never invent codes not listed
- Boolean conditions: translate literally — AND stays AND, OR stays OR; do not simplify
- Pre-dispatch paragraphs run first, then entry-point-specific logic
- Do not add try/catch blocks not present in the source — only catch what is explicitly handled
- Do not abbreviate or skip logic — the goal is a complete, runnable implementation
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

export const C_ANALYZE_ENTRY_POINT_PROMPT = (condition, businessName, context) => `
You are a C expert analyzing one specific operation of a legacy CAPI service for TypeScript/JavaScript rewrite documentation.

Operation: ${businessName} (triggered when ${condition})

${context}

Return ONLY valid JSON matching this schema exactly:
{
  "steps": ["ordered business action 1", "ordered business action 2"],
  "sideEffects": ["what changes in the system"],
  "returns": "what output fields or status are set on success",
  "errors": ["ERROR-CODE: business meaning and consequence"],
  "dbOperations": [
    {
      "table": "table-name",
      "operation": "SGE|RDN|UPD|DEL|INL",
      "keyFields": ["key-field-used-in-lookup"],
      "notFoundAction": { "type": "error", "code": 1500 }
    }
  ]
}

Rules:
- steps: start with PRE-DISPATCH FUNCTIONS logic (validation, init from context) — these run before this operation; then operation-specific logic; each step must name the specific fields, values, and conditions involved — e.g. "Reads exreur with key eur_exec_lgn_id; if not found, returns error 1500"; include actual error codes, field names, and conditional branches; each step that reads a DB table must reference the notFoundAction behavior inline — e.g. "RDN exrcdv with key cdv_macaddr; if not found: set defaults and continue (log error)" not "Read CDV record"
- sideEffects: every DB change, service call triggered, output field populated
- returns: which output fields are set, what status code
- errors: reference ERROR CALLS from context — use actual codes from the list
- dbOperations: list ONLY tables touched by this entry point's functions (including pre-dispatch); keyFields = fields in WHERE/lookup; notFoundAction = structured object — read the function to determine: { "type": "error", "code": N } stops; { "type": "defaults", "fields": { "field": value }, "logError": bool } sets fields and continues; { "type": "continue" } falls through; { "type": "skip" } conditionally skipped; do NOT guess from error catalog; INL/UPD/DEL → notFoundAction null; return [] if none
- Function names are labels: base analysis on actual function code, not the name
- For DB reads: describe what happens after (conditional errors, fallback, field derivation)
`
