// app/components/erpConstants.js

export const WEB_APP_URL = '/api/sheets';
export const DHIU_LOGO_URL = 'https://ik.imagekit.io/syustaging/SYU_PREPROD/LOGO_XGQrxvsxO.webp?tr=w-3840';

export const DEFAULT_SUBJECTS = [
  "Thafseer", "Hadith", "Fiqh", "U :FIQH", "Aqidah", "Balagha", "Logic",
  "English", "Adab", "Urdu", "Social Science", "Thamadun", "Specialization", "Hifz"
];
export const DEFAULT_CLASSES = ["QH1", "AL1", "FC1", "QH2", "AL2", "FC2", "QLA3", "HFC3"];
export const GRADES = ["1", "2", "3"];
export const DEPARTMENTS = ["QURAN", "LANGUAGE", "AQIDAH", "HADITH", "FIQH", "CIVIL"];
export const MADHABS = ["Hanafi", "Shafi", "General"];

export const CCE_LEVELS = { "Level 1": "15", "Level 2": "20", "Level 3": "25", "Level 4": "40" };
export const HIFZ_LEVELS = { "Part 1 (Max 50)": "50_1", "Part 2 (Max 50)": "50_2" };
export const SPECIALIZATION_LEVELS = { "Direct Mark (Max 30)": "30" };

export const parseCSVLine = (str) => {
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

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const getLocalYMD = (d = new Date()) => {
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

export const isTimestampWithinWindow = ({
  targetDateStr,
  startIso,
  endIso,
  startDateStr,
  startTimeStr,
  endDateStr,
  endTimeStr,
  isOpenReturn = false
}) => {
  const now = new Date();
  const todayStr = getLocalYMD(now);
  const checkDate = targetDateStr || todayStr;

  let startMs = null;
  if (startIso) {
    const d = new Date(startIso);
    if (!isNaN(d.getTime())) startMs = d.getTime();
  } else if (startDateStr) {
    const t = startTimeStr && /^\d{2}:\d{2}/.test(startTimeStr) ? startTimeStr : '00:00';
    const d = new Date(`${startDateStr}T${t}:00`);
    if (!isNaN(d.getTime())) startMs = d.getTime();
  }

  let endMs = null;
  if (!isOpenReturn) {
    if (endIso) {
      const d = new Date(endIso);
      if (!isNaN(d.getTime())) endMs = d.getTime();
    } else if (endDateStr) {
      const t = endTimeStr && /^\d{2}:\d{2}/.test(endTimeStr) ? endTimeStr : '23:59';
      const d = new Date(`${endDateStr}T${t}:59`);
      if (!isNaN(d.getTime())) endMs = d.getTime();
    }
  }

  const sDate = startIso ? getLocalYMD(startIso) : (startDateStr || '');
  const eDate = isOpenReturn ? '2099-12-31' : (endIso ? getLocalYMD(endIso) : (endDateStr || sDate || '2099-12-31'));

  if (sDate && checkDate < sDate) return false;
  if (eDate && checkDate > eDate) return false;

  // Strict real-time enforcement when taking attendance today:
  // Must NOT show before start time begins, and MUST stop showing once permitted time ends!
  if (checkDate === todayStr) {
    const nowMs = now.getTime();
    if (startMs !== null && nowMs < startMs) return false;
    if (!isOpenReturn && endMs !== null && nowMs > endMs) return false;
  }

  return true;
};

export const isWaiverActiveOnDate = (waiver, targetDate) => {
  if (!waiver || waiver.status !== 'ACTIVE') return false;
  return isTimestampWithinWindow({
    targetDateStr: targetDate,
    startIso: waiver.permittedFrom || waiver.startTimeIso || waiver.issuedAt || waiver.createdAt,
    endIso: waiver.permittedTo || waiver.endTimeIso || waiver.validUntilIso,
    startDateStr: waiver.startDate || (waiver.issuedAt ? String(waiver.issuedAt).split('T')[0] : ''),
    startTimeStr: waiver.startTime || '00:00',
    endDateStr: waiver.validUntil || waiver.endDate || '2099-12-31',
    endTimeStr: waiver.validUntilTime || waiver.endTime || '23:59',
    isOpenReturn: Boolean(waiver.isOpenReturn)
  });
};

// 🌟 MINIMALIST SHUHOOD DESIGN SYSTEM (Clean Indigo #4f46e5 + Soft Slate #f8fafc)
export const styles = {
  pageBackground: {
    minHeight: '100vh',
    backgroundColor: '#f8fafc',
    padding: '24px 16px',
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
    color: '#0f172a'
  },
  card: {
    background: '#ffffff',
    padding: '24px',
    borderRadius: '14px',
    boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
    border: '1px solid #e2e8f0',
    marginBottom: '20px',
    boxSizing: 'border-box'
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
    boxSizing: 'border-box',
    transition: 'border-color 0.15s ease'
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
    padding: '10px 20px',
    background: '#4f46e5',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    fontWeight: '700',
    cursor: 'pointer',
    fontSize: '14px'
  },
  buttonSecondary: {
    padding: '10px 18px',
    background: '#ffffff',
    color: '#334155',
    border: '1px solid #cbd5e1',
    borderRadius: '8px',
    fontWeight: '700',
    cursor: 'pointer',
    fontSize: '13px'
  },
  buttonSuccess: {
    padding: '12px 22px',
    background: '#10b981',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    fontWeight: '700',
    cursor: 'pointer',
    fontSize: '14px',
    width: '100%',
    marginTop: '8px'
  },
  buttonWarning: {
    padding: '12px 22px',
    background: '#f59e0b',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    fontWeight: '700',
    cursor: 'pointer',
    fontSize: '14px',
    width: '100%',
    marginTop: '8px'
  },
  buttonDanger: {
    padding: '8px 14px',
    background: '#fff1f2',
    color: '#e11d48',
    border: '1px solid #ffe4e6',
    borderRadius: '8px',
    fontWeight: '700',
    cursor: 'pointer',
    fontSize: '13px'
  },
  sectionTitle: {
    margin: '0 0 16px 0',
    fontSize: '18px',
    color: '#0f172a',
    fontWeight: '800',
    borderBottom: '1px solid #f1f5f9',
    paddingBottom: '12px'
  },
  badge: {
    display: 'inline-block',
    padding: '4px 10px',
    borderRadius: '999px',
    fontSize: '11px',
    fontWeight: '700'
  },
  filterSelect: {
    padding: '8px 12px',
    borderRadius: '8px',
    border: '1px solid #cbd5e1',
    outline: 'none',
    fontSize: '13px',
    backgroundColor: '#ffffff',
    color: '#0f172a',
    fontWeight: '600',
    cursor: 'pointer'
  }
};

export const sortStudentsByDepartment = (studentsList, classNameAlias) => {
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