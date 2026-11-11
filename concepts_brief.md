# EGM Brainstorm: Attendance Clearance & Medical Exemption Sync Performance Overhaul

**Author:** safmuzammil  
**Status:** In Review (7-Lens Review Stage)  
**Date:** 2026-11-11  

---

## 1. Problem Statement

1. **Masjid Jamath Exemption Disconnect in Extra Attendance**:
   - In [`NightAttendanceManager.jsx`](file:///D:/Codes/mark-entry-app/app/components/NightAttendanceManager.jsx#L91-L95), the real-time listener for medical waivers filters strictly on `waiverType == 'SICK_IN_ROOM'`. As a result, students holding sanctioned `JAMATH_EXEMPTION` waivers (e.g. Sayyid Muhammad Sahran `#3462` with a leg fracture) never appear in the Extra Attendance portal.
   - Teachers taking extra attendance for congregational prayer, study camps, or assemblies receive no indication of legitimate prayer waivers and risk mistakenly penalizing or badgering injured students.

2. **Absence Clearance Permission Crash**:
   - When attempting to issue an absence clearance in [`AbsenceClearanceManager.jsx`](file:///D:/Codes/mark-entry-app/app/components/AbsenceClearanceManager.jsx#L525), the application throws:
     > `Error saving clearance: Missing or insufficient permissions.`
   - In [`firestore.rules`](file:///D:/Codes/mark-entry-app/firestore.rules), `clearance_certificates` has security rules, but `clearance_history` has **zero declared security rules**, causing Firestore to reject the batch write.

3. **Multi-Ad.No Fetching Latency & UI Freezes**:
   - The "Find Absences" and "Inspect Student Sessions" tools sequentially search unbounded collections across `systemCache` without parallel batching, index acceleration, or local caching.
   - Searching for multiple students (e.g., `3551, 3392, U1107`) across multi-week date scopes causes the UI to hang indefinitely on "Fetching Absences..." / "Loading sessions...".

4. **Status Confusion (Medical vs Official Leave Representation)**:
   - Previously, medical leaves risked being lumped together with official duty or converted to normal presence (`PRESENT`), distorting audit logs.
   - Distinct statuses are required: **Medical Leave** (light red badge) must stay as excused medical absence, while **Official Duty** (light blue badge) represents authorized institutional duty, without forced conversion to simple present.

---

## 2. Proposed Architecture & Solutions

### A. Extra Attendance Waiver Surfacing
- Broaden `campus_medical_waivers` subscription in [`NightAttendanceManager.jsx`](file:///D:/Codes/mark-entry-app/app/components/NightAttendanceManager.jsx) to listen for **all active waivers** (`SICK_IN_ROOM` and `JAMATH_EXEMPTION`).
- On the student card in Extra Attendance:
  - If a student holds an active Masjid Exemption, retain initial default as `Present`, but surface a high-visibility badge:
    `🩹 Masjid Exemption: Leg Fracture / Plaster Cast (Permitted by MUHAMMED MUZAMMIL P)`.
  - Provide an instant 1-tap **`Sick`** button so the teacher can mark them excused with zero friction.

### B. Firestore Security Rules Fix for `clearance_history`
- Delegate to `firestore-rules-author` subagent to declare proper declarative rules for `clearance_history` with strict shape and field validation:
  ```javascript
  function isValidClearanceHist(data) {
    return data.keys().hasAll(['id', 'certNumber', 'studentRegNo', 'studentAdNo', 'studentName', 'clearanceType', 'reason', 'dates', 'totalPeriodsCleared', 'issuedByUsername', 'issuedAt']) &&
           data.id is string &&
           data.certNumber is string &&
           data.studentRegNo is string &&
           data.studentAdNo is string &&
           data.studentName is string &&
           data.clearanceType in ['MEDICAL_LEAVE', 'OFFICIAL_PRESENT'] &&
           data.dates is list && data.dates.size() <= 60 &&
           data.totalPeriodsCleared is number &&
           data.issuedByUsername is string;
  }

  match /clearance_history/{histId} {
    allow read: if isAuthenticated();
    allow create: if isStaffOrAdmin() && isValidClearanceHist(request.resource.data);
    allow update: if isStaffOrAdmin() && isValidClearanceHist(request.resource.data);
    allow delete: if isAdmin();
  }
  ```
- Ensure both `clearance_history` and `clearance_certificates` write atomically without permission failure across both `AbsenceClearanceManager.jsx` and `PeriodAttendanceMinusAndClearance.jsx`.

### C. Multi-Student Absence Clearance Workspace (Instant Chunked Batch Table)
- **Chunked Parallel Queries & In-Memory Cache**:
  - Check existing in-memory daily cache before querying Firestore.
  - Short-circuit session doc fetching if `daySessionsIndex_{date}` reports zero sessions for that date.
  - Query in throttled parallel batches of 10 dates to prevent network saturation.
- **Batch Hierarchy UI**:
  - Render found absent periods grouped by student in a clean responsive table.
  - Show each absent period individually with date, period number, subject, and original marking teacher.
  - Provide:
    1. **"Clear All Found Absences"** master button.
    2. Per-student **"Clear Student (N periods)"** button.
    3. Per-period individual toggle checkboxes to clear one-by-one.

### D. Distinct Status Badging in Attendance Portal (Palette Normalization)
- Maintain clear semantic differentiation in attendance records without auto-converting medical absences to generic normal presence:
  - **Medical Leave**: Styled with **light red / rose background** (`#fff1f2` / `#fef2f2`, border `#fecdd3`, text `#b91c1c`). Retained strictly as Medical Excusals.
  - **Official Duty**: Styled with **light blue background** (`#eff6ff`, border `#bfdbfe`, text `#1d4ed8`). Retained as Official Clearance.
  - **Normal Present**: Background `#f0fdf4`, border `#bbf7d0`, text `#15803d` (Green).
  - Eliminate auto-conversion to generic `Normal Present` so student transcripts retain accurate disciplinary and medical provenance.

---

## 3. Scope & Boundaries

### In Scope:
- `NightAttendanceManager.jsx`: Medical waiver listener and Extra Attendance card badging.
- `AbsenceClearanceManager.jsx` & `PeriodAttendanceMinusAndClearance.jsx`: High-speed batch lookup, multi-Ad.No grouping, per-period selection, and distinct color badging.
- `firestore.rules`: Declarative security rules for `clearance_history` via `firestore-rules-author`.

### Out of Scope:
- Modifying Google Sheets sync formats for attendance (attendance does not sync to CCE mark sheets).
- Modifying Gate Security Kiosk scanning algorithms.
