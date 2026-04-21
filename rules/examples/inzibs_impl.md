# INZIBS — Implementation Specification (Language-Neutral)

## Service Overview

| Property | Value |
|----------|-------|
| Service | inzibs |
| Database | PostgreSQL |
| Transactional | Yes |
| Purpose | Maintain inventory summary by bundles (ISB) and product-summary-by-bundle (PSB) records |

### Endpoints

| Entry Point | Mode | Description |
|-------------|------|-------------|
| inzibsupd | 1 | Direct ISB update for a product item |
| inzibsref | 2 | Reference-based ISB update (PO/PT/RES) |
| inzibsfrm | 3 | ISB update from inzibu (skips eCOMMERCE notification) |
| inzibsdel | 4 | Reference-based ISB delete (negate reservation quantities) |

## External Dependencies

| Service | Purpose | Parameters | Notes |
|---------|---------|------------|-------|
| MCMDL-VLD-LIC | Check eCOMMERCE license | prd_sprd_id = "ISV" | If not licensed, exit silently |
| SCZTLK | Transaction lock check | prs_md="3", ref_pfx="IN", trs_id="PRM-{prm_ref_ctl_no}" | Returns 1 if locked by another process |
| SCZSEQ | Get next sequence number | tbl_pfx="ISB" | Returns new ISB control number |
| LUCESM | eCOMMERCE index maintenance | prs_md="A"/"U"/"D", cmpy_id, isb_ctl_no, incm_ctl_no | Skipped in mode 3 |

## Database Tables

### Primary Tables (Read/Write)

**inbisb_rec** — Inventory Summary by Bundles
- KEY: isb_cmpy_id, isb_isb_ctl_no
- KEY1: isb_cmpy_id, isb_cnctd_253 (253-byte concatenated key)
- Quantity fields: isb_tot_ohd_pcs, isb_tot_ohd_bdl, isb_tot_ohd_msr, isb_tot_ohd_wgt, isb_tot_ohd_qty, isb_tot_res_pcs, isb_tot_res_bdl, isb_tot_res_msr, isb_tot_res_wgt, isb_tot_res_qty, isb_tot_avl_pcs, isb_tot_avl_bdl, isb_tot_avl_msr, isb_tot_avl_wgt, isb_tot_avl_qty
- Key composition fields: isb_isb_cnfg, isb_bgt_for, isb_bgt_for_id, isb_frm, isb_grd, isb_size, isb_fnsh, isb_ef_svar, isb_wdth, isb_lgth, isb_odia, isb_ga_size, isb_whs, isb_brh, isb_invt_qlty, isb_invt_cat, isb_orig_zn, isb_ownr, isb_ownr_ref_id, isb_part_cus_id, isb_part, isb_part_revno, isb_po_arr_to_dt, isb_incm_pfx, isb_incm_no, isb_incm_itm, isb_incm_sbitm, isb_incm_seq_no, isb_pcs_per_bdl
- Stored (denormalized) columns: isb_strd_bgt_for, isb_strd_bf_id, isb_strd_frm, isb_strd_grd, isb_strd_size, isb_strd_fnsh, isb_strd_ef_svar, isb_strd_wdth, isb_strd_lgth, isb_strd_odia, isb_strd_ga_size, isb_strd_whs, isb_strd_brh, isb_strd_invt_qlty, isb_strd_invt_cat, isb_strd_orig_zn, isb_strd_ownr, isb_strd_ownr_rfid, isb_strd_pa_cus_id, isb_strd_pa, isb_strd_pa_revno, isb_spoat_dt, isb_sincm_pfx, isb_sincm_no, isb_sincm_itm, isb_sincm_sbitm, isb_sincm_seq_no, isb_strd_pper_bdl
- Size fields: isb_num_size1..5, isb_incm_ctl_no

**intpsb_rec** — Product Summary by Bundle
- KEY: psb_cmpy_id, psb_itm_ctl_no, psb_isb_cnfg, psb_isb_ctl_no
- Links a product (itm_ctl_no) to an ISB (isb_ctl_no) with bundle configuration (isb_cnfg: 0=unbundled, 1=bundled)

### Reference Tables (Read-Only)

| Table | KEY Fields | Used For |
|-------|-----------|----------|
| intprd_rec | prd_cmpy_id, prd_itm_ctl_no | Product master — source of all product attributes |
| inrfrm_rec | frm_cmpy_id, frm_frm | Form reference |
| inrmat_rec | mat_cmpy_id, mat_frm, mat_grd | Material reference |
| inrprm_rec | prm_cmpy_id, prm_frm, prm_grd, prm_size, prm_fnsh | Product parameter (numeric sizes) |
| intpbc_rec | pbc_cmpy_id, pbc_itm_ctl_no | Budget for customer (if bgt_for="C") |
| intpsp_rec | psp_cmpy_id, psp_itm_ctl_no | Product salesperson (if bgt_for="S") |
| intpbp_rec | pbp_cmpy_id, pbp_itm_ctl_no | Budget for production (if bgt_for="P") |
| inrinq_rec | inq_cmpy_id, inq_invt_qlty | Inventory quality — provides invt_cat |
| intpcu_rec | pcu_cmpy_id, pcu_itm_ctl_no | Product customer (if ownr="C") |
| intpvn_rec | pvn_cmpy_id, pvn_itm_ctl_no | Product vendor (if ownr="V") |
| intpfp_rec | pfp_cmpy_id, pfp_itm_ctl_no | Product floor plan (if prod_for=1) |
| potpod_rec | pod_cmpy_id, pod_po_pfx, pod_po_no, pod_po_itm, pod_po_dist | PO detail |
| potptr_rec | ptr_cmpy_id, ptr_ptr_pfx, ptr_ptr_no, ptr_ptr_itm, ptr_ptr_sbitm | PO transfer |
| rvtres_rec | KEY1: res_cmpy_id, res_ref_pfx, res_ref_no, res_ref_itm, res_ref_sbitm | Reservation |
| tcttsa_rec | tsa_cmpy_id, tsa_ref_pfx, tsa_ref_no, tsa_ref_itm, tsa_ref_sbitm, tsa_sts_typ | Transaction status |
| pntipk_rec | ipk_cmpy_id, ipk_ref_pfx, ipk_ref_no, ipk_ref_itm | Inbound pack (pcs_per_tag) |
| iptrpk_rec | rpk_cmpy_id, rpk_jbs_pfx, rpk_jbs_no, rpk_ref_pfx, rpk_ref_no, rpk_ref_itm | Repack |
| intpcr_rec | pcr_cmpy_id, pcr_itm_ctl_no | Product cross-reference (qds_ctl_no) |
| mchqds_rec | qds_cmpy_id, qds_qds_ctl_no | Quality disposition |
| iptjso_rec | jso_cmpy_id, jso_jbs_pfx, jso_jbs_no | Job shop order |

## Input Parameters

### Mode 1/3 Input

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| sPrsMd | string(1) | Y | "1" or "3" |
| iItmCtlNo | integer | Y | Product item control number |
| iTrsPcs | integer | N | Transaction pieces |
| dTrsMsr | decimal(12,4) | N | Transaction measure |
| dTrsWgt | decimal(8,2) | N | Transaction weight |
| dTrsQty | decimal(12,4) | N | Transaction quantity |
| iTrsResPcs | integer | N | Reserved pieces |
| dTrsResMsr | decimal(14,4) | N | Reserved measure |
| dTrsResWgt | decimal(10,2) | N | Reserved weight |
| dTrsResQty | decimal(14,4) | N | Reserved quantity |
| iRefItm | integer | N | Reference item |
| iRefSbitm | integer | N | Reference sub-item |

### Mode 2/4 Input

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| sPrsMd | string(1) | Y | "2" or "4" |
| sRefPfx | string(2) | Y | Reference prefix ("PO","PT", or other) |
| iRefNo | integer | Y | Reference number |
| iRefItm | integer | N | Reference item (0=all) |
| iRefSbitm | integer | N | Reference sub-item (0=all) |

## Output

| Field | Type | Description |
|-------|------|-------------|
| iRtnSts | integer | 0=success, 1=error |

## Algorithm — Startup

```
FUNCTION checkLicense():
    call MCMDL-VLD-LIC with "ISV"
    IF return = 0 THEN licensed = true
    IF NOT licensed THEN return success (silent exit)

FUNCTION validateLinkage(input):
    IF prsMd NOT IN ("1","2","3","4") THEN error 1500 "PRS-MD"
    IF prsMd IN ("1","3") AND itmCtlNo = 0 THEN error 1507 "ITM-CTL-NO"
    IF prsMd IN ("2","4") AND refPfx is blank THEN error 1502 "REF-PFX"
    IF prsMd IN ("2","4") AND refNo = 0 THEN error 1507 "REF-NO"
```

## Algorithm — Mode 1/3 (updIsb)

```
FUNCTION updIsb(ws):
    IF all TRS quantities = 0 THEN return (nothing to do)

    getPrdTables(ws)        -- read product and related tables
    checkLock(ws)           -- verify PRM not locked

    pcsPerBdl = 1
    pcsPerBdlOvrd = 1

    isbCnfg = 0             -- unbundled pass
    psbLogic(ws)

    setWsPcsPerBdl(ws)      -- determine pieces per bundle

    isbCnfg = 1             -- bundled pass
    psbLogic(ws)
```

## Algorithm — psbLogic (Core)

```
FUNCTION psbLogic(ws):
    prsFndFwdPsb(ws)        -- scan PSB to find matching ISB
    filterPrd(ws)           -- check product exclusions

    IF prdExcl != 0 THEN
        IF isbCtlNo != 0 THEN delPsbLogic(ws, isbCtlNo)
        return

    IF isbCtlNo != 0 THEN
        getIsbFromPsb(ws)   -- lock existing ISB
    ELSE
        getIsb(ws)          -- find or create ISB by key

    pcsPerBdl = ISB.strd_pper_bdl
    pcsPerBdlOvrd = pcsPerBdl (or 1 if 0)

    updateIsb(ws)           -- calculate quantities and write/update/delete
    updatePsb(ws)           -- maintain PSB link record
```

## Algorithm — prsFndFwdPsb (Find matching ISB via PSB scan)

```
FUNCTION prsFndFwdPsb(ws):
    isbCtlNo = 0
    delIsbCtlNo = 0
    setupIsbKey(ws)

    SELECT * FROM intpsb_rec
     WHERE psb_cmpy_id = companyId
       AND psb_itm_ctl_no = itmCtlNo
       AND psb_isb_cnfg = isbCnfg
     ORDER BY psb_isb_ctl_no

    FOR EACH psbRow:
        read inbisb_rec by KEY where isb_isb_ctl_no = psbRow.isb_ctl_no

        IF found AND isb2.cnctd_253 = isb.cnctd_253 THEN
            isbCtlNo = isb2.isb_ctl_no
            EXIT loop

        IF prsMd != "4" AND prd.invt_sts != "N" THEN
            -- stale PSB: clean up
            delPsbLogic(ws, isb2.isb_ctl_no)
```

## Algorithm — setupIsbKey

```
FUNCTION setupIsbKey(ws):
    Build ISB record from product attributes:
    - isb_cnfg = ws.isbCnfg
    - bgt_for = prd.bgt_for (map "C","P" -> "K")
    - bgt_for_id = blank
    - bgt_for_slp = psp.bgt_for_slp (only if bgt_for="S")
    - frm, grd, size, fnsh, ef_svar, wdth, lgth, odia, ga_size = from PRD
    - whs, brh = from PRD
    - invt_qlty = prd.invt_qlty
    - invt_cat = inq.invt_cat
    - orig_zn = prd.orig_zn
    - ownr = ws.ownr (vendor mapped to "O")
    - ownr_ref_id = ws.ownrRefId
    - part_cus_id, part, part_revno = blank
    - po_arr_to_dt = pod.arr_to_dt if trnt_pfx="PO", ptr.arr_to_dt if "PT"
    - incm fields = from PRD trnt fields if invt_sts="I", else blank/zero
    - pcs_per_bdl = ws.pcsPerBdlOvrd

    Copy all key fields to stored (STRD) columns
```

## Algorithm — calcNewQty

```
FUNCTION calcNewQty(ws):
    ohdBdl = 1, resBdl = 1
    IF pcsPerBdl != 0 THEN
        ohdBdl = round(trsPcs / pcsPerBdlOvrd)
        resBdl = round(trsResPcs / pcsPerBdlOvrd)

    IF isbCnfg = 0: isb.tot_ohd_pcs += trsPcs
    IF isbCnfg = 1:
        IF any TRS positive: isb.tot_ohd_bdl += ohdBdl
        ELSE IF any TRS negative: isb.tot_ohd_bdl -= ohdBdl

    isb.tot_ohd_msr += trsMsr
    isb.tot_ohd_wgt += trsWgt
    isb.tot_ohd_qty += trsQty

    IF isbCnfg = 0: isb.tot_res_pcs += trsResPcs
    IF isbCnfg = 1:
        IF any TRS-RES positive: isb.tot_res_bdl += resBdl
        ELSE IF any TRS-RES negative: isb.tot_res_bdl -= resBdl

    isb.tot_res_msr += trsResMsr
    isb.tot_res_wgt += trsResWgt
    isb.tot_res_qty += trsResQty

    isb.tot_avl_bdl = isb.tot_ohd_bdl - isb.tot_res_bdl
    isb.tot_avl_pcs = isb.tot_ohd_pcs - isb.tot_res_pcs
    isb.tot_avl_msr = isb.tot_ohd_msr - isb.tot_res_msr
    isb.tot_avl_wgt = isb.tot_ohd_wgt - isb.tot_res_wgt
    isb.tot_avl_qty = isb.tot_ohd_qty - isb.tot_res_qty
```

## Algorithm — updateIsb

```
FUNCTION updateIsb(ws):
    Copy PRM num_size1..5 to ISB
    Copy incm_ctl_no to ISB
    calcNewQty(ws)
    savIsbCtlNo = isb.isb_ctl_no

    IF all totals zero (ohd_bdl, res_bdl, ohd_pcs, res_pcs):
        IF isbFnd = 1: delete ISB, esmPrsMd = "D"
    ELSE IF isbFnd = 1: update ISB, esmPrsMd = "U"
    ELSE: write new ISB, esmPrsMd = "A"

    IF error on write/update/delete: error 1515 "INBISB"
    IF esmPrsMd set: call LUCESM
```

## Algorithm — updatePsb

```
FUNCTION updatePsb(ws):
    Lock intpsb_rec by KEY: itmCtlNo, isbCnfg, isbCtlNo
    IF locked: error 1520 "INTPSB"

    IF not found:
        IF savIsbCtlNo = 0: return (nothing to create)
        create new PSB with itmCtlNo, isbCnfg, savIsbCtlNo
        IF write error: error 1514 "INTPSB"
        return

    IF savIsbCtlNo = isbCtlNo: return (no change)

    delete existing PSB
    IF error: error 1516 "INTPSB"

    IF savIsbCtlNo = 0: return (ISB was deleted)

    create new PSB with savIsbCtlNo
    IF write error: error 1514 "INTPSB"
```

## Algorithm — filterPrd

```
FUNCTION filterPrd(ws):
    prdExcl = 0
    IF prd.invt_typ IN ("S","R") THEN prdExcl = 1
    IF prd.hld_sts not blank THEN prdExcl = 1
    IF prd.invt_sts NOT IN ("S","I","N") THEN prdExcl = 1
    IF prd.bgt_for NOT IN ("K","C","P") THEN prdExcl = 1
    IF prdOnQds = 1 AND qds.apvd_flg = 0 THEN prdExcl = 1
```

## Algorithm — setWsPcsPerBdl

```
FUNCTION setWsPcsPerBdl(ws):
    pcsPerBdl = prd.ohd_pcs
    IF prd.invt_sts = "N": pcsPerBdl = trsResPcs
    IF ipk.pcs_per_tag != 0: pcsPerBdl = ipk.pcs_per_tag
    IF rpk.pcs_per_tag != 0: pcsPerBdl = rpk.pcs_per_tag
    pcsPerBdlOvrd = pcsPerBdl
    IF pcsPerBdl = 0: pcsPerBdlOvrd = 1
```

## Algorithm — getPrdTables

```
FUNCTION getPrdTables(ws):
    read intprd_rec by KEY (itmCtlNo). Error 1500 if not found.
    IF invt_sts = "I": incmCtlNo = itmCtlNo

    read inrfrm_rec by prd.frm. Error if not found.
    read inrmat_rec by prd.frm + prd.grd. Error if not found.
    read inrprm_rec by prd.frm + grd + size + fnsh. Error if not found.

    IF csc_bas_msr = "E": use prm.e_num_size1..5
    ELSE: use prm.m_num_size1..5

    IF prd.bgt_for = "C": read intpbc_rec
    IF prd.bgt_for = "S": read intpsp_rec
    IF prd.bgt_for = "P": read intpbp_rec

    read inrinq_rec by prd.invt_qlty

    ownr = prd.ownr
    IF ownr = "C": read intpcu_rec, ownrRefId = pcu.cus_id
    IF ownr = "V": read intpvn_rec, ownr = "O", ownrRefId = blank

    IF prd.prod_for = 1: read intpfp_rec

    IF prd.trnt_pfx = "PO": read potpod_rec (optional)
    IF prd.trnt_pfx = "PT": read potptr_rec (optional)

    IPK/RPK logic:
        IF invt_sts IN ("N","I") AND trnt_pfx IN ("PO","PT"):
            read pntipk_rec by "PO" + trnt_no + trnt_itm
        IF ipk.pcs_per_tag = 0 AND refPfx not blank:
            IF refPfx = "JS": scan iptjso_rec to get IPK from first JSO
            ELSE: read pntipk_rec by normalized refPfx + refNo + refItm
        IF invt_sts NOT IN ("N","I"):
            IF ord_ffm_pfx IN ("SO","IP"):
                IF refPfx not blank: read iptrpk_rec
                IF ord_ffm_pfx = "SO": read pntipk_rec

    read intpcr_rec (optional). IF pcr.qds_ctl_no != 0: read mchqds_rec
```

## Algorithm — Mode 2/4 (updByRef)

```
FUNCTION updByRef(ws):
    chkHdrTsa(ws)

    IF refPfx = "PO": prsUpdFwdPod2(ws)
    ELSE IF refPfx = "PT": prsUpdFwdPtr2(ws)
    ELSE: prsUpdFwdRes(ws)
```

## Algorithm — chkHdrTsa

```
FUNCTION chkHdrTsa(ws):
    hdrAddTsaOk = 0, itmAddTsaOk = 0
    IF refPfx NOT IN ("PO","PT") THEN return

    read tcttsa_rec: refPfx, refNo, refItm=0, sbitm=0, stsTyp="T"
    IF not found OR sts_actn != "A": hdrAddTsaOk = 1, return

    read tcttsa_rec: refPfx, refNo, refItm=0, sbitm=0, stsTyp="A"
    IF not found OR sts_actn != "A": hdrAddTsaOk = 1
```

## Algorithm — updByRefLogic (PO/PT items)

```
FUNCTION updByRefLogic(ws):
    getPrdTables(ws)
    checkLock(ws)
    chkItmTsa(ws)

    FOR isbCnfg IN (0, 1):   -- unbundled then bundled
        -- REMOVE old quantities
        prsFndRefFwdPsb(ws)  -- find existing ISB for this product
        IF isbCtlNo != 0:
            trsPcs = -prd.ohd_pcs
            trsMsr = -prd.ohd_msr
            trsWgt = -prd.ohd_wgt
            trsQty = -prd.ohd_qty
            trsResPcs = -(qte_res + ord_res + prod_res + shp_res) for pcs
            -- same for msr, wgt, qty
            getIsbFromPsb(ws)
            updateIsb(ws), updatePsb(ws)

        IF hdrAddTsaOk OR itmAddTsaOk: skip add (continue)

        IF isbCnfg = 1: setWsPcsPerBdl(ws)

        -- ADD current quantities
        trsPcs = prd.ohd_pcs
        trsMsr = prd.ohd_msr
        trsWgt = prd.ohd_wgt
        trsQty = prd.ohd_qty
        trsResPcs = qte_res + ord_res + prod_res + shp_res for pcs
        -- same for msr, wgt, qty
        psbLogic(ws)
```

## Algorithm — updByResLogic (Reservation items, mode 2)

```
FUNCTION updByResLogic(ws):
    getPrdTables(ws)
    IF prd.invt_sts != "N": return (skip)
    checkLock(ws)
    chkItmTsa(ws)
    IF hdr or itm TSA not approved: return

    FOR isbCnfg IN (0, 1):
        IF isbCnfg = 1: setWsPcsPerBdl(ws)
        prsFndFwdPsb(ws)
        trsPcs/msr/wgt/qty = 0
        trsResPcs = +res.res_pcs  -- positive (add)
        trsResMsr/Wgt/Qty = +res values
        psbLogic(ws)
```

## Algorithm — delByResLogic (Reservation items, mode 4)

```
FUNCTION delByResLogic(ws):
    getPrdTables(ws)
    IF prd.invt_sts != "N": return
    checkLock(ws)
    chkItmTsa(ws)

    FOR isbCnfg IN (0, 1):
        IF isbCnfg = 1: setWsPcsPerBdl(ws)
        prsFndFwdPsb(ws)
        IF isbCtlNo = 0: continue (nothing to reverse)
        trsPcs/msr/wgt/qty = 0
        trsResPcs = -res.res_pcs  -- negated (remove)
        trsResMsr/Wgt/Qty = negated res values
        getIsbFromPsb(ws)
        updateIsb(ws), updatePsb(ws)
```

## Algorithm — prsUpdFwdPod2 (PO reference loop)

```
SELECT * FROM potpod_rec
 WHERE pod_cmpy_id = companyId
   AND pod_po_pfx = refPfx AND pod_po_no = refNo
   [AND pod_po_itm = refItm if refItm != 0]
   [AND pod_po_dist = refSbitm if refSbitm != 0]
 ORDER BY pod_po_pfx, pod_po_no, pod_po_itm, pod_po_dist

FOR EACH podRow:
    IF pod.itm_ctl_no = 0: skip
    itmCtlNo = pod.itm_ctl_no
    refItm = pod.po_itm
    refSbitm = pod.po_dist
    updByRefLogic(ws)

    -- Nested PTR2 loop for this POD
    SELECT * FROM potptr_rec
     WHERE ptr_po_pfx = pod.po_pfx AND ptr_po_no = pod.po_no
       AND ptr_po_itm = pod.po_itm AND ptr_po_dist = pod.po_dist
    FOR EACH ptrRow:
        IF ptr.itm_ctl_no = 0: skip
        itmCtlNo = ptr.itm_ctl_no
        updByRefLogic(ws)
```

## Algorithm — prsUpdFwdPtr2 (PT reference loop)

```
SELECT * FROM potptr_rec
 WHERE ptr_cmpy_id = companyId
   AND ptr_ptr_pfx = refPfx AND ptr_ptr_no = refNo
   [AND ptr_ptr_itm = refItm if refItm != 0]
   [AND ptr_ptr_sbitm = refSbitm if refSbitm != 0]
 ORDER BY ptr_ptr_pfx, ptr_ptr_no, ptr_ptr_itm, ptr_ptr_sbitm

FOR EACH ptrRow:
    IF ptr.itm_ctl_no = 0: skip
    itmCtlNo = ptr.itm_ctl_no
    refItm = ptr.ptr_itm
    refSbitm = ptr.ptr_sbitm
    updByRefLogic(ws)
```

## Algorithm — prsUpdFwdRes (Other reference loop)

```
SELECT * FROM rvtres_rec
 WHERE res_cmpy_id = companyId
   AND res_ref_pfx = refPfx AND res_ref_no = refNo
   [AND res_ref_itm = refItm if refItm != 0]
   [AND res_ref_sbitm = refSbitm if refSbitm != 0]
 ORDER BY res_ref_pfx, res_ref_no, res_ref_itm, res_ref_sbitm

FOR EACH resRow:
    itmCtlNo = res.itm_ctl_no
    refItm = res.ref_itm
    refSbitm = res.ref_sbitm

    IF prsMd != "4": updByResLogic(ws)  -- add reservation
    ELSE: delByResLogic(ws)             -- remove reservation
```

## Error Codes

| Seq No | Data Element | Condition |
|--------|-------------|-----------|
| 1500 | PRS-MD | Invalid process mode |
| 1500 | INTPRD | Product record not found |
| 1500 | FRM | Form/material/parameter record not found |
| 1500 | INTPBC/INTPSP/INTPBP | Budget record not found |
| 1500 | INRINQ | Inventory quality record not found |
| 1500 | INTPCU/INTPVN | Owner record not found |
| 1500 | INTPFP | Floor plan record not found |
| 1502 | REF-PFX | Required field blank |
| 1507 | ITM-CTL-NO | Required field zero |
| 1507 | REF-NO | Required field zero |
| 1508 | INBISB | ISB record error |
| 1514 | INTPSB | PSB write error |
| 1515 | INBISB | ISB write/rewrite/delete error |
| 1516 | INTPSB/INBISB | Delete error |
| 1520 | INBISB/INTPSB/INRPRM | Record locked |
