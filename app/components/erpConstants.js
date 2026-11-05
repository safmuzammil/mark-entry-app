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

export const styles = {
  pageBackground: {
    minHeight: '100vh',
    backgroundColor: '#f1f5f9',
    padding: '24px 16px',
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
    color: '#0f172a'
  },
  card: {
    background: '#ffffff',
    padding: '24px',
    borderRadius: '18px',
    boxShadow: '0 4px 20px rgba(15, 23, 42, 0.04)',
    border: '1px solid #cbd5e1',
    marginBottom: '22px',
    boxSizing: 'border-box'
  },
  input: {
    width: '100%',
    padding: '11px 14px',
    borderRadius: '10px',
    border: '1.5px solid #94a3b8',
    backgroundColor: '#ffffff',
    color: '#0f172a',
    fontSize: '14px',
    fontWeight: '600',
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s ease, box-shadow 0.15s ease'
  },
  label: {
    display: 'block',
    fontSize: '12px',
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: '6px',
    textTransform: 'uppercase',
    letterSpacing: '0.4px'
  },
  buttonPrimary: {
    padding: '12px 22px',
    background: 'linear-gradient(135deg, #00897b 0%, #0f766e 100%)',
    color: '#ffffff',
    border: 'none',
    borderRadius: '10px',
    fontWeight: '800',
    cursor: 'pointer',
    fontSize: '14px',
    boxShadow: '0 4px 12px rgba(15, 118, 110, 0.22)'
  },
  buttonSuccess: {
    padding: '14px 24px',
    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    color: '#ffffff',
    border: 'none',
    borderRadius: '10px',
    fontWeight: '800',
    cursor: 'pointer',
    fontSize: '15px',
    width: '100%',
    marginTop: '10px',
    boxShadow: '0 4px 12px rgba(5, 150, 105, 0.22)'
  },
  buttonWarning: {
    padding: '14px 24px',
    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    color: '#ffffff',
    border: 'none',
    borderRadius: '10px',
    fontWeight: '800',
    cursor: 'pointer',
    fontSize: '15px',
    width: '100%',
    marginTop: '10px',
    boxShadow: '0 4px 12px rgba(217, 119, 6, 0.22)'
  },
  buttonDanger: {
    padding: '9px 16px',
    background: '#fef2f2',
    color: '#dc2626',
    border: '1px solid #fecaca',
    borderRadius: '10px',
    fontWeight: '800',
    cursor: 'pointer',
    fontSize: '13px'
  },
  sectionTitle: {
    margin: '0 0 18px 0',
    fontSize: '19px',
    color: '#0f172a',
    fontWeight: '900',
    borderBottom: '2px solid #f1f5f9',
    paddingBottom: '12px'
  },
  badge: {
    display: 'inline-block',
    padding: '4px 9px',
    borderRadius: '7px',
    fontSize: '11px',
    fontWeight: '800'
  },
  filterSelect: {
    padding: '8px 12px',
    borderRadius: '8px',
    border: '1.5px solid #94a3b8',
    outline: 'none',
    fontSize: '13px',
    backgroundColor: '#ffffff',
    color: '#0f172a',
    fontWeight: '700',
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