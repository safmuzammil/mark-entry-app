# Comprehension Audit Report: Permitted Leave Attendance & Targeted Absentees Export

**Target Document**: `docs/designs/permitted_leave_and_absentees_export.md`  
**Auditor**: Comprehension Goldfish (Zero-Knowledge Naive Reader Audit)  
**Status**: Completed  

---

## 1. Feature Specification Paraphrase

### What this proposes
The document proposes expanding student attendance tracking across classroom lectures (Period Attendance), hostel/assembly sessions (Night and Extra Attendance), and post-hoc attendance reconciliation (Clearance) from binary or restrictive states into a standardized five-state model (`Present`, `Absent`, `Permitted Leave`, `Medical Leave`, `Official Duty`). A dedicated `'L'` (`PERMITTED_LEAVE`) status is added so students with sanctioned academic or personal permissions are marked excused without unfairly triggering absence penalties or falsifying physical presence. In addition, the document introduces a targeted WhatsApp and clipboard communication generator that filters out present and excused students to share a cleanly formatted alert strictly containing unexcused absentees (`'A'`) with class teachers.

### How the existing system works, per this document
Currently, faculty and wardens take attendance across separate portals where period attendance tracks only an array of absent student registration numbers (`absentRegNos`), assuming any student not marked absent or medical is physically present. When an attendance recorder re-opens a previously saved session, existing non-absent designations are lost or defaulted back to `PRESENT`. Firestore security rules explicitly restrict post-hoc attendance clearance types to only `MEDICAL_LEAVE` and `OFFICIAL_PRESENT`, rejecting any permitted leave writes. Furthermore, existing export routines for faculty communication either dump full class rosters or bundle excused students together with unexcused absentees, burdening class teachers who need to follow up urgently on missing students.

---

## 2. Implementation Plan Paraphrase

The implementation plan is structured into five sequential phases:
1. **Phase 1 (Security Rules)**: Updates Firestore security rules within `isValidClearanceHist` to whitelist `'PERMITTED_LEAVE'` under allowed clearance types, delegating rule authoring to the `firestore-rules-author` subagent.
2. **Phase 2 (Period Attendance)**: Refactors `PeriodAttendanceManager.jsx` by swapping the `absentRegNos` array for a full status mapping (`sessionStatusMap`), preserving existing statuses upon reloading, calculating net counter and date array deltas when transitioning saved statuses, adding a cyclic badge selector (`Absent` ➔ `Leave` ➔ `Medical` ➔ `Present`) on non-present cards, and outputting an unexcused-only WhatsApp/clipboard absentee roster.
3. **Phase 3 (Night & Extra Attendance)**: Adds a dedicated `Leave` button to the card cluster in `NightAttendanceManager.jsx`, persisting permitted student admission numbers (`permittedAdNos`) and counts to night/extra session documents, and filtering WhatsApp exports strictly to absentees.
4. **Phase 4 (Secondary Clearance Sync)**: Modifies `PeriodAttendanceMinusAndClearance.jsx` to support granting `PERMITTED_LEAVE`, incrementing permitted counters and clearing absent dates without inflating physical presence metrics.
5. **Phase 5 (Verification & Testing)**: Runs build checks (`npm run build`), validates Firestore security rule behavior, verifies string encoding in absentee messages, and tests state transition delta accounting.

---

## 3. Comprehension Findings (Blockers, Major, Nits)

### Finding 1: Undefined and Incomplete Delta State Transitions
* **Severity**: Blocker
* **Affected Scope**: Section 2 (lines 42–46), Section 4.2 § 2 (lines 160–165), Section 6 Phase 2 (lines 225–238).
* **Discrepancy Description & Rationale**:
  The document establishes a 5-state taxonomy (`P`, `A`, `L`, `M`, `O`), but Section 4.2 and Phase 2 only define delta recalculation rules between subsets of three states: `A ↔ L` and `P ↔ L`.
  - Transitions involving `M` (Medical Leave) and `O` (Official Duty) are completely missing (e.g., what counters increment/decrement when a student moves from `A` to `M`, `M` to `L`, `O` to `L`, or `L` to `O`?).
  - If a user re-saves an existing session where a student was initially marked `M` or `O`, a naive developer or system has no specification for whether `absentDates`, `presentCount`, or subject-level tallies change.
  - To be self-contained and implementable without guesswork, the document must provide an explicit transition matrix or exhaustive state machine covering all 5 valid states.

### Finding 2: Unexplained Schema Constructs (`subObj`, `curStat`, `systemCache`)
* **Severity**: Major
* **Affected Scope**: Section 4.1 (lines 91, 111), Section 6 Phase 2 (lines 227–240).
* **Discrepancy Description & Rationale**:
  - The plan introduces variables `subObj` (e.g., `subObj.absentDates`, `subObj.permitted`, `subObj.present`) and `curStat` (e.g., `curStat.permittedCount`, `curStat.presentCount`) without explaining what data structures they refer to, where they are fetched from, or their exact schema within the `students` Firestore document. A reader does not know whether `subObj` represents an entry within a nested `subjects` map or an external object.
  - The Firestore collection `systemCache` is introduced as storing `periodSession_* : attendanceMap`, but the document never defines what `systemCache` is (a Firestore collection or a local cache), why active business transaction records live in a "cache", or the exact keying convention of `periodSession_*` (e.g., `periodSession_${classId}_${date}_${period}`).

### Finding 3: Ambiguous and Divergent Student Identifiers (`adNo` vs `regNo` vs `RollNo`)
* **Severity**: Major
* **Affected Scope**: Section 2 § 4 (line 62), Section 4.1 (lines 92–93), Section 4.2 § 2 & 3 (lines 149, 172), Section 6 Phase 2 & 3 (lines 216, 256, 268).
* **Discrepancy Description & Rationale**:
  The document inconsistently refers to student identity keys across different modules without clarifying their distinct roles:
  - `PeriodAttendanceManager.jsx` maps `sessionStatusMap` by `regNo` (lines 43, 149).
  - `NightAttendanceManager.jsx` tracks `permittedAdNos` and `absentAdNos` by `adNo` (lines 93, 172, 268).
  - The export template combines both alongside a third identifier: `#[AdNo] • Roll: [RollNo]` (line 62, 256).
  - A fresh reader cannot tell whether `regNo` (Register Number) and `adNo` (Admission Number) are identical, distinct primary keys, or aliases, nor how a session in Period Attendance maps to Night Attendance records if they key on different identifiers. A brief glossary entry or inline definition explaining campus student identifiers is required.

### Finding 4: Undefined Institutional Jargon: "Jamath", "Gate Outpass", and "Clearance"
* **Severity**: Major
* **Affected Scope**: Section 1 (lines 13, 19), Section 4.1 (line 94), Section 4.2 § 2 (line 150), Section 6 Phase 4 (lines 273–278).
* **Discrepancy Description & Rationale**:
  - **`Jamath`**: Used in Section 1 ("congregational Jamath attendance") and Section 2 ("Night Jamath") without explanation. A naive reader does not know whether Jamath is an attendance category, a session type, a physical location, or an extracurricular group.
  - **`Gate Outpass`**: Mentioned in Section 1 (line 19) and Section 4.2 § 2 ("computes initial status from Gate Outpasses"). The document does not define what a Gate Outpass is, where outpass data lives, what schema it adheres to, or how the component reads it.
  - **`Clearance`**: `PeriodAttendanceMinusAndClearance.jsx` and `clearance_history` are presented as key components, but the document never defines what "clearance" means in this system (e.g., retroactive administrative excuse granted after absence).

### Finding 5: Contradictory Export Action Behavior on Zero Absentees
* **Severity**: Nit
* **Affected Scope**: Section 2 § 4 (line 64), Section 4.2 § 4 (lines 181–182), Section 6 Phase 2 (lines 257–260).
* **Discrepancy Description & Rationale**:
  There is a functional ambiguity regarding the UI state when unexcused absentees count is zero:
  - Lines 64 and 260 specify: *"disable the WhatsApp button when unexcusedStudents.length === 0"*.
  - Lines 181 and 257 specify fallback message text: `*Unexcused Absent Students (0):* None (All students present or excused)`.
  - If the button is disabled when the count is zero, the user can never trigger or copy the message containing the fallback text. The document should clarify whether the button is disabled or if it allows copying a "clean roster / zero absentees" confirmation report.

### Finding 6: Undefined Acronym `CCE`
* **Severity**: Nit
* **Affected Scope**: Section 3 (line 78).
* **Discrepancy Description & Rationale**:
  Section 3 mentions *"Altering Continuous and Comprehensive Evaluation (CCE) examination mark formulas"*. While the acronym is expanded, the document provides no explanation of how CCE relates to period attendance or leave counts, leaving the reader unclear on why this was singled out as a non-goal. A one-phrase clarification (e.g., "how attendance ratios factor into internal academic CCE marks") would resolve this.

---
Auditing completed by Comprehension Goldfish. Ready for parent orchestrator review.
