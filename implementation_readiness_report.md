# Stage 9 Implementation Readiness Report: Permitted Leave & Absentees Export

**Target Document:** [`docs/designs/permitted_leave_and_absentees_export.md`](file:///D:/Codes/mark-entry-app/docs/designs/permitted_leave_and_absentees_export.md)  
**Evaluated Scope:** DetailedRange (Lines 201..286: Section 6 Phases 1–5)  
**Overall Readiness Verdict:** 🛑 **CHANGES REQUIRED**

---

## 1. Reviewer Swarm Status

| Reviewer Persona | Lens Specialization | Status | Key Focus Area |
| :--- | :--- | :--- | :--- |
| **`egm-implementation-readiness`** | Pragmatic Tech Lead | **completed** | Actionability, edge cases, zero-decision handoff |
| **`egm-codebase-details`** | Pedantic Quality Auditor | **completed** | Identifier fidelity, line numbers, API signatures |
| **`egm-style`** | Technical Copy Editor | **completed** | Precision, brevity, declarative formatting |

---

## 2. Executive Summary & Verdict Rationale

While Phase 1 (`firestore.rules` line 401) is precise, the Detailed Implementation Plan in Section 6 exhibits **3 Blockers** and **3 Major Deficiencies** that will lead to state corruption and broken UI workflows if handed to an implementer without amendment:

1. **Regression on Delta Accounting (Combinatorial vs. Symmetric Two-Step)**: Phase 2 lines 226–238 lists ad-hoc combinatorial branches (`A ➔ L`, `P ➔ L`, `L ➔ P`, `L ➔ A`), directly contradicting Stage 8's architecture. It completely overlooks transitions involving Medical Leave (`M`) and Official Duty (`O`) (e.g. `M ➔ L`, `L ➔ M`, `O ➔ L`), which will cause attendance counter drift during session re-edits.
2. **Non-Existent Target Function in Phase 4**: Phase 4 instructs modifying `handleApplyClearance` in [`PeriodAttendanceMinusAndClearance.jsx`](file:///D:/Codes/mark-entry-app/app/components/PeriodAttendanceMinusAndClearance.jsx). This function **does not exist** in the codebase. The actual functions are `handleSaveClearance` (lines 755–820) and `handleUpdateSessionStatus` (lines 1066–1150).
3. **Hidden Zero-Absentees UI Shell**: Stage 8 established that on 0 unexcused absentees, WhatsApp is disabled while Clipboard remains active with `"None"`. However, in [`PeriodAttendanceManager.jsx`](file:///D:/Codes/mark-entry-app/app/components/PeriodAttendanceManager.jsx#L2342), the entire export card is rendered inside `{absentStudentsByClassGroups.length > 0 && (...)`. When absentees drop to zero, `absentStudentsByClassGroups` is empty, completely removing the Clipboard button from the DOM.
4. **Unspecified Session State & Card Bubbling**: Initial state hydration for new sessions in `checkExistingSession` (`else` branch) is omitted, and card chip clicks lack `e.stopPropagation()`, causing chip cycling to immediately trigger card toggle.

---

## 3. Prioritized Findings (Blockers ➔ Major ➔ Nits)

### 🔴 Blocker 1: Regressed Combinatorial Delta Accounting
* **Reviewer Lens:** `egm-implementation-readiness` & `egm-codebase-details`
* **Affected Scope:** Lines 226–238 ([`permitted_leave_and_absentees_export.md#L226-L238`](file:///D:/Codes/mark-entry-app/docs/designs/permitted_leave_and_absentees_export.md#L226-L238))
* **Discrepancy Description**: Section 6 Phase 2 prescribes explicit combinatorial `oldStatus === 'X' && newStatus === 'Y'` branches. Transitions like `M ➔ L`, `L ➔ M`, `O ➔ L`, and `L ➔ O` are omitted. If a student was recorded under Medical/Sick Leave or Official Outpass and the teacher adjusts them to Permitted Leave, `curStat.medicalCount` or `officialCount` is never decremented, while `permittedCount` is incremented, leading to permanent attendance overcounting.
* **Recommendation**: Replace lines 226–238 with the **Symmetric Two-Step Delta Helper**:
  - **Step 1 (Unapply `oldStatus`)**:
    - If `P` or `O`: decrement `curStat.presentCount` and `subObj.present`.
    - If `O`: decrement `curStat.officialCount` and `subObj.official`.
    - If `M`: decrement `curStat.medicalCount` and `subObj.medical`.
    - If `L`: decrement `curStat.permittedCount` and `subObj.permitted`.
    - If `A`: remove session date from `subObj.absentDates`.
  - **Step 2 (Apply `newStatus`)**:
    - If `P` or `O`: increment `curStat.presentCount` and `subObj.present`.
    - If `O`: increment `curStat.officialCount` and `subObj.official`.
    - If `M`: increment `curStat.medicalCount` and `subObj.medical`.
    - If `L`: increment `curStat.permittedCount` and `subObj.permitted` (do not increment `present`).
    - If `A`: append session date to `subObj.absentDates`.

---

### 🔴 Blocker 2: Non-Existent Target Function `handleApplyClearance`
* **Reviewer Lens:** `egm-codebase-details` & `egm-implementation-readiness`
* **Affected Scope:** Lines 274–278 ([`permitted_leave_and_absentees_export.md#L274-L278`](file:///D:/Codes/mark-entry-app/docs/designs/permitted_leave_and_absentees_export.md#L274-L278))
* **Discrepancy Description**: Phase 4 names `handleApplyClearance`. In [`PeriodAttendanceMinusAndClearance.jsx`](file:///D:/Codes/mark-entry-app/app/components/PeriodAttendanceMinusAndClearance.jsx), the clearance workflow is divided into:
  1. `handleSaveClearance` (lines 755–820): handles clearance certificate generation and period attendance adjustments. Currently, lines 808–814 default any non-medical/non-official clearance to setting `attMap[regNo] = 'O'` and inflating `presentCount`. Line 921 only writes `clearanceType: clearReason === 'medical' ? 'MEDICAL_LEAVE' : 'OFFICIAL_PRESENT'`.
  2. `handleUpdateSessionStatus` (lines 1066–1150): handles session-by-session corrections in the Inspection tab. Lines 1072–1136 only recognize `A`, `P`, `O`, `M`, lacking any handler for `L`.
* **Recommendation**: Retarget Phase 4 to:
  1. Refactor `handleSaveClearance`: When `clearReason === 'permitted'`, set `attMap[reg] = 'L'`, increment `curStat.permittedCount` and `subObj.permitted`, do not inflate `presentCount`, and emit `clearanceType = 'PERMITTED_LEAVE'` to `clearance_history` (line 921).
  2. Refactor `handleUpdateSessionStatus`: Add support for `L` (`PERMITTED_LEAVE`) in Step 1 (unapply) and Step 2 (apply), and add a button to the inspection action bar.

---

### 🔴 Blocker 3: Zero-Absentees UI Container Collapses on Zero Absentees
* **Reviewer Lens:** `egm-implementation-readiness`
* **Affected Scope:** Lines 245–261 ([`permitted_leave_and_absentees_export.md#L245-L261`](file:///D:/Codes/mark-entry-app/docs/designs/permitted_leave_and_absentees_export.md#L245-L261))
* **Discrepancy Description**: Phase 2 Action 4 instructs: "Disable the WhatsApp button when `unexcusedStudents.length === 0`" and display `"None (All students present or excused)"`. In [`PeriodAttendanceManager.jsx`](file:///D:/Codes/mark-entry-app/app/components/PeriodAttendanceManager.jsx#L2342), the entire export block is rendered as `{absentStudentsByClassGroups.length > 0 && (...)}`. When all students are present or excused, `absentStudentsByClassGroups` evaluates to `[]`, unmounting the entire block. The Clipboard copy button becomes inaccessible.
* **Recommendation**: Instruct the implementer to compute class groups across all enrolled students in the batch (`enrolledClassGroups`), or conditionally render the export card whenever `classStudents.length > 0`. If `unexcusedStudents.length === 0`, disable the WhatsApp button (`disabled`, opacity 0.5, cursor `not-allowed`) and leave the Clipboard button active.

---

### 🟡 Major 1: Incomplete `sessionStatusMap` State Hydration (New Sessions)
* **Reviewer Lens:** `egm-implementation-readiness` & `egm-codebase-details`
* **Affected Scope:** Lines 215–224 ([`permitted_leave_and_absentees_export.md#L215-L224`](file:///D:/Codes/mark-entry-app/docs/designs/permitted_leave_and_absentees_export.md#L215-L224))
* **Discrepancy Description**: Phase 2 replaces `setAbsentRegNos` with `setSessionStatusMap` in `checkExistingSession`, but provides zero specification for the `else` branch (lines 562–587) when creating a brand-new session. Furthermore, state declaration `const [sessionStatusMap, setSessionStatusMap] = useState({})` is not mentioned.
* **Recommendation**:
  1. Specify declaring `const [sessionStatusMap, setSessionStatusMap] = useState({})`.
  2. In `checkExistingSession` `else` branch, initialize `sessionStatusMap`:
     ```javascript
     const initialMap = {};
     enrolledSts.forEach(st => {
       const reg = String(st.regNo || st.id).trim();
       if (isRehearsalPresent(st)) initialMap[reg] = 'P';
       else if (isOfficialOutpass(st)) initialMap[reg] = 'O';
       else if (isMedicalOutpassOrWaiver(st)) initialMap[reg] = 'M';
       else if (isUnexcusedOutpassOrRecordedAbsence(st)) initialMap[reg] = 'A';
       else initialMap[reg] = 'P';
     });
     setSessionStatusMap(initialMap);
     ```

---

### 🟡 Major 2: Missing Event Propagation Guard on 4-Way Status Chip
* **Reviewer Lens:** `egm-implementation-readiness`
* **Affected Scope:** Lines 241–244 ([`permitted_leave_and_absentees_export.md#L241-L244`](file:///D:/Codes/mark-entry-app/docs/designs/permitted_leave_and_absentees_export.md#L241-L244))
* **Discrepancy Description**: The outer student card element has an `onClick` that invokes `toggleAbsent` (`P ↔ A`). If the status chip badge is rendered inside without `e.stopPropagation()`, clicking the chip triggers both the chip state cycle and the card toggle simultaneously, corrupting the UI state.
* **Recommendation**: Specify that the interactive chip must include `onClick={(e) => { e.stopPropagation(); cycleStatus(st.regNo); }}` with the strict cyclic transition: `A ➔ L ➔ M ➔ P (➔ A)`.

---

### 🟡 Major 3: Incomplete Night Attendance & Extra Attendance Delta Sync
* **Reviewer Lens:** `egm-implementation-readiness` & `egm-codebase-details`
* **Affected Scope:** Lines 264–270 ([`permitted_leave_and_absentees_export.md#L264-L270`](file:///D:/Codes/mark-entry-app/docs/designs/permitted_leave_and_absentees_export.md#L264-L270))
* **Discrepancy Description**:
  1. In [`NightAttendanceManager.jsx`](file:///D:/Codes/mark-entry-app/app/components/NightAttendanceManager.jsx#L240), `presentCount` is calculated as:
     `presentCount = targetStudents.length - absentAdNos.length - outpassAdNos.length - officialAdNos.length - sickAdNos.length`.
     If `permittedAdNos` is introduced, it must also be subtracted; otherwise students on `LEAVE` will be counted as `PRESENT`.
  2. Action 1 instructs adding `LEAVE` for both Extra and Night attendance, but Action 2 only modifies `handleSaveExtraAttendance` (`night_extra_attendance`) without updating `handleSaveClassAttendance` (which writes to `night_attendance` lines 742–786).
* **Recommendation**:
  1. In `handleSaveExtraAttendance`, define `permittedAdNos = []`, subtract `permittedAdNos.length` from `presentCount`, and persist `permittedCount` and `permittedAdNos` to `night_extra_attendance`.
  2. In `handleSaveClassAttendance`, gather `permittedAdNos` and store `permittedCount` in `night_attendance`.

---

### 🟢 Nit 1: Technical Style in Phase 5
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Line 282 ([`permitted_leave_and_absentees_export.md#L282`](file:///D:/Codes/mark-entry-app/docs/designs/permitted_leave_and_absentees_export.md#L282))
* **Discrepancy Description**: `Run npm run build with BypassSandbox: true` references an LLM harness parameter rather than standard build instructions.
* **Recommendation**: Rephrase to standard imperative: `Run npm run build to verify zero TypeScript, bundling, or JSX compilation errors.`

---

### 🟢 Nit 2: Line Number Verification in `firestore.rules`
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** Line 204 ([`permitted_leave_and_absentees_export.md#L204`](file:///D:/Codes/mark-entry-app/docs/designs/permitted_leave_and_absentees_export.md#L204))
* **Observation**: Line 401 in [`firestore.rules`](file:///D:/Codes/mark-entry-app/firestore.rules#L401) is verified exact (`data.clearanceType in ['MEDICAL_LEAVE', 'OFFICIAL_PRESENT']`). Note that `isValidClearanceCert` (lines 364–377) uses open string validation for `reason` and does not require enum alteration.

---

## 4. Suggested Markdown Replacement for Section 6 (Lines 201..286)

```markdown
### Phase 1: Security Rules Deployment (Subagent Delegation)
* **Target File**: [`firestore.rules`](file:///D:/Codes/mark-entry-app/firestore.rules)
* **Execution**: Delegate authoring to the `firestore-rules-author` subagent.
* **Specification**:
  1. In `isValidClearanceHist` (line 401), add `'PERMITTED_LEAVE'` to the allowed `clearanceType` enum:
     ```javascript
     data.clearanceType in ['MEDICAL_LEAVE', 'OFFICIAL_PRESENT', 'PERMITTED_LEAVE']
     ```
  2. Verify rules compilation and deploy via `firebase deploy --only firestore:rules`.

---

### Phase 2: Period Attendance Roll-Call & Re-Save Delta Accounting
* **Target File**: [`app/components/PeriodAttendanceManager.jsx`](file:///D:/Codes/mark-entry-app/app/components/PeriodAttendanceManager.jsx)
* **Actions**:
  1. **State Declaration & Loader Refactor (`checkExistingSession`)**:
     - Declare `const [sessionStatusMap, setSessionStatusMap] = useState({});`.
     - In `checkExistingSession` (lines 549–592):
       - If session doc exists: map `data.attendanceMap` into `sessionStatusMap`, preserving `'L'`, `'M'`, `'O'`, `'A'`, and `'P'`.
       - If session doc does not exist (`else` branch): initialize `sessionStatusMap` for all enrolled students based on active outpasses and pre-recorded absences (Outpass/Recorded ➔ `'A'`, Medical ➔ `'M'`, Official ➔ `'O'`, default ➔ `'P'`).
  2. **Session Save & Symmetric Two-Step Delta Recalculation (`handleSaveAttendance`)**:
     - Refactor `handleSaveAttendance` to utilize the **Symmetric Two-Step Delta Helper** for each student (`oldStatus` vs `newStatus`):
       ```javascript
       // Step 1: Unapply Old Status
       if (oldStatus === 'P' || oldStatus === 'O') {
         curStat.presentCount = Math.max(0, (curStat.presentCount || 0) - 1);
         subObj.present = Math.max(0, (subObj.present || 0) - 1);
       }
       if (oldStatus === 'O') {
         curStat.officialCount = Math.max(0, (curStat.officialCount || 0) - 1);
         subObj.official = Math.max(0, (subObj.official || 0) - 1);
       } else if (oldStatus === 'M') {
         curStat.medicalCount = Math.max(0, (curStat.medicalCount || 0) - 1);
         subObj.medical = Math.max(0, (subObj.medical || 0) - 1);
       } else if (oldStatus === 'L') {
         curStat.permittedCount = Math.max(0, (curStat.permittedCount || 0) - 1);
         subObj.permitted = Math.max(0, (subObj.permitted || 0) - 1);
       } else if (oldStatus === 'A') {
         const idx = subObj.absentDates.indexOf(attDate);
         if (idx !== -1) subObj.absentDates.splice(idx, 1);
       }

       // Step 2: Apply New Status
       if (newStatus === 'P' || newStatus === 'O') {
         curStat.presentCount = Math.min(curStat.totalPeriods || 9999, (curStat.presentCount || 0) + 1);
         subObj.present = Math.min(subObj.total || 9999, (subObj.present || 0) + 1);
       }
       if (newStatus === 'O') {
         curStat.officialCount = (curStat.officialCount || 0) + 1;
         subObj.official = (subObj.official || 0) + 1;
       } else if (newStatus === 'M') {
         curStat.medicalCount = (curStat.medicalCount || 0) + 1;
         subObj.medical = (subObj.medical || 0) + 1;
       } else if (newStatus === 'L') {
         curStat.permittedCount = (curStat.permittedCount || 0) + 1;
         subObj.permitted = (subObj.permitted || 0) + 1;
       } else if (newStatus === 'A') {
         if (!subObj.absentDates.includes(attDate)) subObj.absentDates.push(attDate);
       }
       ```
     - Persist `sessionStatusMap` to `systemCache` session doc and write updated student stats in chunks ($\le 250$).
  3. **Card UI & Progressive Status Selector**:
     - Default card click toggles `P` ↔ `A`.
     - Non-present cards display an interactive status chip badge cycling:
       `[🔴 ABSENT]` ➔ `[🟣 LEAVE]` ➔ `[🟡 MEDICAL]` ➔ `[🟢 PRESENT]`.
     - Badge chip click handler must call `e.stopPropagation()` to prevent card click toggle bubbling.
  4. **Targeted Absentees WhatsApp & Clipboard Export**:
     - Ensure the absentee export shell renders whenever `classStudents.length > 0` (do not hide on 0 absentees).
     - Filter unexcused absentees strictly for `status === 'A'` (excluding `'P'`, `'M'`, `'O'`, `'L'`).
     - If `unexcusedStudents.length === 0`:
       - Clipboard copy text emits: `*Unexcused Absent Students (0):*\nNone (All students present or excused)`.
       - WhatsApp button is rendered in disabled state (`disabled={true}`, opacity 0.5, cursor `not-allowed`).

---

### Phase 3: Extra & Night Attendance Integration
* **Target File**: [`app/components/NightAttendanceManager.jsx`](file:///D:/Codes/mark-entry-app/app/components/NightAttendanceManager.jsx)
* **Actions**:
  1. Add `LEAVE` button (`id: 'LEAVE', label: 'Leave', activeBg: '#8b5cf6'`) to card action clusters in both Night Attendance (`take_attendance`) and Extra Attendance (`extra_attendance`).
  2. In `handleSaveExtraAttendance`:
     - Accumulate `permittedAdNos` where `stStatus === 'LEAVE'`.
     - Deduct `permittedAdNos.length` from `presentCount`.
     - Persist `permittedAdNos` and `permittedCount` to `night_extra_attendance`.
  3. In `handleSaveClassAttendance`:
     - Deduct permitted students from `presentCount` and persist `permittedCount` to `night_attendance`.
  4. Update `handleSendExtraToClassTeacher` to strictly filter for unexcused absentees (`status === 'ABSENT'`).

---

### Phase 4: Secondary Clearance Component Sync
* **Target File**: [`app/components/PeriodAttendanceMinusAndClearance.jsx`](file:///D:/Codes/mark-entry-app/app/components/PeriodAttendanceMinusAndClearance.jsx)
* **Actions**:
  1. In `handleSaveClearance` (lines 755–820):
     - When `clearReason === 'permitted'`, set `attMap[regNo] = 'L'`, increment `curStat.permittedCount` and `subObj.permitted`, and do not inflate physical presence (`presentCount`).
     - Set `clearanceType: 'PERMITTED_LEAVE'` and label `🎟️ Permitted Leave (Excused)` when saving to `clearance_history` (line 921).
  2. In `handleUpdateSessionStatus` (lines 1066–1150):
     - Add symmetric support for `L` (`PERMITTED_LEAVE`) in Step 1 (unapply) and Step 2 (apply).
     - Add `SET TO PERMITTED LEAVE (L)` button to inspection action bar.

---

### Phase 5: Build Verification & Regression Testing
1. Run `npm run build` to verify zero TypeScript, bundling, or JSX compilation errors.
2. Verify Firestore security rules evaluation for `clearance_history` with `clearanceType == 'PERMITTED_LEAVE'`.
3. Verify session re-edit delta calculations in local state across all combinations (`P ➔ L`, `L ➔ P`, `A ➔ L`, `L ➔ A`, `M ➔ L`, `O ➔ L`).
4. Validate zero-absentees clipboard export copying and WhatsApp button disabled state.
```
