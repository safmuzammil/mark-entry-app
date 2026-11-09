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
      const cur = prev[adNo] || 'PRESENT';
      
      return { ...prev, [adNo]: cur === 'PRESENT' ? 'ABSENT' : 'PRESENT' };
    });
  };

  const handleExtraMarkAll = (status) => {
    const newMap = { ...extraStatusMap };
    extraStudentsList.forEach(st => {
      const ad = String(st.adNo || '').trim();
      const p = getActiveOutpassForStudent(ad);
      if (p) {
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

      const targetStudents = extraBaseClassStudents.filter(st => includeUrdu || !isUrduStudent(st));

      targetStudents.forEach(st => {
        const ad = String(st.adNo || '').trim();
        const stStatus = extraStatusMap[ad] || 'PRESENT';
        if (stStatus === 'ABSENT') absentAdNos.push(ad);
        if (stStatus === 'OUTPASS') outpassAdNos.push(ad);
        if (stStatus === 'OFFICIAL') officialAdNos.push(ad);
        if (stStatus === 'SICK_ROOM') sickAdNos.push(ad);
      });

      const presentCount = targetStudents.length - absentAdNos.length - outpassAdNos.length - officialAdNos.length - sickAdNos.length;
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
        officialCount: officialAdNos.length,
        sickCount: sickAdNos.length,
        absentAdNos,
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

      // 🌟 If student has returned and verified inside campus, he is NO LONGER off-campus!
      const isReturned = st === 'RETURNED' || st === 'ARRIVED_AT_GATE' || Boolean(p.actualReturnTime || p.verifiedReturnedAt || p.teacherVerifiedTime);
      if (isReturned) return false;

      const fromYMD = isoToLocalYMD(p.permittedFrom || p.createdAt);
      const toYMD = p.isOpenReturn || !p.permittedTo
        ? (p.actualReturnTime ? isoToLocalYMD(p.actualReturnTime) : '2099-12-31')
        : isoToLocalYMD(p.actualReturnTime || p.permittedTo);

      if (selectedDate === todayStr && (st === 'OUTSIDE' || st === 'APPROVED')) {
        return !fromYMD || selectedDate >= fromYMD;
      }
      if (fromYMD && selectedDate >= fromYMD && selectedDate <= toYMD) {
        return st === 'OUTSIDE' || st === 'APPROVED';
      }
      return false;
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


      if (savedClassRecord) {
        if ((savedClassRecord.absentAdNos || []).includes(ad)) {
          newStatus[ad] = 'ABSENT';
        } else if ((savedClassRecord.officialAdNos || []).includes(ad)) {
          newStatus[ad] = 'OFFICIAL';
        } else if ((savedClassRecord.outpassAdNos || []).includes(ad)) {
          // 🌟 If saved as outpass earlier, but student has returned & verified inside campus:
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
    if (viewMode === 'extra_reports' && recordedExtraList.length === 0) {
      loadExtraAttendanceRecords();
    }
  }, [viewMode, nightRepScope]);

  const handleCardQuickTap = (adNo) => {
    setStatusMap(prev => {
      const cur = prev[adNo] || 'PRESENT';
      
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
      setClassSubmittedSuccess(selectedClass);
      if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
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
            { id: 'extra_attendance', label: '⚡ Extra Attendance (Same Day)' },
            { id: 'extra_reports', label: '📊 Extra Attendance Reports' },
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
                    onClick={() => { setSelectedClass(cls); setClassSubmittedSuccess(null); }}
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
                      <div style={{ background: '#fffbeb', border: '1px solid #fde68a', padding: '7px 10px', borderRadius: '8px', fontSize: '11px', color: '#92400e', lineHeight: 1.35 }}>
                        <div style={{ fontWeight: '700' }}>
                          🪪 Outside Campus ({activePass.leaveCategory || 'Leave'}): {activePass.destination}
                        </div>
                        <div style={{ fontSize: '10px', marginTop: '2px', color: '#b45309' }}>
                          Reason: &ldquo;{activePass.purpose || activePass.reason || 'Leave'}&rdquo; • Approved by: Usthad {activePass.teacherName}
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
              const isUrdu = isUrduStudent(st);

              let curStatus = extraStatusMap[ad];
              if (!curStatus) {
                if (activePass) {
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
                    cursor: (isOutpass || isOfficial) ? 'default' : 'pointer',
                    userSelect: 'none',
                    border: isAbsent ? '1.5px solid #fecdd3' : isOutpass ? '1.5px solid #fef08a' : isOfficial ? '1.5px solid #bae6fd' : isSick ? '1.5px solid #e9d5ff' : '1.5px solid #e2e8f0',
                    background: isAbsent ? '#fff1f2' : isOutpass ? '#fefce8' : isOfficial ? '#f0f9ff' : isSick ? '#faf5ff' : '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    boxShadow: '0 1px 2px rgba(15,23,42,0.03)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <ProfileAvatar name={st.firstName} code={ad} photoUrl={st.photoUrl} size={36} />
                    <div>
                      <div style={{ fontWeight: '700', fontSize: '13px', color: '#0f172a' }}>{st.firstName}</div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>
                        #{ad} • Roll: {st.rollNo || '—'} {isUrdu && <span style={{ background: '#fef3c7', color: '#92400e', padding: '1px 5px', borderRadius: '4px', fontSize: '10px', fontWeight: '800' }}>URDU</span>}
                      </div>
                    </div>
                  </div>

                  <span style={{
                    padding: '3px 8px',
                    borderRadius: '999px',
                    fontSize: '11px',
                    fontWeight: '800',
                    background: isAbsent ? '#e11d48' : isOutpass ? '#ca8a04' : isOfficial ? '#0284c7' : isSick ? '#9333ea' : '#10b981',
                    color: '#ffffff'
                  }}>
                    {curStatus}
                  </span>
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
          MODE 5: EXTRA ATTENDANCE REPORTS & ARCHIVE
         ========================================================= */}
      {viewMode === 'extra_reports' && (
        <div style={styles.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: '#0f172a' }}>
                📊 Extra Attendance Reports &amp; History
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>
                View and forward all same-day extra roll-calls recorded for specific events, camps, and checks.
              </p>
            </div>
            <button type="button" onClick={loadExtraAttendanceRecords} style={styles.buttonSecondary}>
              🔄 Refresh List
            </button>
          </div>

          {/* FILTER BAR */}
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px', alignItems: 'center' }}>
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

          {/* SESSIONS CARDS LIST */}
          {loadingExtraReports ? (
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
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
                          Present: <span style={{ color: '#059669' }}>{sess.presentCount}</span> / Absent: <span style={{ color: '#e11d48' }}>{sess.absentCount}</span> • Total Strength: {sess.totalStrength}
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
                          style={{ ...styles.buttonSuccess, background: '#25D366', color: '#ffffff', padding: '8px 14px', fontSize: '12px', fontWeight: '800', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                        >
                          📲 Forward to Class Teacher
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}