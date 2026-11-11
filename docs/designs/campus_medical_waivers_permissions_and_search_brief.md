# Concept Brief: Firestore Permissions & Real-Time Student Search for Campus Medical Waivers

## 1. Problem Statement & Root Cause

### A. Firestore Write Rejection ("Missing or insufficient permissions")
When users attempt to grant a **Sick in Room (Bed Rest)** waiver or a **Masjid Jamath Exemption**, the browser alerts:
`Error saving waiver / exemption: Missing or insufficient permissions.`

- **Cause**: In `firestore.rules`, the catch-all rule at the bottom is:
  ```javascript
  match /{document=**} {
    allow read, write: if false;
  }
  ```
  The newly introduced collection `campus_medical_waivers` was not defined with an explicit rule block in `firestore.rules`. Any write (`setDoc`) attempted from `mark-entry-app.vercel.app` is blocked at the security perimeter.

### B. Student Selection Usability Friction
In both `SickInRoomSubTab.jsx` and `MasjidExemptionSubTab.jsx`, student selection relies on a native `<select>` dropdown rendering all students in the teacher's scope.
- **Flaw**: On mobile screens, scrolling through 30–80 students to find a specific individual creates friction.
- **Need**: Direct predictive search by Student Name or Admission Number (e.g., "Salman" or "3456") with instant selection cards.

---

## 2. Proposed System Changes

### A. Security Rules (`firestore.rules`)
Add explicit schema validation and access control for `campus_medical_waivers/{waiverId}`:
1. **Read**: Allowed for authenticated users (`isAuthenticated()`) so teachers, administrators, and student portal monitors can view active waivers.
2. **Create / Update**: Allowed for teachers and administrators (`isStaffOrAdmin()`) validating:
   - Required identity fields: `id`, `studentRegNo`, `adNo`, `studentName`, `className`, `waiverType`.
   - `waiverType` restricted strictly to `'SICK_IN_ROOM'` or `'JAMATH_EXEMPTION'`.
   - `status` restricted strictly to `'ACTIVE'` or `'REVOKED'`.
   - Authorized by teacher credentials (`issuedBy`, `issuedByName`, `issuedByRole`, `issuedAt`).
   - Revocation metadata (`revokedAt`, `revokedBy`, `revokedByName`) allowed on state change.
3. **Delete**: Restricted strictly to administrators (`isAdmin()`).

### B. Reactive Student Autocomplete Component
In both `SickInRoomSubTab.jsx` and `MasjidExemptionSubTab.jsx`:
1. **Search Input**: Text field accepting student name or admission number.
2. **Instant Matching**: Live filter matching against `eligibleStudents` across:
   - `firstName` / `name`
   - `adNo`
   - `regNo`
   - `classes`
3. **Tactile Candidate Cards**: Display top matches showing Avatar, Name, Admission Number, and Class tag.
4. **Pinned Selection State**: When selected, the input collapses into a verified card with a `✕ Change` button to re-select.

---

## 3. Stress-Testing & Critical Edge Cases

1. **Permission Scope for Class Teachers**:
   - Should a Class Teacher be restricted to granting leaves *only* for their assigned classes, or can any teacher excuse a student (e.g., when a class teacher is absent)?
   - *Current frontend*: Enforces `canManageStudent` (Class Teacher or Admin).
   - *Firestore rule*: Validates staff identity.
2. **Multiple Active Waivers**:
   - If a student already has an active `SICK_IN_ROOM` waiver, should granting a second one be blocked or merged?
3. **Search Performance**:
   - Client-side filtering across the preloaded `students` prop avoids additional database read operations and provides zero-latency keystroke filtering.
