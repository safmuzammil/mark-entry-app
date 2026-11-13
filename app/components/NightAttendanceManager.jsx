'use client';
import React, { useState, useEffect } from 'react';
import { db } from '../../lib/firebase';
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot
} from 'firebase/firestore';
import { DEFAULT_CLASSES, styles, isWaiverActiveOnDate, isTimestampWithinWindow } from './erpConstants';
import {
  ProfileAvatar,
  openDirectWhatsApp,
  openWhatsAppGroupAndCopy,
  resolveClassTeacherForStudent
} from './ErpExtensions';

function getTodayDateString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDaysToDate(baseDateStr, days) {
  const parts = String(baseDateStr || getTodayDateString()).split('-');
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const isoToLocalYMD = (isoStr) => {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return String(isoStr).split('T')[0];
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const formatNightPassTime = (isoStr, isOpen) => {
  if (isOpen) return 'Open Return';
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
};

export default function NightAttendanceManager({
  loggedInTeacher = null,
  isAdmin = false,
  preloadedStudents = [],
  preloadedTeachers = []
}) {
  const [viewMode, setViewMode] = useState(isAdmin ? 'admin_summary' : 'take_attendance');
  const [selectedDate, setSelectedDate] = useState(getTodayDateString());
  const [selectedClass, setSelectedClass] = useState(
    loggedInTeacher?.outpassPrivileges?.classTeacherOf?.[0] || DEFAULT_CLASSES[0]
  );

  const [students, setStudents] = useState(preloadedStudents);
  const [teachers, setTeachers] = useState(preloadedTeachers);
  const [activePasses, setActivePasses] = useState([]);
  const [dailyDocData, setDailyDocData] = useState({});
  const [monthlyDocsList, setMonthlyDocsList] = useState([]);
  const [staffGroupLink, setStaffGroupLink] = useState('');

  // 🌟 statusMap: { [adNo]: 'PRESENT' | 'ABSENT' | 'OUTPASS' | 'OFFICIAL' | 'SICK_ROOM' }
  const [statusMap, setStatusMap] = useState({});
  const [showForwardDrawer, setShowForwardDrawer] = useState(false);

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');

  const [nightRepScope, setNightRepScope] = useState('daily');
  const [nightRepMonth, setNightRepMonth] = useState(() => getTodayDateString().slice(0, 7));
  const [nightRepClass, setNightRepClass] = useState('ALL');

  // 🌟 RECORDED STUDENT ABSENCES (Persistent Multi-Day & Reason Storage)
  const [preRecordMode, setPreRecordMode] = useState(false);
  const [previousSavedState, setPreviousSavedState] = useState(null);
  const [recordedAbsencesMap, setRecordedAbsencesMap] = useState({});
  const [activeCampusWaiversMap, setActiveCampusWaiversMap] = useState({});

  // 🌟 Real-time listener for active campus medical waivers (Bed Rest & Masjid Jamath Exemption)
  useEffect(() => {
    try {
      const q = query(
        collection(db, 'campus_medical_waivers'),
        where('status', '==', 'ACTIVE')
      );
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const wMap = {};
        snapshot.forEach(docSnap => {
          const data = docSnap.data();
          const ad = String(data.adNo || data.studentAdNo || '').trim().toUpperCase();
          if (ad) {
            wMap[ad] = { id: docSnap.id, ...data };
          }
        });
        setActiveCampusWaiversMap(wMap);
      }, (err) => {
        console.warn('NightAttendanceManager: Error loading campus medical waivers:', err);
      });
      return () => unsubscribe();
    } catch (e) {
      console.warn('Could not setup campus waivers listener in night attendance:', e);
    }
  }, []);
  const [absenceModalStudent, setAbsenceModalStudent] = useState(null);
  const [absenceModalStatus, setAbsenceModalStatus] = useState('ABSENT');
  const [absenceModalReason, setAbsenceModalReason] = useState('🤒 Sick / Fever in Room');
  const [absenceModalHasDuration, setAbsenceModalHasDuration] = useState(false);
 const [absenceModalStartDate, setAbsenceModalStartDate] = useState(() => getTodayDateString());
const [absenceModalStartTime, setAbsenceModalStartTime] = useState('08:00');
const [absenceModalEndDate, setAbsenceModalEndDate] = useState('');
const [absenceModalEndTime, setAbsenceModalEndTime] = useState('22:00');
const [absenceModalSaving, setAbsenceModalSaving] = useState(false);

// Sub-tab inside the 3rd "Attendance Reports" tab & Class Teacher Summary state (Point 1.8)
const [reportsSubTab, setReportsSubTab] = useState('night_reports'); // 'night_reports' | 'extra_reports'
const [ctSummaryScope, setCtSummaryScope] = useState('date'); // 'date' | 'month' | 'semester'
const [ctSummaryDate, setCtSummaryDate] = useState(() => getTodayDateString());
const [ctSummaryMonth, setCtSummaryMonth] = useState(() => getTodayDateString().slice(0, 7));

  // 🌟 EXTRA ATTENDANCE STATE (Same-Day Multi-Session Recording & Reports)
  const [extraDate, setExtraDate] = useState(getTodayDateString());
  const [extraClass, setExtraClass] = useState(
    loggedInTeacher?.outpassPrivileges?.classTeacherOf?.[0] || DEFAULT_CLASSES[0]
  );
  const [extraReason, setExtraReason] = useState('Special Study Camp');
  const [customExtraReason, setCustomExtraReason] = useState('');
  const [includeUrdu, setIncludeUrdu] = useState(true);
  const [extraStatusMap, setExtraStatusMap] = useState({});
  const [extraSaving, setExtraSaving] = useState(false);
  const [lastSavedExtraPayload, setLastSavedExtraPayload] = useState(null);
  const [recordedExtraList, setRecordedExtraList] = useState([]);
  const [loadingExtraReports, setLoadingExtraReports] = useState(false);
  const [extraRepClass, setExtraRepClass] = useState('ALL');
  const [extraRepDate, setExtraRepDate] = useState('');
  const [extraSearchFilter, setExtraSearchFilter] = useState('');
  const [extraSubmittedState, setExtraSubmittedState] = useState(false);
  const [classSubmittedSuccess, setClassSubmittedSuccess] = useState(null);

  // 🌟 EXTRA ATTENDANCE HELPERS
  const getClassTeacherForClass = (clsName) => {
    return teachers.find(t => {
      const ctClasses = t.outpassPrivileges?.classTeacherOf || t.classTeacherOf || [];
      return Array.isArray(ctClasses) && ctClasses.includes(clsName);
    }) || null;
  };

  const isUrduStudent = (st) => {
    const ad = String(st.adNo || '').trim().toUpperCase();
    const lang = String(st.langTag || st.stream || '').trim().toUpperCase();
    return ad.startsWith('U') || lang.includes('URDU');
  };

  const extraBaseClassStudents = students.filter(st => {
    const cls = st.studentClass || st.class || (Array.isArray(st.classes) ? st.classes[0] : '');
    return cls === extraClass;
  });

  const extraStudentsList = extraBaseClassStudents
    .filter(st => includeUrdu || !isUrduStudent(st))
    .filter(st => {
      if (!extraSearchFilter) return true;
      const q = extraSearchFilter.toLowerCase();
      return (st.firstName || '').toLowerCase().includes(q) || String(st.adNo || '').includes(q);
    });

  const handleExtraQuickTap = (adNo) => {
    setExtraStatusMap(prev => {
      const p = getActiveOutpassForStudent(adNo);
      const activeRec = getActiveRecordedAbsenceForStudent(adNo, extraDate);
      const defaultStatus = activeRec ? (activeRec.status || 'ABSENT') : (p ? ((p.purpose === 'OFFICIAL' || p.category === 'OFFICIAL') ? 'OFFICIAL' : 'OUTPASS') : 'PRESENT');
      const cur = prev[adNo] || defaultStatus;
      
      return { ...prev, [adNo]: cur === 'PRESENT' ? 'ABSENT' : 'PRESENT' };
    });
  };

  const handleExtraMarkAll = (status) => {
    const newMap = { ...extraStatusMap };
    extraStudentsList.forEach(st => {
      const ad = String(st.adNo || '').trim();
      const p = getActiveOutpassForStudent(ad);
      const activeRec = getActiveRecordedAbsenceForStudent(ad, extraDate);
      if (activeRec) {
        newMap[ad] = activeRec.status || 'ABSENT';
      } else if (p) {
        newMap[ad] = (p.purpose === 'OFFICIAL' || p.category === 'OFFICIAL') ? 'OFFICIAL' : 'OUTPASS';
      } else {
        newMap[ad] = status;
      }
    });
    setExtraStatusMap(newMap);
  };

  const handleSaveExtraAttendance = async () => {
    const effectiveReason = extraReason === 'CUSTOM' ? customExtraReason.trim() : extraReason.trim();
    if (!effectiveReason) {
      return alert('Please select or enter a reason for Extra Attendance.');
    }

    setExtraSaving(true);
    try {
      const absentAdNos = [];
      const outpassAdNos = [];
      const officialAdNos = [];
      const sickAdNos = [];
      const permittedAdNos = [];
      const absentReasonsMap = {};

      const targetStudents = extraBaseClassStudents.filter(st => includeUrdu || !isUrduStudent(st));

      targetStudents.forEach(st => {
        const ad = String(st.adNo || '').trim();
        const p = getActiveOutpassForStudent(ad);
        const activeRec = getActiveRecordedAbsenceForStudent(ad, extraDate);
        const activeWaiver = activeCampusWaiversMap[ad.toUpperCase()];
        let stStatus = extraStatusMap[ad];
        if (!stStatus) {
          if (activeWaiver && activeWaiver.waiverType === 'SICK_IN_ROOM' && isWaiverActiveOnDate(activeWaiver, extraDate)) {
            stStatus = 'SICK_ROOM';
          } else if (activeRec) {
            stStatus = activeRec.status || 'ABSENT';
          } else if (p) {
            stStatus = (p.purpose === 'OFFICIAL' || p.category === 'OFFICIAL') ? 'OFFICIAL' : 'OUTPASS';
          } else {
            stStatus = 'PRESENT';
          }
        }
        if (stStatus === 'ABSENT') absentAdNos.push(ad);
        if (stStatus === 'OUTPASS' || stStatus === 'LEAVE') permittedAdNos.push(ad);
        if (stStatus === 'OFFICIAL') officialAdNos.push(ad);
        if (stStatus === 'SICK_ROOM') sickAdNos.push(ad);

        if (activeRec && activeRec.reason) {
          absentReasonsMap[ad] = activeRec.reason;
        } else if (activeWaiver && isWaiverActiveOnDate(activeWaiver, extraDate) && stStatus === 'SICK_ROOM') {
          absentReasonsMap[ad] = (activeWaiver.waiverType === 'JAMATH_EXEMPTION' ? '🩹 Masjid Exemption: ' : '🤒 Bed Rest: ') + (activeWaiver.injuryReason || activeWaiver.diagnosis || 'Medical Waiver');
        }
      });

      const presentCount = targetStudents.length - absentAdNos.length - permittedAdNos.length - officialAdNos.length - sickAdNos.length;
      const reasonSlug = effectiveReason.toLowerCase().replace(/[^a-z0-9]/g, '_');
      const docId = `extra_${extraDate}_${extraClass}_${reasonSlug}_${Date.now()}`;

      const payload = {
        id: docId,
        date: extraDate,
        className: extraClass,
        reason: effectiveReason,
        includeUrdu: Boolean(includeUrdu),
        takenBy: recorderName || 'Teacher',
        totalStrength: targetStudents.length,
        presentCount,
        absentCount: absentAdNos.length,
        outpassCount: outpassAdNos.length,
        permittedCount: permittedAdNos.length,
        officialCount: officialAdNos.length,
        sickCount: sickAdNos.length,
        absentAdNos,
        permittedAdNos,
        absentReasonsMap,
        statusMap: extraStatusMap,
        absentList: targetStudents
          .filter(s => absentAdNos.includes(String(s.adNo || '').trim()))
          .map(s => ({ name: s.firstName || s.name, adNo: s.adNo, rollNo: s.rollNo || '' })),
        createdAt: new Date().toISOString()
      };

      try {
        await setDoc(doc(db, 'night_extra_attendance', docId), payload);
      } catch (permErr) {
        if (permErr.code === 'permission-denied' || String(permErr.message || '').includes('permission')) {
          console.warn('Saving to systemCache fallback:', permErr);
          await setDoc(doc(db, 'systemCache', `extraAtt_${docId}`), {
            ...payload,
            _storedIn: 'systemCache'
          });
        } else {
          throw permErr;
        }
      }

      setLastSavedExtraPayload(payload);
      setRecordedExtraList(prev => [payload, ...prev]);
      setExtraSubmittedState(true);
      if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
      alert(`✅ Extra Attendance saved for Class ${extraClass} (${extraDate} • ${effectiveReason})!`);
    } catch (err) {
      console.error(err);
      alert('Error saving extra attendance: ' + err.message);
    } finally {
      setExtraSaving(false);
    }
  };

  const loadExtraAttendanceRecords = async () => {
    setLoadingExtraReports(true);
    try {
      const list = [];
      try {
        const snap = await getDocs(query(collection(db, 'night_extra_attendance'), orderBy('createdAt', 'desc'), limit(150)));
        snap.forEach(d => list.push({ id: d.id, ...d.data() }));
      } catch (e) {
        console.warn('Loading from systemCache fallback:', e);
      }

      try {
        const cacheSnap = await getDocs(query(collection(db, 'systemCache'), limit(500)));
        cacheSnap.forEach(d => {
          if (d.id.startsWith('extraAtt_')) {
            const item = { id: d.id.replace('extraAtt_', ''), ...d.data() };
            if (!list.some(x => x.id === item.id)) {
              list.push(item);
            }
          }
        });
      } catch (cacheErr) {
        console.warn('Cache fallback read note:', cacheErr);
      }

      list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      setRecordedExtraList(list);
    } catch (e) {
      console.error('Error loading extra attendance reports:', e);
    } finally {
      setLoadingExtraReports(false);
    }
  };

  const handleSendExtraToClassTeacher = (data) => {
    const payload = data || lastSavedExtraPayload;
    if (!payload) return alert('No Extra Attendance session data available.');
    const ct = getClassTeacherForClass(payload.className);
    const ctPhone = ct?.whatsappNumber || ct?.mobileNumber;
    const ctName = ct?.fullName || `Class Teacher (${payload.className})`;

    const absentLines = (payload.absentList && payload.absentList.length > 0)
      ? payload.absentList.map((s, idx) => `${idx + 1}. *${s.name}* (#${s.adNo})`).join('\n')
      : 'None (All students present)';

    const msg = [
      `*⚡ EXTRA ATTENDANCE REPORT — CLASS ${payload.className}*`,
      `📅 *Date:* ${payload.date}`,
      `🏷️ *Reason:* ${payload.reason}`,
      `🌐 *Urdu Stream:* ${payload.includeUrdu ? 'Included in roll-call' : 'Skipped / Excluded'}`,
      `👨‍🏫 *Recorded By:* ${payload.takenBy}`,
      `📊 *Strength:* ${payload.totalStrength} | *Present:* ${payload.presentCount} | *Absent:* ${payload.absentCount}`,
      `-----------------------------------------`,
      (payload.absentList && payload.absentList.length > 0)
        ? `*🔴 ABSENT STUDENTS (${payload.absentList.length}):*\n${absentLines}`
        : `*✅ All ${payload.totalStrength} students were Present!*`,
      `-----------------------------------------`,
      `_Sent to Class Faculty: ${ctName}_`
    ].join('\n');

    openDirectWhatsApp(ctPhone, msg);
  };

  const recorderName = isAdmin
    ? 'Admin'
    : (loggedInTeacher?.fullName || loggedInTeacher?.username || 'Teacher');

  const myPriv = loggedInTeacher?.outpassPrivileges || {};
const myCtClasses = Array.isArray(myPriv.classTeacherOf)
  ? myPriv.classTeacherOf
  : Array.isArray(loggedInTeacher?.classTeacherOf)
  ? loggedInTeacher.classTeacherOf
  : [];

const hasFullAllClassPreRecordPower = Boolean(
  isAdmin || myPriv.isPrincipal || myPriv.isOfficeSecretary
);
const isOutreachCoordRole = Boolean(myPriv.isOutreachCoordinator || myPriv.canApproveOutreach);
const isNiicsCoordRole = Boolean(myPriv.isNiicsCoordinator);
const isClassTeacherRole = myCtClasses.length > 0;

// Check if the logged-in user can pre-record leave for a given student & status
const checkPreRecordPermission = (studentObj, targetStatus = null) => {
  if (!studentObj) return { allowed: false, reason: 'No student selected.' };
  const stCls = studentObj.studentClass || studentObj.class || (Array.isArray(studentObj.classes) ? studentObj.classes[0] : '');
  const isUrdu = isUrduStudent(studentObj);

  if (hasFullAllClassPreRecordPower) {
    return { allowed: true, allowedStatuses: ['OUTPASS', 'OFFICIAL', 'SICK_ROOM', 'ABSENT'], roleLabel: 'Admin / Principal / Office Secretary (All Classes & Leave Types)' };
  }
  if (isClassTeacherRole && myCtClasses.includes(stCls)) {
    return { allowed: true, allowedStatuses: ['OUTPASS', 'OFFICIAL', 'SICK_ROOM', 'ABSENT'], roleLabel: `Class Teacher of ${stCls} (All Leave Types)` };
  }
  if (isNiicsCoordRole && isUrdu) {
    return { allowed: true, allowedStatuses: ['OUTPASS', 'OFFICIAL', 'SICK_ROOM', 'ABSENT'], roleLabel: 'NIICS Coordinator (Urdu Students All Leave Types)' };
  }
  if (isOutreachCoordRole) {
    if (targetStatus && targetStatus !== 'OFFICIAL') {
      return { allowed: false, allowedStatuses: ['OFFICIAL'], reason: 'Outreach Coordinator can only pre-record Official / Rehearsal leaves.' };
    }
    return { allowed: true, allowedStatuses: ['OFFICIAL'], roleLabel: 'Outreach Coordinator (Official & Rehearsal Leave Only)' };
  }
  return {
    allowed: false,
    allowedStatuses: [],
    reason: isClassTeacherRole
      ? `Class Teachers can only pre-record leaves for their assigned class (${myCtClasses.join(', ')}).`
      : isNiicsCoordRole
      ? 'NIICS Coordinator can only pre-record leaves for Urdu stream students (#U...).'
      : 'Only Admin, Principal, Office Secretary, Outreach Coordinator, NIICS Coordinator, or the assigned Class Teacher can pre-record leaves.'
  };
};

const canUsePreRecordButton = Boolean(
  hasFullAllClassPreRecordPower || isOutreachCoordRole || isNiicsCoordRole || isClassTeacherRole
);

const handleCopyExtraUnexcusedAbsentees = () => {
  const targetStudents = extraBaseClassStudents.filter(st => includeUrdu || !isUrduStudent(st));
  const unexcusedList = targetStudents.filter(st => {
    const ad = String(st.adNo || '').trim();
    const cur = extraStatusMap[ad];
    const activeWaiver = activeCampusWaiversMap[ad.toUpperCase()];
    const isWaiverNow = activeWaiver && isWaiverActiveOnDate(activeWaiver, extraDate);
    const activeRec = getActiveRecordedAbsenceForStudent(ad, extraDate);
    const activePass = getActiveOutpassForStudent(ad, extraDate);
    if (cur) return cur === 'ABSENT';
    return !isWaiverNow && !activeRec && !activePass && false;
  });

  const effectiveReason = extraReason === 'CUSTOM' ? customExtraReason.trim() : extraReason.trim();
  const lines = [
    `*⚡ EXTRA ATTENDANCE — UNEXCUSED ABSENTEES (A)*`,
    `📅 Date: ${extraDate} | Class: ${extraClass}`,
    `🏷️ Reason: ${effectiveReason || 'Extra Session'}`,
    `👨‍🏫 Taken By: ${recorderName}`,
    `-----------------------------------------`,
    unexcusedList.length === 0
      ? `✅ Zero Unexcused Absentees!`
      : unexcusedList.map((s, i) => `${i + 1}. *${s.firstName}* (#${s.adNo}) — Absent (A)`).join('\n')
  ];
  navigator.clipboard.writeText(lines.join('\n')).then(() => {
    alert(`📋 Copied ${unexcusedList.length} unexcused absent (A) student(s) to clipboard!`);
  });
};

  const canViewAdminAnalytics = Boolean(
    isAdmin ||
    loggedInTeacher?.outpassPrivileges?.isPrincipal ||
    loggedInTeacher?.outpassPrivileges?.isNiicsCoordinator ||
    loggedInTeacher?.outpassPrivileges?.isAcademicCoordinator ||
    loggedInTeacher?.outpassPrivileges?.isOfficeSecretary
  );

  useEffect(() => { setStudents(preloadedStudents); }, [preloadedStudents]);
  useEffect(() => { setTeachers(preloadedTeachers); }, [preloadedTeachers]);

  useEffect(() => {
    async function initData() {
      try {
        const promises = [
          getDocs(query(collection(db, 'out_passes'), orderBy('createdAt', 'desc'), limit(300))),
          getDoc(doc(db, 'systemCache', 'whatsappGroups')),
          getDoc(doc(db, 'systemCache', 'recordedStudentAbsences'))
        ];
        if (students.length === 0) promises.push(getDocs(collection(db, 'students')));
        if (teachers.length === 0) promises.push(getDocs(collection(db, 'teachers')));

        const results = await Promise.all(promises);
        const passSnap = results[0];
        const groupSnap = results[1];
        const absencesSnap = results[2];

        const pList = [];
        passSnap.forEach(d => pList.push({ id: d.id, ...d.data() }));
        setActivePasses(pList);

        if (groupSnap.exists() && groupSnap.data().staffGroupLink) {
          setStaffGroupLink(groupSnap.data().staffGroupLink);
        }

        if (absencesSnap && absencesSnap.exists()) {
          setRecordedAbsencesMap(absencesSnap.data().absences || {});
        }

        if (students.length === 0 && results[3]) {
          const sList = [];
          results[3].forEach(d => sList.push({ id: d.id, ...d.data() }));
          sList.sort((a, b) => (Number(a.rollNo) || 999) - (Number(b.rollNo) || 999));
          setStudents(sList);
        }
        if (teachers.length === 0 && results[4]) {
          const tList = [];
          results[4].forEach(d => tList.push(d.data()));
          setTeachers(tList);
        }
      } catch (err) {
        console.error('Error initializing night attendance:', err);
      }
    }
    initData();
  }, []);

    const getActiveOutpassForStudent = (adNo, dateOverride = null) => {
  const cleanAd = String(adNo || '').trim().toLowerCase();
  if (!cleanAd) return null;
  const targetDate = dateOverride || selectedDate || getTodayDateString();

  return activePasses.find(p => {
    if (String(p.adNo || '').trim().toLowerCase() !== cleanAd) return false;
    const st = String(p.status || '').toUpperCase();
    if (st === 'CANCELLED') return false;

    const isReturned = st === 'RETURNED' || st === 'ARRIVED_AT_GATE' || Boolean(p.actualReturnTime || p.verifiedReturnedAt || p.teacherVerifiedTime);
    if (isReturned) return false;

    if (st !== 'OUTSIDE' && st !== 'APPROVED') return false;

    return isTimestampWithinWindow({
      targetDateStr: targetDate,
      startIso: p.permittedFrom || p.createdAt,
      endIso: p.actualReturnTime || p.permittedTo,
      isOpenReturn: Boolean(p.isOpenReturn)
    });
  });
};

const getReturnedOutpassForStudent = (adNo) => {
  const cleanAd = String(adNo || '').trim().toLowerCase();
  if (!cleanAd) return null;
  return activePasses.find(p => {
    if (String(p.adNo || '').trim().toLowerCase() !== cleanAd) return false;
    const st = String(p.status || '').toUpperCase();
    if (st === 'CANCELLED') return false;
    return st === 'RETURNED' || st === 'ARRIVED_AT_GATE' || Boolean(p.actualReturnTime || p.verifiedReturnedAt || p.teacherVerifiedTime);
  });
};

const getActiveRecordedAbsenceForStudent = (adNo, dateStr) => {
  const cleanAd = String(adNo || '').trim().toUpperCase();
  if (!cleanAd) return null;

  let rec = recordedAbsencesMap[cleanAd];
  if (!rec || rec.isCancelled) {
    const dailyPre = (dailyDocData.preRecordedAbsences || {})[selectedClass]?.[String(adNo).trim()];
    if (dailyPre && !dailyPre.isCancelled) rec = dailyPre;
  }

  if (!rec || rec.isCancelled) return null;

  const targetDate = dateStr || selectedDate || getTodayDateString();
  const startDate = rec.startDate || rec.date || '';
  const endDate = rec.hasDuration && rec.endDate ? rec.endDate : startDate;

  const withinWindow = isTimestampWithinWindow({
    targetDateStr: targetDate,
    startIso: rec.startDateTimeIso,
    endIso: rec.endDateTimeIso,
    startDateStr: startDate,
    startTimeStr: rec.startTime || '00:00',
    endDateStr: endDate,
    endTimeStr: rec.hasDuration && rec.endTime ? rec.endTime : '23:59',
    isOpenReturn: false
  });

  if (!withinWindow) return null;
  return rec;
};

  const loadDateAttendance = async (dateStr) => {
    setLoading(true);
    try {
      const docSnap = await getDoc(doc(db, 'night_attendance', dateStr));
      const data = docSnap.exists() ? docSnap.data() : {};
      setDailyDocData(data);
    } catch (err) {
      console.error('Error loading date attendance:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedDate) loadDateAttendance(selectedDate);
  }, [selectedDate]);

  const classStudents = students.filter(s => (s.classes || []).includes(selectedClass));

  useEffect(() => {
    const savedClassRecord = (dailyDocData.classes || {})[selectedClass] || null;
    const newStatus = {};

    classStudents.forEach(st => {
      const ad = String(st.adNo || '').trim();
      const activePass = getActiveOutpassForStudent(ad);
      const returnedPass = getReturnedOutpassForStudent(ad);
      const isOfficialPass = activePass && (
        String(activePass.leaveCategory || '').toLowerCase().includes('official') ||
        String(activePass.leaveCategory || '').toLowerCase().includes('outreach')
      );

      const activeRec = getActiveRecordedAbsenceForStudent(ad, selectedDate);

      if (savedClassRecord) {
        if ((savedClassRecord.absentAdNos || []).includes(ad)) {
          newStatus[ad] = 'ABSENT';
        } else if ((savedClassRecord.officialAdNos || []).includes(ad)) {
          newStatus[ad] = 'OFFICIAL';
        } else if ((savedClassRecord.outpassAdNos || []).includes(ad)) {
          if (returnedPass) {
            newStatus[ad] = 'PRESENT';
          } else {
            newStatus[ad] = 'OUTPASS';
          }
        } else if (activePass) {
          newStatus[ad] = isOfficialPass ? 'OFFICIAL' : 'OUTPASS';
        } else if ((savedClassRecord.sickAdNos || []).includes(ad)) {
          newStatus[ad] = 'SICK_ROOM';
        } else {
          newStatus[ad] = 'PRESENT';
        }
      } else {
        // Attendance not finalized yet tonight!
        const campusWaiver = activeCampusWaiversMap[ad.toUpperCase()];
        if (campusWaiver && campusWaiver.waiverType === 'SICK_IN_ROOM' && isWaiverActiveOnDate(campusWaiver, selectedDate)) {
          newStatus[ad] = 'SICK_ROOM';
        } else if (activeRec) {
          newStatus[ad] = activeRec.status || 'ABSENT';
        } else if (activePass) {
          newStatus[ad] = isOfficialPass ? 'OFFICIAL' : 'OUTPASS';
        } else {
          newStatus[ad] = 'PRESENT';
        }
      }
    });

    setStatusMap(newStatus);
  }, [selectedClass, dailyDocData, students, activePasses, recordedAbsencesMap, activeCampusWaiversMap, selectedDate]);

  const loadRecent30DaysForAnalytics = async () => {
    setLoading(true);
    try {
      const qRecent = query(collection(db, 'night_attendance'), limit(60));
      const snap = await getDocs(qRecent);
      const list = [];
      snap.forEach(d => list.push({ date: d.id, ...d.data() }));
      list.sort((a, b) => b.date.localeCompare(a.date));
      setMonthlyDocsList(list);
    } catch (err) {
      console.error('Error loading monthly attendance:', err);
    } finally {
      setLoading(false);
    }
  };

 useEffect(() => {
  if (
    (viewMode === 'regular_absentees' ||
      viewMode === 'ct_class_summary' ||
      viewMode === 'attendance_reports' ||
      (viewMode === 'admin_summary' && nightRepScope !== 'daily')) &&
    monthlyDocsList.length === 0
  ) {
    loadRecent30DaysForAnalytics();
  }
  if ((viewMode === 'extra_reports' || viewMode === 'attendance_reports') && recordedExtraList.length === 0) {
    loadExtraAttendanceRecords();
  }
}, [viewMode, nightRepScope]);

  const openAbsenceModal = (student, initialStatus = 'OUTPASS', existingRec = null) => {
  const perm = checkPreRecordPermission(student);
  if (!perm.allowed) {
    return alert(`🔒 Permission Restricted:\n${perm.reason}`);
  }
  const now = new Date();
  const curHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const defaultStatus = perm.allowedStatuses.includes(initialStatus)
    ? initialStatus
    : perm.allowedStatuses[0] || 'OFFICIAL';

  setAbsenceModalStudent(student);
  setAbsenceModalStatus(defaultStatus);
  if (existingRec) {
    setAbsenceModalReason(existingRec.reason || '');
    setAbsenceModalStartDate(existingRec.startDate || selectedDate);
    setAbsenceModalStartTime(existingRec.startTime || '08:00');
    setAbsenceModalHasDuration(Boolean(existingRec.hasDuration));
    setAbsenceModalEndDate(existingRec.endDate || selectedDate);
    setAbsenceModalEndTime(existingRec.endTime || '22:00');
  } else {
    setAbsenceModalReason(
      defaultStatus === 'SICK_ROOM' ? '🤒 Sick / Fever in Room' :
      defaultStatus === 'OUTPASS' ? '🏡 Permitted Leave' :
      defaultStatus === 'OFFICIAL' ? '🏛️ Official / Rehearsal Duty' :
      '🤒 Sick / Fever in Room'
    );
    setAbsenceModalStartDate(selectedDate);
    setAbsenceModalStartTime(curHHMM);
    setAbsenceModalHasDuration(true);
    setAbsenceModalEndDate(selectedDate);
    setAbsenceModalEndTime('22:00');
  }
};

const handleSaveSingleStudentAbsence = async () => {
  if (!absenceModalStudent) return;
  const st = absenceModalStudent;
  const perm = checkPreRecordPermission(st, absenceModalStatus);
  if (!perm.allowed) {
    return alert(`🔒 Permission Restricted:\n${perm.reason}`);
  }

  const ad = String(st.adNo || '').trim();
  const cleanAd = ad.toUpperCase();
  const now = new Date();

  const effectiveReason = (absenceModalReason || '').trim() || (
    absenceModalStatus === 'SICK_ROOM' ? 'Medical / Sick in Room' :
    absenceModalStatus === 'OUTPASS' ? 'Permitted Leave' :
    absenceModalStatus === 'OFFICIAL' ? 'Official / Rehearsal Leave' : 'Absent'
  );

  const effectiveStartDate = absenceModalStartDate || selectedDate;
  const effectiveStartTime = absenceModalStartTime || '00:00';
  const startDateTimeIso = new Date(`${effectiveStartDate}T${effectiveStartTime}:00`).toISOString();

  const effectiveEndDate = absenceModalHasDuration && absenceModalEndDate ? absenceModalEndDate : effectiveStartDate;
  const effectiveEndTime = absenceModalHasDuration && absenceModalEndTime ? absenceModalEndTime : '23:59';
  const endDateTimeIso = new Date(`${effectiveEndDate}T${effectiveEndTime}:59`).toISOString();

  const absenceRecord = {
    adNo: ad,
    studentName: st.firstName || st.name || 'Student',
    studentRegNo: st.regNo || '',
    className: selectedClass,
    status: absenceModalStatus || 'OUTPASS',
    reason: effectiveReason,
    startDate: effectiveStartDate,
    startTime: effectiveStartTime,
    startDateTimeIso,
    hasDuration: Boolean(absenceModalHasDuration),
    endDate: effectiveEndDate,
    endTime: effectiveEndTime,
    endDateTimeIso,
    recordedBy: recorderName || 'Teacher',
    recordedAt: now.toISOString(),
    isCancelled: false
  };

  setAbsenceModalSaving(true);
  try {
    const newMap = {
      ...recordedAbsencesMap,
      [cleanAd]: absenceRecord
    };

    await setDoc(doc(db, 'systemCache', 'recordedStudentAbsences'), {
      absences: newMap,
      lastUpdated: now.toISOString()
    }, { merge: true });

    const existingClassPre = (dailyDocData.preRecordedAbsences || {})[selectedClass] || {};
    const updatedClassPre = {
      ...existingClassPre,
      [ad]: absenceRecord
    };
    const updatedPreMap = {
      ...(dailyDocData.preRecordedAbsences || {}),
      [selectedClass]: updatedClassPre
    };

    await setDoc(doc(db, 'night_attendance', selectedDate), {
      date: selectedDate,
      classes: dailyDocData.classes || {},
      preRecordedAbsences: updatedPreMap,
      lastUpdated: now.toISOString()
    }, { merge: true });

    setRecordedAbsencesMap(newMap);
    setDailyDocData(prev => ({
      ...prev,
      preRecordedAbsences: updatedPreMap
    }));

    // Only update current statusMap if the start time has already begun
    if (isTimestampWithinWindow({
      targetDateStr: selectedDate,
      startIso: startDateTimeIso,
      endIso: endDateTimeIso,
      startDateStr: effectiveStartDate,
      startTimeStr: effectiveStartTime,
      endDateStr: effectiveEndDate,
      endTimeStr: effectiveEndTime
    })) {
      setStatusMap(prev => ({
        ...prev,
        [ad]: absenceModalStatus || 'OUTPASS'
      }));
    }

    setAbsenceModalStudent(null);
  } catch (err) {
    console.error('Error saving single student absence:', err);
    alert('Error saving absence: ' + err.message);
  } finally {
    setAbsenceModalSaving(false);
  }
};

  const handleMarkPresentAndClearAbsence = async (st) => {
    const ad = String(st.adNo || '').trim();
    const cleanAd = ad.toUpperCase();

    // Immediately mark as PRESENT in UI
    setStatusMap(prev => ({ ...prev, [ad]: 'PRESENT' }));

    const activeRec = getActiveRecordedAbsenceForStudent(ad, selectedDate);
    if (activeRec) {
      try {
        const newMap = { ...recordedAbsencesMap };
        delete newMap[cleanAd];
        setRecordedAbsencesMap(newMap);

        await setDoc(doc(db, 'systemCache', 'recordedStudentAbsences'), {
          absences: newMap,
          lastUpdated: new Date().toISOString()
        }, { merge: true });

        const existingPre = (dailyDocData.preRecordedAbsences || {})[selectedClass] || {};
        const updatedClassPre = { ...existingPre };
        delete updatedClassPre[ad];
        const updatedPreMap = {
          ...(dailyDocData.preRecordedAbsences || {}),
          [selectedClass]: updatedClassPre
        };
        await setDoc(doc(db, 'night_attendance', selectedDate), {
          date: selectedDate,
          classes: dailyDocData.classes || {},
          preRecordedAbsences: updatedPreMap,
          lastUpdated: new Date().toISOString()
        }, { merge: true });

        setDailyDocData(prev => ({
          ...prev,
          preRecordedAbsences: updatedPreMap
        }));
      } catch (err) {
        console.warn('Error clearing recorded absence in cloud:', err);
      }
    }
  };

  const handleSaveClassAttendance = async () => {
    setSaving(true);
    try {
      // 🌟 Snapshot current state for 1-click Undo
      setPreviousSavedState({
        statusMap: { ...statusMap },
        dailyClassesMap: dailyDocData.classes ? { ...dailyDocData.classes } : {}
      });

      const absentAdNos = [];
      const outpassAdNos = [];
      const officialAdNos = [];
      const sickAdNos = [];
      const permittedAdNos = [];

      classStudents.forEach(st => {
        const ad = String(st.adNo || '').trim();
        const stStatus = statusMap[ad] || 'PRESENT';
        if (stStatus === 'ABSENT') absentAdNos.push(ad);
        if (stStatus === 'OUTPASS' || stStatus === 'LEAVE') permittedAdNos.push(ad);
        if (stStatus === 'OFFICIAL') officialAdNos.push(ad);
        if (stStatus === 'SICK_ROOM') sickAdNos.push(ad);
      });

      const absentReasonsMap = {};
      absentAdNos.forEach(ad => {
        const activeRec = getActiveRecordedAbsenceForStudent(ad, selectedDate);
        if (activeRec) {
          absentReasonsMap[ad] = activeRec.reason;
        }
      });
      sickAdNos.forEach(ad => {
        const activeRec = getActiveRecordedAbsenceForStudent(ad, selectedDate);
        if (activeRec) {
          absentReasonsMap[ad] = activeRec.reason;
        }
      });

      const classPayload = {
        className: selectedClass,
        totalStrength: classStudents.length,
        presentCount: classStudents.length - absentAdNos.length - permittedAdNos.length - officialAdNos.length - sickAdNos.length,
        absentCount: absentAdNos.length,
        outpassCount: outpassAdNos.length,
        permittedCount: permittedAdNos.length,
        officialCount: officialAdNos.length,
        sickCount: sickAdNos.length,
        absentAdNos,
        outpassAdNos,
        permittedAdNos,
        officialAdNos,
        sickAdNos,
        absentReasonsMap,
        takenBy: recorderName || 'Teacher',
        updatedAt: new Date().toISOString()
      };

      const updatedClassesMap = {
        ...(dailyDocData.classes || {}),
        [selectedClass]: classPayload
      };

      await setDoc(doc(db, 'night_attendance', selectedDate), {
        date: selectedDate,
        classes: updatedClassesMap,
        lastUpdated: new Date().toISOString()
      }, { merge: true });

      setDailyDocData(prev => ({ ...prev, classes: updatedClassesMap }));
      setClassSubmittedSuccess(selectedClass);
      if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
      alert(`✅ Night Attendance saved for Class ${selectedClass} (${selectedDate})!`);
    } catch (err) {
      alert('Error saving attendance: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleUndoLastSave = async () => {
    if (!previousSavedState) return alert('No previous save state recorded to restore.');
    if (!confirm(`Undo and restore previous saved attendance state for Class ${selectedClass}?`)) return;
    setSaving(true);
    try {
      setStatusMap(previousSavedState.statusMap);
      const restoredClassesMap = {
        ...(dailyDocData.classes || {}),
        [selectedClass]: previousSavedState.dailyClassesMap[selectedClass]
      };
      await setDoc(doc(db, 'night_attendance', selectedDate), {
        date: selectedDate,
        classes: restoredClassesMap,
        lastUpdated: new Date().toISOString()
      }, { merge: true });
      setDailyDocData(prev => ({ ...prev, classes: restoredClassesMap }));
      alert(`↺ Restored previous attendance for Class ${selectedClass}!`);
    } catch (e) {
      alert('Error during undo: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleStudentQuickToggle = (st) => {
    const ad = String(st.adNo || '').trim();
    const curStatus = statusMap[ad] || 'PRESENT';
    const activeRecAbs = getActiveRecordedAbsenceForStudent(ad, selectedDate);
    const activePass = getActiveOutpassForStudent(ad);

    if (activeRecAbs || activePass) {
      if (curStatus !== 'PRESENT') {
        handleMarkPresentAndClearAbsence(st);
      } else {
        openAbsenceModal(st, 'ABSENT', activeRecAbs);
      }
      return;
    }

    setStatusMap(prev => ({
      ...prev,
      [ad]: curStatus === 'PRESENT' ? 'ABSENT' : 'PRESENT'
    }));
  };

  const fallbackCopyText = (text) => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      alert('📋 Copied text to Clipboard!');
    } catch (e) {
      alert(`Please select and copy manually:\n\n${text}`);
    }
  };

  const handleCopyClassUnexcusedAbsentees = () => {
    const unexcusedList = classStudents.filter(s => {
      const st = statusMap[s.adNo];
      if (st !== 'ABSENT') return false;
      const activeRec = getActiveRecordedAbsenceForStudent(s.adNo, selectedDate);
      const activePass = getActiveOutpassForStudent(s.adNo);
      return !activeRec && !activePass;
    });

    const activeRecs = classStudents.filter(s => Boolean(getActiveRecordedAbsenceForStudent(s.adNo, selectedDate)));
    const activePassesList = classStudents.filter(s => Boolean(getActiveOutpassForStudent(s.adNo)));
    const totalAbsentTonight = unexcusedList.length + activeRecs.length + activePassesList.length;
    const presentCount = classStudents.length - totalAbsentTonight;

    const lines = [
      `*🌙 DHIU DEGREE SECTION — NIGHT ATTENDANCE ABSENTEES*`,
      `*Class:* ${selectedClass} | *Date:* ${selectedDate}`,
      `*Roll-Call Recorded By:* ${recorderName || 'Teacher'}`,
      `*Class Teacher:* ${classTeacherObj?.fullName || 'Unassigned'}`,
      `*Class Metrics:* Total: ${classStudents.length} | Present: ${presentCount} | Total Absent: ${totalAbsentTonight} (Unexcused: ${unexcusedList.length})`,
      `-----------------------------------------`
    ];

    if (unexcusedList.length > 0) {
      lines.push(`🔴 *UNEXCUSED ABSENTEES TONIGHT (Recorded by Night Attendance Taker):*`);
      unexcusedList.forEach((s, idx) => {
        lines.push(`${idx + 1}. *${s.firstName}* (#${s.adNo}) - Missing in hostel`);
      });
    } else {
      lines.push(`✅ *Zero Unexcused Absentees Tonight!*`);
    }

    if (activeRecs.length > 0) {
      lines.push(``);
      lines.push(`ℹ️ _Pre-Recorded Known Absences / Medical / Official: ${activeRecs.length}_`);
    }

    lines.push(`-----------------------------------------`);
    const fullText = lines.join('\n');
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(fullText).then(() => {
        alert(`📋 Copied ${unexcusedList.length} unexcused absent students of Class ${selectedClass} to Clipboard!`);
      }).catch(() => fallbackCopyText(fullText));
    } else {
      fallbackCopyText(fullText);
    }
  };

  const handleCopyAllClassesNightReport = () => {
    const inst = computeInstitutionSummaryForDate();
    const lines = [
      `*🌙 DHIU DEGREE SECTION — ALL CLASSES NIGHT ATTENDANCE*`,
      `*Date:* ${selectedDate}`,
      `*Total Strength:* ${inst.totalStrength} | *Present:* ${inst.totalPresent} | *Absent:* ${inst.totalUnexcusedAbsent} | *Medical:* ${inst.totalSick} | *Official:* ${inst.totalOfficial || 0}`,
      `-----------------------------------------`
    ];

    inst.classSummaries.forEach(c => {
      lines.push(`📚 *CLASS ${c.className}* (Strength: ${c.strength})`);
      if (!c.isTaken) {
        lines.push(`   ⏳ *Status:* Attendance Not Taken (CT: ${c.classTeacherName})`);
      } else {
        lines.push(`   📊 *Summary:* Present: ${c.presentCount} | Absent: ${c.absentCount} | Medical: ${c.sickCount} | Leave/Official: ${c.outpassCount}`);
        if (c.absentStudents && c.absentStudents.length > 0) {
          const names = c.absentStudents.map((s, idx) => `${idx + 1}. ${s.firstName} (#${s.adNo})`).join('\n      ');
          lines.push(`   🔴 *Absentees Tonight:*\n      ${names}`);
        } else {
          lines.push(`   ✅ *Zero Unexcused Absentees*`);
        }
      }
      lines.push(`-----------------------------------------`);
    });

    lines.push(`_Report Generated from MarkPortal Night Attendance System_`);
    const fullText = lines.join('\n');
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(fullText).then(() => {
        alert('📋 Copied Master All-Classes Absentee Report to Clipboard for WhatsApp!');
      }).catch(() => fallbackCopyText(fullText));
    } else {
      fallbackCopyText(fullText);
    }
  };

  const buildClassAbsenteeReportText = () => {
    // 1. Students who ought to be in class tonight, but are missing unexcused (without approved pre-record or outpass)
    const unexcusedList = classStudents.filter(s => {
      const st = statusMap[s.adNo];
      if (st !== 'ABSENT') return false;
      const activeRec = getActiveRecordedAbsenceForStudent(s.adNo, selectedDate);
      const activePass = getActiveOutpassForStudent(s.adNo);
      return !activeRec && !activePass;
    });

    // 2. Students on approved leave / pre-recorded absence (known to class teacher)
    const approvedAbsenceList = classStudents.filter(s => {
      const activeRec = getActiveRecordedAbsenceForStudent(s.adNo, selectedDate);
      return Boolean(activeRec);
    });

    // 3. Students on gate outpass (outside campus)
    const outpassList = classStudents.filter(s => {
      const st = statusMap[s.adNo];
      const activePass = getActiveOutpassForStudent(s.adNo);
      return (Boolean(activePass) || st === 'OUTPASS') && !approvedAbsenceList.some(a => a.adNo === s.adNo);
    });

    // 4. Official duty
    const officialList = classStudents.filter(s => statusMap[s.adNo] === 'OFFICIAL' && !approvedAbsenceList.some(a => a.adNo === s.adNo));

    // 5. Sick in room (without multi-day pre-record)
    const sickOnlyList = classStudents.filter(s => statusMap[s.adNo] === 'SICK_ROOM' && !approvedAbsenceList.some(a => a.adNo === s.adNo));

    const presentCount = classStudents.length - unexcusedList.length - approvedAbsenceList.length - outpassList.length - officialList.length - sickOnlyList.length;

    const lines = [
      `*🌙 DHIU DEGREE SECTION — NIGHT ATTENDANCE REPORT*`,
      `*Class:* ${selectedClass} | *Date:* ${selectedDate}`,
      `*Roll-Call Taken By:* ${recorderName}`,
      `*Total Class Strength:* ${classStudents.length} | *Present Tonight:* ${presentCount}`,
      `-----------------------------------------`
    ];

    if (unexcusedList.length > 0) {
      lines.push(`*🔴 UNEXCUSED ABSENTEES TONIGHT (Ought to be in hostel — Class Teacher please verify):*`);
      unexcusedList.forEach((s, i) => {
        lines.push(`${i + 1}. *${s.firstName}* (#${s.adNo}) — Missing / Unverified tonight`);
      });
      lines.push(`-----------------------------------------`);
    } else {
      lines.push(`✅ *Zero Unexcused Absentees! (All expected hostel students are present)*`);
      lines.push(`-----------------------------------------`);
    }

    if (approvedAbsenceList.length > 0) {
      lines.push(`*🪪 APPROVED LEAVE / KNOWN ABSENCES (${approvedAbsenceList.length}):*`);
      approvedAbsenceList.forEach((s, i) => {
        const rec = getActiveRecordedAbsenceForStudent(s.adNo, selectedDate);
        const durationStr = rec?.hasDuration && rec?.endDate ? ` (Until ${rec.endDate} ${rec.endTime || ''})` : '';
        const recordedByStr = rec?.recordedBy ? ` [By: ${rec.recordedBy}]` : '';
        lines.push(`${i + 1}. *${s.firstName}* (#${s.adNo}) — Reason: "${rec?.reason || 'Approved Absence'}"${durationStr}${recordedByStr}`);
      });
      lines.push(`-----------------------------------------`);
    }

    if (outpassList.length > 0) {
      lines.push(`*🚪 OUTSIDE CAMPUS VIA OUTPASS (${outpassList.length}):*`);
      outpassList.forEach((s, i) => {
        const passObj = getActiveOutpassForStudent(s.adNo);
        const detail = passObj
          ? `${passObj.leaveCategory || 'Leave'} to ${passObj.destination} — By: ${passObj.teacherName}`
          : 'Permitted Leave';
        lines.push(`${i + 1}. *${s.firstName}* (#${s.adNo}) — ${detail}`);
      });
      lines.push(`-----------------------------------------`);
    }

    if (officialList.length > 0) {
      lines.push(`*🏛️ ON OFFICIAL DUTY (${officialList.length}):*`);
      officialList.forEach((s, i) => {
        lines.push(`${i + 1}. *${s.firstName}* (#${s.adNo})`);
      });
      lines.push(`-----------------------------------------`);
    }

    if (sickOnlyList.length > 0) {
      lines.push(`*🤒 SICK / IN ROOM (${sickOnlyList.length}):*`);
      sickOnlyList.forEach((s, i) => {
        lines.push(`${i + 1}. *${s.firstName}* (#${s.adNo})`);
      });
      lines.push(`-----------------------------------------`);
    }

    return lines.join('\n');
  };

  const classTeacherObj = resolveClassTeacherForStudent({ classes: [selectedClass] }, teachers);
  const outreachCoordObj = teachers.find(t => t.outpassPrivileges?.isOutreachCoordinator);
  const niicsCoordObj = teachers.find(t => t.outpassPrivileges?.isNiicsCoordinator);

  const computeInstitutionSummaryForDate = () => {
    let totalStrength = students.length;
    let totalUnexcusedAbsent = 0;
    let totalOnOutpass = 0;
    let totalOfficial = 0;
    let totalSick = 0;
    let classesTakenCount = 0;

    const classSummaries = DEFAULT_CLASSES.map(cls => {
      const clsStudents = students.filter(s => (s.classes || []).includes(cls));
      const saved = (dailyDocData.classes || {})[cls];
      const ct = resolveClassTeacherForStudent({ classes: [cls] }, teachers);

      if (saved) {
        classesTakenCount++;
        totalUnexcusedAbsent += (saved.absentAdNos || []).length;
        totalOnOutpass += (saved.outpassAdNos || []).length;
        totalOfficial += (saved.officialAdNos || []).length;
        totalSick += (saved.sickAdNos || []).length;
      }

      return {
        className: cls,
        strength: clsStudents.length,
        classTeacherName: ct?.fullName || 'Unassigned',
        classTeacherPhone: ct?.whatsappNumber || ct?.mobileNumber || '',
        isTaken: Boolean(saved),
        takenBy: saved?.takenBy || 'Pending',
        presentCount: saved ? saved.presentCount : '-',
        absentCount: saved ? (saved.absentAdNos || []).length : '-',
        outpassCount: saved ? (saved.outpassAdNos || []).length : '-',
        officialCount: saved ? (saved.officialAdNos || []).length : '-',
        sickCount: saved ? (saved.sickAdNos || []).length : '-',
        absentStudents: saved
          ? clsStudents.filter(s => (saved.absentAdNos || []).includes(String(s.adNo)))
          : [],
        outpassStudents: saved
          ? clsStudents.filter(s => (saved.outpassAdNos || []).includes(String(s.adNo)) || (saved.officialAdNos || []).includes(String(s.adNo)))
          : []
      };
    });

    const totalPresent = totalStrength - totalUnexcusedAbsent - totalOnOutpass - totalOfficial - totalSick;
    return {
      totalStrength,
      totalPresent,
      totalUnexcusedAbsent,
      totalOnOutpass,
      totalOfficial,
      totalSick,
      classesTakenCount,
      classSummaries
    };
  };

  const getRegularAbsenteesList = () => {
    const counts = {};
    monthlyDocsList.forEach(dayDoc => {
      const clsMap = dayDoc.classes || {};
      Object.values(clsMap).forEach(cRec => {
        (cRec.absentAdNos || []).forEach(ad => {
          if (!counts[ad]) {
            const stObj = students.find(s => String(s.adNo) === String(ad));
            counts[ad] = {
              adNo: ad,
              studentName: stObj?.firstName || 'Student',
              studentClass: (stObj?.classes || [])[0] || cRec.className,
              mentorUsername: stObj?.mentorUsername || '—',
              parentWhatsapp: stObj?.parentWhatsapp || stObj?.parentMobile || '',
              photoUrl: stObj?.photoUrl || null,
              absentDates: [],
              unexcusedCount: 0
            };
          }
          counts[ad].unexcusedCount++;
          counts[ad].absentDates.push(dayDoc.date);
        });
      });
    });
    return Object.values(counts).sort((a, b) => b.unexcusedCount - a.unexcusedCount);
  };

  const instSummary = computeInstitutionSummaryForDate();
  const savedCurrentClassMeta = (dailyDocData.classes || {})[selectedClass];
  const preRecordedCountForSelectedClass = classStudents.filter(s => Boolean(getActiveRecordedAbsenceForStudent(s.adNo, selectedDate))).length;

  const presentInCurrentClass = classStudents.filter(s => (statusMap[s.adNo] || 'PRESENT') === 'PRESENT').length;
  const absentInCurrentClass = classStudents.filter(s => statusMap[s.adNo] === 'ABSENT').length;
  const outpassInCurrentClass = classStudents.filter(s => statusMap[s.adNo] === 'OUTPASS').length;
  const officialInCurrentClass = classStudents.filter(s => statusMap[s.adNo] === 'OFFICIAL').length;
  const sickInCurrentClass = classStudents.filter(s => statusMap[s.adNo] === 'SICK_ROOM').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* 🌟 MINIMALIST TOP NAVIGATION & DATE BAR (No heavy dark banner or rainbow colors!) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#ffffff', padding: '12px 16px', borderRadius: '12px', border: '1px solid #e2e8f0', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
          {[
            { id: 'take_attendance', label: '1. Take Night Attendance' },
            { id: 'extra_attendance', label: '2. ⚡ Extra Attendance' },
            { id: 'attendance_reports', label: '3. 📊 Attendance Reports' },
            ...(isClassTeacherRole || isAdmin ? [
              { id: 'ct_class_summary', label: `🏫 My Class Night Summary (${myCtClasses[0] || selectedClass})` }
            ] : []),
            ...(canViewAdminAnalytics ? [
              { id: 'admin_summary', label: 'Institution Summary' },
              { id: 'regular_absentees', label: 'All-Classes Regular Absentees' }
            ] : [])
          ].map(tab => {
            const active = viewMode === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setViewMode(tab.id)}
                style={{
                  padding: '8px 15px',
                  borderRadius: '8px',
                  fontWeight: '700',
                  fontSize: '13px',
                  cursor: 'pointer',
                  border: active ? '1px solid #4f46e5' : '1px solid transparent',
                  background: active ? '#4f46e5' : '#f8fafc',
                  color: active ? '#ffffff' : '#475569',
                  transition: 'all 0.15s ease'
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '12px', fontWeight: '700', color: '#64748b' }}>Date:</span>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            style={{ ...styles.input, width: 'auto', padding: '7px 12px', fontSize: '13px', fontWeight: '700' }}
          />
        </div>
      </div>

      {/* =========================================================
          MODE 1: MINIMALIST MOBILE-FRIENDLY NIGHT ATTENDANCE CARDS
         ========================================================= */}
      {viewMode === 'take_attendance' && (
        <div style={{ ...styles.card, marginBottom: 0, padding: '20px' }}>
          {/* CLASS SELECTOR PILLS */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '16px', paddingBottom: '14px', borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', fontWeight: '800', color: '#0f172a', marginRight: '4px' }}>Class:</span>
              {DEFAULT_CLASSES.map(cls => {
                const isSelected = selectedClass === cls;
                const isDoneTonight = Boolean((dailyDocData.classes || {})[cls]);
                const preCount = students.filter(s => (s.classes || []).includes(cls) && Boolean(getActiveRecordedAbsenceForStudent(s.adNo, selectedDate))).length;
                return (
                  <button
                    key={cls}
                    type="button"
                    onClick={() => { setSelectedClass(cls); setClassSubmittedSuccess(null); }}
                    style={{
                      padding: '7px 14px', borderRadius: '8px', fontWeight: '700', fontSize: '13px', cursor: 'pointer',
                      background: isSelected ? '#4f46e5' : isDoneTonight ? '#ecfdf5' : preCount > 0 ? '#fffbeb' : '#f8fafc',
                      color: isSelected ? '#ffffff' : isDoneTonight ? '#047857' : preCount > 0 ? '#b45309' : '#334155',
                      border: isSelected ? '1px solid #4f46e5' : isDoneTonight ? '1px solid #a7f3d0' : preCount > 0 ? '1px solid #fde68a' : '1px solid #e2e8f0'
                    }}
                  >
                    {isDoneTonight ? `✓ ${cls}` : preCount > 0 ? `📌 ${cls} (${preCount})` : cls}
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              {preRecordedCountForSelectedClass > 0 && !savedCurrentClassMeta && (
                <span style={{ background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a', padding: '4px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: '800' }}>
                  📌 {preRecordedCountForSelectedClass} Recorded Absences
                </span>
              )}
              {savedCurrentClassMeta && (
                <span style={{ background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', padding: '4px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: '700' }}>
                  ✓ Saved by {savedCurrentClassMeta.takenBy}
                </span>
              )}
            </div>
          </div>

          
          {classSubmittedSuccess === selectedClass && (
            <div style={{ marginBottom: '16px', background: '#ecfdf5', border: '1.5px solid #10b981', padding: '16px 20px', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', boxShadow: '0 2px 4px rgba(16,185,129,0.1)' }}>
              <div>
                <div style={{ fontWeight: '800', fontSize: '15px', color: '#065f46' }}>
                  ✅ Night Attendance for Class {selectedClass} Successfully Recorded ({selectedDate})!
                </div>
                <div style={{ fontSize: '12px', color: '#047857', marginTop: '3px' }}>
                  Present: <strong>{presentInCurrentClass}</strong> • Absent: <strong>{absentInCurrentClass}</strong> • On Leave: <strong>{outpassInCurrentClass + sickInCurrentClass}</strong>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setShowForwardDrawer(true)}
                  style={{ ...styles.buttonSuccess, background: '#25D366', color: '#ffffff', padding: '8px 14px', fontSize: '12px', fontWeight: '800' }}
                >
                  📲 Share Absentees on WhatsApp
                </button>
                {(() => {
                  const unsaved = DEFAULT_CLASSES.find(c => !((dailyDocData.classes || {})[c]));
                  if (!unsaved) return null;
                  return (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedClass(unsaved);
                        setClassSubmittedSuccess(null);
                      }}
                      style={{ ...styles.buttonPrimary, padding: '8px 14px', fontSize: '12px', fontWeight: '800' }}
                    >
                      👥 Take Class {unsaved} Attendance →
                    </button>
                  );
                })()}
                <button
                  type="button"
                  onClick={() => setClassSubmittedSuccess(null)}
                  style={{ ...styles.buttonSecondary, padding: '8px 12px', fontSize: '12px' }}
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* SOFT PASTEL 6-COUNTER BAR (Total, Present, Unexcused, Medical, Official, Outpass) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px', marginBottom: '16px' }}>
            <div style={{ padding: '12px 14px', borderRadius: '12px', background: '#f8fafc', border: '1px solid #e2e8f0', textAlign: 'center' }}>
              <div style={{ fontSize: '10px', fontWeight: '800', color: '#64748b' }}>TOTAL STUDENTS</div>
              <div style={{ fontSize: '20px', fontWeight: '900', color: '#0f172a', marginTop: '2px' }}>{classStudents.length}</div>
            </div>
            <div style={{ padding: '12px 14px', borderRadius: '12px', background: '#ecfdf5', border: '1px solid #a7f3d0', textAlign: 'center' }}>
              <div style={{ fontSize: '10px', fontWeight: '800', color: '#047857' }}>PRESENT</div>
              <div style={{ fontSize: '20px', fontWeight: '900', color: '#065f46', marginTop: '2px' }}>{presentInCurrentClass}</div>
            </div>
            <div style={{ padding: '12px 14px', borderRadius: '12px', background: '#fff1f2', border: '1px solid #fecdd3', textAlign: 'center' }}>
              <div style={{ fontSize: '10px', fontWeight: '800', color: '#be123c' }}>UNEXCUSED ABSENT</div>
              <div style={{ fontSize: '20px', fontWeight: '900', color: '#e11d48', marginTop: '2px' }}>{absentInCurrentClass}</div>
            </div>
            <div style={{ padding: '12px 14px', borderRadius: '12px', background: '#fffbeb', border: '1.5px solid #fde68a', textAlign: 'center' }}>
              <div style={{ fontSize: '10px', fontWeight: '800', color: '#b45309' }}>🤒 MEDICAL ABSENCE</div>
              <div style={{ fontSize: '20px', fontWeight: '900', color: '#d97706', marginTop: '2px' }}>{sickInCurrentClass}</div>
            </div>
            <div style={{ padding: '12px 14px', borderRadius: '12px', background: '#f0fdfa', border: '1.5px solid #99f6e4', textAlign: 'center' }}>
              <div style={{ fontSize: '10px', fontWeight: '800', color: '#0f766e' }}>🏛️ OFFICIAL ABSENT</div>
              <div style={{ fontSize: '20px', fontWeight: '900', color: '#0d9488', marginTop: '2px' }}>{officialInCurrentClass}</div>
            </div>
            <div style={{ padding: '12px 14px', borderRadius: '12px', background: '#eef2ff', border: '1px solid #c7d2fe', textAlign: 'center' }}>
              <div style={{ fontSize: '10px', fontWeight: '800', color: '#4338ca' }}>🪪 GATE OUTPASS</div>
              <div style={{ fontSize: '20px', fontWeight: '900', color: '#4f46e5', marginTop: '2px' }}>{outpassInCurrentClass}</div>
            </div>
          </div>

          {/* SLIDING ACCORDION: WHATSAPP VERIFICATION FORWARDING BAR */}
          <div style={{ marginBottom: '16px', borderRadius: '10px', border: '1px solid #e2e8f0', background: '#f8fafc', overflow: 'hidden' }}>
            <div
              onClick={() => setShowForwardDrawer(prev => !prev)}
              style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
            >
              <div style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a' }}>
                📲 Share / Verify Absentees via WhatsApp ({absentInCurrentClass} Absent • CT: {classTeacherObj?.fullName || 'Not Assigned'})
              </div>
              <span style={{ color: '#4f46e5', fontSize: '12px', fontWeight: '700' }}>
                {showForwardDrawer ? '▲ Hide' : '▼ Share / Copy List'}
              </span>
            </div>

            {showForwardDrawer && (
              <div style={{ padding: '12px 14px', borderTop: '1px solid #e2e8f0', background: '#ffffff', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(buildClassAbsenteeReportText());
                    alert(`✅ Copied Class ${selectedClass} Night Attendance Report to clipboard!`);
                  }}
                  style={styles.buttonSecondary}
                >
                  📋 Copy Report Text
                </button>
                <button
                  type="button"
                  onClick={() => openDirectWhatsApp(classTeacherObj?.whatsappNumber || classTeacherObj?.mobileNumber, buildClassAbsenteeReportText())}
                  style={styles.buttonPrimary}
                >
                  💬 WA Class Teacher ({classTeacherObj?.fullName || selectedClass})
                </button>
                {outreachCoordObj && (
                  <button
                    type="button"
                    onClick={() => openDirectWhatsApp(outreachCoordObj.whatsappNumber || outreachCoordObj.mobileNumber, buildClassAbsenteeReportText())}
                    style={styles.buttonSecondary}
                  >
                    🌍 Verify with Outreach
                  </button>
                )}
                {niicsCoordObj && (
                  <button
                    type="button"
                    onClick={() => openDirectWhatsApp(niicsCoordObj.whatsappNumber || niicsCoordObj.mobileNumber, buildClassAbsenteeReportText())}
                    style={styles.buttonSecondary}
                  >
                    🎓 Send to NIICS Coordinator
                  </button>
                )}
              </div>
            )}
          </div>

          {/* SEARCH + PRE-RECORD TOGGLE + UNDO + QUICK ACTIONS */}
          <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="text"
              placeholder="🔍 Quick search student in this class..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              style={{ ...styles.input, maxWidth: '280px', padding: '8px 12px', fontSize: '13px' }}
            />
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => setPreRecordMode(p => !p)}
                style={{
                  ...styles.buttonSecondary,
                  background: preRecordMode ? '#eef2ff' : '#ffffff',
                  color: preRecordMode ? '#4f46e5' : '#334155',
                  border: preRecordMode ? '2px solid #4f46e5' : '1px solid #cbd5e1',
                  fontWeight: '800'
                }}
              >
                {preRecordMode ? '✓ Done Pre-Recording (Roll-Call Mode)' : '📝 Pre-Record Leaves & Reasons'}
              </button>

              {previousSavedState && (
                <button
                  type="button"
                  onClick={handleUndoLastSave}
                  disabled={saving}
                  style={{ ...styles.buttonSecondary, background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a', fontWeight: '800' }}
                  title="Roll back to previous saved attendance"
                >
                  ↺ Undo Last Save
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  const next = {};
                  classStudents.forEach(s => {
                    const ad = String(s.adNo || '').trim();
                    next[ad] = getActiveOutpassForStudent(ad) ? 'OUTPASS' : 'PRESENT';
                  });
                  setStatusMap(next);
                }}
                style={styles.buttonSecondary}
              >
                ✓ All Present
              </button>

              <button
                type="button"
                onClick={handleCopyClassUnexcusedAbsentees}
                style={styles.buttonSecondary}
                title="Copy unexcused absentees of tonight to clipboard"
              >
                📋 Copy Absentees
              </button>

              <button
                type="button"
                onClick={handleSaveClassAttendance}
                disabled={saving}
                style={styles.buttonPrimary}
              >
                {saving ? 'Saving...' : `💾 Save Class ${selectedClass} Night Attendance`}
              </button>
            </div>
          </div>

          {/* 🌟 MINIMALIST MOBILE-FRIENDLY STUDENT CARDS */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(285px, 1fr))', gap: '12px' }}>
            {classStudents
              .filter(s => !searchFilter.trim() || (s.firstName || '').toLowerCase().includes(searchFilter.toLowerCase()) || String(s.adNo || '').toLowerCase().includes(searchFilter.toLowerCase()))
              .map((st, idx) => {
                const ad = String(st.adNo || '').trim();
                const curStatus = statusMap[ad] || 'PRESENT';
                const activePass = getActiveOutpassForStudent(ad);
                const activeRecAbs = getActiveRecordedAbsenceForStudent(ad, selectedDate);
                const activeCampusWaiver = activeCampusWaiversMap[ad.toUpperCase()];

                const cardThemes = {
                  PRESENT: { bg: '#ffffff', border: '#e2e8f0', badgeBg: '#dcfce7', badgeColor: '#15803d', label: 'Present' },
                  ABSENT: { bg: '#fff1f2', border: '#fecdd3', badgeBg: '#ffe4e6', badgeColor: '#e11d48', label: 'Absent' },
                  OUTPASS: { bg: '#eef2ff', border: '#c7d2fe', badgeBg: '#e0e7ff', badgeColor: '#4338ca', label: 'Leave' },
                  OFFICIAL: { bg: '#f0fdfa', border: '#99f6e4', badgeBg: '#ccfbf1', badgeColor: '#0f766e', label: 'Official' },
                  SICK_ROOM: { bg: '#fffbeb', border: '#fde68a', badgeBg: '#fef3c7', badgeColor: '#b45309', label: 'Medical' }
                };
                const theme = cardThemes[curStatus] || cardThemes.PRESENT;

                return (
                  <div
                    key={st.regNo || st.adNo || idx}
                    onClick={() => {
                      if (preRecordMode) {
                        openAbsenceModal(st, curStatus === 'PRESENT' ? 'ABSENT' : curStatus, activeRecAbs);
                      } else {
                        handleStudentQuickToggle(st);
                      }
                    }}
                    style={{
                      padding: '14px',
                      borderRadius: '12px',
                      background: theme.bg,
                      border: `1.5px solid ${theme.border}`,
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <ProfileAvatar name={st.firstName} code={st.adNo} photoUrl={st.photoUrl} size={38} />
                        <div>
                          <div style={{ fontWeight: '700', color: '#0f172a', fontSize: '14px', lineHeight: 1.25 }}>
                            #{st.rollNo || idx + 1} • {st.firstName}
                          </div>
                          <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '600', marginTop: '2px' }}>
                            Ad.No: #{st.adNo} • {st.department || 'GEN'}
                          </div>
                        </div>
                      </div>

                      <span style={{ background: theme.badgeBg, color: theme.badgeColor, padding: '3px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: '800', whiteSpace: 'nowrap' }}>
                        {theme.label}
                      </span>
                    </div>

                    {/* 🌟 INLINE RECORDED ABSENCE NOTICE */}
                    {activeRecAbs && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          background: activeRecAbs.status === 'SICK_ROOM' ? '#fffbeb' : activeRecAbs.status === 'OFFICIAL' ? '#f0fdfa' : '#fff1f2',
                          border: `1px solid ${activeRecAbs.status === 'SICK_ROOM' ? '#fde68a' : activeRecAbs.status === 'OFFICIAL' ? '#99f6e4' : '#fecdd3'}`,
                          padding: '7px 10px',
                          borderRadius: '8px',
                          fontSize: '11px',
                          color: activeRecAbs.status === 'SICK_ROOM' ? '#92400e' : activeRecAbs.status === 'OFFICIAL' ? '#0f766e' : '#be123c',
                          lineHeight: 1.35
                        }}
                      >
                        <div style={{ fontWeight: '800', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span>📌 {activeRecAbs.status === 'SICK_ROOM' ? '🤒 Medical / Sick' : activeRecAbs.status === 'OFFICIAL' ? '🏛️ Official Duty' : '🔴 Reason'}: &ldquo;{activeRecAbs.reason}&rdquo;</span>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button
                              type="button"
                              onClick={() => openAbsenceModal(st, activeRecAbs.status, activeRecAbs)}
                              style={{ background: 'transparent', border: 'none', color: '#4f46e5', cursor: 'pointer', fontSize: '10px', fontWeight: '800', textDecoration: 'underline' }}
                            >
                              ✏️ Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMarkPresentAndClearAbsence(st)}
                              style={{ background: 'transparent', border: 'none', color: '#e11d48', cursor: 'pointer', fontSize: '10px', fontWeight: '800', textDecoration: 'underline' }}
                            >
                              ✕ Clear
                            </button>
                          </div>
                        </div>
                        {activeRecAbs.hasDuration && activeRecAbs.endDate && (
                          <div style={{ fontSize: '10px', marginTop: '3px', fontWeight: '700' }}>
                            ⏳ Active until: {activeRecAbs.endDate} ({activeRecAbs.endTime || '22:00'})
                          </div>
                        )}
                        <div style={{ fontSize: '10px', marginTop: '2px', fontWeight: '700', opacity: 0.9 }}>
                          Permitted by: Usthad {activeRecAbs.recordedBy || 'Class Teacher'}
                        </div>
                      </div>
                    )}

                    {activeCampusWaiver && activeCampusWaiver.waiverType === 'SICK_IN_ROOM' && isWaiverActiveOnDate(activeCampusWaiver, selectedDate) && !activeRecAbs && (
                      <div
                        style={{
                          background: activeCampusWaiver.waiverType === 'JAMATH_EXEMPTION' ? '#fffbeb' : '#fff1f2',
                          border: `1px solid ${activeCampusWaiver.waiverType === 'JAMATH_EXEMPTION' ? '#fde68a' : '#fecdd3'}`,
                          padding: '7px 10px',
                          borderRadius: '8px',
                          fontSize: '11px',
                          color: activeCampusWaiver.waiverType === 'JAMATH_EXEMPTION' ? '#92400e' : '#be123c',
                          lineHeight: 1.35
                        }}
                      >
                        <div style={{ fontWeight: '800' }}>
                          {activeCampusWaiver.waiverType === 'JAMATH_EXEMPTION' ? '🩹 Masjid Exemption' : '🤒 Bed Rest in Hostel'}: {activeCampusWaiver.injuryReason || activeCampusWaiver.diagnosis || 'Medical Waiver'}
                        </div>
                        <div style={{ fontSize: '10px', marginTop: '2px', fontWeight: '700', color: activeCampusWaiver.waiverType === 'JAMATH_EXEMPTION' ? '#b45309' : '#b91c1c' }}>
                          Permitted by: Usthad {activeCampusWaiver.issuedByName || activeCampusWaiver.issuedBy || 'Class Teacher'}{activeCampusWaiver.validUntil ? ` • Valid until: ${activeCampusWaiver.validUntil}` : ''}
                        </div>
                      </div>
                    )}

                    {activePass && (
                      <div style={{ background: '#eef2ff', border: '1px solid #c7d2fe', padding: '7px 10px', borderRadius: '8px', fontSize: '11px', color: '#4338ca', lineHeight: 1.35 }}>
                        <div style={{ fontWeight: '700' }}>
                          🪪 Outside Campus ({activePass.leaveCategory || 'Leave'}): {activePass.destination}
                        </div>
                        <div style={{ fontSize: '10px', marginTop: '2px', fontWeight: '700' }}>
                          Reason: &ldquo;{activePass.purpose || activePass.reason || 'Leave'}&rdquo; • Permitted by: Usthad {activePass.teacherName || activePass.permittedBy || 'Class Teacher'}
                        </div>
                      </div>
                    )}

                    {/* 🌟 1-TAP MODAL-FREE 4-WAY ROLL CALL SELECTOR (PRESENT, ABSENT, SICK, OFFICIAL) */}
                    <div onClick={(e) => e.stopPropagation()} style={{ paddingTop: '8px', borderTop: '1px solid #f1f5f9' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(70px, 1fr))', gap: '6px' }}>
                        <button
                          type="button"
                          onClick={() => setStatusMap(prev => ({ ...prev, [ad]: 'PRESENT' }))}
                          style={{
                            padding: '8px 6px',
                            borderRadius: '8px',
                            fontSize: '11px',
                            fontWeight: '800',
                            cursor: 'pointer',
                            background: curStatus === 'PRESENT' ? '#10b981' : '#f8fafc',
                            color: curStatus === 'PRESENT' ? '#ffffff' : '#475569',
                            border: curStatus === 'PRESENT' ? '1.5px solid #10b981' : '1px solid #e2e8f0',
                            transition: 'all 0.15s ease',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '3px'
                          }}
                        >
                          🟢 Pres
                        </button>
                        <button
                          type="button"
                          onClick={() => setStatusMap(prev => ({ ...prev, [ad]: 'ABSENT' }))}
                          style={{
                            padding: '8px 6px',
                            borderRadius: '8px',
                            fontSize: '11px',
                            fontWeight: '800',
                            cursor: 'pointer',
                            background: curStatus === 'ABSENT' ? '#e11d48' : '#f8fafc',
                            color: curStatus === 'ABSENT' ? '#ffffff' : '#475569',
                            border: curStatus === 'ABSENT' ? '1.5px solid #e11d48' : '1px solid #e2e8f0',
                            transition: 'all 0.15s ease',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '3px'
                          }}
                        >
                          🔴 Abs
                        </button>
                        <button
                          type="button"
                          onClick={() => setStatusMap(prev => ({ ...prev, [ad]: 'LEAVE' }))}
                          style={{
                            padding: '8px 6px',
                            borderRadius: '8px',
                            fontSize: '11px',
                            fontWeight: '800',
                            cursor: 'pointer',
                            background: (curStatus === 'LEAVE' || curStatus === 'OUTPASS') ? '#8b5cf6' : '#faf5ff',
                            color: (curStatus === 'LEAVE' || curStatus === 'OUTPASS') ? '#ffffff' : '#7c3aed',
                            border: (curStatus === 'LEAVE' || curStatus === 'OUTPASS') ? '1.5px solid #8b5cf6' : '1px solid #e9d5ff',
                            transition: 'all 0.15s ease',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '3px'
                          }}
                        >
                          🟣 Leave
                        </button>
                        <button
                          type="button"
                          onClick={() => setStatusMap(prev => ({ ...prev, [ad]: 'SICK_ROOM' }))}
                          style={{
                            padding: '8px 6px',
                            borderRadius: '8px',
                            fontSize: '11px',
                            fontWeight: '800',
                            cursor: 'pointer',
                            background: curStatus === 'SICK_ROOM' ? '#d97706' : '#fffbeb',
                            color: curStatus === 'SICK_ROOM' ? '#ffffff' : '#b45309',
                            border: curStatus === 'SICK_ROOM' ? '1.5px solid #d97706' : '1px solid #fde68a',
                            transition: 'all 0.15s ease',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '3px'
                          }}
                        >
                          🤒 Sick
                        </button>
                        <button
                          type="button"
                          onClick={() => setStatusMap(prev => ({ ...prev, [ad]: 'OFFICIAL' }))}
                          style={{
                            padding: '8px 6px',
                            borderRadius: '8px',
                            fontSize: '11px',
                            fontWeight: '800',
                            cursor: 'pointer',
                            background: curStatus === 'OFFICIAL' ? '#0d9488' : '#f0fdfa',
                            color: curStatus === 'OFFICIAL' ? '#ffffff' : '#0f766e',
                            border: curStatus === 'OFFICIAL' ? '1.5px solid #0d9488' : '1px solid #99f6e4',
                            transition: 'all 0.15s ease',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '3px'
                          }}
                        >
                          🏛️ Off
                        </button>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
                        <button
                          type="button"
                          onClick={() => openAbsenceModal(st, curStatus === 'PRESENT' ? 'ABSENT' : curStatus, activeRecAbs)}
                          style={{ background: 'transparent', border: 'none', color: '#64748b', fontSize: '10px', fontWeight: '700', cursor: 'pointer', textDecoration: 'underline' }}
                        >
                          📝 Add multi-day duration / note
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>

          <div style={{ marginTop: '20px' }}>
            <button
              type="button"
              onClick={handleSaveClassAttendance}
              disabled={saving}
              style={{ ...styles.buttonPrimary, width: '100%', padding: '14px', fontSize: '15px' }}
            >
              {saving ? 'Saving Roll-Call...' : `💾 Save Class ${selectedClass} Night Attendance (${selectedDate})`}
            </button>
          </div>

          {/* 🌟 RECORD STUDENT ABSENCE MODAL */}
          {absenceModalStudent && (
            <div
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(15, 23, 42, 0.65)',
                backdropFilter: 'blur(3px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 9999,
                padding: '16px'
              }}
              onClick={() => setAbsenceModalStudent(null)}
            >
              <div
                style={{
                  background: '#ffffff',
                  borderRadius: '16px',
                  width: '100%',
                  maxWidth: '520px',
                  maxHeight: '90vh',
                  overflowY: 'auto',
                  boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                  border: '1px solid #e2e8f0',
                  padding: '20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px'
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* HEADER */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <ProfileAvatar
                      name={absenceModalStudent.firstName}
                      code={absenceModalStudent.adNo}
                      photoUrl={absenceModalStudent.photoUrl}
                      size={44}
                    />
                    <div>
                      <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800', color: '#0f172a' }}>
                        Record Student Absence
                      </h3>
                      <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '600', marginTop: '2px' }}>
                        #{absenceModalStudent.rollNo || ''} • {absenceModalStudent.firstName} (Ad.No: #{absenceModalStudent.adNo}) • Class {selectedClass}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAbsenceModalStudent(null)}
                    style={{ background: '#f1f5f9', border: 'none', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer', fontSize: '14px', fontWeight: '700', color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    ✕
                  </button>
                </div>

                {/* 1. STATUS CATEGORY SELECTOR (Filtered by Role Permission) */}
                <div>
                  <label style={{ fontSize: '11px', fontWeight: '800', color: '#475569', textTransform: 'uppercase', marginBottom: '8px', display: 'block' }}>
                    1. Leave / Absence Category ({checkPreRecordPermission(absenceModalStudent).roleLabel}):
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                    {[
                      { id: 'OUTPASS', label: '🟣 Leave (L)', color: '#8b5cf6' },
                      { id: 'OFFICIAL', label: '🏛️ Official (O)', color: '#0d9488' },
                      { id: 'SICK_ROOM', label: '🤒 Medical (M)', color: '#d97706' },
                      { id: 'ABSENT', label: '🔴 Absent (A)', color: '#e11d48' }
                    ]
                      .filter(cat => checkPreRecordPermission(absenceModalStudent).allowedStatuses.includes(cat.id))
                      .map(cat => {
                        const isSel = absenceModalStatus === cat.id;
                        return (
                          <button
                            key={cat.id}
                            type="button"
                            onClick={() => setAbsenceModalStatus(cat.id)}
                            style={{
                              padding: '8px 4px',
                              borderRadius: '8px',
                              fontSize: '12px',
                              fontWeight: '700',
                              cursor: 'pointer',
                              border: isSel ? `2px solid ${cat.color}` : '1px solid #cbd5e1',
                              background: isSel ? `${cat.color}15` : '#ffffff',
                              color: isSel ? cat.color : '#475569',
                              textAlign: 'center'
                            }}
                          >
                            {cat.label}
                          </button>
                        );
                      })}
                  </div>
                </div>

                {/* 2. REASON CHIPS & INPUT */}
                <div>
                  <label style={{ fontSize: '11px', fontWeight: '800', color: '#475569', textTransform: 'uppercase', marginBottom: '6px', display: 'block' }}>
                    2. Reason for Absence:
                  </label>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
                    {[
                      '🤒 Sick / Fever in Room',
                      '🏥 Hospital / Doctor Care',
                      '🏡 Home Leave (Approved)',
                      '🚗 Outstation / Travel',
                      '👨‍👩‍👦 Family Emergency',
                      '🏛️ Campus / Official Duty',
                      '⚠️ Unexcused / Missing'
                    ].map(rStr => {
                      const isSel = absenceModalReason === rStr;
                      return (
                        <button
                          key={rStr}
                          type="button"
                          onClick={() => setAbsenceModalReason(rStr)}
                          style={{
                            padding: '5px 10px',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: '700',
                            cursor: 'pointer',
                            border: isSel ? '1.5px solid #4f46e5' : '1px solid #cbd5e1',
                            background: isSel ? '#4f46e5' : '#f8fafc',
                            color: isSel ? '#ffffff' : '#334155'
                          }}
                        >
                          {rStr}
                        </button>
                      );
                    })}
                  </div>
                  <input
                    type="text"
                    value={absenceModalReason}
                    onChange={(e) => setAbsenceModalReason(e.target.value)}
                    placeholder="Or type custom reason (e.g. In room 204 with fever, resting)..."
                    style={{ ...styles.input, fontSize: '13px', padding: '9px 12px', width: '100%' }}
                  />
                </div>

                {/* 3. DURATION / END DATE & TIME */}
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', margin: 0 }}>
                      <input
                        type="checkbox"
                        checked={absenceModalHasDuration}
                        onChange={(e) => {
                          setAbsenceModalHasDuration(e.target.checked);
                          if (e.target.checked && !absenceModalEndDate) {
                            setAbsenceModalEndDate(selectedDate);
                          }
                        }}
                        style={{ width: '16px', height: '16px', accentColor: '#4f46e5', cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: '13px', fontWeight: '800', color: '#0f172a' }}>
                        Set End Date & Time (Multi-day absence)
                      </span>
                    </label>
                  </div>

                  {absenceModalHasDuration && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px' }}>
                      {/* Quick duration helper chips */}
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {[
                          { label: 'Today Only', days: 0 },
                          { label: 'Tomorrow (+1d)', days: 1 },
                          { label: '+2 Days', days: 2 },
                          { label: '+3 Days', days: 3 },
                          { label: '+1 Week', days: 7 }
                        ].map(chip => (
                          <button
                            key={chip.label}
                            type="button"
                            onClick={() => {
                              const newD = addDaysToDate(selectedDate, chip.days);
                              setAbsenceModalEndDate(newD);
                            }}
                            style={{
                              padding: '4px 10px',
                              borderRadius: '6px',
                              fontSize: '11px',
                              fontWeight: '700',
                              cursor: 'pointer',
                              background: '#ffffff',
                              border: '1px solid #cbd5e1',
                              color: '#334155'
                            }}
                          >
                            {chip.label}
                          </button>
                        ))}
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                        <div>
                          <label style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', display: 'block', marginBottom: '4px' }}>
                            Permitted From (Start Date):
                          </label>
                          <input
                            type="date"
                            value={absenceModalStartDate}
                            onChange={(e) => setAbsenceModalStartDate(e.target.value)}
                            style={{ ...styles.input, width: '100%', fontSize: '12px', padding: '7px 10px' }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', display: 'block', marginBottom: '4px' }}>
                            Permitted From (Start Time):
                          </label>
                          <input
                            type="time"
                            value={absenceModalStartTime}
                            onChange={(e) => setAbsenceModalStartTime(e.target.value)}
                            style={{ ...styles.input, width: '100%', fontSize: '12px', padding: '7px 10px' }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', display: 'block', marginBottom: '4px' }}>
                            Permitted Until (End Date):
                          </label>
                          <input
                            type="date"
                            value={absenceModalEndDate}
                            onChange={(e) => setAbsenceModalEndDate(e.target.value)}
                            style={{ ...styles.input, width: '100%', fontSize: '12px', padding: '7px 10px' }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', display: 'block', marginBottom: '4px' }}>
                            Permitted Until (End Time):
                          </label>
                          <input
                            type="time"
                            value={absenceModalEndTime}
                            onChange={(e) => setAbsenceModalEndTime(e.target.value)}
                            style={{ ...styles.input, width: '100%', fontSize: '12px', padding: '7px 10px' }}
                          />
                        </div>
                      </div>

                      <div style={{ fontSize: '11px', color: '#047857', background: '#ecfdf5', border: '1px solid #a7f3d0', padding: '6px 10px', borderRadius: '6px', lineHeight: 1.35 }}>
                        💡 This absence will automatically persist until <strong>{absenceModalEndDate} ({absenceModalEndTime})</strong>. After that time passes, the student automatically reverts to normal (Present).
                      </div>
                    </div>
                  )}
                </div>

                {/* FOOTER ACTIONS */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', paddingTop: '10px', borderTop: '1px solid #f1f5f9' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setStatusMap(prev => ({ ...prev, [String(absenceModalStudent.adNo).trim()]: absenceModalStatus || 'ABSENT' }));
                      setAbsenceModalStudent(null);
                    }}
                    style={{ ...styles.buttonSecondary, fontSize: '12px', padding: '8px 12px' }}
                  >
                    ⚡ Mark Tonight Only
                  </button>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={() => setAbsenceModalStudent(null)}
                      style={{ ...styles.buttonSecondary, fontSize: '12px', padding: '8px 14px' }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveSingleStudentAbsence}
                      disabled={absenceModalSaving}
                      style={{ ...styles.buttonPrimary, fontSize: '12px', padding: '8px 18px', fontWeight: '800' }}
                    >
                      {absenceModalSaving ? 'Saving...' : '💾 Save for This Student Only'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* =========================================================
              MODE 2: ADMIN INSTITUTION-WIDE & MONTHLY/TOTAL SUMMARY
             ========================================================= */}
          {viewMode === 'admin_summary' && canViewAdminAnalytics && (
            <div style={styles.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '18px' }}>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: '#0f172a' }}>
                  Institution-Wide Night Attendance Summary
                </h3>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={handleCopyAllClassesNightReport}
                    style={styles.buttonSecondary}
                  >
                    📋 Copy All Classes Summary
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const lines = [
                        `*🌙 DHIU DEGREE SECTION — INSTITUTION NIGHT ATTENDANCE SUMMARY*`,
                        `*Date:* ${selectedDate}`,
                        `*Total Strength:* ${instSummary.totalStrength} | *Present:* ${instSummary.totalPresent} | *Unexcused Absent:* ${instSummary.totalUnexcusedAbsent} | *Medical:* ${instSummary.totalSick} | *Official:* ${instSummary.totalOfficial || 0}`,
                        `-----------------------------------------`
                      ];
                      instSummary.classSummaries.forEach(c => {
                        if (!c.isTaken) {
                          lines.push(`• *${c.className}:* ⏳ Pending (CT: ${c.classTeacherName})`);
                        } else {
                          const absNames = c.absentStudents.map(s => `${s.firstName} (#${s.adNo})`).join(', ');
                          lines.push(`• *${c.className}:* Present ${c.presentCount}/${c.strength} | Absent: ${c.absentCount} | Medical: ${c.sickCount} | Leave: ${c.outpassCount}${absNames ? `\n   🔴 _Absent:_ ${absNames}` : ''}`);
                        }
                      });
                      openWhatsAppGroupAndCopy(staffGroupLink, lines.join('\n'), 'Staff WhatsApp Group');
                    }}
                    style={styles.buttonPrimary}
                  >
                    💬 Share Summary to Staff WA Group
                  </button>
                </div>
              </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', background: '#f8fafc', padding: '12px 16px', borderRadius: '10px', border: '1px solid #e2e8f0', marginBottom: '18px' }}>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {[
                { id: 'daily', label: `Specific Date (${selectedDate})` },
                { id: 'monthly', label: 'Monthly Night Report' },
                { id: 'total', label: 'Total Semester Summary' }
              ].map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setNightRepScope(t.id)}
                  style={{
                    padding: '7px 14px',
                    borderRadius: '8px',
                    border: nightRepScope === t.id ? '1px solid #4f46e5' : '1px solid transparent',
                    fontWeight: '700',
                    fontSize: '12px',
                    cursor: 'pointer',
                    background: nightRepScope === t.id ? '#4f46e5' : '#ffffff',
                    color: nightRepScope === t.id ? '#ffffff' : '#475569'
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {nightRepScope !== 'daily' && (
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                <select value={nightRepClass} onChange={e => setNightRepClass(e.target.value)} style={{ ...styles.input, width: '150px', padding: '7px 10px' }}>
                  <option value="ALL">All Classes</option>
                  {DEFAULT_CLASSES.map(c => <option key={c} value={c}>Class {c}</option>)}
                </select>
                {nightRepScope === 'monthly' && (
                  <input type="month" value={nightRepMonth} onChange={e => setNightRepMonth(e.target.value)} style={{ ...styles.input, width: '160px', padding: '7px 10px' }} />
                )}
              </div>
            )}
          </div>

          {nightRepScope !== 'daily' ? (() => {
            const scopedDocs = nightRepScope === 'monthly'
              ? monthlyDocsList.filter(d => String(d.date || '').startsWith(nightRepMonth))
              : monthlyDocsList;
            const targetStudents = students.filter(s => nightRepClass === 'ALL' || (s.classes || []).includes(nightRepClass));

            return (
              <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left', minWidth: '750px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '11px', textTransform: 'uppercase' }}>
                      <th style={{ padding: '12px 14px' }}>#</th>
                      <th style={{ padding: '12px 14px' }}>STUDENT &amp; AD.NO</th>
                      <th style={{ padding: '12px 14px' }}>CLASS</th>
                      <th style={{ padding: '12px 14px', textAlign: 'center' }}>NIGHTS HELD</th>
                      <th style={{ padding: '12px 14px', textAlign: 'center' }}>PRESENT</th>
                      <th style={{ padding: '12px 14px', textAlign: 'center' }}>UNEXCUSED ABSENT</th>
                      <th style={{ padding: '12px 14px', textAlign: 'center' }}>LEAVE / OFFICIAL</th>
                      <th style={{ padding: '12px 14px', textAlign: 'center' }}>SICK</th>
                      <th style={{ padding: '12px 14px', textAlign: 'center' }}>NIGHT %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {targetStudents.map((st, idx) => {
                      const ad = String(st.adNo || '').trim();
                      const stCls = (st.classes || [])[0] || '';
                      let nightsHeld = 0, nightsPres = 0, nightsAbs = 0, nightsOut = 0, nightsSick = 0;

                      scopedDocs.forEach(dayDoc => {
                        const cRec = (dayDoc.classes || {})[stCls];
                        if (!cRec) return;
                        nightsHeld++;
                        if ((cRec.absentAdNos || []).includes(ad)) nightsAbs++;
                        else if ((cRec.outpassAdNos || []).includes(ad) || (cRec.officialAdNos || []).includes(ad)) nightsOut++;
                        else if ((cRec.sickAdNos || []).includes(ad)) nightsSick++;
                        else nightsPres++;
                      });

                      const pct = nightsHeld > 0 ? (((nightsPres + nightsSick) / nightsHeld) * 100).toFixed(1) : '100.0';

                      return (
                        <tr key={st.regNo} style={{ borderBottom: '1px solid #f1f5f9', background: '#ffffff' }}>
                          <td style={{ padding: '12px 14px', color: '#64748b' }}>{idx + 1}</td>
                          <td style={{ padding: '12px 14px', fontWeight: '700', color: '#0f172a' }}>{st.firstName} (#{st.adNo})</td>
                          <td style={{ padding: '12px 14px', fontWeight: '600', color: '#475569' }}>{stCls}</td>
                          <td style={{ padding: '12px 14px', textAlign: 'center' }}>{nightsHeld}</td>
                          <td style={{ padding: '12px 14px', textAlign: 'center', fontWeight: '700', color: '#047857' }}>{nightsPres}</td>
                          <td style={{ padding: '12px 14px', textAlign: 'center', fontWeight: '700', color: nightsAbs > 0 ? '#e11d48' : '#64748b' }}>{nightsAbs}</td>
                          <td style={{ padding: '12px 14px', textAlign: 'center', color: '#4f46e5', fontWeight: '600' }}>{nightsOut}</td>
                          <td style={{ padding: '12px 14px', textAlign: 'center', color: '#b45309' }}>{nightsSick}</td>
                          <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                            <span style={{ background: Number(pct) < 85 ? '#fff1f2' : '#dcfce7', color: Number(pct) < 85 ? '#e11d48' : '#15803d', padding: '3px 10px', borderRadius: '999px', fontWeight: '700', fontSize: '11px' }}>
                              {nightsHeld > 0 ? `${pct}%` : '-'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })() : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px', marginBottom: '20px' }}>
                <div style={{ padding: '16px', borderRadius: '12px', background: '#f8fafc', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                  <span style={{ fontSize: '11px', fontWeight: '800', color: '#64748b' }}>CLASSES RECORDED</span>
                  <div style={{ fontSize: '24px', fontWeight: '900', color: '#0f172a', marginTop: '4px' }}>
                    {instSummary.classesTakenCount} / {DEFAULT_CLASSES.length}
                  </div>
                </div>
                <div style={{ padding: '16px', borderRadius: '12px', background: '#ecfdf5', border: '1px solid #a7f3d0', textAlign: 'center' }}>
                  <span style={{ fontSize: '11px', fontWeight: '800', color: '#047857' }}>TOTAL PRESENT</span>
                  <div style={{ fontSize: '24px', fontWeight: '900', color: '#065f46', marginTop: '4px' }}>{instSummary.totalPresent}</div>
                </div>
                <div style={{ padding: '16px', borderRadius: '12px', background: '#fff1f2', border: '1px solid #fecdd3', textAlign: 'center' }}>
                  <span style={{ fontSize: '11px', fontWeight: '800', color: '#be123c' }}>UNEXCUSED ABSENT</span>
                  <div style={{ fontSize: '24px', fontWeight: '900', color: '#e11d48', marginTop: '4px' }}>{instSummary.totalUnexcusedAbsent}</div>
                </div>
                <div style={{ padding: '16px', borderRadius: '12px', background: '#fffbeb', border: '1.5px solid #fde68a', textAlign: 'center' }}>
                  <span style={{ fontSize: '11px', fontWeight: '800', color: '#b45309' }}>🤒 MEDICAL ABSENCE</span>
                  <div style={{ fontSize: '24px', fontWeight: '900', color: '#d97706', marginTop: '4px' }}>{instSummary.totalSick}</div>
                </div>
                <div style={{ padding: '16px', borderRadius: '12px', background: '#f0fdfa', border: '1.5px solid #99f6e4', textAlign: 'center' }}>
                  <span style={{ fontSize: '11px', fontWeight: '800', color: '#0f766e' }}>🏛️ OFFICIAL ABSENT</span>
                  <div style={{ fontSize: '24px', fontWeight: '900', color: '#0d9488', marginTop: '4px' }}>{instSummary.totalOfficial || 0}</div>
                </div>
                <div style={{ padding: '16px', borderRadius: '12px', background: '#eef2ff', border: '1px solid #c7d2fe', textAlign: 'center' }}>
                  <span style={{ fontSize: '11px', fontWeight: '800', color: '#4338ca' }}>🪪 GATE LEAVE</span>
                  <div style={{ fontSize: '24px', fontWeight: '900', color: '#4f46e5', marginTop: '4px' }}>{instSummary.totalOnOutpass}</div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: '14px' }}>
                {instSummary.classSummaries.map(c => (
                  <div key={c.className} style={{ padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', background: '#ffffff', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '12px' }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <span style={{ fontSize: '15px', fontWeight: '800', color: '#0f172a' }}>Class {c.className}</span>
                        {c.isTaken ? (
                          <span style={{ background: '#dcfce7', color: '#15803d', padding: '3px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: '700' }}>
                            ✓ By {c.takenBy}
                          </span>
                        ) : (
                          <span style={{ background: '#f1f5f9', color: '#64748b', padding: '3px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: '700' }}>
                            Pending
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '600', marginBottom: '8px' }}>
                        CT: {c.classTeacherName} • Present: <strong>{c.presentCount} / {c.strength}</strong>
                        {c.isTaken && (
                          <span style={{ marginLeft: '6px' }}>
                            • <span style={{ color: '#d97706', fontWeight: '700' }}>Med: {c.sickCount}</span>
                            • <span style={{ color: '#0d9488', fontWeight: '700' }}>Off: {c.officialCount || 0}</span>
                          </span>
                        )}
                      </div>

                      {c.absentStudents.length > 0 && (
                        <div style={{ marginTop: '6px' }}>
                          <div style={{ fontSize: '11px', fontWeight: '700', color: '#e11d48', marginBottom: '4px' }}>Absent ({c.absentStudents.length}):</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                            {c.absentStudents.map(s => (
                              <span key={s.adNo} style={{ background: '#fff1f2', color: '#e11d48', padding: '2px 7px', borderRadius: '6px', fontSize: '11px', fontWeight: '700' }}>
                                {s.firstName} (#{s.adNo})
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setSelectedClass(c.className);
                        setViewMode('take_attendance');
                      }}
                      style={styles.buttonSecondary}
                    >
                      Open Class {c.className}
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* =========================================================
          MODE 3: REGULAR / CHRONIC ABSENTEES TRACKER
         ========================================================= */}
      {viewMode === 'regular_absentees' && canViewAdminAnalytics && (
        <div style={styles.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: '#0f172a' }}>
                Regular Night Absentees ({monthlyDocsList.length} Recorded Nights)
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>
                Ranks students by total unexcused night absences.
              </p>
            </div>
            <button type="button" onClick={loadRecent30DaysForAnalytics} style={styles.buttonSecondary}>
              🔄 Refresh Archive
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
            {getRegularAbsenteesList().map((item, idx) => (
              <div key={item.adNo} style={{ padding: '14px', borderRadius: '12px', border: '1px solid #e2e8f0', background: '#ffffff', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <ProfileAvatar name={item.studentName} code={item.adNo} photoUrl={item.photoUrl} size={36} />
                    <div>
                      <div style={{ fontWeight: '700', color: '#0f172a', fontSize: '14px' }}>#{idx + 1} • {item.studentName}</div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>Ad.No: #{item.adNo} • Class {item.studentClass}</div>
                    </div>
                  </div>
                  <span style={{ background: '#fff1f2', color: '#e11d48', padding: '4px 9px', borderRadius: '999px', fontWeight: '800', fontSize: '11px' }}>
                    {item.unexcusedCount} Nights
                  </span>
                </div>
                <div style={{ fontSize: '11px', color: '#64748b' }}>
                  Dates: {item.absentDates.slice(0, 6).join(', ')}
                </div>
                <button
                  type="button"
                  onClick={() => openDirectWhatsApp(item.parentWhatsapp, `Assalamu Alaikum, official notice from Darul Huda Degree Section regarding ${item.studentName} (#${item.adNo}):`)}
                  style={styles.buttonSecondary}
                >
                  💬 Contact Parent on WhatsApp
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* =========================================================
          MODE 4: EXTRA ATTENDANCE (SAME DAY MULTI-SESSION)
         ========================================================= */}
      {viewMode === 'extra_attendance' && (
        <div style={{ ...styles.card, marginBottom: 0, padding: '20px' }}>
          {/* CLASS SELECTOR PILLS */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '16px', paddingBottom: '14px', borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', fontWeight: '800', color: '#0f172a', marginRight: '4px' }}>Class:</span>
              {DEFAULT_CLASSES.map(cls => {
                const active = extraClass === cls;
                return (
                  <button
                    key={cls}
                    type="button"
                    onClick={() => {
                      setExtraClass(cls);
                      setExtraStatusMap({});
                      setLastSavedExtraPayload(null);
                    }}
                    style={{
                      padding: '6px 14px',
                      borderRadius: '8px',
                      fontSize: '12px',
                      fontWeight: '800',
                      cursor: 'pointer',
                      border: active ? '1.5px solid #4f46e5' : '1px solid #e2e8f0',
                      background: active ? '#4f46e5' : '#ffffff',
                      color: active ? '#ffffff' : '#475569',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {cls}
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '12px', fontWeight: '700', color: '#64748b' }}>Extra Date:</span>
              <input
                type="date"
                value={extraDate}
                onChange={(e) => setExtraDate(e.target.value)}
                style={{ ...styles.input, width: 'auto', padding: '6px 12px', fontSize: '12px', fontWeight: '700' }}
              />
            </div>
          </div>

          {/* REASON SELECTOR & URDU TOGGLE */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', marginBottom: '16px', background: '#f8fafc', padding: '14px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
            <div>
              <label style={styles.label}>Reason for Extra Attendance</label>
              <select
                value={extraReason}
                onChange={e => setExtraReason(e.target.value)}
                style={styles.input}
              >
                <option value="Special Study Camp">Special Study Camp</option>
                <option value="Event Rehearsal Practice">Event Rehearsal Practice</option>
                <option value="Special Assembly">Special Assembly</option>
                <option value="Madrasa Night Program">Madrasa Night Program</option>
                <option value="Emergency Roll-Call">Emergency Roll-Call</option>
                <option value="Hostel Gate Check">Hostel Gate Check</option>
                <option value="CUSTOM">Custom Reason...</option>
              </select>
              {extraReason === 'CUSTOM' && (
                <input
                  type="text"
                  placeholder="Type specific reason..."
                  value={customExtraReason}
                  onChange={e => setCustomExtraReason(e.target.value)}
                  style={{ ...styles.input, marginTop: '8px' }}
                />
              )}
            </div>

            <div>
              <label style={styles.label}>Urdu Stream Handling</label>
              <button
                type="button"
                onClick={() => setIncludeUrdu(!includeUrdu)}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  fontWeight: '800',
                  fontSize: '13px',
                  cursor: 'pointer',
                  border: includeUrdu ? '1.5px solid #10b981' : '1.5px solid #f59e0b',
                  background: includeUrdu ? '#ecfdf5' : '#fffbeb',
                  color: includeUrdu ? '#065f46' : '#92400e',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <span>{includeUrdu ? '🌐 Urdu Students: INCLUDED' : '⏭️ Urdu Students: SKIPPED / IGNORED'}</span>
                <span style={{ fontSize: '11px', textDecoration: 'underline' }}>Click to Toggle</span>
              </button>
              <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                {includeUrdu ? 'Urdu stream students (#U...) are included in roll-call.' : 'Urdu stream students are completely omitted from attendance & statistics.'}
              </div>
            </div>

            <div>
              <label style={styles.label}>Designated Class Teacher</label>
              {(() => {
                const ct = getClassTeacherForClass(extraClass);
                return (
                  <div style={{ padding: '8px 12px', background: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px', fontWeight: '700', color: '#0f172a' }}>
                    👨‍🏫 {ct?.fullName || 'Not assigned'} <span style={{ color: '#64748b', fontSize: '11px' }}>({ct?.whatsappNumber || ct?.mobileNumber || 'No Phone'})</span>
                  </div>
                );
              })()}
            </div>
          </div>

          
          {extraSubmittedState && lastSavedExtraPayload ? (
            <div style={{ padding: '28px', background: '#ffffff', borderRadius: '14px', border: '1.5px solid #cbd5e1', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
              <div style={{ textAlign: 'center', marginBottom: '22px' }}>
                <div style={{ fontSize: '44px', marginBottom: '8px' }}>🎉</div>
                <h3 style={{ margin: '0 0 6px 0', fontSize: '22px', fontWeight: '900', color: '#0f172a' }}>
                  Extra Attendance Successfully Recorded!
                </h3>
                <p style={{ margin: 0, fontSize: '14px', color: '#64748b', fontWeight: '600' }}>
                  Recorded separately for <strong>Class {lastSavedExtraPayload.className}</strong> on <strong>{lastSavedExtraPayload.date}</strong> under reason: <strong style={{ color: '#4f46e5' }}>{lastSavedExtraPayload.reason}</strong>
                </p>
              </div>

              {/* STATS TILES */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '20px' }}>
                <div style={{ padding: '14px', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                  <div style={{ fontSize: '11px', fontWeight: '800', color: '#64748b' }}>TOTAL ENROLLED</div>
                  <div style={{ fontSize: '22px', fontWeight: '900', color: '#0f172a', marginTop: '2px' }}>{lastSavedExtraPayload.totalStrength}</div>
                </div>
                <div style={{ padding: '14px', background: '#ecfdf5', borderRadius: '10px', border: '1px solid #a7f3d0', textAlign: 'center' }}>
                  <div style={{ fontSize: '11px', fontWeight: '800', color: '#047857' }}>PRESENT</div>
                  <div style={{ fontSize: '22px', fontWeight: '900', color: '#065f46', marginTop: '2px' }}>{lastSavedExtraPayload.presentCount}</div>
                </div>
                <div style={{ padding: '14px', background: '#fff1f2', borderRadius: '10px', border: '1px solid #fecdd3', textAlign: 'center' }}>
                  <div style={{ fontSize: '11px', fontWeight: '800', color: '#be123c' }}>ABSENT</div>
                  <div style={{ fontSize: '22px', fontWeight: '900', color: '#e11d48', marginTop: '2px' }}>{lastSavedExtraPayload.absentCount}</div>
                </div>
                <div style={{ padding: '14px', background: '#fef3c7', borderRadius: '10px', border: '1px solid #fde68a', textAlign: 'center' }}>
                  <div style={{ fontSize: '11px', fontWeight: '800', color: '#92400e' }}>URDU STREAM</div>
                  <div style={{ fontSize: '14px', fontWeight: '900', color: '#b45309', marginTop: '6px' }}>{lastSavedExtraPayload.includeUrdu ? 'INCLUDED' : 'SKIPPED'}</div>
                </div>
              </div>

              {/* ABSENT LIST IF ANY */}
              {lastSavedExtraPayload.absentList && lastSavedExtraPayload.absentList.length > 0 ? (
                <div style={{ marginBottom: '22px', padding: '16px', background: '#fff1f2', borderRadius: '10px', border: '1px solid #fecdd3' }}>
                  <div style={{ fontSize: '13px', fontWeight: '800', color: '#be123c', marginBottom: '8px' }}>
                    🔴 Absent Students ({lastSavedExtraPayload.absentList.length}):
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {lastSavedExtraPayload.absentList.map(a => (
                      <span key={a.adNo} style={{ background: '#ffffff', color: '#e11d48', border: '1px solid #fecdd3', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '700' }}>
                        {a.name} (#{a.adNo})
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ marginBottom: '22px', padding: '14px', background: '#ecfdf5', borderRadius: '10px', border: '1px solid #a7f3d0', color: '#047857', fontWeight: '700', fontSize: '13px', textAlign: 'center' }}>
                  ✅ 100% Attendance — Zero Absentees for this extra session!
                </div>
              )}

              {/* ACTION BUTTONS */}
              <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => handleSendExtraToClassTeacher(lastSavedExtraPayload)}
                  style={{ ...styles.buttonSuccess, background: '#25D366', color: '#ffffff', padding: '12px 24px', fontSize: '14px', fontWeight: '800', display: 'inline-flex', alignItems: 'center', gap: '8px', boxShadow: '0 2px 4px rgba(37,211,102,0.2)' }}
                >
                  📲 Send Report to Class Teacher (WhatsApp)
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setExtraSubmittedState(false);
                    setExtraStatusMap({});
                    setLastSavedExtraPayload(null);
                  }}
                  style={{ ...styles.buttonPrimary, padding: '12px 24px', fontSize: '14px', fontWeight: '800' }}
                >
                  ➕ Record Another Extra Session
                </button>

                <button
                  type="button"
                  onClick={() => setExtraSubmittedState(false)}
                  style={{ ...styles.buttonSecondary, padding: '12px 18px', fontSize: '13px', fontWeight: '700' }}
                >
                  ✏️ Edit / Adjust This Session
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setViewMode('extra_reports');
                    loadExtraAttendanceRecords();
                  }}
                  style={{ ...styles.buttonSecondary, padding: '12px 18px', fontSize: '13px', fontWeight: '700' }}
                >
                  📊 View Extra Reports Hub
                </button>
              </div>
            </div>
          ) : (

            <>
            {/* ACTION TOOLBAR: QUICK BUTTONS & SEARCH */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button type="button" onClick={() => handleExtraMarkAll('PRESENT')} style={styles.buttonSuccess}>
                ✓ Mark All Present
              </button>
              <button type="button" onClick={() => handleExtraMarkAll('ABSENT')} style={{ ...styles.buttonSecondary, color: '#e11d48' }}>
                ✕ Mark All Absent
              </button>
              <button
                type="button"
                onClick={handleCopyExtraUnexcusedAbsentees}
                style={styles.buttonSecondary}
              >
                📋 Copy Unexcused Absent (A) Only
              </button>
            </div>

            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <input
                type="text"
                placeholder="Search student or #AdNo..."
                value={extraSearchFilter}
                onChange={e => setExtraSearchFilter(e.target.value)}
                style={{ ...styles.input, width: '220px', padding: '8px 12px', fontSize: '12px' }}
              />
            </div>
          </div>

          {/* STUDENT CARDS GRID */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '10px', marginBottom: '20px' }}>
            {extraStudentsList.map(st => {
              const ad = String(st.adNo || '').trim();
              const activePass = getActiveOutpassForStudent(ad);
              const activeRecAbs = getActiveRecordedAbsenceForStudent(ad, extraDate);
              const activeCampusWaiver = activeCampusWaiversMap[ad.toUpperCase()];
              const isUrdu = isUrduStudent(st);

              let curStatus = extraStatusMap[ad];
              if (!curStatus) {
                if (activeCampusWaiver && activeCampusWaiver.waiverType === 'SICK_IN_ROOM' && isWaiverActiveOnDate(activeCampusWaiver, extraDate)) {
                curStatus = 'SICK_ROOM';
              } else if (activeCampusWaiver && activeCampusWaiver.waiverType === 'JAMATH_EXEMPTION' && isWaiverActiveOnDate(activeCampusWaiver, extraDate)) {
                curStatus = 'JAMATH_EXEMPTION';
                } else if (activeRecAbs) {
                  curStatus = activeRecAbs.status || 'ABSENT';
                } else if (activePass) {
                  curStatus = (activePass.purpose === 'OFFICIAL' || activePass.category === 'OFFICIAL') ? 'OFFICIAL' : 'OUTPASS';
                } else {
                  curStatus = 'PRESENT';
                }
              }

              const isAbsent = curStatus === 'ABSENT';
              const isOutpass = curStatus === 'OUTPASS';
              const isOfficial = curStatus === 'OFFICIAL';
              const isSick = curStatus === 'SICK_ROOM';

              return (
                <div
                  key={st.id || ad}
                  onClick={() => handleExtraQuickTap(ad)}
                  style={{
                    padding: '12px 14px',
                    borderRadius: '10px',
                    cursor: 'pointer',
                    userSelect: 'none',
                    border: isAbsent ? '1.5px solid #fecdd3' : isOutpass ? '1.5px solid #fef08a' : isOfficial ? '1.5px solid #bae6fd' : isSick ? '1.5px solid #e9d5ff' : '1.5px solid #e2e8f0',
                    background: isAbsent ? '#fff1f2' : isOutpass ? '#fefce8' : isOfficial ? '#f0f9ff' : isSick ? '#faf5ff' : '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px',
                    boxShadow: '0 1px 2px rgba(15,23,42,0.03)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
                    <ProfileAvatar name={st.firstName} code={ad} photoUrl={st.photoUrl} size={36} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: '700', fontSize: '13px', color: '#0f172a' }}>{st.firstName}</div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>
                        #{ad} • Roll: {st.rollNo || '—'} {isUrdu && <span style={{ background: '#fef3c7', color: '#92400e', padding: '1px 5px', borderRadius: '4px', fontSize: '10px', fontWeight: '800' }}>URDU</span>}
                      </div>
                      {activeCampusWaiver && isWaiverActiveOnDate(activeCampusWaiver, extraDate) && (
                        <div
                          style={{
                            marginTop: '4px',
                            background: activeCampusWaiver.waiverType === 'JAMATH_EXEMPTION' ? '#fffbeb' : '#fff1f2',
                            color: activeCampusWaiver.waiverType === 'JAMATH_EXEMPTION' ? '#92400e' : '#be123c',
                            padding: '3px 8px',
                            borderRadius: '6px',
                            fontSize: '10px',
                            fontWeight: '800',
                            border: `1px solid ${activeCampusWaiver.waiverType === 'JAMATH_EXEMPTION' ? '#fde68a' : '#fecdd3'}`
                          }}
                        >
                          <div>{activeCampusWaiver.waiverType === 'JAMATH_EXEMPTION' ? '🩹 Masjid Exemption' : '🤒 Bed Rest'}: {activeCampusWaiver.injuryReason || activeCampusWaiver.diagnosis || 'Medical Waiver'}</div>
                          <div style={{ fontSize: '9px', marginTop: '1px', color: activeCampusWaiver.waiverType === 'JAMATH_EXEMPTION' ? '#b45309' : '#b91c1c' }}>
                            Permitted by: Usthad {activeCampusWaiver.issuedByName || activeCampusWaiver.issuedBy || 'Class Teacher'}{activeCampusWaiver.validUntil ? ` • Valid until: ${activeCampusWaiver.validUntil}` : ''}
                          </div>
                        </div>
                      )}
                      {activeRecAbs && !activeCampusWaiver && (
                        <div style={{ marginTop: '4px', background: '#fffbeb', color: '#92400e', padding: '3px 8px', borderRadius: '6px', fontSize: '10px', fontWeight: '700', border: '1px solid #fde68a' }}>
                          <div>📌 {activeRecAbs.reason} {activeRecAbs.hasDuration && activeRecAbs.endDate ? `(Until ${activeRecAbs.endDate})` : ''}</div>
                          <div style={{ fontSize: '9px', marginTop: '1px', opacity: 0.85 }}>
                            Permitted by: Usthad {activeRecAbs.recordedBy || 'Class Teacher'}
                          </div>
                        </div>
                      )}
                      {activePass && (
                        <div style={{ marginTop: '4px', background: '#fffbeb', color: '#92400e', padding: '3px 8px', borderRadius: '6px', fontSize: '10px', fontWeight: '700', border: '1px solid #fde68a' }}>
                          <div>🪪 Outpass: {activePass.destination} ({activePass.leaveCategory || 'Leave'})</div>
                          <div style={{ fontSize: '9px', marginTop: '1px', opacity: 0.85 }}>
                            Permitted by: Usthad {activePass.teacherName || activePass.permittedBy || 'Class Teacher'}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    {[
                      { id: 'PRESENT', label: 'P', activeBg: '#10b981' },
                      { id: 'ABSENT', label: 'A', activeBg: '#e11d48' },
                      { id: 'LEAVE', label: 'L', activeBg: '#8b5cf6' },
                      { id: 'SICK_ROOM', label: 'M', activeBg: '#d97706' },
                      { id: 'OFFICIAL', label: 'O', activeBg: '#0d9488' },
                      { id: 'JAMATH_EXEMPTION', label: 'Jamath', activeBg: '#0284c7' }
                    ].map(b => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => setExtraStatusMap(prev => ({ ...prev, [ad]: b.id }))}
                        style={{
                          padding: '4px 8px',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontWeight: '800',
                          cursor: 'pointer',
                          background: (curStatus === b.id || (b.id === 'LEAVE' && curStatus === 'OUTPASS')) ? b.activeBg : '#f1f5f9',
                          color: (curStatus === b.id || (b.id === 'LEAVE' && curStatus === 'OUTPASS')) ? '#ffffff' : '#475569',
                          border: (curStatus === b.id || (b.id === 'LEAVE' && curStatus === 'OUTPASS')) ? `1px solid ${b.activeBg}` : '1px solid #cbd5e1',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        {b.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* SAVE AND FORWARD TO WHATSAPP ACTION BAR */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
            <div>
              <div style={{ fontWeight: '800', fontSize: '15px', color: '#0f172a' }}>
                Summary: {extraStudentsList.length} Students • {extraStudentsList.filter(s => extraStatusMap[s.adNo] === 'ABSENT').length} Absent
              </div>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                Recorded separately from regular night attendance under reason: <strong>{extraReason === 'CUSTOM' ? customExtraReason : extraReason}</strong>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={handleSaveExtraAttendance}
                disabled={extraSaving}
                style={{ ...styles.buttonPrimary, padding: '12px 24px', fontSize: '14px', fontWeight: '800' }}
              >
                {extraSaving ? '⏳ Saving...' : '💾 Save Extra Attendance'}
              </button>

              <button
                type="button"
                onClick={() => handleSendExtraToClassTeacher()}
                style={{ ...styles.buttonSuccess, background: '#25D366', color: '#ffffff', padding: '12px 20px', fontSize: '14px', fontWeight: '800', display: 'inline-flex', alignItems: 'center', gap: '8px' }}
              >
                📲 Send to Class Teacher (WhatsApp)
              </button>
            </div>
          </div>
            </>
          )}
        </div>
      )}

      {/* =========================================================
          MODE 5: 3RD TAB — UNIFIED ATTENDANCE REPORTS (NIGHT + EXTRA SUB-TABS) (Point 1.8)
         ========================================================= */}
      {(viewMode === 'attendance_reports' || viewMode === 'extra_reports') && (
        <div style={styles.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px', borderBottom: '1px solid #f1f5f9', paddingBottom: '14px' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: '#0f172a' }}>
                📊 Attendance Reports Hub (Night &amp; Extra Roll-Calls)
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>
                Switch between Night Attendance Reports and Extra Attendance Reports below.
              </p>
            </div>

            {/* TWO SUB-TABS: 1. NIGHT ATTENDANCE REPORTS | 2. EXTRA ATTENDANCE REPORTS */}
            <div style={{ display: 'flex', gap: '8px', background: '#f1f5f9', padding: '5px', borderRadius: '10px' }}>
              <button
                type="button"
                onClick={() => setReportsSubTab('night_reports')}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  fontWeight: '800',
                  fontSize: '13px',
                  cursor: 'pointer',
                  border: 'none',
                  background: reportsSubTab === 'night_reports' ? '#4f46e5' : 'transparent',
                  color: reportsSubTab === 'night_reports' ? '#ffffff' : '#475569'
                }}
              >
                🌙 Night Attendance Reports
              </button>
              <button
                type="button"
                onClick={() => {
                  setReportsSubTab('extra_reports');
                  loadExtraAttendanceRecords();
                }}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  fontWeight: '800',
                  fontSize: '13px',
                  cursor: 'pointer',
                  border: 'none',
                  background: reportsSubTab === 'extra_reports' ? '#4f46e5' : 'transparent',
                  color: reportsSubTab === 'extra_reports' ? '#ffffff' : '#475569'
                }}
              >
                ⚡ Extra Attendance Reports
              </button>
            </div>
          </div>

          {/* FILTER BAR (Shared Clean Style for Both Sub-Tabs) */}
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
              <div>
                <label style={styles.label}>Filter by Class</label>
                <select
                  value={extraRepClass}
                  onChange={e => setExtraRepClass(e.target.value)}
                  style={{ ...styles.input, width: '140px', padding: '7px 12px' }}
                >
                  <option value="ALL">All Classes</option>
                  {DEFAULT_CLASSES.map(c => <option key={c} value={c}>Class {c}</option>)}
                </select>
              </div>

              <div>
                <label style={styles.label}>Filter by Date</label>
                <input
                  type="date"
                  value={extraRepDate}
                  onChange={e => setExtraRepDate(e.target.value)}
                  style={{ ...styles.input, width: '160px', padding: '7px 12px' }}
                />
              </div>
              {extraRepDate && (
                <button
                  type="button"
                  onClick={() => setExtraRepDate('')}
                  style={{ ...styles.buttonSecondary, marginTop: '16px', padding: '7px 12px', fontSize: '12px' }}
                >
                  Clear Date
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                if (reportsSubTab === 'night_reports') loadRecent30DaysForAnalytics();
                else loadExtraAttendanceRecords();
              }}
              style={styles.buttonSecondary}
            >
              🔄 Refresh Reports
            </button>
          </div>

          {/* SUB-TAB 1: NIGHT ATTENDANCE REPORTS (Using Exact Card Style of Extra Attendance Reports!) */}
          {reportsSubTab === 'night_reports' ? (() => {
            const nightCards = [];
            const docsSource = monthlyDocsList.length > 0 ? monthlyDocsList : [{ date: selectedDate, ...dailyDocData }];

            docsSource.forEach(dayDoc => {
              const dStr = dayDoc.date || selectedDate;
              if (extraRepDate && dStr !== extraRepDate) return;
              const clsMap = dayDoc.classes || {};
              Object.keys(clsMap).forEach(clsKey => {
                if (extraRepClass !== 'ALL' && clsKey !== extraRepClass) return;
                const rec = clsMap[clsKey];
                if (!rec) return;
                nightCards.push({
                  id: `night_${dStr}_${clsKey}`,
                  date: dStr,
                  className: clsKey,
                  ...rec
                });
              });
            });

            if (nightCards.length === 0) {
              return (
                <div style={{ padding: '36px', background: '#f8fafc', borderRadius: '12px', textAlign: 'center', color: '#64748b', fontWeight: '600' }}>
                  No night attendance records found for the selected filters.
                </div>
              );
            }

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {nightCards.map(sess => {
                  const ct = getClassTeacherForClass(sess.className);
                  const clsSts = students.filter(s => (s.classes || []).includes(sess.className));
                  const unexcusedNames = clsSts
                    .filter(s => (sess.absentAdNos || []).includes(String(s.adNo)))
                    .map(s => `${s.firstName} (#${s.adNo})`);
                  const leaveCount = (sess.outpassAdNos?.length || 0) + (sess.permittedAdNos?.length || 0);
                  const medCount = sess.sickAdNos?.length || 0;
                  const offCount = sess.officialAdNos?.length || 0;

                  return (
                    <div
                      key={sess.id}
                      style={{
                        padding: '16px 18px',
                        borderRadius: '12px',
                        border: '1px solid #e2e8f0',
                        background: '#ffffff',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '12px',
                        boxShadow: '0 1px 3px rgba(15,23,42,0.03)'
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span style={{ background: '#4f46e5', color: '#ffffff', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: '800' }}>
                            Class {sess.className}
                          </span>
                          <span style={{ fontSize: '12px', fontWeight: '700', color: '#64748b' }}>
                            📅 {sess.date}
                          </span>
                          <span style={{ background: '#e0e7ff', color: '#3730a3', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: '700' }}>
                            🌙 Night Roll-Call
                          </span>
                        </div>

                        <div style={{ marginTop: '8px', fontSize: '13px', color: '#0f172a', fontWeight: '700', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                          <span>Present: <strong style={{ color: '#059669' }}>{sess.presentCount}</strong></span>
                          <span>• Absent (A): <strong style={{ color: '#e11d48' }}>{(sess.absentAdNos || []).length}</strong></span>
                          <span>• Medical (M): <strong style={{ color: '#d97706' }}>{medCount}</strong></span>
                          <span>• Official (O): <strong style={{ color: '#0d9488' }}>{offCount}</strong></span>
                          <span>• Outpass Leave (L): <strong style={{ color: '#4f46e5' }}>{leaveCount}</strong></span>
                          <span>• Strength: <strong>{sess.totalStrength || clsSts.length}</strong></span>
                        </div>

                        <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                          👨‍🏫 Recorded By: {sess.takenBy || 'Teacher'} • Class Faculty: {ct?.fullName || 'Not assigned'}
                          {unexcusedNames.length > 0 && (
                            <div style={{ marginTop: '4px', color: '#e11d48', fontWeight: '700' }}>
                              🔴 Unexcused Absentees (A): {unexcusedNames.join(', ')}
                            </div>
                          )}
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => {
                            const txt = [
                              `*🌙 NIGHT ATTENDANCE REPORT — CLASS ${sess.className}*`,
                              `📅 Date: ${sess.date} | Recorded By: ${sess.takenBy || 'Faculty'}`,
                              `📊 Strength: ${sess.totalStrength || clsSts.length} | Present: ${sess.presentCount} | Absent (A): ${(sess.absentAdNos || []).length} | Medical (M): ${medCount} | Official (O): ${offCount} | Leave (L): ${leaveCount}`,
                              `-----------------------------------------`,
                              unexcusedNames.length > 0
                                ? `🔴 *Unexcused Absentees (A):*\n${unexcusedNames.map((n, i) => `${i + 1}. ${n}`).join('\n')}`
                                : `✅ Zero Unexcused Absentees!`
                            ].join('\n');
                            openDirectWhatsApp(ct?.whatsappNumber || ct?.mobileNumber, txt);
                          }}
                          style={{ ...styles.buttonSuccess, background: '#25D366', color: '#ffffff', padding: '8px 14px', fontSize: '12px', fontWeight: '800', width: 'auto', marginTop: 0 }}
                        >
                          📲 Forward to Class Teacher
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })() : (
            /* SUB-TAB 2: EXTRA ATTENDANCE REPORTS */
            loadingExtraReports ? (
              <div style={{ padding: '30px', textAlign: 'center', color: '#64748b', fontWeight: '700' }}>Loading extra attendance records...</div>
            ) : (() => {
              const filteredSessions = recordedExtraList
                .filter(item => extraRepClass === 'ALL' || item.className === extraRepClass)
                .filter(item => !extraRepDate || item.date === extraRepDate);

              if (filteredSessions.length === 0) {
                return (
                  <div style={{ padding: '36px', background: '#f8fafc', borderRadius: '12px', textAlign: 'center', color: '#64748b', fontWeight: '600' }}>
                    No extra attendance records found for the selected filters.
                  </div>
                );
              }

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {filteredSessions.map(sess => {
                    const ct = getClassTeacherForClass(sess.className);
                    return (
                      <div
                        key={sess.id}
                        style={{
                          padding: '16px 18px',
                          borderRadius: '12px',
                          border: '1px solid #e2e8f0',
                          background: '#ffffff',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: '12px',
                          boxShadow: '0 1px 3px rgba(15,23,42,0.03)'
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span style={{ background: '#4f46e5', color: '#ffffff', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: '800' }}>
                              Class {sess.className}
                            </span>
                            <span style={{ fontSize: '12px', fontWeight: '700', color: '#64748b' }}>
                              📅 {sess.date}
                            </span>
                            <span style={{ background: '#e0e7ff', color: '#3730a3', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: '700' }}>
                              🏷️ {sess.reason}
                            </span>
                            <span style={{ background: sess.includeUrdu ? '#dcfce7' : '#fef3c7', color: sess.includeUrdu ? '#15803d' : '#92400e', padding: '2px 8px', borderRadius: '6px', fontSize: '10px', fontWeight: '800' }}>
                              {sess.includeUrdu ? 'Urdu Included' : 'Urdu Skipped'}
                            </span>
                          </div>

                          <div style={{ marginTop: '8px', fontSize: '13px', color: '#0f172a', fontWeight: '700' }}>
                            Present: <span style={{ color: '#059669' }}>{sess.presentCount}</span> / Absent (A): <span style={{ color: '#e11d48' }}>{sess.absentCount}</span> • Total Strength: {sess.totalStrength}
                          </div>

                          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '3px' }}>
                            👨‍🏫 Recorded By: {sess.takenBy || 'Teacher'} • Class Faculty: {ct?.fullName || 'Not assigned'}
                            {sess.absentList && sess.absentList.length > 0 && (
                              <div style={{ marginTop: '4px', color: '#e11d48', fontWeight: '600' }}>
                                Absentees: {sess.absentList.map(a => a.name).join(', ')}
                              </div>
                            )}
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <button
                            type="button"
                            onClick={() => handleSendExtraToClassTeacher(sess)}
                            style={{ ...styles.buttonSuccess, background: '#25D366', color: '#ffffff', padding: '8px 14px', fontSize: '12px', fontWeight: '800', width: 'auto', marginTop: 0 }}
                          >
                            📲 Forward to Class Teacher
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()
          )}
        </div>
      )}

      {/* =========================================================
          MODE 6: CLASS TEACHER NIGHT ATTENDANCE SUMMARY & REGULAR ABSENTEES TRACKER (Point 1.8)
         ========================================================= */}
      {viewMode === 'ct_class_summary' && (isClassTeacherRole || isAdmin) && (() => {
        const targetCtClass = isClassTeacherRole ? (myCtClasses[0] || selectedClass) : selectedClass;
        const myClassSts = students.filter(s => (s.classes || []).includes(targetCtClass));

        // Scoped night docs based on Specific Date / Month / Total Semester
        const scopedNightDocs = ctSummaryScope === 'date'
          ? (monthlyDocsList.some(d => d.date === ctSummaryDate)
              ? monthlyDocsList.filter(d => d.date === ctSummaryDate)
              : ctSummaryDate === selectedDate
              ? [{ date: selectedDate, ...dailyDocData }]
              : [])
          : ctSummaryScope === 'month'
          ? monthlyDocsList.filter(d => String(d.date || '').startsWith(ctSummaryMonth))
          : monthlyDocsList;

        let tilePresent = 0;
        let tileMedical = 0;
        let tileOfficial = 0;
        let tileNoReasonAbsent = 0;
        let tileOutpassLeave = 0;

        const studentBreakdown = myClassSts.map(st => {
          const ad = String(st.adNo || '').trim();
          let nightsHeld = 0;
          let pres = 0;
          let med = 0;
          let off = 0;
          let noReasonAbs = 0;
          let outpassLv = 0;
          const unexcusedDates = [];

          scopedNightDocs.forEach(dDoc => {
            const cRec = (dDoc.classes || {})[targetCtClass];
            if (!cRec) return;
            nightsHeld++;
            if ((cRec.absentAdNos || []).includes(ad)) {
              noReasonAbs++;
              unexcusedDates.push(dDoc.date);
            } else if ((cRec.sickAdNos || []).includes(ad)) {
              med++;
            } else if ((cRec.officialAdNos || []).includes(ad)) {
              off++;
            } else if ((cRec.outpassAdNos || []).includes(ad) || (cRec.permittedAdNos || []).includes(ad)) {
              outpassLv++;
            } else {
              pres++;
            }
          });

          tilePresent += pres;
          tileMedical += med;
          tileOfficial += off;
          tileNoReasonAbsent += noReasonAbs;
          tileOutpassLeave += outpassLv;

          const attPct = nightsHeld > 0 ? (((pres + off) / nightsHeld) * 100).toFixed(1) : '100.0';

          return {
            student: st,
            nightsHeld,
            pres,
            med,
            off,
            noReasonAbs,
            outpassLv,
            unexcusedDates,
            attPct
          };
        });

        const regularAbsenteesInMyClass = [...studentBreakdown]
          .filter(r => r.noReasonAbs > 0)
          .sort((a, b) => b.noReasonAbs - a.noReasonAbs);

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <div style={styles.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px' }}>
                <div>
                  <span style={{ background: '#eef2ff', color: '#4f46e5', padding: '3px 9px', borderRadius: '6px', fontSize: '11px', fontWeight: '800' }}>
                    🏫 CLASS TEACHER NIGHT ATTENDANCE COMMAND
                  </span>
                  <h3 style={{ margin: '4px 0 0', fontSize: '18px', fontWeight: '800', color: '#0f172a' }}>
                    Class {targetCtClass} — Night Attendance Summary &amp; Regular Absentees Tracker
                  </h3>
                </div>

                {/* FILTER CONTROLS: SPECIFIC DATE / MONTH / TOTAL SEMESTER */}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                  {(isAdmin || myCtClasses.length > 1) && (
                    <select
                      value={selectedClass}
                      onChange={e => setSelectedClass(e.target.value)}
                      style={{ ...styles.input, width: 'auto', padding: '7px 12px', fontWeight: '700' }}
                    >
                      {(isAdmin ? DEFAULT_CLASSES : myCtClasses).map(c => (
                        <option key={c} value={c}>Class {c}</option>
                      ))}
                    </select>
                  )}

                  {[
                    { id: 'date', label: '📅 Specific Date' },
                    { id: 'month', label: '🗓️ Monthly' },
                    { id: 'semester', label: '📚 Total Semester' }
                  ].map(sc => (
                    <button
                      key={sc.id}
                      type="button"
                      onClick={() => setCtSummaryScope(sc.id)}
                      style={{
                        padding: '7px 14px',
                        borderRadius: '8px',
                        fontSize: '12px',
                        fontWeight: '800',
                        cursor: 'pointer',
                        border: ctSummaryScope === sc.id ? '1.5px solid #4f46e5' : '1px solid #cbd5e1',
                        background: ctSummaryScope === sc.id ? '#4f46e5' : '#ffffff',
                        color: ctSummaryScope === sc.id ? '#ffffff' : '#334155'
                      }}
                    >
                      {sc.label}
                    </button>
                  ))}

                  {ctSummaryScope === 'date' && (
                    <input
                      type="date"
                      value={ctSummaryDate}
                      onChange={e => {
                        setCtSummaryDate(e.target.value);
                        setSelectedDate(e.target.value);
                      }}
                      style={{ ...styles.input, width: 'auto', padding: '6px 10px', fontSize: '12px', fontWeight: '700' }}
                    />
                  )}

                  {ctSummaryScope === 'month' && (
                    <input
                      type="month"
                      value={ctSummaryMonth}
                      onChange={e => setCtSummaryMonth(e.target.value)}
                      style={{ ...styles.input, width: 'auto', padding: '6px 10px', fontSize: '12px', fontWeight: '700' }}
                    />
                  )}
                </div>
              </div>

              {/* 🌟 6 TOP KPI TILES FOR CLASS TEACHER */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '20px' }}>
                <div style={{ padding: '14px', borderRadius: '12px', background: '#f8fafc', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                  <div style={{ fontSize: '10px', fontWeight: '800', color: '#64748b' }}>1. TOTAL CLASS STRENGTH</div>
                  <div style={{ fontSize: '24px', fontWeight: '900', color: '#0f172a', marginTop: '4px' }}>{myClassSts.length}</div>
                </div>
                <div style={{ padding: '14px', borderRadius: '12px', background: '#ecfdf5', border: '1px solid #a7f3d0', textAlign: 'center' }}>
                  <div style={{ fontSize: '10px', fontWeight: '800', color: '#047857' }}>2. TOTAL PRESENT</div>
                  <div style={{ fontSize: '24px', fontWeight: '900', color: '#065f46', marginTop: '4px' }}>{tilePresent}</div>
                </div>
                <div style={{ padding: '14px', borderRadius: '12px', background: '#fffbeb', border: '1.5px solid #fde68a', textAlign: 'center' }}>
                  <div style={{ fontSize: '10px', fontWeight: '800', color: '#b45309' }}>3. TOTAL MEDICAL (M)</div>
                  <div style={{ fontSize: '24px', fontWeight: '900', color: '#d97706', marginTop: '4px' }}>{tileMedical}</div>
                </div>
                <div style={{ padding: '14px', borderRadius: '12px', background: '#f0fdfa', border: '1.5px solid #99f6e4', textAlign: 'center' }}>
                  <div style={{ fontSize: '10px', fontWeight: '800', color: '#0f766e' }}>4. TOTAL OFFICIAL (O)</div>
                  <div style={{ fontSize: '24px', fontWeight: '900', color: '#0d9488', marginTop: '4px' }}>{tileOfficial}</div>
                </div>
                <div style={{ padding: '14px', borderRadius: '12px', background: '#fff1f2', border: '1.5px solid #fecdd3', textAlign: 'center' }}>
                  <div style={{ fontSize: '10px', fontWeight: '800', color: '#be123c' }}>5. NO-REASON ABSENT (A)</div>
                  <div style={{ fontSize: '24px', fontWeight: '900', color: '#e11d48', marginTop: '4px' }}>{tileNoReasonAbsent}</div>
                </div>
                <div style={{ padding: '14px', borderRadius: '12px', background: '#eef2ff', border: '1.5px solid #c7d2fe', textAlign: 'center' }}>
                  <div style={{ fontSize: '10px', fontWeight: '800', color: '#4338ca' }}>6. OUTPASS LEAVE (L)</div>
                  <div style={{ fontSize: '24px', fontWeight: '900', color: '#4f46e5', marginTop: '4px' }}>{tileOutpassLeave}</div>
                </div>
              </div>

              {/* STUDENT-BY-STUDENT NIGHT SUMMARY TABLE FOR THIS CLASS */}
              <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '12px', marginBottom: '22px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left', minWidth: '780px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', color: '#475569', fontSize: '11px', fontWeight: '800', textTransform: 'uppercase' }}>
                      <th style={{ padding: '12px' }}>#</th>
                      <th style={{ padding: '12px' }}>Student Name &amp; Ad.No</th>
                      <th style={{ padding: '12px', textAlign: 'center' }}>Nights Recorded</th>
                      <th style={{ padding: '12px', textAlign: 'center', color: '#047857' }}>Present (P)</th>
                      <th style={{ padding: '12px', textAlign: 'center', color: '#d97706' }}>Medical (M)</th>
                      <th style={{ padding: '12px', textAlign: 'center', color: '#0d9488' }}>Official (O)</th>
                      <th style={{ padding: '12px', textAlign: 'center', color: '#4f46e5' }}>Outpass Leave (L)</th>
                      <th style={{ padding: '12px', textAlign: 'center', color: '#e11d48' }}>No-Reason Absent (A)</th>
                      <th style={{ padding: '12px', textAlign: 'center' }}>Night %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {studentBreakdown.map((r, idx) => (
                      <tr key={r.student.regNo || idx} style={{ borderBottom: '1px solid #f1f5f9', background: r.noReasonAbs > 0 ? '#fff1f2' : '#ffffff' }}>
                        <td style={{ padding: '10px 12px', color: '#64748b' }}>{r.student.rollNo || idx + 1}</td>
                        <td style={{ padding: '10px 12px', fontWeight: '700', color: '#0f172a' }}>
                          {r.student.firstName} <span style={{ color: '#64748b', fontSize: '11px' }}>(#{r.student.adNo})</span>
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: '700' }}>{r.nightsHeld}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: '800', color: '#047857' }}>{r.pres}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: '700', color: '#d97706' }}>{r.med}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: '700', color: '#0d9488' }}>{r.off}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: '700', color: '#4f46e5' }}>{r.outpassLv}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: '900', color: r.noReasonAbs > 0 ? '#e11d48' : '#64748b' }}>{r.noReasonAbs}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          <span style={{
                            background: Number(r.attPct) < 85 ? '#fee2e2' : '#dcfce7',
                            color: Number(r.attPct) < 85 ? '#b91c1c' : '#15803d',
                            padding: '3px 9px',
                            borderRadius: '999px',
                            fontWeight: '800',
                            fontSize: '11px'
                          }}>
                            {r.nightsHeld > 0 ? `${r.attPct}%` : '—'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* REGULAR ABSENTEES TRACKER OF HIS CLASS ONLY */}
              <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                <h4 style={{ margin: '0 0 12px 0', fontSize: '15px', fontWeight: '800', color: '#0f172a' }}>
                  🚨 Regular Night Absentees Tracker — Class {targetCtClass} Only ({regularAbsenteesInMyClass.length} Students)
                </h4>
                {regularAbsenteesInMyClass.length === 0 ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: '#047857', fontWeight: '700', background: '#ecfdf5', borderRadius: '10px', border: '1px solid #a7f3d0' }}>
                    ✅ Zero unexcused night absentees in Class {targetCtClass} for this period!
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: '12px' }}>
                    {regularAbsenteesInMyClass.map((item, idx) => (
                      <div key={item.student.adNo} style={{ padding: '14px', borderRadius: '12px', border: '1.5px solid #fecdd3', background: '#ffffff', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <ProfileAvatar name={item.student.firstName} code={item.student.adNo} photoUrl={item.student.photoUrl} size={36} />
                            <div>
                              <div style={{ fontWeight: '800', color: '#0f172a', fontSize: '14px' }}>#{idx + 1} • {item.student.firstName}</div>
                              <div style={{ fontSize: '11px', color: '#64748b' }}>Ad.No: #{item.student.adNo} • Class {targetCtClass}</div>
                            </div>
                          </div>
                          <span style={{ background: '#e11d48', color: '#ffffff', padding: '4px 9px', borderRadius: '999px', fontWeight: '800', fontSize: '11px' }}>
                            {item.noReasonAbs} Night{item.noReasonAbs > 1 ? 's' : ''}
                          </span>
                        </div>
                        <div style={{ fontSize: '11px', color: '#be123c', fontWeight: '600' }}>
                          📅 Dates: {item.unexcusedDates.slice(0, 6).join(', ')}
                        </div>
                        <button
                          type="button"
                          onClick={() => openDirectWhatsApp(item.student.parentWhatsapp || item.student.parentMobile, `Assalamu Alaikum, official notice from Class Teacher (${targetCtClass}) regarding unexcused night absence of ${item.student.firstName} (#${item.student.adNo}):`)}
                          style={styles.buttonSecondary}
                        >
                          💬 Contact Parent on WhatsApp
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}