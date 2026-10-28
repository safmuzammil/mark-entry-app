'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { auth, db } from '../../lib/firebase'; 
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';

const styles = {
  pageBackground: { minHeight: '100vh', backgroundColor: '#f8fafc', padding: '32px 16px', fontFamily: 'Inter, system-ui, sans-serif', color: '#0f172a' },
  card: { background: '#ffffff', padding: '28px', borderRadius: '16px', boxShadow: '0 4px 20px rgba(15, 23, 42, 0.04)', border: '1px solid #e2e8f0', marginBottom: '24px' },
  input: { width: '100%', padding: '12px 16px', borderRadius: '10px', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', color: '#0f172a', fontSize: '15px', outline: 'none', boxSizing: 'border-box', transition: 'border 0.2s' },
  label: { display: 'block', fontSize: '13px', fontWeight: '700', color: '#334155', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' },
  buttonPrimary: { padding: '12px 24px', background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)', color: '#ffffff', border: 'none', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', fontSize: '15px', boxShadow: '0 4px 12px rgba(37, 99, 235, 0.2)' },
  buttonDanger: { padding: '10px 18px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', fontSize: '14px' },
  badge: { display: 'inline-block', padding: '5px 10px', borderRadius: '8px', fontSize: '12px', fontWeight: '700' },
  sectionTitle: { margin: '0 0 20px 0', fontSize: '18px', color: '#0f172a', fontWeight: '800', borderBottom: '2px solid #f1f5f9', paddingBottom: '12px' }
};

const printStyles = `
  @media print {
    body { background: #ffffff !important; color: #000000 !important; }
    .no-print { display: none !important; }
    div { box-shadow: none !important; }
  }
`;

const CCE_LEVELS = { "Level 1": "15", "Level 2": "20", "Level 3": "25", "Level 4": "40" };

// Strict subject matcher preventing FIQH and U :FIQH collisions
const checkSubjectMatch = (dbKey, expectedSub) => {
  const a = String(dbKey || '').trim().toUpperCase();
  const b = String(expectedSub || '').trim().toUpperCase();
  const isAUsul = a === 'U :FIQH' || a === 'U:FIQH' || a.includes('U :FIQH') || a.includes('U:FIQH');
  const isBUsul = b === 'U :FIQH' || b === 'U:FIQH' || b.includes('U :FIQH') || b.includes('U:FIQH');

  if (isAUsul || isBUsul) return isAUsul && isBUsul;
  if (a === 'FIQH' || b === 'FIQH') return a === 'FIQH' && b === 'FIQH';
  if (a === b) return true;
  if ((a === 'LOGIC' && b === 'MANTIQ') || (a === 'MANTIQ' && b === 'LOGIC')) return true;
  if ((a === 'AQIDAH' && b === 'AQEEDA') || (a === 'AQEEDA' && b === 'AQIDAH')) return true;
  if ((a === 'THAMADUN' && b === 'THAMADAN') || (a === 'THAMADAN' && b === 'THAMADUN')) return true;
  return false;
};

// Helper: Checks if a given student belongs to a specific teacher enrollment
const doesStudentMatchEnrollment = (student, env) => {
  const sReg = String(student.regNo || '').trim().toUpperCase();
  const sAd = String(student.adNo || '').trim().toUpperCase();
  const sId = String(student.id || '').trim().toUpperCase();
  const isUrdu = sAd.startsWith('U');
  const studentClassesLower = (student.classes || []).map(c => String(c).trim().toLowerCase());

  // 1. Check explicit manual student IDs first
  if (env.studentIds && Array.isArray(env.studentIds) && env.studentIds.length > 0) {
    const savedIds = env.studentIds.map(id => String(id).trim().toUpperCase());
    return savedIds.includes(sReg) || savedIds.includes(sAd) || savedIds.includes(sId);
  }

  // 2. Fallback to class & language tag matching
  const envAliasLower = String(env.alias || '').trim().toLowerCase();
  const envLang = String(env.langTag || '').trim().toLowerCase();

  let classMatch = studentClassesLower.some(cls => envAliasLower.includes(cls));
  if (!classMatch && envAliasLower.includes('m10')) {
    if (studentClassesLower.some(cls => cls.includes('3')) && !isUrdu) classMatch = true;
  }

  if (classMatch) {
    if (envLang.includes('urdu') && !envLang.includes('non')) return isUrdu;
    if (envLang.includes('gen') || envLang.includes('non') || envLang === '') return !isUrdu;
    return true;
  }
  return false;
};

// 🌟 Student Weekly Reminder Banner Component (Supports Multi-Level Arrays)
function StudentWeeklyReminder() {
  const [reminder, setReminder] = useState(null);

  useEffect(() => {
    async function fetchReminder() {
      try {
        const snap = await getDoc(doc(db, 'systemCache', 'activeReminder'));
        if (snap.exists() && snap.data().active) {
          setReminder(snap.data());
        }
      } catch (err) {
        console.error("Failed to fetch student reminder", err);
      }
    }
    fetchReminder();
  }, []);

  if (!reminder) return null;

  let configs = reminder.targetConfigs;
  if (!configs && reminder.targetSubjects) {
    configs = {};
    reminder.targetSubjects.forEach(s => {
      configs[s] = [s.toUpperCase() === 'HIFZ' ? '50_1' : (reminder.level || "15")];
    });
  }

  if (!configs || Object.keys(configs).length === 0) return null;

  const formatLevelTag = (lvl) => {
    const strLvl = String(lvl);
    if (strLvl === '50_1') return 'Part 1 (/50)';
    if (strLvl === '50_2') return 'Part 2 (/50)';
    const cceName = Object.keys(CCE_LEVELS).find(key => CCE_LEVELS[key] === strLvl);
    return cceName ? `${cceName} (/${strLvl})` : `Max ${strLvl}`;
  };

  return (
    <div className="no-print" style={{ background: '#fffbeb', border: '1px solid #fde68a', padding: '20px', borderRadius: '14px', marginBottom: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
        <span style={{ fontSize: '24px' }}>📢</span>
        <div>
          <span style={{ background: '#f59e0b', color: '#ffffff', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '800' }}>
            {reminder.weekName || 'Current Week'} Updates
          </span>
          <h4 style={{ margin: '6px 0 0 0', color: '#92400e', fontSize: '15px', fontWeight: '800' }}>
            {reminder.message || 'Please complete and submit your assigned works in these subjects for this week:'}
          </h4>
        </div>
      </div>
      
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '14px' }}>
        {Object.keys(configs).map(sub => {
          const rawLvls = Array.isArray(configs[sub]) ? configs[sub] : [configs[sub]];
          if (rawLvls.length === 0) return null;

          return (
            <div key={sub} style={{ background: '#ffffff', border: '1px solid #fcd34d', padding: '8px 14px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: '800', color: '#0f172a', fontSize: '13px' }}>{sub}</span>
              {rawLvls.map((lvl, i) => (
                <span key={i} style={{ background: '#fef3c7', color: '#d97706', padding: '3px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: '700' }}>
                  {formatLevelTag(lvl)}
                </span>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function StudentDashboard() {
  const [regNo, setRegNo] = useState(''); 
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  
  const [authenticated, setAuthenticated] = useState(false);
  const [loggedInStudent, setLoggedInStudent] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const [isLoadingMarks, setIsLoadingMarks] = useState(false);
  const [subjectAggregates, setSubjectAggregates] = useState([]);
  const [overallStats, setOverallStats] = useState({ total1400: '-', total490: '-', rank: '-', overallStatus: '-' });

  const handleLogin = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setIsLoading(true);

    const safeRegNo = regNo.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
    const fakeEmail = `${safeRegNo}@student.school.com`;
    const safeAdNo = password.trim(); 
    const firebasePassword = safeAdNo.length < 6 ? safeAdNo.padStart(6, '0') : safeAdNo;

    try {
      await signInWithEmailAndPassword(auth, fakeEmail, firebasePassword);
      const docRef = doc(db, "students", safeRegNo);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const studentData = { id: docSnap.id, ...docSnap.data() };
        setLoggedInStudent(studentData);
        setAuthenticated(true);
        
        const coreSubjects = [
          'Thafseer', 'Hadith', 'Fiqh', 'U :FIQH', 'Aqidah', 'Balagha', 'Logic', 
          'English', 'Adab', 'Urdu', 'Social Science', 'Thamadun', 'Specialization', 'Hifz'
        ];
        
        const expectedSubjectsArray = coreSubjects.map(sub => ({ subject: sub }));
        fetchStudentMarksFromFirebase(studentData, expectedSubjectsArray); 
      } else {
        setErrorMsg('Student profile not found in database.');
      }
    } catch (err) {
      console.error("Login Error:", err.message);
      setErrorMsg('Invalid Registration Number or Admission Number.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setAuthenticated(false);
    setLoggedInStudent(null);
    setRegNo('');
    setPassword('');
    setSubjectAggregates([]);
    setOverallStats({ total1400: '-', total490: '-', rank: '-', overallStatus: '-' });
  };

  const fetchStudentMarksFromFirebase = async (studentData, expectedSubjects) => {
    setIsLoadingMarks(true);
    try {
      const studentRegNo = studentData.regNo;
      const [allMarksSnap, allStudentsSnap, allTeachersSnap] = await Promise.all([
        getDocs(collection(db, 'marks')),
        getDocs(collection(db, 'students')),
        getDocs(collection(db, 'teachers'))
      ]);

      const allMarksData = {};
      allMarksSnap.forEach(d => { allMarksData[d.id] = d.data(); });

      const allStudentsList = [];
      allStudentsSnap.forEach(d => { allStudentsList.push({ id: d.id, ...d.data() }); });

      const allTeachersList = [];
      allTeachersSnap.forEach(d => { allTeachersList.push({ id: d.id, ...d.data() }); });

      const marksData = allMarksData[studentRegNo] || {};

      // Add any custom subjects that exist in student's mark record
      Object.keys(marksData).forEach(subKey => {
        const cleanSub = subKey.trim();
        if (cleanSub) {
          const alreadyExists = expectedSubjects.some(s => checkSubjectMatch(s.subject, cleanSub));
          if (!alreadyExists) expectedSubjects.push({ subject: cleanSub });
        }
      });

      // 🌟 TRUE CLASS RANK: Rank only against students sharing the same primary class
      const myPrimaryClass = (studentData.classes || [])[0];
      const classPeers = myPrimaryClass 
        ? allStudentsList.filter(s => (s.classes || []).includes(myPrimaryClass))
        : allStudentsList;

      let peerScores = [];
      classPeers.forEach(peer => {
        const pMarks = allMarksData[peer.regNo] || allMarksData[peer.id] || {};
        let sTotal = 0;
        Object.keys(pMarks).forEach(sub => {
          if (typeof pMarks[sub] === 'object') {
            Object.values(pMarks[sub]).forEach(val => {
              if (val !== undefined && val !== '' && !isNaN(Number(val))) sTotal += Number(val);
            });
          }
        });
        peerScores.push({ id: peer.regNo, total: sTotal });
      });

      peerScores.sort((a, b) => b.total - a.total);
      let myRank = peerScores.findIndex(s => s.id === studentRegNo) + 1;

      processMarksLocally(studentData, marksData, expectedSubjects, myRank, allMarksData, allStudentsList, allTeachersList);
    } catch (err) {
      console.error("Error loading marks from Firebase:", err);
    } finally {
      setIsLoadingMarks(false);
    }
  };

  const processMarksLocally = (studentData, marksData, expectedSubjects, myRank, allMarksData, allStudentsList, allTeachersList) => {
    let total1400 = 0;
    let total490 = 0;
    let totalEnteredMaxPossible = 0;
    let hasAnyOverallData = false;
    const subjectList = [];

    expectedSubjects.forEach(subObj => {
      const sub = subObj.subject;
      let normKey = sub.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
      if (sub.toUpperCase().includes('U :FIQH') || sub.toUpperCase().includes('U:FIQH')) {
        normKey = 'U :FIQH';
      }
      const isHifz = sub.toUpperCase() === 'HIFZ';
      
      const foundSubjectKey = Object.keys(marksData).find(k => checkSubjectMatch(k, sub));
      const subMarks = foundSubjectKey ? marksData[foundSubjectKey] : {};

      // 🌟 FIND THE EXACT TEACHER & ENROLLMENT FOR THIS LOGGED-IN STUDENT & SUBJECT
      let matchedTeacherEnv = null;
      let assignedTeacherName = '';

      // Pass 1: Check explicit manual studentIds assignment
      for (const teacher of allTeachersList) {
        const manualEnv = (teacher.enrollments || []).find(env => {
          const envSub = (env.alias?.toUpperCase().includes('U :FIQH') || env.subject?.toUpperCase().includes('U :FIQH')) ? 'U :FIQH' : (env.subject || '');
          if (!checkSubjectMatch(envSub, sub)) return false;
          if (env.studentIds && Array.isArray(env.studentIds) && env.studentIds.length > 0) {
            const savedIds = env.studentIds.map(id => String(id).trim().toUpperCase());
            return savedIds.includes(String(studentData.regNo).toUpperCase()) || savedIds.includes(String(studentData.adNo).toUpperCase());
          }
          return false;
        });
        if (manualEnv) {
          matchedTeacherEnv = manualEnv;
          assignedTeacherName = teacher.fullName;
          break;
        }
      }

      // Pass 2: Check automatic class/language fallback
      if (!matchedTeacherEnv) {
        for (const teacher of allTeachersList) {
          const autoEnv = (teacher.enrollments || []).find(env => {
            const envSub = (env.alias?.toUpperCase().includes('U :FIQH') || env.subject?.toUpperCase().includes('U :FIQH')) ? 'U :FIQH' : (env.subject || '');
            if (!checkSubjectMatch(envSub, sub)) return false;
            return doesStudentMatchEnrollment(studentData, env);
          });
          if (autoEnv) {
            matchedTeacherEnv = autoEnv;
            assignedTeacherName = teacher.fullName;
            break;
          }
        }
      }

      // 🌟 DETERMINE PEERS IN THIS EXACT TEACHER'S CLASS COHORT ONLY
      let cohortStudentRegNos = [];
      if (matchedTeacherEnv) {
        cohortStudentRegNos = allStudentsList
          .filter(peer => doesStudentMatchEnrollment(peer, matchedTeacherEnv))
          .map(peer => peer.regNo);
      } else {
        const myPrimaryClass = (studentData.classes || [])[0];
        const amIUrdu = String(studentData.adNo || '').toUpperCase().startsWith('U');
        cohortStudentRegNos = allStudentsList
          .filter(peer => {
            const sameClass = myPrimaryClass ? (peer.classes || []).includes(myPrimaryClass) : false;
            const peerUrdu = String(peer.adNo || '').toUpperCase().startsWith('U');
            return sameClass && (amIUrdu === peerUrdu);
          })
          .map(peer => peer.regNo);
      }

      let levelGradingStarted = isHifz 
        ? { '50_1': false, '50_2': false } 
        : { '15': false, '20': false, '25': false, '40': false };
      
      // Only check marks of students inside `cohortStudentRegNos`!
      cohortStudentRegNos.forEach(peerRegNo => {
        const stMarks = allMarksData[peerRegNo];
        if (!stMarks) return;
        const anyFoundKey = Object.keys(stMarks).find(k => checkSubjectMatch(k, sub));
        if (anyFoundKey) {
          const globalSubMarks = stMarks[anyFoundKey];
          if (isHifz) {
            if (globalSubMarks['50_1'] !== undefined && globalSubMarks['50_1'] !== '') levelGradingStarted['50_1'] = true;
            if (globalSubMarks['50_2'] !== undefined && globalSubMarks['50_2'] !== '') levelGradingStarted['50_2'] = true;
          } else {
            if (globalSubMarks['15'] !== undefined && globalSubMarks['15'] !== '') levelGradingStarted['15'] = true;
            if (globalSubMarks['20'] !== undefined && globalSubMarks['20'] !== '') levelGradingStarted['20'] = true;
            if (globalSubMarks['25'] !== undefined && globalSubMarks['25'] !== '') levelGradingStarted['25'] = true;
            if (globalSubMarks['40'] !== undefined && globalSubMarks['40'] !== '') levelGradingStarted['40'] = true;
          }
        }
      });
      
      let subSumObtained = 0;
      let subSumMax = 0; 
      let hasData = false;
      let assessments = {};

      if (isHifz) {
        let h1 = subMarks['50_1'] !== undefined && subMarks['50_1'] !== '' && !isNaN(Number(subMarks['50_1'])) ? Number(subMarks['50_1']) : '-';
        let h2 = subMarks['50_2'] !== undefined && subMarks['50_2'] !== '' && !isNaN(Number(subMarks['50_2'])) ? Number(subMarks['50_2']) : '-';
        assessments = { '50_1': h1, '50_2': h2 };
        if (h1 !== '-') { subSumObtained += h1; subSumMax += 50; hasData = true; }
        if (h2 !== '-') { subSumObtained += h2; subSumMax += 50; hasData = true; }
      } else {
        let l1 = subMarks['15'] !== undefined && subMarks['15'] !== '' && !isNaN(Number(subMarks['15'])) ? Number(subMarks['15']) : '-';
        let l2 = subMarks['20'] !== undefined && subMarks['20'] !== '' && !isNaN(Number(subMarks['20'])) ? Number(subMarks['20']) : '-';
        let l3 = subMarks['25'] !== undefined && subMarks['25'] !== '' && !isNaN(Number(subMarks['25'])) ? Number(subMarks['25']) : '-';
        let l4 = subMarks['40'] !== undefined && subMarks['40'] !== '' && !isNaN(Number(subMarks['40'])) ? Number(subMarks['40']) : '-';
        assessments = { '15': l1, '20': l2, '25': l3, '40': l4 };
        if (l1 !== '-') { subSumObtained += l1; subSumMax += 15; hasData = true; }
        if (l2 !== '-') { subSumObtained += l2; subSumMax += 20; hasData = true; }
        if (l3 !== '-') { subSumObtained += l3; subSumMax += 25; hasData = true; }
        if (l4 !== '-') { subSumObtained += l4; subSumMax += 40; hasData = true; }
      }

      let total100 = hasData ? subSumObtained : '-';
      let semScore = isHifz ? '-' : (hasData ? Number((subSumObtained * 0.3).toFixed(1)) : '-');

      // 🌟 Replicates Google Sheet Formula: SUM(F5:I5) / SUMPRODUCT(--ISNUMBER(F5:I5), F$3:I$3)
      let status = hasData && subSumMax > 0 ? ((subSumObtained / subSumMax) * 100).toFixed(2) + '%' : '-';

      if (hasData) {
        total1400 += total100;
        total490 += isHifz ? total100 : Number((subSumObtained * 0.3).toFixed(1));
        totalEnteredMaxPossible += subSumMax;
        hasAnyOverallData = true;
      }

      subjectList.push({ 
        subject: normKey, 
        teacherName: assignedTeacherName,
        isHifz, 
        assessments, 
        total100, 
        semScore, 
        status, 
        hasData, 
        levelGradingStarted 
      });
    });

    // 🌟 Overall Current Status % based strictly on marks entered so far
    let overallStatus = '-';
    if (hasAnyOverallData && totalEnteredMaxPossible > 0) {
      overallStatus = ((total1400 / totalEnteredMaxPossible) * 100).toFixed(2) + '%';
    }

    setSubjectAggregates(subjectList);
    setOverallStats({
      total1400: hasAnyOverallData ? total1400 : '-',
      total490: hasAnyOverallData ? total490.toFixed(1) : '-',
      rank: hasAnyOverallData && myRank > 0 ? myRank : '-',
      overallStatus: overallStatus
    });
  };

  const renderMarkCell = (mark, gradingStarted) => {
    if (mark !== '-') {
      return <span style={{ color: '#2563eb', fontWeight: '800', fontSize: '15px' }}>{mark}</span>;
    }
    if (gradingStarted) {
      return (
        <span title="Your teacher has started grading this level for your class" style={{ background: '#fef2f2', color: '#dc2626', padding: '4px 8px', borderRadius: '6px', fontSize: '12px', fontWeight: '800', border: '1px solid #fecaca', cursor: 'help' }}>
          ⚠️ Pending
        </span>
      );
    }
    return <span style={{ color: '#cbd5e1', fontWeight: '600' }}>-</span>;
  };

  if (!authenticated) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc', fontFamily: 'Inter, system-ui, sans-serif', padding: '16px' }}>
        <div style={{ background: '#ffffff', padding: '40px 32px', borderRadius: '20px', boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)', width: '100%', maxWidth: '420px', border: '1px solid #e2e8f0' }}>
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <span style={{ fontSize: '40px', display: 'block', marginBottom: '8px' }}>🎓</span>
            <h2 style={{ color: '#0f172a', margin: '0 0 8px 0', fontSize: '26px', fontWeight: '800' }}>Student Portal</h2>
            <p style={{ color: '#64748b', fontSize: '14px', margin: 0, fontWeight: '500' }}>Sign in to view your academic progress</p>
          </div>
          
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <label style={styles.label}>Registration Number</label>
              <input type="text" value={regNo} onChange={(e) => setRegNo(e.target.value)} placeholder="e.g. 726007" required style={styles.input} />
            </div>
            <div>
              <label style={styles.label}>Admission Number</label>
              <div style={{ position: 'relative', width: '100%' }}>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="e.g. U1278"
                  required
                  style={{ ...styles.input, paddingRight: '65px' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#2563eb', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </div>
            <button type="submit" disabled={isLoading} style={{ ...styles.buttonPrimary, opacity: isLoading ? 0.7 : 1 }}>
              {isLoading ? 'Authenticating...' : 'Login to View Marks'}
            </button>
            {errorMsg && <p style={{ color: '#dc2626', fontSize: '14px', textAlign: 'center', margin: 0, fontWeight: '700', background: '#fef2f2', padding: '12px', borderRadius: '8px', border: '1px solid #fecaca' }}>{errorMsg}</p>}
          </form>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.pageBackground}>
      <style dangerouslySetInnerHTML={{ __html: printStyles }} />
      <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
        
        <StudentWeeklyReminder />

        <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', background: '#ffffff', padding: '24px 28px', borderRadius: '16px', boxShadow: '0 4px 20px rgba(15, 23, 42, 0.04)', border: '1px solid #e2e8f0', flexWrap: 'wrap', gap: '16px' }}>
          
          {/* 🌟 New wrapper to place the logo and text side-by-side */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <img src="https://www.dhiu.in/resources/img/uni-logo.png" alt="DHIU Logo" style={{ width: '52px', height: '52px', borderRadius: '50%', objectFit: 'cover' }} />
            
            <div>
              <h1 style={{ margin: '0 0 6px 0', fontSize: '24px', color: '#0f172a', fontWeight: '800' }}>{loggedInStudent?.firstName}</h1>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ ...styles.badge, background: '#f1f5f9', color: '#334155' }}>Reg: {loggedInStudent?.regNo}</span>
                <span style={{ ...styles.badge, background: '#f1f5f9', color: '#334155' }}>Ad.No: {loggedInStudent?.adNo}</span>
                <span style={{ ...styles.badge, background: '#e0f2fe', color: '#0369a1' }}>{loggedInStudent?.department || 'General'}</span>
                {loggedInStudent?.classes?.map((cls, i) => (
                  <span key={i} style={{ ...styles.badge, background: '#ede9fe', color: '#6d28d9' }}>{cls}</span>
                ))}
              </div>
            </div>

          {/* Buttons stay on the far right */}
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
            <Link href="/outpass" style={{ background: "#0f766e", color: "#ffffff", padding: "10px 16px", borderRadius: "10px", fontWeight: "700", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "14px" }}>
              🪪 Out-Pass Portal
            </Link>
            <button onClick={() => window.print()} style={{ padding: '10px 18px', background: '#f8fafc', color: '#0f172a', border: '1px solid #cbd5e1', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', fontSize: '14px' }}>
              🖨️ Print Report
            </button>
            <button onClick={handleLogout} style={styles.buttonDanger}>Logout</button>
          </div>
        </div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
            <Link href="/outpass" style={{ background: "#0f766e", color: "#ffffff", padding: "10px 16px", borderRadius: "10px", fontWeight: "700", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "14px" }}>
              🪪 Out-Pass Portal
            </Link>
            <button onClick={() => window.print()} style={{ padding: '10px 18px', background: '#f8fafc', color: '#0f172a', border: '1px solid #cbd5e1', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', fontSize: '14px' }}>
              🖨️ Print Report
            </button>
            <button onClick={handleLogout} style={styles.buttonDanger}>Logout</button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '24px' }}>
          <div style={{ background: '#ffffff', padding: '22px', borderRadius: '16px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
            <h4 style={{ margin: '0 0 8px 0', color: '#64748b', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Aggregate</h4>
            <div style={{ fontSize: '28px', fontWeight: '900', color: '#0f172a' }}>
              {overallStats.total1400} <span style={{ fontSize: '16px', color: '#94a3b8', fontWeight: '600' }}>/ 1400</span>
            </div>
          </div>
          
          <div style={{ background: '#ffffff', padding: '22px', borderRadius: '16px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
            <h4 style={{ margin: '0 0 8px 0', color: '#64748b', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Sem Score</h4>
            <div style={{ fontSize: '28px', fontWeight: '900', color: '#0f172a' }}>
              {overallStats.total490} <span style={{ fontSize: '16px', color: '#94a3b8', fontWeight: '600' }}>/ 490</span>
            </div>
          </div>

          <div style={{ background: '#ffffff', padding: '22px', borderRadius: '16px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
            <h4 style={{ margin: '0 0 8px 0', color: '#64748b', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Class Rank</h4>
            <div style={{ fontSize: '28px', fontWeight: '900', color: '#2563eb' }}>
              {overallStats.rank !== '-' ? `#${overallStats.rank}` : '-'}
            </div>
          </div>

          <div style={{ background: '#ffffff', padding: '22px', borderRadius: '16px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
            <h4 style={{ margin: '0 0 8px 0', color: '#64748b', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Current Status (%)</h4>
            <div style={{ fontSize: '28px', fontWeight: '900', color: '#10b981' }}>
              {overallStats.overallStatus}
            </div>
          </div>
        </div>

        <div style={styles.card}>
          <h3 style={styles.sectionTitle}>📊 Curriculum & Detailed Performance Breakdown</h3>
          
          {isLoadingMarks ? (
            <p style={{ textAlign: 'center', color: '#64748b', padding: '30px', fontWeight: '600' }}>Loading your academic records...</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', fontSize: '14px', minWidth: '800px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #cbd5e1' }}>
                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', textAlign: 'left' }}>Subject & Instructor</th>
                    <th style={{ padding: '14px 16px', color: '#334155', fontWeight: '800' }}>L1 (15)</th>
                    <th style={{ padding: '14px 16px', color: '#334155', fontWeight: '800' }}>L2 (20)</th>
                    <th style={{ padding: '14px 16px', color: '#334155', fontWeight: '800' }}>L3 (25)</th>
                    <th style={{ padding: '14px 16px', color: '#334155', fontWeight: '800' }}>L4 (40)</th>
                    <th style={{ padding: '14px 16px', color: '#1e40af', fontWeight: '800', borderLeft: '1px solid #e2e8f0' }}>Total (100)</th>
                    <th style={{ padding: '14px 16px', color: '#047857', fontWeight: '800' }}>Scaled (30)</th>
                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800' }}>Current Status</th>
                  </tr>
                </thead>
                <tbody>
                  {subjectAggregates.map((data, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0', background: idx % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                      <td style={{ padding: '14px 16px', textAlign: 'left' }}>
                        <div style={{ fontWeight: '800', color: '#0f172a', fontSize: '15px' }}>{data.subject}</div>
                        {data.teacherName && <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '600', marginTop: '2px' }}>👨‍🏫 {data.teacherName}</div>}
                      </td>
                      
                      {data.isHifz ? (
                        <>
                          <td colSpan="2" style={{ padding: '14px 16px' }}>
                            <span style={{ fontSize: '11px', color: '#64748b', fontWeight: '700', display: 'block', marginBottom: '2px' }}>Part 1 (/50)</span>
                            {renderMarkCell(data.assessments?.['50_1'], data.levelGradingStarted?.['50_1'])}
                          </td>
                          <td colSpan="2" style={{ padding: '14px 16px' }}>
                            <span style={{ fontSize: '11px', color: '#64748b', fontWeight: '700', display: 'block', marginBottom: '2px' }}>Part 2 (/50)</span>
                            {renderMarkCell(data.assessments?.['50_2'], data.levelGradingStarted?.['50_2'])}
                          </td>
                        </>
                      ) : (
                        <>
                          <td style={{ padding: '14px 16px' }}>{renderMarkCell(data.assessments?.['15'], data.levelGradingStarted?.['15'])}</td>
                          <td style={{ padding: '14px 16px' }}>{renderMarkCell(data.assessments?.['20'], data.levelGradingStarted?.['20'])}</td>
                          <td style={{ padding: '14px 16px' }}>{renderMarkCell(data.assessments?.['25'], data.levelGradingStarted?.['25'])}</td>
                          <td style={{ padding: '14px 16px' }}>{renderMarkCell(data.assessments?.['40'], data.levelGradingStarted?.['40'])}</td>
                        </>
                      )}
                      
                      <td style={{ padding: '14px 16px', fontWeight: '800', color: '#1e40af', borderLeft: '1px solid #e2e8f0' }}>{data.total100}</td>
                      <td style={{ padding: '14px 16px', fontWeight: '800', color: '#047857' }}>{data.semScore}</td>
                      <td style={{ padding: '14px 16px' }}>
                        <span style={{ 
                          ...styles.badge, 
                          background: data.status === '-' ? '#f1f5f9' : parseFloat(data.status) >= 40 ? '#ecfdf5' : '#fef2f2', 
                          color: data.status === '-' ? '#64748b' : parseFloat(data.status) >= 40 ? '#047857' : '#dc2626' 
                        }}>
                          {data.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}