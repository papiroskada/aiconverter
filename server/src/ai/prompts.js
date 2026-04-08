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
      "errors": ["ERROR-CODE-OR-CONDITION: business meaning and consequence"]
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
    { "table": "TABLE-NAME", "operation": "SELECT|INSERT|UPDATE|DELETE", "fields": ["FIELD-NAME"] }
  ],
  "fileIO": [
    { "file": "FILE-NAME", "operations": ["OPEN", "READ", "WRITE", "CLOSE"] }
  ]
}

Rules:
- businessPurpose: one sentence, business domain language, not code language
- parameters: extract from LINKAGE SECTION only
- entryPoints: if program dispatches on a parameter (EVALUATE/IF on FUNC, MODE, ACTION etc.) create one entry per value; if no dispatch create one entry with condition "always"
- entryPoints[].paragraphNames: list ALL paragraph names relevant to this entry point (for large-file second-pass use)
- entryPoints[].steps: WHAT HAPPENS FOR THE BUSINESS, not code mechanics — "validates user credentials", not "performs VALIDATE-CREDS paragraph"
- entryPoints[].sideEffects: every data change, record creation/update/deletion, counter change, external call triggered
- errorCatalog: every error code, status value, or failure condition with its business meaning
- externalDependencies: every CALL statement — describe WHY it is called and what data flows in/out
- dbTables: confirm and enrich SQL tables from context; return [] if none
- fileIO: file I/O from SELECT/ASSIGN and OPEN/READ/WRITE/CLOSE; return [] if none
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
  "errors": ["ERROR-CODE-OR-CONDITION: business meaning and consequence"]
}

Rules:
- steps: WHAT HAPPENS FOR THE BUSINESS in this operation, not code mechanics
- sideEffects: every data change, record creation/update/deletion, counter change, external call triggered
- returns: what output parameters or status values are set on success
- errors: every error code or failure condition specific to this operation
`
