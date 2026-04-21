# EXYVLL -- Implementation Specification

> Language-neutral blueprint. Generate working code in any language from this
> file alone. No C, COBOL, or other source files needed.

---

## 1. Service Overview

| Attribute              | Value                                                   |
|------------------------|---------------------------------------------------------|
| **Service name**       | exyvll                                                  |
| **Purpose**            | Validates user licenses during logon, handles session disconnect and cleanup |
| **Read-only**          | Yes for modes 2/I; modes 3/4 trigger external service calls that delete sessions |
| **Page size**          | N/A (no list output)                                    |
| **Database**           | PostgreSQL                                              |

### 1.1 Endpoints

| Function      | Mode | Description                                                 |
|---------------|------|-------------------------------------------------------------|
| exyvlllogon   | 2    | Validate licenses on user logon (full, including PDA)       |
| exyvllinvex   | I    | Validate licenses (skip PDA, used by INVEX CUSTOMER)        |
| exyvllclnup   | 3    | Cleanup old session (user answered YES to disconnect)       |
| exyvlldelsn   | 4    | Delete all existing sessions for ExecLgnId/EnvNm/EnvCl     |

---

## 2. External Dependencies

### 2.1 c_verifyStxLicWhenUserConn

| Attribute       | Value                                                       |
|-----------------|-------------------------------------------------------------|
| **Signature**   | verifyStxLicWhenUserConn() -> status (4-char string)        |
| **Description** | Verifies STRATIX license when a user connects. Returns "0000" on success, any other value on failure. |

### 2.2 c_checkExecLicense

| Attribute       | Value                                                       |
|-----------------|-------------------------------------------------------------|
| **Signature**   | checkExecLicense() -> integer                               |
| **Description** | Checks the main EXEC license. Returns 0 = OK, 1 = expired, 2 = grace period. |

### 2.3 validate_prod

| Attribute       | Value                                                       |
|-----------------|-------------------------------------------------------------|
| **Signature**   | validateProd(prdId, sprdId, lgnId) -> status (1-char string) |
| **Description** | Validates product/sub-product license for a user. Returns "0" = OK, "1" = expired, "2" = grace period, "3" = not licensed. |

### 2.4 CallAscEnv

| Attribute       | Value                                                       |
|-----------------|-------------------------------------------------------------|
| **Signature**   | callAscEnv(serverIp, serverPort, serviceName, inputData, inputLen) -> { outputData, outputLen, returnCode } |
| **Description** | Cross-environment service call. Invokes a service on a target EXEC environment's middleware. returnCode: 0 = success, 1-5 = specific errors, other = unexpected. |

### 2.5 EXZELK (mode "O")

| Attribute       | Value                                                       |
|-----------------|-------------------------------------------------------------|
| **Signature**   | exzelk(mode, controlNumber) -> (void)                       |
| **Description** | Deletes EXEC locks and connected sessions for a given session control number. Mode "O" = delete. **Not yet available** -- stub with TODO. |

### 2.6 MXZURA (mode "D") via CallAscEnv

| Attribute       | Value                                                       |
|-----------------|-------------------------------------------------------------|
| **Signature**   | Called indirectly via callAscEnv to target environment       |
| **Description** | Deletes STRATIX sessions (mxtura/scttlk) on a target EXEC environment. **Not yet available** -- stub with TODO. |

---

## 3. Database Tables

### 3.1 exreur_rec (Exec User Record)

| Attribute       | Value              |
|-----------------|--------------------|
| **Primary key** | eur_exec_lgn_id    |

**Fields used:**

| Field             | Type   | Description                          |
|-------------------|--------|--------------------------------------|
| eur_exec_lgn_id   | string | Exec login ID (primary key)          |
| eur_enbl_flg      | string | Enabled flag ("Y" = enabled)         |

### 3.2 exrsei_rec (Exec Server/Environment Info)

| Attribute       | Value                      |
|-----------------|----------------------------|
| **Primary key** | sei_env_nm, sei_env_cl     |

**Fields used:**

| Field                 | Type   | Description                    |
|-----------------------|--------|--------------------------------|
| sei_env_nm            | string | Environment name               |
| sei_env_cl            | string | Environment class              |
| sei_srvr_ip_addr      | string | Primary server IP address      |
| sei_srvr_port         | string | Primary server port            |
| sei_sec_srvr_ip_addr  | string | Secondary server IP address    |
| sei_sec_srvr_port     | string | Secondary server port          |

### 3.3 exrpda_rec (Exec Product/User Access)

| Attribute       | Value                              |
|-----------------|------------------------------------|
| **Primary key** | pda_exec_lgn_id, pda_prd_id        |

**Fields used:**

| Field             | Type   | Description                                    |
|-------------------|--------|------------------------------------------------|
| pda_exec_lgn_id   | string | Exec login ID                                  |
| pda_prd_id        | string | Product ID                                     |
| pda_usr_acs_md    | string | User access mode: "S" = single, "M" = multi   |

### 3.4 exrpuc_rec (Exec Product User Count)

| Attribute       | Value          |
|-----------------|----------------|
| **Primary key** | puc_prd_id     |

**Fields used:**

| Field           | Type    | Description                                         |
|-----------------|---------|-----------------------------------------------------|
| puc_prd_id      | string  | Product ID                                          |
| puc_connty_typ  | string  | Connectivity type: "C" = concurrent, "N" = named    |
| puc_nbr_usrs    | integer | Licensed number of users                            |

### 3.5 extcns_rec (Exec Connected Sessions)

| Attribute | Value                                                |
|-----------|------------------------------------------------------|
| **KEY1**  | cns_exec_lgn_id, cns_conntd_dt (descending)         |
| **KEY2**  | cns_exec_lgn_id, cns_env_nm, cns_env_cl             |
| **KEY3**  | cns_exec_lgn_id, cns_conntd_ssn_typ                 |

**Fields used:**

| Field                | Type   | Description                |
|----------------------|--------|----------------------------|
| cns_exec_lgn_id      | string | Exec login ID              |
| cns_env_nm           | string | Environment name           |
| cns_env_cl           | string | Environment class          |
| cns_conntd_ssn_typ   | string | Connected session type     |
| cns_conntd_dt        | string | Connected date             |
| cns_cns_ctl_no       | string | Session control number     |

### 3.6 exrglk_rec (Exec Global License Key)

| Attribute       | Value                    |
|-----------------|--------------------------|
| **Primary key** | (single-row global key)  |

**Fields used:**

| Field          | Type   | Description              |
|----------------|--------|--------------------------|
| glk_expry_dt   | string | License expiry date      |

### 3.7 rprcds_rec (Code Descriptions)

| Attribute       | Value                  |
|-----------------|------------------------|
| **Primary key** | cds_cd_typ, cds_cd     |

**Fields used:**

| Field     | Type   | Description           |
|-----------|--------|-----------------------|
| cds_cd_typ| string | Code type             |
| cds_cd    | string | Code value            |
| cds_dsc   | string | Code description      |

---

## 4. Input Structure

| Field      | Type   | Size | Required | Default | Description                         |
|------------|--------|------|----------|---------|-------------------------------------|
| execLgnId  | string | 128  | Yes      | (none)  | Exec Login ID                       |
| envNm      | string | 15   | Yes      | (none)  | Environment Name                    |
| envCl      | string | 3    | Yes      | (none)  | Environment Class                   |
| licPrdId   | string | 3    | Yes      | (none)  | License Product ID ("EXC","MCM","STX") |
| licSprdId  | string | 3    | No       | ""      | License Sub-Product ID              |

### 4.1 Per-Mode Input Parameters

**Mode 2 (exyvlllogon):** execLgnId, envNm, envCl, licPrdId, licSprdId

**Mode I (exyvllinvex):** execLgnId, envNm, envCl, licPrdId, licSprdId

**Mode 3 (exyvllclnup):** execLgnId, envNm, envCl, licPrdId, licSprdId

**Mode 4 (exyvlldelsn):** execLgnId, envNm, envCl, licPrdId (no licSprdId)

---

## 5. Output Structure

### 5.1 Response Envelope

| Field          | Type    | Description                                            |
|----------------|---------|--------------------------------------------------------|
| returnStatus   | integer | 0 = success, 1 = error, 2 = warning (grace), 3 = question |
| hasMore        | boolean | Always false (no pagination)                           |

### 5.2 Response Array: `items`

Empty array. All messaging goes through the standard message mechanism (invLogMessage / sctmsg). The only meaningful output is the returnStatus.

---

## 6. Processing Logic

### 6.1 validateLinkage (shared -- runs before all modes)

```
1. if execLgnId is blank:
     log error seq "1500", data element "EXEC-LGN-ID"
     set returnStatus = 1, return error

2. read exreur_rec by KEY where eur_exec_lgn_id = execLgnId
   if not found:
     log error seq "1500", data element "EXREUR"
     set returnStatus = 1, return error

3. read exrsei_rec by KEY where sei_env_nm = envNm AND sei_env_cl = envCl
   if not found:
     log error seq "1500", data element "EXRSEI"
     set returnStatus = 1, return error
```

### 6.2 verifyStxLicense

```
1. call verifyStxLicWhenUserConn() -> status
2. if status != "0000":
     log error seq "2171", data element "VLL-STX-LIC"
     set returnStatus = 1, return error
```

### 6.3 verifyMainLicense

```
1. call checkExecLicense() -> result
2. if result == 1:
     log error seq "2169", data element "VLL-LIC-EXPRD"
     set returnStatus = 1, return error

3. if result == 2:
     read exrglk_rec by KEY
     if found:
       format glk_expry_dt as display date (4-digit year)
     log warning seq "2170", data elements "VLL-LIC-GRACE" + formattedExpiryDate
     set returnStatus = 2 (warning -- continue processing)
```

### 6.4 validateProductLicense

```
1. call validateProd(licPrdId, licSprdId, execLgnId) -> status
2. if status == "1":
     log error seq "2173", data element "VLL-PRD-EXPRD"
     set returnStatus = 1, return error

3. if status == "2":
     read exrglk_rec by KEY
     if found:
       format glk_expry_dt as display date (4-digit year)
     log warning seq "6761", data elements "VLL-PRD-GRACE" + formattedExpiryDate
     set returnStatus = 2 (warning -- continue processing)

4. if status == "3":
     log error seq "6766", data element "VLL-PRD-NOTLIC"
     set returnStatus = 1, return error
```

### 6.5 checkSpecialLoginId

```
if execLgnId is one of: "invera", "ivxauth", "invsprt", "nesting":
  return true (skip license count checks)
else:
  return false
```

### 6.6 getExtcnsCount (count concurrent sessions)

```sql
SELECT count(*) AS cnt FROM extcns_rec
WHERE cns_exec_lgn_id NOT IN ('ivxauth','invera','iserve','system','invsprt','nesting')
  AND cns_conntd_ssn_typ = {escaped licPrdId}
```

```
execute SQL
if SQL fails:
  log error seq "1696", data element "EXTCNS-CNT"
  return error
return count value
```

NOTE: This is a legitimate count(*) -- the actual row count is needed for comparison against the licensed user limit.

### 6.7 countNamedUsers (PRS-FWD-PDA)

```sql
SELECT pda_exec_lgn_id FROM exrpda_rec
WHERE pda_prd_id = {escaped licPrdId}
```

```
set userCount = 0
open cursor
for each PDA row:
  read exreur_rec by KEY where eur_exec_lgn_id = pda_exec_lgn_id
  if EUR found and eur_enbl_flg == "Y":
    increment userCount
close cursor
return userCount
```

### 6.8 cleanupOneSession

```
input: licPrdId, controlNumber, envName, envClass, sessionType

1. if licPrdId != "EXC":
     call callMxzura(envName, envClass, controlNumber, sessionType)
     -- deletes STRATIX session on target environment

2. call exzelk(mode "O", controlNumber)
   -- deletes EXEC locks and connected session
```

### 6.9 callMxzura (cross-environment service call)

```
TODO: Not yet implemented (Rule 20 stub)

Algorithm:
1. read exrsei_rec by KEY where sei_env_nm = envName, sei_env_cl = envClass
   if not found: log error, return

2. determine target server:
   if sei_srvr_port == current environment's port:
     use secondary server (sei_sec_srvr_ip_addr, sei_sec_srvr_port)
   else:
     use primary server (sei_srvr_ip_addr, sei_srvr_port)

3. build MXZURA input: mode "D", session info (controlNumber, sessionType)

4. call callAscEnv(targetIp, targetPort, "mxzura", input, inputLen)
   -> { outputData, outputLen, returnCode }

5. error mapping:
   returnCode 0: success
   returnCode 1: log error seq "1537", data element "CALL-ASC-ENV"
   returnCode 2: log error seq "7001", data element "CALL-ASC-ENV"
   returnCode 3: log error seq "7002", data element "CALL-ASC-ENV"
   returnCode 4: log error seq "7003", data element "CALL-ASC-ENV"
   returnCode 5: log error seq "7004", data element "CALL-ASC-ENV"
   other:        log error seq "1816", data element "CALL-ASC-ENV"
```

### 6.10 loopSessionsByKey1 (PRS-SSNTYP-FWD-CNS)

```sql
SELECT cns_cns_ctl_no, cns_env_nm, cns_env_cl, cns_conntd_ssn_typ
FROM extcns_rec
WHERE cns_exec_lgn_id = {escaped execLgnId}
ORDER BY cns_conntd_dt DESC
```

```
open cursor
for each session row:
  if cns_conntd_ssn_typ == licPrdId:
    save controlNumber, envName, envClass, sessionType from row
    call cleanupOneSession(licPrdId, controlNumber, envName, envClass, sessionType)
close cursor
```

### 6.11 loopSessionsByKey2Filtered (PRS-NMULTI-FWD-CNS)

```sql
SELECT cns_cns_ctl_no, cns_env_nm, cns_env_cl, cns_conntd_ssn_typ
FROM extcns_rec
WHERE cns_exec_lgn_id = {escaped execLgnId}
  AND cns_env_nm = {escaped envNm}
  AND cns_env_cl = {escaped envCl}
```

```
open cursor
for each session row:
  if cns_conntd_ssn_typ == licPrdId:
    save controlNumber, envName, envClass, sessionType from row
    call cleanupOneSession(licPrdId, controlNumber, envName, envClass, sessionType)
close cursor
```

### 6.12 loopSessionsByKey2All (PRS-MD4-FWD-CNS)

```sql
SELECT cns_cns_ctl_no, cns_env_nm, cns_env_cl, cns_conntd_ssn_typ
FROM extcns_rec
WHERE cns_exec_lgn_id = {escaped execLgnId}
  AND cns_env_nm = {escaped envNm}
  AND cns_env_cl = {escaped envCl}
```

```
open cursor
for each session row:
  save controlNumber, envName, envClass, sessionType from row
  call cleanupOneSession(sessionType, controlNumber, envName, envClass, sessionType)
  -- NOTE: no session type filter -- cleanup ALL sessions
close cursor
```

---

## 7. Mode Algorithms

### 7.1 Mode 2 -- exyvlllogon (Validate License on Logon -- Full)

```
set returnStatus = 0

1. parse input: execLgnId, envNm, envCl, licPrdId, licSprdId
2. validateLinkage(execLgnId, envNm, envCl) -- exit on error
3. verifyStxLicense() -- exit on error
4. verifyMainLicense() -- exit on error (expired); set warning on grace
5. validateProductLicense(licPrdId, licSprdId, execLgnId) -- exit on error

--- PDA logic (mode 2 only) ---

6. if licPrdId != "EXC":
     read exrpda_rec by KEY where pda_exec_lgn_id = execLgnId, pda_prd_id = licPrdId
     if not found:
       log error seq "6768", data element "VLL-NO-PDA"
       set returnStatus = 1, go to buildResponse
     save usrAcsMd = pda_usr_acs_md

7. read exrpuc_rec by KEY where puc_prd_id = licPrdId
   if not found:
     log error seq "1508", data element "EXRPUC"
     set returnStatus = 1, go to buildResponse
   save conntyTyp = puc_connty_typ, nbrUsrs = puc_nbr_usrs

   if licPrdId == "EXC":
     derive usrAcsMd: if conntyTyp == "N" then "S", else "M"

8. if checkSpecialLoginId(execLgnId) is true:
     go to buildResponse (skip license count checks)

9. if conntyTyp == "C" (Concurrent):
     count = getExtcnsCount(licPrdId)
     if error: set returnStatus = 1, go to buildResponse
     if count >= nbrUsrs:
       log error seq "6770", data element "VLL-MAX-CONC"
       set returnStatus = 1, go to buildResponse

10. if conntyTyp == "N" (Named):
      userCount = countNamedUsers(licPrdId)
      if error: set returnStatus = 1, go to buildResponse
      if userCount > nbrUsrs:
        log error seq "6769", data element "VLL-MAX-NAMED"
        set returnStatus = 1, go to buildResponse

      if usrAcsMd == "S" (Single session):
        read extcns_rec by KEY3 where cns_exec_lgn_id = execLgnId,
                                       cns_conntd_ssn_typ = licPrdId
        if found:
          look up rprcds_rec by KEY where cds_cd_typ = "SSN", cds_cd = cns_conntd_ssn_typ
          get session type description from cds_dsc
          log question seq "7344", data elements "VLL-DISC-SSN" + sessionTypeDesc
          set returnStatus = 3, go to buildResponse

      if usrAcsMd == "M" (Multi session):
        read extcns_rec by KEY2 where cns_exec_lgn_id = execLgnId,
                                       cns_env_nm = envNm, cns_env_cl = envCl
        if found and cns_conntd_ssn_typ == licPrdId:
          look up rprcds_rec for session type description (same as above)
          log question seq "7344", data elements "VLL-DISC-SSN" + sessionTypeDesc
          set returnStatus = 3, go to buildResponse

buildResponse:
  build response with empty items array
  return returnStatus
```

### 7.2 Mode I -- exyvllinvex (Validate License -- Skip PDA)

```
set returnStatus = 0

1. parse input: execLgnId, envNm, envCl, licPrdId, licSprdId
2. validateLinkage(execLgnId, envNm, envCl) -- exit on error
3. verifyStxLicense() -- exit on error
4. verifyMainLicense() -- exit on error; set warning on grace
5. validateProductLicense(licPrdId, licSprdId, execLgnId) -- exit on error
   -- Mode I stops here: no PDA/concurrent/named checks

buildResponse:
  build response with empty items array
  return returnStatus
```

### 7.3 Mode 3 -- exyvllclnup (Cleanup Old Session)

```
set returnStatus = 0

1. parse input: execLgnId, envNm, envCl, licPrdId, licSprdId
2. validateLinkage(execLgnId, envNm, envCl) -- exit on error

3. if licPrdId == "EXC" or licPrdId == "MCM":
     loopSessionsByKey1(execLgnId, licPrdId)
   else:
     read exrpda_rec by KEY where pda_exec_lgn_id = execLgnId, pda_prd_id = licPrdId
     if not found:
       go to buildResponse (no sessions to clean)
     if pda_usr_acs_md == "S":
       loopSessionsByKey1(execLgnId, licPrdId)
     if pda_usr_acs_md == "M":
       loopSessionsByKey2Filtered(execLgnId, envNm, envCl, licPrdId)

buildResponse:
  build response with empty items array
  return returnStatus
```

### 7.4 Mode 4 -- exyvlldelsn (Delete All Sessions)

```
set returnStatus = 0

1. parse input: execLgnId, envNm, envCl, licPrdId
2. validateLinkage(execLgnId, envNm, envCl) -- exit on error
3. loopSessionsByKey2All(execLgnId, envNm, envCl)

buildResponse:
  build response with empty items array
  return returnStatus
```

---

## 8. Error Handling

| Seq No | Type | nArgs | Data Element(s)                    | Condition                                    |
|--------|------|-------|------------------------------------|----------------------------------------------|
| 1500   | E    | 1     | "EXEC-LGN-ID" / "EXREUR" / "EXRSEI" | Validation failures                       |
| 1508   | E    | 1     | "EXRPUC"                           | Product user count record not found          |
| 1516   | E    | 1     | "MXTURA"                           | MXTURA error from mxzura                     |
| 1537   | E    | 1     | "CALL-ASC-ENV"                     | CallAscEnv error code 1                      |
| 1696   | E    | 1     | "EXTCNS-CNT"                       | SQL failure getting concurrent session count |
| 1816   | E    | 1     | "CALL-ASC-ENV"                     | CallAscEnv unexpected error                  |
| 2169   | E    | 1     | "VLL-LIC-EXPRD"                    | License expired                              |
| 2170   | W    | 2     | "VLL-LIC-GRACE", expiryDate        | License in grace period                      |
| 2171   | E    | 1     | "VLL-STX-LIC"                      | STRATIX license verify failed                |
| 2173   | E    | 1     | "VLL-PRD-EXPRD"                    | Product license expired                      |
| 6761   | W    | 2     | "VLL-PRD-GRACE", expiryDate        | Product in grace period                      |
| 6766   | E    | 1     | "VLL-PRD-NOTLIC"                   | Product not licensed                         |
| 6768   | E    | 1     | "VLL-NO-PDA"                       | No PDA record for user/product               |
| 6769   | E    | 1     | "VLL-MAX-NAMED"                    | Named user count exceeds licensed count      |
| 6770   | E    | 1     | "VLL-MAX-CONC"                     | Max concurrent licensed users reached        |
| 7001   | E    | 1     | "CALL-ASC-ENV"                     | CallAscEnv error code 2                      |
| 7002   | E    | 1     | "CALL-ASC-ENV"                     | CallAscEnv error code 3                      |
| 7003   | E    | 1     | "CALL-ASC-ENV"                     | CallAscEnv error code 4                      |
| 7004   | E    | 1     | "CALL-ASC-ENV"                     | CallAscEnv error code 5                      |
| 7344   | Q    | 2     | "VLL-DISC-SSN", sessionTypeDesc    | Disconnect existing session question         |

---

## 9. Special Login IDs

The following system accounts bypass concurrent/named license count checks:
- "invera"
- "ivxauth"
- "invsprt"
- "nesting"

The concurrent session count SQL also excludes "iserve" and "system" from the count.
