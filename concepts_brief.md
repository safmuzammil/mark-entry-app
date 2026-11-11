# RFC Concepts Brief: Permitted Leave Attendance Option & Targeted Absentees WhatsApp Export

* **Author:** safmuzammil
* **Date:** 2026-11-11
* **Status:** PROPOSED FOR REVIEW

---

## 1. Problem Statement & Motivation

Across Darul Huda Degree Campus attendance taking desks (Period Attendance, Extra Attendance, and Night Attendance), faculty and wardens encounter two operational pain points:

1. **Absence of a First-Class "Permitted Leave" Option**:
   - Currently, roll-call card options are often binary (Present vs Absent) or limited to predefined outpass/medical waivers.
   - When a student is granted legitimate permission to be away from a lecture or night session without being a hospital/bed-rest case or an official institutional outreach delegate (e.g. library study permission, sanctioned home leave, approved private seminar), attendance takers are forced to choose between marking them physically `PRESENT` (untrue representation) or `ABSENT` (unfairly penalizing academic marks and trigger automated absence notices).
   - The system requires a distinct storage and tracking code **`'L'`** (`PERMITTED_LEAVE`) across all attendance taking interfaces.

2. **WhatsApp & Clipboard Export Over-Inclusion**:
   - When faculty copy or forward roll-call attendance reports to Class Teachers or department groups via WhatsApp, existing templates often include all students or mix excused leaves together with unexcused absentees.
   - Class teachers need an instant, focused list containing **strictly unexcused absent students** (`'A'`), contextualized with Class, Date, and Period / Session info.

---

## 2. Core Technical Hypotheses

### 2.1 Unified "Permitted Leave" (`'L'`) Across All Attendance Desks
1. **Database & Storage Code Alignment**:
   - In `systemCache` session documents (`attendanceMap`), map Permitted Leave to single-character code `'L'`.
   - Full taxonomy across `attendanceMap`:
     * `'P'`: Present
     * `'A'`: Unexcused Absent
     * `'M'`: Medical Leave (Excused)
     * `'O'`: Official Duty (Present)
     * `'L'`: Permitted Leave (Excused)
2. **Student Aggregate Statistics**:
   - In `students.{id}.periodAttendance`, track `'L'` under `permittedCount` and `subjectWise.{sub}.permitted`.
   - Excuses the student from absence penalties without inflating physical presence ratios.
3. **Interactive UI Controls**:
   - **Period Attendance (`PeriodAttendanceManager.jsx`)**: Add a 4-state toggle or button cluster for each student: `Pres` (green), `Abs` (rose/red), `Leave` (purple/indigo), and `Sick` (amber).
   - **Extra & Night Attendance (`NightAttendanceManager.jsx`)**: Include `Leave` button alongside `Pres`, `Abs`, `Sick`, and `Off`.

### 2.2 Strict Unexcused Absentees WhatsApp & Clipboard Export
1. **Filtering Invariant**:
   - The export generator filters solely for students where `status === 'A'` (excluding `'P'`, `'M'`, `'O'`, and `'L'`).
2. **Standardized Contextual Template**:
   ```text
   *📋 ABSENTEES REPORT — CLASS [ClassName]*
   📅 Date: [YYYY-MM-DD] | [Period: N / Session: Extra Study / Night Jamath]
   📖 Subject / Activity: [Subject / Activity Name]
   👨‍🏫 Faculty / Recorder: [TeacherName]

   *Unexcused Absent Students ([Count]):*
   1. [Student Name] (#[AdNo] • Roll: [RollNo])
   2. [Student Name] (#[AdNo] • Roll: [RollNo])
   ```
   *(If count is 0: `None (All students present or excused)`)*.
3. **One-Tap Actions**:
   - "📋 Copy Absentees" (writes formatted text to clipboard).
   - "📲 Send Absentees to Class Teacher" (opens direct WhatsApp chat with the resolved class teacher).

---

## 3. Boundaries & Non-Goals

* **Out-of-Scope**: Pending absence queue / inbox (explicitly skipped per user request).
* **Out-of-Scope**: Altering examination mark entry or CCE grade calculation formulas.
* **Preservation**: Existing gate outpass auto-detection remains active as a pre-fill default.
