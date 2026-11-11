'use client';
import React, { useState, useEffect } from 'react';
import { auth, db } from '../../lib/firebase';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, getDocs, setDoc, collection, query, where } from 'firebase/firestore';
import InstallAppBanner from '../components/InstallAppBanner';
import { DHIU_LOGO_URL, DEFAULT_SUBJECTS, CCE_LEVELS } from '../components/erpConstants';
import {
  HighContrastStyles,
  CollapsibleCard,
  ProfileAvatar,
  openDirectWhatsApp,
  sendDirectEmailNotification,
  resolveClassTeacherForStudent,
  PortalNotificationBanner
} from '../components/ErpExtensions';

const styles = {
  card: {
    background: '#ffffff',
    padding: '22px',
    borderRadius: '14px',
    boxShadow: '0 1px 3px rgba(15, 23, 42, 0.03)',
    border: '1px solid #e2e8f0',
    marginBottom: '20px'
  },
  input: {
    width: '100%',
    padding: '10px 14px',
    borderRadius: '8px',
    border: '1px solid #cbd5e1',
    backgroundColor: '#ffffff',
    color: '#0f172a',
    fontSize: '14px',
    fontWeight: '500',
    outline: 'none',
    boxSizing: 'border-box'
  },
  label: {
    display: 'block',
    fontSize: '11px',
    fontWeight: '700',
    color: '#475569',
    marginBottom: '6px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  },
  buttonPrimary: {
    padding: '11px 20px',
    background: '#4f46e5',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    fontWeight: '700',
    cursor: 'pointer',
    fontSize: '14px'
  },
  buttonSecondary: {
    padding: '9px 16px',
    background: '#ffffff',
    color: '#334155',
    border: '1px solid #cbd5e1',
    borderRadius: '8px',
    fontWeight: '700',
    cursor: 'pointer',
    fontSize: '13px'
  },
  buttonDanger: {
    padding: '9px 16px',
    background: '#fff1f2',
    color: '#e11d48',
    border: '1px solid #ffe4e6',
    borderRadius: '8px',
    fontWeight: '700',
    cursor: 'pointer',
    fontSize: '13px'
  },
  badge: {
    display: 'inline-block',
    padding: '4px 10px',
    borderRadius: '999px',
    fontSize: '11px',
    fontWeight: '700'
  },
  sectionTitle: {
    margin: '0 0 16px 0',
    fontSize: '17px',
    color: '#0f172a',
    fontWeight: '800',
    borderBottom: '1px solid #f1f5f9',
    paddingBottom: '12px'
  }
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
    .print-only-header { display: flex !important; }
    .print-container {
      padding: 0 !important;
      margin: 0 !important;
      max-width: 100% !important;
      background: #ffffff !important;
      display: block !important;
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
  if (env?.isAttendanceOnly) return 0;

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
    { key: 'LOGIC', tokens: ['LOGIC', 'MANTIQ', 'DIRASATH', 'ADYAN'] },
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

  const effectiveEnvSub = detectedSubFromAlias || (envSubUp === 'MANTIQ' || envSubUp.includes('DIRASATH') || envSubUp.includes('ADYAN') ? 'LOGIC' : envSubUp);
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
  const [expanded, setExpanded] = useState(false);
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
    <div className="no-print" style={{ background: '#ffffff', border: '1px solid #e2e8f0', padding: '14px 18px', borderRadius: '12px', marginBottom: '20px' }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', flexWrap: 'wrap', gap: '10px' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ background: '#eef2ff', color: '#4f46e5', padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: '800', textTransform: 'uppercase' }}>
            📢 {reminder.weekName || 'Current Week'} Target
          </span>
          <span style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a' }}>
            {reminder.message || 'Complete and submit your assigned CCE works'}
          </span>
        </div>
        <span style={{ fontSize: '12px', fontWeight: '700', color: '#4f46e5' }}>
          {expanded ? '▲ Hide Subjects' : '▼ View Target Subjects'}
        </span>
      </div>

      {expanded && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #f1f5f9' }}>
          {Object.keys(configs).map(sub => {
            const rawLvls = Array.isArray(configs[sub]) ? configs[sub] : [configs[sub]];
            if (rawLvls.length === 0) return null;
            return (
              <div key={sub} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '6px 10px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: '700', color: '#0f172a', fontSize: '12px' }}>{sub}:</span>
                {rawLvls.map((lvl, i) => {
                  const isDone = hasMarkForSubjectLevel(sub, String(lvl));
                  return (
                    <span key={i} style={{ background: isDone ? '#ecfdf5' : '#fff1f2', color: isDone ? '#047857' : '#e11d48', padding: '2px 7px', borderRadius: '6px', fontSize: '11px', fontWeight: '700' }}>
                      {isDone ? '✓' : '⏳'} {formatLevelTag(lvl)}
                    </span>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

class StudentPortalErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error('StudentPortal caught error:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', background: '#f8fafc', fontFamily: 'Inter, system-ui, sans-serif' }}>
          <div style={{ maxWidth: '440px', background: '#ffffff', borderRadius: '16px', padding: '32px', border: '1px solid #e2e8f0', textAlign: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
            <div style={{ fontSize: '36px', marginBottom: '12px' }}>⚠️</div>
            <h3 style={{ fontSize: '18px', fontWeight: '800', color: '#0f172a', margin: '0 0 8px 0' }}>Student Portal Notice</h3>
            <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 20px 0' }}>An unexpected error occurred while loading this view. You can reload or return to the sign-in screen.</p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{ padding: '9px 16px', background: '#4f46e5', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '700', fontSize: '13px', cursor: 'pointer' }}
              >
                🔄 Reload
              </button>
              <button
                type="button"
                onClick={async () => {
                  try { const { signOut } = await import('firebase/auth'); await signOut(auth); } catch (e) {}
                  window.location.href = '/';
                }}
                style={{ padding: '9px 16px', background: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1', borderRadius: '8px', fontWeight: '700', fontSize: '13px', cursor: 'pointer' }}
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function StudentDashboardInner() {
  const [regNo, setRegNo] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [authenticated, setAuthenticated] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [loggedInStudent, setLoggedInStudent] = useState(null);
  const [activeTab, setActiveTab] = useState('marks'); // 'marks' | 'attendance' | 'mentorship' | 'portfolio'
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

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

  const [studentAttScope, setStudentAttScope] = useState('monthly');
  const [studentAttMonth, setStudentAttMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [studentAttDate, setStudentAttDate] = useState(() => new Date().toISOString().split('T')[0]);
  const todayDateStr = React.useMemo(() => new Date().toISOString().split('T')[0], []);

  const [monthSessions, setMonthSessions] = useState([]);
  const [loadingMonthSessions, setLoadingMonthSessions] = useState(false);

  useEffect(() => {
    if (!studentAttMonth || !authenticated) return;
    let isMounted = true;
    setLoadingMonthSessions(true);

    async function fetchMonthSessions() {
      try {
        const snap = await getDocs(collection(db, 'systemCache'));
        if (!isMounted) return;
        const list = [];
        snap.forEach(d => {
          if (d.id.startsWith(`periodSession_${studentAttMonth}`)) {
            list.push({ id: d.id, ...d.data() });
          }
        });
        setMonthSessions(list);
      } catch (err) {
        console.warn('Error fetching monthly attendance sessions:', err);
      } finally {
        if (isMounted) setLoadingMonthSessions(false);
      }
    }

    fetchMonthSessions();
    return () => { isMounted = false; };
  }, [studentAttMonth, authenticated]);

  const daysInMonth = React.useMemo(() => {
    const [yearStr, monthStr] = (studentAttMonth || '2026-11').split('-');
    const y = parseInt(yearStr, 10);
    const m = parseInt(monthStr, 10);
    if (isNaN(y) || isNaN(m)) return [];
    const numDays = new Date(y, m, 0).getDate();
    const days = [];
    const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    for (let i = 1; i <= numDays; i++) {
      const dStr = `${yearStr}-${String(m).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      const dateObj = new Date(y, m - 1, i);
      const dayOfWeek = dateObj.getDay();
      days.push({
        dateStr: dStr,
        dayNum: String(i).padStart(2, '0'),
        dayName: dayNames[dayOfWeek],
        isFriday: dayOfWeek === 5
      });
    }
    return days;
  }, [studentAttMonth]);

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

  const [clearanceCerts, setClearanceCerts] = useState([]);
  const [selectedCertToView, setSelectedCertToView] = useState(null);
  const [acknowledgingCertId, setAcknowledgingCertId] = useState('');

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
    const paddedPassword = safeAdNo.length < 6 ? safeAdNo.padStart(6, '0') : safeAdNo;

    const passwordAttempts = Array.from(new Set([
      paddedPassword,
      safeAdNo,
      safeAdNo.toUpperCase(),
      safeAdNo.toLowerCase()
    ]));

    let loggedIn = false;
    for (const pwd of passwordAttempts) {
      try {
        await signInWithEmailAndPassword(auth, fakeEmail, pwd);
        loggedIn = true;
        break;
      } catch (err) {
        // try next password variation
      }
    }

    if (!loggedIn) {
      setErrorMsg('Invalid Registration Number or Admission Number.');
      setIsLoading(false);
      return;
    }

    try {
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
      setErrorMsg('Error loading profile: ' + (err.message || ''));
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

  const handleAcknowledgeCert = async (certId) => {
    setAcknowledgingCertId(certId);
    try {
      const nowIso = new Date().toISOString();
      await setDoc(doc(db, 'clearance_certificates', certId), {
        status: 'CONFIRMED',
        studentConfirmedAt: nowIso
      }, { merge: true });

      setClearanceCerts(prev =>
        prev.map(c => c.id === certId ? { ...c, status: 'CONFIRMED', studentConfirmedAt: nowIso } : c)
      );
    } catch (err) {
      alert('Error acknowledging certificate: ' + err.message);
    } finally {
      setAcknowledgingCertId('');
    }
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
      const studentRegNo = String(studentData.regNo || '').trim();
      const studentAdNo = String(studentData.adNo || '').trim();
      let marksData = {};

      const [myMarksSnap, metaSnap, reminderSnap, mentorCfgSnap] = await Promise.all([
        studentRegNo ? getDoc(doc(db, 'marks', studentRegNo)) : null,
        getDoc(doc(db, 'systemCache', 'studentPortalMeta')),
        getDoc(doc(db, 'systemCache', 'activeReminder')),
        getDoc(doc(db, 'systemCache', 'mentorshipConfig'))
      ]);

      if (myMarksSnap && myMarksSnap.exists()) {
        marksData = { ...(myMarksSnap.data() || {}) };
      }
      if (studentAdNo) {
        const adSnap = await getDoc(doc(db, 'marks', studentAdNo));
        if (adSnap.exists()) {
          const adMarks = adSnap.data() || {};
          Object.keys(adMarks).forEach(k => {
            marksData[k] = { ...(marksData[k] || {}), ...(adMarks[k] || {}) };
          });
        }
      }
      setRawStudentMarks(marksData);

      const metaData = metaSnap.exists() ? metaSnap.data() : {};
      const reminderData = reminderSnap.exists() ? reminderSnap.data() : null;
      setActiveReminder(reminderData);

      if (mentorCfgSnap.exists()) {
        setMentorshipConfig(prev => ({ ...prev, ...mentorCfgSnap.data() }));
      }

      const ad = studentData.periodAttendance || {};
      const cleanSubjectWise = {};
      Object.entries(ad.subjectWise || {}).forEach(([k, val]) => {
        const kUp = k.toUpperCase();
        if (kUp.includes('REHEARSAL') || kUp.includes('FEST')) return;
        cleanSubjectWise[k] = val;
      });
      setAttendanceData({
        totalPeriods: Number(ad.totalPeriods) || 0,
        presentCount: Number(ad.presentCount) || 0,
        officialCount: Number(ad.officialCount) || 0,
        medicalCount: Number(ad.medicalCount) || 0,
        minusCount: Number(ad.minusCount) || 0,
        minusLogs: Array.isArray(ad.minusLogs) ? ad.minusLogs : [],
        subjectWise: cleanSubjectWise
      });

      const localCerts = Array.isArray(ad.clearanceCertificates) ? ad.clearanceCertificates : [];
      setClearanceCerts(localCerts);

      try {
        getDocs(query(collection(db, 'clearance_certificates'), where('regNo', '==', studentRegNo)))
          .then(snap => {
            const fetched = [];
            snap.forEach(d => fetched.push({ id: d.id, ...d.data() }));
            if (fetched.length > 0) {
              setClearanceCerts(fetched.sort((a, b) => (b.issuedAt || '').localeCompare(a.issuedAt || '')));
            }
          }).catch(() => {});
      } catch (ce) {}

      let liveTeachers = [];
      try {
        const tSnap = await getDocs(collection(db, 'teachers'));
        liveTeachers = tSnap.docs.map(d => d.data());
      } catch (e) {
        liveTeachers = metaData.teacherDirectory || [];
      }
      if (liveTeachers.length === 0) liveTeachers = metaData.teacherDirectory || [];
      setTeacherDirectory(liveTeachers);

      const deptCapitalized = studentData.department ? (studentData.department.charAt(0).toUpperCase() + studentData.department.slice(1).toLowerCase()) : '';
      const specBranchSubject = deptCapitalized ? `Specialization (${deptCapitalized})` : 'Specialization';
      const expectedSubjects = DEFAULT_SUBJECTS.map(sub => ({
        subject: sub === 'Specialization' ? specBranchSubject : sub
      }));
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
      const isHifz = sub.toUpperCase() === 'HIFZ' || sub.toUpperCase().includes('HIFZ') || sub.toUpperCase() === 'QURAN' || sub.toUpperCase().includes('QURAN');
      const isSpecialization = sub.toUpperCase() === 'SPECIALIZATION';

      const matchingMarkKeys = Object.keys(marksData).filter(k => {
        const kUp = k.trim().toUpperCase();
        const subUp = sub.trim().toUpperCase();
        if (subUp === 'U :FIQH' || subUp === 'U:FIQH') return kUp.includes('U :FIQH') || kUp.includes('U:FIQH');
        if (subUp === 'FIQH') return (kUp === 'FIQH' || kUp === 'FIQH ') && !kUp.includes('U :FIQH') && !kUp.includes('U:FIQH');
        if (subUp === 'LOGIC' || subUp === 'MANTIQ') return kUp === 'LOGIC' || kUp === 'MANTIQ' || kUp.includes('DIRASATH') || kUp.includes('ADYAN');
        if (isHifz) return kUp === 'HIFZ' || kUp.includes('HIFZ') || kUp === 'QURAN' || kUp.includes('QURAN') || kUp === 'HIFDH';
        return kUp === subUp;
      });
      let subMarks = {};
      matchingMarkKeys.forEach(k => {
        subMarks = { ...subMarks, ...(marksData[k] || {}) };
      });

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
        const parts = k.split(':::');
        const clsPart = (parts[0] || '').trim().toUpperCase();
        const subPart = (parts[1] || '').trim().toUpperCase();
        let isSubPartMatch = false;
        const sUp = sub.trim().toUpperCase();
        const pUp = subPart;
        if (sUp === 'U :FIQH' || sUp === 'U:FIQH') isSubPartMatch = pUp.includes('U :FIQH') || pUp.includes('U:FIQH');
        else if (sUp === 'FIQH') isSubPartMatch = pUp === 'FIQH' && !pUp.includes('U :FIQH');
        else if (sUp === 'LOGIC' || sUp === 'MANTIQ') isSubPartMatch = pUp === 'LOGIC' || pUp === 'MANTIQ' || pUp.includes('DIRASATH') || pUp.includes('ADYAN');
        else if (isHifz) isSubPartMatch = pUp === 'HIFZ' || pUp.includes('HIFZ') || pUp === 'QURAN' || pUp.includes('QURAN') || pUp === 'HIFDH';
        else isSubPartMatch = sUp === pUp;

        const primaryClsNorm = myPrimaryClass.replace(/\s+/g, '');
        const clsPartNorm = clsPart.replace(/\s+/g, '').replace('HIFZ', '');
        const isClassMatch = clsPart === myPrimaryClass ||
                             clsPartNorm === primaryClsNorm ||
                             (matchedTeacherEnv && clsPart === String(matchedTeacherEnv.targetClass || matchedTeacherEnv.alias || '').toUpperCase());

        if (isClassMatch && isSubPartMatch) {
          (lvls || []).forEach(l => {
            const lStr = String(l).trim();
            levelGradingStarted[lStr] = true;
            if (isHifz) {
              if (lStr === '1' || lStr === '50_1' || lStr === 'Part 1' || lStr === '501') {
                levelGradingStarted['50_1'] = true;
                levelGradingStarted['1'] = true;
              }
              if (lStr === '2' || lStr === '50_2' || lStr === 'Part 2' || lStr === '502') {
                levelGradingStarted['50_2'] = true;
                levelGradingStarted['2'] = true;
              }
              if (lStr === '50') {
                levelGradingStarted['50_1'] = true;
                levelGradingStarted['50_2'] = true;
              }
            }
          });
        }
      });

      const remSubKey = Object.keys(reminderConfigs).find(k => {
        const kUp = k.toUpperCase();
        const subUp = sub.toUpperCase();
        if (subUp === 'U :FIQH' || subUp === 'U:FIQH') return kUp.includes('U :FIQH') || kUp.includes('U:FIQH');
        if (subUp === 'FIQH') return kUp === 'FIQH' && !kUp.includes('U :FIQH');
        if (subUp === 'LOGIC' || subUp === 'MANTIQ') return kUp === 'LOGIC' || kUp === 'MANTIQ';
        if (isHifz) return kUp === 'HIFZ' || kUp.includes('HIFZ') || kUp === 'QURAN';
        return kUp === subUp;
      });
      if (remSubKey) {
        const rLvls = Array.isArray(reminderConfigs[remSubKey]) ? reminderConfigs[remSubKey] : [reminderConfigs[remSubKey]];
        rLvls.forEach(l => {
          const lStr = String(l).trim();
          levelGradingStarted[lStr] = true;
          if (isHifz) {
            if (lStr === '1' || lStr === '50_1' || lStr === 'Part 1') {
              levelGradingStarted['50_1'] = true;
              levelGradingStarted['1'] = true;
            }
            if (lStr === '2' || lStr === '50_2' || lStr === 'Part 2') {
              levelGradingStarted['50_2'] = true;
              levelGradingStarted['2'] = true;
            }
          }
        });
      }

      let subSumObtained = 0;
      let subSumMax = 0;
      let hasData = false;
      let assessments = {};

      if (isHifz) {
        const rawH1 = subMarks['50_1'] ?? subMarks['50-1'] ?? subMarks['501'] ?? subMarks['Part 1'] ?? subMarks['part1'] ?? subMarks['1'] ?? (subMarks['50_2'] === undefined && subMarks['50-2'] === undefined ? subMarks['50'] : undefined);
        const rawH2 = subMarks['50_2'] ?? subMarks['50-2'] ?? subMarks['502'] ?? subMarks['Part 2'] ?? subMarks['part2'] ?? subMarks['2'];

        let h1 = rawH1 !== undefined && rawH1 !== '' && !isNaN(Number(rawH1)) ? Number(rawH1) : '-';
        let h2 = rawH2 !== undefined && rawH2 !== '' && !isNaN(Number(rawH2)) ? Number(rawH2) : '-';
        assessments = { '50_1': h1, '50_2': h2 };
        if (h1 !== '-') { subSumObtained += h1; subSumMax += 50; hasData = true; }
        if (h2 !== '-') { subSumObtained += h2; subSumMax += 50; hasData = true; }
      } else if (isSpecialization) {
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
        isSpecialization,
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
    if (mark !== '-') return <span style={{ color: '#4f46e5', fontWeight: '700', fontSize: '14px' }}>{mark}</span>;
    if (gradingStarted) {
      return (
        <span style={{ background: '#fff1f2', color: '#e11d48', padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: '700' }}>
          Pending
        </span>
      );
    }
    return <span style={{ color: '#cbd5e1', fontWeight: '500' }}>-</span>;
  };

  if (authChecking) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', fontWeight: '700', color: '#4f46e5' }}>
        Loading Student Portal...
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc', fontFamily: 'Inter, system-ui, sans-serif', padding: '16px' }}>
        <HighContrastStyles />
        <div style={{ width: '100%', maxWidth: '420px' }}>
          <InstallAppBanner />
          <div style={{ background: '#ffffff', padding: '38px 32px', borderRadius: '16px', boxShadow: '0 4px 20px rgba(15, 23, 42, 0.05)', border: '1px solid #e2e8f0' }}>
            <div style={{ textAlign: 'center', marginBottom: '28px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <img src={DHIU_LOGO_URL} alt="DHIU Logo" style={{ width: '68px', height: '68px', borderRadius: '50%', objectFit: 'contain', marginBottom: '12px' }} />
              <h2 style={{ color: '#0f172a', margin: '0 0 6px 0', fontSize: '24px', fontWeight: '800' }}>DHIU Degree Campus</h2>
              <p style={{ color: '#64748b', fontSize: '14px', margin: 0, fontWeight: '500' }}>Sign in to view your marks, attendance &amp; portfolio</p>
            </div>
            <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div>
                <label style={styles.label}>Registration Number (Reg.No)</label>
                <input type="text" value={regNo} onChange={(e) => setRegNo(e.target.value)} placeholder="e.g. 726007" required style={styles.input} />
              </div>
              <div>
                <label style={styles.label}>Admission Number (Ad.No)</label>
                <div style={{ position: 'relative', width: '100%' }}>
                  <input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="e.g. U1278" required style={{ ...styles.input, paddingRight: '65px' }} />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#4f46e5', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}>
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </div>
              <button type="submit" disabled={isLoading} style={styles.buttonPrimary}>
                {isLoading ? 'Authenticating...' : 'Sign In'}
              </button>
              {errorMsg && <p style={{ color: '#e11d48', fontSize: '13px', textAlign: 'center', margin: 0, fontWeight: '700', background: '#fff1f2', padding: '12px', borderRadius: '8px', border: '1px solid #ffe4e6' }}>{errorMsg}</p>}
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

  // Canonical Subject Name Normalizer
  const canonicalSubject = (subKey) => {
    const up = String(subKey || '').trim().toUpperCase();
    if (up.includes('THAFSEER')) return 'Thafseer';
    if (up.includes('HADEES') || up.includes('HADITH')) return 'Hadith';
    if (up.includes('U :FIQH') || up.includes('U:FIQH') || up.includes('U: FIQH')) return 'U :FIQH';
    if (up.includes('FIQH')) return 'Fiqh';
    if (up.includes('AQEED') || up.includes('AQIDAH')) return 'Aqidah';
    if (up.includes('BALAG')) return 'Balagha';
    if (up.includes('MANTHIQ') || up.includes('MANTIQ') || up.includes('LOGIC') || up.includes('DIRASATHUL ADYAN') || up.includes('DIRASATH') || up.includes('DIRASAT') || up.includes('ADYAN')) return 'Logic';
    if (up.includes('ENGLISH')) return 'English';
    if (up.includes('ADAB')) return 'Adab';
    if (up.includes('URDU')) return 'Urdu';
    if (up === 'SS' || up.startsWith('SS ') || up.endsWith(' SS') || up.includes('SOCIAL')) return 'Social Science';
    if (up.includes('THAMAD')) return 'Thamadun';
    if (up.includes('PKV')) return 'PKV';
    if (up.includes('RP')) return 'RP';
    if (up.includes('SPECIALIZATION') || up.includes('TAKASSUS') || up.includes('THAKHASUS') || up.includes('TKS')) {
      if (up.includes('FIQH') || up.includes('HANAFI')) return 'Specialization (Fiqh)';
      if (up.includes('QURAN') || up.includes('Q3') || up.includes('Q1') || up.includes('Q2')) return 'Specialization (Quran)';
      if (up.includes('HADEES') || up.includes('HADITH') || up.includes('H3') || up.includes('H2') || up.includes('H1')) return 'Specialization (Hadith)';
      if (up.includes('CIVIL') || up.includes('C1') || up.includes('C2') || up.includes('C3')) return 'Specialization (Civil)';
      if (up.includes('LANGUAGE') || up.includes('L1') || up.includes('L2') || up.includes('L3')) return 'Specialization (Language)';
      if (up.includes('AQEED') || up.includes('AQIDAH') || up.includes('A3') || up.includes('A2') || up.includes('A1')) return 'Specialization (Aqidah)';
      return 'Specialization';
    }
    return subKey;
  };

  const deduplicatedSubjectsMap = new Map();

  (subjectAggregates || []).filter(item => !item.isHifz).forEach(item => {
    const subUpper = String(item.subject || '').toUpperCase();
    if (subUpper.includes('REHEARSAL') || subUpper.includes('FEST')) return;
    const canon = canonicalSubject(item.subject);
    if (canon.toUpperCase().includes('REHEARSAL') || canon.toUpperCase().includes('FEST')) return;
    deduplicatedSubjectsMap.set(canon, {
      subject: canon,
      teacherName: item.teacherName || '',
      isAttendanceOnly: false
    });
  });

  Object.keys(attendanceData?.subjectWise || {}).forEach(k => {
    const kUp = k.toUpperCase();
    if (kUp === 'HIFZ' || kUp.includes('REHEARSAL') || kUp.includes('FEST')) return;
    const canon = canonicalSubject(k);
    if (canon.toUpperCase().includes('REHEARSAL') || canon.toUpperCase().includes('FEST')) return;
    if (!deduplicatedSubjectsMap.has(canon)) {
      deduplicatedSubjectsMap.set(canon, {
        subject: canon,
        teacherName: attendanceData.subjectWise[k]?.teacherName || '',
        isAttendanceOnly: true
      });
    } else {
      const existing = deduplicatedSubjectsMap.get(canon);
      if (!existing.teacherName && attendanceData.subjectWise[k]?.teacherName) {
        existing.teacherName = attendanceData.subjectWise[k].teacherName;
      }
    }
  });

  const allAttendanceSubjectsForStudent = Array.from(deduplicatedSubjectsMap.values())
    .filter(item => !String(item.subject).toUpperCase().includes('REHEARSAL') && !String(item.subject).toUpperCase().includes('FEST') && !String(item.subject).toUpperCase().includes('DIRASATH') && !String(item.subject).toUpperCase().includes('ADYAN'));

  const getSubjectAttendanceStats = (canonSubject, scopeMonth) => {
    const matchingEntries = Object.entries(attendanceData?.subjectWise || {}).filter(([k]) => canonicalSubject(k) === canonSubject);

    let total = 0;
    const absentDatesSet = new Set();
    let teacher = '';

    matchingEntries.forEach(([k, v]) => {
      total = Math.max(total, Number(v?.total) || 0);
      (Array.isArray(v?.absentDates) ? v.absentDates : []).forEach(d => absentDatesSet.add(d));
      if (!teacher && v?.teacherName) teacher = v.teacherName;
    });

    const allAbsentDates = Array.from(absentDatesSet).sort();
    const scopedAbsentDates = scopeMonth
      ? allAbsentDates.filter(d => String(d).startsWith(scopeMonth))
      : allAbsentDates;

    const present = Math.max(0, total - allAbsentDates.length);
    const pct = total > 0 ? ((present / total) * 100).toFixed(1) : null;

    return {
      total,
      present,
      absent: allAbsentDates.length,
      pct,
      teacherName: teacher,
      allAbsentDates,
      scopedAbsentDates
    };
  };

  const studentNavItems = [
    { id: 'marks', label: 'CCE & Hifz Marks', icon: '📊', desc: 'Curriculum performance & class rank' },
    { id: 'attendance', label: 'Period Attendance', icon: '📅', desc: `Semester attendance (${attendancePct}%) & minus log` },
    { id: 'mentorship', label: 'My Mentorship', icon: '🧭', desc: `Consultancy sittings (${completedSittings}/${minReqSittings}) & action plan` },
    { id: 'portfolio', label: 'Skills & Awards', icon: '🏆', desc: 'Verified talents & Sibaq achievements' }
  ];

  const currentTabObj = studentNavItems.find(x => x.id === activeTab) || studentNavItems[0];

  return (
    <div className="print-container" style={{ minHeight: '100vh', display: 'flex', backgroundColor: '#f8fafc', fontFamily: 'Inter, system-ui, -apple-system, sans-serif', color: '#0f172a' }}>
      <HighContrastStyles />
      <style dangerouslySetInnerHTML={{ __html: printStyles }} />
      <style>{`
        @media (max-width: 960px) {
          .dhiu-student-sidebar {
            position: fixed !important;
            top: 0;
            left: 0;
            bottom: 0;
            z-index: 1200;
            transform: translateX(-100%);
            transition: transform 0.25s ease;
          }
          .dhiu-student-sidebar.open {
            transform: translateX(0);
          }
          .dhiu-student-menu-btn {
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

      {mobileSidebarOpen && (
        <div
          className="no-print"
          onClick={() => setMobileSidebarOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.4)', zIndex: 1150 }}
        />
      )}

      {/* 🌟 LEFT SIDEBAR NAVIGATION FOR STUDENT PORTAL */}
      <aside
        className={`dhiu-student-sidebar no-print ${mobileSidebarOpen ? 'open' : ''}`}
        style={{
          width: '250px',
          minWidth: '250px',
          backgroundColor: '#ffffff',
          borderRight: '1px solid #e2e8f0',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          position: 'sticky',
          top: 0,
          height: '100vh',
          padding: '20px 14px',
          boxSizing: 'border-box'
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '4px 10px 18px', borderBottom: '1px solid #f1f5f9' }}>
            <img src={DHIU_LOGO_URL} alt="DHIU" style={{ width: '38px', height: '38px', borderRadius: '10px', objectFit: 'contain', border: '1px solid #e2e8f0', padding: '2px' }} />
            <div>
              <div style={{ fontSize: '17px', fontWeight: '800', color: '#0f172a', lineHeight: 1.2 }}>DHIU Degree Campus</div>
              <div style={{ fontSize: '10px', fontWeight: '800', color: '#4f46e5', letterSpacing: '0.6px', textTransform: 'uppercase', marginTop: '2px' }}>
                👨‍🎓 STUDENT PORTAL
              </div>
            </div>
          </div>

          <div style={{ fontSize: '11px', fontWeight: '800', color: '#94a3b8', letterSpacing: '0.8px', padding: '16px 12px 8px', textTransform: 'uppercase' }}>
            NAVIGATION
          </div>

          <nav style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {studentNavItems.map(item => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(item.id);
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

        <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button
            type="button"
            onClick={handlePrintSinglePagePDF}
            style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', borderRadius: '8px', background: '#f8fafc', color: '#334155', border: '1px solid #e2e8f0', fontSize: '13px', fontWeight: '700', cursor: 'pointer', width: '100%', textAlign: 'left' }}
          >
            <span>🖨️</span> Print 1-Page Mark Sheet
          </button>
          <button
            type="button"
            onClick={handleLogout}
            style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', borderRadius: '8px', background: '#fff1f2', color: '#e11d48', border: '1px solid #ffe4e6', fontSize: '13px', fontWeight: '700', cursor: 'pointer', width: '100%', textAlign: 'left' }}
          >
            <span>🚪</span> Sign Out
          </button>
        </div>
      </aside>

      {/* 🌟 MAIN STUDENT CONTENT AREA */}
      <div className="print-container" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Clean Minimalist Top Bar */}
        <header className="no-print" style={{ backgroundColor: '#ffffff', borderBottom: '1px solid #e2e8f0', padding: '14px 26px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', position: 'sticky', top: 0, zIndex: 90 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="dhiu-student-menu-btn"
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
            <span style={{ background: '#f8fafc', color: '#4f46e5', border: '1px solid #e2e8f0', padding: '5px 12px', borderRadius: '999px', fontSize: '11px', fontWeight: '800' }}>
              Ad.No: #{loggedInStudent?.adNo} • Reg: {loggedInStudent?.regNo}
            </span>
            <span style={{ background: '#f8fafc', color: '#334155', border: '1px solid #e2e8f0', padding: '5px 12px', borderRadius: '999px', fontSize: '11px', fontWeight: '700' }}>
              Class {(loggedInStudent?.classes || []).join(', ')} • {loggedInStudent?.department || 'GENERAL'}
            </span>
            {attendanceData.totalPeriods > 0 && (
              <span
                onClick={() => setActiveTab('attendance')}
                style={{
                  background: isShortage ? '#fff1f2' : '#ecfdf5',
                  color: isShortage ? '#e11d48' : '#047857',
                  border: `1px solid ${isShortage ? '#fecdd3' : '#a7f3d0'}`,
                  padding: '5px 12px',
                  borderRadius: '999px',
                  fontSize: '11px',
                  fontWeight: '800',
                  cursor: 'pointer'
                }}
              >
                📅 Att: {attendancePct}%
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <ProfileAvatar name={loggedInStudent?.firstName} code={loggedInStudent?.adNo} photoUrl={loggedInStudent?.photoUrl} size={36} />
            <div>
              <div style={{ fontSize: '13px', fontWeight: '800', color: '#0f172a' }}>{loggedInStudent?.firstName}</div>
              <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '600' }}>
                Mentor: {mentorTeacherObj?.fullName || loggedInStudent?.mentorUsername || 'Assigned'}
              </div>
            </div>
          </div>
        </header>

        <main className="print-container" style={{ padding: '26px', maxWidth: '1160px', width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
          <div className="no-print"><InstallAppBanner /></div>

          {/* 🌟 TARGETED PORTAL NOTIFICATION BANNER FOR STUDENTS */}
          <PortalNotificationBanner
            viewerRole="student"
            viewerId={loggedInStudent?.regNo || ''}
            viewerAdNo={loggedInStudent?.adNo || ''}
            viewerClasses={loggedInStudent?.classes || []}
            canSendMessages={false}
          />

          <StudentWeeklyReminder reminder={activeReminder} studentMarks={rawStudentMarks} />

          <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '20px' }}>
            <div>
              <h1 style={{ margin: 0, fontSize: '23px', fontWeight: '800', color: '#0f172a' }}>{currentTabObj.label}</h1>
              <p style={{ margin: '3px 0 0', fontSize: '13px', color: '#64748b', fontWeight: '500' }}>{currentTabObj.desc}</p>
            </div>
            {activeTab === 'marks' && (
              <button onClick={handlePrintSinglePagePDF} style={styles.buttonSecondary}>
                🖨️ Print 1-Page PDF Mark Sheet
              </button>
            )}
          </div>

          {/* ============================================================
              TAB 1: CCE & HIFZ MARK SHEET
             ============================================================ */}
          {activeTab === 'marks' && (
            <>
              <div className="print-kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', marginBottom: '20px' }}>
                <div className="print-kpi-card" style={{ background: '#f8fafc', padding: '18px', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                  <h4 style={{ margin: '0 0 6px 0', color: '#64748b', fontSize: '11px', fontWeight: '800', textTransform: 'uppercase' }}>Total Aggregate</h4>
                  <div className="print-kpi-val" style={{ fontSize: '26px', fontWeight: '900', color: '#0f172a' }}>
                    {overallStats.total1400} <span style={{ fontSize: '14px', color: '#64748b', fontWeight: '600' }}>/ 1400</span>
                  </div>
                </div>

                <div className="print-kpi-card" style={{ background: '#f8fafc', padding: '18px', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                  <h4 style={{ margin: '0 0 6px 0', color: '#64748b', fontSize: '11px', fontWeight: '800', textTransform: 'uppercase' }}>Total Sem Score</h4>
                  <div className="print-kpi-val" style={{ fontSize: '26px', fontWeight: '900', color: '#0f172a' }}>
                    {overallStats.total490} <span style={{ fontSize: '14px', color: '#64748b', fontWeight: '600' }}>/ 490</span>
                  </div>
                </div>

                <div className="print-kpi-card" style={{ background: '#eef2ff', padding: '18px', borderRadius: '12px', border: '1px solid #c7d2fe', textAlign: 'center' }}>
                  <h4 style={{ margin: '0 0 6px 0', color: '#4338ca', fontSize: '11px', fontWeight: '800', textTransform: 'uppercase' }}>Class Rank</h4>
                  <div className="print-kpi-val" style={{ fontSize: '26px', fontWeight: '900', color: '#4f46e5' }}>
                    {overallStats.rank !== '-' ? `#${overallStats.rank}` : '-'}
                    {overallStats.totalPeers !== '-' && (
                      <span style={{ fontSize: '14px', color: '#64748b', fontWeight: '600' }}> / {overallStats.totalPeers}</span>
                    )}
                  </div>
                </div>

                <div className="print-kpi-card" style={{ background: '#ecfdf5', padding: '18px', borderRadius: '12px', border: '1px solid #a7f3d0', textAlign: 'center' }}>
                  <h4 style={{ margin: '0 0 6px 0', color: '#047857', fontSize: '11px', fontWeight: '800', textTransform: 'uppercase' }}>Current Status (%)</h4>
                  <div className="print-kpi-val" style={{ fontSize: '26px', fontWeight: '900', color: '#065f46' }}>
                    {overallStats.overallStatus}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', marginBottom: '12px', padding: '8px 14px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '600', color: '#475569' }}>
                  <span style={{ fontWeight: '800', color: '#0f172a' }}>ℹ️ Mark Status Legend:</span>
                  <span><strong style={{ color: '#4f46e5' }}>Numbered Score:</strong> Confirmed &amp; Recorded</span>
                  <span><strong style={{ color: '#b45309' }}>🟡 In Progress:</strong> Usthad has begun grading your classmates</span>
                  <span><strong style={{ color: '#64748b' }}>⚪ Not Started:</strong> Usthad hasn't entered marks yet</span>
                </div>

                <div className="print-table-card" style={{ ...styles.card, padding: 0, overflow: 'hidden' }}>
                {isLoadingMarks ? (
                  <p style={{ textAlign: 'center', color: '#64748b', padding: '30px', fontWeight: '600' }}>Loading your academic records...</p>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="print-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', fontSize: '13px', minWidth: '800px' }}>
                      <thead>
                        <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '11px', textTransform: 'uppercase' }}>
                          <th style={{ padding: '14px 16px', textAlign: 'left' }}>SUBJECT &amp; ASSIGNED USTHAD</th>
                          <th style={{ padding: '14px 16px' }}>L1 (15)</th>
                          <th style={{ padding: '14px 16px' }}>L2 (20)</th>
                          <th style={{ padding: '14px 16px' }}>L3 (25)</th>
                          <th style={{ padding: '14px 16px' }}>L4 (40)</th>
                          <th style={{ padding: '14px 16px', borderLeft: '1px solid #e2e8f0' }}>TOTAL (100)</th>
                          <th style={{ padding: '14px 16px' }}>SCALED (30)</th>
                          <th style={{ padding: '14px 16px' }}>STATUS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {subjectAggregates.map((data, idx) => (
                          <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9', background: '#ffffff' }}>
                            <td style={{ padding: '13px 16px', textAlign: 'left' }}>
                              <div style={{ fontWeight: '700', color: '#0f172a', fontSize: '14px' }}>{data.subject}</div>
                              {data.teacherName && (
                                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '500', marginTop: '2px' }}>
                                  {data.teacherName}
                                </div>
                              )}
                            </td>

                            {data.isHifz ? (
                              <>
                                <td colSpan="2" style={{ padding: '13px 16px' }}>
                                  <span style={{ fontSize: '10px', color: '#64748b', display: 'block' }}>Part 1 (/50)</span>
                                  {renderMarkCell(data.assessments?.['50_1'], data.levelGradingStarted?.['50_1'] || data.levelGradingStarted?.['1'] || data.levelGradingStarted?.['50'])}
                                </td>
                                <td colSpan="2" style={{ padding: '13px 16px' }}>
                                  <span style={{ fontSize: '10px', color: '#64748b', display: 'block' }}>Part 2 (/50)</span>
                                  {renderMarkCell(data.assessments?.['50_2'], data.levelGradingStarted?.['50_2'] || data.levelGradingStarted?.['2'] || data.levelGradingStarted?.['50'])}
                                </td>
                              </>
                            ) : data.isSpecialization ? (
                              <td colSpan="4" style={{ padding: '13px 16px' }}>
                                <span style={{ fontSize: '10px', color: '#64748b', display: 'block' }}>Direct Score (/30)</span>
                                {renderMarkCell(data.assessments?.['30'], data.levelGradingStarted?.['30'])}
                              </td>
                            ) : (
                              <>
                                <td style={{ padding: '13px 16px' }}>{renderMarkCell(data.assessments?.['15'], data.levelGradingStarted?.['15'])}</td>
                                <td style={{ padding: '13px 16px' }}>{renderMarkCell(data.assessments?.['20'], data.levelGradingStarted?.['20'])}</td>
                                <td style={{ padding: '13px 16px' }}>{renderMarkCell(data.assessments?.['25'], data.levelGradingStarted?.['25'])}</td>
                                <td style={{ padding: '13px 16px' }}>{renderMarkCell(data.assessments?.['40'], data.levelGradingStarted?.['40'])}</td>
                              </>
                            )}

                            <td style={{ padding: '13px 16px', fontWeight: '700', color: '#4f46e5', borderLeft: '1px solid #f1f5f9' }}>{data.total100}</td>
                            <td style={{ padding: '13px 16px', fontWeight: '700', color: '#047857' }}>{data.semScore}</td>
                            <td style={{ padding: '13px 16px' }}>
                              <span style={{
                                ...styles.badge,
                                background: data.status === '-' ? '#f8fafc' : parseFloat(data.status) >= 40 ? '#dcfce7' : '#fff1f2',
                                color: data.status === '-' ? '#64748b' : parseFloat(data.status) >= 40 ? '#15803d' : '#e11d48'
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '14px' }}>
                <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                  <span style={{ fontSize: '11px', fontWeight: '800', color: '#64748b' }}>TOTAL PERIODS</span>
                  <div style={{ fontSize: '24px', fontWeight: '900', color: '#0f172a', marginTop: '4px' }}>{attendanceData.totalPeriods}</div>
                </div>
                <div style={{ background: '#ecfdf5', padding: '16px', borderRadius: '12px', border: '1px solid #a7f3d0', textAlign: 'center' }}>
                  <span style={{ fontSize: '11px', fontWeight: '800', color: '#047857' }}>GROSS PRESENT</span>
                  <div style={{ fontSize: '24px', fontWeight: '900', color: '#065f46', marginTop: '4px' }}>{attendanceData.presentCount}</div>
                </div>
                <div style={{ background: '#fff1f2', padding: '16px', borderRadius: '12px', border: '1px solid #fecdd3', textAlign: 'center' }}>
                  <span style={{ fontSize: '11px', fontWeight: '800', color: '#be123c' }}>MINUS DEDUCTIONS</span>
                  <div style={{ fontSize: '24px', fontWeight: '900', color: '#e11d48', marginTop: '4px' }}>-{attendanceData.minusCount}</div>
                </div>
                <div style={{ background: '#eef2ff', padding: '16px', borderRadius: '12px', border: '1px solid #c7d2fe', textAlign: 'center' }}>
                  <span style={{ fontSize: '11px', fontWeight: '800', color: '#4338ca' }}>FINAL NET %</span>
                  <div style={{ fontSize: '24px', fontWeight: '900', color: isShortage ? '#e11d48' : '#4f46e5', marginTop: '4px' }}>{attendancePct}%</div>
                </div>
              </div>

              <div style={styles.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {[
                      { id: 'monthly', label: '📋 Monthly Register Grid' },
                      { id: 'total', label: '📊 Semester Summary Table' },
                      { id: 'daily', label: '📅 Check Specific Date' }
                    ].map(tab => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setStudentAttScope(tab.id)}
                        style={{
                          padding: '7px 14px',
                          borderRadius: '8px',
                          border: studentAttScope === tab.id ? '1px solid #4f46e5' : '1px solid #e2e8f0',
                          fontWeight: '700',
                          fontSize: '12px',
                          cursor: 'pointer',
                          background: studentAttScope === tab.id ? '#4f46e5' : '#f8fafc',
                          color: studentAttScope === tab.id ? '#ffffff' : '#475569'
                        }}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {studentAttScope === 'monthly' && (
                    <input type="month" value={studentAttMonth} onChange={e => setStudentAttMonth(e.target.value)} style={{ ...styles.input, width: '170px', padding: '7px 10px' }} />
                  )}
                  {studentAttScope === 'daily' && (
                    <input type="date" value={studentAttDate} onChange={e => setStudentAttDate(e.target.value)} style={{ ...styles.input, width: '170px', padding: '7px 10px' }} />
                  )}
                </div>

                {studentAttScope === 'daily' && (() => {
                  const absOnDay = [];
                  Object.entries(attendanceData.subjectWise || {}).forEach(([subKey, sObj]) => {
                    const count = (sObj.absentDates || []).filter(d => d === studentAttDate).length;
                    if (count > 0) absOnDay.push({ subKey, count });
                  });
                  const minusOnDay = (attendanceData.minusLogs || []).filter(l => l.date === studentAttDate);

                  return (
                    <div style={{ marginBottom: '16px', background: '#f8fafc', padding: '14px 16px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                      <div style={{ fontWeight: '700', fontSize: '13px', color: '#0f172a', marginBottom: '4px' }}>
                        📅 Attendance Summary for {studentAttDate}:
                      </div>
                      {absOnDay.length === 0 ? (
                        <div style={{ color: '#047857', fontWeight: '600', fontSize: '13px' }}>
                          ✓ Zero recorded subject absences on {studentAttDate}.
                        </div>
                      ) : (
                        <div style={{ color: '#e11d48', fontWeight: '600', fontSize: '13px' }}>
                          Absent in: {absOnDay.map(x => `${x.subKey} (${x.count})`).join(', ')}
                        </div>
                      )}
                      {minusOnDay.length > 0 && (
                        <div style={{ color: '#be123c', fontWeight: '600', fontSize: '12px', marginTop: '4px' }}>
                          Minus Deducted: {minusOnDay.map(m => `-${m.count} (${m.reason})`).join(', ')}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {studentAttScope === 'monthly' ? (
                  /* 🌟 MONTHLY REGISTER GRID: COLUMNS = DATES, ROWS = DEDUPLICATED SUBJECTS */
                  <div style={{ overflowX: 'auto', border: '1px solid #cbd5e1', borderRadius: '12px', background: '#ffffff', boxShadow: '0 2px 4px rgba(0,0,0,0.03)' }}>
                    <div style={{ padding: '12px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                      <div style={{ fontSize: '13px', fontWeight: '800', color: '#0f172a' }}>
                        📋 Monthly Attendance Register — {studentAttMonth} (Working Days • Friday Off)
                      </div>
                      <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '600' }}>
                        <span style={{ display: 'inline-block', width: '10px', height: '10px', background: '#059669', borderRadius: '2px', marginRight: '4px' }}></span> Present (P) &nbsp;&nbsp;
                        <span style={{ display: 'inline-block', width: '10px', height: '10px', background: '#e11d48', borderRadius: '2px', marginRight: '4px' }}></span> Absent (A) &nbsp;&nbsp;
                        <span style={{ display: 'inline-block', width: '10px', height: '10px', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '2px', marginRight: '4px' }}></span> Friday Off &nbsp;&nbsp;
                        <span style={{ color: '#94a3b8' }}>— No Class</span>
                      </div>
                    </div>

                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', textAlign: 'center', minWidth: '980px' }}>
                      <thead style={{ position: 'sticky', top: 0, background: '#0f172a', color: '#ffffff', zIndex: 10 }}>
                        <tr>
                          <th style={{ padding: '8px 10px', textAlign: 'left', minWidth: '160px' }}>Subject &amp; Usthad</th>
                          <th style={{ padding: '8px 6px', minWidth: '55px', background: '#1e293b' }}>Type</th>
                          {daysInMonth.map(d => (
                            <th
                              key={d.dateStr}
                              style={{
                                padding: '6px 3px',
                                minWidth: '28px',
                                background: d.isFriday ? '#475569' : '#1e293b',
                                color: d.isFriday ? '#fbbf24' : '#ffffff',
                                borderLeft: '1px solid #334155'
                              }}
                            >
                              <div style={{ fontSize: '11px', fontWeight: '800' }}>{d.dayNum}</div>
                              <div style={{ fontSize: '9px', opacity: 0.85 }}>{d.dayName}</div>
                            </th>
                          ))}
                          <th style={{ padding: '8px 8px', minWidth: '45px', background: '#1e293b' }}>Held</th>
                          <th style={{ padding: '8px 8px', minWidth: '45px', background: '#064e3b' }}>Pres</th>
                          <th style={{ padding: '8px 8px', minWidth: '45px', background: '#881337' }}>Abs</th>
                          <th style={{ padding: '8px 8px', minWidth: '55px', background: '#312e81' }}>%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allAttendanceSubjectsForStudent.map((sub, idx) => {
                          const stats = getSubjectAttendanceStats(sub.subject, studentAttMonth);
                          const subAbsentDatesMonth = new Set(stats.scopedAbsentDates);

                          const getMonthlyCellAttendance = (d) => {
                            if (d.isFriday) return { type: 'OFF', label: 'OFF', bg: '#fef3c7', textCol: '#b45309' };

                            const canon = canonicalSubject(sub.subject);
                            const myReg = String(loggedInStudent?.regNo || regNo || '').trim();
                            const myAd = String(loggedInStudent?.adNo || '').trim().toUpperCase();
                            const myId = String(loggedInStudent?.id || '').trim();
                            const myClasses = (loggedInStudent?.classes || []).map(c => String(c).trim().toUpperCase());
                            if (loggedInStudent?.class) myClasses.push(String(loggedInStudent.class).trim().toUpperCase());
                            const myPrimaryClass = myClasses[0] || '';

                            // Filter matching sessions from monthSessions
                            const matchingSessions = monthSessions.filter(sess => {
                              if (sess.date !== d.dateStr) return false;
                              const sessCanon = canonicalSubject(sess.subject || sess.classAlias || sess.alias || '');
                              if (sessCanon !== canon) return false;

                              const attMap = sess.attendanceMap || {};
                              const inMap = Boolean(
                                attMap[myReg] || attMap[myAd] || attMap[myId] ||
                                attMap[myReg.toLowerCase()] || attMap[myAd.toLowerCase()]
                              );
                              if (inMap) return true;

                              const sessClass = String(sess.targetClass || '').trim().toUpperCase();
                              const sessAlias = String(sess.classAlias || '').trim().toUpperCase();
                              if (myPrimaryClass && (sessClass === myPrimaryClass || sessAlias.includes(myPrimaryClass))) return true;
                              if (myClasses.some(c => c && (sessClass === c || sessAlias.includes(c)))) return true;
                              return false;
                            });

                            // If no session recorded on this date for this subject
                            if (matchingSessions.length === 0) {
                              if (subAbsentDatesMonth.has(d.dateStr)) {
                                return { type: 'A', label: 'A', bg: '#e11d48', textCol: '#ffffff' };
                              }
                              // Blank / line when attendance was not taken!
                              return { type: 'EMPTY', label: '—', bg: 'transparent', textCol: '#cbd5e1' };
                            }

                            // Attendance was taken on this day!
                            let isAbsent = false;
                            let isMedical = false;
                            let isOfficial = false;
                            let isPresent = false;

                            matchingSessions.forEach(sess => {
                              const attMap = sess.attendanceMap || {};
                              const val = attMap[myReg] || attMap[myAd] || attMap[myId] ||
                                          attMap[myReg.toLowerCase()] || attMap[myAd.toLowerCase()];
                              if (val === 'A') isAbsent = true;
                              else if (val === 'M') isMedical = true;
                              else if (val === 'O') isOfficial = true;
                              else if (val === 'P') isPresent = true;
                              else if (subAbsentDatesMonth.has(d.dateStr)) isAbsent = true;
                              else isPresent = true;
                            });

                            if (isAbsent) return { type: 'A', label: 'A', bg: '#e11d48', textCol: '#ffffff' };
                            if (isMedical) return { type: 'M', label: 'M', bg: '#0284c7', textCol: '#ffffff' };
                            if (isOfficial) return { type: 'O', label: 'O', bg: '#4f46e5', textCol: '#ffffff' };
                            return { type: 'P', label: 'P', bg: '#059669', textCol: '#ffffff' };
                          };

                          const monthHeldDays = daysInMonth.filter(d => {
                            if (d.isFriday) return false;
                            const cell = getMonthlyCellAttendance(d);
                            return cell.type === 'P' || cell.type === 'A' || cell.type === 'M' || cell.type === 'O';
                          });
                          const monthHeldCount = monthHeldDays.length;
                          const monthAbsCount = monthHeldDays.filter(d => {
                            const cell = getMonthlyCellAttendance(d);
                            return cell.type === 'A' || cell.type === 'M';
                          }).length;
                          const monthPresCount = monthHeldDays.filter(d => {
                            const cell = getMonthlyCellAttendance(d);
                            return cell.type === 'P' || cell.type === 'O';
                          }).length;
                          const monthPct = monthHeldCount > 0
                            ? ((monthPresCount / monthHeldCount) * 100).toFixed(1)
                            : (stats.pct !== null ? stats.pct : null);

                          return (
                            <tr key={sub.subject} style={{ borderBottom: '1px solid #e2e8f0', background: idx % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                              <td style={{ padding: '8px 10px', textAlign: 'left' }}>
                                <div style={{ fontWeight: '800', color: '#0f172a', fontSize: '12px' }}>{sub.subject}</div>
                                <div style={{ fontSize: '10px', color: '#64748b' }}>{sub.teacherName || stats.teacherName || 'Assigned Faculty'}</div>
                              </td>
                              <td style={{ padding: '6px 4px' }}>
                                <span style={{
                                  background: sub.isAttendanceOnly ? '#fef3c7' : '#ecfdf5',
                                  color: sub.isAttendanceOnly ? '#b45309' : '#047857',
                                  padding: '2px 5px',
                                  borderRadius: '4px',
                                  fontSize: '9px',
                                  fontWeight: '800'
                                }}>
                                  {sub.isAttendanceOnly ? 'NON-MARK' : 'MARK'}
                                </span>
                              </td>

                              {daysInMonth.map(d => {
                                const cell = getMonthlyCellAttendance(d);

                                if (cell.type === 'OFF') {
                                  return (
                                    <td key={d.dateStr} style={{ padding: '3px 1px', background: '#fef3c7', color: '#b45309', fontWeight: '800', fontSize: '9px', borderLeft: '1px solid #f1f5f9' }}>
                                      OFF
                                    </td>
                                  );
                                }

                                if (cell.type === 'EMPTY') {
                                  return (
                                    <td key={d.dateStr} style={{ padding: '3px 1px', color: '#cbd5e1', borderLeft: '1px solid #f1f5f9' }}>
                                      —
                                    </td>
                                  );
                                }

                                return (
                                  <td
                                    key={d.dateStr}
                                    style={{
                                      padding: '3px 1px',
                                      background: cell.type === 'A' ? '#fff1f2' : cell.type === 'M' ? '#eff6ff' : cell.type === 'O' ? '#eef2ff' : '#ecfdf5',
                                      borderLeft: cell.type === 'A' ? '1px solid #fecdd3' : '1px solid #a7f3d0'
                                    }}
                                  >
                                    <span style={{
                                      background: cell.bg,
                                      color: cell.textCol,
                                      borderRadius: '4px',
                                      padding: '1px 5px',
                                      fontSize: '10px',
                                      fontWeight: '900'
                                    }}>
                                      {cell.label}
                                    </span>
                                  </td>
                                );
                              })}

                              <td style={{ padding: '6px 4px', fontWeight: '700', color: '#334155' }}>
                                {monthHeldCount > 0 ? monthHeldCount : '—'}
                              </td>
                              <td style={{ padding: '6px 4px', fontWeight: '800', color: '#047857' }}>
                                {monthHeldCount > 0 ? monthPresCount : '—'}
                              </td>
                              <td style={{ padding: '6px 4px', fontWeight: '800', color: monthAbsCount > 0 ? '#e11d48' : '#64748b' }}>
                                {monthHeldCount > 0 ? monthAbsCount : '—'}
                              </td>
                              <td style={{
                                padding: '6px 4px',
                                fontWeight: '800',
                                color: monthPct !== null && Number(monthPct) < 85 ? '#e11d48' : '#4f46e5'
                              }}>
                                {monthPct !== null ? `${monthPct}%` : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  /* 📊 SEMESTER TOTAL SUMMARY VIEW */
                  <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', fontSize: '13px', minWidth: '660px' }}>
                      <thead>
                        <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '11px', textTransform: 'uppercase' }}>
                          <th style={{ padding: '12px 16px', textAlign: 'left' }}>SUBJECT &amp; USTHAD</th>
                          <th style={{ padding: '12px 16px' }}>TYPE</th>
                          <th style={{ padding: '12px 16px' }}>TOTAL</th>
                          <th style={{ padding: '12px 16px' }}>PRESENT</th>
                          <th style={{ padding: '12px 16px' }}>ABSENT</th>
                          <th style={{ padding: '12px 16px' }}>SUBJECT %</th>
                          <th style={{ padding: '12px 16px', textAlign: 'left' }}>ABSENT DATES</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allAttendanceSubjectsForStudent.map((item, idx) => {
                          const stats = getSubjectAttendanceStats(item.subject, null);
                          const total = stats.total;
                          const present = stats.present;
                          const absent = stats.absent;
                          const pct = stats.pct;

                          return (
                            <tr key={item.subject} style={{ borderBottom: '1px solid #f1f5f9', background: idx % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                              <td style={{ padding: '12px 16px', textAlign: 'left' }}>
                                <div style={{ fontWeight: '700', color: '#0f172a' }}>{item.subject}</div>
                                <div style={{ fontSize: '11px', color: '#64748b' }}>{item.teacherName || stats.teacherName || 'Assigned Faculty'}</div>
                              </td>
                              <td style={{ padding: '12px 16px' }}>
                                <span style={{
                                  background: item.isAttendanceOnly ? '#fef3c7' : '#ecfdf5',
                                  color: item.isAttendanceOnly ? '#b45309' : '#047857',
                                  padding: '3px 8px',
                                  borderRadius: '6px',
                                  fontSize: '10px',
                                  fontWeight: '800'
                                }}>
                                  {item.isAttendanceOnly ? 'NON-MARK' : 'MARK'}
                                </span>
                              </td>
                              <td style={{ padding: '12px 16px' }}>{total > 0 ? total : '-'}</td>
                              <td style={{ padding: '12px 16px', fontWeight: '700', color: '#047857' }}>{total > 0 ? present : '-'}</td>
                              <td style={{ padding: '12px 16px', fontWeight: '700', color: absent > 0 ? '#e11d48' : '#64748b' }}>{total > 0 ? absent : '-'}</td>
                              <td style={{ padding: '12px 16px', fontWeight: '700', color: pct !== null && Number(pct) < 85 ? '#e11d48' : '#4f46e5' }}>
                                {pct !== null ? `${pct}%` : '-'}
                              </td>
                              <td style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', color: '#e11d48' }}>
                                {stats.allAbsentDates.length > 0 ? stats.allAbsentDates.slice(0, 8).join(', ') : <span style={{ color: '#94a3b8' }}>—</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>


              {/* 🌟 OFFICIAL ATTENDANCE CLEARANCE SLIPS & CERTIFICATES */}
              <CollapsibleCard
                title="Official Attendance Clearance Certificates &amp; Slips"
                subtitle="Review approved clearances, acknowledge receipt, and download certificates"
                badgeText={`${clearanceCerts.length} Certificate(s)`}
                icon="🎟️"
                accentColor="#059669"
                defaultOpen={clearanceCerts.length > 0}
              >
                {clearanceCerts.length === 0 ? (
                  <div style={{ padding: '16px', background: '#f8fafc', borderRadius: '10px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                    No attendance clearance certificates issued yet.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {clearanceCerts.map(cert => {
                      const isConfirmed = cert.status === 'CONFIRMED' || Boolean(cert.studentConfirmedAt);
                      const isAcknowledging = acknowledgingCertId === cert.id;
                      const isMed = cert.clearanceType === 'MEDICAL_LEAVE' || cert.reason === 'medical';
                      const isOff = cert.clearanceType === 'OFFICIAL_PRESENT' || cert.reason === 'official' || cert.reason === 'permitted';

                      return (
                        <div
                          key={cert.id}
                          style={{
                            background: isMed ? '#fffbeb' : isOff ? '#f0fdfa' : isConfirmed ? '#f8fafc' : '#fffbeb',
                            borderRadius: '12px',
                            border: isMed ? (isConfirmed ? '1.5px solid #fde68a' : '2px solid #f59e0b') : isOff ? (isConfirmed ? '1.5px solid #99f6e4' : '2px solid #0d9488') : isConfirmed ? '1px solid #cbd5e1' : '2px solid #f59e0b',
                            padding: '16px 18px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: '14px'
                          }}
                        >
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                              <span style={{ fontWeight: '800', color: '#0f172a', fontSize: '14px' }}>
                                🎟️ {cert.certNumber || cert.id}
                              </span>
                              <span
                                style={{
                                  background: isMed ? '#fef3c7' : isOff ? '#ccfbf1' : '#eef2ff',
                                  color: isMed ? '#92400e' : isOff ? '#0f766e' : '#4338ca',
                                  border: `1px solid ${isMed ? '#fde68a' : isOff ? '#99f6e4' : '#c7d2fe'}`,
                                  padding: '2px 8px',
                                  borderRadius: '6px',
                                  fontSize: '11px',
                                  fontWeight: '800'
                                }}
                              >
                                {isMed ? '🏥 Medical Leave' : isOff ? '🏛️ Official Leave' : '🎟️ Clearance Slip'}
                              </span>
                              <span
                                style={{
                                  background: isConfirmed ? '#ecfdf5' : '#fef3c7',
                                  color: isConfirmed ? '#047857' : '#92400e',
                                  border: isConfirmed ? '1px solid #a7f3d0' : '1px solid #fde68a',
                                  padding: '2px 8px',
                                  borderRadius: '999px',
                                  fontSize: '11px',
                                  fontWeight: '800'
                                }}
                              >
                                {isConfirmed ? '✓ CONFIRMED BY YOU' : '🟡 ACTION NEEDED: PENDING YOUR CONFIRMATION'}
                              </span>
                            </div>

                            <div style={{ fontSize: '12px', color: '#475569', marginTop: '4px' }}>
                              Cleared Dates: <strong>{(cert.dates || []).join(', ')}</strong> • Type: <strong style={{ textTransform: 'capitalize', color: isMed ? '#b45309' : isOff ? '#0d9488' : '#475569' }}>{cert.clearanceTypeLabel || cert.reason}</strong>
                            </div>

                            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                              Issued By: <strong>{cert.clearedBy}</strong> ({cert.clearedByRole}) on {new Date(cert.issuedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                              {cert.remarks && <span> • Note: &ldquo;{cert.remarks}&rdquo;</span>}
                            </div>

                            {isConfirmed && cert.studentConfirmedAt && (
                              <div style={{ fontSize: '11px', color: '#047857', marginTop: '3px', fontWeight: '700' }}>
                                ✓ You acknowledged and confirmed receipt on {new Date(cert.studentConfirmedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                              </div>
                            )}
                          </div>

                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            {!isConfirmed && (
                              <button
                                type="button"
                                onClick={() => handleAcknowledgeCert(cert.id)}
                                disabled={isAcknowledging}
                                style={{
                                  padding: '8px 14px',
                                  background: '#059669',
                                  color: '#ffffff',
                                  border: 'none',
                                  borderRadius: '8px',
                                  fontWeight: '800',
                                  fontSize: '12px',
                                  cursor: isAcknowledging ? 'not-allowed' : 'pointer',
                                  boxShadow: '0 2px 4px rgba(5,150,105,0.2)'
                                }}
                              >
                                {isAcknowledging ? 'Confirming...' : '✅ Acknowledge & Confirm Receipt'}
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => setSelectedCertToView(cert)}
                              style={{
                                padding: '8px 14px',
                                background: '#ffffff',
                                color: '#4f46e5',
                                border: '1px solid #c7d2fe',
                                borderRadius: '8px',
                                fontWeight: '800',
                                fontSize: '12px',
                                cursor: 'pointer'
                              }}
                            >
                              🖨️ View &amp; Print Certificate
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CollapsibleCard>

              {/* STUDENT OFFICIAL CERTIFICATE MODAL */}
              {selectedCertToView && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '16px' }}>
                  <div style={{ background: '#ffffff', borderRadius: '16px', maxWidth: '640px', width: '100%', maxHeight: '92vh', overflowY: 'auto', padding: '28px', border: '2px solid #059669', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}>
                    <div style={{ textAlign: 'center', borderBottom: '2px solid #e2e8f0', paddingBottom: '16px', marginBottom: '18px' }}>
                      <div style={{ fontSize: '11px', fontWeight: '800', letterSpacing: '1px', color: '#059669', textTransform: 'uppercase' }}>
                        Darul Huda Islamic University • Student Records Desk
                      </div>
                      <h2 style={{ margin: '4px 0 2px', fontSize: '20px', fontWeight: '900', color: '#0f172a' }}>
                        🎟️ OFFICIAL ATTENDANCE CLEARANCE CERTIFICATE
                      </h2>
                      <div style={{ fontSize: '12px', fontWeight: '700', color: '#64748b' }}>
                        Verification Number: <span style={{ color: '#0f172a' }}>{selectedCertToView.certNumber}</span>
                      </div>
                    </div>

                    <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
                      <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '700' }}>STUDENT</div>
                      <div style={{ fontSize: '15px', fontWeight: '800', color: '#0f172a' }}>
                        {selectedCertToView.studentName} <span style={{ color: '#4f46e5' }}>(#{selectedCertToView.adNo})</span>
                      </div>
                      <div style={{ fontSize: '12px', color: '#475569', marginTop: '2px' }}>
                        Class: <strong>{(selectedCertToView.classes || []).join(', ')}</strong> • Dept: {selectedCertToView.department}
                      </div>
                      <div style={{ marginTop: '8px', fontSize: '13px', color: '#059669', fontWeight: '800', textTransform: 'uppercase' }}>
                        Category: {selectedCertToView.reason} • Cleared Dates: {(selectedCertToView.dates || []).join(', ')}
                      </div>
                    </div>

                    <div style={{ padding: '12px 14px', background: '#ecfdf5', borderRadius: '10px', border: '1px solid #a7f3d0', marginBottom: '18px', fontSize: '12px', color: '#065f46' }}>
                      <strong>Authority Remark:</strong> {selectedCertToView.remarks}
                      <div style={{ marginTop: '4px', fontSize: '11px', color: '#047857' }}>
                        Issued by: <strong>{selectedCertToView.clearedBy}</strong> • Status: <strong>{selectedCertToView.status}</strong>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        onClick={() => window.print()}
                        style={styles.buttonPrimary}
                      >
                        🖨️ Print Certificate
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedCertToView(null)}
                        style={styles.buttonSecondary}
                      >
                        Close
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <CollapsibleCard
                title="Disciplinary Minus Attendance Records"
                subtitle="Click to view detailed reasons, dates, and issuing Usthads"
                badgeText={`${(attendanceData.minusLogs || []).length} Record(s)`}
                icon="⚠️"
                accentColor="#4f46e5"
                defaultOpen={(attendanceData.minusLogs || []).length > 0}
              >
                {(attendanceData.minusLogs || []).length === 0 ? (
                  <div style={{ padding: '16px', background: '#f8fafc', borderRadius: '10px', textAlign: 'center', color: '#047857', fontWeight: '700' }}>
                    Alhamdulillah! You have 0 minus attendance deductions this semester.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {(attendanceData.minusLogs || []).map((log, i) => (
                      <div key={log.id || i} style={{ padding: '12px 16px', borderRadius: '10px', border: '1px solid #ffe4e6', background: '#fff1f2', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                        <div>
                          <div style={{ fontWeight: '800', color: '#be123c', fontSize: '14px' }}>
                            -{log.count} Period(s) • &quot;{log.reason}&quot;
                          </div>
                          <div style={{ fontSize: '11px', color: '#9f1239', marginTop: '2px', fontWeight: '600' }}>
                            ⚖️ Deducted from total campus attendance percentage
                          </div>
                        </div>
                        <div style={{ fontSize: '12px', color: '#881337', fontWeight: '600' }}>
                          {log.date} • By {log.issuedBy || 'Faculty'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CollapsibleCard>
            </div>
          )}

          {/* ============================================================
              TAB 3: MENTORSHIP TAB
             ============================================================ */}
          {activeTab === 'mentorship' && (
            <div style={styles.card}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px', marginBottom: '22px' }}>
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '16px', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>Assigned Mentor Usthad</div>
                    <div style={{ fontSize: '16px', fontWeight: '800', color: '#0f172a', marginTop: '2px' }}>
                      {mentorTeacherObj?.fullName || loggedInStudent?.mentorName || loggedInStudent?.mentorUsername || 'Not Assigned'}
                    </div>
                  </div>
                  {mentorTeacherObj?.whatsappNumber && (
                    <button
                      type="button"
                      onClick={() => openDirectWhatsApp(mentorTeacherObj.whatsappNumber, `Assalamu Alaikum Usthad, I am ${loggedInStudent.firstName} (#${loggedInStudent.adNo}).`)}
                      style={styles.buttonSecondary}
                    >
                      💬 WhatsApp
                    </button>
                  )}
                </div>

                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '16px', borderRadius: '12px' }}>
                  <div style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>Current Action Plan</div>
                  <div style={{ fontSize: '14px', fontWeight: '700', color: '#0f172a', marginTop: '6px' }}>
                    {latestSitting?.actionPlan ? `"${latestSitting.actionPlan}"` : 'Meet with your Mentor Usthad to receive your semester action plan.'}
                  </div>
                </div>
              </div>

              <h4 style={styles.sectionTitle}>Recorded Mentorship Sittings ({studentMentorLogs.length})</h4>
              {studentMentorLogs.length === 0 ? (
                <div style={{ padding: '24px', background: '#f8fafc', borderRadius: '10px', textAlign: 'center', color: '#64748b', fontWeight: '600' }}>
                  No mentorship sittings have been logged yet.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {studentMentorLogs.map((log, i) => (
                    <div key={log.id || i} style={{ padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0', background: '#ffffff' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <span style={{ fontWeight: '700', fontSize: '13px', color: '#0f172a' }}>
                          📅 {log.date} • {log.type || 'Sitting'}
                        </span>
                        <span style={{ fontSize: '12px', color: '#64748b' }}>By {log.loggedBy || 'Mentor'}</span>
                      </div>
                      {log.summary && <div style={{ fontSize: '13px', color: '#334155' }}>{log.summary}</div>}
                      {log.actionPlan && <div style={{ fontSize: '12px', color: '#4f46e5', fontWeight: '600', marginTop: '4px' }}>Action Plan: {log.actionPlan}</div>}
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
              <div style={{ marginBottom: '24px' }}>
                <h4 style={styles.sectionTitle}>Recognized Skills &amp; Talents ({studentSkills.length})</h4>
                {studentSkills.length === 0 ? (
                  <div style={{ padding: '18px', background: '#f8fafc', borderRadius: '10px', color: '#64748b', fontSize: '13px' }}>
                    No skills added yet. Contact your Mentor or Class Teacher to update your portfolio.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {studentSkills.map((sk, idx) => (
                      <span key={idx} style={{ background: '#eef2ff', color: '#4f46e5', padding: '6px 14px', borderRadius: '999px', fontSize: '12px', fontWeight: '700' }}>
                        ✦ {sk}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h4 style={styles.sectionTitle}>Achievements, Awards &amp; Sibaq Log ({studentAchievements.length})</h4>
                {studentAchievements.length === 0 ? (
                  <div style={{ padding: '18px', background: '#f8fafc', borderRadius: '10px', color: '#64748b', fontSize: '13px' }}>
                    No achievements recorded yet.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {studentAchievements.map((ach, i) => (
                      <div key={ach.id || i} style={{ padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0', background: '#f8fafc' }}>
                        <div style={{ fontWeight: '700', color: '#0f172a', fontSize: '14px' }}>🏅 {ach.title}</div>
                        <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                          {ach.category} • {ach.level} • {ach.date}
                        </div>
                        {ach.notes && <div style={{ fontSize: '13px', color: '#334155', marginTop: '4px' }}>{ach.notes}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}


        </main>
      </div>
    </div>
  );
}

export default function StudentDashboard() {
  return (
    <StudentPortalErrorBoundary>
      <StudentDashboardInner />
    </StudentPortalErrorBoundary>
  );
}
