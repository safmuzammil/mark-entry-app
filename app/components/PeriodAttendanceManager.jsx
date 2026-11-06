'use client';
import React, { useState, useEffect } from 'react';
import { auth, db } from '../../lib/firebase';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc, getDocs, setDoc, deleteDoc, collection, writeBatch } from 'firebase/firestore';
import { DEFAULT_CLASSES, DEFAULT_SUBJECTS, DHIU_LOGO_URL, styles, sortStudentsByDepartment } from './erpConstants';
import { doesClassMatchAlias, openDirectWhatsApp, resolveClassTeacherForStudent, CollapsibleCard } from './ErpExtensions';
import PeriodAttendanceReportsHub from './PeriodAttendanceReportsHub';
import PeriodAttendanceMinusAndClearance from './PeriodAttendanceMinusAndClearance';

export const isHifzEnrollment = (env) => {
  const subUp = String(env?.subject || '').trim().toUpperCase();
  const aliasUp = String(env?.alias || '').trim().toUpperCase();
  return subUp === 'HIFZ' || aliasUp.includes('HIFZ');
};

export const isAttendanceOnlyEnrollment = (env) => {
  if (!env) return false;
  if (env.isAttendanceOnly === true || env.onlyAttendance === true || env.nonMarkSubject === true) return true;
  const subUp = String(env.subject || '').trim().toUpperCase();
  const normDefault = DEFAULT_SUBJECTS.map(s => s.toUpperCase());
  if (subUp === 'MANTIQ' || subUp.includes('U :FIQH') || subUp.includes('U:FIQH')) return false;
  return subUp !== '' && !normDefault.includes(subUp);
};

export const LEADER_CLASS_ORDER = ['QLA3', 'HFC3', 'FC2', 'AL2', 'QH2', 'FC1', 'QH1', 'AL1'];

export const sortStudentsForEventLeader = (studentsArray) => {
  return [...studentsArray].sort((a, b) => {
    const clsA = String((a.classes || [])[0] || a.class || '').toUpperCase().trim();
    const clsB = String((b.classes || [])[0] || b.class || '').toUpperCase().trim();
    const idxA = LEADER_CLASS_ORDER.indexOf(clsA) !== -1 ? LEADER_CLASS_ORDER.indexOf(clsA) : 99;
    const idxB = LEADER_CLASS_ORDER.indexOf(clsB) !== -1 ? LEADER_CLASS_ORDER.indexOf(clsB) : 99;
    if (idxA !== idxB) return idxA - idxB;
    return (Number(a.rollNo) || 999) - (Number(b.rollNo) || 999);
  });
};

export const REHEARSAL_SESSIONS = [
  { id: 'FN1', label: 'Forenoon Session 1 (Clears 2 Regular Periods • Periods 3 & 4)', coveredPeriods: [3, 4], weight: 2 },
  { id: 'FN2', label: 'Forenoon Session 2 (Clears 2 Regular Periods • Periods 5 & 6)', coveredPeriods: [5, 6], weight: 2 },
  { id: 'AN1', label: 'Afternoon Session 3 (Clears 3 Regular Periods • Periods 7, 8 & 9)', coveredPeriods: [7, 8, 9], weight: 3 }
];

export const normalizeSubKey = (sub) => {
  const up = String(sub || '').trim().toUpperCase().replace(/\./g, '');
  if (up.includes('U :FIQH') || up.includes('U:FIQH') || up.includes('USUL')) return 'U :FIQH';
  if (up === 'MANTIQ') return 'LOGIC';
  return up;
};

export default function PeriodAttendanceManager({
  userRole = 'teacher', // 'teacher' | 'admin' | 'event_leader'
  loggedInUser,
  preloadedStudents = [],
  preloadedTeachers = [],
  onStudentsUpdated,
  onTeachersUpdated
}) {
  const isEventLeaderUser = Boolean(
    userRole === 'event_leader' ||
    loggedInUser?.isEventLeader ||
    loggedInUser?.roleCategory === 'Event Leader'
  );

  const [localStudents, setLocalStudents] = useState(preloadedStudents);
  const [localTeachers, setLocalTeachers] = useState(preloadedTeachers);

  useEffect(() => { setLocalStudents(preloadedStudents); }, [preloadedStudents]);
  useEffect(() => { setLocalTeachers(preloadedTeachers); }, [preloadedTeachers]);

  const [activeTab, setActiveTab] = useState(isEventLeaderUser ? 'rehearsal_leader' : 'cards');
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  useEffect(() => {
    if (isEventLeaderUser) setActiveTab('rehearsal_leader');
  }, [isEventLeaderUser]);

  const [activeOutpassesByReg, setActiveOutpassesByReg] = useState({});

  // --- 1. SUBJECT CARDS & 9-PERIOD ROLL CALL STATE ---
  const [selectedTeacherUsername, setSelectedTeacherUsername] = useState(loggedInUser?.username || '');
  const [attDate, setAttDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [attSession, setAttSession] = useState(''); // Mandatory manual selection!
  const [attEnrollmentId, setAttEnrollmentId] = useState('');
  const [classStudents, setClassStudents] = useState([]);
  const [absentRegNos, setAbsentRegNos] = useState([]);
  const [existingSessionDoc, setExistingSessionDoc] = useState(null);
  const [rehearsalPresentMapForDate, setRehearsalPresentMapForDate] = useState({});

  // --- 2. EVENT / ARTS FEST REHEARSAL LEADER STATE ---
  const [rehDate, setRehDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [rehSessionId, setRehSessionId] = useState('FN1');
  const [rehSelectedLeaderUsername, setRehSelectedLeaderUsername] = useState(loggedInUser?.username || '');
  const [rehAbsentRegNos, setRehAbsentRegNos] = useState([]);
  const [existingRehDoc, setExistingRehDoc] = useState(null);

  // --- 3. ADMIN: CREATE & MANAGE TEMP EVENT LEADERS + DEADLINES ---
  const [newLeaderName, setNewLeaderName] = useState('');
  const [newLeaderUsername, setNewLeaderUsername] = useState('');
  const [newLeaderPassword, setNewLeaderPassword] = useState('');
  const [newLeaderEventTitle, setNewLeaderEventTitle] = useState('Arts Fest Rehearsal');
  const [assignLeaderUsername, setAssignLeaderUsername] = useState('');
  const [leaderAssignDeadline, setLeaderAssignDeadline] = useState('2026-11-15');
  const [leaderFilterClass, setLeaderFilterClass] = useState('All');
  const [leaderStudentSearch, setLeaderStudentSearch] = useState('');
  const [leaderSelectedRegs, setLeaderSelectedRegs] = useState([]);
  const [bulkAdNoPasteText, setBulkAdNoPasteText] = useState('');

  // --- 4. NON-MARK SUBJECT CREATOR & MASS ASSIGN STATE ---
  const [nmTeacherUsername, setNmTeacherUsername] = useState('');
  const [nmSubjectName, setNmSubjectName] = useState('');
  const [nmTargetClass, setNmTargetClass] = useState('QLA3');
  const [nmAlias, setNmAlias] = useState('');
  const [nmSelectedEnrollmentId, setNmSelectedEnrollmentId] = useState('');
  const [nmClassFilter, setNmClassFilter] = useState('All');
  const [nmStreamFilter, setNmStreamFilter] = useState('All');
  const [nmStudentSearch, setNmStudentSearch] = useState('');
  const [nmSelectedStudentRegs, setNmSelectedStudentRegs] = useState([]);

  const [clearancePrintStudent, setClearancePrintStudent] = useState(null);

  const isoToLocalYMD = (isoStr) => {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return String(isoStr).split('T')[0];
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const formatShortDateTime = (isoStr, isOpen) => {
    if (isOpen) return 'Open Return';
    if (!isoStr) return '—';
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
  };

  // Load Active Out-Passes & Rehearsal Stamps for `attDate`
  useEffect(() => {
    async function loadOutpassesAndRehearsalStamps() {
      try {
        const [opSnap, rehSnap] = await Promise.all([
          getDocs(collection(db, 'out_passes')),
          getDoc(doc(db, 'systemCache', `rehearsalStamp_${attDate}`))
        ]);

        const opMap = {};
        opSnap.forEach(d => {
          const data = d.data();
          const status = String(data.status || '').toUpperCase();
          if (status === 'CANCELLED') return;

          const depDate = isoToLocalYMD(data.permittedFrom || data.departureDate || data.createdAt);
          const retDate = data.isOpenReturn || !data.permittedTo
            ? (data.actualReturnTime ? isoToLocalYMD(data.actualReturnTime) : '2099-12-31')
            : isoToLocalYMD(data.actualReturnTime || data.permittedTo || data.returnDate);

          const isActiveNow = status === 'APPROVED' || status === 'OUTSIDE' || status === 'ARRIVED_AT_GATE';
          const isWithinDateWindow = depDate && attDate >= depDate && attDate <= retDate;

          if (isWithinDateWindow && (isActiveNow || status === 'RETURNED')) {
            const passAdNo = String(data.adNo || '').trim().toUpperCase();
            const passRegNo = String(data.studentRegNo || data.regNo || '').trim().toUpperCase();

            const matchedSt = localStudents.find(
              s => String(s.adNo || '').trim().toUpperCase() === passAdNo ||
                   String(s.regNo || '').trim().toUpperCase() === passRegNo ||
                   String(s.regNo || '').trim().toUpperCase() === passAdNo
            );

            const targetKey = matchedSt ? matchedSt.regNo : passAdNo;
            if (targetKey) {
              const cat = String(data.leaveCategory || data.category || 'General');
              const catLower = cat.toLowerCase();
              const isOfficial = catLower.includes('official') || catLower.includes('outreach');
              opMap[targetKey] = {
                category: cat,
                isOfficial,
                status,
                destination: data.destination || 'Out',
                reason: data.purpose || data.reason || '',
                teacherName: data.teacherName || 'Faculty',
                teacherPhone: data.teacherPhone || '',
                fromFormatted: formatShortDateTime(data.permittedFrom, false),
                toFormatted: formatShortDateTime(data.permittedTo, data.isOpenReturn)
              };
            }
          }
        });
        setActiveOutpassesByReg(opMap);

        if (rehSnap.exists()) {
          setRehearsalPresentMapForDate(rehSnap.data().periodPresentRegs || {});
        } else {
          setRehearsalPresentMapForDate({});
        }
      } catch (e) {
        console.error('Error syncing out_passes:', e);
      }
    }
    if (localStudents.length > 0) {
      loadOutpassesAndRehearsalStamps();
    }
  }, [attDate, localStudents]);

  useEffect(() => {
    const nonLeaderTeachers = localTeachers.filter(t => !t.isEventLeader);
    if (userRole === 'admin' && !selectedTeacherUsername && nonLeaderTeachers.length > 0) {
      setSelectedTeacherUsername(nonLeaderTeachers[0].username);
      setNmTeacherUsername(nonLeaderTeachers[0].username);
    }
    const leaders = localTeachers.filter(t => t.isEventLeader);
    if (userRole === 'admin' && !assignLeaderUsername && leaders.length > 0) {
      setAssignLeaderUsername(leaders[0].username);
      setRehSelectedLeaderUsername(leaders[0].username);
    }
  }, [userRole, localTeachers, selectedTeacherUsername, assignLeaderUsername]);

  const activeTeacherObj = userRole === 'admin'
    ? (localTeachers.find(t => t.username === selectedTeacherUsername) || localTeachers[0] || loggedInUser)
    : (localTeachers.find(t => t.username === loggedInUser?.username) || loggedInUser);

  const attendanceEnrollments = (Array.isArray(activeTeacherObj?.enrollments) ? activeTeacherObj.enrollments : [])
    .filter(env => !isHifzEnrollment(env) && !env.isRehearsalSlot);

  const getStudentsForEnrollment = (env) => {
    if (!env || localStudents.length === 0) return [];
    const envAliasLower = String(env.alias || '').trim().toLowerCase();
    const envLang = String(env.langTag || '').trim().toLowerCase();
    const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const KNOWN_SPECIFIC_CLASSES = ['QH1', 'AL1', 'ALC1', 'FC1', 'QH2', 'AL2', 'ALC2', 'FC2', 'QLA3', 'HFC3', 'QH3', 'AL3', 'FC3'];
    const isSpecificClassBatch = KNOWN_SPECIFIC_CLASSES.some(cls => norm(env.alias).includes(cls) || norm(env.targetClass).includes(cls));

    const matched = localStudents.filter(st => {
      const sReg = String(st.regNo || '').trim().toUpperCase();
      const sAd = String(st.adNo || '').trim().toUpperCase();
      const sId = String(st.id || '').trim().toUpperCase();
      const isUrdu = sAd.startsWith('U');

      if (Array.isArray(env.studentIds) && env.studentIds.length > 0) {
        const savedIds = env.studentIds.map(id => String(id).trim().toUpperCase()).filter(Boolean);
        if (savedIds.length > 0) {
          return savedIds.includes(sReg) || savedIds.includes(sAd) || savedIds.includes(sId);
        }
      }
      if (Array.isArray(st.attendanceEnrollmentIds) && st.attendanceEnrollmentIds.includes(env.id)) {
        return true;
      }

      if (env.isAttendanceOnly && (!env.targetClass || env.targetClass === 'CUSTOM')) {
        return false;
      }

      const classMatch = doesClassMatchAlias(st.classes || [st.class], env.targetClass, env.alias, env.grade);
      if (!classMatch) return false;

      const isStrictlyUrdu = (envLang.includes('urdu') && !envLang.includes('non')) || /\bu(8|9|10)\b/.test(envAliasLower);
      const isStrictlyNonUrdu = envLang.includes('non-urdu') || envLang.includes('non urdu') || /\bm(8|9|10)\b/.test(envAliasLower);

      if (isStrictlyUrdu) return isUrdu;
      if (isStrictlyNonUrdu) return !isUrdu;
      if (isSpecificClassBatch) return true;
      if (envLang.includes('gen')) return !isUrdu;
      return true;
    });

    return typeof sortStudentsByDepartment === 'function'
      ? sortStudentsByDepartment(matched, env.alias || env.subject)
      : matched;
  };

  useEffect(() => {
    if (!attEnrollmentId) {
      setClassStudents([]);
      return;
    }
    const env = attendanceEnrollments.find(e => e.id === attEnrollmentId);
    setClassStudents(getStudentsForEnrollment(env));
  }, [attEnrollmentId, localStudents, selectedTeacherUsername]);

  useEffect(() => {
    async function checkExistingSession() {
      if (!attEnrollmentId || !attDate || !attSession) {
        setExistingSessionDoc(null);
        setAbsentRegNos([]);
        return;
      }
      const env = attendanceEnrollments.find(e => e.id === attEnrollmentId);
      if (!env) return;

      const sessionDocId = `periodSession_${attDate}_${String(env.alias || env.subject).replace(/[^a-zA-Z0-9]/g, '_')}_S${attSession}`;
      try {
        const snap = await getDoc(doc(db, 'systemCache', sessionDocId));
        if (snap.exists()) {
          const data = snap.data();
          setExistingSessionDoc(data);
          const abs = Object.keys(data.attendanceMap || {}).filter(reg => data.attendanceMap[reg] === 'A' || data.attendanceMap[reg] === 'M');
          setAbsentRegNos(abs);
        } else {
          setExistingSessionDoc(null);
          const rehPresentForThisPeriod = rehearsalPresentMapForDate[String(attSession)] || [];
          const autoAbs = classStudents
            .filter(st => {
              if (rehPresentForThisPeriod.includes(st.regNo)) return false;
              const op = activeOutpassesByReg[st.regNo];
              return op && !op.isOfficial;
            })
            .map(st => st.regNo);
          setAbsentRegNos(autoAbs);
        }
      } catch (e) {
        setExistingSessionDoc(null);
      }
    }
    checkExistingSession();
  }, [attEnrollmentId, attDate, attSession, classStudents, activeOutpassesByReg, rehearsalPresentMapForDate]);

  const toggleAbsent = (regNo) => {
    setAbsentRegNos(prev => prev.includes(regNo) ? prev.filter(id => id !== regNo) : [...prev, regNo]);
  };

  const getStudentAttStat = (st) => {
    return st?.periodAttendance || {
      totalPeriods: 0,
      presentCount: 0,
      officialCount: 0,
      medicalCount: 0,
      minusCount: 0,
      minusLogs: [],
      subjectWise: {}
    };
  };

  const syncUpdatedStudentsState = (updatedMapByReg) => {
    const nextList = localStudents.map(s => updatedMapByReg[s.regNo] ? updatedMapByReg[s.regNo] : s);
    setLocalStudents(nextList);
    if (onStudentsUpdated) onStudentsUpdated(nextList);
  };

  const absentStudentsByClassGroups = React.useMemo(() => {
    const rehPresentHere = rehearsalPresentMapForDate[String(attSession)] || [];
    const currentAbsentStudents = classStudents.filter(st => {
      const op = activeOutpassesByReg[st.regNo];
      const isAutoOfficial = rehPresentHere.includes(st.regNo) || (op && op.isOfficial);
      return !isAutoOfficial && absentRegNos.includes(st.regNo);
    });

    const groups = {};
    currentAbsentStudents.forEach(st => {
      const clsName = String((st.classes || [])[0] || st.class || 'GENERAL').trim().toUpperCase();
      if (!groups[clsName]) {
        const ctObj = resolveClassTeacherForStudent(st, localTeachers);
        groups[clsName] = { className: clsName, classTeacher: ctObj, students: [] };
      }
      groups[clsName].students.push(st);
    });
    return Object.values(groups);
  }, [classStudents, absentRegNos, rehearsalPresentMapForDate, attSession, activeOutpassesByReg, localTeachers]);

  const formatAbsentMessageForClass = (group) => {
    const env = attendanceEnrollments.find(e => e.id === attEnrollmentId);
    const subTitle = env?.alias || env?.subject || 'Class';
    const lines = group.students.map((s, idx) => `${idx + 1}. ${s.firstName} (#${s.adNo})`).join('\n');
    return `*📋 ABSENTEES CONFIRMATION — CLASS ${group.className}*\n📅 Date: ${attDate} | Period: ${attSession}\n📖 Subject: ${subTitle}\n👨‍🏫 Teacher: ${activeTeacherObj?.fullName || 'Faculty'}\n\n*Absent Students (${group.students.length}):*\n${lines}`;
  };

  const handleCopyClassAbsentees = (group) => {
    navigator.clipboard.writeText(formatAbsentMessageForClass(group)).then(() => {
      alert(`✅ Copied ${group.students.length} absentee(s) of Class ${group.className} to clipboard!`);
    });
  };

  const handleCopyAllAbsentees = () => {
    if (absentStudentsByClassGroups.length === 0) return;
    const combined = absentStudentsByClassGroups.map(g => formatAbsentMessageForClass(g)).join('\n\n----------------\n\n');
    navigator.clipboard.writeText(combined).then(() => {
      alert('✅ Copied all absent students to clipboard!');
    });
  };

  // ==========================================
  // 1. ERROR-PROOF SAVE REGULAR PERIOD ATTENDANCE
  // ==========================================
  const handleSaveAttendance = async (e) => {
    e.preventDefault();
    if (!attSession) {
      return alert('⚠️ Mandatory Step: Please select the Period (1 to 9) before saving attendance!');
    }
    if (!attEnrollmentId || classStudents.length === 0) {
      return alert('Please select a subject with enrolled students.');
    }

    setLoading(true);
    setStatusMsg('');
    try {
      const env = attendanceEnrollments.find(x => x.id === attEnrollmentId);
      if (!env) throw new Error('Selected subject enrollment not found.');

      const safeAlias = String(env.alias || env.subject || 'Subject').trim();
      const sessionDocId = `periodSession_${attDate}_${safeAlias.replace(/[^a-zA-Z0-9]/g, '_')}_S${attSession}`;
      const subKey = normalizeSubKey(isAttendanceOnlyEnrollment(env) ? safeAlias : (env.subject || safeAlias));
      const safeTeacherUsername = String(activeTeacherObj?.username || loggedInUser?.username || 'faculty').toLowerCase().trim();
      const safeTeacherName = String(activeTeacherObj?.fullName || loggedInUser?.fullName || 'Faculty').trim();

      const rehPresentList = rehearsalPresentMapForDate[String(attSession)] || [];
      const previousMap = existingSessionDoc?.attendanceMap || null;
      const newAttendanceMap = {};

      classStudents.forEach(st => {
        const reg = String(st.regNo || st.id || '').trim();
        if (!reg) return;
        const isMarkedAbsentByRegularTeacher = absentRegNos.includes(reg);
        const isRehearsalPresent = rehPresentList.includes(reg);
        const op = activeOutpassesByReg[reg];

        if (!isMarkedAbsentByRegularTeacher) {
          newAttendanceMap[reg] = 'P';
        } else if (isRehearsalPresent || (op && op.isOfficial)) {
          newAttendanceMap[reg] = 'O';
        } else {
          newAttendanceMap[reg] = op ? 'M' : 'A';
        }
      });

      const updatedStudentsByReg = {};
      for (let i = 0; i < classStudents.length; i += 400) {
        const chunk = classStudents.slice(i, i + 400);
        const stBatch = writeBatch(db);

        chunk.forEach(st => {
          const reg = String(st.regNo || st.id || '').trim();
          const docId = String(st.id || st.regNo || '').toLowerCase().trim();
          if (!reg || !docId) return;

          const stRef = doc(db, 'students', docId);
          const curStat = JSON.parse(JSON.stringify(getStudentAttStat(st)));

          if (!curStat.subjectWise) curStat.subjectWise = {};
          if (!curStat.subjectWise[subKey]) {
            curStat.subjectWise[subKey] = {
              total: 0,
              present: 0,
              official: 0,
              medical: 0,
              absentDates: [],
              teacherName: safeTeacherName,
              isAttendanceOnly: Boolean(isAttendanceOnlyEnrollment(env))
            };
          }
          const subObj = curStat.subjectWise[subKey];
          subObj.teacherName = safeTeacherName || subObj.teacherName || '';
          subObj.isAttendanceOnly = Boolean(isAttendanceOnlyEnrollment(env));
          if (!Array.isArray(subObj.absentDates)) subObj.absentDates = [];

          const newStatus = newAttendanceMap[reg] || 'P';
          const isNewPresent = newStatus === 'P' || newStatus === 'O';
          const oldStatus = previousMap ? previousMap[reg] : null;
          const wasOldPresent = oldStatus === 'P' || oldStatus === 'O';

          if (!oldStatus) {
            curStat.totalPeriods = (Number(curStat.totalPeriods) || 0) + 1;
            subObj.total = (Number(subObj.total) || 0) + 1;
            if (isNewPresent) {
              curStat.presentCount = (Number(curStat.presentCount) || 0) + 1;
              subObj.present = (Number(subObj.present) || 0) + 1;
              if (newStatus === 'O') {
                curStat.officialCount = (Number(curStat.officialCount) || 0) + 1;
                subObj.official = (Number(subObj.official) || 0) + 1;
              }
            } else {
              if (!subObj.absentDates.includes(attDate)) subObj.absentDates.push(attDate);
              if (newStatus === 'M') {
                curStat.medicalCount = (Number(curStat.medicalCount) || 0) + 1;
                subObj.medical = (Number(subObj.medical) || 0) + 1;
              }
            }
          } else if (wasOldPresent !== isNewPresent) {
            if (!wasOldPresent && isNewPresent) {
              curStat.presentCount = (Number(curStat.presentCount) || 0) + 1;
              subObj.present = (Number(subObj.present) || 0) + 1;
              subObj.absentDates = subObj.absentDates.filter(d => d !== attDate);
            } else if (wasOldPresent && !isNewPresent) {
              curStat.presentCount = Math.max(0, (Number(curStat.presentCount) || 0) - 1);
              subObj.present = Math.max(0, (Number(subObj.present) || 0) - 1);
              if (!subObj.absentDates.includes(attDate)) subObj.absentDates.push(attDate);
            }
          }

          curStat.updatedAt = new Date().toISOString();
          stBatch.set(stRef, { periodAttendance: curStat }, { merge: true });
          updatedStudentsByReg[reg] = { ...st, periodAttendance: curStat };
        });

        await stBatch.commit();
      }

      try {
        await setDoc(doc(db, 'systemCache', sessionDocId), {
          date: attDate,
          session: Number(attSession) || 1,
          subject: subKey,
          classAlias: safeAlias,
          isAttendanceOnly: Boolean(isAttendanceOnlyEnrollment(env)),
          teacherUsername: safeTeacherUsername,
          teacherName: safeTeacherName,
          attendanceMap: newAttendanceMap,
          updatedAt: new Date().toISOString()
        }, { merge: true });

        const dayIndexRef = doc(db, 'systemCache', `daySessionsIndex_${attDate}`);
        const dayIndexSnap = await getDoc(dayIndexRef);
        const existingSessionsList = dayIndexSnap.exists() ? (dayIndexSnap.data().sessions || []) : [];
        const updatedSessionsList = [
          ...existingSessionsList.filter(x => x.sessionDocId !== sessionDocId),
          { sessionDocId, session: Number(attSession) || 1, subject: subKey }
        ];
        await setDoc(dayIndexRef, { date: attDate, sessions: updatedSessionsList }, { merge: true });
      } catch (cacheErr) {
        console.warn('Session cache note:', cacheErr);
      }

      syncUpdatedStudentsState(updatedStudentsByReg);
      setExistingSessionDoc({ attendanceMap: newAttendanceMap });
      const presentTotal = Object.values(newAttendanceMap).filter(v => v === 'P' || v === 'O').length;
      setStatusMsg(`✅ Period ${attSession} Attendance (${safeAlias}) Saved! (${presentTotal} Present, ${classStudents.length - presentTotal} Absent)`);
    } catch (error) {
      console.error('Save attendance error:', error);
      alert('Error saving attendance: ' + error.message);
      setStatusMsg('❌ Error saving attendance: ' + error.message);
    } finally {
      setLoading(false);
      setTimeout(() => setStatusMsg(''), 6000);
    }
  };

  // ==========================================
  // 2. EVENT / ARTS FEST STUDENT LEADER REHEARSAL
  // ==========================================
  const activeLeaderObj = isEventLeaderUser
    ? (localTeachers.find(t => t.username === loggedInUser?.username) || loggedInUser)
    : (localTeachers.find(t => t.username === rehSelectedLeaderUsername && t.isEventLeader) || localTeachers.find(t => t.isEventLeader));

  const leaderAssignedStudentIds = React.useMemo(() => {
    const firstEnv = (activeLeaderObj?.enrollments || [])[0];
    return Array.isArray(firstEnv?.studentIds) ? firstEnv.studentIds : (activeLeaderObj?.assignedStudentIds || []);
  }, [activeLeaderObj]);

  const leaderStudentDeadlinesMap = React.useMemo(() => {
    const firstEnv = (activeLeaderObj?.enrollments || [])[0];
    return firstEnv?.studentDeadlines || activeLeaderObj?.studentDeadlines || {};
  }, [activeLeaderObj]);

  const leaderStudentsSorted = React.useMemo(() => {
    const savedUpper = leaderAssignedStudentIds.map(id => String(id).trim().toUpperCase());
    const matched = localStudents.filter(st => {
      const isAssigned =
        savedUpper.includes(String(st.regNo || '').trim().toUpperCase()) ||
        savedUpper.includes(String(st.adNo || '').trim().toUpperCase());
      if (!isAssigned) return false;
      const deadline = leaderStudentDeadlinesMap[st.regNo] || st.rehearsalDeadline || '';
      if (deadline && rehDate > deadline) return false;
      return true;
    });
    return sortStudentsForEventLeader(matched);
  }, [localStudents, leaderAssignedStudentIds, leaderStudentDeadlinesMap, rehDate]);

  useEffect(() => {
    async function loadExistingRehearsal() {
      if (!activeLeaderObj?.username || !rehDate || !rehSessionId) return;
      const docId = `rehearsalSession_${rehDate}_${activeLeaderObj.username}_${rehSessionId}`;
      try {
        const snap = await getDoc(doc(db, 'systemCache', docId));
        if (snap.exists()) {
          const data = snap.data();
          setExistingRehDoc(data);
          setRehAbsentRegNos(data.absentRegNos || []);
        } else {
          setExistingRehDoc(null);
          setRehAbsentRegNos([]);
        }
      } catch (e) {
        setExistingRehDoc(null);
      }
    }
    loadExistingRehearsal();
  }, [activeLeaderObj?.username, rehDate, rehSessionId]);

  const handleSaveRehearsalAttendance = async (e) => {
    e.preventDefault();
    if (!activeLeaderObj || leaderStudentsSorted.length === 0) {
      return alert('No active students assigned for this date.');
    }

    const sessionConfig = REHEARSAL_SESSIONS.find(s => s.id === rehSessionId) || REHEARSAL_SESSIONS[0];
    const coveredPeriods = sessionConfig.coveredPeriods;
    const presentRegs = leaderStudentsSorted.filter(st => !rehAbsentRegNos.includes(st.regNo)).map(st => st.regNo);

    setLoading(true);
    setStatusMsg('');
    try {
      const batch = writeBatch(db);
      const rehDocId = `rehearsalSession_${rehDate}_${activeLeaderObj.username}_${rehSessionId}`;
      batch.set(doc(db, 'systemCache', rehDocId), {
        date: rehDate,
        sessionId: rehSessionId,
        sessionLabel: sessionConfig.label,
        coveredPeriods,
        weight: sessionConfig.weight,
        leaderUsername: activeLeaderObj.username,
        leaderName: activeLeaderObj.fullName || 'Event Leader',
        presentRegNos: presentRegs,
        absentRegNos: rehAbsentRegNos,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      const stampRef = doc(db, 'systemCache', `rehearsalStamp_${rehDate}`);
      const stampSnap = await getDoc(stampRef);
      const existingPeriodPresent = stampSnap.exists() ? (stampSnap.data().periodPresentRegs || {}) : {};
      coveredPeriods.forEach(pNum => {
        const prevList = Array.isArray(existingPeriodPresent[String(pNum)]) ? existingPeriodPresent[String(pNum)] : [];
        const filteredPrev = prevList.filter(r => !rehAbsentRegNos.includes(r));
        existingPeriodPresent[String(pNum)] = Array.from(new Set([...filteredPrev, ...presentRegs]));
      });
      batch.set(stampRef, { date: rehDate, periodPresentRegs: existingPeriodPresent, updatedAt: new Date().toISOString() }, { merge: true });

      await batch.commit();
      setExistingRehDoc({ presentRegNos: presentRegs, absentRegNos: rehAbsentRegNos });
      setStatusMsg(`✅ Rehearsal Attendance Saved (${presentRegs.length} Present, ${rehAbsentRegNos.length} Absent)!`);
    } catch (err) {
      setStatusMsg('❌ Error saving rehearsal attendance: ' + err.message);
    } finally {
      setLoading(false);
      setTimeout(() => setStatusMsg(''), 6000);
    }
  };

  // ==========================================
  // 3. ADMIN: CREATE, ASSIGN & REVOKE EVENT LEADERS + NON-MARK SUBJECTS
  // ==========================================
  const handleCreateEventLeaderAccount = async (e) => {
    e.preventDefault();
    const safeUser = newLeaderUsername.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
    if (!newLeaderName.trim() || !safeUser || newLeaderPassword.length < 6) {
      return alert('Please enter Leader Name, Username, and a Password of at least 6 characters.');
    }

    setLoading(true);
    try {
      const secondaryAppName = 'SecondaryLeaderCreationApp';
      const existingSecondary = getApps().find(a => a.name === secondaryAppName);
      const secondaryApp = existingSecondary || initializeApp(auth.app.options, secondaryAppName);
      const secondaryAuth = getAuth(secondaryApp);

      try {
        await createUserWithEmailAndPassword(secondaryAuth, `${safeUser}@school.com`, newLeaderPassword.trim());
      } catch (authErr) {
        if (authErr.code !== 'auth/email-already-in-use') throw authErr;
      }

      const leaderDoc = {
        username: safeUser,
        fullName: `${newLeaderName.trim()} (${newLeaderEventTitle.trim()})`,
        designation: 'Event Attendance Leader',
        roleCategory: 'Event Leader',
        isEventLeader: true,
        eventTitle: newLeaderEventTitle.trim(),
        roles: ['Event Leader'],
        enrollments: [{
          id: `rehearsal_${safeUser}`,
          grade: 'ALL',
          targetClass: 'CUSTOM',
          subject: newLeaderEventTitle.trim(),
          alias: newLeaderEventTitle.trim(),
          isAttendanceOnly: true,
          isRehearsalSlot: true,
          studentIds: [],
          studentDeadlines: {}
        }],
        studentDeadlines: {},
        createdAt: new Date().toISOString()
      };

      await setDoc(doc(db, 'teachers', safeUser), leaderDoc, { merge: true });
      const nextTeachers = [...localTeachers.filter(t => t.username !== safeUser), leaderDoc];
      setLocalTeachers(nextTeachers);
      if (onTeachersUpdated) onTeachersUpdated(nextTeachers);

      setAssignLeaderUsername(safeUser);
      setNewLeaderName('');
      setNewLeaderUsername('');
      setNewLeaderPassword('');
      setStatusMsg(`✅ Created Temporary Event Leader Account "@${safeUser}"!`);
    } catch (err) {
      alert('Error creating Event Leader: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAssignStudentsToLeader = async () => {
    if (!assignLeaderUsername) return alert('Select an Event Leader account first.');
    if (leaderSelectedRegs.length === 0) return alert('Select at least one student below.');

    setLoading(true);
    try {
      const leaderObj = localTeachers.find(t => t.username === assignLeaderUsername);
      if (!leaderObj) throw new Error('Leader not found');

      const existingIds = leaderObj.enrollments?.[0]?.studentIds || leaderObj.assignedStudentIds || [];
      const existingDeadlines = { ...(leaderObj.enrollments?.[0]?.studentDeadlines || leaderObj.studentDeadlines || {}) };

      const mergedIds = Array.from(new Set([...existingIds, ...leaderSelectedRegs]));
      leaderSelectedRegs.forEach(reg => {
        if (leaderAssignDeadline) existingDeadlines[reg] = leaderAssignDeadline;
      });

      const updatedEnrollments = [{
        ...(leaderObj.enrollments?.[0] || {
          id: `rehearsal_${leaderObj.username}`,
          subject: leaderObj.eventTitle || 'Arts Fest Rehearsal',
          alias: leaderObj.eventTitle || 'Arts Fest Rehearsal',
          isAttendanceOnly: true,
          isRehearsalSlot: true
        }),
        studentIds: mergedIds,
        studentDeadlines: existingDeadlines
      }];

      await setDoc(doc(db, 'teachers', leaderObj.username), {
        enrollments: updatedEnrollments,
        assignedStudentIds: mergedIds,
        studentDeadlines: existingDeadlines
      }, { merge: true });

      const nextTeachers = localTeachers.map(t =>
        t.username === leaderObj.username
          ? { ...t, enrollments: updatedEnrollments, assignedStudentIds: mergedIds, studentDeadlines: existingDeadlines }
          : t
      );
      setLocalTeachers(nextTeachers);
      if (onTeachersUpdated) onTeachersUpdated(nextTeachers);

      setLeaderSelectedRegs([]);
      setStatusMsg(`✅ Assigned ${leaderSelectedRegs.length} students (Valid until ${leaderAssignDeadline || 'No Expiry'}) to ${leaderObj.fullName}!`);
    } catch (err) {
      alert('Failed to assign students: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveStudentFromLeader = async (leaderUsername, regNoToRemove) => {
    const leaderObj = localTeachers.find(t => t.username === leaderUsername);
    if (!leaderObj) return;
    const existingIds = leaderObj.enrollments?.[0]?.studentIds || leaderObj.assignedStudentIds || [];
    const existingDeadlines = { ...(leaderObj.enrollments?.[0]?.studentDeadlines || leaderObj.studentDeadlines || {}) };
    delete existingDeadlines[regNoToRemove];

    const nextIds = existingIds.filter(id => id !== regNoToRemove);
    const updatedEnrollments = [{ ...(leaderObj.enrollments?.[0] || {}), studentIds: nextIds, studentDeadlines: existingDeadlines }];

    await setDoc(doc(db, 'teachers', leaderUsername), {
      enrollments: updatedEnrollments,
      assignedStudentIds: nextIds,
      studentDeadlines: existingDeadlines
    }, { merge: true });

    const nextTeachers = localTeachers.map(t =>
      t.username === leaderUsername
        ? { ...t, enrollments: updatedEnrollments, assignedStudentIds: nextIds, studentDeadlines: existingDeadlines }
        : t
    );
    setLocalTeachers(nextTeachers);
    if (onTeachersUpdated) onTeachersUpdated(nextTeachers);
  };

  const handleDeleteEventLeaderAccount = async (leaderObj) => {
    if (!window.confirm(`Revoke & Delete temporary login for "${leaderObj.fullName}" (@${leaderObj.username})?`)) return;
    setLoading(true);
    try {
      await deleteDoc(doc(db, 'teachers', leaderObj.username));
      const nextTeachers = localTeachers.filter(t => t.username !== leaderObj.username);
      setLocalTeachers(nextTeachers);
      if (onTeachersUpdated) onTeachersUpdated(nextTeachers);
      setStatusMsg(`✅ Revoked login for @${leaderObj.username}.`);
    } catch (err) {
      alert('Error deleting leader account: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadAbsentReport = () => {
    let csv = 'data:text/csv;charset=utf-8,Subject Batch,Ad.No,Student Name,Class,Total Periods,Present,Absent,Attendance %,Absent Dates\n';
    attendanceEnrollments.forEach(env => {
      const subKey = normalizeSubKey(isAttendanceOnlyEnrollment(env) ? (env.alias || env.subject) : env.subject);
      const enrolled = getStudentsForEnrollment(env);
      enrolled.forEach(st => {
        const pAtt = getStudentAttStat(st);
        const sObj = (pAtt.subjectWise || {})[subKey] || { total: 0, present: 0, absentDates: [] };
        const abs = Math.max(0, (sObj.total || 0) - (sObj.present || 0));
        const pct = sObj.total > 0 ? ((sObj.present / sObj.total) * 100).toFixed(1) : '100.0';
        csv += `"${env.alias || env.subject}",${st.adNo},"${st.firstName}","${(st.classes || []).join(' ')}",${sObj.total || 0},${sObj.present || 0},${abs},${pct}%,"${(sObj.absentDates || []).join(', ')}"\n`;
      });
    });
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csv));
    link.setAttribute('download', `Absent_Report_${activeTeacherObj?.username || 'Faculty'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCreateNonMarkSubject = async (e) => {
    e.preventDefault();
    if (!nmTeacherUsername || !nmSubjectName.trim()) return alert('Please select a teacher and enter a subject name.');

    setLoading(true);
    try {
      const teacherObj = localTeachers.find(t => t.username === nmTeacherUsername);
      if (!teacherObj) throw new Error('Teacher not found');

      const cleanSub = nmSubjectName.trim();
      const cleanCls = nmTargetClass === 'CUSTOM' ? '' : nmTargetClass;
      const finalAlias = nmAlias.trim() || (cleanCls ? `${cleanSub.toUpperCase()} ${cleanCls}` : cleanSub.toUpperCase());
      const gMatch = String(cleanCls).match(/\d+/);

      const newEnv = {
        id: `att_only_${Date.now()}`,
        grade: gMatch ? gMatch[0] : '1',
        targetClass: nmTargetClass,
        subject: cleanSub,
        alias: finalAlias,
        langTag: '',
        isAttendanceOnly: true,
        studentIds: []
      };

      const updatedEnrollments = [...(teacherObj.enrollments || []), newEnv];
      await setDoc(doc(db, 'teachers', teacherObj.username), { enrollments: updatedEnrollments }, { merge: true });

      const nextTeachers = localTeachers.map(t => t.username === teacherObj.username ? { ...t, enrollments: updatedEnrollments } : t);
      setLocalTeachers(nextTeachers);
      if (onTeachersUpdated) onTeachersUpdated(nextTeachers);

      setNmSelectedEnrollmentId(newEnv.id);
      setNmSubjectName('');
      setNmAlias('');
      setStatusMsg(`✅ Created Attendance-Only subject "${finalAlias}" under ${teacherObj.fullName}!`);
    } catch (err) {
      alert('Error creating subject: ' + err.message);
    } finally {
      setLoading(false);
      setTimeout(() => setStatusMsg(''), 5000);
    }
  };

  const handleMassAssignToNonMarkSubject = async () => {
    if (!nmTeacherUsername || !nmSelectedEnrollmentId) return alert('Select a teacher and a Period Slot first.');
    if (nmSelectedStudentRegs.length === 0) return alert('Select at least one student from the list below.');

    setLoading(true);
    try {
      const teacherObj = localTeachers.find(t => t.username === nmTeacherUsername);
      const updatedEnrollments = (teacherObj.enrollments || []).map(env => {
        if (env.id === nmSelectedEnrollmentId) {
          const merged = Array.from(new Set([...(env.studentIds || []), ...nmSelectedStudentRegs]));
          return { ...env, studentIds: merged };
        }
        return env;
      });

      await setDoc(doc(db, 'teachers', teacherObj.username), { enrollments: updatedEnrollments }, { merge: true });
      const nextTeachers = localTeachers.map(t => t.username === teacherObj.username ? { ...t, enrollments: updatedEnrollments } : t);
      setLocalTeachers(nextTeachers);
      if (onTeachersUpdated) onTeachersUpdated(nextTeachers);

      setStatusMsg(`✅ Assigned ${nmSelectedStudentRegs.length} students to ${teacherObj.fullName}'s period attendance slot!`);
      setNmSelectedStudentRegs([]);
    } catch (err) {
      alert('Error assigning students: ' + err.message);
    } finally {
      setLoading(false);
      setTimeout(() => setStatusMsg(''), 5000);
    }
  };

  const filteredNmStudents = localStudents.filter(st => {
    const isUrdu = String(st.adNo || '').toUpperCase().startsWith('U');
    const stClasses = Array.isArray(st.classes) ? st.classes : [st.class];
    if (nmClassFilter !== 'All' && !stClasses.includes(nmClassFilter)) return false;
    if (nmStreamFilter === 'Urdu' && !isUrdu) return false;
    if (nmStreamFilter === 'General' && isUrdu) return false;
    if (nmStudentSearch.trim()) {
      const q = nmStudentSearch.trim().toLowerCase();
      if (!String(st.firstName || '').toLowerCase().includes(q) && !String(st.adNo || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const filteredLeaderAssignStudents = sortStudentsForEventLeader(
    localStudents.filter(st => {
      const stClasses = Array.isArray(st.classes) ? st.classes : [st.class];
      if (leaderFilterClass !== 'All' && !stClasses.includes(leaderFilterClass)) return false;
      if (leaderStudentSearch.trim()) {
        const q = leaderStudentSearch.trim().toLowerCase();
        if (!String(st.firstName || '').toLowerCase().includes(q) && !String(st.adNo || '').toLowerCase().includes(q)) return false;
      }
      return true;
    })
  );

  const shortageCount = localStudents.filter(st => {
    const stat = getStudentAttStat(st);
    const total = Number(stat.totalPeriods) || 0;
    if (total <= 0) return false;
    const net = Math.max(0, (Number(stat.presentCount) || 0) - (Number(stat.minusCount) || 0));
    return (net / total) * 100 < 85;
  }).length;

  const eventLeadersList = localTeachers.filter(t => t.isEventLeader);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* PRINTABLE ABSENCE CLEARANCE FORM MODAL */}
      {clearancePrintStudent && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2500, padding: '16px' }}>
          <div style={{ background: '#ffffff', padding: '32px', borderRadius: '16px', maxWidth: '720px', width: '100%', color: '#0f172a' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #0f172a', paddingBottom: '14px', marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <img src={DHIU_LOGO_URL} alt="DHIU" style={{ width: '52px', height: '52px', objectFit: 'contain' }} />
                <div>
                  <h3 style={{ margin: 0, fontSize: '20px', fontWeight: '900' }}>DARUL HUDA DEGREE INSTITUTION</h3>
                  <div style={{ fontSize: '13px', fontWeight: '800', color: '#dc2626' }}>OFFICIAL ABSENCE &amp; SHORTAGE CLEARANCE FORM</div>
                </div>
              </div>
              <button onClick={() => setClearancePrintStudent(null)} className="no-print" style={{ background: '#fee2e2', color: '#dc2626', border: 'none', padding: '8px 12px', borderRadius: '8px', fontWeight: '800', cursor: 'pointer' }}>✕ Close</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '14px', marginBottom: '20px', background: '#f8fafc', padding: '16px', borderRadius: '10px', border: '1px solid #cbd5e1' }}>
              <div><strong>Student Name:</strong> {clearancePrintStudent.firstName}</div>
              <div><strong>Admission No:</strong> #{clearancePrintStudent.adNo} (Reg: {clearancePrintStudent.regNo})</div>
              <div><strong>Class &amp; Dept:</strong> {(clearancePrintStudent.classes || []).join(', ')} ({clearancePrintStudent.department || 'GENERAL'})</div>
              <div><strong>Total Periods Held:</strong> {clearancePrintStudent.totalPeriods}</div>
              <div><strong>Gross Present / Minus:</strong> {clearancePrintStudent.rawPresent} Present / -{clearancePrintStudent.minusCount} Minus</div>
              <div><strong style={{ color: '#dc2626' }}>Net Attendance %:</strong> <strong style={{ color: '#dc2626', fontSize: '16px' }}>{clearancePrintStudent.effectivePct}% (Required: 85%)</strong></div>
            </div>

            <div style={{ border: '1px solid #94a3b8', borderRadius: '10px', padding: '18px', marginBottom: '24px', fontSize: '13px', lineHeight: 1.7 }}>
              <strong>Explanation / Reason for Attendance Shortage:</strong>
              <div style={{ height: '65px', borderBottom: '1px dashed #cbd5e1', marginTop: '8px' }} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginTop: '40px', textAlign: 'center', fontSize: '13px', fontWeight: '800' }}>
              <div style={{ borderTop: '1.5px solid #0f172a', paddingTop: '8px' }}>Class Teacher Signature</div>
              <div style={{ borderTop: '1.5px solid #0f172a', paddingTop: '8px' }}>Mentor Usthad Signature</div>
              <div style={{ borderTop: '1.5px solid #0f172a', paddingTop: '8px' }}>Principal / HoD Approval</div>
            </div>

            <div className="no-print" style={{ marginTop: '24px', textAlign: 'right' }}>
              <button onClick={() => window.print()} style={styles.buttonPrimary}>🖨️ Print Official Clearance Form</button>
            </div>
          </div>
        </div>
      )}

      {/* 🌟 MINIMALIST SHUHOOD SUB-NAVIGATION BAR */}
      {!isEventLeaderUser && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#ffffff', padding: '10px 14px', borderRadius: '12px', border: '1px solid #e2e8f0', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {[
              { id: 'cards', match: ['cards', 'mark_sheet'], label: `Subject Cards (${attendanceEnrollments.length})` },
              { id: 'reports_hub', match: ['reports_hub'], label: 'Monthly / Daily / Total Reports' },
              { id: 'minus_attendance', match: ['minus_attendance'], label: 'Minus Attendance' },
              { id: 'shortage', match: ['shortage'], label: `Shortage <85% (${shortageCount})` },
              ...(userRole === 'admin' ? [
                { id: 'clearance', match: ['clearance'], label: 'Clearance' },
                { id: 'manage_leaders', match: ['manage_leaders', 'rehearsal_leader'], label: `Event Leaders (${eventLeadersList.length})` },
                { id: 'non_mark_subjects', match: ['non_mark_subjects'], label: 'Non-Mark Subjects' },
                { id: 'import_old', match: ['import_old'], label: 'Import Shuhood' }
              ] : [])
            ].map(tab => {
              const isAct = tab.match.includes(activeTab);
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    padding: '8px 14px',
                    borderRadius: '8px',
                    fontWeight: '700',
                    fontSize: '13px',
                    border: isAct ? '1px solid #4f46e5' : '1px solid transparent',
                    cursor: 'pointer',
                    background: isAct ? '#4f46e5' : '#f8fafc',
                    color: isAct ? '#ffffff' : '#475569',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={handleDownloadAbsentReport}
            style={{ padding: '8px 14px', borderRadius: '8px', fontWeight: '700', fontSize: '12px', border: '1px solid #cbd5e1', cursor: 'pointer', background: '#ffffff', color: '#334155' }}
          >
            ⬇️ Export Absent CSV
          </button>
        </div>
      )}

      {statusMsg && (
        <div style={{ padding: '12px 16px', background: statusMsg.includes('✅') || statusMsg.includes('🎉') ? '#ecfdf5' : '#fff1f2', color: statusMsg.includes('✅') || statusMsg.includes('🎉') ? '#047857' : '#e11d48', borderRadius: '10px', fontWeight: '700', fontSize: '13px', border: `1px solid ${statusMsg.includes('✅') || statusMsg.includes('🎉') ? '#a7f3d0' : '#fecdd3'}` }}>
          {statusMsg}
        </div>
      )}

      {/* VIEW 1: SUBJECT ATTENDANCE CARDS */}
      {activeTab === 'cards' && !isEventLeaderUser && (
        <div>
          {userRole === 'admin' && (
            <div style={{ marginBottom: '18px', background: '#ffffff', padding: '14px 18px', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
              <label style={{ ...styles.label, margin: 0 }}>👨‍🏫 Inspect / Take Attendance for Teacher:</label>
              <select value={selectedTeacherUsername} onChange={e => setSelectedTeacherUsername(e.target.value)} style={{ ...styles.input, maxWidth: '340px' }}>
                {localTeachers.filter(t => !t.isEventLeader).map(t => (
                  <option key={t.username} value={t.username}>{t.fullName} (@{t.username})</option>
                ))}
              </select>
            </div>
          )}

          {attendanceEnrollments.length === 0 ? (
            <div style={{ background: '#ffffff', padding: '40px', borderRadius: '14px', border: '1px dashed #cbd5e1', textAlign: 'center', color: '#64748b', fontWeight: '600' }}>
              No period-attendance subjects assigned yet (Hifz is automatically excluded from period attendance).
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: '16px' }}>
              {attendanceEnrollments.map(env => {
                const enrolledList = getStudentsForEnrollment(env);
                const isNonMark = isAttendanceOnlyEnrollment(env);
                return (
                  <div
                    key={env.id}
                    style={{
                      background: '#ffffff',
                      padding: '20px',
                      borderRadius: '14px',
                      border: '1px solid #e2e8f0',
                      boxShadow: '0 1px 3px rgba(15, 23, 42, 0.03)',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      gap: '16px'
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                        <h3 style={{ margin: 0, fontSize: '17px', fontWeight: '800', color: '#0f172a', textTransform: 'uppercase' }}>
                          {env.alias || `${env.subject} ${env.targetClass || ''}`}
                        </h3>
                        {isNonMark && (
                          <span style={{ background: '#fef3c7', color: '#b45309', padding: '2px 8px', borderRadius: '6px', fontSize: '10px', fontWeight: '800' }}>
                            ATTENDANCE ONLY
                          </span>
                        )}
                      </div>
                      <div style={{ marginTop: '8px' }}>
                        <span style={{ background: '#f8fafc', color: '#475569', border: '1px solid #e2e8f0', padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: '700' }}>
                          Class: {env.targetClass || env.alias?.split(' ').pop() || `Grade ${env.grade || '-'}`}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '14px', color: '#475569', fontSize: '13px', fontWeight: '600' }}>
                        <span style={{ background: '#eef2ff', color: '#4f46e5', padding: '5px 8px', borderRadius: '8px', fontSize: '13px' }}>👥</span>
                        <span><strong>{enrolledList.length}</strong> Students Enrolled</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setAttEnrollmentId(env.id);
                        setAttSession(''); // Mandatory manual selection!
                        setExistingSessionDoc(null);
                        setActiveTab('mark_sheet');
                      }}
                      style={{ width: '100%', padding: '11px', background: '#4f46e5', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '700', fontSize: '13px', cursor: 'pointer' }}
                    >
                      Mark Attendance
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* VIEW 1B: 9-PERIOD ROLL-CALL SHEET */}
      {activeTab === 'mark_sheet' && !isEventLeaderUser && (
        <div style={styles.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '18px' }}>
            <button
              type="button"
              onClick={() => setActiveTab('cards')}
              style={styles.buttonSecondary}
            >
              ⬅ Back to Subject Cards
            </button>
            {existingSessionDoc && attSession && (
              <span style={{ background: '#fef3c7', color: '#92400e', padding: '4px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: '700', border: '1px solid #fde68a' }}>
                ✏️ Editing Saved Session ({attDate} • Period {attSession})
              </span>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '14px', marginBottom: '20px' }}>
            <div>
              <label style={styles.label}>Selected Subject Batch</label>
              <select value={attEnrollmentId} onChange={e => setAttEnrollmentId(e.target.value)} style={styles.input}>
                {attendanceEnrollments.map(env => (
                  <option key={env.id} value={env.id}>{env.alias || env.subject}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={styles.label}>Date</label>
              <input type="date" value={attDate} onChange={e => setAttDate(e.target.value)} style={styles.input} />
            </div>
            <div>
              <label style={{ ...styles.label, color: !attSession ? '#e11d48' : '#475569' }}>
                Period / Session (1 to 9) *Mandatory
              </label>
              <select
                value={attSession}
                onChange={e => setAttSession(e.target.value)}
                required
                style={{
                  ...styles.input,
                  border: !attSession ? '1.5px solid #e11d48' : '1.5px solid #10b981',
                  background: !attSession ? '#fff1f2' : '#ffffff',
                  fontWeight: '700'
                }}
              >
                <option value="">-- ⚠️ Select Period (1 to 9) --</option>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(s => (
                  <option key={s} value={String(s)}>Period {s}</option>
                ))}
              </select>
            </div>
          </div>

          {!attSession ? (
            <div style={{ padding: '32px 24px', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '12px', textAlign: 'center', color: '#475569', fontWeight: '700', fontSize: '14px' }}>
              👆 Please select a Period (Period 1 to Period 9) from the dropdown above to load the roll-call sheet.
            </div>
          ) : classStudents.length > 0 && (
            <form onSubmit={handleSaveAttendance}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '12px 16px', borderRadius: '10px', marginBottom: '14px', fontWeight: '700', fontSize: '13px', flexWrap: 'wrap', gap: '10px', border: '1px solid #e2e8f0' }}>
                <span style={{ color: '#0f172a' }}>Total: {classStudents.length}</span>
                <span style={{ color: '#047857' }}>Present: {classStudents.length - absentRegNos.length}</span>
                <span style={{ color: '#e11d48' }}>Absent: {absentRegNos.length}</span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button type="button" onClick={() => setAbsentRegNos([])} style={{ padding: '5px 10px', background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', borderRadius: '6px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}>All Present</button>
                  <button type="button" onClick={() => setAbsentRegNos(classStudents.map(s => s.regNo))} style={{ padding: '5px 10px', background: '#fff1f2', color: '#e11d48', border: '1px solid #fecdd3', borderRadius: '6px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}>All Absent</button>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(265px, 1fr))', gap: '10px', maxHeight: '480px', overflowY: 'auto', marginBottom: '20px' }}>
                {classStudents.map(st => {
                  const rehPresentHere = (rehearsalPresentMapForDate[String(attSession)] || []).includes(st.regNo);
                  const op = activeOutpassesByReg[st.regNo];
                  const isAutoOfficial = rehPresentHere || (op && op.isOfficial);
                  const isAbsent = !isAutoOfficial && absentRegNos.includes(st.regNo);

                  return (
                    <div
                      key={st.regNo}
                      onClick={() => { if (!isAutoOfficial) toggleAbsent(st.regNo); }}
                      style={{
                        padding: '12px 14px',
                        borderRadius: '10px',
                        cursor: isAutoOfficial ? 'default' : 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: '8px',
                        background: isAutoOfficial ? '#eef2ff' : isAbsent ? '#fff1f2' : '#ecfdf5',
                        border: `1.5px solid ${isAutoOfficial ? '#6366f1' : isAbsent ? '#f43f5e' : '#10b981'}`
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: '700', color: '#0f172a', fontSize: '14px' }}>
                          #{st.rollNo || '-'} • {st.firstName}
                        </div>
                        <div style={{ fontSize: '12px', color: '#475569', fontWeight: '600' }}>
                          Ad.No: #{st.adNo} • {(st.classes || []).join(', ')}
                        </div>
                        {rehPresentHere && (
                          <span style={{ display: 'inline-block', marginTop: '4px', background: '#e0e7ff', color: '#4338ca', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: '800' }}>
                            🎭 Rehearsal Present (Auto-Cleared)
                          </span>
                        )}
                        {op && (
                          <div style={{ marginTop: '6px', background: '#ffffff', color: '#334155', padding: '5px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: '600', lineHeight: 1.35, border: '1px solid #cbd5e1' }}>
                            <div>🪪 <strong>{op.category} Leave:</strong> {op.destination} {op.reason ? `(${op.reason})` : ''}</div>
                            <div style={{ fontSize: '10px', marginTop: '2px', color: '#64748b' }}>
                              By: {op.teacherName} • Return: {op.toFormatted}
                            </div>
                          </div>
                        )}
                      </div>
                      <span style={{ padding: '4px 10px', borderRadius: '6px', fontWeight: '800', fontSize: '11px', background: isAutoOfficial ? '#4f46e5' : isAbsent ? '#e11d48' : '#10b981', color: '#ffffff', whiteSpace: 'nowrap' }}>
                        {isAutoOfficial ? 'OFFICIAL' : isAbsent ? 'ABSENT' : 'PRESENT'}
                      </span>
                    </div>
                  );
                })}
              </div>

              {absentStudentsByClassGroups.length > 0 && (
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px', marginBottom: '18px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
                    <div style={{ fontWeight: '800', color: '#0f172a', fontSize: '13px' }}>
                      📲 Send / Copy Absent Students to Respective Class Teachers ({absentStudentsByClassGroups.length} Class{absentStudentsByClassGroups.length > 1 ? 'es' : ''})
                    </div>
                    {absentStudentsByClassGroups.length > 1 && (
                      <button type="button" onClick={handleCopyAllAbsentees} style={styles.buttonSecondary}>
                        📋 Copy All Classes Together
                      </button>
                    )}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px' }}>
                    {absentStudentsByClassGroups.map(grp => (
                      <div key={grp.className} style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px 14px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '10px' }}>
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                            <span style={{ background: '#fff1f2', color: '#e11d48', padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: '800' }}>
                              Class {grp.className} ({grp.students.length} Absent)
                            </span>
                            <span style={{ fontSize: '11px', fontWeight: '700', color: '#475569' }}>
                              CT: {grp.classTeacher?.fullName || 'Unassigned'}
                            </span>
                          </div>
                          <div style={{ fontSize: '12px', color: '#334155', fontWeight: '600', lineHeight: 1.5 }}>
                            {grp.students.map(s => `${s.firstName} (#${s.adNo})`).join(', ')}
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          <button type="button" onClick={() => handleCopyClassAbsentees(grp)} style={{ ...styles.buttonSecondary, flex: 1, padding: '7px 10px', fontSize: '12px' }}>
                            📋 Copy {grp.className}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const phone = grp.classTeacher?.whatsappNumber || grp.classTeacher?.mobileNumber;
                              if (!phone) return alert(`No WhatsApp number saved for Class ${grp.className} Teacher.`);
                              openDirectWhatsApp(phone, formatAbsentMessageForClass(grp));
                            }}
                            style={{ flex: 1, padding: '7px 10px', background: '#10b981', color: '#ffffff', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}
                          >
                            💬 WA {grp.classTeacher?.fullName ? grp.classTeacher.fullName.split(' ')[0] : 'CT'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button type="submit" disabled={loading} style={{ ...styles.buttonPrimary, width: '100%', padding: '14px', fontSize: '15px' }}>
                {loading ? 'Saving Attendance...' : `💾 ${existingSessionDoc ? 'Update' : 'Save'} Period ${attSession} Attendance`}
              </button>
            </form>
          )}
        </div>
      )}

      {/* VIEW 2: EVENT LEADER REHEARSAL ROLL-CALL */}
      {activeTab === 'rehearsal_leader' && (
        <div style={styles.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px', borderBottom: '1px solid #f1f5f9', paddingBottom: '14px' }}>
            <div>
              <span style={{ background: '#eef2ff', color: '#4f46e5', padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: '800', textTransform: 'uppercase' }}>
                🎭 Special Event / Arts Fest Rehearsal Attendance
              </span>
              <h3 style={{ margin: '6px 0 0 0', fontSize: '19px', color: '#0f172a', fontWeight: '800' }}>
                {activeLeaderObj?.fullName || 'Event Leader Roll-Call'} ({leaderStudentsSorted.length} Active Students for {rehDate})
              </h3>
            </div>
            {userRole === 'admin' && (
              <button type="button" onClick={() => setActiveTab('manage_leaders')} style={styles.buttonSecondary}>
                ⚙️ Manage Leader Accounts &amp; Deadlines
              </button>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px', marginBottom: '20px' }}>
            {userRole === 'admin' && eventLeadersList.length > 0 && (
              <div>
                <label style={styles.label}>Select Event Leader Account</label>
                <select value={rehSelectedLeaderUsername} onChange={e => setRehSelectedLeaderUsername(e.target.value)} style={styles.input}>
                  {eventLeadersList.map(l => (
                    <option key={l.username} value={l.username}>{l.fullName} (@{l.username})</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label style={styles.label}>Rehearsal Date</label>
              <input type="date" value={rehDate} onChange={e => setRehDate(e.target.value)} style={styles.input} />
            </div>
            <div>
              <label style={styles.label}>Select Rehearsal Sitting</label>
              <select value={rehSessionId} onChange={e => setRehSessionId(e.target.value)} style={styles.input}>
                {REHEARSAL_SESSIONS.map(s => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>

          {leaderStudentsSorted.length === 0 ? (
            <div style={{ padding: '32px', background: '#f8fafc', borderRadius: '12px', textAlign: 'center', color: '#64748b', fontWeight: '600' }}>
              No active students found for {rehDate}.
            </div>
          ) : (
            <form onSubmit={handleSaveRehearsalAttendance}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '10px', maxHeight: '460px', overflowY: 'auto', marginBottom: '20px' }}>
                {leaderStudentsSorted.map((st, idx) => {
                  const isAbsent = rehAbsentRegNos.includes(st.regNo);
                  const dl = leaderStudentDeadlinesMap[st.regNo] || '';
                  return (
                    <div
                      key={st.regNo}
                      onClick={() => setRehAbsentRegNos(prev => prev.includes(st.regNo) ? prev.filter(r => r !== st.regNo) : [...prev, st.regNo])}
                      style={{
                        padding: '12px 14px',
                        borderRadius: '10px',
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        background: isAbsent ? '#fff1f2' : '#ecfdf5',
                        border: `1.5px solid ${isAbsent ? '#f43f5e' : '#10b981'}`
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          <span style={{ background: '#4f46e5', color: '#ffffff', padding: '2px 7px', borderRadius: '4px', fontSize: '10px', fontWeight: '800' }}>
                            {(st.classes || []).join(', ') || st.class}
                          </span>
                          <span style={{ fontWeight: '700', color: '#0f172a', fontSize: '14px' }}>{st.firstName}</span>
                        </div>
                        <div style={{ fontSize: '11px', color: '#475569', fontWeight: '600', marginTop: '4px' }}>
                          Ad.No: #{st.adNo} • Sn: {idx + 1} {dl ? `• Until ${dl}` : ''}
                        </div>
                      </div>
                      <span style={{ padding: '4px 10px', borderRadius: '6px', fontWeight: '800', fontSize: '11px', background: isAbsent ? '#e11d48' : '#10b981', color: '#ffffff' }}>
                        {isAbsent ? 'ABSENT' : 'PRESENT'}
                      </span>
                    </div>
                  );
                })}
              </div>

              <button type="submit" disabled={loading} style={{ ...styles.buttonPrimary, width: '100%', padding: '14px', fontSize: '15px' }}>
                {loading ? 'Submitting Rehearsal Attendance...' : `💾 ${existingRehDoc ? 'Update' : 'Submit'} Rehearsal Attendance (${rehSessionId})`}
              </button>
            </form>
          )}
        </div>
      )}

      {/* VIEW 2B: ADMIN EVENT LEADER MANAGER WITH SLIDING DRAWER */}
      {activeTab === 'manage_leaders' && userRole === 'admin' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <CollapsibleCard
            title="1. Create Temporary Student Leader / Event Attendance Account"
            subtitle="Create temporary leader logins; revoking them later keeps all recorded attendance 100% permanent"
            badgeText={`${eventLeadersList.length} Leaders`}
            icon="🎭"
            accentColor="#4f46e5"
            defaultOpen={eventLeadersList.length === 0}
          >
            <form onSubmit={handleCreateEventLeaderAccount} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', alignItems: 'end', marginBottom: '20px' }}>
              <div>
                <label style={styles.label}>Leader Name</label>
                <input type="text" value={newLeaderName} onChange={e => setNewLeaderName(e.target.value)} placeholder="e.g. Sinan QLA3" required style={styles.input} />
              </div>
              <div>
                <label style={styles.label}>Event / Team Name</label>
                <input type="text" value={newLeaderEventTitle} onChange={e => setNewLeaderEventTitle(e.target.value)} placeholder="e.g. Arts Fest Zone A" required style={styles.input} />
              </div>
              <div>
                <label style={styles.label}>Login Username</label>
                <input type="text" value={newLeaderUsername} onChange={e => setNewLeaderUsername(e.target.value)} placeholder="e.g. leader_zone1" required style={styles.input} />
              </div>
              <div>
                <label style={styles.label}>Password (Min 6 chars)</label>
                <input type="text" value={newLeaderPassword} onChange={e => setNewLeaderPassword(e.target.value)} placeholder="e.g. fest123" required style={styles.input} />
              </div>
              <button type="submit" disabled={loading} style={styles.buttonPrimary}>
                ➕ Create Leader Login
              </button>
            </form>

            {eventLeadersList.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px' }}>
                {eventLeadersList.map(l => {
                  const sIds = l.enrollments?.[0]?.studentIds || l.assignedStudentIds || [];
                  return (
                    <div key={l.username} style={{ padding: '14px 16px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                      <div>
                        <div style={{ fontWeight: '800', color: '#0f172a', fontSize: '14px' }}>🎭 {l.fullName}</div>
                        <div style={{ fontSize: '12px', color: '#475569', fontWeight: '600', marginTop: '2px' }}>
                          Login: <code>@{l.username}</code> • <strong>{sIds.length} Students Mapped</strong>
                        </div>
                      </div>
                      <button type="button" onClick={() => handleDeleteEventLeaderAccount(l)} style={styles.buttonDanger}>
                        🗑️ Revoke
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </CollapsibleCard>

          <div style={styles.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
              <h3 style={{ margin: 0, fontSize: '17px', color: '#0f172a', fontWeight: '800' }}>
                2. Map Students &amp; Set Rehearsal Deadline Date
              </h3>
              {eventLeadersList.length > 0 && (
                <button type="button" onClick={() => setActiveTab('rehearsal_leader')} style={styles.buttonPrimary}>
                  📋 Open Rehearsal Roll-Call Screen ➔
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '16px', background: '#f8fafc', padding: '14px', borderRadius: '12px', border: '1px solid #e2e8f0', alignItems: 'center' }}>
              <div style={{ flex: '1 1 280px', display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  value={bulkAdNoPasteText}
                  onChange={e => setBulkAdNoPasteText(e.target.value)}
                  placeholder="Paste Ad.Nos separated by comma (e.g. 3538, U1127)..."
                  style={styles.input}
                />
                <button
                  type="button"
                  onClick={() => {
                    const tokens = bulkAdNoPasteText.split(/[\s,;\n]+/).map(t => t.replace(/^#/, '').trim().toUpperCase()).filter(Boolean);
                    if (tokens.length === 0) return alert('Paste at least one Admission Number first.');
                    const matchedRegs = localStudents
                      .filter(s => tokens.includes(String(s.adNo || '').trim().toUpperCase()) || tokens.includes(String(s.regNo || '').trim().toUpperCase()))
                      .map(s => s.regNo);
                    if (matchedRegs.length === 0) return alert('No matching students found.');
                    setLeaderSelectedRegs(prev => Array.from(new Set([...prev, ...matchedRegs])));
                    setBulkAdNoPasteText('');
                  }}
                  style={{ ...styles.buttonSecondary, whiteSpace: 'nowrap' }}
                >
                  ☑️ Auto-Check
                </button>
              </div>

              <select value={assignLeaderUsername} onChange={e => setAssignLeaderUsername(e.target.value)} style={{ ...styles.input, maxWidth: '240px' }}>
                <option value="">-- Select Event Leader --</option>
                {eventLeadersList.map(l => (
                  <option key={l.username} value={l.username}>{l.fullName} (@{l.username})</option>
                ))}
              </select>

              <input type="date" value={leaderAssignDeadline} onChange={e => setLeaderAssignDeadline(e.target.value)} style={{ ...styles.input, maxWidth: '160px' }} />

              <button type="button" onClick={handleAssignStudentsToLeader} disabled={loading} style={styles.buttonPrimary}>
                🚀 Assign {leaderSelectedRegs.length} Checked
              </button>
            </div>

            {assignLeaderUsername && (
              <div style={{ marginBottom: '16px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {sortStudentsForEventLeader(
                  localStudents.filter(s => (localTeachers.find(t => t.username === assignLeaderUsername)?.enrollments?.[0]?.studentIds || []).includes(s.regNo))
                ).map(st => {
                  const dlMap = localTeachers.find(t => t.username === assignLeaderUsername)?.enrollments?.[0]?.studentDeadlines || {};
                  return (
                    <span key={st.regNo} style={{ background: '#eef2ff', color: '#4f46e5', padding: '4px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: '700', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      [{(st.classes || []).join(',')}] {st.firstName} (#{st.adNo}) • Until: {dlMap[st.regNo] || 'Open'}
                      <button type="button" onClick={() => handleRemoveStudentFromLeader(assignLeaderUsername, st.regNo)} style={{ border: 'none', background: 'transparent', color: '#e11d48', cursor: 'pointer', fontWeight: '800' }}>✕</button>
                    </span>
                  );
                })}
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
              <input type="text" value={leaderStudentSearch} onChange={e => setLeaderStudentSearch(e.target.value)} placeholder="Search student name or Ad.No..." style={{ ...styles.input, maxWidth: '260px' }} />
              <select value={leaderFilterClass} onChange={e => setLeaderFilterClass(e.target.value)} style={{ ...styles.input, maxWidth: '180px' }}>
                <option value="All">All Classes</option>
                {LEADER_CLASS_ORDER.map(c => <option key={c} value={c}>Class {c}</option>)}
              </select>
            </div>

            <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                <thead style={{ position: 'sticky', top: 0, background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  <tr>
                    <th style={{ padding: '10px 14px', width: '40px' }}>✓</th>
                    <th style={{ padding: '10px 14px' }}>CLASS</th>
                    <th style={{ padding: '10px 14px' }}>AD.NO</th>
                    <th style={{ padding: '10px 14px' }}>STUDENT NAME</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLeaderAssignStudents.map((st) => {
                    const checked = leaderSelectedRegs.includes(st.regNo);
                    return (
                      <tr
                        key={st.regNo}
                        onClick={() => setLeaderSelectedRegs(prev => prev.includes(st.regNo) ? prev.filter(r => r !== st.regNo) : [...prev, st.regNo])}
                        style={{ borderBottom: '1px solid #f1f5f9', background: checked ? '#eef2ff' : '#ffffff', cursor: 'pointer' }}
                      >
                        <td style={{ padding: '10px 14px' }}><input type="checkbox" checked={checked} readOnly /></td>
                        <td style={{ padding: '10px 14px', fontWeight: '700', color: '#4f46e5' }}>{(st.classes || []).join(', ')}</td>
                        <td style={{ padding: '10px 14px', fontWeight: '600' }}>#{st.adNo}</td>
                        <td style={{ padding: '10px 14px', fontWeight: '700' }}>{st.firstName}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 4: ADMIN NON-MARK SUBJECT CREATOR WITH SLIDING DRAWER */}
      {activeTab === 'non_mark_subjects' && userRole === 'admin' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <CollapsibleCard
            title="1. Add Non-Mark Subject (Attendance-Only Period like Speech Practice, PKV)"
            subtitle="Click to create a new attendance-only period subject under any teacher"
            icon="➕"
            accentColor="#4f46e5"
            defaultOpen={true}
          >
            <form onSubmit={handleCreateNonMarkSubject} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', alignItems: 'end' }}>
              <div>
                <label style={styles.label}>Select Teacher</label>
                <select value={nmTeacherUsername} onChange={e => setNmTeacherUsername(e.target.value)} style={styles.input}>
                  {localTeachers.filter(t => !t.isEventLeader).map(t => <option key={t.username} value={t.username}>{t.fullName}</option>)}
                </select>
              </div>
              <div>
                <label style={styles.label}>Period / Subject Name</label>
                <input type="text" value={nmSubjectName} onChange={e => setNmSubjectName(e.target.value)} placeholder="e.g. Speech Practice, PKV..." required style={styles.input} />
              </div>
              <div>
                <label style={styles.label}>Target Class</label>
                <select value={nmTargetClass} onChange={e => setNmTargetClass(e.target.value)} style={styles.input}>
                  <option value="CUSTOM">Custom Selected Students Only</option>
                  {DEFAULT_CLASSES.map(c => <option key={c} value={c}>Entire Class {c}</option>)}
                </select>
              </div>
              <div>
                <label style={styles.label}>Card Title (Optional)</label>
                <input type="text" value={nmAlias} onChange={e => setNmAlias(e.target.value)} placeholder="e.g. PKV QLA3" style={styles.input} />
              </div>
              <button type="submit" disabled={loading} style={styles.buttonPrimary}>
                ➕ Create Subject
              </button>
            </form>
          </CollapsibleCard>

          <div style={styles.card}>
            <h3 style={{ margin: '0 0 14px 0', fontSize: '17px', color: '#0f172a', fontWeight: '800' }}>
              2. Mass Assign Students to Any Period Attendance Subject
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', marginBottom: '16px', background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', alignItems: 'end' }}>
              <div>
                <label style={styles.label}>1. Select Teacher</label>
                <select
                  value={nmTeacherUsername}
                  onChange={e => {
                    setNmTeacherUsername(e.target.value);
                    const t = localTeachers.find(x => x.username === e.target.value);
                    const firstEnv = (t?.enrollments || []).find(ev => !isHifzEnrollment(ev));
                    setNmSelectedEnrollmentId(firstEnv?.id || '');
                  }}
                  style={styles.input}
                >
                  {localTeachers.filter(t => !t.isEventLeader).map(t => <option key={t.username} value={t.username}>{t.fullName}</option>)}
                </select>
              </div>
              <div>
                <label style={styles.label}>2. Select Teacher's Period Slot</label>
                <select value={nmSelectedEnrollmentId} onChange={e => setNmSelectedEnrollmentId(e.target.value)} style={styles.input}>
                  <option value="">-- Select Slot --</option>
                  {(localTeachers.find(t => t.username === nmTeacherUsername)?.enrollments || [])
                    .filter(ev => !isHifzEnrollment(ev))
                    .map(ev => (
                      <option key={ev.id} value={ev.id}>
                        {ev.alias || ev.subject} ({(ev.studentIds || []).length} manual IDs)
                      </option>
                    ))}
                </select>
              </div>
              <button type="button" onClick={handleMassAssignToNonMarkSubject} disabled={loading} style={styles.buttonPrimary}>
                🚀 Assign {nmSelectedStudentRegs.length} Selected
              </button>
            </div>

            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '14px' }}>
              <input type="text" value={nmStudentSearch} onChange={e => setNmStudentSearch(e.target.value)} placeholder="Search student name or Ad.No..." style={{ ...styles.input, maxWidth: '260px' }} />
              <select value={nmClassFilter} onChange={e => setNmClassFilter(e.target.value)} style={{ ...styles.input, maxWidth: '170px' }}>
                <option value="All">All Classes</option>
                {DEFAULT_CLASSES.map(c => <option key={c} value={c}>Class {c}</option>)}
              </select>
            </div>

            <div style={{ maxHeight: '320px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                <thead style={{ position: 'sticky', top: 0, background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  <tr>
                    <th style={{ padding: '10px 14px', width: '40px' }}>✓</th>
                    <th style={{ padding: '10px 14px' }}>AD.NO</th>
                    <th style={{ padding: '10px 14px' }}>STUDENT NAME</th>
                    <th style={{ padding: '10px 14px' }}>CLASS &amp; DEPT</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredNmStudents.map((st) => {
                    const checked = nmSelectedStudentRegs.includes(st.regNo);
                    return (
                      <tr
                        key={st.regNo}
                        onClick={() => setNmSelectedStudentRegs(prev => prev.includes(st.regNo) ? prev.filter(r => r !== st.regNo) : [...prev, st.regNo])}
                        style={{ borderBottom: '1px solid #f1f5f9', background: checked ? '#eef2ff' : '#ffffff', cursor: 'pointer' }}
                      >
                        <td style={{ padding: '10px 14px' }}><input type="checkbox" checked={checked} readOnly /></td>
                        <td style={{ padding: '10px 14px', fontWeight: '600' }}>#{st.adNo}</td>
                        <td style={{ padding: '10px 14px', fontWeight: '700' }}>{st.firstName}</td>
                        <td style={{ padding: '10px 14px' }}>{(st.classes || []).join(', ')} ({st.department || 'GENERAL'})</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* DELEGATE REPORTS HUB TO MODULAR COMPONENT */}
      {activeTab === 'reports_hub' && !isEventLeaderUser && (
        <PeriodAttendanceReportsHub
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          userRole={userRole}
          loggedInUser={loggedInUser}
          activeTeacherObj={activeTeacherObj}
          localStudents={localStudents}
          localTeachers={localTeachers}
          attendanceEnrollments={attendanceEnrollments}
          getStudentsForEnrollment={getStudentsForEnrollment}
          getStudentAttStat={getStudentAttStat}
          normalizeSubKey={normalizeSubKey}
          isAttendanceOnlyEnrollment={isAttendanceOnlyEnrollment}
          isHifzEnrollment={isHifzEnrollment}
          setSelectedTeacherUsername={setSelectedTeacherUsername}
          setAttEnrollmentId={setAttEnrollmentId}
          setAttDate={setAttDate}
          setAttSession={setAttSession}
          loading={loading}
          setLoading={setLoading}
          setStatusMsg={setStatusMsg}
        />
      )}

      {/* DELEGATE MINUS ATTENDANCE, CLEARANCE, SHORTAGE & SHUHOOD IMPORT TO MODULAR COMPONENT */}
      {['minus_attendance', 'clearance', 'shortage', 'import_old'].includes(activeTab) && !isEventLeaderUser && (
        <PeriodAttendanceMinusAndClearance
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          userRole={userRole}
          loggedInUser={loggedInUser}
          activeTeacherObj={activeTeacherObj}
          localStudents={localStudents}
          localTeachers={localTeachers}
          attendanceEnrollments={attendanceEnrollments}
          getStudentsForEnrollment={getStudentsForEnrollment}
          getStudentAttStat={getStudentAttStat}
          syncUpdatedStudentsState={syncUpdatedStudentsState}
          normalizeSubKey={normalizeSubKey}
          isAttendanceOnlyEnrollment={isAttendanceOnlyEnrollment}
          isHifzEnrollment={isHifzEnrollment}
          setSelectedTeacherUsername={setSelectedTeacherUsername}
          setAttEnrollmentId={setAttEnrollmentId}
          setAttDate={setAttDate}
          setAttSession={setAttSession}
          setClearancePrintStudent={setClearancePrintStudent}
          loading={loading}
          setLoading={setLoading}
          setStatusMsg={setStatusMsg}
        />
      )}
    </div>
  );
}