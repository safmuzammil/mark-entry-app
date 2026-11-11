# Streamlined Leave Granting & Unified Admin Leaves Hub

* **Author:** safmuzammil
* **Date:** 2026-11-11

## Overview

This specification establishes streamlined leave creation workflows and elevates the Admin portal navigation to match the teacher portal:

1. **Streamlined Leave Modal (`SickInRoomSubTab` & `MasjidExemptionSubTab`)**:
   * Drops secondary fields (`roomNumber` and `additionalNotes`) completely from both UI and data payload, as campus wardens do not conduct in-room checks.
   * Promotes **`✍️ Custom Reason...`** to the very top (first option) of the reason picker, paired with 1-tap template chips directly underneath.
   * Introduces **End Date Selection** (`validUntil`):
     - **Default Expiration**: Automatically expires at the end of the current date (single-day bed rest).
     - **Multi-Day Excusals**: Quick duration chips (`Today Only`, `+1 Day (Tomorrow)`, `+2 Days (Day After)`, `Custom Date`) allow scheduled multi-day recovery.
     - Lapsed waivers automatically cease excusing attendance without requiring manual intervention.

2. **Unified Admin Leaves Desk (`app/page.jsx` & `app/outpass/page.jsx`)**:
   * Renames Admin navigation entry from `Out-Pass Portal` to **`Leaves & Outpass`** (`🪪`).
   * Renders a persistent 4-tab desk for Admin:
     1. **`🪪 Gate Outpass`**: Off-campus approvals, gate scans, and live outside student counters.
     2. **`🤒 Sick in Room`**: Bed-rest excusals with global student search and active list.
     3. **`🩹 Masjid Jamath Exemption`**: Mobility and orthopedic exemptions with global student search.
     4. **`📊 Movement & Audit Reports`**: Dedicated administrative reports, history logs, and analytics.

---

## Technical Specifications & Invariants

### 1. Modal Form Redesign
The streamlined modal presents exactly three essential sections:
1. **Student Selection**: Predictive search (Name, `#adNo`, Reg.No, Class) with verified selection card and `[✕ Change]`.
2. **Reason Selection**:
   * Dropdown selector with `✍️ Custom Reason...` as the default first option.
   * When `Custom Reason` is selected, an autofocus text input is shown.
   * 1-tap preset chips (e.g., `Fever / Flu`, `Stomach Ache`, `Sprain / Bruise`) displayed right below; tapping any chip sets the dropdown/text immediately.
3. **Validity Period**:
   * Preset chips: `[Today Only]` (default), `[+1 Day (Tomorrow)]`, `[+2 Days (Day After)]`, `[Custom Date]`.
   * Date input displaying the effective end date with a live preview pill (`Valid through Today, 11 Nov`).

### 2. Expiration Logic & Backward Compatibility Invariant
In Firestore `campus_medical_waivers`, `validUntil` is stored as an ISO date string (`YYYY-MM-DD`).

**Critical Invariant for Legacy Data**:
Waivers created prior to this update lack `validUntil`. They must NOT be treated as expired based on `issuedAt`.
```javascript
export const isWaiverActiveOnDate = (w, dateStr) => {
  if (w.status !== 'ACTIVE') return false;
  // Legacy waivers without validUntil remain open-ended until manually revoked:
  if (!w.validUntil) return true;
  return dateStr <= w.validUntil;
};
```

### 3. Attendance Engine Integration
* **`PeriodAttendanceManager.jsx`**: Maps `startDate: w.issuedAt.split('T')[0]` and `endDate: w.validUntil || w.issuedAt.split('T')[0]` with `hasDuration: Boolean(w.validUntil)`.
* **`NightAttendanceManager.jsx`**: Evaluates `isWaiverActiveOnDate(w, selectedDate)` before setting `SICK_ROOM` status in night roll-call.

### 4. Admin Portal Tab Architecture
Inside `app/outpass/page.jsx`, when `isAdminProp === true` or user is Admin:
* The main navigation header displays the 4 sibling tabs:
  `[🪪 Gate Outpasses] [🤒 Sick in Room] [🩹 Masjid Jamath Exemption] [📊 Movement Reports]`
* Secondary tools (`⚙️ Settings`, `Scanner`) are accessible as top utility actions.
* Admin maintains unrestricted global search and issuance privileges across all campus classes in both `Sick in Room` and `Masjid Exemption`.

---

## Goals vs. Non-Goals

* **In-Scope Goals:**
  * Clean modal interface with reason and end date only.
  * Completely eliminate `roomNumber` and `additionalNotes` fields.
  * Automatic expiration at midnight for single-day bed rests.
  * Admin portal displays `Leaves & Outpass` with 4 sibling tabs.
  * 1-tap template chips and top-positioned custom reason input.
  * Backward-compatible active status check for legacy waivers.
* **Out-of-Scope Non-Goals:**
  * Room or wing occupancy tracking.
  * Automated pharmacy stock tracking.
  * Push notifications to parents for internal 1-day bed rests.
