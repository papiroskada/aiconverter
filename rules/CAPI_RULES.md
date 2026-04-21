# CAPI Module Generation Rules
## Invex ivx4.5 — C API Shared Object Modules

This document defines the rules for generating CAPI `.c` files that compile into
Apache-loaded shared objects (`.so`). Every generated file must follow these rules
exactly. Do not deviate from naming, structure, memory, or SQL patterns described here.

---

## 1. File Header

Every `.c` file must begin with this exact block. Fill in the fields for the specific API.

```c
#define _GNU_SOURCE

/****************************************************************************************\
* Created By:   Gaurav Saxena                                                           *
* Date Created: <MMM DD, YYYY>                                                          *
* Release:      ivx4.5                                                                  *
* eCIM Call #:  <call number>                                                           *
* Description:  <one line description of the API>                                      *
\****************************************************************************************/
```

---

## 2. Required Includes

Always include these four headers in this order. No others are needed unless the API
specifically requires additional standard library headers (e.g. `<ctype.h>`).

```c
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>
#include "InvSQLIO.h"
#include "invex_lib.h"
#include "cJSON.h"
#include "inv_mempool.h"
```

---

## 3. Page Size Constant

Every API that returns a list must define a page size constant at the top of the file,
below the includes. Use a meaningful name based on the API.

```c
#define MYAPI_PAGE_SIZE  10
```

**Deriving the page size from COBOL:** The page size is determined by the OCCURS
count on the output field table in the COBOL linkage section. Look for the output
record's repeating group — e.g., `CPSRO-FLD-TBL OCCURS 10 TIMES` means the page
size is 10. Do not guess or use an arbitrary number.

---

## 4. Private Return Status Global

Every API file must declare this static global immediately after the page size constant.
It holds the final return status set by business logic and is returned by the main function.

```c
static int pvtiReturnStatus = 0;
```

---

## 5. Entry Point Signature

Every API file exports exactly **one public function**. Its name must match the `.so`
filename and the service name passed in the `invera-service-name` HTTP header.

```c
int functionName(
    struct InvexRequestHeader *ivxRqstHdr,
    const cJSON               *jsonParams,
    const cJSON               *jsonInput,
    cJSON                    **jsonOutput
);
```

Rules:
- `ivxRqstHdr` — cast to `(void)ivxRqstHdr;` at the top of the function if unused.
- `jsonParams` — URL query parameters as a cJSON object (key/value strings).
- `jsonInput`  — HTTP request body parsed as cJSON.
- `jsonOutput` — set via `invSetApiResponse()` before returning.
- The function name must be all lowercase to match the `.so` filename.

### Return values

| Value | Meaning                                      |
|-------|----------------------------------------------|
| `0`   | SUCCESS — no errors                          |
| `1`   | ERROR — business error; messages in sctmsg   |
| `2`   | WARNING                                      |
| `3`   | QUESTION                                     |
| `-1`  | Internal/system error (allocation, SQL fail) |

Always reset `pvtiReturnStatus = 0;` as the first line of the entry point function.

---

## 6. Forward Declarations

All private (static) functions must be forward-declared at the top of the file,
before the entry point definition. This keeps the entry point near the top of the file.

```c
static int  pvtParseAPIRequest(...);
static int  pvtBuildQuerySql(...);
static cJSON *pvtBuildResponseRow(...);
static cJSON *pvtReadSomeTable(const char *id);
```

---

## 7. Naming Conventions

| Item                          | Convention                                   | Example                        |
|-------------------------------|----------------------------------------------|--------------------------------|
| Private functions             | `pvt` prefix, camelCase                      | `pvtParseAPIRequest`           |
| Private integer return status | `pvtiReturnStatus`                           | always this exact name         |
| SQL buffer variable           | `sSqlBuf`                                    | `char *sSqlBuf = NULL;`        |
| Error message variable        | `sErrMsg`                                    | `char *sErrMsg = NULL;`        |
| cJSON row variables           | `j` prefix + table abbreviation + `Row`      | `jArrcusRow`, `jArrcrdRow`     |
| cJSON array variable          | `j` prefix + entity name + `Array`           | `jCustomersArray`              |
| cJSON keys variable           | camelCase + `Keys`                           | `arrcusKeys`                   |
| Response count                | `iResponseArrayCount`                        | always this exact name         |
| Has-more-pages flag           | `bHasMore`                                   | `bool bHasMore = false;`       |
| SQL cursor handle             | entity name + `_handle`                      | `arrcus_handle`                |
| Escaped SQL value             | `esc_` + field name                          | `esc_login`, `esc_brh`         |
| Trimmed string                | field name + `Trimmed`                       | `cusNmTrimmed`, `areaTrimmed`  |
| Output string from format fn  | meaningful short name                        | `tel`, `nameWrapped`           |

---

## 8. Memory Management — CRITICAL

This is the most important section. Mixing pool memory and heap memory will cause
crashes or leaks. Follow these rules exactly.

### 8.1 Pool memory — DO NOT free

The following functions allocate from the implicit memory pool. The pool is destroyed
automatically at the end of the request. **Never call `free()` on their return values.**

| Function                        | Returns                                      |
|---------------------------------|----------------------------------------------|
| `invasprintf(&ptr, fmt, ...)`   | allocated string from pool                   |
| `invMemPoolAlloc(size)`         | raw block from pool                          |
| `invTrimAlloc(src)`             | trimmed copy of string from pool             |
| `invSqlEscapeQuote(src)`        | SQL-quoted string from pool (includes `'`)   |
| `invFormatTelephone(...)`       | formatted telephone string from pool         |

```c
/* CORRECT */
char *trimmed = invTrimAlloc(s);
char *escaped = invSqlEscapeQuote(value);
/* do NOT free trimmed or escaped */

/* WRONG — will corrupt the pool */
free(trimmed);
free(escaped);
```

### 8.2 cJSON objects from database reads — MUST cJSON_Delete

These functions return a `cJSON *` that is allocated on the heap. The caller owns it
and **must call `cJSON_Delete()`** when done.

| Function                              | Caller must delete         |
|---------------------------------------|----------------------------|
| `invGetRecordsBySqlNext(handle)`      | `cJSON_Delete(row)`        |
| `invGetRecordsBySqlNextJson(handle)`  | `cJSON_Delete(row)`        |
| `invExecSqlSingleRow(..., &row)`      | `cJSON_Delete(row)`        |
| `invExecSqlSingleRowJson(..., &row)`  | `cJSON_Delete(row)`        |

```c
/* CORRECT */
cJSON *row = NULL;
invExecSqlSingleRowJson(sql, &status, &row);
if (status == 0 && row) {
    /* use row */
    cJSON_Delete(row);
}

/* CORRECT for cursor scan */
while ((row = invGetRecordsBySqlNext(handle)) != NULL) {
    /* use row */
    cJSON_Delete(row);
}
```

### 8.3 cJSON objects you create for keys/results — MUST cJSON_Delete

Any `cJSON *` created with `cJSON_CreateObject()` or `cJSON_CreateArray()` that is
used as a keys or result parameter to `invGetRecordByIndexJson` must be deleted after use.

```c
cJSON *keys = cJSON_CreateObject();
cJSON *row  = cJSON_CreateObject();
cJSON_AddStringToObject(keys, "col", value);
invGetRecordByIndexJson("table_rec", "KEY", keys, row);
cJSON_Delete(keys);   /* always delete keys */
/* use row fields here */
cJSON_Delete(row);    /* delete row when done */
```

### 8.4 cJSON objects added to a response array — do NOT delete

Once a cJSON item is added to an array with `cJSON_AddItemToArray`, the array owns it.
Do not delete the item separately.

```c
cJSON *item = cJSON_CreateObject();
cJSON_AddStringToObject(item, "id", "123");
cJSON_AddItemToArray(jMyArray, item);
/* do NOT cJSON_Delete(item) — the array owns it now */
```

### 8.5 The response array — do NOT delete

The array passed to `invSetApiResponse()` is consumed by that function. Do not delete it.

```c
invSetApiResponse(0, bHasMore, nCusNm, iResponseArrayCount, "items", jMyArray, jsonOutput);
/* do NOT cJSON_Delete(jMyArray) after this call */
```

### 8.6 invUserLog — does not free

`invUserLog(&sErrMsg)` logs the message but does not free it.
Since `sErrMsg` comes from `invasprintf` (pool), do not free it either.

```c
char *sErrMsg = NULL;
invasprintf(&sErrMsg, "Something went wrong: %s", detail);
invUserLog(&sErrMsg);
/* do NOT free sErrMsg */
```

---

## 9. SQL Building Rules

### 9.1 Always use invasprintf to build SQL

Never use `sprintf` or `snprintf` for SQL strings. Always use `invasprintf`.
Check the return value — `-1` means allocation failed, return `-1` from the function.

```c
char *sSqlBuf = NULL;
if (invasprintf(&sSqlBuf,
        "SELECT col1, col2 FROM some_rec WHERE col = %s",
        invSqlEscapeQuote(value)) == -1)
    return -1;
```

### 9.2 Always escape user-supplied values

**Never** interpolate a value directly with `'%s'`. Always call `invSqlEscapeQuote()`
first. The function adds the surrounding single quotes — do not add them in the format string.

```c
/* WRONG — SQL injection risk */
invasprintf(&sSqlBuf, "WHERE col = '%s'", userValue);

/* CORRECT */
char *esc = invSqlEscapeQuote(userValue);
if (!esc) return -1;
invasprintf(&sSqlBuf, "WHERE col = %s", esc);
```

Values that must always be escaped:
- Any value from `gInvexClientInfo` (loginId, companyId, countryCode, languageCode, etc.)
- Any value from `jsonParams` (URL query parameters — user-supplied)
- Any value from `jsonInput` (request body — user-supplied)
- Any value read from the database and re-used in another query

### 9.3 Building SQL incrementally

When building a SQL string with conditional clauses, use a chaining pattern:

```c
char *buf = NULL;
char *tmp = NULL;

if (invasprintf(&buf, "SELECT ... FROM table_rec WHERE cmpy_id = %s",
        invSqlEscapeQuote(gInvexClientInfo.companyId)) == -1)
    return -1;

if (someCondition) {
    char *esc = invSqlEscapeQuote(someValue);
    if (!esc) return -1;
    if (invasprintf(&tmp, "%s AND col = %s", buf, esc) == -1)
        return -1;
    buf = tmp;
}

/* add ORDER BY last */
if (invasprintf(&tmp, "%s ORDER BY col ASC", buf) == -1)
    return -1;
*sql_out = tmp;
```

### 9.4 Company ID filter

Every query against a multi-tenant table must include `cus_cmpy_id` (or equivalent)
as the first WHERE condition, always using the escaped company ID:

```c
invasprintf(&buf, "SELECT ... FROM table_rec WHERE tbl_cmpy_id = %s",
    invSqlEscapeQuote(gInvexClientInfo.companyId));
```

---

## 10. Database Access Patterns

### 10.1 Single row by primary key (invGetRecordByIndexJson)

Use when reading one record by its key. The index name is always `"KEY"` for primary key.

```c
cJSON *keys = cJSON_CreateObject();
cJSON *row  = cJSON_CreateObject();
if (!keys || !row) {
    cJSON_Delete(keys);
    cJSON_Delete(row);
    return NULL;   /* or -1 */
}
cJSON_AddStringToObject(keys, "col_key1", value1);
cJSON_AddStringToObject(keys, "col_key2", value2);

if (!invGetRecordByIndexJson("table_rec", "KEY", keys, row)) {
    cJSON_Delete(keys);
    cJSON_Delete(row);
    return NULL;   /* record not found */
}
cJSON_Delete(keys);
/* use row here */
cJSON_Delete(row);
```

### 10.2 Single row by SQL (invExecSqlSingleRowJson)

Use when the query is more complex than a key lookup.

```c
char *sSqlBuf = NULL;
int status = -1;
cJSON *row = NULL;

if (invasprintf(&sSqlBuf, "SELECT col FROM table_rec WHERE col = %s",
        invSqlEscapeQuote(value)) == -1)
    return -1;

invExecSqlSingleRowJson(sSqlBuf, &status, &row);
if (status == 0 && row) {
    const char *val = invJsonGetValue(row, "col");
    /* use val */
    cJSON_Delete(row);
}
```

### 10.3 Multi-row cursor scan (invGetRecordsBySqlOpen/Next/Close)

Use for list queries with pagination.

```c
uint64_t handle = invGetRecordsBySqlOpen(sSqlBuf);
if (!handle) {
    invasprintf(&sErrMsg, "Query failed");
    invUserLog(&sErrMsg);
    return -1;
}

cJSON *row = NULL;
while ((row = invGetRecordsBySqlNext(handle)) != NULL) {
    if (iResponseArrayCount >= MYAPI_PAGE_SIZE) {
        bHasMore = true;
        cJSON_Delete(row);
        break;
    }
    /* process row */
    cJSON_Delete(row);
}
invGetRecordsBySqlClose(handle);
```

Always call `invGetRecordsBySqlClose(handle)` even if the loop exits early.

### 10.4 Lock record for update (invLockRecordForUpdateJson)

Use before updating a record. Same pattern as `invGetRecordByIndexJson`.

```c
if (!invLockRecordForUpdateJson("table_rec", "KEY", keys, row)) {
    /* record not found or lock failed */
}
```

### 10.5 Write operations

```c
/* Create */
invBeginWork();
if (!invCreateRecord("table_rec", record)) {
    invRollbackWork();
    return 1;
}
invCommitWork();

/* Update */
invBeginWork();
if (!invUpdateRecord("table_rec", "KEY", record)) {
    invRollbackWork();
    return 1;
}
invCommitWork();

/* Delete */
invBeginWork();
if (!invDeleteRecord("table_rec", "KEY", keys)) {
    invRollbackWork();
    return 1;
}
invCommitWork();
```

---

## 11. Reading Field Values

Always use `invJsonGetValue()` to read a field from a cJSON record row.
It handles both string and number fields and returns a `char *`.
The returned pointer is valid as long as the cJSON object exists — do not free it.

```c
const char *s = invJsonGetValue(row, "field_name");
if (s && *s) {
    /* use s */
}
```

To get a trimmed copy: `char *trimmed = invTrimAlloc(s);`
To get an integer value: `int n = s ? atoi(s) : 0;`

---

## 12. Error Logging

### 15.1 Log a free-form message

```c
invasprintf(&sErrMsg, "Descriptive message about what went wrong");
invUserLog(&sErrMsg);
```

### 15.2 Log a message with a sequence number (from scrpei_rec)

```c
invLogMessage('E', 1, "8609", "WNW-CUS-ACCT");
/*             ^typ ^nArgs  ^seqno  ^data element name */
```

- First vararg after `nArgs`: sequence number string (from `scrpei_rec.pei_seq_no`)
- Subsequent varargs: data element names (from `rprdel_rec`) substituted into message placeholders
- `msgType`: `'E'` error, `'W'` warning, `'I'` info

---

## 13. Date Formatting

```c
char sDateBuf[INVEX_MAX_DATE_OUT];
char sRtnSts[9] = "00000000";

invFormatDate(rawDateFromDb, sDateBuf, sizeof(sDateBuf),
              sRtnSts, sizeof(sRtnSts), '1');
/*                                               ^cnYrFlag:
                                                  '0' = 2-digit year
                                                  '1' = 4-digit year
                                                  '2' = no year      */
char *trimmed = invTrimAlloc(sDateBuf);
if (trimmed && trimmed[0])
    cJSON_AddStringToObject(item, "fieldName", trimmed);
```

Input format from PostgreSQL: `YYYY-MM-DD`.
Output format is controlled by `scrlnc_rec` (lnc_shrt_dt_sty, lnc_shrt_dt_sepr)
loaded at session start — no manual style configuration needed in API code.

---

## 14. Telephone Formatting

```c
const char *area = invJsonGetValue(row, "cva_tel_area_cd");
const char *num  = invJsonGetValue(row, "cva_tel_no");
const char *ext  = invJsonGetValue(row, "cva_tel_ext");

char *areaTrimmed = invTrimAlloc(area);
char *numTrimmed  = invTrimAlloc(num);
char *extTrimmed  = invTrimAlloc(ext);

char *tel = invFormatTelephone(
    areaTrimmed ? areaTrimmed : "",
    numTrimmed  ? numTrimmed  : "",
    extTrimmed  ? extTrimmed  : "");

if (tel && tel[0])
    cJSON_AddStringToObject(item, "telephoneNumber", tel);
/* tel, areaTrimmed, numTrimmed, extTrimmed — all pool; do not free */
```

---

## 15. Building the Response

### 18.1 Build a row object

```c
static cJSON *pvtBuildResponseRow(...) {
    cJSON *item = cJSON_CreateObject();
    if (!item) return NULL;

    const char *s;
    char *trimmed;

    s = invJsonGetValue(srcRow, "col_name");
    if (s) {
        trimmed = invTrimAlloc(s);
        if (trimmed) cJSON_AddStringToObject(item, "outputFieldName", trimmed);
    }

    cJSON_AddNumberToObject(item, "numericField", atoi(invJsonGetValue(srcRow, "col") ?: "0"));

    return item;
}
```

### 18.2 Accumulate rows into the array

```c
cJSON *item = pvtBuildResponseRow(...);
if (item) {
    cJSON_AddItemToArray(jMyArray, item);
    iResponseArrayCount++;
}
```

### 18.3 Set the final response

Always call this as the last statement before `return pvtiReturnStatus`:

```c
invSetApiResponse(
    0,                    /* returnStatus: 0=success, 1=error */
    bHasMore ? 1 : 0,    /* hasNext: 1 if more pages available */
    nCusNm,              /* cursor value for next page (last name seen), or NULL */
    iResponseArrayCount, /* total rows in this page */
    "items",             /* JSON array key name in response */
    jMyArray,            /* the array — do NOT delete after this call */
    jsonOutput           /* output parameter from entry point */
);
```

---

## 16. Parsing Request Parameters

URL query parameters arrive in `jsonParams`. Request body fields arrive in `jsonInput`.
Both are read the same way. Always handle NULL jsonParams gracefully.

```c
static int pvtParseAPIRequest(
    const cJSON *jsonParams,
    char **out_branch,
    int  *out_includeInactive
) {
    if (out_branch)          *out_branch          = NULL;
    if (out_includeInactive) *out_includeInactive = 0;

    if (!jsonParams) {
        if (out_branch && invasprintf(out_branch, "") == -1) return -1;
        return 0;
    }

    if (out_branch) {
        cJSON *v = cJSON_GetObjectItem(jsonParams, "sAdminBranch");
        if (cJSON_IsString(v) && v->valuestring)
            invasprintf(out_branch, "%s", v->valuestring);
        else
            invasprintf(out_branch, "");
    }

    if (out_includeInactive) {
        cJSON *v = cJSON_GetObjectItem(jsonParams, "iIncludeInactive");
        if (cJSON_IsString(v) && v->valuestring)
            *out_includeInactive = atoi(v->valuestring);
    }

    return 0;
}
```

---

## 17. Global Session Information

The following fields are available on every request via `gInvexClientInfo`:

| Field               | Content                              |
|---------------------|--------------------------------------|
| `loginId`           | User login ID                        |
| `companyId`         | Company ID                           |
| `countryCode`       | 2-char country code                  |
| `languageCode`      | 2-char language code                 |
| `sessionId`         | Session UUID                         |
| `clientAppId`       | Client application identifier        |
| `hostName`          | Client host name                     |
| `hostAddress`       | Client IP address                    |
| `terminalName`      | Terminal/device name                 |
| `processId`         | Client process ID                    |
| `clientDateTime`    | Client timestamp (17 chars YYYYMMDDHHMISSMMM) |

Pre-loaded cJSON records available on every request (may be NULL — check before use):

| Variable          | Table       | Loaded by               |
|-------------------|-------------|-------------------------|
| `invjScrcscRow`   | scrcsc_rec  | sycapx (always loaded)  |
| `invjScrlncRow`   | scrlnc_rec  | sycapx (always loaded)  |
| `invjScroptRow`   | scropt_rec  | sycapx (always loaded)  |
| `invjMxrusrRow`   | mxrusr_rec  | sycapx (always loaded)  |

---

## 18. Complete Entry Point Template

```c
int myapi(
    struct InvexRequestHeader *ivxRqstHdr,
    const cJSON               *jsonParams,
    const cJSON               *jsonInput,
    cJSON                    **jsonOutput
) {
    char *sParam1       = NULL;
    char *sErrMsg       = NULL;
    char *sSqlBuf       = NULL;
    int   iIncludeX     = 0;
    int   iResponseArrayCount = 0;
    bool  bHasMore      = false;
    cJSON *jItemsArray  = NULL;
    cJSON *jRow         = NULL;
    uint64_t row_handle = 0;

    (void)ivxRqstHdr;

    pvtiReturnStatus = 0;

    /* 1. Parse request parameters */
    if (pvtParseAPIRequest(jsonParams, &sParam1, &iIncludeX) != 0) {
        invasprintf(&sErrMsg, "Invalid API request");
        invUserLog(&sErrMsg);
        return -1;
    }

    /* 2. Build query */
    if (pvtBuildQuerySql(iIncludeX, sParam1, &sSqlBuf) != 0) {
        invasprintf(&sErrMsg, "Failed to build query");
        invUserLog(&sErrMsg);
        return -1;
    }

    /* 3. Open cursor */
    row_handle = invGetRecordsBySqlOpen(sSqlBuf);
    if (!row_handle) {
        invasprintf(&sErrMsg, "Query failed");
        invUserLog(&sErrMsg);
        return -1;
    }

    /* 4. Create response array */
    jItemsArray = cJSON_CreateArray();
    if (!jItemsArray) {
        invGetRecordsBySqlClose(row_handle);
        return -1;
    }

    /* 5. Iterate rows */
    while ((jRow = invGetRecordsBySqlNext(row_handle)) != NULL) {
        if (iResponseArrayCount >= MYAPI_PAGE_SIZE) {
            bHasMore = true;
            cJSON_Delete(jRow);
            break;
        }
        cJSON *item = pvtBuildResponseRow(jRow);
        if (item) {
            cJSON_AddItemToArray(jItemsArray, item);
            iResponseArrayCount++;
        }
        cJSON_Delete(jRow);
    }
    invGetRecordsBySqlClose(row_handle);

    /* 6. Set response */
    invSetApiResponse(pvtiReturnStatus, bHasMore ? 1 : 0,
        NULL, iResponseArrayCount, "items", jItemsArray, jsonOutput);

    return pvtiReturnStatus;
}
```

---

## 19. Things Claude Must Never Do

- Never call `free()` on anything returned by `invasprintf`, `invTrimAlloc`,
  `invSqlEscapeQuote`, or `invFormatTelephone`.
- Never use `sprintf` or `snprintf` to build SQL strings.
- Never interpolate user data into SQL with `'%s'` — always use `invSqlEscapeQuote`.
- Never `cJSON_Delete` an item after adding it to an array (`cJSON_AddItemToArray`).
- Never `cJSON_Delete` the array passed to `invSetApiResponse`.
- Never add surrounding single quotes in a format string when using `invSqlEscapeQuote`
  — the function already includes them.
- Never invent new utility functions — use the ones in `invex_lib.h` and `InvSQLIO.h`.
- Never declare non-static functions other than the single entry point.
- Never use `malloc`/`calloc`/`realloc` in API code — use `invasprintf` or `invMemPoolAlloc`.
- Never use `strncpy` on SQL buffers — use `invasprintf`.
- Never omit `invGetRecordsBySqlClose(handle)` — always call it even if the loop exits early.
- Never add logic that is not in the spec. If the spec does not say to read a
  table, do not read it. If a shared function accepts an optional parameter
  (e.g., `cpfRow`) and the spec does not say to populate it for a given mode,
  pass NULL — do not "helpfully" add a read because the parameter exists. The
  spec is the contract. Follow it literally.

---

## 19b. Code Generation Must Follow the Spec Literally

When generating code from a spec (detailed or impl), the output must contain
**exactly** the logic described in the spec — nothing more, nothing less.

**Do not:**
- Add table reads that the spec does not mention. If a shared output builder
  accepts a parameter for table X, but the mode's algorithm does not include
  "read table X," pass NULL/nil/undefined — do not infer that the read is needed.
- Add validation steps the spec does not describe.
- Add error handling paths the spec does not document.
- "Improve" the logic by adding features, optimizations, or safety checks that
  are not in the spec.
- Assume a function parameter must always be populated. Many shared functions
  accept optional parameters that are NULL for some modes and populated for others.

**Do:**
- Follow the spec's algorithm step by step, in order.
- Pass NULL for parameters the spec says are not used for that mode.
- Include only the table reads the spec explicitly lists for each mode.
- Generate exactly the SQL queries shown in the spec.

**Why:** The spec was traced from the actual COBOL source and verified. Adding
extra logic introduces bugs that don't exist in the original program. For example,
reading CPF in mode 1 (when the COBOL never does) would cause unnecessary database
hits and potentially return incorrect vendor part data.

## 19c. Every Spec Item Must Be Implemented — No Skipping

After generating code from a spec, verify that **every item** in the spec has a
corresponding implementation. Do not assume that implementing one variant of a
pattern covers them all.

**Common patterns where items get skipped:**

1. **Break checks:** The spec lists CHK-PART-BRK, CHK-VEN-PART-BRK, and
   CHK-PART-PPS-BRK as three separate checks used by different modes. Implementing
   only CHK-PART-BRK and skipping the other two is a Rule 19b violation.

2. **Table reads per mode:** The spec lists which tables each mode reads. Mode 1
   reads CLG+CPR+PPD+CPC. Mode 5 reads CPF. Implementing a generic "read all
   tables" for every mode violates Rule 19b. Implementing only mode 1's reads and
   skipping mode 5's CPF also violates it.

3. **Filter variants:** The spec may describe different filter logic for different
   modes (e.g., FLTR-ORH-CONDS checks branch access for mode 1 but skips it for
   mode 2). Each variant must be implemented separately.

4. **Similar-but-different functions:** formatPrdCdCodes (modes 1/2) and
   formatPrdCdCodesA (mode 5) look similar but have different field order.
   Both must be implemented.

**Verification procedure after code generation:**

For each section in the detailed spec:
1. Search the generated code for the corresponding function or logic block.
2. If not found — it was skipped. Implement it.
3. If found — compare the implementation against the spec step by step.
   Every step in the spec must have a corresponding line in the code.

This is not optional. A spec with 15 items must produce code with 15 items.
Not 12. Not 14. Exactly 15.

---

## 20. External Program and Function Calls

When the original COBOL program calls another COBOL program (e.g., `CALL "ORYCCR"`)
or an external function/service, the specification file must **not** reimplement that
program's logic. Instead:

- State **"call [program/function name] with [arguments]"** and list the input/output
  fields.
- If the called program has already been converted to a C function, reference it by its
  C function name.
- If the called program has **not** yet been converted, stub the call with a `/* TODO */`
  comment that returns NULL or a sensible default, and note the dependency in the spec.

**Example in a spec file:**

> Call COBOL program `ORYCCR` with `PRS-MD="A"`, `STS-ACTN="A"`, and `CUS-CUS-ID`.
> Returns: `preBillBalanceAmt`, `creditHoldAmt`, `releasedOrderAmt`, …
> If not yet available as a C function, return NULL (all values default to 0).

This keeps specs focused on the current API's logic and avoids duplicating or
misinterpreting another program's internal behaviour.

---

## 21. Process-Mode-Specific Request Parameters

When a COBOL program has multiple processing modes (PRS-MD) and each mode becomes a
separate API endpoint, only include the request parameters that are **actually used**
by that specific mode's logic.

- After writing the spec, trace the COBOL code for that mode to determine which input
  fields (`CPSRI-*`, `XXXRI-*`, etc.) are referenced in that mode's PERFORM paragraphs
  and any shared paragraphs it calls.
- **Do not** carry over input fields from other modes just because they exist in the
  shared COBOL linkage area.
- Each endpoint's `pvtParseAPIRequest` should only parse the parameters relevant to
  that endpoint.

**Example:** If a COBOL program has 5 modes sharing 40+ input fields, but Mode 4 only
uses `PART-STS`, `PART-CTL-NO`, and `PART-LN-NO`, then the Mode 4 endpoint spec and
C code should only have those 3 request parameters — not all 40.

---

## 22. COBOL Analysis: Start from BUSINESS-LOGIC, Trace Everything

When converting a COBOL program, **always start from the top-level entry point**
(typically `BUSINESS-LOGIC` or the main PERFORM sequence) and trace the complete
execution path. Do not jump directly to mode-specific paragraphs.

### 22a. Pre-dispatch shared logic

Before the EVALUATE/mode dispatch, COBOL programs commonly perform:

- **VALIDATE-LINKAGE** — input validation (process mode, required fields)
- **INITIAL-SETUP** — output initialization, search parameter setup
- **VALIDATE-ACCESS** — access checks. **Do not assume** what this paragraph does
  from the name alone — each COBOL program defines its own VALIDATE-ACCESS with
  different logic. Trace the actual code. Only map to `arcusacsValidateAccess()`
  when the COBOL calls the `MXBBAV-CHK-BRH-ACS` frame. If the paragraph does
  something else (e.g., reads different tables, checks different conditions),
  implement what the code actually does, not what the paragraph name suggests.
- **GET-OPT-INFO / GET-CSC-INFO** — loading system configuration

All of this shared logic must appear in every endpoint's spec. If VALIDATE-ACCESS
checks branch access before any mode runs, every endpoint must include that check.

**CRITICAL: VALIDATE-LINKAGE must not be skipped.** Every COBOL program starts at
BUSINESS-LOGIC, which almost always calls VALIDATE-LINKAGE as its first step.
VALIDATE-LINKAGE typically does MORE than just validate PRS-MD — it often:

1. **Validates PRS-MD** — error 1500 if invalid
2. **Normalizes input dimensions** — calls inline frames like INCTUBRNG-PRS-TUBE-VARS
   (derives missing tube dimension from two provided: OD+Wall→ID, ID+OD→Wall,
   ID+Wall→OD) and INP-3-PRS-TUBE-VARS (normalizes pagination cursor dimensions)
3. **Pre-reads required records** — some modes read a primary record in
   VALIDATE-LINKAGE (e.g., cpycps mode 4 reads ORH, orybor mode 2 reads ORH)
4. **Validates required fields** — customer ID non-blank checks, etc.

When tracing BUSINESS-LOGIC, read VALIDATE-LINKAGE line by line. Do not skip it
or summarize it as "validates PRS-MD". Trace every PERFORM within it. The tube
normalization step (INCTUBRNG) is especially important for programs that accept
OCTG dimension ranges — without it, queries will use the raw input dimensions
instead of the geometrically derived ones.

### 22b. Output builder paragraphs — trace ALL PERFORMs

When analyzing the output-building paragraph (e.g., `FILL-CPS-LNK`), do not only
capture `MOVE` statements. Also trace every `PERFORM` within it:

- **FORMAT-RDM-DIM / INCRDM-FORMAT-RDM-DIMS** — formats random dimension values into
  display strings. These produce output fields like `FMT-RDM-DIM-1`, `FMT-RDM-DIM-2`.
- **FMT-PRD-DESC / INYPIF** — calls external program to format product description
  lines. These produce output fields like `FMT-LN-1`, `FMT-LN-2`.
- Any other PERFORM that computes or formats output data.

If the PERFORM calls an external program (CALL statement), follow rule 20 — document
it as "call program X with arguments" and stub if not yet converted. If it is inline
logic, include it in the spec.

### 22c. Finding the correct table/record names — MANDATORY SYTABLEW verification

**This is the single most common source of errors in COBOL-to-C conversion.**
COBOL field prefixes (e.g., `IPD-`, `PDS-`, `SCA-`, `BRN-`, `NAD-`) have **no
reliable relationship** to the actual PostgreSQL table name. The table name is
defined ONLY in the SYTABLEW declaration. Every table name in a spec or C file
MUST be verified against SYTABLEW — no exceptions.

**Procedure (mandatory for every table reference):**

1. Search the COBOL file for `*-TABNAM` to get the complete list of all table
   declarations. Example: `grep "-TABNAM" programname.cbl`
2. For each table, read the `VALUE` clause — that 6-character string is the
   actual table name. Example: `RVTRES-TABNAM VALUE "rvtres"` → table is `rvtres`
3. The C record name is `{tabnam}_rec` (e.g., `rvtres_rec`)
4. **NEVER derive table names from:**
   - COBOL field prefixes (`IPD-FRM` does NOT mean the table is `ipd_rec` —
     it is `tctipd_rec`)
   - COBOL record prefixes (`RVTRES-*` does NOT mean the table is `rvtres_rec`
     wait, actually it does in this case — but `INTPRD-*` gives `intprd_rec`,
     not `prd_rec`)
   - Guessing based on similar names from other programs
   - The COBOL working-storage variable name
5. **Before writing any spec or code**, run `grep "-TABNAM" programname.cbl`
   and build a complete mapping of COBOL prefix → actual table name. Include
   this mapping in the detailed spec's tables reference section.

**Why this matters:** The COBOL naming convention is inconsistent by design.
Different subsystems use different prefix schemes:

| COBOL Prefix | Field Prefix | Actual TABNAM | You might guess | WRONG |
|-------------|-------------|---------------|-----------------|-------|
| RVTRES | RES- | `rvtres` | `invres` | YES |
| TCTIPD | IPD- | `tctipd` | `ipdipc` | YES |
| TCTPDS | PDS- | `tctpds` | `ipdpds` | YES |
| TCTNAD | NAD- | `tctnad` | `ortnad` | YES |
| TCTTSA | TSA- | `tcttsa` | `sctsoa` | YES |
| INRPRM | PRM- | `inrprm` | `ipdprm` | YES |
| INRMAT | MAT- | `inrmat` | `ipdmat` | YES |
| INTPRD | PRD- | `intprd` | `ipdprd` | YES |
| ORRSCA | SCA- | `orrsca` | `ipdsca` | YES |
| PETBRN | BRN- | `petbrn` | `orxbrn` | YES |
| ORTXRH | XRH- | `ortxrh` | `tctxrh` | YES |
| SCRUMR | UMR- | `scrumr` | `scxumr` | YES |
| IPTJSO | JSO- | `iptjso` | `cpsjso` | YES |
| TRTSRD | SRD- | `trtsrd` | `tctsrd` | YES |

Every single "guess" above is wrong. The ONLY reliable source is the SYTABLEW
`*-TABNAM VALUE` declaration.

### 22d. Post-read conditional logic — trace the CALLER, not just the READ

When a table read paragraph (e.g., `READ-CVA`) is PERFORMed, do not stop at the read
itself. Always read the **calling paragraph** (e.g., `GET-SOLD-TO`) to see what
happens after the read returns:

- **Conditional error checks** — the caller may check additional conditions beyond
  `TABLE-STATUS`. For example, a missing address record may only be an error if the
  customer account type is not in a set of allowed values (`"M"`, `"P"`, `"L"`, `"J"`).
- **Fallback reads** — the caller may retry with different key values (e.g., try
  address type `"O"`, then fall back to `"L"`).
- **Post-read field derivation** — the caller may compute or transform fields after
  the read succeeds.

If you only capture the READ paragraph without reading the caller, you will miss
validation logic, fallback patterns, and error conditions that depend on context.

### 22e. Exact string constants — verify against COBOL MOVE statements

**Never infer** string constant values from naming conventions or patterns seen in other
programs. Always read the exact `MOVE` statement in the COBOL source to get the value.

Common mistake: assuming a data element name has a prefix like `"ALL-"` when the COBOL
actually uses the bare name:

```
MOVE "INV-FREQ" TO CDS-DATA-EL-NM     ← correct: "INV-FREQ"
                                        ← wrong:  "ALL-INV-FREQ"
```

For every string constant in the spec (error messages, data element names, status codes,
table key values), find and quote the exact COBOL `MOVE` statement as the source of truth.

### 22f. Second-structure pattern (e.g., ARRCUS2, CRD2, ORTORH2)

#### Why COBOL uses multiple record buffers

In COBOL, table I/O passes a **record structure** (the RECORD) to the I/O function.
The same structure is used for all operations: READ, READ-NEXT, START, UPDATE,
INSERT, DELETE. This creates a problem: if a program is iterating through records
using READ-NEXT (which fills the RECORD with the current row), and also needs to
UPDATE or INSERT into the same table, modifying the RECORD for the update would
**destroy the cursor position** — the next READ-NEXT would start from the wrong
place.

The solution is to declare a **second copy** of the same record structure (e.g.,
`ORTORH2` for table `ortorh`). The first copy is used for iteration (READ-NEXT),
and the second copy is used for updates/inserts/single reads without disturbing
the iteration.

#### How to identify them

When you see a name like `ARRCUS2`, `CRD2`, `CLG2`, `ORTORH2`, or any
`<PREFIX>2` / `<PREFIX>3`:

1. **It is NOT a different table.** It is a second working-storage buffer for the
   same table. Verify by checking `*-TABNAM VALUE` in the SYTABLEW declaration —
   it will match the original (e.g., `ARRCUS2-TABNAM VALUE "arrcus"`,
   `ORTORH2-TABNAM VALUE "ortorh"`).
2. **In C, use the same `_rec` name** (e.g., `arrcus_rec`, not `arrcus2_rec`,
   `ortorh_rec`, not `ortorh2_rec`). Since C reads return a `cJSON*`, each call
   produces a new JSON object — the cursor-position problem does not exist in C.
   There is no need for a separate record name.
3. **The key may differ.** The whole point of a second buffer is to access the
   same table with a different key or for a different purpose. Trace the calling
   paragraph to see which field is MOVEd into the key before the read:
   - `MOVE CRD-CUS-ID TO CUS2-CUS-ID` → read arrcus by credit record's customer ID
   - `MOVE CRD-CR-CTL-CUS-ID TO CRD2-CUS-ID` → read arrcrd by credit control customer
   - `MOVE ORH-ORD-NO TO ORH2-ORD-NO` → read same ortorh by order number for update
4. **Fields from the second buffer are distinct.** `CUS2-CUS-CAT` maps to
   `cus_cus_cat` from the second read's JSON, not from the first CUS read. Keep
   the cJSON pointers separate (e.g., `jArrcus` vs `jArrcus2`).
5. **Common use cases for second buffers:**
   - **Loop + update:** First buffer iterates (READ-NEXT), second buffer reads
     and updates individual records within the loop.
   - **Loop + lookup:** First buffer iterates one key, second buffer reads the
     same table by a different key for cross-reference.
   - **Nested reads:** Outer loop reads records, inner logic needs to read the
     same table with a different key.

#### In C — no second buffer needed

Since C uses separate `cJSON*` pointers for each read result, and cursor
iteration uses `invGetRecordsBySqlNext()` which maintains its own internal state
independent of any record buffer, the COBOL second-buffer pattern has **no direct
equivalent** in C. Simply use different `cJSON*` variable names:

```c
/* COBOL: ORH-RECORD for cursor, ORH2-RECORD for update lookup */
/* C: just two different cJSON pointers, same table name */
cJSON *jOrhCursor = invGetRecordsBySqlNext(handle);  /* iteration */
cJSON *jOrhUpdate = pvtReadOrtorh(sOrdNo);            /* separate read */
```

### 22g. Trace key value sources for every read

Before writing a `pvtRead*` function, trace WHERE the key comes from in the COBOL source:

- Search for the `MOVE ... TO <PREFIX>-<KEY>` statement that precedes the PERFORM of the
  read paragraph.
- The source of the MOVE determines the C function's parameter:
  - `MOVE CUS-ID TO ...` → use a field already available (from a prior read result)
  - `MOVE LNK-CUS-ID TO ...` → use the request parameter
  - `MOVE CRD-CUS-ID TO ...` → use a value extracted from a different read's result

**Never assume** the key is always the request parameter. Second-structure reads and
chained reads frequently use a value from a prior read as their key.

### 22g-ii. COBOL linkage naming conventions

COBOL linkage field names follow a structured convention. Understanding it prevents
incorrect renaming during C conversion.

There are **two patterns** depending on whether the program name has `z` as its
3rd character:

**Pattern 1 — Standard programs** (3rd char is NOT `z`):
`{PGM}R{DIR}-{FIELD-NAME}`

| Part | Meaning | Example |
|------|---------|---------|
| `{PGM}` | Last 3 characters of the program name | `CPS` (from cpycps), `PIF` (from inypif), `OSB` (from oryosb), `BOR` (from orybor) |
| `R` | Always `R` — indicates this is a service Record (linkage) | `R` |
| `{DIR}` | Direction: `I` = Input, `O` = Output | `I` or `O` |
| `{FIELD}` | The actual field name | `PART-CUS-ID`, `FRM`, `RTN-STS` |

**Pattern 2 — Programs with `z` as 3rd character** (e.g., orzchg, orzrdo, orzipr):
`{PGM}U{DIR}-{FIELD-NAME}`

| Part | Meaning | Example |
|------|---------|---------|
| `{PGM}` | First 3 characters of the program name | `CHG` (from orzchg), `RDO` (from orzrdo), `IPR` (from orzipr) |
| `U` | Always `U` — indicates this is a User service linkage | `U` |
| `{DIR}` | Direction: `I` = Input, `O` = Output | `I` or `O` |
| `{FIELD}` | The actual field name | `REF-PFX`, `RTN-STS` |

**How to determine the pattern:** Check the 3rd character of the program name.
If it is `z`, use Pattern 2 (UI/UO). Otherwise, use Pattern 1 (RI/RO).

**Examples — Pattern 1 (standard):**
- `CPSRI-PART-CUS-ID` → program `cpycps`, input, field `PART-CUS-ID`
- `CPSRO-FMT-LN-1` → program `cpycps`, output, field `FMT-LN-1`
- `PIFRI-FRM` → program `inypif`, input, field `FRM`
- `PIFRO-FMT-LN-1` → program `inypif`, output, field `FMT-LN-1`
- `OSBRI-PRS-MD` → program `oryosb`, input, field `PRS-MD`
- `BORRI-SLP` → program `orybor`, input, field `SLP`

**Examples — Pattern 2 (z-programs):**
- `CHGUI-REF-PFX` → program `orzchg`, input, field `REF-PFX`
- `CHGUO-RTN-STS` → program `orzchg`, output, field `RTN-STS`
- `RDOUI-ORD-NO` → program `orzrdo`, input, field `ORD-NO`
- `RDOUO-RTN-STS` → program `orzrdo`, output, field `RTN-STS`
- `IPRUI-PRS-MD` → program `orzipr`, input, field `PRS-MD`

**Rules for C parameter naming:**
1. **Preserve the full COBOL field name** when converting to a C parameter.
   `CPSRI-PART-CUS-ID` becomes `sPartCusId`, not `sCusId`. Dropping `PART-`
   loses information — the field is specifically the *part's* customer ID, which
   may differ from other customer ID fields in the same program.
2. **Convert hyphens to camelCase.** `PART-CUS-ID` → `partCusId`,
   `REF-PFX` → `refPfx`, `FMT-LN-1` → `fmtLn1`.
3. **Strip only the linkage prefix** (`CPSRI-`, `CPSRO-`, `CHGUI-`, etc.).
   Everything after the prefix is the logical field name and must be preserved.
4. **The output field table OCCURS count** determines the page size (Rule 3).
   Look for `{PGM}RO-FLD-TBL OCCURS {n} TIMES` — the `{n}` is the page size.

---

## 23. Netron Frame Conversion

Netron frames are self-contained logic blocks that appear as inline COPY members in
COBOL programs. Frame source files always end in `.f` (e.g., `INCRDM.F`, `ARCUSACS.F`).

### 23a. Frame structure

Each frame has:
- **Input work area** — fields the caller MOVEs into before PERFORMing the frame
- **Logic paragraphs** — the frame's processing (reads, computations, formatting)
- **Output work area** — fields the caller reads after the frame returns

### 23b. C function mapping — frames vs inline frames

There are two types of frames, and they map differently to C:

**Frames** (specs in `frames/` directory):
- Each frame becomes a **separate `.c` file** (e.g., `incrdm.c`, `mxbgudbw.c`)
- Compiled independently, called by programs via `extern` declarations
- The C function file name matches the frame name in lowercase

**Inline frames** (specs in `frames/inlineframes/` directory):
- Each inline frame becomes a **static function inside the calling program's `.c` file**
- Not a separate `.c` file — the logic lives within the program that uses it
- In COBOL, the Netron generator injects inline frame code directly into the `.cbl`
- In C, the equivalent is a `static` helper function in the program's `.c` file

**Both types follow the same conversion rules:**
1. Frame input work area fields become **function parameters**
2. Frame output work area fields become **return values** or **output pointers**
3. Follow all CAPI_RULES.md patterns (pool memory, cJSON for DB reads, etc.)

### 23c. External service calls become direct C function calls

When a Netron frame PERFORMs a `SYCALPGM-*` paragraph to call an external service
(e.g., `SYCALPGM-INYPIF` calls the INYPIF program), the C equivalent calls the target
program's C function directly. No service call infrastructure (TPCALL, sub-program CALL)
is needed — just a direct C function call.

If the target program has not yet been converted to C, it must be converted first, or
the calling frame must be deferred until it is available.

### 23d. Always call the frame function — never reimplement

When a COBOL program PERFORMs a frame paragraph, the C code must **call the
frame's function** — not reimplement the frame's logic.

**For frames** (`frames/` directory): call the separate `.c` function via `extern`.
**For inline frames** (`frames/inlineframes/`): call the `static` function that
was implemented within the same program's `.c` file.

In either case, **never reimplement** the frame's logic at the call site. Frame
functions often contain more logic than is apparent from a quick read:
- `MXBGUDBW-GET-USR-DFLT` reads the user record but also handles cross-company
  defaults via SCYVCP — a caller that only reads `usr_usr_brh` would miss the
  cross-company path.
- `MXBBAV-CHK-BRH-ACS` checks branch access with fallbacks and UBA record lookups
  — a caller that only does a simple branch comparison would miss edge cases.
- `SCCGTALD` does alternate language description lookup with specific key structure
  and fallback — a caller that writes its own SQL would miss the key pattern.

**Rules:**
1. **Frames** (`frames/` directory) with runtime logic become **separate `.c` files**.
   Callers call them via `extern` declarations. The frame's logic lives in one
   place and is shared across all programs that use it.
2. **Inline frames** (`frames/inlineframes/` directory) with runtime logic become
   **`static` functions inside the calling program's `.c` file**. The logic is
   implemented once within the program, not duplicated at each call site.
3. **Data-definition-only frames** (frames that only generate COBOL working-storage
   field definitions with no PERFORM paragraphs, e.g., INCSIZE in TBL mode,
   INCGAUGE in TBL mode, INCBEFSH in DEF mode) do not need a C function — they
   define data structures, not logic. In C, the equivalent is struct fields or
   local variables.
4. **If the frame's C function does not exist yet**, add an `extern` declaration
   (for frames) or a stub `static` function (for inline frames) and a comment
   noting the dependency. Do not substitute a simplified reimplementation — the
   frame may have edge cases, error handling, or fallback logic that the
   simplified version would miss.
5. **The frame spec (`*_english.md`) is the contract.** The C function must match
   the spec's signature and behavior. Callers rely on the spec, not on reading the
   frame's internal implementation.

**How to tell if a frame has runtime logic:**
- Check the frame's `_english.md` spec. If it has a "Function Signature" section
  with a C function prototype → it has runtime logic → call the function.
- If the spec says "No code generation needed" or "data definition only" → it is
  a data-definition frame → no function needed.
- If no spec exists yet, check the `.f` file for PERFORM paragraphs. If there are
  PERFORMs → runtime logic → needs a C function.

**Example — wrong vs right:**
```c
/* WRONG — reimplements only part of the frame logic, misses cross-company path */
static char *pvtGetUserDefaultBranch(void) {
    cJSON *row = pvtReadMxrusr(loginId);
    return invTrimAlloc(invJsonGetValue(row, "usr_usr_brh"));
}

/* RIGHT — calls the frame function which handles all paths */
extern int mxbgudbwGetUserDefault(const char *sLgnId,
    char **out_dfltBrh, char **out_dfltWhs);

static char *pvtGetUserDefaultBranch(void) {
    char *sBrh = NULL;
    mxbgudbwGetUserDefault(gInvexClientInfo.loginId, &sBrh, NULL);
    return sBrh;
}
```

---

### 23e. Checklist for COBOL analysis

Before writing any spec, verify you have traced:

1. ☐ The full path from entry point through BUSINESS-LOGIC to mode dispatch
2. ☐ All shared paragraphs executed before the EVALUATE (validation, access, setup)
3. ☐ The mode-specific paragraph and every paragraph it PERFORMs (transitively)
4. ☐ The output-building paragraph — every MOVE **and** every PERFORM within it
5. ☐ All CALL statements to external programs (apply rule 20)
6. ☐ Post-processing paragraphs (MAIN-LOGIC-END, TERMINATION-RTN) for any cleanup
7. ☐ All table/record names verified via SYTABLEW declarations (apply rule 22c)
8. ☐ All post-read conditional logic in calling paragraphs traced (apply rule 22d)
9. ☐ All string constants verified against exact COBOL MOVE statements (apply rule 22e)
10. ☐ All second-structure names (PREFIX2/3) confirmed as same-table buffers (apply rule 22f)
11. ☐ All read key sources traced to their MOVE statements (apply rule 22g)
12. ☐ All paragraph names verified by reading their actual code (apply rule 22h)
13. ☐ All frame references verified against the `.s` file (apply rule 22h)

### 22h. Paragraph names are labels, not contracts

COBOL paragraph names are chosen by the original programmer and **do not guarantee**
what the code inside them does. Different programs frequently reuse the same paragraph
names (e.g., `VALIDATE-ACCESS`, `INITIAL-SETUP`, `GET-OPT-INFO`, `FORMAT-OUTPUT`)
with completely different logic.

**Rules:**
1. **Never assume** a paragraph's behavior from its name. Always read the full
   paragraph body and trace every PERFORM within it.
2. **Never map** a paragraph to a known C function based on name alone. For example,
   seeing `VALIDATE-ACCESS` does not mean it calls `arcusacsValidateAccess()` — it
   only does if the code inside calls the `ARCUSACS` program via CALL. The paragraph
   might use `MXBBAV-CHK-BRH-ACS` inline (a different pattern), or do something
   entirely unrelated to branch access.
3. **Verify frames via the `.s` file.** Each COBOL program has a corresponding `.s`
   file (e.g., `cpycps.s`) that lists which Netron frames are actually included.
   Before assuming a C frame function is available, search the `.s` file to confirm
   the frame is used. If a frame name (e.g., `ARCUSACS`) does not appear in the
   `.s` file, the program does NOT use that frame and the corresponding C function
   must NOT be called.
4. **Never copy** the implementation from one COBOL program's paragraph to another
   program's spec just because the paragraph names match. Each program must be
   traced independently.
5. **Document what the code does**, not what the name suggests. If a paragraph named
   `VALIDATE-ACCESS` reads SHP records and calls MXBBAV directly, write that in the
   spec — do not substitute `arcusacsValidateAccess()`. Include the COBOL line
   numbers where the logic was traced.

This rule applies to **all** paragraph names, not just access validation. Common
names that vary across programs include: `INITIAL-SETUP`, `VALIDATE-LINKAGE`,
`GET-OPT-INFO`, `FORMAT-OUTPUT`, `FILL-LNK`, `TERMINATION-RTN`, `MAIN-LOGIC-END`.

**Example — correct approach:**
```
VALIDATE-ACCESS (cpycps.cbl lines 10354-10392):
  - Reads arrshp_rec by KEY2 for customer ID
  - Iterates unique SHP-ADMIN-BRH values
  - Calls MXBBAV-CHK-BRH-ACS inline (line 10379) with access "F"
  - C equivalent: invValidateBranchAccess() in a loop (NOT arcusacsValidateAccess)
  - Verified: ARCUSACS not in cpycps.s
```

---

### 22i. Two spec files per program — summary and detailed

**Required inputs:** `programname.cbl` and `programname.s`. Both must be
present before creating any spec or code.

**Output:** Every COBOL program conversion produces **two** spec files, then code:

#### Step 1 — Summary spec (`programname_english.md`)

Created first. Uses the `.cbl` and `.s` to produce a high-level overview:

- Program purpose, service name, transactional flag
- API endpoint table — one row per process mode (Rule 27), with function
  name, HTTP path, description
- Shared pre-dispatch logic overview (VALIDATE-LINKAGE, INITIAL-SETUP,
  VALIDATE-ACCESS — traced from actual code, not assumed from names per 22h)
- Per-endpoint: request parameters (only fields used by that mode — Rule 21)
  and logic summary (2–5 bullet points)
- Shared output structure — complete response field table with JSON key,
  source table/field, type
- Shared helper logic — one paragraph per helper describing what it does
- Tables reference — all tables with record name and key fields
- Dependencies — all external functions/frames (verified against `.s` file)
- Exact string constants — all mode codes, status values, error numbers

#### Step 2 — Detailed spec (`programname_detailed_english.md`)

Created second by tracing the COBOL line by line. Must be **self-sufficient** —
code in any language (C, Node.js, Python) can be generated from this file
alone, without reading the `.cbl` or `.s` file.

**Mandatory sections** (must be present in **every** detailed spec, regardless
of whether the program has multiple modes or is single-purpose):

1. **Complete input structure** — A table listing EVERY input field with:
   COBOL field name, JSON parameter name, type, default value, and description.
   This applies to ALL programs — multi-mode and single-purpose alike. For
   single-purpose programs with no user input (e.g., batch utilities), document
   the client info fields and any configuration inputs.

2. **Complete output field summary** — A single table listing EVERY output field
   with: JSON key name, source table.column, type, and any transformation logic
   (e.g., gauge/wall routing via PRM dim_seg). This is the buildResponseRow /
   FILL-LNK equivalent. Every field the response returns must be documented here.
   For single-purpose programs that only return a status code, document the
   status field and any other output fields.

4. **Per-mode input parameters** (multi-mode programs only) — For each processing
   mode, list the EXACT input parameters that mode uses (Rule 21). This is a
   table with: parameter name, type, required/optional, and description. Do not
   list parameters from other modes — each mode section has its own input
   parameter table. Single-purpose programs skip this (their input structure
   in item 1 already covers the single execution path).

5. **Input parameters by mode matrix** (multi-mode programs only) — A
   cross-reference matrix showing which input fields each mode uses (Y/N per
   cell). Single-purpose programs skip this.

**Required detail for every function/algorithm:**

- **SQL queries:** Exact SELECT columns, FROM table, every WHERE clause
  (always vs conditional), exact ORDER BY. Show the full query template.
- **Table reads:** Exact record name, exact key field names, exact source
  of each key value.
- **Scan loops:** Exact row processing steps, exact skip/continue conditions,
  exact cleanup on each path, pagination check and cursor value.
- **Field mappings:** Every JSON output key → exact source field, type,
  default value, conditional logic (e.g., gauge/wall routing via PRM dim_seg).
- **String operations:** Exact buffer sizes, exact character-by-character
  operations, exact separator characters and placement rules.
- **Compress calls:** Exact parameters (string, length, startPos, compressChar,
  seqSize, padChar) for every call site.
- **Conditional branches:** Exact field names, exact comparison values, exact
  branch paths.
- **Error handling:** Exact error sequence numbers, exact data element names,
  exact return status values.
- **Frame calls:** Exact input field population, exact output field extraction,
  verified against `.s` file.
- **Access validation:** Exact query, exact loop logic, exact MXBBAV/access
  function call — traced from actual COBOL, not assumed from paragraph name.
- **Date/time conversion:** Exact timezone lookup, exact offset application.

#### Step 3 — Code generation (C)

Generate C code from the detailed spec (not from the COBOL):
- One `.c` + one `.h` per program (Rule 27)
- All process modes as public entry points in the same file
- Shared helpers as static functions

#### Step 4 — Implementation spec (`programname_impl.md`)

Created AFTER the C code is working. Derived from the working C code, NOT
from the COBOL. This is a **language-neutral implementation blueprint** that
can generate working code in ANY language (C, Node.js, Python, etc.) without
reading the C source, COBOL, or any other spec file.

The impl spec contains:
- **Service overview** — endpoints, page size, database (PostgreSQL)
- **External dependencies** — every external function/service with signature
  and behavior description (language-neutral, no `extern` or `require`)
- **Database tables** — table names, key fields, and ONLY the fields actually
  used (not the entire table schema)
- **Input validation** — tube range normalization formulas, etc.
- **Shared functions as pseudocode** — complete algorithms written in
  structured English or pseudocode, not in any programming language
- **Complete field mapping** — every JSON output field with source table,
  column, type, and transformation logic
- **Exact SQL queries** — these are PostgreSQL and identical in any language
- **Mode algorithms as pseudocode** — complete scan/filter/pagination logic
- **Error handling** — error codes, when raised, how returned
- **Response format** — exact JSON structure

**What the impl spec is NOT:**
- Not a COBOL trace (no COBOL line numbers or paragraph names)
- Not C-specific (no cJSON, invasprintf, pool memory, or cJSON_Delete)
- Not an API doc (not about HTTP endpoints or REST conventions)

**Why this file exists:** The detailed spec (`_detailed_english.md`) is tied
to COBOL tracing and C-oriented. The impl spec is truly language-neutral and
proven to generate working code in both C and Node.js from the same source.

**When to create it:** After the C code is implemented and verified. The
impl spec is derived from the working code, capturing the exact algorithms
as they were implemented (which may differ slightly from the COBOL trace
due to SQL optimizations, etc.).

#### Keeping specs in sync

All three specs must stay consistent:
- **Summary spec** — source of truth for planning and review
- **Detailed spec** — source of truth for C code generation
- **Impl spec** — source of truth for multi-language code generation

If any spec changes, update the others to match. The impl spec takes
precedence for code generation since it reflects the actual working
implementation.

**The `.cbl` and `.s` files are inputs to creating the summary and detailed
specs.** The impl spec is derived from the working C code. Once all three
specs exist, neither the `.cbl`, `.s`, nor `.c` files are needed for code
generation in any target language.

---

## 24. Spec Files Are Language-Neutral

Spec files (`*_english.md`) describe **business logic only**. They must not contain
language-specific implementation details such as memory management, pointer cleanup,
or object disposal.

**Do not write:**
- "Delete the CUS row" (sounds like a database DELETE; is actually C memory cleanup)
- "Free the JSON object"
- "Call cJSON_Delete on the result"
- "Set the pointer to NULL"

**Instead:** simply describe the logical flow (e.g., "Return 0 (denied)"). The
implementation language's rules handle resource cleanup:
- In C, `CAPI_RULES.md` governs `cJSON_Delete`, pool memory, etc.
- In Node.js, garbage collection handles object lifetime automatically.

Specs should be usable to generate code in **any** target language without modification.

---

## 25. Existence Checks: Use SELECT … LIMIT 1, Not COUNT(*)

`SELECT count(*)` is slow in PostgreSQL. When the only question is "does at least one
row exist?", use a `SELECT ... LIMIT 1` query instead and check whether a row was returned.

**Do:**
```sql
SELECT 1 FROM scrslp_rec
WHERE slp_cmpy_id = '{companyId}' AND slp_slp IN ('{isSlp}', '{osSlp}', '{tknSlp}')
  AND slp_lgn_id = '{sLgnId}'
LIMIT 1
```
Then check: row returned → exists, no row → does not exist.

**Do not:**
```sql
SELECT count(*) AS cnt FROM scrslp_rec
WHERE slp_cmpy_id = '{companyId}' AND slp_slp IN ('{isSlp}', '{osSlp}', '{tknSlp}')
  AND slp_lgn_id = '{sLgnId}'
```

Use `count(*)` **only** when you genuinely need the number of matching rows.

---

## 25b. COBOL Patterns — Preserve vs Optimize

When converting COBOL to C, some patterns exist because of COBOL I/O limitations
(START/READ-NEXT only, no SQL JOINs) and can be simplified in C with SQL. Other
patterns exist for **real business reasons** and must be preserved. Before optimizing
away a COBOL pattern, understand WHY it exists.

### Patterns to PRESERVE (they serve a business purpose):

**Raw/work tables (RAWT, ORXnn, temp tables):**
COBOL programs sometimes build temporary tables (e.g., `orxoh1_rec` in orybor)
to materialize a result set. This is NOT just a workaround — it serves real purposes:
- **Large result sets** (2000+ rows) need to persist across pages
- **User re-sorting** — the user can re-sort by different column combinations
  without re-executing the expensive base query. The raw table is read by
  different keys for each sort order.
- **The raw table is a server-side materialized result set.** Do not replace it
  with a direct SQL query unless you can guarantee re-sort performance is acceptable.

When a raw table pattern is found:
1. Preserve the raw table build (INSERT...SELECT) — the SQL is already optimized
2. Preserve the raw table scan for subsequent pages and re-sorts
3. Preserve the cleanup (SCCURT/DELETE) when the browse session ends
4. The sequence number (SCZSEQ) identifies the user's session — preserve it

**Nested cursor patterns (ORH→ORL, parent→child):**
The COBOL scans a parent table, then for each parent scans child records. In C
with SQL, this CAN sometimes be replaced with a JOIN — but complex JOINs cause
worse performance problems than nested scans. Apply this decision rule:

**Use a JOIN when:**
- The join is on indexed/key columns (primary key or foreign key with an index)
- The filter conditions are simple field comparisons (no per-row function calls,
  no reads to other tables, no business logic beyond equality/range checks)
- The result set is bounded (pagination limits apply)

**Keep the nested scan when:**
- The parent or child filter requires per-row reads to other tables (e.g.,
  FLTR-ORH-CONDS calls MXBBAV/MXBVOWOR per row — these read mxruba, scrslp)
- The child filter requires per-row lookups (e.g., FLTR-ORL-CONDS reads
  tcttsa, tctwfr per ORL to check closed/pending status)
- The child processing calls external programs (e.g., ORYOSD per ORL)
- The JOIN would require multiple LEFT JOINs with complex CASE/COALESCE logic
  that is harder to maintain and debug than a straightforward nested loop

**Rule of thumb:** if you can write the JOIN in under 10 lines of SQL with
only indexed column conditions, use the JOIN. If the SQL grows beyond that
or requires non-indexed lookups, keep the nested scan.

### Patterns that CAN be optimized:

**Multiple index scans replaced by SQL OR:**
COBOL scans the same table 3 times using 3 different index keys (e.g., IS-SLP,
OS-SLP, TKN-SLP). In SQL, use a single query with `OR`:
```sql
WHERE (is_slp = ? OR os_slp = ? OR tkn_slp = ?)
```
This is already what the COBOL does when building raw tables (INSERT...SELECT with OR).

**Per-row existence checks replaced by JOIN/subquery:**
COBOL reads a reference table for each row (e.g., read TSA to check if closed).
In SQL, this can be a LEFT JOIN or NOT EXISTS subquery in the main query.

---

## 25c. Existing C Library Functions (`c_*`) — Call, Never Reimplement

COBOL programs call many existing C functions via `CALL "c_functionname"`. These
functions are already implemented in our C library and will be linked at build time.

**Rule:** When the COBOL calls a `c_*` function, the C code must call that same
function via `extern` declaration. **Never reimplement** a `c_*` function's logic.
These are pre-existing, tested library functions.

**Common `c_*` functions found in COBOL programs:**

| Function | Purpose |
|----------|---------|
| `c_templcomp` | Template/wildcard comparison (`*` and `/` wildcards) |
| `c_highLow` | Get collation-aware high/low boundary values |
| `c_compress` | String compression (remove consecutive character runs) |
| `c_GetUTDateTm` | Get current UTC date/time |
| `c_GetDateTm` | Get current local date/time |
| `c_convert_to_gmt` | Convert local time to GMT |
| `c_convert_to_local` | Convert GMT to local time |
| `c_getcmpyid` | Get company ID |
| `c_getplenv` | Get platform environment variable |
| `c_getifdinfo` | Get IFD (table metadata) information |
| `c_getvalue` | Get a value from a record buffer |

**How to call them in C:**
```c
/* Declare the extern — the library provides the implementation */
extern int c_templcomp(char *field1, char *field2, int *size);

/* Call it directly */
int status = c_templcomp(pattern, value, &size);
```

**Do not:**
- Reimplement `c_templcomp` as a custom `pvtTemplateMatch` function
- Reimplement `c_compress` as a custom `pvtCompress` function
- Reimplement `c_highLow` as custom high/low value logic
- Write ANY custom code that duplicates what a `c_*` function already does

**Infrastructure `c_*` functions** (transaction, service, logging) are handled by
the CAPI framework and typically do not need explicit calls in the converted C code:
`c_tpbegin`, `c_tpcommit`, `c_tpabort`, `c_tpcall`, `c_tpreturn`, `c_tpsvcstart`,
`c_goback`, `c_writelnkarea`, `c_sycalpgmbeg`, `c_sycalpgmend`, `c_begcom`,
`c_isolation`, `c_setlokmod`, `c_upddps`, `c_plnlog`, `c_catpei`, `c_scsmap`.
These map to `invBeginWork`, `invCommitWork`, `invRollbackWork`, `invSetApiResponse`,
etc. in the CAPI framework.

---

## 26. Memory Allocation Strategy: Stack First, Pool for Returns

Use **stack variables and fixed-size buffers** for all local/temporary data within
functions. Use **pool allocation** only for strings returned to callers or data that
must live beyond the function's scope.

The pool is destroyed automatically when the API unloads — no manual `free()` calls
are ever needed.

### 26a. Stack — local/temporary variables

Use stack-allocated fixed-size buffers for any string that is only used within the
current function and is not returned to the caller.

**Multi-byte string support:** All fixed-size character buffers must be **4× the
logical field size** to accommodate multi-byte UTF-8 characters (up to 4 bytes per
character). For example, a COBOL `PIC X(8)` field needs a `char[33]` buffer
(8 × 4 + 1 for null terminator).

```c
/* CORRECT — 4× logical size + 1 for null terminator */
char sCusId[33];     /* 8-char field: 8×4+1 = 33 */
char sSlpCode[17];   /* 4-char field: 4×4+1 = 17 */
char sAdminBrh[13];  /* 3-char field: 3×4+1 = 13 */
char sTemp[1025];    /* 256-char field: 256×4+1 = 1025 */

snprintf(sCusId, sizeof(sCusId), "%s", someValue);
```

### 26b. Pool — returned strings and long-lived data

Use `invasprintf` or `invMemPoolAlloc` for:
- Strings returned to the caller via output pointers
- Strings stored in structures that outlive the function
- SQL buffers (built incrementally, used after the function returns)

```c
/* CORRECT — pool for output to caller */
if (out_adminBrh)
    invasprintf(out_adminBrh, "%s", tAdminBrh);

/* CORRECT — pool for SQL buffer passed to DB functions */
invasprintf(&sSqlBuf, "SELECT ...");
```

### 26c. Decision guide

| Lifetime | Allocation | Free? |
|----------|-----------|-------|
| Used only within this function | Stack (fixed buffer) | No — automatic |
| Returned to caller | Pool (`invasprintf`) | No — pool cleanup |
| Stored in API-level structure | Pool (`invMemPoolAlloc`) | No — pool cleanup |
| cJSON from DB reads | Heap (by DB function) | Yes — `cJSON_Delete` |

### 26d. Unknown field sizes — never assume

When converting from **any** source — COBOL programs, Netron frames, or existing C
programs — if the field size cannot be determined from the source code, **do not guess**.
Add a `/* TODO: verify field size */` comment so it can be reviewed manually.

This applies to:
- COBOL `PIC X` lengths
- Netron frame work area field sizes
- Existing C `char[]` buffer sizes being carried forward or resized
- Any field where the logical character length is unclear

```c
/* CORRECT — unknown size flagged for review */
char sCusName[1] = "";  /* TODO: verify field size — source size not found */

/* WRONG — guessed a size */
char sCusName[129] = "";  /* assumed 32 chars */
```

### 26e. Do not

- Do not use `invasprintf` for strings that are only used locally and discarded
- Do not use `malloc`/`calloc`/`realloc` — use pool or stack
- Do not call `free()` on pool-allocated memory
- Do not assume or guess field sizes — flag unknown sizes with a TODO comment
- The **only** heap objects that need explicit cleanup are `cJSON*` from database reads

---

## 27. Multi-Mode COBOL Programs — One File, Multiple Entry Points

When a COBOL program has multiple processing modes (PRS-MD), the C conversion produces
**one `.c` file** containing all modes, with each mode exposed as a separate public
function that can serve as both an API endpoint and a direct C function call.

### 27a. File structure

```
pgmname.c          — single C file with all modes
pgmname.h          — public header with structs + all entry point prototypes
```

The file contains:
1. **Shared private helpers** — table reads, formatting, validation logic used by
   multiple modes. These are `static` functions with `pvt` prefix.
2. **One public function per mode** — each has the standard API entry point signature
   (Rule 5) so it can be loaded as a `.so` endpoint by the httpd module, AND can be
   called directly as a C function by other modules via `extern` + the header file.
3. **Shared JSON parser** (optional) — if modes share many input fields, provide a
   `pgmnameParseJsonInput()` function that populates an input struct from `jsonInput`.
4. **Shared response builder** (optional) — `pgmnameBuildResponse()` to create the
   standard `invSetApiResponse` output from the output struct.

### 27b. Naming conventions

| Item | Convention | Example |
|------|-----------|---------|
| C file | COBOL program name, lowercase | `inypif.c` |
| Header file | same + `.h` | `inypif.h` |
| Mode entry points | short mnemonic per mode | `inpifsel`, `inpifact`, `inpifext` |
| Shared input struct | `PgmnameInput` | `InypifInput` |
| Shared output struct | `PgmnameOutput` | `InypifOutput` |
| Shared parser | `pgmnameParseJsonInput()` | `inypifParseJsonInput()` |
| Shared response builder | `pgmnameBuildResponse()` | `inypifBuildResponse()` |
| Internal engine function | `pgmname()` (if needed) | `inypif()` |

### 27c. Spec file structure

Create **one master spec file** (`pgmname_english.md`) that contains:

1. **Program overview** — purpose, service name, all modes listed in a summary table.
2. **Shared pre-dispatch logic** — VALIDATE-LINKAGE, INITIAL-SETUP, VALIDATE-ACCESS,
   and any other paragraphs that run before the mode EVALUATE.
3. **Shared output structure** — the complete response row schema used by all modes.
4. **Shared helper logic** — formatting, validation, and table-read functions shared
   across modes.
5. **One endpoint section per mode** — each with its own:
   - API endpoint name, HTTP path, function name
   - Request parameters (only fields used by that mode — Rule 21)
   - Mode-specific logic
6. **Tables reference** — all tables used across all modes.
7. **Exact string constants** — all mode codes, status values, error numbers.

Individual per-mode spec files (`pgmname_mode_english.md`) may also exist for
detailed implementation guidance. The master spec is the authoritative overview.

### 27d. Dual-use entry points

Each mode's public function must work in **two contexts**:

1. **As an API endpoint** — loaded as a `.so` by the httpd module. Receives
   `jsonParams`/`jsonInput`, returns via `invSetApiResponse` into `*jsonOutput`.
   Uses the standard Rule 5 signature.
2. **As a direct C function call** — called by other C modules via `extern`
   declaration and the header file. The caller populates the input struct directly
   and reads the output struct, bypassing JSON parsing/response building.

To support both, structure each mode function as:
```c
int modename(
    struct InvexRequestHeader *ivxRqstHdr,
    const cJSON               *jsonParams,
    const cJSON               *jsonInput,
    cJSON                    **jsonOutput
) {
    PgmnameInput  inp;
    PgmnameOutput out;

    pgmnameParseJsonInput(jsonInput, 'N', &inp);  /* N = mode number */
    pgmname(&inp, &out);                          /* shared engine */
    pgmnameBuildResponse(&out, jsonOutput);        /* standard response */

    return out.iRtnSts;
}
```

For direct C callers, they populate `PgmnameInput` themselves, call `pgmname()`
directly, and read `PgmnameOutput` — no JSON involved.

### 27e. Do not

- Do not create separate `.c` files per mode when the modes share significant logic
  (table reads, formatting, validation). One file avoids code duplication.
- Do not duplicate shared helper functions across mode files. If modes share a
  `pvtReadTable()` or `pvtFormatField()`, it belongs in the shared `.c` file.
- Do not expose internal helper functions in the header — only mode entry points,
  the input/output structs, the parser, and the response builder are public.
- Do not parse parameters in the shared engine function. Parsing belongs in the
  mode entry point or the shared JSON parser — the engine takes a populated struct
