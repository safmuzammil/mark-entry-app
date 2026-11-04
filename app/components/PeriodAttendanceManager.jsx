'use client';
import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { auth, db } from '../../lib/firebase';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc, getDocs, setDoc, deleteDoc, collection, writeBatch } from 'firebase/firestore';
import { DEFAULT_CLASSES, DEFAULT_SUBJECTS, DHIU_LOGO_URL, styles, sortStudentsByDepartment } from './erpConstants';
import { doesClassMatchAlias, openDirectWhatsApp, resolveClassTeacherForStudent } from './ErpExtensions';

// Helper: Hifz is excluded from Period Attendance roll-call
export const isHifzEnrollment = (env) => {
  const subUp = String(env?.subject || '').trim().toUpperCase();
  const aliasUp = String(env?.alias || '').trim().toUpperCase();
  return subUp === 'HIFZ' || aliasUp.includes('HIFZ');
};

// Helper: Identifies Non-Mark (Attendance-Only) subjects like Speech Practice, PKV, Economics, etc.
export const isAttendanceOnlyEnrollment = (env) => {
  if (!env) return false;
  if (env.isAttendanceOnly === true || env.onlyAttendance === true || env.nonMarkSubject === true) return true;
  const subUp = String(env.subject || '').trim().toUpperCase();
  const normDefault = DEFAULT_SUBJECTS.map(s => s.toUpperCase());
  if (subUp === 'MANTIQ' || subUp.includes('U :FIQH') || subUp.includes('U:FIQH')) return false;
  return subUp !== '' && !normDefault.includes(subUp);
};

// 🌟 Seniority Class Order for Event / Arts Fest Student Leader Roll-Call (QLA3 -> AL1)
const LEADER_CLASS_ORDER = ['QLA3', 'HFC3', 'FC2', 'AL2', 'ALC2', 'QH2', 'FC1', 'QH1', 'AL1', 'ALC1'];

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

// 🌟 Rehearsal Session Definitions (Maps to the 9-Period Day)
export const REHEARSAL_SESSIONS = [
  {
    id: 'FN1',
    label: 'Forenoon Session 1 (Clears 2 Regular Periods • Periods 3 & 4)',
    coveredPeriods: [3, 4],
    weight: 2
  },
  {
    id: 'FN2',
    label: 'Forenoon Session 2 (Clears 2 Regular Periods • Periods 5 & 6)',
    coveredPeriods: [5, 6],
    weight: 2
  },
  {
    id: 'AN1',
    label: 'Afternoon Session 3 (Clears 3 Regular Periods • Periods 7, 8 & 9)',
    coveredPeriods: [7, 8, 9],
    weight: 3
  }
];

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

  // Views: 'cards' | 'mark_sheet' | 'rehearsal_leader' | 'manage_leaders' | 'minus_attendance' | 'non_mark_subjects' | 'clearance' | 'shortage' | 'import_old'
  const [activeTab, setActiveTab] = useState(isEventLeaderUser ? 'rehearsal_leader' : 'cards');
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  useEffect(() => {
    if (isEventLeaderUser) setActiveTab('rehearsal_leader');
  }, [isEventLeaderUser]);

  // --- LIVE OUT-PASSES MAP FOR SELECTED DATE ---
  const [activeOutpassesByReg, setActiveOutpassesByReg] = useState({});

  // --- 1. SHUHOOD-STYLE CARDS & ROLL CALL STATE (9 Periods) ---
  const [selectedTeacherUsername, setSelectedTeacherUsername] = useState(loggedInUser?.username || '');
  const [attDate, setAttDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [attSession, setAttSession] = useState('1');
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

  // --- 4. MINUS ATTENDANCE STATE ---
  const [minusSearchQuery, setMinusSearchQuery] = useState('');
  const [selectedMinusStudent, setSelectedMinusStudent] = useState(null);
  const [minusCount, setMinusCount] = useState(1);
  const [minusReason, setMinusReason] = useState('');

  // --- 5. NON-MARK SUBJECT CREATOR & MASS ASSIGN STATE ---
  const [nmTeacherUsername, setNmTeacherUsername] = useState('');
  const [nmSubjectName, setNmSubjectName] = useState('');
  const [nmTargetClass, setNmTargetClass] = useState('QLA3');
  const [nmAlias, setNmAlias] = useState('');
  const [nmSelectedEnrollmentId, setNmSelectedEnrollmentId] = useState('');
  const [nmClassFilter, setNmClassFilter] = useState('All');
  const [nmStreamFilter, setNmStreamFilter] = useState('All');
  const [nmStudentSearch, setNmStudentSearch] = useState('');
  const [nmSelectedStudentRegs, setNmSelectedStudentRegs] = useState([]);

  // --- 6. CLEARANCE DESK & SHORTAGE STATE ---
  const [clearAdNo, setClearAdNo] = useState('');
  const [clearReason, setClearReason] = useState('official');
  const [clearDateMode, setClearDateMode] = useState('single');
  const [clearDate, setClearDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [clearStartDate, setClearStartDate] = useState('');
  const [clearEndDate, setClearEndDate] = useState('');
  const [clearSelectedSubjects, setClearSelectedSubjects] = useState([]);
  const [shortageClassFilter, setShortageClassFilter] = useState('ALL');
  const [clearancePrintStudent, setClearancePrintStudent] = useState(null);

  const normalizeSubKey = (sub) => {
    const up = String(sub || '').trim().toUpperCase().replace(/\./g, '');
    if (up.includes('U :FIQH') || up.includes('U:FIQH') || up.includes('USUL')) return 'U :FIQH';
    if (up === 'MANTIQ') return 'LOGIC';
    return up;
  };

  // Load active outpasses & rehearsal stamps for attDate
  useEffect(() => {
    async function loadOutpassesAndRehearsalStamps() {
      try {
        const [opSnap, rehSnap] = await Promise.all([
          getDocs(collection(db, 'outpasses')),
          getDoc(doc(db, 'systemCache', `rehearsalStamp_${attDate}`))
        ]);

        const opMap = {};
        opSnap.forEach(d => {
          const data = d.data();
          const status = String(data.status || '').toLowerCase();
          if (status !== 'approved' && status !== 'out') return;

          const depDate = String(data.departureDate || data.date || '').split('T')[0];
          const retDate = String(data.returnDate || data.departureDate || data.date || '').split('T')[0];
          if (depDate && attDate >= depDate && (!retDate || attDate <= retDate)) {
            const sReg = String(data.studentRegNo || data.regNo || '').trim();
            if (sReg) {
              const cat = String(data.category || data.leaveType || 'General').toLowerCase();
              const isOfficial = cat.includes('official') || cat.includes('outreach');
              opMap[sReg] = {
                category: data.category || 'Leave',
                isOfficial,
                reason: data.reason || data.destination || ''
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
      } catch (e) {}
    }
    loadOutpassesAndRehearsalStamps();
  }, [attDate]);

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

  // Check if regular session was already recorded
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

  // 🌟 Group current absentees by Class & find each class's Class Teacher for 1-Click Copy / WhatsApp
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
        groups[clsName] = {
          className: clsName,
          classTeacher: ctObj,
          students: []
        };
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
    const text = formatAbsentMessageForClass(group);
    navigator.clipboard.writeText(text).then(() => {
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
  // 1. SAVE REGULAR PERIOD ATTENDANCE
  // ==========================================
  const handleSaveAttendance = async (e) => {
    e.preventDefault();
    if (!attEnrollmentId || classStudents.length === 0) return alert('Please select a subject with enrolled students.');

    setLoading(true);
    setStatusMsg('');
    try {
      const env = attendanceEnrollments.find(e => e.id === attEnrollmentId);
      const sessionDocId = `periodSession_${attDate}_${String(env.alias || env.subject).replace(/[^a-zA-Z0-9]/g, '_')}_S${attSession}`;
      const subKey = normalizeSubKey(isAttendanceOnlyEnrollment(env) ? (env.alias || env.subject) : env.subject);

      const rehPresentList = rehearsalPresentMapForDate[String(attSession)] || [];
      const previousMap = existingSessionDoc?.attendanceMap || null;
      const newAttendanceMap = {};

      classStudents.forEach(st => {
        const isRehearsalPresent = rehPresentList.includes(st.regNo);
        const op = activeOutpassesByReg[st.regNo];
        if (isRehearsalPresent || (op && op.isOfficial)) {
          newAttendanceMap[st.regNo] = 'O';
        } else if (absentRegNos.includes(st.regNo)) {
          newAttendanceMap[st.regNo] = op ? 'M' : 'A';
        } else {
          newAttendanceMap[st.regNo] = 'P';
        }
      });

      const batch = writeBatch(db);
      const sessionRef = doc(db, 'systemCache', sessionDocId);
      batch.set(sessionRef, {
        date: attDate,
        session: Number(attSession),
        subject: subKey,
        classAlias: env.alias || env.subject,
        isAttendanceOnly: Boolean(isAttendanceOnlyEnrollment(env)),
        teacherUsername: activeTeacherObj?.username || 'admin',
        teacherName: activeTeacherObj?.fullName || 'Admin',
        attendanceMap: newAttendanceMap,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      const dayIndexRef = doc(db, 'systemCache', `daySessionsIndex_${attDate}`);
      const dayIndexSnap = await getDoc(dayIndexRef);
      const existingSessionsList = dayIndexSnap.exists() ? (dayIndexSnap.data().sessions || []) : [];
      const updatedSessionsList = [
        ...existingSessionsList.filter(x => x.sessionDocId !== sessionDocId),
        { sessionDocId, session: Number(attSession), subject: subKey }
      ];
      batch.set(dayIndexRef, { date: attDate, sessions: updatedSessionsList }, { merge: true });

      const updatedStudentsByReg = {};

      for (const st of classStudents) {
        const reg = st.regNo;
        const docId = String(st.id || st.regNo).toLowerCase().trim();
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
            teacherName: activeTeacherObj?.fullName || '',
            isAttendanceOnly: Boolean(isAttendanceOnlyEnrollment(env))
          };
        }
        const subObj = curStat.subjectWise[subKey];
        subObj.teacherName = activeTeacherObj?.fullName || subObj.teacherName || '';
        subObj.isAttendanceOnly = Boolean(isAttendanceOnlyEnrollment(env));
        if (!Array.isArray(subObj.absentDates)) subObj.absentDates = [];

        const newStatus = newAttendanceMap[reg];
        const isNewPresent = newStatus === 'P' || newStatus === 'O';
        const oldStatus = previousMap ? previousMap[reg] : null;
        const wasOldPresent = oldStatus === 'P' || oldStatus === 'O';

        if (!oldStatus) {
          curStat.totalPeriods = (curStat.totalPeriods || 0) + 1;
          subObj.total = (subObj.total || 0) + 1;
          if (isNewPresent) {
            curStat.presentCount = (curStat.presentCount || 0) + 1;
            subObj.present = (subObj.present || 0) + 1;
            if (newStatus === 'O') {
              curStat.officialCount = (curStat.officialCount || 0) + 1;
              subObj.official = (subObj.official || 0) + 1;
            }
          } else {
            if (!subObj.absentDates.includes(attDate)) subObj.absentDates.push(attDate);
            if (newStatus === 'M') {
              curStat.medicalCount = (curStat.medicalCount || 0) + 1;
              subObj.medical = (subObj.medical || 0) + 1;
            }
          }
        } else if (wasOldPresent !== isNewPresent) {
          if (!wasOldPresent && isNewPresent) {
            curStat.presentCount = (curStat.presentCount || 0) + 1;
            subObj.present = (subObj.present || 0) + 1;
            subObj.absentDates = subObj.absentDates.filter(d => d !== attDate);
          } else if (wasOldPresent && !isNewPresent) {
            curStat.presentCount = Math.max(0, (curStat.presentCount || 0) - 1);
            subObj.present = Math.max(0, (subObj.present || 0) - 1);
            if (!subObj.absentDates.includes(attDate)) subObj.absentDates.push(attDate);
          }
        }

        curStat.updatedAt = new Date().toISOString();
        batch.set(stRef, { periodAttendance: curStat }, { merge: true });
        updatedStudentsByReg[reg] = { ...st, periodAttendance: curStat };
      }

      await batch.commit();
      syncUpdatedStudentsState(updatedStudentsByReg);
      setExistingSessionDoc({ attendanceMap: newAttendanceMap });
      const presentTotal = Object.values(newAttendanceMap).filter(v => v === 'P' || v === 'O').length;
      setStatusMsg(`✅ Period ${attSession} Attendance (${env.alias}) Saved! (${presentTotal} Present, ${classStudents.length - presentTotal} Absent)`);
    } catch (error) {
      setStatusMsg('❌ Error saving attendance: ' + error.message);
    } finally {
      setLoading(false);
      setTimeout(() => setStatusMsg(''), 5000);
    }
  };

  // ==========================================
  // 2. EVENT / ARTS FEST STUDENT LEADER REHEARSAL ATTENDANCE + DEADLINE FILTER
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

  // 🌟 Automatically hides students whose Rehearsal Deadline (e.g. Nov 10 or Nov 15) has passed!
  const leaderStudentsSorted = React.useMemo(() => {
    const savedUpper = leaderAssignedStudentIds.map(id => String(id).trim().toUpperCase());
    const matched = localStudents.filter(st => {
      const isAssigned =
        savedUpper.includes(String(st.regNo || '').trim().toUpperCase()) ||
        savedUpper.includes(String(st.adNo || '').trim().toUpperCase());
      if (!isAssigned) return false;

      const deadline = leaderStudentDeadlinesMap[st.regNo] || st.rehearsalDeadline || '';
      if (deadline && rehDate > deadline) {
        return false; // Student's rehearsal deadline has passed -> Do not show on Leader's roll-call!
      }
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
    const presentRegs = leaderStudentsSorted
      .filter(st => !rehAbsentRegNos.includes(st.regNo))
      .map(st => st.regNo);

    setLoading(true);
    setStatusMsg('');
    try {
      const batch = writeBatch(db);

      // 1. Save Leader's Rehearsal Session Doc
      const rehDocId = `rehearsalSession_${rehDate}_${activeLeaderObj.username}_${rehSessionId}`;
      batch.set(doc(db, 'systemCache', rehDocId), {
        date: rehDate,
        sessionId: rehSessionId,
        sessionLabel: sessionConfig.label,
        coveredPeriods,
        weight: sessionConfig.weight,
        leaderUsername: activeLeaderObj.username,
        leaderName: activeLeaderObj.fullName,
        presentRegNos: presentRegs,
        absentRegNos: rehAbsentRegNos,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      // 2. Save Rehearsal Stamp for coveredPeriods
      const stampRef = doc(db, 'systemCache', `rehearsalStamp_${rehDate}`);
      const stampSnap = await getDoc(stampRef);
      const existingPeriodPresent = stampSnap.exists() ? (stampSnap.data().periodPresentRegs || {}) : {};
      coveredPeriods.forEach(pNum => {
        const prevList = Array.isArray(existingPeriodPresent[String(pNum)]) ? existingPeriodPresent[String(pNum)] : [];
        const filteredPrev = prevList.filter(r => !rehAbsentRegNos.includes(r));
        existingPeriodPresent[String(pNum)] = Array.from(new Set([...filteredPrev, ...presentRegs]));
      });
      batch.set(stampRef, { date: rehDate, periodPresentRegs: existingPeriodPresent, updatedAt: new Date().toISOString() }, { merge: true });

      // 3. Check if any Regular Teachers in the New App already recorded attendance for coveredPeriods on rehDate
      const dayIndexSnap = await getDoc(doc(db, 'systemCache', `daySessionsIndex_${rehDate}`));
      const recordedSessionsOnDate = dayIndexSnap.exists() ? (dayIndexSnap.data().sessions || []) : [];
      const matchingRegularSessions = recordedSessionsOnDate.filter(s => coveredPeriods.includes(Number(s.session)));

      const updatedStudentsByReg = {};
      let autoClearedPeriodCount = 0;

      for (const regSess of matchingRegularSessions) {
        const sSnap = await getDoc(doc(db, 'systemCache', regSess.sessionDocId));
        if (!sSnap.exists()) continue;
        const sData = sSnap.data();
        const attMap = { ...(sData.attendanceMap || {}) };
        const subKey = sData.subject;
        let sessionModified = false;

        for (const st of leaderStudentsSorted) {
          const reg = st.regNo;
          const isPresentInRehearsal = presentRegs.includes(reg);
          const currentRegularStatus = attMap[reg];
          if (currentRegularStatus === undefined) continue;

          const baseStudent = updatedStudentsByReg[reg] || st;
          const curStat = JSON.parse(JSON.stringify(getStudentAttStat(baseStudent)));
          const subObj = curStat.subjectWise?.[subKey];

          if (isPresentInRehearsal && currentRegularStatus === 'A' && subObj) {
            attMap[reg] = 'O';
            sessionModified = true;
            curStat.presentCount = Math.min(curStat.totalPeriods || 9999, (curStat.presentCount || 0) + 1);
            curStat.officialCount = (curStat.officialCount || 0) + 1;
            subObj.present = Math.min(subObj.total || 9999, (subObj.present || 0) + 1);
            subObj.official = (subObj.official || 0) + 1;
            subObj.absentDates = (subObj.absentDates || []).filter(d => d !== rehDate);

            const docId = String(baseStudent.id || baseStudent.regNo).toLowerCase().trim();
            batch.set(doc(db, 'students', docId), { periodAttendance: curStat }, { merge: true });
            updatedStudentsByReg[reg] = { ...baseStudent, periodAttendance: curStat };
            autoClearedPeriodCount++;
          } else if (!isPresentInRehearsal && currentRegularStatus === 'O' && subObj) {
            attMap[reg] = 'A';
            sessionModified = true;
            curStat.presentCount = Math.max(0, (curStat.presentCount || 0) - 1);
            curStat.officialCount = Math.max(0, (curStat.officialCount || 0) - 1);
            subObj.present = Math.max(0, (subObj.present || 0) - 1);
            subObj.official = Math.max(0, (subObj.official || 0) - 1);
            if (!Array.isArray(subObj.absentDates)) subObj.absentDates = [];
            if (!subObj.absentDates.includes(rehDate)) subObj.absentDates.push(rehDate);

            const docId = String(baseStudent.id || baseStudent.regNo).toLowerCase().trim();
            batch.set(doc(db, 'students', docId), { periodAttendance: curStat }, { merge: true });
            updatedStudentsByReg[reg] = { ...baseStudent, periodAttendance: curStat };
          }
        }

        if (sessionModified) {
          batch.set(doc(db, 'systemCache', regSess.sessionDocId), { attendanceMap: attMap }, { merge: true });
        }
      }

      await batch.commit();
      if (Object.keys(updatedStudentsByReg).length > 0) {
        syncUpdatedStudentsState(updatedStudentsByReg);
      }
      setExistingRehDoc({ presentRegNos: presentRegs, absentRegNos: rehAbsentRegNos });
      setStatusMsg(
        `✅ Rehearsal Attendance Saved (${presentRegs.length} Present, ${rehAbsentRegNos.length} Absent)! ` +
        (autoClearedPeriodCount > 0
          ? `Automatically cleared ${autoClearedPeriodCount} recorded regular class absence(s)!`
          : `Saved ${sessionConfig.weight}-period credit for ${rehDate} (Will auto-clear when old app data is uploaded or regular teachers save attendance!).`)
      );
    } catch (err) {
      setStatusMsg('❌ Error saving rehearsal attendance: ' + err.message);
    } finally {
      setLoading(false);
      setTimeout(() => setStatusMsg(''), 6000);
    }
  };

  // ==========================================
  // 3. ADMIN: CREATE, ASSIGN (WITH DEADLINE) & REVOKE EVENT LEADER ACCOUNTS
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
        enrollments: [
          {
            id: `rehearsal_${safeUser}`,
            grade: 'ALL',
            targetClass: 'CUSTOM',
            subject: newLeaderEventTitle.trim(),
            alias: newLeaderEventTitle.trim(),
            isAttendanceOnly: true,
            isRehearsalSlot: true,
            studentIds: [],
            studentDeadlines: {}
          }
        ],
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
      setStatusMsg(`✅ Created Temporary Event Leader Account "@${safeUser}"! Now assign students & their rehearsal deadline below.`);
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
        if (leaderAssignDeadline) {
          existingDeadlines[reg] = leaderAssignDeadline;
        }
      });

      const updatedEnrollments = [
        {
          ...(leaderObj.enrollments?.[0] || {
            id: `rehearsal_${leaderObj.username}`,
            subject: leaderObj.eventTitle || 'Arts Fest Rehearsal',
            alias: leaderObj.eventTitle || 'Arts Fest Rehearsal',
            isAttendanceOnly: true,
            isRehearsalSlot: true
          }),
          studentIds: mergedIds,
          studentDeadlines: existingDeadlines
        }
      ];

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
    if (!window.confirm(
      `Revoke & Delete temporary login for "${leaderObj.fullName}" (@${leaderObj.username})?\n\n` +
      `✅ All rehearsal attendance & auto-clearances recorded by this leader will remain 100% saved in student records.`
    )) return;

    setLoading(true);
    try {
      await deleteDoc(doc(db, 'teachers', leaderObj.username));
      const nextTeachers = localTeachers.filter(t => t.username !== leaderObj.username);
      setLocalTeachers(nextTeachers);
      if (onTeachersUpdated) onTeachersUpdated(nextTeachers);
      setStatusMsg(`✅ Revoked login for @${leaderObj.username}. All recorded attendance history remains intact!`);
    } catch (err) {
      alert('Error deleting leader account: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // ==========================================
  // 4. MINUS ATTENDANCE, CLEARANCE & DATE-BASED OLD SHUHOOD IMPORT (Zero Changes Needed in Old App!)
  // ==========================================
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

  const matchingMinusStudents = minusSearchQuery.trim().length >= 2
    ? localStudents.filter(s => {
        const q = minusSearchQuery.trim().toLowerCase();
        return String(s.adNo || '').toLowerCase().includes(q) ||
               String(s.firstName || '').toLowerCase().includes(q) ||
               String(s.regNo || '').toLowerCase().includes(q);
      }).slice(0, 8)
    : [];

  const handleSaveMinus = async (e) => {
    e.preventDefault();
    if (!selectedMinusStudent) return alert('Please search and select a student first.');
    if (!minusReason.trim()) return alert('Please enter a reason for the minus deduction.');

    setLoading(true);
    setStatusMsg('');
    try {
      const st = localStudents.find(s => s.regNo === selectedMinusStudent.regNo) || selectedMinusStudent;
      const docId = String(st.id || st.regNo).toLowerCase().trim();
      const curStat = JSON.parse(JSON.stringify(getStudentAttStat(st)));

      const newLog = {
        id: `minus_${Date.now()}`,
        date: new Date().toISOString().split('T')[0],
        count: Number(minusCount),
        reason: minusReason.trim(),
        issuedBy: loggedInUser?.fullName || 'Admin',
        issuedByUsername: String(loggedInUser?.username || 'admin').toLowerCase()
      };

      curStat.minusLogs = [newLog, ...(curStat.minusLogs || [])];
      curStat.minusCount = (curStat.minusCount || 0) + Number(minusCount);

      await setDoc(doc(db, 'students', docId), { periodAttendance: curStat }, { merge: true });
      const updatedSt = { ...st, periodAttendance: curStat };
      setSelectedMinusStudent(updatedSt);
      syncUpdatedStudentsState({ [st.regNo]: updatedSt });

      setStatusMsg(`✅ Deducted ${minusCount} period(s) from ${st.firstName} (#${st.adNo}).`);
      setMinusReason('');
      setMinusCount(1);
    } catch (error) {
      setStatusMsg('❌ Error: ' + error.message);
    } finally {
      setLoading(false);
      setTimeout(() => setStatusMsg(''), 5000);
    }
  };

  const handleDeleteMinus = async (studentObj, logItem) => {
    const myUser = String(loggedInUser?.username || '').trim().toLowerCase();
    const issuerUser = String(logItem.issuedByUsername || '').trim().toLowerCase();

    if (userRole !== 'admin' && myUser !== issuerUser) {
      return alert('⛔ Permission Denied: You can only delete minus entries that YOU issued.');
    }

    if (!window.confirm(`Delete this minus record (-${logItem.count}) and restore attendance to ${studentObj.firstName}?`)) return;
    setLoading(true);
    try {
      const docId = String(studentObj.id || studentObj.regNo).toLowerCase().trim();
      const curStat = JSON.parse(JSON.stringify(getStudentAttStat(studentObj)));

      curStat.minusLogs = (curStat.minusLogs || []).filter(l => l.id !== logItem.id);
      curStat.minusCount = Math.max(0, (curStat.minusCount || 0) - Number(logItem.count));

      await setDoc(doc(db, 'students', docId), { periodAttendance: curStat }, { merge: true });
      const updatedSt = { ...studentObj, periodAttendance: curStat };
      setSelectedMinusStudent(updatedSt);
      syncUpdatedStudentsState({ [studentObj.regNo]: updatedSt });

      setStatusMsg(`✅ Minus entry deleted and ${logItem.count} period(s) restored!`);
    } catch (error) {
      setStatusMsg('❌ Error deleting minus: ' + error.message);
    } finally {
      setLoading(false);
      setTimeout(() => setStatusMsg(''), 5000);
    }
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

  const toggleClearanceSubject = (sub) => {
    setClearSelectedSubjects(prev => prev.includes(sub) ? prev.filter(s => s !== sub) : [...prev, sub]);
  };

  const handleSaveClearance = async (e) => {
    e.preventDefault();
    if (!clearAdNo.trim()) return alert('Enter Student Ad.No.');
    if (clearSelectedSubjects.length === 0) return alert('Select at least one subject.');

    const student = localStudents.find(
      s => String(s.adNo || '').trim().toLowerCase() === clearAdNo.trim().toLowerCase() ||
           String(s.regNo || '').trim().toLowerCase() === clearAdNo.trim().toLowerCase()
    );
    if (!student) return alert('Student not found.');

    setLoading(true);
    try {
      const docId = String(student.id || student.regNo).toLowerCase().trim();
      const curStat = JSON.parse(JSON.stringify(getStudentAttStat(student)));
      if (!curStat.subjectWise) curStat.subjectWise = {};

      let clearedCount = 0;
      clearSelectedSubjects.forEach(sub => {
        const subKey = normalizeSubKey(sub);
        if (!curStat.subjectWise[subKey]) {
          curStat.subjectWise[subKey] = { total: 0, present: 0, official: 0, medical: 0, absentDates: [] };
        }
        const subObj = curStat.subjectWise[subKey];
        if (!Array.isArray(subObj.absentDates)) subObj.absentDates = [];

        const matchingDates = subObj.absentDates.filter(d =>
          clearDateMode === 'single' ? d === clearDate : (d >= clearStartDate && d <= clearEndDate)
        );
        const countToClear = Math.max(1, matchingDates.length);
        clearedCount += countToClear;

        if (clearReason === 'official') {
          curStat.presentCount = Math.min(curStat.totalPeriods || 9999, (curStat.presentCount || 0) + countToClear);
          curStat.officialCount = (curStat.officialCount || 0) + countToClear;
          subObj.present = Math.min(subObj.total || 9999, (subObj.present || 0) + countToClear);
          subObj.official = (subObj.official || 0) + countToClear;
          subObj.absentDates = subObj.absentDates.filter(d => !matchingDates.includes(d));
        } else {
          curStat.medicalCount = (curStat.medicalCount || 0) + countToClear;
          subObj.medical = (subObj.medical || 0) + countToClear;
        }
      });

      await setDoc(doc(db, 'students', docId), { periodAttendance: curStat }, { merge: true });
      syncUpdatedStudentsState({ [student.regNo]: { ...student, periodAttendance: curStat } });
      setStatusMsg(`✅ Cleared ${clearedCount} period(s) as [${clearReason.toUpperCase()}] for ${student.firstName}!`);
      setClearSelectedSubjects([]);
    } catch (err) {
      setStatusMsg('❌ Error: ' + err.message);
    } finally {
      setLoading(false);
      setTimeout(() => setStatusMsg(''), 5000);
    }
  };

  // 🌟 Helper: Gather all Leader Rehearsal Credits by Student RegNo & Date from systemCache
  const fetchRehearsalCreditsByRegAndDate = async () => {
    const cacheSnap = await getDocs(collection(db, 'systemCache'));
    const map = {};
    cacheSnap.forEach(d => {
      if (!d.id.startsWith('rehearsalSession_')) return;
      const rData = d.data();
      const rDate = rData.date;
      const sessId = rData.sessionId;
      const sCfg = REHEARSAL_SESSIONS.find(x => x.id === sessId);
      const weight = Number(rData.weight || sCfg?.weight || 2);

      (rData.presentRegNos || []).forEach(reg => {
        if (!map[reg]) map[reg] = {};
        if (!map[reg][rDate]) {
          map[reg][rDate] = { sessionsDone: new Set(), weightEarned: 0 };
        }
        const entry = map[reg][rDate];
        if (!entry.sessionsDone.has(sessId)) {
          entry.sessionsDone.add(sessId);
          entry.weightEarned += weight; // FN1 (2) + FN2 (2) + AN1 (3) = up to 7 periods per date!
        }
      });
    });
    return map;
  };

  // 🌟 Pure Date-Based Rehearsal Auto-Clearance (Works with UNMODIFIED Old App JSON or Excel!)
  const applyDateBasedRehearsalCreditsToStat = (curStat, studentRehDatesMap) => {
    if (!studentRehDatesMap || Object.keys(studentRehDatesMap).length === 0) return { stat: curStat, cleared: 0 };

    const nextStat = JSON.parse(JSON.stringify(curStat));
    if (!nextStat.subjectWise) nextStat.subjectWise = {};
    if (!nextStat.appliedRehearsalDates) nextStat.appliedRehearsalDates = {};

    let totalClearedForStudent = 0;
    const subKeys = Object.keys(nextStat.subjectWise);

    Object.keys(studentRehDatesMap).forEach(rehDateStr => {
      const earnedWeight = studentRehDatesMap[rehDateStr].weightEarned || 0;
      const alreadyAppliedOnDate = Number(nextStat.appliedRehearsalDates[rehDateStr] || 0);
      let creditsToApply = Math.max(0, earnedWeight - alreadyAppliedOnDate);
      if (creditsToApply <= 0) return;

      let clearedOnThisDate = 0;

      if (subKeys.length > 0) {
        // Look across all subjects where this student was marked absent on `rehDateStr`
        for (const sKey of subKeys) {
          if (creditsToApply <= 0) break;
          const sObj = nextStat.subjectWise[sKey];
          if (!sObj || !Array.isArray(sObj.absentDates)) continue;

          // Clear matching date occurrences in this subject
          while (creditsToApply > 0 && sObj.absentDates.includes(rehDateStr)) {
            const idx = sObj.absentDates.indexOf(rehDateStr);
            sObj.absentDates.splice(idx, 1);
            sObj.present = Math.min(sObj.total || 9999, (sObj.present || 0) + 1);
            sObj.official = (sObj.official || 0) + 1;
            nextStat.presentCount = Math.min(nextStat.totalPeriods || 9999, (nextStat.presentCount || 0) + 1);
            nextStat.officialCount = (nextStat.officialCount || 0) + 1;

            creditsToApply -= 1;
            clearedOnThisDate += 1;
            totalClearedForStudent += 1;
          }
        }
      } else {
        // Fallback if imported from a simple Excel sheet without subject-wise dates:
        // Only clear if the student actually has recorded absences (totalPeriods > presentCount)
        const currentAbsences = Math.max(0, (nextStat.totalPeriods || 0) - (nextStat.presentCount || 0));
        const canClear = Math.min(creditsToApply, currentAbsences);
        if (canClear > 0) {
          nextStat.presentCount += canClear;
          nextStat.officialCount = (nextStat.officialCount || 0) + canClear;
          clearedOnThisDate += canClear;
          totalClearedForStudent += canClear;
        }
      }

      if (clearedOnThisDate > 0) {
        nextStat.appliedRehearsalDates[rehDateStr] = alreadyAppliedOnDate + clearedOnThisDate;
      }
    });

    return { stat: nextStat, cleared: totalClearedForStudent };
  };

  // 🌟 Import Old Shuhood JSON / Excel AND Automatically Clear Rehearsal Dates!
  const handleImportOldShuhoodFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setStatusMsg('⏳ Importing old Shuhood data & auto-clearing Event Leader rehearsal dates...');

    try {
      const rehearsalCreditsMap = await fetchRehearsalCreditsByRegAndDate();
      const ext = file.name.split('.').pop().toLowerCase();
      const updatedMap = {};
      let importedCount = 0;
      let totalAutoCleared = 0;

      if (ext === 'json') {
        const jsonMap = JSON.parse(await file.text());
        const entries = Object.values(jsonMap);

        for (let i = 0; i < entries.length; i += 400) {
          const chunk = entries.slice(i, i + 400);
          const batch = writeBatch(db);
          chunk.forEach(item => {
            const cleanAd = String(item.adNo || '').trim().toUpperCase();
            const st = localStudents.find(s => String(s.adNo || '').trim().toUpperCase() === cleanAd);
            if (!st) return;

            const docId = String(st.id || st.regNo).toLowerCase().trim();
            const baseStat = {
              totalPeriods: Number(item.totalPeriods) || 0,
              presentCount: Number(item.presentCount) || 0,
              officialCount: Number(item.officialCount) || 0,
              medicalCount: Number(item.medicalCount) || 0,
              minusCount: Number(item.minusCount) || 0,
              minusLogs: Array.isArray(item.minusLogs) ? item.minusLogs : [],
              subjectWise: item.subjectWise || {},
              appliedRehearsalDates: {},
              updatedAt: new Date().toISOString()
            };

            const { stat: finalStat, cleared } = applyDateBasedRehearsalCreditsToStat(
              baseStat,
              rehearsalCreditsMap[st.regNo]
            );
            totalAutoCleared += cleared;

            batch.set(doc(db, 'students', docId), { periodAttendance: finalStat }, { merge: true });
            updatedMap[st.regNo] = { ...st, periodAttendance: finalStat };
            importedCount++;
          });
          await batch.commit();
        }
      } else {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        const batch = writeBatch(db);

        rows.forEach(row => {
          const rawAd = row.admissionNumber || row['Admission Number'] || row['Ad.No'] || row.AdNo || row['Adm No'];
          if (!rawAd) return;
          const cleanAd = String(rawAd).trim().toUpperCase();
          const st = localStudents.find(s => String(s.adNo || '').trim().toUpperCase() === cleanAd);
          if (!st) return;

          const docId = String(st.id || st.regNo).toLowerCase().trim();
          const cur = getStudentAttStat(st);
          const baseStat = {
            ...cur,
            totalPeriods: Number(row.totalAttendanceCount ?? row.TotalPeriods ?? row['Total Periods'] ?? cur.totalPeriods ?? 0),
            presentCount: Number(row.totalPresentCount ?? row.PresentPeriods ?? row['Total Present'] ?? cur.presentCount ?? 0),
            minusCount: Number(row.minusCount ?? row.MinusCount ?? row.Minus ?? cur.minusCount ?? 0),
            appliedRehearsalDates: {},
            updatedAt: new Date().toISOString()
          };

          const { stat: finalStat, cleared } = applyDateBasedRehearsalCreditsToStat(
            baseStat,
            rehearsalCreditsMap[st.regNo]
          );
          totalAutoCleared += cleared;

          batch.set(doc(db, 'students', docId), { periodAttendance: finalStat }, { merge: true });
          updatedMap[st.regNo] = { ...st, periodAttendance: finalStat };
          importedCount++;
        });
        await batch.commit();
      }

      syncUpdatedStudentsState(updatedMap);
      setStatusMsg(
        `🎉 Imported semester attendance for ${importedCount} students AND auto-cleared ${totalAutoCleared} absence period(s) from Event Leader rehearsal dates!`
      );
    } catch (err) {
      setStatusMsg('❌ Import error: ' + err.message);
    } finally {
      setLoading(false);
      e.target.value = null;
    }
  };

  // 🌟 1-Click Button to Re-Apply Leader Rehearsal Credits to Already-Imported Student Records
  const handleSyncRehearsalCreditsToExistingRecords = async () => {
    setLoading(true);
    setStatusMsg('⏳ Syncing Event Leader rehearsal dates with student attendance records...');
    try {
      const rehearsalCreditsMap = await fetchRehearsalCreditsByRegAndDate();
      const batch = writeBatch(db);
      const updatedMap = {};
      let totalCleared = 0;

      localStudents.forEach(st => {
        const stCredits = rehearsalCreditsMap[st.regNo];
        if (!stCredits) return;
        const curStat = getStudentAttStat(st);
        if (!curStat.totalPeriods) return;

        const { stat: finalStat, cleared } = applyDateBasedRehearsalCreditsToStat(curStat, stCredits);
        if (cleared > 0) {
          const docId = String(st.id || st.regNo).toLowerCase().trim();
          batch.set(doc(db, 'students', docId), { periodAttendance: finalStat }, { merge: true });
          updatedMap[st.regNo] = { ...st, periodAttendance: finalStat };
          totalCleared += cleared;
        }
      });

      if (totalCleared > 0) {
        await batch.commit();
        syncUpdatedStudentsState(updatedMap);
      }
      setStatusMsg(`✅ Sync complete! Auto-cleared ${totalCleared} recorded absence period(s) matching Event Leader rehearsal dates.`);
    } catch (err) {
      setStatusMsg('❌ Sync error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const shortageList = localStudents
    .filter(st => shortageClassFilter === 'ALL' || (st.classes || []).includes(shortageClassFilter))
    .map(st => {
      const stat = getStudentAttStat(st);
      const total = Number(stat.totalPeriods) || 0;
      const rawPresent = Number(stat.presentCount) || 0;
      const minus = Number(stat.minusCount) || 0;
      const netPresent = Math.max(0, rawPresent - minus);
      const effectivePct = total > 0 ? Number(((netPresent / total) * 100).toFixed(1)) : 100;
      return { ...st, totalPeriods: total, rawPresent, netPresent, minusCount: minus, effectivePct };
    })
    .filter(st => st.totalPeriods > 0 && st.effectivePct < 85);

  const selectedMinusStudentStats = selectedMinusStudent ? getStudentAttStat(selectedMinusStudent) : { minusCount: 0, minusLogs: [] };
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
                  <div style={{ fontSize: '13px', fontWeight: '800', color: '#dc2626' }}>OFFICIAL ABSENCE & SHORTAGE CLEARANCE FORM</div>
                </div>
              </div>
              <button onClick={() => setClearancePrintStudent(null)} className="no-print" style={{ background: '#fee2e2', color: '#dc2626', border: 'none', padding: '8px 12px', borderRadius: '8px', fontWeight: '800', cursor: 'pointer' }}>✕ Close</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '14px', marginBottom: '20px', background: '#f8fafc', padding: '16px', borderRadius: '10px', border: '1px solid #cbd5e1' }}>
              <div><strong>Student Name:</strong> {clearancePrintStudent.firstName}</div>
              <div><strong>Admission No:</strong> #{clearancePrintStudent.adNo} (Reg: {clearancePrintStudent.regNo})</div>
              <div><strong>Class & Dept:</strong> {(clearancePrintStudent.classes || []).join(', ')} ({clearancePrintStudent.department || 'GENERAL'})</div>
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

      {/* 🌟 TOP NAVIGATION BAR (Hidden if user is a Restricted Event Student Leader!) */}
      {!isEventLeaderUser && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#ffffff', padding: '16px 22px', borderRadius: '16px', border: '1px solid #cbd5e1', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setActiveTab('cards')}
              style={{ padding: '10px 18px', borderRadius: '10px', fontWeight: '800', fontSize: '13px', border: 'none', cursor: 'pointer', background: activeTab === 'cards' || activeTab === 'mark_sheet' ? '#4f46e5' : '#f1f5f9', color: activeTab === 'cards' || activeTab === 'mark_sheet' ? '#ffffff' : '#0f172a' }}
            >
              📚 Subject Attendance Cards ({attendanceEnrollments.length})
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('minus_attendance')}
              style={{ padding: '10px 18px', borderRadius: '10px', fontWeight: '800', fontSize: '13px', border: 'none', cursor: 'pointer', background: '#e11d48', color: '#ffffff', boxShadow: '0 4px 10px rgba(225, 29, 72, 0.25)' }}
            >
              ⚠️ Manage Minus Attendance
            </button>

            <button
              type="button"
              onClick={handleDownloadAbsentReport}
              style={{ padding: '10px 18px', borderRadius: '10px', fontWeight: '800', fontSize: '13px', border: '1px solid #cbd5e1', cursor: 'pointer', background: '#f8fafc', color: '#1e293b' }}
            >
              ⬇️ Download Absent Report
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('shortage')}
              style={{ padding: '10px 16px', borderRadius: '10px', fontWeight: '800', fontSize: '13px', border: 'none', cursor: 'pointer', background: activeTab === 'shortage' ? '#d97706' : '#f1f5f9', color: activeTab === 'shortage' ? '#ffffff' : '#0f172a' }}
            >
              📉 Shortage &lt;85% ({shortageList.length})
            </button>

            {userRole === 'admin' && (
              <>
                <button
                  type="button"
                  onClick={() => setActiveTab('manage_leaders')}
                  style={{ padding: '10px 16px', borderRadius: '10px', fontWeight: '800', fontSize: '13px', border: 'none', cursor: 'pointer', background: activeTab === 'manage_leaders' || activeTab === 'rehearsal_leader' ? '#7c3aed' : '#f5f3ff', color: activeTab === 'manage_leaders' || activeTab === 'rehearsal_leader' ? '#ffffff' : '#6d28d9' }}
                >
                  🎭 Event / Arts Fest Leaders ({eventLeadersList.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('non_mark_subjects')}
                  style={{ padding: '10px 16px', borderRadius: '10px', fontWeight: '800', fontSize: '13px', border: 'none', cursor: 'pointer', background: activeTab === 'non_mark_subjects' ? '#0d9488' : '#f0fdfa', color: activeTab === 'non_mark_subjects' ? '#ffffff' : '#0f766e' }}
                >
                  ➕ Non-Mark Subjects &amp; Mass Assign
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('clearance')}
                  style={{ padding: '10px 16px', borderRadius: '10px', fontWeight: '800', fontSize: '13px', border: 'none', cursor: 'pointer', background: activeTab === 'clearance' ? '#0284c7' : '#f1f5f9', color: activeTab === 'clearance' ? '#ffffff' : '#0f172a' }}
                >
                  ⚖️ Medical/Official Clearance
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('import_old')}
                  style={{ padding: '10px 16px', borderRadius: '10px', fontWeight: '800', fontSize: '13px', border: 'none', cursor: 'pointer', background: activeTab === 'import_old' ? '#4f46e5' : '#f1f5f9', color: activeTab === 'import_old' ? '#ffffff' : '#0f172a' }}
                >
                  📂 Import Old Shuhood Data
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {statusMsg && (
        <div style={{ padding: '14px 18px', background: statusMsg.includes('✅') || statusMsg.includes('🎉') ? '#dcfce7' : '#fee2e2', color: statusMsg.includes('✅') || statusMsg.includes('🎉') ? '#166534' : '#991b1b', borderRadius: '10px', fontWeight: '800' }}>
          {statusMsg}
        </div>
      )}

      {/* ============================================================
          VIEW 1: SHUHOOD-STYLE SUBJECT ATTENDANCE CARDS
         ============================================================ */}
      {activeTab === 'cards' && !isEventLeaderUser && (
        <div>
          {userRole === 'admin' && (
            <div style={{ marginBottom: '20px', background: '#ffffff', padding: '16px 20px', borderRadius: '14px', border: '1px solid #cbd5e1', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
              <label style={{ ...styles.label, margin: 0 }}>👨‍🏫 Inspect / Take Attendance for Teacher:</label>
              <select
                value={selectedTeacherUsername}
                onChange={e => setSelectedTeacherUsername(e.target.value)}
                style={{ ...styles.input, maxWidth: '340px' }}
              >
                {localTeachers.filter(t => !t.isEventLeader).map(t => (
                  <option key={t.username} value={t.username}>{t.fullName} (@{t.username})</option>
                ))}
              </select>
            </div>
          )}

          {attendanceEnrollments.length === 0 ? (
            <div style={{ background: '#ffffff', padding: '40px', borderRadius: '16px', border: '1px dashed #cbd5e1', textAlign: 'center', color: '#64748b', fontWeight: '700' }}>
              No period-attendance subjects assigned yet (Hifz is automatically excluded from period attendance).
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: '20px' }}>
              {attendanceEnrollments.map(env => {
                const enrolledList = getStudentsForEnrollment(env);
                const isNonMark = isAttendanceOnlyEnrollment(env);
                return (
                  <div
                    key={env.id}
                    style={{
                      background: '#ffffff',
                      padding: '24px',
                      borderRadius: '18px',
                      border: '1px solid #e2e8f0',
                      boxShadow: '0 4px 15px rgba(15, 23, 42, 0.04)',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      gap: '16px'
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                        <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '900', color: '#0f172a', textTransform: 'uppercase' }}>
                          {env.alias || `${env.subject} ${env.targetClass || ''}`}
                        </h3>
                        {isNonMark && (
                          <span style={{ background: '#fef3c7', color: '#b45309', padding: '3px 8px', borderRadius: '6px', fontSize: '10px', fontWeight: '900' }}>
                            ATTENDANCE ONLY
                          </span>
                        )}
                      </div>

                      <div style={{ marginTop: '8px' }}>
                        <span style={{ background: '#f1f5f9', color: '#475569', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '800' }}>
                          Class: {env.targetClass || env.alias?.split(' ').pop() || `Grade ${env.grade || '-'}`}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '18px', color: '#475569', fontSize: '14px', fontWeight: '700' }}>
                        <span style={{ background: '#eef2ff', color: '#4f46e5', padding: '6px 8px', borderRadius: '8px', fontSize: '14px' }}>👥</span>
                        <span><strong>{enrolledList.length}</strong> Students Enrolled</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setAttEnrollmentId(env.id);
                        setActiveTab('mark_sheet');
                      }}
                      style={{
                        width: '100%',
                        padding: '13px',
                        background: '#0f172a',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '10px',
                        fontWeight: '800',
                        fontSize: '14px',
                        cursor: 'pointer'
                      }}
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

      {/* ============================================================
          VIEW 1B: 9-PERIOD ROLL-CALL SHEET + CLASS-WISE ABSENTEE WA/COPY
         ============================================================ */}
      {activeTab === 'mark_sheet' && !isEventLeaderUser && (
        <div style={{ background: '#ffffff', padding: '24px', borderRadius: '16px', border: '1px solid #cbd5e1' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '18px' }}>
            <button
              type="button"
              onClick={() => setActiveTab('cards')}
              style={{ padding: '8px 14px', background: '#f1f5f9', color: '#0f172a', border: '1px solid #cbd5e1', borderRadius: '8px', fontWeight: '800', cursor: 'pointer' }}
            >
              ⬅ Back to Subject Cards
            </button>
            {existingSessionDoc && (
              <span style={{ background: '#fef3c7', color: '#92400e', padding: '5px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: '800', border: '1px solid #f59e0b' }}>
                ✏️ Editing Saved Session ({attDate} • Period {attSession})
              </span>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '14px', marginBottom: '20px' }}>
            <div>
              <label style={styles.label}>Selected Subject Batch:</label>
              <select value={attEnrollmentId} onChange={e => setAttEnrollmentId(e.target.value)} style={styles.input}>
                {attendanceEnrollments.map(env => (
                  <option key={env.id} value={env.id}>{env.alias || env.subject}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={styles.label}>Date:</label>
              <input type="date" value={attDate} onChange={e => setAttDate(e.target.value)} style={styles.input} />
            </div>
            <div>
              <label style={styles.label}>Period / Session (1 to 9):</label>
              <select value={attSession} onChange={e => setAttSession(e.target.value)} style={styles.input}>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(s => <option key={s} value={s}>Period {s}</option>)}
              </select>
            </div>
          </div>

          {classStudents.length > 0 && (
            <form onSubmit={handleSaveAttendance}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '12px 16px', borderRadius: '10px', marginBottom: '14px', fontWeight: '800', flexWrap: 'wrap', gap: '10px', border: '1px solid #cbd5e1' }}>
                <span style={{ color: '#0f172a' }}>👥 Total: {classStudents.length}</span>
                <span style={{ color: '#059669' }}>✅ Present: {classStudents.length - absentRegNos.length}</span>
                <span style={{ color: '#dc2626' }}>❌ Absent: {absentRegNos.length}</span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button type="button" onClick={() => setAbsentRegNos([])} style={{ padding: '5px 10px', background: '#dcfce7', color: '#166534', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: '800', cursor: 'pointer' }}>All Present</button>
                  <button type="button" onClick={() => setAbsentRegNos(classStudents.map(s => s.regNo))} style={{ padding: '5px 10px', background: '#fee2e2', color: '#991b1b', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: '800', cursor: 'pointer' }}>All Absent</button>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '10px', maxHeight: '440px', overflowY: 'auto', marginBottom: '20px' }}>
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
                        alignItems: 'center',
                        background: isAutoOfficial ? '#eff6ff' : isAbsent ? '#fef2f2' : '#ecfdf5',
                        border: `2px solid ${isAutoOfficial ? '#3b82f6' : isAbsent ? '#ef4444' : '#10b981'}`
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: '800', color: isAutoOfficial ? '#1e40af' : isAbsent ? '#991b1b' : '#065f46', fontSize: '14px' }}>
                          #{st.rollNo || '-'} • {st.firstName}
                        </div>
                        <div style={{ fontSize: '12px', color: isAutoOfficial ? '#2563eb' : isAbsent ? '#dc2626' : '#047857', fontWeight: '700' }}>
                          Ad.No: #{st.adNo} • {(st.classes || []).join(', ')}
                        </div>
                        {rehPresentHere && (
                          <span style={{ display: 'inline-block', marginTop: '4px', background: '#dbeafe', color: '#1e40af', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: '900' }}>
                            🎭 Rehearsal Present (Auto-Cleared)
                          </span>
                        )}
                        {op && (
                          <span style={{ display: 'inline-block', marginTop: '4px', background: op.isOfficial ? '#dbeafe' : '#fef3c7', color: op.isOfficial ? '#1e40af' : '#92400e', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: '900' }}>
                            🪪 {op.category} Out-Pass
                          </span>
                        )}
                      </div>
                      <span style={{ padding: '4px 10px', borderRadius: '6px', fontWeight: '900', fontSize: '12px', background: isAutoOfficial ? '#2563eb' : isAbsent ? '#dc2626' : '#059669', color: '#ffffff' }}>
                        {isAutoOfficial ? 'OFFICIAL' : isAbsent ? 'ABSENT' : 'PRESENT'}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* 🌟 CLASS-WISE ABSENTEE COPY & WHATSAPP TO CLASS TEACHER */}
              {absentStudentsByClassGroups.length > 0 && (
                <div style={{ background: '#fffbeb', border: '2px solid #f59e0b', borderRadius: '12px', padding: '16px', marginBottom: '18px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
                    <div>
                      <div style={{ fontWeight: '900', color: '#92400e', fontSize: '14px' }}>
                        📲 Send / Copy Absent Students to Respective Class Teachers ({absentStudentsByClassGroups.length} Class{absentStudentsByClassGroups.length > 1 ? 'es' : ''})
                      </div>
                      <div style={{ fontSize: '12px', color: '#b45309', fontWeight: '600' }}>
                        Students are automatically grouped by class so each Class Teacher only receives their own class's absentees.
                      </div>
                    </div>
                    {absentStudentsByClassGroups.length > 1 && (
                      <button
                        type="button"
                        onClick={handleCopyAllAbsentees}
                        style={{ padding: '7px 12px', background: '#0f172a', color: '#ffffff', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '800', cursor: 'pointer' }}
                      >
                        📋 Copy All Classes Together
                      </button>
                    )}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px' }}>
                    {absentStudentsByClassGroups.map(grp => (
                      <div key={grp.className} style={{ background: '#ffffff', border: '1px solid #fcd34d', borderRadius: '10px', padding: '12px 14px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '10px' }}>
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                            <span style={{ background: '#fef3c7', color: '#92400e', padding: '3px 8px', borderRadius: '6px', fontSize: '12px', fontWeight: '900' }}>
                              🏫 Class {grp.className} ({grp.students.length} Absent)
                            </span>
                            <span style={{ fontSize: '11px', fontWeight: '800', color: '#0f766e' }}>
                              CT: {grp.classTeacher?.fullName || 'Unassigned'}
                            </span>
                          </div>
                          <div style={{ fontSize: '12px', color: '#dc2626', fontWeight: '700', lineHeight: 1.5 }}>
                            {grp.students.map(s => `${s.firstName} (#${s.adNo})`).join(', ')}
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            onClick={() => handleCopyClassAbsentees(grp)}
                            style={{ flex: 1, padding: '8px 10px', background: '#f1f5f9', color: '#0f172a', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '12px', fontWeight: '800', cursor: 'pointer' }}
                          >
                            📋 Copy {grp.className} List
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const phone = grp.classTeacher?.whatsappNumber || grp.classTeacher?.mobileNumber;
                              if (!phone) return alert(`No WhatsApp number saved for Class ${grp.className} Teacher (${grp.classTeacher?.fullName || 'Unassigned'}).`);
                              openDirectWhatsApp(phone, formatAbsentMessageForClass(grp));
                            }}
                            style={{ flex: 1, padding: '8px 10px', background: '#16a34a', color: '#ffffff', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '800', cursor: 'pointer' }}
                          >
                            💬 WA {grp.classTeacher?.fullName ? grp.classTeacher.fullName.split(' ')[0] : 'CT'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button type="submit" disabled={loading} style={{ ...styles.buttonPrimary, width: '100%', padding: '16px', fontSize: '16px' }}>
                {loading ? 'Saving Attendance...' : `💾 ${existingSessionDoc ? 'Update' : 'Save'} Period ${attSession} Attendance`}
              </button>
            </form>
          )}
        </div>
      )}

      {/* ============================================================
          VIEW 2: EVENT / ARTS FEST STUDENT LEADER REHEARSAL ROLL-CALL
          (Sorted QLA3 -> AL1, Auto-Hides Expired Students After Deadline!)
         ============================================================ */}
      {activeTab === 'rehearsal_leader' && (
        <div style={{ background: '#ffffff', padding: '24px', borderRadius: '16px', border: '2px solid #7c3aed' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px', borderBottom: '2px solid #f5f3ff', paddingBottom: '14px' }}>
            <div>
              <span style={{ background: '#7c3aed', color: '#ffffff', padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: '900', textTransform: 'uppercase' }}>
                🎭 Special Event / Arts Fest Rehearsal Attendance Portal
              </span>
              <h3 style={{ margin: '6px 0 0 0', fontSize: '20px', color: '#0f172a', fontWeight: '900' }}>
                {activeLeaderObj?.fullName || 'Event Leader Roll-Call'} ({leaderStudentsSorted.length} Active Students for {rehDate})
              </h3>
              <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#475569', fontWeight: '600' }}>
                Sorted from <strong>QLA3 down to AL1</strong>. Students whose rehearsal deadline date has passed are automatically hidden.
              </p>
            </div>
            {userRole === 'admin' && (
              <button
                type="button"
                onClick={() => setActiveTab('manage_leaders')}
                style={{ padding: '8px 14px', background: '#f5f3ff', color: '#6d28d9', border: '1px solid #c4b5fd', borderRadius: '8px', fontWeight: '800', cursor: 'pointer' }}
              >
                ⚙️ Manage Leader Accounts &amp; Deadlines
              </button>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px', marginBottom: '20px' }}>
            {userRole === 'admin' && eventLeadersList.length > 0 && (
              <div>
                <label style={styles.label}>Select Event Leader Account:</label>
                <select value={rehSelectedLeaderUsername} onChange={e => setRehSelectedLeaderUsername(e.target.value)} style={styles.input}>
                  {eventLeadersList.map(l => (
                    <option key={l.username} value={l.username}>{l.fullName} (@{l.username})</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label style={styles.label}>Rehearsal Date:</label>
              <input type="date" value={rehDate} onChange={e => setRehDate(e.target.value)} style={styles.input} />
            </div>
            <div>
              <label style={styles.label}>Select Rehearsal Sitting (3 Daily Sittings):</label>
              <select value={rehSessionId} onChange={e => setRehSessionId(e.target.value)} style={{ ...styles.input, borderColor: '#7c3aed', fontWeight: '800' }}>
                {REHEARSAL_SESSIONS.map(s => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>

          {existingRehDoc && (
            <div style={{ marginBottom: '14px', padding: '10px 14px', background: '#fef3c7', color: '#92400e', borderRadius: '8px', fontWeight: '800', fontSize: '13px', border: '1px solid #f59e0b' }}>
              ✏️ You are viewing/editing previously submitted rehearsal attendance for {rehDate} ({rehSessionId}). You can modify and click Update below.
            </div>
          )}

          {leaderStudentsSorted.length === 0 ? (
            <div style={{ padding: '32px', background: '#f8fafc', borderRadius: '12px', textAlign: 'center', color: '#64748b', fontWeight: '700' }}>
              No active students found for {rehDate} (either no students are mapped yet, or their rehearsal deadline has passed).
            </div>
          ) : (
            <form onSubmit={handleSaveRehearsalAttendance}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f5f3ff', padding: '12px 16px', borderRadius: '10px', marginBottom: '14px', fontWeight: '800', flexWrap: 'wrap', gap: '10px', border: '1px solid #ddd6fe' }}>
                <span style={{ color: '#4c1d95' }}>👥 Active Assigned: {leaderStudentsSorted.length}</span>
                <span style={{ color: '#059669' }}>✅ Present at Rehearsal: {leaderStudentsSorted.length - rehAbsentRegNos.length}</span>
                <span style={{ color: '#dc2626' }}>❌ Absent from Rehearsal: {rehAbsentRegNos.length}</span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button type="button" onClick={() => setRehAbsentRegNos([])} style={{ padding: '5px 10px', background: '#dcfce7', color: '#166534', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: '800', cursor: 'pointer' }}>All Present</button>
                  <button type="button" onClick={() => setRehAbsentRegNos(leaderStudentsSorted.map(s => s.regNo))} style={{ padding: '5px 10px', background: '#fee2e2', color: '#991b1b', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: '800', cursor: 'pointer' }}>All Absent</button>
                </div>
              </div>

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
                        background: isAbsent ? '#fef2f2' : '#ecfdf5',
                        border: `2px solid ${isAbsent ? '#ef4444' : '#10b981'}`
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          <span style={{ background: '#4c1d95', color: '#ffffff', padding: '2px 7px', borderRadius: '4px', fontSize: '11px', fontWeight: '900' }}>
                            {(st.classes || []).join(', ') || st.class}
                          </span>
                          <span style={{ fontWeight: '900', color: '#0f172a', fontSize: '14px' }}>
                            {st.firstName}
                          </span>
                        </div>
                        <div style={{ fontSize: '12px', color: isAbsent ? '#dc2626' : '#047857', fontWeight: '800', marginTop: '4px' }}>
                          Ad.No: #{st.adNo} • Sn: {idx + 1} {dl ? `• Until ${dl}` : ''}
                        </div>
                      </div>
                      <span style={{ padding: '5px 10px', borderRadius: '6px', fontWeight: '900', fontSize: '12px', background: isAbsent ? '#dc2626' : '#059669', color: '#ffffff' }}>
                        {isAbsent ? 'ABSENT' : 'PRESENT'}
                      </span>
                    </div>
                  );
                })}
              </div>

              <button type="submit" disabled={loading} style={{ ...styles.buttonPrimary, width: '100%', padding: '16px', fontSize: '16px', background: '#7c3aed' }}>
                {loading ? 'Submitting Rehearsal Attendance...' : `💾 ${existingRehDoc ? 'Update' : 'Submit'} Rehearsal Attendance (${rehSessionId})`}
              </button>
            </form>
          )}
        </div>
      )}

      {/* ============================================================
          VIEW 2B: ADMIN EVENT LEADER ACCOUNT CREATOR & DEADLINE MAPPER
         ============================================================ */}
      {activeTab === 'manage_leaders' && userRole === 'admin' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div style={{ background: '#ffffff', padding: '24px', borderRadius: '16px', border: '1px solid #cbd5e1' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '14px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '19px', color: '#6d28d9', fontWeight: '900' }}>
                  🎭 1. Create Temporary Student Leader / Event Attendance Account
                </h3>
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b', fontWeight: '600' }}>
                  Create 1, 2, 3, or more temporary accounts. When deleted after the event, all recorded attendance remains 100% permanent!
                </p>
              </div>
              {eventLeadersList.length > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveTab('rehearsal_leader')}
                  style={{ padding: '10px 16px', background: '#7c3aed', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}
                >
                  📋 Open Rehearsal Roll-Call Screen ➔
                </button>
              )}
            </div>

            <form onSubmit={handleCreateEventLeaderAccount} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', alignItems: 'end', marginBottom: '20px' }}>
              <div>
                <label style={styles.label}>Leader Name:</label>
                <input type="text" value={newLeaderName} onChange={e => setNewLeaderName(e.target.value)} placeholder="e.g. Sinan QLA3" required style={styles.input} />
              </div>
              <div>
                <label style={styles.label}>Event / Team Name:</label>
                <input type="text" value={newLeaderEventTitle} onChange={e => setNewLeaderEventTitle(e.target.value)} placeholder="e.g. Arts Fest Zone A" required style={styles.input} />
              </div>
              <div>
                <label style={styles.label}>Login Username:</label>
                <input type="text" value={newLeaderUsername} onChange={e => setNewLeaderUsername(e.target.value)} placeholder="e.g. leader_zone1" required style={styles.input} />
              </div>
              <div>
                <label style={styles.label}>Password (Min 6 chars):</label>
                <input type="text" value={newLeaderPassword} onChange={e => setNewLeaderPassword(e.target.value)} placeholder="e.g. fest123" required style={styles.input} />
              </div>
              <button type="submit" disabled={loading} style={{ ...styles.buttonPrimary, background: '#7c3aed', padding: '12px 18px' }}>
                ➕ Create Leader Login
              </button>
            </form>

            {eventLeadersList.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px' }}>
                {eventLeadersList.map(l => {
                  const sIds = l.enrollments?.[0]?.studentIds || l.assignedStudentIds || [];
                  return (
                    <div key={l.username} style={{ padding: '14px 16px', background: '#f5f3ff', border: '1.5px solid #c4b5fd', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                      <div>
                        <div style={{ fontWeight: '900', color: '#4c1d95', fontSize: '15px' }}>🎭 {l.fullName}</div>
                        <div style={{ fontSize: '12px', color: '#6d28d9', fontWeight: '700', marginTop: '2px' }}>
                          Login: <code>@{l.username}</code> • <strong>{sIds.length} Students Mapped</strong>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteEventLeaderAccount(l)}
                        style={{ padding: '7px 12px', background: '#fee2e2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '8px', fontWeight: '800', fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                      >
                        🗑️ Revoke Login
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ background: '#ffffff', padding: '24px', borderRadius: '16px', border: '1px solid #cbd5e1' }}>
            <h3 style={{ margin: '0 0 6px 0', fontSize: '18px', color: '#0f172a', fontWeight: '900' }}>
              👥 2. Map Students &amp; Set Rehearsal Deadline Date (e.g. Nov 10 or Nov 15)
            </h3>
            <p style={{ margin: '0 0 14px 0', fontSize: '13px', color: '#64748b', fontWeight: '600' }}>
              Select students below, pick their rehearsal end date (e.g., <code>2026-11-10</code> for Batch 1, then <code>2026-11-15</code> for Batch 2), and click Assign. After their deadline date passes, their name automatically disappears from the leader's roll-call!
            </p>

            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '16px', background: '#f5f3ff', padding: '14px', borderRadius: '12px', border: '1.5px solid #8b5cf6', alignItems: 'center' }}>
              {/* ⚡ INSTANT MULTI-CLASS AD.NO PASTE & SELECTOR */}
            <div style={{ marginBottom: '16px', padding: '14px', background: '#f8fafc', borderRadius: '12px', border: '1.5px dashed #7c3aed', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ flex: '1 1 280px' }}>
                <div style={{ fontSize: '12px', fontWeight: '900', color: '#4c1d95', marginBottom: '4px' }}>
                  ⚡ Quick Multi-Class Select by Admission Numbers (No Subject Needed):
                </div>
                <input
                  type="text"
                  value={bulkAdNoPasteText}
                  onChange={e => setBulkAdNoPasteText(e.target.value)}
                  placeholder="Paste Ad.Nos from any classes separated by comma or space (e.g. 3538, U1127, 3668, U1278)..."
                  style={{ ...styles.input, fontSize: '13px', borderColor: '#c4b5fd' }}
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  const tokens = bulkAdNoPasteText
                    .split(/[\s,;\n]+/)
                    .map(t => t.replace(/^#/, '').trim().toUpperCase())
                    .filter(Boolean);
                  if (tokens.length === 0) return alert('Paste at least one Admission Number (Ad.No) first.');

                  const matchedRegs = localStudents
                    .filter(s => tokens.includes(String(s.adNo || '').trim().toUpperCase()) || tokens.includes(String(s.regNo || '').trim().toUpperCase()))
                    .map(s => s.regNo);

                  if (matchedRegs.length === 0) return alert('No matching students found for those Admission Numbers.');

                  setLeaderSelectedRegs(prev => Array.from(new Set([...prev, ...matchedRegs])));
                  setBulkAdNoPasteText('');
                  alert(`✅ Selected ${matchedRegs.length} students across classes! Now click the purple "🚀 Assign / Update Checked Students" button above.`);
                }}
                style={{ padding: '12px 16px', background: '#0f172a', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '800', fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                ☑️ Auto-Check Pasted Ad.Nos
              </button>
              {leaderSelectedRegs.length > 0 && (
                <button
                  type="button"
                  onClick={() => setLeaderSelectedRegs([])}
                  style={{ padding: '12px 14px', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '8px', fontWeight: '800', fontSize: '12px', cursor: 'pointer' }}
                >
                  Clear ({leaderSelectedRegs.length})
                </button>
              )}
            </div>
              <select
                value={assignLeaderUsername}
                onChange={e => setAssignLeaderUsername(e.target.value)}
                style={{ ...styles.input, maxWidth: '280px', fontWeight: '800' }}
              >
                <option value="">-- Select Target Event Leader --</option>
                {eventLeadersList.map(l => (
                  <option key={l.username} value={l.username}>{l.fullName} (@{l.username})</option>
                ))}
              </select>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <label style={{ fontSize: '12px', fontWeight: '900', color: '#4c1d95', whiteSpace: 'nowrap' }}>
                  📅 Rehearsal Ends On:
                </label>
                <input
                  type="date"
                  value={leaderAssignDeadline}
                  onChange={e => setLeaderAssignDeadline(e.target.value)}
                  style={{ ...styles.input, maxWidth: '170px', borderColor: '#7c3aed', fontWeight: '800' }}
                />
              </div>

              <button
                type="button"
                onClick={handleAssignStudentsToLeader}
                disabled={loading}
                style={{ padding: '12px 18px', background: '#7c3aed', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}
              >
                🚀 Assign / Update {leaderSelectedRegs.length} Checked Students
              </button>
            </div>

            {assignLeaderUsername && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '12px', fontWeight: '800', color: '#475569', marginBottom: '6px' }}>
                  Currently Mapped to @{assignLeaderUsername} (Shows Deadline Date • Click ✕ to remove):
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {sortStudentsForEventLeader(
                    localStudents.filter(s =>
                      (localTeachers.find(t => t.username === assignLeaderUsername)?.enrollments?.[0]?.studentIds || []).includes(s.regNo)
                    )
                  ).map(st => {
                    const dlMap = localTeachers.find(t => t.username === assignLeaderUsername)?.enrollments?.[0]?.studentDeadlines || {};
                    const stDl = dlMap[st.regNo] || 'Open';
                    return (
                      <span key={st.regNo} style={{ background: '#ede9fe', color: '#5b21b6', padding: '4px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: '800', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        [{(st.classes || []).join(',')}] {st.firstName} (#{st.adNo}) • 📅 Until: {stDl}
                        <button type="button" onClick={() => handleRemoveStudentFromLeader(assignLeaderUsername, st.regNo)} style={{ border: 'none', background: 'transparent', color: '#dc2626', cursor: 'pointer', fontWeight: '900' }}>✕</button>
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
              <input type="text" value={leaderStudentSearch} onChange={e => setLeaderStudentSearch(e.target.value)} placeholder="Search student name or Ad.No..." style={{ ...styles.input, maxWidth: '260px' }} />
              <select value={leaderFilterClass} onChange={e => setLeaderFilterClass(e.target.value)} style={{ ...styles.input, maxWidth: '180px' }}>
                <option value="All">All Classes (QLA3 ➔ AL1)</option>
                {LEADER_CLASS_ORDER.map(c => <option key={c} value={c}>Class {c}</option>)}
              </select>
              <button
                type="button"
                onClick={() => {
                  const allRegs = filteredLeaderAssignStudents.map(s => s.regNo);
                  const allChecked = allRegs.length > 0 && allRegs.every(r => leaderSelectedRegs.includes(r));
                  setLeaderSelectedRegs(allChecked ? [] : allRegs);
                }}
                style={{ padding: '10px 14px', background: '#e2e8f0', color: '#0f172a', border: 'none', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', fontSize: '12px' }}
              >
                ☑️ Select / Deselect Visible ({filteredLeaderAssignStudents.length})
              </button>
            </div>

            <div style={{ maxHeight: '340px', overflowY: 'auto', border: '1px solid #cbd5e1', borderRadius: '12px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                <thead style={{ position: 'sticky', top: 0, background: '#0f172a', color: '#ffffff' }}>
                  <tr>
                    <th style={{ padding: '10px 14px', width: '40px' }}>✓</th>
                    <th style={{ padding: '10px 14px' }}>Class</th>
                    <th style={{ padding: '10px 14px' }}>Ad.No</th>
                    <th style={{ padding: '10px 14px' }}>Student Name</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLeaderAssignStudents.map((st, idx) => {
                    const checked = leaderSelectedRegs.includes(st.regNo);
                    return (
                      <tr
                        key={st.regNo}
                        onClick={() => setLeaderSelectedRegs(prev => prev.includes(st.regNo) ? prev.filter(r => r !== st.regNo) : [...prev, st.regNo])}
                        style={{ borderBottom: '1px solid #e2e8f0', background: checked ? '#ede9fe' : idx % 2 === 0 ? '#ffffff' : '#f8fafc', cursor: 'pointer' }}
                      >
                        <td style={{ padding: '10px 14px' }}><input type="checkbox" checked={checked} readOnly /></td>
                        <td style={{ padding: '10px 14px', fontWeight: '900', color: '#4c1d95' }}>{(st.classes || []).join(', ')}</td>
                        <td style={{ padding: '10px 14px', fontWeight: '800' }}>#{st.adNo}</td>
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

      {/* ============================================================
          VIEW 3: MANAGE MINUS ATTENDANCE
         ============================================================ */}
      {activeTab === 'minus_attendance' && !isEventLeaderUser && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px' }}>
          <div style={{ background: '#ffffff', padding: '24px', borderRadius: '16px', border: '1px solid #cbd5e1' }}>
            <h3 style={{ margin: '0 0 14px 0', fontSize: '18px', color: '#dc2626', fontWeight: '900' }}>
              ⚠️ Issue Disciplinary Minus Attendance
            </h3>

            <form onSubmit={handleSaveMinus} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={styles.label}>Search Student by Name or Ad.No:</label>
                <input
                  type="text"
                  value={minusSearchQuery}
                  onChange={e => {
                    setMinusSearchQuery(e.target.value);
                    const exact = localStudents.find(s => String(s.adNo || '').toLowerCase() === e.target.value.trim().toLowerCase());
                    if (exact) setSelectedMinusStudent(exact);
                  }}
                  placeholder="Type student name or Ad.No..."
                  style={styles.input}
                />
                {matchingMinusStudents.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                    {matchingMinusStudents.map(st => (
                      <button
                        key={st.regNo}
                        type="button"
                        onClick={() => {
                          setSelectedMinusStudent(st);
                          setMinusSearchQuery(`${st.firstName} (#${st.adNo})`);
                        }}
                        style={{
                          padding: '6px 10px',
                          borderRadius: '8px',
                          border: selectedMinusStudent?.regNo === st.regNo ? '2px solid #0f766e' : '1px solid #cbd5e1',
                          background: selectedMinusStudent?.regNo === st.regNo ? '#ccfbf1' : '#f8fafc',
                          color: '#0f172a',
                          fontSize: '12px',
                          fontWeight: '800',
                          cursor: 'pointer'
                        }}
                      >
                        {st.firstName} (#{st.adNo})
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {selectedMinusStudent && (
                <div style={{ padding: '12px 14px', background: '#f0fdfa', border: '1.5px solid #0d9488', borderRadius: '10px', color: '#0f766e', fontWeight: '800', fontSize: '14px' }}>
                  🎯 Selected: <strong>{selectedMinusStudent.firstName}</strong> (#{selectedMinusStudent.adNo} • Class {(selectedMinusStudent.classes || []).join(', ')})
                  <div style={{ fontSize: '12px', color: '#dc2626', marginTop: '2px' }}>
                    Total Minus Deducted: -{selectedMinusStudentStats.minusCount || 0} Periods
                  </div>
                </div>
              )}

              <div>
                <label style={styles.label}>Minus Count (Periods to Deduct):</label>
                <input type="number" min="1" max="30" value={minusCount} onChange={e => setMinusCount(e.target.value)} required style={styles.input} />
              </div>

              <div>
                <label style={styles.label}>Reason / Law Broken:</label>
                <input type="text" value={minusReason} onChange={e => setMinusReason(e.target.value)} placeholder="e.g. Late to Fajr, Mobile Violation..." required style={styles.input} />
              </div>

              <button type="submit" disabled={loading || !selectedMinusStudent} style={{ ...styles.buttonPrimary, background: '#dc2626' }}>
                {loading ? 'Processing...' : '⚠️ Deduct Minus Attendance'}
              </button>
            </form>
          </div>

          <div style={{ background: '#ffffff', padding: '24px', borderRadius: '16px', border: '1px solid #cbd5e1' }}>
            <h3 style={{ margin: '0 0 6px 0', fontSize: '18px', color: '#0f172a', fontWeight: '900' }}>
              📜 Student's Minus History
            </h3>
            <p style={{ margin: '0 0 14px 0', fontSize: '12px', color: '#64748b', fontWeight: '600' }}>
              🔒 Only the teacher who issued a minus (or Admin) can delete that minus record.
            </p>

            {!selectedMinusStudent ? (
              <div style={{ padding: '24px', background: '#f8fafc', borderRadius: '12px', color: '#64748b', fontWeight: '700', textAlign: 'center' }}>
                Select a student on the left to view their minus logs.
              </div>
            ) : (selectedMinusStudentStats.minusLogs || []).length === 0 ? (
              <div style={{ padding: '20px', background: '#ecfdf5', borderRadius: '12px', color: '#047857', fontWeight: '800', textAlign: 'center' }}>
                ✅ {selectedMinusStudent.firstName} has 0 minus deductions!
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '420px', overflowY: 'auto' }}>
                {(selectedMinusStudentStats.minusLogs || []).map(log => {
                  const myUser = String(loggedInUser?.username || '').trim().toLowerCase();
                  const issuerUser = String(log.issuedByUsername || '').trim().toLowerCase();
                  const isMyMinusOrAdmin = userRole === 'admin' || (myUser !== '' && myUser === issuerUser);

                  return (
                    <div key={log.id} style={{ padding: '14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                      <div>
                        <div style={{ fontSize: '15px', fontWeight: '900', color: '#991b1b' }}>-{log.count} Period(s) Deducted</div>
                        <div style={{ fontSize: '13px', color: '#dc2626', fontWeight: '700', marginTop: '3px' }}>Reason: "{log.reason}"</div>
                        <div style={{ fontSize: '11px', color: '#7f1d1d', marginTop: '4px', fontWeight: '700' }}>
                          📅 {log.date} • By Usthad: <strong>{log.issuedBy}</strong>
                        </div>
                      </div>
                      {isMyMinusOrAdmin ? (
                        <button
                          type="button"
                          onClick={() => handleDeleteMinus(selectedMinusStudent, log)}
                          disabled={loading}
                          style={{ padding: '8px 12px', background: '#dc2626', color: '#ffffff', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '800', cursor: 'pointer', whiteSpace: 'nowrap' }}
                        >
                          🗑️ Delete
                        </button>
                      ) : (
                        <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '700' }}>🔒 Locked</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================================================
          VIEW 4: ADMIN NON-MARK SUBJECT CREATOR & MASS ASSIGN
         ============================================================ */}
      {activeTab === 'non_mark_subjects' && userRole === 'admin' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div style={{ background: '#ffffff', padding: '24px', borderRadius: '16px', border: '1px solid #cbd5e1' }}>
            <h3 style={{ margin: '0 0 6px 0', fontSize: '19px', color: '#0f766e', fontWeight: '900' }}>
              ➕ 1. Add Non-Mark Subject (Attendance-Only Period like Speech Practice, PKV, Economics)
            </h3>
            <form onSubmit={handleCreateNonMarkSubject} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', alignItems: 'end', marginTop: '14px' }}>
              <div>
                <label style={styles.label}>Select Teacher:</label>
                <select value={nmTeacherUsername} onChange={e => setNmTeacherUsername(e.target.value)} style={styles.input}>
                  {localTeachers.filter(t => !t.isEventLeader).map(t => <option key={t.username} value={t.username}>{t.fullName}</option>)}
                </select>
              </div>
              <div>
                <label style={styles.label}>Period / Subject Name:</label>
                <input type="text" value={nmSubjectName} onChange={e => setNmSubjectName(e.target.value)} placeholder="e.g. Speech Practice, PKV..." required style={styles.input} />
              </div>
              <div>
                <label style={styles.label}>Target Class (or Custom Group):</label>
                <select value={nmTargetClass} onChange={e => setNmTargetClass(e.target.value)} style={styles.input}>
                  <option value="CUSTOM">Custom Selected Students Only</option>
                  {DEFAULT_CLASSES.map(c => <option key={c} value={c}>Entire Class {c}</option>)}
                </select>
              </div>
              <div>
                <label style={styles.label}>Card Title (Optional):</label>
                <input type="text" value={nmAlias} onChange={e => setNmAlias(e.target.value)} placeholder="e.g. PKV QLA3" style={styles.input} />
              </div>
              <button type="submit" disabled={loading} style={{ ...styles.buttonPrimary, padding: '12px 18px' }}>
                ➕ Create Attendance-Only Subject
              </button>
            </form>
          </div>

          <div style={{ background: '#ffffff', padding: '24px', borderRadius: '16px', border: '1px solid #cbd5e1' }}>
            <h3 style={{ margin: '0 0 14px 0', fontSize: '18px', color: '#0f172a', fontWeight: '900' }}>
              👥 2. Mass Assign Students to Any Period Attendance Subject
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', marginBottom: '16px', background: '#f0fdfa', padding: '16px', borderRadius: '12px', border: '2px solid #0d9488', alignItems: 'end' }}>
              <div>
                <label style={styles.label}>1. Select Teacher:</label>
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
                <label style={styles.label}>2. Select Teacher's Period Slot:</label>
                <select value={nmSelectedEnrollmentId} onChange={e => setNmSelectedEnrollmentId(e.target.value)} style={styles.input}>
                  <option value="">-- Select Slot --</option>
                  {(localTeachers.find(t => t.username === nmTeacherUsername)?.enrollments || [])
                    .filter(ev => !isHifzEnrollment(ev))
                    .map(ev => (
                      <option key={ev.id} value={ev.id}>
                        {ev.alias || ev.subject} {isAttendanceOnlyEnrollment(ev) ? '• [Attendance-Only]' : '• [Regular]'} ({(ev.studentIds || []).length} manual IDs)
                      </option>
                    ))}
                </select>
              </div>
              <button type="button" onClick={handleMassAssignToNonMarkSubject} disabled={loading} style={{ ...styles.buttonPrimary, padding: '12px 18px' }}>
                🚀 Assign {nmSelectedStudentRegs.length} Selected Students
              </button>
            </div>

            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '14px' }}>
              <input type="text" value={nmStudentSearch} onChange={e => setNmStudentSearch(e.target.value)} placeholder="Search student name or Ad.No..." style={{ ...styles.input, maxWidth: '260px' }} />
              <select value={nmClassFilter} onChange={e => setNmClassFilter(e.target.value)} style={{ ...styles.input, maxWidth: '170px' }}>
                <option value="All">All Classes</option>
                {DEFAULT_CLASSES.map(c => <option key={c} value={c}>Class {c}</option>)}
              </select>
              <select value={nmStreamFilter} onChange={e => setNmStreamFilter(e.target.value)} style={{ ...styles.input, maxWidth: '180px' }}>
                <option value="All">All Streams</option>
                <option value="Urdu">Urdu Only</option>
                <option value="General">General Only</option>
              </select>
              <button
                type="button"
                onClick={() => {
                  const allRegs = filteredNmStudents.map(s => s.regNo);
                  const allChecked = allRegs.length > 0 && allRegs.every(r => nmSelectedStudentRegs.includes(r));
                  setNmSelectedStudentRegs(allChecked ? [] : allRegs);
                }}
                style={{ padding: '10px 14px', background: '#e2e8f0', color: '#0f172a', border: 'none', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', fontSize: '12px' }}
              >
                ☑️ Select / Deselect All Filtered ({filteredNmStudents.length})
              </button>
            </div>

            <div style={{ maxHeight: '360px', overflowY: 'auto', border: '1px solid #cbd5e1', borderRadius: '12px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                <thead style={{ position: 'sticky', top: 0, background: '#0f172a', color: '#ffffff' }}>
                  <tr>
                    <th style={{ padding: '10px 14px', width: '40px' }}>✓</th>
                    <th style={{ padding: '10px 14px' }}>Ad.No</th>
                    <th style={{ padding: '10px 14px' }}>Student Name</th>
                    <th style={{ padding: '10px 14px' }}>Class & Dept</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredNmStudents.map((st, idx) => {
                    const checked = nmSelectedStudentRegs.includes(st.regNo);
                    return (
                      <tr
                        key={st.regNo}
                        onClick={() => setNmSelectedStudentRegs(prev => prev.includes(st.regNo) ? prev.filter(r => r !== st.regNo) : [...prev, st.regNo])}
                        style={{ borderBottom: '1px solid #e2e8f0', background: checked ? '#ccfbf1' : idx % 2 === 0 ? '#ffffff' : '#f8fafc', cursor: 'pointer' }}
                      >
                        <td style={{ padding: '10px 14px' }}><input type="checkbox" checked={checked} readOnly /></td>
                        <td style={{ padding: '10px 14px', fontWeight: '800' }}>#{st.adNo}</td>
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

      {/* ============================================================
          VIEW 5: SHORTAGE REPORT (<85%), CLEARANCE & OLD SHUHOOD IMPORT
         ============================================================ */}
      {activeTab === 'shortage' && !isEventLeaderUser && (
        <div style={{ background: '#ffffff', padding: '24px', borderRadius: '16px', border: '1px solid #cbd5e1' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', flexWrap: 'wrap', gap: '12px' }}>
            <h3 style={{ margin: 0, fontSize: '19px', color: '#d97706', fontWeight: '900' }}>
              📉 Below 85% Attendance Shortage List ({shortageList.length} Students)
            </h3>
            <select value={shortageClassFilter} onChange={e => setShortageClassFilter(e.target.value)} style={{ ...styles.input, maxWidth: '200px' }}>
              <option value="ALL">All Classes</option>
              {DEFAULT_CLASSES.map(c => <option key={c} value={c}>Class {c}</option>)}
            </select>
          </div>

          <div style={{ overflowX: 'auto', border: '1px solid #cbd5e1', borderRadius: '12px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
              <thead style={{ background: '#0f172a', color: '#ffffff' }}>
                <tr>
                  <th style={{ padding: '12px 16px' }}>Student & Ad.No</th>
                  <th style={{ padding: '12px 16px' }}>Class</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center' }}>Gross Present</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center' }}>Minus</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center' }}>Net %</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right' }}>Clearance Form</th>
                </tr>
              </thead>
              <tbody>
                {shortageList.length === 0 ? (
                  <tr><td colSpan="6" style={{ padding: '24px', textAlign: 'center', color: '#059669', fontWeight: '800' }}>✅ No students below 85%!</td></tr>
                ) : (
                  shortageList.map((st, i) => (
                    <tr key={st.regNo} style={{ borderBottom: '1px solid #e2e8f0', background: i % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                      <td style={{ padding: '12px 16px', fontWeight: '800' }}>{st.firstName} (#{st.adNo})</td>
                      <td style={{ padding: '12px 16px' }}>{(st.classes || []).join(', ')}</td>
                      <td style={{ padding: '12px 16px', textAlign: 'center' }}>{st.rawPresent} / {st.totalPeriods}</td>
                      <td style={{ padding: '12px 16px', textAlign: 'center', color: '#dc2626', fontWeight: '800' }}>-{st.minusCount}</td>
                      <td style={{ padding: '12px 16px', textAlign: 'center', color: '#dc2626', fontWeight: '900' }}>{st.effectivePct}%</td>
                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                        <button type="button" onClick={() => setClearancePrintStudent(st)} style={{ padding: '7px 12px', background: '#0284c7', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '800', fontSize: '12px', cursor: 'pointer' }}>
                          🖨️ Clearance Form
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'clearance' && userRole === 'admin' && (
        <div style={{ background: '#ffffff', padding: '24px', borderRadius: '16px', border: '1px solid #cbd5e1' }}>
          <h3 style={{ margin: '0 0 14px 0', fontSize: '19px', color: '#0284c7', fontWeight: '900' }}>⚖️ Medical & Official Absence Clearance</h3>
          <form onSubmit={handleSaveClearance} style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '760px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
              <div>
                <label style={styles.label}>Student Ad.No:</label>
                <input type="text" value={clearAdNo} onChange={e => setClearAdNo(e.target.value)} required style={styles.input} />
              </div>
              <div>
                <label style={styles.label}>Clearance Type:</label>
                <select value={clearReason} onChange={e => setClearReason(e.target.value)} style={styles.input}>
                  <option value="official">📋 Official (Counts Present)</option>
                  <option value="medical">🏥 Medical (Tagged Medical)</option>
                </select>
              </div>
              <div>
                <label style={styles.label}>Date Mode:</label>
                <select value={clearDateMode} onChange={e => setClearDateMode(e.target.value)} style={styles.input}>
                  <option value="single">Mode 1: Single Date</option>
                  <option value="range">Mode 2: Date Range</option>
                </select>
              </div>
            </div>

            {clearDateMode === 'single' ? (
              <div style={{ maxWidth: '260px' }}>
                <label style={styles.label}>Select Date:</label>
                <input type="date" value={clearDate} onChange={e => setClearDate(e.target.value)} required style={styles.input} />
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', maxWidth: '500px' }}>
                <div>
                  <label style={styles.label}>Start Date:</label>
                  <input type="date" value={clearStartDate} onChange={e => setClearStartDate(e.target.value)} required style={styles.input} />
                </div>
                <div>
                  <label style={styles.label}>End Date:</label>
                  <input type="date" value={clearEndDate} onChange={e => setClearEndDate(e.target.value)} required style={styles.input} />
                </div>
              </div>
            )}

            <div>
              <label style={styles.label}>Select Subjects to Clear:</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {DEFAULT_SUBJECTS.filter(s => s.toUpperCase() !== 'HIFZ').map(sub => (
                  <button
                    key={sub}
                    type="button"
                    onClick={() => toggleClearanceSubject(sub)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '8px',
                      fontSize: '12px',
                      fontWeight: '800',
                      cursor: 'pointer',
                      border: clearSelectedSubjects.includes(sub) ? '2px solid #0284c7' : '1px solid #cbd5e1',
                      background: clearSelectedSubjects.includes(sub) ? '#0284c7' : '#f8fafc',
                      color: clearSelectedSubjects.includes(sub) ? '#ffffff' : '#0f172a'
                    }}
                  >
                    {sub}
                  </button>
                ))}
              </div>
            </div>
            <button type="submit" disabled={loading} style={{ ...styles.buttonPrimary, background: '#0284c7' }}>✅ Apply Clearance</button>
          </form>
        </div>
      )}

      {activeTab === 'import_old' && userRole === 'admin' && (
        <div style={{ background: '#ffffff', padding: '24px', borderRadius: '16px', border: '1px solid #cbd5e1', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '19px', color: '#4f46e5', fontWeight: '900' }}>
              📂 Import Old Shuhood Data (Auto-Clears Event Leader Rehearsal Dates!)
            </h3>
            <p style={{ margin: 0, fontSize: '13px', color: '#475569', fontWeight: '600', lineHeight: 1.5 }}>
              Upload your unmodified <code>shuhood_semester_export.json</code> or an Excel/CSV summary sheet from the old Shuhood portal. The importer automatically checks all dates where Event Leaders marked students Present in the new app and clears their absences on those dates (up to 2+2+3 = 7 periods per day) without touching unrecorded days!
            </p>
          </div>

          <input type="file" accept=".json,.xlsx,.xls,.csv" onChange={handleImportOldShuhoodFile} disabled={loading} style={styles.input} />

          <div style={{ padding: '16px', background: '#f5f3ff', borderRadius: '12px', border: '1.5px solid #c4b5fd', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <div style={{ fontWeight: '900', color: '#4c1d95', fontSize: '14px' }}>
                🔄 Already Uploaded Old Data? Sync Rehearsal Credits Anytime
              </div>
              <div style={{ fontSize: '12px', color: '#6d28d9', fontWeight: '600' }}>
                Click this button to apply any new Event Leader rehearsal sessions to already-imported student records by date.
              </div>
            </div>
            <button
              type="button"
              onClick={handleSyncRehearsalCreditsToExistingRecords}
              disabled={loading}
              style={{ padding: '10px 18px', background: '#7c3aed', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '800', fontSize: '13px', cursor: 'pointer' }}
            >
              🔄 Auto-Apply Rehearsal Credits by Date
            </button>
          </div>
        </div>
      )}
    </div>
  );
}