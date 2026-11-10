# Three-Tiered Unified Leave Architecture & Zero-Friction Attendance Workflows

* **Author:** safmuzammil
* **Date:** 2026-11-10

## Overview

This specification establishes an authoritative three-tiered campus leave architecture and a zero-friction roll-call engine across the Darul Huda Degree Campus ERP.

Rather than fragmenting navigation with multiple sidebar items, the existing `Out-Pass Desk` is elevated into a unified **`Leaves & Outpass`** desk (`🪪`), partitioned into three dedicated sub-tabs:
1. **Sub-Tab 1: 🪪 Gate Outpass (Off-Campus Leave)**:
   * Permission to leave the campus perimeter.
   * Full outpass lifecycle (parent approval, class teacher verification, gate security scanner check-out/check-in).
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

## Multi-Lens Goldfish Review Analysis

### 1. UX & Mobile Ergonomics (`egm-design`)
* **Friction Elimination**: Eliminates modal dialogs during roll-call. Teachers tap directly between 4 tactile states with instant visual feedback and color tokens (Green for Present, Rose for Absent, Amber for Sick in Room, Cyan for Official Duty).
* **Locked Outpass Badging**: Students marked `OUTSIDE` at the gate are auto-badged in Indigo (`#e0e7ff`/`#4338ca`) and locked against accidental roll-call overwrites.

### 2. Codebase Data Architecture (`egm-codebase-details`)
* **Collection Schema**: Introduces `campus_medical_waivers`:
  * `id`: Document ID (`waiver_${Date.now()}_${adNo}`)
  * `studentRegNo`: string
  * `adNo`: string
  * `studentName`: string
  * `className`: string
  * `waiverType`: `'SICK_IN_ROOM'` | `'JAMATH_EXEMPTION'`
  * `injuryReason`: string (e.g. `Leg Fracture / Plaster Cast`, `Acute Viral Fever`)
  * `roomNumber`: string (optional hostel room number)
  * `issuedBy`: string (teacher username or "admin")
  * `issuedByRole`: `'CLASS_TEACHER'` | `'ADMIN'`
  * `issuedAt`: ISO string
  * `status`: `'ACTIVE'` | `'REVOKED'`
  * `revokedAt`: ISO string (nullable)
  * `revokedBy`: string (nullable)

### 3. Macro Architecture & Perimeter Security (`egm-zoom-out`)
* **The Gate Invariant**: The Gate Security Kiosk remains strictly quarantined to physical campus exits. Gate security personnel never see internal sick room or prayer waivers. An internal sick student attempting to leave the gate will be stopped with "No valid gate outpass."

### 4. Conflict Precedence Rules (`egm-comprehension`)
* **Precedence Hierarchy**:
  * Physical Gate Outpass (`OUTSIDE`) takes precedence over internal waivers. If a student with an active Masjid Exemption or Sick in Room waiver is granted an outpass to go home or to a hospital, their global status becomes `🪪 Outside Campus`.
  * Upon gate check-in (`RETURNED`), internal active waivers automatically resume.

### 5. Poka-Yoke Jamath Protection (`egm-inventive-catalyst`)
* When a teacher or warden enters `Minus Attendance` for `Jamath Missing`, selecting a student with an active Category 3 waiver prompts an immediate shield alert: `🛡️ Protected Waiver: Student has an active Masjid Exemption (Reason: Leg Fracture). Jamath deduction blocked.`

## System Cross-Tab Visibility Matrix

| Module / Tab | Sub-Tab 1: Gate Outpass | Sub-Tab 2: Sick in Room | Sub-Tab 3: Masjid Exemption |
| :--- | :--- | :--- | :--- |
| **Gate Security Kiosk** | ✅ Whitelisted to Exit Gate | ❌ Prohibited (Must stay in hostel) | ❌ Prohibited (Must stay in campus) |
| **Period Attendance** | `🪪 Outside Campus` (Indigo) | `🤒 Sick in Room` (Amber) | `🟢 Normal Class Student` (Green) |
| **Night Roll-Call** | `🪪 Outside Campus` (Indigo) | `🤒 In Room (Sick)` (Amber) | `🟢 Present in Hostel` (Green) |
| **Extra Attendance** | `🪪 Outside Campus` (Indigo) | `🤒 Sick in Room` (Amber) | `🩹 Masjid Exempt` (Cyan) |
| **Minus Attendance** | Exempt from Jamath Minus | Exempt from Jamath Minus | 🛡️ **Protected: Jamath Minus Blocked** |
| **Absence Clearance** | Linked to Outpass | Logged as `MEDICAL_LEAVE` | Not applicable (No class absence) |

## Goals vs. Non-Goals

* **In-Scope Goals:**
  * Inline 4-way single-tap selector (`Present`, `Absent`, `Sick`, `Official`) in both Night Attendance and Extra Attendance.
  * Consolidation of `Out-Pass Desk` into `Leaves & Outpass` with 3 sub-tabs.
  * Period Attendance automatically badges Category 2 as `🤒 Sick in Room` (Amber).
  * Minus Attendance cross-checks Category 3 to prevent erroneous "Jamath Missing" minus deductions.
  * Gate Security Kiosk isolated strictly to Gate Outpasses.
* **Out-of-Scope Non-Goals:**
  * Automatic spillover of night roll-call sick selections into next morning's academic periods.
  * Automated medical diagnosis or pharmacy stock tracking.
