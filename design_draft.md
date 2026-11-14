# Design Document: Admin Audit Trail, Exam Seating Arrangement & Academic Timetable Generator

* **Author:** safmuzammil
* **Date:** 2026-11-14
* **Status:** PROPOSED (DRAFT)
* **Target Components:** `app/page.jsx`, `app/components/TeacherPrivilegeModal.jsx` (`ErpExtensions.jsx`), `app/components/AuditTrailManager.jsx` (new), `app/components/ExamSeatingManager.jsx` (new), `app/components/TimetableManager.jsx` (new), `app/teacher/timetable/page.jsx` (new), `lib/audit.js` (new), `lib/seatingCsp.js` (new), `lib/timetableSolver.js` (new), `workers/timetable.worker.js` (new), `firestore.rules`, `firestore.indexes.json`

---

## 1. Problem Statement

Across the Darul Huda Degree Section ERP portal, daily administrative workflows have successfully consolidated student records, 9-period roll-calls, hostel night attendances, clearance certificates, and CCE mark audits. However, three critical operational bottlenecks and institutional governance gaps remain unresolved:

1. **Absence of an Administrative Audit Trail**:
   - High-consequence mutations (attendance overrides, medical/official clearance grants, mark updates, gate outpass approvals, and student profile edits) occur without persistent actor attribution or historical state tracking.
   - If marks or clearance statuses are contested or accidentally altered, college leadership cannot determine who made the modification, when it occurred, or what previous values existed.
   - *Constraint*: The institution operates strictly on the **free Firebase Spark tier** (20,000 writes/day, 50,000 reads/day, 1 GB storage, no Cloud Functions). Any logging mechanism must avoid write-quota exhaustion, document size ceilings (1 MB/doc), and expensive un-paginated queries that could burn the entire daily read budget in a single click.

2. **Manual and Error-Prone Exam Hall Seating**:
   - During institutional term and degree examinations, administrative staff manually assign 300–500 students into examination halls across multi-seat benches.
   - Maintaining the strict exam integrity invariant—**no two students from the same class may share a bench or sit in adjacent seats**—requires tedious manual cross-referencing. When rosters change or venue dimensions vary, manual seating plans collapse, resulting in exam hall copying and seat re-allocation chaos on examination day.
   - *Constraint*: The solution must compute layout assignments client-side without freezing mobile/desktop browsers and must export print-ready physical desk rosters.

3. **Complex Academic Timetable Scheduling & Distribution**:
   - Constructing a weekly lecture schedule for **10–15 classes**, across **9 daily periods** and a **6-day academic week**, involving **20–30 teaching faculty** (totaling ~810 timetable slots) is currently attempted manually.
   - Staff operate under asymmetric constraints: full-time vs. part-time availability, specific day-off policies (e.g., Friday off), and blocked time windows, alongside required weekly subject hour quotas per class.
   - Faculty members lack an instant, offline-accessible personal timetable on their mobile devices, forcing reliance on printed physical paper sheets or shared PDF rosters.
   - *Constraint*: Timetable scheduling is NP-hard. Classical backtracking on an 810-slot variable matrix hangs web browsers. Computation must be deterministic, non-blocking (Web Worker), complete in under 8 seconds, support manual slot locking with iterative re-solve, and deploy a lightweight offline PWA home-screen shortcut for each teacher.

4. **Staged Verification Requirement**:
   - College leadership requires that these advanced features NOT be exposed immediately to all admin or faculty accounts. They must be gated exclusively to a **Super Admin** or designated faculty member (e.g., Academic Coordinator) for manual verification and staging before full institutional rollout.

---

## 2. Institutional Architecture & Multi-Tenant Data Contracts

### 2.1 Scale & Environment Parameters

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       INSTITUTIONAL SCALE METRICS                           │
├───────────────────────────────┬─────────────────────────────────────────────┤
│ Academic Classes              │ 10 – 15 Classes (e.g., Deg 1 to Deg 3)      │
│ Daily Periods                 │ 9 Periods / Day                             │
│ Academic Week                 │ 6 Days / Week (Saturday – Thursday)         │
│ Total Timetable Slots         │ 15 × 9 × 6 = 810 Slot Variables             │
│ Teaching Faculty              │ 20 – 30 Usthad Members (FT & PT)            │
│ Exam Seating Capacity         │ 300 – 500 Students per Venue Session        │
│ Daily Write Budget (Spark)    │ 20,000 Writes / Day (Audit writes ~130/day) │
│ Daily Read Budget (Spark)     │ 50,000 Reads / Day (Enforces cursor limits) │
│ Computation Environment       │ Client-side V8 (React JSX / Web Worker)     │
└───────────────────────────────┴─────────────────────────────────────────────┘
```

---

## 3. Detailed Component & Algorithmic Specifications

### 3.1 Module 1: Admin Audit Trail (`AuditTrailManager.jsx` & `lib/audit.js`)

#### A. Data Schema (`audit_log` Collection)
Each audit entry is created using Firestore `addDoc` with an auto-generated document ID:

```javascript
// audit_log/{autoId}
{
  timestamp: FieldValue.serverTimestamp(), // Immutable Firestore server time
  actorUid: string,                       // request.auth.uid (tamper-proof)
  actorUsername: string,                  // Display name/email of editor
  actionType: string,                     // 'ATTENDANCE_SAVE' | 'CLEARANCE_ISSUE' | 'MARK_EDIT' |
                                          // 'OUTPASS_APPROVE' | 'STUDENT_RECORD_CHANGE' |
                                          // 'TIMETABLE_SAVE' | 'SEATING_SAVE'
  collection: string,                     // 'period_attendance' | 'clearance_history' | etc.
  documentId: string,                     // Key of modified entity
  beforeSnapshot: object | null,          // null for CREATE
  afterSnapshot: object | null,           // null for DELETE
  snapshotTruncated: boolean,             // true if serialized size exceeded 400KB
  clientMeta: {
    userAgent: string,                    // Browser signature
    ipPlaceholder: string                 // 'client-web'
  }
}
```

#### B. Safe Snapshot Truncation Engine (`lib/audit.js`)
To guarantee that documents never approach Firestore's 1 MB limit:
```javascript
const MAX_SNAPSHOT_BYTES = 400000; // 400 KB safety threshold
const EXCLUDED_RAW_KEYS = ['attendanceRecords', 'rawScanBuffer', 'historyLog'];

export function safeSnapshot(data) {
  if (!data || typeof data !== 'object') return data || null;
  const clone = { ...data };
  EXCLUDED_RAW_KEYS.forEach(k => delete clone[k]);
  
  try {
    const serialized = JSON.stringify(clone);
    if (serialized.length > MAX_SNAPSHOT_BYTES) {
      return {
        _truncated: true,
        _keys: Object.keys(clone),
        _approxSizeBytes: serialized.length,
        _preview: Object.fromEntries(Object.entries(clone).slice(0, 10))
      };
    }
    return clone;
  } catch (err) {
    return { _error: 'Serialization failed', message: err.message };
  }
}
```

#### C. Fire-and-Forget Dispatch Pattern
Audit logging must never block or abort main operational transactions:
```javascript
export async function auditWrite({ actionType, collectionName, documentId, before, after }) {
  try {
    const authUser = auth.currentUser;
    if (!authUser) return; // Skip unauthenticated actions
    
    const beforeClean = safeSnapshot(before);
    const afterClean = safeSnapshot(after);
    const isTruncated = Boolean(beforeClean?._truncated || afterClean?._truncated);

    await addDoc(collection(db, 'audit_log'), {
      timestamp: serverTimestamp(),
      actorUid: authUser.uid,
      actorUsername: authUser.displayName || authUser.email || 'Admin',
      actionType,
      collection: collectionName,
      documentId: String(documentId),
      beforeSnapshot: beforeClean,
      afterSnapshot: afterClean,
      snapshotTruncated: isTruncated
    });
  } catch (err) {
    console.warn('[AuditTrail] Non-fatal background audit write failed:', err);
  }
}
```

#### D. Firestore Security Rules
```javascript
match /audit_log/{entryId} {
  // Read allowed exclusively for Super Admin or whitelisted roles
  allow read: if request.auth != null && (
    request.auth.token.email in ['admin@dhiu.in', 'dhdegreeclearance@gmail.com'] ||
    request.auth.token.role == 'super_admin'
  );

  // Append-only write: cannot fake actorUid, cannot fake server timestamp
  allow create: if request.auth != null
    && request.resource.data.actorUid == request.auth.uid
    && request.resource.data.timestamp == request.time;

  // Strict immutability
  allow update, delete: if false;
}
```

#### E. Admin UI & Read Budget Safeguards
- **Cursor Pagination**: Hardcoded `limit: 50` with Firestore `startAfter(lastVisibleDoc)`.
- **Single-Filter Discipline**: To prevent requiring exponential composite indexes in `firestore.indexes.json`, the UI supports filtering by Date Range plus **strictly one secondary attribute at a time** (Actor, Action Type, or Collection).
- **Side-by-Side Diff Viewer**: Expands on tap to show color-coded field mutations (red for deleted/modified prior values, green for new additions).

---

### 3.2 Module 2: Constraint-Based Exam Seating Arrangement (`ExamSeatingManager.jsx` & `lib/seatingCsp.js`)

#### A. Problem Formulation: Graph Coloring with Physical Bench Topology
The seating problem is formulated as an undirected graph $G = (V, E)$:
- **Vertices ($V$)**: Every seat position $s_{r, b, k}$ where $r$ is row index, $b$ is bench index, and $k$ is seat number on the bench ($1 \le k \le \text{benchCapacity}$).
- **Colors ($C$)**: The student's enrolled `className` (e.g., `Deg 1A`, `Deg 2B`).
- **Edges / Conflicts ($E$)**:
  1. *Intra-bench adjacency*: All seats on the same bench $(r, b, k_1)$ and $(r, b, k_2)$ share an edge.
  2. *Inter-bench adjacency*: Seats on immediately neighboring benches in the same row $(r, b)$ and $(r, b \pm 1)$ share an edge.
  3. *Cross-row adjacency*: Optional strict toggle. Default is row-isolated to maximize venue utilization.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        PHYSICAL BENCH ADJACENCY                        │
├────────────────────────────────────────────────────────────────────────┤
│  ROW 1:  [ Seat 1A | Seat 1B ] <---> [ Seat 2A | Seat 2B ]  (Conflict) │
│              (Intra-bench conflict)                                    │
│                                                                        │
│  ROW 2:  [ Seat 1A | Seat 1B ] <---> [ Seat 2A | Seat 2B ]            │
└────────────────────────────────────────────────────────────────────────┘
```

#### B. Algorithm: Welsh-Powell Degree Ordering with Random-Restart Swap Repair
Because $|V| \le 500$ and $|C| \le 15$, pure backtracking is replaced with a high-speed greedy coloring algorithm that runs in $<50\text{ ms}$:

```javascript
// lib/seatingCsp.js
export function generateExamSeating({ layout, students, allowCrossRow = false }) {
  // 1. Build seat nodes with adjacency lists
  const seats = [];
  for (let r = 0; r < layout.rows; r++) {
    for (let b = 0; b < layout.benchesPerRow; b++) {
      for (let k = 0; k < layout.studentsPerBench; k++) {
        seats.push({
          id: `R${r + 1}-B${b + 1}-S${k + 1}`,
          row: r,
          bench: b,
          seatIndex: k,
          label: `Row ${r + 1} Bench ${b + 1} (${k + 1})`,
          neighbors: []
        });
      }
    }
  }

  // Populate graph edges
  seats.forEach(s1 => {
    seats.forEach(s2 => {
      if (s1.id === s2.id) return;
      const isSameBench = s1.row === s2.row && s1.bench === s2.bench;
      const isNeighborBench = s1.row === s2.row && Math.abs(s1.bench - s2.bench) === 1;
      const isCrossRow = allowCrossRow && Math.abs(s1.row - s2.row) === 1 && s1.bench === s2.bench;
      
      if (isSameBench || isNeighborBench || isCrossRow) {
        s1.neighbors.push(s2.id);
      }
    });
  });

  // 2. Sort seats by degree (descending constraint density)
  seats.sort((a, b) => b.neighbors.length - a.neighbors.length);

  // 3. Group students by class and shuffle
  const studentPool = [...students].sort(() => Math.random() - 0.5);
  const assignment = {}; // seatId -> student
  const unassigned = [];

  for (const student of studentPool) {
    // Find best seat whose assigned neighbors do NOT share this student's class
    const validSeat = seats.find(seat => {
      if (assignment[seat.id]) return false;
      return !seat.neighbors.some(nId => assignment[nId]?.className === student.className);
    });

    if (validSeat) {
      assignment[validSeat.id] = student;
    } else {
      unassigned.push(student);
    }
  }

  // 4. Swap-Repair Phase if unassigned students remain
  if (unassigned.length > 0) {
    let repairIterations = 0;
    while (unassigned.length > 0 && repairIterations < 500) {
      repairIterations++;
      const candidateStudent = unassigned[0];
      // Search for a swap target seat
      const swapSeat = seats.find(s => {
        const curOccupant = assignment[s.id];
        if (!curOccupant) return false;
        // Check if candidate can sit here
        const canCandidateSit = !s.neighbors.some(nId => assignment[nId]?.className === candidateStudent.className);
        return canCandidateSit;
      });

      if (swapSeat) {
        const displaced = assignment[swapSeat.id];
        assignment[swapSeat.id] = candidateStudent;
        unassigned.shift();
        unassigned.push(displaced); // Try re-seating displaced student
      } else {
        break;
      }
    }
  }

  return {
    assignment,
    unassigned,
    isComplete: unassigned.length === 0,
    totalSeats: seats.length,
    assignedCount: Object.keys(assignment).length
  };
}
```

#### C. Presentation & Physical Print Format
- **Mobile Display (390px)**: Compact list cards ordered by bench label (`R1-B1`, `R1-B2`).
- **Desktop/Hall View**: Interactive 2D SVG/Grid showing bench desk blocks with student cards.
- **Print Export**: Native `@media print` layout formatting A4 bench stickers (Cut-and-Paste Desk Cards) with student Name, Ad No, Class, and Seat Number.

---

### 3.3 Module 3: Academic Timetable Generator (`TimetableManager.jsx`)

#### A. Mathematical Model & Constraint Specifications
The timetable problem is defined as assigning a teacher $T$ and subject $S$ to every slot $(C, D, P)$ where:
- $C \in \{1 \dots 15\}$ (Classes)
- $D \in \{1 \dots 6\}$ (Days: Sat, Sun, Mon, Tue, Wed, Thu)
- $P \in \{1 \dots 9\}$ (Daily Periods)

**Hard Constraints (Cost weight: 1000 each)**:
1. **Teacher Uniqueness**: A teacher cannot be scheduled into two different classes in the same day and period.
   $$\forall T, D, P: \sum_{C} [T_{C, D, P} == T] \le 1$$
2. **Teacher Availability**: A teacher cannot be scheduled on their registered leave days or blocked time periods.
3. **Class Single-Slot Invariant**: Exactly one teacher and subject per class period.
4. **Locked Slot Invariance**: User-locked slots ($\text{locked} == \text{true}$) must never be modified by the solver.

**Soft Constraints (Cost weight: 10 to 50 each)**:
1. **Subject Weekly Quota**: Target periods per week for each subject in each class (e.g. 5 periods of Fiqh, 3 periods of Nahw).
2. **Teacher Daily Load Balancing**: No teacher should have more than 5 periods in a single day.
3. **Consecutive Lecture Cap**: No teacher should teach more than 2 consecutive periods in the same class without a break.

#### B. Simulated Annealing Solver (`workers/timetable.worker.js`)
To guarantee completion without browser lockup, the solver executes in a Web Worker using simulated annealing:

```javascript
// workers/timetable.worker.js
self.onmessage = function (e) {
  const { classes, teachers, subjects, periodConfig, lockedSlots, maxSeconds = 6 } = e.data;
  const startTime = Date.now();
  const maxTimeMs = maxSeconds * 1000;

  // 1. Initialize random valid assignments for unlocked slots
  let currentGrid = initializeSchedule(classes, teachers, subjects, lockedSlots);
  let currentCost = computeTotalCost(currentGrid, teachers, subjects, lockedSlots);
  let bestGrid = currentGrid;
  let bestCost = currentCost;

  let temperature = 100.0;
  const coolingRate = 0.995;
  let iterations = 0;

  while (Date.now() - startTime < maxTimeMs && bestCost > 0) {
    iterations++;
    // Propose a random swap between two unlocked slots in the same class
    const mutatedGrid = proposeMutation(currentGrid, lockedSlots);
    const newCost = computeTotalCost(mutatedGrid, teachers, subjects, lockedSlots);
    const delta = newCost - currentCost;

    if (delta < 0 || Math.exp(-delta / temperature) > Math.random()) {
      currentGrid = mutatedGrid;
      currentCost = newCost;

      if (currentCost < bestCost) {
        bestGrid = currentGrid;
        bestCost = currentCost;
      }
    }

    temperature *= coolingRate;

    // Post progress telemetry every 250 iterations
    if (iterations % 250 === 0) {
      self.postMessage({
        type: 'PROGRESS',
        iterations,
        bestCost,
        elapsedSec: ((Date.now() - startTime) / 1000).toFixed(1)
      });
    }
  }

  // Final resolution report
  self.postMessage({
    type: 'COMPLETED',
    grid: bestGrid,
    finalCost: bestCost,
    isPerfect: bestCost === 0,
    iterations,
    elapsedMs: Date.now() - startTime,
    conflicts: diagnoseConflicts(bestGrid, teachers, subjects)
  });
};
```

#### C. Manual Override & Cell Locking Workflow
- In the class timetable grid, clicking any period cell opens a slide-over/bottom sheet:
  - Displays current Usthad & Subject.
  - Dropdown to assign an alternative available teacher.
  - **Lock Toggle (🔒)**: Marks the slot as pinned.
  - When re-running the solver, pinned slots are treated as fixed context constants, allowing faculty coordinators to iteratively freeze periods and optimize the remainder.

#### D. Multi-Format Printable Outputs
1. **Master Institutional Grid**: Horizontal scrollable overview for notice boards.
2. **Class-Wise Weekly Cards**: Single-page A4 printouts tailored for class notice boards.
3. **Teacher Pocket Schedules**: Clean pocket-size card for each Usthad listing their 9 daily periods across the 6-day week.

---

### 3.4 Teacher Phone Widget (PWA Offline Home-Screen Shortcut)

#### A. Architecture & Route Design
- Dedicated lightweight route: `app/teacher/timetable/page.jsx`.
- Authenticated via existing teacher session or credential token.
- Reads cached timetable from Firestore document `systemCache/current_timetable`.
- Leverages Next.js PWA manifest & Service Worker caching (`CacheFirst` strategy with background stale-while-revalidate).

#### B. Offline Experience & Home-Screen Installation
- When the teacher opens `/teacher/timetable`, an install banner appears:
  - *"📲 Add My Timetable to Home Screen"*.
- Clicking creates a direct home-screen shortcut icon.
- Opens in standalone display mode (`display: "standalone"`), functioning identically to a native mobile widget.
- Full offline support: loads in $<100\text{ ms}$ even without Wi-Fi or mobile data inside campus lecture halls.

---

### 3.5 Staged Access Control & Feature Gating

#### A. Role Hierarchy & Super Admin Gate
To ensure college leadership can test and verify these engines safely:
1. **Super Admin Guard in `app/page.jsx`**:
   ```javascript
   const SUPER_ADMIN_EMAILS = [
     'admin@dhiu.in',
     'dhdegreeclearance@gmail.com'
   ];
   
   export function isSuperAdminUser(user) {
     if (!user || !user.email) return false;
     return SUPER_ADMIN_EMAILS.includes(user.email.toLowerCase());
   }
   ```
2. **Teacher Privilege Gating in `TeacherPrivilegeModal` (`ErpExtensions.jsx`)**:
   Add granular capability toggles to `outpassPrivileges`:
   ```javascript
   {
     canManageTimetable: boolean,    // Academic Coordinator / Principal
     canManageExamSeating: boolean,  // Examination Cell Head
     canViewAuditLog: boolean        // Strictly Super Admin by default
   }
   ```
3. **Sidebar Gating Logic**:
   Tabs `Audit Log`, `Exam Seating`, and `Timetable` will remain completely hidden and inaccessible to regular admins and teachers unless `isSuperAdminUser()` returns true OR the teacher document possesses the explicit capability flag.

---

## 4. Free Firebase Spark Tier Quota & Performance Invariants

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       SPARK QUOTA BUDGET INVARIANTS                         │
├───────────────────────┬─────────────────────────────────────────────────────┤
│ Metric                │ Invariant Rule & Architecture Guard                 │
├───────────────────────┼─────────────────────────────────────────────────────┤
│ Daily Writes          │ Maximum 20,000 writes/day. Normal ERP operations    │
│                       │ take ~2,000 writes. Audit logging adds ~130 writes/ │
│                       │ day. Net utilization: <12%. SAFE.                   │
├───────────────────────┼─────────────────────────────────────────────────────┤
│ Daily Reads           │ Maximum 50,000 reads/day. Audit log queries MUST    │
│                       │ enforce `limit(50)` and cursor pagination. Timetable│
│                       │ reads use cached singleton document. SAFE.          │
├───────────────────────┼─────────────────────────────────────────────────────┤
│ Document Size Limit   │ Maximum 1 MB/doc. `safeSnapshot()` enforces 400 KB  │
│                       │ cap and strips bulk array keys. SAFE.               │
├───────────────────────┼─────────────────────────────────────────────────────┤
│ Cloud Functions       │ 0 Cloud Functions required. All solvers (coloring,  │
│                       │ annealing) execute client-side in Web Workers. SAFE.│
└───────────────────────┴─────────────────────────────────────────────────────┘
```

---

## 5. Step-by-Step Implementation Plan

### Phase 1: Access Control & Audit Trail Foundation
1. **`app/page.jsx`**: Introduce `isSuperAdminUser` helper and register gated sidebar items for `audit_log`, `exam_seating`, and `timetable`.
2. **`app/components/ErpExtensions.jsx`**: Update `TeacherPrivilegeModal` with `canManageTimetable`, `canManageExamSeating`, and `canViewAuditLog` toggles.
3. **`lib/audit.js`**: Implement `safeSnapshot()` and `auditWrite()` fire-and-forget engine.
4. **`firestore.rules`**: Add security rules for `audit_log` (read: super admin; create: auth actor match; update/delete: false).
5. **`firestore.indexes.json`**: Define required composite indexes for date-range audit queries.
6. **`app/components/AuditTrailManager.jsx`**: Build admin UI with cursor pagination, date pickers, filter dropdowns, and diff view.
7. **Instrument Write Points**: Wire `auditWrite()` into `PeriodAttendanceManager.jsx`, `NightAttendanceManager.jsx`, and `PeriodAttendanceMinusAndClearance.jsx`.

### Phase 2: Exam Seating Arrangement Engine
1. **`lib/seatingCsp.js`**: Implement Welsh-Powell graph coloring and bench swap-repair logic.
2. **`app/components/ExamSeatingManager.jsx`**: Build venue dimension input, class roster selector, interactive bench grid preview, and unassigned student alert.
3. **Export Engine**: Add `@media print` bench card layouts and downloadable HTML blobs.
4. **Persistence**: Save finalized seating plans into `seating_plans` collection.

### Phase 3: Academic Timetable Generator & Teacher PWA Widget
1. **`workers/timetable.worker.js`**: Implement simulated annealing solver with telemetry messaging.
2. **`lib/timetableSolver.js`**: Build constraint evaluator, hard/soft cost functions, and conflict diagnostician.
3. **`app/components/TimetableManager.jsx`**:
   - Master Class Grid with 9 periods × 6 days.
   - Slot editing bottom sheet with lock toggle (🔒).
   - Usthad availability matrix editor (FT/PT, day off, blocked periods).
   - Printable exports (Master grid, Class weekly card, Usthad pocket schedule).
4. **`app/teacher/timetable/page.jsx`**: Implement standalone mobile-optimized view for teachers with offline IndexedDB caching.
5. **Persistence**: Save master schedule to `systemCache/current_timetable` with version bump.

---

## 6. Verification & Test Plan

1. **Audit Security Verification**:
   - Verify unauthenticated users and non-super-admins receive permission denied on reading `audit_log`.
   - Verify update or delete operations on `audit_log` fail directly at Firestore rules engine.
   - Verify snapshot truncation triggers correctly when handling large test payloads (>400 KB).
2. **Seating Constraint Verification**:
   - Input 400 students across 8 classes in a 20-row, 10-bench hall (2 students/bench).
   - Assert zero instances of adjacent students sharing identical `className`.
   - Verify partial solution and warning display when attempting to seat 50 students of the same class in a small venue.
3. **Timetable Solver Stress Test**:
   - Run solver against 15 classes, 25 teachers, 9 periods, 6 days.
   - Confirm worker terminates within 8 seconds with zero hard conflicts.
   - Verify that locking 20 slots preserves them exactly through subsequent solver runs.
4. **PWA Offline Test**:
   - Open `/teacher/timetable` on Chrome Android, trigger "Add to Home Screen", switch phone to Airplane Mode, and verify instant offline rendering.
