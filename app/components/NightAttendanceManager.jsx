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
  orderBy,
  limit
} from 'firebase/firestore';
import { DEFAULT_CLASSES, DEPARTMENTS, styles } from './erpConstants';
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

export default function NightAttendanceManager({
  loggedInTeacher = null,
  isAdmin = false,
  preloadedStudents = [],
  preloadedTeachers = []
}) {
  const [viewMode, setViewMode] = useState(isAdmin ? 'admin_summary' : 'take_attendance'); // 'take_attendance' | 'admin_summary' | 'regular_absentees'
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

  // Current Class Attendance State
  // statusMap: { [adNo]: 'PRESENT' | 'ABSENT' | 'OUTPASS' | 'SICK_ROOM' }
  const [statusMap, setStatusMap] = useState({});
  const [remarksMap, setRemarksMap] = useState({});
  const [expandedRemarkAdNo, setExpandedRemarkAdNo] = useState(null);
  const [showForwardDrawer, setShowForwardDrawer] = useState(false);

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');

  // Night Attendance Report Scope ('daily' | 'monthly' | 'total')
  const [nightRepScope, setNightRepScope] = useState('daily');
  const [nightRepMonth, setNightRepMonth] = useState(() => getTodayDateString().slice(0, 7)); // 'YYYY-MM'
  const [nightRepClass, setNightRepClass] = useState('ALL');

  useEffect(() => { setStudents(preloadedStudents); }, [preloadedStudents]);
  useEffect(() => { setTeachers(preloadedTeachers); }, [preloadedTeachers]);

  const recorderName = isAdmin
    ? 'Admin'
    : (loggedInTeacher?.fullName || loggedInTeacher?.username || 'Teacher');

  const canViewAdminAnalytics = Boolean(
    isAdmin ||
    loggedInTeacher?.outpassPrivileges?.isPrincipal ||
    loggedInTeacher?.outpassPrivileges?.isNiicsCoordinator ||
    loggedInTeacher?.outpassPrivileges?.isAcademicCoordinator ||
    loggedInTeacher?.outpassPrivileges?.isOfficeSecretary
  );

  // 1. Load Students, Teachers, Active Out-Passes, and WhatsApp Group Links
  useEffect(() => {
    async function initData() {
      try {
        const promises = [
          getDocs(query(collection(db, 'out_passes'), orderBy('createdAt', 'desc'), limit(300))),
          getDoc(doc(db, 'systemCache', 'whatsappGroups'))
        ];
        if (students.length === 0) promises.push(getDocs(collection(db, 'students')));
        if (teachers.length === 0) promises.push(getDocs(collection(db, 'teachers')));

        const results = await Promise.all(promises);
        const passSnap = results[0];
        const groupSnap = results[1];

        const pList = [];
        passSnap.forEach(d => pList.push({ id: d.id, ...d.data() }));
        setActivePasses(pList);

        if (groupSnap.exists() && groupSnap.data().staffGroupLink) {
          setStaffGroupLink(groupSnap.data().staffGroupLink);
        }

        if (students.length === 0 && results[2]) {
          const sList = [];
          results[2].forEach(d => sList.push({ id: d.id, ...d.data() }));
          sList.sort((a, b) => (Number(a.rollNo) || 999) - (Number(b.rollNo) || 999));
          setStudents(sList);
        }
        if (teachers.length === 0 && results[3]) {
          const tList = [];
          results[3].forEach(d => tList.push(d.data()));
          setTeachers(tList);
        }
      } catch (err) {
        console.error('Error initializing night attendance:', err);
      }
    }
    initData();
  }, []);

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

  // Matches student Ad.No AND verifies the Out-Pass is active on `selectedDate`
  const getActiveOutpassForStudent = (adNo) => {
    const cleanAd = String(adNo || '').trim().toLowerCase();
    if (!cleanAd) return null;

    const todayStr = getTodayDateString();

    return activePasses.find(p => {
      if (String(p.adNo || '').trim().toLowerCase() !== cleanAd) return false;
      const st = String(p.status || '').toUpperCase();
      if (st === 'CANCELLED') return false;

      const fromYMD = isoToLocalYMD(p.permittedFrom || p.createdAt);
      const toYMD = p.isOpenReturn || !p.permittedTo
        ? (p.actualReturnTime ? isoToLocalYMD(p.actualReturnTime) : '2099-12-31')
        : isoToLocalYMD(p.actualReturnTime || p.permittedTo);

      if (selectedDate === todayStr && (st === 'OUTSIDE' || st === 'APPROVED')) {
        return !fromYMD || selectedDate >= fromYMD;
      }

      if (fromYMD && selectedDate >= fromYMD && selectedDate <= toYMD) {
        return st === 'OUTSIDE' || st === 'APPROVED' || st === 'ARRIVED_AT_GATE' || st === 'RETURNED';
      }
      return false;
    });
  };

  // 2. Load Night Attendance Document for Selected Date (`night_attendance/{YYYY-MM-DD}`)
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
    if (selectedDate) {
      loadDateAttendance(selectedDate);
    }
  }, [selectedDate]);

  // 3. Populate Class Sheet (Auto-Detecting Out-Pass Students!)
  const classStudents = students.filter(s => (s.classes || []).includes(selectedClass));

  useEffect(() => {
    const savedClassRecord = (dailyDocData.classes || {})[selectedClass] || null;
    const newStatus = {};
    const newRemarks = {};

    classStudents.forEach(st => {
      const ad = String(st.adNo || '').trim();
      const activePass = getActiveOutpassForStudent(ad);

      if (savedClassRecord) {
        if ((savedClassRecord.absentAdNos || []).includes(ad)) {
          newStatus[ad] = 'ABSENT';
        } else if ((savedClassRecord.outpassAdNos || []).includes(ad) || activePass) {
          newStatus[ad] = 'OUTPASS';
        } else if ((savedClassRecord.sickAdNos || []).includes(ad)) {
          newStatus[ad] = 'SICK_ROOM';
        } else {
          newStatus[ad] = 'PRESENT';
        }
        if (savedClassRecord.remarks && savedClassRecord.remarks[ad]) {
          newRemarks[ad] = savedClassRecord.remarks[ad];
        } else if (activePass) {
          newRemarks[ad] = `${activePass.leaveCategory || 'Leave'}: ${activePass.destination} (${activePass.purpose}) — By ${activePass.teacherName}`;
        }
      } else {
        if (activePass) {
          newStatus[ad] = 'OUTPASS';
          newRemarks[ad] = `${activePass.leaveCategory || 'Leave'}: ${activePass.destination} (${activePass.purpose}) — By ${activePass.teacherName}`;
        } else {
          newStatus[ad] = 'PRESENT';
        }
      }
    });

    setStatusMap(newStatus);
    setRemarksMap(newRemarks);
  }, [selectedClass, dailyDocData, students, activePasses]);

  // Load Recent 60 Days for Chronic / Regular Absentee Analysis & Monthly Reports
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
    if ((viewMode === 'regular_absentees' || (viewMode === 'admin_summary' && nightRepScope !== 'daily')) && monthlyDocsList.length === 0) {
      loadRecent30DaysForAnalytics();
    }
  }, [viewMode, nightRepScope]);

  // Tap card to toggle PRESENT <-> ABSENT (just like Period Attendance!)
  const handleCardQuickTap = (adNo) => {
    setStatusMap(prev => {
      const cur = prev[adNo] || 'PRESENT';
      if (cur === 'OUTPASS') return prev;
      return { ...prev, [adNo]: cur === 'PRESENT' ? 'ABSENT' : 'PRESENT' };
    });
  };

  const handleSaveClassAttendance = async () => {
    setSaving(true);
    try {
      const absentAdNos = [];
      const outpassAdNos = [];
      const sickAdNos = [];
      const cleanRemarks = {};

      classStudents.forEach(st => {
        const ad = String(st.adNo || '').trim();
        const stStatus = statusMap[ad] || 'PRESENT';
        if (stStatus === 'ABSENT') absentAdNos.push(ad);
        if (stStatus === 'OUTPASS') outpassAdNos.push(ad);
        if (stStatus === 'SICK_ROOM') sickAdNos.push(ad);
        if (remarksMap[ad]) cleanRemarks[ad] = String(remarksMap[ad]).trim();
      });

      const classPayload = {
        className: selectedClass,
        totalStrength: classStudents.length,
        presentCount: classStudents.length - absentAdNos.length - outpassAdNos.length - sickAdNos.length,
        absentCount: absentAdNos.length,
        outpassCount: outpassAdNos.length,
        sickCount: sickAdNos.length,
        absentAdNos,
        outpassAdNos,
        sickAdNos,
        remarks: cleanRemarks,
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
      alert(`✅ Night Attendance saved for Class ${selectedClass} (${selectedDate})!`);
    } catch (err) {
      alert('Error saving attendance: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Build Formatted WhatsApp Verification Message for Class Teacher / Outreach / NIICS
  const buildClassAbsenteeReportText = () => {
    const unexcusedList = classStudents.filter(s => statusMap[s.adNo] === 'ABSENT');
    const outpassList = classStudents.filter(s => statusMap[s.adNo] === 'OUTPASS');
    const sickList = classStudents.filter(s => statusMap[s.adNo] === 'SICK_ROOM');

    const lines = [
      `*🌙 DHIU DEGREE SECTION — NIGHT ATTENDANCE REPORT*`,
      `*Class:* ${selectedClass} | *Date:* ${selectedDate}`,
      `*Recorded By:* ${recorderName}`,
      `*Strength:* ${classStudents.length} | *Present:* ${classStudents.length - unexcusedList.length - outpassList.length - sickList.length}`,
      `-----------------------------------------`
    ];

    if (unexcusedList.length > 0) {
      lines.push(`*🔴 UNVERIFIED ABSENT STUDENTS (${unexcusedList.length}) — Please verify if with permission:*`);
      unexcusedList.forEach((s, i) => {
        const note = remarksMap[s.adNo] ? ` (${remarksMap[s.adNo]})` : '';
        lines.push(`${i + 1}. *${s.firstName}* (#${s.adNo})${note}`);
      });
    } else {
      lines.push(`✅ *Zero Unexcused Absentees in Class ${selectedClass}!*`);
    }

    if (outpassList.length > 0) {
      lines.push(`\n*🪪 ABSENT ON PERMITTED OUT-PASS (${outpassList.length}):*`);
      outpassList.forEach((s, i) => {
        const passObj = getActiveOutpassForStudent(s.adNo);
        const detail = passObj
          ? `${passObj.leaveCategory || 'Leave'} to ${passObj.destination} (${passObj.purpose}) — *By: ${passObj.teacherName}*`
          : (remarksMap[s.adNo] || 'Permitted Out-Pass');
        lines.push(`${i + 1}. *${s.firstName}* (#${s.adNo}) — ${detail}`);
      });
    }

    if (sickList.length > 0) {
      lines.push(`\n*🤒 SICK / IN ROOM (${sickList.length}):*`);
      sickList.forEach((s, i) => {
        lines.push(`${i + 1}. *${s.firstName}* (#${s.adNo}) ${remarksMap[s.adNo] ? `— ${remarksMap[s.adNo]}` : ''}`);
      });
    }

    return lines.join('\n');
  };

  const classTeacherObj = resolveClassTeacherForStudent({ classes: [selectedClass] }, teachers);
  const outreachCoordObj = teachers.find(t => t.outpassPrivileges?.isOutreachCoordinator);
  const niicsCoordObj = teachers.find(t => t.outpassPrivileges?.isNiicsCoordinator);

  // Calculate Institution-Wide Summary for `selectedDate`
  const computeInstitutionSummaryForDate = () => {
    let totalStrength = students.length;
    let totalUnexcusedAbsent = 0;
    let totalOnOutpass = 0;
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
        sickCount: saved ? (saved.sickAdNos || []).length : '-',
        absentStudents: saved
          ? clsStudents.filter(s => (saved.absentAdNos || []).includes(String(s.adNo)))
          : [],
        outpassStudents: saved
          ? clsStudents.filter(s => (saved.outpassAdNos || []).includes(String(s.adNo)))
          : []
      };
    });

    const totalPresent = totalStrength - totalUnexcusedAbsent - totalOnOutpass - totalSick;
    return {
      totalStrength,
      totalPresent,
      totalUnexcusedAbsent,
      totalOnOutpass,
      totalSick,
      classesTakenCount,
      classSummaries
    };
  };

  // Compute Regular / Chronic Absentees Across Loaded Days
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

  const presentInCurrentClass = classStudents.filter(s => (statusMap[s.adNo] || 'PRESENT') === 'PRESENT').length;
  const absentInCurrentClass = classStudents.filter(s => statusMap[s.adNo] === 'ABSENT').length;
  const outpassInCurrentClass = classStudents.filter(s => statusMap[s.adNo] === 'OUTPASS').length;
  const sickInCurrentClass = classStudents.filter(s => statusMap[s.adNo] === 'SICK_ROOM').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      {/* TOP BAR & VIEW MODE SWITCHER */}
      <div style={{ ...styles.card, marginBottom: 0, background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', color: '#ffffff', padding: '20px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
          <div>
            <span style={{ background: '#00897b', color: '#ffffff', padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: '800', letterSpacing: '0.8px' }}>
              🌙 DARUL HUDA DEGREE SECTION • NIGHT ATTENDANCE REGISTER
            </span>
            <h2 style={{ margin: '6px 0 2px', fontSize: '21px', fontWeight: '800', color: '#ffffff' }}>
              Night Roll-Call, Out-Pass Auto-Sync &amp; Absentee Verification
            </h2>
            <p style={{ margin: 0, fontSize: '13px', color: '#cbd5e1', fontWeight: '500' }}>
              Tap any student card to toggle Present / Absent, or tap a status button (Present, Absent, On Leave, Sick).
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              style={{ padding: '9px 14px', borderRadius: '8px', fontWeight: '800', fontSize: '13px', cursor: 'pointer', background: '#ffffff', color: '#0f172a' }}
            />
            <button
              type="button"
              onClick={() => setViewMode('take_attendance')}
              style={{
                padding: '9px 16px', borderRadius: '8px', border: 'none', fontWeight: '800', fontSize: '13px', cursor: 'pointer',
                background: viewMode === 'take_attendance' ? '#00897b' : 'rgba(255,255,255,0.15)',
                color: '#ffffff'
              }}
            >
              ✍️ Take Class Attendance
            </button>
            {canViewAdminAnalytics && (
              <>
                <button
                  type="button"
                  onClick={() => setViewMode('admin_summary')}
                  style={{
                    padding: '9px 16px', borderRadius: '8px', border: 'none', fontWeight: '800', fontSize: '13px', cursor: 'pointer',
                    background: viewMode === 'admin_summary' ? '#2563eb' : 'rgba(255,255,255,0.15)',
                    color: '#ffffff'
                  }}
                >
                  📊 Institution &amp; Class Summary
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('regular_absentees')}
                  style={{
                    padding: '9px 16px', borderRadius: '8px', border: 'none', fontWeight: '800', fontSize: '13px', cursor: 'pointer',
                    background: viewMode === 'regular_absentees' ? '#dc2626' : 'rgba(255,255,255,0.15)',
                    color: '#ffffff'
                  }}
                >
                  🚨 Regular Absentees Tracker
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* =========================================================
          MODE 1: TAKE CLASS NIGHT ATTENDANCE (MOBILE-FIRST CARDS)
         ========================================================= */}
      {viewMode === 'take_attendance' && (
        <div style={{ ...styles.card, marginBottom: 0 }}>
          {/* CLASS SELECTOR PILLS */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '18px', paddingBottom: '14px', borderBottom: '2px solid #f1f5f9' }}>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', fontWeight: '800', color: '#0f172a' }}>Select Class:</span>
              {DEFAULT_CLASSES.map(cls => {
                const isSelected = selectedClass === cls;
                const isDoneTonight = Boolean((dailyDocData.classes || {})[cls]);
                return (
                  <button
                    key={cls}
                    type="button"
                    onClick={() => setSelectedClass(cls)}
                    style={{
                      padding: '8px 16px', borderRadius: '8px', fontWeight: '800', fontSize: '13px', cursor: 'pointer',
                      background: isSelected ? '#0f766e' : isDoneTonight ? '#ecfdf5' : '#f8fafc',
                      color: isSelected ? '#ffffff' : isDoneTonight ? '#047857' : '#0f172a',
                      border: isSelected ? '2px solid #0f766e' : isDoneTonight ? '1.5px solid #10b981' : '1.5px solid #cbd5e1'
                    }}
                  >
                    {isDoneTonight ? `✓ ${cls}` : cls}
                  </button>
                );
              })}
            </div>

            {savedCurrentClassMeta && (
              <span style={{ background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: '800' }}>
                ✅ Recorded by {savedCurrentClassMeta.takenBy}
              </span>
            )}
          </div>

          {/* LIVE COUNTERS */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: '12px', marginBottom: '16px' }}>
            <div style={{ padding: '14px', borderRadius: '10px', background: '#f8fafc', border: '1px solid #cbd5e1', textAlign: 'center' }}>
              <div style={{ fontSize: '11px', fontWeight: '800', color: '#64748b' }}>CLASS {selectedClass} TOTAL</div>
              <div style={{ fontSize: '22px', fontWeight: '900', color: '#0f172a' }}>{classStudents.length}</div>
            </div>
            <div style={{ padding: '14px', borderRadius: '10px', background: '#ecfdf5', border: '1px solid #a7f3d0', textAlign: 'center' }}>
              <div style={{ fontSize: '11px', fontWeight: '800', color: '#047857' }}>🟢 PRESENT</div>
              <div style={{ fontSize: '22px', fontWeight: '900', color: '#047857' }}>{presentInCurrentClass}</div>
            </div>
            <div style={{ padding: '14px', borderRadius: '10px', background: '#fef2f2', border: '1px solid #fecaca', textAlign: 'center' }}>
              <div style={{ fontSize: '11px', fontWeight: '800', color: '#dc2626' }}>🔴 UNEXCUSED ABSENT</div>
              <div style={{ fontSize: '22px', fontWeight: '900', color: '#dc2626' }}>{absentInCurrentClass}</div>
            </div>
            <div style={{ padding: '14px', borderRadius: '10px', background: '#eff6ff', border: '1px solid #bfdbfe', textAlign: 'center' }}>
              <div style={{ fontSize: '11px', fontWeight: '800', color: '#1d4ed8' }}>🪪 OUT-PASS / 🤒 SICK</div>
              <div style={{ fontSize: '22px', fontWeight: '900', color: '#1d4ed8' }}>{outpassInCurrentClass} / {sickInCurrentClass}</div>
            </div>
          </div>

          {/* SLIDING WHATSAPP VERIFICATION DRAWER */}
          <div style={{ background: '#f0fdf4', border: '1.5px solid #86efac', borderRadius: '12px', marginBottom: '18px', overflow: 'hidden' }}>
            <div
              onClick={() => setShowForwardDrawer(prev => !prev)}
              style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', flexWrap: 'wrap', gap: '8px' }}
            >
              <div>
                <div style={{ fontWeight: '800', fontSize: '14px', color: '#14532d' }}>
                  📲 Forward Absentee List for Permission Verification ({absentInCurrentClass} Absent)
                </div>
                <div style={{ fontSize: '12px', color: '#166534', fontWeight: '600' }}>
                  Class Teacher of {selectedClass}: <strong>{classTeacherObj?.fullName || 'Not Assigned'}</strong>
                </div>
              </div>
              <span style={{ background: '#16a34a', color: '#ffffff', padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: '800' }}>
                {showForwardDrawer ? '▲ Hide Share Buttons' : '▼ Share / Copy List'}
              </span>
            </div>

            {showForwardDrawer && (
              <div style={{ padding: '12px 16px', background: '#ffffff', borderTop: '1px solid #bbf7d0', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => {
                    const text = buildClassAbsenteeReportText();
                    navigator.clipboard.writeText(text);
                    alert(`✅ Copied Class ${selectedClass} Night Attendance Report to clipboard!`);
                  }}
                  style={{ padding: '8px 14px', background: '#f59e0b', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '800', fontSize: '12px', cursor: 'pointer' }}
                >
                  📋 Copy Absent List
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const text = buildClassAbsenteeReportText();
                    openDirectWhatsApp(classTeacherObj?.whatsappNumber || classTeacherObj?.mobileNumber, text);
                  }}
                  style={{ padding: '8px 14px', background: '#16a34a', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '800', fontSize: '12px', cursor: 'pointer' }}
                >
                  💬 Send to Class Teacher ({classTeacherObj?.fullName || selectedClass})
                </button>

                {outreachCoordObj && (
                  <button
                    type="button"
                    onClick={() => {
                      const text = buildClassAbsenteeReportText();
                      openDirectWhatsApp(outreachCoordObj.whatsappNumber || outreachCoordObj.mobileNumber, text);
                    }}
                    style={{ padding: '8px 14px', background: '#0284c7', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '800', fontSize: '12px', cursor: 'pointer' }}
                  >
                    🌍 Verify with Outreach ({outreachCoordObj.fullName})
                  </button>
                )}

                {niicsCoordObj && (
                  <button
                    type="button"
                    onClick={() => {
                      const text = buildClassAbsenteeReportText();
                      openDirectWhatsApp(niicsCoordObj.whatsappNumber || niicsCoordObj.mobileNumber, text);
                    }}
                    style={{ padding: '8px 14px', background: '#7c3aed', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '800', fontSize: '12px', cursor: 'pointer' }}
                  >
                    🎓 Send to NIICS Coordinator
                  </button>
                )}
              </div>
            )}
          </div>

          <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="text"
              placeholder="🔍 Quick search student in this class..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              style={{ ...styles.input, maxWidth: '320px', padding: '10px 14px' }}
            />
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
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
                style={{ padding: '10px 14px', background: '#dcfce7', color: '#166534', border: 'none', borderRadius: '10px', fontWeight: '800', fontSize: '12px', cursor: 'pointer' }}
              >
                ✅ All Present
              </button>
              <button
                type="button"
                onClick={handleSaveClassAttendance}
                disabled={saving}
                style={{ padding: '10px 22px', background: '#00897b', color: '#ffffff', border: 'none', borderRadius: '10px', fontWeight: '800', fontSize: '14px', cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,137,123,0.25)' }}
              >
                {saving ? 'Saving Roll-Call...' : `💾 Save Class ${selectedClass} Night Attendance`}
              </button>
            </div>
          </div>

          {/* 🌟 MOBILE-FRIENDLY TAPPABLE STUDENT CARDS (Works cleanly on all phones & desktops!) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(285px, 1fr))', gap: '12px' }}>
            {classStudents
              .filter(s => !searchFilter.trim() || (s.firstName || '').toLowerCase().includes(searchFilter.toLowerCase()) || String(s.adNo || '').toLowerCase().includes(searchFilter.toLowerCase()))
              .map((st, idx) => {
                const ad = String(st.adNo || '').trim();
                const curStatus = statusMap[ad] || 'PRESENT';
                const activePass = getActiveOutpassForStudent(ad);
                const hasRemark = Boolean(remarksMap[ad]);
                const isRemarkOpen = expandedRemarkAdNo === ad;

                const cardThemes = {
                  PRESENT: { bg: '#ecfdf5', border: '#10b981', badgeBg: '#059669', titleColor: '#065f46', label: 'PRESENT' },
                  ABSENT: { bg: '#fef2f2', border: '#ef4444', badgeBg: '#dc2626', titleColor: '#991b1b', label: 'ABSENT' },
                  OUTPASS: { bg: '#eff6ff', border: '#3b82f6', badgeBg: '#2563eb', titleColor: '#1e40af', label: 'ON LEAVE' },
                  SICK_ROOM: { bg: '#fffbeb', border: '#f59e0b', badgeBg: '#d97706', titleColor: '#92400e', label: 'SICK / ROOM' }
                };
                const theme = cardThemes[curStatus] || cardThemes.PRESENT;

                return (
                  <div
                    key={st.regNo}
                    onClick={() => handleCardQuickTap(ad)}
                    style={{
                      padding: '14px',
                      borderRadius: '14px',
                      background: theme.bg,
                      border: `2px solid ${theme.border}`,
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <ProfileAvatar name={st.firstName} code={st.adNo} photoUrl={st.photoUrl} size={40} />
                        <div>
                          <div style={{ fontWeight: '900', color: theme.titleColor, fontSize: '14px', lineHeight: 1.25 }}>
                            #{st.rollNo || idx + 1} • {st.firstName}
                          </div>
                          <div style={{ fontSize: '12px', color: '#475569', fontWeight: '800', marginTop: '2px' }}>
                            Ad.No: #{st.adNo} • {st.department || 'GEN'}
                          </div>
                        </div>
                      </div>

                      <span style={{ background: theme.badgeBg, color: '#ffffff', padding: '4px 10px', borderRadius: '8px', fontSize: '11px', fontWeight: '900', whiteSpace: 'nowrap' }}>
                        {theme.label}
                      </span>
                    </div>

                    {/* AUTOMATIC OUT-PASS DETECTION BOX WITH FULL SCHEDULE DETAILS */}
                    {activePass && (
                      <div style={{ background: '#dbeafe', border: '1.5px solid #93c5fd', padding: '8px 10px', borderRadius: '8px', fontSize: '11px', color: '#1e3a8a', lineHeight: 1.4 }}>
                        <div style={{ fontWeight: '900', color: '#1e40af' }}>
                          🪪 {activePass.leaveCategory || 'Leave'} • 📍 {activePass.destination} ({activePass.status})
                        </div>
                        <div style={{ fontSize: '11px', marginTop: '2px', fontWeight: '700', color: '#1d4ed8' }}>
                          📝 Reason: {activePass.purpose || '—'}
                        </div>
                        <div style={{ fontSize: '10px', marginTop: '2px', fontWeight: '800', color: '#0369a1' }}>
                          🚶‍♂️ Out: {formatNightPassTime(activePass.permittedFrom, false)} ➔ ⏳ Return: {formatNightPassTime(activePass.permittedTo, activePass.isOpenReturn)}
                        </div>
                        <div style={{ fontSize: '10px', marginTop: '2px', fontWeight: '800', color: '#0f172a' }}>
                          👨‍🏫 Permitted By: <strong>{activePass.teacherName}</strong>
                          {activePass.teacherPhone ? ` (📞 ${activePass.teacherPhone})` : ''}
                        </div>
                      </div>
                    )}

                    {/* 1-CLICK STATUS PILLS + NOTE TOGGLE */}
                    <div
                      onClick={(e) => e.stopPropagation()}
                      style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', paddingTop: '6px', borderTop: '1px solid rgba(15,23,42,0.08)' }}
                    >
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {[
                          { id: 'PRESENT', label: '🟢 Pres', bg: '#059669' },
                          { id: 'ABSENT', label: '🔴 Abs', bg: '#dc2626' },
                          { id: 'OUTPASS', label: '🪪 Leave', bg: '#2563eb' },
                          { id: 'SICK_ROOM', label: '🤒 Sick', bg: '#d97706' }
                        ].map(btn => {
                          const active = curStatus === btn.id;
                          return (
                            <button
                              key={btn.id}
                              type="button"
                              onClick={() => setStatusMap(prev => ({ ...prev, [ad]: btn.id }))}
                              style={{
                                padding: '6px 9px',
                                borderRadius: '8px',
                                fontSize: '11px',
                                fontWeight: '900',
                                cursor: 'pointer',
                                background: active ? btn.bg : '#ffffff',
                                color: active ? '#ffffff' : '#0f172a',
                                border: active ? `1.5px solid ${btn.bg}` : '1px solid #cbd5e1'
                              }}
                            >
                              {btn.label}
                            </button>
                          );
                        })}
                      </div>

                      <button
                        type="button"
                        onClick={() => setExpandedRemarkAdNo(isRemarkOpen ? null : ad)}
                        style={{
                          padding: '5px 8px',
                          borderRadius: '6px',
                          background: hasRemark ? '#fef3c7' : '#ffffff',
                          color: hasRemark ? '#92400e' : '#475569',
                          border: '1px solid #cbd5e1',
                          fontSize: '11px',
                          fontWeight: '800',
                          cursor: 'pointer'
                        }}
                      >
                        📝 {hasRemark ? 'Note✓' : '+Note'}
                      </button>
                    </div>

                    {(isRemarkOpen || (hasRemark && !activePass)) && (
                      <div onClick={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          placeholder="Optional note (e.g. With Outreach Usthad)..."
                          value={remarksMap[ad] || ''}
                          onChange={(e) => setRemarksMap(prev => ({ ...prev, [ad]: e.target.value }))}
                          style={{ ...styles.input, padding: '8px 10px', fontSize: '12px', background: '#ffffff', color: '#0f172a' }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
          </div>

          <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={handleSaveClassAttendance}
              disabled={saving}
              style={{ ...styles.buttonPrimary, width: '100%', padding: '16px', fontSize: '16px' }}
            >
              {saving ? 'Saving Roll-Call...' : `💾 Save Class ${selectedClass} Night Attendance`}
            </button>
          </div>
        </div>
      )}

      {/* =========================================================
          MODE 2: ADMIN INSTITUTION-WIDE & CLASS-WISE SUMMARY
         ========================================================= */}
      {viewMode === 'admin_summary' && canViewAdminAnalytics && (
        <div style={styles.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '20px' }}>
            <h3 style={{ margin: 0, fontSize: '19px', fontWeight: '800', color: '#0f172a' }}>
              📊 Institution-Wide Night Attendance Summary ({selectedDate})
            </h3>
            <button
              type="button"
              onClick={() => {
                const lines = [
                  `*🌙 DHIU DEGREE SECTION — INSTITUTION NIGHT ATTENDANCE SUMMARY*`,
                  `*Date:* ${selectedDate}`,
                  `*Total Strength:* ${instSummary.totalStrength} | *Present:* ${instSummary.totalPresent} | *Unexcused Absent:* ${instSummary.totalUnexcusedAbsent} | *On Out-Pass:* ${instSummary.totalOnOutpass}`,
                  `-----------------------------------------`
                ];
                instSummary.classSummaries.forEach(c => {
                  if (!c.isTaken) {
                    lines.push(`• *${c.className}:* ⏳ Attendance Not Recorded Yet (CT: ${c.classTeacherName})`);
                  } else {
                    const absNames = c.absentStudents.map(s => `${s.firstName} (#${s.adNo})`).join(', ');
                    lines.push(`• *${c.className}:* Present ${c.presentCount}/${c.strength} | Absent: ${c.absentCount} | Out-Pass: ${c.outpassCount} (By ${c.takenBy})${absNames ? `\n   🔴 _Absent:_ ${absNames}` : ''}`);
                  }
                });
                openWhatsAppGroupAndCopy(staffGroupLink, lines.join('\n'), 'Staff WhatsApp Group');
              }}
              style={{ padding: '10px 18px', background: '#16a34a', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '800', fontSize: '13px', cursor: 'pointer' }}
            >
              💬 Share Full Institution Summary to Staff WhatsApp Group
            </button>
          </div>

          {/* NIGHT ATTENDANCE SCOPE SWITCHER: Specific Date | Monthly Report | Total Semester */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', background: '#f8fafc', padding: '14px 18px', borderRadius: '12px', border: '1px solid #cbd5e1', marginBottom: '20px' }}>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {[
                { id: 'daily', label: `📅 Specific Date (${selectedDate})` },
                { id: 'monthly', label: '🗓️ Monthly Night Report' },
                { id: 'total', label: '📈 Total Semester Night Summary' }
              ].map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setNightRepScope(t.id)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    border: 'none',
                    fontWeight: '800',
                    fontSize: '13px',
                    cursor: 'pointer',
                    background: nightRepScope === t.id ? '#0f766e' : '#ffffff',
                    color: nightRepScope === t.id ? '#ffffff' : '#0f172a'
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {nightRepScope !== 'daily' && (
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                <select value={nightRepClass} onChange={e => setNightRepClass(e.target.value)} style={{ ...styles.input, width: '160px', padding: '8px 12px' }}>
                  <option value="ALL">All Classes</option>
                  {DEFAULT_CLASSES.map(c => <option key={c} value={c}>Class {c}</option>)}
                </select>
                {nightRepScope === 'monthly' && (
                  <input type="month" value={nightRepMonth} onChange={e => setNightRepMonth(e.target.value)} style={{ ...styles.input, width: '170px', padding: '8px 12px' }} />
                )}
              </div>
            )}
          </div>

          {/* MONTHLY OR TOTAL STUDENT-WISE NIGHT ATTENDANCE MATRIX */}
          {nightRepScope !== 'daily' && (() => {
            const scopedDocs = nightRepScope === 'monthly'
              ? monthlyDocsList.filter(d => String(d.date || '').startsWith(nightRepMonth))
              : monthlyDocsList;

            const targetStudents = students.filter(s => nightRepClass === 'ALL' || (s.classes || []).includes(nightRepClass));

            return (
              <div style={{ marginBottom: '26px', border: '1px solid #cbd5e1', borderRadius: '12px', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left', minWidth: '800px' }}>
                  <thead>
                    <tr style={{ background: '#0f172a', color: '#ffffff' }}>
                      <th style={{ padding: '12px 14px', color: '#ffffff' }}>#</th>
                      <th style={{ padding: '12px 14px', color: '#ffffff' }}>Student &amp; Ad.No</th>
                      <th style={{ padding: '12px 14px', color: '#ffffff' }}>Class</th>
                      <th style={{ padding: '12px 14px', color: '#ffffff', textAlign: 'center' }}>Nights Recorded</th>
                      <th style={{ padding: '12px 14px', color: '#ffffff', textAlign: 'center' }}>Present</th>
                      <th style={{ padding: '12px 14px', color: '#ffffff', textAlign: 'center' }}>Unexcused Absent</th>
                      <th style={{ padding: '12px 14px', color: '#ffffff', textAlign: 'center' }}>On Out-Pass</th>
                      <th style={{ padding: '12px 14px', color: '#ffffff', textAlign: 'center' }}>Sick/Room</th>
                      <th style={{ padding: '12px 14px', color: '#ffffff', textAlign: 'center' }}>Night Attendance %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {targetStudents.map((st, idx) => {
                      const ad = String(st.adNo || '').trim();
                      const stCls = (st.classes || [])[0] || '';
                      let nightsHeld = 0;
                      let nightsPres = 0;
                      let nightsAbs = 0;
                      let nightsOut = 0;
                      let nightsSick = 0;

                      scopedDocs.forEach(dayDoc => {
                        const cRec = (dayDoc.classes || {})[stCls];
                        if (!cRec) return;
                        nightsHeld++;
                        if ((cRec.absentAdNos || []).includes(ad)) nightsAbs++;
                        else if ((cRec.outpassAdNos || []).includes(ad)) nightsOut++;
                        else if ((cRec.sickAdNos || []).includes(ad)) nightsSick++;
                        else nightsPres++;
                      });

                      const pct = nightsHeld > 0 ? (((nightsPres + nightsSick) / nightsHeld) * 100).toFixed(1) : '100.0';

                      return (
                        <tr key={st.regNo} style={{ borderBottom: '1px solid #e2e8f0', background: idx % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                          <td style={{ padding: '10px 14px', fontWeight: '700', color: '#64748b' }}>{idx + 1}</td>
                          <td style={{ padding: '10px 14px', fontWeight: '800', color: '#0f172a' }}>{st.firstName} (#{st.adNo})</td>
                          <td style={{ padding: '10px 14px', fontWeight: '800', color: '#0f766e' }}>{stCls}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: '700' }}>{nightsHeld}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: '800', color: '#047857' }}>{nightsPres}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: '900', color: nightsAbs > 0 ? '#dc2626' : '#64748b' }}>{nightsAbs}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: '800', color: '#2563eb' }}>{nightsOut}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: '800', color: '#d97706' }}>{nightsSick}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                            <span style={{ background: Number(pct) < 85 ? '#fef2f2' : '#dcfce7', color: Number(pct) < 85 ? '#dc2626' : '#166534', padding: '4px 10px', borderRadius: '999px', fontWeight: '900', fontSize: '12px' }}>
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
          })()}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '16px', marginBottom: '24px' }}>
            <div style={{ padding: '18px', borderRadius: '12px', background: '#f8fafc', border: '1px solid #cbd5e1', textAlign: 'center' }}>
              <span style={{ fontSize: '11px', fontWeight: '800', color: '#64748b' }}>CLASSES RECORDED TONIGHT</span>
              <div style={{ fontSize: '26px', fontWeight: '900', color: '#0f172a', marginTop: '4px' }}>
                {instSummary.classesTakenCount} / {DEFAULT_CLASSES.length}
              </div>
            </div>
            <div style={{ padding: '18px', borderRadius: '12px', background: '#ecfdf5', border: '1px solid #a7f3d0', textAlign: 'center' }}>
              <span style={{ fontSize: '11px', fontWeight: '800', color: '#047857' }}>TOTAL PRESENT IN CAMPUS</span>
              <div style={{ fontSize: '26px', fontWeight: '900', color: '#047857', marginTop: '4px' }}>{instSummary.totalPresent}</div>
            </div>
            <div style={{ padding: '18px', borderRadius: '12px', background: '#fef2f2', border: '1px solid #fecaca', textAlign: 'center' }}>
              <span style={{ fontSize: '11px', fontWeight: '800', color: '#dc2626' }}>TOTAL UNEXCUSED ABSENT</span>
              <div style={{ fontSize: '26px', fontWeight: '900', color: '#dc2626', marginTop: '4px' }}>{instSummary.totalUnexcusedAbsent}</div>
            </div>
            <div style={{ padding: '18px', borderRadius: '12px', background: '#eff6ff', border: '1px solid #bfdbfe', textAlign: 'center' }}>
              <span style={{ fontSize: '11px', fontWeight: '800', color: '#1d4ed8' }}>ON PERMITTED OUT-PASS</span>
              <div style={{ fontSize: '26px', fontWeight: '900', color: '#1d4ed8', marginTop: '4px' }}>{instSummary.totalOnOutpass}</div>
            </div>
          </div>

          <div style={{ overflowX: 'auto', border: '1px solid #cbd5e1', borderRadius: '12px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', textAlign: 'left', minWidth: '880px' }}>
              <thead>
                <tr style={{ background: '#0f172a', color: '#ffffff' }}>
                  <th style={{ padding: '12px 14px', color: '#ffffff' }}>Class &amp; Class Teacher</th>
                  <th style={{ padding: '12px 14px', color: '#ffffff' }}>Status &amp; Recorded By</th>
                  <th style={{ padding: '12px 14px', color: '#ffffff', textAlign: 'center' }}>Present / Total</th>
                  <th style={{ padding: '12px 14px', color: '#ffffff' }}>Unexcused Absent Students</th>
                  <th style={{ padding: '12px 14px', color: '#ffffff' }}>On Permitted Out-Pass</th>
                  <th style={{ padding: '12px 14px', color: '#ffffff', textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {instSummary.classSummaries.map((c, i) => (
                  <tr key={c.className} style={{ borderBottom: '1px solid #e2e8f0', background: i % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ fontWeight: '800', color: '#0f172a', fontSize: '15px' }}>Class {c.className}</div>
                      <div style={{ fontSize: '12px', color: '#0f766e', fontWeight: '700' }}>🏫 CT: {c.classTeacherName}</div>
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      {c.isTaken ? (
                        <span style={{ background: '#dcfce7', color: '#166534', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '800' }}>
                          ✅ By {c.takenBy}
                        </span>
                      ) : (
                        <span style={{ background: '#fef2f2', color: '#dc2626', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '800' }}>
                          ⏳ Not Taken Yet
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'center', fontWeight: '800' }}>
                      {c.presentCount} / {c.strength}
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      {c.absentStudents.length === 0 ? (
                        <span style={{ color: '#64748b', fontSize: '12px' }}>None</span>
                      ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {c.absentStudents.map(s => (
                            <span key={s.adNo} style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: '800' }}>
                              🔴 {s.firstName} (#{s.adNo})
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      {c.outpassStudents.length === 0 ? (
                        <span style={{ color: '#64748b', fontSize: '12px' }}>None</span>
                      ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {c.outpassStudents.map(s => (
                            <span key={s.adNo} style={{ background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: '800' }}>
                              🪪 {s.firstName} (#{s.adNo})
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedClass(c.className);
                          setViewMode('take_attendance');
                        }}
                        style={{ padding: '7px 12px', background: '#0f766e', color: '#ffffff', border: 'none', borderRadius: '6px', fontWeight: '800', fontSize: '12px', cursor: 'pointer' }}
                      >
                        Open Sheet
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =========================================================
          MODE 3: REGULAR / CHRONIC ABSENTEES TRACKER
         ========================================================= */}
      {viewMode === 'regular_absentees' && canViewAdminAnalytics && (
        <div style={styles.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '19px', fontWeight: '800', color: '#0f172a' }}>
                🚨 Regular / Habitual Night Absentees Report (Across {monthlyDocsList.length} Recorded Nights)
              </h3>
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
                Ranks students by total unexcused night absences so Admin, Principal, and NIICS Coordinator can take timely action.
              </p>
            </div>
            <button
              type="button"
              onClick={loadRecent30DaysForAnalytics}
              style={{ padding: '8px 14px', background: '#0284c7', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '800', fontSize: '12px', cursor: 'pointer' }}
            >
              🔄 Refresh Archive
            </button>
          </div>

          <div style={{ overflowX: 'auto', border: '1px solid #cbd5e1', borderRadius: '12px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: '#0f172a', color: '#ffffff' }}>
                  <th style={{ padding: '12px 14px', color: '#ffffff' }}>Rank</th>
                  <th style={{ padding: '12px 14px', color: '#ffffff' }}>Student &amp; Ad.No</th>
                  <th style={{ padding: '12px 14px', color: '#ffffff' }}>Class &amp; Mentor</th>
                  <th style={{ padding: '12px 14px', color: '#ffffff' }}>Unexcused Night Absences</th>
                  <th style={{ padding: '12px 14px', color: '#ffffff' }}>Dates Absent</th>
                  <th style={{ padding: '12px 14px', color: '#ffffff', textAlign: 'right' }}>Contact Parent</th>
                </tr>
              </thead>
              <tbody>
                {getRegularAbsenteesList().map((item, idx) => (
                  <tr key={item.adNo} style={{ borderBottom: '1px solid #e2e8f0', background: idx % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                    <td style={{ padding: '12px 14px', fontWeight: '800' }}>#{idx + 1}</td>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <ProfileAvatar name={item.studentName} code={item.adNo} photoUrl={item.photoUrl} size={36} />
                        <div>
                          <div style={{ fontWeight: '800', color: '#0f172a' }}>{item.studentName}</div>
                          <div style={{ fontSize: '12px', color: '#475569' }}>Ad.No: #{item.adNo}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <strong>Class {item.studentClass}</strong> • Mentor: {item.mentorUsername}
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <span style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', padding: '4px 10px', borderRadius: '999px', fontWeight: '800', fontSize: '12px' }}>
                        🚨 {item.unexcusedCount} Nights Absent
                      </span>
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: '12px', color: '#475569' }}>
                      {item.absentDates.slice(0, 6).join(', ')}
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                      <button
                        type="button"
                        onClick={() => openDirectWhatsApp(item.parentWhatsapp, `Assalamu Alaikum, official notice from Darul Huda Degree Section regarding ${item.studentName} (#${item.adNo}):`)}
                        style={{ padding: '7px 12px', background: '#dcfce7', color: '#166534', border: 'none', borderRadius: '8px', fontWeight: '800', fontSize: '12px', cursor: 'pointer' }}
                      >
                        💬 Parent WA
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}