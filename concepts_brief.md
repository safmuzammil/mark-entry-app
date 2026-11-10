# Three-Tiered Campus Leave Architecture & Zero-Friction Attendance Workflows

* **Author:** safmuzammil
* **Date:** 2026-11-10

## Overview

This specification establishes a unified three-tiered leave architecture for Darul Huda Degree Campus, separating external gate movements from internal residential sick leaves and prayer exemptions. It also removes all mandatory modal interruptions from Night Attendance to support rapid roll-call throughput.

### The Three Campus Leave Categories:
1. **Category 1: Gate Outpass (Off-Campus Leave)**:
   * Permission to leave the campus perimeter.
   * *Managed in*: Outpass Module (`/outpass`, `OutpassManager.jsx`).
   * *Attendance Impact*: Excused in Period Attendance (`🪪 OUTPASS`), Night Attendance (`OUTPASS`), and Jamath/Prayer roll-call.
   * *Security Invariant*: Only Category 1 permits gate security exit.
2. **Category 2: Sick in Room Leave (Internal Bed Rest / Acute Illness)**:
   * Permission to stay in hostel room resting due to fever, flu, or acute illness.
   * *Attendance Impact*:
     * **Academic Period Attendance**: Displayed in Amber (`🤒 Sick in Room`) with zero academic penalty (excused medical leave).
     * **Masjid Jamath / Minus Attendance**: Excused from masjid congregational prayer without triggering "Jamath Missing" disciplinary minus penalties.
     * **Night Attendance**: Accounted for as present in hostel under `🤒 SICK IN ROOM`.
3. **Category 3: Jamath / Masjid Exemption Leave (Mobility / Fracture Waiver)**:
   * Student has an orthopedic or mobility impairment (fracture, plaster cast, crutches, open surgical dressing) that prevents walking to the campus central masjid 5 times daily, but does **not** impede classroom learning.
   * *Attendance Impact*:
     * **Academic Period Attendance**: Normal classroom attendance (`🟢 PRESENT`).
     * **Masjid Jamath / Minus Attendance**: Badged as `🩹 MASJID EXEMPT (FRACTURE/INJURY)`. Minus Attendance explicitly blocks or flags warnings against deducting minus periods for missed jamath.
     * **Night Attendance**: Present in hostel (`🟢 PRESENT`).

---

## Zero-Friction Night Attendance Roll-Call

### Eliminating Modal Overhead
In hostel corridors, wardens verify up to 40 students across multiple rooms in 10 minutes. Opening a modal requiring text reasons, medical end-dates, and timestamps destroys roll-call velocity.

### Proposed Card Interaction Model:
* Each student card presents an inline 4-way direct status selector:
  `[🟢 Present] [🔴 Absent] [🤒 Sick] [🏛️ Official]`
* Tapping any option commits the status instantly in client state with zero modal dialogs.
* Active Category 1 Outpasses are preloaded and rendered as locked badges (`🪪 Outside Campus`), preventing accidental overwrites.
* The redundant configuration modal is eliminated from standard roll-call flow.

---

## Placement & Workflow for Categories 2 and 3

### Where Should Internal Waivers Be Issued?
* **Dedicated "Campus Medical & Jamath Waivers" Desk**:
  * Located as a distinct tab within `TeacherPortalView.jsx` (accessible to Class Teachers, Wardens, and Health In-Charge) and Admin Dashboard.
  * **Sick in Room (Category 2)**:
    - Inputs: Student picker, Date (default today), Duration (Today Only / Multi-Day), Resting Room Number.
    - Effect: Auto-flags Period Attendance (Periods 1-9) as Medical and excuses Jamath.
  * **Masjid Jamath Exemption (Category 3)**:
    - Inputs: Student picker, Exemption Reason (`Leg Fracture / Cast`, `Bandage / Open Dressing`, `Crutches / Sprain`, `Other Mobility Issue`), Valid Until Date.
    - Effect: Zero effect on class periods. Synchronizes to Minus Attendance & Jamath monitor to block "Jamath Missing" deductions.

---

## System Cross-Tab Visibility Matrix

| Module / Tab | Category 1: Gate Outpass | Category 2: Sick in Room | Category 3: Jamath Exemption |
| :--- | :--- | :--- | :--- |
| **Gate Security Kiosk** | ✅ Allowed to Exit Gate | ❌ Prohibited (Must stay in hostel) | ❌ Prohibited (Must stay in campus) |
| **Period Attendance** | `🪪 Outside Campus` (Indigo) | `🤒 Sick in Room` (Amber) | `🟢 Normal Class Student` (Green) |
| **Night Roll-Call** | `🪪 Outside Campus` (Indigo) | `🤒 In Room (Sick)` (Amber) | `🟢 Present in Hostel` (Green) |
| **Minus Attendance** | Exempt from Jamath Minus | Exempt from Jamath Minus | 🛡️ **Protected: Jamath Minus Blocked** |
| **Absence Clearance** | Automatically linked to Outpass | Logged as `MEDICAL_LEAVE` | Not applicable (No class absence) |

---

## Technical Stress-Testing & Critical Vulnerabilities

1. **Overnight Spillover Ambiguity**:
   * If a warden marks a student `🤒 Sick` during 10:00 PM Night Attendance, does that automatically excuse the student from 7:45 AM Period 1 tomorrow morning?
   * *Risk*: Students might report minor evening headaches to skip morning exams or first-period classes without waking up.
   * *Proposed Rule*: Night Attendance `Sick` status applies strictly to the night roll-call record. Academic Period 1-9 medical leave must originate from Class Teacher or Warden entry in the Medical Waiver desk.
2. **Minus Attendance Race Condition**:
   * Disciplinary wardens frequently bulk-upload "Jamath Missing" spreadsheets or select all absentees during Fajr prayer.
   * *Risk*: Students with leg fractures get penalized if Minus Attendance does not cross-check active Jamath Exemptions before applying deductions.
   * *Proposed Invariant*: `MinusAttendanceManager` must inspect `systemCache/jamathExemptions` on submit and display an override prompt if a teacher attempts to apply minus marks to an exempt student.
3. **Data Storage & Reversibility**:
   * Store internal medical leaves under `campus_medical_waivers` collection with fields: `studentRegNo`, `adNo`, `waiverType` (`SICK_IN_ROOM` | `JAMATH_EXEMPTION`), `validFrom`, `validTo`, `approvedBy`, `reason`.

---

## Goals vs. Non-Goals

* **In-Scope Goals:**
  * Modal-free 1-tap status selection in Night Attendance (`Present`, `Absent`, `Sick`, `Official`).
  * Institutional data model for Category 2 (Sick in Room) and Category 3 (Masjid Jamath Exemption).
  * Period Attendance reflects Category 2 as Amber `Sick in Room`.
  * Minus Attendance / Jamath reflects Category 3 and prevents erroneous penalties.
* **Out-of-Scope Non-Goals:**
  * Bluetooth or biometric automated masjid attendance scanners.
  * Pharmacy prescription inventory tracking.
