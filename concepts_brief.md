# Google Sheets Mark Entry Sync Pipeline Optimization

* **Author:** safmuzammil
* **Date:** 2026-11-10

## Overview

This proposal optimizes the mark synchronization bridge between the Next.js portal (`TeacherPortalView.jsx` & `app/api/sheets/route.js`) and Google Sheets (`QH1`, `AL1`, `FC1`, `QH2`, `AL2`, `FC2`, `QLA3`, `HFC3`). 

The current Google Apps Script (`doPost`) performs up to 280+ remote spreadsheet RPC calls per class submission, leading to execution timeouts (>20 seconds) and triggering the frontend client's 10-second `AbortController` timeout. Furthermore, merged header rows and lack of formula protection create risks of formula corruption and misassigned marks.

The revised pipeline introduces $O(1)$ class sheet targeting, single-pass in-memory row/column resolution, formula collision shielding, strict curricular subject separation (`FIQH` vs `U :FIQH`, `LOGIC` vs `MANTIQ`), and deliberate exclusion of Specialization marks.

## Analysis

### 1. Root Cause Breakdown of Current Bottlenecks
* **RPC Call Storm**: The legacy `doPost` iterates over all spreadsheet tabs and calls `sheet.getDataRange().getValues()` repeatedly inside the student mark loop. For 35 students across 8 class tabs, this triggers 280+ remote spreadsheet reads.
* **Client-Side Abort Mismatch**: In `TeacherPortalView.jsx` (lines 775–783), an `AbortController` enforces a 10-second timeout. Because Google Apps Script takes 15–40 seconds to process the unoptimized nested loops, the browser aborts the request, falsely reporting a sync error to the user even after Firestore writes have completed.
* **Merged Header State Machine**: In Google Sheets, merged cells only store data in the top-left cell. When searching for column positions across sub-levels (`15`, `20`, `25`, `40`), the script must carry the active subject header across empty merged cells in Row 2.
* **Curricular Collisions**:
  * `FIQH` vs `U :FIQH` (Usulul Fiqh): Naïve substring checks (e.g. `sheetSub.includes('FIQH')`) cause false matches between Fiqh and Usulul Fiqh.
  * `LOGIC` vs `MANTIQ`: Requires bidirectional aliasing.
  * `Social Science`: Normalized to match `SOCIAL SCIENCE` and variations.
  * `HIFZ`: Uses two 50-mark evaluations (`50_1` and `50_2`), differing from standard CCE 4-level matrices.
  * `Specialization`: Explicitly skipped from Google Sheets sync by author confirmation (managed solely in Firebase).

### 2. High-Performance Algorithmic Redesign
* **Direct Class Sheet Targeting**: The client payload passes `targetClass` (e.g. `'QH1'`). Google Apps Script calls `ss.getSheetByName(targetClass)` directly in $O(1)$, bypassing all other class tabs.
* **Single-Pass Ingestion & In-Memory Lookup**:
  1. Call `sheet.getDataRange().getValues()` and `getFormulas()` exactly **once**.
  2. Traverse Row 2 (Subjects) and Row 3 (Levels) once to locate `targetColIndex` for the batch.
  3. Index Col B (`Reg.no`) and Col C (`Ad.No`) into in-memory lookup maps (`regMap` and `adMap`) in $O(N)$.
  4. Perform $O(1)$ row resolution for each student in the batch.
  5. Check `formulas[row][targetColIndex] === ""` before writing to guarantee formulas (`100`, `30`, `Status`, `Total`, `Rank`) are never overwritten.
  6. Execute atomic cell writes under a 6-second `LockService` lock.

## Goals vs. Non-Goals

* **In-Scope Goals:**
  * Eliminate Google Apps Script timeouts by reducing remote RPC calls from 280+ to $\le 2$ reads and localized updates (< 600ms total runtime).
  * Update `TeacherPortalView.jsx` payload to include `targetClass`, `adNo`, and `regNo`.
  * Support exact subject matching: strict `FIQH` vs `U :FIQH`, `LOGIC` vs `MANTIQ`, `Social Science`, and `HIFZ` (`50_1` / `50_2`).
  * Shield all formula columns (`100`, `30`, `Current Status`, `TOTAL`, `RANK`) from accidental data overwrites.
  * Gracefully skip Specialization marks from Google Sheets sync while preserving them in Firestore.

* **Out-of-Scope Non-Goals:**
  * Modifying the Google Sheets structure or visual cell layouts (all column positions and formula calculations remain untouched).
  * Syncing Attendance or Outpass logs to Google Sheets (restricted strictly to Academic Marks).
  * Replacing Google Sheets with an alternate external spreadsheet provider.

## Key Technical Trade-Offs & Decisions

| Decision | Selected Option | Alternative Rejected | Rationale |
| :--- | :--- | :--- | :--- |
| **Class Sheet Resolution** | Payload-driven `targetClass` routing (`ss.getSheetByName`) | Scanning all sheets sequentially | Reduces sheet access time by 87% (from 8 sheets down to 1). |
| **Formula Protection** | Verify `formulas[r][c] === ""` prior to writing | Full-grid `setValues(grid)` writeback | Writing full grid values overwrites and destroys formula chains in Sheets. |
| **Specialization Sync** | Skip sheet write completely | Writing to a custom /30 column | Author confirmed Specialization is handled in portal only and absent from standard class CCE tabs. |
| **Student Identification** | Dual-key matching (`Reg.no` or `Ad.No`) | `Reg.no` only | Accommodates older batches and Urdu-stream students whose identifier might be populated as admission number. |

## Open Questions / Follow-ups

1. **Client Timeout Threshold**: Should the frontend `AbortController` timeout in `TeacherPortalView.jsx` be expanded from 10s to 15s as an extra safety margin for slower network connections?
2. **Batch Admin Force Sync**: In `ReportManager.jsx` ("Force Sync ALL Marks"), should the client group marks by class and dispatch them in parallel class batches rather than one massive monolithic payload?

## Sign-off & Next Steps

The design resolves the Google Apps Script execution timeout, preserves all sheet formulas, and enforces curricular mapping invariants.
Recommended next step: Proceed to drafting (`/egm-draft`) to formalize the revised `Code.gs` script and client-side payload updates.
