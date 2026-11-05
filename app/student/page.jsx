'use client';
import React, { useState, useEffect } from 'react';
import { auth, db } from '../../lib/firebase';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, getDocs, collection } from 'firebase/firestore';
import InstallAppBanner from '../components/InstallAppBanner';
import { DHIU_LOGO_URL, DEFAULT_SUBJECTS, CCE_LEVELS } from '../components/erpConstants';
import {
  HighContrastStyles,
  ProfileAvatar,
  openDirectWhatsApp,
  sendDirectEmailNotification,
  resolveClassTeacherForStudent
} from '../components/ErpExtensions';

const styles = {
  pageBackground: { minHeight: '100vh', backgroundColor: '#f1f5f9', padding: '28px 16px', fontFamily: 'Inter, system-ui, sans-serif', color: '#0f172a' },
  card: { background: '#ffffff', padding: '26px', borderRadius: '16px', boxShadow: '0 4px 20px rgba(15, 23, 42, 0.04)', border: '1px solid #cbd5e1', marginBottom: '24px' },
  input: { width: '100%', padding: '12px 16px', borderRadius: '10px', border: '1.5px solid #94a3b8', backgroundColor: '#ffffff', color: '#0f172a', fontSize: '15px', fontWeight: '600', outline: 'none', boxSizing: 'border-box' },
  label: { display: 'block', fontSize: '13px', fontWeight: '800', color: '#0f172a', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' },
  buttonPrimary: { padding: '14px 24px', background: 'linear-gradient(135deg, #00897b 0%, #0f766e 100%)', color: '#ffffff', border: 'none', borderRadius: '10px', fontWeight: '800', cursor: 'pointer', fontSize: '15px', boxShadow: '0 4px 12px rgba(15, 118, 110, 0.25)' },
  buttonDanger: { padding: '10px 18px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '10px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' },
  badge: { display: 'inline-block', padding: '5px 10px', borderRadius: '8px', fontSize: '12px', fontWeight: '800' },
  sectionTitle: { margin: '0 0 18px 0', fontSize: '18px', color: '#0f172a', fontWeight: '800', borderBottom: '2px solid #f1f5f9', paddingBottom: '12px' }
};

const printStyles = `
  @media print {
    @page {
      size: A4 portrait;
      margin: 7mm 8mm;
    }
    html, body {
      background: #ffffff !important;
      color: #000000 !important;
      font-size: 11px !important;
      line-height: 1.25 !important;
      margin: 0 !important;
      padding: 0 !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .no-print { display: none !important; }
    .print-container {
      padding: 0 !important;
      margin: 0 !important;
      max-width: 100% !important;
      background: #ffffff !important;
    }
    .print-header-card {
      padding: 10px 14px !important;
      margin-bottom: 8px !important;
      border: 1px solid #94a3b8 !important;
      border-radius: 8px !important;
    }
    .print-header-card h1 {
      font-size: 16px !important;
      margin-bottom: 3px !important;
    }
    .print-kpi-grid {
      display: grid !important;
      grid-template-columns: repeat(4, 1fr) !important;
      gap: 8px !important;
      margin-bottom: 8px !important;
    }
    .print-kpi-card {
      padding: 8px 10px !important;
      border: 1px solid #94a3b8 !important;
      border-radius: 8px !important;
    }
    .print-kpi-val {
      font-size: 16px !important;
    }
    .print-table-card {
      padding: 10px 12px !important;
      margin-bottom: 0 !important;
      border: 1px solid #94a3b8 !important;
      border-radius: 8px !important;
      page-break-inside: avoid !important;
    }
    .print-table-card h3 {
      font-size: 13px !important;
      margin-bottom: 6px !important;
      padding-bottom: 4px !important;
    }
    .print-table {
      width: 100% !important;
      min-width: 100% !important;
      font-size: 11px !important;
      border-collapse: collapse !important;
    }
    .print-table th, .print-table td {
      padding: 5px 6px !important;
      border-bottom: 1px solid #cbd5e1 !important;
    }
    div { box-shadow: none !important; }
  }
`;

const getEnrollmentMatchScore = (student, env, targetSubjectName) => {
  if (env?.isAttendanceOnly) return 0; // Never match non-mark subjects in CCE Mark Sheet!

  const sReg = String(student.regNo || '').trim().toUpperCase();
  const sAd = String(student.adNo || '').trim().toUpperCase();
  const sId = String(student.id || '').trim().toUpperCase();
  const isUrdu = sAd.startsWith('U');
  const studentClassesLower = Array.isArray(student.classes) ? student.classes.map(c => String(c).trim().toLowerCase()) : [];

  const envSubUp = String(env.subject || '').toUpperCase();
  const envAliasUp = String(env.alias || '').toUpperCase();
  const targetUp = String(targetSubjectName).trim().toUpperCase();

  const explicitSubjects = [
    { key: 'U :FIQH', tokens: ['U :FIQH', 'U:FIQH', 'USUL'] },
    { key: 'FIQH', tokens: ['FIQH'] },
    { key: 'THAFSEER', tokens: ['THAFSEER', 'TAFSEER', 'TAFSIR'] },
    { key: 'HADITH', tokens: ['HADITH', 'HADEETH'] },
    { key: 'AQIDAH', tokens: ['AQIDAH', 'AQEEDAH'] },
    { key: 'BALAGHA', tokens: ['BALAGHA'] },
    { key: 'LOGIC', tokens: ['LOGIC', 'MANTIQ'] },
    { key: 'ENGLISH', tokens: ['ENGLISH'] },
    { key: 'ADAB', tokens: ['ADAB'] },
    { key: 'URDU', tokens: ['URDU'] },
    { key: 'SOCIAL SCIENCE', tokens: ['SOCIAL SCIENCE', 'SOCIAL'] },
    { key: 'THAMADUN', tokens: ['THAMADUN', 'TAMADDUN'] },
    { key: 'SPECIALIZATION', tokens: ['SPECIALIZATION', 'TAKASSUS'] },
    { key: 'HIFZ', tokens: ['HIFZ'] }
  ];

  let detectedSubFromAlias = null;
  for (const item of explicitSubjects) {
    if (item.key === 'FIQH') {
      const isUsul = envAliasUp.includes('U :FIQH') || envAliasUp.includes('U:FIQH') || envAliasUp.includes('USUL');
      if (!isUsul && envAliasUp.includes('FIQH')) { detectedSubFromAlias = 'FIQH'; break; }
    } else if (item.tokens.some(tok => envAliasUp.includes(tok))) {
      detectedSubFromAlias = item.key;
      break;
    }
  }

  const effectiveEnvSub = detectedSubFromAlias || (envSubUp === 'MANTIQ' ? 'LOGIC' : envSubUp);
  const normalizedTarget = (targetUp === 'U:FIQH' || targetUp.includes('USUL')) ? 'U :FIQH' : (targetUp === 'MANTIQ' ? 'LOGIC' : targetUp);

  let isMatchingSub = false;
  if (normalizedTarget === 'U :FIQH') {
    isMatchingSub = effectiveEnvSub === 'U :FIQH' || envSubUp.includes('U :FIQH') || envSubUp.includes('U:FIQH');
  } else if (normalizedTarget === 'FIQH') {
    const isUsul = effectiveEnvSub === 'U :FIQH' || envSubUp.includes('U :FIQH') || envSubUp.includes('U:FIQH') || envAliasUp.includes('U :FIQH') || envAliasUp.includes('USUL');
    isMatchingSub = effectiveEnvSub === 'FIQH' && !isUsul;
  } else {
    isMatchingSub = effectiveEnvSub === normalizedTarget;
  }

  if (!isMatchingSub) return 0;

  if (env.studentIds && Array.isArray(env.studentIds) && env.studentIds.length > 0) {
    const savedIds = env.studentIds.map(id => String(id).trim().toUpperCase());
    if (savedIds.includes(sReg) || savedIds.includes(sAd) || savedIds.includes(sId)) {
      return 10;
    }
  }

  const envLang = String(env.langTag || '').trim().toLowerCase();
  const envAliasLower = String(env.alias || '').trim().toLowerCase();
  const envClassLower = String(env.targetClass || '').trim().toLowerCase();

  const isStrictlyUrduOnly = (envLang.includes('urdu') && !envLang.includes('non')) || /\bu(8|9|10)\b/.test(envAliasLower);
  const isStrictlyNonUrduOnly = envLang.includes('non-urdu') || envLang.includes('non urdu') || /\bm(8|9|10)\b/.test(envAliasLower);

  if (isStrictlyUrduOnly && !isUrdu) return 0;
  if (isStrictlyNonUrduOnly && isUrdu) return 0;

  const matchesStudentExactClass = studentClassesLower.some(cls =>
    cls && (envAliasLower.includes(cls) || envClassLower.includes(cls))
  );
  if (matchesStudentExactClass) {
    if (isUrdu && isStrictlyUrduOnly) return 6;
    if (!isUrdu && !isStrictlyUrduOnly) return 6;
    return 5;
  }

  let stGrade = '1';
  if (studentClassesLower.some(c => c.includes('10') || c.includes('3'))) stGrade = '3';
  else if (studentClassesLower.some(c => c.includes('9') || c.includes('2'))) stGrade = '2';

  let gradeMatch = false;
  if (envAliasLower.includes('m10') && stGrade === '3' && !isUrdu) gradeMatch = true;
  if (envAliasLower.includes('m9') && stGrade === '2' && !isUrdu) gradeMatch = true;
  if (envAliasLower.includes('m8') && stGrade === '1' && !isUrdu) gradeMatch = true;
  if (envAliasLower.includes('u10') && stGrade === '3' && isUrdu) gradeMatch = true;
  if (envAliasLower.includes('u9') && stGrade === '2' && isUrdu) gradeMatch = true;
  if (envAliasLower.includes('u8') && stGrade === '1' && isUrdu) gradeMatch = true;

  if (!gradeMatch && (envAliasLower.includes(`grade ${stGrade}`) || envClassLower.includes(`grade ${stGrade}`) || (String(env.grade) === stGrade && !envClassLower))) {
    if (envLang.includes('gen') && isUrdu) return 0;
    gradeMatch = true;
  }

  if (!gradeMatch && normalizedTarget === 'SPECIALIZATION') {
    const stDept = String(student.department || '').trim().toLowerCase();
    if (stDept && (envAliasLower.includes(stDept) || envClassLower.includes(stDept))) {
      gradeMatch = true;
    }
  }

  if (gradeMatch) return 3;
  return 0;
};

function StudentWeeklyReminder({ reminder, studentMarks }) {
  if (!reminder || !reminder.active) return null;
  let configs = reminder.targetConfigs;
  if (!configs && reminder.targetSubjects) {
    configs = {};
    reminder.targetSubjects.forEach(s => { configs[s] = [s.toUpperCase() === 'HIFZ' ? '50_1' : (reminder.level || "15")]; });
  }
  if (!configs || Object.keys(configs).length === 0) return null;

  const formatLevelTag = (lvl) => {
    const strLvl = String(lvl);
    if (strLvl === '50_1') return 'Part 1 (/50)';
    if (strLvl === '50_2') return 'Part 2 (/50)';
    const cceName = Object.keys(CCE_LEVELS).find(key => CCE_LEVELS[key] === strLvl);
    return cceName ? `${cceName} (/${strLvl})` : `Max ${strLvl}`;
  };

  const hasMarkForSubjectLevel = (subName, lvlKey) => {
    if (!studentMarks) return false;
    const foundSubKey = Object.keys(studentMarks).find(k => {
      const kUp = k.toUpperCase();
      const subUp = subName.toUpperCase();
      if (subUp === 'U :FIQH' || subUp === 'U:FIQH') return kUp.includes('U :FIQH') || kUp.includes('U:FIQH');
      if (subUp === 'FIQH') return kUp === 'FIQH' && !kUp.includes('U :FIQH');
      if (subUp === 'LOGIC' || subUp === 'MANTIQ') return kUp === 'LOGIC' || kUp === 'MANTIQ';
      return kUp === subUp;
    });
    if (!foundSubKey || !studentMarks[foundSubKey]) return false;
    const val = studentMarks[foundSubKey][lvlKey];
    return val !== undefined && val !== '';
  };

  return (
    <div className="no-print" style={{ background: '#fffbeb', border: '1.5px solid #fcd34d', padding: '20px', borderRadius: '14px', marginBottom: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
        <span style={{ fontSize: '26px' }}>📢</span>
        <div>
          <span style={{ background: '#d97706', color: '#ffffff', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '800' }}>
            {reminder.weekName || 'Current Week'} Academic Target
          </span>
          <h4 style={{ margin: '6px 0 0 0', color: '#92400e', fontSize: '15px', fontWeight: '800' }}>
            {reminder.message || 'Please complete and submit your assigned CCE works in these subjects:'}
          </h4>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '14px' }}>
        {Object.keys(configs).map(sub => {
          const rawLvls = Array.isArray(configs[sub]) ? configs[sub] : [configs[sub]];
          if (rawLvls.length === 0) return null;
          return (
            <div key={sub} style={{ background: '#ffffff', border: '1px solid #fcd34d', padding: '8px 14px', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: '800', color: '#0f172a', fontSize: '13px' }}>{sub}:</span>
              {rawLvls.map((lvl, i) => {
                const isDone = hasMarkForSubjectLevel(sub, String(lvl));
                return (
                  <span key={i} style={{ background: isDone ? '#dcfce7' : '#fef2f2', color: isDone ? '#166534' : '#dc2626', border: `1px solid ${isDone ? '#86efac' : '#fecaca'}`, padding: '3px 8px', borderRadius: '6px', fontSize: '12px', fontWeight: '800' }}>
                    {isDone ? '✅' : '⏳'} {formatLevelTag(lvl)}
                  </span>
                );
              })}
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
  const [authChecking, setAuthChecking] = useState(true);
  const [loggedInStudent, setLoggedInStudent] = useState(null);
  const [activeTab, setActiveTab] = useState('marks'); // 'marks' | 'attendance' | 'mentorship' | 'portfolio' | 'faculty'

  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const [isLoadingMarks, setIsLoadingMarks] = useState(false);
  const [rawStudentMarks, setRawStudentMarks] = useState({});
  const [activeReminder, setActiveReminder] = useState(null);
  const [teacherDirectory, setTeacherDirectory] = useState([]);
  const [subjectAggregates, setSubjectAggregates] = useState([]);

  const [mentorshipConfig, setMentorshipConfig] = useState({
    semesterName: 'Current Semester',
    minConsultations: 3,
    targetDeadline: '',
    guidelinesNote: ''
  });

  const [attendanceData, setAttendanceData] = useState({
    totalPeriods: 0,
    presentCount: 0,
    officialCount: 0,
    medicalCount: 0,
    minusCount: 0,
    minusLogs: [],
    subjectWise: {}
  });

  const [overallStats, setOverallStats] = useState({
    total1400: '-',
    total490: '-',
    rank: '-',
    totalPeers: '-',
    overallStatus: '-'
  });

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user && user.email && user.email.endsWith('@student.school.com')) {
        const safeRegNo = user.email.split('@')[0].toLowerCase().trim();
        try {
          const docSnap = await getDoc(doc(db, 'students', safeRegNo));
          if (docSnap.exists()) {
            const studentData = { id: docSnap.id, ...docSnap.data() };
            setLoggedInStudent(studentData);
            setAuthenticated(true);
            await loadStudentPortalDataSecurely(studentData);
          }
        } catch (err) {}
      }
      setAuthChecking(false);
    });
    return () => unsub();
  }, []);

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
      const docSnap = await getDoc(doc(db, 'students', safeRegNo));
      if (docSnap.exists()) {
        const studentData = { id: docSnap.id, ...docSnap.data() };
        setLoggedInStudent(studentData);
        setAuthenticated(true);
        await loadStudentPortalDataSecurely(studentData);
      } else {
        setErrorMsg('Student profile not found in database.');
        await signOut(auth);
      }
    } catch (err) {
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
  };

  const handlePrintSinglePagePDF = () => {
    if (activeTab !== 'marks') {
      setActiveTab('marks');
      setTimeout(() => window.print(), 250);
    } else {
      window.print();
    }
  };

  const loadStudentPortalDataSecurely = async (studentData) => {
    setIsLoadingMarks(true);
    try {
      const studentRegNo = studentData.regNo;
      const [myMarksSnap, metaSnap, reminderSnap, mentorCfgSnap] = await Promise.all([
        getDoc(doc(db, 'marks', studentRegNo)),
        getDoc(doc(db, 'systemCache', 'studentPortalMeta')),
        getDoc(doc(db, 'systemCache', 'activeReminder')),
        getDoc(doc(db, 'systemCache', 'mentorshipConfig'))
      ]);

      const marksData = myMarksSnap.exists() ? myMarksSnap.data() : {};
      setRawStudentMarks(marksData);

      const metaData = metaSnap.exists() ? metaSnap.data() : {};
      const reminderData = reminderSnap.exists() ? reminderSnap.data() : null;
      setActiveReminder(reminderData);

      if (mentorCfgSnap.exists()) {
        setMentorshipConfig(prev => ({ ...prev, ...mentorCfgSnap.data() }));
      }

      // 🌟 Reads periodAttendance directly from studentData (Zero Firestore Permission Errors!)
      const ad = studentData.periodAttendance || {};
      setAttendanceData({
        totalPeriods: Number(ad.totalPeriods) || 0,
        presentCount: Number(ad.presentCount) || 0,
        officialCount: Number(ad.officialCount) || 0,
        medicalCount: Number(ad.medicalCount) || 0,
        minusCount: Number(ad.minusCount) || 0,
        minusLogs: Array.isArray(ad.minusLogs) ? ad.minusLogs : [],
        subjectWise: ad.subjectWise || {}
      });

      let liveTeachers = [];
      try {
        const tSnap = await getDocs(collection(db, 'teachers'));
        liveTeachers = tSnap.docs.map(d => d.data());
      } catch (e) {
        liveTeachers = metaData.teacherDirectory || [];
      }
      if (liveTeachers.length === 0) liveTeachers = metaData.teacherDirectory || [];
      setTeacherDirectory(liveTeachers);

      // 🌟 Strictly the 14 academic subjects for Mark Sheet (Never includes non-mark attendance subjects!)
      const expectedSubjects = DEFAULT_SUBJECTS.map(sub => ({ subject: sub }));
      const rankObj = (metaData.classRanks || {})[studentRegNo] || null;

      processMarksLocally(studentData, marksData, expectedSubjects, rankObj, metaData.startedLevels || {}, reminderData, liveTeachers);
    } catch (err) {
      console.error('Error loading student portal data:', err);
    } finally {
      setIsLoadingMarks(false);
    }
  };

  const processMarksLocally = (studentData, marksData, expectedSubjects, rankObj, startedLevelsMap, reminderData, cachedTeachers) => {
    let total1400 = 0;
    let total490 = 0;
    let totalEnteredMaxPossible = 0;
    let hasAnyOverallData = false;
    const subjectList = [];

    const myPrimaryClass = String((studentData.classes || [])[0] || '').trim().toUpperCase();
    const reminderConfigs = reminderData?.active ? (reminderData.targetConfigs || {}) : {};
    const autoClassTeacher = resolveClassTeacherForStudent(studentData, cachedTeachers);

    expectedSubjects.forEach(subObj => {
      const sub = subObj.subject;
      let normKey = sub.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
      if (sub.toUpperCase().includes('U :FIQH') || sub.toUpperCase().includes('U:FIQH')) normKey = 'U :FIQH';
      const isHifz = sub.toUpperCase() === 'HIFZ';
      const isSpecialization = sub.toUpperCase() === 'SPECIALIZATION';

      const foundSubjectKey = Object.keys(marksData).find(k => {
        const kUp = k.toUpperCase();
        const subUp = sub.toUpperCase();
        if (subUp === 'U :FIQH' || subUp === 'U:FIQH') return kUp.includes('U :FIQH') || kUp.includes('U:FIQH');
        if (subUp === 'FIQH') return kUp === 'FIQH' && !kUp.includes('U :FIQH');
        if (subUp === 'LOGIC' || subUp === 'MANTIQ') return kUp === 'LOGIC' || kUp === 'MANTIQ';
        return kUp === subUp;
      });
      const subMarks = foundSubjectKey ? marksData[foundSubjectKey] : {};

      let bestScore = 0;
      let assignedTeacherName = '';
      let assignedTeacherPhone = '';
      let assignedTeacherEmail = '';
      let matchedTeacherEnv = null;

      for (const teacher of cachedTeachers) {
        for (const env of (teacher.enrollments || [])) {
          const score = getEnrollmentMatchScore(studentData, env, sub);
          if (score > bestScore) {
            bestScore = score;
            matchedTeacherEnv = env;
            assignedTeacherName = teacher.fullName;
            assignedTeacherPhone = teacher.whatsappNumber || teacher.mobileNumber || '';
            assignedTeacherEmail = teacher.email || '';
          }
        }
      }

      if (isHifz && bestScore === 0 && autoClassTeacher) {
        assignedTeacherName = autoClassTeacher.fullName;
        assignedTeacherPhone = autoClassTeacher.whatsappNumber || autoClassTeacher.mobileNumber || '';
        assignedTeacherEmail = autoClassTeacher.email || '';
      }

      let levelGradingStarted = isHifz
        ? { '50_1': false, '50_2': false }
        : isSpecialization
          ? { '30': false }
          : { '15': false, '20': false, '25': false, '40': false };

      Object.entries(startedLevelsMap).forEach(([k, lvls]) => {
        const [clsPart, subPart] = k.split(':::');
        let isSubPartMatch = false;
        const sUp = sub.toUpperCase();
        const pUp = subPart.toUpperCase();
        if (sUp === 'U :FIQH' || sUp === 'U:FIQH') isSubPartMatch = pUp.includes('U :FIQH') || pUp.includes('U:FIQH');
        else if (sUp === 'FIQH') isSubPartMatch = pUp === 'FIQH' && !pUp.includes('U :FIQH');
        else if (sUp === 'LOGIC' || sUp === 'MANTIQ') isSubPartMatch = pUp === 'LOGIC' || pUp === 'MANTIQ';
        else isSubPartMatch = sUp === pUp;

        if ((clsPart === myPrimaryClass || (matchedTeacherEnv && clsPart === String(matchedTeacherEnv.targetClass || matchedTeacherEnv.alias || '').toUpperCase())) && isSubPartMatch) {
          (lvls || []).forEach(l => { levelGradingStarted[String(l)] = true; });
        }
      });

      const remSubKey = Object.keys(reminderConfigs).find(k => {
        const kUp = k.toUpperCase();
        const subUp = sub.toUpperCase();
        if (subUp === 'U :FIQH' || subUp === 'U:FIQH') return kUp.includes('U :FIQH') || kUp.includes('U:FIQH');
        if (subUp === 'FIQH') return kUp === 'FIQH' && !kUp.includes('U :FIQH');
        if (subUp === 'LOGIC' || subUp === 'MANTIQ') return kUp === 'LOGIC' || kUp === 'MANTIQ';
        return kUp === subUp;
      });
      if (remSubKey) {
        const rLvls = Array.isArray(reminderConfigs[remSubKey]) ? reminderConfigs[remSubKey] : [reminderConfigs[remSubKey]];
        rLvls.forEach(l => { levelGradingStarted[String(l)] = true; });
      }

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
      } else if (isSpecialization) {
        // 🌟 Direct /30 Specialization Score (or fallback if legacy L1-L4 was entered)
        let s30 = subMarks['30'] !== undefined && subMarks['30'] !== '' && !isNaN(Number(subMarks['30'])) ? Number(subMarks['30']) : '-';
        assessments = { '30': s30 };
        if (s30 !== '-') { subSumObtained += s30; subSumMax += 30; hasData = true; }
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

      let total100 = hasData ? (isSpecialization ? Number(((subSumObtained / 30) * 100).toFixed(1)) : subSumObtained) : '-';
      let semScore = isHifz ? '-' : isSpecialization ? (hasData ? subSumObtained : '-') : (hasData ? Number((subSumObtained * 0.3).toFixed(1)) : '-');
      let status = hasData && subSumMax > 0 ? ((subSumObtained / subSumMax) * 100).toFixed(2) + '%' : '-';

      if (hasData) {
        total1400 += total100;
        total490 += isHifz ? total100 : isSpecialization ? subSumObtained : Number((subSumObtained * 0.3).toFixed(1));
        totalEnteredMaxPossible += isSpecialization ? 100 : subSumMax;
        hasAnyOverallData = true;
      }

      subjectList.push({
        subject: normKey,
        teacherName: assignedTeacherName,
        teacherPhone: assignedTeacherPhone,
        teacherEmail: assignedTeacherEmail,
        isHifz,
        assessments,
        total100,
        semScore,
        status,
        hasData,
        levelGradingStarted
      });
    });

    let overallStatus = '-';
    if (hasAnyOverallData && totalEnteredMaxPossible > 0) {
      overallStatus = ((total1400 / totalEnteredMaxPossible) * 100).toFixed(2) + '%';
    }

    setSubjectAggregates(subjectList);
    setOverallStats({
      total1400: hasAnyOverallData ? total1400 : '-',
      total490: hasAnyOverallData ? total490.toFixed(1) : '-',
      rank: rankObj?.rank || '-',
      totalPeers: rankObj?.totalPeers || '-',
      overallStatus
    });
  };

  const renderMarkCell = (mark, gradingStarted) => {
    if (mark !== '-') return <span style={{ color: '#2563eb', fontWeight: '800', fontSize: '15px' }}>{mark}</span>;
    if (gradingStarted) {
      return (
        <span style={{ background: '#fef2f2', color: '#dc2626', padding: '4px 8px', borderRadius: '6px', fontSize: '12px', fontWeight: '800', border: '1px solid #fecaca' }}>
          ⚠️ Pending
        </span>
      );
    }
    return <span style={{ color: '#cbd5e1', fontWeight: '600' }}>-</span>;
  };

  if (authChecking) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', fontWeight: '800', color: '#0f766e' }}>
        Loading Student Portal...
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f5f9', fontFamily: 'Inter, system-ui, sans-serif', padding: '16px' }}>
        <HighContrastStyles />
        <div style={{ width: '100%', maxWidth: '430px' }}>
          <InstallAppBanner />
          <div style={{ background: '#ffffff', padding: '40px 32px', borderRadius: '20px', boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)', border: '1px solid #cbd5e1' }}>
            <div style={{ textAlign: 'center', marginBottom: '28px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <img src={DHIU_LOGO_URL} alt="DHIU Logo" style={{ width: '72px', height: '72px', borderRadius: '50%', objectFit: 'contain', marginBottom: '10px' }} />
              <h2 style={{ color: '#0f172a', margin: '0 0 6px 0', fontSize: '26px', fontWeight: '800' }}>Student Portal</h2>
              <p style={{ color: '#475569', fontSize: '14px', margin: 0, fontWeight: '600' }}>Sign in to view your CCE marks, attendance & achievements</p>
            </div>
            <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div>
                <label style={styles.label}>Registration Number (Reg.No)</label>
                <input type="text" value={regNo} onChange={(e) => setRegNo(e.target.value)} placeholder="e.g. 726007" required style={styles.input} />
              </div>
              <div>
                <label style={styles.label}>Admission Number (Ad.No)</label>
                <div style={{ position: 'relative', width: '100%' }}>
                  <input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="e.g. U1278" required style={{ ...styles.input, paddingRight: '65px' }} />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#0f766e', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}>
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </div>
              <button type="submit" disabled={isLoading} style={styles.buttonPrimary}>
                {isLoading ? 'Authenticating...' : 'Login to Student Portal'}
              </button>
              {errorMsg && <p style={{ color: '#dc2626', fontSize: '14px', textAlign: 'center', margin: 0, fontWeight: '700', background: '#fef2f2', padding: '12px', borderRadius: '8px', border: '1px solid #fecaca' }}>{errorMsg}</p>}
            </form>
          </div>
        </div>
      </div>
    );
  }

  const studentSkills = Array.isArray(loggedInStudent?.skills) ? loggedInStudent.skills : [];
  const studentAchievements = Array.isArray(loggedInStudent?.achievements) ? loggedInStudent.achievements : [];
  const studentMentorLogs = Array.isArray(loggedInStudent?.mentorLogs)
    ? loggedInStudent.mentorLogs
    : Array.isArray(loggedInStudent?.consultationLogs)
      ? loggedInStudent.consultationLogs
      : [];

  const minReqSittings = Number(mentorshipConfig.minConsultations) || 3;
  const completedSittings = studentMentorLogs.length;
  const metMentorTarget = completedSittings >= minReqSittings;
  const latestSitting = studentMentorLogs[0] || null;

  const mentorTeacherObj = teacherDirectory.find(
    t => String(t.username || '').toLowerCase() === String(loggedInStudent?.mentorUsername || '').toLowerCase()
  );
  const classTeacherObj = resolveClassTeacherForStudent(loggedInStudent, teacherDirectory);

  const netPresent = Math.max(0, attendanceData.presentCount - attendanceData.minusCount);
  const attendancePct = attendanceData.totalPeriods > 0 ? ((netPresent / attendanceData.totalPeriods) * 100).toFixed(1) : '0.0';
  const officialPct = attendanceData.totalPeriods > 0 ? ((attendanceData.officialCount / attendanceData.totalPeriods) * 100).toFixed(1) : '0.0';
  const medicalPct = attendanceData.totalPeriods > 0 ? ((attendanceData.medicalCount / attendanceData.totalPeriods) * 100).toFixed(1) : '0.0';
  const isShortage = attendanceData.totalPeriods > 0 && Number(attendancePct) < 85;

  // Build Attendance Subject List: Excludes Hifz + Adds any Non-Mark Attendance-Only subjects!
  const regularAttendanceSubjects = subjectAggregates.filter(item => !item.isHifz);
  const extraNonMarkSubjects = Object.keys(attendanceData.subjectWise || {})
    .filter(k => {
      const kUp = k.toUpperCase();
      if (kUp === 'HIFZ') return false;
      return !regularAttendanceSubjects.some(regSub => {
        const rUp = regSub.subject.toUpperCase().replace(/\./g, '');
        return rUp === kUp || kUp.includes(rUp);
      });
    })
    .map(k => ({
      subject: k,
      teacherName: attendanceData.subjectWise[k]?.teacherName || 'Assigned Faculty',
      isAttendanceOnly: true
    }));

  const allAttendanceSubjectsForStudent = [...regularAttendanceSubjects, ...extraNonMarkSubjects];

  return (
    <div className="print-container" style={styles.pageBackground}>
      <HighContrastStyles />
      <style dangerouslySetInnerHTML={{ __html: printStyles }} />
      <div className="print-container" style={{ maxWidth: '1140px', margin: '0 auto' }}>
        <div className="no-print"><InstallAppBanner /></div>

        <StudentWeeklyReminder reminder={activeReminder} studentMarks={rawStudentMarks} />

        <div className="print-header-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', background: '#ffffff', padding: '22px 26px', borderRadius: '16px', boxShadow: '0 4px 20px rgba(15, 23, 42, 0.04)', border: '1px solid #cbd5e1', flexWrap: 'wrap', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
            <img src={DHIU_LOGO_URL} alt="DHIU Logo" style={{ width: '54px', height: '54px', borderRadius: '50%', objectFit: 'contain', backgroundColor: '#ffffff' }} />
            <ProfileAvatar name={loggedInStudent?.firstName} code={loggedInStudent?.adNo} photoUrl={loggedInStudent?.photoUrl} size={58} />

            <div>
              <h1 style={{ margin: '0 0 6px 0', fontSize: '23px', color: '#0f172a', fontWeight: '900' }}>
                {loggedInStudent?.firstName}
              </h1>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ ...styles.badge, background: '#f1f5f9', color: '#0f172a', border: '1px solid #cbd5e1' }}>Reg: {loggedInStudent?.regNo}</span>
                <span style={{ ...styles.badge, background: '#f0fdfa', color: '#0f766e', border: '1px solid #99f6e4' }}>Ad.No: #{loggedInStudent?.adNo}</span>
                <span style={{ ...styles.badge, background: '#e0f2fe', color: '#0369a1' }}>{loggedInStudent?.department || 'GENERAL'}</span>
                {loggedInStudent?.classes?.map((cls, i) => (
                  <span key={i} style={{ ...styles.badge, background: '#ede9fe', color: '#6d28d9' }}>Class {cls}</span>
                ))}
                <span style={{
                  ...styles.badge,
                  background: metMentorTarget ? '#dcfce7' : '#fef3c7',
                  color: metMentorTarget ? '#166534' : '#92400e',
                  border: `1px solid ${metMentorTarget ? '#86efac' : '#fde68a'}`
                }}>
                  🧭 Mentor Sittings: {completedSittings} / {minReqSittings} {metMentorTarget ? '✅' : '⏳'}
                </span>
                {attendanceData.totalPeriods > 0 && (
                  <span style={{
                    ...styles.badge,
                    background: isShortage ? '#fef2f2' : '#dcfce7',
                    color: isShortage ? '#dc2626' : '#166534',
                    border: `1px solid ${isShortage ? '#fecaca' : '#86efac'}`
                  }}>
                    📅 Attendance: {attendancePct}% {attendanceData.minusCount > 0 ? `(-${attendanceData.minusCount} Minus)` : ''}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', marginTop: '8px', fontSize: '13px', color: '#334155', fontWeight: '700' }}>
                <span>🧭 Mentor: <strong style={{ color: '#0f766e' }}>{mentorTeacherObj?.fullName || loggedInStudent?.mentorName || loggedInStudent?.mentorUsername || 'Assigned Faculty'}</strong></span>
                <span>🏫 Class Teacher: <strong style={{ color: '#1d4ed8' }}>{classTeacherObj?.fullName || loggedInStudent?.classTeacherUsername || 'Class Faculty'}</strong></span>
              </div>
            </div>
          </div>

          <div className="no-print" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
            <button onClick={handlePrintSinglePagePDF} style={{ padding: '10px 18px', background: '#0f766e', color: '#ffffff', border: 'none', borderRadius: '10px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}>
              🖨️ Print 1-Page PDF Mark Sheet
            </button>
            <button onClick={handleLogout} style={styles.buttonDanger}>Logout</button>
          </div>
        </div>

        {/* 🌟 5-TAB NAVIGATION BAR */}
        <div className="no-print" style={{ display: 'flex', gap: '10px', marginBottom: '22px', flexWrap: 'wrap', background: '#ffffff', padding: '10px 14px', borderRadius: '14px', border: '1px solid #cbd5e1' }}>
          {[
            { id: 'marks', label: '📊 CCE & Hifz Mark Sheet' },
            { id: 'attendance', label: `📅 Attendance & Minus (${attendanceData.totalPeriods > 0 ? `${attendancePct}%` : 'View'})` },
            { id: 'mentorship', label: `🧭 My Mentorship & Sittings (${completedSittings}/${minReqSittings})` },
            { id: 'portfolio', label: `🏆 Skills & Achievements (${studentSkills.length + studentAchievements.length})` },
            { id: 'faculty', label: '👨‍🏫 My Mentor & Subject Usthads' }
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '10px 18px',
                borderRadius: '10px',
                border: 'none',
                fontWeight: '800',
                fontSize: '14px',
                cursor: 'pointer',
                background: activeTab === tab.id ? '#00897b' : '#f1f5f9',
                color: activeTab === tab.id ? '#ffffff' : '#0f172a'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ============================================================
            TAB 1: CCE & HIFZ MARK SHEET (Strictly 14 Academic Subjects)
           ============================================================ */}
        {activeTab === 'marks' && (
          <>
            <div className="print-kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '24px' }}>
              <div className="print-kpi-card" style={{ background: '#ffffff', padding: '22px', borderRadius: '16px', border: '1px solid #cbd5e1', textAlign: 'center' }}>
                <h4 style={{ margin: '0 0 8px 0', color: '#64748b', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase' }}>Total Aggregate</h4>
                <div className="print-kpi-val" style={{ fontSize: '28px', fontWeight: '900', color: '#0f172a' }}>
                  {overallStats.total1400} <span style={{ fontSize: '16px', color: '#64748b', fontWeight: '700' }}>/ 1400</span>
                </div>
              </div>

              <div className="print-kpi-card" style={{ background: '#ffffff', padding: '22px', borderRadius: '16px', border: '1px solid #cbd5e1', textAlign: 'center' }}>
                <h4 style={{ margin: '0 0 8px 0', color: '#64748b', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase' }}>Total Sem Score</h4>
                <div className="print-kpi-val" style={{ fontSize: '28px', fontWeight: '900', color: '#0f172a' }}>
                  {overallStats.total490} <span style={{ fontSize: '16px', color: '#64748b', fontWeight: '700' }}>/ 490</span>
                </div>
              </div>

              <div className="print-kpi-card" style={{ background: '#ffffff', padding: '22px', borderRadius: '16px', border: '1px solid #cbd5e1', textAlign: 'center' }}>
                <h4 style={{ margin: '0 0 8px 0', color: '#64748b', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase' }}>Class Rank</h4>
                <div className="print-kpi-val" style={{ fontSize: '28px', fontWeight: '900', color: '#2563eb' }}>
                  {overallStats.rank !== '-' ? `#${overallStats.rank}` : '-'}
                  {overallStats.totalPeers !== '-' && (
                    <span style={{ fontSize: '14px', color: '#64748b', fontWeight: '700' }}> / {overallStats.totalPeers}</span>
                  )}
                </div>
              </div>

              <div className="print-kpi-card" style={{ background: '#ffffff', padding: '22px', borderRadius: '16px', border: '1px solid #cbd5e1', textAlign: 'center' }}>
                <h4 style={{ margin: '0 0 8px 0', color: '#64748b', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase' }}>Current Status (%)</h4>
                <div className="print-kpi-val" style={{ fontSize: '28px', fontWeight: '900', color: '#059669' }}>
                  {overallStats.overallStatus}
                </div>
              </div>
            </div>

            <div className="print-table-card" style={styles.card}>
              <h3 style={styles.sectionTitle}>📊 Curriculum & Detailed Performance Breakdown</h3>

              {isLoadingMarks ? (
                <p style={{ textAlign: 'center', color: '#64748b', padding: '30px', fontWeight: '700' }}>Loading your academic records...</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="print-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', fontSize: '14px', minWidth: '820px' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '2px solid #cbd5e1' }}>
                        <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', textAlign: 'left' }}>Subject & Assigned Usthad</th>
                        <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800' }}>L1 (15)</th>
                        <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800' }}>L2 (20)</th>
                        <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800' }}>L3 (25)</th>
                        <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800' }}>L4 (40)</th>
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
                            {data.teacherName && (
                              <div style={{ fontSize: '12px', color: '#0f766e', fontWeight: '700', marginTop: '2px' }}>
                                👨‍🏫 {data.teacherName}
                              </div>
                            )}
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
                          ) : data.isSpecialization ? (
                            <td colSpan="4" style={{ padding: '14px 16px' }}>
                              <span style={{ fontSize: '11px', color: '#0f766e', fontWeight: '800', display: 'block', marginBottom: '2px' }}>Direct Specialization Score (/30)</span>
                              {renderMarkCell(data.assessments?.['30'], data.levelGradingStarted?.['30'])}
                            </td>
                          ) : (
                            <>
                              <td style={{ padding: '14px 16px' }}>{renderMarkCell(data.assessments?.['15'], data.levelGradingStarted?.['15'])}</td>
                              <td style={{ padding: '14px 16px' }}>{renderMarkCell(data.assessments?.['20'], data.levelGradingStarted?.['20'])}</td>
                              <td style={{ padding: '14px 16px' }}>{renderMarkCell(data.assessments?.['25'], data.levelGradingStarted?.['25'])}</td>
                              <td style={{ padding: '14px 16px' }}>{renderMarkCell(data.assessments?.['40'], data.levelGradingStarted?.['40'])}</td>
                            </>
                          )}

                          <td style={{ padding: '14px 16px', fontWeight: '800', color: '#1e40af', borderLeft: '1px solid #e2e8f0' }}>{data.total100}</td>
                          <td style={ { padding: '14px 16px', fontWeight: '800', color: '#047857' }}>{data.semScore}</td>
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
          </>
        )}

        {/* ============================================================
            TAB 2: PERIOD ATTENDANCE, SUBJECT BREAKDOWN & MINUS LOGS
           ============================================================ */}
        {activeTab === 'attendance' && (
          <div style={styles.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '16px', borderBottom: '2px solid #f1f5f9', paddingBottom: '14px' }}>
              <div>
                <h3 style={{ margin: '0 0 6px 0', fontSize: '20px', color: '#0f172a', fontWeight: '900' }}>
                  📅 My Semester Period Attendance & Minus Log
                </h3>
                <p style={{ margin: 0, fontSize: '13px', color: '#64748b', fontWeight: '600' }}>
                  Minimum required attendance is <strong>85%</strong>. Minus deductions are subtracted from your overall present periods.
                </p>
              </div>
              <span style={{
                padding: '8px 16px',
                borderRadius: '999px',
                fontSize: '15px',
                fontWeight: '900',
                background: isShortage ? '#fef2f2' : '#dcfce7',
                color: isShortage ? '#dc2626' : '#166534',
                border: `2px solid ${isShortage ? '#fecaca' : '#86efac'}`
              }}>
                {attendancePct}% Net Attendance {isShortage ? '⚠️ (Below 85% Shortage)' : '✅'}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: '14px', marginBottom: '24px' }}>
              <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #cbd5e1', textAlign: 'center' }}>
                <span style={{ fontSize: '11px', fontWeight: '800', color: '#64748b' }}>TOTAL PERIODS</span>
                <div style={{ fontSize: '26px', fontWeight: '900', color: '#0f172a', marginTop: '4px' }}>{attendanceData.totalPeriods}</div>
              </div>
              <div style={{ background: '#ecfdf5', padding: '16px', borderRadius: '12px', border: '1px solid #a7f3d0', textAlign: 'center' }}>
                <span style={{ fontSize: '11px', fontWeight: '800', color: '#047857' }}>GROSS PRESENT</span>
                <div style={{ fontSize: '26px', fontWeight: '900', color: '#059669', marginTop: '4px' }}>{attendanceData.presentCount}</div>
              </div>
              <div style={{ background: '#fee2e2', padding: '16px', borderRadius: '12px', border: '1px solid #fecaca', textAlign: 'center' }}>
                <span style={{ fontSize: '11px', fontWeight: '800', color: '#991b1b' }}>MINUS DEDUCTIONS</span>
                <div style={{ fontSize: '26px', fontWeight: '900', color: '#dc2626', marginTop: '4px' }}>-{attendanceData.minusCount}</div>
              </div>
              <div style={{ background: '#eff6ff', padding: '16px', borderRadius: '12px', border: '1px solid #bfdbfe', textAlign: 'center' }}>
                <span style={{ fontSize: '11px', fontWeight: '800', color: '#1e40af' }}>NET ATTENDED</span>
                <div style={{ fontSize: '26px', fontWeight: '900', color: '#2563eb', marginTop: '4px' }}>{netPresent}</div>
              </div>
              <div style={{ background: '#fffbeb', padding: '16px', borderRadius: '12px', border: '1px solid #fde68a', textAlign: 'center' }}>
                <span style={{ fontSize: '11px', fontWeight: '800', color: '#92400e' }}>OFFICIAL / MEDICAL</span>
                <div style={{ fontSize: '18px', fontWeight: '900', color: '#b45309', marginTop: '8px' }}>
                  Off: {officialPct}% • Med: {medicalPct}%
                </div>
              </div>
            </div>

            {/* 📆 MONTH-BY-MONTH ABSENCE & MINUS SUMMARY */}
            {(() => {
              const monthMap = {};
              Object.entries(attendanceData.subjectWise || {}).forEach(([subName, sObj]) => {
                (sObj.absentDates || []).forEach(dStr => {
                  const mKey = String(dStr || '').slice(0, 7); // "YYYY-MM"
                  if (!mKey) return;
                  if (!monthMap[mKey]) monthMap[mKey] = { absentPeriods: 0, minusPoints: 0, subjects: new Set() };
                  monthMap[mKey].absentPeriods += 1;
                  monthMap[mKey].subjects.add(subName);
                });
              });
              (attendanceData.minusLogs || []).forEach(log => {
                const mKey = String(log.date || '').slice(0, 7);
                if (!mKey) return;
                if (!monthMap[mKey]) monthMap[mKey] = { absentPeriods: 0, minusPoints: 0, subjects: new Set() };
                monthMap[mKey].minusPoints += Number(log.count) || 0;
              });
              const monthsSorted = Object.keys(monthMap).sort().reverse();
              if (monthsSorted.length === 0) return null;

              return (
                <div style={{ marginBottom: '24px' }}>
                  <h4 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: '900', color: '#0f172a' }}>
                    📆 Month-Wise Absence &amp; Minus Summary
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px' }}>
                    {monthsSorted.map(mKey => {
                      const info = monthMap[mKey];
                      return (
                        <div key={mKey} style={{ padding: '14px 16px', borderRadius: '12px', border: '1px solid #cbd5e1', background: '#f8fafc' }}>
                          <div style={{ fontWeight: '900', fontSize: '15px', color: '#0f172a', marginBottom: '6px' }}>
                            🗓️ Month: {mKey}
                          </div>
                          <div style={{ fontSize: '13px', fontWeight: '700', color: '#dc2626' }}>
                            ❌ Class Absences: <strong>{info.absentPeriods} Period(s)</strong>
                          </div>
                          <div style={{ fontSize: '13px', fontWeight: '700', color: '#991b1b', marginTop: '2px' }}>
                            ⚠️ Minus Deducted: <strong>-{info.minusPoints} Point(s)</strong>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* SUBJECT-WISE ATTENDANCE TABLE (Excludes Hifz + Includes Non-Mark Attendance Subjects!) */}
            <h4 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: '900', color: '#0f172a' }}>
              📖 Subject-Wise Attendance Breakdown
            </h4>
            <div style={{ overflowX: 'auto', border: '1px solid #cbd5e1', borderRadius: '12px', marginBottom: '26px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', fontSize: '14px', minWidth: '680px' }}>
                <thead style={{ background: '#0f172a', color: '#ffffff' }}>
                  <tr>
                    <th style={{ padding: '12px 16px', textAlign: 'left' }}>Subject & Usthad</th>
                    <th style={{ padding: '12px 16px' }}>Total Periods</th>
                    <th style={{ padding: '12px 16px' }}>Present</th>
                    <th style={{ padding: '12px 16px' }}>Absent</th>
                    <th style={{ padding: '12px 16px' }}>Subject %</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left' }}>Recorded Absent Dates</th>
                  </tr>
                </thead>
                <tbody>
                  {allAttendanceSubjectsForStudent.map((item, idx) => {
                    const normSub = item.subject.toUpperCase().replace(/\./g, '');
                    const matchKey = Object.keys(attendanceData.subjectWise || {}).find(k => {
                      const kUp = k.toUpperCase().replace(/\./g, '');
                      if (normSub.includes('U :FIQH') || normSub.includes('U:FIQH')) return kUp.includes('U :FIQH') || kUp.includes('U:FIQH') || kUp.includes('USUL');
                      if (normSub === 'FIQH') return kUp === 'FIQH' && !kUp.includes('U :FIQH');
                      if (normSub === 'LOGIC') return kUp === 'LOGIC' || kUp === 'MANTIQ';
                      return kUp === normSub || kUp.includes(normSub);
                    });

                    const sData = matchKey ? attendanceData.subjectWise[matchKey] : { total: 0, present: 0, absentDates: [] };
                    const total = Number(sData.total) || 0;
                    const present = Number(sData.present) || 0;
                    const absent = Math.max(0, total - present);
                    const pct = total > 0 ? ((present / total) * 100).toFixed(1) : null;
                    const absDates = Array.isArray(sData.absentDates) ? sData.absentDates : [];

                    return (
                      <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0', background: idx % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                        <td style={{ padding: '12px 16px', textAlign: 'left' }}>
                          <div style={{ fontWeight: '800', color: '#0f172a' }}>
                            {item.subject}
                            {item.isAttendanceOnly && (
                              <span style={{ marginLeft: '6px', background: '#fef3c7', color: '#b45309', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: '800' }}>
                                Period Only
                              </span>
                            )}
                          </div>
                          {item.teacherName && <div style={{ fontSize: '11px', color: '#0f766e', fontWeight: '700' }}>👨‍🏫 {item.teacherName}</div>}
                        </td>
                        <td style={{ padding: '12px 16px', fontWeight: '700' }}>{total > 0 ? total : '-'}</td>
                        <td style={{ padding: '12px 16px', fontWeight: '800', color: '#047857' }}>{total > 0 ? present : '-'}</td>
                        <td style={{ padding: '12px 16px', fontWeight: '800', color: absent > 0 ? '#dc2626' : '#64748b' }}>{total > 0 ? absent : '-'}</td>
                        <td style={{ padding: '12px 16px', fontWeight: '900', color: pct !== null && Number(pct) < 85 ? '#dc2626' : '#1e40af' }}>
                          {pct !== null ? `${pct}%` : '-'}
                        </td>
                        <td style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', color: '#dc2626', fontWeight: '700' }}>
                          {absDates.length > 0 ? absDates.slice(0, 8).join(', ') : <span style={{ color: '#94a3b8' }}>None</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* MINUS ATTENDANCE LOGS */}
            <h4 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: '900', color: '#0f172a' }}>
              ⚠️ My Disciplinary Minus Attendance Records ({attendanceData.minusLogs.length})
            </h4>
            {attendanceData.minusLogs.length === 0 ? (
              <div style={{ padding: '24px', background: '#f0fdfa', borderRadius: '12px', border: '1px dashed #0d9488', textAlign: 'center', color: '#0f766e', fontWeight: '800' }}>
                Alhamdulillah! You have 0 minus attendance deductions this semester.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {attendanceData.minusLogs.map((log, i) => (
                  <div key={log.id || i} style={{ padding: '16px', borderRadius: '12px', border: '1px solid #fecaca', background: '#fef2f2', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                    <div>
                      <div style={{ fontWeight: '900', color: '#991b1b', fontSize: '15px' }}>
                        -{log.count} Period(s) Deducted
                      </div>
                      <div style={{ fontSize: '14px', color: '#dc2626', fontWeight: '700', marginTop: '4px' }}>
                        Reason / Rule Broken: <strong>"{log.reason}"</strong>
                      </div>
                    </div>
                    <div style={{ fontSize: '12px', color: '#7f1d1d', fontWeight: '700', textAlign: 'right' }}>
                      <div>📅 Date: {log.date}</div>
                      <div>👨‍🏫 Issued by Usthad: <strong>{log.issuedBy || 'Faculty'}</strong></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ============================================================
            TAB 3: MENTORSHIP TAB
           ============================================================ */}
        {activeTab === 'mentorship' && (
          <div style={styles.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '20px', borderBottom: '2px solid #f1f5f9', paddingBottom: '14px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '20px', fontWeight: '900', color: '#0f172a' }}>
                  🧭 My Mentorship & Consultancy Progress ({mentorshipConfig.semesterName})
                </h3>
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#475569', fontWeight: '600' }}>
                  You are required to complete at least <strong>{minReqSittings} consultancy sittings</strong> with your Assigned Mentor this semester.
                </p>
              </div>
              <span style={{
                background: metMentorTarget ? '#dcfce7' : '#fef3c7',
                color: metMentorTarget ? '#166534' : '#92400e',
                padding: '8px 16px',
                borderRadius: '999px',
                fontSize: '14px',
                fontWeight: '900',
                border: `1.5px solid ${metMentorTarget ? '#22c55e' : '#f59e0b'}`
              }}>
                {metMentorTarget
                  ? `✅ Target Achieved (${completedSittings}/${minReqSittings} Sittings)`
                  : `⏳ ${Math.max(0, minReqSittings - completedSittings)} More Sitting(s) Needed (${completedSittings}/${minReqSittings})`}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '24px' }}>
              <div style={{ background: '#f0fdfa', border: '2px solid #0d9488', padding: '18px', borderRadius: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                <div>
                  <div style={{ fontSize: '11px', fontWeight: '900', color: '#0f766e', textTransform: 'uppercase' }}>🧭 My Assigned Mentor Usthad</div>
                  <div style={{ fontSize: '18px', fontWeight: '900', color: '#0f172a', marginTop: '4px' }}>
                    {mentorTeacherObj?.fullName || loggedInStudent?.mentorName || loggedInStudent?.mentorUsername || 'Not Assigned Yet'}
                  </div>
                  {mentorshipConfig.targetDeadline && (
                    <div style={{ fontSize: '12px', color: '#047857', fontWeight: '700', marginTop: '4px' }}>
                      📅 Semester Target Deadline: {mentorshipConfig.targetDeadline}
                    </div>
                  )}
                </div>
                {mentorTeacherObj?.whatsappNumber && (
                  <button
                    type="button"
                    onClick={() => openDirectWhatsApp(mentorTeacherObj.whatsappNumber, `Assalamu Alaikum Usthad, I am ${loggedInStudent.firstName} (#${loggedInStudent.adNo}). I would like to schedule my next mentorship sitting.`)}
                    style={{ padding: '10px 14px', background: '#0d9488', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '800', fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    💬 Request Sitting on WA
                  </button>
                )}
              </div>

              <div style={{ background: '#fffbeb', border: '2px solid #f59e0b', padding: '18px', borderRadius: '14px' }}>
                <div style={{ fontSize: '11px', fontWeight: '900', color: '#b45309', textTransform: 'uppercase' }}>🎯 Current Action Plan & Next Sitting</div>
                {latestSitting?.actionPlan ? (
                  <>
                    <div style={{ fontSize: '15px', fontWeight: '800', color: '#0f172a', marginTop: '6px' }}>
                      "{latestSitting.actionPlan}"
                    </div>
                    {latestSitting.nextFollowUpDate && (
                      <div style={{ fontSize: '12px', color: '#92400e', fontWeight: '800', marginTop: '6px' }}>
                        ⏰ Next Scheduled Sitting: {latestSitting.nextFollowUpDate}
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ fontSize: '13px', color: '#78350f', fontWeight: '600', marginTop: '6px' }}>
                    Meet with your Mentor Usthad to receive your personalized academic and skill action plan.
                  </div>
                )}
              </div>
            </div>

            <h4 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: '900', color: '#0f172a' }}>
              📜 My Recorded Mentorship Sittings ({studentMentorLogs.length})
            </h4>
            {studentMentorLogs.length === 0 ? (
              <div style={{ padding: '28px', background: '#f8fafc', borderRadius: '12px', border: '1px dashed #cbd5e1', textAlign: 'center', color: '#64748b', fontWeight: '700' }}>
                No mentorship sittings have been logged yet. Please meet your Mentor Usthad to complete your {minReqSittings} required sittings.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {studentMentorLogs.map((log, i) => (
                  <div key={log.id || i} style={{ padding: '16px', borderRadius: '12px', border: '1px solid #cbd5e1', background: '#f8fafc' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ background: '#0f172a', color: '#ffffff', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '800' }}>
                          📅 {log.date}
                        </span>
                        <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '800' }}>
                          {log.type || 'Mentorship Sitting'}
                        </span>
                      </div>
                      <span style={{ fontSize: '12px', color: '#475569', fontWeight: '700' }}>
                        👨‍🏫 Mentor: <strong>{log.loggedBy || 'Faculty'}</strong>
                      </span>
                    </div>

                    {Array.isArray(log.topics) && log.topics.length > 0 && (
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
                        {log.topics.map((t, idx) => (
                          <span key={idx} style={{ background: '#ffffff', border: '1px solid #cbd5e1', color: '#334155', padding: '2px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: '700' }}>
                            ✓ {t}
                          </span>
                        ))}
                      </div>
                    )}

                    {log.summary && (
                      <div style={{ fontSize: '14px', color: '#0f172a', fontWeight: '600', marginBottom: '6px' }}>
                        {log.summary}
                      </div>
                    )}

                    {(log.actionPlan || log.nextFollowUpDate) && (
                      <div style={{ marginTop: '8px', padding: '8px 12px', background: '#f0fdfa', borderRadius: '8px', fontSize: '12px', color: '#0f766e', fontWeight: '800', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                        {log.actionPlan && <span>🎯 Action Plan: {log.actionPlan}</span>}
                        {log.nextFollowUpDate && <span>⏰ Follow-Up Date: {log.nextFollowUpDate}</span>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ============================================================
            TAB 4: SKILLS & ACHIEVEMENTS PORTFOLIO
           ============================================================ */}
        {activeTab === 'portfolio' && (
          <div style={styles.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '18px', borderBottom: '2px solid #f1f5f9', paddingBottom: '12px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '19px', fontWeight: '800', color: '#0f172a' }}>
                  🏆 My Verified Skills & Achievements Portfolio
                </h3>
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#475569', fontWeight: '600' }}>
                  Verified and maintained by your Assigned Mentor and Class Teacher.
                </p>
              </div>
              <span style={{ background: '#f0fdfa', color: '#0f766e', border: '1px solid #99f6e4', padding: '6px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: '800' }}>
                🔒 Official Faculty Record (View-Only)
              </span>
            </div>

            <div style={{ marginBottom: '26px' }}>
              <h4 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: '800', color: '#0f172a' }}>
                🌟 Recognized Skills & Talents ({studentSkills.length})
              </h4>
              {studentSkills.length === 0 ? (
                <div style={{ padding: '20px', background: '#f8fafc', borderRadius: '12px', border: '1px dashed #cbd5e1', color: '#64748b', fontSize: '14px', fontWeight: '600' }}>
                  No skills have been added to your portfolio yet. Contact your Mentor or Class Teacher to update your recognized talents.
                </div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                  {studentSkills.map((sk, idx) => (
                    <span key={idx} style={{ background: '#f0fdfa', color: '#0f766e', border: '1.5px solid #0d9488', padding: '8px 16px', borderRadius: '999px', fontSize: '13px', fontWeight: '800' }}>
                      ✦ {sk}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h4 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: '800', color: '#0f172a' }}>
                🏅 Achievements, Awards & Sibaq Log ({studentAchievements.length})
              </h4>
              {studentAchievements.length === 0 ? (
                <div style={{ padding: '24px', background: '#f8fafc', borderRadius: '12px', border: '1px dashed #cbd5e1', color: '#64748b', fontSize: '14px', fontWeight: '600' }}>
                  No achievements or awards recorded yet.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {studentAchievements.map((ach, i) => (
                    <div key={ach.id || i} style={{ padding: '16px', borderRadius: '12px', border: '1px solid #cbd5e1', background: '#f8fafc' }}>
                      <div style={{ fontWeight: '800', color: '#0f172a', fontSize: '15px' }}>🏅 {ach.title}</div>
                      <div style={{ fontSize: '12px', color: '#334155', marginTop: '6px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', fontWeight: '700' }}>
                        <span style={{ background: '#fef3c7', color: '#92400e', padding: '3px 8px', borderRadius: '6px', fontWeight: '800' }}>{ach.category}</span>
                        <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '3px 8px', borderRadius: '6px', fontWeight: '800' }}>{ach.level}</span>
                        <span>📅 {ach.date}</span>
                        {ach.addedBy && <span>• Verified by <strong>{ach.addedBy}</strong></span>}
                      </div>
                      {ach.notes && <div style={{ fontSize: '13px', color: '#1e293b', marginTop: '6px', fontWeight: '600' }}>{ach.notes}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ============================================================
            TAB 5: MENTOR, CLASS TEACHER & 14 SUBJECT USTHADS
           ============================================================ */}
        {activeTab === 'faculty' && (
          <div style={styles.card}>
            <h3 style={styles.sectionTitle}>👨‍🏫 My Academic Mentor, Class Teacher & Subject Faculty</h3>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '24px' }}>
              <div style={{ background: '#f0fdfa', border: '2px solid #0d9488', padding: '18px', borderRadius: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                <div>
                  <div style={{ fontSize: '11px', fontWeight: '900', color: '#0f766e', textTransform: 'uppercase' }}>🧭 Assigned Mentor</div>
                  <div style={{ fontSize: '17px', fontWeight: '800', color: '#0f172a', marginTop: '4px' }}>
                    {mentorTeacherObj?.fullName || loggedInStudent?.mentorUsername || 'Not Assigned'}
                  </div>
                  <div style={{ fontSize: '12px', color: '#334155', fontWeight: '600', marginTop: '2px' }}>
                    Personal guidance, portfolio & academic mentorship
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {mentorTeacherObj?.whatsappNumber && (
                    <button
                      type="button"
                      onClick={() => openDirectWhatsApp(mentorTeacherObj.whatsappNumber, `Assalamu Alaikum Usthad, I am ${loggedInStudent.firstName} (Ad.No #${loggedInStudent.adNo}, Class ${(loggedInStudent.classes || []).join(', ')}).`)}
                      style={{ padding: '8px 12px', background: '#16a34a', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '800', fontSize: '12px', cursor: 'pointer' }}
                    >
                      💬 WhatsApp
                    </button>
                  )}
                  {mentorTeacherObj?.email && (
                    <button
                      type="button"
                      onClick={() => sendDirectEmailNotification('/api/sheets', mentorTeacherObj.email, `Student Inquiry: ${loggedInStudent.firstName} (#${loggedInStudent.adNo})`, `Assalamu Alaikum Usthad ${mentorTeacherObj.fullName},\n\n`)}
                      style={{ padding: '8px 12px', background: '#0284c7', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '800', fontSize: '12px', cursor: 'pointer' }}
                    >
                      ✉️ Email
                    </button>
                  )}
                </div>
              </div>

              <div style={{ background: '#eff6ff', border: '2px solid #3b82f6', padding: '18px', borderRadius: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                <div>
                  <div style={{ fontSize: '11px', fontWeight: '900', color: '#1d4ed8', textTransform: 'uppercase' }}>🏫 Class Teacher</div>
                  <div style={{ fontSize: '17px', fontWeight: '800', color: '#0f172a', marginTop: '4px' }}>
                    {classTeacherObj?.fullName || loggedInStudent?.classTeacherUsername || 'Class Faculty'}
                  </div>
                  <div style={{ fontSize: '12px', color: '#334155', fontWeight: '600', marginTop: '2px' }}>
                    Class {(loggedInStudent?.classes || []).join(', ')} coordinator & Hifz instructor
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {classTeacherObj?.whatsappNumber && (
                    <button
                      type="button"
                      onClick={() => openDirectWhatsApp(classTeacherObj.whatsappNumber, `Assalamu Alaikum Usthad, I am ${loggedInStudent.firstName} (Ad.No #${loggedInStudent.adNo}, Class ${(loggedInStudent.classes || []).join(', ')}).`)}
                      style={{ padding: '8px 12px', background: '#2563eb', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '800', fontSize: '12px', cursor: 'pointer' }}
                    >
                      💬 WhatsApp
                    </button>
                  )}
                  {classTeacherObj?.email && (
                    <button
                      type="button"
                      onClick={() => sendDirectEmailNotification('/api/sheets', classTeacherObj.email, `Student Inquiry: ${loggedInStudent.firstName} (#${loggedInStudent.adNo})`, `Assalamu Alaikum Usthad ${classTeacherObj.fullName},\n\n`)}
                      style={{ padding: '8px 12px', background: '#0284c7', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '800', fontSize: '12px', cursor: 'pointer' }}
                    >
                      ✉️ Email
                    </button>
                  )}
                </div>
              </div>
            </div>

            <h4 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: '800', color: '#0f172a' }}>
              📚 My 14 Subject Usthads
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
              {subjectAggregates.map((item, idx) => (
                <div key={idx} style={{ padding: '14px', borderRadius: '12px', border: '1px solid #cbd5e1', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                  <div>
                    <div style={{ fontWeight: '800', color: '#0f172a', fontSize: '14px' }}>📖 {item.subject}</div>
                    <div style={{ fontSize: '12px', color: '#0f766e', fontWeight: '700', marginTop: '3px' }}>
                      👨‍🏫 {item.teacherName || 'Faculty Assigned by Dept'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    {item.teacherPhone && (
                      <button
                        type="button"
                        onClick={() => openDirectWhatsApp(item.teacherPhone, `Assalamu Alaikum Usthad, I am ${loggedInStudent.firstName} (#${loggedInStudent.adNo}) regarding ${item.subject} CCE work:`)}
                        style={{ padding: '6px 10px', background: '#dcfce7', color: '#166534', border: '1px solid #86efac', borderRadius: '8px', fontWeight: '800', fontSize: '11px', cursor: 'pointer' }}
                      >
                        💬 WA
                      </button>
                    )}
                    {item.teacherEmail && (
                      <button
                        type="button"
                        onClick={() => sendDirectEmailNotification('/api/sheets', item.teacherEmail, `Question regarding ${item.subject}: ${loggedInStudent.firstName} (#${loggedInStudent.adNo})`, `Assalamu Alaikum Usthad,\n\n`)}
                        style={{ padding: '6px 10px', background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd', borderRadius: '8px', fontWeight: '800', fontSize: '11px', cursor: 'pointer' }}
                      >
                        ✉️ Mail
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}