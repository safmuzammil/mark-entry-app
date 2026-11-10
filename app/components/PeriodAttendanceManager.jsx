'use client';
import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { auth, db } from '../../lib/firebase';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc, getDocs, setDoc, deleteDoc, collection, writeBatch, query, orderBy, limit } from 'firebase/firestore';
import { DEFAULT_CLASSES, DEFAULT_SUBJECTS, DHIU_LOGO_URL, styles, sortStudentsByDepartment } from './erpConstants';
import { doesClassMatchAlias, openDirectWhatsApp, resolveClassTeacherForStudent, CollapsibleCard } from './ErpExtensions';
import PeriodAttendanceReportsHub from './PeriodAttendanceReportsHub';
import PeriodAttendanceMinusAndClearance from './PeriodAttendanceMinusAndClearance';
import ClassPeriodMonitorTab from './ClassPeriodMonitorTab';

export const isHifzEnrollment = (env) => {
  const subUp = String(env?.subject || '').trim().toUpperCase();
  const aliasUp = String(env?.alias || '').trim().toUpperCase();
  return subUp === 'HIFZ' || aliasUp.includes('HIFZ');
};

export const isAttendanceOnlyEnrollment = (env) => {
  if (!env) return false;
  const subUp = String(env.subject || '').trim().toUpperCase();
  const aliasUp = String(env.alias || '').trim().toUpperCase();

  // 🌟 Specialization is strictly a MARK ENTRY subject (max 30 marks), NEVER attendance-only!
  if (
    subUp.includes('SPECIALIZATION') || aliasUp.includes('SPECIALIZATION') ||
    subUp.startsWith('TKS') || aliasUp.startsWith('TKS') ||
    subUp.includes('THAKHASUS') || aliasUp.includes('THAKHASUS')
  ) {
    return false;
  }
  if (subUp === 'MANTIQ' || subUp === 'LOGIC' || subUp.includes('U :FIQH') || subUp.includes('U:FIQH')) {
    return false;
  }

  if (env.isAttendanceOnly === true || env.onlyAttendance === true || env.nonMarkSubject === true) return true;
  const normDefault = DEFAULT_SUBJECTS.map(s => s.toUpperCase());
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
  const [recordedAbsencesByReg, setRecordedAbsencesByReg] = useState({});

  // --- 1. SUBJECT CARDS & 9-PERIOD ROLL CALL STATE ---
  const [selectedTeacherUsername, setSelectedTeacherUsername] = useState(loggedInUser?.username || '');
  const [attDate, setAttDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [attSession, setAttSession] = useState('');
  const [attEnrollmentId, setAttEnrollmentId] = useState('');
  const [classStudents, setClassStudents] = useState([]);
  const [absentRegNos, setAbsentRegNos] = useState([]);
  const [existingSessionDoc, setExistingSessionDoc] = useState(null);
  const [rehearsalPresentMapForDate, setRehearsalPresentMapForDate] = useState({});
  const [todayRecordedSessions, setTodayRecordedSessions] = useState([]);

  // 🌟 Load today's recorded sessions index for visual indicators & direct edit access
  useEffect(() => {
    async function loadTodayIndex() {
      if (!attDate) return;
      try {
        const snap = await getDoc(doc(db, 'systemCache', `daySessionsIndex_${attDate}`));
        if (snap.exists()) {
          setTodayRecordedSessions(snap.data().sessions || []);
        } else {
          setTodayRecordedSessions([]);
        }
      } catch (e) {
        setTodayRecordedSessions([]);
      }
    }
    loadTodayIndex();
  }, [attDate]);

  // 🌟 Self-heal: If localStudents or localTeachers is empty (e.g. event leader portal initial load), fetch from Firestore
  useEffect(() => {
    async function ensureStudentsAndLeaderDoc() {
      if (localStudents.length === 0) {
        try {
          const sSnap = await getDocs(collection(db, 'students'));
          const sData = [];
          sSnap.forEach(d => sData.push({ id: d.id, ...d.data() }));
          sData.sort((a, b) => (Number(a.rollNo) || 999) - (Number(b.rollNo) || 999));
          if (sData.length > 0) {
            setLocalStudents(sData);
            if (onStudentsUpdated) onStudentsUpdated(sData);
          }
        } catch (err) {
          console.warn('Student fetch fallback error:', err);
        }
      }

      if (isEventLeaderUser && loggedInUser?.username) {
        try {
          const freshSnap = await getDoc(doc(db, 'teachers', loggedInUser.username));
          if (freshSnap.exists()) {
            const freshData = { id: freshSnap.id, ...freshSnap.data() };
            setLocalTeachers(prev => {
              const updated = prev.filter(t => t.username !== loggedInUser.username);
              return [...updated, freshData];
            });
          }
        } catch (e) {
          console.warn('Leader doc refresh note:', e);
        }
      }
    }
    ensureStudentsAndLeaderDoc();
  }, [isEventLeaderUser, loggedInUser?.username, localStudents.length]);

  // --- 2. EVENT / ARTS FEST REHEARSAL LEADER STATE ---
  const [rehDate, setRehDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [rehSessionId, setRehSessionId] = useState('');
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

  // --- 3b. EVENT LEADER ATTENDANCE AUDIT & VERIFICATION STATE ---
  const [leaderManagerSubTab, setLeaderManagerSubTab] = useState('setup'); // 'setup' | 'logs'
  const [eventLeaderLogs, setEventLeaderLogs] = useState([]);
  const [loadingLeaderLogs, setLoadingLeaderLogs] = useState(false);
  const [leaderLogFilterLeader, setLeaderLogFilterLeader] = useState('ALL');
  const [leaderLogFilterDate, setLeaderLogFilterDate] = useState('');
  const [leaderLogFilterSession, setLeaderLogFilterSession] = useState('ALL');
  const [leaderLogFilterStatus, setLeaderLogFilterStatus] = useState('ALL'); // 'ALL' | 'SUBMITTED' | 'VERIFIED'
  const [leaderLogSearch, setLeaderLogSearch] = useState('');
  const [inspectingLeaderLog, setInspectingLeaderLog] = useState(null);

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

  // Load Active Out-Passes, Rehearsal Stamps & Night Attendance Recorded Absences for `attDate`
  useEffect(() => {
    async function loadOutpassesAndRehearsalStamps() {
      try {
        const [opSnap, rehSnap, recSnap, naSnap] = await Promise.all([
          getDocs(collection(db, 'out_passes')),
          getDoc(doc(db, 'systemCache', `rehearsalStamp_${attDate}`)),
          getDoc(doc(db, 'systemCache', 'recordedStudentAbsences')),
          getDoc(doc(db, 'night_attendance', attDate))
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

          const isReturned = status === 'RETURNED' || status === 'ARRIVED_AT_GATE' || Boolean(data.actualReturnTime || data.verifiedReturnedAt || data.teacherVerifiedTime);
          const isCurrentlyOutside = (status === 'APPROVED' || status === 'OUTSIDE') && !isReturned;
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
                isReturned,
                isCurrentlyOutside,
                actualReturnTime: data.actualReturnTime || data.verifiedReturnedAt || data.gateArrivalTime,
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

        // 🌟 Map Recorded Absences, Medical Leaves & Official Leaves from Night Attendance
        const absMap = {};
        const allRecs = [];

        if (recSnap.exists()) {
          const recData = recSnap.data() || {};
          const absencesDict = recData.absences || {};
          Object.values(absencesDict).forEach(r => {
            if (r && !r.isCancelled) allRecs.push(r);
          });
        }

        if (naSnap.exists()) {
          const naData = naSnap.data() || {};
          const classPre = naData.preRecordedAbsences || {};
          Object.values(classPre).forEach(subMap => {
            if (subMap && typeof subMap === 'object') {
              Object.values(subMap).forEach(r => {
                if (r && !r.isCancelled) {
                  const cleanAd = String(r.adNo || '').trim().toUpperCase();
                  if (!allRecs.some(x => String(x.adNo || '').trim().toUpperCase() === cleanAd)) {
                    allRecs.push(r);
                  }
                }
              });
            }
          });
        }

        const todayStr = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;

        allRecs.forEach(rec => {
          const cleanAd = String(rec.adNo || '').trim().toUpperCase();
          const cleanReg = String(rec.studentRegNo || '').trim().toUpperCase();

          const startDate = rec.startDate || rec.date || '';
          const endDate = rec.hasDuration && rec.endDate ? rec.endDate : startDate;

          if (startDate && attDate < startDate) return;
          if (endDate && attDate > endDate) return;

          if (rec.hasDuration && rec.endDateTimeIso) {
            const endMs = new Date(rec.endDateTimeIso).getTime();
            if (!isNaN(endMs) && attDate === todayStr && Date.now() > endMs) {
              return; // Expired!
            }
          }

          const stStatus = String(rec.status || 'ABSENT').toUpperCase();
          const reasonLower = String(rec.reason || '').toLowerCase();
          const isOfficial = stStatus === 'OFFICIAL' || reasonLower.includes('official') || reasonLower.includes('outreach') || reasonLower.includes('duty');
          const isMedical = stStatus === 'SICK_ROOM' || reasonLower.includes('sick') || reasonLower.includes('fever') || reasonLower.includes('medical') || reasonLower.includes('hospital') || reasonLower.includes('doctor');

          const recObj = {
            status: stStatus,
            reason: rec.reason || '',
            isOfficial,
            isMedical,
            recordedBy: rec.recordedBy || 'Teacher',
            hasDuration: Boolean(rec.hasDuration),
            endDate: rec.endDate,
            endTime: rec.endTime
          };

          const matchedSt = localStudents.find(
            s => (cleanAd && String(s.adNo || '').trim().toUpperCase() === cleanAd) ||
                 (cleanReg && String(s.regNo || '').trim().toUpperCase() === cleanReg)
          );

          if (matchedSt) {
            if (matchedSt.regNo) absMap[matchedSt.regNo] = recObj;
            if (matchedSt.adNo) absMap[String(matchedSt.adNo).trim().toUpperCase()] = recObj;
            if (matchedSt.id) absMap[String(matchedSt.id).trim()] = recObj;
          } else {
            if (cleanAd) absMap[cleanAd] = recObj;
            if (cleanReg) absMap[cleanReg] = recObj;
          }
        });

        setRecordedAbsencesByReg(absMap);

        if (rehSnap.exists()) {
          setRehearsalPresentMapForDate(rehSnap.data().periodPresentRegs || {});
        } else {
          let localRehStamp = null;
          if (typeof window !== 'undefined') {
            try {
              const str = localStorage.getItem('dhiu_reh_stamp_' + attDate);
              if (str) localRehStamp = JSON.parse(str);
            } catch (_) {}
          }
          setRehearsalPresentMapForDate(localRehStamp?.periodPresentRegs || {});
        }
      } catch (e) {
        console.error('Error syncing out_passes and recorded absences:', e);
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

  const rawAttendanceEnrollments = (Array.isArray(activeTeacherObj?.enrollments) ? activeTeacherObj.enrollments : [])
    .filter(env => !isHifzEnrollment(env) && !env.isRehearsalSlot);

  // Group and merge Dirasathul Adyan into Logic so only Logic is ever displayed
  const attendanceEnrollments = rawAttendanceEnrollments.filter(env => {
    const s = ((env.Sub || env.subject || '') + ' ' + (env.Alias || env.alias || '') + ' ' + (env.id || '')).toUpperCase();
    return !s.includes('DIRASATH') && !s.includes('ADYAN');
  });

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
      const env = attendanceEnrollments.find(e => String(e.id) === String(attEnrollmentId)) || attendanceEnrollments[0];
      if (!env) return;

      const safeAlias = String(env.alias || env.subject || 'Subject').trim();
      const safeAliasKey = safeAlias.replace(/[^a-zA-Z0-9]/g, '_');
      const envUniqueKey = String(env.id || env.targetClass || env.subject || '').replace(/[^a-zA-Z0-9]/g, '_');
      const sessionDocId = `periodSession_${attDate}_${safeAliasKey}_${envUniqueKey}_S${attSession}`;
      const legacyDocId = `periodSession_${attDate}_${safeAliasKey}_S${attSession}`;

      try {
        let snap = await getDoc(doc(db, 'systemCache', sessionDocId));
        if (!snap.exists()) {
          snap = await getDoc(doc(db, 'systemCache', legacyDocId));
        }
        if (!snap.exists() && (env.subject === 'Logic' || String(env.alias || '').toUpperCase().includes('LOGIC'))) {
          const targetCls = (env.targetClass || '').toUpperCase();
          const fallbackIds = [
            `periodSession_${attDate}_LOGIC_${targetCls}_S${attSession}`,
            `periodSession_${attDate}_MANTHIQ_${targetCls}_S${attSession}`,
            `periodSession_${attDate}_DIRASATHUL_ADYAN_${targetCls}_S${attSession}`,
            `periodSession_${attDate}_DIRASATHUL_ADYAN__${targetCls}_S${attSession}`
          ];
          for (const fid of fallbackIds) {
            const fSnap = await getDoc(doc(db, 'systemCache', fid));
            if (fSnap.exists()) {
              snap = fSnap;
              break;
            }
          }
        }

        if (!snap.exists()) {
          const idxSnap = await getDoc(doc(db, 'systemCache', `daySessionsIndex_${attDate}`));
          if (idxSnap.exists()) {
            const list = idxSnap.data().sessions || [];
            const subKey = normalizeSubKey(isAttendanceOnlyEnrollment(env) ? safeAlias : (env.subject || safeAlias));
            const matchedItem = list.find(s => Number(s.session) === Number(attSession) && (s.subject === subKey || s.sessionDocId?.includes(safeAliasKey)));
            if (matchedItem && matchedItem.sessionDocId) {
              snap = await getDoc(doc(db, 'systemCache', matchedItem.sessionDocId));
            }
          }
        }

        if (snap.exists()) {
          const data = snap.data();
          setExistingSessionDoc({ id: snap.id, ...data });
          const attMap = data.attendanceMap || {};
          const rehPresentForThisPeriod = rehearsalPresentMapForDate[String(attSession)] || [];
          const abs = Object.keys(attMap).filter(k => {
            const val = attMap[k];
            if (val !== 'A' && val !== 'M') return false;
            const strK = String(k).trim().toUpperCase();
            const isReh = rehPresentForThisPeriod.some(r => String(r).trim().toUpperCase() === strK);
            return !isReh;
          }).map(k => String(k).trim());
          setAbsentRegNos(abs);
        } else {
          setExistingSessionDoc(null);
          const enrolledSts = getStudentsForEnrollment(env);
          const rehPresentForThisPeriod = rehearsalPresentMapForDate[String(attSession)] || [];
          const autoAbs = enrolledSts
            .filter(st => {
              const sReg = String(st.regNo || '').trim();
              const sAd = String(st.adNo || '').trim();
              const sId = String(st.id || '').trim();
              if (rehPresentForThisPeriod.some(r => {
                const str = String(r || '').trim().toUpperCase();
                return (sReg && str === sReg.toUpperCase()) || 
                       (sAd && str === sAd.toUpperCase()) || 
                       (sId && str === sId.toUpperCase());
              })) return false;
              const op = activeOutpassesByReg[sReg] || (sAd && activeOutpassesByReg[sAd]) || (sId && activeOutpassesByReg[sId]);
              if (op && !op.isOfficial && op.isCurrentlyOutside) return true;

              const recAbs = recordedAbsencesByReg[sReg] || (sAd && recordedAbsencesByReg[sAd]) || (sId && recordedAbsencesByReg[sId]);
              if (recAbs && !recAbs.isOfficial) return true;

              return false;
            })
            .map(st => String(st.regNo || st.id).trim());
          setAbsentRegNos(autoAbs);
        }
      } catch (e) {
        console.warn('Error loading session doc:', e);
        setExistingSessionDoc(null);
      }
    }
    checkExistingSession();
  }, [attEnrollmentId, attDate, attSession, rehearsalPresentMapForDate, activeOutpassesByReg, recordedAbsencesByReg]);

  const toggleAbsent = (regNo) => {
    const sReg = String(regNo || '').trim();
    if (!sReg) return;
    setAbsentRegNos(prev => {
      const exists = prev.some(r => String(r).trim() === sReg);
      return exists
        ? prev.filter(r => String(r).trim() !== sReg)
        : [...prev, sReg];
    });
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
    if (!updatedMapByReg || typeof updatedMapByReg !== 'object') return;
    const nextList = localStudents.map(s => {
      const sReg = String(s.regNo || '').trim();
      const sId = String(s.id || '').trim();
      const match = updatedMapByReg[sReg] ||
                    updatedMapByReg[sId] ||
                    updatedMapByReg[sReg.toLowerCase()] ||
                    updatedMapByReg[sReg.toUpperCase()] ||
                    updatedMapByReg[sId.toLowerCase()] ||
                    updatedMapByReg[sId.toUpperCase()];
      return match ? { ...s, ...match } : s;
    });
    setLocalStudents(nextList);
    if (onStudentsUpdated) onStudentsUpdated(nextList);
  };

  const absentStudentsByClassGroups = React.useMemo(() => {
    const rehPresentHere = rehearsalPresentMapForDate[String(attSession)] || [];
    const currentAbsentStudents = classStudents.filter(st => {
      const sReg = String(st.regNo || '').trim();
      const sAd = String(st.adNo || '').trim();
      const sId = String(st.id || '').trim();
      const isReh = rehPresentHere.some(r => {
        const str = String(r || '').trim().toUpperCase();
        return (sReg && str === sReg.toUpperCase()) || 
               (sAd && str === sAd.toUpperCase()) || 
               (sId && str === sId.toUpperCase());
      });
      const op = activeOutpassesByReg[sReg] || (sAd && activeOutpassesByReg[sAd]) || (sId && activeOutpassesByReg[sId]);
      const recAbs = recordedAbsencesByReg[sReg] || (sAd && recordedAbsencesByReg[sAd]) || (sId && recordedAbsencesByReg[sId]);
      const isAutoOfficial = isReh || (op && op.isOfficial) || (recAbs && recAbs.isOfficial);
      const isMarkedAbsent = absentRegNos.some(r => {
        const str = String(r).trim().toUpperCase();
        return (sReg && str === sReg.toUpperCase()) || (sAd && str === sAd.toUpperCase()) || (sId && str === sId.toUpperCase());
      });
      return !isAutoOfficial && isMarkedAbsent;
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
  }, [classStudents, absentRegNos, rehearsalPresentMapForDate, attSession, activeOutpassesByReg, recordedAbsencesByReg, localTeachers]);

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
      const envUniqueKey = String(env.id || env.targetClass || env.subject || '').replace(/[^a-zA-Z0-9]/g, '_');
      const sessionDocId = `periodSession_${attDate}_${safeAlias.replace(/[^a-zA-Z0-9]/g, '_')}_${envUniqueKey}_S${attSession}`;
      const subKey = normalizeSubKey(isAttendanceOnlyEnrollment(env) ? safeAlias : (env.subject || safeAlias));
      const safeTeacherUsername = String(activeTeacherObj?.username || loggedInUser?.username || 'faculty').toLowerCase().trim();
      const safeTeacherName = String(activeTeacherObj?.fullName || loggedInUser?.fullName || 'Faculty').trim();

            const rehPresentList = rehearsalPresentMapForDate[String(attSession)] || [];
      const sessionRef = doc(db, 'systemCache', sessionDocId);
      let previousMap = existingSessionDoc?.attendanceMap || null;
      try {
        const freshSnap = await getDoc(sessionRef);
        if (freshSnap.exists()) {
          previousMap = freshSnap.data().attendanceMap || previousMap;
        }
      } catch (err) {
        console.warn('Could not re-fetch session cache:', err);
      }
      const newAttendanceMap = {};

      classStudents.forEach(st => {
        const reg = String(st.regNo || st.id || '').trim();
        if (!reg) return;
        const sReg = String(st.regNo || '').trim();
        const sAd = String(st.adNo || '').trim();
        const sId = String(st.id || '').trim();
        const isMarkedAbsentByRegularTeacher = absentRegNos.some(r => {
          const str = String(r).trim().toUpperCase();
          return (sReg && str === sReg.toUpperCase()) || (sAd && str === sAd.toUpperCase()) || (sId && str === sId.toUpperCase());
        });
        const isRehearsalPresent = rehPresentList.some(r => {
          const str = String(r || '').trim().toUpperCase();
          return (sReg && str === sReg.toUpperCase()) || 
                 (sAd && str === sAd.toUpperCase()) || 
                 (sId && str === sId.toUpperCase());
        });
        const op = activeOutpassesByReg[sReg] || (sAd && activeOutpassesByReg[sAd]) || (sId && activeOutpassesByReg[sId]);
        const recAbs = recordedAbsencesByReg[sReg] || (sAd && recordedAbsencesByReg[sAd]) || (sId && recordedAbsencesByReg[sId]);

        if (isRehearsalPresent) {
          newAttendanceMap[reg] = 'P'; // 🌟 Converted to ACTUAL PRESENT per user logic!
        } else if (recAbs && recAbs.isOfficial) {
          newAttendanceMap[reg] = 'O'; // 🌟 Official Duty from recorded absence / leave!
        } else if (op && op.isCurrentlyOutside && op.isOfficial) {
          newAttendanceMap[reg] = 'O'; // 🌟 Official Gate Outpass
        } else if (recAbs && recAbs.isMedical) {
          newAttendanceMap[reg] = 'M'; // 🌟 Medical leave from recorded absence (e.g. sick in room / hospital)!
        } else if (op && op.isCurrentlyOutside) {
          newAttendanceMap[reg] = 'M'; // 🌟 Permitted leave from Gate Outpass
        } else if (recAbs && isMarkedAbsentByRegularTeacher) {
          newAttendanceMap[reg] = recAbs.status === 'SICK_ROOM' ? 'M' : 'A';
        } else if (!isMarkedAbsentByRegularTeacher) {
          newAttendanceMap[reg] = 'P';
        } else {
          newAttendanceMap[reg] = 'A';
        }
      });

      const updatedStudentsByReg = {};
      for (let i = 0; i < classStudents.length; i += 400) {
        const chunk = classStudents.slice(i, i + 400);
        const stBatch = writeBatch(db);

        chunk.forEach(st => {
          const reg = String(st.regNo || st.id || '').trim();
          const docId = String(st.id || st.regNo || '').trim();
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
          const updatedObj = { ...st, periodAttendance: curStat };
          updatedStudentsByReg[reg] = updatedObj;
          if (reg.toLowerCase() !== reg) updatedStudentsByReg[reg.toLowerCase()] = updatedObj;
          if (reg.toUpperCase() !== reg) updatedStudentsByReg[reg.toUpperCase()] = updatedObj;
          if (st.id) updatedStudentsByReg[st.id] = updatedObj;
        });

        await stBatch.commit();
      }

      const sessionMeta = {
        sessionDocId,
        session: Number(attSession) || 1,
        subject: subKey,
        enrollmentId: env.id,
        targetClass: env.targetClass || '',
        classAlias: safeAlias,
        teacherUsername: safeTeacherUsername,
        teacherName: safeTeacherName,
        attendanceMap: newAttendanceMap
      };

      try {
        await setDoc(doc(db, 'systemCache', sessionDocId), {
          date: attDate,
          session: Number(attSession) || 1,
          subject: subKey,
          enrollmentId: env.id,
          targetClass: env.targetClass || '',
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
          sessionMeta
        ];
        await setDoc(dayIndexRef, { date: attDate, sessions: updatedSessionsList }, { merge: true });
      } catch (cacheErr) {
        console.warn('Session cache note:', cacheErr);
      }

      syncUpdatedStudentsState(updatedStudentsByReg);

      const recordedAbs = Object.keys(newAttendanceMap)
        .filter(k => newAttendanceMap[k] === 'A' || newAttendanceMap[k] === 'M')
        .map(k => String(k).trim());
      setAbsentRegNos(recordedAbs);
      setExistingSessionDoc({
        id: sessionDocId,
        date: attDate,
        session: Number(attSession) || 1,
        subject: subKey,
        enrollmentId: env.id,
        targetClass: env.targetClass || '',
        classAlias: safeAlias,
        isAttendanceOnly: Boolean(isAttendanceOnlyEnrollment(env)),
        teacherUsername: safeTeacherUsername,
        teacherName: safeTeacherName,
        attendanceMap: newAttendanceMap,
        updatedAt: new Date().toISOString()
      });

      // Update today's recorded list in state
      setTodayRecordedSessions(prev => {
        const filtered = prev.filter(x => x.sessionDocId !== sessionDocId);
        return [...filtered, sessionMeta];
      });

      const presentTotal = Object.values(newAttendanceMap).filter(v => v === 'P' || v === 'O').length;

      // 🌟 Return to Subject Cards Dashboard so teacher sees immediate confirmation that it has been recorded
      setActiveTab('cards');
      setStatusMsg(`✅ Period ${attSession} Attendance (${safeAlias}) Successfully Recorded! (${presentTotal} Present, ${classStudents.length - presentTotal} Absent)`);
      // Reset form to initial clean state
      setAttSession('');
      setAttEnrollmentId('');
      setClassStudents([]);
      setAbsentRegNos([]);
      setExistingSessionDoc(null);
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
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
    const ids = new Set();
    const envs = Array.isArray(activeLeaderObj?.enrollments) ? activeLeaderObj.enrollments : [];
    envs.forEach(e => {
      if (Array.isArray(e?.studentIds)) {
        e.studentIds.forEach(id => { if (id) ids.add(String(id).trim()); });
      }
    });
    if (Array.isArray(activeLeaderObj?.assignedStudentIds)) {
      activeLeaderObj.assignedStudentIds.forEach(id => { if (id) ids.add(String(id).trim()); });
    }
    return Array.from(ids);
  }, [activeLeaderObj]);

  const leaderStudentDeadlinesMap = React.useMemo(() => {
    const deadlines = { ...(activeLeaderObj?.studentDeadlines || {}) };
    const envs = Array.isArray(activeLeaderObj?.enrollments) ? activeLeaderObj.enrollments : [];
    envs.forEach(e => {
      if (e?.studentDeadlines && typeof e.studentDeadlines === 'object') {
        Object.assign(deadlines, e.studentDeadlines);
      }
    });
    return deadlines;
  }, [activeLeaderObj]);

  const leaderMinDate = React.useMemo(() => {
    if (activeLeaderObj?.createdAt) {
      return String(activeLeaderObj.createdAt).slice(0, 10);
    }
    return '';
  }, [activeLeaderObj]);

  const leaderMaxDate = React.useMemo(() => {
    const deadlines = Object.values(leaderStudentDeadlinesMap).filter(Boolean);
    if (activeLeaderObj?.deadline) deadlines.push(activeLeaderObj.deadline);
    if (activeLeaderObj?.expiryDate) deadlines.push(activeLeaderObj.expiryDate);
    if (deadlines.length > 0) {
      return deadlines.sort().reverse()[0];
    }
    return '';
  }, [leaderStudentDeadlinesMap, activeLeaderObj]);

  useEffect(() => {
    if (isEventLeaderUser && leaderMinDate && rehDate < leaderMinDate) {
      setRehDate(leaderMinDate);
    } else if (isEventLeaderUser && leaderMaxDate && rehDate > leaderMaxDate) {
      setRehDate(leaderMaxDate);
    }
  }, [leaderMinDate, leaderMaxDate, isEventLeaderUser]);

  const leaderStudentsSorted = React.useMemo(() => {
    const savedUpper = leaderAssignedStudentIds.map(id => String(id).trim().toUpperCase());
    const matched = localStudents.filter(st => {
      const sReg = String(st.regNo || '').trim().toUpperCase();
      const sAd = String(st.adNo || '').trim().toUpperCase();
      const sId = String(st.id || '').trim().toUpperCase();
      const isAssigned = (sReg && savedUpper.includes(sReg)) ||
                         (sAd && savedUpper.includes(sAd)) ||
                         (sId && savedUpper.includes(sId));
      if (!isAssigned) return false;
      const dl = leaderStudentDeadlinesMap[sReg] ||
                 (sAd && leaderStudentDeadlinesMap[sAd]) ||
                 (sId && leaderStudentDeadlinesMap[sId]) ||
                 st.rehearsalDeadline || '';
      if (dl && rehDate > dl) return false;
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
          const localStr = typeof window !== 'undefined' ? localStorage.getItem('dhiu_reh_' + docId) : null;
          if (localStr) {
            const data = JSON.parse(localStr);
            setExistingRehDoc(data);
            setRehAbsentRegNos(data.absentRegNos || []);
          } else {
            setExistingRehDoc(null);
            setRehAbsentRegNos([]);
          }
        }
      } catch (e) {
        const localStr = typeof window !== 'undefined' ? localStorage.getItem('dhiu_reh_' + docId) : null;
        if (localStr) {
          try {
            const data = JSON.parse(localStr);
            setExistingRehDoc(data);
            setRehAbsentRegNos(data.absentRegNos || []);
          } catch (_) {
            setExistingRehDoc(null);
          }
        } else {
          setExistingRehDoc(null);
        }
      }
    }
    loadExistingRehearsal();
  }, [activeLeaderObj?.username, rehDate, rehSessionId]);

  const handleSaveRehearsalAttendance = async (e) => {
    e.preventDefault();
    if (!rehSessionId) {
      return alert('⚠️ Mandatory Step: Please select a Rehearsal Sitting before saving attendance.');
    }
    if (!activeLeaderObj || leaderStudentsSorted.length === 0) {
      return alert('No active students assigned for this date.');
    }

    if (leaderMinDate && rehDate < leaderMinDate) {
      return alert(`⛔ Date Restricted: Rehearsal attendance can only be taken starting from the account creation date (${leaderMinDate}). You cannot take attendance for earlier dates.`);
    }
    if (leaderMaxDate && rehDate > leaderMaxDate) {
      return alert(`⛔ Date Restricted: Rehearsal event validity ended on ${leaderMaxDate}. You cannot take attendance after the deadline.`);
    }

    const sessionConfig = REHEARSAL_SESSIONS.find(s => s.id === rehSessionId) || REHEARSAL_SESSIONS[0];
    const coveredPeriods = sessionConfig.coveredPeriods;
    const presentRegs = leaderStudentsSorted.filter(st => !rehAbsentRegNos.includes(st.regNo)).map(st => st.regNo);

    setLoading(true);
    setStatusMsg('');
    try {
      const rehDocId = `rehearsalSession_${rehDate}_${activeLeaderObj.username}_${rehSessionId}`;

      // 1. In-memory sync for student tracking (Do not pollute students' academic subjectWise with REHEARSAL)
      const updatedStudentsByReg = {};
      leaderStudentsSorted.forEach(st => {
        const reg = String(st.regNo || st.id || '').trim();
        const docId = String(st.id || st.regNo || '').trim();
        if (!reg || !docId) return;

        const curStat = JSON.parse(JSON.stringify(getStudentAttStat(st)));
        // Note: Students academic subjects are preserved without adding REHEARSAL to academic records
        curStat.updatedAt = new Date().toISOString();
        const updatedObj = { ...st, periodAttendance: curStat };
        updatedStudentsByReg[reg] = updatedObj;
        if (reg.toLowerCase() !== reg) updatedStudentsByReg[reg.toLowerCase()] = updatedObj;
        if (reg.toUpperCase() !== reg) updatedStudentsByReg[reg.toUpperCase()] = updatedObj;
        if (st.id) updatedStudentsByReg[st.id] = updatedObj;
      });

      // 2. Immediately sync in-memory React state so the register and cards reflect it instantly
      syncUpdatedStudentsState(updatedStudentsByReg);

      // 3. Update in-memory rehearsalPresentMapForDate
      setRehearsalPresentMapForDate(prev => {
        const next = { ...prev };
        coveredPeriods.forEach(pNum => {
          const prevList = Array.isArray(next[String(pNum)]) ? next[String(pNum)] : [];
          const filtered = prevList.filter(r => !rehAbsentRegNos.includes(r));
          next[String(pNum)] = Array.from(new Set([...filtered, ...presentRegs]));
        });
        return next;
      });

      // 4. Update existingRehDoc state
      setExistingRehDoc({ date: rehDate, sessionId: rehSessionId, sessionLabel: sessionConfig.label, coveredPeriods, presentRegNos: presentRegs, absentRegNos: rehAbsentRegNos });

      // 5. Save locally in localStorage for 100% offline-first reliability
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('dhiu_reh_' + rehDocId, JSON.stringify({
            date: rehDate,
            sessionId: rehSessionId,
            sessionLabel: sessionConfig.label,
            coveredPeriods,
            presentRegNos: presentRegs,
            absentRegNos: rehAbsentRegNos,
            updatedAt: new Date().toISOString()
          }));

          const localStampStr = localStorage.getItem('dhiu_reh_stamp_' + rehDate);
          const localStampData = localStampStr ? JSON.parse(localStampStr) : {};
          const localStampPresent = localStampData.periodPresentRegs || {};
          coveredPeriods.forEach(pNum => {
            const prevList = Array.isArray(localStampPresent[String(pNum)]) ? localStampPresent[String(pNum)] : [];
            const filtered = prevList.filter(r => !rehAbsentRegNos.includes(r));
            localStampPresent[String(pNum)] = Array.from(new Set([...filtered, ...presentRegs]));
          });
          localStorage.setItem('dhiu_reh_stamp_' + rehDate, JSON.stringify({
            date: rehDate,
            periodPresentRegs: localStampPresent,
            updatedAt: new Date().toISOString()
          }));
        } catch (_) {}
      }

      // 6. Sync to Firestore in the background
      try {
        const batch = writeBatch(db);
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

        const rehAttendanceMap = {};
        leaderStudentsSorted.forEach(st => {
          const reg = String(st.regNo || st.id || '').trim();
          if (!reg) return;
          const isAbsent = rehAbsentRegNos.includes(reg);
          rehAttendanceMap[reg] = isAbsent ? 'A' : 'O';
        });

        for (const pNum of coveredPeriods) {
          const pSessionDocId = `periodSession_${rehDate}_Rehearsal_${rehSessionId}_S${pNum}`;
          await setDoc(doc(db, 'systemCache', pSessionDocId), {
            date: rehDate,
            session: Number(pNum),
            subject: `REHEARSAL_${rehSessionId.toUpperCase()}`,
            classAlias: `Rehearsal - ${sessionConfig.label || 'Event'}`,
            isRehearsal: true,
            isAttendanceOnly: true,
            teacherUsername: activeLeaderObj.username,
            teacherName: activeLeaderObj.fullName || 'Event Leader',
            attendanceMap: rehAttendanceMap,
            updatedAt: new Date().toISOString()
          }, { merge: true });
        }

        // 🌟 Dedicated Storage for Event Leader Attendance Verification & Admin Audit
        const eventLeaderRecord = {
          id: `eventLeaderAtt_${rehDate}_${activeLeaderObj.username}_${rehSessionId}`,
          date: rehDate,
          sessionId: rehSessionId,
          sessionLabel: sessionConfig.label || 'Rehearsal',
          sessionTime: sessionConfig.time || '',
          coveredPeriods,
          weight: sessionConfig.weight || 1,
          leaderUsername: activeLeaderObj.username,
          leaderName: activeLeaderObj.fullName || 'Event Leader',
          totalAssigned: leaderStudentsSorted.length,
          presentCount: presentRegs.length,
          absentCount: rehAbsentRegNos.length,
          presentRegNos: presentRegs,
          absentRegNos: rehAbsentRegNos,
          students: leaderStudentsSorted.map(st => ({
            regNo: st.regNo,
            adNo: st.adNo,
            name: st.firstName,
            classes: st.classes || [st.class] || [],
            status: rehAbsentRegNos.includes(st.regNo) ? 'ABSENT' : 'PRESENT'
          })),
          status: 'SUBMITTED',
          savedAt: new Date().toISOString(),
          verifiedAt: null,
          verifiedBy: null,
          adminNotes: ''
        };

        try {
          await setDoc(doc(db, 'event_leader_attendance', eventLeaderRecord.id), eventLeaderRecord, { merge: true });
          await setDoc(doc(db, 'systemCache', `eventLeaderLog_${rehDate}_${activeLeaderObj.username}_${rehSessionId}`), eventLeaderRecord, { merge: true });
          if (typeof window !== 'undefined') {
            localStorage.setItem('dhiu_event_leader_att_' + eventLeaderRecord.id, JSON.stringify(eventLeaderRecord));
          }
        } catch (logErr) {
          console.warn('Dedicated event leader log write note:', logErr);
        }

        const dayIndexRef = doc(db, 'systemCache', `daySessionsIndex_${rehDate}`);
        const dayIndexSnap = await getDoc(dayIndexRef);
        const existingList = dayIndexSnap.exists() ? (dayIndexSnap.data().sessions || []) : [];
        const newEntries = coveredPeriods.map(pNum => ({
          sessionDocId: `periodSession_${rehDate}_Rehearsal_${rehSessionId}_S${pNum}`,
          session: Number(pNum),
          subject: `REHEARSAL_${rehSessionId.toUpperCase()}`,
          classAlias: `Rehearsal - ${sessionConfig.label || 'Event'}`,
          attendanceMap: rehAttendanceMap,
          teacherName: activeLeaderObj.fullName || 'Event Leader'
        }));
        const filteredList = existingList.filter(x => !newEntries.some(n => n.sessionDocId === x.sessionDocId));
        await setDoc(dayIndexRef, { date: rehDate, sessions: [...filteredList, ...newEntries] }, { merge: true });

        // 🌟 Retroactively convert any absence in existing regular teacher sessions for coveredPeriods to Present!
        try {
          const matchedRegularSessions = existingList.filter(s =>
            coveredPeriods.includes(Number(s.session)) &&
            !String(s.subject || '').startsWith('REHEARSAL')
          );

          for (const sess of matchedRegularSessions) {
            if (!sess.sessionDocId) continue;
            const sRef = doc(db, 'systemCache', sess.sessionDocId);
            const sSnap = await getDoc(sRef);
            if (!sSnap.exists()) continue;
            const sData = sSnap.data();
            const attMap = { ...(sData.attendanceMap || {}) };
            let sessionChanged = false;

            presentRegs.forEach(pReg => {
              const strReg = String(pReg || '').trim();
              if (!strReg) return;
              const matchedKey = Object.keys(attMap).find(k => String(k).trim().toUpperCase() === strReg.toUpperCase());
              const currentVal = matchedKey ? attMap[matchedKey] : null;

              if (currentVal === 'A' || currentVal === 'M' || currentVal === 'O') {
                const targetKey = matchedKey || strReg;
                attMap[targetKey] = 'P'; // Converted to actual present!
                sessionChanged = true;

                // Also update student's subject record
                const st = localStudents.find(s =>
                  String(s.regNo || '').trim().toUpperCase() === strReg.toUpperCase() ||
                  String(s.adNo || '').trim().toUpperCase() === strReg.toUpperCase() ||
                  String(s.id || '').trim().toUpperCase() === strReg.toUpperCase()
                );
                if (st) {
                  const targetDocId = String(st.id || st.regNo || '').trim();
                  const curStat = updatedStudentsByReg[strReg]?.periodAttendance ||
                                  updatedStudentsByReg[targetDocId]?.periodAttendance ||
                                  JSON.parse(JSON.stringify(getStudentAttStat(st)));
                  const subKey = sess.subject || 'GENERAL';
                  if (curStat.subjectWise && curStat.subjectWise[subKey]) {
                    const subObj = curStat.subjectWise[subKey];
                    if (Array.isArray(subObj.absentDates) && subObj.absentDates.includes(rehDate)) {
                      subObj.absentDates = subObj.absentDates.filter(d => d !== rehDate);
                      subObj.present = (Number(subObj.present) || 0) + 1;
                      curStat.presentCount = (Number(curStat.presentCount) || 0) + 1;
                      curStat.updatedAt = new Date().toISOString();
                      const updatedObj = { ...st, periodAttendance: curStat };
                      updatedStudentsByReg[strReg] = updatedObj;
                      updatedStudentsByReg[targetDocId] = updatedObj;
                    }
                  }
                }
              }
            });

            if (sessionChanged) {
              await setDoc(sRef, { attendanceMap: attMap, updatedAt: new Date().toISOString() }, { merge: true });
            }
          }
        } catch (retroErr) {
          console.warn('Retroactive regular session reconciliation note:', retroErr);
        }

        // Update students in Firestore
        for (let i = 0; i < leaderStudentsSorted.length; i += 400) {
          const chunk = leaderStudentsSorted.slice(i, i + 400);
          const stBatch = writeBatch(db);
          chunk.forEach(st => {
            const reg = String(st.regNo || st.id || '').trim();
            const docId = String(st.id || st.regNo || '').trim();
            if (!reg || !docId) return;
            const up = updatedStudentsByReg[reg] || updatedStudentsByReg[docId];
            if (up && up.periodAttendance) {
              stBatch.set(doc(db, 'students', docId), { periodAttendance: up.periodAttendance }, { merge: true });
            }
          });
          await stBatch.commit();
        }
        syncUpdatedStudentsState(updatedStudentsByReg);
      } catch (cloudErr) {
        console.warn('Rehearsal Firestore background sync note (local device cache active):', cloudErr);
      }

      setStatusMsg(`✅ Rehearsal Attendance Recorded to Period Register (${presentRegs.length} Present, ${rehAbsentRegNos.length} Absent)!`);
      // Reset rehearsal form to initial clean state
      setRehSessionId('');
      setRehAbsentRegNos([]);
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } catch (err) {
      console.error('Error saving rehearsal attendance:', err);
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

  // 🌟 Load & Query Event Leader Attendance Logs
  const loadEventLeaderLogs = async () => {
    setLoadingLeaderLogs(true);
    try {
      const logs = [];
      const seenIds = new Set();

      // 1. Fetch from dedicated event_leader_attendance collection
      try {
        const snap = await getDocs(query(collection(db, 'event_leader_attendance'), orderBy('savedAt', 'desc'), limit(200)));
        snap.forEach(d => {
          seenIds.add(d.id);
          logs.push({ id: d.id, ...d.data() });
        });
      } catch (err) {
        console.warn('Query event_leader_attendance note:', err);
      }

      // 2. Also scan systemCache for any existing/older rehearsalSession_ docs
      try {
        const cacheSnap = await getDocs(query(collection(db, 'systemCache'), limit(400)));
        cacheSnap.forEach(d => {
          if (d.id.startsWith('rehearsalSession_')) {
            const data = d.data();
            const logId = `eventLeaderAtt_${data.date}_${data.leaderUsername}_${data.sessionId}`;
            if (!seenIds.has(logId) && !seenIds.has(d.id)) {
              seenIds.add(d.id);
              const presRegs = data.presentRegNos || [];
              const absRegs = data.absentRegNos || [];
              const allRegs = Array.from(new Set([...presRegs, ...absRegs]));
              const studentRecs = allRegs.map(reg => {
                const st = localStudents.find(s => s.regNo === reg || s.id === reg || s.adNo === reg);
                return {
                  regNo: reg,
                  adNo: st?.adNo || reg,
                  name: st?.firstName || 'Student',
                  classes: st?.classes || [st?.class] || [],
                  status: absRegs.includes(reg) ? 'ABSENT' : 'PRESENT'
                };
              });
              logs.push({
                id: d.id,
                date: data.date,
                sessionId: data.sessionId,
                sessionLabel: data.sessionLabel || 'Rehearsal',
                coveredPeriods: data.coveredPeriods || [],
                weight: data.weight || 1,
                leaderUsername: data.leaderUsername,
                leaderName: data.leaderName || 'Event Leader',
                totalAssigned: allRegs.length,
                presentCount: presRegs.length,
                absentCount: absRegs.length,
                presentRegNos: presRegs,
                absentRegNos: absRegs,
                students: studentRecs,
                status: data.verifiedAt ? 'VERIFIED' : 'SUBMITTED',
                savedAt: data.updatedAt || `${data.date}T00:00:00Z`,
                verifiedAt: data.verifiedAt || null,
                verifiedBy: data.verifiedBy || null
              });
            }
          }
        });
      } catch (err) {
        console.warn('systemCache fallback scan note:', err);
      }

      logs.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
      setEventLeaderLogs(logs);
    } catch (err) {
      console.error('Error loading event leader logs:', err);
    } finally {
      setLoadingLeaderLogs(false);
    }
  };

  const handleVerifyLeaderLog = async (logItem) => {
    if (!window.confirm(`Confirm verification for Event Leader attendance marked by ${logItem.leaderName} on ${logItem.date} (${logItem.sessionLabel})?`)) return;

    setLoading(true);
    try {
      const nowIso = new Date().toISOString();
      const patch = {
        status: 'VERIFIED',
        verifiedAt: nowIso,
        verifiedBy: loggedInUser?.username || 'admin',
        verifiedByName: loggedInUser?.fullName || 'Central Admin'
      };

      const ref = doc(db, 'event_leader_attendance', logItem.id);
      await setDoc(ref, patch, { merge: true });

      try {
        const cacheRef = doc(db, 'systemCache', logItem.id);
        await setDoc(cacheRef, patch, { merge: true });
      } catch (_) {}

      setEventLeaderLogs(prev => prev.map(l => l.id === logItem.id ? { ...l, ...patch } : l));
      if (inspectingLeaderLog && inspectingLeaderLog.id === logItem.id) {
        setInspectingLeaderLog(prev => ({ ...prev, ...patch }));
      }

      alert('✅ Verified and confirmed event leader attendance record.');
    } catch (err) {
      console.error('Error verifying log:', err);
      alert('Error verifying record: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleExportLeaderLogsExcel = () => {
    if (filteredLeaderLogs.length === 0) return alert('No records to export.');

    const rows = filteredLeaderLogs.map((l, idx) => ({
      '#': idx + 1,
      'DATE': l.date,
      'LEADER NAME': l.leaderName,
      'LEADER USERNAME': l.leaderUsername,
      'SITTING / SESSION': l.sessionLabel,
      'COVERED PERIODS': (l.coveredPeriods || []).join(', '),
      'TOTAL STUDENTS': l.totalAssigned,
      'PRESENT COUNT': l.presentCount,
      'ABSENT COUNT': l.absentCount,
      'ATTENDANCE %': l.totalAssigned > 0 ? `${((l.presentCount / l.totalAssigned) * 100).toFixed(1)}%` : '100%',
      'VERIFICATION STATUS': l.status === 'VERIFIED' ? `Verified by ${l.verifiedBy || 'Admin'}` : 'Pending Verification',
      'SUBMITTED AT': l.savedAt ? String(l.savedAt).replace('T', ' ').substring(0, 19) : ''
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'EventLeaderAttendance');
    XLSX.writeFile(wb, `Event_Leader_Attendance_Summary_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const filteredLeaderLogs = useMemo(() => {
    return eventLeaderLogs.filter(l => {
      if (leaderLogFilterLeader !== 'ALL' && l.leaderUsername !== leaderLogFilterLeader) return false;
      if (leaderLogFilterDate && l.date !== leaderLogFilterDate) return false;
      if (leaderLogFilterSession !== 'ALL' && l.sessionId !== leaderLogFilterSession) return false;
      if (leaderLogFilterStatus !== 'ALL' && l.status !== leaderLogFilterStatus) return false;
      if (leaderLogSearch.trim()) {
        const q = leaderLogSearch.trim().toLowerCase();
        const matchLeader = String(l.leaderName || '').toLowerCase().includes(q) || String(l.leaderUsername || '').toLowerCase().includes(q);
        const matchStudent = (l.students || []).some(s =>
          String(s.name || '').toLowerCase().includes(q) || String(s.adNo || '').toLowerCase().includes(q)
        );
        if (!matchLeader && !matchStudent) return false;
      }
      return true;
    });
  }, [eventLeaderLogs, leaderLogFilterLeader, leaderLogFilterDate, leaderLogFilterSession, leaderLogFilterStatus, leaderLogSearch]);

  const leaderAggregatedStats = useMemo(() => {
    const map = {};
    filteredLeaderLogs.forEach(l => {
      const u = l.leaderUsername || 'unknown';
      if (!map[u]) {
        map[u] = {
          username: u,
          fullName: l.leaderName || u,
          sessionsCount: 0,
          totalAssigned: 0,
          presentCount: 0,
          absentCount: 0
        };
      }
      map[u].sessionsCount += 1;
      map[u].totalAssigned += Number(l.totalAssigned) || 0;
      map[u].presentCount += Number(l.presentCount) || 0;
      map[u].absentCount += Number(l.absentCount) || 0;
    });
    return Object.values(map);
  }, [filteredLeaderLogs]);

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

  const myCtClasses = React.useMemo(() => {
    const set = new Set();
    const direct = activeTeacherObj?.outpassPrivileges?.classTeacherOf || activeTeacherObj?.classTeacherOf;
    if (Array.isArray(direct)) direct.forEach(c => set.add(String(c).toUpperCase().trim()));
    else if (direct) set.add(String(direct).toUpperCase().trim());

    const myUser = String(loggedInUser?.username || activeTeacherObj?.username || '').toLowerCase().trim();
    if (myUser && Array.isArray(localStudents)) {
      localStudents.forEach(st => {
        const ctU = String(st.classTeacherUsername || '').toLowerCase().trim();
        if (ctU && ctU === myUser) {
          (st.classes || [st.class]).filter(Boolean).forEach(c => set.add(String(c).toUpperCase().trim()));
        }
      });
    }
    return Array.from(set);
  }, [activeTeacherObj, loggedInUser, localStudents]);

  const teacherAllowedStudentRegs = React.useMemo(() => {
    const set = new Set();
    (attendanceEnrollments || []).forEach(env => {
      const enrolled = getStudentsForEnrollment ? getStudentsForEnrollment(env) : [];
      enrolled.forEach(st => set.add(String(st.regNo || st.id || '').trim()));
      if (Array.isArray(env.studentIds)) {
        env.studentIds.forEach(id => set.add(String(id).trim()));
      }
    });
    if (myCtClasses.length > 0 && Array.isArray(localStudents)) {
      localStudents.forEach(st => {
        const stClasses = (st.classes || [st.class] || []).map(c => String(c).toUpperCase().trim());
        if (stClasses.some(c => myCtClasses.includes(c))) {
          set.add(String(st.regNo || st.id || '').trim());
        }
      });
    }
    return set;
  }, [attendanceEnrollments, myCtClasses, localStudents]);

  const shortageCount = localStudents.filter(st => {
    if (userRole !== 'admin') {
      const reg = String(st.regNo || st.id || '').trim();
      const ad = String(st.adNo || '').trim().toUpperCase();
      const stClasses = (st.classes || [st.class] || []).map(c => String(c).toUpperCase().trim());
      const isCtStudent = stClasses.some(c => myCtClasses.includes(c));
      const isTeachingStudent = teacherAllowedStudentRegs.has(reg) || teacherAllowedStudentRegs.has(ad) || teacherAllowedStudentRegs.has(st.regNo);
      if (!isCtStudent && !isTeachingStudent) return false;
    }
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
              { id: 'live_monitor', match: ['live_monitor'], label: '⏱️ Class & Period Monitor' },
              { id: 'reports_hub', match: ['reports_hub'], label: 'Monthly / Daily / Total Reports' },
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

                    {/* Recorded Periods Status for Today */}
                    {(() => {
                      const subKey = normalizeSubKey(isAttendanceOnlyEnrollment(env) ? (env.alias || env.subject) : env.subject);
                      const envUniqueKey = String(env.id || env.targetClass || '').replace(/[^a-zA-Z0-9]/g, '_');
                      const eAliasClean = String(env.alias || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
                      const eSubClean = String(env.subject || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
                      const eTargetClean = String(env.targetClass || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

                      const recordedSessions = todayRecordedSessions.filter(s => {
                        if (s.enrollmentId && s.enrollmentId === env.id) return true;
                        if (envUniqueKey && s.sessionDocId?.includes(envUniqueKey)) return true;

                        const sSub = String(s.subject || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
                        const sAlias = String(s.classAlias || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
                        const sDocId = String(s.sessionDocId || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

                        // 1. Direct clean alias match (e.g. "QLA3THAMADUN" in "QLA3THAMADUN")
                        if (eAliasClean && (sAlias.includes(eAliasClean) || sSub.includes(eAliasClean) || sDocId.includes(eAliasClean))) {
                          return true;
                        }

                        // 2. Target class + Subject match (both must match to avoid cross-batch pollution)
                        if (eTargetClean && (sAlias.includes(eTargetClean) || sDocId.includes(eTargetClean))) {
                          if (eSubClean && (sSub.includes(eSubClean) || sAlias.includes(eSubClean))) {
                            return true;
                          }
                        }

                        // 3. Fallback only if no specific alias or class is present
                        if (!eAliasClean && !eTargetClean && eSubClean && sSub === eSubClean) {
                          return true;
                        }
                        return false;
                      });

                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                          {recordedSessions.length > 0 && (
                            <div style={{ background: '#ecfdf5', padding: '6px 10px', borderRadius: '8px', border: '1px solid #a7f3d0', fontSize: '11px', fontWeight: '700', color: '#065f46', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                              <span>✓ Recorded on {attDate}:</span>
                              {recordedSessions.map(r => (
                                <button
                                  key={r.session}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setAttEnrollmentId(env.id);
                                    setAttSession(String(r.session));
                                    setActiveTab('mark_sheet');
                                  }}
                                  style={{
                                    padding: '2px 7px',
                                    borderRadius: '5px',
                                    background: '#10b981',
                                    color: '#ffffff',
                                    border: 'none',
                                    fontWeight: '800',
                                    fontSize: '10px',
                                    cursor: 'pointer'
                                  }}
                                >
                                  Period {r.session} (Edit)
                                </button>
                              ))}
                            </div>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              setAttEnrollmentId(env.id);
                              setAttSession('');
                              setExistingSessionDoc(null);
                              setActiveTab('mark_sheet');
                            }}
                            style={{
                              width: '100%',
                              padding: '11px',
                              background: recordedSessions.length > 0 ? '#059669' : '#4f46e5',
                              color: '#ffffff',
                              border: 'none',
                              borderRadius: '8px',
                              fontWeight: '700',
                              fontSize: '13px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '6px'
                            }}
                          >
                            <span>{recordedSessions.length > 0 ? '➕ Mark / Edit Another Period' : 'Mark Attendance'}</span>
                          </button>
                        </div>
                      );
                    })()}
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
                <option value="">-- ⚠️ Mandatory: Select Period (1 to 9) --</option>
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
                {(() => {
                  let medCount = 0;
                  let offCount = 0;
                  let unexcusedCount = 0;
                  let presentCount = 0;

                  classStudents.forEach(st => {
                    const sReg = String(st.regNo || '').trim();
                    const sAd = String(st.adNo || '').trim();
                    const sId = String(st.id || '').trim();
                    const rehPresentHere = (rehearsalPresentMapForDate[String(attSession)] || []).some(r => {
                      const str = String(r || '').trim().toUpperCase();
                      return (sReg && str === sReg.toUpperCase()) || 
                             (sAd && str === sAd.toUpperCase()) || 
                             (sId && str === sId.toUpperCase());
                    });
                    const op = activeOutpassesByReg[sReg] || (sAd && activeOutpassesByReg[sAd]) || (sId && activeOutpassesByReg[sId]);
                    const recAbs = recordedAbsencesByReg[sReg] || (sAd && recordedAbsencesByReg[sAd]) || (sId && recordedAbsencesByReg[sId]);
                    const isOfficialPass = Boolean((op && op.isOfficial) || (recAbs && recAbs.isOfficial));
                    const isAbsent = !rehPresentHere && !isOfficialPass && absentRegNos.some(r => {
                      const str = String(r).trim().toUpperCase();
                      return (sReg && str === sReg.toUpperCase()) || (sAd && str === sAd.toUpperCase()) || (sId && str === sId.toUpperCase());
                    });

                    if (isOfficialPass) {
                      offCount++;
                    } else if (recAbs?.isMedical && isAbsent) {
                      medCount++;
                    } else if (isAbsent) {
                      unexcusedCount++;
                    } else {
                      presentCount++;
                    }
                  });

                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                      <span style={{ color: '#0f172a' }}>Total: {classStudents.length}</span>
                      <span style={{ color: '#047857' }}>Present: {presentCount}</span>
                      <span style={{ color: '#e11d48' }}>Absent: {unexcusedCount}</span>
                      <span style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#d97706', padding: '2px 8px', borderRadius: '6px', fontSize: '12px' }}>
                        🤒 Medical: {medCount}
                      </span>
                      <span style={{ background: '#f0fdfa', border: '1px solid #99f6e4', color: '#0d9488', padding: '2px 8px', borderRadius: '6px', fontSize: '12px' }}>
                        🏛️ Official: {offCount}
                      </span>
                    </div>
                  );
                })()}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button type="button" onClick={() => setAbsentRegNos([])} style={{ padding: '5px 10px', background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', borderRadius: '6px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}>All Present</button>
                  <button
                    type="button"
                    onClick={() => {
                      const rehPresentList = rehearsalPresentMapForDate[String(attSession)] || [];
                      const nonRehRegs = classStudents.filter(s => {
                        const sReg = String(s.regNo || '').trim();
                        const sAd = String(s.adNo || '').trim();
                        const sId = String(s.id || '').trim();
                        const isReh = rehPresentList.some(r => {
                          const str = String(r || '').trim().toUpperCase();
                          return (sReg && str === sReg.toUpperCase()) || (sAd && str === sAd.toUpperCase()) || (sId && str === sId.toUpperCase());
                        });
                        return !isReh;
                      }).map(s => s.regNo);
                      setAbsentRegNos(nonRehRegs);
                    }}
                    style={{ padding: '5px 10px', background: '#fff1f2', color: '#e11d48', border: '1px solid #fecdd3', borderRadius: '6px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}
                  >
                    All Absent
                  </button>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(265px, 1fr))', gap: '10px', maxHeight: '480px', overflowY: 'auto', marginBottom: '20px' }}>
                {classStudents.map(st => {
                  const sReg = String(st.regNo || '').trim();
                  const sAd = String(st.adNo || '').trim();
                  const sId = String(st.id || '').trim();
                  const rehPresentHere = (rehearsalPresentMapForDate[String(attSession)] || []).some(r => {
                    const str = String(r || '').trim().toUpperCase();
                    return (sReg && str === sReg.toUpperCase()) || 
                           (sAd && str === sAd.toUpperCase()) || 
                           (sId && str === sId.toUpperCase());
                  });
                  const op = activeOutpassesByReg[sReg] || (sAd && activeOutpassesByReg[sAd]) || (sId && activeOutpassesByReg[sId]);
                  const recAbs = recordedAbsencesByReg[sReg] || (sAd && recordedAbsencesByReg[sAd]) || (sId && recordedAbsencesByReg[sId]);
                  const isOfficialPass = Boolean((op && op.isOfficial) || (recAbs && recAbs.isOfficial));
                  const isAbsent = !rehPresentHere && !isOfficialPass && absentRegNos.some(r => {
                    const str = String(r).trim().toUpperCase();
                    return (sReg && str === sReg.toUpperCase()) || (sAd && str === sAd.toUpperCase()) || (sId && str === sId.toUpperCase());
                  });

                  return (
                    <div
                      key={st.regNo}
                      onClick={() => {
                        if (rehPresentHere) {
                          alert(`🎭 ${st.firstName} (#${st.adNo}) is marked Present in Rehearsal by Event Leader and will be automatically recorded as Present.`);
                          return;
                        }
                        if (isOfficialPass && (op?.isCurrentlyOutside || recAbs?.isOfficial)) return;
                        toggleAbsent(st.regNo);
                      }}
                      style={{
                        padding: '12px 14px',
                        borderRadius: '10px',
                        cursor: rehPresentHere ? 'default' : (isOfficialPass && (op?.isCurrentlyOutside || recAbs?.isOfficial)) ? 'default' : 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: '8px',
                        background: rehPresentHere ? '#f5f3ff' : isOfficialPass ? '#f0fdfa' : (recAbs?.isMedical && isAbsent) ? '#fffbeb' : isAbsent ? '#fff1f2' : '#ecfdf5',
                        border: `1.5px solid ${rehPresentHere ? '#8b5cf6' : isOfficialPass ? '#0d9488' : (recAbs?.isMedical && isAbsent) ? '#fde68a' : isAbsent ? '#f43f5e' : '#10b981'}`
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
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginTop: '5px', background: '#e0e7ff', color: '#4338ca', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: '800' }}>
                            🎭 Rehearsal Present (Converts to Present)
                          </span>
                        )}
                        {recAbs && (
                          <div style={{ marginTop: '6px', background: recAbs.isMedical ? '#fffbeb' : recAbs.isOfficial ? '#f0fdfa' : '#fff1f2', color: recAbs.isMedical ? '#92400e' : recAbs.isOfficial ? '#0f766e' : '#be123c', padding: '6px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: '600', lineHeight: 1.35, border: `1px solid ${recAbs.isMedical ? '#fde68a' : recAbs.isOfficial ? '#99f6e4' : '#fecdd3'}` }}>
                            <div>
                              <strong>{recAbs.isMedical ? '🤒 Medical Leave / Sick' : recAbs.isOfficial ? '🏛️ Official Duty' : '🔴 Pre-Recorded Absence'}:</strong> &ldquo;{recAbs.reason || 'Leave'}&rdquo;
                              {recAbs.hasDuration && recAbs.endDate ? ` (Until ${recAbs.endDate} ${recAbs.endTime || ''})` : ''}
                            </div>
                            <div style={{ fontSize: '10px', marginTop: '2px', color: recAbs.isMedical ? '#b45309' : recAbs.isOfficial ? '#0d9488' : '#e11d48' }}>
                              Recorded by: Usthad {recAbs.recordedBy}
                            </div>
                          </div>
                        )}
                        {op && op.isCurrentlyOutside && !recAbs && (
                          <div style={{ marginTop: '6px', background: '#fffbeb', color: '#92400e', padding: '6px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: '600', lineHeight: 1.35, border: '1px solid #fde68a' }}>
                            <div>🪪 <strong>Outside Campus ({op.category} Leave):</strong> {op.destination}</div>
                            <div style={{ fontSize: '10px', marginTop: '2px', color: '#b45309' }}>
                              Reason: &ldquo;{op.reason || op.category}&rdquo; • Approved by: Usthad {op.teacherName} • Expected Return: {op.toFormatted}
                            </div>
                          </div>
                        )}
                      </div>
                      <span style={{
                        padding: '4px 10px',
                        borderRadius: '6px',
                        fontWeight: '800',
                        fontSize: '11px',
                        background: rehPresentHere ? '#7c3aed' : isOfficialPass ? '#0d9488' : (recAbs?.isMedical && isAbsent) ? '#d97706' : isAbsent ? '#e11d48' : '#10b981',
                        color: '#ffffff',
                        whiteSpace: 'nowrap'
                      }}>
                        {rehPresentHere ? '🎭 REHEARSAL' : isOfficialPass ? 'OFFICIAL' : (recAbs?.isMedical && isAbsent) ? '🤒 MEDICAL' : isAbsent ? 'ABSENT' : 'PRESENT'}
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
              <input
                type="date"
                value={rehDate}
                min={leaderMinDate || undefined}
                max={leaderMaxDate || undefined}
                onChange={e => setRehDate(e.target.value)}
                style={styles.input}
              />
              {leaderMinDate && (
                <div style={{ fontSize: '11px', color: '#6366f1', marginTop: '4px', fontWeight: '700' }}>
                  📅 Valid Window: {leaderMinDate} {leaderMaxDate ? `to ${leaderMaxDate}` : 'onwards'}
                </div>
              )}
            </div>
            <div>
              <label style={{ ...styles.label, color: !rehSessionId ? '#e11d48' : '#475569' }}>
                Select Rehearsal Sitting *Mandatory
              </label>
              <select
                value={rehSessionId}
                onChange={e => setRehSessionId(e.target.value)}
                required
                style={{
                  ...styles.input,
                  border: !rehSessionId ? '1.5px solid #e11d48' : '1.5px solid #10b981',
                  background: !rehSessionId ? '#fff1f2' : '#ffffff',
                  fontWeight: '700'
                }}
              >
                <option value="">-- ⚠️ Mandatory: Select Rehearsal Sitting --</option>
                {REHEARSAL_SESSIONS.map(s => (
                  <option key={s.id} value={s.id}>{s.label} ({s.time})</option>
                ))}
              </select>
            </div>
          </div>

          {!rehSessionId ? (
            <div style={{ padding: '32px 24px', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '12px', textAlign: 'center', color: '#475569', fontWeight: '700', fontSize: '14px' }}>
              👆 Please select a Rehearsal Sitting from the dropdown above to load the roll-call sheet.
            </div>
          ) : leaderStudentsSorted.length === 0 ? (
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

          {/* INSPECTION MODAL FOR EVENT LEADER ATTENDANCE RECORD */}
          {inspectingLeaderLog && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2500, padding: '16px' }}>
              <div style={{ background: '#ffffff', padding: '28px', borderRadius: '16px', maxWidth: '780px', width: '100%', color: '#0f172a', maxHeight: '85vh', overflowY: 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '14px', marginBottom: '18px' }}>
                  <div>
                    <span style={{ background: '#eef2ff', color: '#4f46e5', padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: '800' }}>
                      🎭 {inspectingLeaderLog.sessionLabel || 'Rehearsal Sitting'}
                    </span>
                    <h3 style={{ margin: '6px 0 0', fontSize: '18px', fontWeight: '800' }}>
                      {inspectingLeaderLog.date} • Marked by {inspectingLeaderLog.leaderName} (@{inspectingLeaderLog.leaderUsername})
                    </h3>
                  </div>
                  <button type="button" onClick={() => setInspectingLeaderLog(null)} style={{ background: '#fee2e2', color: '#dc2626', border: 'none', padding: '6px 12px', borderRadius: '8px', fontWeight: '800', cursor: 'pointer' }}>✕ Close</button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px', marginBottom: '18px', background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                  <div><strong style={{ color: '#64748b', fontSize: '11px' }}>COVERED PERIODS:</strong> <div style={{ fontWeight: '800' }}>Periods {(inspectingLeaderLog.coveredPeriods || []).join(', ')}</div></div>
                  <div><strong style={{ color: '#64748b', fontSize: '11px' }}>TOTAL ASSIGNED:</strong> <div style={{ fontWeight: '800' }}>{inspectingLeaderLog.totalAssigned} Students</div></div>
                  <div><strong style={{ color: '#047857', fontSize: '11px' }}>PRESENT:</strong> <div style={{ fontWeight: '800', color: '#047857' }}>{inspectingLeaderLog.presentCount} ({inspectingLeaderLog.totalAssigned > 0 ? ((inspectingLeaderLog.presentCount / inspectingLeaderLog.totalAssigned) * 100).toFixed(1) : 100}%)</div></div>
                  <div><strong style={{ color: '#e11d48', fontSize: '11px' }}>ABSENT:</strong> <div style={{ fontWeight: '800', color: '#e11d48' }}>{inspectingLeaderLog.absentCount}</div></div>
                  <div>
                    <strong style={{ color: '#64748b', fontSize: '11px' }}>STATUS:</strong>
                    <div>
                      <span style={{
                        padding: '2px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: '800',
                        background: inspectingLeaderLog.status === 'VERIFIED' ? '#ecfdf5' : '#fffbeb',
                        color: inspectingLeaderLog.status === 'VERIFIED' ? '#047857' : '#b45309'
                      }}>
                        {inspectingLeaderLog.status === 'VERIFIED' ? `✅ Verified by ${inspectingLeaderLog.verifiedBy || 'Admin'}` : '⏳ Pending Verification'}
                      </span>
                    </div>
                  </div>
                </div>

                <div style={{ marginBottom: '18px' }}>
                  <div style={{ fontWeight: '800', fontSize: '13px', color: '#0f172a', marginBottom: '10px' }}>
                    Student Roll-Call Breakdown ({(inspectingLeaderLog.students || []).length} Students):
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '8px', maxHeight: '340px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '10px' }}>
                    {(inspectingLeaderLog.students || []).map((st, idx) => {
                      const isAbs = st.status === 'ABSENT';
                      return (
                        <div
                          key={st.regNo || idx}
                          style={{
                            padding: '8px 12px',
                            borderRadius: '8px',
                            background: isAbs ? '#fff1f2' : '#f0fdf4',
                            border: isAbs ? '1px solid #fecdd3' : '1px solid #bbf7d0',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '8px'
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: '700', fontSize: '12px', color: '#0f172a' }}>{st.name}</div>
                            <div style={{ fontSize: '11px', color: '#64748b' }}>#{st.adNo} • {(st.classes || []).join(', ')}</div>
                          </div>
                          <span style={{
                            padding: '2px 8px', borderRadius: '6px', fontSize: '10px', fontWeight: '800',
                            background: isAbs ? '#e11d48' : '#10b981', color: '#ffffff'
                          }}>
                            {isAbs ? 'ABSENT' : 'PRESENT'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', borderTop: '1px solid #e2e8f0', paddingTop: '14px' }}>
                  {inspectingLeaderLog.status !== 'VERIFIED' && (
                    <button
                      type="button"
                      onClick={() => handleVerifyLeaderLog(inspectingLeaderLog)}
                      disabled={loading}
                      style={styles.buttonPrimary}
                    >
                      {loading ? 'Verifying...' : '✅ Confirm & Mark Verified'}
                    </button>
                  )}
                  <button type="button" onClick={() => setInspectingLeaderLog(null)} style={styles.buttonSecondary}>
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* SUB-TABS: LEADER ACCOUNTS vs ATTENDANCE LOGS & VERIFICATION */}
          <div style={{ display: 'flex', gap: '8px', background: '#f1f5f9', padding: '4px', borderRadius: '10px', width: 'fit-content' }}>
            <button
              type="button"
              onClick={() => setLeaderManagerSubTab('setup')}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                fontWeight: '800',
                fontSize: '13px',
                cursor: 'pointer',
                border: 'none',
                background: leaderManagerSubTab === 'setup' ? '#4f46e5' : 'transparent',
                color: leaderManagerSubTab === 'setup' ? '#ffffff' : '#64748b',
                boxShadow: leaderManagerSubTab === 'setup' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                transition: 'all 0.15s ease'
              }}
            >
              👥 Leader Accounts &amp; Student Mappings
            </button>
            <button
              type="button"
              onClick={() => {
                setLeaderManagerSubTab('logs');
                loadEventLeaderLogs();
              }}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                fontWeight: '800',
                fontSize: '13px',
                cursor: 'pointer',
                border: 'none',
                background: leaderManagerSubTab === 'logs' ? '#4f46e5' : 'transparent',
                color: leaderManagerSubTab === 'logs' ? '#ffffff' : '#64748b',
                boxShadow: leaderManagerSubTab === 'logs' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                transition: 'all 0.15s ease'
              }}
            >
              📋 Event Leader Attendance Logs &amp; Verification
            </button>
          </div>

          {leaderManagerSubTab === 'setup' ? (
            <>
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
            </>
          ) : (
            /* ============================================================
               VIEW 2B-2: EVENT LEADER ATTENDANCE AUDIT, SUMMARY & VERIFICATION
               ============================================================ */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

              {/* KPI STRIP */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                <div style={{ background: '#ffffff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                  <div style={{ fontSize: '11px', fontWeight: '800', color: '#64748b' }}>TOTAL SESSIONS LOGGED</div>
                  <div style={{ fontSize: '24px', fontWeight: '900', color: '#0f172a', marginTop: '4px' }}>{filteredLeaderLogs.length}</div>
                </div>
                <div style={{ background: '#ffffff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                  <div style={{ fontSize: '11px', fontWeight: '800', color: '#64748b' }}>STUDENT SITTINGS CHECKED</div>
                  <div style={{ fontSize: '24px', fontWeight: '900', color: '#4f46e5', marginTop: '4px' }}>
                    {filteredLeaderLogs.reduce((acc, l) => acc + (Number(l.totalAssigned) || 0), 0)}
                  </div>
                </div>
                <div style={{ background: '#ecfdf5', padding: '16px', borderRadius: '12px', border: '1px solid #a7f3d0', textAlign: 'center' }}>
                  <div style={{ fontSize: '11px', fontWeight: '800', color: '#047857' }}>TOTAL PRESENT</div>
                  <div style={{ fontSize: '24px', fontWeight: '900', color: '#065f46', marginTop: '4px' }}>
                    {filteredLeaderLogs.reduce((acc, l) => acc + (Number(l.presentCount) || 0), 0)}
                  </div>
                </div>
                <div style={{ background: '#fff1f2', padding: '16px', borderRadius: '12px', border: '1px solid #fecdd3', textAlign: 'center' }}>
                  <div style={{ fontSize: '11px', fontWeight: '800', color: '#be123c' }}>TOTAL ABSENT</div>
                  <div style={{ fontSize: '24px', fontWeight: '900', color: '#9f1239', marginTop: '4px' }}>
                    {filteredLeaderLogs.reduce((acc, l) => acc + (Number(l.absentCount) || 0), 0)}
                  </div>
                </div>
                <div style={{ background: '#ffffff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                  <div style={{ fontSize: '11px', fontWeight: '800', color: '#64748b' }}>VERIFICATION STATUS</div>
                  <div style={{ fontSize: '18px', fontWeight: '800', color: '#0f172a', marginTop: '6px' }}>
                    <span style={{ color: '#059669' }}>{filteredLeaderLogs.filter(l => l.status === 'VERIFIED').length} Verified</span>
                    {' • '}
                    <span style={{ color: '#d97706' }}>{filteredLeaderLogs.filter(l => l.status !== 'VERIFIED').length} Pending</span>
                  </div>
                </div>
              </div>

              {/* FILTER TOOLBAR */}
              <div style={styles.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '14px' }}>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <select
                      value={leaderLogFilterLeader}
                      onChange={e => setLeaderLogFilterLeader(e.target.value)}
                      style={{ ...styles.input, width: 'auto', fontWeight: '700' }}
                    >
                      <option value="ALL">All Event Leaders ({eventLeadersList.length})</option>
                      {eventLeadersList.map(l => (
                        <option key={l.username} value={l.username}>{l.fullName} (@{l.username})</option>
                      ))}
                    </select>

                    <input
                      type="date"
                      value={leaderLogFilterDate}
                      onChange={e => setLeaderLogFilterDate(e.target.value)}
                      style={{ ...styles.input, width: 'auto' }}
                    />
                    {leaderLogFilterDate && (
                      <button type="button" onClick={() => setLeaderLogFilterDate('')} style={{ fontSize: '11px', color: '#64748b', background: 'transparent', border: 'none', cursor: 'pointer' }}>✕ Clear Date</button>
                    )}

                    <select
                      value={leaderLogFilterSession}
                      onChange={e => setLeaderLogFilterSession(e.target.value)}
                      style={{ ...styles.input, width: 'auto' }}
                    >
                      <option value="ALL">All Sittings</option>
                      {REHEARSAL_SESSIONS.map(s => (
                        <option key={s.id} value={s.id}>{s.label}</option>
                      ))}
                    </select>

                    <select
                      value={leaderLogFilterStatus}
                      onChange={e => setLeaderLogFilterStatus(e.target.value)}
                      style={{ ...styles.input, width: 'auto' }}
                    >
                      <option value="ALL">All Statuses</option>
                      <option value="SUBMITTED">Pending Verification</option>
                      <option value="VERIFIED">Verified Only</option>
                    </select>

                    <input
                      type="text"
                      value={leaderLogSearch}
                      onChange={e => setLeaderLogSearch(e.target.value)}
                      placeholder="🔍 Search leader or student name..."
                      style={{ ...styles.input, width: '220px' }}
                    />
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="button" onClick={loadEventLeaderLogs} disabled={loadingLeaderLogs} style={styles.buttonSecondary}>
                      {loadingLeaderLogs ? '⏳ Loading...' : '🔄 Refresh Logs'}
                    </button>
                    <button type="button" onClick={handleExportLeaderLogsExcel} style={styles.buttonPrimary}>
                      📥 Export Excel
                    </button>
                  </div>
                </div>

                {/* SUMMARY BY LEADER BREAKDOWN */}
                {leaderAggregatedStats.length > 0 && (
                  <div style={{ marginBottom: '20px', padding: '14px', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontWeight: '800', fontSize: '13px', color: '#0f172a', marginBottom: '8px' }}>
                      Leader Attendance Summary Breakdown ({leaderAggregatedStats.length} Leaders):
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '10px' }}>
                      {leaderAggregatedStats.map(s => {
                        const pct = s.totalAssigned > 0 ? ((s.presentCount / s.totalAssigned) * 100).toFixed(1) : '100.0';
                        return (
                          <div key={s.username} style={{ background: '#ffffff', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                              <div style={{ fontWeight: '800', fontSize: '13px', color: '#0f172a' }}>{s.fullName}</div>
                              <div style={{ fontSize: '11px', color: '#64748b' }}>@{s.username} • {s.sessionsCount} sessions</div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontWeight: '800', fontSize: '13px', color: '#047857' }}>{s.presentCount}/{s.totalAssigned} Pres</div>
                              <div style={{ fontSize: '11px', color: '#64748b' }}>{pct}% rate ({s.absentCount} abs)</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* DETAILED SESSIONS TABLE */}
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '11px', fontWeight: '800', textTransform: 'uppercase' }}>
                        <th style={{ padding: '12px 14px' }}>#</th>
                        <th style={{ padding: '12px 14px' }}>DATE</th>
                        <th style={{ padding: '12px 14px' }}>EVENT LEADER</th>
                        <th style={{ padding: '12px 14px' }}>SITTING &amp; PERIODS</th>
                        <th style={{ padding: '12px 14px', textAlign: 'center' }}>ASSIGNED</th>
                        <th style={{ padding: '12px 14px', textAlign: 'center' }}>PRESENT</th>
                        <th style={{ padding: '12px 14px', textAlign: 'center' }}>ABSENT</th>
                        <th style={{ padding: '12px 14px', textAlign: 'center' }}>STATUS</th>
                        <th style={{ padding: '12px 14px', textAlign: 'right' }}>ACTIONS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLeaderLogs.length === 0 ? (
                        <tr>
                          <td colSpan="9" style={{ padding: '32px', textAlign: 'center', color: '#64748b', fontWeight: '600' }}>
                            {loadingLeaderLogs ? 'Loading event leader logs from database...' : 'No event leader attendance records match the current filter.'}
                          </td>
                        </tr>
                      ) : (
                        filteredLeaderLogs.map((logItem, idx) => (
                          <tr key={logItem.id} style={{ borderBottom: '1px solid #f1f5f9', background: '#ffffff' }}>
                            <td style={{ padding: '12px 14px', color: '#64748b' }}>{idx + 1}</td>
                            <td style={{ padding: '12px 14px', fontWeight: '700', color: '#0f172a' }}>{logItem.date}</td>
                            <td style={{ padding: '12px 14px' }}>
                              <div style={{ fontWeight: '700', color: '#0f172a' }}>{logItem.leaderName}</div>
                              <div style={{ fontSize: '11px', color: '#64748b' }}>@{logItem.leaderUsername}</div>
                            </td>
                            <td style={{ padding: '12px 14px' }}>
                              <span style={{ fontWeight: '700', color: '#4f46e5' }}>{logItem.sessionLabel}</span>
                              <div style={{ fontSize: '11px', color: '#64748b' }}>Periods: {(logItem.coveredPeriods || []).join(', ')}</div>
                            </td>
                            <td style={{ padding: '12px 14px', textAlign: 'center', fontWeight: '700' }}>{logItem.totalAssigned}</td>
                            <td style={{ padding: '12px 14px', textAlign: 'center', fontWeight: '700', color: '#047857' }}>{logItem.presentCount}</td>
                            <td style={{ padding: '12px 14px', textAlign: 'center', fontWeight: '700', color: logItem.absentCount > 0 ? '#e11d48' : '#64748b' }}>
                              {logItem.absentCount}
                            </td>
                            <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                              <span style={{
                                padding: '3px 10px',
                                borderRadius: '999px',
                                fontSize: '11px',
                                fontWeight: '800',
                                background: logItem.status === 'VERIFIED' ? '#ecfdf5' : '#fffbeb',
                                color: logItem.status === 'VERIFIED' ? '#047857' : '#b45309'
                              }}>
                                {logItem.status === 'VERIFIED' ? '✅ Verified' : '⏳ Submitted'}
                              </span>
                            </td>
                            <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                              <div style={{ display: 'inline-flex', gap: '6px' }}>
                                <button
                                  type="button"
                                  onClick={() => setInspectingLeaderLog(logItem)}
                                  style={{ padding: '4px 10px', background: '#f8fafc', color: '#334155', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '11px', fontWeight: '700', cursor: 'pointer' }}
                                >
                                  👁️ Inspect
                                </button>
                                {logItem.status !== 'VERIFIED' && (
                                  <button
                                    type="button"
                                    onClick={() => handleVerifyLeaderLog(logItem)}
                                    disabled={loading}
                                    style={{ padding: '4px 10px', background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', borderRadius: '6px', fontSize: '11px', fontWeight: '700', cursor: 'pointer' }}
                                  >
                                    ✅ Verify
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
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

      {/* 🌟 LIVE CLASS & PERIOD ATTENDANCE MONITOR */}
      {activeTab === 'live_monitor' && !isEventLeaderUser && (
        <ClassPeriodMonitorTab
          loggedInUser={loggedInUser}
          userRole={userRole}
          localStudents={localStudents}
          localTeachers={localTeachers}
          activeOutpassesByReg={activeOutpassesByReg}
          recordedAbsencesByReg={recordedAbsencesByReg}
          todayRecordedSessions={todayRecordedSessions}
          attDate={attDate}
          myCtClasses={myCtClasses}
        />
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