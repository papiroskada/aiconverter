export const INTERFACE_PROMPT = (context) => `
You are a COBOL expert analysing a program for documentation and JavaScript rewrite.

${context}

Return ONLY valid JSON matching this schema exactly:
{
  "programType": "subroutine",
  "description": "2-3 factual sentences: what the program receives, what it does, what external programs or files it uses. No filler phrases.",
  "flow_narrative": "5-8 sentences describing execution from entry to exit in plain English, including main branches and error paths.",
  "parameters": [
    { "name": "camelCaseName", "cobolName": "ORIGINAL-COBOL-NAME", "type": "string|number|boolean|object", "direction": "in|out|inout" }
  ],
  "fileIO": [
    { "file": "FILE-NAME", "operations": ["OPEN", "READ", "WRITE", "CLOSE"] }
  ],
  "externalCalls": [
    { "program": "program-name", "using": "PARAM-NAME-OR-NULL" }
  ],
  "dbTables": [
    { "table": "TABLE-NAME", "operation": "SELECT|INSERT|UPDATE|DELETE", "fields": ["FIELD-NAME"] }
  ],
  "sections": [
    {
      "name": "PARAGRAPH-NAME",
      "purpose": "one sentence in plain business English",
      "rules": ["IF condition → action", "IF condition → action"]
    }
  ]
}

programType values: "subroutine" (has LINKAGE SECTION / USING parameters), "batch" (reads/writes files via FILE SECTION), "transaction" (uses ACCEPT/DISPLAY for user interaction), "unknown".
parameters: extract from LINKAGE SECTION. direction — "in": read-only input, "out": filled by this program, "inout": passed in and modified.
externalCalls: list every CALL statement from the context. "using" is the first USING parameter, or null if none.
dbTables: confirm and enrich the SQL tables listed in the context. Return [] if none.
sections: cover EVERY paragraph listed in the context. Per section:
  - "purpose": one plain-English sentence describing what the paragraph does
  - "rules": array of business rules in "IF ... → ..." format. Cover ALL branches of IF/EVALUATE trees, include status codes and error paths. For simple paragraphs with only MOVE/PERFORM: return []. Maximum 10 rules per paragraph.
`

export const RULES_PROMPT = (complexParagraphs) => `
You are a COBOL expert. For each paragraph below, extract all business rules as plain-English IF-THEN statements.

${complexParagraphs}

Return ONLY valid JSON matching this schema exactly:
{
  "paragraphRules": [
    {
      "name": "PARAGRAPH-NAME",
      "rules": [
        "IF condition AND condition → action with status code",
        "IF condition → action"
      ]
    }
  ]
}

Rules guide:
- Each rule is ONE business decision or action in "IF ... → ..." format
- Cover EVERY branch of IF/EVALUATE trees including WHEN OTHER and ELSE
- Include status codes, error paths, rejection codes, and return values
- For paragraphs with only MOVE/PERFORM and no conditional logic: return "rules": []
- Maximum 10 rules per paragraph
`

export const DIAGRAM_PROMPT = (summary) => `
You are analyzing a COBOL business application.
Based on the following program summary, create a Mermaid flowchart of the business logic flow.

Rules:
- Use flowchart TD syntax
- Maximum 15 nodes
- Show business events and decisions only — no COBOL variable names, no technical internals
- Use plain business language (e.g. "Validate Customer" not "PERFORM VALIDATE-CUST-PARA")
- Return ONLY the Mermaid code — no explanation, no markdown fences

PROGRAM SUMMARY:
${summary}
`
