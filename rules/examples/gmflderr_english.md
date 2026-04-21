# Spec: GMFLDERR — Field Error (VB UI Only)

## 1. Purpose

A **Visual Basic UI frame** that handles field error display in interactive
ACD service clients. Sets focus to the tab containing the first field in error.
This is VB code, not COBOL — it has **no C equivalent** and is not applicable
to CAPI services.

## 2. C Equivalent

None. This frame is specific to Visual Basic interactive clients. CAPI services
return errors via the message log, not by setting UI focus.

## 3. Frame Parameters (compile-time)

| Parameter | Description |
|---|---|
| GMFLDERR_TBLPFX | Table prefix (3 letters) — used to identify the tab control |

## 4. Logic: SetFocusOnTab

Sets the active tab to the page containing the first field in error:
- If `TabIndex > 13`: tab = `1 + (TabIndex - 14) \ nMaxFieldPerPage`
- Otherwise: tab = `TabIndex \ (nMaxFieldPerPage + 1)`

## 5. Dependencies

None applicable to CAPI.
