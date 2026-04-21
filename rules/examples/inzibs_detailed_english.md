# INZIBS — Detailed Specification

## 1. Complete Input Structure

| COBOL Field | JSON Parameter | Type | Default | Description |
|-------------|---------------|------|---------|-------------|
| IBSUI-PRS-MD | sPrsMd | X(1) | - | Process mode: "1","2","3","4" |
| IBSUI-ITM-CTL-NO | iItmCtlNo | 9(10) | 0 | Item control number (modes 1/3) |
| IBSUI-REF-PFX | sRefPfx | X(2) | spaces | Reference prefix (modes 2/4) |
| IBSUI-REF-NO | iRefNo | 9(8) | 0 | Reference number (modes 2/4) |
| IBSUI-REF-ITM | iRefItm | 9(3) | 0 | Reference item |
| IBSUI-REF-SBITM | iRefSbitm | 9(4) | 0 | Reference sub-item |
| IBSUI-TRS-PCS | iTrsPcs | S9(7) | 0 | Transaction pieces (modes 1/3) |
| IBSUI-TRS-MSR | dTrsMsr | S9(12)V9(4) | 0 | Transaction measure (modes 1/3) |
| IBSUI-TRS-WGT | dTrsWgt | S9(8)V9(2) | 0 | Transaction weight (modes 1/3) |
| IBSUI-TRS-QTY | dTrsQty | S9(12)V9(4) | 0 | Transaction quantity (modes 1/3) |
| IBSUI-TRS-RES-PCS | iTrsResPcs | S9(9) | 0 | Reserved pieces (modes 1/3) |
| IBSUI-TRS-RES-MSR | dTrsResMsr | S9(14)V9(4) | 0 | Reserved measure (modes 1/3) |
| IBSUI-TRS-RES-WGT | dTrsResWgt | S9(10)V9(2) | 0 | Reserved weight (modes 1/3) |
| IBSUI-TRS-RES-QTY | dTrsResQty | S9(14)V9(4) | 0 | Reserved quantity (modes 1/3) |

## 2. Complete Output Structure

| JSON Key | Type | Description |
|----------|------|-------------|
| iRtnSts | 9(4) | 0 = success, 1 = error |

## 3. Input Parameters by Mode Matrix

| Parameter | Mode 1 | Mode 2 | Mode 3 | Mode 4 |
|-----------|--------|--------|--------|--------|
| sPrsMd | Y | Y | Y | Y |
| iItmCtlNo | Y | - | Y | - |
| sRefPfx | - | Y | - | Y |
| iRefNo | - | Y | - | Y |
| iRefItm | Y | Y | Y | Y |
| iRefSbitm | Y | Y | Y | Y |
| iTrsPcs | Y | - | Y | - |
| dTrsMsr | Y | - | Y | - |
| dTrsWgt | Y | - | Y | - |
| dTrsQty | Y | - | Y | - |
| iTrsResPcs | Y | - | Y | - |
| dTrsResMsr | Y | - | Y | - |
| dTrsResWgt | Y | - | Y | - |
| dTrsResQty | Y | - | Y | - |

## 4. Table Name Mapping (verified via SYTABLEW)

| COBOL Prefix | TABNAM Value | C Record Name |
|-------------|-------------|---------------|
| INBISB | inbisb | inbisb_rec |
| INBISB2 | inbisb | inbisb_rec |
| INTPSB | intpsb | intpsb_rec |
| INTPSB2 | intpsb | intpsb_rec |
| INTPRD | intprd | intprd_rec |
| INRFRM | inrfrm | inrfrm_rec |
| INRMAT | inrmat | inrmat_rec |
| INRPRM | inrprm | inrprm_rec |
| INTPBC | intpbc | intpbc_rec |
| INTPSP | intpsp | intpsp_rec |
| INTPBP | intpbp | intpbp_rec |
| INRINQ | inrinq | inrinq_rec |
| INTPCU | intpcu | intpcu_rec |
| INTPVN | intpvn | intpvn_rec |
| INTPFP | intpfp | intpfp_rec |
| POTPOD | potpod | potpod_rec |
| POTPOD2 | potpod | potpod_rec |
| POTPTR | potptr | potptr_rec |
| POTPTR2 | potptr | potptr_rec |
| RVTRES | rvtres | rvtres_rec |
| TCTTSA | tcttsa | tcttsa_rec |
| PNTIPK | pntipk | pntipk_rec |
| IPTRPK | iptrpk | iptrpk_rec |
| INTPCR | intpcr | intpcr_rec |
| MCHQDS | mchqds | mchqds_rec |
| IPTJSO | iptjso | iptjso_rec |

## 5. BUSINESS-LOGIC — Top-Level Flow

1. Initialize all working-storage fields (INIT-WS-VARS)
2. **CHK-ISV-LIC:**
   - Call MCMDL-VLD-LIC with PRD-SPRD-ID = "ISV"
   - If MCMDL-RTN-STS = 0, set WS-ISV-LIC = 1
   - If WS-ISV-LIC = 0, exit silently (return success without doing anything)
3. **VALIDATE-LINKAGE:**
   - If PRS-MD not in ("1","2","3","4"), error 1500 data-el "PRS-MD"
   - If PRS-MD = "1" or "3" and ITM-CTL-NO = 0, error 1507 data-el "ITM-CTL-NO"
   - If PRS-MD = "2" or "4" and REF-PFX = spaces, error 1502 data-el "REF-PFX"
   - If PRS-MD = "2" or "4" and REF-NO = 0, error 1507 data-el "REF-NO"
4. **PROGRAM-LOGIC:**
   - Begin transaction
   - VALIDATE-REF-TABLES (no-op)
   - Dispatch:
     - Mode "1" or "3":
       - Copy input: ITM-CTL-NO, TRS-PCS/MSR/WGT/QTY, TRS-RES-PCS/MSR/WGT/QTY, REF-ITM, REF-SBITM to WS
       - Call UPD-ISB
     - Mode "2" or "4":
       - Call UPD-BY-REF
   - If OC-STATUS = 0: commit, set RTN-STS = 0
   - If OC-STATUS != 0: rollback

## 6. UPD-ISB (Modes 1/3)

1. Set WS-ISB-CTL-NO = 0, WS-SAV-ISB-CTL-NO = 0
2. If ALL of TRS-PCS, TRS-MSR, TRS-WGT, TRS-QTY, TRS-RES-PCS, TRS-RES-MSR, TRS-RES-WGT, TRS-RES-QTY = 0, exit (nothing to do)
3. Call GET-PRD-TABLES. If error, exit.
4. Call CHECK-LOCK. If error, exit.
5. Set WS-PCS-PER-BDL = 1, WS-PCS-PER-BDL-OVRD = 1
6. Set WS-ISB-CNFG = 0, call PSB-LOGIC. If error, exit.
7. Call SET-WS-PCS-PER-BDL. If error, exit.
8. Set WS-ISB-CNFG = 1, call PSB-LOGIC. If error, exit.

## 7. PSB-LOGIC

1. Call PRS-FND-FWD-PSB. If error, exit.
2. Call FILTER-PRD. If error, exit.
3. If WS-PRD-EXCL != 0:
   - If WS-ISB-CTL-NO != 0: set WS-DEL-ISB-CTL-NO = WS-ISB-CTL-NO, call DEL-PSB-LOGIC
   - Exit
4. If WS-ISB-CTL-NO != 0: call GET-ISB-FROM-PSB. If error, exit.
5. If WS-ISB-CTL-NO = 0: call GET-ISB. If error, exit.
6. Set WS-PCS-PER-BDL = ISB-STRD-PPER-BDL, WS-PCS-PER-BDL-OVRD = ISB-STRD-PPER-BDL
7. Call UPDATE-ISB. If error, exit.
8. Call UPDATE-PSB. If error, exit.

## 8. PRS-FND-FWD-PSB (Scan PSB for matching ISB)

Loop forward through intpsb_rec by KEY starting at:
- PSB-ITM-CTL-NO = WS-ITM-CTL-NO
- PSB-ISB-CNFG = WS-ISB-CNFG

Before loop: set WS-ISB-CTL-NO = 0, WS-DEL-ISB-CTL-NO = 0. Call SETUP-ISB-KEY.

Check-key break: exit if PSB-CMPY-ID != company OR PSB-ITM-CTL-NO != WS-ITM-CTL-NO OR PSB-ISB-CNFG != WS-ISB-CNFG.

Loop body:
1. Read inbisb_rec (ISB2 buffer) by KEY with ISB2-ISB-CTL-NO = PSB-ISB-CTL-NO
2. If read OK and ISB2-CNCTD-253 = ISB-CNCTD-253: set WS-ISB-CTL-NO = ISB2-ISB-CTL-NO, exit loop
3. If PRS-MD != "4" and PRD-INVT-STS != "N":
   - Set WS-DEL-ISB-CTL-NO = ISB2-ISB-CTL-NO
   - Call DEL-PSB-LOGIC

## 9. PRS-FND-REF-FWD-PSB (Scan PSB for reference-based update)

Same structure as PRS-FND-FWD-PSB but simpler body:
- Set WS-ISB-CTL-NO = PSB-ISB-CTL-NO, exit loop on first match
- No ISB2 comparison, no stale cleanup

## 10. DEL-PSB-LOGIC

1. Read-lock intpsb_rec (PSB2 buffer) by KEY: ITM-CTL-NO, ISB-CNFG, WS-DEL-ISB-CTL-NO
2. If locked: error 1520 "INTPSB", exit
3. Delete the PSB2 record

## 11. SETUP-ISB-KEY (Build 253-byte concatenated key)

Initialize ISB-RECORD, then populate:

| ISB Field | Source |
|-----------|--------|
| ISB-ISB-CNFG | WS-ISB-CNFG |
| ISB-BGT-FOR | PRD-BGT-FOR (but if "C" or "P", set to "K") |
| ISB-BGT-FOR-ID | spaces (always) |
| ISB-BGT-FOR-SLP | PSP-BGT-FOR-SLP (only if PRD-BGT-FOR = "S") |
| ISB-FRM | PRD-FRM |
| ISB-GRD | PRD-GRD |
| ISB-SIZE | PRD-SIZE |
| ISB-FNSH | PRD-FNSH |
| ISB-EF-SVAR | PRD-EF-SVAR |
| ISB-WDTH | PRD-WDTH |
| ISB-LGTH | PRD-LGTH |
| ISB-ODIA | PRD-ODIA |
| ISB-GA-SIZE | PRD-GA-SIZE |
| ISB-WHS | PRD-WHS |
| ISB-BRH | PRD-BRH |
| ISB-INVT-QLTY | PRD-INVT-QLTY |
| ISB-INVT-CAT | INQ-INVT-CAT |
| ISB-ORIG-ZN | PRD-ORIG-ZN |
| ISB-OWNR | WS-OWNR |
| ISB-OWNR-REF-ID | WS-OWNR-REF-ID |
| ISB-PART-CUS-ID | spaces |
| ISB-PART | spaces |
| ISB-PART-REVNO | spaces |
| ISB-PO-ARR-TO-DT | POD-ARR-TO-DT if PRD-TRNT-PFX="PO", PTR-ARR-TO-DT if "PT" |
| ISB-INCM-PFX | PRD-TRNT-PFX if INVT-STS="I", else spaces |
| ISB-INCM-NO | PRD-TRNT-NO if INVT-STS="I", else 0 |
| ISB-INCM-ITM | PRD-TRNT-ITM if INVT-STS="I", else 0 |
| ISB-INCM-SBITM | PRD-TRNT-SBITM if INVT-STS="I", else 0 |
| ISB-INCM-SEQ-NO | PRD-TRNT-SEQ-NO if INVT-STS="I", else 0 |
| ISB-PCS-PER-BDL | WS-PCS-PER-BDL-OVRD |

Then copy all key fields to STRD (stored) columns:
- ISB-STRD-BGT-FOR = ISB-BGT-FOR
- ISB-STRD-BF-ID = ISB-BGT-FOR-ID
- ISB-STRD-FRM = ISB-FRM
- ISB-STRD-GRD = ISB-GRD
- ISB-STRD-SIZE = ISB-SIZE
- ISB-STRD-FNSH = ISB-FNSH
- ISB-STRD-EF-SVAR = ISB-EF-SVAR
- ISB-STRD-WDTH = ISB-WDTH
- ISB-STRD-LGTH = ISB-LGTH
- ISB-STRD-ODIA = ISB-ODIA
- ISB-STRD-GA-SIZE = ISB-GA-SIZE
- ISB-STRD-WHS = ISB-WHS
- ISB-STRD-BRH = ISB-BRH
- ISB-STRD-INVT-QLTY = ISB-INVT-QLTY
- ISB-STRD-INVT-CAT = ISB-INVT-CAT
- ISB-STRD-ORIG-ZN = ISB-ORIG-ZN
- ISB-STRD-OWNR = ISB-OWNR
- ISB-STRD-OWNR-RFID = ISB-OWNR-REF-ID
- ISB-STRD-PA-CUS-ID = ISB-PART-CUS-ID
- ISB-STRD-PA = ISB-PART
- ISB-STRD-PA-REVNO = ISB-PART-REVNO
- ISB-SPOAT-DT = ISB-PO-ARR-TO-DT
- ISB-SINCM-PFX = ISB-INCM-PFX
- ISB-SINCM-NO = ISB-INCM-NO
- ISB-SINCM-ITM = ISB-INCM-ITM
- ISB-SINCM-SBITM = ISB-INCM-SBITM
- ISB-SINCM-SEQ-NO = ISB-INCM-SEQ-NO
- ISB-STRD-PPER-BDL = ISB-PCS-PER-BDL

## 12. GET-ISB-FROM-PSB

1. Set WS-ISB-FND = 0
2. Read-lock inbisb_rec by KEY: ISB-ISB-CTL-NO = WS-ISB-CTL-NO
3. If locked: error 1520 "INBISB", exit
4. If not found: error 1508 "INBISB", exit
5. Set WS-ISB-FND = 1

## 13. GET-ISB (Find or create ISB by concatenated key)

1. Set WS-ISB-FND = 1 (assume found)
2. Call SETUP-ISB-KEY
3. Read-lock inbisb_rec by KEY1 (concatenated key ISB-CNCTD-253)
4. If locked: error 1520 "INBISB", exit
5. If not found:
   a. Reinitialize ISB-RECORD, call SETUP-ISB-KEY again
   b. Call SCZSEQ with TBL-PFX="ISB" to get new ISB-CTL-NO
   c. Set WS-ISB-FND = 0, WS-ESM-PRS-MD = "A"
   d. Write ISB
   e. If DUPLICATE-PRIMARY-KEY: retry from step 1 (GO TO GET-ISB)
   f. If write OK: call CALL-LUCESM (mode "A"), then retry from step 1
   g. If write error: error 1508 "INBISB", exit

## 14. CALC-NEW-QTY

1. Set WS-OHD-BDL = 1, WS-RES-BDL = 1
2. If WS-PCS-PER-BDL != 0:
   - WS-OHD-BDL = round(WS-TRS-PCS / WS-PCS-PER-BDL-OVRD)
   - WS-RES-BDL = round(WS-TRS-RES-PCS / WS-PCS-PER-BDL-OVRD)
3. If WS-ISB-CNFG = 0: ISB-TOT-OHD-PCS += WS-TRS-PCS
4. If WS-ISB-CNFG = 1:
   - If any TRS > 0: ISB-TOT-OHD-BDL += WS-OHD-BDL
   - Else if any TRS < 0: ISB-TOT-OHD-BDL -= WS-OHD-BDL
5. ISB-TOT-OHD-MSR += WS-TRS-MSR (rounded)
6. ISB-TOT-OHD-WGT += WS-TRS-WGT (rounded)
7. ISB-TOT-OHD-QTY += WS-TRS-QTY (rounded)
8. If WS-ISB-CNFG = 0: ISB-TOT-RES-PCS += WS-TRS-RES-PCS
9. If WS-ISB-CNFG = 1:
   - If any TRS-RES > 0: ISB-TOT-RES-BDL += WS-RES-BDL
   - Else if any TRS-RES < 0: ISB-TOT-RES-BDL -= WS-RES-BDL
10. ISB-TOT-RES-MSR += WS-TRS-RES-MSR (rounded)
11. ISB-TOT-RES-WGT += WS-TRS-RES-WGT (rounded)
12. ISB-TOT-RES-QTY += WS-TRS-RES-QTY (rounded)
13. ISB-TOT-AVL-BDL = ISB-TOT-OHD-BDL - ISB-TOT-RES-BDL (rounded)
14. ISB-TOT-AVL-PCS = ISB-TOT-OHD-PCS - ISB-TOT-RES-PCS (rounded)
15. ISB-TOT-AVL-MSR = ISB-TOT-OHD-MSR - ISB-TOT-RES-MSR (rounded)
16. ISB-TOT-AVL-WGT = ISB-TOT-OHD-WGT - ISB-TOT-RES-WGT (rounded)
17. ISB-TOT-AVL-QTY = ISB-TOT-OHD-QTY - ISB-TOT-RES-QTY (rounded)

## 15. UPDATE-ISB

1. Set WS-ESM-PRS-MD = spaces, WS-ISB-ISB-CTL-NO = 0, WS-ISB-INCM-CTL-NO = 0
2. Copy WS-PRM-NUM-SIZE1..5 to ISB-NUM-SIZE1..5
3. Copy WS-INCM-CTL-NO to ISB-INCM-CTL-NO
4. Call CALC-NEW-QTY. If error, exit.
5. Save: WS-SAV-ISB-CTL-NO = ISB-ISB-CTL-NO
6. If all totals zero (ISB-TOT-OHD-BDL=0, RES-BDL=0, OHD-PCS=0, RES-PCS=0):
   - If WS-ISB-FND = 1: set WS-SAV-ISB-CTL-NO=0, WS-ESM-PRS-MD="D", delete ISB
7. Else if WS-ISB-FND = 1: set WS-ESM-PRS-MD="U", rewrite ISB
8. Else (new): set WS-ESM-PRS-MD="A", write ISB
9. If table error: error 1515 "INBISB", exit
10. If WS-ESM-PRS-MD != spaces: call CALL-LUCESM

## 16. UPDATE-PSB

1. Initialize PSB-RECORD
2. Set PSB-ITM-CTL-NO = WS-ITM-CTL-NO, PSB-ISB-CNFG = WS-ISB-CNFG, PSB-ISB-CTL-NO = WS-ISB-CTL-NO
3. Read-lock intpsb_rec by KEY
4. If locked: error 1520 "INTPSB", exit
5. If not found:
   - If WS-SAV-ISB-CTL-NO = 0: exit (PSB not needed since ISB was deleted)
   - Else: call SETUP-PSB, write new PSB. If write error: error 1514, exit.
   - Exit
6. If WS-SAV-ISB-CTL-NO = WS-ISB-CTL-NO: exit (no change needed)
7. Delete existing PSB. If error: error 1516, exit.
8. If WS-SAV-ISB-CTL-NO = 0: exit (ISB was deleted, PSB removed)
9. Call SETUP-PSB, write new PSB. If write error: error 1514, exit.

### SETUP-PSB
- PSB-ITM-CTL-NO = WS-ITM-CTL-NO
- PSB-ISB-CNFG = WS-ISB-CNFG
- PSB-ISB-CTL-NO = WS-SAV-ISB-CTL-NO

## 17. SET-WS-PCS-PER-BDL

1. WS-PCS-PER-BDL = PRD-OHD-PCS
2. If PRD-INVT-STS = "N": WS-PCS-PER-BDL = WS-TRS-RES-PCS
3. If IPK-PCS-PER-TAG != 0: WS-PCS-PER-BDL = IPK-PCS-PER-TAG
4. If RPK-PCS-PER-TAG != 0: WS-PCS-PER-BDL = RPK-PCS-PER-TAG
5. WS-PCS-PER-BDL-OVRD = WS-PCS-PER-BDL
6. If WS-PCS-PER-BDL = 0: WS-PCS-PER-BDL-OVRD = 1

## 18. FILTER-PRD

1. Set WS-PRD-EXCL = 0
2. If PRD-INVT-TYP = "S" or "R": set WS-PRD-EXCL = 1, exit
3. If PRD-HLD-STS != spaces: set WS-PRD-EXCL = 1, exit
4. If PRD-INVT-STS not in ("S","I","N"): set WS-PRD-EXCL = 1, exit
5. If PRD-BGT-FOR not in ("K","C","P"): set WS-PRD-EXCL = 1, exit
6. If WS-PRD-ON-QDS = 1 and QDS-APVD-FLG = 0: set WS-PRD-EXCL = 1, exit

## 19. GET-PRD-TABLES

1. Read intprd_rec by KEY: ITM-CTL-NO = WS-ITM-CTL-NO. If not found: error 1500 "INTPRD".
2. If PRD-INVT-STS = "I": set WS-INCM-CTL-NO = WS-ITM-CTL-NO, else 0.
3. Read inrfrm_rec by KEY: FRM = PRD-FRM. If not found: error 1500 "FRM".
4. Read inrmat_rec by KEY: FRM = PRD-FRM, GRD = PRD-GRD. If not found: error 1500 "FRM".
5. Read inrprm_rec by KEY: FRM = PRD-FRM, GRD = PRD-GRD, SIZE = PRD-SIZE, FNSH = PRD-FNSH. If not found: error 1500 "FRM".
6. If CSC-BAS-MSR = "E": use PRM-E-NUM-SIZE1..5, else PRM-M-NUM-SIZE1..5 -> WS-PRM-NUM-SIZE1..5.
7. If PRD-BGT-FOR = "C": read intpbc_rec by ITM-CTL-NO. If not found: error 1500 "INTPBC".
8. If PRD-BGT-FOR = "S": read intpsp_rec by ITM-CTL-NO. If not found: error 1500 "INTPSP".
9. If PRD-BGT-FOR = "P": read intpbp_rec by ITM-CTL-NO. If not found: error 1500 "INTPBP".
10. Read inrinq_rec by INVT-QLTY = PRD-INVT-QLTY. If not found: error 1500 "INRINQ".
11. Set WS-OWNR = PRD-OWNR.
12. If PRD-OWNR = "C": read intpcu_rec by ITM-CTL-NO. If not found: error 1500 "INTPCU". Set WS-OWNR-REF-ID = PCU-CUS-ID.
13. If PRD-OWNR = "V": read intpvn_rec by ITM-CTL-NO. If not found: error 1500 "INTPVN". Set WS-OWNR = "O", WS-OWNR-REF-ID = spaces.
14. If PRD-PROD-FOR = 1: read intpfp_rec by ITM-CTL-NO. If not found: error 1500 "INTPFP".
15. If PRD-TRNT-PFX = "PO": read potpod_rec by PO-PFX/NO/ITM/DIST. If not found: initialize POD.
16. If PRD-TRNT-PFX = "PT": read potptr_rec by PTR-PFX/NO/ITM/SBITM. If not found: initialize PTR.
17. IPK/RPK logic:
    - If PRD-INVT-STS = "N" or "I" and PRD-TRNT-PFX = "PO" or "PT":
      read pntipk_rec by REF-PFX="PO", REF-NO=PRD-TRNT-NO, REF-ITM=PRD-TRNT-ITM. If not found: initialize IPK.
    - If IPK-PCS-PER-TAG = 0 and REF-PFX not blank:
      - If REF-PFX = "JS": scan iptjso_rec (PRS-SO-IPK-FWD-JSO) by JBS-PFX/NO to get IPK from first JSO
      - Else: read pntipk_rec by REF-PFX (normalize PO/PT to "PO"), REF-NO, WS-REF-ITM
    - If PRD-INVT-STS not "N"/"I" and ORD-FFM-PFX = "SO" or "IP":
      - If REF-PFX not blank: read iptrpk_rec by JBS-PFX=REF-PFX, JBS-NO=REF-NO, REF-PFX=ORD-FFM-PFX, REF-NO=ORD-FFM-NO, REF-ITM=ORD-FFM-ITM
      - If ORD-FFM-PFX = "SO": read pntipk_rec by ORD-FFM-PFX/NO/ITM
18. Read intpcr_rec by ITM-CTL-NO. If not found: initialize PCR.
19. If PCR-QDS-CTL-NO != 0: set WS-PRD-ON-QDS=1, read mchqds_rec by QDS-CTL-NO. If not found: initialize QDS.

## 20. CHECK-LOCK

1. Call SCZTLK with:
   - PRS-MD = "3"
   - REF-PFX = "IN"
   - TRS-ID = "PRM-" + PRM-REF-CTL-NO (padded to 20 chars)
2. If TLKUO-RTN-STS = 1 (lock found by different process):
   - Error 1520 "INRPRM", exit with error

## 21. CALL-LUCESM

1. If PRS-MD = "3" (mode from inzibu): exit (skip LUCESM)
2. Call LUCESM with:
   - ESMUI-PRS-MD = WS-ESM-PRS-MD ("A", "U", or "D")
   - ESMUI-CMPY-ID = CSC-CMPY-ID
   - ESMUI-ISB-CTL-NO = WS-ISB-ISB-CTL-NO
   - ESMUI-INCM-CTL-NO = WS-ISB-INCM-CTL-NO
3. If ESMUO-RTN-STS = 1: exit (but no error set)

## 22. UPD-BY-REF (Mode 2/4)

1. Call CHK-HDR-TSA
2. Dispatch by IBSUI-REF-PFX:
   - "PO": call PRS-UPD-FWD-POD2
   - "PT": call PRS-UPD-FWD-PTR2
   - Other: call PRS-UPD-FWD-RES

## 23. CHK-HDR-TSA

1. Set WS-HDR-ADD-TSA-OK = 0, WS-ITM-ADD-TSA-OK = 0
2. If REF-PFX != "PO" and != "PT": exit (only check for PO/PT)
3. Read tcttsa_rec: REF-PFX, REF-NO, REF-ITM=0, REF-SBITM=0, STS-TYP="T"
   - If not found or TSA-STS-ACTN != "A": set WS-HDR-ADD-TSA-OK = 1, exit
4. Read tcttsa_rec: REF-PFX, REF-NO, REF-ITM=0, REF-SBITM=0, STS-TYP="A"
   - If not found or TSA-STS-ACTN != "A": set WS-HDR-ADD-TSA-OK = 1, exit

## 24. CHK-ITM-TSA

1. Set WS-ITM-ADD-TSA-OK = 0
2. If REF-PFX != "PO" and != "PT": exit
3. Read tcttsa_rec: REF-PFX, REF-NO, REF-ITM=WS-REF-ITM, REF-SBITM=0, STS-TYP="T"
   - If not found or TSA-STS-ACTN != "A": set WS-ITM-ADD-TSA-OK = 1, exit

## 25. PRS-UPD-FWD-POD2 (Loop POD2 records)

Loop forward through potpod_rec (POD2 buffer) by KEY starting at:
- PO-PFX = REF-PFX, PO-NO = REF-NO, PO-ITM = REF-ITM, PO-DIST = REF-SBITM

Break if: CMPY-ID changed OR PO-PFX changed OR PO-NO changed OR (PO-ITM changed AND REF-ITM != 0) OR (PO-DIST changed AND REF-SBITM != 0)

Body:
1. If POD2-ITM-CTL-NO = 0: skip (continue loop)
2. Set WS-ITM-CTL-NO = POD2-ITM-CTL-NO, WS-REF-ITM = POD2-PO-ITM, WS-REF-SBITM = POD2-PO-DIST
3. Call UPD-BY-REF-LOGIC. If error, exit loop.
4. Call PRS-POD2-FWD-PTR2 (nested PTR2 loop). If error, exit loop.

## 26. PRS-POD2-FWD-PTR2 (Nested PTR2 loop within POD2)

Loop forward through potptr_rec (PTR2 buffer) by KEY1 starting at:
- PO-PFX = POD2-PO-PFX, PO-NO = POD2-PO-NO, PO-ITM = POD2-PO-ITM, PO-DIST = POD2-PO-DIST

Break if: any of these 4 fields changed.

Body:
1. If PTR2-ITM-CTL-NO = 0: skip
2. WS-ITM-CTL-NO = PTR2-ITM-CTL-NO
3. Call UPD-BY-REF-LOGIC

## 27. PRS-UPD-FWD-PTR2 (Loop PTR2 records for mode 2 "PT")

Loop forward through potptr_rec (PTR2 buffer) by KEY starting at:
- PTR-PFX = REF-PFX, PTR-NO = REF-NO, PTR-ITM = REF-ITM, PTR-SBITM = REF-SBITM

Break if: PTR-PFX changed OR PTR-NO changed OR (PTR-ITM changed AND REF-ITM != 0) OR (PTR-SBITM changed AND REF-SBITM != 0)

Body:
1. If PTR2-ITM-CTL-NO = 0: skip
2. WS-ITM-CTL-NO = PTR2-ITM-CTL-NO, WS-REF-ITM = PTR2-PTR-ITM, WS-REF-SBITM = PTR2-PTR-SBITM
3. Call UPD-BY-REF-LOGIC

## 28. PRS-UPD-FWD-RES (Loop RES records)

Loop forward through rvtres_rec by KEY1 starting at:
- REF-PFX = REF-PFX, REF-NO = REF-NO, REF-ITM = REF-ITM, REF-SBITM = REF-SBITM

Break if: REF-PFX changed OR REF-NO changed OR (REF-ITM changed AND REF-ITM != 0) OR (REF-SBITM changed AND REF-SBITM != 0)

Body:
1. WS-ITM-CTL-NO = RES-ITM-CTL-NO, WS-REF-ITM = RES-REF-ITM, WS-REF-SBITM = RES-REF-SBITM
2. If PRS-MD != "4": call UPD-BY-RES-LOGIC
3. If PRS-MD = "4": call DEL-BY-RES-LOGIC

## 29. UPD-BY-REF-LOGIC (For PO/PT references)

1. Call GET-PRD-TABLES. If error, exit.
2. Call CHECK-LOCK. If error, exit.
3. Call CHK-ITM-TSA. If error, exit.
4. Set WS-ISB-CNFG = 0

**Label UPD-BY-REF-LOGIC-50:**
5. Call PRS-FND-REF-FWD-PSB (find existing ISB for this product).
6. If WS-ISB-CTL-NO = 0: go to step 11 (no old summary to reverse)
7. Compute reverse quantities:
   - WS-TRS-PCS = PRD-OHD-PCS * -1
   - WS-TRS-MSR = PRD-OHD-MSR * -1
   - WS-TRS-WGT = PRD-OHD-WGT * -1
   - WS-TRS-QTY = PRD-OHD-QTY * -1
   - WS-TRS-RES-PCS = (PRD-QTE-RES-PCS + PRD-ORD-RES-PCS + PRD-PROD-RES-PCS + PRD-SHP-RES-PCS) * -1
   - WS-TRS-RES-MSR = (PRD-QTE-RES-MSR + PRD-ORD-RES-MSR + PRD-PROD-RES-MSR + PRD-SHP-RES-MSR) * -1
   - WS-TRS-RES-WGT = (PRD-QTE-RES-WGT + PRD-ORD-RES-WGT + PRD-PROD-RES-WGT + PRD-SHP-RES-WGT) * -1
   - WS-TRS-RES-QTY = (PRD-QTE-RES-QTY + PRD-ORD-RES-QTY + PRD-PROD-RES-QTY + PRD-SHP-RES-QTY) * -1
8. Call GET-ISB-FROM-PSB (lock existing ISB). If error, exit.
9. WS-PCS-PER-BDL = ISB-STRD-PPER-BDL, WS-PCS-PER-BDL-OVRD = ISB-STRD-PPER-BDL
10. Call UPDATE-ISB, UPDATE-PSB. If error, exit.

**Label UPD-BY-REF-LOGIC-100:**
11. If WS-HDR-ADD-TSA-OK != 0 or WS-ITM-ADD-TSA-OK != 0: go to step 15 (skip add)
12. If WS-ISB-CNFG = 1: call SET-WS-PCS-PER-BDL
13. Compute add quantities:
   - WS-TRS-PCS = PRD-OHD-PCS
   - WS-TRS-MSR = PRD-OHD-MSR
   - WS-TRS-WGT = PRD-OHD-WGT
   - WS-TRS-QTY = PRD-OHD-QTY
   - WS-TRS-RES-PCS = PRD-QTE-RES-PCS + PRD-ORD-RES-PCS + PRD-PROD-RES-PCS + PRD-SHP-RES-PCS
   - Same for MSR, WGT, QTY
14. Call PSB-LOGIC. If error, exit.

**Label UPD-BY-REF-LOGIC-200:**
15. If WS-ISB-CNFG = 0: set WS-ISB-CNFG = 1, go to step 5 (UPD-BY-REF-LOGIC-50)

## 30. UPD-BY-RES-LOGIC (For reservation references, mode 2)

1. Call GET-PRD-TABLES. If error, exit.
2. If PRD-INVT-STS != "N": exit
3. Call CHECK-LOCK. If error, exit.
4. Call CHK-ITM-TSA. If error, exit.
5. If WS-HDR-ADD-TSA-OK != 0 or WS-ITM-ADD-TSA-OK != 0: exit
6. Set WS-ISB-CNFG = 0, WS-PCS-PER-BDL = 1, WS-PCS-PER-BDL-OVRD = 1

**Label UPD-BY-RES-LOGIC-50:**
7. If WS-ISB-CNFG = 1: call SET-WS-PCS-PER-BDL
8. Call PRS-FND-FWD-PSB
9. Set TRS-PCS/MSR/WGT/QTY = 0
10. WS-TRS-RES-PCS = RES-RES-PCS (positive), same for MSR/WGT/QTY
11. Call PSB-LOGIC
12. If WS-ISB-CNFG = 0: set WS-ISB-CNFG = 1, go to step 7

## 31. DEL-BY-RES-LOGIC (For reservation references, mode 4)

1. Call GET-PRD-TABLES. If error, exit.
2. If PRD-INVT-STS != "N": exit
3. Call CHECK-LOCK. If error, exit.
4. Call CHK-ITM-TSA. If error, exit.
5. Set WS-ISB-CNFG = 0, WS-PCS-PER-BDL = 1, WS-PCS-PER-BDL-OVRD = 1

**Label DEL-BY-RES-LOGIC-50:**
6. If WS-ISB-CNFG = 1: call SET-WS-PCS-PER-BDL
7. Call PRS-FND-FWD-PSB
8. If WS-ISB-CTL-NO = 0: exit (nothing to reverse)
9. Set TRS-PCS/MSR/WGT/QTY = 0
10. WS-TRS-RES-PCS = RES-RES-PCS * -1 (negate), same for MSR/WGT/QTY
11. Call GET-ISB-FROM-PSB. WS-PCS-PER-BDL = ISB-STRD-PPER-BDL.
12. Call UPDATE-ISB, UPDATE-PSB
13. If WS-ISB-CNFG = 0: set WS-ISB-CNFG = 1, go to step 6

## 32. PRS-SO-IPK-FWD-JSO (Get IPK from first JSO for "JS" reference)

Loop forward through iptjso_rec by KEY starting at:
- JSO-JBS-PFX = IBSUI-REF-PFX, JSO-JBS-NO = IBSUI-REF-NO

Break if: JBS-PFX changed OR JBS-NO changed

Body (first match only):
1. Read pntipk_rec: IPK-REF-PFX = JSO-ORD-PFX, IPK-REF-NO = JSO-ORD-NO, IPK-REF-ITM = JSO-ORD-ITM
2. If not found: initialize IPK
3. Exit loop

## 33. Inline Frames

The following inline frames are used for quantity derivation. They are data-computation frames that determine the ISB quantity type fields:

- **INBDRQTY**: derives ISB measure/weight/quantity types from FRM fields
- **SCBPCFQT**: derives pieces factor from PRM num-size fields and PRD invt-sts
- **SCBMSFQT**: derives measure factor from FRM and PRD invt-sts
- **SCBWGFQT**: derives weight factor from FRM and PRD invt-sts

These frames populate WS-ISB-PCS-TYP, WS-ISB-MSR-TYP, WS-ISB-WGT-TYP and related factor fields. They are called during GET-PRD-TABLES processing but their results feed into SETUP-ISB-KEY and CALC-NEW-QTY indirectly via the working-storage fields.

Note: These inline frames are data-definition and simple computation frames. In the C implementation, their logic should be stubbed with TODO comments until the frame specs are available.
