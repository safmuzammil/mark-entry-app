'use client';
import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { auth, db } from '../../lib/firebase';
import { updatePassword } from 'firebase/auth';
import { doc, setDoc, getDoc, getDocs, collection } from 'firebase/firestore';
import ReportManager from './ReportManager';
import NightAttendanceManager from './NightAttendanceManager';
import PeriodAttendanceManager, { isAttendanceOnlyEnrollment } from './PeriodAttendanceManager';
import MinusAttendanceManager from './MinusAttendanceManager';
import OutPassPortal from '../outpass/page';
import {
  WEB_APP_URL, DHIU_LOGO_URL, CCE_LEVELS, HIFZ_LEVELS,
  styles, sortStudentsByDepartment
} from './erpConstants';
import {
  HighContrastStyles,
  ProfileAvatar,
  StudentPortfolioModal,
  MentorAndOutreachTab,
  PortalNotificationBanner,
  doesClassMatchAlias
} from './ErpExtensions';

const SPECIALIZATION_LEVELS = {
  'Direct Mark (Max 30)': '30'
};

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

function TeacherPasswordSettings({ loggedInTeacher }) {
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

      // Also persist to Firestore teacher document so old passwords are immediately invalidated
      const uName = String(loggedInTeacher?.username || (user.email ? user.email.split('@')[0] : '')).trim().toLowerCase();
      if (uName && uName !== 'admin') {
        await setDoc(doc(db, 'teachers', uName), {
          password: newPassword,
          passwordUpdatedAt: new Date().toISOString(),
          passwordUpdatedBy: 'teacher'
        }, { merge: true });
      }
      setStatus('✅ Password updated successfully!');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      if (err.code === 'auth/requires-recent-login') {
        setStatus('Error: For security, please log out and log back in before changing your password.');
      } else {
        setStatus('Error: ' + err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ ...styles.card, maxWidth: '460px' }}>
      <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: '800', color: '#0f172a' }}>Change Account Password</h3>
      <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: '#64748b' }}>
        Enter a new password of at least 6 characters.
      </p>
      <form onSubmit={handlePasswordChange} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div><label style={styles.label}>New Password</label><input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required style={styles.input} /></div>
        <div><label style={styles.label}>Confirm New Password</label><input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required style={styles.input} /></div>
        <button type="submit" disabled={loading} style={styles.buttonPrimary}>{loading ? 'Updating...' : 'Update Password'}</button>
      </form>
      {status && <div style={{ marginTop: '16px', padding: '12px', borderRadius: '8px', fontSize: '13px', fontWeight: '700', backgroundColor: status.includes('Error') ? '#fff1f2' : '#ecfdf5', color: status.includes('Error') ? '#e11d48' : '#047857' }}>{status}</div>}
    </div>
  );
}

export default function TeacherPortalView({ loggedInTeacher, onLogout, embeddedInAdmin = false }) {
  const myUsername = String(loggedInTeacher?.username || '').toLowerCase();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [showTaskDetails, setShowTaskDetails] = useState(false);

  const [allStudentsCache, setAllStudentsCache] = useState([]);
  const [allTeachersCache, setAllTeachersCache] = useState([]);
  const [activeOutpassesCache, setActiveOutpassesCache] = useState([]);

  useEffect(() => {
    async function fetchStudentsTeachersAndPasses() {
      try {
        const [sSnap, tSnap, opSnap] = await Promise.all([
          getDocs(collection(db, 'students')),
          getDocs(collection(db, 'teachers')),
          getDocs(collection(db, 'out_passes'))
        ]);
        const sData = [];
        sSnap.forEach((d) => sData.push({ id: d.id, ...d.data() }));
        sData.sort((a, b) => (Number(a.rollNo) || 999) - (Number(b.rollNo) || 999));
        setAllStudentsCache(sData);

        const tData = [];
        tSnap.forEach((d) => tData.push({ id: d.id, ...d.data() }));
        setAllTeachersCache(tData);

        const opData = [];
        opSnap.forEach((d) => {
          const data = d.data();
          const st = String(data.status || '').toUpperCase();
          if (st === 'OUTSIDE' || st === 'APPROVED' || st === 'ARRIVED_AT_GATE') {
            opData.push({ id: d.id, ...data });
          }
        });
        setActiveOutpassesCache(opData);
      } catch (error) {
        console.error('Student fetch error:', error);
      }
    }
    fetchStudentsTeachersAndPasses();
  }, []);

  const myClassTeacherOf = React.useMemo(() => {
    return loggedInTeacher?.outpassPrivileges?.classTeacherOf || [];
  }, [loggedInTeacher?.outpassPrivileges?.classTeacherOf]);

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

  const [activeView, setActiveView] = useState('period_attendance');
  // 📱 Mobile Back-Swipe & Hardware Back Navigation: Return to Marks (Home) instead of exiting app
  const handleSelectTeacherView = (viewId, skipHistory = false) => {
    if (viewId === activeView) return;
    if (!skipHistory && typeof window !== 'undefined') {
      window.history.pushState(
        { teacherView: viewId },
        '',
        viewId === 'period_attendance' ? window.location.pathname : '#' + viewId
      );
    }
    setActiveView(viewId);
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const hashView = window.location.hash.replace('#', '').trim();
    const validViews = ['marks', 'period_attendance', 'minus_attendance', 'mentees', 'outpass', 'attendance', 'outreach_dept', 'academic_coord', 'settings'];
    if (hashView && validViews.includes(hashView)) {
      setActiveView(hashView);
      window.history.replaceState({ teacherView: hashView }, '', '#' + hashView);
    } else {
      setActiveView('period_attendance');
      window.history.replaceState({ teacherView: 'period_attendance' }, '', window.location.pathname);
    }

    const handlePopState = (e) => {
      const targetView = e.state?.teacherView || 'period_attendance';
      setActiveView(targetView);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

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
    const isSpec = Boolean(
      chosenEnv?.subject?.toUpperCase()?.includes('SPECIALIZATION') ||
      chosenEnv?.alias?.toUpperCase()?.includes('SPECIALIZATION') ||
      chosenEnv?.subject?.toUpperCase()?.startsWith('TKS') ||
      chosenEnv?.alias?.toUpperCase()?.startsWith('TKS')
    );
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

  // 🌟 Live Campus & Medical Counts for Teacher's Designated Class and Assigned Mentees
  const cleanAdNo = (str) => String(str || '').replace('#', '').trim().toUpperCase();
  const outsideAdSet = React.useMemo(() => {
    return new Set(
      activeOutpassesCache
        .filter(p => String(p.status || '').toUpperCase() === 'OUTSIDE')
        .map(p => cleanAdNo(p.adNo))
        .filter(Boolean)
    );
  }, [activeOutpassesCache]);

  const medicalAdSet = React.useMemo(() => {
    return new Set(
      activeOutpassesCache
        .filter(p => String(p.status || '').toUpperCase() === 'OUTSIDE' && (String(p.leaveCategory || '').toLowerCase().includes('medical') || p.isOpenReturn))
        .map(p => cleanAdNo(p.adNo))
        .filter(Boolean)
    );
  }, [activeOutpassesCache]);

  const myDesignatedClassStudents = React.useMemo(() => {
    if (myClassTeacherOf.length === 0) return [];
    return allStudentsCache.filter(s => (s.classes || []).some(c => myClassTeacherOf.includes(c)));
  }, [allStudentsCache, myClassTeacherOf]);

  const myClassOutCount = myDesignatedClassStudents.filter(s => outsideAdSet.has(cleanAdNo(s.adNo))).length;
  const myClassMedCount = myDesignatedClassStudents.filter(s => medicalAdSet.has(cleanAdNo(s.adNo))).length;
  const myClassInCount = Math.max(0, myDesignatedClassStudents.length - myClassOutCount);

  const myAssignedMentees = allStudentsCache.filter(
    s => String(s.mentorUsername || '').trim().toLowerCase() === myUsername
  );
  const myMenteesOutCount = myAssignedMentees.filter(s => outsideAdSet.has(cleanAdNo(s.adNo))).length;
  const myMenteesMedCount = myAssignedMentees.filter(s => medicalAdSet.has(cleanAdNo(s.adNo))).length;
  const myMenteesInCount = Math.max(0, myAssignedMentees.length - myMenteesOutCount);

  const minSittingsReq = Number(mentorshipConfig.minConsultations) || 3;
  const menteesMetTargetCount = myAssignedMentees.filter(s => {
    const logs = Array.isArray(s.mentorLogs) ? s.mentorLogs : (s.consultationLogs || []);
    return logs.length >= minSittingsReq;
  }).length;

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
        marksPayload.push({
          studentId: student.regNo,
          regNo: student.regNo,
          adNo: student.adNo || '',
          subject: finalSubjectKey,
          maxMarks: assessmentMaxMark,
          marksObtained: val,
          score: val
        });
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
          const timeoutId = setTimeout(() => controller.abort(), 15000);
          const targetClassStr = String(
            currentEnrollment.targetClass ||
            currentEnrollment.alias ||
            classStudents[0]?.class ||
            ''
          ).trim().toUpperCase();

          const syncPayload = {
            targetClass: targetClassStr,
            subject: finalSubjectKey,
            maxMarks: String(assessmentMaxMark),
            marks: marksPayload
          };

          const res = await fetch(WEB_APP_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(syncPayload),
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          const result = await res.json();
          setStatusMsg(result.status === 'success' ? '✅ Marks saved to database AND Google Sheets!' : '⚠️ Firebase updated, Sheets note: ' + (result.message || 'Updated'));
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

  if (loggedInTeacher?.isEventLeader || loggedInTeacher?.roleCategory === 'Event Leader') {
    return (
      <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
        <HighContrastStyles />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', background: '#ffffff', padding: '18px 24px', borderRadius: '14px', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <img src={DHIU_LOGO_URL} alt="DHIU Logo" style={{ width: '44px', height: '44px', borderRadius: '50%', objectFit: 'contain' }} />
            <div>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: '#0f172a' }}>🎭 Event / Rehearsal Attendance Portal</h2>
              <div style={{ fontSize: '12px', fontWeight: '600', color: '#64748b' }}>Logged in as: {loggedInTeacher.fullName} (@{loggedInTeacher.username})</div>
            </div>
          </div>
          <button onClick={onLogout} style={styles.buttonDanger}>Sign Out</button>
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

  const teacherNavItems = [
    { id: 'period_attendance', label: 'Period Attendance', icon: '📅', onClick: () => handleSelectTeacherView('period_attendance') },
    { id: 'minus_attendance', label: 'Minus Attendance', icon: '⚖️', onClick: () => handleSelectTeacherView('minus_attendance') },
    { id: 'marks', label: 'CCE Marks', icon: '📖', onClick: () => { handleSelectTeacherView('marks'); handleSelectSubject(''); } },
    { id: 'mentees', label: 'Mentorship & Class', icon: '👥', onClick: () => handleSelectTeacherView('mentees') },
    { id: 'outpass', label: loggedInTeacher?.outpassPrivileges?.isOfficeSecretary ? 'Office Out-Pass' : 'Out-Pass Desk', icon: '🪪', onClick: () => handleSelectTeacherView('outpass') },
    { id: 'attendance', label: 'Night Attendance', icon: '🌙', onClick: () => handleSelectTeacherView('attendance') },
    { id: 'reminders', label: 'Weekly Reminders', icon: '🔔', onClick: () => handleSelectTeacherView('reminders') },
    ...((loggedInTeacher?.outpassPrivileges?.isOutreachCoordinator || loggedInTeacher?.outpassPrivileges?.isPrincipal || loggedInTeacher?.outpassPrivileges?.isNiicsCoordinator)
      ? [{ id: 'outreach_dept', label: 'Outreach Tracker', icon: '🌍', onClick: () => setActiveView('outreach_dept') }]
      : []),
    ...((loggedInTeacher?.outpassPrivileges?.isAcademicCoordinator || loggedInTeacher?.outpassPrivileges?.isPrincipal || loggedInTeacher?.outpassPrivileges?.isNiicsCoordinator)
      ? [{ id: 'academic_coord', label: 'Academic Auditor', icon: '📊', onClick: () => setActiveView('academic_coord') }]
      : []),
    { id: 'settings', label: 'Password Settings', icon: '⚙️', onClick: () => handleSelectTeacherView('settings') }
  ];

  const pendingTasksCount = reminderChecklist.filter(x => x.missing > 0).length;

  return (
    <div style={{ minHeight: embeddedInAdmin ? 'auto' : '100vh', display: 'flex', backgroundColor: '#f8fafc' }}>
      <HighContrastStyles />
      <style>{`
        @media (max-width: 960px) {
          .shuhood-teacher-sidebar {
            position: fixed !important;
            top: 0;
            left: 0;
            bottom: 0;
            z-index: 1200;
            transform: translateX(-100%);
            transition: transform 0.25s ease;
          }
          .shuhood-teacher-sidebar.open {
            transform: translateX(0);
          }
          .shuhood-teacher-menu-btn {
            display: inline-flex !important;
            align-items: center;
            justify-content: center;
            color: #0f172a !important;
            background-color: #ffffff !important;
            border: 1.5px solid #94a3b8 !important;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1) !important;
          }
        }
      `}</style>

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

      {mobileSidebarOpen && (
        <div
          onClick={() => setMobileSidebarOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.4)', zIndex: 1150 }}
        />
      )}

      {/* 🌟 LEFT SIDEBAR FOR TEACHER PORTAL */}
      <aside
        className={`shuhood-teacher-sidebar ${mobileSidebarOpen ? 'open' : ''}`}
        style={{
          width: '245px',
          minWidth: '245px',
          backgroundColor: '#ffffff',
          borderRight: '1px solid #e2e8f0',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          position: embeddedInAdmin ? 'relative' : 'sticky',
          top: 0,
          height: embeddedInAdmin ? 'auto' : '100vh',
          padding: '20px 14px',
          boxSizing: 'border-box'
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '4px 10px 18px', borderBottom: '1px solid #f1f5f9' }}>
            <img src={DHIU_LOGO_URL} alt="DHIU" style={{ width: '38px', height: '38px', borderRadius: '10px', objectFit: 'contain', border: '1px solid #e2e8f0', padding: '2px' }} />
            <div>
              <div style={{ fontSize: '17px', fontWeight: '800', color: '#0f172a', lineHeight: 1.2 }}>DHIU Campus</div>
              <div style={{ fontSize: '10px', fontWeight: '800', color: '#4f46e5', letterSpacing: '0.6px', textTransform: 'uppercase', marginTop: '2px' }}>
                🎓 FACULTY PORTAL
              </div>
            </div>
          </div>

          <div style={{ fontSize: '11px', fontWeight: '800', color: '#94a3b8', letterSpacing: '0.8px', padding: '16px 12px 8px', textTransform: 'uppercase' }}>
            NAVIGATION
          </div>

          <nav style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {teacherNavItems.map(item => {
              const isActive = activeView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    item.onClick();
                    setMobileSidebarOpen(false);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    width: '100%',
                    padding: '11px 14px',
                    borderRadius: '10px',
                    border: isActive ? '1.5px solid #1e1b4b' : '1.5px solid transparent',
                    backgroundColor: isActive ? '#4f46e5' : 'transparent',
                    color: isActive ? '#ffffff' : '#475569',
                    fontWeight: isActive ? '700' : '600',
                    fontSize: '14px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <span style={{ fontSize: '16px' }}>{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '14px' }}>
          <button
            type="button"
            onClick={onLogout}
            style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', borderRadius: '8px', background: '#fff1f2', color: '#e11d48', border: '1px solid #ffe4e6', fontSize: '13px', fontWeight: '700', cursor: 'pointer', width: '100%', textAlign: 'left' }}
          >
            <span>🚪</span> {embeddedInAdmin ? 'Exit Proxy Mode' : 'Sign Out'}
          </button>
        </div>
      </aside>

      {/* 🌟 MAIN TEACHER CONTENT AREA */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Clean Minimalist Top Bar with Live Class & Mentee Campus/Medical Badges */}
        <header style={{ backgroundColor: '#ffffff', borderBottom: '1px solid #e2e8f0', padding: '14px 26px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="shuhood-teacher-menu-btn"
              onClick={() => setMobileSidebarOpen(true)}
              style={{
                display: 'none',
                padding: '8px 14px',
                background: '#ffffff',
                color: '#0f172a',
                border: '1.5px solid #94a3b8',
                borderRadius: '10px',
                fontWeight: '900',
                cursor: 'pointer',
                fontSize: '22px',
                lineHeight: '1',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
              }}
              aria-label="Toggle navigation menu"
            >
              ☰
            </button>

            {myClassTeacherOf.length > 0 && (
              <span
                onClick={() => setActiveView('mentees')}
                style={{ background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', padding: '5px 12px', borderRadius: '999px', fontSize: '11px', fontWeight: '800', cursor: 'pointer' }}
              >
                🏫 Class {myClassTeacherOf.join(', ')}: 🟢 {myClassInCount} In • 🟠 {myClassOutCount} Out {myClassMedCount > 0 ? `(🏥 ${myClassMedCount} Med)` : ''}
              </span>
            )}

            {myAssignedMentees.length > 0 && (
              <span
                onClick={() => setActiveView('mentees')}
                style={{ background: '#eef2ff', color: '#4f46e5', border: '1px solid #c7d2fe', padding: '5px 12px', borderRadius: '999px', fontSize: '11px', fontWeight: '800', cursor: 'pointer' }}
              >
                🧭 Mentees ({myAssignedMentees.length}): 🟢 {myMenteesInCount} In • 🟠 {myMenteesOutCount} Out {myMenteesMedCount > 0 ? `(🏥 ${myMenteesMedCount} Med)` : ''} • Sittings {menteesMetTargetCount}/{myAssignedMentees.length}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <ProfileAvatar name={loggedInTeacher?.fullName} code={loggedInTeacher?.username} photoUrl={loggedInTeacher?.photoUrl} size={36} />
            <div>
              <div style={{ fontSize: '13px', fontWeight: '800', color: '#0f172a' }}>{loggedInTeacher?.fullName}</div>
              <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '600' }}>@{loggedInTeacher?.username}</div>
            </div>
          </div>
        </header>

        <main style={{ padding: '26px', maxWidth: '1220px', width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
          {/* 🌟 TARGETED PORTAL NOTIFICATION CENTER FOR TEACHERS (Send & Receive) */}
          <PortalNotificationBanner
            viewerRole="teacher"
            viewerId={loggedInTeacher?.username || ''}
            canSendMessages={true}
            senderName={loggedInTeacher?.fullName || 'Faculty'}
            senderRole="teacher"
            senderUsername={loggedInTeacher?.username || ''}
            studentsList={allStudentsCache}
            teachersList={allTeachersCache}
            loggedInTeacher={loggedInTeacher}
          />

          {adminBroadcast && (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', padding: '12px 18px', borderRadius: '10px', marginBottom: '18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
              <div style={{ fontSize: '13px', color: '#92400e', fontWeight: '600' }}>
                <strong style={{ fontWeight: '800' }}>📢 Notice ({adminBroadcast.title}):</strong> {adminBroadcast.message}
              </div>
            </div>
          )}

          {/* MINIMALIST 1-LINE WEEKLY REMINDER STRIP (Expands on Click!) */}
          {weeklyReminder && reminderChecklist.length > 0 && activeView === 'marks' && (
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '14px 18px', marginBottom: '20px' }}>
              <div
                onClick={() => setShowTaskDetails(!showTaskDetails)}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', flexWrap: 'wrap', gap: '10px' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <span style={{ background: '#eef2ff', color: '#4f46e5', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '800' }}>
                    📅 {weeklyReminder.weekName || 'Current Week'}
                  </span>
                  <span style={{ fontSize: '14px', fontWeight: '700', color: '#0f172a' }}>
                    {weeklyReminder.message || 'Mark Entry Target'}
                  </span>
                  <span style={{ background: pendingTasksCount > 0 ? '#fff1f2' : '#ecfdf5', color: pendingTasksCount > 0 ? '#e11d48' : '#047857', padding: '3px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: '800' }}>
                    {pendingTasksCount > 0 ? `${pendingTasksCount} Pending` : '✅ All Completed'}
                  </span>
                </div>
                <span style={{ fontSize: '12px', fontWeight: '700', color: '#4f46e5' }}>
                  {showTaskDetails ? '▲ Hide Tasks' : '▼ View Assigned Tasks'}
                </span>
              </div>

              {showTaskDetails && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '14px', paddingTop: '12px', borderTop: '1px solid #f1f5f9' }}>
                  {reminderChecklist.map((item, idx) => {
                    const isDone = item.missing === 0;
                    return (
                      <span
                        key={idx}
                        style={{
                          padding: '6px 12px',
                          borderRadius: '8px',
                          fontSize: '12px',
                          fontWeight: '700',
                          background: isDone ? '#ecfdf5' : '#fff1f2',
                          color: isDone ? '#047857' : '#be123c',
                          border: `1px solid ${isDone ? '#a7f3d0' : '#fecdd3'}`
                        }}
                      >
                        {isDone ? '✅' : '⏳'} {item.alias} ({item.targetLevel}){!isDone ? ` • ${item.missing} left` : ''}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeView === 'reminders' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ background: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0', padding: '22px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '14px' }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: '#0f172a' }}>
                      🔔 Academic Mark Entry Target Tracker
                    </h2>
                    <div style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>
                      {weeklyReminder?.weekName || 'Current Week'}: {weeklyReminder?.message || 'Please complete mark entry targets'}
                    </div>
                  </div>
                  <span style={{
                    padding: '6px 14px',
                    borderRadius: '999px',
                    fontWeight: '800',
                    fontSize: '12px',
                    background: pendingTasksCount === 0 ? '#ecfdf5' : '#fff1f2',
                    color: pendingTasksCount === 0 ? '#047857' : '#e11d48'
                  }}>
                    {pendingTasksCount === 0 ? '✅ All Targets Completed!' : `⏳ ${pendingTasksCount} Target(s) Incomplete`}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '14px', marginTop: '16px' }}>
                  {reminderChecklist.length === 0 ? (
                    <div style={{ padding: '30px', textAlign: 'center', color: '#64748b', background: '#f8fafc', borderRadius: '10px', border: '1px dashed #cbd5e1', width: '100%' }}>
                      No specific mark entry targets assigned to your subject batches for this week.
                    </div>
                  ) : (
                    reminderChecklist.map((item, idx) => {
                      const isDone = item.missing === 0;
                      return (
                        <div
                          key={idx}
                          style={{
                            padding: '16px',
                            borderRadius: '12px',
                            border: `1.5px solid ${isDone ? '#a7f3d0' : '#fecdd3'}`,
                            background: isDone ? '#f0fdf4' : '#fff1f2',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ fontWeight: '800', fontSize: '15px', color: '#0f172a' }}>{item.alias}</div>
                            <span style={{ padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: '800', background: isDone ? '#10b981' : '#f43f5e', color: '#ffffff' }}>
                              {isDone ? 'COMPLETED' : 'PENDING'}
                            </span>
                          </div>
                          <div style={{ fontSize: '12px', color: '#475569' }}>
                            Target Level: <strong>{item.targetLevel}</strong>
                          </div>
                          <div style={{ fontSize: '12px', color: '#475569' }}>
                            Entered: <strong>{item.entered}</strong> / {item.total} students ({item.missing} missing)
                          </div>
                          <div style={{ width: '100%', height: '6px', borderRadius: '999px', background: '#e2e8f0', overflow: 'hidden', marginTop: '4px' }}>
                            <div style={{ width: `${item.total > 0 ? (item.entered / item.total) * 100 : 100}%`, height: '100%', background: isDone ? '#10b981' : '#f59e0b' }} />
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          ) : activeView === 'settings' ? (
            <TeacherPasswordSettings loggedInTeacher={loggedInTeacher} />
          ) : activeView === 'minus_attendance' ? (
            <MinusAttendanceManager
              userRole="teacher"
              loggedInUser={loggedInTeacher}
              activeTeacherObj={loggedInTeacher}
              localStudents={allStudentsCache}
              localTeachers={allTeachersCache}
              onStudentsUpdated={(nextStudents) => setAllStudentsCache(nextStudents)}
            />
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
              <h3 style={{ margin: '0 0 6px 0', fontSize: '18px', color: '#0f172a', fontWeight: '800' }}>CCE &amp; Hifz Mark Entry</h3>
              <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: '#64748b' }}>
                Select an assigned subject below to view or enter marks.
              </p>

              {teacherEnrollments.length === 0 ? (
                <div style={{ padding: '32px', textAlign: 'center', color: '#64748b', background: '#f8fafc', borderRadius: '12px', border: '1px dashed #cbd5e1', fontWeight: '600' }}>
                  No mark-entry subjects have been assigned to your profile yet.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '16px' }}>
                  {teacherEnrollments.map(env => {
                    const enrolledCount = allStudentsCache.filter(st => doesStudentBelongToTeacherEnrollment(st, env)).length;
                    return (
                      <div
                        key={env.id}
                        onClick={() => handleSelectSubject(env.id)}
                        style={{ padding: '20px', borderRadius: '14px', border: '1px solid #e2e8f0', background: '#ffffff', cursor: 'pointer', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '16px' }}
                      >
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                            <span style={{ background: '#f1f5f9', color: '#475569', padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: '700' }}>
                              Grade {env.grade || '-'} • {env.langTag || 'General'}
                            </span>
                            <span style={{ background: '#eef2ff', color: '#4f46e5', padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: '800' }}>
                              {enrolledCount} Students
                            </span>
                          </div>
                          <h4 style={{ margin: '0 0 4px 0', fontSize: '17px', fontWeight: '800', color: '#0f172a' }}>
                            {env.alias || `Grade ${env.grade} ${env.subject}`}
                          </h4>
                          <p style={{ margin: 0, fontSize: '12px', color: '#64748b', fontWeight: '500' }}>
                            Subject: {env.subject}
                          </p>
                        </div>
                        <button type="button" style={{ width: '100%', padding: '10px', background: '#0f172a', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}>
                          Open Mark Sheet
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <>
              <div style={styles.card}>
                <div style={{ marginBottom: '14px' }}>
                  <button
                    type="button"
                    onClick={() => handleSelectSubject('')}
                    style={styles.buttonSecondary}
                  >
                    ⬅ Back to Subjects
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', alignItems: 'end' }}>
                  <div>
                    <label style={styles.label}>1. Selected Subject</label>
                    <select value={selectedEnrollmentId} onChange={(e) => handleSelectSubject(e.target.value)} style={styles.input}>
                      {teacherEnrollments.map(env => (
                        <option key={env.id} value={env.id}>{env.alias || `Grade ${env.grade} ${env.subject}`} ({env.langTag || 'Gen'})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={styles.label}>2. Select Level to Grade</label>
                    <select value={cceLevel} onChange={(e) => handleSelectLevel(e.target.value)} style={styles.input}>
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
                          width: '100%', padding: '10px 16px', borderRadius: '8px', fontWeight: '700', fontSize: '13px', cursor: 'pointer',
                          border: isEditingUnlocked ? '1.5px solid #10b981' : '1.5px solid #cbd5e1',
                          background: isEditingUnlocked ? '#ecfdf5' : '#f8fafc',
                          color: isEditingUnlocked ? '#047857' : '#334155'
                        }}
                      >
                        {isEditingUnlocked ? `🔓 ${cceLevel} Unlocked` : `🔒 Unlock ${cceLevel} to Edit`}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {assessmentMaxMark && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px', marginBottom: '18px' }}>
                  <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                    <span style={{ fontSize: '11px', color: '#64748b', fontWeight: '700' }}>CLASS AVERAGE ({cceLevel.toUpperCase()})</span>
                    <div style={{ fontSize: '22px', color: '#0f172a', fontWeight: '800', marginTop: '4px' }}>{classAverage} / {maxAllowed}</div>
                  </div>
                  <div style={{ background: '#ecfdf5', padding: '16px', borderRadius: '12px', border: '1px solid #a7f3d0', textAlign: 'center' }}>
                    <span style={{ fontSize: '11px', color: '#047857', fontWeight: '700' }}>HIGHEST SCORE</span>
                    <div style={{ fontSize: '22px', fontWeight: '800', color: '#065f46', marginTop: '4px' }}>{highestScore} / {maxAllowed}</div>
                  </div>
                  <div style={{ background: '#eff6ff', padding: '16px', borderRadius: '12px', border: '1px solid #bfdbfe', textAlign: 'center' }}>
                    <span style={{ fontSize: '11px', color: '#1d4ed8', fontWeight: '700' }}>PASSING RATE</span>
                    <div style={{ fontSize: '22px', fontWeight: '800', color: '#1e40af', marginTop: '4px' }}>{passPercentage}%</div>
                  </div>
                </div>
              )}

              <form onSubmit={handleBulkSubmit} style={styles.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid #f1f5f9', paddingBottom: '14px', marginBottom: '18px', gap: '12px' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '17px', color: '#0f172a', fontWeight: '800' }}>
                      {currentEnrollment?.alias || currentEnrollment?.subject} ({classStudents.length} Students)
                    </h3>
                    <span style={{ fontSize: '12px', fontWeight: '600', color: isEditingUnlocked ? '#059669' : '#64748b' }}>
                      {!cceLevel
                        ? 'Select a Task Level above to enter marks.'
                        : !isEditingUnlocked
                          ? `${cceLevel} is locked. Click "Unlock" above to edit.`
                          : `Editing ${cceLevel} (Auto-save enabled)`}
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button type="button" onClick={handleDownloadExternalPortalCSV} style={styles.buttonSecondary}>
                      ⬇️ Export {isHifz ? '(/100)' : '(/30)'} CSV
                    </button>
                    {cceLevel && (
                      <button type="button" onClick={() => setIsCompactMode(!isCompactMode)} style={styles.buttonSecondary}>
                        {isCompactMode ? '📋 Table View' : '📱 Mobile View'}
                      </button>
                    )}
                    {cceLevel && (
                      <button type="button" onClick={handleDownloadMarksTemplate} style={styles.buttonSecondary}>
                        📥 Template
                      </button>
                    )}
                    {cceLevel && isEditingUnlocked && (
                      <label style={{ ...styles.buttonPrimary, padding: '9px 14px', fontSize: '13px', display: 'inline-flex', alignItems: 'center' }}>
                        ⬆️ Upload CSV
                        <input type="file" accept=".csv, .xlsx" onChange={handleUniversalUpload} style={{ display: 'none' }} />
                      </label>
                    )}
                  </div>
                </div>

                {classStudents.length === 0 ? (
                  <div style={{ padding: '32px', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '12px', textAlign: 'center', color: '#64748b', fontSize: '14px' }}>No students assigned to this subject.</div>
                ) : isCompactMode && assessmentMaxMark ? (
                  <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden', marginBottom: '20px' }}>
                    {classStudents.map((student, index) => {
                      const marks = studentMarks[student.regNo] || {};
                      const canOpenPortfolio = canEditStudentPortfolio(student);

                      return (
                        <div key={student.regNo} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #f1f5f9', background: '#ffffff' }}>
                          <div>
                            <div style={{ fontWeight: '700', color: '#0f172a', fontSize: '14px' }}>
                              <span style={{ color: '#64748b', marginRight: '8px' }}>#{student.rollNo || index + 1}</span>
                              {student.firstName}
                              {canOpenPortfolio && (
                                <button type="button" onClick={() => setPortfolioStudent(student)} style={{ marginLeft: '8px', padding: '2px 8px', fontSize: '11px', background: '#f8fafc', color: '#4f46e5', border: '1px solid #e2e8f0', borderRadius: '6px', cursor: 'pointer', fontWeight: '600' }}>
                                  👁️ View
                                </button>
                              )}
                            </div>
                            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                              Ad.No: {student.adNo}
                            </div>
                          </div>

                          {isEditingUnlocked ? (
                            <input
                              type="number" max={maxAllowed} min="0" step="any" data-index={index}
                              value={marks[assessmentMaxMark] ?? ''}
                              onChange={(e) => handleMarkChange(student.regNo, e.target.value)}
                              onKeyDown={(e) => handleKeyDown(e, index)}
                              placeholder={`/ ${maxAllowed}`}
                              style={{ padding: '8px 10px', width: '85px', textAlign: 'center', borderRadius: '8px', border: '1.5px solid #4f46e5', fontSize: '15px', fontWeight: '700' }}
                            />
                          ) : (
                            <span style={{ fontWeight: '700', fontSize: '15px', padding: '6px 12px', background: '#f8fafc', borderRadius: '6px', color: '#0f172a' }}>
                              {marks[assessmentMaxMark] ?? '-'}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ width: '100%', overflowX: 'auto', marginBottom: '20px', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px', minWidth: '800px' }}>
                      <thead>
                        <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '11px', textTransform: 'uppercase' }}>
                          <th style={{ padding: '12px 16px', width: '50px' }}>#</th>
                          <th style={{ padding: '12px 16px', width: '90px' }}>AD.NO</th>
                          <th style={{ padding: '12px 16px', width: '220px' }}>NAME</th>
                          {isSpecialization ? (
                            <th colSpan="4" style={{ padding: '12px 16px' }}>DIRECT SCORE (/30)</th>
                          ) : isHifz ? (
                            <>
                              <th colSpan="2" style={{ padding: '12px 16px' }}>PART 1 (/50)</th>
                              <th colSpan="2" style={{ padding: '12px 16px' }}>PART 2 (/50)</th>
                            </>
                          ) : (
                            <>
                              <th style={{ padding: '12px 16px' }}>LVL 1 (15)</th>
                              <th style={{ padding: '12px 16px' }}>LVL 2 (20)</th>
                              <th style={{ padding: '12px 16px' }}>LVL 3 (25)</th>
                              <th style={{ padding: '12px 16px' }}>LVL 4 (40)</th>
                            </>
                          )}
                          <th style={{ padding: '12px 16px' }}>TOTAL (/100)</th>
                          {!isHifz && <th style={{ padding: '12px 16px' }}>SCALED (/30)</th>}
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
                            <tr key={student.regNo} style={{ borderBottom: '1px solid #f1f5f9', background: '#ffffff' }}>
                              <td style={{ padding: '12px 16px', color: '#64748b' }}>{student.rollNo || index + 1}</td>
                              <td style={{ padding: '12px 16px', fontWeight: '600', color: '#475569' }}>{student.adNo}</td>
                              <td style={{ padding: '12px 16px', fontWeight: '700', color: '#0f172a' }}>
                                {student.firstName}
                                {canOpenPortfolio && (
                                  <button type="button" onClick={() => setPortfolioStudent(student)} style={{ marginLeft: '8px', padding: '2px 8px', fontSize: '11px', background: '#f8fafc', color: '#4f46e5', border: '1px solid #e2e8f0', borderRadius: '6px', cursor: 'pointer', fontWeight: '600' }}>
                                    👁️ View
                                  </button>
                                )}
                              </td>
                              {isSpecialization ? (
                                <td colSpan="4" style={{ padding: '12px 16px' }}>
                                  {assessmentMaxMark === '30' && isEditingUnlocked ? (
                                    <input type="number" max="30" min="0" step="any" data-index={index} value={marks['30'] ?? ''} onChange={(e) => handleMarkChange(student.regNo, e.target.value)} onKeyDown={(e) => handleKeyDown(e, index)} placeholder="/ 30" style={{ padding: '7px 10px', width: '85px', borderRadius: '6px', border: '1.5px solid #4f46e5', fontWeight: '700' }} />
                                  ) : (
                                    <span style={{ fontWeight: '700' }}>{marks['30'] !== undefined && marks['30'] !== '' ? `${marks['30']} / 30` : '-'}</span>
                                  )}
                                </td>
                              ) : isHifz ? (
                                <>
                                  <td colSpan="2" style={{ padding: '12px 16px' }}>
                                    {assessmentMaxMark === '50_1' && isEditingUnlocked ? (
                                      <input type="number" max="50" min="0" step="any" data-index={index} value={marks['50_1'] ?? ''} onChange={(e) => handleMarkChange(student.regNo, e.target.value)} onKeyDown={(e) => handleKeyDown(e, index)} style={{ padding: '7px 10px', width: '80px', borderRadius: '6px', border: '1.5px solid #4f46e5', fontWeight: '700' }} />
                                    ) : (<span>{marks['50_1'] ?? '-'}</span>)}
                                  </td>
                                  <td colSpan="2" style={{ padding: '12px 16px' }}>
                                    {assessmentMaxMark === '50_2' && isEditingUnlocked ? (
                                      <input type="number" max="50" min="0" step="any" data-index={index} value={marks['50_2'] ?? ''} onChange={(e) => handleMarkChange(student.regNo, e.target.value)} onKeyDown={(e) => handleKeyDown(e, index)} style={{ padding: '7px 10px', width: '80px', borderRadius: '6px', border: '1.5px solid #4f46e5', fontWeight: '700' }} />
                                    ) : (<span>{marks['50_2'] ?? '-'}</span>)}
                                  </td>
                                </>
                              ) : (
                                ['15', '20', '25', '40'].map(lvl => (
                                  <td key={lvl} style={{ padding: '12px 16px' }}>
                                    {assessmentMaxMark === lvl && isEditingUnlocked ? (
                                      <input type="number" max={lvl} min="0" step="any" data-index={index} value={marks[lvl] ?? ''} onChange={(e) => handleMarkChange(student.regNo, e.target.value)} onKeyDown={(e) => handleKeyDown(e, index)} style={{ padding: '7px 10px', width: '80px', borderRadius: '6px', border: '1.5px solid #4f46e5', fontWeight: '700' }} />
                                    ) : (<span>{marks[lvl] ?? '-'}</span>)}
                                  </td>
                                ))
                              )}
                              <td style={{ padding: '12px 16px', fontWeight: '700', color: '#4f46e5' }}>
                                {total100 > 0 ? total100 : '-'}
                              </td>
                              {!isHifz && (
                                <td style={{ padding: '12px 16px', fontWeight: '700', color: '#047857' }}>
                                  {scaled30}
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
                    <button type="submit" disabled={classStudents.length === 0} style={{ ...styles.buttonPrimary, padding: '12px 24px' }}>
                      💾 Save {cceLevel} Marks
                    </button>
                    {autoSaveStatus && (
                      <span style={{ fontSize: '13px', fontWeight: '700', color: '#047857' }}>
                        {autoSaveStatus}
                      </span>
                    )}
                  </div>
                )}
              </form>
              {statusMsg && <div style={{ padding: '14px', background: '#ecfdf5', borderRadius: '8px', color: '#065f46', fontWeight: '700', textAlign: 'center' }}>{statusMsg}</div>}
            </>
          )}
        </main>
      </div>
    </div>
  );
}