# Spec: INCCHMV — Chemical Element Variable Definitions

## 1. Purpose

Defines the field layout for chemical element data. Provides three modes:
LNK for linkage area definitions (30-entry table with string variable),
TBL for individual working-storage fields (no OCCURS), and SEL for
selection linkage with 5 individually named entries plus an OCCURS 5
redefine.

## 2. C Equivalent

No direct C equivalent needed. This is a data definition frame. The field
layouts should be defined as struct members in the consuming service's
linkage or working-storage area.

## 3. Frame Parameters (compile-time)

| Parameter | Description | Default |
|---|---|---|
| INCCHMV_FRMODE | Mode: `LNK`, `TBL`, `SEL` | `LNK` |
| INCCHMV_LVLNO | COBOL level number | `05` |
| INCCHMV_VAR_PFX | Field name prefix | `WS` |
| INCCHMV_VLD | Include validation flag field: `Y` or `N` | `N` |
| INCCHMV_GNRTNULL | Generate NULL indicators for fields: `Y` or `N` | `N` |

## 4. Field Sets

### LNK — Linkage Chemical Table (30 entries)

**CHM-TBL-INFO group:**

| Field | Description |
|---|---|
| CHM-TBL | Array of 30 entries, each containing: |
| CHMEL | Chemical element code (3 chars) |
| CHM-ALPHA-VAL | Alpha value (10 chars) |
| CHM-MIN | Minimum value (2 integer, 6 decimal) |
| CHM-MAX | Maximum value (2 integer, 6 decimal) |
| CHM-VAL | Actual value (2 integer, 6 decimal) |
| CHM-TOL-NEG | Negative tolerance (3 integer, 2 decimal) |
| CHM-TOL-POSV | Positive tolerance (3 integer, 2 decimal) |
| CHM-VLD | Validation flag (0=not valid, 1=valid) — only if VLD=Y |

**CHM-STRNG group:**

| Field | Description |
|---|---|
| CHM-VAR | Chemical string variable (900 chars) |

### TBL — Individual Fields (no OCCURS)

Same fields as LNK but defined individually (no array wrapper):
CHMEL, CHM-ALPHA-VAL, CHM-MIN, CHM-MAX, CHM-VAL, CHM-TOL-NEG,
CHM-TOL-POSV.

**CHM-STRNG group:** same as LNK.

### SEL — Selection Fields (5 named entries)

**CHM-TBL-INFO group:**

5 individually named entry sets (suffix -1 through -5), each containing:
CHMEL-n, CHM-ALPHA-VAL-n, CHM-MIN-n, CHM-MAX-n, CHM-VAL-n,
CHM-TOL-NEG-n, CHM-TOL-POSV-n.

**CHM-TBL-RED (redefine of CHM-TBL-INFO):**

| Field | Description |
|---|---|
| CHM-EL | Array of 5 entries (OCCURS 5), each containing: |
| CHMEL | Chemical element code (3 chars) |
| CHM-ALPHA-VAL | Alpha value (10 chars) |
| CHM-MIN | Minimum value (2 integer, 6 decimal) |
| CHM-MAX | Maximum value (2 integer, 6 decimal) |
| CHM-VAL | Actual value (2 integer, 6 decimal) |
| CHM-TOL-NEG | Negative tolerance (3 integer, 2 decimal) |
| CHM-TOL-POSV | Positive tolerance (3 integer, 2 decimal) |
| CHM-VLD | Validation flag (0=not valid, 1=valid) — only if VLD=Y |

**CHM-STRNG group:** same as LNK.
