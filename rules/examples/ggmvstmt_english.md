# Spec: GGMVSTMT — Move Statement Processing (Compile-Time Template)

## 1. Purpose

A **compile-time template frame** that generates COBOL MOVE statements for
copying data between input/output message fields and internal working storage.
Generates an INMSG paragraph (input moves) and OUTMSG paragraph (output moves).
For output, RTN-STS fields are only moved when non-zero (to preserve earlier
warnings/questions).

## 2. C Equivalent

None. In C, field-level copying is done directly via struct assignment or
individual field copies. No code generation needed.

## 3. Frame Parameters (compile-time)

| Parameter | Description |
|---|---|
| GGMVSTMT_PARAGNM | Paragraph name qualifier (field, service, or program) |
| GGMVSTMT_INMSGSRCFLD | Input message source field(s) |
| GGMVSTMT_INMSGDSTFLD | Input message destination field(s) |
| GGMVSTMT_OUTMSGSRCFLD | Output message source field(s) |
| GGMVSTMT_OUTMSGDSTFLD | Output message destination field(s) |
| GGMVSTMT_NOOFINMVSTMT | Number of input message move statements |
| GGMVSTMT_NOOFOUTMVSTMT | Number of output message move statements |

## 4. Generated Paragraphs

### INMSG-PARAGNM

For each input move statement (1 to N):
- `MOVE source-field TO destination-field`.

### OUTMSG-PARAGNM

For each output move statement (1 to N):
- If the source field name ends with `RTN-STS`: only move if value ≠ 0.
- Otherwise: `MOVE source-field TO destination-field`.

## 5. Dependencies

None.
