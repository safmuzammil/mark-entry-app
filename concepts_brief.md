# Attendance Clearance History, Night Roll-Call Polish & Student Portal Evaluation Logic

* **Author:** safmuzammil
* **Date:** 2026-11-10

## Overview

This specification establishes an authoritative architecture and user experience across three interrelated academic and residential subsystems in the Darul Huda Degree ERP:
1. **Attendance Clearance History Subsystem**: Unifying absence clearance from an isolated issuance utility into a permanent, verifiable, two-way audit trail that synchronizes across academic registries, period session caches, and the student portal.
2. **Night Roll-Call Subsystem**: Providing high-velocity mobile roll-call with single-tap gestures, live gate outpass cross-checks, dorm/room grouping, and unexcused absentee filtering.
3. **Student Portal Evaluation Logic**: Resolving mid-semester denominator skew ("35/490") by providing dynamic progress-weighted evaluation, transparent attendance shortage alerts (<85%), and clear distinction between Medical Leaves (Amber) and Official Duty (Teal).

## Analysis

### 1. Unified Clearance History & Two-Way Sync (`egm-codebase-details`, `egm-design`)
* **Collection Divergence**: Currently, `AbsenceClearanceManager.jsx` reads from both `clearance_history` and `clearance_certificates`, while `app/student/page.jsx` reads `clearance_certificates`.
* **Resolution**: Standardize on `clearance_history` as the primary collection with dual-key indexing on both registration number (`regNo`) and admission number (`adNo`).
* **Audit Integrity**: Store an immutable audit trail capturing who cleared the session, the exact category (`MEDICAL_LEAVE` vs `OFFICIAL_PRESENT`), issuing timestamps, and admin verification status (`PENDING` vs `VERIFIED`).

### 2. Elimination of the Mid-Semester Denominator Fallacy (`egm-comprehension`)
* **Cognitive Issue**: When a faculty member has only graded Level 1 (out of 15 marks), calculating aggregate semester marks against the full 490 total creates an artificial failing score (e.g., 35/490 = 7.1%), alarming students and parents.
* **Resolution**:
  1. **Published Score to Date**: Evaluates solely completed components (e.g. `35 / 45` = 77.8%).
  2. **Curriculum Target Progress**: Displays a progress indicator showing components completed (e.g. `3 of 14 components recorded`).

### 3. Night Attendance Gesture Velocity & Cross-Pass Verification (`egm-design`, `egm-inventive-catalyst`)
* **Hallway Roll-Call Ergonomics**: Roll-calls are executed in dorm corridors on mobile phones under strict time constraints. Modals introduce unacceptable latency.
* **Resolution**: Maintain single-tap toggle (`PRESENT` ↔ `ABSENT`) by default, with pre-recorded leaves clearly badged.
* **Gate Outpass Integration**: Outpasses spanning across midnight are evaluated via timestamp ranges rather than simple date matching to prevent false absentee alerts for students legitimately outside on overnight leave.

## Goals vs. Non-Goals

* **In-Scope Goals:**
  * Single-collection clearance record architecture with explicit `clearanceType` enums (`MEDICAL_LEAVE` vs `OFFICIAL_PRESENT`).
  * Deep-merged mark retrieval combining `marks/{regNo}` and `marks/{adNo}`.
  * Published score vs curriculum completion progress separation on Student Portal.
  * Explicit color differentiation everywhere: Amber for Medical Leave, Teal for Official Duty, Rose for Unexcused Absent, Green for Present.
  * Removal of redundant stacked save buttons and addition of 1-tap Undo rollback in Night Attendance.

* **Out-of-Scope Non-Goals:**
  * Merging Medical Leave into normal attendance credit (Medical Leave remains an excused absence exempt from condonation penalties, not a presence credit).
  * Automated background WhatsApp bot dispatch (remains manual clipboard copy and direct `wa.me` links).

## Alternatives Weighed

* **Alternative 1: Separate Collections for Medical vs Official Clearances**
  * *Rejected*: Fragmenting into `medical_clearances` and `official_clearances` multiplies Firestore queries and complicates admin filtering. A unified `clearance_history` with indexed `clearanceType` provides clean queryability with zero schema bloat.
* **Alternative 2: Modal On Every Absent Tap in Night Roll-Call**
  * *Rejected*: Slows hostel wardens significantly when recording attendance for 35+ students in 10 minutes. Resolved via the dedicated `Pre-Record Mode` toggle.

## Key Decisions & Staging for Next Steps

1. **Clearance Auditing**: Ensure atomic batch updates synchronize `clearance_history`, student document `periodAttendance`, and `systemCache/periodSession_*` caches.
2. **Student Portal Presentation**: Keep the CCE mark table transparent by displaying published scores against active levels, accompanied by a curriculum completion count.
3. **Roll-Call Hardening**: Preserve the single-tap toggle and rollback snapshot for Night Attendance.
