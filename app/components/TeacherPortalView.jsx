'use client';
import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { auth, db } from '../../lib/firebase';
import { updatePassword } from 'firebase/auth';
import { doc, setDoc, getDoc, getDocs, collection } from 'firebase/firestore';
import ReportManager from './ReportManager';
import NightAttendanceManager from './NightAttendanceManager';
import PeriodAttendanceManager, { isAttendanceOnlyEnrollment } from './PeriodAttendanceManager';
import OutPassPortal from '../outpass/page';
import {
  WEB_APP_URL, DHIU_LOGO_URL, CCE_LEVELS, HIFZ_LEVELS,
  styles, sortStudentsByDepartment
} from './erpConstants';
import {
  HighContrastStyles,
  StudentPortfolioModal,
  MentorAndOutreachTab,
  doesClassMatchAlias
} from './ErpExtensions';

// 🌟 Single direct /30 mark level for Specialization
const SPECIALIZATION_LEVELS = {
  'Direct Mark (Max 30)': '30'
};

// 🌟 STRICT ENROLLMENT STUDENT MATCHER FOR TEACHER PORTAL
function doesStudentBelongToTeacherEnrollment(student, env) {
  if (!student || !env) return false;

  const sReg = String(student.regNo || '').trim().toUpperCase();
  const sAd = String(student.adNo || '').trim().toUpperCase();
  const sId = String(student.id || '').trim().toUpperCase();
  const isUrdu = sAd.startsWith('U');

  if (Array.isArray(env.studentIds) && env.studentIds.length > 0) {
    const savedIds = env.studentIds.map(id => String(id).trim().toUpperCase()).filter(Boolean);
    if (savedIds.length > 0) {
      return savedIds.includes(sReg) || savedIds.includes(sAd) || savedIds.includes(sId);
    }
  }

  const classMatch = doesClassMatchAlias(
    student.classes || [student.class],
    env.targetClass,
    env.alias,
    env.grade
  );
  if (!classMatch) return false;

  const envLang = String(env.langTag || '').trim().toLowerCase();
  const aliasLow = String(env.alias || '').trim().toLowerCase();
  const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const aliasNorm = norm(env.alias);
  const targetNorm = norm(env.targetClass);

  const KNOWN_SPECIFIC_CLASSES = [
    'QH1', 'AL1', 'ALC1', 'FC1',
    'QH2', 'AL2', 'ALC2', 'FC2',
    'QLA3', 'HFC3', 'QH3', 'AL3', 'FC3'
  ];
  const isSpecificClassBatch = KNOWN_SPECIFIC_CLASSES.some(
    cls => aliasNorm.includes(cls) || targetNorm.includes(cls)
  );

  const isStrictlyUrdu = (envLang.includes('urdu') && !envLang.includes('non')) || /\bu(8|9|10)\b/.test(aliasLow);
  const isStrictlyNonUrdu = envLang.includes('non-urdu') || envLang.includes('non urdu') || /\bm(8|9|10)\b/.test(aliasLow);

  if (isStrictlyUrdu) return isUrdu;
  if (isStrictlyNonUrdu) return !isUrdu;
  if (isSpecificClassBatch) return true;
  if (envLang.includes('gen')) return !isUrdu;
  return true;
}

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
      if (!user) throw new Error('No active user session found. Please log in again.');
      await updatePassword(user, newPassword);
      setStatus('Password updated successfully!');
      setNewPassword('');
      setConfirmPassword('');
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

export default function TeacherPortalView({ loggedInTeacher, onLogout }) {
  const myUsername = String(loggedInTeacher?.username || '').toLowerCase();

  const [allStudentsCache, setAllStudentsCache] = useState([]);
  const [allTeachersCache, setAllTeachersCache] = useState([]);

  useEffect(() => {
    async function fetchStudentsAndTeachers() {
      try {
        const [sSnap, tSnap] = await Promise.all([
          getDocs(collection(db, 'students')),
          getDocs(collection(db, 'teachers'))
        ]);
        const sData = [];
        sSnap.forEach((d) => sData.push({ id: d.id, ...d.data() }));
        sData.sort((a, b) => (Number(a.rollNo) || 999) - (Number(b.rollNo) || 999));
        setAllStudentsCache(sData);

        const tData = [];
        tSnap.forEach((d) => tData.push({ id: d.id, ...d.data() }));
        setAllTeachersCache(tData);
      } catch (error) {
        console.error('Student fetch error:', error);
      }
    }
    fetchStudentsAndTeachers();
  }, []);

  const myClassTeacherOf = React.useMemo(() => {
    return loggedInTeacher?.outpassPrivileges?.classTeacherOf || [];
  }, [loggedInTeacher?.outpassPrivileges?.classTeacherOf]);

  // 🌟 MARK ENTRY ENROLLMENTS: Excludes Attendance-Only subjects (like Speech Practice / PKV) and deduplicates Hifz!
  const teacherEnrollments = React.useMemo(() => {
    const rawBase = (Array.isArray(loggedInTeacher?.enrollments) ? [...loggedInTeacher.enrollments] : [])
      .filter(e => !isAttendanceOnlyEnrollment(e));

    const normalizeCls = (str) => String(str || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

    const seenHifzClasses = new Set();
    const base = rawBase.filter(e => {
      const isSubHifz = String(e.subject || '').toUpperCase() === 'HIFZ' || String(e.alias || '').toUpperCase().includes('HIFZ');
      if (!isSubHifz) return true;
      const normTarget = normalizeCls(e.targetClass || e.alias).replace('HIFZ', '');
      if (normTarget && seenHifzClasses.has(normTarget)) return false;
      if (normTarget) seenHifzClasses.add(normTarget);
      return true;
    });

    myClassTeacherOf.forEach(clsName => {
      const normCls = normalizeCls(clsName);
      const hasHifz = base.some(e => {
        const isSubHifz = String(e.subject || '').toUpperCase() === 'HIFZ' || String(e.alias || '').toUpperCase().includes('HIFZ');
        const normTarget = normalizeCls(e.targetClass);
        const normAlias = normalizeCls(e.alias);
        return isSubHifz && (normTarget === normCls || normAlias.includes(normCls));
      });
      if (!hasHifz) {
        const gMatch = String(clsName).match(/\d+/);
        base.push({
          id: `auto_hifz_${normCls}`,
          grade: gMatch ? gMatch[0] : '1',
          targetClass: clsName,
          subject: 'Hifz',
          alias: `${clsName} Hifz`,
          langTag: '',
          studentIds: []
        });
      }
    });
    return base;
  }, [loggedInTeacher, myClassTeacherOf]);

  const [activeView, setActiveView] = useState('marks'); // 'marks' | 'period_attendance' | 'mentees' | 'attendance' | 'outpass' | 'outreach_dept' | 'academic_coord' | 'settings'
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState('');
  const [cceLevel, setCceLevel] = useState('');
  const [isEditingUnlocked, setIsEditingUnlocked] = useState(false);
  const [isCompactMode, setIsCompactMode] = useState(false);

  const currentEnrollment = teacherEnrollments.find(e => e.id === selectedEnrollmentId);
  const isHifz = currentEnrollment?.subject?.toUpperCase() === 'HIFZ';
  const isSpecialization =
    currentEnrollment?.subject?.toUpperCase() === 'SPECIALIZATION' ||
    currentEnrollment?.alias?.toUpperCase().includes('SPECIALIZATION');

  const activeLevels = isHifz
    ? HIFZ_LEVELS
    : isSpecialization
      ? SPECIALIZATION_LEVELS
      : CCE_LEVELS;

  const handleSelectSubject = (envId) => {
    setSelectedEnrollmentId(envId);
    const chosenEnv = teacherEnrollments.find(e => e.id === envId);
    const isSpec = chosenEnv?.subject?.toUpperCase() === 'SPECIALIZATION' || chosenEnv?.alias?.toUpperCase().includes('SPECIALIZATION');
    setCceLevel(isSpec ? 'Direct Mark (Max 30)' : '');
    setIsEditingUnlocked(false);
    setStatusMsg('');
  };

  const handleSelectLevel = (newLevel) => {
    setCceLevel(newLevel);
    setIsEditingUnlocked(false);
  };

  const assessmentMaxMark = cceLevel ? activeLevels[cceLevel] : null;
  const maxAllowed = isHifz ? 50 : isSpecialization ? 30 : (assessmentMaxMark ? Number(assessmentMaxMark) : 100);

  const [classStudents, setClassStudents] = useState([]);
  const [studentMarks, setStudentMarks] = useState({});
  const [statusMsg, setStatusMsg] = useState('');
  const [weeklyReminder, setWeeklyReminder] = useState(null);
  const [reminderChecklist, setReminderChecklist] = useState([]);
  const [autoSaveStatus, setAutoSaveStatus] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [portfolioStudent, setPortfolioStudent] = useState(null);
  const [adminBroadcast, setAdminBroadcast] = useState(null);

  const [mentorshipConfig, setMentorshipConfig] = useState({
    semesterName: 'Current Semester',
    minConsultations: 3,
    targetDeadline: ''
  });

  useEffect(() => {
    getDoc(doc(db, 'systemCache', 'mentorshipConfig')).then(snap => {
      if (snap.exists()) setMentorshipConfig(prev => ({ ...prev, ...snap.data() }));
    }).catch(() => {});
  }, []);

  const myAssignedMentees = allStudentsCache.filter(
    s => String(s.mentorUsername || '').trim().toLowerCase() === myUsername
  );
  const minSittingsReq = Number(mentorshipConfig.minConsultations) || 3;
  const menteesMetTargetCount = myAssignedMentees.filter(s => {
    const logs = Array.isArray(s.mentorLogs) ? s.mentorLogs : (s.consultationLogs || []);
    return logs.length >= minSittingsReq;
  }).length;
  const menteesPendingTargetCount = myAssignedMentees.length - menteesMetTargetCount;

  const canEditStudentPortfolio = (st) => {
    if (!st) return false;
    const priv = loggedInTeacher?.outpassPrivileges || {};
    const isUrdu = String(st.adNo || '').trim().toUpperCase().startsWith('U');
    if (priv.isPrincipal || priv.isOutreachCoordinator) return true;
    if (priv.isNiicsCoordinator && isUrdu) return true;
    if (String(st.mentorUsername || '').toLowerCase() === myUsername) return true;
    if (String(st.classTeacherUsername || '').toLowerCase() === myUsername) return true;
    if ((st.classes || []).some(c => myClassTeacherOf.includes(c))) return true;
    return false;
  };

  useEffect(() => {
    getDoc(doc(db, 'systemCache', 'teacherBroadcast')).then(snap => {
      if (snap.exists() && snap.data().active) {
        const data = snap.data();
        const targets = data.targetTeachers || [];
        if (targets.length === 0 || targets.includes(loggedInTeacher?.username)) {
          setAdminBroadcast(data);
        }
      }
    }).catch(() => {});
  }, [loggedInTeacher]);

  useEffect(() => {
    async function fetchReminderAndChecklist() {
      try {
        const snap = await getDoc(doc(db, 'systemCache', 'activeReminder'));
        if (snap.exists() && snap.data().active) {
          const reminderData = snap.data();
          setWeeklyReminder(reminderData);

          if (allStudentsCache.length > 0) {
            const checklist = [];
            let configs = reminderData.targetConfigs;
            if (!configs && reminderData.targetSubjects) {
              configs = {};
              reminderData.targetSubjects.forEach(s => configs[s] = [reminderData.level || '15']);
            }

            for (const env of teacherEnrollments) {
              const exactSubject = (env.alias?.toUpperCase().includes('U :FIQH') || env.subject?.toUpperCase().includes('U :FIQH')) ? 'U :FIQH' : (env.subject || '');
              const actUp = exactSubject.toUpperCase();
              const matchingSubKey = Object.keys(configs || {}).find(k => k.toUpperCase() === actUp);
              if (!matchingSubKey) continue;

              const rawLevels = configs[matchingSubKey];
              const requiredLevelsArray = Array.isArray(rawLevels) ? rawLevels : [rawLevels];

              const matchedStudents = allStudentsCache.filter(student =>
                doesStudentBelongToTeacherEnrollment(student, env)
              );

              if (matchedStudents.length === 0) continue;

              const markPromises = matchedStudents.map(st => getDoc(doc(db, 'marks', st.regNo)));
              const markDocs = await Promise.all(markPromises);

              for (const requiredLevel of requiredLevelsArray) {
                let missingCount = 0;
                markDocs.forEach(docSnap => {
                  let hasMark = false;
                  if (docSnap.exists()) {
                    const mData = docSnap.data();
                    const foundKey = Object.keys(mData).find(k => {
                      const kUp = k.trim().toUpperCase();
                      if (actUp.includes('U :FIQH') || actUp.includes('U:FIQH')) return kUp.includes('U :FIQH') || kUp.includes('U:FIQH');
                      if (actUp === 'FIQH') return kUp === 'FIQH';
                      return kUp === actUp;
                    });
                    if (foundKey && mData[foundKey] && mData[foundKey][requiredLevel] !== undefined && mData[foundKey][requiredLevel] !== '') {
                      hasMark = true;
                    }
                  }
                  if (!hasMark) missingCount++;
                });

                const lvlDisplay = requiredLevel === '50_1' ? 'Part 1 (50)' : requiredLevel === '50_2' ? 'Part 2 (50)' : `${requiredLevel} max`;
                checklist.push({
                  alias: env.alias || env.subject,
                  targetLevel: lvlDisplay,
                  missing: missingCount,
                  entered: matchedStudents.length - missingCount,
                  total: matchedStudents.length
                });
              }
            }
            setReminderChecklist(checklist);
          }
        } else {
          setWeeklyReminder(null);
        }
      } catch (error) {
        console.error('Reminder fetch error:', error);
      }
    }
    fetchReminderAndChecklist();
  }, [loggedInTeacher, allStudentsCache, studentMarks, teacherEnrollments]);

  useEffect(() => {
    if (!selectedEnrollmentId || allStudentsCache.length === 0) {
      setClassStudents([]);
      return;
    }
    const currentEnrollment = teacherEnrollments.find(e => e.id === selectedEnrollmentId);
    if (!currentEnrollment) return;

    const matchedStudents = allStudentsCache.filter(student =>
      doesStudentBelongToTeacherEnrollment(student, currentEnrollment)
    );

    const targetClassName = currentEnrollment.alias || `Grade ${currentEnrollment.grade || ''} ${currentEnrollment.subject || ''}`;
    const sortedStudents = typeof sortStudentsByDepartment === 'function' ? sortStudentsByDepartment(matchedStudents, targetClassName) : matchedStudents;
    setClassStudents(sortedStudents);
  }, [selectedEnrollmentId, allStudentsCache, teacherEnrollments]);

  useEffect(() => {
    if (!selectedEnrollmentId || classStudents.length === 0) return;
    const currentEnrollment = teacherEnrollments.find(e => e.id === selectedEnrollmentId);
    if (!currentEnrollment) return;

    const rawSub = (currentEnrollment.subject || '').trim();
    const rawAlias = (currentEnrollment.alias || '').trim();
    let finalSubjectKey = rawSub;
    if (rawAlias.toUpperCase().includes('U :FIQH') || rawSub.toUpperCase().includes('U :FIQH')) {
      finalSubjectKey = 'U :FIQH';
    } else if (rawSub.toUpperCase() === 'MANTIQ') {
      finalSubjectKey = 'Logic';
    }

    async function fetchExistingMarks() {
      try {
        let newMarks = {};
        const markPromises = classStudents.map(student => getDoc(doc(db, 'marks', student.regNo)));
        const markDocs = await Promise.all(markPromises);

        markDocs.forEach((docSnap, index) => {
          if (docSnap.exists()) {
            const mData = docSnap.data();
            const studentRegNo = classStudents[index].regNo;
            const foundKey = Object.keys(mData).find(k => {
              const kUp = k.trim().toUpperCase();
              const fUp = finalSubjectKey.toUpperCase();
              if (fUp.includes('U :FIQH') || fUp.includes('U:FIQH')) return kUp.includes('U :FIQH') || kUp.includes('U:FIQH');
              if (fUp === 'FIQH') return kUp === 'FIQH';
              return kUp === fUp || kUp === rawSub.toUpperCase();
            });
            newMarks[studentRegNo] = foundKey ? mData[foundKey] : {};
          }
        });

        const savedDraft = localStorage.getItem(`draft_marks_${selectedEnrollmentId}`);
        if (savedDraft) {
          try {
            const parsedDraft = JSON.parse(savedDraft);
            Object.keys(parsedDraft).forEach(reg => {
              newMarks[reg] = { ...(newMarks[reg] || {}), ...parsedDraft[reg] };
            });
          } catch (e) {}
        }

        setStudentMarks(newMarks);
      } catch (err) { console.error('Error loading marks', err); }
    }
    fetchExistingMarks();
  }, [selectedEnrollmentId, classStudents, teacherEnrollments]);

  const handleMarkChange = (studentRegNo, value) => {
    if (!isEditingUnlocked || !assessmentMaxMark) return;
    if (value === '' || /^\d*(\.\d{0,2})?$/.test(value)) {
      const updatedMarks = {
        ...studentMarks,
        [studentRegNo]: {
          ...(studentMarks[studentRegNo] || {}),
          [assessmentMaxMark]: value
        }
      };
      setStudentMarks(updatedMarks);
      setIsDirty(true);
      if (selectedEnrollmentId) {
        localStorage.setItem(`draft_marks_${selectedEnrollmentId}`, JSON.stringify(updatedMarks));
      }
    }
  };

  useEffect(() => {
    if (!isDirty || !selectedEnrollmentId || !assessmentMaxMark || classStudents.length === 0) return;

    const timer = setTimeout(async () => {
      setAutoSaveStatus('Saving draft...');
      const currentEnrollment = teacherEnrollments.find(e => e.id === selectedEnrollmentId);
      if (!currentEnrollment) return;

      const rawSub = (currentEnrollment.subject || '').trim();
      const rawAlias = (currentEnrollment.alias || '').trim();
      let finalSubjectKey = rawSub;
      if (rawAlias.toUpperCase().includes('U :FIQH') || rawSub.toUpperCase().includes('U :FIQH')) finalSubjectKey = 'U :FIQH';
      else if (rawSub.toUpperCase() === 'MANTIQ') finalSubjectKey = 'Logic';

      const firestorePromises = [];
      for (let student of classStudents) {
        let val = studentMarks[student.regNo]?.[assessmentMaxMark];
        if (val !== undefined && val !== '') {
          if (parseFloat(val) <= maxAllowed) {
            firestorePromises.push(setDoc(doc(db, 'marks', student.regNo), { [finalSubjectKey]: { [assessmentMaxMark]: Number(val) } }, { merge: true }));
          }
        }
      }

      try {
        if (firestorePromises.length > 0) {
          await Promise.all(firestorePromises);
          localStorage.removeItem(`draft_marks_${selectedEnrollmentId}`);
          setAutoSaveStatus('✅ Draft Auto-Saved');
          setIsDirty(false);
          setTimeout(() => setAutoSaveStatus(''), 4000);
        }
      } catch (err) {
        setAutoSaveStatus('⚠️ Auto-save failed');
      }
    }, 2500);

    return () => clearTimeout(timer);
  }, [studentMarks, isDirty, selectedEnrollmentId, classStudents, assessmentMaxMark, maxAllowed, teacherEnrollments]);

  const handleKeyDown = (e, currentIndex) => {
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault();
      const nextInput = document.querySelector(`input[data-index="${currentIndex + 1}"]`);
      if (nextInput) nextInput.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevInput = document.querySelector(`input[data-index="${currentIndex - 1}"]`);
      if (prevInput) prevInput.focus();
    }
  };

  const handleDownloadExternalPortalCSV = () => {
    if (classStudents.length === 0) return alert('No students found in this class to download.');
    const headerLabel = isHifz ? 'Marks (Out of 100)' : 'Marks (Out of 30)';
    let csvContent = `data:text/csv;charset=utf-8,Ad.No,${headerLabel}\n`;

    classStudents.forEach(student => {
      const marks = studentMarks[student.regNo] || {};
      if (isSpecialization) {
        const hasSpec = marks['30'] !== undefined && marks['30'] !== '';
        const specScore = hasSpec ? Number(marks['30']) : '';
        csvContent += `${student.adNo},${specScore}\n`;
      } else {
        const m1 = parseFloat(marks[isHifz ? '50_1' : '15']) || 0;
        const m2 = parseFloat(marks[isHifz ? '50_2' : '20']) || 0;
        const m3 = isHifz ? 0 : (parseFloat(marks['25']) || 0);
        const m4 = isHifz ? 0 : (parseFloat(marks['40']) || 0);
        const hasAnyMark = isHifz
          ? (marks['50_1'] !== undefined && marks['50_1'] !== '') || (marks['50_2'] !== undefined && marks['50_2'] !== '')
          : (marks['15'] !== undefined && marks['15'] !== '') || (marks['20'] !== undefined && marks['20'] !== '') || (marks['25'] !== undefined && marks['25'] !== '') || (marks['40'] !== undefined && marks['40'] !== '');
        const total100 = m1 + m2 + m3 + m4;
        let finalScore = hasAnyMark ? (isHifz ? total100 : ((total100 / 100) * 30).toFixed(1)) : '';
        csvContent += `${student.adNo},${finalScore}\n`;
      }
    });

    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    const safeTitle = (currentEnrollment?.alias || 'Class').replace(/[^a-zA-Z0-9]/g, '_');
    link.setAttribute('download', `${safeTitle}_${isHifz ? 'Out_of_100' : 'Out_of_30'}_Portal_Upload.csv`);
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const handleDownloadMarksTemplate = () => {
    if (!assessmentMaxMark) return alert('Please select a Task Level first.');
    if (classStudents.length === 0) return alert('No students found in this class.');
    let csvContent = 'data:text/csv;charset=utf-8,Ad.No,Student Name,Marks (Max ' + maxAllowed + ')\n';
    classStudents.forEach(student => { csvContent += `${student.adNo},"${student.firstName}",\n`; });
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    const safeTitle = (currentEnrollment?.alias || 'Class').replace(/[^a-zA-Z0-9]/g, '_');
    link.setAttribute('download', `${safeTitle}_${cceLevel.replace(/\s+/g, '')}_Marks.csv`);
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const handleUniversalUpload = (e) => {
    if (!assessmentMaxMark || !isEditingUnlocked) {
      e.target.value = null;
      return alert("Please select a Task Level and click 'Unlock to Edit' before uploading.");
    }
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    const fileExtension = file.name.split('.').pop().toLowerCase();

    const processSheetData = (sheetData) => {
      const newMarks = { ...studentMarks };
      let updatedCount = 0, errorCount = 0;

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
      setIsDirty(true);
      alert(`Imported marks for ${updatedCount} students (Skipped ${errorCount} invalid).`);
    };

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
    if (!assessmentMaxMark) return alert('Please select a Task Level first.');
    let marksPayload = [];
    const currentEnrollment = teacherEnrollments.find(e => e.id === selectedEnrollmentId);
    if (!currentEnrollment) return alert('Please select a valid enrollment before saving.');

    const rawSub = (currentEnrollment.subject || '').trim();
    const rawAlias = (currentEnrollment.alias || '').trim();
    let finalSubjectKey = rawSub;
    if (rawAlias.toUpperCase().includes('U :FIQH') || rawSub.toUpperCase().includes('U :FIQH')) finalSubjectKey = 'U :FIQH';
    else if (rawSub.toUpperCase() === 'MANTIQ') finalSubjectKey = 'Logic';

    setStatusMsg('Saving to database...');
    const firestorePromises = [];

    for (let student of classStudents) {
      let val = studentMarks[student.regNo]?.[assessmentMaxMark];
      if (val !== undefined && val !== '') {
        if (parseFloat(val) > maxAllowed) {
          setStatusMsg('');
          return alert(`Marks for ${student.firstName} exceed limit!`);
        }
        marksPayload.push({ studentId: student.regNo, subject: finalSubjectKey, maxMarks: assessmentMaxMark, marksObtained: val });
        firestorePromises.push(setDoc(doc(db, 'marks', student.regNo), { [finalSubjectKey]: { [assessmentMaxMark]: Number(val) } }, { merge: true }));
      }
    }

    try {
      await Promise.all(firestorePromises);

      try {
        const classTag = String(
          currentEnrollment.targetClass ||
          currentEnrollment.alias ||
          `Grade_${currentEnrollment.grade || '1'}`
        ).trim().toUpperCase();
        const subTag = finalSubjectKey.trim().toUpperCase();
        const metaRef = doc(db, 'systemCache', 'studentPortalMeta');
        const metaSnap = await getDoc(metaRef);
        const existingMeta = metaSnap.exists() ? metaSnap.data() : {};
        const startedMap = existingMeta.startedLevels || {};
        const envKey = `${classTag}:::${subTag}`;
        const currentArr = Array.isArray(startedMap[envKey]) ? startedMap[envKey] : [];

        if (!currentArr.includes(String(assessmentMaxMark))) {
          startedMap[envKey] = [...currentArr, String(assessmentMaxMark)];
        }

        const teacherDirectory = (allTeachersCache || []).map(t => ({
          username: t.username,
          fullName: t.fullName,
          designation: t.designation || 'Faculty',
          whatsappNumber: t.whatsappNumber || t.mobileNumber || '',
          email: t.email || '',
          classTeacherOf: t.outpassPrivileges?.classTeacherOf || [],
          enrollments: (t.enrollments || []).map(ev => ({
            id: ev.id,
            grade: ev.grade,
            targetClass: ev.targetClass || '',
            subject: ev.subject,
            alias: ev.alias,
            langTag: ev.langTag,
            isAttendanceOnly: Boolean(ev.isAttendanceOnly),
            studentIds: ev.studentIds || []
          }))
        }));

        await setDoc(metaRef, {
          startedLevels: startedMap,
          teacherDirectory,
          updatedAt: new Date().toISOString()
        }, { merge: true });
      } catch (metaErr) {}

      setIsDirty(false);
      setIsEditingUnlocked(false);
      if (selectedEnrollmentId) localStorage.removeItem(`draft_marks_${selectedEnrollmentId}`);

      if (typeof WEB_APP_URL !== 'undefined' && marksPayload.length > 0) {
        setStatusMsg('Database saved! Syncing to Google Sheets...');
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000);
          const res = await fetch(WEB_APP_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ marks: marksPayload }),
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          const result = await res.json();
          setStatusMsg(result.status === 'success' ? '✅ Marks saved to database AND Google Sheets!' : '⚠️ Firebase updated, Sheets note: ' + result.message);
        } catch (fetchErr) {
          setStatusMsg('✅ Marks saved to Database securely!');
        }
      } else {
        setStatusMsg('✅ Marks saved to database!');
      }
    } catch (err) {
      setStatusMsg('❌ Marks saved to database, but network prevented Sheets sync.');
    }
    setTimeout(() => setStatusMsg(''), 5000);
  };

  // 🌟 STRICT LOCK FOR TEMPORARY EVENT / ARTS FEST STUDENT LEADERS (Only Rehearsal Attendance + Logout!)
  if (loggedInTeacher?.isEventLeader || loggedInTeacher?.roleCategory === 'Event Leader') {
    return (
      <div>
        <HighContrastStyles />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', background: '#ffffff', padding: '18px 24px', borderRadius: '16px', border: '2px solid #7c3aed' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <img src={DHIU_LOGO_URL} alt="DHIU Logo" style={{ width: '48px', height: '48px', borderRadius: '50%', objectFit: 'contain' }} />
            <div>
              <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '900', color: '#4c1d95' }}>🎭 Event / Rehearsal Attendance Portal</h2>
              <div style={{ fontSize: '13px', fontWeight: '700', color: '#6d28d9' }}>Logged in as: {loggedInTeacher.fullName} (@{loggedInTeacher.username})</div>
            </div>
          </div>
          <button onClick={onLogout} style={styles.buttonDanger}>Logout</button>
        </div>

        <PeriodAttendanceManager
          userRole="event_leader"
          loggedInUser={loggedInTeacher}
          preloadedStudents={allStudentsCache}
          preloadedTeachers={allTeachersCache}
          onStudentsUpdated={(nextStudents) => setAllStudentsCache(nextStudents)}
        />
      </div>
    );
  }

  const validMarks = assessmentMaxMark
    ? classStudents.map(s => studentMarks[s.regNo]?.[assessmentMaxMark]).filter(v => v !== undefined && v !== '').map(v => parseFloat(v)).filter(v => !isNaN(v))
    : [];
  const highestScore = validMarks.length > 0 ? Math.max(...validMarks) : 0;
  const classAverage = validMarks.length > 0 ? (validMarks.reduce((a, b) => a + b, 0) / validMarks.length).toFixed(1) : 0;
  const passPercentage = validMarks.length > 0 ? ((validMarks.filter(m => m >= maxAllowed * 0.4).length / validMarks.length) * 100).toFixed(0) : 0;

  return (
    <div>
      <HighContrastStyles />

      {portfolioStudent && (
        <StudentPortfolioModal
          student={portfolioStudent}
          canEditSkills={canEditStudentPortfolio(portfolioStudent)}
          canViewConfidential={canEditStudentPortfolio(portfolioStudent)}
          editorName={loggedInTeacher?.fullName || 'Teacher'}
          onClose={() => setPortfolioStudent(null)}
          onSaved={(updated) => setAllStudentsCache(prev => prev.map(s => s.regNo === updated.regNo ? updated : s))}
        />
      )}

      {/* UNIFIED TEACHER PORTAL TOP BAR */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '22px', background: '#ffffff', padding: '18px 24px', borderRadius: '16px', border: '1px solid #cbd5e1', flexWrap: 'wrap', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <img src={DHIU_LOGO_URL} alt="DHIU Logo" style={{ width: '50px', height: '50px', borderRadius: '50%', objectFit: 'contain', backgroundColor: '#ffffff' }} />
          <div>
            <h1 style={{ margin: '0 0 4px 0', fontSize: '22px', fontWeight: '800', color: '#0f172a' }}>Teacher Portal (Degree Section)</h1>
            <p style={{ margin: 0, color: '#475569', fontSize: '14px', fontWeight: '600' }}>
              Welcome, <strong>{loggedInTeacher?.fullName || 'Teacher'}</strong>
              {loggedInTeacher?.outpassPrivileges?.isNiicsCoordinator && (
                <span style={{ marginLeft: '8px', background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: '800' }}>
                  🎓 NIICS Coordinator
                </span>
              )}
              {myClassTeacherOf.length > 0 && (
                <span style={{ marginLeft: '8px', background: '#dcfce7', color: '#166534', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: '800' }}>
                  🏫 CT: {myClassTeacherOf.join(', ')}
                </span>
              )}
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => { setActiveView('marks'); handleSelectSubject(''); }}
            style={{ padding: '10px 14px', background: activeView === 'marks' ? '#00897b' : '#f8fafc', color: activeView === 'marks' ? '#ffffff' : '#0f172a', border: '1px solid #cbd5e1', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}
          >
            📝 Marks &amp; Subjects
          </button>

          <button
            type="button"
            onClick={() => setActiveView('period_attendance')}
            style={{ padding: '10px 14px', background: activeView === 'period_attendance' ? '#4f46e5' : '#eef2ff', color: activeView === 'period_attendance' ? '#ffffff' : '#3730a3', border: '1.5px solid #6366f1', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}
          >
            📅 Period Attendance &amp; Minus
          </button>

          <button
            type="button"
            onClick={() => setActiveView('mentees')}
            style={{ padding: '10px 14px', background: activeView === 'mentees' ? '#00897b' : '#f8fafc', color: activeView === 'mentees' ? '#ffffff' : '#0f172a', border: '1px solid #cbd5e1', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}
          >
            👨‍🎓 Mentor &amp; Class Portfolio
          </button>

          <button
            type="button"
            onClick={() => setActiveView('attendance')}
            style={{ padding: '10px 14px', background: activeView === 'attendance' ? '#0f172a' : '#f8fafc', color: activeView === 'attendance' ? '#ffffff' : '#0f172a', border: '1px solid #cbd5e1', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}
          >
            🌙 Night Attendance
          </button>

          <button
            type="button"
            onClick={() => setActiveView('outpass')}
            style={{
              background: activeView === 'outpass' ? '#0f766e' : loggedInTeacher?.outpassPrivileges?.isOfficeSecretary ? '#7c3aed' : '#ecfdf5',
              color: activeView === 'outpass' || loggedInTeacher?.outpassPrivileges?.isOfficeSecretary ? '#ffffff' : '#0f766e',
              border: '1.5px solid #0d9488',
              padding: '10px 16px',
              borderRadius: '8px',
              fontWeight: '800',
              cursor: 'pointer',
              fontSize: '13px'
            }}
          >
            🪪 {loggedInTeacher?.outpassPrivileges?.isOfficeSecretary ? 'Office Secretary Out-Pass' : 'Out-Pass Desk'}
          </button>

          {(loggedInTeacher?.outpassPrivileges?.isOutreachCoordinator || loggedInTeacher?.outpassPrivileges?.isPrincipal || loggedInTeacher?.outpassPrivileges?.isNiicsCoordinator) && (
            <button
              type="button"
              onClick={() => setActiveView('outreach_dept')}
              style={{ padding: '10px 14px', background: activeView === 'outreach_dept' ? '#059669' : '#ecfdf5', color: activeView === 'outreach_dept' ? '#ffffff' : '#065f46', border: '1.5px solid #10b981', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}
            >
              🌍 Outreach / All Tracker
            </button>
          )}

          {(loggedInTeacher?.outpassPrivileges?.isAcademicCoordinator || loggedInTeacher?.outpassPrivileges?.isPrincipal || loggedInTeacher?.outpassPrivileges?.isNiicsCoordinator) && (
            <button
              type="button"
              onClick={() => setActiveView('academic_coord')}
              style={{ padding: '10px 14px', background: activeView === 'academic_coord' ? '#1d4ed8' : '#eff6ff', color: activeView === 'academic_coord' ? '#ffffff' : '#1e40af', border: '1.5px solid #60a5fa', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}
            >
              📊 Academic Admin
            </button>
          )}

          <button onClick={() => setActiveView(activeView === 'settings' ? 'marks' : 'settings')} style={{ padding: '10px 12px', background: '#f8fafc', color: '#334155', border: '1px solid #cbd5e1', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}>
            ⚙️ Password
          </button>
          <button onClick={onLogout} style={styles.buttonDanger}>Logout</button>
        </div>
      </div>

      {adminBroadcast && (
        <div style={{ background: '#fef9c3', border: '2px solid #eab308', padding: '16px 20px', borderRadius: '12px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '11px', fontWeight: '900', color: '#854d0e', textTransform: 'uppercase' }}>📢 ADMIN BROADCAST NOTIFICATION</div>
            <div style={{ fontSize: '16px', fontWeight: '800', color: '#0f172a', marginTop: '2px' }}>{adminBroadcast.title}</div>
            <div style={{ fontSize: '14px', fontWeight: '600', color: '#1e293b', marginTop: '2px' }}>{adminBroadcast.message}</div>
          </div>
        </div>
      )}

      {myAssignedMentees.length > 0 && activeView === 'marks' && (
        <div style={{ background: '#f0fdfa', border: '1.5px solid #0d9488', padding: '16px 20px', borderRadius: '12px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <span style={{ background: '#0f766e', color: '#ffffff', padding: '3px 9px', borderRadius: '6px', fontSize: '11px', fontWeight: '900', textTransform: 'uppercase' }}>
              🧭 {mentorshipConfig.semesterName || 'Semester'} Mentorship Target: Min {minSittingsReq} Sittings / Mentee
            </span>
            <div style={{ fontSize: '15px', fontWeight: '800', color: '#0f172a', marginTop: '6px' }}>
              You have <strong>{myAssignedMentees.length} Assigned Mentees</strong> •{' '}
              <span style={{ color: '#047857' }}>{menteesMetTargetCount} Met Target ✅</span> •{' '}
              <span style={{ color: menteesPendingTargetCount > 0 ? '#dc2626' : '#64748b' }}>
                {menteesPendingTargetCount} Pending Sittings ⏳
              </span>
              {mentorshipConfig.targetDeadline ? ` (Deadline: ${mentorshipConfig.targetDeadline})` : ''}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setActiveView('mentees')}
            style={{ padding: '10px 16px', background: '#0d9488', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '800', fontSize: '13px', cursor: 'pointer' }}
          >
            📝 Open Mentees &amp; Log Sitting ➔
          </button>
        </div>
      )}

      {weeklyReminder && reminderChecklist.length > 0 && activeView === 'marks' && (
        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', padding: '20px', borderRadius: '12px', marginBottom: '24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
              {reminderChecklist.map((item, idx) => {
                const isDone = item.missing === 0;
                const inProgress = item.entered > 0 && item.missing > 0;
                let color = '#dc2626';
                let icon = '❌';
                if (isDone) { color = '#047857'; icon = '✅'; }
                else if (inProgress) { color = '#d97706'; icon = '⏳'; }
                return (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: '700', color: color }}>
                    {icon} {item.alias} <span style={{ color: '#64748b', fontSize: '12px', marginLeft: '4px' }}>({item.targetLevel})</span>
                    {!isDone && <span style={{ fontSize: '12px', fontWeight: '600', color: '#ef4444' }}>({item.missing} pending)</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {activeView === 'settings' ? (
        <TeacherPasswordSettings />
      ) : activeView === 'period_attendance' ? (
        <PeriodAttendanceManager
          userRole="teacher"
          loggedInUser={loggedInTeacher}
          preloadedStudents={allStudentsCache}
          preloadedTeachers={allTeachersCache}
          onStudentsUpdated={(nextStudents) => setAllStudentsCache(nextStudents)}
        />
      ) : activeView === 'attendance' ? (
        <NightAttendanceManager
          loggedInTeacher={loggedInTeacher}
          isAdmin={false}
          preloadedStudents={allStudentsCache}
          preloadedTeachers={allTeachersCache}
        />
      ) : activeView === 'outpass' ? (
        <OutPassPortal
          embeddedMode={true}
          isAdminProp={false}
          preloadedTeacherUser={loggedInTeacher}
          preloadedStudents={allStudentsCache}
          preloadedTeachers={allTeachersCache}
        />
      ) : activeView === 'mentees' ? (
        <MentorAndOutreachTab
          students={allStudentsCache}
          teachers={allTeachersCache}
          loggedInTeacher={loggedInTeacher}
          isAdmin={false}
          isOutreachView={false}
          onStudentUpdated={(updated) => setAllStudentsCache(prev => prev.map(s => s.regNo === updated.regNo ? updated : s))}
        />
      ) : activeView === 'outreach_dept' ? (
        <MentorAndOutreachTab
          students={allStudentsCache}
          teachers={allTeachersCache}
          loggedInTeacher={loggedInTeacher}
          isAdmin={false}
          isOutreachView={true}
          onStudentUpdated={(updated) => setAllStudentsCache(prev => prev.map(s => s.regNo === updated.regNo ? updated : s))}
        />
      ) : activeView === 'academic_coord' ? (
        <ReportManager />
      ) : !selectedEnrollmentId ? (
        <div style={styles.card}>
          <h3 style={{ margin: '0 0 8px 0', fontSize: '20px', color: '#0f172a', fontWeight: '800' }}>📚 Select a Subject Assignment (Mark Entry)</h3>
          <p style={{ margin: '0 0 24px 0', fontSize: '14px', color: '#64748b' }}>Choose one of your assigned grading subjects below to view marks or unlock a level for grading.</p>

          {teacherEnrollments.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', color: '#64748b', background: '#f8fafc', borderRadius: '12px', border: '1px dashed #cbd5e1' }}>
              No mark-entry subjects have been assigned to your profile yet.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '16px' }}>
              {teacherEnrollments.map(env => (
                <div
                  key={env.id}
                  onClick={() => handleSelectSubject(env.id)}
                  style={{ padding: '20px', borderRadius: '14px', border: '1px solid #cbd5e1', background: '#ffffff', cursor: 'pointer', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '14px' }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '800' }}>
                        Grade {env.grade || '-'}
                      </span>
                      <span style={{ background: '#f1f5f9', color: '#475569', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '700' }}>
                        {env.langTag || 'General'}
                      </span>
                    </div>
                    <h4 style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: '800', color: '#0f172a' }}>
                      {env.alias || `Grade ${env.grade} ${env.subject}`}
                    </h4>
                    <p style={{ margin: 0, fontSize: '13px', color: '#64748b', fontWeight: '600' }}>
                      Subject: {env.subject}
                    </p>
                  </div>
                  <button type="button" style={{ width: '100%', padding: '10px', background: '#2563eb', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '14px' }}>
                    Open Mark Sheet ➔
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          <div style={styles.card}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', alignItems: 'end' }}>
              <div>
                <label style={styles.label}>1. Selected Subject:</label>
                <select value={selectedEnrollmentId} onChange={(e) => handleSelectSubject(e.target.value)} style={{ ...styles.input, cursor: 'pointer', fontWeight: '700' }}>
                  {teacherEnrollments.map(env => (
                    <option key={env.id} value={env.id}>{env.alias || `Grade ${env.grade} ${env.subject}`} ({env.langTag || 'Gen'})</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={styles.label}>2. Select Level to Grade:</label>
                <select value={cceLevel} onChange={(e) => handleSelectLevel(e.target.value)} style={{ ...styles.input, cursor: 'pointer', fontWeight: '700' }}>
                  <option value="">-- View Only (Select a Level to Edit) --</option>
                  {Object.keys(activeLevels).map(level => (
                    <option key={level} value={level}>
                      {level} (Max {isHifz ? 50 : isSpecialization ? 30 : activeLevels[level]})
                    </option>
                  ))}
                </select>
              </div>

              {cceLevel && (
                <div>
                  <button
                    type="button"
                    onClick={() => setIsEditingUnlocked(!isEditingUnlocked)}
                    style={{
                      width: '100%', padding: '12px 18px', borderRadius: '8px', fontWeight: '800', fontSize: '14px', cursor: 'pointer',
                      border: isEditingUnlocked ? '2px solid #059669' : '2px solid #f59e0b',
                      background: isEditingUnlocked ? '#ecfdf5' : '#fffbeb',
                      color: isEditingUnlocked ? '#047857' : '#b45309'
                    }}
                  >
                    {isEditingUnlocked ? `🔓 ${cceLevel} Unlocked (Click to Lock)` : `🔒 Unlock ${cceLevel} to Enter Marks`}
                  </button>
                </div>
              )}
            </div>
          </div>

          {assessmentMaxMark && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '20px' }}>
              <div style={{ background: '#ffffff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 'bold' }}>CLASS AVERAGE ({cceLevel.toUpperCase()})</span>
                <div style={{ fontSize: '22px', color: '#0f172a', fontWeight: '800', marginTop: '4px' }}>{classAverage} / {maxAllowed}</div>
              </div>
              <div style={{ background: '#ffffff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 'bold' }}>HIGHEST SCORE</span>
                <div style={{ fontSize: '22px', fontWeight: '800', color: '#10b981', marginTop: '4px' }}>{highestScore} / {maxAllowed}</div>
              </div>
              <div style={{ background: '#ffffff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 'bold' }}>PASSING RATE</span>
                <div style={{ fontSize: '22px', fontWeight: '800', color: '#2563eb', marginTop: '4px' }}>{passPercentage}%</div>
              </div>
            </div>
          )}

          <form onSubmit={handleBulkSubmit} style={styles.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', borderBottom: '2px solid #f1f5f9', paddingBottom: '16px', marginBottom: '20px', gap: '16px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '19px', color: '#0f172a', fontWeight: '800' }}>
                  {currentEnrollment?.alias || currentEnrollment?.subject} — Students ({classStudents.length})
                </h3>
                <span style={{ fontSize: '13px', fontWeight: '700', color: isEditingUnlocked ? '#059669' : '#d97706' }}>
                  {!cceLevel
                    ? '🔒 View-Only Mode: Select a Task Level above to grade.'
                    : !isEditingUnlocked
                      ? `🔒 ${cceLevel} is Locked for safety. Click "Unlock ${cceLevel}" above to type marks.`
                      : `✍️ Editing Mode Active for ${cceLevel} (Auto-Save On)`}
                </span>
              </div>

              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <button type="button" onClick={handleDownloadExternalPortalCSV} style={{ padding: '10px 16px', background: '#10b981', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', fontSize: '14px' }}>
                  📊 Download {isHifz ? '(/100)' : '(/30)'} CSV for Portal
                </button>
                {cceLevel && (
                  <button type="button" onClick={() => setIsCompactMode(!isCompactMode)} style={{ padding: '10px 16px', background: isCompactMode ? '#2563eb' : '#f8fafc', color: isCompactMode ? '#ffffff' : '#334155', border: '1px solid #cbd5e1', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '14px' }}>
                    {isCompactMode ? '📋 Full Table View' : '📱 Mobile Quick-Entry'}
                  </button>
                )}
                {cceLevel && (
                  <button type="button" onClick={handleDownloadMarksTemplate} style={{ padding: '10px 16px', background: '#f8fafc', color: '#334155', border: '1px solid #cbd5e1', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '14px' }}>
                    📥 Download Template
                  </button>
                )}
                {cceLevel && isEditingUnlocked && (
                  <label style={{ padding: '10px 16px', background: '#0284c7', color: '#ffffff', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '14px' }}>
                    📂 Upload Spreadsheet
                    <input type="file" accept=".csv, .xlsx" onChange={handleUniversalUpload} style={{ display: 'none' }} />
                  </label>
                )}
              </div>
            </div>

            {classStudents.length === 0 ? (
              <div style={{ padding: '40px', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '12px', textAlign: 'center', color: '#64748b', fontSize: '15px' }}>No students assigned to this subject.</div>
            ) : isCompactMode && assessmentMaxMark ? (
              <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid #cbd5e1', borderRadius: '12px', overflow: 'hidden', marginBottom: '24px' }}>
                <div style={{ background: '#f8fafc', padding: '12px 16px', borderBottom: '2px solid #cbd5e1', display: 'flex', justifyContent: 'space-between', fontWeight: '800', color: '#0f172a', fontSize: '14px' }}>
                  <span>Student Details</span>
                  <span style={{ color: '#0369a1' }}>{cceLevel} (Max {maxAllowed})</span>
                </div>
                {classStudents.map((student, index) => {
                  const marks = studentMarks[student.regNo] || {};
                  const specScore = parseFloat(marks['30']) || 0;
                  const m1 = parseFloat(marks[isHifz ? '50_1' : '15']) || 0;
                  const m2 = parseFloat(marks[isHifz ? '50_2' : '20']) || 0;
                  const m3 = isHifz ? 0 : (parseFloat(marks['25']) || 0);
                  const m4 = isHifz ? 0 : (parseFloat(marks['40']) || 0);
                  const totalDisplay = isSpecialization
                    ? (marks['30'] !== undefined && marks['30'] !== '' ? `${specScore}/30` : '-')
                    : ((m1 + m2 + m3 + m4) > 0 ? `${m1 + m2 + m3 + m4}/100` : '-');
                  const canOpenPortfolio = canEditStudentPortfolio(student);

                  return (
                    <div key={student.regNo} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #e2e8f0', background: index % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                      <div>
                        <div style={{ fontWeight: '800', color: '#0f172a', fontSize: '15px' }}>
                          <span style={{ color: '#64748b', marginRight: '8px' }}>#{student.rollNo || '-'}</span>
                          {student.firstName}
                          {canOpenPortfolio && (
                            <button type="button" onClick={() => setPortfolioStudent(student)} style={{ marginLeft: '8px', padding: '3px 8px', fontSize: '11px', background: '#f0fdfa', color: '#0f766e', border: '1px solid #99f6e4', borderRadius: '6px', cursor: 'pointer', fontWeight: '700' }}>
                              🏆 Details
                            </button>
                          )}
                        </div>
                        <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '600', marginTop: '4px' }}>
                          Ad.No: <strong>{student.adNo}</strong> • Score: <strong style={{ color: '#1e40af' }}>{totalDisplay}</strong>
                        </div>
                      </div>

                      {isEditingUnlocked ? (
                        <input
                          type="number" max={maxAllowed} min="0" step="any" data-index={index}
                          value={marks[assessmentMaxMark] ?? ''}
                          onChange={(e) => handleMarkChange(student.regNo, e.target.value)}
                          onKeyDown={(e) => handleKeyDown(e, index)}
                          placeholder={`/ ${maxAllowed}`}
                          style={{ padding: '10px 12px', width: '90px', textAlign: 'center', borderRadius: '8px', border: '2px solid #0284c7', fontSize: '16px', fontWeight: '800' }}
                        />
                      ) : (
                        <span style={{ fontWeight: '800', fontSize: '16px', padding: '8px 14px', background: '#f1f5f9', borderRadius: '8px' }}>
                          {marks[assessmentMaxMark] ?? '-'}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ width: '100%', overflowX: 'auto', marginBottom: '24px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '15px', minWidth: '850px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #cbd5e1' }}>
                      <th style={{ padding: '14px 16px', width: '50px', color: '#0f172a', fontWeight: '800' }}>Sn</th>
                      <th style={{ padding: '14px 16px', width: '90px', color: '#0f172a', fontWeight: '800' }}>Ad.No</th>
                      <th style={{ padding: '14px 16px', width: '200px', color: '#0f172a', fontWeight: '800' }}>Student Name</th>
                      {isSpecialization ? (
                        <th colSpan="4" style={{ padding: '14px 16px', fontWeight: '800', color: '#0f766e' }}>Direct Specialization Score (Max 30)</th>
                      ) : isHifz ? (
                        <>
                          <th colSpan="2" style={{ padding: '14px 16px', fontWeight: '800' }}>Part 1 (50)</th>
                          <th colSpan="2" style={{ padding: '14px 16px', fontWeight: '800' }}>Part 2 (50)</th>
                        </>
                      ) : (
                        <>
                          <th style={{ padding: '14px 16px', fontWeight: '800' }}>Lvl 1 (15)</th>
                          <th style={{ padding: '14px 16px', fontWeight: '800' }}>Lvl 2 (20)</th>
                          <th style={{ padding: '14px 16px', fontWeight: '800' }}>Lvl 3 (25)</th>
                          <th style={{ padding: '14px 16px', fontWeight: '800' }}>Lvl 4 (40)</th>
                        </>
                      )}
                      <th style={{ padding: '14px 16px', color: '#1e40af', fontWeight: '800' }}>Total (/100)</th>
                      {!isHifz && <th style={{ padding: '14px 16px', color: '#047857', fontWeight: '800' }}>Scaled (/30)</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {classStudents.map((student, index) => {
                      const marks = studentMarks[student.regNo] || {};
                      const hasSpec = marks['30'] !== undefined && marks['30'] !== '';
                      const specMark = hasSpec ? parseFloat(marks['30']) : 0;

                      const m1 = parseFloat(marks[isHifz ? '50_1' : '15']) || 0;
                      const m2 = parseFloat(marks[isHifz ? '50_2' : '20']) || 0;
                      const m3 = isHifz ? 0 : (parseFloat(marks['25']) || 0);
                      const m4 = isHifz ? 0 : (parseFloat(marks['40']) || 0);

                      const total100 = isSpecialization
                        ? (hasSpec ? Number(((specMark / 30) * 100).toFixed(1)) : 0)
                        : (m1 + m2 + m3 + m4);
                      const scaled30 = isHifz
                        ? '-'
                        : isSpecialization
                          ? (hasSpec ? specMark : '-')
                          : (total100 > 0 ? ((total100 / 100) * 30).toFixed(1) : '-');
                      const canOpenPortfolio = canEditStudentPortfolio(student);

                      return (
                        <tr key={student.regNo} style={{ borderBottom: '1px solid #e2e8f0', background: '#ffffff' }}>
                          <td style={{ padding: '14px 16px', fontWeight: '800' }}>{student.rollNo || '-'}</td>
                          <td style={{ padding: '14px 16px', fontWeight: '800' }}>{student.adNo}</td>
                          <td style={{ padding: '16px', fontWeight: '800', fontSize: '15px' }}>
                            {student.firstName}
                            {canOpenPortfolio && (
                              <button type="button" onClick={() => setPortfolioStudent(student)} style={{ marginLeft: '8px', padding: '3px 8px', fontSize: '11px', background: '#f0fdfa', color: '#0f766e', border: '1px solid #99f6e4', borderRadius: '6px', cursor: 'pointer', fontWeight: '700' }}>
                                🏆 Details
                              </button>
                            )}
                          </td>
                          {isSpecialization ? (
                            <td colSpan="4" style={{ padding: '14px 16px' }}>
                              {assessmentMaxMark === '30' && isEditingUnlocked ? (
                                <input type="number" max="30" min="0" step="any" data-index={index} value={marks['30'] ?? ''} onChange={(e) => handleMarkChange(student.regNo, e.target.value)} onKeyDown={(e) => handleKeyDown(e, index)} placeholder="/ 30" style={{ padding: '8px 12px', width: '90px', borderRadius: '6px', border: '2px solid #0284c7', fontWeight: '800' }} />
                              ) : (
                                <span style={{ fontWeight: '800', color: '#0f766e' }}>{marks['30'] !== undefined && marks['30'] !== '' ? `${marks['30']} / 30` : '-'}</span>
                              )}
                            </td>
                          ) : isHifz ? (
                            <>
                              <td colSpan="2" style={{ padding: '14px 16px' }}>
                                {assessmentMaxMark === '50_1' && isEditingUnlocked ? (
                                  <input type="number" max="50" min="0" step="any" data-index={index} value={marks['50_1'] ?? ''} onChange={(e) => handleMarkChange(student.regNo, e.target.value)} onKeyDown={(e) => handleKeyDown(e, index)} style={{ padding: '8px 12px', width: '80px', borderRadius: '6px', border: '2px solid #0284c7', fontWeight: '700' }} />
                                ) : (<span style={{ fontWeight: '700' }}>{marks['50_1'] ?? '-'}</span>)}
                              </td>
                              <td colSpan="2" style={{ padding: '14px 16px' }}>
                                {assessmentMaxMark === '50_2' && isEditingUnlocked ? (
                                  <input type="number" max="50" min="0" step="any" data-index={index} value={marks['50_2'] ?? ''} onChange={(e) => handleMarkChange(student.regNo, e.target.value)} onKeyDown={(e) => handleKeyDown(e, index)} style={{ padding: '8px 12px', width: '80px', borderRadius: '6px', border: '2px solid #0284c7', fontWeight: '700' }} />
                                ) : (<span style={{ fontWeight: '700' }}>{marks['50_2'] ?? '-'}</span>)}
                              </td>
                            </>
                          ) : (
                            ['15', '20', '25', '40'].map(lvl => (
                              <td key={lvl} style={{ padding: '14px 16px' }}>
                                {assessmentMaxMark === lvl && isEditingUnlocked ? (
                                  <input type="number" max={lvl} min="0" step="any" data-index={index} value={marks[lvl] ?? ''} onChange={(e) => handleMarkChange(student.regNo, e.target.value)} onKeyDown={(e) => handleKeyDown(e, index)} style={{ padding: '8px 12px', width: '80px', borderRadius: '6px', border: '2px solid #0284c7', fontWeight: '700' }} />
                                ) : (<span style={{ fontWeight: '700' }}>{marks[lvl] ?? '-'}</span>)}
                              </td>
                            ))
                          )}
                          <td style={{ padding: '14px 16px' }}>
                            {total100 > 0 ? <span style={{ background: '#dbeafe', color: '#1e40af', padding: '6px 10px', borderRadius: '6px', fontWeight: '800' }}>{total100}</span> : '-'}
                          </td>
                          {!isHifz && (
                            <td style={{ padding: '14px 16px' }}>
                              {scaled30 !== '-' ? <span style={{ background: '#d1fae5', color: '#047857', padding: '6px 10px', borderRadius: '6px', fontWeight: '800' }}>{scaled30}</span> : '-'}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {isEditingUnlocked && assessmentMaxMark && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                <button type="submit" disabled={classStudents.length === 0} style={styles.buttonSuccess}>
                  💾 Save &amp; Lock {cceLevel} Marks
                </button>
                {autoSaveStatus && (
                  <span style={{ fontSize: '15px', fontWeight: '700', color: autoSaveStatus.includes('failed') ? '#ef4444' : '#059669', background: autoSaveStatus.includes('failed') ? '#fee2e2' : '#d1fae5', padding: '8px 16px', borderRadius: '8px' }}>
                    {autoSaveStatus}
                  </span>
                )}
              </div>
            )}
          </form>
          {statusMsg && <div style={{ padding: '16px', background: '#ecfdf5', borderRadius: '8px', color: '#065f46', fontWeight: '700', textAlign: 'center' }}>{statusMsg}</div>}
        </>
      )}
    </div>
  );
}