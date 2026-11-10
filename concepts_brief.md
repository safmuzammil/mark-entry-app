# Three-Tiered Campus Leave Architecture & Zero-Friction Attendance Workflows

* **Author:** safmuzammil
* **Date:** 2026-11-10

## Overview

This specification establishes an authoritative three-tiered campus leave architecture and zero-friction roll-call engine across the Darul Huda Degree Campus ERP:
1. **Category 1: Gate Outpass (Off-Campus Leave)**:
   * Permission to leave the campus perimeter. Managed in Outpass module (`/outpass`, `OutpassManager.jsx`).
   * Impacts Period Attendance, Night Attendance, and Jamath Attendance as `🪪 Outside Campus`.
2. **Category 2: Sick in Room Leave (Internal Bed Rest / Acute Illness)**:
   * Excused from academic classes and congregational Jamath to rest in hostel room.
   * Authorized strictly by the student's **Class Teacher** or **Admin** via the new `Campus Leaves` tab.
   * Impacts Period Attendance as `🤒 Sick in Room` (Amber `#fffbeb`/`#d97706`) and excuses Jamath.
3. **Category 3: Jamath / Masjid Exemption Leave (Mobility / Fracture)**:
   * Attends academic classes normally (`🟢 PRESENT`), but is excused from central masjid Jamath prayer due to a fracture, cast, sprain, or bandage.
   * Authorized strictly by the student's **Class Teacher** or **Admin** via the `Campus Leaves` tab.
   * Protected in `MinusAttendanceManager.jsx` by actively blocking or warning against "Jamath Missing" deductions.
4. **Modal-Free 1-Tap Attendance Taking (Night & Extra Attendance)**:
   * Direct inline 4-way single-tap selector: `[🟢 Present] [🔴 Absent] [🤒 Sick] [🏛️ Official]`.
   * Completely eliminates modal dialogs and mandatory text inputs during roll-call across both **Night Attendance** and **Extra Attendance**.
   * **Night Isolation Invariant**: Night attendance records remain strictly isolated to the night report and do not automatically alter next morning's period attendance.

## Navigation & Tab Architecture

### Proposed Tab Name: `Campus Leaves` (Icon: 🏥)
* **Alignment with Sidebar**:
  * Matches the brevity and structure of `Out-Pass Desk` (Off-Campus Leaves vs On-Campus Leaves).
  * Sidebar hierarchy:
    * `⏱️ Period Attendance`
    * `⚖️ Minus Attendance`
    * `📖 CCE Marks`
    * `🪪 Out-Pass Desk` (Off-Campus Outpasses)
    * `🏥 Campus Leaves` (Internal Sick in Room & Masjid Exemptions)
    * `🌙 Night Attendance`
* **Internal Structure of `Campus Leaves` Tab**:
  * **Sub-Tab 1: 🤒 Sick in Room**: Active bed-rest leaves, auto-syncing to Period Attendance.
  * **Sub-Tab 2: 🩹 Masjid Exemptions**: Active mobility waivers, protecting students in Minus Attendance.
  * **Scope Control**: Class Teachers see only their assigned class students; Admin sees all classes with bulk search.

## System Cross-Tab Visibility Matrix

| Module / Tab | Category 1: Gate Outpass | Category 2: Sick in Room | Category 3: Jamath Exemption |
| :--- | :--- | :--- | :--- |
| **Gate Security Kiosk** | ✅ Allowed to Exit Gate | ❌ Prohibited (Must stay in hostel) | ❌ Prohibited (Must stay in campus) |
| **Period Attendance** | `🪪 Outside Campus` (Indigo) | `🤒 Sick in Room` (Amber) | `🟢 Normal Class Student` (Green) |
| **Night Roll-Call** | `🪪 Outside Campus` (Indigo) | `🤒 In Room (Sick)` (Amber) | `🟢 Present in Hostel` (Green) |
| **Extra Attendance** | `🪪 Outside Campus` (Indigo) | `🤒 Sick in Room` (Amber) | `🩹 Masjid Exempt` (Cyan) |
| **Minus Attendance** | Exempt from Jamath Minus | Exempt from Jamath Minus | 🛡️ **Protected: Jamath Minus Blocked** |
| **Absence Clearance** | Linked to Outpass | Logged as `MEDICAL_LEAVE` | Not applicable (No class absence) |

## Authorization & Lifecycle Rules

1. **Authority Gate**:
   * Only the student's assigned Class Teacher or Central Admin can issue or revoke Category 2 and Category 3 leaves.
   * Subject teachers and hostel wardens can view active statuses in roll-call but cannot authorize them.
2. **Open-Ended Duration**:
   * No mandatory end-date required. Leaves remain active until manually revoked by the Class Teacher or Admin upon student recovery.
3. **Data Model**:
   * Stored under `campus_medical_waivers` collection with fields: `studentRegNo`, `adNo`, `studentName`, `className`, `waiverType` (`SICK_IN_ROOM` | `JAMATH_EXEMPTION`), `injuryReason`, `issuedBy`, `issuedByRole`, `issuedAt`, `status` (`ACTIVE` | `REVOKED`), `revokedAt`, `revokedBy`.

## Goals vs. Non-Goals

* **In-Scope Goals:**
  * Modal-free 1-tap status selector (`Present`, `Absent`, `Sick`, `Official`) in both Night Attendance and Extra Attendance.
  * Dedicated `Campus Leaves` tab in `TeacherPortalView.jsx` and Admin Dashboard.
  * Period Attendance automatically badges Category 2 as `🤒 Sick in Room` (Amber).
  * Minus Attendance cross-checks Category 3 to prevent erroneous "Jamath Missing" minus deductions.
* **Out-of-Scope Non-Goals:**
  * Automatic spillover of night roll-call sick selections into next morning's academic periods.
  * Automated medical diagnosis or pharmacy stock tracking.
