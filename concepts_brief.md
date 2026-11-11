# Masjid Jamath Exemption & Sick Waiver Query Index Resolution

* **Author:** safmuzammil
* **Date:** 2026-11-11

## Overview

When faculty or administrators granted a Masjid Jamath Exemption or Sick in Room waiver, the document was successfully validated and committed to Cloud Firestore (`campus_medical_waivers`). However, the real-time subscriber (`onSnapshot`) failed silently with a composite index error (`The query requires an index: waiverType ASC, issuedAt DESC`), causing the snapshot listener to abort and keep the client-side `activeWaivers` list empty (`0 Students`).

## Root Cause Analysis

1. **Write Verification**:
   - Live query inspection of Cloud Firestore confirmed that documents submitted by faculty **were successfully written and persisted**.
   - Example saved document:
     - Document ID: `waiver_jamath_1794377071353_3462`
     - Student: Sayyid Muhammad Sahran (`#3462`, Class `QLA3`)
     - Validity: Until `2026-11-21`
     - Issued By: `muzammil` (`MUHAMMED MUZAMMIL P`)
     - Status: `ACTIVE`

2. **Read Failure via Missing Composite Index**:
   - The query in `MasjidExemptionSubTab.jsx` and `SickInRoomSubTab.jsx` requested:
     ```javascript
     query(
       collection(db, "campus_medical_waivers"),
       where("waiverType", "==", "JAMATH_EXEMPTION"),
       orderBy("issuedAt", "desc"),
       limit(200)
     )
     ```
   - Firestore strictly requires an explicit composite index whenever an equality filter (`where`) is combined with an order clause (`orderBy`) on a different field.
   - Because no composite index existed for `waiverType ASC, issuedAt DESC`, Firestore rejected the query with `FirebaseError: The query requires an index`.
   - The `onSnapshot` error callback executed, leaving the `activeWaivers` array as `[]`. The UI consequently showed:
     - `ACTIVE EXEMPTIONS: 0 Students`
     - `No students currently holding Masjid Jamath Exemptions.`

## Resolution Applied

1. **In-Memory Client Sorting**:
   - Removed `orderBy("issuedAt", "desc")` from the Firestore query in both `MasjidExemptionSubTab.jsx` and `SickInRoomSubTab.jsx`.
   - Single equality filters (`where("waiverType", "==", ...)`) execute immediately using Firestore's built-in single-field indexing.
   - Result sets are sorted directly in memory on the client:
     ```javascript
     active.sort((a, b) => (b.issuedAt || "").localeCompare(a.issuedAt || ""));
     revoked.sort((a, b) => (b.issuedAt || "").localeCompare(a.issuedAt || ""));
     ```

2. **Source-Controlled Index Definition**:
   - Created `firestore.indexes.json` defining the composite index for `campus_medical_waivers`.
   - Updated `firebase.json` to link the index specification.

3. **Verification**:
   - Executed diagnostic query against Firestore database. The query now retrieves all active records immediately, and `Sayyid Muhammad Sahran` is correctly resolved as active until `2026-11-21`.
