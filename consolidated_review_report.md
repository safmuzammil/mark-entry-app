# Consolidated Review Report: Three-Tiered Unified Leave Architecture & Modal-Free Roll-Call Engine

* **Target Document:** [`docs/designs/three_tiered_leaves_and_modal_free_attendance.md`](file:///D:/Codes/mark-entry-app/docs/designs/three_tiered_leaves_and_modal_free_attendance.md)
* **Date:** 2026-11-10
* **Review Protocol:** EGM Uninterrupted Multi-Lens Review Swarm (Stages 5–9)

---

## 1. Executive Summary

The Goldfish review swarm evaluated [`docs/designs/three_tiered_leaves_and_modal_free_attendance.md`](file:///D:/Codes/mark-entry-app/docs/designs/three_tiered_leaves_and_modal_free_attendance.md) across all 5 review phases (Initial Zoom Out, Comprehension Paraphrase, Design Critique, Intermediate Zoom Out, and Implementation Readiness).

The reviewers verified that the design establishes a viable architectural structure for consolidating leave operations and eliminating roll-call modal friction. Ten specific findings were identified across institutional precedence, data token alignment, batch protection, and mobile ergonomics:
* **🔴 Blockers**: 3 items
* **🟡 Majors**: 5 items
* **🟢 Nits**: 2 items

---

## 2. Prioritized Actionable Tasks

### 🔴 Blockers

#### Task 1: Decouple Masjid Exemption from Academic Classroom Attendance (Precedence Rule 3)
* **Location in Document:** Lines 149–150 (Section 4.4)
* **Finding:** Section 4.4 Precedence 3 dictates: `Class status = 🟢 Present; Jamath status = 🩹 Masjid Exempt`. An orthopedic masjid exemption (excusing stair climbing to the masjid) must not force classroom presence if the student is absent from class, sick at home, or on gate leave.
* **Remediation:** Rewrite Precedence 3 so that `JAMATH_EXEMPTION` shields the student strictly in Minus Attendance (Jamath discipline) and has zero authority to override period roll-call. Classroom presence evaluates independently via Precedence 2 (Sick in Room) or Precedence 4 (Teacher Roll-Call).

#### Task 2: Bridge Night Bed-Rest Roll-Call to Class Teacher Waiver Workflow (Morning Handshake Queue)
* **Location in Document:** Lines 31–35, 122–131, 164–167 (Sections 3, 4.3.3, 5 Alt 3)
* **Finding:** Because night roll-call is strictly 1-tap and isolated from academic periods, night wardens marking `[🤒 Sick]` do not create formal waivers in `campus_medical_waivers`. If unaddressed, sick residents appear as unexcused absentees in Period 1 next morning unless their Class Teacher manually notices the night report.
* **Remediation:** Specify an asynchronous "Night Bed-Rest Handshake Queue" in `SickInRoomSubTab.jsx` and the Class Teacher Portal header. When a resident is marked `SICK_ROOM` overnight, their assigned Class Teacher sees a 1-click prompt: `[Grant Bed-Rest Waiver]` (pre-populating student info) or `[Cleared for Class]`.

#### Task 3: Standardize State Tokens Across Module Layers (`SICK_ROOM` vs `SICK_IN_ROOM`)
* **Location in Document:** Lines 92, 126, 241 (Sections 4.2, 4.3.3, 6.2 Step 5)
* **Finding:** Step 5 instructs setting `statusMap[ad] = 'SICK'`, whereas `NightAttendanceManager.jsx` relies on `'SICK_ROOM'`, `campus_medical_waivers` uses `waiverType === 'SICK_IN_ROOM'`, and `PeriodAttendanceManager.jsx` checks `status === 'SICK_ROOM'`. Setting `'SICK'` breaks existing card themes and monthly reports.
* **Remediation:** Standardize:
  * In `NightAttendanceManager.jsx` client status map: Use `'SICK_ROOM'`.
  * In `campus_medical_waivers` Firestore documents: Use `waiverType: 'SICK_IN_ROOM'`.
  * In `PeriodAttendanceManager.jsx`: Map `SICK_IN_ROOM` waivers to `'SICK_ROOM'` period entries.

---

### 🟡 Major Findings

#### Task 4: Extend Minus Attendance Jamath Shield to Comma-Separated Batch Entries
* **Location in Document:** Lines 137–142, 257–264 (Sections 4.3.5, 6.2 Step 7)
* **Finding:** Section 4.3.5 specifies intercepting `Jamath Missing` deductions on the single-student form. Monitors frequently enter comma-separated lists in `handleAddCommaSeparatedStudents`.
* **Remediation:** Update Step 7 to parse comma-separated lists against `jamathExemptionsByAdNo`, automatically exclude exempt students, and display an alert listing excluded students.

#### Task 5: Define Firestore Security Rules for `campus_medical_waivers`
* **Location in Document:** Lines 80–106, 195–199 (Sections 4.2, 6.2 Step 1)
* **Finding:** The root collection `campus_medical_waivers` lacks security rules specifications.
* **Remediation:** Add security rule specifications: Read access for authenticated faculty/admin; Write/Update access restricted to Admins and assigned Class Teachers (`isClassTeacherOf(resource.data.className)`).

#### Task 6: Responsive 2x2 Button Grid for Mobile Roll-Call Cards
* **Location in Document:** Lines 122–129, 238–242 (Sections 4.3.3, 6.2 Step 5)
* **Finding:** Placing 4 horizontal buttons in a single row within cards narrower than 320px yields ~55–60px button width, failing WCAG touch target guidelines and causing mistaps.
* **Remediation:** On card widths under 320px, render buttons as a 2x2 grid (`[Present] [Absent]` / `[Sick] [Official]`) with minimum height of 42px.

#### Task 7: Fix Gate Security State Variable Name (`isSecurityKiosk`)
* **Location in Document:** Line 229 (Section 6.2 Step 3)
* **Finding:** References non-existent `isGateSecurityMode`. The actual state variable in `app/outpass/page.jsx` is `isSecurityKiosk`.
* **Remediation:** Update line 229 to check `isSecurityKiosk === true`.

#### Task 8: Define Component Props for Sub-Tabs
* **Location in Document:** Lines 200–222 (Section 6.2 Step 2)
* **Finding:** Missing formal prop signatures for `SickInRoomSubTab.jsx` and `MasjidExemptionSubTab.jsx`.
* **Remediation:** Document standard prop interface: `students`, `teachers`, `loggedInUser`, `isAdmin`, `classTeacherOf`, and `onWaiverCreated`.

---

### 🟢 Nits

#### Task 9: Preserve Office Secretary Navigation Label
* **Location in Document:** Lines 111, 182, 232–235 (Sections 4.3.1, 6.1, 6.2 Step 4)
* **Finding:** Renaming unconditionally to `'Leaves & Outpass'` overrides the role-specific `'Office Out-Pass'` label.
* **Remediation:** Use conditional label: `loggedInTeacher?.outpassPrivileges?.isOfficeSecretary ? 'Office Leaves & Outpass' : 'Leaves & Outpass'`.

#### Task 10: Explicit Subscription Cleanup in Period Attendance
* **Location in Document:** Lines 132–136, 248–255 (Sections 4.3.4, 6.2 Step 6)
* **Finding:** Omitting unsubscribe cleanup on `onSnapshot` listeners causes memory leaks on class switches.
* **Remediation:** Document `useEffect` cleanup handler returning the unsubscribe function.

---

## 3. Traceability Matrix

| Finding ID | Severity | Lens Origin | Target Section in Design | Remediation Status |
| :--- | :--- | :--- | :--- | :--- |
| **Task 1** | 🔴 Blocker | `egm-zoom-out` | Section 4.4 | Ready to apply |
| **Task 2** | 🔴 Blocker | `egm-inventive-catalyst` | Sections 3, 4.3.3, 6.2 | Ready to apply |
| **Task 3** | 🔴 Blocker | `egm-codebase-details` | Sections 4.2, 4.3.3, 6.2 | Ready to apply |
| **Task 4** | 🟡 Major | `egm-codebase-details` | Sections 4.3.5, 6.2 | Ready to apply |
| **Task 5** | 🟡 Major | `egm-zoom-out` | Sections 4.2, 6.2 | Ready to apply |
| **Task 6** | 🟡 Major | `egm-design` | Section 4.3.3 | Ready to apply |
| **Task 7** | 🟡 Major | `egm-codebase-details` | Section 6.2 | Ready to apply |
| **Task 8** | 🟡 Major | `egm-implementation-readiness` | Section 6.2 | Ready to apply |
| **Task 9** | 🟢 Nit | `egm-style` | Sections 4.3.1, 6.2 | Ready to apply |
| **Task 10** | 🟢 Nit | `egm-implementation-readiness` | Section 6.2 | Ready to apply |
