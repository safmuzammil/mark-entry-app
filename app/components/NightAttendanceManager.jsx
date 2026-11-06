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
import { DEFAULT_CLASSES, styles } from './erpConstants';
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

  useEffect(() => { setStudents(preloadedStudents); }, [preloadedStudents]);
  useEffect(() => { setTeachers(preloadedTeachers); }, [preloadedTeachers]);

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
      const isOfficialPass = activePass && (
        String(activePass.leaveCategory || '').toLowerCase().includes('official') ||
        String(activePass.leaveCategory || '').toLowerCase().includes('outreach')
      );

      if (savedClassRecord) {
        if ((savedClassRecord.absentAdNos || []).includes(ad)) {
          newStatus[ad] = 'ABSENT';
        } else if ((savedClassRecord.officialAdNos || []).includes(ad)) {
          newStatus[ad] = 'OFFICIAL';
        } else if ((savedClassRecord.outpassAdNos || []).includes(ad) || activePass) {
          newStatus[ad] = isOfficialPass ? 'OFFICIAL' : 'OUTPASS';
        } else if ((savedClassRecord.sickAdNos || []).includes(ad)) {
          newStatus[ad] = 'SICK_ROOM';
        } else {
          newStatus[ad] = 'PRESENT';
        }
      } else {
        if (activePass) {
          newStatus[ad] = isOfficialPass ? 'OFFICIAL' : 'OUTPASS';
        } else {
          newStatus[ad] = 'PRESENT';
        }
      }
    });

    setStatusMap(newStatus);
  }, [selectedClass, dailyDocData, students, activePasses]);

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

  const handleCardQuickTap = (adNo) => {
    setStatusMap(prev => {
      const cur = prev[adNo] || 'PRESENT';
      if (cur === 'OUTPASS' || cur === 'OFFICIAL') return prev;
      return { ...prev, [adNo]: cur === 'PRESENT' ? 'ABSENT' : 'PRESENT' };
    });
  };

  const handleSaveClassAttendance = async () => {
    setSaving(true);
    try {
      const absentAdNos = [];
      const outpassAdNos = [];
      const officialAdNos = [];
      const sickAdNos = [];

      classStudents.forEach(st => {
        const ad = String(st.adNo || '').trim();
        const stStatus = statusMap[ad] || 'PRESENT';
        if (stStatus === 'ABSENT') absentAdNos.push(ad);
        if (stStatus === 'OUTPASS') outpassAdNos.push(ad);
        if (stStatus === 'OFFICIAL') officialAdNos.push(ad);
        if (stStatus === 'SICK_ROOM') sickAdNos.push(ad);
      });

      const classPayload = {
        className: selectedClass,
        totalStrength: classStudents.length,
        presentCount: classStudents.length - absentAdNos.length - outpassAdNos.length - officialAdNos.length - sickAdNos.length,
        absentCount: absentAdNos.length,
        outpassCount: outpassAdNos.length,
        officialCount: officialAdNos.length,
        sickCount: sickAdNos.length,
        absentAdNos,
        outpassAdNos,
        officialAdNos,
        sickAdNos,
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

  const buildClassAbsenteeReportText = () => {
    const unexcusedList = classStudents.filter(s => statusMap[s.adNo] === 'ABSENT');
    const outpassList = classStudents.filter(s => statusMap[s.adNo] === 'OUTPASS');
    const officialList = classStudents.filter(s => statusMap[s.adNo] === 'OFFICIAL');
    const sickList = classStudents.filter(s => statusMap[s.adNo] === 'SICK_ROOM');

    const lines = [
      `*🌙 DHIU DEGREE SECTION — NIGHT ATTENDANCE REPORT*`,
      `*Class:* ${selectedClass} | *Date:* ${selectedDate}`,
      `*Recorded By:* ${recorderName}`,
      `*Strength:* ${classStudents.length} | *Present:* ${classStudents.length - unexcusedList.length - outpassList.length - officialList.length - sickList.length}`,
      `-----------------------------------------`
    ];

    if (unexcusedList.length > 0) {
      lines.push(`*🔴 UNVERIFIED ABSENT STUDENTS (${unexcusedList.length}):*`);
      unexcusedList.forEach((s, i) => {
        lines.push(`${i + 1}. *${s.firstName}* (#${s.adNo})`);
      });
    } else {
      lines.push(`✅ *Zero Unexcused Absentees in Class ${selectedClass}!*`);
    }

    if (outpassList.length > 0) {
      lines.push(`\n*🪪 ON PERMITTED LEAVE (${outpassList.length}):*`);
      outpassList.forEach((s, i) => {
        const passObj = getActiveOutpassForStudent(s.adNo);
        const detail = passObj
          ? `${passObj.leaveCategory || 'Leave'} to ${passObj.destination} — *By: ${passObj.teacherName}*`
          : 'Permitted Leave';
        lines.push(`${i + 1}. *${s.firstName}* (#${s.adNo}) — ${detail}`);
      });
    }

    if (officialList.length > 0) {
      lines.push(`\n*📋 ON OFFICIAL DUTY (${officialList.length}):*`);
      officialList.forEach((s, i) => {
        lines.push(`${i + 1}. *${s.firstName}* (#${s.adNo})`);
      });
    }

    if (sickList.length > 0) {
      lines.push(`\n*🤒 SICK / IN ROOM (${sickList.length}):*`);
      sickList.forEach((s, i) => {
        lines.push(`${i + 1}. *${s.firstName}* (#${s.adNo})`);
      });
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
        outpassCount: saved ? (saved.outpassAdNos || []).length + (saved.officialAdNos || []).length : '-',
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
      totalOnOutpass: totalOnOutpass + totalOfficial,
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

  const presentInCurrentClass = classStudents.filter(s => (statusMap[s.adNo] || 'PRESENT') === 'PRESENT').length;
  const absentInCurrentClass = classStudents.filter(s => statusMap[s.adNo] === 'ABSENT').length;
  const outpassInCurrentClass = classStudents.filter(s => statusMap[s.adNo] === 'OUTPASS' || statusMap[s.adNo] === 'OFFICIAL').length;
  const sickInCurrentClass = classStudents.filter(s => statusMap[s.adNo] === 'SICK_ROOM').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* 🌟 MINIMALIST TOP NAVIGATION & DATE BAR (No heavy dark banner or rainbow colors!) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#ffffff', padding: '12px 16px', borderRadius: '12px', border: '1px solid #e2e8f0', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
          {[
            { id: 'take_attendance', label: 'Take Class Attendance' },
            ...(canViewAdminAnalytics ? [
              { id: 'admin_summary', label: 'Institution & Monthly Summary' },
              { id: 'regular_absentees', label: 'Regular Absentees Tracker' }
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
                return (
                  <button
                    key={cls}
                    type="button"
                    onClick={() => setSelectedClass(cls)}
                    style={{
                      padding: '7px 14px', borderRadius: '8px', fontWeight: '700', fontSize: '13px', cursor: 'pointer',
                      background: isSelected ? '#4f46e5' : isDoneTonight ? '#ecfdf5' : '#f8fafc',
                      color: isSelected ? '#ffffff' : isDoneTonight ? '#047857' : '#334155',
                      border: isSelected ? '1px solid #4f46e5' : isDoneTonight ? '1px solid #a7f3d0' : '1px solid #e2e8f0'
                    }}
                  >
                    {isDoneTonight ? `✓ ${cls}` : cls}
                  </button>
                );
              })}
            </div>

            {savedCurrentClassMeta && (
              <span style={{ background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', padding: '4px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: '700' }}>
                ✓ Saved by {savedCurrentClassMeta.takenBy}
              </span>
            )}
          </div>

          {/* SOFT PASTEL 4-COUNTER BAR */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '16px' }}>
            <div style={{ padding: '14px', borderRadius: '12px', background: '#f8fafc', border: '1px solid #e2e8f0', textAlign: 'center' }}>
              <div style={{ fontSize: '10px', fontWeight: '800', color: '#64748b' }}>CLASS {selectedClass} TOTAL</div>
              <div style={{ fontSize: '22px', fontWeight: '900', color: '#0f172a', marginTop: '2px' }}>{classStudents.length}</div>
            </div>
            <div style={{ padding: '14px', borderRadius: '12px', background: '#ecfdf5', border: '1px solid #a7f3d0', textAlign: 'center' }}>
              <div style={{ fontSize: '10px', fontWeight: '800', color: '#047857' }}>PRESENT</div>
              <div style={{ fontSize: '22px', fontWeight: '900', color: '#065f46', marginTop: '2px' }}>{presentInCurrentClass}</div>
            </div>
            <div style={{ padding: '14px', borderRadius: '12px', background: '#fff1f2', border: '1px solid #fecdd3', textAlign: 'center' }}>
              <div style={{ fontSize: '10px', fontWeight: '800', color: '#be123c' }}>UNEXCUSED ABSENT</div>
              <div style={{ fontSize: '22px', fontWeight: '900', color: '#e11d48', marginTop: '2px' }}>{absentInCurrentClass}</div>
            </div>
            <div style={{ padding: '14px', borderRadius: '12px', background: '#eef2ff', border: '1px solid #c7d2fe', textAlign: 'center' }}>
              <div style={{ fontSize: '10px', fontWeight: '800', color: '#4338ca' }}>LEAVE / OFFICIAL / SICK</div>
              <div style={{ fontSize: '22px', fontWeight: '900', color: '#4f46e5', marginTop: '2px' }}>{outpassInCurrentClass} / {sickInCurrentClass}</div>
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

          {/* SEARCH + QUICK ALL PRESENT + SAVE BUTTON */}
          <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="text"
              placeholder="🔍 Quick search student in this class..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              style={{ ...styles.input, maxWidth: '300px', padding: '8px 12px', fontSize: '13px' }}
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
                style={styles.buttonSecondary}
              >
                ✓ All Present
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

          {/* 🌟 MINIMALIST MOBILE-FRIENDLY STUDENT CARDS (With Official option & No Note clutter!) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(285px, 1fr))', gap: '12px' }}>
            {classStudents
              .filter(s => !searchFilter.trim() || (s.firstName || '').toLowerCase().includes(searchFilter.toLowerCase()) || String(s.adNo || '').toLowerCase().includes(searchFilter.toLowerCase()))
              .map((st, idx) => {
                const ad = String(st.adNo || '').trim();
                const curStatus = statusMap[ad] || 'PRESENT';
                const activePass = getActiveOutpassForStudent(ad);

                const cardThemes = {
                  PRESENT: { bg: '#ffffff', border: '#e2e8f0', badgeBg: '#dcfce7', badgeColor: '#15803d', label: 'Present' },
                  ABSENT: { bg: '#fff1f2', border: '#fecdd3', badgeBg: '#ffe4e6', badgeColor: '#e11d48', label: 'Absent' },
                  OUTPASS: { bg: '#eef2ff', border: '#c7d2fe', badgeBg: '#e0e7ff', badgeColor: '#4338ca', label: 'Leave' },
                  OFFICIAL: { bg: '#f0fdfa', border: '#99f6e4', badgeBg: '#ccfbf1', badgeColor: '#0f766e', label: 'Official' },
                  SICK_ROOM: { bg: '#fffbeb', border: '#fde68a', badgeBg: '#fef3c7', badgeColor: '#b45309', label: 'Sick' }
                };
                const theme = cardThemes[curStatus] || cardThemes.PRESENT;

                return (
                  <div
                    key={st.regNo}
                    onClick={() => handleCardQuickTap(ad)}
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

                      <span style={{ background: theme.badgeBg, color: theme.badgeColor, padding: '3px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: '700', whiteSpace: 'nowrap' }}>
                        {theme.label}
                      </span>
                    </div>

                    {activePass && (
                      <div style={{ background: '#f8fafc', border: '1px solid #cbd5e1', padding: '7px 10px', borderRadius: '8px', fontSize: '11px', color: '#334155', lineHeight: 1.35 }}>
                        <div style={{ fontWeight: '700' }}>
                          🪪 {activePass.leaveCategory || 'Leave'}: {activePass.destination}
                        </div>
                        <div style={{ fontSize: '10px', marginTop: '2px', color: '#64748b' }}>
                          By: {activePass.teacherName} • Return: {formatNightPassTime(activePass.permittedTo, activePass.isOpenReturn)}
                        </div>
                      </div>
                    )}

                    {/* 🌟 5 CLEAN STATUS PILLS (Pres | Abs | Leave | Official | Sick — No Note button!) */}
                    <div
                      onClick={(e) => e.stopPropagation()}
                      style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', paddingTop: '6px', borderTop: '1px solid #f1f5f9' }}
                    >
                      {[
                        { id: 'PRESENT', label: 'Pres', activeBg: '#10b981' },
                        { id: 'ABSENT', label: 'Abs', activeBg: '#e11d48' },
                        { id: 'OUTPASS', label: 'Leave', activeBg: '#4f46e5' },
                        { id: 'OFFICIAL', label: 'Official', activeBg: '#0d9488' },
                        { id: 'SICK_ROOM', label: 'Sick', activeBg: '#d97706' }
                      ].map(btn => {
                        const active = curStatus === btn.id;
                        return (
                          <button
                            key={btn.id}
                            type="button"
                            onClick={() => setStatusMap(prev => ({ ...prev, [ad]: btn.id }))}
                            style={{
                              flex: 1,
                              padding: '6px 8px',
                              borderRadius: '6px',
                              fontSize: '11px',
                              fontWeight: '700',
                              cursor: 'pointer',
                              background: active ? btn.activeBg : '#f8fafc',
                              color: active ? '#ffffff' : '#475569',
                              border: active ? `1px solid ${btn.activeBg}` : '1px solid #e2e8f0',
                              textAlign: 'center'
                            }}
                          >
                            {btn.label}
                          </button>
                        );
                      })}
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
            <button
              type="button"
              onClick={() => {
                const lines = [
                  `*🌙 DHIU DEGREE SECTION — INSTITUTION NIGHT ATTENDANCE SUMMARY*`,
                  `*Date:* ${selectedDate}`,
                  `*Total Strength:* ${instSummary.totalStrength} | *Present:* ${instSummary.totalPresent} | *Unexcused Absent:* ${instSummary.totalUnexcusedAbsent} | *Leave/Official:* ${instSummary.totalOnOutpass}`,
                  `-----------------------------------------`
                ];
                instSummary.classSummaries.forEach(c => {
                  if (!c.isTaken) {
                    lines.push(`• *${c.className}:* ⏳ Pending (CT: ${c.classTeacherName})`);
                  } else {
                    const absNames = c.absentStudents.map(s => `${s.firstName} (#${s.adNo})`).join(', ');
                    lines.push(`• *${c.className}:* Present ${c.presentCount}/${c.strength} | Absent: ${c.absentCount} | Leave: ${c.outpassCount}${absNames ? `\n   🔴 _Absent:_ ${absNames}` : ''}`);
                  }
                });
                openWhatsAppGroupAndCopy(staffGroupLink, lines.join('\n'), 'Staff WhatsApp Group');
              }}
              style={styles.buttonPrimary}
            >
              💬 Share Summary to Staff WA Group
            </button>
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
                <div style={{ padding: '16px', borderRadius: '12px', background: '#eef2ff', border: '1px solid #c7d2fe', textAlign: 'center' }}>
                  <span style={{ fontSize: '11px', fontWeight: '800', color: '#4338ca' }}>LEAVE / OFFICIAL</span>
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
    </div>
  );
}