# Design Document: Attendance Clearance Engine & Medical Exemption Sync

* **Author:** safmuzammil
* **Date:** 2026-11-11
* **Status:** APPROVED

---

## 1. Problem Statement

The campus management operations at Darul Huda Degree Campus face three critical defects across medical excusals, disciplinary attendance clearance, and system performance:

1. **Masjid Jamath Exemption Disconnect in Extra Attendance**:
   - In [`NightAttendanceManager.jsx`](file:///D:/Codes/mark-entry-app/app/components/NightAttendanceManager.jsx#L91-L95), the live Firestore listener for campus medical waivers queries strictly for `where('waiverType', '==', 'SICK_IN_ROOM')`. It completely ignores `where('waiverType', '==', 'JAMATH_EXEMPTION')`.
   - When faculty or wardens take attendance for extra sessions (congregational prayer, camps, or assemblies), students with sanctioned prayer exemptions (e.g., Sayyid Muhammad Sahran `#3462` with a leg fracture) have zero visible indication of their exemption. Attendance takers mistakenly record them as absent or demand unnecessary explanations, defeating the institutional shield against Jamath Missing deductions.

2. **Absence Clearance Permission Crash**:
   - When an administrator attempts to issue an absence clearance in the Clearance Desk ([`AbsenceClearanceManager.jsx`](file:///D:/Codes/mark-entry-app/app/components/AbsenceClearanceManager.jsx#L525)), the operation crashes with:
     > `Error saving clearance: Missing or insufficient permissions.`
   - In [`firestore.rules`](file:///D:/Codes/mark-entry-app/firestore.rules), `match /clearance_certificates/{certId}` exists, but `match /clearance_history/{histId}` is completely absent. Because Cloud Firestore security rules reject undeclared collections by default, the batch write operation fails immediately.

3. **High Latency & UI Freezes on Multi-Student Absence Searches**:
   - The "Find Absences" and "Inspect Student Sessions" tools sequentially search unbounded collections across `systemCache` over multi-day date scopes without parallel batching or index acceleration.
   - Searching for multiple students (e.g. `3551, 3392, U1107`) across multi-week periods causes the browser to hang indefinitely on "Fetching Absences..." / "Loading sessions...".

4. **Semantic Status Distortion (Medical Leave vs Official Duty)**:
   - In the clearance desk, both medical leaves and official duties risked being converted to normal presence (`PRESENT`), erasing medical audit provenance.
   - Medical leaves must remain distinctly marked as excused medical absences with light red styling, while official duty remains recognized as institutional duty with light blue styling, avoiding generic presence conversions.

---

## 2. Overview & Solution Narrative

This design introduces a high-performance, fault-tolerant attendance clearance and waiver synchronization architecture:

1. **Dual Waiver Subscription in Extra Attendance**:
   - Broadens the `campus_medical_waivers` real-time listener in [`NightAttendanceManager.jsx`](file:///D:/Codes/mark-entry-app/app/components/NightAttendanceManager.jsx) to load both `SICK_IN_ROOM` and `JAMATH_EXEMPTION`.
   - Surfaces a high-visibility badge on student cards in Extra Attendance:
     `🩹 Masjid Exemption: Leg Fracture / Plaster Cast (by MUHAMMED MUZAMMIL P)`
   - Keeps initial roll-call state non-destructive (`Present`), with a 1-tap `Sick` button for immediate excusal.

2. **Declarative Security Rules for `clearance_history`**:
   - Implements a dedicated schema validator `isValidClearanceHist` in [`firestore.rules`](file:///D:/Codes/mark-entry-app/firestore.rules) checking required string/numeric attributes, bounded array sizes (`dates <= 60`), and role authorization (`isStaffOrAdmin()`). Accommodates numeric and string admission numbers (`data.studentAdNo is number || (data.studentAdNo is string ...)`).

3. **High-Velocity Multi-Student Batch Clearance Workspace**:
   - Implements a two-tiered search engine: (1) preliminary conditioning using in-memory set intersection of target student `absentDates`, and (2) chunked parallel retrieval of `daySessionsIndex_{date}` in batches of 10 dates, short-circuiting dates with zero sessions.
   - Groups candidate absences by student in a responsive batch table displaying each individual absent period (Date, Period Number, Subject, Original Teacher).
   - Provides a master **"Clear All Found Absences"** action, per-student batch clearance, and granular per-period checkboxes, committed in safe chunks of $\le 250$ write operations.

4. **Normalized Visual & Data Status Palette**:
   - **Medical Leave**: Light red/rose badge (`#fff1f2` / `#fef2f2`, border `#fecdd3`, text `#b91c1c`), preserved as excused medical absence.
   - **Official Duty**: Light blue badge (`#eff6ff`, border `#bfdbfe`, text `#1d4ed8`), preserved as authorized institutional duty.
   - **Normal Present**: Light green badge (`#f0fdf4`, border `#bbf7d0`, text `#15803d`).
   - Eliminates auto-conversion to generic `Normal Present`.

---

## 3. Goals & Non-Goals

### In-Scope Goals
* **Real-time Waiver Visibility**: Automatically surface active Masjid Jamath Exemptions in Extra Attendance roll-call cards with a 1-tap excusal action.
* **Permission Crash Elimination**: Author and deploy strict declarative security rules for `clearance_history` in `firestore.rules` supporting both numeric and string admission numbers.
* **Zero UI Lag on Multi-Student Queries**: Accelerate absence searching across multiple admission numbers to sub-second responses (<300ms) via in-memory `absentDates` filtering and cached daily indexes.
* **Granular Batch Workspace with Safe Commit Chunking**: Support clearing all candidate absences at once, per student, or per period, bounded by $\le 250$ writes per commit.
* **Semantic Status Preservation**: Maintain explicit separation between Medical Leave (rose/red) and Official Duty (blue).

### Out-of-Scope Non-Goals
* Modifying CCE Google Sheets sync routines (attendance records do not sync to examination mark sheets).
* Modifying Gate Security Kiosk barcode scanner verification routines.
* Altering Period Attendance roll-call recording for standard classroom teachers.

---

## 4. Technical Plan (Architecture & Specifications)

### 4.1 System Topology & Data Flow

```mermaid
flowchart TD
    subgraph DataStore ["Firestore Collections"]
        MW["campus_medical_waivers<br/>(SICK_IN_ROOM & JAMATH_EXEMPTION)"]
        CH["clearance_history<br/>(Audit records)"]
        CC["clearance_certificates<br/>(Legacy certificates)"]
        SC["systemCache<br/>(daySessionsIndex_{date} & periodSession_{id})"]
        ST["students<br/>(periodAttendance stats)"]
    end

    subgraph Security ["Firestore Security Rules"]
        VAL_H["isValidClearanceHist(data)"]
        VAL_C["isValidClearanceCert(data)"]
        RULE_H["match /clearance_history/{id}"]
        RULE_C["match /clearance_certificates/{id}"]
        RULE_H --> VAL_H
        RULE_C --> VAL_C
    end

    subgraph ExtraAttendancePortal ["NightAttendanceManager.jsx"]
        MW -->|Real-time Snapshot (where status == ACTIVE)| EA_STATE["activeCampusWaiversMap"]
        EA_STATE -->|Render Card Badge & 1-Tap Sick Action| EA_CARD["Student Roll-Call Card<br/>🩹 Masjid Exemption Badge"]
    end

    subgraph ClearancePortal ["AbsenceClearanceManager.jsx"]
        PRE_FILTER["In-Memory absentDates Filter<br/>(localStudents pre-conditioning)"]
        CACHE_ENGINE["Fast Chunked Index Engine<br/>(daySessionsIndex_{date} in 10-date batches)"]
        BATCH_UI["Multi-Student Batch Clearance Workspace<br/>(Grouped by Student + Per-Period Checkboxes)"]
        
        PRE_FILTER --> CACHE_ENGINE
        SC <-->|Read Indexes & Update attendanceMap| CACHE_ENGINE
        CACHE_ENGINE --> BATCH_UI
        BATCH_UI -->|Chunked Batch Commit <=250 writes| CH & CC & ST & SC
    end

    RULE_H -.->|Enforces Authorization| CH
    RULE_C -.->|Enforces Authorization| CC
```

---

### 4.2 Module Specifications

#### 1. Extra Attendance Medical Exemption Surfacing (`NightAttendanceManager.jsx`)
* **Waiver Listener Update**:
  Modify the query in `useEffect` (lines 89–113) to load all active waivers regardless of type:
  ```javascript
  const q = query(
    collection(db, 'campus_medical_waivers'),
    where('status', '==', 'ACTIVE')
  );
  ```
* **Student Roll-Call Card Enhancement**:
  When rendering students in Extra Attendance, verify date validity (`isWaiverActiveOnDate(waiver, extraDate)`):
  - Check `activeCampusWaiversMap[st.adNo]`.
  - If `waiverType === 'JAMATH_EXEMPTION'`:
    - Display an amber badge:
      `🩹 Masjid Exemption: ${waiver.injuryReason || 'Prayer Exemption'} (by ${waiver.issuedByName || 'Teacher'})`
    - Initial state remains `PRESENT`.
    - Teacher can tap `Sick` to immediately excusal without typing a manual reason.
  - If `waiverType === 'SICK_IN_ROOM'`:
    - Display a rose badge:
      `🤒 Sick in Room: ${waiver.injuryReason || 'Bed Rest'} (by ${waiver.issuedByName})`
    - Defaults to `SICK_ROOM` or 1-tap selectable.

#### 2. Declarative Security Rules for `clearance_history` (`firestore.rules`)
* Author dedicated validation and match rules supporting both numeric and alphanumeric admission numbers:
  ```javascript
  function isValidClearanceHist(data) {
    return data.keys().hasAll([
      'id', 'certNumber', 'studentRegNo', 'studentAdNo',
      'studentName', 'clearanceType', 'reason', 'dates',
      'totalPeriodsCleared', 'issuedByUsername', 'issuedAt'
    ]) &&
    data.id is string && data.id.size() >= 1 && data.id.size() <= 100 &&
    data.certNumber is string && data.certNumber.size() >= 1 && data.certNumber.size() <= 100 &&
    data.studentRegNo is string && data.studentRegNo.size() >= 1 && data.studentRegNo.size() <= 50 &&
    (data.studentAdNo is number || (data.studentAdNo is string && data.studentAdNo.size() >= 1 && data.studentAdNo.size() <= 50)) &&
    data.studentName is string && data.studentName.size() <= 100 &&
    data.clearanceType in ['MEDICAL_LEAVE', 'OFFICIAL_PRESENT'] &&
    data.dates is list && data.dates.size() <= 60 &&
    data.totalPeriodsCleared is number &&
    data.issuedByUsername is string && data.issuedByUsername.size() <= 100 &&
    ((data.issuedAt is string && data.issuedAt.size() <= 50) || data.issuedAt is timestamp);
  }

  match /clearance_history/{histId} {
    allow read: if isAuthenticated();
    allow create: if isStaffOrAdmin() && isValidClearanceHist(request.resource.data);
    allow update: if isStaffOrAdmin() && isValidClearanceHist(request.resource.data);
    allow delete: if isAdmin();
  }
  ```

#### 3. High-Velocity Multi-Student Absence Querying Engine (`AbsenceClearanceManager.jsx`)
* **In-Memory Pre-Filtering & Chunked Parallel Ingestion**:
  - Accept multiple admission numbers separated by commas or spaces (e.g. `3551, 3392, U1107`).
  - Resolve each admission number against `localStudents` in memory to retrieve the student's `regNo`, `name`, `classes`, and `department`.
  - Extract the union of all `absentDates` across all subjects for target students from `student.periodAttendance.subjectWise.*.absentDates`.
  - Filter this union against the requested clearance date range (`clearStartDate` to `clearEndDate`).
  - Ingest `daySessionsIndex_{date}` for the candidate absent dates in throttled parallel batches of 10 dates via `Promise.all`.
  - Concurrently retrieve session docs using a bounded pool (max 10 concurrent requests) and locate records where candidate student is marked `ABSENT` (`val === 'A'`).
* **Multi-Student Batch Workspace**:
  - Organize findings into a nested student hierarchy:
    ```
    ▼ Student: Sayyid Muhammad Sahran (#3462) — Class QLA3 [3 Absences]
      [✓] Clear Student (3 Periods)
      ├── [x] 11-11-2026 | Period 1 | Fiqh | Teacher: Siraj Hudawi
      ├── [x] 11-11-2026 | Period 2 | Thafseer | Teacher: Abdussalam Baqavi
      └── [x] 11-11-2026 | Period 4 | Hadith | Teacher: Ajmal Hudawi
    ```
  - Master controls:
    - **`⚡ Clear All Found Absences (N)`**
    - **`✓ Select / Deselect All`**
    - Per-period individual toggle checkboxes.

#### 4. Semantic Status Separation & Taxonomy Mapping
* **Taxonomy Matrix**:
  | UI Action Label | UI Styling / Palette | `clearance_history.clearanceType` | `systemCache.attendanceMap[regNo]` | Academic Effect |
  | :--- | :--- | :--- | :---: | :--- |
  | **Medical Leave (Excused)** | Light Rose (`#fff1f2`, border `#fecdd3`, text `#b91c1c`) | `'MEDICAL_LEAVE'` | `'M'` | Excused medical absence. Excluded from unexcused absence penalty without inflating normal presence. |
  | **Official Duty (Present)** | Light Blue (`#eff6ff`, border `#bfdbfe`, text `#1d4ed8`) | `'OFFICIAL_PRESENT'` | `'P'` | Authorized institutional representation. Counted as verified duty presence. |
  | **Unexcused Absence** | Red (`#fef2f2`, border `#fca5a5`, text `#dc2626`) | N/A (Uncleared) | `'A'` | Unexcused absence subject to shortage calculation. |

---

## 5. Alternatives Considered

| Alternative Considered | Pros | Cons | Why Rejected |
| :--- | :--- | :--- | :--- |
| **Alternative A: Client-side sequential date scan** (Status quo) | Simple `for` loop; low concurrent connection count. | Hangs the browser UI for 1–2 minutes when querying wide date spans across multiple students; freezes rendering loop. | Unusable in production for multi-student or multi-week audits; users see "Searching..." indefinitely. |
| **Alternative B: Cloud Function background aggregation** | Offloads query computation to Google Cloud infrastructure; client receives pre-computed results. | Adds cold-start latency (1–3s); increases infrastructure cost; requires server deployment and maintenance outside client app bundle. | Overkill. Pre-filtering with in-memory `absentDates` + chunked parallel client querying (`daySessionsIndex_{date}`) completes in <300ms using local client cache with zero backend cost. |
| **Alternative C: Unifying all clearance under generic `PRESENT`** | Simpler database schema; eliminates need for special `MEDICAL_LEAVE` status tracking. | Destroys medical leave audit trails; students with genuine illness cannot be distinguished from students on official college duties. | Explicitly rejected by institution and user requirement: Medical leaves must remain identifiable as excused medical records in light red. |
| **Alternative D: Client-side unrestricted writes to `clearance_history`** | Quickest fix for permission error without drafting detailed security rules. | Leaves the audit collection vulnerable to unauthorized tampering, data corruption, or malicious deletion. | Violates zero-trust security and Firestore declarative guidelines; strict schema validation rules must be deployed. |

---

## 6. Detailed Implementation Plan & Execution Phasing

### Phase 1: Security Rules Deployment (Subagent Delegation)
* **Target File**: [`firestore.rules`](file:///D:/Codes/mark-entry-app/firestore.rules)
* **Execution**: Delegate authoring to the `firestore-rules-author` subagent in accordance with the mandatory security guidelines.
* **Specification**:
  1. **Add Validator Function `isValidClearanceHist(data)`**:
     ```javascript
     function isValidClearanceHist(data) {
       return data.keys().hasAll([
         'id', 'certNumber', 'studentRegNo', 'studentAdNo',
         'studentName', 'clearanceType', 'reason', 'dates',
         'totalPeriodsCleared', 'issuedByUsername', 'issuedAt'
       ]) &&
       data.id is string && data.id.size() >= 1 && data.id.size() <= 100 &&
       data.certNumber is string && data.certNumber.size() >= 1 && data.certNumber.size() <= 100 &&
       data.studentRegNo is string && data.studentRegNo.size() >= 1 && data.studentRegNo.size() <= 50 &&
       (data.studentAdNo is number || (data.studentAdNo is string && data.studentAdNo.size() >= 1 && data.studentAdNo.size() <= 50)) &&
       data.studentName is string && data.studentName.size() <= 100 &&
       data.clearanceType in ['MEDICAL_LEAVE', 'OFFICIAL_PRESENT'] &&
       data.dates is list && data.dates.size() <= 60 &&
       data.totalPeriodsCleared is number &&
       data.issuedByUsername is string && data.issuedByUsername.size() <= 100 &&
       ((data.issuedAt is string && data.issuedAt.size() <= 50) || data.issuedAt is timestamp);
     }
     ```
  2. **Add Match Block for `clearance_history`**:
     ```javascript
     match /clearance_history/{histId} {
       allow read: if isAuthenticated();
       allow create: if isStaffOrAdmin() && isValidClearanceHist(request.resource.data);
       allow update: if isStaffOrAdmin() && isValidClearanceHist(request.resource.data);
       allow delete: if isAdmin();
     }
     ```
  3. **Verify and Deploy**: Verify syntax via `firebase deploy --only firestore:rules` or rules emulator test suite.

---

### Phase 2: Extra Attendance Waiver Listener & Card UI
* **Target File**: [`app/components/NightAttendanceManager.jsx`](file:///D:/Codes/mark-entry-app/app/components/NightAttendanceManager.jsx)
* **Actions**:
  1. **Broaden Real-Time Listener**:
     In `useEffect` (lines 89–113), update the query from `where('waiverType', '==', 'SICK_IN_ROOM')` to:
     ```javascript
     const q = query(
       collection(db, 'campus_medical_waivers'),
       where('status', '==', 'ACTIVE')
     );
     ```
  2. **Index Active Waivers**:
     Populate `activeCampusWaiversMap` keyed by uppercase admission number:
     ```javascript
     const ad = String(data.adNo || data.studentAdNo || '').trim().toUpperCase();
     if (ad) wMap[ad] = { id: docSnap.id, ...data };
     ```
  3. **Contextual Badge Display**:
     In the student card rendering, verify date validity (`isWaiverActiveOnDate(waiver, extraDate)`). If active:
     - For `JAMATH_EXEMPTION`: Amber badge with icon 🩹, `waiver.injuryReason`, and `waiver.issuedByName`.
     - For `SICK_IN_ROOM`: Rose badge with icon 🤒, `waiver.injuryReason`, and `waiver.issuedByName`.
  4. **Roll-Call Status Defaults & 1-Tap Excusal**:
     - For students with `JAMATH_EXEMPTION`, default roll-call status cleanly to `PRESENT` (do not flag as absent).
     - For students with `SICK_IN_ROOM`, provide a 1-tap `🤒 Sick in Room` button on the roll-call card that sets `extraStatusMap[ad] = 'SICK_ROOM'` and auto-populates `absentReasonsMap[ad] = waiver.injuryReason || 'Medical Bed Rest'`.

---

### Phase 3: High-Velocity Clearance Engine & Multi-Student Batch Workspace
* **Target File**: [`app/components/AbsenceClearanceManager.jsx`](file:///D:/Codes/mark-entry-app/app/components/AbsenceClearanceManager.jsx)
* **Actions**:
  1. **Multi-Input Parsing & Identity Resolution**:
     - Parse comma- or space-separated admission numbers from `clearAdNo`.
     - Resolve each admission number against `localStudents` in memory to retrieve the full student record (`regNo`, `adNo`, `firstName`, `classes`, `department`).
  2. **In-Memory Pre-Filtering & Chunked Parallel Search**:
     - **Step A (In-Memory Pre-Filter)**: Extract the union of all `absentDates` across all subjects for target students from `student.periodAttendance.subjectWise.*.absentDates`.
     - **Step B (Range Intersection)**: Filter this union to only include dates falling within the requested clearance date range (`clearStartDate` to `clearEndDate`).
     - **Step C (Chunked Parallel Fetch)**: Partition only the candidate absent dates into parallel chunks of $\le 10$ dates. Query `doc(db, 'systemCache', 'daySessionsIndex_' + dStr)` for these dates concurrently.
     - **Step D (Session Retrieval with Concurrency Guard)**: For active sessions containing target student absences, fetch session docs using a bounded concurrency pool (max 10 concurrent requests).
  3. **Hierarchical Batch Workspace UI**:
     - Render candidate absences grouped by student card with Select All / Deselect All, student-level toggles, and individual period checkboxes.
     - Add master bulk action `⚡ Clear All Found Absences (N)` alongside individual student clearance buttons.
  4. **Status Taxonomy & Multi-Target Batch Write Chunking**:
     - Standardize data mapping:
       * **Medical Leave**: UI = `🏥 Medical Leave (Excused)`, History `clearanceType = 'MEDICAL_LEAVE'`, Session Code = `'M'`.
       * **Official Duty**: UI = `🏛️ Official Duty (Present)`, History `clearanceType = 'OFFICIAL_PRESENT'`, Session Code = `'P'`.
     - **Batch Write Chunking ($\le 250$ Operations)**:
       Build an array of write operations across:
       1. `clearance_history/{histDocId}`: write full `histObj`.
       2. `clearance_certificates/{histDocId}`: write mirror payload explicitly including `status: 'ISSUED'` and `dates: targetDates.slice(0, 50)`.
       3. `systemCache/{sessionDocId}`: update `attendanceMap[studentRegNo]` to `'M'` or `'P'`.
       4. `students/{studentDocId}`: update `periodAttendance` stats (`presentCount`, `medicalCount`, `officialCount`, and prune `absentDates`).
       Partition all writes into discrete chunks of $\le 250$ operations:
       ```javascript
       const CHUNK_SIZE = 250;
       for (let i = 0; i < allOperations.length; i += CHUNK_SIZE) {
         const batch = writeBatch(db);
         const chunk = allOperations.slice(i, i + CHUNK_SIZE);
         chunk.forEach(op => op(batch));
         await batch.commit();
       }
       ```

---

### Phase 4: Sync Secondary Clearance Component
* **Target File**: [`app/components/PeriodAttendanceMinusAndClearance.jsx`](file:///D:/Codes/mark-entry-app/app/components/PeriodAttendanceMinusAndClearance.jsx)
* **Actions**:
  1. Synchronize the clearance save handler (`handleApplyClearance`, lines 1080–1150):
     - Ensure session document updates in `systemCache` write single-character codes (`'M'`, `'P'`).
     - If writing to `clearance_certificates`, explicitly include `status: 'ISSUED'`.
     - Ensure writes to `students` and `systemCache` obey the $\le 250$ write batch chunking limit.
  2. Align the color palette and status badges with Phase 3 (Rose `#fff1f2` for Medical, Blue `#eff6ff` for Official).

---

### Phase 5: Verification & Production Regression Suite
1. **Compilation & Build**: Run `npm run build` to guarantee zero JSX, ESLint, or TypeScript syntax errors.
2. **Security Rules Verification**: Test `isValidClearanceHist` against Firebase Emulator suite. Assert that numeric `studentAdNo` (e.g. `3462`) and string `studentAdNo` (e.g. `'U1107'`) both pass rule evaluation.
3. **500-Write Batch Stress Test**: Execute a simulated bulk clearance with $>100$ absent periods across 10 students (total write operations $>400$). Verify all batches commit cleanly without transaction limit errors.
4. **Mirror Write Validation**: Verify that documents created in `clearance_certificates` contain `status: 'ISSUED'` and pass `isValidClearanceCert`.
5. **Latency Validation**: Run multi-student search over a 60-day range. Confirm that in-memory `absentDates` pre-filtering keeps query execution time $<300\text{ms}$.
