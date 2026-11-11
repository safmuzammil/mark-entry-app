# Design Documents Sitemap

| Design Document | Date | Author | Target Components | Description |
| :--- | :--- | :--- | :--- | :--- |
| [Three-Tiered Unified Leave Architecture & Zero-Friction Attendance Workflows](three_tiered_leaves_and_modal_free_attendance.md) | 2026-11-10 | safmuzammil | `TeacherPortalView`, `OutPassPortal`, `NightAttendanceManager`, `PeriodAttendanceManager`, `MinusAttendanceManager` | Elevates Out-Pass Desk into unified Leaves & Outpass with 3 sub-tabs (Gate Outpasses, Sick in Room, Masjid Exemptions) and implements modal-free 1-tap roll-call across Night & Extra Attendance. |
| [Streamlined Leave Granting & Unified Admin Leaves Hub](streamlined_leaves_and_admin_hub.md) | 2026-11-11 | safmuzammil | `SickInRoomSubTab`, `MasjidExemptionSubTab`, `OutPassPortal`, `PeriodAttendanceManager`, `NightAttendanceManager`, `firestore.rules` | Streamlines leave granting modal (custom-first reason with 1-tap template chips, end-of-day expiration, validUntil duration selector) and unifies Admin Portal navigation with 4 sibling tabs under Leaves & Outpass. |
