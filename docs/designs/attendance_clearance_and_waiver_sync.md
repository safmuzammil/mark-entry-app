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
   - Implements a dedicated schema validator `isValidClearanceHist` in [`firestore.rules`](file:///D:/Codes/mark-entry-app/firestore.rules) checking required string attributes, bounded array sizes (`dates <= 60`, `clearedSessions <= 100`), and role authorization (`isStaffOrAdmin()`).

3. **High-Velocity Multi-Student Batch Clearance Workspace**:
   - Implements a chunked parallel query engine utilizing client-side cached daily session indexes (`daySessionsIndex_{date}`) in batches of 10 dates, short-circuiting dates with zero sessions.
   - Groups candidate absences by student in a responsive batch table displaying each individual absent period (Date, Period Number, Subject, Original Teacher).
   - Provides a master **"Clear All Found Absences"** action, per-student batch clearance, and granular per-period checkboxes.

4. **Normalized Visual & Data Status Palette**:
   - **Medical Leave**: Light red/rose badge (`#fff1f2` / `#fef2f2`, border `#fecdd3`, text `#b91c1c`), preserved as excused medical absence.
   - **Official Duty**: Light blue badge (`#eff6ff`, border `#bfdbfe`, text `#1d4ed8`), preserved as authorized institutional duty.
   - **Normal Present**: Light green badge (`#f0fdf4`, border `#bbf7d0`, text `#15803d`).
   - Eliminates auto-conversion to generic `Normal Present`.

---

## 3. Goals & Non-Goals

### In-Scope Goals
* **Real-time Waiver Visibility**: Automatically surface active Masjid Jamath Exemptions in Extra Attendance roll-call cards with a 1-tap excusal action.
* **Permission Crash Elimination**: Author and deploy strict declarative security rules for `clearance_history` in `firestore.rules`.
* **Zero UI Lag on Multi-Student Queries**: Accelerate absence searching across multiple admission numbers to sub-second responses via cached daily indexes and parallel chunking.
* **Granular Batch Workspace**: Support clearing all candidate absences at once, per student, or per period.
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
        VAL["isValidClearanceHist(data)"]
        RULE["match /clearance_history/{id}"]
        RULE --> VAL
    end

    subgraph ExtraAttendancePortal ["NightAttendanceManager.jsx"]
        MW -->|Real-time Snapshot (where status == ACTIVE)| EA_STATE["activeCampusWaiversMap"]
        EA_STATE -->|Render Card Badge & 1-Tap Sick Action| EA_CARD["Student Roll-Call Card<br/>🩹 Masjid Exemption Badge"]
    end

    subgraph ClearancePortal ["AbsenceClearanceManager.jsx"]
        CACHE_ENGINE["Fast Chunked Index Engine<br/>(daySessionsIndex_{date})"]
        BATCH_UI["Multi-Student Batch Clearance Workspace<br/>(Grouped by Student + Per-Period Checkboxes)"]
        
        SC --> CACHE_ENGINE
        CACHE_ENGINE --> BATCH_UI
        BATCH_UI -->|Atomic Batch Commit| CH & CC & ST
    end

    RULE -.->|Enforces Authorization| CH
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
  When rendering students in Extra Attendance:
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
* Author dedicated validation and match rules:
  ```javascript
  function isValidClearanceHist(data) {
    return data.keys().hasAll([
      'id', 'certNumber', 'studentRegNo', 'studentAdNo',
      'studentName', 'clearanceType', 'reason', 'dates',
      'totalPeriodsCleared', 'issuedByUsername', 'issuedAt'
    ]) &&
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

#### 3. High-Velocity Multi-Student Absence Querying Engine (`AbsenceClearanceManager.jsx`)
* **Parallel Chunked Ingestion**:
  - Accept multiple admission numbers separated by commas or spaces (e.g. `3551, 3392, U1107`).
  - Calculate target date list.
  - Ingest `daySessionsIndex_{date}` in throttled parallel batches of 10 dates via `Promise.all`.
  - If `daySessionsIndex_{date}` reports 0 sessions, immediately skip without requesting individual session docs.
  - For active sessions, retrieve candidate session docs in parallel and locate records where candidate student is marked `ABSENT` (`val === 'A'`).
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

#### 4. Semantic Status Separation & Color Palette Normalization
* **Status Badges & Tokens**:
  - **Medical Leave**:
    - Container: `background: #fff1f2; border: 1px solid #fecdd3; color: #b91c1c;`
    - Action Label: `🏥 Record Medical Leave (Excused)`
    - Applied Status in Session: `MEDICAL_LEAVE` (never generic `PRESENT`)
    - Effect: Excused from academic absence penalties without modifying official presence ratios.
  - **Official Duty**:
    - Container: `background: #eff6ff; border: 1px solid #bfdbfe; color: #1d4ed8;`
    - Action Label: `🏛️ Clear Official Duty (Official Present)`
    - Applied Status in Session: `OFFICIAL_DUTY` or `PRESENT`
    - Effect: Counted as verified institutional representation.
  - **Unexcused Absence**:
    - Container: `background: #fef2f2; border: 1px solid #fca5a5; color: #dc2626;`


---

## 5. Alternatives Considered

| Alternative Considered | Pros | Cons | Why Rejected |
| :--- | :--- | :--- | :--- |
| **Alternative A: Client-side sequential date scan** (Status quo) | Simple `for` loop; low concurrent connection count. | Hangs the browser UI for 1–2 minutes when querying wide date spans across multiple students; freezes rendering loop. | Unusable in production for multi-student or multi-week audits; users see "Searching..." indefinitely. |
| **Alternative B: Cloud Function background aggregation** | Offloads query computation to Google Cloud infrastructure; client receives pre-computed results. | Adds cold-start latency (1–3s); increases infrastructure cost; requires server deployment and maintenance outside client app bundle. | Overkill. Chunked parallel client querying (`daySessionsIndex_{date}`) completes in <300ms using local client cache with zero backend cost. |
| **Alternative C: Unifying all clearance under generic `PRESENT`** | Simpler database schema; eliminates need for special `MEDICAL_LEAVE` status tracking. | Destroys medical leave audit trails; students with genuine illness cannot be distinguished from students on official college duties. | Explicitly rejected by institution and user requirement: Medical leaves must remain identifiable as excused medical records in light red. |
| **Alternative D: Client-side unrestricted writes to `clearance_history`** | Quickest fix for permission error without drafting detailed security rules. | Leaves the audit collection vulnerable to unauthorized tampering, data corruption, or malicious deletion. | Violates zero-trust security and Firestore declarative guidelines; strict schema validation rules must be deployed. |

---

## 6. Detailed Implementation Plan & Execution Phasing

### Phase 1: Security Rules Deployment (Subagent Delegation)
* **Target File**: [`firestore.rules`](file:///D:/Codes/mark-entry-app/firestore.rules)
* **Execution**: Delegate authoring to the `firestore-rules-author` subagent in accordance with the mandatory security guidelines.
* **Specification**:
  - Add validator function `isValidClearanceHist(data)`.
  - Add match block for `match /clearance_history/{histId}` with authenticated read, staff/admin create/update, and admin-only delete.
  - Verify syntax and run `firebase deploy --only firestore:rules` or validate rules compilation.

### Phase 2: Extra Attendance Waiver Listener & Card UI
* **Target File**: [`app/components/NightAttendanceManager.jsx`](file:///D:/Codes/mark-entry-app/app/components/NightAttendanceManager.jsx)
* **Actions**:
  1. Broaden `campus_medical_waivers` query from `where('waiverType', '==', 'SICK_IN_ROOM')` to `where('status', '==', 'ACTIVE')`.
  2. Map waivers by student admission number (`adNo`) into `activeCampusWaiversMap`.
  3. In the student roll-call card, display the prominent badge:
     - For `JAMATH_EXEMPTION`: Amber badge with icon 🩹, mobility diagnosis, and authorizing teacher name.
     - For `SICK_IN_ROOM`: Rose badge with icon 🤒, bed-rest diagnosis, and authorizing teacher name.
  4. Ensure initial attendance status defaults cleanly (e.g. `Present` for Jamath exemptions or non-destructive default) and provide a 1-tap `Sick` button so attendance takers can record excusal in one click.

### Phase 3: High-Velocity Clearance Engine & Multi-Student Batch Workspace
* **Target File**: [`app/components/AbsenceClearanceManager.jsx`](file:///D:/Codes/mark-entry-app/app/components/AbsenceClearanceManager.jsx)
* **Actions**:
  1. **Multi-Input Parsing**: Parse comma/space-separated admission numbers from the input box.
  2. **Chunked Parallel Search**:
     - Partition date range into chunks of 10 dates.
     - Fetch `daySessionsIndex_{date}` in parallel.
     - Fast skip empty dates.
     - Concurrently read session documents for active dates.
     - Extract only sessions where target students are marked `ABSENT`.
  3. **Hierarchical Batch Workspace**:
     - Render candidate absences grouped by student card.
     - List each absent period in a distinct row with Date, Period Number, Subject Name, Faculty Name, and current status.
     - Implement Select All / Deselect All, Student-level toggle, and individual period checkboxes.
     - Add master action: `⚡ Clear All Found Absences (N)` alongside individual student clearance buttons.
  4. **Status Badging & Provenance Preservation**:
     - Support separate clearance modes:
       - **Medical Leave**: Excused medical status with light red badge (`#fff1f2`, border `#fecdd3`, text `#b91c1c`).
       - **Official Duty**: Authorized duty with light blue badge (`#eff6ff`, border `#bfdbfe`, text `#1d4ed8`).
     - Commit batch updates atomically to `clearance_history`, `clearance_certificates`, and individual session records in `systemCache`.

### Phase 4: Sync Secondary Clearance Component
* **Target File**: [`app/components/PeriodAttendanceMinusAndClearance.jsx`](file:///D:/Codes/mark-entry-app/app/components/PeriodAttendanceMinusAndClearance.jsx)
* **Actions**:
  - Update any shared clearance helpers or styling to ensure consistent permissions, performance, and color palette across both clearance tabs.

### Phase 5: Verification & Production Build
1. Build verification via `npm run build` to confirm zero JSX, syntax, or type errors.
2. Verify Firestore rules syntax against Firebase emulators / schema parser.
3. Validate multi-student query performance (<300ms for multi-week spans).
4. Verify visual fidelity against provided screenshots.
