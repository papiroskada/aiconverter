# INZIBS — Update Inventory Summary by Bundles

## Program Overview

| Field            | Value                                                    |
|------------------|----------------------------------------------------------|
| Program name     | inzibs                                                   |
| Service name     | inzibs                                                   |
| Transactional    | Y                                                        |
| Purpose          | Maintains inventory summary by bundles (ISB) and product summary by bundle (PSB) records based on product inventory changes |

## API Endpoint Table

| Mode | Function Name | Description |
|------|--------------|-------------|
| 1    | inzibsupd    | Update ISB: read product, find/create ISB, update quantities |
| 2    | inzibsref    | Update by reference: revisit all ISB for a PO/PT/other reference |
| 3    | inzibsfrm    | Update ISB from inzibu: same as mode 1 but skips LUCESM calls |
| 4    | inzibsdel    | Delete by reference: remove ISB entries for a reference |

## Shared Pre-Dispatch Logic

### CHK-ISV-LIC
- Call MCMDL-VLD-LIC with PRD-SPRD-ID = "ISV"
- If return status = 0, set ISV-LIC = 1 (licensed)
- If ISV-LIC = 0 (not licensed), exit silently (no error)

### VALIDATE-LINKAGE
- Validate PRS-MD is "1", "2", "3", or "4" (error 1500 "PRS-MD" if invalid)
- Modes 1/3: validate ITM-CTL-NO not zero (error 1507 "ITM-CTL-NO")
- Modes 2/4: validate REF-PFX not blank (error 1502 "REF-PFX")
- Modes 2/4: validate REF-NO not zero (error 1507 "REF-NO")

### VALIDATE-REF-TABLES
- Empty paragraph (no-op)

### PROGRAM-LOGIC
- Begin transaction
- Call VALIDATE-REF-TABLES (no-op)
- Dispatch by mode:
  - Mode 1/3: copy input fields to working storage, call UPD-ISB
  - Mode 2/4: call UPD-BY-REF
- If success: commit. If error: rollback.
- Set IBSUO-RTN-STS = 0 on success

## Mode 1/3 — UPD-ISB (Update ISB)

### Request Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| sPrsMd | X(1) | Y | "1" or "3" |
| iItmCtlNo | 9(10) | Y | Item control number |
| iTrsPcs | S9(7) | N | Transaction pieces |
| dTrsMsr | S9(12)V9(4) | N | Transaction measure |
| dTrsWgt | S9(8)V9(2) | N | Transaction weight |
| dTrsQty | S9(12)V9(4) | N | Transaction quantity |
| iTrsResPcs | S9(9) | N | Transaction reserved pieces |
| dTrsResMsr | S9(14)V9(4) | N | Transaction reserved measure |
| dTrsResWgt | S9(10)V9(2) | N | Transaction reserved weight |
| dTrsResQty | S9(14)V9(4) | N | Transaction reserved quantity |
| iRefItm | 9(3) | N | Reference item |
| iRefSbitm | 9(4) | N | Reference sub-item |

### Logic Summary
1. Skip if all TRS quantities are zero
2. GET-PRD-TABLES: read intprd, inrfrm, inrmat, inrprm, and conditionally pbc/psp/pbp/inq/pcu/pvn/pfp/pod/ptr/ipk/rpk/pcr/qds
3. CHECK-LOCK: verify PRM not locked via SCZTLK mode "3"
4. Run PSB-LOGIC for unbundled (ISB-CNFG=0)
5. SET-WS-PCS-PER-BDL: determine pieces-per-bundle
6. Run PSB-LOGIC for bundled (ISB-CNFG=1)

## Mode 2 — UPD-BY-REF (Update by Reference)

### Request Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| sPrsMd | X(1) | Y | "2" |
| sRefPfx | X(2) | Y | Reference prefix ("PO", "PT", or other) |
| iRefNo | 9(8) | Y | Reference number |
| iRefItm | 9(3) | N | Reference item (0 = all items) |
| iRefSbitm | 9(4) | N | Reference sub-item (0 = all sub-items) |

### Logic Summary
1. CHK-HDR-TSA: for PO/PT, check header transaction and authorization status
2. Dispatch by REF-PFX:
   - "PO": loop POD2 records, for each call UPD-BY-REF-LOGIC + loop PTR2
   - "PT": loop PTR2 records, for each call UPD-BY-REF-LOGIC
   - Other: loop RES records, for each call UPD-BY-RES-LOGIC
3. UPD-BY-REF-LOGIC: remove old quantities (negate OHD/RES), add current PRD quantities

## Mode 4 — DEL-BY-REF (Delete by Reference)

### Request Parameters
Same as Mode 2 but sPrsMd = "4"

### Logic Summary
Same dispatch as Mode 2 but for "other" (RES) references, calls DEL-BY-RES-LOGIC which negates reservation quantities instead of OHD.

## PSB-LOGIC (Core — shared by modes 1/2/3/4)
1. PRS-FND-FWD-PSB: scan PSB records for ITM-CTL-NO + ISB-CNFG. For each PSB, read ISB2 and compare ISB2-CNCTD-253 with current ISB-CNCTD-253. If match, use that ISB. Clean up stale PSB entries.
2. FILTER-PRD: exclude scrap/reject, on-hold, non-stock statuses, unapproved QDS
3. GET-ISB-FROM-PSB or GET-ISB: lock existing ISB or create new one
4. CALC-NEW-QTY: compute OHD-BDL and RES-BDL from TRS-PCS / PCS-PER-BDL, update all ISB quantity fields
5. UPDATE-ISB: if all totals zero, delete ISB. If existing, rewrite. If new, write.
6. UPDATE-PSB: maintain the PSB link record
7. CALL-LUCESM: notify eCOMMERCE (skipped in mode 3)

## FILTER-PRD (Exclusion Criteria)
- Scrap/reject (INVT-TYP "S"/"R")
- Items on hold (HLD-STS not spaces)
- Only INVT-STS "S"/"I"/"N" allowed
- Only BGT-FOR "K"/"C"/"P" allowed
- Unapproved QDS (PRD-ON-QDS=1 and QDS-APVD-FLG=0)

## Tables Reference

| COBOL Prefix | Table Name | Record Name | Key Fields |
|-------------|-----------|-------------|------------|
| ISB | inbisb | inbisb_rec | isb_cmpy_id + isb_isb_ctl_no |
| ISB2 | inbisb | inbisb_rec | isb_cmpy_id + isb_isb_ctl_no (2nd buffer) |
| PSB | intpsb | intpsb_rec | psb_cmpy_id + psb_itm_ctl_no + psb_isb_cnfg + psb_isb_ctl_no |
| PSB2 | intpsb | intpsb_rec | (2nd buffer, same table) |
| PRD | intprd | intprd_rec | prd_cmpy_id + prd_itm_ctl_no |
| FRM | inrfrm | inrfrm_rec | frm_cmpy_id + frm_frm |
| MAT | inrmat | inrmat_rec | mat_cmpy_id + mat_frm + mat_grd |
| PRM | inrprm | inrprm_rec | prm_cmpy_id + prm_frm + prm_grd + prm_size + prm_fnsh |
| PBC | intpbc | intpbc_rec | pbc_cmpy_id + pbc_itm_ctl_no |
| PSP | intpsp | intpsp_rec | psp_cmpy_id + psp_itm_ctl_no |
| PBP | intpbp | intpbp_rec | pbp_cmpy_id + pbp_itm_ctl_no |
| INQ | inrinq | inrinq_rec | inq_cmpy_id + inq_invt_qlty |
| PCU | intpcu | intpcu_rec | pcu_cmpy_id + pcu_itm_ctl_no |
| PVN | intpvn | intpvn_rec | pvn_cmpy_id + pvn_itm_ctl_no |
| PFP | intpfp | intpfp_rec | pfp_cmpy_id + pfp_itm_ctl_no |
| POD | potpod | potpod_rec | pod_cmpy_id + pod_po_pfx + pod_po_no + pod_po_itm + pod_po_dist |
| POD2 | potpod | potpod_rec | (2nd buffer) KEY: pod_cmpy_id + pod_po_pfx + pod_po_no + pod_po_itm + pod_po_dist |
| PTR | potptr | potptr_rec | ptr_cmpy_id + ptr_ptr_pfx + ptr_ptr_no + ptr_ptr_itm + ptr_ptr_sbitm |
| PTR2 | potptr | potptr_rec | (2nd buffer) |
| RES | rvtres | rvtres_rec | KEY1: res_cmpy_id + res_ref_pfx + res_ref_no + res_ref_itm + res_ref_sbitm |
| TSA | tcttsa | tcttsa_rec | tsa_cmpy_id + tsa_ref_pfx + tsa_ref_no + tsa_ref_itm + tsa_ref_sbitm + tsa_sts_typ |
| IPK | pntipk | pntipk_rec | ipk_cmpy_id + ipk_ref_pfx + ipk_ref_no + ipk_ref_itm |
| RPK | iptrpk | iptrpk_rec | rpk_cmpy_id + rpk_jbs_pfx + rpk_jbs_no + rpk_ref_pfx + rpk_ref_no + rpk_ref_itm |
| PCR | intpcr | intpcr_rec | pcr_cmpy_id + pcr_itm_ctl_no |
| QDS | mchqds | mchqds_rec | qds_cmpy_id + qds_qds_ctl_no |
| JSO | iptjso | iptjso_rec | jso_cmpy_id + jso_jbs_pfx + jso_jbs_no + ... |

## External Dependencies
- **LUCESM** — eCOMMERCE summary maintenance (add/update/delete ISB in lucene index)
- **SCZTLK** — Lock check service (mode "3": verify PRM not locked)
- **SCZSEQ** — Sequence number generator (TBL-PFX="ISB")
- **MCMDL-VLD-LIC** — License check (PRD-SPRD-ID="ISV")
- **INBDRQTY** — Inline frame for inventory quantity derivation
- **SCBPCFQT** — Inline frame for pieces factor quantity
- **SCBMSFQT** — Inline frame for measure factor quantity
- **SCBWGFQT** — Inline frame for weight factor quantity

## Output Fields
| Field | Type | Description |
|-------|------|-------------|
| iRtnSts | 9(4) | 0 = success, 1 = error |

## Error Messages
| Seq No | Data Element | Condition |
|--------|-------------|-----------|
| 1500 | PRS-MD | Invalid mode |
| 1500 | INTPRD | PRD record not found |
| 1500 | INTPBC/INTPSP/INTPBP/INRINQ/INTPCU/INTPVN/INTPFP | Required record not found |
| 1502 | REF-PFX | Required field blank (modes 2/4) |
| 1507 | ITM-CTL-NO | Required field zero (modes 1/3) |
| 1507 | REF-NO | Required field zero (modes 2/4) |
| 1508 | INBISB | ISB read error |
| 1514 | INTPSB | PSB write error |
| 1515 | INBISB | ISB write/rewrite/delete error |
| 1516 | INTPSB/INBISB | Delete error |
| 1520 | INBISB/INTPSB/INRPRM | Record locked |
