# Real-Time Class & Period Attendance Monitor

* **Author:** safmuzammil
* **Date:** 2026-11-10

## Overview

The Real-Time Class & Period Attendance Monitor is a live supervisory dashboard for Administrators, Office Secretaries, and Class Teachers (strictly scoped to their assigned class) within `mark-entry-app`. It evaluates attendance completion across Darul Huda Degree Institution's 9-period bell schedule (P1 07:45 through P9 15:30).

Rather than displaying unrecorded periods as arbitrary absences or assuming default presence, the monitor mathematically reconciles split-teacher subject cohorts within each class. It presents class tiles that expand into period status cards displaying total students in class, taken vs untaken count, and present vs absent counts. For absent students, one-click clipboard copying formats their details (admission number, name, and absence/leave reason) for instant WhatsApp reporting.

## Analysis

### Bell Schedule Operations & State Machine
The system checks the active client time against the 9-period bell schedule:
* **P1**: 07:45 - 08:30 (Morning Core / Prime Slot)
* **P2**: 08:30 - 09:15 (Morning Core Slot)
* **P3**: 09:40 - 10:25 (Midday Academic Slot)
* **P4**: 10:25 - 11:10 (Pre-Tea Academic Slot)
* **P5**: 11:20 - 12:05 (Post-Break Academic Slot)
* **P6**: 12:05 - 12:50 (Pre-Zuhr & Lunch Core Slot)
* **P7**: 14:00 - 14:40 (Afternoon Session Start)
* **P8**: 14:40 - 15:20 (Afternoon Electives / Language Splits)
* **P9**: 15:30 - 16:15 (Final Academic Period)

Each class period resolves into one of five states:
1. `Scheduled`: Current time is before period start time.
2. `In Progress`: Current time is within the period window or its 15-minute submission grace period.
3. `Overdue / Untaken`: Period start time plus grace threshold has passed without all students being accounted for.
4. `Partial`: Some subject teachers in a split class have recorded attendance, but other cohorts remain unrecorded.
5. `Completed`: All enrolled students in the class have their attendance recorded for that period.

### Zero-Query Client Reconciliation (TRIZ Contradiction Resolution)
* **Contradiction**: Continuous real-time visibility across 360 class-period slots versus Firestore read quota exhaustion.
* **Resolution**: The monitor subscribes to a single reactive listener on `systemCache/daySessionsIndex_${attDate}` and joins with `localStudents` in memory. No additional Firestore documents or batch queries are executed during navigation or filtering.

### Split-Teacher Stream Cohort Accounting
Classes frequently split into parallel subjects (e.g. Urdu vs Arabic in QLA3 or elective tracks). When Teacher A records attendance for 16 students in Period 3, the remaining 18 students are designated as `Untaken`. They are explicitly omitted from absent or present counts, preventing false absenteeism metrics.

### Clipboard Output Specification
Clicking the copy button formats strictly unexcused absent students (omitting students with approved outpasses, medical leave, or official permissions):
```text
📋 *PERIOD ATTENDANCE - UNEXCUSED ABSENTEES*
🏫 *Darul Huda Degree Institution*
📚 *Class:* QLA3
⏰ *Period:* P3 (09:40 - 10:25) | 10 Nov 2026
📊 *Summary:* 34 Enrolled | 31 Accounted | 1 Unexcused Absent

⚠️ *STUDENTS REQUIRING CLASS TEACHER VERIFICATION:*
1. *#1105* - Salman Faris (Ad.No: 1105)

_Generated via MarkPortal Period Attendance Monitor_
```

## Goals vs. Non-Goals

* **In-Scope Goals:**
  * Real-time 9-period bell schedule state machine driving visual badge transitions.
  * Responsive class tiles with mini 9-segment progress pills expanding into detailed period cards.
  * Accurate partition of students into Taken (Present / Absent / Medical / Official / Outpass) and Untaken.
  * Role-based access control: Admin and Office Secretary view all classes; Class Teachers view strictly their assigned class.
  * One-click clipboard copying of only absent students' formatted details with verified leave reasons.
  * Direct integration into `PeriodAttendanceManager.jsx` sub-navigation.

* **Out-of-Scope Non-Goals:**
  * Automatic automated WhatsApp bot messaging (copying is manual one-click to clipboard).
  * Direct modification or overwriting of teacher submitted session data from the monitor view (attendance entry remains in subject cards).
  * Overhauling the core timetable assignment schema in Firestore.

## Key Technical Trade-Offs & Decisions

| Decision | Selected Option | Alternative Rejected | Rationale |
| :--- | :--- | :--- | :--- |
| **Data Aggregation** | Client-side memory join on `daySessionsIndex` & `localStudents` | Backend Cloud Function aggregator or separate collection writes | Eliminates Firestore write operations, zero additional billing cost, zero concurrency lag. |
| **Untaken Student Handling** | Classified as neutral `Untaken` status | Defaulting to absent or defaulting to present | Prevents penalizing students or generating false panic when teachers have not yet submitted roll call. |
| **Clipboard Target** | Copy strictly absent and excused students with reasons | Copying all students or copying delinquent teachers | Meets the user's explicit directive for rapid staff communication regarding missing students. |
| **Rehearsal Sessions** | Auto-link rehearsal blocks (FN1, FN2, AN1) to corresponding periods | Marking normal periods overdue during campus arts rehearsals | Reflects real campus schedule suspensions already implemented in `PeriodAttendanceManager.jsx`. |

## Open Questions / Follow-ups

1. **Free / Exempt Period Handling**: Should periods without an assigned subject for specific classes be auto-marked as "Free / Self Study", or should they remain marked "Scheduled / Optional"?
2. **Grace Period Threshold**: Is a 15-minute grace period after period start optimal before labeling a period "Untaken / Overdue"?
3. **Daily Summary Copy**: In addition to per-period absentee copying, should an aggregated day-wide absentee list be copyable from the class tile header?

## Sign-off & Next Steps

The architectural concept has been stress-tested across all 7 review lenses. It utilizes existing in-memory datasets with zero schema migrations or additional Firestore costs.
Recommended next step: Proceed to detailed drafting (`/egm-draft`) to specify component state, props, and exact UI layouts.
