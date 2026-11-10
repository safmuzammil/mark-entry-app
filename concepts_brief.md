# Three-Tiered Campus Leave Architecture & Zero-Friction Attendance Workflows

* **Author:** safmuzammil
* **Date:** 2026-11-10

## Overview

This specification establishes an authoritative three-tiered campus leave architecture and zero-friction roll-call engine for the Darul Huda Degree Campus ERP:
1. **Category 1: Gate Outpass (Off-Campus Leave)**:
   * Permission to leave the campus perimeter. Managed in Outpass module (`/outpass`, `OutpassManager.jsx`).
   * Impacts Period Attendance, Night Attendance, and Jamath Attendance as `🪪 Outside Campus`.
2. **Category 2: Sick in Room Leave (Internal Bed Rest / Medical)**:
   * Student is excused from academic classes and congregational Jamath to rest in their hostel room due to illness.
   * Authorized strictly by the student's **Class Teacher** or **Admin** via a dedicated sub-tab.
   * Impacts Period Attendance as `🤒 Sick in Room` (Amber `#fffbeb`/`#d97706`) and excuses Jamath penalties.
3. **Category 3: Jamath / Masjid Exemption Leave (Mobility / Fracture)**:
   * Student attends academic classes normally (`🟢 PRESENT`), but is excused from the central masjid Jamath prayer due to a leg/hand fracture, cast, sprain, or bandage.
   * Authorized strictly by the student's **Class Teacher** or **Admin**.
   * Protected in `MinusAttendanceManager.jsx` by actively blocking or warning against "Jamath Missing" deductions.
4. **Zero-Friction Night Roll-Call**:
   * Direct inline 4-way single-tap selector: `[🟢 Present] [🔴 Absent] [🤒 Sick] [🏛️ Official]`.
   * Completely eliminates modal dialogs and mandatory text inputs during roll-call.
   * **Night Isolation Invariant**: Night attendance records remain strictly isolated to the night report and do not automatically alter next morning's period attendance.

## System Cross-Tab Visibility Matrix

| Module / Tab | Category 1: Gate Outpass | Category 2: Sick in Room | Category 3: Jamath Exemption |
| :--- | :--- | :--- | :--- |
| **Gate Security Kiosk** | ✅ Allowed to Exit Gate | ❌ Prohibited (Must stay in hostel) | ❌ Prohibited (Must stay in campus) |
| **Period Attendance** | `🪪 Outside Campus` (Indigo) | `🤒 Sick in Room` (Amber) | `🟢 Normal Class Student` (Green) |
| **Night Roll-Call** | `🪪 Outside Campus` (Indigo) | `🤒 In Room (Sick)` (Amber) | `🟢 Present in Hostel` (Green) |
| **Minus Attendance** | Exempt from Jamath Minus | Exempt from Jamath Minus | 🛡️ **Protected: Jamath Minus Blocked** |
| **Absence Clearance** | Linked to Outpass | Logged as `MEDICAL_LEAVE` | Not applicable (No class absence) |

## Authorization & Lifecycle Rules

1. **Authority Gate**:
   * Only the student's assigned Class Teacher or Central Admin can issue or revoke Category 2 and Category 3 leaves.
   * Subject teachers and wardens can view active statuses but cannot issue them outside their class teacher scope.
2. **Duration Policy**:
   * Leaves do not require an explicit expiration date. They remain active until manually revoked by the Class Teacher or Admin upon the student's recovery.
3. **Audit Trail**:
   * All internal leaves are written to `campus_medical_waivers` collection with fields: `studentRegNo`, `adNo`, `studentName`, `className`, `waiverType` (`SICK_IN_ROOM` | `JAMATH_EXEMPTION`), `issuedBy`, `issuedByRole`, `issuedAt`, `status` (`ACTIVE` | `REVOKED`), `revokedAt`, `revokedBy`.

## Goals vs. Non-Goals

* **In-Scope Goals:**
  * Inline 1-tap status selector (`Present`, `Absent`, `Sick`, `Official`) on Night Attendance student cards without modals.
  * Dedicated "Internal Leaves & Medical Waivers" sub-tab in `TeacherPortalView.jsx` and Admin Dashboard.
  * Period Attendance automatically badges Category 2 as `🤒 Sick in Room` (Amber).
  * Minus Attendance cross-checks Category 3 to prevent erroneous "Jamath Missing" minus deductions.
* **Out-of-Scope Non-Goals:**
  * Automatic spillover of night roll-call sick selections into next morning's academic periods.
  * Automated medical diagnosis or pharmacy stock tracking.
