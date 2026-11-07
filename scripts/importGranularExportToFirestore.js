// scripts/importGranularExportToFirestore.js
// Direct full migration script: Imports shuhood_full_granular_export.json directly into Cloud Firestore
// using admin authentication.

const fs = require('fs');
const path = require('path');
const { initializeApp } = require('firebase/app');
const { getAuth, signInWithEmailAndPassword } = require('firebase/auth');
const { initializeFirestore, collection, getDocs, doc, writeBatch } = require('firebase/firestore');

const firebaseConfig = {
  apiKey: "AIzaSyDl7vTn-ienRgdOMdfoo_41iHCZprmeK74",
  authDomain: "mark-entry-app.firebaseapp.com",
  projectId: "mark-entry-app",
  storageBucket: "mark-entry-app.firebasestorage.app",
  messagingSenderId: "694213237468",
  appId: "1:694213237468:web:04efcc2b775c578bf97219"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, { experimentalForceLongPolling: true });

async function runMigration() {
  console.log("=================================================");
  console.log("🚀 STARTING DIRECT HUZOOR DATA MIGRATION TO FIRESTORE");
  console.log("=================================================\n");

  // 1. Sign in as Admin
  console.log("🔑 Authenticating as admin@school.com...");
  await signInWithEmailAndPassword(auth, 'admin@school.com', 'admin123');
  console.log("✅ Admin authentication successful!\n");

  // 2. Read Granular Export File
  const jsonPath = path.join(__dirname, '..', 'shuhood_full_granular_export.json');
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`Export file not found at: ${jsonPath}`);
  }
  console.log(`📖 Reading export file: ${jsonPath}`);
  const exportData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  console.log(`   Export version: ${exportData.version}`);
  console.log(`   Exported at: ${exportData.exportedAt}`);
  console.log(`   Metadata:`, exportData.metadata);

  // 3. Load existing students from Firestore
  console.log("\n📥 Fetching existing students from Firestore...");
  const sSnap = await getDocs(collection(db, 'students'));
  const currentStudents = [];
  sSnap.forEach(d => currentStudents.push({ docId: d.id, ...d.data() }));
  console.log(`✅ Loaded ${currentStudents.length} students from Firestore.`);

  // 4. Load existing teachers from Firestore
  console.log("📥 Fetching existing teachers from Firestore...");
  const tSnap = await getDocs(collection(db, 'teachers'));
  const currentTeachers = [];
  tSnap.forEach(d => currentTeachers.push({ docId: d.id, ...d.data() }));
  console.log(`✅ Loaded ${currentTeachers.length} teachers from Firestore.\n`);

  // 5. Match and Update Students' Period Attendance
  console.log("👥 Matching and writing period attendance to student profiles...");
  const rawStudents = exportData.students || {};
  const studentEntries = Object.values(rawStudents);
  let matchedStudentsCount = 0;
  const notFoundList = [];

  for (let i = 0; i < studentEntries.length; i += 50) {
    const chunk = studentEntries.slice(i, i + 50);
    const batch = writeBatch(db);

    chunk.forEach(item => {
      let cleanAd = String(item.adNo || item.admissionNumber || '').trim().toUpperCase();
      if (cleanAd.startsWith('#')) cleanAd = cleanAd.slice(1).trim();
      if (!cleanAd) return;

      // Match by exact adNo or regNo
      let st = currentStudents.find(s =>
        String(s.adNo || '').trim().toUpperCase() === cleanAd ||
        String(s.regNo || '').trim().toUpperCase() === cleanAd ||
        String(s.docId || '').trim().toUpperCase() === cleanAd
      );

      // Handle Urdu stream U prefix if needed
      if (!st && /^\d{3,5}$/.test(cleanAd)) {
        st = currentStudents.find(s => String(s.adNo || '').trim().toUpperCase() === 'U' + cleanAd);
      }

      if (!st) {
        notFoundList.push(cleanAd);
        return;
      }

      matchedStudentsCount++;
      const docId = st.docId || st.regNo;
      const existingPatt = st.periodAttendance || {};

      // Merge minus logs safely
      const existingMinusLogs = Array.isArray(existingPatt.minusLogs) ? existingPatt.minusLogs : [];
      const newMinusLogs = Array.isArray(item.minusLogs) ? item.minusLogs : [];
      const mergedMinusLogs = [...existingMinusLogs];
      newMinusLogs.forEach(ml => {
        if (!mergedMinusLogs.some(em => (em.id && em.id === ml.id) || (em.date === ml.date && em.reason === ml.reason && em.count === ml.count))) {
          mergedMinusLogs.push(ml);
        }
      });
      const totalMinusCount = mergedMinusLogs.reduce((acc, m) => acc + (Number(m.count) || 0), 0);

      const periodAttendance = {
        totalPeriods: Number(item.totalPeriods) || 0,
        presentCount: Number(item.presentCount) || 0,
        officialCount: Number(item.officialCount) || 0,
        medicalCount: Number(item.medicalCount) || 0,
        permittedCount: 0,
        minusCount: totalMinusCount,
        minusLogs: mergedMinusLogs,
        subjectWise: item.subjectWise || {},
        appliedRehearsalDates: existingPatt.appliedRehearsalDates || {},
        updatedAt: new Date().toISOString()
      };

      batch.set(doc(db, 'students', docId), { periodAttendance }, { merge: true });
    });

    await batch.commit();
    console.log(`   Processed ${Math.min(i + 50, studentEntries.length)} / ${studentEntries.length} student records...`);
  }
  console.log(`✅ Successfully updated period attendance for ${matchedStudentsCount} students!`);
  if (notFoundList.length > 0) {
    console.log(`   ℹ️ ${notFoundList.length} old student records not found in current roster:`, notFoundList.slice(0, 10));
  }

  // 6. Write Granular Period Sessions to systemCache
  const sessions = exportData.sessions || [];
  console.log(`\n📅 Writing ${sessions.length} granular date-by-date period sessions (Periods 1 to 9)...`);

  for (let i = 0; i < sessions.length; i += 80) {
    const chunk = sessions.slice(i, i + 80);
    const batch = writeBatch(db);

    chunk.forEach(s => {
      const safeAlias = String(s.subject || s.classAlias || 'Subject').trim().replace(/[^a-zA-Z0-9]/g, '_');
      const sessionDocId = s.sessionDocId || `periodSession_${s.date}_${safeAlias}_S${s.session || 1}`;

      // Normalize attendance map with student regNos
      const normalizedMap = {};
      Object.entries(s.attendanceMap || {}).forEach(([adOrReg, status]) => {
        normalizedMap[adOrReg] = status;
        const cleanK = String(adOrReg).trim().toUpperCase();
        const matched = currentStudents.find(st =>
          String(st.adNo || '').trim().toUpperCase() === cleanK ||
          String(st.regNo || '').trim().toUpperCase() === cleanK
        );
        if (matched) {
          normalizedMap[matched.regNo] = status;
        }
      });

      batch.set(doc(db, 'systemCache', sessionDocId), {
        date: s.date,
        session: Number(s.session) || 1,
        subject: s.subject,
        classAlias: s.classAlias,
        teacherUsername: String(s.teacherUsername || 'admin').toLowerCase().trim(),
        teacherName: String(s.teacherName || 'Faculty').trim(),
        attendanceMap: normalizedMap,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    });

    await batch.commit();
    console.log(`   Wrote ${Math.min(i + 80, sessions.length)} / ${sessions.length} period sessions...`);
  }
  console.log(`✅ All ${sessions.length} period sessions written to systemCache!`);

  // 7. Write Day Sessions Index to systemCache
  const dayIndexes = exportData.dayIndexes || {};
  const dayDates = Object.keys(dayIndexes);
  console.log(`\n🗂️ Writing daily session indexes for ${dayDates.length} calendar dates...`);

  for (let i = 0; i < dayDates.length; i += 50) {
    const chunk = dayDates.slice(i, i + 50);
    const batch = writeBatch(db);

    chunk.forEach(dStr => {
      batch.set(doc(db, 'systemCache', `daySessionsIndex_${dStr}`), {
        date: dStr,
        sessions: dayIndexes[dStr] || []
      }, { merge: true });
    });

    await batch.commit();
    console.log(`   Indexed ${Math.min(i + 50, dayDates.length)} / ${dayDates.length} dates...`);
  }
  console.log(`✅ Daily session indexes written!`);

  // 8. Merge Teacher Allocations & Enrollments
  const teachersList = exportData.teachers || [];
  console.log(`\n👨‍🏫 Merging allocations for ${teachersList.length} faculty members...`);
  const tBatch = writeBatch(db);
  let updatedTeachersCount = 0;

  teachersList.forEach(t => {
    const safeUser = String(t.username || '').toLowerCase().trim();
    if (!safeUser) return;
    const existingT = currentTeachers.find(x => x.username === safeUser);
    const mergedEnrollments = [...(existingT?.enrollments || [])];

    (t.enrollments || []).forEach(env => {
      if (!mergedEnrollments.some(e => e.id === env.id || (e.subject === env.subject && e.alias === env.alias))) {
        mergedEnrollments.push(env);
      }
    });

    tBatch.set(doc(db, 'teachers', safeUser), {
      fullName: t.fullName || t.name,
      username: safeUser,
      role: t.role || 'teacher',
      enrollments: mergedEnrollments
    }, { merge: true });
    updatedTeachersCount++;
  });

  await tBatch.commit();
  console.log(`✅ Updated ${updatedTeachersCount} teacher profiles with allocations!`);

  console.log("\n=================================================");
  console.log("🎉 ALL HUZOOR ATTENDANCE DATA MIGRATED SUCCESSFULLY!");
  console.log("=================================================\n");
  process.exit(0);
}

runMigration().catch(err => {
  console.error("❌ Fatal Migration Error:", err);
  process.exit(1);
});
