'use client';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { db } from '../../lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { DEFAULT_CLASSES, styles } from './erpConstants';
import { doesClassMatchAlias, resolveClassTeacherForStudent, openDirectWhatsApp } from './ErpExtensions';

// 🌟 Institution 9-Period Bell Schedule
export const BELL_SCHEDULE = [
  { period: 1, label: 'Period 1', start: '07:45', end: '08:30', slot: 'P1' },
  { period: 2, label: 'Period 2', start: '08:30', end: '09:15', slot: 'P2' },
  { period: 3, label: 'Period 3', start: '09:40', end: '10:25', slot: 'P3' },
  { period: 4, label: 'Period 4', start: '10:25', end: '11:10', slot: 'P4' },
  { period: 5, label: 'Period 5', start: '11:20', end: '12:05', slot: 'P5' },
  { period: 6, label: 'Period 6', start: '12:05', end: '12:50', slot: 'P6' },
  { period: 7, label: 'Period 7', start: '14:00', end: '14:40', slot: 'P7' },
  { period: 8, label: 'Period 8', start: '14:40', end: '15:20', slot: 'P8' },
  { period: 9, label: 'Period 9', start: '15:30', end: '16:15', slot: 'P9' },
];

export const PERIOD_STATUS_CONFIG = {
  COMPLETED: {
    label: 'Completed',
    bg: '#ecfdf5',
    color: '#047857',
    border: '#a7f3d0',
    dot: '#10b981',
    icon: '🟢'
  },
  PARTIAL: {
    label: 'Partial Split',
    bg: '#fffbeb',
    color: '#b45309',
    border: '#fde68a',
    dot: '#f59e0b',
    icon: '🟠'
  },
  IN_PROGRESS: {
    label: 'In Progress',
    bg: '#eff6ff',
    color: '#1d4ed8',
    border: '#bfdbfe',
    dot: '#3b82f6',
    icon: '🟡'
  },
  OVERDUE: {
    label: 'Untaken / Overdue',
    bg: '#fff1f2',
    color: '#e11d48',
    border: '#fecdd3',
    dot: '#f43f5e',
    icon: '🔴'
  },
  SCHEDULED: {
    label: 'Scheduled',
    bg: '#f8fafc',
    color: '#64748b',
    border: '#e2e8f0',
    dot: '#94a3b8',
    icon: '⚪'
  },
  EMPTY: {
    label: 'No Roster',
    bg: '#f1f5f9',
    color: '#94a3b8',
    border: '#cbd5e1',
    dot: '#cbd5e1',
    icon: '⚪'
  }
};

/**
 * Evaluates live status for a period based on current time and submission counts.
 */
export function evaluatePeriodStatus(now, scheduleSlot, takenCount, totalEnrolled, isSelectedDateToday, graceMinutes = 15) {
  if (totalEnrolled === 0) return 'EMPTY';
  if (takenCount >= totalEnrolled && totalEnrolled > 0) return 'COMPLETED';
  if (takenCount > 0 && takenCount < totalEnrolled) return 'PARTIAL';

  // If viewing a previous date and nothing taken, it's overdue / untaken
  if (!isSelectedDateToday) {
    return 'OVERDUE';
  }

  const [sH, sM] = scheduleSlot.start.split(':').map(Number);
  const [eH, eM] = scheduleSlot.end.split(':').map(Number);
  const startMs = new Date(now).setHours(sH, sM, 0, 0);
  const graceMs = startMs + graceMinutes * 60 * 1000;
  const nowMs = now.getTime();

  if (nowMs < startMs) return 'SCHEDULED';
  if (nowMs >= startMs && nowMs <= graceMs) return 'IN_PROGRESS';
  return 'OVERDUE';
}

export default function ClassPeriodMonitorTab({
  loggedInUser,
  userRole = 'teacher',
  localStudents = [],
  localTeachers = [],
  activeOutpassesByReg = {},
  recordedAbsencesByReg = {},
  todayRecordedSessions = [],
  attDate = '',
  myCtClasses = []
}) {
  const [selectedDate, setSelectedDate] = useState(() => attDate || new Date().toISOString().split('T')[0]);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [daySessions, setDaySessions] = useState(todayRecordedSessions);
  const [fullSessionsByDocId, setFullSessionsByDocId] = useState({});
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL'); // 'ALL' | 'UNEXCUSED' | 'OVERDUE' | 'PARTIAL' | 'COMPLETED'
  const [expandedClasses, setExpandedClasses] = useState({});
  const [activePeriodTab, setActivePeriodTab] = useState({}); // { [classId]: periodNum }
  const [toastMsg, setToastMsg] = useState(null);

  // 🌟 Real-time 30-second interval clock
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  const isToday = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    return selectedDate === todayStr;
  }, [selectedDate]);

  // 🌟 Load daySessionsIndex for selectedDate
  useEffect(() => {
    let isMounted = true;
    async function loadSessionsForDate() {
      if (!selectedDate) return;
      setLoadingSessions(true);
      try {
        const snap = await getDoc(doc(db, 'systemCache', `daySessionsIndex_${selectedDate}`));
        if (snap.exists() && isMounted) {
          const list = snap.data().sessions || [];
          setDaySessions(list);
        } else if (isMounted) {
          setDaySessions([]);
        }
      } catch (err) {
        console.error('Error fetching day sessions index:', err);
        if (isMounted) setDaySessions([]);
      } finally {
        if (isMounted) setLoadingSessions(false);
      }
    }

    if (isToday && todayRecordedSessions.length > 0) {
      setDaySessions(todayRecordedSessions);
    } else {
      loadSessionsForDate();
    }

    return () => { isMounted = false; };
  }, [selectedDate, isToday, todayRecordedSessions]);

  // 🌟 Fetch full session documents to retrieve attendanceMap if missing from index
  useEffect(() => {
    let isMounted = true;
    async function fetchFullSessionDetails() {
      if (!daySessions || daySessions.length === 0) return;

      const missingDocIds = daySessions
        .filter(s => s && s.sessionDocId && !s.attendanceMap && !fullSessionsByDocId[s.sessionDocId])
        .map(s => s.sessionDocId);

      if (missingDocIds.length === 0) return;

      try {
        const fetched = {};
        await Promise.all(
          missingDocIds.map(async (docId) => {
            try {
              const snap = await getDoc(doc(db, 'systemCache', docId));
              if (snap.exists()) {
                fetched[docId] = snap.data();
              }
            } catch (e) {
              console.warn('Session doc fetch err:', docId, e);
            }
          })
        );
        if (isMounted && Object.keys(fetched).length > 0) {
          setFullSessionsByDocId(prev => ({ ...prev, ...fetched }));
        }
      } catch (e) {
        console.error('Error fetching missing session details:', e);
      }
    }

    fetchFullSessionDetails();
    return () => { isMounted = false; };
  }, [daySessions, fullSessionsByDocId]);

  // 🌟 Role check: Admin / Office Secretary vs Class Teacher
  const isSuperAdminOrOfficeSec = useMemo(() => {
    if (userRole === 'admin') return true;
    const cat = String(loggedInUser?.roleCategory || '').toLowerCase();
    const role = String(loggedInUser?.role || '').toLowerCase();
    const user = String(loggedInUser?.username || '').toLowerCase();
    return cat.includes('office') || cat.includes('secretary') || role.includes('office') || user === 'admin';
  }, [userRole, loggedInUser]);

  // 🌟 Filter visible classes based on permissions
  const availableClasses = useMemo(() => {
    const classSet = new Set(DEFAULT_CLASSES);
    (localStudents || []).forEach(st => {
      const cls = String(st.class || '').trim().toUpperCase();
      if (cls) classSet.add(cls);
      (st.classes || []).forEach(c => {
        const uc = String(c || '').trim().toUpperCase();
        if (uc) classSet.add(uc);
      });
    });

    const allList = Array.from(classSet).sort((a, b) => {
      const idxA = DEFAULT_CLASSES.indexOf(a);
      const idxB = DEFAULT_CLASSES.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });

    if (isSuperAdminOrOfficeSec) {
      return allList;
    }

    // Scoped strictly to Class Teacher assigned classes
    return allList.filter(c => (myCtClasses || []).includes(c));
  }, [isSuperAdminOrOfficeSec, localStudents, myCtClasses]);

  // Auto-expand if class teacher has only 1 class
  useEffect(() => {
    if (!isSuperAdminOrOfficeSec && availableClasses.length === 1) {
      const singleClass = availableClasses[0];
      setExpandedClasses(prev => ({ ...prev, [singleClass]: true }));
      // Default to current active period if today
      const currentPeriod = BELL_SCHEDULE.find(slot => {
        const [sH, sM] = slot.start.split(':').map(Number);
        const [eH, eM] = slot.end.split(':').map(Number);
        const start = new Date(currentTime).setHours(sH, sM, 0, 0);
        const end = new Date(currentTime).setHours(eH, eM, 0, 0);
        const now = currentTime.getTime();
        return now >= start && now <= end;
      });
      if (currentPeriod) {
        setActivePeriodTab(prev => ({ ...prev, [singleClass]: currentPeriod.period }));
      }
    }
  }, [isSuperAdminOrOfficeSec, availableClasses, currentTime]);

  // 🌟 Consolidated Reconciliation Engine
  const classPeriodReport = useMemo(() => {
    const report = {};

    availableClasses.forEach(cls => {
      // 1. All students enrolled in this class
      const classStudents = (localStudents || []).filter(s => {
        const c = String(s.class || '').trim().toUpperCase();
        const cList = (s.classes || []).map(x => String(x).trim().toUpperCase());
        return c === cls.toUpperCase() || cList.includes(cls.toUpperCase());
      }).sort((a, b) => (Number(a.rollNo) || 999) - (Number(b.rollNo) || 999));

      const totalEnrolled = classStudents.length;
      const classTeacherObj = classStudents.length > 0 ? resolveClassTeacherForStudent(classStudents[0], localTeachers) : null;

      // 2. Periods 1 to 9 breakdown
      const periods = {};
      let totalCompletedPeriods = 0;
      let totalUnexcusedAbsentCount = 0;

      BELL_SCHEDULE.forEach(slot => {
        const pNum = slot.period;

        // Find sessions for this period & class
        const matchedSessions = daySessions.filter(s => {
          if (Number(s.session) !== pNum) return false;
          const target = String(s.targetClass || '').toUpperCase();
          const alias = String(s.classAlias || '').toUpperCase();
          const clsUp = cls.toUpperCase();
          return target === clsUp || alias.includes(clsUp) || doesClassMatchAlias(clsUp, alias);
        });

        // Consolidate attendance maps from matched sessions
        const studentStatusMap = {};
        const recordedTeachers = [];

        matchedSessions.forEach(s => {
          const fullDoc = s.attendanceMap ? s : (fullSessionsByDocId[s.sessionDocId] || s);
          const attMap = fullDoc.attendanceMap || {};
          const teacherName = s.teacherName || fullDoc.teacherName || 'Subject Teacher';
          const subName = s.subject || fullDoc.subject || s.classAlias || 'General Subject';

          recordedTeachers.push({
            teacherName,
            subject: subName,
            count: Object.keys(attMap).length
          });

          Object.entries(attMap).forEach(([regKey, stat]) => {
            const cleanKey = String(regKey).trim().toUpperCase();
            studentStatusMap[cleanKey] = {
              status: stat,
              teacherName,
              subject: subName
            };
          });
        });

        // Partition class roster into Taken vs Untaken
        const takenStudents = [];
        const untakenStudents = [];
        const unexcusedAbsentees = [];
        const excusedAbsentees = [];
        const presentStudents = [];

        classStudents.forEach(st => {
          const regClean = String(st.regNo || '').trim().toUpperCase();
          const adClean = String(st.adNo || '').trim().toUpperCase();
          const idClean = String(st.id || '').trim().toUpperCase();

          const rec = studentStatusMap[regClean] || studentStatusMap[adClean] || studentStatusMap[idClean];

          if (rec) {
            // Check outpass & recorded leave statuses
            const op = activeOutpassesByReg[regClean] || activeOutpassesByReg[adClean] || (st.regNo && activeOutpassesByReg[st.regNo]);
            const recAbs = recordedAbsencesByReg[regClean] || recordedAbsencesByReg[adClean] || (st.regNo && recordedAbsencesByReg[st.regNo]);

            const isOutpassOutside = Boolean(op && (op.isCurrentlyOutside !== false));
            const isMedicalLeave = Boolean(recAbs && recAbs.isMedical);
            const isOfficialDuty = Boolean(recAbs && recAbs.isOfficial) || rec.status === 'O';
            const isMarkedPresent = rec.status === 'P' || isOfficialDuty;

            let finalStatusLabel = 'Present';
            let finalStatusCode = 'P';
            let leaveReason = '';
            let isUnexcused = false;

            if (isMarkedPresent) {
              finalStatusCode = isOfficialDuty ? 'O' : 'P';
              finalStatusLabel = isOfficialDuty ? 'Official Duty' : 'Present';
              presentStudents.push({ student: st, status: finalStatusCode, label: finalStatusLabel, sessionInfo: rec });
            } else if (isOutpassOutside) {
              finalStatusCode = 'M';
              finalStatusLabel = 'Gate Outpass';
              leaveReason = `Approved Outpass (${op.reason || 'General Permitted Outpass'})`;
              excusedAbsentees.push({ student: st, status: finalStatusCode, label: finalStatusLabel, reason: leaveReason, sessionInfo: rec });
            } else if (isMedicalLeave) {
              finalStatusCode = 'M';
              finalStatusLabel = 'Medical Leave';
              leaveReason = recAbs.reason || 'Sick Room / Medical Excusal';
              excusedAbsentees.push({ student: st, status: finalStatusCode, label: finalStatusLabel, reason: leaveReason, sessionInfo: rec });
            } else if (rec.status === 'M') {
              finalStatusCode = 'M';
              finalStatusLabel = 'Excused Leave';
              leaveReason = 'Permitted Leave / Excused';
              excusedAbsentees.push({ student: st, status: finalStatusCode, label: finalStatusLabel, reason: leaveReason, sessionInfo: rec });
            } else {
              // Unexcused Absent!
              finalStatusCode = 'A';
              finalStatusLabel = 'Unexcused Absent';
              isUnexcused = true;
              unexcusedAbsentees.push({ student: st, status: finalStatusCode, label: finalStatusLabel, sessionInfo: rec });
            }

            takenStudents.push({
              student: st,
              status: finalStatusCode,
              label: finalStatusLabel,
              leaveReason,
              isUnexcused,
              sessionInfo: rec
            });
          } else {
            untakenStudents.push(st);
          }
        });

        const takenCount = takenStudents.length;
        const untakenCount = untakenStudents.length;
        const presentCount = presentStudents.length;
        const unexcusedCount = unexcusedAbsentees.length;
        const excusedCount = excusedAbsentees.length;
        const totalAbsentCount = unexcusedCount + excusedCount;

        totalUnexcusedAbsentCount += unexcusedCount;

        const periodStatus = evaluatePeriodStatus(
          currentTime,
          slot,
          takenCount,
          totalEnrolled,
          isToday
        );

        if (periodStatus === 'COMPLETED') {
          totalCompletedPeriods++;
        }

        periods[pNum] = {
          slot,
          status: periodStatus,
          statusConfig: PERIOD_STATUS_CONFIG[periodStatus] || PERIOD_STATUS_CONFIG.SCHEDULED,
          totalEnrolled,
          takenCount,
          untakenCount,
          presentCount,
          unexcusedCount,
          excusedCount,
          totalAbsentCount,
          recordedTeachers,
          takenStudents,
          untakenStudents,
          unexcusedAbsentees,
          excusedAbsentees,
          presentStudents
        };
      });

      report[cls] = {
        className: cls,
        classTeacher: classTeacherObj,
        totalEnrolled,
        classStudents,
        periods,
        totalCompletedPeriods,
        totalUnexcusedAbsentCount
      };
    });

    return report;
  }, [availableClasses, localStudents, localTeachers, daySessions, fullSessionsByDocId, activeOutpassesByReg, recordedAbsencesByReg, currentTime, isToday]);

  // 🌟 Filtered Classes by Search Query & Status Filter
  const filteredClasses = useMemo(() => {
    return availableClasses.filter(cls => {
      const data = classPeriodReport[cls];
      if (!data) return false;

      // Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesClass = cls.toLowerCase().includes(q);
        const matchesCT = String(data.classTeacher?.fullName || '').toLowerCase().includes(q);
        const matchesStudent = data.classStudents.some(s =>
          String(s.firstName || '').toLowerCase().includes(q) ||
          String(s.adNo || '').toLowerCase().includes(q) ||
          String(s.regNo || '').toLowerCase().includes(q)
        );
        if (!matchesClass && !matchesCT && !matchesStudent) return false;
      }

      // Status Filter
      if (statusFilter === 'UNEXCUSED') {
        return data.totalUnexcusedAbsentCount > 0;
      }
      if (statusFilter === 'OVERDUE') {
        return Object.values(data.periods).some(p => p.status === 'OVERDUE');
      }
      if (statusFilter === 'PARTIAL') {
        return Object.values(data.periods).some(p => p.status === 'PARTIAL');
      }
      if (statusFilter === 'COMPLETED') {
        return data.totalCompletedPeriods === 9;
      }

      return true;
    });
  }, [availableClasses, classPeriodReport, searchQuery, statusFilter]);

  // 🌟 Toggle Class Accordion
  const toggleClassExpansion = useCallback((cls) => {
    setExpandedClasses(prev => {
      const nextState = !prev[cls];
      if (nextState && !activePeriodTab[cls]) {
        // Default to Period 1 or current period
        setActivePeriodTab(p => ({ ...p, [cls]: 1 }));
      }
      return { ...prev, [cls]: nextState };
    });
  }, [activePeriodTab]);

  // 🌟 Clipboard Copy: Strictly Unexcused Absent Students
  const handleCopyUnexcusedAbsentees = useCallback((cls, periodNum) => {
    const classData = classPeriodReport[cls];
    if (!classData) return;

    const periodData = classData.periods[periodNum];
    if (!periodData) return;

    const unexcusedList = periodData.unexcusedAbsentees || [];

    if (unexcusedList.length === 0) {
      setToastMsg({
        type: 'info',
        text: `Zero unexcused absentees for Class ${cls} (${periodData.slot.label}). Everyone accounted for!`
      });
      setTimeout(() => setToastMsg(null), 3500);
      return;
    }

    const ctName = classData.classTeacher?.fullName || 'Unassigned';
    const lines = [
      `📋 *UNEXCUSED ABSENTEES REPORT*`,
      `🏫 *Darul Huda Degree Institution*`,
      `📚 *Class:* ${cls}`,
      `⏰ *Period:* ${periodData.slot.label} (${periodData.slot.start} - ${periodData.slot.end}) • ${selectedDate}`,
      `👨‍🏫 *Class Teacher:* Usthad ${ctName}`,
      `📊 *Roster:* ${periodData.totalEnrolled} Enrolled • ${periodData.takenCount} Recorded • ${periodData.untakenCount} Untaken • ${periodData.presentCount} Present`,
      ``,
      `⚠️ *UNEXCUSED ABSENT STUDENTS (Action Required):*`
    ];

    unexcusedList.forEach((item, idx) => {
      const st = item.student;
      const roll = st.rollNo ? `#${st.rollNo}` : `#${idx + 1}`;
      const ad = st.adNo ? `(Ad.No: ${st.adNo})` : '';
      const dept = st.department ? `[${st.department}]` : '';
      lines.push(`${idx + 1}. *${roll}* - ${st.firstName || st.name} ${ad} ${dept}`.trim());
    });

    lines.push(``);
    lines.push(`_Total Unexcused Missing: ${unexcusedList.length}_`);
    lines.push(`_Generated via MarkPortal Period Attendance Monitor_`);

    const textToCopy = lines.join('\n');

    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(textToCopy).then(() => {
        setToastMsg({
          type: 'success',
          text: `📋 Copied ${unexcusedList.length} Unexcused Absentees for ${cls} (${periodData.slot.label}) to Clipboard!`
        });
        setTimeout(() => setToastMsg(null), 4000);
      }).catch(err => {
        fallbackCopyText(textToCopy, unexcusedList.length, cls, periodData.slot.label);
      });
    } else {
      fallbackCopyText(textToCopy, unexcusedList.length, cls, periodData.slot.label);
    }
  }, [classPeriodReport, selectedDate]);

  const fallbackCopyText = (text, count, cls, periodLabel) => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setToastMsg({
        type: 'success',
        text: `📋 Copied ${count} Unexcused Absentees for ${cls} (${periodLabel}) to Clipboard!`
      });
      setTimeout(() => setToastMsg(null), 4000);
    } catch (e) {
      alert(`Could not automatically copy. Please select and copy manually:\n\n${text}`);
    }
  };

  // If teacher has zero class teacher assignments and is not admin
  if (!isSuperAdminOrOfficeSec && availableClasses.length === 0) {
    return (
      <div style={{ padding: '36px 20px', textAlign: 'center', background: '#f8fafc', borderRadius: '16px', border: '1px dashed #cbd5e1', margin: '20px 0' }}>
        <div style={{ fontSize: '38px', marginBottom: '12px' }}>🔒</div>
        <h3 style={{ fontSize: '18px', fontWeight: '800', color: '#1e293b', marginBottom: '8px' }}>
          Class Teacher Authorization Required
        </h3>
        <p style={{ fontSize: '13px', color: '#64748b', maxWidth: '520px', margin: '0 auto 16px auto', lineHeight: '1.6' }}>
          You are currently logged in as a subject teacher without an active Class Teacher assignment.
          Live class-wide period monitoring is restricted to assigned Class Teachers for their respective cohorts or Central Administration.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', margin: '10px 0 30px 0' }}>
      {/* 🌟 Toast Notification Banner */}
      {toastMsg && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: 9999,
          padding: '14px 20px',
          borderRadius: '12px',
          background: toastMsg.type === 'success' ? '#065f46' : '#1e293b',
          color: '#ffffff',
          fontWeight: '700',
          fontSize: '13px',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          animation: 'fadeIn 0.2s ease-in-out'
        }}>
          <span>{toastMsg.text}</span>
          <button
            type="button"
            onClick={() => setToastMsg(null)}
            style={{ background: 'transparent', border: 'none', color: '#ffffff', cursor: 'pointer', fontSize: '14px' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* 🌟 Monitor Header Bar */}
      <div style={{
        padding: '18px 22px',
        background: '#ffffff',
        borderRadius: '16px',
        border: '1px solid #e2e8f0',
        boxShadow: '0 2px 8px -2px rgba(0, 0, 0, 0.05)',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '22px' }}>⏱️</span>
              <h2 style={{ fontSize: '20px', fontWeight: '800', color: '#0f172a', margin: 0 }}>
                Live Class &amp; Period Attendance Monitor
              </h2>
              {isToday && (
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '4px 10px',
                  borderRadius: '999px',
                  background: '#ecfdf5',
                  color: '#059669',
                  fontSize: '11px',
                  fontWeight: '800',
                  border: '1px solid #a7f3d0'
                }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
                  LIVE REAL-TIME
                </span>
              )}
            </div>
            <p style={{ fontSize: '12px', color: '#64748b', margin: '4px 0 0 0' }}>
              Tracking 9-period bell schedule (07:45 to 16:15) with split-stream roster reconciliation.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            {/* Live Clock Display */}
            <div style={{
              padding: '6px 14px',
              borderRadius: '10px',
              background: '#f1f5f9',
              border: '1px solid #cbd5e1',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '13px',
              fontWeight: '700',
              color: '#334155'
            }}>
              <span>🕒</span>
              <span>
                {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </div>

            {/* Date Picker */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <label htmlFor="monitor-date-picker" style={{ fontSize: '12px', fontWeight: '700', color: '#475569' }}>Date:</label>
              <input
                id="monitor-date-picker"
                type="date"
                value={selectedDate}
                onChange={e => setSelectedDate(e.target.value)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontWeight: '700',
                  fontSize: '13px',
                  color: '#1e293b',
                  background: '#ffffff'
                }}
              />
            </div>
          </div>
        </div>

        {/* 🌟 Search & Filter Controls */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', paddingTop: '10px', borderTop: '1px solid #f1f5f9' }}>
          <div style={{ display: 'flex', gap: '8px', flex: '1 1 300px', maxWidth: '450px' }}>
            <input
              type="text"
              placeholder="Search class, class teacher, or student..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 14px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                fontWeight: '600'
              }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '0 12px', cursor: 'pointer', fontWeight: '700' }}
              >
                ✕
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {[
              { id: 'ALL', label: `All Classes (${availableClasses.length})` },
              { id: 'UNEXCUSED', label: `⚠️ Unexcused Absentees` },
              { id: 'OVERDUE', label: `🔴 Overdue / Untaken` },
              { id: 'PARTIAL', label: `🟠 Partial Splits` },
              { id: 'COMPLETED', label: `🟢 100% Completed` }
            ].map(f => (
              <button
                key={f.id}
                type="button"
                onClick={() => setStatusFilter(f.id)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  border: statusFilter === f.id ? '1px solid #4f46e5' : '1px solid #e2e8f0',
                  background: statusFilter === f.id ? '#4f46e5' : '#ffffff',
                  color: statusFilter === f.id ? '#ffffff' : '#475569',
                  transition: 'all 0.15s ease'
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 🌟 Classes Grid */}
      {loadingSessions ? (
        <div style={{ padding: '40px', textAlign: 'center', color: '#64748b', fontWeight: '700' }}>
          ⏳ Loading live period attendance records...
        </div>
      ) : filteredClasses.length === 0 ? (
        <div style={{ padding: '36px', textAlign: 'center', background: '#ffffff', borderRadius: '14px', border: '1px dashed #cbd5e1', color: '#64748b', fontWeight: '600' }}>
          No classes match the selected filter or search criteria for {selectedDate}.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {filteredClasses.map(cls => {
            const classData = classPeriodReport[cls];
            if (!classData) return null;

            const isExpanded = Boolean(expandedClasses[cls]);
            const selectedPeriodNum = activePeriodTab[cls] || 1;
            const activePeriodData = classData.periods[selectedPeriodNum];
            const ctName = classData.classTeacher?.fullName || 'Unassigned';

            return (
              <div
                key={cls}
                style={{
                  background: '#ffffff',
                  borderRadius: '16px',
                  border: isExpanded ? '1px solid #818cf8' : '1px solid #e2e8f0',
                  boxShadow: isExpanded ? '0 8px 24px -4px rgba(79, 70, 229, 0.12)' : '0 2px 6px -1px rgba(0, 0, 0, 0.05)',
                  overflow: 'hidden',
                  transition: 'all 0.2s ease'
                }}
              >
                {/* 🌟 Class Card Header / Tile */}
                <div
                  onClick={() => toggleClassExpansion(cls)}
                  style={{
                    padding: '16px 20px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    background: isExpanded ? '#f5f3ff' : '#ffffff',
                    borderBottom: isExpanded ? '1px solid #e0e7ff' : 'none',
                    userSelect: 'none'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                    <div style={{
                      padding: '8px 14px',
                      borderRadius: '10px',
                      background: '#4f46e5',
                      color: '#ffffff',
                      fontWeight: '800',
                      fontSize: '16px',
                      letterSpacing: '0.5px'
                    }}>
                      {cls}
                    </div>

                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '14px', fontWeight: '800', color: '#1e293b' }}>
                          Class {cls}
                        </span>
                        <span style={{ fontSize: '12px', color: '#64748b', fontWeight: '600' }}>
                          • {classData.totalEnrolled} Students
                        </span>
                      </div>
                      <div style={{ fontSize: '11px', color: '#475569', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>Class Teacher:</span>
                        <span style={{ fontWeight: '700', color: classData.classTeacher ? '#1e293b' : '#94a3b8' }}>
                          {ctName}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 🌟 9-Period Mini Progress Meter */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                      {BELL_SCHEDULE.map(slot => {
                        const pInfo = classData.periods[slot.period];
                        const cfg = pInfo?.statusConfig || PERIOD_STATUS_CONFIG.SCHEDULED;
                        return (
                          <div
                            key={slot.period}
                            title={`${slot.label} (${slot.start} - ${slot.end}): ${cfg.label}`}
                            style={{
                              width: '24px',
                              height: '24px',
                              borderRadius: '6px',
                              background: cfg.bg,
                              border: `1px solid ${cfg.border}`,
                              color: cfg.color,
                              fontSize: '10px',
                              fontWeight: '800',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'pointer'
                            }}
                          >
                            P{slot.period}
                          </div>
                        );
                      })}
                    </div>

                    {/* Unexcused Absentee Alert Badge */}
                    {classData.totalUnexcusedAbsentCount > 0 && (
                      <span style={{
                        padding: '4px 10px',
                        borderRadius: '8px',
                        background: '#ffe4e6',
                        color: '#e11d48',
                        fontWeight: '800',
                        fontSize: '12px',
                        border: '1px solid #fecdd3'
                      }}>
                        ⚠️ {classData.totalUnexcusedAbsentCount} Unexcused
                      </span>
                    )}

                    <div style={{ fontSize: '16px', color: '#64748b', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }}>
                      ▼
                    </div>
                  </div>
                </div>

                {/* 🌟 Expanded Class Period Accordion Content */}
                {isExpanded && (
                  <div style={{ padding: '20px', background: '#fafafa' }}>
                    {/* 🌟 9-Period Sub-Tab Switcher */}
                    <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '10px', marginBottom: '16px' }}>
                      {BELL_SCHEDULE.map(slot => {
                        const pInfo = classData.periods[slot.period];
                        const cfg = pInfo?.statusConfig || PERIOD_STATUS_CONFIG.SCHEDULED;
                        const isSelected = selectedPeriodNum === slot.period;

                        return (
                          <button
                            key={slot.period}
                            type="button"
                            onClick={() => setActivePeriodTab(prev => ({ ...prev, [cls]: slot.period }))}
                            style={{
                              flex: '1 0 auto',
                              padding: '8px 12px',
                              borderRadius: '10px',
                              border: isSelected ? '2px solid #4f46e5' : `1px solid ${cfg.border}`,
                              background: isSelected ? '#ffffff' : cfg.bg,
                              color: isSelected ? '#4f46e5' : cfg.color,
                              fontWeight: isSelected ? '800' : '700',
                              fontSize: '12px',
                              cursor: 'pointer',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              gap: '2px',
                              boxShadow: isSelected ? '0 2px 8px rgba(79, 70, 229, 0.15)' : 'none',
                              transition: 'all 0.15s ease'
                            }}
                          >
                            <span>{slot.label}</span>
                            <span style={{ fontSize: '10px', opacity: 0.85 }}>{slot.start}</span>
                            <span style={{ fontSize: '10px', fontWeight: '800', marginTop: '2px' }}>
                              {cfg.icon} {cfg.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {/* 🌟 Selected Period Detailed Card */}
                    {activePeriodData && (
                      <div style={{
                        background: '#ffffff',
                        borderRadius: '14px',
                        border: '1px solid #e2e8f0',
                        padding: '20px',
                        boxShadow: '0 1px 4px rgba(0,0,0,0.04)'
                      }}>
                        {/* Period Card Header */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <h3 style={{ fontSize: '17px', fontWeight: '800', color: '#0f172a', margin: 0 }}>
                                {activePeriodData.slot.label} ({activePeriodData.slot.start} - {activePeriodData.slot.end})
                              </h3>
                              <span style={{
                                padding: '4px 10px',
                                borderRadius: '8px',
                                background: activePeriodData.statusConfig.bg,
                                color: activePeriodData.statusConfig.color,
                                border: `1px solid ${activePeriodData.statusConfig.border}`,
                                fontSize: '12px',
                                fontWeight: '800'
                              }}>
                                {activePeriodData.statusConfig.icon} {activePeriodData.statusConfig.label}
                              </span>
                            </div>

                            {/* Recorded Teachers / Subjects in this Period */}
                            <div style={{ fontSize: '12px', color: '#475569', marginTop: '6px' }}>
                              {activePeriodData.recordedTeachers.length > 0 ? (
                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                                  <span style={{ fontWeight: '700' }}>Roll Call Recorded By:</span>
                                  {activePeriodData.recordedTeachers.map((t, idx) => (
                                    <span
                                      key={idx}
                                      style={{
                                        padding: '2px 8px',
                                        borderRadius: '6px',
                                        background: '#f1f5f9',
                                        border: '1px solid #cbd5e1',
                                        fontWeight: '700',
                                        fontSize: '11px',
                                        color: '#334155'
                                      }}
                                    >
                                      👨‍🏫 {t.teacherName} • {t.subject} ({t.count} students)
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span style={{ color: '#dc2626', fontWeight: '700' }}>
                                  ⚠️ No teacher has submitted roll call for this period yet.
                                </span>
                              )}
                            </div>
                          </div>

                          {/* 🌟 ACTION: One-Click Copy Unexcused Absentees */}
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <button
                              type="button"
                              onClick={() => handleCopyUnexcusedAbsentees(cls, selectedPeriodNum)}
                              disabled={activePeriodData.unexcusedCount === 0}
                              style={{
                                padding: '8px 16px',
                                borderRadius: '10px',
                                fontWeight: '800',
                                fontSize: '13px',
                                border: activePeriodData.unexcusedCount > 0 ? '1px solid #e11d48' : '1px solid #cbd5e1',
                                cursor: activePeriodData.unexcusedCount > 0 ? 'pointer' : 'not-allowed',
                                background: activePeriodData.unexcusedCount > 0 ? '#fff1f2' : '#f8fafc',
                                color: activePeriodData.unexcusedCount > 0 ? '#e11d48' : '#94a3b8',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                transition: 'all 0.15s ease'
                              }}
                            >
                              <span>📋</span>
                              <span>
                                Copy Unexcused Absentees ({activePeriodData.unexcusedCount})
                              </span>
                            </button>
                          </div>
                        </div>

                        {/* Roster Metrics Counters */}
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                          gap: '10px',
                          marginBottom: '20px'
                        }}>
                          <div style={{ padding: '10px 14px', borderRadius: '10px', background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                            <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '700' }}>TOTAL ROSTER</div>
                            <div style={{ fontSize: '18px', fontWeight: '800', color: '#1e293b' }}>{activePeriodData.totalEnrolled}</div>
                          </div>

                          <div style={{ padding: '10px 14px', borderRadius: '10px', background: '#ecfdf5', border: '1px solid #a7f3d0' }}>
                            <div style={{ fontSize: '11px', color: '#047857', fontWeight: '700' }}>TAKEN / RECORDED</div>
                            <div style={{ fontSize: '18px', fontWeight: '800', color: '#059669' }}>
                              {activePeriodData.takenCount}
                              <span style={{ fontSize: '12px', fontWeight: '600', marginLeft: '4px', opacity: 0.8 }}>
                                ({activePeriodData.totalEnrolled > 0 ? Math.round((activePeriodData.takenCount / activePeriodData.totalEnrolled) * 100) : 0}%)
                              </span>
                            </div>
                          </div>

                          <div style={{ padding: '10px 14px', borderRadius: '10px', background: activePeriodData.untakenCount > 0 ? '#fffbeb' : '#f8fafc', border: `1px solid ${activePeriodData.untakenCount > 0 ? '#fde68a' : '#e2e8f0'}` }}>
                            <div style={{ fontSize: '11px', color: activePeriodData.untakenCount > 0 ? '#b45309' : '#64748b', fontWeight: '700' }}>UNTAKEN / PENDING</div>
                            <div style={{ fontSize: '18px', fontWeight: '800', color: activePeriodData.untakenCount > 0 ? '#d97706' : '#64748b' }}>
                              {activePeriodData.untakenCount}
                            </div>
                          </div>

                          <div style={{ padding: '10px 14px', borderRadius: '10px', background: '#ecfdf5', border: '1px solid #a7f3d0' }}>
                            <div style={{ fontSize: '11px', color: '#047857', fontWeight: '700' }}>PRESENT</div>
                            <div style={{ fontSize: '18px', fontWeight: '800', color: '#059669' }}>{activePeriodData.presentCount}</div>
                          </div>

                          <div style={{ padding: '10px 14px', borderRadius: '10px', background: activePeriodData.unexcusedCount > 0 ? '#fff1f2' : '#f8fafc', border: `1px solid ${activePeriodData.unexcusedCount > 0 ? '#fecdd3' : '#e2e8f0'}` }}>
                            <div style={{ fontSize: '11px', color: activePeriodData.unexcusedCount > 0 ? '#e11d48' : '#64748b', fontWeight: '700' }}>UNEXCUSED ABSENT</div>
                            <div style={{ fontSize: '18px', fontWeight: '800', color: activePeriodData.unexcusedCount > 0 ? '#e11d48' : '#64748b' }}>
                              {activePeriodData.unexcusedCount}
                            </div>
                          </div>

                          <div style={{ padding: '10px 14px', borderRadius: '10px', background: activePeriodData.excusedCount > 0 ? '#eff6ff' : '#f8fafc', border: `1px solid ${activePeriodData.excusedCount > 0 ? '#bfdbfe' : '#e2e8f0'}` }}>
                            <div style={{ fontSize: '11px', color: activePeriodData.excusedCount > 0 ? '#1d4ed8' : '#64748b', fontWeight: '700' }}>EXCUSED / LEAVE</div>
                            <div style={{ fontSize: '18px', fontWeight: '800', color: activePeriodData.excusedCount > 0 ? '#2563eb' : '#64748b' }}>
                              {activePeriodData.excusedCount}
                            </div>
                          </div>
                        </div>

                        {/* 🌟 Detailed Breakdown Lists */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                          {/* 1. Unexcused Absentees Section */}
                          {activePeriodData.unexcusedCount > 0 ? (
                            <div style={{ padding: '14px', borderRadius: '12px', background: '#fff1f2', border: '1px solid #fecdd3' }}>
                              <div style={{ fontSize: '13px', fontWeight: '800', color: '#9f1239', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span>⚠️</span>
                                <span>Unexcused Absent Students (Action Required - Missing from Class):</span>
                              </div>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '8px' }}>
                                {activePeriodData.unexcusedAbsentees.map((item, idx) => {
                                  const st = item.student;
                                  return (
                                    <div
                                      key={st.id || idx}
                                      style={{
                                        padding: '8px 12px',
                                        borderRadius: '8px',
                                        background: '#ffffff',
                                        border: '1px solid #fda4af',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center'
                                      }}
                                    >
                                      <div>
                                        <div style={{ fontSize: '13px', fontWeight: '800', color: '#9f1239' }}>
                                          #{st.rollNo || idx + 1} • {st.firstName || st.name}
                                        </div>
                                        <div style={{ fontSize: '11px', color: '#64748b' }}>
                                          Ad.No: {st.adNo || 'N/A'} • {st.department || 'General'}
                                        </div>
                                      </div>
                                      <span style={{ fontSize: '11px', fontWeight: '800', color: '#e11d48', background: '#fee2e2', padding: '3px 8px', borderRadius: '6px' }}>
                                        Absent
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ) : (
                            <div style={{ padding: '12px 16px', borderRadius: '10px', background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#047857', fontSize: '13px', fontWeight: '700' }}>
                              ✅ No unexcused absentees for this period.
                            </div>
                          )}

                          {/* 2. Excused Leaves (Medical / Gate Outpass / Official) */}
                          {activePeriodData.excusedCount > 0 && (
                            <div style={{ padding: '14px', borderRadius: '12px', background: '#eff6ff', border: '1px solid #bfdbfe' }}>
                              <div style={{ fontSize: '13px', fontWeight: '800', color: '#1e40af', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span>🏥</span>
                                <span>Approved Excused Leaves / Outpasses:</span>
                              </div>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '8px' }}>
                                {activePeriodData.excusedAbsentees.map((item, idx) => {
                                  const st = item.student;
                                  return (
                                    <div
                                      key={st.id || idx}
                                      style={{
                                        padding: '8px 12px',
                                        borderRadius: '8px',
                                        background: '#ffffff',
                                        border: '1px solid #93c5fd',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center'
                                      }}
                                    >
                                      <div>
                                        <div style={{ fontSize: '13px', fontWeight: '800', color: '#1e40af' }}>
                                          #{st.rollNo || idx + 1} • {st.firstName || st.name}
                                        </div>
                                        <div style={{ fontSize: '11px', color: '#64748b' }}>
                                          {item.reason}
                                        </div>
                                      </div>
                                      <span style={{ fontSize: '10px', fontWeight: '800', color: '#2563eb', background: '#dbeafe', padding: '3px 8px', borderRadius: '6px' }}>
                                        {item.label}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* 3. Untaken Students Roster (Split Streams or Teacher Not Taken) */}
                          {activePeriodData.untakenCount > 0 && (
                            <div style={{ padding: '14px', borderRadius: '12px', background: '#fffbeb', border: '1px solid #fde68a' }}>
                              <div style={{ fontSize: '13px', fontWeight: '800', color: '#92400e', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span>⏳</span>
                                <span>Untaken / Pending Roster ({activePeriodData.untakenCount} Students):</span>
                              </div>
                              <p style={{ fontSize: '11px', color: '#78350f', margin: '0 0 10px 0' }}>
                                Attendance has not been submitted for these students yet. They are excluded from present and absent totals to prevent false data.
                              </p>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '6px' }}>
                                {activePeriodData.untakenStudents.map((st, idx) => (
                                  <div
                                    key={st.id || idx}
                                    style={{
                                      padding: '6px 10px',
                                      borderRadius: '6px',
                                      background: '#ffffff',
                                      border: '1px solid #fef3c7',
                                      fontSize: '12px',
                                      fontWeight: '600',
                                      color: '#78350f'
                                    }}
                                  >
                                    #{st.rollNo || idx + 1} • {st.firstName || st.name} (Ad: {st.adNo || 'N/A'})
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
