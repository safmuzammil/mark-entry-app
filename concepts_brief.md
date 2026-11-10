# Three-Tiered Unified Leave Architecture & Zero-Friction Attendance Workflows

* **Author:** safmuzammil
* **Date:** 2026-11-10

## Overview

This specification establishes an authoritative three-tiered campus leave architecture and zero-friction roll-call engine across the Darul Huda Degree Campus ERP. 

Rather than fragmenting navigation with multiple sidebar items, the existing `Out-Pass Desk` is elevated into a unified **`Leaves & Outpass`** desk (`🪪`), partitioned into three clear sub-tabs:
1. **Sub-Tab 1: 🪪 Gate Outpass (Off-Campus Leave)**:
   * Permission to leave the campus perimeter.
   * Full existing outpass lifecycle (parent approval, class teacher consent, gate security scanner check-out/check-in).
   * Reflected in Period Attendance, Night Attendance, and Extra Attendance as `🪪 Outside Campus`.
2. **Sub-Tab 2: 🤒 Sick in Room (Internal Bed Rest / Acute Illness)**:
   * Excused from academic classes and congregational Jamath to rest in hostel room.
   * Authorized strictly by the student's **Class Teacher** or **Admin**.
   * Open-ended validity (persists until manually revoked upon recovery).
   * Automatically reflected in Period Attendance as `🤒 Sick in Room` (Amber `#fffbeb`/`#d97706`) and excuses Jamath.
3. **Sub-Tab 3: 🩹 Masjid Exemption (Mobility / Fracture Waiver)**:
   * Attends academic classes normally (`🟢 PRESENT`), but excused from central masjid Jamath prayer due to a fracture, cast, sprain, or bandage.
   * Authorized strictly by the student's **Class Teacher** or **Admin**.
   * Open-ended validity (persists until manually revoked upon recovery).
   * Protected in `MinusAttendanceManager.jsx` by actively blocking or warning against "Jamath Missing" deductions.
4. **Modal-Free 1-Tap Attendance Taking (Night & Extra Attendance)**:
   * Direct inline 4-way single-tap selector: `[🟢 Present] [🔴 Absent] [🤒 Sick] [🏛️ Official]`.
   * Completely eliminates modal dialogs and mandatory text inputs during roll-call across both **Night Attendance** and **Extra Attendance**.
   * **Night Isolation Invariant**: Night attendance records remain strictly isolated to the night report and do not automatically alter next morning's period attendance.

## Navigation & Tab Architecture

### Selected Approach: Unified `Leaves & Outpass` Tab (`🪪`)
* **Sidebar Consistency**:
  * Avoids sidebar bloat while consolidating all student leaves under one authoritative desk.
  * Sidebar item: `🪪 Leaves & Outpass` (or `🪪 Leaves Desk`).
* **Sub-Tab Structure**:
  1. `🪪 Gate Outpasses` (External campus exits — strictly connected to Gate Security).
  2. `🤒 Sick in Room` (Internal hostel bed rest — strictly connected to Period Attendance & Jamath excuse).
  3. `🩹 Masjid Exemptions` (Mobility waivers — strictly connected to Minus Attendance jamath protection).
* **Access Control**:
  * **Class Teachers**: Manage leaves strictly for students of their assigned class (`classTeacherOf`).
  * **Central Admin / Office Secretary**: Full institutional access across all classes.
  * **Gate Security Kiosk**: Strictly filtered to Sub-Tab 1 (`Gate Outpass`). Gate scanners have zero access or visibility to internal Sick in Room or Masjid Exemptions, preserving gate security perimeter integrity.

## System Cross-Tab Visibility Matrix

| Module / Tab | Sub-Tab 1: Gate Outpass | Sub-Tab 2: Sick in Room | Sub-Tab 3: Masjid Exemption |
| :--- | :--- | :--- | :--- |
| **Gate Security Kiosk** | ✅ Whitelisted to Exit Gate | ❌ Prohibited (Must stay in hostel) | ❌ Prohibited (Must stay in campus) |
| **Period Attendance** | `🪪 Outside Campus` (Indigo) | `🤒 Sick in Room` (Amber) | `🟢 Normal Class Student` (Green) |
| **Night Roll-Call** | `🪪 Outside Campus` (Indigo) | `🤒 In Room (Sick)` (Amber) | `🟢 Present in Hostel` (Green) |
| **Extra Attendance** | `🪪 Outside Campus` (Indigo) | `🤒 Sick in Room` (Amber) | `🩹 Masjid Exempt` (Cyan) |
| **Minus Attendance** | Exempt from Jamath Minus | Exempt from Jamath Minus | 🛡️ **Protected: Jamath Minus Blocked** |
| **Absence Clearance** | Linked to Outpass | Logged as `MEDICAL_LEAVE` | Not applicable (No class absence) |

## Data Model & Collections

* **Collection `campus_medical_waivers`**:
  * `id`: Document ID (`waiver_${Date.now()}_${adNo}`)
  * `studentRegNo`: string
  * `adNo`: string
  * `studentName`: string
  * `className`: string
  * `waiverType`: `'SICK_IN_ROOM'` | `'JAMATH_EXEMPTION'`
  * `injuryReason`: string (e.g. `Leg Fracture / Plaster Cast`, `High Fever / Bed Rest`, `Crutches`)
  * `roomNumber`: string (optional hostel room number)
  * `issuedBy`: string
  * `issuedByRole`: string
  * `issuedAt`: ISO string
  * `status`: `'ACTIVE'` | `'REVOKED'`
  * `revokedAt`: ISO string (nullable)
  * `revokedBy`: string (nullable)

## Goals vs. Non-Goals

* **In-Scope Goals:**
  * Modal-free 1-tap status selector (`Present`, `Absent`, `Sick`, `Official`) in both Night Attendance and Extra Attendance.
  * Consolidation of `Out-Pass Desk` into `Leaves & Outpass` with 3 sub-tabs.
  * Period Attendance automatically badges Category 2 as `🤒 Sick in Room` (Amber).
  * Minus Attendance cross-checks Category 3 to prevent erroneous "Jamath Missing" minus deductions.
  * Gate Security Kiosk isolated strictly to Gate Outpasses.
* **Out-of-Scope Non-Goals:**
  * Automatic spillover of night roll-call sick selections into next morning's academic periods.
  * Automated medical diagnosis or pharmacy stock tracking.
