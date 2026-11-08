// scripts/deduplicate_teachers.js
const { initializeApp } = require('firebase/app');
const { getAuth, signInWithEmailAndPassword } = require('firebase/auth');
const { initializeFirestore, collection, getDocs, doc, writeBatch, deleteDoc } = require('firebase/firestore');

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

// Explicit 24 Duplicate Mapping: [Upper/Imported Username -> True Lower Username]
const TEACHER_MAPPING = {
  'abdussalam_baqavi': 'abdussalambaqavi',
  'aboobacker_sidheeq_hudawi': 'sidheeqhudawi',
  'ajmal_hudawi': 'ajmalhudawi',
  'ashraf_alimi': 'ashraf',
  'aswim_saeed_hudawi': 'aswimhudawi',
  'c.yousuf_faizy': 'yousuffaisy',
  'hassan_nawaz_alimi': 'hassan',
  'hassankutty_baqavi': 'hasankutty',
  'mohammed_hudawi': 'muhammedhudawi',
  'muhammed_ali_hudawi_pi': 'pihudawi',
  'muhammed_ali_shihab_hudawi': 'shihabhudawi',
  'munavir_hudawi': 'munawir',
  'musthaqeem_faizy': 'musthaqeem',
  'muzammil_hudawi': 'muzammil',
  'niyas_hudawi': 'niyas',
  'sayyed_shahul_hameed_hudawi': 'thangal',
  'shabeer_hudawi': 'shabeer',
  'shajahan_hudawi': 'shajahanhudawi',
  'shamsu_sir': 'shamsu',
  'shanid_hudawi': 'shanid',
  'sharafudheen_hudawi': 'sharafu',
  'shuaib_hudawi': 'shuaibhudawi',
  'siraj_hudawi': 'sirajhudawi',
  'yoonus_hudawi': 'yoonushudawi'
};

async function executeDeduplication() {
  console.log("=================================================");
  console.log("🚀 STARTING TEACHER DEDUPLICATION & DATA MIGRATION");
  console.log("=================================================\n");

  // 1. Authenticate
  console.log("🔑 Authenticating as admin@school.com...");
  await signInWithEmailAndPassword(auth, 'admin@school.com', 'admin123');
  console.log("✅ Authenticated successfully!\n");

  // 2. Fetch all teachers
  console.log("📥 Loading teachers from Firestore...");
  const tSnap = await getDocs(collection(db, 'teachers'));
  const allTeachers = {};
  tSnap.forEach(d => {
    allTeachers[d.id] = { docId: d.id, ...d.data() };
  });
  console.log(`✅ Loaded ${Object.keys(allTeachers).length} teacher records.\n`);

  // Verify all mapped accounts exist
  for (const [upperUser, lowerUser] of Object.entries(TEACHER_MAPPING)) {
    if (!allTeachers[upperUser]) {
      throw new Error(`Upper teacher account not found: ${upperUser}`);
    }
    if (!allTeachers[lowerUser]) {
      throw new Error(`Lower teacher account not found: ${lowerUser}`);
    }
  }
  console.log("✅ All 24 duplicate pairs verified!\n");

  // Build name lookup for lower teachers
  const lowerTeacherNames = {};
  for (const lowerUser of Object.values(TEACHER_MAPPING)) {
    lowerTeacherNames[lowerUser] = allTeachers[lowerUser].fullName || lowerUser;
  }

  // 3. Merge enrollments from Upper into Lower
  console.log("🔄 Merging Huzoor enrollments from Upper into Lower accounts...");
  const teacherBatch = writeBatch(db);

  for (const [upperUser, lowerUser] of Object.entries(TEACHER_MAPPING)) {
    const upperDoc = allTeachers[upperUser];
    const lowerDoc = allTeachers[lowerUser];

    const currentEnrollments = Array.isArray(lowerDoc.enrollments) ? [...lowerDoc.enrollments] : [];
    const upperEnrollments = Array.isArray(upperDoc.enrollments) ? upperDoc.enrollments : [];

    let addedCount = 0;
    upperEnrollments.forEach(ue => {
      const exists = currentEnrollments.some(ce => 
        (ce.id && ce.id === ue.id) || 
        (String(ce.alias || '').trim().toLowerCase() === String(ue.alias || '').trim().toLowerCase())
      );
      if (!exists) {
        currentEnrollments.push({
          ...ue,
          teacherName: lowerDoc.fullName || lowerDoc.name || ue.teacherName
        });
        addedCount++;
      }
    });

    teacherBatch.update(doc(db, 'teachers', lowerUser), {
      enrollments: currentEnrollments,
      updatedAt: new Date().toISOString()
    });
    console.log(`   Merged ${addedCount} enrollments into ${lowerUser} (${lowerDoc.fullName})`);
  }

  await teacherBatch.commit();
  console.log("✅ All enrollments merged into lower teacher accounts!\n");

  // 4. Update periodSession_ documents in systemCache
  console.log("📥 Loading period sessions from systemCache to reassign usernames...");
  const sysSnap = await getDocs(collection(db, 'systemCache'));
  
  const sessionsToUpdate = [];
  const dayIndexesToUpdate = [];

  sysSnap.forEach(d => {
    if (d.id.startsWith('periodSession_')) {
      const data = d.data();
      const currentU = String(data.teacherUsername || '').trim();
      if (TEACHER_MAPPING[currentU]) {
        const targetU = TEACHER_MAPPING[currentU];
        const targetName = lowerTeacherNames[targetU];
        sessionsToUpdate.push({
          docId: d.id,
          targetU,
          targetName
        });
      }
    } else if (d.id.startsWith('daySessionsIndex_')) {
      const data = d.data();
      let hasChanges = false;
      const updatedSessions = (data.sessions || []).map(s => {
        const u = String(s.teacherUsername || '').trim();
        if (TEACHER_MAPPING[u]) {
          hasChanges = true;
          const targetU = TEACHER_MAPPING[u];
          return {
            ...s,
            teacherUsername: targetU,
            teacherName: lowerTeacherNames[targetU] || s.teacherName
          };
        }
        return s;
      });

      if (hasChanges) {
        dayIndexesToUpdate.push({
          docId: d.id,
          sessions: updatedSessions
        });
      }
    }
  });

  console.log(`Found ${sessionsToUpdate.length} period sessions to reassign.`);
  console.log(`Found ${dayIndexesToUpdate.length} daily index documents to update.\n`);

  // Commit period session updates in batches
  for (let i = 0; i < sessionsToUpdate.length; i += 200) {
    const chunk = sessionsToUpdate.slice(i, i + 200);
    const batch = writeBatch(db);
    chunk.forEach(item => {
      batch.update(doc(db, 'systemCache', item.docId), {
        teacherUsername: item.targetU,
        teacherName: item.targetName,
        updatedAt: new Date().toISOString()
      });
    });
    await batch.commit();
    console.log(`   Updated period sessions: ${Math.min(i + 200, sessionsToUpdate.length)} / ${sessionsToUpdate.length}...`);
  }
  console.log("✅ All period sessions updated to true lower teacher accounts!\n");

  // Commit day index updates in batches
  for (let i = 0; i < dayIndexesToUpdate.length; i += 50) {
    const chunk = dayIndexesToUpdate.slice(i, i + 50);
    const batch = writeBatch(db);
    chunk.forEach(item => {
      batch.update(doc(db, 'systemCache', item.docId), {
        sessions: item.sessions,
        updatedAt: new Date().toISOString()
      });
    });
    await batch.commit();
    console.log(`   Updated day indexes: ${Math.min(i + 50, dayIndexesToUpdate.length)} / ${dayIndexesToUpdate.length}...`);
  }
  console.log("✅ All day indexes updated to true lower teacher accounts!\n");

  // 5. Delete the 24 Upper Duplicate Documents
  console.log("🗑️ Deleting the 24 duplicate uppercase teacher documents from Firestore...");
  const deleteBatch = writeBatch(db);
  for (const upperUser of Object.keys(TEACHER_MAPPING)) {
    deleteBatch.delete(doc(db, 'teachers', upperUser));
    console.log(`   Queued deletion: ${upperUser}`);
  }
  await deleteBatch.commit();
  console.log("✅ Successfully deleted all 24 duplicate uppercase accounts!\n");

  // 6. Post-Verification
  console.log("🔍 Running final verification...");
  const verifyTSnap = await getDocs(collection(db, 'teachers'));
  const remainingTeachers = [];
  verifyTSnap.forEach(d => remainingTeachers.push({ id: d.id, name: d.data().fullName }));
  console.log(`Remaining teachers count: ${remainingTeachers.length}`);
  remainingTeachers.forEach((t, idx) => console.log(`   ${idx + 1}. [${t.id}] ${t.name}`));

  console.log("\n=================================================");
  console.log("🎉 TEACHER DEDUPLICATION COMPLETED SAFELY & PERFECTLY!");
  console.log("=================================================\n");
  process.exit(0);
}

executeDeduplication().catch(err => {
  console.error("❌ Fatal Deduplication Error:", err);
  process.exit(1);
});
