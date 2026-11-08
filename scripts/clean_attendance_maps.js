// scripts/clean_attendance_maps.js
// Cleans up duplicated attendanceMap entries in all periodSession_ documents in Firestore systemCache.
// Replaces double-counted keys (adNo + regNo) with canonical regNo, and maps legacy subjects to clean names.

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

function mapSubjectName(rawSub, rawClass) {
  let s = String(rawSub || '').trim().replace(/\s+/g, ' ');
  let cls = String(rawClass || '').trim();

  const classRegex = /\b(AL1|AL2|FC1|FC2|QH1|QH2|QLA3|HFC3|AC2)\b/i;
  const match = s.match(classRegex);
  if (match && !cls) {
    cls = match[1].toUpperCase();
    if (cls === 'AC2') cls = 'FC2';
  }

  let base = s.replace(classRegex, '').trim();
  const upper = base.toUpperCase();

  if (upper.includes('THAFSEER')) return { subject: 'Thafseer', classAlias: cls || rawClass };
  if (upper.includes('HADEES')) return { subject: 'Hadith', classAlias: cls || rawClass };
  if (upper.includes('U:FIQH') || upper.includes('U: FIQH')) return { subject: 'U :FIQH', classAlias: cls || rawClass };
  if (upper.includes('FIQH')) return { subject: 'Fiqh', classAlias: cls || rawClass };
  if (upper.includes('AQEED')) return { subject: 'Aqidah', classAlias: cls || rawClass };
  if (upper.includes('BALAG')) return { subject: 'Balagha', classAlias: cls || rawClass };
  if (upper.includes('MANTHIQ')) return { subject: 'Logic', classAlias: cls || rawClass };
  if (upper.includes('ENGLISH')) return { subject: 'English', classAlias: cls || rawClass };
  if (upper.includes('ADAB')) return { subject: 'Adab', classAlias: cls || rawClass };
  if (upper.includes('URDU')) return { subject: 'Urdu', classAlias: cls || rawClass };
  if (upper === 'SS' || upper.startsWith('SS ') || upper.endsWith(' SS')) return { subject: 'Social Science', classAlias: cls || rawClass };
  if (upper.includes('THAMAD')) return { subject: 'Thamadun', classAlias: cls || rawClass };
  if (upper.includes('DIRASATHUL ADYAN')) return { subject: 'Dirasathul Adyan', classAlias: cls || rawClass };
  if (upper === 'PKV') return { subject: 'PKV', classAlias: cls || rawClass };
  if (upper === 'RP') return { subject: 'RP', classAlias: cls || rawClass };
  if (upper === 'DPA') return { subject: 'DPA', classAlias: cls || rawClass };
  if (upper.startsWith('TKS')) return { subject: s, classAlias: cls || rawClass };

  return { subject: s, classAlias: cls || rawClass };
}

async function cleanAttendance() {
  console.log("=================================================");
  console.log("🚀 STARTING ATTENDANCE MAP DEDUPLICATION & SUBJECT CLEANUP");
  console.log("=================================================\n");

  await signInWithEmailAndPassword(auth, 'admin@school.com', 'admin123');
  console.log("✅ Authenticated successfully!\n");

  // 1. Build Student Maps
  console.log("📥 Loading students...");
  const sSnap = await getDocs(collection(db, 'students'));
  const validRegNos = new Set();
  const adToReg = {};

  sSnap.forEach(d => {
    const st = d.data();
    const reg = String(st.regNo || st.id || d.id).trim();
    if (reg) validRegNos.add(reg);
    if (st.adNo) {
      const cleanAd = String(st.adNo).trim().toUpperCase();
      adToReg[cleanAd] = reg;
      if (/^\d+$/.test(cleanAd)) {
        adToReg['U' + cleanAd] = reg;
      }
    }
  });
  console.log(`✅ Loaded ${validRegNos.size} registered students.\n`);

  // 2. Fetch all systemCache documents
  console.log("📥 Loading period sessions from systemCache...");
  const sysSnap = await getDocs(collection(db, 'systemCache'));
  
  const sessionsToUpdate = [];
  const dayIndexesToUpdate = [];

  sysSnap.forEach(d => {
    if (d.id.startsWith('periodSession_')) {
      const data = d.data();
      const rawMap = data.attendanceMap || {};
      const rawKeys = Object.keys(rawMap);
      
      const cleanedMap = {};
      rawKeys.forEach(k => {
        const cleanK = String(k).trim().toUpperCase();
        const targetReg = validRegNos.has(k) ? k : (validRegNos.has(cleanK) ? cleanK : adToReg[cleanK]);
        if (targetReg && !cleanedMap[targetReg]) {
          cleanedMap[targetReg] = rawMap[k];
        }
      });

      const { subject: cleanSub, classAlias: cleanCls } = mapSubjectName(data.subject, data.classAlias);

      // Check if update is needed
      const keysChanged = rawKeys.length !== Object.keys(cleanedMap).length;
      const subChanged = cleanSub !== data.subject;

      if (keysChanged || subChanged) {
        sessionsToUpdate.push({
          docId: d.id,
          attendanceMap: cleanedMap,
          subject: cleanSub,
          classAlias: cleanCls || data.classAlias
        });
      }
    } else if (d.id.startsWith('daySessionsIndex_')) {
      const data = d.data();
      let hasChanges = false;
      const updatedSessions = (data.sessions || []).map(s => {
        const { subject: cleanSub, classAlias: cleanCls } = mapSubjectName(s.subject, s.classAlias);
        if (cleanSub !== s.subject) {
          hasChanges = true;
          return {
            ...s,
            subject: cleanSub,
            classAlias: cleanCls || s.classAlias
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

  console.log(`Found ${sessionsToUpdate.length} period sessions with duplicate keys / unmapped subjects.`);
  console.log(`Found ${dayIndexesToUpdate.length} day indexes to update.\n`);

  // Commit session updates in batches of 200
  for (let i = 0; i < sessionsToUpdate.length; i += 200) {
    const chunk = sessionsToUpdate.slice(i, i + 200);
    const batch = writeBatch(db);
    chunk.forEach(item => {
      batch.update(doc(db, 'systemCache', item.docId), {
        attendanceMap: item.attendanceMap,
        subject: item.subject,
        classAlias: item.classAlias,
        updatedAt: new Date().toISOString()
      });
    });
    await batch.commit();
    console.log(`   Updated period sessions: ${Math.min(i + 200, sessionsToUpdate.length)} / ${sessionsToUpdate.length}...`);
  }
  console.log("✅ All period session attendance maps cleaned and deduplicated!\n");

  // Commit day index updates in batches of 50
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
  console.log("✅ All day indexes updated!\n");

  console.log("=================================================");
  console.log("🎉 ATTENDANCE DEDUPLICATION & CLEANUP COMPLETE!");
  console.log("=================================================\n");
  process.exit(0);
}

cleanAttendance().catch(err => {
  console.error("❌ Fatal Error:", err);
  process.exit(1);
});
