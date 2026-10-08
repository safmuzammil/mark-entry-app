'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { auth, db } from '../lib/firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, getAuth, signOut, updatePassword, onAuthStateChanged } from 'firebase/auth';
import { doc, setDoc, getDoc, getDocs, collection, deleteDoc, arrayUnion } from 'firebase/firestore';
import { getApp, initializeApp } from 'firebase/app';
import * as XLSX from 'xlsx';
import InstallAppBanner from './components/InstallAppBanner';

const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbxN_z56f3Q5O3OjsKFagUSqromiH0xTKTfro0zqJZN4ZB-FJLM3jERMigPXiOkfw-4/exec';

const DEFAULT_SUBJECTS = ["Thafseer", "Hadith", "Fiqh", "U :FIQH", "Aqidah", "Balagha", "Logic", "English", "Adab", "Urdu", "Social Science", "Thamadun", "Specialization", "Hifz"];
const DEFAULT_CLASSES = ["QH1", "AL1", "FC1", "QH2", "AL2", "FC2", "QLA3", "HFC3"];
const GRADES = ["1", "2", "3"];
const DEPARTMENTS = ["QURAN", "LANGUAGE", "AQIDAH", "HADITH", "FIQH", "CIVIL"];
const MADHABS = ["Hanafi", "Shafi", "General"];

const CCE_LEVELS = { "Level 1": "15", "Level 2": "20", "Level 3": "25", "Level 4": "40" };

const parseCSVLine = (str) => {
  let arr = [];
  let quote = false;
  let current = '';
  for (let i = 0; i < str.length; i++) {
    let char = str[i];
    if (char === '"') quote = !quote;
    else if (char === ',' && !quote) { arr.push(current); current = ''; }
    else current += char;
  }
  arr.push(current);
  return arr;
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const styles = {
  card: { background: '#ffffff', padding: '24px', borderRadius: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: '1px solid #f1f5f9', marginBottom: '24px', boxSizing: 'border-box' },
  input: { width: '100%', padding: '12px 16px', borderRadius: '8px', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', color: '#0f172a', fontSize: '15px', outline: 'none', boxSizing: 'border-box' },
  label: { display: 'block', fontSize: '14px', fontWeight: '600', color: '#334155', marginBottom: '8px' },
  buttonPrimary: { padding: '12px 24px', background: '#2563eb', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '15px' },
  buttonSuccess: { padding: '14px 24px', background: '#10b981', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '16px', width: '100%', marginTop: '10px' },
  buttonWarning: { padding: '14px 24px', background: '#f59e0b', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '16px', width: '100%', marginTop: '10px' },
  buttonDanger: { padding: '8px 14px', background: '#fee2e2', color: '#ef4444', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' },
  sectionTitle: { margin: '0 0 20px 0', fontSize: '20px', color: '#0f172a', fontWeight: '700', borderBottom: '2px solid #f1f5f9', paddingBottom: '12px' },
  badge: { display: 'inline-block', padding: '4px 8px', borderRadius: '6px', fontSize: '12px', fontWeight: '700' },
  filterSelect: { padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none', fontSize: '13px', backgroundColor: '#ffffff', color: '#0f172a', fontWeight: '600', cursor: 'pointer' }
};

const sortStudentsByDepartment = (studentsList, classNameAlias) => {
  const classLower = String(classNameAlias || '').toLowerCase();
  let deptOrder = [];
  let classOrder = [];

  if (classLower.includes('qhf')) deptOrder = ['QURAN', 'HADITH', 'FIQH'];
  else if (classLower.includes('alc')) deptOrder = ['AQIDAH', 'LANGUAGE', 'CIVIL'];
  else if (classLower.includes('m10') || classLower.includes('u10')) {
    classOrder = ['qla3', 'hfc3'];
    deptOrder = ['QURAN', 'LANGUAGE', 'AQIDAH', 'HADITH', 'FIQH', 'CIVIL'];
  } else if (classLower.includes('fcl')) deptOrder = ['FIQH', 'CIVIL', 'LANGUAGE'];
  else if (classLower.includes('qha')) deptOrder = ['QURAN', 'HADITH', 'AQIDAH'];
  else if (classLower.includes('u8') || classLower.includes('u9')) {
    classOrder = ['qh', 'fc', 'al'];
    deptOrder = ['QURAN', 'HADITH', 'FIQH', 'CIVIL', 'AQIDAH', 'LANGUAGE'];
  }

  if (deptOrder.length === 0 && classOrder.length === 0) {
    return [...studentsList].sort((a, b) => (Number(a.rollNo) || 999) - (Number(b.rollNo) || 999));
  }

  return [...studentsList].sort((a, b) => {
    if (classOrder.length > 0) {
      const aClasses = (a.classes || [a.className] || []).map(c => String(c).toLowerCase());
      const bClasses = (b.classes || [b.className] || []).map(c => String(c).toLowerCase());
      let classIndexA = 999, classIndexB = 999;
      classOrder.forEach((prefix, i) => {
        if (classIndexA === 999 && aClasses.some(c => c.includes(prefix))) classIndexA = i;
        if (classIndexB === 999 && bClasses.some(c => c.includes(prefix))) classIndexB = i;
      });
      if (classIndexA !== classIndexB) return classIndexA - classIndexB;
    }

    if (deptOrder.length > 0) {
      const deptA = String(a.department || '').toUpperCase();
      const deptB = String(b.department || '').toUpperCase();
      let indexA = deptOrder.indexOf(deptA);
      let indexB = deptOrder.indexOf(deptB);
      if (indexA === -1) indexA = 999;
      if (indexB === -1) indexB = 999;
      if (indexA !== indexB) return indexA - indexB;
    }

    return (Number(a.rollNo) || 999) - (Number(b.rollNo) || 999);
  });
};

function TeacherPasswordSettings() {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    if (newPassword.length < 6) return setStatus('Password must be at least 6 characters.');
    if (newPassword !== confirmPassword) return setStatus('Passwords do not match.');
    setLoading(true);
    setStatus('');
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("No active user session found. Please log in again.");
      await updatePassword(user, newPassword);
      setStatus('Password updated successfully!');
      setNewPassword(''); setConfirmPassword('');
    } catch (err) {
      if (err.code === 'auth/requires-recent-login') {
        setStatus('For security, please log out and log back in before changing your password.');
      } else {
        setStatus('Error: ' + err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ ...styles.card, maxWidth: '450px', margin: '0 auto' }}>
      <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', color: '#0f172a' }}>🔒 Change Your Password</h3>
      <p style={{ margin: '0 0 20px 0', fontSize: '14px', color: '#64748b' }}>Update your account password. You will use this new password the next time you log in.</p>
      <form onSubmit={handlePasswordChange} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div><label style={styles.label}>New Password</label><input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required style={styles.input} /></div>
        <div><label style={styles.label}>Confirm New Password</label><input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required style={styles.input} /></div>
        <button type="submit" disabled={loading} style={styles.buttonPrimary}>{loading ? 'Updating...' : 'Update Password'}</button>
      </form>
      {status && <div style={{ marginTop: '16px', padding: '12px', borderRadius: '8px', fontSize: '14px', fontWeight: '600', backgroundColor: status.includes('Error') ? '#fee2e2' : '#d1fae5', color: status.includes('Error') ? '#ef4444' : '#10b981' }}>{status}</div>}
    </div>
  );
}

// ==========================================
// 🌟 FULLY UPGRADED TEACHER PORTAL VIEW
// ==========================================
function TeacherPortalView({ loggedInTeacher, onLogout }) {
  // 🌟 CRASH FIX: Ensure enrollments is always an array, even if the teacher has none yet.
  const teacherEnrollments = loggedInTeacher?.enrollments || [];

  const [activeView, setActiveView] = useState('marks');
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState(teacherEnrollments[0]?.id || '');
  const [cceLevel, setCceLevel] = useState('Level 1');

  // Failsafe for CCE_LEVELS if it's defined globally outside
  const assessmentMaxMark = typeof CCE_LEVELS !== 'undefined' ? CCE_LEVELS[cceLevel] : '15';

  const [allStudentsCache, setAllStudentsCache] = useState([]);
  const [classStudents, setClassStudents] = useState([]);

  const [studentMarks, setStudentMarks] = useState({});
  const [statusMsg, setStatusMsg] = useState('');
  const [weeklyReminder, setWeeklyReminder] = useState(null);
  const [reminderChecklist, setReminderChecklist] = useState([]);

  useEffect(() => {
    async function fetchReminderAndChecklist() {
      try {
        const snap = await getDoc(doc(db, 'systemCache', 'activeReminder'));
        if (snap.exists() && snap.data().active) {
          const reminderData = snap.data();
          setWeeklyReminder(reminderData);

          if (allStudentsCache.length > 0) {
            const checklist = [];

            // Handles old single-level fallback just in case
            let configs = reminderData.targetConfigs;
            if (!configs && reminderData.targetSubjects) {
              configs = {};
              reminderData.targetSubjects.forEach(s => configs[s] = reminderData.level || "15");
            }

            for (const env of teacherEnrollments) {
              const exactSubject = (env.alias?.toUpperCase().includes('U :FIQH') || env.subject?.toUpperCase().includes('U :FIQH')) ? 'U :FIQH' : (env.subject || '');

              const actUp = exactSubject.toUpperCase();
              const matchingSubKey = Object.keys(configs || {}).find(k => k.toUpperCase() === actUp);

              // Skip if this specific subject isn't active this week
              if (!matchingSubKey) continue;

              const requiredLevel = configs[matchingSubKey];

              const matchedStudents = allStudentsCache.filter(student => env.studentIds && env.studentIds.includes(student.regNo));
              if (matchedStudents.length === 0) continue;

              let missingCount = 0;
              const markPromises = matchedStudents.map(st => getDoc(doc(db, 'marks', st.regNo)));
              const markDocs = await Promise.all(markPromises);

              markDocs.forEach(docSnap => {
                let hasMark = false;
                if (docSnap.exists()) {
                  const mData = docSnap.data();
                  const foundKey = Object.keys(mData).find(k => {
                    if (actUp.includes('U :FIQH') || actUp.includes('U:FIQH')) return k.trim().toUpperCase().includes('U :FIQH') || k.trim().toUpperCase().includes('U:FIQH');
                    if (actUp === 'FIQH') return k.trim().toUpperCase() === 'FIQH';
                    return k.trim().toUpperCase() === actUp;
                  });
                  // Match against the dynamically required level
                  if (foundKey && mData[foundKey] && mData[foundKey][requiredLevel] !== undefined && mData[foundKey][requiredLevel] !== '') {
                    hasMark = true;
                  }
                }
                if (!hasMark) missingCount++;
              });

              checklist.push({
                alias: env.alias || env.subject,
                targetLevel: requiredLevel, // Store specific level for UI
                missing: missingCount,
                entered: matchedStudents.length - missingCount,
                total: matchedStudents.length
              });
            }
            setReminderChecklist(checklist);
          }
        } else {
          setWeeklyReminder(null);
        }
      } catch (error) {
        console.error("Reminder fetch error:", error);
      }
    }
    fetchReminderAndChecklist();
  }, [loggedInTeacher, allStudentsCache, studentMarks, teacherEnrollments]);

  useEffect(() => {
    async function fetchStudents() {
      try {
        const sSnap = await getDocs(collection(db, 'students'));
        const sData = [];
        sSnap.forEach((doc) => sData.push(doc.data()));
        setAllStudentsCache(sData);
      } catch (error) {
        console.error("Student fetch error:", error);
      }
    }
    fetchStudents();
  }, []);

  useEffect(() => {
    if (!selectedEnrollmentId || allStudentsCache.length === 0) return;
    // 🌟 Use safe teacherEnrollments array
    const currentEnrollment = teacherEnrollments.find(e => e.id === selectedEnrollmentId);
    if (!currentEnrollment) return;

    const envAliasLower = String(currentEnrollment.alias || '').trim().toLowerCase();
    const envLang = (currentEnrollment.langTag || '').toLowerCase();

    const matchedStudents = allStudentsCache.filter(student => {
      const studentClassesLower = (student.classes || []).map(c => String(c).trim().toLowerCase());
      const isUrdu = String(student.adNo || '').toUpperCase().startsWith('U');

      // 1. Check if manually assigned
      if (currentEnrollment.studentIds && currentEnrollment.studentIds.length > 0) {
        const savedIds = currentEnrollment.studentIds.map(id => String(id).trim());
        if (savedIds.includes(student.regNo) || savedIds.includes(student.adNo)) return true;
      }

      // 2. Auto-match by class and language rules
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
    });

    // Handle sort formatting safely
    const targetClassName = currentEnrollment.alias || `Grade ${currentEnrollment.grade || ''} ${currentEnrollment.subject || ''}`;
    // Assuming sortStudentsByDepartment is defined globally in your file
    const sortedStudents = typeof sortStudentsByDepartment === 'function' ? sortStudentsByDepartment(matchedStudents, targetClassName) : matchedStudents;

    setClassStudents(sortedStudents);
  }, [selectedEnrollmentId, allStudentsCache, teacherEnrollments]);

  useEffect(() => {
    if (!selectedEnrollmentId || classStudents.length === 0) return;
    // 🌟 Use safe teacherEnrollments array
    const currentEnrollment = teacherEnrollments.find(e => e.id === selectedEnrollmentId);
    if (!currentEnrollment) return;

    async function fetchExistingMarks() {
      try {
        let newMarks = {};
        const markPromises = classStudents.map(student => getDoc(doc(db, 'marks', student.regNo)));
        const markDocs = await Promise.all(markPromises);

        markDocs.forEach((docSnap, index) => {
          if (docSnap.exists()) {
            const mData = docSnap.data();
            const studentRegNo = classStudents[index].regNo;
            if (mData[currentEnrollment.subject]) {
              newMarks[studentRegNo] = mData[currentEnrollment.subject];
            } else {
              newMarks[studentRegNo] = {};
            }
          }
        });
        setStudentMarks(newMarks);
      } catch (err) { console.error("Error loading marks", err); }
    }
    fetchExistingMarks();
  }, [selectedEnrollmentId, classStudents, teacherEnrollments]);

  const handleMarkChange = (studentRegNo, value) => {
    if (value === '' || /^\d*(\.\d{0,2})?$/.test(value)) {
      const updatedMarks = {
        ...studentMarks,
        [studentRegNo]: {
          ...(studentMarks[studentRegNo] || {}),
          [assessmentMaxMark]: value
        }
      };
      setStudentMarks(updatedMarks);
      if (selectedEnrollmentId) {
        localStorage.setItem(`draft_marks_${selectedEnrollmentId}`, JSON.stringify(updatedMarks));
      }
    }
  };

  const handleKeyDown = (e, currentIndex) => {
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault();
      const nextInput = document.querySelector(`input[data-index="${currentIndex + 1}"]`);
      if (nextInput) nextInput.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      // 🌟 SYNTAX ERROR FIX: Cleaned up the broken newline issue
      const prevInput = document.querySelector(`input[data-index="${currentIndex - 1}"]`);
      if (prevInput) prevInput.focus();
    }
  };

  useEffect(() => {
    if (selectedEnrollmentId) {
      const savedDraft = localStorage.getItem(`draft_marks_${selectedEnrollmentId}`);
      if (savedDraft) setStudentMarks(JSON.parse(savedDraft));
    }
  }, [selectedEnrollmentId]);

  const handleDownloadMarksTemplate = () => {
    if (classStudents.length === 0) return alert('No students found in this class to generate a template.');
    let csvContent = "data:text/csv;charset=utf-8,Ad.No,Student Name,Marks (Max " + assessmentMaxMark + ")\n";
    classStudents.forEach(student => { csvContent += `${student.adNo},"${student.firstName}",\n`; });
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    // 🌟 Use safe teacherEnrollments array
    const currentEnrollment = teacherEnrollments.find(e => e.id === selectedEnrollmentId);
    const safeTitle = (currentEnrollment?.alias || 'Class').replace(/[^a-zA-Z0-9]/g, '_');
    link.setAttribute("download", `${safeTitle}_${cceLevel.replace(' ', '')}_Marks.csv`);
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const handleUniversalUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    const fileExtension = file.name.split('.').pop().toLowerCase();

    const processSheetData = (sheetData) => {
      const newMarks = { ...studentMarks };
      let updatedCount = 0, errorCount = 0;
      const maxAllowed = Number(assessmentMaxMark);

      sheetData.forEach((row) => {
        const rawAdNo = String(row['Ad.No'] || row['AdNo'] || row['AdmissionNo'] || row['RegNo'] || '').trim();
        const keys = Object.keys(row);
        const marksStr = String(row['Marks'] || row['Mark'] || row['Score'] || row[keys[keys.length - 1]] || '').trim();

        if (rawAdNo && marksStr !== '') {
          const markVal = parseFloat(marksStr);
          const matchedStudent = classStudents.find(s => String(s.adNo).trim() === rawAdNo);
          if (matchedStudent) {
            if (!isNaN(markVal) && markVal <= maxAllowed && markVal >= 0) {
              newMarks[matchedStudent.regNo] = {
                ...(newMarks[matchedStudent.regNo] || {}),
                [assessmentMaxMark]: marksStr
              };
              updatedCount++;
            } else { errorCount++; }
          }
        }
      });
      setStudentMarks(newMarks);
      alert(`Imported marks for ${updatedCount} students (Skipped ${errorCount} invalid). Review table and click save.`);
    };

    // Make sure XLSX is defined in your environment (e.g. imported at the top of your file)
    if (fileExtension === 'csv' || fileExtension === 'txt') {
      reader.onload = (event) => {
        const workbook = XLSX.read(event.target.result, { type: 'string' });
        processSheetData(XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]));
      };
      reader.readAsText(file);
    } else {
      reader.onload = (event) => {
        const workbook = XLSX.read(new Uint8Array(event.target.result), { type: 'array' });
        processSheetData(XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]));
      };
      reader.readAsArrayBuffer(file);
    }
    e.target.value = null;
  };

  const handleBulkSubmit = async (e) => {
    e.preventDefault();
    let marksPayload = [];
    // 🌟 Use safe teacherEnrollments array
    const currentEnrollment = teacherEnrollments.find(e => e.id === selectedEnrollmentId);
    if (!currentEnrollment) return alert("Please select a valid enrollment before saving.");

    const maxNumber = Number(assessmentMaxMark);

    const rawSub = (currentEnrollment.subject || '').trim();
    const rawAlias = (currentEnrollment.alias || '').trim();
    let finalSubjectKey = rawSub;
    if (rawAlias.toUpperCase().includes('U :FIQH') || rawSub.toUpperCase().includes('U :FIQH')) {
      finalSubjectKey = 'U :FIQH';
    } else if (rawSub.toUpperCase() === 'MANTIQ') {
      finalSubjectKey = 'Logic';
    }

    setStatusMsg('Syncing marks...');
    const firestorePromises = [];
    for (let student of classStudents) {
      let val = studentMarks[student.regNo]?.[assessmentMaxMark];
      if (val !== undefined && val !== '') {
        if (parseFloat(val) > maxNumber) return alert(`Marks for ${student.firstName} exceed limit!`);
        marksPayload.push({ studentId: student.regNo, subject: finalSubjectKey, maxMarks: assessmentMaxMark, marksObtained: val });
        firestorePromises.push(setDoc(doc(db, 'marks', student.regNo), { [finalSubjectKey]: { [assessmentMaxMark]: Number(val) } }, { merge: true }));
      }
    }

    try {
      await Promise.all(firestorePromises);

      // Make sure WEB_APP_URL is defined in your file constants
      if (typeof WEB_APP_URL !== 'undefined') {
        const res = await fetch(WEB_APP_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain;charset=utf-8',
          },
          body: JSON.stringify({ marks: marksPayload })
        });

        const result = await res.json();

        if (result.status === 'success') {
          setStatusMsg('Marks saved to database and Google Sheets successfully!');
          localStorage.removeItem(`draft_marks_${selectedEnrollmentId}`);
        } else {
          setStatusMsg('Firebase updated, but Sheets backup error: ' + result.message);
        }
      } else {
        setStatusMsg('Marks saved to database successfully!');
        localStorage.removeItem(`draft_marks_${selectedEnrollmentId}`);
      }
    } catch (err) {
      console.error("Submission Error:", err);
      setStatusMsg('Marks saved to database, but network prevented Sheets sync.');
    }
  };

  const validMarks = classStudents.map(s => studentMarks[s.regNo]?.[assessmentMaxMark]).filter(v => v !== undefined && v !== '').map(v => parseFloat(v)).filter(v => !isNaN(v));
  const highestScore = validMarks.length > 0 ? Math.max(...validMarks) : 0;
  const classAverage = validMarks.length > 0 ? (validMarks.reduce((a, b) => a + b, 0) / validMarks.length).toFixed(1) : 0;
  const passPercentage = validMarks.length > 0 ? ((validMarks.filter(m => m >= Number(assessmentMaxMark) * 0.4).length / validMarks.length) * 100).toFixed(0) : 0;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', background: '#ffffff', padding: '20px 24px', borderRadius: '16px', border: '1px solid #e2e8f0', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ margin: '0 0 4px 0', fontSize: '24px', fontWeight: '800', color: '#0f172a' }}>Teacher Portal</h1>
          <p style={{ margin: 0, color: '#64748b', fontSize: '15px' }}>Welcome, <strong>{loggedInTeacher?.fullName || 'Teacher'}</strong></p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button onClick={() => setActiveView(activeView === 'marks' ? 'settings' : 'marks')} style={{ padding: '10px 16px', background: '#f8fafc', color: '#334155', border: '1px solid #cbd5e1', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '14px' }}>
            {activeView === 'marks' ? '⚙️ Settings' : '⬅ Back to Marks'}
          </button>
          {/* Ensure styles.buttonDanger is defined globally in your file */}
          <button onClick={onLogout} style={typeof styles !== 'undefined' ? styles.buttonDanger : { padding: '10px 20px', background: '#fee2e2', color: '#ef4444', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer' }}>Logout</button>
        </div>
      </div>

      {weeklyReminder && reminderChecklist.length > 0 && (
        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', padding: '20px', borderRadius: '12px', marginBottom: '24px', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 4px 6px rgba(0,0,0,0.02)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <span style={{ fontSize: '28px' }}>📅</span>
            <div>
              <span style={{ display: 'inline-block', background: '#dbeafe', color: '#1e40af', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '800', marginBottom: '6px' }}>
                {weeklyReminder.weekName || 'This Week'}
              </span>
              <h4 style={{ margin: '0 0 4px 0', color: '#1e40af', fontSize: '16px', fontWeight: '800' }}>
                Action Required: Complete Mark Entries
              </h4>
              <p style={{ margin: 0, color: '#1e3a8a', fontSize: '14px', fontWeight: '600' }}>{weeklyReminder.message}</p>
            </div>
          </div>

          <div style={{ marginTop: '8px', background: '#ffffff', padding: '16px', borderRadius: '8px', border: '1px solid #dbeafe' }}>
            <h5 style={{ margin: '0 0 12px 0', color: '#0f172a', fontSize: '14px', fontWeight: '800' }}>Your Assigned Tasks:</h5>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
              {reminderChecklist.map((item, idx) => {
                const isDone = item.missing === 0;
                const inProgress = item.entered > 0 && item.missing > 0;

                let color = '#dc2626'; // Red (Pending)
                let icon = '❌';
                if (isDone) { color = '#047857'; icon = '✅'; } // Green (Done)
                else if (inProgress) { color = '#d97706'; icon = '⏳'; } // Yellow (In Progress)
                return (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: '700', color: color }}>
                    {icon} {item.alias} <span style={{ color: '#64748b', fontSize: '12px', marginLeft: '6px' }}>(/ {item.targetLevel} max)</span>
                    {!isDone && <span style={{ fontSize: '12px', fontWeight: '600', color: '#ef4444' }}>({item.missing} pending)</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Make sure TeacherPasswordSettings is imported or defined globally */}
      {activeView === 'settings' ? (typeof TeacherPasswordSettings !== 'undefined' ? <TeacherPasswordSettings /> : <div>Settings component missing</div>) : (
        <>
          {/* Ensure styles.card is defined globally in your file */}
          <div style={typeof styles !== 'undefined' ? styles.card : { background: '#ffffff', padding: '32px', borderRadius: '16px', border: '1px solid #f1f5f9', marginBottom: '24px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '20px' }}>
              <div>
                <label style={typeof styles !== 'undefined' ? styles.label : { display: 'block', fontSize: '14px', fontWeight: '600', color: '#334155', marginBottom: '8px' }}>Select Assigned Subject:</label>
                <select value={selectedEnrollmentId} onChange={(e) => setSelectedEnrollmentId(e.target.value)} style={typeof styles !== 'undefined' ? { ...styles.input, cursor: 'pointer' } : { width: '100%', padding: '12px 16px', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
                  {teacherEnrollments.map(env => (
                    <option key={env.id} value={env.id}>{env.alias || `Grade ${env.grade} ${env.subject}`} ({env.langTag || 'Gen'})</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={typeof styles !== 'undefined' ? styles.label : { display: 'block', fontSize: '14px', fontWeight: '600', color: '#334155', marginBottom: '8px' }}>Select Task Level:</label>
                {/* Make sure CCE_LEVELS is globally available */}
                <select value={cceLevel} onChange={(e) => setCceLevel(e.target.value)} style={typeof styles !== 'undefined' ? { ...styles.input, cursor: 'pointer' } : { width: '100%', padding: '12px 16px', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
                  {typeof CCE_LEVELS !== 'undefined' && Object.keys(CCE_LEVELS).map(level => <option key={level} value={level}>{level} (Max {CCE_LEVELS[level]} Marks)</option>)}
                </select>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '20px' }}>
            <div style={{ background: '#ffffff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
              <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 'bold' }}>CLASS AVERAGE</span>
              <div style={{ fontSize: '22px', color: '#0f172a', fontWeight: '800', marginTop: '4px' }}>{classAverage} / {assessmentMaxMark}</div>
            </div>
            <div style={{ background: '#ffffff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
              <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 'bold' }}>HIGHEST SCORE</span>
              <div style={{ fontSize: '22px', fontWeight: '800', color: '#10b981', marginTop: '4px' }}>{highestScore} / {assessmentMaxMark}</div>
            </div>
            <div style={{ background: '#ffffff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
              <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 'bold' }}>PASSING RATE</span>
              <div style={{ fontSize: '22px', fontWeight: '800', color: '#2563eb', marginTop: '4px' }}>{passPercentage}%</div>
            </div>
          </div>

          <form onSubmit={handleBulkSubmit} style={typeof styles !== 'undefined' ? styles.card : { background: '#ffffff', padding: '32px', borderRadius: '16px', border: '1px solid #f1f5f9', marginBottom: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', borderBottom: '2px solid #f1f5f9', paddingBottom: '16px', marginBottom: '24px', gap: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '19px', color: '#0f172a', fontWeight: '800' }}>Enrolled Students ({classStudents.length})</h3>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <button type="button" onClick={handleDownloadMarksTemplate} style={{ padding: '10px 16px', background: '#f8fafc', color: '#334155', border: '1px solid #cbd5e1', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '14px' }}>📥 Download Template</button>
                <label style={{ padding: '10px 16px', background: '#0284c7', color: '#ffffff', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '14px' }}>📂 Upload Spreadsheet<input type="file" accept=".csv, .xlsx" onChange={handleUniversalUpload} style={{ display: 'none' }} /></label>
              </div>
            </div>

            {classStudents.length === 0 ? (
              <div style={{ padding: '40px', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '12px', textAlign: 'center', color: '#64748b', fontSize: '15px' }}>No students assigned to this subject.</div>
            ) : (
              <div style={{ width: '100%', overflowX: 'auto', marginBottom: '24px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '15px', minWidth: '850px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #cbd5e1' }}>
                      <th style={{ padding: '14px 16px', width: '50px', color: '#0f172a', fontWeight: '800' }}>Sn</th>
                      <th style={{ padding: '14px 16px', width: '90px', color: '#0f172a', fontWeight: '800' }}>Ad.No</th>
                      <th style={{ padding: '14px 16px', width: '200px', color: '#0f172a', fontWeight: '800' }}>Student Name</th>
                      <th style={{ padding: '14px 16px', background: assessmentMaxMark === '15' ? '#e0f2fe' : 'transparent', color: assessmentMaxMark === '15' ? '#0369a1' : '#0f172a', fontWeight: '800' }}>Level 1 (15)</th>
                      <th style={{ padding: '14px 16px', background: assessmentMaxMark === '20' ? '#e0f2fe' : 'transparent', color: assessmentMaxMark === '20' ? '#0369a1' : '#0f172a', fontWeight: '800' }}>Level 2 (20)</th>
                      <th style={{ padding: '14px 16px', background: assessmentMaxMark === '25' ? '#e0f2fe' : 'transparent', color: assessmentMaxMark === '25' ? '#0369a1' : '#0f172a', fontWeight: '800' }}>Level 3 (25)</th>
                      <th style={{ padding: '14px 16px', background: assessmentMaxMark === '40' ? '#e0f2fe' : 'transparent', color: assessmentMaxMark === '40' ? '#0369a1' : '#0f172a', fontWeight: '800' }}>Level 4 (40)</th>
                      <th style={{ padding: '14px 16px', color: '#1e40af', fontWeight: '800' }}>Total (/100)</th>
                      <th style={{ padding: '14px 16px', color: '#047857', fontWeight: '800' }}>Scaled (/30)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {classStudents.map((student, index) => {
                      const marks = studentMarks[student.regNo] || {};
                      const m1 = parseFloat(marks['15']) || 0;
                      const m2 = parseFloat(marks['20']) || 0;
                      const m3 = parseFloat(marks['25']) || 0;
                      const m4 = parseFloat(marks['40']) || 0;
                      const total100 = m1 + m2 + m3 + m4;
                      const scaled30 = total100 > 0 ? ((total100 / 100) * 30).toFixed(1) : '-';

                      return (
                        <tr key={student.regNo} style={{ borderBottom: '1px solid #e2e8f0', background: '#ffffff' }}>
                          <td style={{ padding: '14px 16px', fontWeight: '800', color: '#0f172a' }}>{student.rollNo || '-'}</td>
                          <td style={{ padding: '14px 16px', fontWeight: '800', color: '#0f172a' }}>{student.adNo}</td>
                          <td style={{ padding: '16px', color: '#0f172a', fontWeight: '800', fontSize: '15px' }}>{student.firstName}</td>

                          <td style={{ padding: '14px 16px', background: assessmentMaxMark === '15' ? '#f0f9ff' : 'transparent', color: '#0f172a' }}>
                            {assessmentMaxMark === '15' ? (
                              <input type="number" max="15" min="0" step="any" data-index={index}
                                value={marks['15'] ?? ''}
                                onChange={(e) => handleMarkChange(student.regNo, e.target.value)}
                                onKeyDown={(e) => handleKeyDown(e, index)}
                                placeholder="/ 15"
                                style={{ padding: '8px 12px', width: '80px', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none', fontSize: '15px', backgroundColor: '#ffffff', color: '#0f172a', fontWeight: '700' }} />
                            ) : (<span style={{ fontWeight: '700' }}>{marks['15'] || '-'}</span>)}
                          </td>

                          <td style={{ padding: '14px 16px', background: assessmentMaxMark === '20' ? '#f0f9ff' : 'transparent', color: '#0f172a' }}>
                            {assessmentMaxMark === '20' ? (
                              <input type="number" max="20" min="0" step="any" data-index={index}
                                value={marks['20'] ?? ''}
                                onChange={(e) => handleMarkChange(student.regNo, e.target.value)}
                                onKeyDown={(e) => handleKeyDown(e, index)}
                                placeholder="/ 20"
                                style={{ padding: '8px 12px', width: '80px', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none', fontSize: '15px', backgroundColor: '#ffffff', color: '#0f172a', fontWeight: '700' }} />
                            ) : (<span style={{ fontWeight: '700' }}>{marks['20'] || '-'}</span>)}
                          </td>

                          <td style={{ padding: '14px 16px', background: assessmentMaxMark === '25' ? '#f0f9ff' : 'transparent', color: '#0f172a' }}>
                            {assessmentMaxMark === '25' ? (
                              <input type="number" max="25" min="0" step="any" data-index={index}
                                value={marks['25'] ?? ''}
                                onChange={(e) => handleMarkChange(student.regNo, e.target.value)}
                                onKeyDown={(e) => handleKeyDown(e, index)}
                                placeholder="/ 25"
                                style={{ padding: '8px 12px', width: '80px', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none', fontSize: '15px', backgroundColor: '#ffffff', color: '#0f172a', fontWeight: '700' }} />
                            ) : (<span style={{ fontWeight: '700' }}>{marks['25'] || '-'}</span>)}
                          </td>

                          <td style={{ padding: '14px 16px', background: assessmentMaxMark === '40' ? '#f0f9ff' : 'transparent', color: '#0f172a' }}>
                            {assessmentMaxMark === '40' ? (
                              <input type="number" max="40" min="0" step="any" data-index={index}
                                value={marks['40'] ?? ''}
                                onChange={(e) => handleMarkChange(student.regNo, e.target.value)}
                                onKeyDown={(e) => handleKeyDown(e, index)}
                                placeholder="/ 40"
                                style={{ padding: '8px 12px', width: '80px', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none', fontSize: '15px', backgroundColor: '#ffffff', color: '#0f172a', fontWeight: '700' }} />
                            ) : (<span style={{ fontWeight: '700' }}>{marks['40'] || '-'}</span>)}
                          </td>

                          <td style={{ padding: '14px 16px' }}>
                            {total100 > 0 ? <span style={{ background: '#dbeafe', color: '#1e40af', padding: '6px 10px', borderRadius: '6px', fontWeight: '800' }}>{total100}</span> : '-'}
                          </td>
                          <td style={{ padding: '14px 16px' }}>
                            {scaled30 !== '-' ? <span style={{ background: '#d1fae5', color: '#047857', padding: '6px 10px', borderRadius: '6px', fontWeight: '800' }}>{scaled30}</span> : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {/* Make sure styles.buttonSuccess is defined globally in your file */}
            <button type="submit" disabled={classStudents.length === 0} style={typeof styles !== 'undefined' ? styles.buttonSuccess : { background: '#10b981', color: '#ffffff', border: 'none', padding: '12px 24px', borderRadius: '10px', fontWeight: '700', cursor: 'pointer' }}>Save / Update All Marks</button>
          </form>
          {statusMsg && <div style={{ padding: '16px', background: '#ecfdf5', borderRadius: '8px', color: '#065f46', fontWeight: '700', textAlign: 'center' }}>{statusMsg}</div>}
        </>
      )}
    </div>
  );
}

// ==========================================
// ADMIN COMPONENTS
// ==========================================
// ==========================================
// 🌟 TEACHER MANAGER (With Advanced Student Assignment)
// ==========================================
function TeacherManager() {
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [enrollments, setEnrollments] = useState([]);
  const [registeredTeachers, setRegisteredTeachers] = useState([]);

  // 🌟 New States for Student Assignment
  const [allStudents, setAllStudents] = useState([]);
  const [assigningEnvId, setAssigningEnvId] = useState(null);
  const [assignFilterClasses, setAssignFilterClasses] = useState([]);
  const [assignFilterDepts, setAssignFilterDepts] = useState([]);
  const [assignFilterMadhab, setAssignFilterMadhab] = useState('All');
  const [assignSearch, setAssignSearch] = useState('');
  const [assignFilterGrade, setAssignFilterGrade] = useState('All');
  const [assignFilterLangs, setAssignFilterLangs] = useState([]);

  const [isEditing, setIsEditing] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const [envGrade, setEnvGrade] = useState('1');
  const [envSubject, setEnvSubject] = useState(DEFAULT_SUBJECTS[0]);
  const [envLangTag, setEnvLangTag] = useState('');

  const fetchInitialData = async () => {
    try {
      const [tSnap, sSnap] = await Promise.all([
        getDocs(collection(db, 'teachers')),
        getDocs(collection(db, 'students'))
      ]);

      const teachersData = [];
      tSnap.forEach(doc => teachersData.push(doc.data()));
      setRegisteredTeachers(teachersData);

      const studentsData = [];
      sSnap.forEach(doc => studentsData.push({ id: doc.id, ...doc.data() }));
      // Sort students numerically by roll number for a cleaner list
      studentsData.sort((a, b) => (Number(a.rollNo) || 999) - (Number(b.rollNo) || 999));
      setAllStudents(studentsData);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => { fetchInitialData(); }, []);

  const handleAddEnrollment = () => {
    if (!envSubject) return alert("Please select a subject.");
    const generatedAlias = `Grade ${envGrade} ${envSubject}`;
    const newEnv = {
      id: Date.now().toString(),
      grade: envGrade,
      subject: envSubject,
      alias: generatedAlias,
      langTag: envLangTag,
      studentIds: [] // Initializes empty array for specific assignments
    };
    setEnrollments([...enrollments, newEnv]);
    setEnvLangTag('');
  };

  const handleRemoveEnrollment = (id) => setEnrollments(enrollments.filter(env => env.id !== id));

  const handleAddOrUpdateTeacher = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setStatusMsg(isEditing ? 'Updating teacher profile...' : 'Registering teacher securely...');
    const safeUsername = username.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
    const fakeEmail = `${safeUsername}@school.com`;

    try {
      if (!isEditing) {
        await createUserWithEmailAndPassword(auth, fakeEmail, password);
      }
      await setDoc(doc(db, 'teachers', safeUsername), {
        fullName,
        username: safeUsername,
        enrollments
      }, { merge: true });

      setIsLoading(false);
      setStatusMsg(isEditing ? 'Teacher updated successfully!' : 'Teacher registered successfully!');
      fetchInitialData();
      resetForm();
    } catch (err) {
      setIsLoading(false);
      setStatusMsg('Error: ' + err.message);
    }
  };

  const handleEditClick = (teacher) => {
    setIsEditing(true);
    setFullName(teacher.fullName);
    setUsername(teacher.username);
    setEnrollments(teacher.enrollments || []);
    setPassword('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteClick = async (teacherUsername) => {
    if (window.confirm(`Are you sure you want to delete ${teacherUsername}?`)) {
      try {
        await deleteDoc(doc(db, 'teachers', teacherUsername));
        fetchInitialData();
      } catch (err) {
        alert("Failed to delete.");
      }
    }
  };

  const resetForm = () => {
    setIsEditing(false); setFullName(''); setUsername(''); setPassword('');
    setEnrollments([]); setStatusMsg(''); setAssigningEnvId(null);
  };

  // 🌟 ADVANCED STUDENT ASSIGNMENT LOGIC
  const filteredStudentsForAssign = allStudents.filter(s => {
    // Multi-select check for Class
    if (assignFilterClasses.length > 0 && !assignFilterClasses.some(c => (s.classes || []).includes(c))) return false;

    // Multi-select check for Department
    if (assignFilterDepts.length > 0 && !assignFilterDepts.includes((s.department || 'GENERAL').toUpperCase())) return false;
    if (assignFilterMadhab !== 'All' && (s.madhab || 'General') !== assignFilterMadhab) return false;
    // Multi-select check for Language (Urdu / Non-Urdu)
    if (assignFilterLangs.length > 0) {
      const isUrdu = String(s.adNo || '').toUpperCase().startsWith('U');
      if (assignFilterLangs.includes('Urdu') && !assignFilterLangs.includes('Non-Urdu') && !isUrdu) return false;
      if (assignFilterLangs.includes('Non-Urdu') && !assignFilterLangs.includes('Urdu') && isUrdu) return false;
    }
    // Grade Filter Check
    if (assignFilterGrade !== 'All') {
      const studentLevels = (s.classes || []).map(c => {
        const match = String(c).match(/\d+/);
        return match ? match[0] : null;
      }).filter(Boolean);
      if (!studentLevels.includes(assignFilterGrade)) return false;
    }
    if (assignSearch) {
      const query = assignSearch.toLowerCase();
      const searchName = s.firstName?.toLowerCase() || '';
      const searchAdNo = s.adNo?.toLowerCase() || '';
      if (!searchName.includes(query) && !searchAdNo.includes(query)) return false;
    }
    return true;
  });

  const toggleStudentForEnv = (envId, regNo) => {
    setEnrollments(prev => prev.map(env => {
      if (env.id === envId) {
        const currentIds = env.studentIds || [];
        const newIds = currentIds.includes(regNo)
          ? currentIds.filter(id => id !== regNo)
          : [...currentIds, regNo];
        return { ...env, studentIds: newIds };
      }
      return env;
    }));
  };

  const toggleSelectAllForEnv = (envId, isSelectingAll) => {
    setEnrollments(prev => prev.map(env => {
      if (env.id === envId) {
        const currentIdsSet = new Set(env.studentIds || []);
        if (isSelectingAll) {
          filteredStudentsForAssign.forEach(s => currentIdsSet.add(s.regNo));
        } else {
          filteredStudentsForAssign.forEach(s => currentIdsSet.delete(s.regNo));
        }
        return { ...env, studentIds: Array.from(currentIdsSet) };
      }
      return env;
    }));
  };

  const updateEnvAlias = (envId, newAlias) => {
    setEnrollments(prev => prev.map(env => env.id === envId ? { ...env, alias: newAlias } : env));
  };

  return (
    <div>
      <div style={{ ...styles.card, borderLeft: isEditing ? '6px solid #f59e0b' : '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={styles.sectionTitle}>{isEditing ? `Editing Teacher: ${username}` : 'Register Teacher'}</h3>
          {isEditing && <button type="button" onClick={resetForm} style={{ padding: '8px 16px', background: '#e2e8f0', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '700' }}>Cancel</button>}
        </div>

        <form onSubmit={handleAddOrUpdateTeacher} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px' }}>
            <div><label style={styles.label}>Full Name</label><input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} required style={styles.input} /></div>
            <div><label style={styles.label}>Username</label><input type="text" value={username} onChange={(e) => setUsername(e.target.value)} disabled={isEditing} required style={{ ...styles.input, backgroundColor: isEditing ? '#f1f5f9' : '#ffffff', color: isEditing ? '#94a3b8' : '#0f172a' }} /></div>
            {!isEditing && <div><label style={styles.label}>Password (Min 6 chars)</label><input type="text" value={password} onChange={(e) => setPassword(e.target.value)} required style={styles.input} /></div>}
          </div>

          <div style={{ background: '#f8fafc', padding: '24px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
            <h4 style={{ margin: '0 0 16px 0', fontSize: '16px', color: '#0f172a', fontWeight: '800' }}>Subject Enrollments</h4>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-end', marginBottom: '24px', background: '#ffffff', padding: '16px', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
              <div style={{ flex: '1 1 120px' }}><label style={styles.label}>Grade</label><select value={envGrade} onChange={(e) => setEnvGrade(e.target.value)} style={styles.input}>{GRADES.map(g => <option key={g} value={g}>Grade {g}</option>)}</select></div>
              <div style={{ flex: '2 1 150px' }}><label style={styles.label}>Subject</label><select value={envSubject} onChange={(e) => setEnvSubject(e.target.value)} style={styles.input}>{DEFAULT_SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
              <div style={{ flex: '1 1 120px' }}><label style={styles.label}>Lang Tag</label><select value={envLangTag} onChange={(e) => setEnvLangTag(e.target.value)} style={styles.input}><option value="">General</option><option value="Urdu">Urdu</option><option value="Non-Urdu">Non-Urdu</option></select></div>
              <button type="button" onClick={handleAddEnrollment} style={{ ...styles.buttonPrimary, padding: '12px 20px', background: '#3b82f6' }}>+ Add Subject</button>
            </div>

            {enrollments.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {enrollments.map((env) => {
                  const isAssigning = assigningEnvId === env.id;
                  const studentCount = (env.studentIds || []).length;
                  const allFilteredSelected = filteredStudentsForAssign.length > 0 && filteredStudentsForAssign.every(s => (env.studentIds || []).includes(s.regNo));

                  return (
                    <div key={env.id} style={{ background: '#ffffff', borderRadius: '12px', border: '1px solid #cbd5e1', overflow: 'hidden' }}>

                      {/* Enrollment Header */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', background: isAssigning ? '#f8fafc' : '#ffffff', borderBottom: isAssigning ? '1px solid #e2e8f0' : 'none' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <h4 style={{ margin: 0, fontSize: '16px', fontWeight: '800', color: '#0f172a' }}>{env.alias || `${env.grade} ${env.subject}`}</h4>
                          <span style={{ background: '#e2e8f0', color: '#334155', padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '700' }}>{studentCount} students</span>
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button type="button" onClick={() => setAssigningEnvId(isAssigning ? null : env.id)} style={{ padding: '8px 16px', background: '#f59e0b', color: '#ffffff', border: 'none', borderRadius: '6px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}>
                            {isAssigning ? 'Close Assignment' : 'Assign Students'}
                          </button>
                          <button type="button" onClick={() => handleRemoveEnrollment(env.id)} style={{ padding: '8px 16px', background: '#fee2e2', color: '#ef4444', border: 'none', borderRadius: '6px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}>
                            Remove
                          </button>
                        </div>
                      </div>

                      {/* Advanced Assignment Dropdown */}
                      {isAssigning && (
                        <div style={{ padding: '20px', borderTop: '1px solid #e2e8f0' }}>

                          {/* Alias Input Bar */}
                          <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
                            <input type="text" value={env.alias} onChange={(e) => updateEnvAlias(env.id, e.target.value)} placeholder="Class Alias (e.g. FCL1 Balagha)" style={{ ...styles.input, flex: 1 }} />
                            <button type="button" onClick={() => updateEnvAlias(env.id, `Grade ${env.grade} ${env.subject}`)} style={{ padding: '0 20px', background: '#0284c7', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '14px' }}>
                              Auto-Fill Name
                            </button>
                          </div>

                          {/* Filters */}
                          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px', padding: '12px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                            {/* Multi-Select Classes */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                              <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#64748b' }}>Select Classes (Multiple):</span>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', maxWidth: '300px' }}>
                                {DEFAULT_CLASSES.map(c => (
                                  <label key={c} style={{ fontSize: '12px', fontWeight: '600', background: assignFilterClasses.includes(c) ? '#2563eb' : '#ffffff', color: assignFilterClasses.includes(c) ? '#ffffff' : '#334155', padding: '6px 10px', borderRadius: '20px', cursor: 'pointer', border: `1px solid ${assignFilterClasses.includes(c) ? '#2563eb' : '#cbd5e1'}` }}>
                                    <input type="checkbox" checked={assignFilterClasses.includes(c)} onChange={(e) => {
                                      if (e.target.checked) setAssignFilterClasses([...assignFilterClasses, c]);
                                      else setAssignFilterClasses(assignFilterClasses.filter(x => x !== c));
                                    }} style={{ display: 'none' }} />
                                    {c}
                                  </label>
                                ))}
                                {assignFilterClasses.length > 0 && <span onClick={() => setAssignFilterClasses([])} style={{ fontSize: '12px', color: '#ef4444', cursor: 'pointer', padding: '6px', fontWeight: 'bold' }}>Clear</span>}
                              </div>
                            </div>

                            {/* Multi-Select Departments */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', borderLeft: '1px solid #cbd5e1', paddingLeft: '12px', marginLeft: '6px' }}>
                              <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#64748b' }}>Select Depts (Multiple):</span>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', maxWidth: '300px' }}>
                                {DEPARTMENTS.map(d => (
                                  <label key={d} style={{ fontSize: '12px', fontWeight: '600', background: assignFilterDepts.includes(d) ? '#059669' : '#ffffff', color: assignFilterDepts.includes(d) ? '#ffffff' : '#334155', padding: '6px 10px', borderRadius: '20px', cursor: 'pointer', border: `1px solid ${assignFilterDepts.includes(d) ? '#059669' : '#cbd5e1'}` }}>
                                    <input type="checkbox" checked={assignFilterDepts.includes(d)} onChange={(e) => {
                                      if (e.target.checked) setAssignFilterDepts([...assignFilterDepts, d]);
                                      else setAssignFilterDepts(assignFilterDepts.filter(x => x !== d));
                                    }} style={{ display: 'none' }} />
                                    {d}
                                  </label>
                                ))}
                                {assignFilterDepts.length > 0 && <span onClick={() => setAssignFilterDepts([])} style={{ fontSize: '12px', color: '#ef4444', cursor: 'pointer', padding: '6px', fontWeight: 'bold' }}>Clear</span>}
                              </div>
                            </div>
                            {/* Multi-Select Language (Urdu/Non-Urdu) */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', borderLeft: '1px solid #cbd5e1', paddingLeft: '12px', marginLeft: '6px' }}>
                              <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#64748b' }}>Select Language:</span>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                {['Urdu', 'Non-Urdu'].map(lang => (
                                  <label key={lang} style={{ fontSize: '12px', fontWeight: '600', background: assignFilterLangs.includes(lang) ? '#8b5cf6' : '#ffffff', color: assignFilterLangs.includes(lang) ? '#ffffff' : '#334155', padding: '6px 10px', borderRadius: '20px', cursor: 'pointer', border: `1px solid ${assignFilterLangs.includes(lang) ? '#8b5cf6' : '#cbd5e1'}` }}>
                                    <input type="checkbox" checked={assignFilterLangs.includes(lang)} onChange={(e) => {
                                      if (e.target.checked) setAssignFilterLangs([...assignFilterLangs, lang]);
                                      else setAssignFilterLangs(assignFilterLangs.filter(x => x !== lang));
                                    }} style={{ display: 'none' }} />
                                    {lang}
                                  </label>
                                ))}
                                {assignFilterLangs.length > 0 && <span onClick={() => setAssignFilterLangs([])} style={{ fontSize: '12px', color: '#ef4444', cursor: 'pointer', padding: '6px', fontWeight: 'bold' }}>Clear</span>}
                              </div>
                            </div>
                            <select value={assignFilterMadhab} onChange={(e) => setAssignFilterMadhab(e.target.value)} style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px' }}>
                              <option value="All">All Madhabs</option>
                              {MADHABS.map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                            <select value={assignFilterGrade} onChange={(e) => setAssignFilterGrade(e.target.value)} style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px' }}>
                              <option value="All">All Grades</option>
                              {GRADES.map(g => <option key={g} value={g}>Grade {g}</option>)}
                            </select>
                            <input type="text" placeholder="Search name or ad.no..." value={assignSearch} onChange={(e) => setAssignSearch(e.target.value)} style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', flex: 1, minWidth: '150px' }} />
                          </div>

                          {/* Checkbox List */}
                          <div style={{ border: '1px solid #cbd5e1', borderRadius: '8px', overflow: 'hidden' }}>
                            <div style={{ padding: '12px 16px', background: '#f1f5f9', borderBottom: '1px solid #cbd5e1', display: 'flex', alignItems: 'center' }}>
                              <input
                                type="checkbox"
                                checked={allFilteredSelected && filteredStudentsForAssign.length > 0}
                                onChange={(e) => toggleSelectAllForEnv(env.id, e.target.checked)}
                                style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#0f172a' }}
                              />
                              <span style={{ marginLeft: '12px', fontWeight: '800', color: '#0f172a', fontSize: '14px' }}>
                                Select All ({filteredStudentsForAssign.length})
                              </span>
                            </div>
                            <div style={{ maxHeight: '300px', overflowY: 'auto', background: '#ffffff' }}>
                              {filteredStudentsForAssign.length === 0 ? (
                                <div style={{ padding: '20px', textAlign: 'center', color: '#64748b', fontSize: '14px' }}>No students match your filters.</div>
                              ) : (
                                filteredStudentsForAssign.map((s, i) => (
                                  <div key={s.regNo} style={{ padding: '10px 16px', borderBottom: i === filteredStudentsForAssign.length - 1 ? 'none' : '1px solid #f1f5f9', display: 'flex', alignItems: 'center' }}>
                                    <input
                                      type="checkbox"
                                      checked={(env.studentIds || []).includes(s.regNo)}
                                      onChange={() => toggleStudentForEnv(env.id, s.regNo)}
                                      style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#334155' }}
                                    />
                                    <span style={{ marginLeft: '12px', color: '#334155', fontSize: '14px', fontWeight: '600' }}>
                                      {s.adNo} - {s.firstName} <span style={{ color: '#94a3b8', fontSize: '12px' }}>({s.department || 'GENERAL'})</span>
                                    </span>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>

                          {/* Done Button */}
                          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
                            <button type="button" onClick={() => setAssigningEnvId(null)} style={{ padding: '10px 24px', background: '#10b981', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', fontSize: '14px' }}>
                              Done Selecting
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <button type="submit" disabled={isLoading} style={isEditing ? styles.buttonWarning : styles.buttonSuccess}>
            {isLoading ? 'Processing...' : isEditing ? 'Update Teacher' : 'Register Teacher'}
          </button>
        </form>

        {statusMsg && (
          <div style={{ marginTop: '20px', padding: '16px', background: statusMsg.includes('Error') ? '#fee2e2' : '#ecfdf5', border: `1px solid ${statusMsg.includes('Error') ? '#fecaca' : '#a7f3d0'}`, borderRadius: '8px', color: statusMsg.includes('Error') ? '#991b1b' : '#065f46', fontWeight: '700' }}>
            {statusMsg}
          </div>
        )}
      </div>

      <div style={styles.card}>
        <h3 style={styles.sectionTitle}>👨‍🏫 Teachers Directory</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '15px', minWidth: '700px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #cbd5e1' }}>
                <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800' }}>Full Name</th>
                <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800' }}>Username</th>
                <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800' }}>Enrollments</th>
                <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {registeredTeachers.map((teacher, index) => (
                <tr key={index} style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <td style={{ padding: '16px', fontWeight: '700', color: '#0f172a' }}>{teacher.fullName}</td>
                  <td style={{ padding: '16px', color: '#64748b', fontWeight: '600' }}>{teacher.username}</td>
                  <td style={{ padding: '16px' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {(teacher.enrollments || []).map((env, i) => (
                        <span key={i} style={{ display: 'inline-block', background: '#f1f5f9', color: '#1e293b', padding: '4px 8px', borderRadius: '6px', fontSize: '12px', fontWeight: '700', border: '1px solid #e2e8f0' }}>
                          {env.alias || env.subject}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td style={{ padding: '16px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                      <button onClick={() => handleEditClick(teacher)} style={{ padding: '8px 14px', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '13px' }}>Edit</button>
                      <button onClick={() => handleDeleteClick(teacher.username)} style={{ padding: '8px 14px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '13px' }}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StudentManager() {
  const [rollNo, setRollNo] = useState('');
  const [regNo, setRegNo] = useState('');
  const [adNo, setAdNo] = useState('');
  const [firstName, setFirstName] = useState('');
  const [department, setDepartment] = useState(DEPARTMENTS[0]);
  const [madhab, setMadhab] = useState('Hanafi');
  const [selectedClasses, setSelectedClasses] = useState([]);
  const [availableStudentClasses, setAvailableStudentClasses] = useState(DEFAULT_CLASSES);
  const [customClassInput, setCustomClassInput] = useState('');
  const [showStudentPassword, setShowStudentPassword] = useState(false);
  const [registeredStudents, setRegisteredStudents] = useState([]);
  const [selectedRows, setSelectedRows] = useState([]);
  const [bulkDept, setBulkDept] = useState('');
  const [bulkMadhab, setBulkMadhab] = useState('');
  const [bulkAddClass, setBulkAddClass] = useState('');

  const [filterLevel, setFilterLevel] = useState('All');
  const [filterClass, setFilterClass] = useState('All');
  const [filterDepartments, setFilterDepartments] = useState([]);
  const [filterMadhab, setFilterMadhab] = useState('All');
  const [filterLanguage, setFilterLanguage] = useState('All');

  const [isEditing, setIsEditing] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // 🌟 NEW STATES: Mass RegNo Migration
  const [isRegNoEditMode, setIsRegNoEditMode] = useState(false);
  const [regNoDrafts, setRegNoDrafts] = useState({});

  const fetchStudents = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, 'students'));
      const studentsData = [];
      querySnapshot.forEach((doc) => studentsData.push(doc.data()));
      studentsData.sort((a, b) => (Number(a.rollNo) || 999) - (Number(b.rollNo) || 999));
      setRegisteredStudents(studentsData);
    } catch (err) { console.error(err); }
  };

  useEffect(() => { fetchStudents(); }, []);

  const handleDownloadTemplate = () => {
    const csvContent = "data:text/csv;charset=utf-8,rollNo,regNo,adNo,firstName,classes,department,madhab\n1,726007,U1278,ABBU SHAHMA,\"QH1, Mixed_Urdu\",QURAN,Shafi\n2,726031,3668,Abdullah Fayiz M,QH1,HADITH,Hanafi";
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "student_upload_template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const toggleStudentClass = (cls) => {
    if (selectedClasses.includes(cls)) setSelectedClasses(selectedClasses.filter(c => c !== cls));
    else setSelectedClasses([...selectedClasses, cls]);
  };

  const handleAddCustomClass = (e) => {
    e.preventDefault();
    if (!customClassInput.trim()) return;
    const newClass = customClassInput.trim();
    if (!availableStudentClasses.includes(newClass)) setAvailableStudentClasses([...availableStudentClasses, newClass]);
    if (!selectedClasses.includes(newClass)) setSelectedClasses([...selectedClasses, newClass]);
    setCustomClassInput('');
  };

  const handleAddOrUpdateStudent = async (e) => {
    e.preventDefault();
    if (selectedClasses.length === 0) return alert('Please select at least one class or group.');
    setIsLoading(true); setStatusMsg(isEditing ? 'Updating student profile...' : 'Registering student securely...');
    const safeRegNo = regNo.toLowerCase().replace(/[^a-z0-9_.-]/g, '');
    const safeAdNo = adNo.trim();
    const safeRollNo = Number(rollNo);
    const fakeEmail = `${safeRegNo}@student.school.com`;
    const firebasePassword = safeAdNo.length < 6 ? safeAdNo.padStart(6, '0') : safeAdNo;
    try {
      if (!isEditing) await createUserWithEmailAndPassword(auth, fakeEmail, firebasePassword);
      await setDoc(doc(db, 'students', safeRegNo), { rollNo: safeRollNo, regNo: safeRegNo, adNo: safeAdNo, firstName, department: department.toUpperCase(), madhab: madhab, classes: selectedClasses }, { merge: true });
      setIsLoading(false); setStatusMsg(isEditing ? 'Student updated successfully!' : 'Student registered successfully!');
      fetchStudents(); resetForm();
    } catch (err) { setIsLoading(false); setStatusMsg('Error: ' + err.message); }
  };

  const handleBulkUpdate = async () => {
    if (selectedRows.length === 0) return;
    if (!bulkDept && !bulkMadhab && !bulkAddClass) return alert('Select update option.');
    if (!window.confirm(`Apply changes to ${selectedRows.length} students?`)) return;
    setIsLoading(true); setStatusMsg(`Updating ${selectedRows.length} students...`);
    try {
      const promises = selectedRows.map(regNo => {
        const updateData = {};
        if (bulkDept) updateData.department = bulkDept;
        if (bulkMadhab) updateData.madhab = bulkMadhab;
        if (bulkAddClass) updateData.classes = arrayUnion(bulkAddClass.trim());
        return setDoc(doc(db, 'students', regNo), updateData, { merge: true });
      });
      await Promise.all(promises);
      setIsLoading(false); setStatusMsg(`Successfully updated!`);
      setSelectedRows([]); setBulkDept(''); setBulkMadhab(''); setBulkAddClass('');
      if (bulkAddClass && !availableStudentClasses.includes(bulkAddClass.trim())) setAvailableStudentClasses([...availableStudentClasses, bulkAddClass.trim()]);
      fetchStudents();
    } catch (err) { setIsLoading(false); setStatusMsg('Error: ' + err.message); }
  };

  const handleCSVUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target.result;
      const lines = text.split('\n');
      let studentsArray = [];
      for (let i = 1; i < lines.length; i++) {
        let line = lines[i].trim();
        if (!line) continue;
        let cols = parseCSVLine(line);
        if (cols.length >= 5) {
          studentsArray.push({
            rollNo: Number(cols[0].trim()),
            regNo: cols[1].toLowerCase().replace(/[^a-z0-9_.-]/g, ''),
            adNo: cols[2].trim(),
            firstName: cols[3].trim(),
            classes: cols[4].split(',').map(c => c.trim()).filter(Boolean),
            department: cols[5] ? cols[5].trim().toUpperCase() : 'GENERAL',
            madhab: cols[6] ? cols[6].trim() : 'Hanafi'
          });
        }
      }
      if (studentsArray.length === 0) return alert('No valid rows found in CSV. Please ensure the template format is used.');
      setIsLoading(true);
      setStatusMsg(`Registering ${studentsArray.length} students with rate-limiting...`);
      try {
        const primaryApp = getApp();
        let secondaryApp;
        try { secondaryApp = getApp("SecondaryApp"); } catch (err) { secondaryApp = initializeApp(primaryApp.options, "SecondaryApp"); }
        const secondaryAuth = getAuth(secondaryApp);

        for (let i = 0; i < studentsArray.length; i++) {
          const s = studentsArray[i];
          const fakeEmail = `${s.regNo}@student.school.com`;
          const firebasePassword = s.adNo.length < 6 ? s.adNo.padStart(6, '0') : s.adNo;

          setStatusMsg(`Registering student ${i + 1} of ${studentsArray.length}...`);
          await delay(2000);

          try {
            await createUserWithEmailAndPassword(secondaryAuth, fakeEmail, firebasePassword);
          } catch (authErr) {
            if (authErr.code === 'auth/too-many-requests') throw new Error("Firebase temporary spam lock. Please wait 5 minutes before continuing.");
            if (authErr.code !== 'auth/email-already-in-use') throw authErr;
          }

          await setDoc(doc(db, 'students', s.regNo), {
            rollNo: s.rollNo, regNo: s.regNo, adNo: s.adNo, firstName: s.firstName,
            department: s.department, madhab: s.madhab, classes: s.classes
          }, { merge: true });
        }

        await signOut(secondaryAuth);
        setIsLoading(false); setStatusMsg(`Successfully registered ${studentsArray.length} students!`);
        fetchStudents();
      } catch (err) { setIsLoading(false); setStatusMsg('Error: ' + err.message); }
    };
    reader.readAsText(file);
  };

  const handleEditClick = (student) => {
    setIsEditing(true); setRollNo(student.rollNo || ''); setRegNo(student.regNo); setAdNo(student.adNo); setFirstName(student.firstName); setDepartment(student.department || DEPARTMENTS[0]); setMadhab(student.madhab || 'Hanafi');
    const stuClasses = getSafeClassesArray(student);
    setSelectedClasses(stuClasses);
    const newAvailable = [...availableStudentClasses];
    let changed = false;
    stuClasses.forEach(c => { if (!newAvailable.includes(c)) { newAvailable.push(c); changed = true; } });
    if (changed) setAvailableStudentClasses(newAvailable);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteClick = async (studentRegNo) => {
    if (window.confirm(`Delete student ${studentRegNo}?`)) {
      try { await deleteDoc(doc(db, 'students', studentRegNo)); fetchStudents(); } catch (err) { alert("Failed to delete."); }
    }
  };

  const resetForm = () => { setIsEditing(false); setRollNo(''); setRegNo(''); setAdNo(''); setFirstName(''); setDepartment(DEPARTMENTS[0]); setMadhab('Hanafi'); setSelectedClasses([]); setStatusMsg(''); };

  // 🌟 ANTI-CRASH SAFEGUARD: Forces any stored data into a clean array before rendering
  const getSafeClassesArray = (student) => {
    if (Array.isArray(student.classes)) return student.classes;
    if (typeof student.classes === 'string') return [student.classes];
    if (student.className) return [student.className];
    return [];
  };

  const getStudentLevels = (student) => {
    const classes = getSafeClassesArray(student);
    const levels = new Set();
    classes.forEach(c => { const match = String(c).match(/\d+/); if (match) levels.add(match[0]); });
    return Array.from(levels);
  };

  const isUrduStudent = (adNo) => (adNo || '').toUpperCase().includes('U');

  const toggleFilterDirectoryDept = (dept) => {
    if (filterDepartments.includes(dept)) setFilterDepartments(filterDepartments.filter(d => d !== dept));
    else setFilterDepartments([...filterDepartments, dept]);
  };

  const filteredStudents = registeredStudents.filter((student) => {
    if (filterLevel !== 'All' && !getStudentLevels(student).includes(filterLevel)) return false;
    if (filterClass !== 'All' && !getSafeClassesArray(student).includes(filterClass)) return false;
    if (filterDepartments.length > 0 && !filterDepartments.includes((student.department || '').toUpperCase())) return false;
    if (filterMadhab !== 'All' && (student.madhab || 'General') !== filterMadhab) return false;
    if (filterLanguage === 'Urdu' && !isUrduStudent(student.adNo)) return false;
    if (filterLanguage === 'Non-Urdu' && isUrduStudent(student.adNo)) return false;
    return true;
  });

  const toggleRowSelect = (regNo) => {
    if (selectedRows.includes(regNo)) setSelectedRows(selectedRows.filter(id => id !== regNo));
    else setSelectedRows([...selectedRows, regNo]);
  };

  const toggleSelectAll = (filteredArray) => {
    if (selectedRows.length === filteredArray.length) setSelectedRows([]);
    else setSelectedRows(filteredArray.map(s => s.regNo));
  };

  // 🌟 MIGRATION FUNCTIONS
  const handleRegNoDraftChange = (oldRegNo, val) => {
    setRegNoDrafts(prev => ({ ...prev, [oldRegNo]: val }));
  };

  const executeRegNoMigration = async () => {
    const updates = Object.entries(regNoDrafts).filter(([oldReg, newReg]) => newReg && newReg.trim() !== '' && newReg !== oldReg);
    if (updates.length === 0) return alert('No changes entered. Please type a new RegNo for at least one student.');
    if (!window.confirm(`Are you sure you want to migrate ${updates.length} Registration Numbers? This will move their profiles, marks, and create new login credentials.`)) return;

    setIsLoading(true);
    setStatusMsg(`Migrating ${updates.length} students... Please wait.`);

    try {
      const primaryApp = getApp();
      let secondaryApp;
      try { secondaryApp = getApp("SecondaryApp"); } catch (err) { secondaryApp = initializeApp(primaryApp.options, "SecondaryApp"); }
      const secondaryAuth = getAuth(secondaryApp);

      for (const [oldReg, newRegRaw] of updates) {
        const newReg = newRegRaw.toLowerCase().replace(/[^a-z0-9_.-]/g, '');

        const studentSnap = await getDoc(doc(db, 'students', oldReg));
        const markSnap = await getDoc(doc(db, 'marks', oldReg));

        if (studentSnap.exists()) {
          const studentData = studentSnap.data();
          studentData.regNo = newReg;

          const fakeEmail = `${newReg}@student.school.com`;
          const safeAdNo = String(studentData.adNo).trim();
          const firebasePassword = safeAdNo.length < 6 ? safeAdNo.padStart(6, '0') : safeAdNo;

          try { await createUserWithEmailAndPassword(secondaryAuth, fakeEmail, firebasePassword); }
          catch (authErr) { if (authErr.code !== 'auth/email-already-in-use') console.error("Auth skip:", authErr); }

          await setDoc(doc(db, 'students', newReg), studentData);
          if (markSnap.exists()) await setDoc(doc(db, 'marks', newReg), markSnap.data());

          await deleteDoc(doc(db, 'students', oldReg));
          if (markSnap.exists()) await deleteDoc(doc(db, 'marks', oldReg));
        }
      }

      await signOut(secondaryAuth);
      setRegNoDrafts({});
      setIsRegNoEditMode(false);
      setStatusMsg(`Successfully migrated ${updates.length} students to their new Registration Numbers!`);
      fetchStudents();
    } catch (err) {
      setStatusMsg('Migration Error: ' + err.message);
    }
    setIsLoading(false);
  };

  return (
    <div>
      <div style={styles.card}>
        <h3 style={styles.sectionTitle}>Mass Upload Students</h3>
        <p style={{ fontSize: '15px', color: '#64748b', marginBottom: '20px', lineHeight: '1.5' }}>Upload CSV columns: <strong>rollNo, regNo, adNo, firstName, classes, department, madhab</strong>.</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
          <button onClick={handleDownloadTemplate} style={{ padding: '12px 20px', background: '#f8fafc', color: '#334155', border: '1px solid #cbd5e1', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '14px' }}>📥 Download CSV Template</button>
          <label style={{ display: 'inline-flex', alignItems: 'center', padding: '12px 20px', background: '#0284c7', color: '#ffffff', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '14px' }}>📂 Upload Completed CSV <input type="file" accept=".csv" onChange={handleCSVUpload} style={{ display: 'none' }} /></label>
        </div>
      </div>

      <div style={{ ...styles.card, borderLeft: isEditing ? '6px solid #f59e0b' : '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
          <h3 style={styles.sectionTitle}>{isEditing ? `Editing Student: ${regNo}` : 'Register Student'}</h3>
          {isEditing && <button type="button" onClick={resetForm} style={{ padding: '8px 16px', background: '#e2e8f0', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '700' }}>Cancel</button>}
        </div>

        <form onSubmit={handleAddOrUpdateStudent} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px' }}>
            <div>
              <label style={styles.label}>Sn (Roll No)</label>
              <input type="number" value={rollNo} onChange={(e) => setRollNo(e.target.value)} required style={styles.input} />
            </div>
            <div>
              <label style={styles.label}>First Name</label>
              <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} required style={styles.input} />
            </div>
            <div>
              <label style={styles.label}>Department</label>
              <select value={department} onChange={(e) => setDepartment(e.target.value)} style={{ ...styles.input, cursor: 'pointer' }}>
                {DEPARTMENTS.map(dept => <option key={dept} value={dept}>{dept}</option>)}
              </select>
            </div>
            <div>
              <label style={styles.label}>Madhab</label>
              <select value={madhab} onChange={(e) => setMadhab(e.target.value)} style={{ ...styles.input, cursor: 'pointer' }}>
                {MADHABS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '24px' }}>
            <div>
              <label style={styles.label}>Reg.no (Username)</label>
              <input type="text" value={regNo} onChange={(e) => setRegNo(e.target.value)} disabled={isEditing} required style={{ ...styles.input, backgroundColor: isEditing ? '#f1f5f9' : '#ffffff', color: isEditing ? '#94a3b8' : '#0f172a' }} />
            </div>
            <div>
              <label style={styles.label}>
                Ad.No {isEditing ? '' : '(Password)'}
                {isUrduStudent(adNo) && <span style={{ marginLeft: '8px', color: '#d97706', fontSize: '12px' }}>★ Urdu Student Detected</span>}
              </label>
              <div style={{ display: 'flex', position: 'relative' }}>
                <input type={showStudentPassword || isEditing ? "text" : "password"} value={adNo} onChange={(e) => setAdNo(e.target.value)} required style={styles.input} />
                {!isEditing && <button type="button" onClick={() => setShowStudentPassword(!showStudentPassword)} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#2563eb', fontWeight: '700', cursor: 'pointer' }}>{showStudentPassword ? "Hide" : "Show"}</button>}
              </div>
            </div>
          </div>

          <div style={{ background: '#f8fafc', padding: '24px', borderRadius: '12px', border: '1px solid #e2e8f0', boxSizing: 'border-box' }}>
            <h4 style={{ margin: '0 0 16px 0', fontSize: '16px', color: '#0f172a', fontWeight: '800' }}>Assign to Classes / Groups</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '12px', background: '#ffffff', padding: '16px', border: '1px solid #cbd5e1', borderRadius: '8px', marginBottom: '16px' }}>
              {availableStudentClasses.map(cls => (
                <label key={cls} style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '14px', color: '#334155', fontWeight: '600' }}>
                  <input type="checkbox" checked={selectedClasses.includes(cls)} onChange={() => toggleStudentClass(cls)} style={{ marginRight: '8px', accentColor: '#2563eb', width: '16px', height: '16px' }} /> {cls}
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <input type="text" value={customClassInput} onChange={(e) => setCustomClassInput(e.target.value)} placeholder="Or custom group (e.g. Mixed_Urdu)..." style={{ ...styles.input, flex: '1 1 220px' }} />
              <button type="button" onClick={handleAddCustomClass} style={{ padding: '10px 16px', background: '#cbd5e1', color: '#334155', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '14px' }}>Add Custom Group</button>
            </div>
          </div>

          <button type="submit" disabled={isLoading} style={isEditing ? styles.buttonWarning : styles.buttonSuccess}>
            {isLoading ? 'Processing...' : isEditing ? 'Update Student Profile' : 'Register Student'}
          </button>
        </form>
        {statusMsg && <div style={{ marginTop: '20px', padding: '16px', background: statusMsg.includes('Error') ? '#fee2e2' : '#ecfdf5', border: `1px solid ${statusMsg.includes('Error') ? '#fecaca' : '#a7f3d0'}`, borderRadius: '8px', color: statusMsg.includes('Error') ? '#991b1b' : '#065f46', fontWeight: '700' }}>{statusMsg}</div>}
      </div>

      <div style={styles.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', marginBottom: '24px' }}>
          <div>
            <h3 style={{ margin: '0 0 4px 0', fontSize: '19px', color: '#0f172a', fontWeight: '800' }}>Students Directory (For Profile Edits)</h3>
            <span style={{ fontSize: '14px', color: '#64748b', fontWeight: '600' }}>Showing {filteredStudents.length} of {registeredStudents.length} total students</span>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
            <button
              onClick={() => { setIsRegNoEditMode(!isRegNoEditMode); setRegNoDrafts({}); }}
              style={{ padding: '8px 16px', background: isRegNoEditMode ? '#fef3c7' : '#f8fafc', color: isRegNoEditMode ? '#d97706' : '#334155', border: `1px solid ${isRegNoEditMode ? '#fcd34d' : '#cbd5e1'}`, borderRadius: '8px', fontWeight: '800', cursor: 'pointer', fontSize: '13px', marginRight: '10px' }}
            >
              {isRegNoEditMode ? 'Cancel Edit Mode' : '✏️ Mass Edit RegNo'}
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '13px', fontWeight: '700', color: '#334155' }}>Filter Depts:</span>
              {DEPARTMENTS.map(d => (
                <label key={d} style={{ display: 'flex', alignItems: 'center', fontSize: '12px', color: '#0f172a', background: filterDepartments.includes(d) ? '#dbeafe' : '#ffffff', padding: '6px 10px', borderRadius: '6px', cursor: 'pointer', border: filterDepartments.includes(d) ? '2px solid #3b82f6' : '1px solid #cbd5e1', fontWeight: '700' }}>
                  <input type="checkbox" checked={filterDepartments.includes(d)} onChange={() => toggleFilterDirectoryDept(d)} style={{ display: 'none' }} />
                  {d}
                </label>
              ))}
              {filterDepartments.length > 0 && <button type="button" onClick={() => setFilterDepartments([])} style={{ fontSize: '12px', background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontWeight: '800' }}>Clear</button>}
            </div>

            <select value={filterLevel} onChange={(e) => setFilterLevel(e.target.value)} style={styles.filterSelect}>
              <option value="All">All Levels</option><option value="1">Level 1</option><option value="2">Level 2</option><option value="3">Level 3</option>
            </select>
            <select value={filterClass} onChange={(e) => setFilterClass(e.target.value)} style={styles.filterSelect}>
              <option value="All">All Classes</option>
              {availableStudentClasses.map(cls => <option key={cls} value={cls}>{cls}</option>)}
            </select>
            <select value={filterMadhab} onChange={(e) => setFilterMadhab(e.target.value)} style={styles.filterSelect}>
              <option value="All">All Madhabs</option>
              {MADHABS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <select value={filterLanguage} onChange={(e) => setFilterLanguage(e.target.value)} style={styles.filterSelect}>
              <option value="All">All Languages</option><option value="Urdu">Urdu Only</option><option value="Non-Urdu">Non-Urdu</option>
            </select>
          </div>
        </div>

        {selectedRows.length > 0 && !isRegNoEditMode && (
          <div style={{ padding: '16px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '10px', marginBottom: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
            <div><strong style={{ color: '#1e40af', fontSize: '15px' }}>{selectedRows.length} students selected</strong></div>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
              <select value={bulkDept} onChange={(e) => setBulkDept(e.target.value)} style={styles.filterSelect}><option value="">Set Dept -</option>{DEPARTMENTS.map(dept => <option key={dept} value={dept}>{dept}</option>)}</select>
              <select value={bulkMadhab} onChange={(e) => setBulkMadhab(e.target.value)} style={styles.filterSelect}><option value="">Set Madhab -</option>{MADHABS.map(m => <option key={m} value={m}>{m}</option>)}</select>
              <span style={{ color: '#94a3b8', margin: '0 5px' }}>|</span>
              <input type="text" value={bulkAddClass} onChange={(e) => setBulkAddClass(e.target.value)} placeholder="Assign Group..." style={{ padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', fontSize: '14px', width: '220px' }} />
              <button onClick={handleBulkUpdate} style={{ padding: '10px 18px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '14px' }}>Apply Bulk</button>
            </div>
          </div>
        )}

        {isRegNoEditMode && (
          <div style={{ padding: '16px', background: '#fffbeb', border: '2px dashed #f59e0b', borderRadius: '10px', marginBottom: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <strong style={{ color: '#b45309', fontSize: '15px', display: 'block' }}>⚠️ Mass RegNo Migration Mode Active</strong>
              <span style={{ fontSize: '13px', color: '#92400e' }}>Type the new registration number next to the students you want to correct, then click Migrate.</span>
            </div>
            <button onClick={executeRegNoMigration} disabled={isLoading} style={{ padding: '12px 24px', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', fontSize: '15px' }}>
              {isLoading ? 'Migrating...' : '🚀 Migrate Entered RegNos'}
            </button>
          </div>
        )}

        <div style={{ width: '100%', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '15px', minWidth: '850px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #cbd5e1' }}>
                {!isRegNoEditMode && (
                  <th style={{ padding: '14px 16px', width: '50px' }}><input type="checkbox" checked={filteredStudents.length > 0 && selectedRows.length === filteredStudents.length} onChange={() => toggleSelectAll(filteredStudents)} style={{ accentColor: '#2563eb', width: '16px', height: '16px', cursor: 'pointer' }} /></th>
                )}
                <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', width: '60px' }}>Sn</th>
                <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', width: '150px' }}>Current Reg.No</th>

                {isRegNoEditMode && (
                  <th style={{ padding: '14px 16px', color: '#d97706', fontWeight: '800', width: '180px' }}>Type New Reg.No</th>
                )}

                <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', width: '180px' }}>Name / Ad.No</th>
                <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', width: '150px' }}>Profile</th>
                <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800' }}>Classes & Levels</th>
                {!isRegNoEditMode && (
                  <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', width: '160px', textAlign: 'right' }}>Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {filteredStudents.map((student, index) => {
                const isUrdu = isUrduStudent(student.adNo);
                const levels = getStudentLevels(student);
                const safeClasses = getSafeClassesArray(student);

                return (
                  <tr key={index} style={{ borderBottom: '1px solid #e2e8f0', background: selectedRows.includes(student.regNo) || regNoDrafts[student.regNo] ? '#f0f9ff' : 'transparent' }}>
                    {!isRegNoEditMode && (
                      <td style={{ padding: '16px', verticalAlign: 'middle' }}><input type="checkbox" checked={selectedRows.includes(student.regNo)} onChange={() => toggleRowSelect(student.regNo)} style={{ accentColor: '#2563eb', width: '16px', height: '16px', cursor: 'pointer' }} /></td>
                    )}
                    <td style={{ padding: '16px', fontWeight: '700', color: '#64748b', verticalAlign: 'middle' }}>{student.rollNo || '-'}</td>
                    <td style={{ padding: '16px', fontWeight: '700', color: '#0f172a', verticalAlign: 'middle' }}>{student.regNo}</td>

                    {isRegNoEditMode && (
                      <td style={{ padding: '16px', verticalAlign: 'middle' }}>
                        <input
                          type="text"
                          value={regNoDrafts[student.regNo] || ''}
                          onChange={(e) => handleRegNoDraftChange(student.regNo, e.target.value)}
                          placeholder="Enter correction..."
                          style={{ width: '100%', padding: '8px 12px', border: '2px solid #cbd5e1', borderRadius: '6px', outline: 'none', fontWeight: '700', color: '#0f172a', background: '#ffffff' }}
                        />
                      </td>
                    )}

                    <td style={{ padding: '16px', color: '#0f172a', fontWeight: '700', verticalAlign: 'middle' }}>
                      {student.firstName}<br />
                      <span style={{ fontSize: '13px', color: '#64748b', fontWeight: '600' }}>Ad: {student.adNo}</span>
                      {isUrdu && <span style={{ ...styles.badge, background: '#fef3c7', color: '#b45309', marginLeft: '6px' }}>URDU</span>}
                    </td>
                    <td style={{ padding: '16px', verticalAlign: 'middle' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                        <span style={{ ...styles.badge, background: '#e0f2fe', color: '#0369a1' }}>{student.department || 'GENERAL'}</span>
                        <span style={{ ...styles.badge, background: '#f3e8ff', color: '#7e22ce' }}>{student.madhab || 'Hanafi'}</span>
                      </div>
                    </td>
                    <td style={{ padding: '16px', verticalAlign: 'middle' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {safeClasses.map((c, i) => (
                          <span key={i} style={{ display: 'inline-block', background: '#f1f5f9', color: '#0f172a', padding: '4px 8px', borderRadius: '6px', fontSize: '12px', fontWeight: '700', border: '1px solid #e2e8f0' }}>{c}</span>
                        ))}
                        {levels.map((lvl, i) => (
                          <span key={`lvl-${i}`} style={{ display: 'inline-block', background: '#ecfdf5', color: '#047857', padding: '4px 8px', borderRadius: '6px', fontSize: '12px', fontWeight: '700', border: '1px solid #a7f3d0' }}>Lvl {lvl}</span>
                        ))}
                      </div>
                    </td>
                    {!isRegNoEditMode && (
                      <td style={{ padding: '16px', textAlign: 'right', verticalAlign: 'middle' }}>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                          <button onClick={() => handleEditClick(student)} style={{ padding: '8px 14px', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '13px' }}>Edit</button>
                          <button onClick={() => handleDeleteClick(student.regNo)} style={{ padding: '8px 14px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '13px' }}>Delete</button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ReportManager() {
  const [registeredStudents, setRegisteredStudents] = useState([]);
  const [overallMarksCache, setOverallMarksCache] = useState({});
  const [filteredResults, setFilteredResults] = useState([]);

  const [isLoading, setIsLoading] = useState(false);
  const [isBackgroundSyncing, setIsBackgroundSyncing] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [auditPreset, setAuditPreset] = useState('ALL');
  const [exportDepartment, setExportDepartment] = useState('All');
  const [exportClassFilter, setExportClassFilter] = useState('All');
  const [exportMetric, setExportMetric] = useState('STATUS');
  const [exportSubject, setExportSubject] = useState(DEFAULT_SUBJECTS[0]);
  const [thresholdCondition, setThresholdCondition] = useState('Below');
  const [thresholdScore, setThresholdScore] = useState(40);

  const [inspectorClass, setInspectorClass] = useState(DEFAULT_CLASSES[0]);
  const [inspectorSubject, setInspectorSubject] = useState(DEFAULT_SUBJECTS[0]);
  const [subjectLevelMarks, setSubjectLevelMarks] = useState({});
  const [isInspecting, setIsInspecting] = useState(false);
  const [inspectorMode, setInspectorMode] = useState('class');
  const [allTeachers, setAllTeachers] = useState([]);
  const [inspectorTeacherUsername, setInspectorTeacherUsername] = useState('');
  const [inspectorTeacherEnrollmentId, setInspectorTeacherEnrollmentId] = useState('');

  // 🌟 NEW STATES FOR ANALYTICS AND AVERAGES
  const [analyticsMode, setAnalyticsMode] = useState('grade'); // Changed to 'grade'
  const [analyticsGrade, setAnalyticsGrade] = useState('1');
  const [analyticsTeacherUsername, setAnalyticsTeacherUsername] = useState('');
  const [analyticsData, setAnalyticsData] = useState(null);
  const [isFetchingAnalytics, setIsFetchingAnalytics] = useState(false);

  const fetchReportData = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, 'students'));
      const studentsData = [];
      querySnapshot.forEach((doc) => studentsData.push(doc.data()));
      studentsData.sort((a, b) => (Number(a.rollNo) || 999) - (Number(b.rollNo) || 999));
      setRegisteredStudents(studentsData);

      const tSnap = await getDocs(collection(db, 'teachers'));
      const tData = [];
      tSnap.forEach((doc) => tData.push(doc.data()));
      setAllTeachers(tData);
      if (tData.length > 0) {
        setInspectorTeacherUsername(tData[0].username);
        setAnalyticsTeacherUsername(tData[0].username); // Set default for analytics
        if (tData[0].enrollments?.length > 0) {
          setInspectorTeacherEnrollmentId(tData[0].enrollments[0].id);
        }
      }

      const cacheDocRef = doc(db, 'systemCache', 'adminReportCache');
      const cacheSnap = await getDoc(cacheDocRef);

      if (cacheSnap.exists()) {
        setOverallMarksCache(cacheSnap.data().marksData || {});
        setIsLoading(false);
      } else {
        setIsLoading(false);
      }

      backgroundSyncWithGoogleSheets();

    } catch (err) {
      console.error('Error fetching report data:', err);
      setIsLoading(false);
    }
  };

  const backgroundSyncWithGoogleSheets = async () => {
    setIsBackgroundSyncing(true);
    try {
      const res = await fetch(`${WEB_APP_URL}?action=getAllAdminReportData`);
      const result = await res.json();
      if (result.status === 'success') {
        const freshData = result.data || {};
        setOverallMarksCache(freshData);
        await setDoc(doc(db, 'systemCache', 'adminReportCache'), {
          marksData: freshData,
          lastUpdated: new Date().toISOString()
        });
      }
    } catch (err) {
      console.error('Background sheet sync error:', err);
    } finally {
      setIsBackgroundSyncing(false);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReportData();
  }, []);

  const generateFilteredList = () => {
    const filtered = registeredStudents.filter((student) => {
      if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase();
        const name = (student.firstName || '').toLowerCase();
        const adNo = (student.adNo || '').toLowerCase();
        const regNo = (student.regNo || '').toLowerCase();
        if (!name.includes(query) && !adNo.includes(query) && !regNo.includes(query)) {
          return false;
        }
      }

      if (exportDepartment !== 'All' && (student.department || '').toUpperCase() !== exportDepartment.toUpperCase()) return false;
      if (exportClassFilter !== 'All' && !(student.classes || []).includes(exportClassFilter)) return false;

      if (auditPreset === 'ALL') return true;

      const marksInfo = overallMarksCache[student.regNo];

      if (auditPreset === 'MISSING') {
        if (!marksInfo || !marksInfo.overall || !marksInfo.overall['STATUS'] || marksInfo.overall['STATUS'] === '-' || marksInfo.overall['STATUS'] === '') return true;
        return false;
      }

      if (!marksInfo) return false;

      let scoreToCompareStr = '';
      if (exportMetric === 'STATUS') scoreToCompareStr = marksInfo.overall?.['STATUS'];
      else if (exportMetric === '1400') scoreToCompareStr = marksInfo.overall?.['1400'];
      else if (exportMetric === '420') scoreToCompareStr = marksInfo.overall?.['420'];
      else if (exportMetric === 'SUBJECT') scoreToCompareStr = marksInfo.subjects?.[exportSubject.toUpperCase()];

      if (!scoreToCompareStr || scoreToCompareStr === '-' || scoreToCompareStr === '') return false;
      const score = parseFloat(String(scoreToCompareStr).replace('%', ''));
      if (isNaN(score)) return false;

      if (auditPreset === 'FAIL' && score >= 40) return false;
      if (auditPreset === 'TOP' && score < 80) return false;

      if (auditPreset === 'CUSTOM') {
        if (thresholdCondition === 'Below' && score >= Number(thresholdScore)) return false;
        if (thresholdCondition === 'Above' && score < Number(thresholdScore)) return false;
      }

      return true;
    });

    const mappedResults = filtered.map((s) => {
      let printedMetric = 'Missing / -';
      const info = overallMarksCache[s.regNo];
      if (info) {
        if (exportMetric === 'STATUS') printedMetric = info.overall?.['STATUS'] || 'Missing';
        else if (exportMetric === '1400') printedMetric = info.overall?.['1400'] || 'Missing';
        else if (exportMetric === '420') printedMetric = info.overall?.['420'] || 'Missing';
        else if (exportMetric === 'SUBJECT') printedMetric = info.subjects?.[exportSubject.toUpperCase()] || 'Missing';
      }
      return { ...s, displayMetric: printedMetric };
    });

    let sortedMappedResults = [...mappedResults];
    if (exportClassFilter !== 'All') {
      sortedMappedResults = sortStudentsByDepartment(sortedMappedResults, exportClassFilter);
    } else {
      sortedMappedResults.sort((a, b) => (Number(a.rollNo) || 999) - (Number(b.rollNo) || 999));
    }

    setFilteredResults(sortedMappedResults);
    if (sortedMappedResults.length === 0) setStatusMsg(`No students match the criteria.`);
    else setStatusMsg(`Found ${sortedMappedResults.length} students matching your filter criteria.`);
  };

  const totalStudentsCount = registeredStudents.length;
  const studentsWithMarks = registeredStudents.filter(s => {
    const info = overallMarksCache[s.regNo];
    return info && info.overall && info.overall['STATUS'] && info.overall['STATUS'] !== '-';
  }).length;
  const missingMarksCount = totalStudentsCount - studentsWithMarks;

  const fetchClassSubjectMarks = async () => {
    setIsInspecting(true);
    try {
      const studentSnap = await getDocs(collection(db, 'students'));
      const allStudents = [];
      studentSnap.forEach(docSnap => {
        allStudents.push({ id: docSnap.id, ...docSnap.data() });
      });

      const teacherSnap = await getDocs(collection(db, 'teachers'));
      const teachersList = [];
      teacherSnap.forEach(tDoc => {
        teachersList.push({ id: tDoc.id, fullName: tDoc.data().fullName, username: tDoc.data().username, enrollments: tDoc.data().enrollments || [] });
      });

      let matchedStudents = [];
      let activeSubject = '';
      let sorterAlias = '';

      if (inspectorMode === 'class') {
        activeSubject = inspectorSubject;
        sorterAlias = inspectorClass;
        matchedStudents = allStudents.filter(s => (s.classes || []).includes(inspectorClass));
      }
      else if (inspectorMode === 'teacher') {
        const selectedTeacher = teachersList.find(t => t.username === inspectorTeacherUsername);
        const selectedEnrollment = selectedTeacher?.enrollments?.find(e => e.id === inspectorTeacherEnrollmentId);

        if (!selectedEnrollment) {
          alert("No valid assignment selected for this teacher.");
          setIsInspecting(false);
          return;
        }

        const rawSub = (selectedEnrollment.subject || '').trim();
        const rawAlias = (selectedEnrollment.alias || '').trim();

        // 🌟 STRICTLY Separate Fiqh and Usul al-Fiqh
        if (rawSub.toUpperCase() === 'U :FIQH' || rawSub.toUpperCase() === 'U:FIQH' || rawAlias.toUpperCase().includes('U :FIQH') || rawAlias.toUpperCase().includes('U:FIQH')) {
          activeSubject = 'U :FIQH';
        } else if (rawSub.toUpperCase() === 'FIQH' || rawAlias.toUpperCase().includes('FIQH')) {
          activeSubject = 'FIQH';
        } else {
          activeSubject = rawSub;
        }

        sorterAlias = selectedEnrollment.alias || '';
        const envAliasLower = String(selectedEnrollment.alias || '').trim().toLowerCase();
        const envLang = (selectedEnrollment.langTag || '').toLowerCase();

        matchedStudents = allStudents.filter(student => {
          const studentClassesLower = (student.classes || []).map(c => String(c).trim().toLowerCase());
          const sReg = String(student.regNo || '').trim().toUpperCase();
          const sAd = String(student.adNo || '').trim().toUpperCase();
          const sId = String(student.id || '').trim().toUpperCase();
          const isUrdu = sAd.startsWith('U');

          if (selectedEnrollment.studentIds && Array.isArray(selectedEnrollment.studentIds)) {
            const savedIds = selectedEnrollment.studentIds.map(id => String(id).trim().toUpperCase());
            if (savedIds.includes(sReg) || savedIds.includes(sAd) || savedIds.includes(sId)) {
              return true;
            }
          }

          let classMatch = studentClassesLower.some(cls => envAliasLower.includes(cls));

          if (!classMatch && envAliasLower.includes('m10')) {
            const isGrade3 = studentClassesLower.some(cls => cls.includes('3'));
            if (isGrade3 && !isUrdu) classMatch = true;
          }

          if (!classMatch) {
            let envGrade = String(selectedEnrollment.grade || '');
            if (!envGrade) {
              if (envAliasLower.match(/8|1/)) envGrade = '1';
              else if (envAliasLower.match(/9|2/)) envGrade = '2';
              else if (envAliasLower.match(/10|3/)) envGrade = '3';
            }
            let stuGrade = '';
            if (studentClassesLower.some(c => c.includes('1') || c.includes('8'))) stuGrade = '1';
            else if (studentClassesLower.some(c => c.includes('2') || c.includes('9'))) stuGrade = '2';
            else if (studentClassesLower.some(c => c.includes('3') || c.includes('10'))) stuGrade = '3';

            if (envGrade && stuGrade && envGrade === stuGrade) classMatch = true;
          }

          if (classMatch) {
            if (envLang.includes('urdu') && !envLang.includes('non')) return isUrdu;
            if (envLang.includes('gen') || envLang.includes('non') || envLang === '') return !isUrdu;
            return true;
          }
          return false;
        });
      }

      matchedStudents = sortStudentsByDepartment(matchedStudents, sorterAlias);

      const marksRecord = {};
      const teacherRecord = {};

      // 🌟 HELPER: Strictly prevent 'U8 Fiqh' from being confused with 'U :Fiqh'
      const isMatchingSubject = (inspSub, envSub, envAliasUpper) => {
        const isInspUsul = inspSub === 'U :FIQH' || inspSub === 'U:FIQH';
        const isEnvUsul = envSub === 'U :FIQH' || envSub === 'U:FIQH' || envAliasUpper.includes('U :FIQH') || envAliasUpper.includes('U:FIQH');

        if (isInspUsul) return isEnvUsul;

        if (inspSub === 'FIQH') {
          const hasFiqh = envSub === 'FIQH' || envAliasUpper.includes('FIQH');
          return hasFiqh && !isEnvUsul;
        }

        return (envSub === inspSub) ||
          (inspSub === 'LOGIC' && envSub === 'MANTIQ') ||
          (inspSub === 'MANTIQ' && envSub === 'LOGIC') ||
          envAliasUpper.includes(inspSub);
      };

      for (const student of matchedStudents) {
        let markSnap = null;
        const possibleKeys = [student.regNo, student.id, student.adNo, student.admissionNo].filter(Boolean);
        for (const key of possibleKeys) {
          markSnap = await getDoc(doc(db, 'marks', String(key).trim()));
          if (markSnap.exists()) break;
        }

        if (markSnap && markSnap.exists()) {
          const studentMarksData = markSnap.data();

          const foundSubjectKey = Object.keys(studentMarksData).find(k => {
            const kUp = k.trim().toUpperCase();
            const actUp = activeSubject.trim().toUpperCase();

            const isActUsul = actUp === 'U :FIQH' || actUp === 'U:FIQH';
            const isKUpUsul = kUp === 'U :FIQH' || kUp === 'U:FIQH';

            if (isActUsul) return isKUpUsul;
            if (actUp === 'FIQH') return kUp === 'FIQH' && !isKUpUsul;
            return kUp === actUp;
          });

          marksRecord[student.regNo || student.id] = foundSubjectKey ? studentMarksData[foundSubjectKey] : {};
        } else {
          marksRecord[student.regNo || student.id] = {};
        }

        if (inspectorMode === 'teacher') {
          teacherRecord[student.regNo || student.id] = teachersList.find(t => t.username === inspectorTeacherUsername)?.fullName || 'Assigned';
        } else {
          let assignedTeacher = 'Unassigned';
          const studentClassesLower = (student.classes || []).map(c => String(c).trim().toLowerCase());
          if (!studentClassesLower.includes(inspectorClass.toLowerCase())) {
            studentClassesLower.push(inspectorClass.toLowerCase());
          }

          const sReg = String(student.regNo || '').trim().toUpperCase();
          const sAd = String(student.adNo || '').trim().toUpperCase();
          const sId = String(student.id || '').trim().toUpperCase();
          const isUrdu = sAd.startsWith('U');

          // 🌟 PASS 1: HIGHEST PRIORITY - Check Manual Assignments (Protects your Shafi/Hanafi split)
          for (const teacher of teachersList) {
            const matchingManualEnv = teacher.enrollments.find(env => {
              const envSub = String(env.subject || '').trim().toUpperCase();
              const inspSub = inspectorSubject.trim().toUpperCase();
              const envAliasUpper = String(env.alias || '').trim().toUpperCase();

              if (!isMatchingSubject(inspSub, envSub, envAliasUpper)) return false;

              if (env.studentIds && Array.isArray(env.studentIds)) {
                const savedIds = env.studentIds.map(id => String(id).trim().toUpperCase());
                if (savedIds.includes(sReg) || savedIds.includes(sAd) || savedIds.includes(sId)) {
                  return true;
                }
              }
              return false;
            });

            if (matchingManualEnv) {
              assignedTeacher = teacher.fullName || teacher.id;
              break;
            }
          }

          // 🌟 PASS 2: AUTO-ASSIGNMENT FALLBACK (Only for students you didn't manually check)
          if (assignedTeacher === 'Unassigned') {
            for (const teacher of teachersList) {
              const matchingAutoEnv = teacher.enrollments.find(env => {
                const envSub = String(env.subject || '').trim().toUpperCase();
                const inspSub = inspectorSubject.trim().toUpperCase();
                const envAliasUpper = String(env.alias || '').trim().toUpperCase();
                const envLang = String(env.langTag || '').trim().toLowerCase();

                if (!isMatchingSubject(inspSub, envSub, envAliasUpper)) return false;

                const envAliasLower = String(env.alias || '').trim().toLowerCase();
                let classMatch = studentClassesLower.some(cls => envAliasLower.includes(cls));

                if (!classMatch && envAliasLower.includes('m10')) {
                  const isGrade3 = studentClassesLower.some(cls => cls.includes('3'));
                  if (isGrade3 && !isUrdu) classMatch = true;
                }

                if (!classMatch) {
                  let envGrade = String(env.grade || '');
                  if (!envGrade) {
                    if (envAliasLower.match(/8|1/)) envGrade = '1';
                    else if (envAliasLower.match(/9|2/)) envGrade = '2';
                    else if (envAliasLower.match(/10|3/)) envGrade = '3';
                  }
                  let stuGrade = '';
                  if (studentClassesLower.some(c => c.includes('1') || c.includes('8'))) stuGrade = '1';
                  else if (studentClassesLower.some(c => c.includes('2') || c.includes('9'))) stuGrade = '2';
                  else if (studentClassesLower.some(c => c.includes('3') || c.includes('10'))) stuGrade = '3';

                  if (envGrade && stuGrade && envGrade === stuGrade) classMatch = true;
                }

                if (classMatch) {
                  if (envLang.includes('urdu') && !envLang.includes('non')) return isUrdu;
                  if (envLang.includes('gen') || envLang.includes('non') || envLang === '') return !isUrdu;
                  return true;
                }
                return false;
              });

              if (matchingAutoEnv) {
                assignedTeacher = teacher.fullName || teacher.id;
                break;
              }
            }
          }
          teacherRecord[student.regNo || student.id] = assignedTeacher;
        }
      }

      setSubjectLevelMarks({ students: matchedStudents, records: marksRecord, teachers: teacherRecord });
    } catch (err) {
      console.error('Error fetching subject level marks:', err);
    } finally {
      setIsInspecting(false);
    }
  };
  // 🌟 NEW: FUNCTION TO GENERATE CLASS OR TEACHER AVERAGES ANALYTICS
  // 🌟 REPLACE the entire generateAnalytics function inside ReportManager
  // 🌟 REPLACE the first part of generateAnalytics inside ReportManager
  const generateAnalytics = async () => {
    setIsFetchingAnalytics(true);
    try {
      let targetEnrollments = [];

      // Gather Enrollments by Grade (1, 2, 3) or by Teacher
      if (analyticsMode === 'grade') {
        allTeachers.forEach(t => {
          (t.enrollments || []).forEach(env => {
            const envAliasLower = String(env.alias || '').trim().toLowerCase();
            let envGrade = '1';
            if (envAliasLower.includes('10') || envAliasLower.includes('3')) envGrade = '3';
            else if (envAliasLower.includes('9') || envAliasLower.includes('2')) envGrade = '2';
            else if (String(env.grade) === '3') envGrade = '3';
            else if (String(env.grade) === '2') envGrade = '2';

            if (envGrade === analyticsGrade) {
              targetEnrollments.push({ ...env, teacherName: t.fullName });
            }
          });
        });
      } else {
        const t = allTeachers.find(x => x.username === analyticsTeacherUsername);
        if (t) targetEnrollments = (t.enrollments || []).map(env => ({ ...env, teacherName: t.fullName }));
      }

      const results = [];
      const marksSnap = await getDocs(collection(db, 'marks'));
      const allMarks = {};
      marksSnap.forEach(doc => { allMarks[doc.id] = doc.data(); });

      for (const env of targetEnrollments) {
        const envAliasLower = String(env.alias || '').trim().toLowerCase();
        const envLang = (env.langTag || '').toLowerCase();

        const matchedStudents = registeredStudents.filter(student => {
          const studentClassesLower = (student.classes || []).map(c => String(c).trim().toLowerCase());
          const isUrdu = String(student.adNo || '').toUpperCase().startsWith('U');

          if (env.studentIds && Array.isArray(env.studentIds)) {
            const savedIds = env.studentIds.map(id => String(id).trim());
            if (savedIds.includes(student.regNo) || savedIds.includes(student.adNo)) return true;
          }

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
        });

        let sum15 = 0, sum20 = 0, sum25 = 0, sum40 = 0, sum100 = 0;

        let exactSubject = (env.alias?.toUpperCase().includes('U :FIQH') || env.subject?.toUpperCase().includes('U :FIQH')) ? 'U :FIQH' : (env.subject || '').trim();

        matchedStudents.forEach(st => {
          const stMarksData = allMarks[st.regNo] || allMarks[st.id] || allMarks[st.adNo];
          if (stMarksData) {
            const foundSubjectKey = Object.keys(stMarksData).find(k => {
              const kUp = k.trim().toUpperCase();
              const actUp = exactSubject.trim().toUpperCase();
              if (actUp.includes('U :FIQH') || actUp.includes('U:FIQH')) return kUp.includes('U :FIQH') || kUp.includes('U:FIQH');
              if (actUp === 'FIQH') return kUp === 'FIQH';
              return kUp === actUp;
            });

            if (foundSubjectKey && stMarksData[foundSubjectKey]) {
              const m = stMarksData[foundSubjectKey];
              let t100 = 0;
              if (m['15'] !== undefined && m['15'] !== '') { sum15 += parseFloat(m['15']); t100 += parseFloat(m['15']); }
              if (m['20'] !== undefined && m['20'] !== '') { sum20 += parseFloat(m['20']); t100 += parseFloat(m['20']); }
              if (m['25'] !== undefined && m['25'] !== '') { sum25 += parseFloat(m['25']); t100 += parseFloat(m['25']); }
              if (m['40'] !== undefined && m['40'] !== '') { sum40 += parseFloat(m['40']); t100 += parseFloat(m['40']); }
              sum100 += t100;
            }
          }
        });

        // Total enrolled includes absent students. Divides sums by totalEnrolled.
        const totalEnrolled = matchedStudents.length;

        results.push({
          id: env.id,
          subjectName: env.alias || env.subject,
          teacherName: env.teacherName,
          avg15: totalEnrolled > 0 ? (sum15 / totalEnrolled).toFixed(1) : '-',
          avg20: totalEnrolled > 0 ? (sum20 / totalEnrolled).toFixed(1) : '-',
          avg25: totalEnrolled > 0 ? (sum25 / totalEnrolled).toFixed(1) : '-',
          avg40: totalEnrolled > 0 ? (sum40 / totalEnrolled).toFixed(1) : '-',
          avg100: totalEnrolled > 0 ? (sum100 / totalEnrolled).toFixed(1) : '-',
          avg30: totalEnrolled > 0 ? (((sum100 / totalEnrolled) / 100) * 30).toFixed(1) : '-',
          studentCount: totalEnrolled
        });
      }

      setAnalyticsData(results);
    } catch (error) {
      console.error(error);
      alert("Failed to load averages. Error: " + error.message);
    } finally {
      setIsFetchingAnalytics(false);
    }
  };

  const handleDownloadExcel = () => {
    if (filteredResults.length === 0) return;
    let csvContent = 'data:text/csv;charset=utf-8,Roll No,Ad.No,First Name,Department,Class,Metric Value\n';
    filteredResults.forEach((s) => {
      csvContent += `${s.rollNo || ''},${s.adNo || ''},"${s.firstName || ''}",${s.department || ''},"${(s.classes || []).join(', ')}",${s.displayMetric || '-'}\n`;
    });
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Filtered_Report_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCopyToClipboard = () => {
    if (filteredResults.length === 0) return;
    let tsvContent = 'Roll No\tAd.No\tFirst Name\tDepartment\tClass\tMetric Value\n';
    filteredResults.forEach((s) => {
      tsvContent += `${s.rollNo || ''}\t${s.adNo || ''}\t${s.firstName || ''}\t${s.department || ''}\t${(s.classes || []).join(', ')}\t${s.displayMetric || '-'}\n`;
    });

    navigator.clipboard.writeText(tsvContent).then(() => {
      alert('Successfully copied table to clipboard!');
    }).catch((err) => {
      alert('Failed to copy to clipboard: ' + err);
    });
  };

  // ==========================================
  // 🌟 EXPORT HANDLERS FOR MARK INSPECTOR
  // ==========================================
  const handleDownloadInspectorExcel = () => {
    if (!subjectLevelMarks.students || subjectLevelMarks.students.length === 0) return alert("No data to download.");

    let csvContent = 'data:text/csv;charset=utf-8,Roll,Ad.No,Student Name,Reg.No,Lvl 1 (15),Lvl 2 (20),Lvl 3 (25),Lvl 4 (40),Total (/100),Scaled (/30)';
    if (inspectorMode === 'class') csvContent += ',Teacher';
    csvContent += '\n';

    subjectLevelMarks.students.forEach((student) => {
      const marks = subjectLevelMarks.records[student.regNo || student.id] || {};
      const teacherName = subjectLevelMarks.teachers[student.regNo || student.id] || 'Unassigned';
      const m1 = parseFloat(marks['15']) || 0;
      const m2 = parseFloat(marks['20']) || 0;
      const m3 = parseFloat(marks['25']) || 0;
      const m4 = parseFloat(marks['40']) || 0;
      const total100 = m1 + m2 + m3 + m4;
      const scaled30 = total100 > 0 ? ((total100 / 100) * 30).toFixed(1) : '-';

      const safeName = (student.firstName || '').replace(/"/g, '""');

      csvContent += `${student.rollNo || '-'},${student.adNo},"${safeName}",${student.regNo},${marks['15'] || '-'},${marks['20'] || '-'},${marks['25'] || '-'},${marks['40'] || '-'},${total100 > 0 ? total100 : '-'},${scaled30}`;
      if (inspectorMode === 'class') csvContent += `,"${teacherName}"`;
      csvContent += '\n';
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Mark_Inspector_${new Date().toLocaleDateString().replace(/\//g, '-')}.csv`);
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const handleCopyInspectorToClipboard = () => {
    if (!subjectLevelMarks.students || subjectLevelMarks.students.length === 0) return alert("No data to copy.");

    let tsvContent = 'Roll\tAd.No\tStudent Name\tReg.No\tLvl 1 (15)\tLvl 2 (20)\tLvl 3 (25)\tLvl 4 (40)\tTotal (/100)\tScaled (/30)';
    if (inspectorMode === 'class') tsvContent += '\tTeacher';
    tsvContent += '\n';

    subjectLevelMarks.students.forEach((student) => {
      const marks = subjectLevelMarks.records[student.regNo || student.id] || {};
      const teacherName = subjectLevelMarks.teachers[student.regNo || student.id] || 'Unassigned';
      const m1 = parseFloat(marks['15']) || 0; const m2 = parseFloat(marks['20']) || 0;
      const m3 = parseFloat(marks['25']) || 0; const m4 = parseFloat(marks['40']) || 0;
      const total100 = m1 + m2 + m3 + m4;
      const scaled30 = total100 > 0 ? ((total100 / 100) * 30).toFixed(1) : '-';

      tsvContent += `${student.rollNo || '-'}\t${student.adNo}\t${student.firstName || ''}\t${student.regNo}\t${marks['15'] || '-'}\t${marks['20'] || '-'}\t${marks['25'] || '-'}\t${marks['40'] || '-'}\t${total100 > 0 ? total100 : '-'}\t${scaled30}`;
      if (inspectorMode === 'class') tsvContent += `\t${teacherName}`;
      tsvContent += '\n';
    });

    navigator.clipboard.writeText(tsvContent).then(() => alert('✅ Inspector Table copied to clipboard!'));
  };

  // ==========================================
  // 🌟 EXPORT HANDLERS FOR AVERAGES ANALYTICS
  // ==========================================
  const handleDownloadAnalyticsExcel = () => {
    if (!analyticsData || analyticsData.length === 0) return alert("No data to download.");
    let csvContent = 'data:text/csv;charset=utf-8,Subject / Assignment,Teacher,Students,Avg Lvl 1 (15),Avg Lvl 2 (20),Avg Lvl 3 (25),Avg Lvl 4 (40),Avg Total (/100),Avg Scaled (/30)\n';

    analyticsData.forEach((row) => {
      csvContent += `"${row.subjectName}","${row.teacherName || 'Unknown'}",${row.studentCount},${row.avg15},${row.avg20},${row.avg25},${row.avg40},${row.avg100},${row.avg30}\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Averages_Analytics_${new Date().toLocaleDateString().replace(/\//g, '-')}.csv`);
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const handleCopyAnalyticsToClipboard = () => {
    if (!analyticsData || analyticsData.length === 0) return alert("No data to copy.");
    let tsvContent = 'Subject / Assignment\tTeacher\tStudents\tAvg Lvl 1 (15)\tAvg Lvl 2 (20)\tAvg Lvl 3 (25)\tAvg Lvl 4 (40)\tAvg Total (/100)\tAvg Scaled (/30)\n';

    analyticsData.forEach((row) => {
      tsvContent += `${row.subjectName}\t${row.teacherName || 'Unknown'}\t${row.studentCount}\t${row.avg15}\t${row.avg20}\t${row.avg25}\t${row.avg40}\t${row.avg100}\t${row.avg30}\n`;
    });

    navigator.clipboard.writeText(tsvContent).then(() => alert('✅ Analytics Table copied to clipboard!'));
  };


  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>

      {/* 🌟 1. ADVANCED STUDENT MARKS AUDITOR */}
      <div style={styles.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h3 style={{ margin: '0 0 6px 0', fontSize: '20px', color: '#0f172a', fontWeight: '800' }}>⚡ Student Marks Auditor & Filter</h3>
            <p style={{ margin: 0, fontSize: '15px', color: '#64748b' }}>Instant multi-parameter audit across all registered students without external quotas.</p>
          </div>
          <span style={{ fontSize: '13px', color: '#047857', background: '#ecfdf5', padding: '6px 14px', borderRadius: '20px', fontWeight: '800', border: '1px solid #a7f3d0' }}>
            ⚡ 100% Free & Realtime
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '28px' }}>
          <div style={{ padding: '20px', borderRadius: '12px', background: '#f8fafc', border: '1px solid #e2e8f0', textAlign: 'center' }}>
            <span style={{ fontSize: '12px', fontWeight: '800', color: '#64748b', letterSpacing: '0.5px' }}>TOTAL ENROLLED</span>
            <div style={{ fontSize: '24px', fontWeight: '800', color: '#0f172a', marginTop: '8px' }}>{totalStudentsCount}</div>
          </div>
          <div style={{ padding: '20px', borderRadius: '12px', background: '#ecfdf5', border: '1px solid #a7f3d0', textAlign: 'center' }}>
            <span style={{ fontSize: '12px', fontWeight: '800', color: '#047857', letterSpacing: '0.5px' }}>MARKS RECORDED</span>
            <div style={{ fontSize: '24px', fontWeight: '800', color: '#047857', marginTop: '8px' }}>{studentsWithMarks}</div>
          </div>
          <div style={{ padding: '20px', borderRadius: '12px', background: '#fee2e2', border: '1px solid #fecaca', textAlign: 'center' }}>
            <span style={{ fontSize: '12px', fontWeight: '800', color: '#991b1b', letterSpacing: '0.5px' }}>MISSING / INCOMPLETE</span>
            <div style={{ fontSize: '24px', fontWeight: '800', color: '#dc2626', marginTop: '8px' }}>{missingMarksCount}</div>
          </div>
          <div style={{ padding: '20px', borderRadius: '12px', background: '#eff6ff', border: '1px solid #bfdbfe', textAlign: 'center' }}>
            <span style={{ fontSize: '12px', fontWeight: '800', color: '#1e40af', letterSpacing: '0.5px' }}>COMPLETION RATE</span>
            <div style={{ fontSize: '24px', fontWeight: '800', color: '#2563eb', marginTop: '8px' }}>
              {totalStudentsCount > 0 ? `${((studentsWithMarks / totalStudentsCount) * 100).toFixed(0)}%` : '0%'}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '20px' }}>
          <div>
            <label style={styles.label}>Quick Status Preset:</label>
            <select value={auditPreset} onChange={(e) => setAuditPreset(e.target.value)} style={{ ...styles.input, fontWeight: '700' }}>
              <option value="ALL">Show All Students</option>
              <option value="MISSING">⚠ Missing / Zero Marks Only</option>
              <option value="FAIL">📉 Needs Attention (&lt; 40%)</option>
              <option value="TOP">⭐ Top Achievers (&ge; 80%)</option>
              <option value="CUSTOM">⚙ Custom Score Threshold</option>
            </select>
          </div>

          <div>
            <label style={styles.label}>Search by Name / Ad.No:</label>
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Type student name or Ad.No..." style={styles.input} />
          </div>

          <div>
            <label style={styles.label}>Class Filter:</label>
            <select value={exportClassFilter} onChange={(e) => setExportClassFilter(e.target.value)} style={styles.input}>
              <option value="All">All Classes</option>
              {DEFAULT_CLASSES.map(cls => <option key={cls} value={cls}>{cls}</option>)}
            </select>
          </div>

          <div>
            <label style={styles.label}>Department:</label>
            <select value={exportDepartment} onChange={(e) => setExportDepartment(e.target.value)} style={styles.input}>
              <option value="All">All Departments</option>
              {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>

        {auditPreset === 'CUSTOM' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px', padding: '20px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '20px' }}>
            <div>
              <label style={styles.label}>Metric:</label>
              <select value={exportMetric} onChange={(e) => setExportMetric(e.target.value)} style={styles.input}>
                <option value="STATUS">Overall Percentage (%)</option>
                <option value="1400">Total out of 1400</option>
                <option value="420">Total out of 420</option>
                <option value="SUBJECT">Specific Subject</option>
              </select>
            </div>
            {exportMetric === 'SUBJECT' && (
              <div>
                <label style={styles.label}>Subject:</label>
                <select value={exportSubject} onChange={(e) => setExportSubject(e.target.value)} style={styles.input}>
                  {DEFAULT_SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            )}
            <div>
              <label style={styles.label}>Rule:</label>
              <div style={{ display: 'flex', gap: '10px' }}>
                <select value={thresholdCondition} onChange={(e) => setThresholdCondition(e.target.value)} style={{ ...styles.input, flex: 1 }}>
                  <option value="Below">Below</option>
                  <option value="Above">Above or Equal</option>
                </select>
                <input type="number" value={thresholdScore} onChange={(e) => setThresholdScore(e.target.value)} style={{ ...styles.input, flex: 1 }} />
              </div>
            </div>
          </div>
        )}

        <button onClick={generateFilteredList} style={{ ...styles.buttonPrimary, width: '100%', background: '#2563eb', padding: '16px', fontSize: '16px', fontWeight: '800' }}>
          🔍 Run Filter & Audit List
        </button>

        {statusMsg && (
          <div style={{ marginTop: '20px', padding: '16px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', color: '#166534', fontWeight: '700' }}>
            {statusMsg}
          </div>
        )}

        {filteredResults.length > 0 && (
          <div style={{ border: '1px solid #cbd5e1', borderRadius: '12px', overflow: 'hidden', marginTop: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '16px 20px', borderBottom: '1px solid #cbd5e1', flexWrap: 'wrap', gap: '12px' }}>
              <h4 style={{ margin: 0, color: '#0f172a', fontWeight: '800', fontSize: '16px' }}>Audit Results ({filteredResults.length} students)</h4>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={handleCopyToClipboard} style={{ padding: '8px 16px', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '700', cursor: 'pointer', fontSize: '14px' }}>📋 Copy Table</button>
                <button onClick={handleDownloadExcel} style={{ padding: '8px 16px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '700', cursor: 'pointer', fontSize: '14px' }}>📊 Download CSV</button>
              </div>
            </div>

            <div style={{ overflowX: 'auto', maxHeight: '400px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '15px', minWidth: '700px' }}>
                <thead style={{ position: 'sticky', top: 0, background: '#ffffff', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                  <tr style={{ borderBottom: '2px solid #cbd5e1' }}>
                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', width: '100px' }}>Ad.No</th>
                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800' }}>Name</th>
                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', width: '150px' }}>Department</th>
                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', width: '120px' }}>Class</th>
                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', width: '160px', textAlign: 'right' }}>Score / Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredResults.map((student, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0', background: idx % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                      <td style={{ padding: '14px 16px', fontWeight: '800', color: '#0f172a', verticalAlign: 'middle' }}>{student.adNo}</td>
                      <td style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '700', verticalAlign: 'middle' }}>{student.firstName}</td>
                      <td style={{ padding: '14px 16px', verticalAlign: 'middle' }}>
                        <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '6px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '800' }}>{student.department || 'GENERAL'}</span>
                      </td>
                      <td style={{ padding: '14px 16px', color: '#334155', fontWeight: '700', verticalAlign: 'middle' }}>{(student.classes || []).join(', ')}</td>
                      <td style={{ padding: '14px 16px', textAlign: 'right', verticalAlign: 'middle' }}>
                        <span style={{ color: String(student.displayMetric).includes('Missing') ? '#dc2626' : '#047857', fontWeight: '800', fontSize: '16px' }}>{student.displayMetric}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* 🌟 2. LEVEL-BY-LEVEL INSPECTOR */}
      <div style={styles.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
          <h3 style={styles.sectionTitle}>🔍 Level-by-Level Mark Inspector</h3>
        </div>

        <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
          <button onClick={() => { setInspectorMode('class'); setSubjectLevelMarks({}); }} style={{ padding: '12px 20px', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', border: '1px solid #cbd5e1', background: inspectorMode === 'class' ? '#2563eb' : '#f8fafc', color: inspectorMode === 'class' ? '#ffffff' : '#334155', fontSize: '14px' }}>
            Filter by Class & Subject
          </button>
          <button onClick={() => { setInspectorMode('teacher'); setSubjectLevelMarks({}); }} style={{ padding: '12px 20px', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', border: '1px solid #cbd5e1', background: inspectorMode === 'teacher' ? '#2563eb' : '#f8fafc', color: inspectorMode === 'teacher' ? '#ffffff' : '#334155', fontSize: '14px' }}>
            Filter by Teacher
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '24px' }}>
          {inspectorMode === 'class' && (
            <>
              <div>
                <label style={styles.label}>Select Class Group:</label>
                <select value={inspectorClass} onChange={(e) => setInspectorClass(e.target.value)} style={styles.input}>
                  {DEFAULT_CLASSES.map(cls => <option key={cls} value={cls}>{cls}</option>)}
                </select>
              </div>
              <div>
                <label style={styles.label}>Select Subject:</label>
                <select value={inspectorSubject} onChange={(e) => setInspectorSubject(e.target.value)} style={styles.input}>
                  {DEFAULT_SUBJECTS.map(sub => <option key={sub} value={sub}>{sub}</option>)}
                </select>
              </div>
            </>
          )}

          {inspectorMode === 'teacher' && (
            <>
              <div>
                <label style={styles.label}>Select Teacher:</label>
                <select
                  value={inspectorTeacherUsername}
                  onChange={(e) => {
                    setInspectorTeacherUsername(e.target.value);
                    const teacher = allTeachers.find(t => t.username === e.target.value);
                    if (teacher && teacher.enrollments?.length > 0) {
                      setInspectorTeacherEnrollmentId(teacher.enrollments[0].id);
                    } else {
                      setInspectorTeacherEnrollmentId('');
                    }
                  }}
                  style={styles.input}
                >
                  {allTeachers.map(t => <option key={t.username} value={t.username}>{t.fullName}</option>)}
                </select>
              </div>
              <div>
                <label style={styles.label}>Select Assignment:</label>
                <select value={inspectorTeacherEnrollmentId} onChange={(e) => setInspectorTeacherEnrollmentId(e.target.value)} style={styles.input}>
                  {allTeachers.find(t => t.username === inspectorTeacherUsername)?.enrollments?.map(env => (
                    <option key={env.id} value={env.id}>{env.alias || `${env.grade} ${env.subject}`} ({env.langTag || 'Gen'})</option>
                  )) || <option value="">No assignments found</option>}
                </select>
              </div>
            </>
          )}

          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button
              onClick={fetchClassSubjectMarks}
              disabled={inspectorMode === 'teacher' && !inspectorTeacherEnrollmentId}
              style={{ ...styles.buttonPrimary, width: '100%', background: '#0284c7', padding: '12px', fontWeight: '800', opacity: (inspectorMode === 'teacher' && !inspectorTeacherEnrollmentId) ? 0.5 : 1 }}
            >
              {isInspecting ? 'Loading...' : 'Inspect Marks'}
            </button>
          </div>
        </div>

        {subjectLevelMarks.students && subjectLevelMarks.students.length > 0 && (
          <div style={{ marginTop: '24px', border: '1px solid #cbd5e1', borderRadius: '12px', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '16px 20px', borderBottom: '1px solid #cbd5e1', flexWrap: 'wrap', gap: '12px' }}>
              <h4 style={{ margin: 0, color: '#0f172a', fontWeight: '800', fontSize: '16px' }}>
                Inspector Results ({subjectLevelMarks.students.length} students)
              </h4>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={handleCopyInspectorToClipboard} style={{ padding: '8px 16px', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}>📋 Copy Table</button>
                <button onClick={handleDownloadInspectorExcel} style={{ padding: '8px 16px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}>📊 Download CSV</button>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '15px', minWidth: '950px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #cbd5e1' }}>
                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', width: '60px' }}>Roll</th>
                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', width: '100px' }}>Ad.No</th>
                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800' }}>Student Name</th>
                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', width: '90px' }}>Lvl 1 (15)</th>
                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', width: '90px' }}>Lvl 2 (20)</th>
                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', width: '90px' }}>Lvl 3 (25)</th>
                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', width: '90px' }}>Lvl 4 (40)</th>
                    <th style={{ padding: '14px 16px', color: '#1e40af', fontWeight: '800', width: '100px' }}>Total (/100)</th>
                    <th style={{ padding: '14px 16px', color: '#047857', fontWeight: '800', width: '100px' }}>Scaled (/30)</th>
                    {inspectorMode === 'class' && <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', width: '160px' }}>Teacher</th>}
                  </tr>
                </thead>
                <tbody>
                  {subjectLevelMarks.students.map((student, idx) => {
                    const marks = subjectLevelMarks.records[student.regNo || student.id] || {};
                    const teacherName = subjectLevelMarks.teachers[student.regNo || student.id] || 'Unassigned';
                    const m1 = parseFloat(marks['15']) || 0;
                    const m2 = parseFloat(marks['20']) || 0;
                    const m3 = parseFloat(marks['25']) || 0;
                    const m4 = parseFloat(marks['40']) || 0;
                    const total100 = m1 + m2 + m3 + m4;
                    const scaled30 = total100 > 0 ? ((total100 / 100) * 30).toFixed(1) : '-';

                    return (
                      <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0', background: idx % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                        <td style={{ padding: '14px 16px', fontWeight: '800', color: '#0f172a', verticalAlign: 'middle' }}>{student.rollNo || '-'}</td>
                        <td style={{ padding: '14px 16px', fontWeight: '800', color: '#0f172a', verticalAlign: 'middle' }}>{student.adNo}</td>
                        <td style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '700', verticalAlign: 'middle' }}>
                          {student.firstName}
                          <br />
                          <span style={{ fontSize: '13px', color: '#64748b', fontWeight: '600' }}>{student.regNo}</span>
                        </td>
                        <td style={{ padding: '14px 16px', verticalAlign: 'middle' }}><span style={{ fontSize: '15px', fontWeight: '800', color: marks['15'] !== undefined ? '#0f172a' : '#cbd5e1' }}>{marks['15'] !== undefined ? marks['15'] : '-'}</span></td>
                        <td style={{ padding: '14px 16px', verticalAlign: 'middle' }}><span style={{ fontSize: '15px', fontWeight: '800', color: marks['20'] !== undefined ? '#0f172a' : '#cbd5e1' }}>{marks['20'] !== undefined ? marks['20'] : '-'}</span></td>
                        <td style={{ padding: '14px 16px', verticalAlign: 'middle' }}><span style={{ fontSize: '15px', fontWeight: '800', color: marks['25'] !== undefined ? '#0f172a' : '#cbd5e1' }}>{marks['25'] !== undefined ? marks['25'] : '-'}</span></td>
                        <td style={{ padding: '14px 16px', verticalAlign: 'middle' }}><span style={{ fontSize: '15px', fontWeight: '800', color: marks['40'] !== undefined ? '#0f172a' : '#cbd5e1' }}>{marks['40'] !== undefined ? marks['40'] : '-'}</span></td>
                        <td style={{ padding: '14px 16px', verticalAlign: 'middle' }}>
                          {total100 > 0 ? <span style={{ background: '#dbeafe', color: '#1e40af', padding: '6px 10px', borderRadius: '6px', fontWeight: '800', fontSize: '15px' }}>{total100}</span> : <span style={{ color: '#94a3b8', fontWeight: '700' }}>-</span>}
                        </td>
                        <td style={{ padding: '14px 16px', verticalAlign: 'middle' }}>
                          {scaled30 !== '-' ? <span style={{ background: '#d1fae5', color: '#047857', padding: '6px 10px', borderRadius: '6px', fontWeight: '800', fontSize: '15px' }}>{scaled30}</span> : <span style={{ color: '#94a3b8', fontWeight: '700' }}>-</span>}
                        </td>
                        {inspectorMode === 'class' && (
                          <td style={{ padding: '14px 16px', color: teacherName === 'Unassigned' ? '#dc2626' : '#047857', fontWeight: '700', verticalAlign: 'middle' }}>
                            {teacherName}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* 🌟 3. CLASS & TEACHER AVERAGES ANALYTICS */}
      <div style={styles.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
          <h3 style={styles.sectionTitle}>📊 Subject & Teacher Averages Analytics</h3>
        </div>

        <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
          <button onClick={() => { setAnalyticsMode('grade'); setAnalyticsData(null); }} style={{ padding: '12px 20px', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', border: '1px solid #cbd5e1', background: analyticsMode === 'grade' ? '#2563eb' : '#f8fafc', color: analyticsMode === 'grade' ? '#ffffff' : '#334155', fontSize: '14px' }}>
            Average by Grade
          </button>
          <button onClick={() => { setAnalyticsMode('teacher'); setAnalyticsData(null); }} style={{ padding: '12px 20px', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', border: '1px solid #cbd5e1', background: analyticsMode === 'teacher' ? '#2563eb' : '#f8fafc', color: analyticsMode === 'teacher' ? '#ffffff' : '#334155', fontSize: '14px' }}>
            Average by Teacher
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '24px' }}>
          {analyticsMode === 'grade' ? (
            <div>
              <label style={styles.label}>Select Grade Level:</label>
              <select value={analyticsGrade} onChange={e => setAnalyticsGrade(e.target.value)} style={styles.input}>
                <option value="1">Grade 1 (u8, m8, 1st years)</option>
                <option value="2">Grade 2 (u9, m9, 2nd years)</option>
                <option value="3">Grade 3 (u10, m10, 3rd years)</option>
              </select>
            </div>
          ) : (
            <div>
              <label style={styles.label}>Select Teacher:</label>
              <select value={analyticsTeacherUsername} onChange={e => setAnalyticsTeacherUsername(e.target.value)} style={styles.input}>
                {allTeachers.map(t => <option key={t.username} value={t.username}>{t.fullName}</option>)}
              </select>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button onClick={generateAnalytics} disabled={isFetchingAnalytics} style={{ ...styles.buttonPrimary, width: '100%', background: '#0284c7', padding: '12px', fontWeight: '800' }}>
              {isFetchingAnalytics ? 'Calculating Averages...' : 'Generate Averages'}
            </button>
          </div>
        </div>

        {analyticsData && (
          <div style={{ marginTop: '24px', border: '1px solid #cbd5e1', borderRadius: '12px', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '16px 20px', borderBottom: '1px solid #cbd5e1', flexWrap: 'wrap', gap: '12px' }}>
              <h4 style={{ margin: 0, color: '#0f172a', fontWeight: '800', fontSize: '16px' }}>
                Averages Data
              </h4>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={handleCopyAnalyticsToClipboard} style={{ padding: '8px 16px', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}>📋 Copy Table</button>
                <button onClick={handleDownloadAnalyticsExcel} style={{ padding: '8px 16px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}>📊 Download CSV</button>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px', minWidth: '950px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #cbd5e1' }}>
                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800' }}>Subject / Assignment</th>
                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800' }}>Teacher</th>
                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', textAlign: 'center' }}>Students</th>
                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', textAlign: 'center' }}>Avg Lvl 1 (15)</th>
                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', textAlign: 'center' }}>Avg Lvl 2 (20)</th>
                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', textAlign: 'center' }}>Avg Lvl 3 (25)</th>
                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', textAlign: 'center' }}>Avg Lvl 4 (40)</th>
                    <th style={{ padding: '14px 16px', color: '#1e40af', fontWeight: '800', textAlign: 'center' }}>Avg Total (/100)</th>
                    <th style={{ padding: '14px 16px', color: '#047857', fontWeight: '800', textAlign: 'center' }}>Avg Scaled (/30)</th>
                  </tr>
                </thead>
                <tbody>
                  {analyticsData.length === 0 ? (
                    <tr>
                      <td colSpan="9" style={{ padding: '20px', textAlign: 'center', color: '#64748b', fontWeight: '600' }}>No subjects found for this selection.</td>
                    </tr>
                  ) : (
                    analyticsData.map((row, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0', background: idx % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                        <td style={{ padding: '14px 16px', fontWeight: '800', color: '#0f172a' }}>{row.subjectName}</td>
                        <td style={{ padding: '14px 16px', fontWeight: '600', color: '#334155' }}>{row.teacherName || 'Unknown'}</td>
                        <td style={{ padding: '14px 16px', textAlign: 'center' }}><span style={{ background: '#f1f5f9', padding: '4px 8px', borderRadius: '6px', fontWeight: '700' }}>{row.studentCount}</span></td>
                        <td style={{ padding: '14px 16px', textAlign: 'center', fontWeight: '700', color: row.avg15 === '-' ? '#cbd5e1' : '#0f172a' }}>{row.avg15}</td>
                        <td style={{ padding: '14px 16px', textAlign: 'center', fontWeight: '700', color: row.avg20 === '-' ? '#cbd5e1' : '#0f172a' }}>{row.avg20}</td>
                        <td style={{ padding: '14px 16px', textAlign: 'center', fontWeight: '700', color: row.avg25 === '-' ? '#cbd5e1' : '#0f172a' }}>{row.avg25}</td>
                        <td style={{ padding: '14px 16px', textAlign: 'center', fontWeight: '700', color: row.avg40 === '-' ? '#cbd5e1' : '#0f172a' }}>{row.avg40}</td>
                        <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                          {row.avg100 !== '-' ? <span style={{ background: '#dbeafe', color: '#1e40af', padding: '4px 8px', borderRadius: '6px', fontWeight: '800' }}>{row.avg100}</span> : <span style={{ color: '#94a3b8' }}>-</span>}
                        </td>
                        <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                          {row.avg30 !== '-' ? <span style={{ background: '#d1fae5', color: '#047857', padding: '4px 8px', borderRadius: '6px', fontWeight: '800' }}>{row.avg30}</span> : <span style={{ color: '#94a3b8' }}>-</span>}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ReminderManager() {
  const [weekName, setWeekName] = useState('Week 3');
  const [targetConfigs, setTargetConfigs] = useState({}); // Stores { "Fiqh": "15", "Hadith": "20" }
  const [message, setMessage] = useState('Please complete your mark entry for this week.');
  const [isActive, setIsActive] = useState(false);
  const [trackerData, setTrackerData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchTrackerData = async () => {
    setIsLoading(true);
    try {
      const [tSnap, sSnap, mSnap, cacheSnap] = await Promise.all([
        getDocs(collection(db, 'teachers')),
        getDocs(collection(db, 'students')),
        getDocs(collection(db, 'marks')),
        getDoc(doc(db, 'systemCache', 'activeReminder'))
      ]);

      if (cacheSnap.exists()) {
        const data = cacheSnap.data();
        setWeekName(data.weekName || 'Week 1');
        setMessage(data.message || '');
        setIsActive(data.active || false);

        // BACKWARD COMPATIBILITY: Converts old single-level array to new specific-level object
        if (data.targetConfigs) {
          setTargetConfigs(data.targetConfigs);
        } else if (data.targetSubjects) {
          let migratedConf = {};
          const fallbackLvl = data.level || "15";
          if (data.targetSubjects.includes('All')) {
            DEFAULT_SUBJECTS.forEach(s => migratedConf[s] = fallbackLvl);
          } else {
            data.targetSubjects.forEach(s => { if (s !== 'All') migratedConf[s] = fallbackLvl; });
          }
          setTargetConfigs(migratedConf);
        }
      }

      const students = []; sSnap.forEach(d => students.push({ id: d.id, ...d.data() }));
      const marks = {}; mSnap.forEach(d => marks[d.id] = d.data());
      const trackList = [];

      // Determine which configs to use for tracking
      let activeConfigs = targetConfigs;
      if (cacheSnap.exists() && cacheSnap.data().targetConfigs) {
        activeConfigs = cacheSnap.data().targetConfigs;
      }

      tSnap.forEach(tDoc => {
        const teacher = tDoc.data();
        if (!teacher.enrollments) return;

        teacher.enrollments.forEach(env => {
          const exactSubject = (env.alias?.toUpperCase().includes('U :FIQH') || env.subject?.toUpperCase().includes('U :FIQH')) ? 'U :FIQH' : (env.subject || '');
          const actUp = exactSubject.toUpperCase();

          // 🌟 ONLY track if this exact subject was selected in the config
          const matchingSubKey = Object.keys(activeConfigs).find(k => k.toUpperCase() === actUp);
          if (!matchingSubKey) return; // Skip if not active this week

          const requiredLevel = activeConfigs[matchingSubKey];
          const envAliasLower = String(env.alias || '').trim().toLowerCase();
          const envLang = (env.langTag || '').toLowerCase();

          // Your exact preserved student matching logic
          const matchedStudents = students.filter(student => {
            const studentClassesLower = (student.classes || []).map(c => String(c).trim().toLowerCase());
            const isUrdu = String(student.adNo || '').toUpperCase().startsWith('U');
            if (env.studentIds && Array.isArray(env.studentIds)) {
              const savedIds = env.studentIds.map(id => String(id).trim());
              if (savedIds.includes(student.regNo) || savedIds.includes(student.adNo)) return true;
            }
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
          });

          let missingCount = 0;
          matchedStudents.forEach(st => {
            const stMarks = marks[st.regNo] || marks[st.id] || marks[st.adNo];
            let hasMark = false;
            if (stMarks) {
              const foundKey = Object.keys(stMarks).find(k => {
                const kUp = k.trim().toUpperCase();
                if (actUp.includes('U :FIQH') || actUp.includes('U:FIQH')) return kUp.includes('U :FIQH') || kUp.includes('U:FIQH');
                if (actUp === 'FIQH') return kUp === 'FIQH';
                return kUp === actUp;
              });

              // 🌟 Verify the specific required level exists
              if (foundKey && stMarks[foundKey] && stMarks[foundKey][requiredLevel] !== undefined && stMarks[foundKey][requiredLevel] !== '') {
                hasMark = true;
              }
            }
            if (!hasMark) missingCount++;
          });

          if (matchedStudents.length > 0) {
            trackList.push({
              teacherName: teacher.fullName,
              subject: env.alias || env.subject,
              levelRequired: requiredLevel, // Storing specific level for UI
              totalEnrolled: matchedStudents.length,
              missingCount: missingCount,
              enteredCount: matchedStudents.length - missingCount,
              isComplete: missingCount === 0
            });
          }
        });
      });
      setTrackerData(trackList);
    } catch (err) { console.error(err); }
    setIsLoading(false);
  };

  useEffect(() => { fetchTrackerData(); }, []);

  const handleSave = async () => {
    setIsLoading(true);
    await setDoc(doc(db, 'systemCache', 'activeReminder'), {
      weekName: weekName,
      targetConfigs: targetConfigs, // Saves the subject:level mapping perfectly
      message: message,
      active: isActive,
      updatedAt: new Date().toISOString()
    });
    alert('Reminder settings updated and broadcasted to teachers & students!');
    fetchTrackerData();
  };

  // 🌟 New Subject Toggle Logic
  const toggleSubjectConfig = (sub) => {
    setTargetConfigs(prev => {
      const newConf = { ...prev };
      if (newConf[sub]) {
        delete newConf[sub]; // Uncheck
      } else {
        newConf[sub] = "15"; // Check (Default to Level 1 / 15 marks)
      }
      return newConf;
    });
  };

  const updateSubjectLevel = (sub, level) => {
    setTargetConfigs(prev => ({ ...prev, [sub]: level }));
  };

  return (
    <div style={styles.card}>
      <h3 style={styles.sectionTitle}>📅 Weekly Mark Entry Reminder & Tracker</h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginBottom: '24px', background: '#f8fafc', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px' }}>
          <div style={{ flex: '1 1 150px' }}>
            <label style={styles.label}>Academic Week:</label>
            <input type="text" value={weekName} onChange={(e) => setWeekName(e.target.value)} placeholder="e.g. Week 3" style={styles.input} />
          </div>
          <div style={{ flex: '2 1 300px' }}>
            <label style={styles.label}>Reminder Message for Teachers & Students:</label>
            <input type="text" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. Please complete your mark entry for this week." style={styles.input} />
          </div>
        </div>

        <div>
          <label style={styles.label}>Select Subjects & Assign Specific Levels:</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', background: '#ffffff', padding: '20px', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
            {DEFAULT_SUBJECTS.map(sub => (
              <div key={sub} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: targetConfigs[sub] ? '#eff6ff' : '#f8fafc', padding: '8px 12px', borderRadius: '8px', border: `1px solid ${targetConfigs[sub] ? '#bfdbfe' : '#e2e8f0'}` }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', cursor: 'pointer', color: '#0f172a', fontWeight: '700' }}>
                  <input type="checkbox" checked={!!targetConfigs[sub]} onChange={() => toggleSubjectConfig(sub)} style={{ width: '16px', height: '16px', accentColor: '#2563eb' }} />
                  {sub}
                </label>
                {/* Dynamic Dropdown that only appears when subject is checked */}
                {targetConfigs[sub] && (
                  <select value={targetConfigs[sub]} onChange={(e) => updateSubjectLevel(sub, e.target.value)} style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #93c5fd', fontSize: '12px', outline: 'none', fontWeight: '700', color: '#1e40af', background: '#ffffff', cursor: 'pointer' }}>
                    {Object.entries(CCE_LEVELS).map(([name, val]) => (
                      <option key={val} value={val}>{name} (/{val})</option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', marginTop: '8px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '700', color: isActive ? '#047857' : '#64748b', background: isActive ? '#d1fae5' : '#e2e8f0', padding: '12px 16px', borderRadius: '8px', cursor: 'pointer', border: `1px solid ${isActive ? '#34d399' : '#cbd5e1'}` }}>
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} style={{ width: '18px', height: '18px' }} />
            {isActive ? 'Reminder is ACTIVE' : 'Reminder is OFF'}
          </label>
          <button onClick={handleSave} disabled={isLoading} style={{ ...styles.buttonPrimary, padding: '12px 24px', margin: 0 }}>
            {isLoading ? 'Saving...' : 'Save & Broadcast'}
          </button>
        </div>
      </div>

      <h4 style={{ margin: '0 0 16px 0', color: '#0f172a', fontWeight: '800' }}>
        Teacher Completion Tracker ({weekName})
      </h4>
      <div style={{ overflowX: 'auto', border: '1px solid #cbd5e1', borderRadius: '12px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '15px', minWidth: '800px' }}>
          <thead>
            <tr style={{ background: '#f1f5f9', borderBottom: '2px solid #cbd5e1' }}>
              <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800' }}>Teacher Name</th>
              <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800' }}>Subject Assignment</th>
              <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', textAlign: 'center' }}>Target Level</th>
              <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', textAlign: 'center' }}>Enrolled</th>
              <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', textAlign: 'center' }}>Missing</th>
              <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', textAlign: 'center' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {trackerData.length === 0 ? (
              <tr><td colSpan="6" style={{ padding: '20px', textAlign: 'center', color: '#64748b' }}>No teachers match this week's active targets.</td></tr>
            ) : (
              trackerData.map((row, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0', background: '#ffffff' }}>
                  <td style={{ padding: '14px 16px', fontWeight: '800', color: '#0f172a' }}>{row.teacherName}</td>
                  <td style={{ padding: '14px 16px', color: '#334155', fontWeight: '700' }}>{row.subject}</td>
                  <td style={{ padding: '14px 16px', textAlign: 'center' }}><span style={{ background: '#e0f2fe', color: '#0369a1', padding: '4px 8px', borderRadius: '6px', fontWeight: '800', fontSize: '13px' }}>Max {row.levelRequired}</span></td>
                  <td style={{ padding: '14px 16px', textAlign: 'center', fontWeight: '700', color: '#64748b' }}>{row.totalEnrolled}</td>
                  <td style={{ padding: '14px 16px', textAlign: 'center', fontWeight: '800', color: row.missingCount > 0 ? '#ef4444' : '#10b981' }}>{row.missingCount}</td>
                  <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                    {row.missingCount === 0 ? (
                      <span style={{ background: '#d1fae5', color: '#047857', padding: '6px 12px', borderRadius: '6px', fontWeight: '800', fontSize: '13px' }}>✅ DONE</span>
                    ) : row.enteredCount > 0 ? (
                      <span style={{ background: '#fef3c7', color: '#d97706', padding: '6px 12px', borderRadius: '6px', fontWeight: '800', fontSize: '13px' }}>⏳ IN PROGRESS</span>
                    ) : (
                      <span style={{ background: '#fee2e2', color: '#dc2626', padding: '6px 12px', borderRadius: '6px', fontWeight: '800', fontSize: '13px' }}>❌ PENDING</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function UnifiedSchoolPortal() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const [userRole, setUserRole] = useState(null);
  const [loggedInTeacherData, setLoggedInTeacherData] = useState(null);
  const [activeAdminTab, setActiveAdminTab] = useState('teachers');

  useEffect(() => {
    if (localStorage.getItem('isAdminAuth') === 'true') {
      setUserRole('admin');
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user && user.email && user.email.endsWith('@school.com')) {
        const safeUsername = user.email.split('@')[0];
        const docRef = doc(db, "teachers", safeUsername);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setLoggedInTeacherData(docSnap.data());
          setUserRole('teacher');
        }
      }
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    setIsLoading(true);

    const rawUsername = username.trim().toLowerCase();
    const safeUsername = rawUsername.replace(/[^a-z0-9_.-]/g, '');

    if (rawUsername === 'admin' && password === 'admin123') {
      localStorage.setItem('isAdminAuth', 'true');
      setUserRole('admin');
      setIsLoading(false);
      return;
    }

    try {
      const fakeEmail = `${safeUsername}@school.com`;
      await signInWithEmailAndPassword(auth, fakeEmail, password.trim());

      const docRef = doc(db, "teachers", safeUsername);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        setLoggedInTeacherData(docSnap.data());
        setUserRole('teacher');
      } else {
        setLoginError('Teacher profile data not found.');
        await signOut(auth);
      }
    } catch (err) {
      console.error("Login Error:", err);
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setLoginError('Incorrect password or username.');
      } else if (err.code === 'auth/user-not-found') {
        setLoginError('Username does not exist in the database.');
      } else {
        setLoginError('Login failed. Please check credentials.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    localStorage.removeItem('isAdminAuth');
    setUserRole(null);
    setLoggedInTeacherData(null);
    setUsername(''); setPassword('');
  };

  if (userRole === 'admin') {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#f0f2f5', padding: '32px 20px', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <InstallAppBanner />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '28px', background: '#ffffff', padding: '24px 32px', borderRadius: '16px', border: '1px solid #e2e8f0', flexWrap: 'wrap', gap: '20px', boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }}>
            <h1 style={{ margin: 0, fontSize: '26px', fontWeight: '800', color: '#0f172a' }}>Admin Dashboard</h1>
            <button onClick={handleLogout} style={styles.buttonDanger}>Logout</button>
          </div>

          <div style={{ display: 'flex', gap: '12px', marginBottom: '28px', flexWrap: 'wrap' }}>
            <button onClick={() => setActiveAdminTab('teachers')} style={{ padding: '12px 22px', background: activeAdminTab === 'teachers' ? '#2563eb' : '#ffffff', color: activeAdminTab === 'teachers' ? '#ffffff' : '#1e293b', border: '1px solid #cbd5e1', borderRadius: '10px', fontWeight: '800', cursor: 'pointer', fontSize: '15px', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>👥 Manage Teachers</button>
            <button onClick={() => setActiveAdminTab('students')} style={{ padding: '12px 22px', background: activeAdminTab === 'students' ? '#2563eb' : '#ffffff', color: activeAdminTab === 'students' ? '#ffffff' : '#1e293b', border: '1px solid #cbd5e1', borderRadius: '10px', fontWeight: '800', cursor: 'pointer', fontSize: '15px', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>🎓 Manage Students</button>
            <button onClick={() => setActiveAdminTab('reports')} style={{ padding: '12px 22px', background: activeAdminTab === 'reports' ? '#2563eb' : '#ffffff', color: activeAdminTab === 'reports' ? '#ffffff' : '#1e293b', border: '1px solid #cbd5e1', borderRadius: '10px', fontWeight: '800', cursor: 'pointer', fontSize: '15px', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>📊 Reports & Export</button>
            <button onClick={() => setActiveAdminTab('reminders')} style={{ padding: '12px 22px', background: activeAdminTab === 'reminders' ? '#2563eb' : '#ffffff', color: activeAdminTab === 'reminders' ? '#ffffff' : '#1e293b', border: '1px solid #cbd5e1', borderRadius: '10px', fontWeight: '800', cursor: 'pointer', fontSize: '15px', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>🔔 Weekly Reminders</button>
          </div>

          {activeAdminTab === 'teachers' && <TeacherManager />}
          {activeAdminTab === 'students' && <StudentManager />}
          {activeAdminTab === 'reports' && <ReportManager />}
          {activeAdminTab === 'reminders' && <ReminderManager />}

        </div>
      </div>
    );
  }

  if (userRole === 'teacher') {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#f0f2f5', padding: '32px 20px', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <InstallAppBanner />
          <TeacherPortalView loggedInTeacher={loggedInTeacherData} onLogout={handleLogout} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f0f2f5', fontFamily: 'Inter, system-ui, sans-serif', padding: '16px', boxSizing: 'border-box' }}>
      <div style={{ width: '100%', maxWidth: '440px' }}>
        <InstallAppBanner />
        <div style={{ background: '#ffffff', padding: '40px 32px', borderRadius: '16px', boxShadow: '0 10px 25px rgba(0,0,0,0.08)', border: '1px solid #e2e8f0', boxSizing: 'border-box' }}>
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <span style={{ fontSize: '42px', display: 'block', marginBottom: '10px' }}>🏫</span>
            <h2 style={{ color: '#0f172a', margin: '0 0 8px 0', fontSize: '26px', fontWeight: '800' }}>School Portal</h2>
            <p style={{ color: '#64748b', fontSize: '15px', margin: 0, fontWeight: '500' }}>Sign in with your Admin or Teacher Portal account</p>
          </div>

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <label style={styles.label}>Username</label>
              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. admin or username" required style={styles.input} />
            </div>
            <div>
              <label style={styles.label}>Password</label>
              <div style={{ display: 'flex', position: 'relative' }}>
                <input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required style={styles.input} />
                <button type="button" onClick={() => setShowPassword(!showPassword)} style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#2563eb', fontWeight: '700', cursor: 'pointer', fontSize: '14px' }}>{showPassword ? "Hide" : "Show"}</button>
              </div>
            </div>

            {loginError && <div style={{ padding: '12px', background: '#fef2f2', color: '#b91c1c', borderRadius: '8px', fontSize: '14px', fontWeight: '700', textAlign: 'center' }}>{loginError}</div>}

            <button type="submit" disabled={isLoading} style={{ ...styles.buttonPrimary, width: '100%', padding: '14px', fontWeight: '800', marginTop: '6px', opacity: isLoading ? 0.7 : 1 }}>
              {isLoading ? 'Signing In...' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}