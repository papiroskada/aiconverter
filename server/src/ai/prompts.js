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
          "notFoundAction": "error 1500 | fallback read with key X | return empty | n/a"
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
      "notFoundAction": "error 1500 | fallback read with key X | return empty | n/a"
    }
  ],
  "fileIO": [
    { "file": "FILE-NAME", "operations": ["OPEN", "READ", "WRITE", "CLOSE"] }
  ]
}

Rules:
- businessPurpose: one sentence, business domain language, not code language
- parameters: use LINKAGE SECTION VARIABLES — field names, PIC types, and direction labels [in]/[out] are pre-analyzed; infer JS type: PIC X = string, PIC 9 = number, group level (no PIC) = object; direction null means infer from context
- entryPoints: use ENTRY POINT DISPATCH as the starting point — each WHEN entry is one entry point; if ENTRY POINT DISPATCH is (none), look for EVALUATE or IF blocks dispatching on a linkage parameter; if no dispatch create one entry with condition "always"
- entryPoints[].paragraphNames: list ALL paragraph names relevant to this entry point including PRE-DISPATCH PARAGRAPHS (for large-file second-pass use)
- entryPoints[].steps: include PRE-DISPATCH PARAGRAPHS logic first (validation, access checks, initial setup) — these run before every mode; then mode-specific steps; describe WHAT HAPPENS FOR THE BUSINESS, not code mechanics
- entryPoints[].sideEffects: every data change, record creation/update/deletion, counter change, external call triggered
- errorCatalog: use ERROR ENTRIES as the canonical list — each entry has seqNo and dataElement pre-extracted; populate code=seqNo, add businessMeaning and systemAction from context; include every entry listed
- externalDependencies: only CALLS representing meaningful business operations; EXCLUDE calls starting with C_ (C_WRITELNKAREA, C_GETPLENV, C_GETDATETM, C_HIGHLOW, C_ISOLATION, C_COMPRESS) — middleware boilerplate
- dbTables: combine DATABASE OPERATIONS (EXEC SQL) and DATABASE OPERATIONS (TUX MIDDLEWARE); if you see PREFIX2 operating on the same table as PREFIX in the paragraph text, that is a second buffer for the same table (not a different table) — the parser already deduplicates these; for each table also capture: keyFields = fields used in the WHERE clause or key lookup (e.g. primary key field); notFoundAction = what happens if the row does not exist (error code, fallback read with a different key, or "return empty"); if no key info is available use []; if write-only (INSERT/UPDATE/DELETE) set notFoundAction to "n/a"; return [] if none; table name: use the EXACT name from DATABASE OPERATIONS sections above — never invent, generalize, or translate to English; if you see a table access in paragraph code that is not listed in DATABASE OPERATIONS, write the COBOL prefix as-is (e.g. "eur-unknown") rather than guessing
- fileIO: file I/O from FILE I/O (SELECT statements) and OPEN/READ/WRITE/CLOSE in paragraphs; return [] if none
- entryPoints[].dbOperations: for each entry point list ONLY the db tables actually touched by that entry point's paragraphs (including pre-dispatch); use the same keyFields/notFoundAction logic as top-level dbTables; INSERT/UPDATE/DELETE → notFoundAction "n/a"; return [] if none

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
      "notFoundAction": "error 1500 | fallback read with key X | return empty | n/a"
    }
  ]
}

Rules:
- steps: start with PRE-DISPATCH PARAGRAPHS logic (validation, access, setup listed in context) — these run before this operation too; then describe the operation-specific WHAT HAPPENS FOR THE BUSINESS, not code mechanics
- sideEffects: every data change, record creation/update/deletion, counter change, external call triggered
- returns: what output parameters or status values are set on success
- errors: reference ERROR ENTRIES from context — format as "seqNo (dataElement): business meaning"; use actual seq numbers from the list, not generic descriptions
- dbOperations: list ONLY tables touched by this entry point's paragraphs (including pre-dispatch); keyFields = fields in WHERE clause or key lookup; notFoundAction = what happens if row not found (error code, fallback, "return empty"); INSERT/UPDATE/DELETE → notFoundAction "n/a"; return [] if none; table name: use the EXACT name from DATABASE OPERATIONS sections above — never invent, generalize, or translate to English; if you see a table access in paragraph code that is not listed in DATABASE OPERATIONS, write the COBOL prefix as-is (e.g. "eur-unknown") rather than guessing
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
          "notFoundAction": "error code | fallback read | return empty | n/a"
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
      "notFoundAction": "error code | fallback read | return empty | n/a"
    }
  ],
  "fileIO": []
}

Rules:
- businessPurpose: one sentence, business domain language, not C code terms
- parameters: use INPUT FIELDS and OUTPUT FIELDS sections — derive direction from field name suffix (InpRec = in, OutRec = out); infer JS type: char array = string, int = number
- entryPoints: use MODE DISPATCH — each case is one entry point; if MODE DISPATCH is (none) create one entry with condition "always"
- entryPoints[].paragraphNames: list ALL function names for this mode including PRE-DISPATCH FUNCTIONS
- entryPoints[].steps: start with PRE-DISPATCH FUNCTIONS logic (validation, init — listed in context), then mode-specific steps; describe WHAT HAPPENS FOR THE BUSINESS
- errorCatalog: use ERROR CALLS — each entry has code and field pre-extracted; add businessMeaning and systemAction from code context
- externalDependencies: use SERVICE CALLS — only meaningful business calls; exclude c_xxx utility calls (c_writelnkarea, c_fmtShrtDate, c_getdatetm etc.)
- dbTables: use DATABASE CALLS (svcCallPlnsqlio) — table and operations pre-extracted; for each call also capture: keyFields = fields passed as lookup key; notFoundAction = what happens if no row found (error code, fallback call, or "return empty"); INL/UPD/DEL → notFoundAction "n/a"
- entryPoints[].dbOperations: list ONLY tables touched by this entry point's functions (including pre-dispatch); same keyFields/notFoundAction logic as dbTables; INL/UPD/DEL → notFoundAction "n/a"; return [] if none
- fileIO: always []

Analysis discipline:
- Function names are labels — pvtValidateAccess in one service checks branches, in another reads different tables; always base analysis on actual function code
- For each DB table read (RDN), consider what happens after: conditional error? fallback read? field derivation?
- PRE-DISPATCH FUNCTIONS run before every mode — their logic applies to ALL entry points
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
      "notFoundAction": "error code | fallback read | return empty | n/a"
    }
  ]
}

Rules:
- steps: start with PRE-DISPATCH FUNCTIONS logic (validation, init from context) — these run before this operation; then operation-specific WHAT HAPPENS FOR THE BUSINESS
- sideEffects: every DB change, service call triggered, output field populated
- returns: which output fields are set, what status code
- errors: reference ERROR CALLS from context — use actual codes from the list
- dbOperations: list ONLY tables touched by this entry point's functions (including pre-dispatch); keyFields = fields in WHERE/lookup; notFoundAction = what happens if row not found; INL/UPD/DEL → notFoundAction "n/a"; return [] if none
- Function names are labels: base analysis on actual function code, not the name
- For DB reads: describe what happens after (conditional errors, fallback, field derivation)
`
