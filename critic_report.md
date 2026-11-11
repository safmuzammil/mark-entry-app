# Critic Review Report: Permitted Leave Attendance & Targeted Absentees Export

* **Target File:** `docs/designs/permitted_leave_and_absentees_export.md`
* **Evaluated Scope:** Lines 1–200 (`FeatureRange`)
* **Review Date:** 2026-11-11
* **Reviewer Personas:**
  - `egm-design`: Hostile Architecture Critic
  - `egm-structural`: Structural Layout Validator
  - `egm-style`: Technical Copy Editor
* **Overall Verdict:** **APPROVED WITH RECOMMENDATIONS**

---

## 1. Reviewer Status Matrix

| Reviewer Persona | Lens / Focus Area | Evaluation Status |
| :--- | :--- | :--- |
| `egm-design` | System Architecture, Scalability, State Machine, Data Contracts | **Completed** |
| `egm-structural` | Layout Symmetry, Heading Hierarchy, Template Compliance, Cross-References | **Completed** |
| `egm-style` | Precision, Brevity, Ambiguity Elimination, Terminology Consistency | **Completed** |

---

## 2. Multi-Perspective Findings

### 2.1 System Architecture & Scalability (`egm-design`)

1. **State Machine Asymmetry (`'O'` Missing from Roll-Call Cycle):**
   - Lines 35–40 establish a 5-state taxonomy: `'P'`, `'A'`, `'L'`, `'M'`, `'O'`.
   - Lines 49 and 168 define the badge chip cycle as: `[🔴 ABSENT]` ➔ `[🟣 PERMITTED LEAVE]` ➔ `[🟡 MEDICAL]` ➔ `[🟢 PRESENT]`.
   - **Architectural Gap:** Official Duty (`'O'`) is omitted from the cycle. If `'O'` can only be set externally via clearance certificates or rehearsal sync, the document must state that `'O'` is read-only in this UI. If teachers are allowed to mark `'O'`, it must be included in the cycle. Furthermore, if a student enters the session with `'O'`, clicking their card or chip must have a deterministic transition defined.

2. **Delta Recalculation Combinatorial Omissions:**
   - Lines 161–165 enumerate only 4 delta transitions: `A ➔ L`, `P ➔ L`, `L ➔ P`, and `L ➔ A`.
   - Because the badge chip cycles directly from `L` to `M`, a teacher can easily change a student from `Permitted Leave` to `Medical Leave`. Without an explicit rule for `L ➔ M` (and `M ➔ L`), `permittedCount` will fail to decrement and `medicalCount` will become desynchronized.
   - **Recommendation:** Replace the 4 hardcoded transitions with a generalized state transition engine:
     ```javascript
     function applyAttendanceDelta(oldStatus, newStatus, curStat, subObj, date) {
       if (oldStatus === newStatus) return;
       // 1. Decrement old status counters
       decrementStatusCounter(oldStatus, curStat, subObj, date);
       // 2. Increment new status counters
       incrementStatusCounter(newStatus, curStat, subObj, date);
     }
     ```

3. **Percentage Denominator & Shortage Semantics:**
   - Line 45 states that changing to `'L'` updates counts "without inflating physical presence ratios".
   - In `PeriodAttendanceManager.jsx`, total session counts are tracked via `totalPeriods` or `totalConducted`. The document must clarify whether `totalPeriods` increments when `'L'` is recorded. If `totalPeriods` increments while `presentCount` does not, the physical presence ratio drops. The document should state explicitly whether `'L'` is excluded from absence shortage thresholds (condoned) or excluded from the denominator.

4. **URL Encoding & Mobile Query String Limits:**
   - Lines 55–64 and 176–182 specify WhatsApp URL generation with contextual headers and numbered absentee lists.
   - For large classes with multiple absentees and long subject titles, unencoded URLs can exceed standard URL length limits (~2,000 characters) on mobile browsers. Truncation handling or fallback to clipboard-only copying should be mentioned for large absentee rosters.

---

### 2.2 Structural Integrity & Layout (`egm-structural`)

1. **Metadata Status Lifecycle Discrepancy:**
   - Line 5 lists `* **Status:** APPROVED`.
   - A document currently undergoing Stage 7 Critic Review should not be marked `APPROVED` before review completion. It should be `PROPOSED` or `IN REVIEW`.

2. **Component Symmetry Gap in Section 4.2:**
   - Section 3 (Line 71) identifies `PeriodAttendanceMinusAndClearance.jsx` as an in-scope goal.
   - Section 6 (Line 273) dedicates Phase 4 to updating `PeriodAttendanceMinusAndClearance.jsx`.
   - **Structural Gap:** Section 4.2 ("Module Specifications", lines 130–184) defines modules 1, 2, 3, and 4, but completely skips `PeriodAttendanceMinusAndClearance.jsx`. A dedicated subsection `#### 5. Secondary Clearance Component Sync (PeriodAttendanceMinusAndClearance.jsx)` must be added to Section 4.2 for structural completeness.

3. **Export Button Disabling vs. Empty Fallback Message Contradiction:**
   - Line 64 specifies that the generator "disables action buttons when there are zero unexcused absentees."
   - Line 181 specifies fallback text: `None (All students present or excused)`.
   - If the WhatsApp button is disabled when count is 0, the fallback text cannot be sent via WhatsApp. The document should clarify that the fallback text applies to clipboard copying or class teacher inspection, whereas the WhatsApp launcher button is disabled.

---

### 2.3 Style, Precision & Tone (`egm-style`)

1. **Badge Nomenclature Inconsistency:**
   - Line 49: `[🟣 PERMITTED LEAVE]`
   - Line 168: `[🟣 LEAVE]`
   - Line 244: `[🟣 LEAVE]`
   - **Recommendation:** Standardize label text across all sections to `[🟣 LEAVE]` (optimal for narrow 360px mobile viewports).

2. **File Reference Redundancy in Problem Statement:**
   - Lines 13–14 cite `NightAttendanceManager.jsx` twice:
     `2. Night Attendance (NightAttendanceManager.jsx)`
     `3. Extra Attendance (NightAttendanceManager.jsx)`
   - Clarify that Extra Attendance is an operational sub-mode managed within `NightAttendanceManager.jsx` to prevent the perception of a duplicate file error.

3. **Code Snippet Completeness:**
   - Lines 134–145 contain ellipsis (`...`) within the Firestore rule code block. While acceptable in design narratives, providing the exact AST condition prevents implementation ambiguity:
     ```javascript
     data.clearanceType in ['MEDICAL_LEAVE', 'OFFICIAL_PRESENT', 'PERMITTED_LEAVE']
     ```

---

## 3. Prioritized Unified Findings

### 🔴 Blockers
*None.* (The fundamental architecture is sound, safe, and backwards-compatible.)

---

### 🟡 Major Findings

#### 1. State Machine Asymmetry with Official Duty (`'O'`)
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 35–40, 48–50, 149, 166–169
* **Discrepancy Description:** The data contract defines 5 states (`'P' | 'A' | 'L' | 'M' | 'O'`), but the cycling UI chip only provides 4 states (`A ➔ L ➔ M ➔ P`). There is no documented mechanism to select `'O'`, nor is there a defined behavior when a student pre-populated with `'O'` is tapped.
* **Actionable Remediation:**
  - Add explicit narrative in Section 4.2 (Module 2) clarifying whether `'O'` is read-only (originating strictly from clearance certificates / rehearsals) or selectable.
  - If read-only, document that tapping an `'O'` badge shows a locked indicator or prompts clearance override.
  - If selectable, update the badge sequence to: `[🔴 ABSENT] ➔ [🟣 LEAVE] ➔ [🟡 MEDICAL] ➔ [🔵 OFFICIAL] ➔ [🟢 PRESENT]`.

#### 2. Incomplete Delta Transition Matrix
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 160–165
* **Discrepancy Description:** Enforcing only 4 pairwise delta transitions (`A ➔ L`, `P ➔ L`, `L ➔ P`, `L ➔ A`) causes counter desynchronization whenever a student is cycled between `L` and `M` (which are consecutive chips in the selector).
* **Actionable Remediation:**
  - Specify a symmetric, two-step delta calculation: decrement old state counters (`oldStatus`), then increment new state counters (`newStatus`), handling `absentDates`, `permittedCount`, `medicalCount`, `officialCount`, and `presentCount` uniformly.

#### 3. Section 4.2 Structural Omission (`PeriodAttendanceMinusAndClearance.jsx`)
* **Reviewer Lens:** `egm-structural`
* **Affected Scope:** Lines 71, 130–185, 273–279
* **Discrepancy Description:** Section 3 states that `PeriodAttendanceMinusAndClearance.jsx` is an in-scope goal, and Section 6 includes it in Phase 4, but Section 4.2 has no specification subsection for it.
* **Actionable Remediation:**
  - Insert `#### 5. Secondary Clearance Component Sync (PeriodAttendanceMinusAndClearance.jsx)` under Section 4.2 detailing how clearance approvals write `PERMITTED_LEAVE` and update `permittedCount`.

---

### 🟢 Minor / Nits

#### 4. Premature Lifecycle Status in Metadata Header
* **Reviewer Lens:** `egm-structural`
* **Affected Scope:** Line 5
* **Discrepancy Description:** Document status is listed as `APPROVED` before completion of Critic Review.
* **Actionable Remediation:** Change `* **Status:** APPROVED` to `* **Status:** PROPOSED` or `IN REVIEW`.

#### 5. Export Button Disabling vs Fallback Text Logic
* **Reviewer Lens:** `egm-structural` / `egm-style`
* **Affected Scope:** Lines 64, 181–182, 257–260
* **Discrepancy Description:** Disabling the WhatsApp action button when `unexcusedCount === 0` makes the fallback message `"None (All students present or excused)"` unreachable via WhatsApp.
* **Actionable Remediation:** Clarify in Section 4.2 that clipboard copy remains active with the `"None"` placeholder, while WhatsApp direct launch is disabled to prevent sending empty absentee spam.

#### 6. Inconsistent Badge Nomenclature
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Line 49 vs. Line 168
* **Discrepancy Description:** Inconsistent naming between `[🟣 PERMITTED LEAVE]` and `[🟣 LEAVE]`.
* **Actionable Remediation:** Standardize on `[🟣 LEAVE]` across all sections for mobile UI clarity.

---

## 4. Overall Critic Verdict

### **VERDICT: APPROVED WITH RECOMMENDATIONS**

The design is approved to advance to implementation once the recommendations for the delta transition engine, `'O'` state semantics, and Section 4.2 structural symmetry are incorporated into the document.
