'use client';
import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { db } from '../../lib/firebase';
import { doc, getDoc, getDocs, collection, onSnapshot } from 'firebase/firestore';
import { DEFAULT_CLASSES, styles } from './erpConstants';
import { openDirectWhatsApp } from './ErpExtensions';

export default function PeriodAttendanceReportsHub({
  activeTab,
  setActiveTab,
  userRole,
  loggedInUser,
  activeTeacherObj,
  localStudents,
  localTeachers,
  attendanceEnrollments,
  getStudentsForEnrollment,
  getStudentAttStat,
  normalizeSubKey,
  isAttendanceOnlyEnrollment,
  isHifzEnrollment,
  setSelectedTeacherUsername,
  setAttEnrollmentId,
  setAttDate,
  setAttSession
}) {
  // --- 1. REPORTS HUB STATE ---
  const [repScope, setRepScope] = useState(() => {
    const ctClasses =
      activeTeacherObj?.outpassPrivileges?.classTeacherOf ||
      activeTeacherObj?.classTeacherOf ||
      loggedInUser?.outpassPrivileges?.classTeacherOf ||
      loggedInUser?.classTeacherOf ||
      [];
    const hasCt = Array.isArray(ctClasses) ? ctClasses.length > 0 : Boolean(ctClasses);
    return userRole === 'admin' || hasCt ? 'total' : 'total';
  });

  const [repClass, setRepClass] = useState(() => {
    const ctClasses =
      activeTeacherObj?.outpassPrivileges?.classTeacherOf ||
      activeTeacherObj?.classTeacherOf ||
      loggedInUser?.outpassPrivileges?.classTeacherOf ||
      loggedInUser?.classTeacherOf ||
      [];
    const firstCt = Array.isArray(ctClasses) ? ctClasses[0] : ctClasses;
    return userRole !== 'admin' && firstCt ? firstCt : 'ALL';
  });

  const [repMonth, setRepMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [totalFilterMonth, setTotalFilterMonth] = useState('ALL'); // 'ALL' or 'YYYY-MM' for Total Semester Summary
  const [repDate, setRepDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [repTeacher, setRepTeacher] = useState(
    userRole === 'admin' ? 'ALL' : loggedInUser?.username || 'ALL'
  );
  const [repSubject, setRepSubject] = useState('ALL');
  const [repMinusMode, setRepMinusMode] = useState('both');
  const [repSearch, setRepSearch] = useState('');
  const [dailySessionsCache, setDailySessionsCache] = useState([]);
  const [allPeriodSessionsCache, setAllPeriodSessionsCache] = useState([]);
  const [loadingReport, setLoadingReport] = useState(false);
  const [showReportFilters, setShowReportFilters] = useState(false);

  // 🌟 STUDENT DRILLDOWN STATE (Matches Screenshots 4, 5, and 6)
  const [selectedProfileStudent, setSelectedProfileStudent] = useState(null);
  const [studentDrilldownView, setStudentDrilldownView] = useState('stats'); // 'stats' | 'details'
  const [focusedSubjectKey, setFocusedSubjectKey] = useState('ALL'); // 'ALL' or specific subKey
  const [showMinusDetailsBanner, setShowMinusDetailsBanner] = useState(false);

  // 🌟 FN (Periods 1-6) & AN (Periods 7-9) Monthly Day Strategy State
  const [fnAnMonthSessions, setFnAnMonthSessions] = useState([]);
  const [fnAnOutpasses, setFnAnOutpasses] = useState([]);
  const [fnAnRecordedAbsences, setFnAnRecordedAbsences] = useState([]);
  const [fnAnFilterMode, setFnAnFilterMode] = useState('ALL');
  const [fnAnViewMode, setFnAnViewMode] = useState('summary');
  const [loadingFnAn, setLoadingFnAn] = useState(false);

  // Load all period sessions from systemCache so we can build the exact Monthly Date-Square Calendars & Month-Filtered Totals
  useEffect(() => {
    async function loadAllPeriodSessions() {
      if (activeTab !== 'reports_hub') return;
      try {
        const snap = await getDocs(collection(db, 'systemCache'));
        const sessMap = {};
        snap.forEach(d => {
          const id = d.id;
          const data = d.data() || {};
          if (id.startsWith('periodSession_')) {
            sessMap[id] = { id, ...data };
          } else if (id.startsWith('daySessionsIndex_')) {
            const dFromId = id.replace('daySessionsIndex_', '');
            (data.sessions || []).forEach(s => {
              const sId = s.sessionDocId || `periodSession_${data.date || dFromId}_${s.subject}_${s.session}`;
              if (!sessMap[sId]) {
                sessMap[sId] = { id: sId, date: data.date || dFromId, ...s };
              }
            });
          }
        });
        setAllPeriodSessionsCache(Object.values(sessMap));
      } catch (err) {
        console.warn('Error loading all period sessions for reports:', err);
      }
    }
    loadAllPeriodSessions();
  }, [activeTab]);

  // Load Daily Recorded Sessions for non-admin teachers when `repScope === 'daily'`
  useEffect(() => {
    async function fetchDailySessionsForReport() {
      if (activeTab !== 'reports_hub' || repScope !== 'daily' || !repDate) return;
      setLoadingReport(true);
      try {
        const idxSnap = await getDoc(doc(db, 'systemCache', `daySessionsIndex_${repDate}`));
        const list = idxSnap.exists() ? idxSnap.data().sessions || [] : [];
        const fullSessions = [];
        for (const item of list) {
          const sSnap = await getDoc(doc(db, 'systemCache', item.sessionDocId));
          if (sSnap.exists()) {
            fullSessions.push({ id: item.sessionDocId, ...sSnap.data() });
          }
        }
        fullSessions.sort((a, b) => Number(a.session) - Number(b.session));
        setDailySessionsCache(fullSessions);
      } catch (e) {
        console.error('Error loading daily sessions:', e);
      } finally {
        setLoadingReport(false);
      }
    }
    fetchDailySessionsForReport();
  }, [activeTab, repScope, repDate]);

  // 🌟 Real-time listener for recorded absences so any new absence updates the report immediately
  useEffect(() => {
    if (activeTab !== 'reports_hub') return;
    const unsub = onSnapshot(doc(db, 'systemCache', 'recordedStudentAbsences'), snap => {
      if (snap.exists()) {
        const data = snap.data() || {};
        const raw = data.absences;
        const list = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? Object.values(raw) : []);
        setFnAnRecordedAbsences(list.filter(r => r && !r.isCancelled));
      }
    }, err => console.warn('Realtime recordedStudentAbsences listener error:', err));
    return () => unsub();
  }, [activeTab]);

    // Load Month Period Sessions & Out-Passes when `repScope === 'fn_an_monthly'`
  useEffect(() => {
    async function fetchFnAnMonthData() {
      if (activeTab !== 'reports_hub' || repScope !== 'fn_an_monthly' || !repMonth) return;
      setLoadingFnAn(true);
      try {
        const [cacheSnap, opSnap] = await Promise.all([
          getDocs(collection(db, 'systemCache')),
          getDocs(collection(db, 'out_passes'))
        ]);

        const monthSessions = [];
        let recAbsList = [];
        cacheSnap.forEach(d => {
          if (d.id.startsWith(`periodSession_${repMonth}`)) {
            monthSessions.push({ id: d.id, ...d.data() });
          } else if (d.id === 'recordedStudentAbsences') {
            const data = d.data() || {};
            const absencesDict = data.absences || {};
            recAbsList = Object.values(absencesDict).filter(r => r && !r.isCancelled);
          }
        });
        setFnAnMonthSessions(monthSessions);
        setFnAnRecordedAbsences(recAbsList);

        const opList = [];
        opSnap.forEach(d => {
          const data = d.data();
          if (String(data.status || '').toUpperCase() !== 'CANCELLED') {
            opList.push({ id: d.id, ...data });
          }
        });
        setFnAnOutpasses(opList);
      } catch (err) {
        console.error('Error loading FN/AN monthly sessions:', err);
      } finally {
        setLoadingFnAn(false);
      }
    }
    fetchFnAnMonthData();
  }, [activeTab, repScope, repMonth]);

  const teacherAllowedClassesSet = new Set();
  const teacherAllowedStudentRegs = new Set();
  const subjectColsSet = new Set();

  const myCtClasses = useMemo(() => {
    const set = new Set();
    const addClean = val => {
      if (!val) return;
      if (Array.isArray(val)) {
        val.filter(Boolean).forEach(c => set.add(String(c).trim().toUpperCase()));
      } else if (typeof val === 'string') {
        val
          .split(',')
          .map(s => s.trim().toUpperCase())
          .filter(Boolean)
          .forEach(c => set.add(c));
      }
    };
    addClean(activeTeacherObj?.outpassPrivileges?.classTeacherOf);
    addClean(activeTeacherObj?.classTeacherOf);
    addClean(loggedInUser?.outpassPrivileges?.classTeacherOf);
    addClean(loggedInUser?.classTeacherOf);

    const myUser = String(activeTeacherObj?.username || loggedInUser?.username || '')
      .trim()
      .toLowerCase();
    const myName = String(activeTeacherObj?.fullName || loggedInUser?.fullName || '')
      .trim()
      .toLowerCase();

    if (myUser && myUser !== 'admin') {
      localStudents.forEach(st => {
        const ctUser = String(st.classTeacherUsername || st.classTeacher || '')
          .trim()
          .toLowerCase();
        const ctName = String(st.classTeacherName || '').trim().toLowerCase();
        if ((ctUser && ctUser === myUser) || (ctName && ctName === myName)) {
          const stClasses = Array.isArray(st.classes) ? st.classes : [st.class].filter(Boolean);
          stClasses.forEach(c => set.add(String(c).trim().toUpperCase()));
        }
      });
    }
    return Array.from(set);
  }, [activeTeacherObj, loggedInUser, localStudents]);

  const isClassTeacher = userRole !== 'admin' && myCtClasses.length > 0;
  const isPureSubjectTeacher = userRole !== 'admin' && myCtClasses.length === 0;

  useEffect(() => {
    if (isPureSubjectTeacher && repScope === 'fn_an_monthly') {
      setRepScope('total');
    }
  }, [isPureSubjectTeacher, repScope]);

  myCtClasses.forEach(c => teacherAllowedClassesSet.add(c));

  if (userRole !== 'admin') {
    attendanceEnrollments.forEach(env => {
      const subKey = normalizeSubKey(
        isAttendanceOnlyEnrollment(env) ? env.alias || env.subject : env.subject
      );
      subjectColsSet.add(subKey);
      const enrolled = getStudentsForEnrollment(env);
      enrolled.forEach(st => {
        teacherAllowedStudentRegs.add(st.regNo);
        (st.classes || [st.class]).filter(Boolean).forEach(c => teacherAllowedClassesSet.add(c));
      });
    });
    if (myCtClasses.length > 0) {
      localStudents.forEach(st => {
        const stCls = Array.isArray(st.classes) ? st.classes : [st.class];
        if (stCls.some(c => myCtClasses.includes(c))) {
          teacherAllowedStudentRegs.add(st.regNo);
        }
      });
    }
  } else if (repTeacher !== 'ALL') {
    const tObj = localTeachers.find(t => t.username === repTeacher);
    (tObj?.enrollments || [])
      .filter(e => !isHifzEnrollment(e))
      .forEach(env => {
        subjectColsSet.add(
          normalizeSubKey(isAttendanceOnlyEnrollment(env) ? env.alias || env.subject : env.subject)
        );
      });
  }

  const ctClassSubKeys = new Set();
  if (myCtClasses.length > 0 && Array.isArray(localStudents)) {
    localStudents.forEach(st => {
      const stCls = (st.classes || [st.class] || []).map(c => String(c).toUpperCase().trim());
      if (stCls.some(c => myCtClasses.includes(c))) {
        const sw = getStudentAttStat(st).subjectWise || {};
        Object.keys(sw).forEach(k => {
          if (k.toUpperCase() !== 'HIFZ') {
            ctClassSubKeys.add(k);
            subjectColsSet.add(k);
          }
        });
      }
    });
  }

  const allDaysInSelectedMonth = useMemo(() => {
    if (!repMonth) return [];
    const parts = repMonth.split('-');
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    if (!year || !month) return [];
    const daysInMonth = new Date(year, month, 0).getDate();
    const days = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dStr = `${repMonth}-${String(d).padStart(2, '0')}`;
      const dayOfWeek = new Date(`${dStr}T00:00:00`).getDay();
      const isFriday = dayOfWeek === 5;
      days.push({
        dateStr: dStr,
        dayNum: d,
        dayOfWeek,
        isFriday,
        dayName: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayOfWeek]
      });
    }
    return days;
  }, [repMonth]);

  const availableClassesForDropdown =
    userRole === 'admin'
      ? DEFAULT_CLASSES
      : repScope === 'fn_an_monthly'
      ? myCtClasses.length > 0
        ? myCtClasses
        : Array.from(teacherAllowedClassesSet)
      : Array.from(teacherAllowedClassesSet);

  const filteredReportStudents = localStudents.filter(st => {
    if (userRole !== 'admin') {
      const reg = String(st.regNo || st.id || '').trim();
      const ad = String(st.adNo || '').trim().toUpperCase();
      const stClasses = (st.classes || [st.class] || []).map(c => String(c).toUpperCase().trim());
      const isCtStudent = stClasses.some(c => myCtClasses.includes(c));
      const isTeachingStudent =
        teacherAllowedStudentRegs.has(reg) ||
        teacherAllowedStudentRegs.has(ad) ||
        teacherAllowedStudentRegs.has(st.regNo);
      if (!isCtStudent && !isTeachingStudent) return false;
    }
    const stClasses = Array.isArray(st.classes) ? st.classes : [st.class];
    if (repClass !== 'ALL' && !stClasses.includes(repClass)) return false;
    if (repSearch.trim()) {
      const q = repSearch.trim().toLowerCase();
      if (
        !String(st.firstName || '').toLowerCase().includes(q) &&
        !String(st.adNo || '').toLowerCase().includes(q)
      )
        return false;
    }
    return true;
  });

  if (userRole === 'admin' && repTeacher === 'ALL') {
    filteredReportStudents.forEach(st => {
      const sw = getStudentAttStat(st).subjectWise || {};
      Object.keys(sw).forEach(k => {
        if (k.toUpperCase() !== 'HIFZ') subjectColsSet.add(k);
      });
    });
  }

  const teacherSubKeys = new Set(
    attendanceEnrollments.map(env =>
      normalizeSubKey(isAttendanceOnlyEnrollment(env) ? env.alias || env.subject : env.subject)
    )
  );
  let subjectColumns = Array.from(subjectColsSet);
  if (userRole !== 'admin') {
    const isViewingCtClass = repClass !== 'ALL' && myCtClasses.includes(repClass);
    if (isViewingCtClass) {
      const classSubKeys = new Set();
      filteredReportStudents.forEach(st => {
        const sw = getStudentAttStat(st).subjectWise || {};
        Object.keys(sw).forEach(k => {
          if (k.toUpperCase() !== 'HIFZ') classSubKeys.add(k);
        });
      });
      subjectColumns = subjectColumns.filter(s => classSubKeys.has(s));
    } else if (repClass !== 'ALL') {
      const classEnrollmentSubs = new Set(
        attendanceEnrollments
          .filter(env => {
            const tCls = String(env.targetClass || '').toUpperCase().trim();
            const alias = String(env.alias || '').toUpperCase().trim();
            return tCls === repClass || alias.includes(repClass);
          })
          .map(env =>
            normalizeSubKey(isAttendanceOnlyEnrollment(env) ? env.alias || env.subject : env.subject)
          )
      );
      subjectColumns = subjectColumns.filter(s =>
        classEnrollmentSubs.size > 0 ? classEnrollmentSubs.has(s) : teacherSubKeys.has(s)
      );
    } else {
      subjectColumns = subjectColumns.filter(s => teacherSubKeys.has(s) || ctClassSubKeys.has(s));
    }
  }
  if (repSubject !== 'ALL') {
    subjectColumns = subjectColumns.filter(s => s === repSubject);
  }

  // Helper to compute a student's Total Semester / Month-filtered summary metrics
  const computeStudentSummaryMetrics = (st, monthFilter = 'ALL') => {
    const stat = getStudentAttStat(st);
    const sw = stat.subjectWise || {};
    const reg = String(st.regNo || '').trim();
    const sId = String(st.id || '').trim();
    const ad = String(st.adNo || '').trim().toUpperCase();

    if (monthFilter && monthFilter !== 'ALL') {
      // Filter by specific month using cached sessions or absentDates fallback
      const monthSess = allPeriodSessionsCache.filter(
        s => String(s.date || '').startsWith(monthFilter) && !s.isRehearsal
      );

      let mTotal = 0;
      let mNormalPres = 0;
      let mOfficial = 0;
      let mMedical = 0;
      let mAbsent = 0;

      monthSess.forEach(sess => {
        const map = sess.attendanceMap || {};
        const val = map[reg] || map[sId] || map[ad] || map[st.adNo];
        if (!val) return;
        mTotal++;
        if (val === 'P') mNormalPres++;
        else if (val === 'O') mOfficial++;
        else if (val === 'M') {
          mMedical++;
          mAbsent++;
        } else {
          mAbsent++;
        }
      });

      const minusC = (stat.minusLogs || [])
        .filter(l => String(l.date || '').startsWith(monthFilter))
        .reduce((acc, l) => acc + (Number(l.count) || 0), 0);

      const grandTotalPres = mNormalPres + mOfficial;
      const netAfterMinus = Math.max(0, grandTotalPres - minusC);
      const netPct = mTotal > 0 ? ((netAfterMinus / mTotal) * 100).toFixed(1) : '100.0';

      return {
        totalTaken: mTotal,
        normalPresent: mNormalPres,
        totalAbsence: mAbsent,
        officialCount: mOfficial,
        medicalCount: mMedical,
        grandTotalPres,
        minusCount: minusC,
        netAfterMinus,
        netPct
      };
    }

    // Whole Semester Summary
    const totalTaken = Number(stat.totalPeriods) || 0;
    const combinedPres = Number(stat.presentCount) || 0; // In PeriodAttendanceManager, presentCount includes P + O
    const officialCount = Number(stat.officialCount) || 0;
    const medicalCount = Number(stat.medicalCount) || 0;
    const normalPresent = Math.max(0, combinedPres - officialCount);
    const grandTotalPres = normalPresent + officialCount;
    const totalAbsence = Math.max(0, totalTaken - grandTotalPres);
    const minusCount = Number(stat.minusCount) || 0;
    const netAfterMinus = Math.max(0, grandTotalPres - minusCount);
    const netPct = totalTaken > 0 ? ((netAfterMinus / totalTaken) * 100).toFixed(1) : '100.0';

    return {
      totalTaken,
      normalPresent,
      totalAbsence,
      officialCount,
      medicalCount,
      grandTotalPres,
      minusCount,
      netAfterMinus,
      netPct
    };
  };

  // Compute FN/AN Monthly Rows
  const computeFnAnMonthlyRows = () => {
    return filteredReportStudents.map(st => {
      const reg = st.regNo;
      const ad = String(st.adNo || '').trim().toUpperCase();
      const dateMap = {};

      fnAnMonthSessions.forEach(sess => {
        const attMap = sess.attendanceMap || {};
        const sReg = String(st.regNo || '').trim();
        const sAd = String(st.adNo || '').trim().toUpperCase();
        const sId = String(st.id || '').trim();
        const status =
          attMap[sReg] ||
          attMap[sAd] ||
          attMap[sId] ||
          attMap[sReg.toLowerCase()] ||
          attMap[sAd.toLowerCase()] ||
          attMap[reg] ||
          attMap[st.id] ||
          attMap[ad];
        if (!status) return;

        const dStr = sess.date;
        const pNum = Number(sess.session) || 1;
        if (!dateMap[dStr]) dateMap[dStr] = { fnStatuses: [], anStatuses: [] };
        if (pNum <= 6) {
          dateMap[dStr].fnStatuses.push(status);
        } else {
          dateMap[dStr].anStatuses.push(status);
        }
      });

      let workingDaysHeld = 0;
      let fnPresentCount = 0;
      let fnTotalCount = 0;
      let anPresentCount = 0;
      let anTotalCount = 0;
      let totalDaysPresent = 0;
      let totalDaysAbsent = 0;
      const absentDatesDetails = [];

      Object.keys(dateMap)
        .sort()
        .forEach(dStr => {
          const { fnStatuses, anStatuses } = dateMap[dStr];
          const hasFn = fnStatuses.length > 0;
          const hasAn = anStatuses.length > 0;

          const isFnPresent = hasFn ? fnStatuses.some(c => c === 'P' || c === 'O') : false;
          const isAnPresent = hasAn ? anStatuses.some(c => c === 'P' || c === 'O') : false;

          if (hasFn) {
            fnTotalCount += 1;
            if (isFnPresent) fnPresentCount += 1;
          }
          if (hasAn) {
            anTotalCount += 1;
            if (isAnPresent) anPresentCount += 1;
          }

          if (hasFn && hasAn) {
            workingDaysHeld += 1;
            const dayPres = (isFnPresent ? 0.5 : 0) + (isAnPresent ? 0.5 : 0);
            const dayAbs = 1 - dayPres;
            totalDaysPresent += dayPres;
            totalDaysAbsent += dayAbs;
            if (dayAbs > 0) {
              absentDatesDetails.push(
                `${dStr} (${!isFnPresent && !isAnPresent ? 'Full Day' : isFnPresent ? 'AN Absent' : 'FN Absent'})`
              );
            }
          } else if (hasFn || hasAn) {
            workingDaysHeld += 0.5;
            const halfPres = (hasFn && isFnPresent) || (hasAn && isAnPresent) ? 0.5 : 0;
            const halfAbs = 0.5 - halfPres;
            totalDaysPresent += halfPres;
            totalDaysAbsent += halfAbs;
            if (halfAbs > 0) {
              absentDatesDetails.push(`${dStr} (${hasFn ? 'FN Absent' : 'AN Absent'})`);
            }
          }
        });

      const studentMonthPasses = fnAnOutpasses.filter(p => {
        if (String(p.adNo || '').trim().toUpperCase() !== ad) return false;
        const fromM = String(p.permittedFrom || p.createdAt || '').slice(0, 7);
        const toM = String(p.permittedTo || '').slice(0, 7);
        return fromM === repMonth || toM === repMonth;
      });

      const studentMonthRecordedAbs = fnAnRecordedAbsences.filter(r => {
        if (String(r.adNo || '').trim().toUpperCase() !== ad) return false;
        const fromM = String(r.startDate || r.date || '').slice(0, 7);
        const toM = String(r.endDate || r.startDate || '').slice(0, 7);
        return fromM === repMonth || toM === repMonth;
      });

      const leaveReasonsList = [
        ...studentMonthPasses.map(
          p => `${p.leaveCategory || 'Leave'}: ${p.destination || 'Out'}${p.purpose ? ` (${p.purpose})` : ''}`
        ),
        ...studentMonthRecordedAbs.map(
          r =>
            `${
              r.status === 'SICK_ROOM'
                ? 'Medical / Sick'
                : r.status === 'OFFICIAL'
                ? 'Official Duty'
                : 'Leave'
            }: ${r.reason || 'Recorded Absence'}`
        )
      ];

      const isPresentAllWorkingDays = workingDaysHeld > 0 && totalDaysAbsent === 0;
      const isAbsentMoreThan5Days = totalDaysAbsent >= 5;
      const dayAttPct = workingDaysHeld > 0 ? ((totalDaysPresent / workingDaysHeld) * 100).toFixed(1) : '100.0';

      return {
        student: st,
        workingDaysHeld,
        fnPresentCount,
        fnTotalCount,
        anPresentCount,
        anTotalCount,
        totalDaysPresent,
        totalDaysAbsent,
        dayAttPct,
        absentDatesDetails,
        leaveReasonsList,
        isPresentAllWorkingDays,
        isAbsentMoreThan5Days
      };
    });
  };

  const fnAnRows = repScope === 'fn_an_monthly' ? computeFnAnMonthlyRows() : [];
  const presentAllDaysCount = fnAnRows.filter(r => r.isPresentAllWorkingDays).length;
  const absentGt5DaysCount = fnAnRows.filter(r => r.isAbsentMoreThan5Days).length;

  const displayedFnAnRows = fnAnRows.filter(r => {
    if (fnAnFilterMode === 'ABSENT_GT_5') return r.isAbsentMoreThan5Days;
    if (fnAnFilterMode === 'PRESENT_ALL_DAYS') return r.isPresentAllWorkingDays;
    return true;
  });

  const handleExportReportMatrixExcel = () => {
    if (repScope === 'total') {
      const rows = filteredReportStudents.map((st, idx) => {
        const m = computeStudentSummaryMetrics(st, totalFilterMonth);
        return {
          '#': idx + 1,
          'STUDENT NAME': st.firstName,
          'ADMISSION NO': st.adNo,
          'CLASS': (st.classes || []).join(', '),
          'TOTAL ATTENDANCE TAKEN': m.totalTaken,
          'TOTAL PRESENT (NORMAL)': m.normalPresent,
          'TOTAL ABSENCE': m.totalAbsence,
          'OFFICIAL LEAVE': m.officialCount,
          'MEDICAL LEAVE': m.medicalCount,
          'GRAND TOTAL (PRESENT + OFFICIAL)': m.grandTotalPres,
          'TOTAL MINUS': m.minusCount > 0 ? -m.minusCount : 0,
          'NET TOTAL (GRAND TOTAL - MINUS)': m.netAfterMinus,
          'NET %': `${m.netPct}%`
        };
      });
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Total_Semester_Summary');
      XLSX.writeFile(wb, `Total_Semester_Attendance_${repClass}_${totalFilterMonth}.xlsx`);
      return;
    }

    if (repScope === 'fn_an_monthly') {
      const rows = displayedFnAnRows.map((r, idx) => ({
        '#': idx + 1,
        'STUDENT NAME': r.student.firstName,
        'ADMISSION NO': r.student.adNo,
        'CLASS': (r.student.classes || []).join(', '),
        'WORKING DAYS': r.workingDaysHeld,
        'FN PRESENT': `${r.fnPresentCount}/${r.fnTotalCount}`,
        'AN PRESENT': `${r.anPresentCount}/${r.anTotalCount}`,
        'TOTAL PRESENT (DAYS)': r.totalDaysPresent,
        'TOTAL ABSENT (DAYS)': r.totalDaysAbsent,
        'ATTENDANCE %': `${r.dayAttPct}%`,
        'ABSENT DATES': r.absentDatesDetails.join(', '),
        'OUT-PASS REASONS': r.leaveReasonsList.join(' | ')
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'FN_AN_Monthly_Days');
      XLSX.writeFile(wb, `FN_AN_Monthly_Days_${repClass}_${repMonth}.xlsx`);
      return;
    }

    const rows = filteredReportStudents.map((st, idx) => {
      const stat = getStudentAttStat(st);
      const sw = stat.subjectWise || {};
      let totP = Number(stat.totalPeriods) || 0;
      let presP = Number(stat.presentCount) || 0;
      let minusC = Number(stat.minusCount) || 0;

      if (repScope === 'monthly') {
        let monthAbs = 0;
        Object.values(sw).forEach(sObj => {
          monthAbs += (sObj.absentDates || []).filter(d => String(d).startsWith(repMonth)).length;
        });
        minusC = (stat.minusLogs || [])
          .filter(l => String(l.date || '').startsWith(repMonth))
          .reduce((s, l) => s + (Number(l.count) || 0), 0);
        presP = Math.max(0, totP - monthAbs);
      }

      const grossPct = totP > 0 ? ((presP / totP) * 100).toFixed(2) : '100.00';
      const netPres = Math.max(0, presP - minusC);
      const netPct = totP > 0 ? ((netPres / totP) * 100).toFixed(2) : '100.00';

      const rowObj = {
        '#': idx + 1,
        'STUDENT NAME': st.firstName,
        'ADMISSION NO': st.adNo,
        'CLASS': (st.classes || []).join(', '),
        'GROSS %': `${grossPct}%`,
        'MINUS': -minusC,
        'OVERALL NET %': `${netPct}%`
      };

      subjectColumns.forEach(subKey => {
        const sObj = sw[subKey];
        if (!sObj || !sObj.total) {
          rowObj[subKey] = '-';
        } else {
          let sPres = sObj.present || 0;
          if (repScope === 'monthly') {
            const mAbs = (sObj.absentDates || []).filter(d => String(d).startsWith(repMonth)).length;
            sPres = Math.max(0, sObj.total - mAbs);
          }
          const sPct = ((sPres / sObj.total) * 100).toFixed(1);
          rowObj[subKey] = `${sPres}/${sObj.total} (${sPct}%)`;
        }
      });

      return rowObj;
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Attendance_Report');
    XLSX.writeFile(wb, `Attendance_Report_${repScope.toUpperCase()}_${repClass}.xlsx`);
  };

 // ============================================================================
  // 🌟 STUDENT DRILLDOWN VIEW (MATCHES SCREENSHOTS 4, 5 & 6 — DEDUPLICATED BY DATE)
  // ============================================================================
  if (selectedProfileStudent) {
    const st = selectedProfileStudent;
    const stat = getStudentAttStat(st);
    const sw = stat.subjectWise || {};
    const reg = String(st.regNo || '').trim();
    const sId = String(st.id || '').trim();
    const ad = String(st.adNo || '').trim().toUpperCase();
    const stCls = (st.classes || [st.class] || [])[0] || '';
    const stDept = String(st.department || '').trim().toUpperCase();

    // Helper: Canonical Subject Key (Merges TKS & SPECIALIZATION across all 6 departments, and strips class suffixes)
    const getCanonicalSubKey = (rawKey, clsName) => {
      let clean = String(rawKey || '').trim().toUpperCase().replace(/\s+/g, ' ');
      if (!clean || clean === 'HIFZ' || clean.includes('REHEARSAL')) return '';

      // Strip class names anywhere at the end (e.g. "QLA3", "HFC3", "F3", etc.)
      const upCls = String(clsName || '').trim().toUpperCase();
      if (upCls && clean.endsWith(` ${upCls}`)) {
        clean = clean.slice(0, clean.length - upCls.length).trim();
      }
      [...DEFAULT_CLASSES, 'F1', 'F2', 'F3', 'Q1', 'Q2', 'Q3', 'A1', 'A2', 'A3'].forEach(c => {
        const uc = c.toUpperCase();
        if (clean.endsWith(` ${uc}`)) {
          clean = clean.slice(0, clean.length - uc.length).trim();
        }
      });

      // 🌟 Merge TKS / THAKHASUS / SPECIALIZATION into a single subject per student
      if (
        clean.startsWith('TKS') ||
        clean.includes('THAKHASUS') ||
        clean.includes('SPECIALIZATION') ||
        clean.includes('SPECIALISATION')
      ) {
        let deptTag = '';
        if (clean.includes('QURAN') || clean.includes("QUR'AN")) deptTag = 'QURAN';
        else if (clean.includes('HANAFI')) deptTag = 'FIQH HANAFI';
        else if (clean.includes('SHAFI')) deptTag = 'FIQH SHAFI';
        else if (clean.includes('FIQH')) deptTag = stDept.includes('HANAFI') ? 'FIQH HANAFI' : 'FIQH';
        else if (clean.includes('HADITH') || clean.includes('HADEES')) deptTag = 'HADITH';
        else if (clean.includes('AQIDAH') || clean.includes('AQEEDA')) deptTag = 'AQIDAH';
        else if (clean.includes('ADAB')) deptTag = 'ADAB';
        else if (stDept && stDept !== 'GENERAL') deptTag = stDept;

        return deptTag ? `SPECIALIZATION (${deptTag})` : 'SPECIALIZATION';
      }

      if (clean === 'AQEEDA' || clean === 'AQEEDAH') return 'AQIDAH';
      if (clean === 'BALAGA') return 'BALAGHA';
      if (clean === 'HADEES') return 'HADITH';
      if (clean === 'THAMADHUN') return 'THAMADUN';
      if (clean.includes('DIRASATH') || clean.includes('ADYAN') || clean === 'MANTHIQ' || clean === 'MANTIQ') return 'LOGIC';
      if (clean === 'SS' || clean.startsWith('SS ')) return 'SOCIAL SCIENCE';
      if (clean.includes('U:FIQH') || clean.includes('U :FIQH') || clean.includes('USUL')) return 'U :FIQH';
      return clean;
    };

    // 1. Collect all real session dates for this student from `allPeriodSessionsCache`
    // Deduplicate strictly by (canonicalSubject + YYYY-MM-DD) because each subject is taken ONCE per day!
    const sessionsBySubAndDate = {}; // canonKey -> Map(dateStr -> isPresent)
    allPeriodSessionsCache.forEach(sess => {
      if (!sess.date || sess.isRehearsal) return;
      const dStr = String(sess.date).trim().slice(0, 10);
      if (!dStr) return;

      const canonKey = getCanonicalSubKey(sess.subject || sess.classAlias || '', stCls);
      if (!canonKey) return; // skips HIFZ and REHEARSAL automatically

      const map = sess.attendanceMap || {};
      const val = map[reg] || map[sId] || map[ad] || map[st.adNo];
      if (!val) return;

      if (!sessionsBySubAndDate[canonKey]) {
        sessionsBySubAndDate[canonKey] = new Map();
      }
      const isPres = val === 'P' || val === 'O';
      // If duplicate session exists on the same date for the same subject, keep 1 entry per day
      if (!sessionsBySubAndDate[canonKey].has(dStr)) {
        sessionsBySubAndDate[canonKey].set(dStr, isPres);
      } else if (isPres) {
        sessionsBySubAndDate[canonKey].set(dStr, true);
      }
    });

    // 2. Merge `student.periodAttendance.subjectWise` keys and deduplicate same-date entries
    const mergedSubMap = {};
    Object.entries(sw).forEach(([rawKey, sObj]) => {
      if (!sObj) return;
      const canonKey = getCanonicalSubKey(rawKey, stCls);
      if (!canonKey) return; // Excludes REHEARSAL and HIFZ

      if (!mergedSubMap[canonKey]) {
        mergedSubMap[canonKey] = {
          subKey: canonKey,
          rawKeys: [rawKey],
          displayTitle: stCls ? `${canonKey} ${stCls}` : canonKey,
          maxRawTotal: 0,
          maxRawPresent: 0,
          sumRawTotal: 0,
          sumRawPresent: 0,
          uniqueAbsentDates: new Set()
        };
      } else if (!mergedSubMap[canonKey].rawKeys.includes(rawKey)) {
        mergedSubMap[canonKey].rawKeys.push(rawKey);
      }

      const grp = mergedSubMap[canonKey];
      const sTot = Number(sObj.total) || 0;
      const sPres = Number(sObj.present) || 0;
      grp.maxRawTotal = Math.max(grp.maxRawTotal, sTot);
      grp.maxRawPresent = Math.max(grp.maxRawPresent, sPres);
      grp.sumRawTotal += sTot;
      grp.sumRawPresent += sPres;

      (Array.isArray(sObj.absentDates) ? sObj.absentDates : []).forEach(d => {
        const cleanD = String(d || '').trim().slice(0, 10);
        if (cleanD) grp.uniqueAbsentDates.add(cleanD);
      });
    });

    // Also ensure any subject found in sessionsBySubAndDate is in mergedSubMap
    Object.keys(sessionsBySubAndDate).forEach(canonKey => {
      if (!mergedSubMap[canonKey]) {
        mergedSubMap[canonKey] = {
          subKey: canonKey,
          rawKeys: [canonKey],
          displayTitle: stCls ? `${canonKey} ${stCls}` : canonKey,
          maxRawTotal: 0,
          maxRawPresent: 0,
          sumRawTotal: 0,
          sumRawPresent: 0,
          uniqueAbsentDates: new Set()
        };
      }
    });

    // 3. Finalize each subject's deduplicated daily calendar & exact counts
    const subjectEntries = Object.values(mergedSubMap)
      .map(grp => {
        const dateMap = new Map(); // dateStr -> boolean (true = Present, false = Absent)

        // First populate from actual session documents (already 1 per day)
        const sessMap = sessionsBySubAndDate[grp.subKey];
        if (sessMap && sessMap.size > 0) {
          sessMap.forEach((isPres, dStr) => {
            dateMap.set(dStr, isPres);
          });
        }

        // Ensure all uniqueAbsentDates from student profile are marked false (1 per day)
        grp.uniqueAbsentDates.forEach(dStr => {
          if (!dateMap.has(dStr)) {
            dateMap.set(dStr, false);
          }
        });

        let finalTotal = dateMap.size;
        let finalNotPresent = Array.from(dateMap.values()).filter(v => v === false).length;
        let finalPresent = finalTotal - finalNotPresent;

        // If no session docs were cached yet for this subject, use deduplicated profile counts
        // (When TKS QURAN [20] and SPECIALIZATION QURAN [21] were duplicate imports of the same subject,
        // use maxRawTotal instead of doubling them to 41!)
        const isMergedTksDuplicate = grp.rawKeys.length > 1 && grp.subKey.startsWith('SPECIALIZATION');
        const profileTotal = isMergedTksDuplicate ? grp.maxRawTotal : grp.sumRawTotal;

        if (finalTotal === 0 && profileTotal > 0) {
          finalTotal = profileTotal;
          finalNotPresent = grp.uniqueAbsentDates.size;
          finalPresent = Math.max(0, finalTotal - finalNotPresent);
        }

        const sPct = finalTotal > 0 ? ((finalPresent / finalTotal) * 100).toFixed(2) : '100.00';

        // Sort unique dates chronologically for the Monthly Calendar Cards
        const sortedDailyLogs = Array.from(dateMap.entries())
          .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
          .map(([dateStr, isPresent]) => ({ dateStr, isPresent }));

        return {
          subKey: grp.subKey,
          displayTitle: grp.displayTitle,
          total: finalTotal,
          present: finalPresent,
          notPresent: finalNotPresent,
          pct: sPct,
          dailyLogs: sortedDailyLogs
        };
      })
      .filter(item => item.total > 0)
      .sort((a, b) => a.displayTitle.localeCompare(b.displayTitle));

    // Recalculate top tiles from deduplicated academic subjects (excludes Rehearsal & duplicate TKS!)
    const totalClassesHeld = subjectEntries.reduce((acc, item) => acc + item.total, 0) || (Number(stat.totalPeriods) || 0);
    const totalPresentWithOfficial = subjectEntries.reduce((acc, item) => acc + item.present, 0) || (Number(stat.presentCount) || 0);
    const totalAbsent = Math.max(0, totalClassesHeld - totalPresentWithOfficial);
    const totalOfficial = Number(stat.officialCount) || 0;
    const totalMedical = Number(stat.medicalCount) || 0;
    const minusCount = Number(stat.minusCount) || 0;
    const minusLogs = Array.isArray(stat.minusLogs) ? stat.minusLogs : [];

    const overallPct =
      totalClassesHeld > 0
        ? Math.round((Math.max(0, totalPresentWithOfficial - minusCount) / totalClassesHeld) * 100)
        : 100;
    const medicalPct =
      totalClassesHeld > 0 ? Math.round((totalMedical / totalClassesHeld) * 100) : 0;
    const officialPct =
      totalClassesHeld > 0 ? Math.round((totalOfficial / totalClassesHeld) * 100) : 0;

    // Build month-by-month green/red day squares for a subject (Strictly 1 square per unique date!)
    const buildSubjectMonthCalendarGroups = subEntry => {
      const monthGroups = {};
      (subEntry.dailyLogs || []).forEach(item => {
        const dObj = new Date(`${item.dateStr}T00:00:00`);
        const mLabel = !isNaN(dObj.getTime())
          ? dObj.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase()
          : item.dateStr.slice(0, 7);
        const dayNum = !isNaN(dObj.getTime()) ? dObj.getDate() : item.dateStr.slice(8, 10);
        if (!monthGroups[mLabel]) monthGroups[mLabel] = [];
        // Guarantee no duplicate day square inside the same month
        if (!monthGroups[mLabel].some(x => x.dayNum === dayNum)) {
          monthGroups[mLabel].push({
            dayNum,
            dateStr: item.dateStr,
            isPresent: item.isPresent
          });
        }
      });
      return Object.entries(monthGroups);
    };

    return (
      <div style={{ background: '#ffffff', padding: '26px', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
        {/* TOP HEADER BAR WITH BACK BUTTON AND "Go To Details ->" BUTTON */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => {
                if (studentDrilldownView === 'details') {
                  setStudentDrilldownView('stats');
                  setFocusedSubjectKey('ALL');
                } else {
                  setSelectedProfileStudent(null);
                }
              }}
              style={styles.buttonSecondary}
            >
              ⬅ {studentDrilldownView === 'details' ? 'Back to Attendance Statistics' : 'Back to Master Report'}
            </button>
            <div>
              <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: '#0f172a' }}>
                📈 Attendance Statistics — {st.firstName} (#{st.adNo} • {stCls})
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              if (studentDrilldownView === 'stats') {
                setFocusedSubjectKey('ALL');
                setStudentDrilldownView('details');
              } else {
                setStudentDrilldownView('stats');
              }
            }}
            style={{
              padding: '10px 20px',
              borderRadius: '999px',
              background: '#0d9488',
              color: '#ffffff',
              border: 'none',
              fontWeight: '800',
              fontSize: '13px',
              cursor: 'pointer',
              boxShadow: '0 4px 10px rgba(13, 148, 136, 0.2)'
            }}
          >
            {studentDrilldownView === 'stats' ? 'Go To Details ➔' : '📊 View Summary Table'}
          </button>
        </div>

        {/* 4 PASTEL TILES (TOTAL CLASSES, PRESENT, ABSENT, CLICKABLE MINUS DEDUCTION) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: '14px', marginBottom: '18px' }}>
          <div style={{ padding: '18px 20px', borderRadius: '14px', background: '#eef2ff', border: '1px solid #c7d2fe' }}>
            <div style={{ fontSize: '11px', fontWeight: '800', color: '#4f46e5', textTransform: 'uppercase' }}>TOTAL CLASSES</div>
            <div style={{ fontSize: '28px', fontWeight: '900', color: '#3730a3', marginTop: '4px' }}>{totalClassesHeld}</div>
          </div>

          <div style={{ padding: '18px 20px', borderRadius: '14px', background: '#ecfdf5', border: '1px solid #a7f3d0' }}>
            <div style={{ fontSize: '11px', fontWeight: '800', color: '#10b981', textTransform: 'uppercase' }}>PRESENT</div>
            <div style={{ fontSize: '28px', fontWeight: '900', color: '#047857', marginTop: '4px' }}>{totalPresentWithOfficial}</div>
          </div>

          <div style={{ padding: '18px 20px', borderRadius: '14px', background: '#fffbeb', border: '1px solid #fde68a' }}>
            <div style={{ fontSize: '11px', fontWeight: '800', color: '#d97706', textTransform: 'uppercase' }}>ABSENT</div>
            <div style={{ fontSize: '28px', fontWeight: '900', color: '#b45309', marginTop: '4px' }}>{totalAbsent}</div>
          </div>

          <div
            onClick={() => {
              setShowMinusDetailsBanner(prev => !prev);
              setStudentDrilldownView('details');
            }}
            title="Click to see Minus Deduction reasons, dates, and teachers"
            style={{
              padding: '18px 20px',
              borderRadius: '14px',
              background: '#fff1f2',
              border: '1.5px solid #fecdd3',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', fontWeight: '800', color: '#e11d48', textTransform: 'uppercase' }}>MINUS DEDUCTION</span>
              <span style={{ fontSize: '10px', fontWeight: '800', color: '#be123c', textDecoration: 'underline' }}>Click for why/when</span>
            </div>
            <div style={{ fontSize: '28px', fontWeight: '900', color: '#be123c', marginTop: '4px' }}>
              {minusCount > 0 ? `−${minusCount}` : '0'}
            </div>
          </div>
        </div>

        {/* RED PERCENTAGES BAR (Overall Percentage, Medical Percentage, Official Percentage) */}
        <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', flexWrap: 'wrap', gap: '16px', padding: '12px 16px', marginBottom: '20px', color: '#dc2626', fontWeight: '700', fontSize: '15px' }}>
          <span>Overall Percentage: {overallPct}%</span>
          <span>Medical Percentage: {medicalPct}%</span>
          <span>Official Percentage: {officialPct}%</span>
        </div>

        {/* MINUS DEDUCTION LOG CARDS (Shown when Minus Tile is clicked or inside Details View, matching Pic 6 top card!) */}
        {(showMinusDetailsBanner || studentDrilldownView === 'details') && (
          <div style={{ marginBottom: '22px', padding: '16px 20px', borderRadius: '14px', background: '#ffffff', border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(15,23,42,0.04)' }}>
            <div style={{ fontSize: '12px', fontWeight: '800', color: '#be123c', textTransform: 'uppercase', marginBottom: '10px' }}>
              ⚖️ Minus Deduction History ({minusLogs.length} Record{minusLogs.length === 1 ? '' : 's'})
            </div>
            {minusLogs.length === 0 ? (
              <div style={{ fontSize: '13px', color: '#047857', fontWeight: '700' }}>
                ✅ Zero minus deductions recorded for {st.firstName}.
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                {minusLogs.map((mLog, mIdx) => (
                  <div
                    key={mLog.id || mIdx}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '12px',
                      background: '#fff1f2',
                      border: '1px solid #fecdd3',
                      padding: '10px 16px',
                      borderRadius: '12px'
                    }}
                  >
                    <span style={{ background: '#ffe4e6', color: '#be123c', padding: '4px 10px', borderRadius: '999px', fontWeight: '900', fontSize: '13px' }}>
                      − {mLog.count || 1}
                    </span>
                    <div>
                      <div style={{ fontWeight: '800', fontSize: '13px', color: '#0f172a', fontStyle: 'italic' }}>
                        &ldquo;{mLog.reason || 'Disciplinary Minus'}&rdquo;
                      </div>
                      <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '600', marginTop: '2px' }}>
                        By: <strong>{mLog.teacherName || mLog.recordedBy || 'ADMIN USER'}</strong>
                      </div>
                    </div>
                    <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '700', marginLeft: '6px' }}>
                      {mLog.date || ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* VIEW 1: SUBJECT SUMMARY TABLE (Matches Pics 4 & 5 — each subject row is clickable!) */}
        {studentDrilldownView === 'stats' ? (
          <div style={{ border: '1px solid #e2e8f0', borderRadius: '14px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '11px', fontWeight: '800', textTransform: 'uppercase' }}>
                  <th style={{ padding: '14px 18px' }}>SUBJECT</th>
                  <th style={{ padding: '14px 18px' }}>ATTENDANCE %</th>
                  <th style={{ padding: '14px 18px' }}>TOTAL ATTENDANCE</th>
                  <th style={{ padding: '14px 18px' }}>NOT PRESENT</th>
                </tr>
              </thead>
              <tbody>
                {subjectEntries.map(item => (
                  <tr
                    key={item.subKey}
                    onClick={() => {
                      setFocusedSubjectKey(item.subKey);
                      setStudentDrilldownView('details');
                    }}
                    title="Click to open monthly calendar breakdown for this subject"
                    style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer', background: '#ffffff', transition: 'background 0.15s' }}
                  >
                    <td style={{ padding: '14px 18px', fontWeight: '700', color: '#1e293b' }}>
                      {item.displayTitle}
                    </td>
                    <td style={{ padding: '14px 18px', fontWeight: '800', color: Number(item.pct) < 85 ? '#dc2626' : '#0f172a' }}>
                      {item.pct}%
                    </td>
                    <td style={{ padding: '14px 18px', fontWeight: '600', color: '#334155' }}>
                      {item.total}
                    </td>
                    <td style={{ padding: '14px 18px', fontWeight: '600', color: '#334155' }}>
                      {item.notPresent}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          /* VIEW 2: SUBJECT MONTHLY DATE-SQUARE CALENDAR CARDS (Matches Pic 6!) */
          <div>
            {focusedSubjectKey !== 'ALL' && (
              <div style={{ marginBottom: '14px' }}>
                <button
                  type="button"
                  onClick={() => setFocusedSubjectKey('ALL')}
                  style={styles.buttonSecondary}
                >
                  📚 Show All Subjects ({subjectEntries.length})
                </button>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
              {subjectEntries
                .filter(item => focusedSubjectKey === 'ALL' || item.subKey === focusedSubjectKey)
                .map(item => {
                  const monthGroups = buildSubjectMonthCalendarGroups(item);
                  return (
                    <div
                      key={item.subKey}
                      style={{
                        background: '#ffffff',
                        borderRadius: '16px',
                        border: '1px solid #e2e8f0',
                        overflow: 'hidden',
                        boxShadow: '0 4px 12px rgba(15,23,42,0.05)',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between'
                      }}
                    >
                      {/* RED / CORAL SUBJECT HEADER BAR (Matches Pic 6) */}
                      <div>
                        <div
                          style={{
                            background: 'linear-gradient(135deg, #f43f5e 0%, #e11d48 100%)',
                            color: '#ffffff',
                            padding: '14px 18px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                          }}
                        >
                          <div style={{ fontWeight: '800', fontSize: '15px', letterSpacing: '0.3px' }}>
                            📖 {item.displayTitle}
                          </div>
                          <span
                            style={{
                              background: 'rgba(255,255,255,0.22)',
                              color: '#ffffff',
                              padding: '4px 10px',
                              borderRadius: '999px',
                              fontSize: '12px',
                              fontWeight: '800'
                            }}
                          >
                            {Number(item.pct).toFixed(1)}%
                          </span>
                        </div>

                        {/* MONTH-BY-MONTH GREEN / RED DATE SQUARES */}
                        <div style={{ padding: '18px' }}>
                          {monthGroups.length === 0 ? (
                            <div style={{ fontSize: '12px', color: '#94a3b8', padding: '12px 0' }}>
                              No individual date logs stored for this subject.
                            </div>
                          ) : (
                            monthGroups.map(([monthTitle, daysArr]) => (
                              <div key={monthTitle} style={{ marginBottom: '16px' }}>
                                <div style={{ fontSize: '11px', fontWeight: '800', color: '#475569', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <span>📅</span> {monthTitle}
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                  {daysArr.map((dItem, dIdx) => (
                                    <span
                                      key={`${dItem.dateStr}_${dIdx}`}
                                      title={`${dItem.dateStr}: ${dItem.isPresent ? 'Present' : 'Absent'}`}
                                      style={{
                                        width: '34px',
                                        height: '34px',
                                        borderRadius: '8px',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontWeight: '800',
                                        fontSize: '12px',
                                        background: dItem.isPresent ? '#10b981' : '#f43f5e',
                                        color: '#ffffff',
                                        boxShadow: '0 2px 4px rgba(0,0,0,0.08)'
                                      }}
                                    >
                                      {dItem.dayNum}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      {/* 4 BOTTOM STAT BOXES (Total Days, Present, Absent, Percentage — Matches Pic 6) */}
                      <div
                        style={{
                          padding: '14px 18px 18px',
                          borderTop: '1px solid #f1f5f9',
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr',
                          gap: '10px'
                        }}
                      >
                        <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '10px' }}>
                          <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '700' }}>📅 Total Days</div>
                          <div style={{ fontSize: '18px', fontWeight: '900', color: '#0f172a', marginTop: '2px' }}>{item.total}</div>
                        </div>
                        <div style={{ background: '#ecfdf5', padding: '10px 14px', borderRadius: '10px' }}>
                          <div style={{ fontSize: '11px', color: '#059669', fontWeight: '700' }}>✓ Present</div>
                          <div style={{ fontSize: '18px', fontWeight: '900', color: '#065f46', marginTop: '2px' }}>{item.present}</div>
                        </div>
                        <div style={{ background: '#fff1f2', padding: '10px 14px', borderRadius: '10px' }}>
                          <div style={{ fontSize: '11px', color: '#e11d48', fontWeight: '700' }}>✕ Absent</div>
                          <div style={{ fontSize: '18px', fontWeight: '900', color: '#9f1239', marginTop: '2px' }}>{item.notPresent}</div>
                        </div>
                        <div style={{ background: '#fff1f2', padding: '10px 14px', borderRadius: '10px' }}>
                          <div style={{ fontSize: '11px', color: '#e11d48', fontWeight: '700' }}>📈 Percentage</div>
                          <div style={{ fontSize: '18px', fontWeight: '900', color: '#be123c', marginTop: '2px' }}>{item.pct}%</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ============================================================================
  // MAIN MASTER REPORTS HUB VIEW
  // ============================================================================
  return (
    <div style={{ background: '#ffffff', padding: '24px', borderRadius: '14px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', borderBottom: '1px solid #f1f5f9', paddingBottom: '14px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: '#0f172a' }}>
            {repScope === 'fn_an_monthly'
              ? `FN / AN Monthly Day Summary (${repMonth})`
              : repScope === 'monthly'
              ? `Monthly Subject Report (${repMonth})`
              : `Total Semester Attendance Summary (${totalFilterMonth === 'ALL' ? 'Whole Semester' : totalFilterMonth})`}
          </h2>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>
            Click on any student&apos;s name to open their full Subject-Wise Attendance Statistics, Monthly Calendar &amp; Minus Deduction breakdown.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setShowReportFilters(prev => !prev)}
            style={{
              padding: '8px 14px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              background: showReportFilters ? '#4f46e5' : '#ffffff',
              color: showReportFilters ? '#ffffff' : '#334155',
              fontWeight: '700',
              fontSize: '12px',
              cursor: 'pointer'
            }}
          >
            🎛️ {showReportFilters ? 'Hide Filters' : 'Filter Options'}
          </button>
          <button type="button" onClick={handleExportReportMatrixExcel} style={styles.buttonPrimary}>
            ⬇️ Export Excel
          </button>
        </div>
      </div>

      {/* SCOPE SELECTOR TABS (Deleted "📅 Specific Date (All Periods)" for Admin!) */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', background: '#f8fafc', padding: '12px 16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {[
         ...(userRole === 'admin'
           ? [
               { id: 'total', label: '📈 Total Semester Attendance' },
               { id: 'fn_an_monthly', label: '🌤️ FN / AN Monthly Days (All Classes)' }
             ]
           : isClassTeacher
           ? [
               { id: 'fn_an_monthly', label: `🌤️ Class ${myCtClasses.join(', ')} Monthly Day Register (FN & AN)` },
               { id: 'total', label: '📈 My Subject Summary (Total)' },
               { id: 'daily', label: '📅 My Recorded Periods (Daily)' }
             ]
           : [
               { id: 'total', label: '📈 My Subject Summary (Total)' },
               { id: 'daily', label: '📅 My Recorded Periods (Daily)' }
             ])
       ].map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setRepScope(tab.id)}
              style={{
                padding: '8px 14px',
                borderRadius: '8px',
                border: repScope === tab.id ? '1px solid #4f46e5' : '1px solid transparent',
                fontWeight: '700',
                fontSize: '12px',
                cursor: 'pointer',
                background: repScope === tab.id ? '#4f46e5' : '#ffffff',
                color: repScope === tab.id ? '#ffffff' : '#334155'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* CLASS FILTER + MONTH FILTER RIGHT ON THE BAR */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <select
            value={repClass}
            onChange={e => setRepClass(e.target.value)}
            style={{ ...styles.input, width: 'auto', padding: '7px 12px', fontSize: '12px', fontWeight: '700' }}
          >
            <option value="ALL">All Classes ({availableClassesForDropdown.length})</option>
            {availableClassesForDropdown.map(c => (
              <option key={c} value={c}>Class {c}</option>
            ))}
          </select>

          {repScope === 'total' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <select
                value={totalFilterMonth === 'ALL' ? 'ALL' : 'MONTH'}
                onChange={e => {
                  if (e.target.value === 'ALL') setTotalFilterMonth('ALL');
                  else setTotalFilterMonth(repMonth);
                }}
                style={{ ...styles.input, width: 'auto', padding: '7px 12px', fontSize: '12px', fontWeight: '700' }}
              >
                <option value="ALL">📚 Whole Semester</option>
                <option value="MONTH">🗓️ Filter by Month</option>
              </select>
              {totalFilterMonth !== 'ALL' && (
                <input
                  type="month"
                  value={totalFilterMonth}
                  onChange={e => setTotalFilterMonth(e.target.value)}
                  style={{ ...styles.input, width: 'auto', padding: '7px 12px', fontSize: '12px', fontWeight: '700' }}
                />
              )}
            </div>
          )}

          {(repScope === 'monthly' || repScope === 'fn_an_monthly') && (
            <input
              type="month"
              value={repMonth}
              onChange={e => setRepMonth(e.target.value)}
              style={{ ...styles.input, width: 'auto', padding: '7px 12px', fontSize: '12px', fontWeight: '700' }}
            />
          )}

          <input
            type="text"
            value={repSearch}
            onChange={e => setRepSearch(e.target.value)}
            placeholder="🔍 Search student..."
            style={{ ...styles.input, width: '190px', padding: '7px 12px', fontSize: '12px' }}
          />
        </div>
      </div>

      {/* =========================================================
          VIEW 1: TOTAL SEMESTER ATTENDANCE SUMMARY (Clean Totals Only + Clickable Student Name!)
         ========================================================= */}
      {repScope === 'total' ? (
        <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left', minWidth: '940px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', color: '#475569', fontSize: '11px', fontWeight: '800', textTransform: 'uppercase' }}>
                <th style={{ padding: '14px 12px' }}>#</th>
                <th style={{ padding: '14px 12px' }}>STUDENT NAME (CLICK FOR DETAILS)</th>
                <th style={{ padding: '14px 12px' }}>AD.NO</th>
                <th style={{ padding: '14px 12px' }}>CLASS</th>
                <th style={{ padding: '14px 12px', textAlign: 'center' }}>TOTAL TAKEN</th>
                <th style={{ padding: '14px 12px', textAlign: 'center', color: '#047857' }}>NORMAL PRESENT</th>
                <th style={{ padding: '14px 12px', textAlign: 'center', color: '#e11d48' }}>TOTAL ABSENCE</th>
                <th style={{ padding: '14px 12px', textAlign: 'center', color: '#0d9488' }}>OFFICIAL</th>
                <th style={{ padding: '14px 12px', textAlign: 'center', color: '#d97706' }}>MEDICAL</th>
                <th style={{ padding: '14px 12px', textAlign: 'center', background: '#ecfdf5', color: '#065f46' }}>GRAND TOTAL (PRES + OFF)</th>
                <th style={{ padding: '14px 12px', textAlign: 'center', color: '#be123c' }}>MINUS</th>
                <th style={{ padding: '14px 12px', textAlign: 'center', background: '#eef2ff', color: '#4f46e5' }}>NET TOTAL (AFTER MINUS)</th>
                <th style={{ padding: '14px 12px', textAlign: 'center' }}>NET %</th>
              </tr>
            </thead>
            <tbody>
              {filteredReportStudents.map((st, idx) => {
                const m = computeStudentSummaryMetrics(st, totalFilterMonth);
                return (
                  <tr key={st.regNo || idx} style={{ borderBottom: '1px solid #f1f5f9', background: '#ffffff' }}>
                    <td style={{ padding: '13px 12px', color: '#64748b' }}>{idx + 1}</td>
                    <td style={{ padding: '13px 12px' }}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedProfileStudent(st);
                          setStudentDrilldownView('stats');
                          setFocusedSubjectKey('ALL');
                          setShowMinusDetailsBanner(false);
                        }}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          padding: 0,
                          fontWeight: '800',
                          fontSize: '13px',
                          color: '#4f46e5',
                          cursor: 'pointer',
                          textDecoration: 'underline',
                          textAlign: 'left'
                        }}
                      >
                        {st.firstName} ↗
                      </button>
                    </td>
                    <td style={{ padding: '13px 12px', fontWeight: '700', color: '#475569' }}>#{st.adNo}</td>
                    <td style={{ padding: '13px 12px', fontWeight: '700', color: '#334155' }}>{(st.classes || []).join(', ')}</td>
                    <td style={{ padding: '13px 12px', textAlign: 'center', fontWeight: '800' }}>{m.totalTaken}</td>
                    <td style={{ padding: '13px 12px', textAlign: 'center', fontWeight: '700', color: '#047857' }}>{m.normalPresent}</td>
                    <td style={{ padding: '13px 12px', textAlign: 'center', fontWeight: '700', color: '#e11d48' }}>{m.totalAbsence}</td>
                    <td style={{ padding: '13px 12px', textAlign: 'center', fontWeight: '700', color: '#0d9488' }}>{m.officialCount}</td>
                    <td style={{ padding: '13px 12px', textAlign: 'center', fontWeight: '700', color: '#d97706' }}>{m.medicalCount}</td>
                    <td style={{ padding: '13px 12px', textAlign: 'center', fontWeight: '900', background: '#f0fdf4', color: '#065f46' }}>
                      {m.grandTotalPres}
                    </td>
                    <td style={{ padding: '13px 12px', textAlign: 'center', fontWeight: '800', color: m.minusCount > 0 ? '#e11d48' : '#94a3b8' }}>
                      {m.minusCount > 0 ? `-${m.minusCount}` : '0'}
                    </td>
                    <td style={{ padding: '13px 12px', textAlign: 'center', fontWeight: '900', background: '#f5f3ff', color: '#4f46e5' }}>
                      {m.netAfterMinus}
                    </td>
                    <td style={{ padding: '13px 12px', textAlign: 'center' }}>
                      <span
                        style={{
                          background: Number(m.netPct) < 85 ? '#fff1f2' : '#dcfce7',
                          color: Number(m.netPct) < 85 ? '#e11d48' : '#15803d',
                          padding: '4px 10px',
                          borderRadius: '999px',
                          fontWeight: '800',
                          fontSize: '12px'
                        }}
                      >
                        {m.totalTaken > 0 ? `${m.netPct}%` : '-'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : repScope === 'fn_an_monthly' ? (
        /* =========================================================
           VIEW 2: FN / AN MONTHLY DAYS
           ========================================================= */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ marginBottom: '14px' }}>
            <div
              style={{
                maxWidth: '280px',
                padding: '16px 20px',
                borderRadius: '12px',
                background: '#f8fafc',
                border: '1.5px solid #e2e8f0',
                textAlign: 'center'
              }}
            >
              <span style={{ fontSize: '11px', fontWeight: '800', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Class Strength
              </span>
              <div style={{ fontSize: '28px', fontWeight: '900', color: '#0f172a', marginTop: '4px' }}>
                {fnAnRows.length}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', background: '#f8fafc', padding: '10px 14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setFnAnViewMode('summary')}
                style={{
                  padding: '7px 14px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  fontWeight: '800',
                  cursor: 'pointer',
                  border: fnAnViewMode === 'summary' ? '2px solid #4f46e5' : '1px solid #cbd5e1',
                  background: fnAnViewMode === 'summary' ? '#eef2ff' : '#ffffff',
                  color: fnAnViewMode === 'summary' ? '#4f46e5' : '#475569'
                }}
              >
                📊 Monthly Day Summary
              </button>
              <button
                type="button"
                onClick={() => setFnAnViewMode('register_grid')}
                style={{
                  padding: '7px 14px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  fontWeight: '800',
                  cursor: 'pointer',
                  border: fnAnViewMode === 'register_grid' ? '2px solid #4f46e5' : '1px solid #cbd5e1',
                  background: fnAnViewMode === 'register_grid' ? '#eef2ff' : '#ffffff',
                  color: fnAnViewMode === 'register_grid' ? '#4f46e5' : '#475569'
                }}
              >
                📋 Full Month Register Grid (All Working Days • Friday Off)
              </button>
            </div>
          </div>

          {loadingFnAn ? (
            <div style={{ padding: '28px', textAlign: 'center', color: '#64748b', fontWeight: '700' }}>
              Calculating Forenoon (P1–P6) &amp; Afternoon (P7–P9) daily sessions for {repMonth}...
            </div>
          ) : fnAnViewMode === 'summary' ? (
            <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left', minWidth: '880px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '11px', fontWeight: '800', textTransform: 'uppercase' }}>
                    <th style={{ padding: '12px 14px' }}>#</th>
                    <th style={{ padding: '12px 14px' }}>STUDENT &amp; AD.NO</th>
                    <th style={{ padding: '12px 14px' }}>CLASS</th>
                    <th style={{ padding: '12px 14px', textAlign: 'center' }}>WORKING DAYS</th>
                    <th style={{ padding: '12px 14px', textAlign: 'center' }}>FN PRESENT (P1–P6)</th>
                    <th style={{ padding: '12px 14px', textAlign: 'center' }}>AN PRESENT (P7–P9)</th>
                    <th style={{ padding: '12px 14px', textAlign: 'center' }}>DAYS PRESENT</th>
                    <th style={{ padding: '12px 14px', textAlign: 'center' }}>DAYS ABSENT</th>
                    <th style={{ padding: '12px 14px' }}>ABSENT DATES &amp; LEAVE REASONS</th>
                    <th style={{ padding: '12px 14px', textAlign: 'right' }}>CONTACT</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedFnAnRows.map((r, idx) => (
                    <tr key={r.student.regNo} style={{ borderBottom: '1px solid #f1f5f9', background: r.isAbsentMoreThan5Days ? '#fff1f2' : '#ffffff' }}>
                      <td style={{ padding: '12px 14px', color: '#64748b' }}>{idx + 1}</td>
                      <td style={{ padding: '12px 14px', fontWeight: '700', color: '#0f172a' }}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedProfileStudent(r.student);
                            setStudentDrilldownView('stats');
                          }}
                          style={{ background: 'transparent', border: 'none', padding: 0, fontWeight: '800', color: '#4f46e5', cursor: 'pointer', textDecoration: 'underline' }}
                        >
                          {r.student.firstName} (#{r.student.adNo}) ↗
                        </button>
                      </td>
                      <td style={{ padding: '12px 14px', fontWeight: '700', color: '#334155' }}>
                        {(r.student.classes || []).join(', ')}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'center', fontWeight: '700' }}>
                        {r.workingDaysHeld}d
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'center', color: '#047857', fontWeight: '700' }}>
                        {r.fnPresentCount}/{r.fnTotalCount}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'center', color: '#0284c7', fontWeight: '700' }}>
                        {r.anPresentCount}/{r.anTotalCount}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                        <span style={{ background: '#dcfce7', color: '#15803d', padding: '3px 10px', borderRadius: '999px', fontWeight: '800', fontSize: '12px' }}>
                          {r.totalDaysPresent} Days ({r.dayAttPct}%)
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                        <span style={{
                          background: r.totalDaysAbsent >= 5 ? '#ffe4e6' : r.totalDaysAbsent > 0 ? '#fef3c7' : '#f1f5f9',
                          color: r.totalDaysAbsent >= 5 ? '#e11d48' : r.totalDaysAbsent > 0 ? '#b45309' : '#64748b',
                          padding: '3px 10px',
                          borderRadius: '999px',
                          fontWeight: '800',
                          fontSize: '12px'
                        }}>
                          {r.totalDaysAbsent} Days
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px', fontSize: '11px', maxWidth: '280px' }}>
                        {r.absentDatesDetails.length > 0 && (
                          <div style={{ color: '#e11d48', fontWeight: '600', marginBottom: '2px' }}>
                            📅 {r.absentDatesDetails.slice(0, 6).join(', ')}
                          </div>
                        )}
                        {r.leaveReasonsList.length > 0 ? (
                          <div style={{ color: '#475569', fontWeight: '600' }}>
                            🪪 {r.leaveReasonsList.slice(0, 2).join(' • ')}
                          </div>
                        ) : r.totalDaysAbsent > 0 ? (
                          <span style={{ color: '#94a3b8' }}>No Out-Pass recorded</span>
                        ) : (
                          <span style={{ color: '#047857', fontWeight: '700' }}>✓ Present All Working Days</span>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                        <button
                          type="button"
                          onClick={() =>
                            openDirectWhatsApp(
                              r.student.parentWhatsapp || r.student.parentMobile,
                              `Assalamu Alaikum, monthly attendance update for ${r.student.firstName} (#${r.student.adNo}) for ${repMonth}: Present ${r.totalDaysPresent} days, Absent ${r.totalDaysAbsent} days out of ${r.workingDaysHeld} working days.`
                            )
                          }
                          style={{ padding: '5px 10px', background: '#f8fafc', color: '#334155', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '11px', fontWeight: '700', cursor: 'pointer' }}
                        >
                          💬 Parent WA
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '12px', maxHeight: '560px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', textAlign: 'center', minWidth: '1050px' }}>
                <thead style={{ position: 'sticky', top: 0, background: '#0f172a', color: '#ffffff', zIndex: 10 }}>
                  <tr>
                    <th style={{ padding: '8px 10px', textAlign: 'left', minWidth: '35px' }}>#</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left', minWidth: '160px' }}>Student Name</th>
                    <th style={{ padding: '8px 10px', minWidth: '60px' }}>Ad.No</th>
                    {allDaysInSelectedMonth.map(d => (
                      <th
                        key={d.dateStr}
                        style={{
                          padding: '6px 4px',
                          minWidth: '32px',
                          background: d.isFriday ? '#475569' : '#1e293b',
                          color: d.isFriday ? '#fbbf24' : '#ffffff',
                          borderLeft: '1px solid #334155'
                        }}
                      >
                        <div style={{ fontSize: '11px', fontWeight: '800' }}>{d.dayNum}</div>
                        <div style={{ fontSize: '9px', opacity: 0.85 }}>{d.dayName}</div>
                      </th>
                    ))}
                    <th style={{ padding: '8px 10px', minWidth: '70px', background: '#064e3b' }}>Pres (d)</th>
                    <th style={{ padding: '8px 10px', minWidth: '70px', background: '#881337' }}>Abs (d)</th>
                    <th style={{ padding: '8px 10px', minWidth: '70px', background: '#312e81' }}>%</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedFnAnRows.map((r, idx) => {
                    const st = r.student;
                    const reg = st.regNo;
                    const ad = String(st.adNo || '').trim().toUpperCase();

                    return (
                      <tr key={st.regNo} style={{ borderBottom: '1px solid #e2e8f0', background: idx % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                        <td style={{ padding: '6px 8px', textAlign: 'left', color: '#64748b' }}>{idx + 1}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'left', fontWeight: '700', color: '#0f172a', whiteSpace: 'nowrap' }}>{st.firstName}</td>
                        <td style={{ padding: '6px 8px', color: '#64748b' }}>#{st.adNo}</td>
                        {allDaysInSelectedMonth.map(d => {
                          if (d.isFriday) {
                            return (
                              <td key={d.dateStr} style={{ padding: '4px 2px', background: '#fef3c7', color: '#b45309', fontWeight: '800', fontSize: '9px', borderLeft: '1px solid #e2e8f0' }}>
                                OFF
                              </td>
                            );
                          }
                          const daySessions = fnAnMonthSessions.filter(s => s.date === d.dateStr);
                          if (daySessions.length === 0) {
                            return (
                              <td key={d.dateStr} style={{ padding: '4px 2px', color: '#cbd5e1', borderLeft: '1px solid #f1f5f9' }}>
                                -
                              </td>
                            );
                          }

                          const fnSess = daySessions.filter(s => Number(s.session) <= 6);
                          const anSess = daySessions.filter(s => Number(s.session) > 6);
                          const isFnPres = fnSess.some(s => {
                            const val = (s.attendanceMap || {})[reg] || (s.attendanceMap || {})[st.id] || (s.attendanceMap || {})[ad];
                            return val === 'P' || val === 'O';
                          });
                          const isAnPres = anSess.some(s => {
                            const val = (s.attendanceMap || {})[reg] || (s.attendanceMap || {})[st.id] || (s.attendanceMap || {})[ad];
                            return val === 'P' || val === 'O';
                          });

                          let badgeText = 'A';
                          let bg = '#fee2e2';
                          let textCol = '#dc2626';

                          if (fnSess.length > 0 && anSess.length > 0) {
                            if (isFnPres && isAnPres) { badgeText = 'P'; bg = '#dcfce7'; textCol = '#15803d'; }
                            else if (isFnPres) { badgeText = 'FN'; bg = '#fef3c7'; textCol = '#d97706'; }
                            else if (isAnPres) { badgeText = 'AN'; bg = '#e0f2fe'; textCol = '#0284c7'; }
                          } else if (fnSess.length > 0 && isFnPres) {
                            badgeText = 'FN'; bg = '#fef3c7'; textCol = '#d97706';
                          } else if (anSess.length > 0 && isAnPres) {
                            badgeText = 'AN'; bg = '#e0f2fe'; textCol = '#0284c7';
                          }

                          return (
                            <td key={d.dateStr} style={{ padding: '4px 2px', background: bg, color: textCol, fontWeight: '800', fontSize: '10px', borderLeft: '1px solid #e2e8f0' }}>
                              {badgeText}
                            </td>
                          );
                        })}
                        <td style={{ padding: '6px 8px', fontWeight: '800', color: '#047857', background: '#ecfdf5' }}>{r.totalDaysPresent}d</td>
                        <td style={{ padding: '6px 8px', fontWeight: '800', color: r.totalDaysAbsent >= 5 ? '#e11d48' : '#475569', background: r.totalDaysAbsent >= 5 ? '#ffe4e6' : '#f8fafc' }}>{r.totalDaysAbsent}d</td>
                        <td style={{ padding: '6px 8px', fontWeight: '800', color: '#1e40af' }}>{r.dayAttPct}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        /* =========================================================
           VIEW 3: MONTHLY SUBJECT MATRIX
           ========================================================= */
        <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left', minWidth: '880px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '11px', fontWeight: '800', textTransform: 'uppercase' }}>
                <th style={{ padding: '14px 12px' }}>#</th>
                <th style={{ padding: '14px 12px' }}>STUDENT NAME</th>
                <th style={{ padding: '14px 12px' }}>ADMISSION NO</th>
                {(repMinusMode === 'both' || repMinusMode === 'without_minus') && (
                  <th style={{ padding: '14px 12px', textAlign: 'center' }}>GROSS % (NO MINUS)</th>
                )}
                {(repMinusMode === 'both' || repMinusMode === 'with_minus') && (
                  <>
                    <th style={{ padding: '14px 12px', textAlign: 'center' }}>MINUS</th>
                    <th style={{ padding: '14px 12px', textAlign: 'center' }}>OVERALL % (NET)</th>
                  </>
                )}
                {subjectColumns.map(subKey => (
                  <th key={subKey} style={{ padding: '14px 12px', textAlign: 'center' }}>
                    {subKey}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredReportStudents.map((st, idx) => {
                const stat = getStudentAttStat(st);
                const sw = stat.subjectWise || {};
                let totP = Number(stat.totalPeriods) || 0;
                let presP = Number(stat.presentCount) || 0;
                let minusC = Number(stat.minusCount) || 0;

                if (repScope === 'monthly') {
                  let monthAbs = 0;
                  Object.values(sw).forEach(sObj => {
                    monthAbs += (sObj.absentDates || []).filter(d => String(d).startsWith(repMonth)).length;
                  });
                  minusC = (stat.minusLogs || [])
                    .filter(l => String(l.date || '').startsWith(repMonth))
                    .reduce((s, l) => s + (Number(l.count) || 0), 0);
                  presP = Math.max(0, totP - monthAbs);
                }

                const grossPct = totP > 0 ? ((presP / totP) * 100).toFixed(2) : '100.00';
                const netPres = Math.max(0, presP - minusC);
                const netPct = totP > 0 ? ((netPres / totP) * 100).toFixed(2) : '100.00';

                return (
                  <tr key={st.regNo} style={{ borderBottom: '1px solid #f1f5f9', background: '#ffffff' }}>
                    <td style={{ padding: '13px 12px', color: '#64748b' }}>{idx + 1}</td>
                    <td style={{ padding: '13px 12px', fontWeight: '700', color: '#0f172a' }}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedProfileStudent(st);
                          setStudentDrilldownView('stats');
                        }}
                        style={{ background: 'transparent', border: 'none', padding: 0, fontWeight: '800', color: '#4f46e5', cursor: 'pointer', textDecoration: 'underline' }}
                      >
                        {st.firstName} ↗
                      </button>
                    </td>
                    <td style={{ padding: '13px 12px', fontWeight: '600', color: '#475569' }}>{st.adNo}</td>

                    {(repMinusMode === 'both' || repMinusMode === 'without_minus') && (
                      <td style={{ padding: '13px 12px', textAlign: 'center' }}>
                        <span style={{ background: '#ecfdf5', color: '#047857', padding: '4px 10px', borderRadius: '999px', fontWeight: '700', fontSize: '12px' }}>
                          {totP > 0 ? `${grossPct}%` : '-'}
                        </span>
                      </td>
                    )}

                    {(repMinusMode === 'both' || repMinusMode === 'with_minus') && (
                      <>
                        <td style={{ padding: '13px 12px', textAlign: 'center', fontWeight: '700', color: minusC > 0 ? '#e11d48' : '#94a3b8' }}>
                          {minusC > 0 ? `-${minusC}` : '0'}
                        </td>
                        <td style={{ padding: '13px 12px', textAlign: 'center' }}>
                          <span style={{
                            background: Number(netPct) < 85 ? '#fff1f2' : '#eef2ff',
                            color: Number(netPct) < 85 ? '#e11d48' : '#4f46e5',
                            padding: '4px 10px',
                            borderRadius: '999px',
                            fontWeight: '800',
                            fontSize: '12px'
                          }}>
                            {totP > 0 ? `${netPct}%` : '-'}
                          </span>
                        </td>
                      </>
                    )}

                    {subjectColumns.map(subKey => {
                      const sObj = sw[subKey];
                      if (!sObj || !sObj.total) {
                        return <td key={subKey} style={{ padding: '13px 12px', textAlign: 'center', color: '#94a3b8' }}>-</td>;
                      }
                      let sPres = sObj.present || 0;
                      if (repScope === 'monthly') {
                        const mAbs = (sObj.absentDates || []).filter(d => String(d).startsWith(repMonth)).length;
                        sPres = Math.max(0, sObj.total - mAbs);
                      }
                      const sPct = ((sPres / sObj.total) * 100).toFixed(2);
                      return (
                        <td key={subKey} style={{ padding: '13px 12px', textAlign: 'center', fontWeight: '600', color: Number(sPct) < 85 ? '#e11d48' : '#334155' }}>
                          {sPct}%
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}