'use client';
import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { db } from '../../lib/firebase';
import { doc, getDoc, getDocs, collection } from 'firebase/firestore';
import { DEFAULT_CLASSES, DEFAULT_SUBJECTS, styles } from './erpConstants';
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
  setAttSession,
  loading,
  setLoading,
  setStatusMsg
}) {
  // --- 1. REPORTS HUB STATE ---
  const [repScope, setRepScope] = useState('total'); // 'total' | 'monthly' | 'fn_an_monthly' | 'daily'
  const [repClass, setRepClass] = useState(() => {
    const ctClasses = activeTeacherObj?.outpassPrivileges?.classTeacherOf || loggedInUser?.outpassPrivileges?.classTeacherOf || [];
    return ctClasses.length > 0 ? ctClasses[0] : 'ALL';
  });
  const [repMonth, setRepMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [repDate, setRepDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [repTeacher, setRepTeacher] = useState(userRole === 'admin' ? 'ALL' : (loggedInUser?.username || 'ALL'));
  const [repSubject, setRepSubject] = useState('ALL');
  const [repMinusMode, setRepMinusMode] = useState('both'); // 'both' | 'with_minus' | 'without_minus'
  const [repSearch, setRepSearch] = useState('');
  const [dailySessionsCache, setDailySessionsCache] = useState([]);
  const [loadingReport, setLoadingReport] = useState(false);
  const [showReportFilters, setShowReportFilters] = useState(false);

  // 🌟 FN (Periods 1-6) & AN (Periods 7-9) Monthly Day Strategy State
  const [fnAnMonthSessions, setFnAnMonthSessions] = useState([]);
  const [fnAnOutpasses, setFnAnOutpasses] = useState([]);
  const [fnAnFilterMode, setFnAnFilterMode] = useState('ALL'); // 'ALL' | 'ABSENT_GT_5' | 'PRESENT_ALL_DAYS'
  const [fnAnViewMode, setFnAnViewMode] = useState('summary'); // 'summary' | 'register_grid'
  const [loadingFnAn, setLoadingFnAn] = useState(false);

  // Load Daily Recorded Sessions when `repScope === 'daily'`
  useEffect(() => {
    async function fetchDailySessionsForReport() {
      if (activeTab !== 'reports_hub' || repScope !== 'daily' || !repDate) return;
      setLoadingReport(true);
      try {
        const idxSnap = await getDoc(doc(db, 'systemCache', `daySessionsIndex_${repDate}`));
        const list = idxSnap.exists() ? (idxSnap.data().sessions || []) : [];
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

  // 🌟 Load Month Period Sessions & Out-Passes when `repScope === 'fn_an_monthly'`
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
        cacheSnap.forEach(d => {
          if (d.id.startsWith(`periodSession_${repMonth}`)) {
            monthSessions.push({ id: d.id, ...d.data() });
          }
        });
        setFnAnMonthSessions(monthSessions);

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

  const myCtClasses = activeTeacherObj?.outpassPrivileges?.classTeacherOf || loggedInUser?.outpassPrivileges?.classTeacherOf || [];
  myCtClasses.forEach(c => teacherAllowedClassesSet.add(c));

  if (userRole !== 'admin') {
    attendanceEnrollments.forEach(env => {
      const subKey = normalizeSubKey(isAttendanceOnlyEnrollment(env) ? (env.alias || env.subject) : env.subject);
      subjectColsSet.add(subKey);
      const enrolled = getStudentsForEnrollment(env);
      enrolled.forEach(st => {
        teacherAllowedStudentRegs.add(st.regNo);
        (st.classes || [st.class]).filter(Boolean).forEach(c => teacherAllowedClassesSet.add(c));
      });
    });
    // Also include students in Class Teacher's designated class
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
    (tObj?.enrollments || []).filter(e => !isHifzEnrollment(e)).forEach(env => {
      subjectColsSet.add(normalizeSubKey(isAttendanceOnlyEnrollment(env) ? (env.alias || env.subject) : env.subject));
    });
  }

  const allDaysInSelectedMonth = React.useMemo(() => {
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

  const availableClassesForDropdown = userRole === 'admin'
    ? DEFAULT_CLASSES
    : Array.from(teacherAllowedClassesSet);

  const filteredReportStudents = localStudents.filter(st => {
    if (userRole !== 'admin' && !teacherAllowedStudentRegs.has(st.regNo)) return false;
    const stClasses = Array.isArray(st.classes) ? st.classes : [st.class];
    if (repClass !== 'ALL' && !stClasses.includes(repClass)) return false;
    if (repSearch.trim()) {
      const q = repSearch.trim().toLowerCase();
      if (!String(st.firstName || '').toLowerCase().includes(q) && !String(st.adNo || '').toLowerCase().includes(q)) return false;
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

  let subjectColumns = Array.from(subjectColsSet);
  if (repSubject !== 'ALL') {
    subjectColumns = subjectColumns.filter(s => s === repSubject);
  }

  // 🌟 COMPUTE FORENOON (PERIODS 1-6) & AFTERNOON (PERIODS 7-9) 2-SESSION DAILY TOTALS FOR MONTH
  const computeFnAnMonthlyRows = () => {
    return filteredReportStudents.map(st => {
      const reg = st.regNo;
      const ad = String(st.adNo || '').trim().toUpperCase();
      const dateMap = {};

      fnAnMonthSessions.forEach(sess => {
        const attMap = sess.attendanceMap || {};
        const status = attMap[reg] || attMap[st.id] || attMap[ad];
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

      Object.keys(dateMap).sort().forEach(dStr => {
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
            absentDatesDetails.push(`${dStr} (${!isFnPresent && !isAnPresent ? 'Full Day' : isFnPresent ? 'AN Absent' : 'FN Absent'})`);
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

      const leaveReasonsList = studentMonthPasses.map(p =>
        `${p.leaveCategory || 'Leave'}: ${p.destination || 'Out'}${p.purpose ? ` (${p.purpose})` : ''}`
      );

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
        'TOTAL PERIODS': totP,
        'PRESENT PERIODS': presP,
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

  return (
    <div style={{ background: '#ffffff', padding: '24px', borderRadius: '14px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', borderBottom: '1px solid #f1f5f9', paddingBottom: '14px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: '#0f172a' }}>
            {repScope === 'fn_an_monthly' ? `FN / AN Monthly Day Summary (${repMonth})` : repScope === 'monthly' ? `Monthly Subject Report (${repMonth})` : repScope === 'daily' ? `Daily Period Attendance Report (${repDate})` : 'Total Semester Attendance Report'}
          </h2>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>
            {repScope === 'fn_an_monthly' ? 'Forenoon (Periods 1–6) & Afternoon (Periods 7–9) working day summary with 5-day absence tracking & 100% full-attendance recognition.' : 'Complete period attendance matrix with live minus calculations and per-subject breakdown.'}
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setShowReportFilters(prev => !prev)}
            style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', background: showReportFilters ? '#4f46e5' : '#ffffff', color: showReportFilters ? '#ffffff' : '#334155', fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}
          >
            🎛️ {showReportFilters ? 'Hide Filters' : 'Filter Options'}
          </button>
          <button
            type="button"
            onClick={handleExportReportMatrixExcel}
            style={styles.buttonPrimary}
          >
            ⬇️ Export Excel
          </button>
        </div>
      </div>

      {/* SCOPE SELECTOR TABS */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', background: '#f8fafc', padding: '12px 16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {[
            { id: 'total', label: '📈 Total Semester' },
            { id: 'fn_an_monthly', label: '🌤️ FN / AN Monthly Days (≥5d Absent & 100% Present)' },
            { id: 'monthly', label: '🗓️ Subject Monthly' },
            { id: 'daily', label: '📅 Specific Date (9 Periods & Edit)' }
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

        {(repScope === 'monthly' || repScope === 'fn_an_monthly') && (
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
            <input
              type="month"
              value={repMonth}
              onChange={e => setRepMonth(e.target.value)}
              style={{ ...styles.input, width: 'auto', padding: '7px 12px', fontSize: '12px', fontWeight: '700' }}
            />
          </div>
        )}

        {repScope === 'daily' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <input
              type="date"
              value={repDate}
              onChange={e => setRepDate(e.target.value)}
              style={{ ...styles.input, width: 'auto', padding: '7px 12px', fontSize: '12px', fontWeight: '700' }}
            />
          </div>
        )}

        {(repScope === 'total' || repScope === 'monthly') && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <select
              value={repMinusMode}
              onChange={e => setRepMinusMode(e.target.value)}
              style={{ ...styles.input, width: 'auto', padding: '7px 12px', fontSize: '12px', fontWeight: '700' }}
            >
              <option value="both">Show Both (Gross % &amp; Net %)</option>
              <option value="with_minus">Minus Affected Only (Net %)</option>
              <option value="without_minus">Without Minus Only (Gross %)</option>
            </select>
          </div>
        )}
      </div>

      {/* ADVANCED FILTERS PANEL */}
      {showReportFilters && (
        <div className="erp-slide-panel" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))', gap: '14px', alignItems: 'end', background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
          <div>
            <label style={styles.label}>Select Class</label>
            <select value={repClass} onChange={e => setRepClass(e.target.value)} style={styles.input}>
              <option value="ALL">{userRole === 'admin' ? 'All Classes' : `All My Classes (${availableClassesForDropdown.length})`}</option>
              {availableClassesForDropdown.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {(repScope === 'monthly' || repScope === 'fn_an_monthly') && (
            <div>
              <label style={styles.label}>Select Month</label>
              <input type="month" value={repMonth} onChange={e => setRepMonth(e.target.value)} style={styles.input} />
            </div>
          )}

          {repScope === 'daily' && (
            <div>
              <label style={styles.label}>Select Specific Date</label>
              <input type="date" value={repDate} onChange={e => setRepDate(e.target.value)} style={styles.input} />
            </div>
          )}

          {userRole === 'admin' && repScope !== 'fn_an_monthly' && (
            <div>
              <label style={styles.label}>Filter by Teacher</label>
              <select value={repTeacher} onChange={e => { setRepTeacher(e.target.value); setRepSubject('ALL'); }} style={styles.input}>
                <option value="ALL">All Teachers</option>
                {localTeachers.filter(t => !t.isEventLeader).map(t => (
                  <option key={t.username} value={t.username}>{t.fullName}</option>
                ))}
              </select>
            </div>
          )}

          {repScope !== 'fn_an_monthly' && (
            <div>
              <label style={styles.label}>{userRole === 'admin' ? 'Filter by Subject' : 'My Subjects'}</label>
              <select value={repSubject} onChange={e => setRepSubject(e.target.value)} style={styles.input}>
                <option value="ALL">{userRole === 'admin' ? `All Subjects (${subjectColsSet.size})` : `All My Subjects (${subjectColsSet.size})`}</option>
                {Array.from(subjectColsSet).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}

          <div>
            <label style={styles.label}>Search Student</label>
            <input type="text" value={repSearch} onChange={e => setRepSearch(e.target.value)} placeholder="Name or Ad.No..." style={styles.input} />
          </div>
        </div>
      )}

      {/* 🌟 VIEW A-1: FORENOON (P1-P6) + AFTERNOON (P7-P9) 2-SESSION MONTHLY DAY REPORT */}
      {repScope === 'fn_an_monthly' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
            <div
              onClick={() => setFnAnFilterMode('ALL')}
              style={{ padding: '16px', borderRadius: '12px', background: '#f8fafc', border: fnAnFilterMode === 'ALL' ? '2px solid #4f46e5' : '1px solid #e2e8f0', textAlign: 'center', cursor: 'pointer' }}
            >
              <span style={{ fontSize: '11px', fontWeight: '800', color: '#475569' }}>TOTAL CLASS STUDENTS</span>
              <div style={{ fontSize: '26px', fontWeight: '900', color: '#0f172a', marginTop: '4px' }}>{fnAnRows.length}</div>
              <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>Click to show all</div>
            </div>

            <div
              onClick={() => setFnAnFilterMode('PRESENT_ALL_DAYS')}
              style={{ padding: '16px', borderRadius: '12px', background: '#ecfdf5', border: fnAnFilterMode === 'PRESENT_ALL_DAYS' ? '2px solid #059669' : '1px solid #a7f3d0', textAlign: 'center', cursor: 'pointer' }}
            >
              <span style={{ fontSize: '11px', fontWeight: '800', color: '#047857' }}>🏆 100% PRESENT (ALL WORKING DAYS)</span>
              <div style={{ fontSize: '26px', fontWeight: '900', color: '#065f46', marginTop: '4px' }}>{presentAllDaysCount}</div>
              <div style={{ fontSize: '11px', color: '#047857', marginTop: '2px' }}>Zero FN or AN absences in {repMonth}</div>
            </div>

            <div
              onClick={() => setFnAnFilterMode('ABSENT_GT_5')}
              style={{ padding: '16px', borderRadius: '12px', background: '#fff1f2', border: fnAnFilterMode === 'ABSENT_GT_5' ? '2px solid #e11d48' : '1px solid #fecdd3', textAlign: 'center', cursor: 'pointer' }}
            >
              <span style={{ fontSize: '11px', fontWeight: '800', color: '#be123c' }}>🚨 ABSENT &ge; 5 DAYS IN MONTH</span>
              <div style={{ fontSize: '26px', fontWeight: '900', color: '#e11d48', marginTop: '4px' }}>{absentGt5DaysCount}</div>
              <div style={{ fontSize: '11px', color: '#be123c', marginTop: '2px' }}>Click to filter &amp; view reasons</div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {[
                { id: 'ALL', label: `All Students (${fnAnRows.length})` },
                { id: 'PRESENT_ALL_DAYS', label: `🏆 100% Present All Working Days (${presentAllDaysCount})` },
                { id: 'ABSENT_GT_5', label: `🚨 Absent ≥ 5 Days (${absentGt5DaysCount})` }
              ].map(fBtn => (
                <button
                  key={fBtn.id}
                  type="button"
                  onClick={() => setFnAnFilterMode(fBtn.id)}
                  style={{
                    padding: '7px 14px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: '700',
                    cursor: 'pointer',
                    border: fnAnFilterMode === fBtn.id ? '1px solid #4f46e5' : '1px solid #cbd5e1',
                    background: fnAnFilterMode === fBtn.id ? '#4f46e5' : '#ffffff',
                    color: fnAnFilterMode === fBtn.id ? '#ffffff' : '#334155'
                  }}
                >
                  {fBtn.label}
                </button>
              ))}
            </div>

            <input
              type="text"
              value={repSearch}
              onChange={e => setRepSearch(e.target.value)}
              placeholder="🔍 Search student..."
              style={{ ...styles.input, maxWidth: '240px', padding: '7px 12px', fontSize: '12px' }}
            />
          </div>

          {loadingFnAn ? (
            <div style={{ padding: '28px', textAlign: 'center', color: '#64748b', fontWeight: '700' }}>
              Calculating Forenoon (P1–P6) &amp; Afternoon (P7–P9) daily sessions for {repMonth}...
            </div>
          ) : (
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
                  {displayedFnAnRows.length === 0 ? (
                    <tr>
                      <td colSpan="10" style={{ padding: '28px', textAlign: 'center', color: '#64748b', fontWeight: '600' }}>
                        No students match the selected filter for {repMonth}.
                      </td>
                    </tr>
                  ) : (
                    displayedFnAnRows.map((r, idx) => (
                      <tr key={r.student.regNo} style={{ borderBottom: '1px solid #f1f5f9', background: r.isAbsentMoreThan5Days ? '#fff1f2' : '#ffffff' }}>
                        <td style={{ padding: '12px 14px', color: '#64748b' }}>{idx + 1}</td>
                        <td style={{ padding: '12px 14px', fontWeight: '700', color: '#0f172a' }}>
                          {r.student.firstName} <span style={{ color: '#4f46e5' }}>(#{r.student.adNo})</span>
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
                              📅 {r.absentDatesDetails.slice(0, 6).join(', ')}{r.absentDatesDetails.length > 6 ? '...' : ''}
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
                            onClick={() => openDirectWhatsApp(
                              r.student.parentWhatsapp || r.student.parentMobile,
                              `Assalamu Alaikum, monthly attendance update for ${r.student.firstName} (#${r.student.adNo}) for ${repMonth}: Present ${r.totalDaysPresent} days, Absent ${r.totalDaysAbsent} days out of ${r.workingDaysHeld} working days.`
                            )}
                            style={{ padding: '5px 10px', background: '#f8fafc', color: '#334155', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '11px', fontWeight: '700', cursor: 'pointer' }}
                          >
                            💬 Parent WA
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        /* VIEW A-2: STANDARD PERIOD & SUBJECT MATRIX */
        <>
          {repScope === 'daily' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ fontWeight: '800', fontSize: '14px', color: '#0f172a' }}>
                📅 Recorded Period Sessions on {repDate} ({dailySessionsCache.length} Sessions Found)
              </div>
              {loadingReport ? (
                <div style={{ padding: '24px', textAlign: 'center', color: '#64748b', fontWeight: '700' }}>Loading sessions for {repDate}...</div>
              ) : dailySessionsCache.length === 0 ? (
                <div style={{ padding: '24px', background: '#f8fafc', borderRadius: '12px', textAlign: 'center', color: '#64748b', fontWeight: '600' }}>
                  No period sessions recorded for {repDate} yet.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: '12px' }}>
                  {dailySessionsCache
                    .filter(s => userRole === 'admin' || s.teacherUsername === loggedInUser?.username || myCtClasses.some(c => String(s.classAlias || '').includes(c)))
                    .map(sess => {
                      const mapVals = Object.values(sess.attendanceMap || {});
                      const presC = mapVals.filter(v => v === 'P' || v === 'O').length;
                      const absC = mapVals.length - presC;
                      return (
                        <div key={sess.id} style={{ padding: '14px 16px', borderRadius: '12px', border: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                          <div>
                            <span style={{ background: '#4f46e5', color: '#ffffff', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: '800' }}>
                              Period {sess.session}
                            </span>
                            <div style={{ fontWeight: '800', fontSize: '14px', color: '#0f172a', marginTop: '4px' }}>
                              {sess.classAlias || sess.subject}
                            </div>
                            <div style={{ fontSize: '12px', color: '#475569', fontWeight: '600' }}>
                              👨‍🏫 {sess.teacherName} • Pres: {presC} / Abs: {absC}
                            </div>
                          </div>
                          {(userRole === 'admin' || sess.teacherUsername === loggedInUser?.username) && (
                            <button
                              type="button"
                              onClick={() => {
                                if (userRole === 'admin' && sess.teacherUsername) {
                                  setSelectedTeacherUsername(sess.teacherUsername);
                                }
                                const tObj = localTeachers.find(t => t.username === sess.teacherUsername) || activeTeacherObj;
                                const matchEnv = (tObj?.enrollments || []).find(
                                  e => (e.alias || e.subject) === sess.classAlias || normalizeSubKey(e.subject) === sess.subject
                                );
                                if (matchEnv) setAttEnrollmentId(matchEnv.id);
                                setAttDate(repDate);
                                setAttSession(String(sess.session));
                                setActiveTab('mark_sheet');
                              }}
                              style={styles.buttonSecondary}
                            >
                              ✏️ Edit
                            </button>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          )}

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
                      <td style={{ padding: '13px 12px', fontWeight: '700', color: '#0f172a' }}>{st.firstName}</td>
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
        </>
      )}
    </div>
  );
}
