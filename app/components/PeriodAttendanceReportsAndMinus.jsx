'use client';
import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { db } from '../../lib/firebase';
import { doc, getDoc, getDocs, setDoc, collection, writeBatch } from 'firebase/firestore';
import { DEFAULT_CLASSES, DEFAULT_SUBJECTS, styles } from './erpConstants';
import { CollapsibleCard } from './ErpExtensions';
import { REHEARSAL_SESSIONS } from './PeriodAttendanceManager';

export default function PeriodAttendanceReportsAndMinus({
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
  syncUpdatedStudentsState,
  normalizeSubKey,
  isAttendanceOnlyEnrollment,
  isHifzEnrollment,
  setSelectedTeacherUsername,
  setAttEnrollmentId,
  setAttDate,
  setAttSession,
  setClearancePrintStudent,
  loading,
  setLoading,
  setStatusMsg
}) {
  // --- 1. REPORTS HUB STATE ---
  const [repScope, setRepScope] = useState('total'); // 'total' | 'monthly' | 'daily'
  const [repClass, setRepClass] = useState('ALL');
  const [repMonth, setRepMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [repDate, setRepDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [repTeacher, setRepTeacher] = useState(userRole === 'admin' ? 'ALL' : (loggedInUser?.username || 'ALL'));
  const [repSubject, setRepSubject] = useState('ALL');
  const [repMinusMode, setRepMinusMode] = useState('both'); // 'both' | 'with_minus' | 'without_minus'
  const [repSearch, setRepSearch] = useState('');
  const [dailySessionsCache, setDailySessionsCache] = useState([]);
  const [loadingReport, setLoadingReport] = useState(false);
  const [showReportFilters, setShowReportFilters] = useState(false);

  // --- 2. MINUS ATTENDANCE STATE ---
  const [minusSubTab, setMinusSubTab] = useState('add'); // 'add' | 'manage' | 'excel'
  const [minusSearchQuery, setMinusSearchQuery] = useState('');
  const [selectedMinusStudent, setSelectedMinusStudent] = useState(null);
  const [selectedMinusStudentsList, setSelectedMinusStudentsList] = useState([]);
  const [minusCount, setMinusCount] = useState(1);
  const [minusReason, setMinusReason] = useState('');
  const [editingMinusLog, setEditingMinusLog] = useState(null);
  const [minusTableSearch, setMinusTableSearch] = useState('');
  const [minusTeacherFilter, setMinusTeacherFilter] = useState('ALL');

  // --- 3. MULTI-STUDENT 3-STEP CLEARANCE & SHORTAGE STATE ---
  const [clearAdNo, setClearAdNo] = useState('');
  const [fetchedClearStudentsList, setFetchedClearStudentsList] = useState([]);
  const [fetchedAbsentSubjects, setFetchedAbsentSubjects] = useState([]);
  const [showAllClearSubjects, setShowAllClearSubjects] = useState(false);
  const [clearReason, setClearReason] = useState('official');
  const [clearDateMode, setClearDateMode] = useState('single');
  const [clearDate, setClearDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [clearStartDate, setClearStartDate] = useState('');
  const [clearEndDate, setClearEndDate] = useState('');
  const [clearSelectedSubjects, setClearSelectedSubjects] = useState([]);
  const [deleteAllPassword, setDeleteAllPassword] = useState('');
  const [deleteAllConfirmText, setDeleteAllConfirmText] = useState('');
  const [shortageClassFilter, setShortageClassFilter] = useState('ALL');
  const [importAuditReport, setImportAuditReport] = useState(null);

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

  // Smart Teacher Ownership Matcher
  const canUserModifyMinusLog = (logItem) => {
    if (userRole === 'admin') return true;
    const myUser = String(loggedInUser?.username || activeTeacherObj?.username || '').trim().toLowerCase();
    const myFullName = String(loggedInUser?.fullName || activeTeacherObj?.fullName || '').trim().toLowerCase();
    const issuerUser = String(logItem?.issuedByUsername || '').trim().toLowerCase();
    const issuerName = String(logItem?.issuedBy || '').trim().toLowerCase();

    if (myUser && issuerUser && myUser === issuerUser) return true;
    if (myFullName && issuerName && (issuerName.includes(myFullName) || myFullName.includes(issuerName))) return true;

    const stopWords = new Set(['muhammed', 'mohammed', 'mohd', 'abdul', 'abdu', 'sayyid', 'hudawi', 'baqavi', 'faisy', 'al', 'usthad', 'sir', 'admin', 'central', 'faculty', 'user']);
    const myTokens = myFullName.split(/[\s._-]+/).filter(w => w.length >= 4 && !stopWords.has(w));
    const issuerTokens = issuerName.split(/[\s._-]+/).filter(w => w.length >= 4 && !stopWords.has(w));

    return myTokens.length > 0 && issuerTokens.some(t => myTokens.includes(t));
  };

  const lastMinusToken = minusSearchQuery.split(',').pop().trim().toLowerCase();
  const matchingMinusStudents = lastMinusToken.length >= 1
    ? localStudents.filter(s => {
        const ad = String(s.adNo || '').toLowerCase();
        const nm = String(s.firstName || '').toLowerCase();
        const rg = String(s.regNo || '').toLowerCase();
        return ad.includes(lastMinusToken) || nm.includes(lastMinusToken) || rg.includes(lastMinusToken);
      }).slice(0, 10)
    : [];

  const handleAddCommaSeparatedMinusStudents = () => {
    const tokens = minusSearchQuery.split(/[,;\n]+/).map(t => t.replace(/^#/, '').trim().toLowerCase()).filter(Boolean);
    if (tokens.length === 0) return alert('Type one or more Admission Numbers or Student Names separated by commas.');

    const newlyFound = [];
    const unmatchedTokens = [];

    tokens.forEach(tok => {
      let match = localStudents.find(
        s => String(s.adNo || '').trim().toLowerCase() === tok ||
             String(s.regNo || '').trim().toLowerCase() === tok
      );
      if (!match) {
        match = localStudents.find(s => String(s.firstName || '').trim().toLowerCase() === tok) ||
                localStudents.find(s => String(s.firstName || '').trim().toLowerCase().includes(tok));
      }
      if (match) {
        if (!newlyFound.some(x => x.regNo === match.regNo)) newlyFound.push(match);
      } else {
        unmatchedTokens.push(tok);
      }
    });

    if (newlyFound.length === 0) {
      return alert(`No matching students found for: ${unmatchedTokens.join(', ')}`);
    }

    setSelectedMinusStudentsList(prev => {
      const map = new Map(prev.map(s => [s.regNo, s]));
      newlyFound.forEach(s => map.set(s.regNo, s));
      return Array.from(map.values());
    });
    setSelectedMinusStudent(newlyFound[0]);
    setEditingMinusLog(null);
    setMinusSearchQuery('');
  };

  const handleSaveMinus = async (e) => {
    e.preventDefault();
    if (!minusReason.trim()) return alert('Please enter a reason.');

    const targetStudents = editingMinusLog
      ? (selectedMinusStudent ? [selectedMinusStudent] : [])
      : (selectedMinusStudentsList.length > 0 ? selectedMinusStudentsList : selectedMinusStudent ? [selectedMinusStudent] : []);

    if (targetStudents.length === 0) return alert('Please select or add at least one student first.');

    setLoading(true);
    try {
      if (editingMinusLog) {
        const st = localStudents.find(s => s.regNo === selectedMinusStudent.regNo) || selectedMinusStudent;
        const docId = String(st.id || st.regNo).toLowerCase().trim();
        const curStat = JSON.parse(JSON.stringify(getStudentAttStat(st)));

        if (!canUserModifyMinusLog(editingMinusLog)) {
          setLoading(false);
          return alert('⛔ Permission Denied: You can only edit minus entries that YOU issued.');
        }

        const updatedLogs = (curStat.minusLogs || []).map(l => {
          if (l.id === editingMinusLog.id) {
            return { ...l, count: Number(minusCount), reason: minusReason.trim(), editedAt: new Date().toISOString().split('T')[0] };
          }
          return l;
        });

        curStat.minusLogs = updatedLogs;
        curStat.minusCount = updatedLogs.reduce((sum, item) => sum + (Number(item.count) || 0), 0);

        await setDoc(doc(db, 'students', docId), { periodAttendance: curStat }, { merge: true });
        const updatedSt = { ...st, periodAttendance: curStat };
        setSelectedMinusStudent(updatedSt);
        setSelectedMinusStudentsList(prev => prev.map(x => x.regNo === updatedSt.regNo ? updatedSt : x));
        syncUpdatedStudentsState({ [st.regNo]: updatedSt });

        setStatusMsg(`✅ Updated minus entry for ${st.firstName} to -${minusCount} period(s).`);
        setEditingMinusLog(null); setMinusReason(''); setMinusCount(1);
      } else {
        const batch = writeBatch(db);
        const updatedMap = {};
        const todayStr = new Date().toISOString().split('T')[0];

        targetStudents.forEach((targetSt, idx) => {
          const st = localStudents.find(s => s.regNo === targetSt.regNo) || targetSt;
          const docId = String(st.id || st.regNo).toLowerCase().trim();
          const curStat = JSON.parse(JSON.stringify(getStudentAttStat(st)));

          const newLog = {
            id: `minus_${Date.now()}_${idx}`,
            date: todayStr,
            count: Number(minusCount),
            reason: minusReason.trim(),
            issuedBy: loggedInUser?.fullName || activeTeacherObj?.fullName || 'Admin',
            issuedByUsername: String(loggedInUser?.username || activeTeacherObj?.username || 'admin').toLowerCase()
          };

          const updatedLogs = [newLog, ...(curStat.minusLogs || [])];
          curStat.minusLogs = updatedLogs;
          curStat.minusCount = updatedLogs.reduce((sum, item) => sum + (Number(item.count) || 0), 0);

          batch.set(doc(db, 'students', docId), { periodAttendance: curStat }, { merge: true });
          updatedMap[st.regNo] = { ...st, periodAttendance: curStat };
        });

        await batch.commit();
        syncUpdatedStudentsState(updatedMap);

        const lastTarget = updatedMap[targetStudents[0].regNo];
        if (lastTarget) setSelectedMinusStudent(lastTarget);
        setSelectedMinusStudentsList(targetStudents.map(s => updatedMap[s.regNo] || s));

        setStatusMsg(`✅ Deducted -${minusCount} period(s) from ${targetStudents.length} student(s)!`);
        setMinusReason(''); setMinusCount(1);
      }
    } catch (error) {
      setStatusMsg('❌ Error: ' + error.message);
    } finally {
      setLoading(false);
      setTimeout(() => setStatusMsg(''), 6000);
    }
  };

  const handleDeleteMinus = async (studentObj, logItem) => {
    if (!canUserModifyMinusLog(logItem)) {
      return alert('⛔ Permission Denied: You can only delete minus entries that YOU issued.');
    }
    if (!window.confirm(`Delete minus record (-${logItem.count}) and restore attendance to ${studentObj.firstName}?`)) return;
    setLoading(true);
    try {
      const docId = String(studentObj.id || studentObj.regNo).toLowerCase().trim();
      const curStat = JSON.parse(JSON.stringify(getStudentAttStat(studentObj)));

      const updatedLogs = (curStat.minusLogs || []).filter(l => l.id !== logItem.id);
      curStat.minusLogs = updatedLogs;
      curStat.minusCount = updatedLogs.reduce((sum, item) => sum + (Number(item.count) || 0), 0);

      await setDoc(doc(db, 'students', docId), { periodAttendance: curStat }, { merge: true });
      const updatedSt = { ...studentObj, periodAttendance: curStat };
      setSelectedMinusStudent(updatedSt);
      syncUpdatedStudentsState({ [studentObj.regNo]: updatedSt });

      if (editingMinusLog?.id === logItem.id) {
        setEditingMinusLog(null); setMinusReason(''); setMinusCount(1);
      }
      setStatusMsg(`✅ Minus entry deleted and ${logItem.count} period(s) restored!`);
    } catch (error) {
      setStatusMsg('❌ Error: ' + error.message);
    } finally {
      setLoading(false);
      setTimeout(() => setStatusMsg(''), 5000);
    }
  };

  const allFlattenedMinusRecords = React.useMemo(() => {
    const rows = [];
    const myStudentRegs = new Set();
    if (userRole !== 'admin') {
      attendanceEnrollments.forEach(env => {
        getStudentsForEnrollment(env).forEach(s => myStudentRegs.add(s.regNo));
      });
    }

    localStudents.forEach(st => {
      const stat = getStudentAttStat(st);
      (stat.minusLogs || []).forEach(log => {
        const isMine = canUserModifyMinusLog(log);
        if (userRole !== 'admin') {
          if (minusTeacherFilter === 'ALL_STUDENTS') {
            if (!isMine && !myStudentRegs.has(st.regNo)) return;
          } else {
            if (!isMine) return;
          }
        } else if (minusTeacherFilter !== 'ALL' && String(log.issuedBy || '').toUpperCase() !== minusTeacherFilter.toUpperCase()) {
          return;
        }

        if (minusTableSearch.trim()) {
          const q = minusTableSearch.trim().toLowerCase();
          const matchName = String(st.firstName || '').toLowerCase().includes(q);
          const matchAd = String(st.adNo || '').toLowerCase().includes(q);
          const matchReason = String(log.reason || '').toLowerCase().includes(q);
          if (!matchName && !matchAd && !matchReason) return;
        }
        rows.push({ studentObj: st, rollNo: st.rollNo || 0, studentName: st.firstName, adNo: st.adNo, className: (st.classes || []).join(', '), isMine, log });
      });
    });
    return rows.sort((a, b) => String(b.log.date || '').localeCompare(String(a.log.date || '')));
  }, [localStudents, userRole, minusTeacherFilter, minusTableSearch, loggedInUser, activeTeacherObj]);

  const handleExportMinusRecordsExcel = () => {
    const data = allFlattenedMinusRecords.map(r => ({
      'Roll No': r.rollNo, 'Student Name': r.studentName, 'Admission No': r.adNo,
      'Class': r.className, 'Minus': -Math.abs(Number(r.log.count) || 0),
      'Reason': r.log.reason || '—', 'Date': r.log.date || '—', 'Issued By': r.log.issuedBy || 'Admin'
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Minus_Attendance');
    XLSX.writeFile(wb, `Minus_Attendance_Records_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleBulkMinusExcelUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      const batch = writeBatch(db);
      const updatedMap = {};
      let addedCount = 0;
      const todayStr = new Date().toISOString().split('T')[0];

      rows.forEach((row, idx) => {
        const rawAd = row['Adm. No.'] || row['Admission No'] || row.adNo || row.AdNo || row.admissionNumber;
        const rawMinus = Math.abs(Number(row.Minus ?? row.minus ?? row.Count ?? row.count ?? 0));
        if (!rawAd || !rawMinus) return;

        const cleanAd = String(rawAd).trim().toUpperCase();
        const st = localStudents.find(s => String(s.adNo || '').trim().toUpperCase() === cleanAd);
        if (!st) return;

        const baseSt = updatedMap[st.regNo] || st;
        const curStat = JSON.parse(JSON.stringify(getStudentAttStat(baseSt)));
        const newLog = {
          id: `excel_minus_${Date.now()}_${idx}`,
          date: row.Date || row.date || todayStr,
          count: rawMinus,
          reason: String(row.Reason || row.reason || 'Disciplinary Deduction').trim(),
          issuedBy: row.By || row['Issued By'] || loggedInUser?.fullName || 'ADMIN USER',
          issuedByUsername: String(loggedInUser?.username || 'admin').toLowerCase()
        };
        curStat.minusLogs = [newLog, ...(curStat.minusLogs || [])];
        curStat.minusCount = curStat.minusLogs.reduce((sum, l) => sum + (Number(l.count) || 0), 0);

        const docId = String(st.id || st.regNo).toLowerCase().trim();
        batch.set(doc(db, 'students', docId), { periodAttendance: curStat }, { merge: true });
        updatedMap[st.regNo] = { ...st, periodAttendance: curStat };
        addedCount++;
      });

      if (addedCount > 0) {
        await batch.commit();
        syncUpdatedStudentsState(updatedMap);
      }
      setStatusMsg(`✅ Uploaded ${addedCount} minus record(s) from Excel!`);
      setMinusSubTab('manage');
    } catch (err) {
      alert('Excel upload error: ' + err.message);
    } finally {
      setLoading(false);
      e.target.value = null;
    }
  };

  const toggleClearanceSubject = (sub) => {
    setClearSelectedSubjects(prev => prev.includes(sub) ? prev.filter(s => s !== sub) : [...prev, sub]);
  };

  const handleFetchStudentForClearance = () => {
    if (!clearAdNo.trim()) return alert('Please enter one or more Student Admission Numbers (e.g. 3551, U1107).');

    const tokens = clearAdNo.split(/[,;\n]+/).map(t => t.replace(/^#/, '').trim().toUpperCase()).filter(Boolean);
    const foundStudents = [];
    const unmatched = [];

    tokens.forEach(tok => {
      const match = localStudents.find(
        s => String(s.adNo || '').trim().toUpperCase() === tok ||
             String(s.regNo || '').trim().toUpperCase() === tok
      );
      if (match) {
        if (!foundStudents.some(x => x.regNo === match.regNo)) foundStudents.push(match);
      } else {
        unmatched.push(tok);
      }
    });

    if (foundStudents.length === 0) {
      setFetchedClearStudentsList([]);
      setFetchedAbsentSubjects([]);
      return alert(`No students found for: ${unmatched.join(', ')}`);
    }

    setFetchedClearStudentsList(foundStudents);
    setClearSelectedSubjects([]);

    const subSet = new Set();
    foundStudents.forEach(st => {
      const stat = getStudentAttStat(st);
      const subWise = stat.subjectWise || {};
      Object.entries(subWise).forEach(([subKey, sObj]) => {
        const absDates = Array.isArray(sObj.absentDates) ? sObj.absentDates : [];
        const hasAbsenceInScope = absDates.some(d =>
          clearDateMode === 'single' ? d === clearDate : ((!clearStartDate || d >= clearStartDate) && (!clearEndDate || d <= clearEndDate))
        );
        if (hasAbsenceInScope) subSet.add(subKey);
      });
    });

    const matchedSubs = Array.from(subSet);
    setFetchedAbsentSubjects(matchedSubs);
    setShowAllClearSubjects(matchedSubs.length === 0);
  };

  const handleSaveClearance = async (e) => {
    e.preventDefault();
    if (fetchedClearStudentsList.length === 0) return alert('Please fetch students first.');
    if (clearSelectedSubjects.length === 0) return alert('Select at least one subject to clear.');

    setLoading(true);
    try {
      const batch = writeBatch(db);
      const updatedMap = {};

      fetchedClearStudentsList.forEach(student => {
        const docId = String(student.id || student.regNo).toLowerCase().trim();
        const curStat = JSON.parse(JSON.stringify(getStudentAttStat(student)));
        if (!curStat.subjectWise) curStat.subjectWise = {};

        clearSelectedSubjects.forEach(sub => {
          const subKey = normalizeSubKey(sub);
          if (!curStat.subjectWise[subKey]) {
            curStat.subjectWise[subKey] = { total: 0, present: 0, official: 0, medical: 0, permitted: 0, absentDates: [] };
          }
          const subObj = curStat.subjectWise[subKey];
          if (!Array.isArray(subObj.absentDates)) subObj.absentDates = [];

          const matchingDates = subObj.absentDates.filter(d =>
            clearDateMode === 'single' ? d === clearDate : (d >= clearStartDate && d <= clearEndDate)
          );
          const countToClear = Math.max(1, matchingDates.length);

          if (clearReason === 'official') {
            curStat.presentCount = Math.min(curStat.totalPeriods || 9999, (curStat.presentCount || 0) + countToClear);
            curStat.officialCount = (curStat.officialCount || 0) + countToClear;
            subObj.present = Math.min(subObj.total || 9999, (subObj.present || 0) + countToClear);
            subObj.official = (subObj.official || 0) + countToClear;
            subObj.absentDates = subObj.absentDates.filter(d => !matchingDates.includes(d));
          } else if (clearReason === 'medical') {
            curStat.medicalCount = (curStat.medicalCount || 0) + countToClear;
            subObj.medical = (subObj.medical || 0) + countToClear;
          } else {
            curStat.permittedCount = (curStat.permittedCount || 0) + countToClear;
            subObj.permitted = (subObj.permitted || 0) + countToClear;
          }
        });

        batch.set(doc(db, 'students', docId), { periodAttendance: curStat }, { merge: true });
        updatedMap[student.regNo] = { ...student, periodAttendance: curStat };
      });

      await batch.commit();
      syncUpdatedStudentsState(updatedMap);
      setStatusMsg(`✅ Applied [${clearReason.toUpperCase()}] clearance for ${fetchedClearStudentsList.length} student(s)!`);
      setClearSelectedSubjects([]);
    } catch (err) {
      setStatusMsg('❌ Error: ' + err.message);
    } finally {
      setLoading(false);
      setTimeout(() => setStatusMsg(''), 6000);
    }
  };

  const handleCompleteAttendanceDeleteAll = async () => {
    if (deleteAllConfirmText.trim() !== 'DELETE ALL') return alert('Please type exact confirmation: DELETE ALL');
    if (!deleteAllPassword.trim()) return alert('Please enter your admin account password.');
    if (!window.confirm('🚨 CRITICAL WARNING: This will permanently reset period attendance records for all students. Proceed?')) return;

    setLoading(true);
    try {
      const updatedMap = {};
      for (let i = 0; i < localStudents.length; i += 400) {
        const chunk = localStudents.slice(i, i + 400);
        const batch = writeBatch(db);
        chunk.forEach(st => {
          const docId = String(st.id || st.regNo).toLowerCase().trim();
          const emptyStat = {
            totalPeriods: 0, presentCount: 0, officialCount: 0, medicalCount: 0,
            permittedCount: 0, minusCount: 0, minusLogs: [], subjectWise: {},
            updatedAt: new Date().toISOString()
          };
          batch.set(doc(db, 'students', docId), { periodAttendance: emptyStat }, { merge: true });
          updatedMap[st.regNo] = { ...st, periodAttendance: emptyStat };
        });
        await batch.commit();
      }
      syncUpdatedStudentsState(updatedMap);
      setDeleteAllPassword(''); setDeleteAllConfirmText('');
      setStatusMsg('✅ All student period attendance records have been reset.');
    } catch (err) {
      alert('Error deleting attendance: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

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
        if (!map[reg][rDate]) map[reg][rDate] = { sessionsDone: new Set(), weightEarned: 0 };
        const entry = map[reg][rDate];
        if (!entry.sessionsDone.has(sessId)) {
          entry.sessionsDone.add(sessId);
          entry.weightEarned += weight;
        }
      });
    });
    return map;
  };

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
        for (const sKey of subKeys) {
          if (creditsToApply <= 0) break;
          const sObj = nextStat.subjectWise[sKey];
          if (!sObj || !Array.isArray(sObj.absentDates)) continue;
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
      }
      if (clearedOnThisDate > 0) {
        nextStat.appliedRehearsalDates[rehDateStr] = alreadyAppliedOnDate + clearedOnThisDate;
      }
    });
    return { stat: nextStat, cleared: totalClearedForStudent };
  };

  const handleImportOldShuhoodFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setImportAuditReport(null);
    setStatusMsg('⏳ Importing old Shuhood attendance and minus history...');

    try {
      const ext = file.name.split('.').pop().toLowerCase();
      const updatedMap = {};
      let importedCount = 0;
      const notFoundInNewApp = [];
      const nameDiffWarnings = [];
      const matchedNewRegs = new Set();

      if (ext === 'json') {
        const textContent = await file.text();
        const jsonMap = JSON.parse(textContent);
        const entries = Array.isArray(jsonMap) ? jsonMap : Object.entries(jsonMap).map(([k, v]) => ({ jsonKey: k, ...v }));

        for (let i = 0; i < entries.length; i += 400) {
          const chunk = entries.slice(i, i + 400);
          const batch = writeBatch(db);

          chunk.forEach(item => {
            const rawAd = item.adNo || item.admissionNumber || item.admission_number || item.jsonKey || '';
            const cleanAd = String(rawAd).trim().toUpperCase();
            if (!cleanAd) return;

            const st = localStudents.find(s =>
              String(s.adNo || '').trim().toUpperCase() === cleanAd ||
              String(s.regNo || '').trim().toUpperCase() === cleanAd ||
              String(s.id || '').trim().toUpperCase() === cleanAd
            );

            if (!st) {
              notFoundInNewApp.push({
                adNo: cleanAd,
                oldName: item.studentName || item.name || 'Unknown',
                oldClass: item.className || item.class || '-',
                totalPeriods: Number(item.totalPeriods) || 0,
                presentCount: Number(item.presentCount) || 0,
                minusCount: Number(item.minusCount) || 0
              });
              return;
            }

            matchedNewRegs.add(st.regNo);

            let calcTotal = Number(item.totalPeriods) || 0;
            let calcPresent = Number(item.presentCount) || 0;
            const subjData = item.subjectWise || item.subjects || {};

            if (calcTotal === 0 && Object.keys(subjData).length > 0) {
              Object.values(subjData).forEach(subObj => {
                calcTotal += Number(subObj.total || subObj.totalPeriods) || 0;
                calcPresent += Number(subObj.present || subObj.presentCount) || 0;
              });
            }

            const docId = String(st.id || st.regNo).toLowerCase().trim();
            const periodAttendance = {
              totalPeriods: calcTotal,
              presentCount: calcPresent,
              officialCount: Number(item.officialCount) || 0,
              medicalCount: Number(item.medicalCount) || 0,
              permittedCount: 0,
              minusCount: Number(item.minusCount) || Number(item.totalMinusCount) || 0,
              minusLogs: Array.isArray(item.minusLogs) ? item.minusLogs : [],
              subjectWise: subjData,
              appliedRehearsalDates: {},
              updatedAt: new Date().toISOString()
            };

            batch.set(doc(db, 'students', docId), { periodAttendance }, { merge: true });
            updatedMap[st.regNo] = { ...st, periodAttendance };
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
          const oldName = row.studentName || row['Student Name'] || row.name || 'Unknown';
          const oldClass = row.className || row.Class || '-';
          const totalP = Number(row.totalAttendanceCount ?? row.TotalPeriods ?? 0);
          const presentP = Number(row.totalPresentCount ?? row.PresentPeriods ?? 0);
          const minusC = Number(row.minusCount ?? row.MinusCount ?? 0);

          const st = localStudents.find(s =>
            String(s.adNo || '').trim().toUpperCase() === cleanAd ||
            String(s.regNo || '').trim().toUpperCase() === cleanAd
          );

          if (!st) {
            notFoundInNewApp.push({ adNo: cleanAd, oldName, oldClass, totalPeriods: totalP, presentCount: presentP, minusCount: minusC });
            return;
          }

          matchedNewRegs.add(st.regNo);
          const docId = String(st.id || st.regNo).toLowerCase().trim();
          const cur = getStudentAttStat(st);
          const periodAttendance = {
            ...cur,
            totalPeriods: totalP || cur.totalPeriods || 0,
            presentCount: presentP || cur.presentCount || 0,
            minusCount: minusC || cur.minusCount || 0,
            updatedAt: new Date().toISOString()
          };

          batch.set(doc(db, 'students', docId), { periodAttendance }, { merge: true });
          updatedMap[st.regNo] = { ...st, periodAttendance };
          importedCount++;
        });
        await batch.commit();
      }

      const missingFromOldExport = localStudents
        .filter(s => !matchedNewRegs.has(s.regNo))
        .map(s => ({ adNo: s.adNo, name: s.firstName, className: (s.classes || []).join(', ') }));

      setImportAuditReport({ importedCount, totalAutoCleared: 0, notFoundInNewApp, nameDiffWarnings, missingFromOldExport });
      syncUpdatedStudentsState(updatedMap);
      setStatusMsg(`🎉 Successfully imported semester attendance history and minus logs for ${importedCount} students!`);
    } catch (err) {
      setStatusMsg('❌ Import error: ' + err.message);
    } finally {
      setLoading(false);
      e.target.value = null;
    }
  };

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* ============================================================
          VIEW A: SHUHOOD-STYLE MONTHLY, DAILY & TOTAL REPORTS HUB
         ============================================================ */}
      {activeTab === 'reports_hub' && (() => {
        const teacherAllowedClassesSet = new Set();
        const teacherAllowedStudentRegs = new Set();
        const subjectColsSet = new Set();

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
        } else if (repTeacher !== 'ALL') {
          const tObj = localTeachers.find(t => t.username === repTeacher);
          (tObj?.enrollments || []).filter(e => !isHifzEnrollment(e)).forEach(env => {
            subjectColsSet.add(normalizeSubKey(isAttendanceOnlyEnrollment(env) ? (env.alias || env.subject) : env.subject));
          });
        }

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

        const handleExportReportMatrixExcel = () => {
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

            const grossPct = totP > 0 ? Number(((presP / totP) * 100).toFixed(2)) : 100;
            const netPres = Math.max(0, presP - minusC);
            const netPct = totP > 0 ? Number(((netPres / totP) * 100).toFixed(2)) : 100;

            const rowObj = {
              '#': idx + 1,
              'STUDENT NAME': st.firstName,
              'ADMISSION NO': st.adNo,
              'CLASS': (st.classes || []).join(', '),
              'GROSS % (NO MINUS)': `${grossPct}%`,
              'MINUS': -minusC,
              'OVERALL % (WITH MINUS)': `${netPct}%`
            };

            subjectColumns.forEach(subKey => {
              const sObj = sw[subKey];
              if (!sObj || !sObj.total) {
                rowObj[subKey] = '-';
              } else if (repScope === 'monthly') {
                const mAbs = (sObj.absentDates || []).filter(d => String(d).startsWith(repMonth)).length;
                const mPres = Math.max(0, sObj.total - mAbs);
                rowObj[subKey] = `${((mPres / sObj.total) * 100).toFixed(2)}% (${mPres}/${sObj.total})`;
              } else {
                rowObj[subKey] = `${((sObj.present / sObj.total) * 100).toFixed(2)}% (${sObj.present}/${sObj.total})`;
              }
            });
            return rowObj;
          });

          const ws = XLSX.utils.json_to_sheet(rows);
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, ws, 'Attendance_Report');
          XLSX.writeFile(wb, `Attendance_${repScope.toUpperCase()}_${repClass}.xlsx`);
        };

        return (
          <div style={{ background: '#ffffff', padding: '26px', borderRadius: '18px', border: '1px solid #cbd5e1', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', borderBottom: '2px solid #f1f5f9', paddingBottom: '16px' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '22px', fontWeight: '900', color: '#0f172a' }}>
                  {repScope === 'monthly' ? 'Monthly Report' : repScope === 'daily' ? 'Daily Session Report & Quick Edit' : 'Total Semester Attendance Report'}
                </h2>
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b', fontWeight: '600' }}>
                  {userRole === 'admin'
                    ? 'Institution-wide class, subject, teacher, and minus-adjusted attendance matrix.'
                    : `Showing summaries strictly for your ${subjectColsSet.size} assigned subject(s) and enrolled students.`}
                </p>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setShowReportFilters(prev => !prev)}
                  style={{ padding: '9px 16px', borderRadius: '8px', border: '1px solid #cbd5e1', background: showReportFilters ? '#4f46e5' : '#ffffff', color: showReportFilters ? '#ffffff' : '#334155', fontWeight: '700', fontSize: '13px', cursor: 'pointer' }}
                >
                  🎛️ {showReportFilters ? 'Hide Filters' : 'Filter Options'}
                </button>
                <button
                  type="button"
                  onClick={handleExportReportMatrixExcel}
                  style={{ padding: '11px 20px', background: '#059669', color: '#ffffff', border: 'none', borderRadius: '10px', fontWeight: '800', fontSize: '13px', cursor: 'pointer' }}
                >
                  ⬇️ Export Excel
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', background: '#f8fafc', padding: '14px 18px', borderRadius: '14px', border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {[
                  { id: 'total', label: '📈 Total Semester Summary' },
                  { id: 'monthly', label: '🗓️ Monthly Report (By Month)' },
                  { id: 'daily', label: '📅 Specific Date (9 Periods & Edit)' }
                ].map(tab => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setRepScope(tab.id)}
                    style={{
                      padding: '9px 16px',
                      borderRadius: '8px',
                      border: 'none',
                      fontWeight: '800',
                      fontSize: '13px',
                      cursor: 'pointer',
                      background: repScope === tab.id ? '#4f46e5' : '#ffffff',
                      color: repScope === tab.id ? '#ffffff' : '#334155'
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: '800', color: '#475569' }}>Minus Display:</span>
                <select
                  value={repMinusMode}
                  onChange={e => setRepMinusMode(e.target.value)}
                  style={{ ...styles.input, width: 'auto', padding: '8px 12px', fontSize: '12px', fontWeight: '800' }}
                >
                  <option value="both">Show Both (Gross % &amp; Net %)</option>
                  <option value="with_minus">Minus Affected Only (Net %)</option>
                  <option value="without_minus">Without Minus Only (Gross %)</option>
                </select>
              </div>
            </div>

            {/* 🌟 TOGGLEABLE ADVANCED FILTERS GRID */}
            {showReportFilters && (
              <div className="erp-slide-panel" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))', gap: '14px', alignItems: 'end', background: '#ffffff', padding: '18px', borderRadius: '14px', border: '1px solid #cbd5e1' }}>
                <div>
                  <label style={styles.label}>Select Class:</label>
                  <select value={repClass} onChange={e => setRepClass(e.target.value)} style={styles.input}>
                    <option value="ALL">{userRole === 'admin' ? 'All Classes' : `All My Classes (${availableClassesForDropdown.length})`}</option>
                    {availableClassesForDropdown.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                {repScope === 'monthly' && (
                  <div>
                    <label style={styles.label}>Select Month:</label>
                    <input type="month" value={repMonth} onChange={e => setRepMonth(e.target.value)} style={styles.input} />
                  </div>
                )}

                {repScope === 'daily' && (
                  <div>
                    <label style={styles.label}>Select Specific Date:</label>
                    <input type="date" value={repDate} onChange={e => setRepDate(e.target.value)} style={styles.input} />
                  </div>
                )}

                {userRole === 'admin' && (
                  <div>
                    <label style={styles.label}>Filter by Teacher:</label>
                    <select value={repTeacher} onChange={e => { setRepTeacher(e.target.value); setRepSubject('ALL'); }} style={styles.input}>
                      <option value="ALL">All Teachers</option>
                      {localTeachers.filter(t => !t.isEventLeader).map(t => (
                        <option key={t.username} value={t.username}>{t.fullName}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label style={styles.label}>{userRole === 'admin' ? 'Filter by Subject:' : 'My Subjects:'}</label>
                  <select value={repSubject} onChange={e => setRepSubject(e.target.value)} style={styles.input}>
                    <option value="ALL">{userRole === 'admin' ? `All Subjects (${subjectColsSet.size})` : `All My Subjects (${subjectColsSet.size})`}</option>
                    {Array.from(subjectColsSet).map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>

                <div>
                  <label style={styles.label}>Search Student:</label>
                  <input type="text" value={repSearch} onChange={e => setRepSearch(e.target.value)} placeholder="Name or Ad.No..." style={styles.input} />
                </div>
              </div>
            )}

            {repScope === 'daily' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div style={{ fontWeight: '900', fontSize: '15px', color: '#0f172a' }}>
                  📅 Recorded Period Sessions on {repDate} ({dailySessionsCache.length} Sessions Found)
                </div>
                {loadingReport ? (
                  <div style={{ padding: '24px', textAlign: 'center', color: '#64748b', fontWeight: '700' }}>Loading sessions for {repDate}...</div>
                ) : dailySessionsCache.length === 0 ? (
                  <div style={{ padding: '24px', background: '#f8fafc', borderRadius: '12px', textAlign: 'center', color: '#64748b', fontWeight: '700' }}>
                    No period sessions recorded in the new portal for {repDate} yet.
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
                    {dailySessionsCache
                      .filter(s => userRole === 'admin' || s.teacherUsername === loggedInUser?.username)
                      .map(sess => {
                        const mapVals = Object.values(sess.attendanceMap || {});
                        const presC = mapVals.filter(v => v === 'P' || v === 'O').length;
                        const absC = mapVals.length - presC;
                        return (
                          <div key={sess.id} style={{ padding: '14px 16px', borderRadius: '12px', border: '1px solid #cbd5e1', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                            <div>
                              <span style={{ background: '#4f46e5', color: '#ffffff', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: '900' }}>
                                Period {sess.session}
                              </span>
                              <div style={{ fontWeight: '900', fontSize: '15px', color: '#0f172a', marginTop: '4px' }}>
                                {sess.classAlias || sess.subject}
                              </div>
                              <div style={{ fontSize: '12px', color: '#475569', fontWeight: '700' }}>
                                👨‍🏫 {sess.teacherName} • ✅ {presC} Pres / ❌ {absC} Abs
                              </div>
                            </div>
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
                              style={{ padding: '8px 12px', background: '#f59e0b', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '800', fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                            >
                              ✏️ Edit Session
                            </button>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            )}

            <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '14px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left', minWidth: '900px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', color: '#475569', fontSize: '11px', fontWeight: '900', textTransform: 'uppercase' }}>
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
                      <tr key={st.regNo} style={{ borderBottom: '1px solid #f1f5f9', background: idx % 2 === 0 ? '#ffffff' : '#fcfdff' }}>
                        <td style={{ padding: '14px 12px', color: '#64748b', fontWeight: '700' }}>{idx + 1}</td>
                        <td style={{ padding: '14px 12px', fontWeight: '800', color: '#0f172a' }}>{st.firstName}</td>
                        <td style={{ padding: '14px 12px', fontWeight: '700', color: '#475569' }}>{st.adNo}</td>

                        {(repMinusMode === 'both' || repMinusMode === 'without_minus') && (
                          <td style={{ padding: '14px 12px', textAlign: 'center' }}>
                            <span style={{ background: '#ecfdf5', color: '#047857', padding: '4px 10px', borderRadius: '999px', fontWeight: '800', fontSize: '12px' }}>
                              {totP > 0 ? `${grossPct}%` : '-'}
                            </span>
                          </td>
                        )}

                        {(repMinusMode === 'both' || repMinusMode === 'with_minus') && (
                          <>
                            <td style={{ padding: '14px 12px', textAlign: 'center', fontWeight: '800', color: minusC > 0 ? '#dc2626' : '#94a3b8' }}>
                              {minusC > 0 ? `-${minusC}` : '0'}
                            </td>
                            <td style={{ padding: '14px 12px', textAlign: 'center' }}>
                              <span style={{
                                background: Number(netPct) < 85 ? '#fef2f2' : '#eef2ff',
                                color: Number(netPct) < 85 ? '#dc2626' : '#4f46e5',
                                padding: '4px 10px',
                                borderRadius: '999px',
                                fontWeight: '900',
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
                            return <td key={subKey} style={{ padding: '14px 12px', textAlign: 'center', color: '#94a3b8' }}>-</td>;
                          }
                          let sPres = sObj.present || 0;
                          if (repScope === 'monthly') {
                            const mAbs = (sObj.absentDates || []).filter(d => String(d).startsWith(repMonth)).length;
                            sPres = Math.max(0, sObj.total - mAbs);
                          }
                          const sPct = ((sPres / sObj.total) * 100).toFixed(2);
                          return (
                            <td key={subKey} style={{ padding: '14px 12px', textAlign: 'center', fontWeight: '700', color: Number(sPct) < 85 ? '#dc2626' : '#334155' }}>
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
          </div>
        );
      })()}

      {/* ============================================================
          VIEW 2: MINUS ATTENDANCE (With High-Contrast Search Pills)
         ============================================================ */}
      {activeTab === 'minus_attendance' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ background: 'linear-gradient(135deg, #1e1b4b 0%, #881337 60%, #0f172a 100%)', color: '#ffffff', padding: '26px 30px', borderRadius: '20px', display: 'flex', alignItems: 'center', gap: '18px' }}>
            <div style={{ width: '52px', height: '52px', borderRadius: '14px', background: 'rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '26px', fontWeight: '900' }}>
              −
            </div>
            <div>
              <div style={{ fontSize: '11px', fontWeight: '800', letterSpacing: '1px', color: '#fda4af', textTransform: 'uppercase' }}>
                {userRole === 'admin' ? 'ADMIN' : 'TEACHER'} • ATTENDANCE MANAGEMENT
              </div>
              <h2 style={{ margin: '4px 0', fontSize: '26px', fontWeight: '900', color: '#ffffff' }}>Minus Attendance</h2>
              <p style={{ margin: 0, fontSize: '13px', color: '#e2e8f0' }}>
                Record attendance deductions — deducted from each student's total attendance
              </p>
            </div>
          </div>

          <div style={{ display: 'inline-flex', background: '#e2e8f0', padding: '5px', borderRadius: '12px', gap: '6px', alignSelf: 'flex-start', flexWrap: 'wrap' }}>
            {[
              { id: 'add', label: 'Add Records' },
              ...(userRole === 'admin' ? [{ id: 'excel', label: 'Excel Upload' }] : []),
              { id: 'manage', label: `Manage Records (${allFlattenedMinusRecords.length})` }
            ].map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => setMinusSubTab(t.id)}
                style={{
                  padding: '9px 18px',
                  borderRadius: '9px',
                  border: minusSubTab === t.id ? '1.5px solid #0f172a' : 'none',
                  background: minusSubTab === t.id ? '#ffffff' : 'transparent',
                  color: '#0f172a',
                  fontWeight: '800',
                  fontSize: '13px',
                  cursor: 'pointer'
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {minusSubTab === 'add' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '24px' }}>
              <div style={{ background: '#ffffff', padding: '24px', borderRadius: '16px', border: editingMinusLog ? '2px solid #f59e0b' : '1px solid #cbd5e1' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                  <h3 style={{ margin: 0, fontSize: '18px', color: editingMinusLog ? '#b45309' : '#dc2626', fontWeight: '900' }}>
                    {editingMinusLog ? `✏️ Edit Minus Entry (${editingMinusLog.date})` : '⚠️ Issue Disciplinary Minus Attendance'}
                  </h3>
                  {editingMinusLog && (
                    <button
                      type="button"
                      onClick={() => { setEditingMinusLog(null); setMinusCount(1); setMinusReason(''); }}
                      style={{ padding: '5px 10px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '6px', fontWeight: '800', fontSize: '12px', cursor: 'pointer' }}
                    >
                      ✕ Cancel Edit
                    </button>
                  )}
                </div>

                <form onSubmit={handleSaveMinus} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div>
                    <label style={styles.label}>Search or Paste Comma-Separated Ad.Nos / Student Names:</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        type="text"
                        value={minusSearchQuery}
                        onChange={e => { setMinusSearchQuery(e.target.value); setEditingMinusLog(null); }}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && minusSearchQuery.trim()) {
                            e.preventDefault();
                            handleAddCommaSeparatedMinusStudents();
                          }
                        }}
                        placeholder="e.g. U1434, 3527, Salmanul Faris..."
                        style={{ ...styles.input, flex: 1 }}
                      />
                      <button
                        type="button"
                        onClick={handleAddCommaSeparatedMinusStudents}
                        style={{ padding: '0 14px', background: '#0f172a', color: '#ffffff', border: 'none', borderRadius: '10px', fontWeight: '800', fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                      >
                        ➕ Add Matched
                      </button>
                    </div>

                    {matchingMinusStudents.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                        {matchingMinusStudents.map(st => {
                          const isAdded = selectedMinusStudentsList.some(x => x.regNo === st.regNo);
                          return (
                            <button
                              key={st.regNo}
                              type="button"
                              onClick={() => {
                                setSelectedMinusStudent(st);
                                setEditingMinusLog(null);
                                setSelectedMinusStudentsList(prev => prev.some(x => x.regNo === st.regNo) ? prev : [...prev, st]);
                                const parts = minusSearchQuery.split(',');
                                if (parts.length > 1) { parts.pop(); setMinusSearchQuery(parts.join(', ') + ', '); }
                                else { setMinusSearchQuery(''); }
                              }}
                              style={{
                                padding: '8px 12px', borderRadius: '8px',
                                border: isAdded ? '2px solid #0f766e' : '1.5px solid #64748b',
                                background: isAdded ? '#ccfbf1' : '#ffffff',
                                color: isAdded ? '#065f46' : '#0f172a',
                                fontWeight: '900', cursor: 'pointer', fontSize: '13px'
                              }}
                            >
                              {isAdded ? '✓ ' : '+ '}{st.firstName} (#{st.adNo} • {(st.classes || []).join(',')})
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {selectedMinusStudentsList.length > 0 && (
                    <div style={{ padding: '12px 14px', background: '#f0fdfa', border: '1.5px solid #0d9488', borderRadius: '10px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <span style={{ color: '#0f766e', fontWeight: '900', fontSize: '13px' }}>
                          🎯 Selected Students ({selectedMinusStudentsList.length}):
                        </span>
                        <button type="button" onClick={() => { setSelectedMinusStudentsList([]); setSelectedMinusStudent(null); }} style={{ background: '#fee2e2', color: '#dc2626', border: 'none', padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: '800', cursor: 'pointer' }}>Clear All</button>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {selectedMinusStudentsList.map(st => {
                          const stStat = getStudentAttStat(localStudents.find(x => x.regNo === st.regNo) || st);
                          const isInspecting = selectedMinusStudent?.regNo === st.regNo;
                          return (
                            <span
                              key={st.regNo}
                              onClick={() => { setSelectedMinusStudent(localStudents.find(x => x.regNo === st.regNo) || st); setEditingMinusLog(null); }}
                              style={{ background: isInspecting ? '#0f766e' : '#ffffff', color: isInspecting ? '#ffffff' : '#0f172a', border: '1.5px solid #0f766e', padding: '5px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: '800', display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}
                            >
                              <span>{st.firstName} (#{st.adNo}) • -{stStat.minusCount || 0}</span>
                              <button type="button" onClick={(ev) => { ev.stopPropagation(); const next = selectedMinusStudentsList.filter(x => x.regNo !== st.regNo); setSelectedMinusStudentsList(next); if (selectedMinusStudent?.regNo === st.regNo) setSelectedMinusStudent(next[0] || null); }} style={{ background: 'transparent', border: 'none', color: isInspecting ? '#fecaca' : '#dc2626', fontWeight: '900', cursor: 'pointer' }}>✕</button>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div>
                    <label style={styles.label}>Minus Count (Periods to Deduct):</label>
                    <input type="number" min="1" max="30" value={minusCount} onChange={e => setMinusCount(e.target.value)} required style={styles.input} />
                  </div>
                  <div>
                    <label style={styles.label}>Reason / Law Broken:</label>
                    <input type="text" value={minusReason} onChange={e => setMinusReason(e.target.value)} placeholder="e.g. Late to Fajr, Class Skipping..." required style={styles.input} />
                  </div>
                  <button type="submit" disabled={loading || (selectedMinusStudentsList.length === 0 && !selectedMinusStudent)} style={{ ...styles.buttonPrimary, background: editingMinusLog ? '#d97706' : '#dc2626' }}>
                    {loading ? 'Processing...' : editingMinusLog ? `💾 Save Updated Minus Entry` : `⚠️ Deduct -${minusCount} Minus from ${selectedMinusStudentsList.length || 1} Student(s)`}
                  </button>
                </form>
              </div>

              <div style={{ background: '#ffffff', padding: '24px', borderRadius: '16px', border: '1px solid #cbd5e1' }}>
                <h3 style={{ margin: '0 0 6px 0', fontSize: '18px', color: '#0f172a', fontWeight: '900' }}>📜 Selected Student's Minus History</h3>
                <p style={{ margin: '0 0 14px 0', fontSize: '12px', color: '#64748b', fontWeight: '600' }}>
                  🔒 Only the teacher who issued a minus (or Admin) can edit or delete it.
                </p>
                {!selectedMinusStudent ? (
                  <div style={{ padding: '24px', background: '#f8fafc', borderRadius: '12px', color: '#64748b', fontWeight: '700', textAlign: 'center' }}>
                    Select a student on the left (or switch to "Manage Records" above to see all records).
                  </div>
                ) : (selectedMinusStudentStats.minusLogs || []).length === 0 ? (
                  <div style={{ padding: '20px', background: '#ecfdf5', borderRadius: '12px', color: '#047857', fontWeight: '800', textAlign: 'center' }}>
                    ✅ {selectedMinusStudent.firstName} has 0 minus deductions!
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '420px', overflowY: 'auto' }}>
                    {(selectedMinusStudentStats.minusLogs || []).map(log => {
                      const canModify = canUserModifyMinusLog(log);
                      return (
                        <div key={log.id} style={{ padding: '14px', background: editingMinusLog?.id === log.id ? '#fffbeb' : '#fef2f2', border: editingMinusLog?.id === log.id ? '2px solid #f59e0b' : '1px solid #fecaca', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                          <div>
                            <div style={{ fontSize: '15px', fontWeight: '900', color: '#991b1b' }}>-{log.count} Period(s)</div>
                            <div style={{ fontSize: '13px', color: '#dc2626', fontWeight: '700', marginTop: '3px' }}>"{log.reason}"</div>
                            <div style={{ fontSize: '11px', color: '#7f1d1d', marginTop: '4px', fontWeight: '700' }}>📅 {log.date} • By: <strong>{log.issuedBy}</strong></div>
                          </div>
                          {canModify ? (
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <button type="button" onClick={() => { setEditingMinusLog(log); setMinusCount(log.count); setMinusReason(log.reason); }} style={{ padding: '8px 12px', background: '#e0e7ff', color: '#4338ca', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '800', cursor: 'pointer' }}>✏️</button>
                              <button type="button" onClick={() => handleDeleteMinus(selectedMinusStudent, log)} style={{ padding: '8px 12px', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '800', cursor: 'pointer' }}>🗑️</button>
                            </div>
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

          {minusSubTab === 'excel' && userRole === 'admin' && (
            <div style={{ background: '#ffffff', padding: '24px', borderRadius: '16px', border: '1px solid #cbd5e1' }}>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: '900', color: '#0f172a' }}>📤 Bulk Upload Minus Records via Excel / CSV</h3>
              <p style={{ margin: '0 0 14px 0', fontSize: '13px', color: '#64748b', fontWeight: '600' }}>
                Upload an Excel sheet with columns: <code>Admission No</code>, <code>Minus</code>, <code>Reason</code>, <code>Date</code>, and <code>By</code>.
              </p>
              <input type="file" accept=".xlsx,.xls,.csv" onChange={handleBulkMinusExcelUpload} disabled={loading} style={styles.input} />
            </div>
          )}

          {minusSubTab === 'manage' && (
            <div style={{ background: '#ffffff', padding: '26px', borderRadius: '18px', border: '1px solid #cbd5e1' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '20px' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '20px', fontWeight: '900', color: '#0f172a' }}>All Records</h3>
                  <div style={{ fontSize: '13px', color: '#64748b', fontWeight: '600' }}>
                    {allFlattenedMinusRecords.length} records total {userRole !== 'admin' ? '(Issued by You)' : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                  {userRole !== 'admin' && (
                    <select
                      value={minusTeacherFilter}
                      onChange={e => setMinusTeacherFilter(e.target.value)}
                      style={{ ...styles.input, width: 'auto', padding: '9px 12px', fontSize: '12px', fontWeight: '800' }}
                    >
                      <option value="ALL">👤 Issued by Me Only</option>
                      <option value="ALL_STUDENTS">🏫 All My Students' Minuses</option>
                    </select>
                  )}
                  <input
                    type="text"
                    value={minusTableSearch}
                    onChange={e => setMinusTableSearch(e.target.value)}
                    placeholder="🔍 Search by name or admission no."
                    style={{ ...styles.input, width: '260px', padding: '9px 14px', fontSize: '13px' }}
                  />
                  <button
                    type="button"
                    onClick={handleExportMinusRecordsExcel}
                    style={{ padding: '10px 16px', background: '#ffffff', color: '#0f172a', border: '1px solid #cbd5e1', borderRadius: '10px', fontWeight: '800', fontSize: '13px', cursor: 'pointer' }}
                  >
                    📗 Export Excel
                  </button>
                </div>
              </div>

              <div style={{ overflowX: 'auto', border: '1px solid #f1f5f9', borderRadius: '12px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', color: '#475569', fontSize: '11px', fontWeight: '900', textTransform: 'uppercase' }}>
                      <th style={{ padding: '12px 14px' }}>ROLL NO.</th>
                      <th style={{ padding: '12px 14px' }}>STUDENT</th>
                      <th style={{ padding: '12px 14px' }}>ADM. NO.</th>
                      <th style={{ padding: '12px 14px' }}>MINUS</th>
                      <th style={{ padding: '12px 14px' }}>REASON</th>
                      <th style={{ padding: '12px 14px' }}>DATE</th>
                      <th style={{ padding: '12px 14px' }}>BY</th>
                      <th style={{ padding: '12px 14px', textAlign: 'right' }}>ACTIONS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allFlattenedMinusRecords.map((item, idx) => (
                      <tr key={`${item.adNo}_${item.log.id}_${idx}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '14px', fontWeight: '800', color: '#4f46e5' }}>{item.rollNo || 0}</td>
                        <td style={{ padding: '14px', fontWeight: '800', color: '#0f172a' }}>{item.studentName}</td>
                        <td style={{ padding: '14px', color: '#475569', fontWeight: '700' }}>{item.adNo}</td>
                        <td style={{ padding: '14px' }}>
                          <span style={{ background: '#ffe4e6', color: '#e11d48', padding: '4px 10px', borderRadius: '999px', fontWeight: '900', fontSize: '12px' }}>
                            - {item.log.count}
                          </span>
                        </td>
                        <td style={{ padding: '14px', fontStyle: 'italic', color: '#334155' }}>{item.log.reason || '—'}</td>
                        <td style={{ padding: '14px', color: '#64748b' }}>{item.log.date}</td>
                        <td style={{ padding: '14px', color: '#64748b', fontSize: '12px', fontWeight: '700' }}>{item.log.issuedBy}</td>
                        <td style={{ padding: '14px', textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '6px' }}>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedMinusStudent(item.studentObj);
                                setSelectedMinusStudentsList([item.studentObj]);
                                setEditingMinusLog(item.log);
                                setMinusCount(item.log.count);
                                setMinusReason(item.log.reason);
                                setMinusSubTab('add');
                              }}
                              style={{ padding: '6px 10px', background: '#e0e7ff', color: '#4f46e5', border: 'none', borderRadius: '8px', cursor: 'pointer' }}
                              title="Edit Minus"
                            >
                              ✏️
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteMinus(item.studentObj, item.log)}
                              style={{ padding: '6px 10px', background: '#ffe4e6', color: '#e11d48', border: 'none', borderRadius: '8px', cursor: 'pointer' }}
                              title="Delete Minus"
                            >
                              🗑️
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ============================================================
          VIEW 3: 3-STEP CLEARANCE & SHORTAGE
         ============================================================ */}
      {activeTab === 'clearance' && userRole === 'admin' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '22px', maxWidth: '880px' }}>
          <div style={{ background: 'linear-gradient(135deg, #0f172a 0%, #064e3b 65%, #0f172a 100%)', color: '#ffffff', padding: '28px 32px', borderRadius: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: '11px', fontWeight: '800', letterSpacing: '1px', color: '#6ee7b7', textTransform: 'uppercase' }}>DAILY FOCUS</div>
              <h2 style={{ margin: '4px 0 6px', fontSize: '28px', fontWeight: '900', color: '#ffffff' }}>Attendance Clearance</h2>
              <p style={{ margin: 0, fontSize: '14px', color: '#cbd5e1' }}>
                Select a date scope, fetch absent subjects, and apply official, medical, or permitted clearance with better control.
              </p>
            </div>
            <div style={{ width: '48px', height: '48px', borderRadius: '14px', background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px' }}>🛡️</div>
          </div>

          <div style={{ background: '#ffffff', padding: '24px', borderRadius: '18px', border: '1px solid #e2e8f0' }}>
            <h4 style={{ margin: '0 0 14px 0', fontSize: '15px', fontWeight: '900', color: '#0f172a' }}>Step 1: Date Scope</h4>
            <div style={{ display: 'flex', gap: '10px', marginBottom: '18px' }}>
              <button
                type="button"
                onClick={() => setClearDateMode('single')}
                style={{
                  padding: '10px 18px', borderRadius: '10px', fontWeight: '800', fontSize: '13px', cursor: 'pointer',
                  border: clearDateMode === 'single' ? '2px solid #0f766e' : '1px solid #cbd5e1',
                  background: clearDateMode === 'single' ? '#0d9488' : '#ffffff',
                  color: clearDateMode === 'single' ? '#ffffff' : '#334155'
                }}
              >
                📅 Selected Date
              </button>
              <button
                type="button"
                onClick={() => setClearDateMode('range')}
                style={{
                  padding: '10px 18px', borderRadius: '10px', fontWeight: '800', fontSize: '13px', cursor: 'pointer',
                  border: clearDateMode === 'range' ? '2px solid #0f766e' : '1px solid #cbd5e1',
                  background: clearDateMode === 'range' ? '#0d9488' : '#ffffff',
                  color: clearDateMode === 'range' ? '#ffffff' : '#334155'
                }}
              >
                🗓️ Bulk Date Range
              </button>
            </div>

            {clearDateMode === 'single' ? (
              <div style={{ marginBottom: '14px' }}>
                <label style={styles.label}>Selected Date</label>
                <input type="date" value={clearDate} onChange={e => setClearDate(e.target.value)} style={styles.input} />
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
                <div>
                  <label style={styles.label}>Start Date</label>
                  <input type="date" value={clearStartDate} onChange={e => setClearStartDate(e.target.value)} style={styles.input} />
                </div>
                <div>
                  <label style={styles.label}>End Date</label>
                  <input type="date" value={clearEndDate} onChange={e => setClearEndDate(e.target.value)} style={styles.input} />
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <input
                type="text"
                value={clearAdNo}
                onChange={e => setClearAdNo(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleFetchStudentForClearance(); } }}
                placeholder="Enter Student Admission Number (e.g. 3551)..."
                style={{ ...styles.input, flex: 1 }}
              />
              <button
                type="button"
                onClick={handleFetchStudentForClearance}
                style={{ padding: '12px 22px', background: '#0d9488', color: '#ffffff', border: 'none', borderRadius: '10px', fontWeight: '800', fontSize: '14px', cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                🔍 Fetch Data
              </button>
            </div>
          </div>

          {fetchedClearStudentsList.length > 0 && (
            <form onSubmit={handleSaveClearance} style={{ background: '#ffffff', padding: '24px', borderRadius: '18px', border: '1px solid #cbd5e1' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '14px', marginBottom: '20px' }}>
                <div>
                  <h4 style={{ margin: '0 0 10px 0', fontSize: '16px', fontWeight: '900', color: '#0f172a' }}>
                    👤 Student Information ({fetchedClearStudentsList.length} Matched)
                  </h4>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {fetchedClearStudentsList.map(st => (
                      <div key={st.regNo} style={{ background: '#f0fdfa', border: '1.5px solid #0d9488', padding: '8px 12px', borderRadius: '10px', fontSize: '13px', color: '#0f172a' }}>
                        <strong>{st.firstName}</strong> • Ad.No: #{st.adNo} • Class {(st.classes || []).join(', ')}
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px 18px', minWidth: '150px' }}>
                  <div style={{ fontSize: '10px', fontWeight: '900', color: '#64748b', textTransform: 'uppercase' }}>SELECTED SUBJECTS</div>
                  <div style={{ fontSize: '24px', fontWeight: '900', color: '#0f172a', marginTop: '4px' }}>{clearSelectedSubjects.length}</div>
                </div>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <h4 style={{ margin: 0, fontSize: '14px', fontWeight: '900', color: '#0f172a' }}>Step 2: Select Absent Subjects</h4>
                  <button
                    type="button"
                    onClick={() => setShowAllClearSubjects(prev => !prev)}
                    style={{ background: 'transparent', border: 'none', color: '#0284c7', fontSize: '12px', fontWeight: '800', cursor: 'pointer' }}
                  >
                    {showAllClearSubjects ? 'Show Only Recorded Absent Subjects on Date' : 'Show All Class Subjects'}
                  </button>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                  {(showAllClearSubjects
                    ? DEFAULT_SUBJECTS.filter(s => s.toUpperCase() !== 'HIFZ')
                    : fetchedAbsentSubjects
                  )
                    .filter((v, i, a) => a.indexOf(v) === i)
                    .map(sub => {
                      const checked = clearSelectedSubjects.includes(sub);
                      return (
                        <label
                          key={sub}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: '8px',
                            padding: '9px 14px', borderRadius: '10px',
                            border: checked ? '2px solid #0d9488' : '1px solid #cbd5e1',
                            background: checked ? '#f0fdfa' : '#ffffff',
                            fontSize: '12px', fontWeight: '800', color: '#0f172a', cursor: 'pointer'
                          }}
                        >
                          <input type="checkbox" checked={checked} onChange={() => toggleClearanceSubject(sub)} />
                          {sub}
                        </label>
                      );
                    })}
                </div>
              </div>

              <div>
                <label style={styles.label}>Step 3: Select Reason</label>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <select value={clearReason} onChange={e => setClearReason(e.target.value)} style={{ ...styles.input, flex: 1 }}>
                    <option value="medical">Medical</option>
                    <option value="official">Official (Counts as Present)</option>
                    <option value="permitted">Permitted / Activity</option>
                  </select>
                  <button
                    type="submit"
                    disabled={loading || clearSelectedSubjects.length === 0}
                    style={{ padding: '12px 24px', background: clearSelectedSubjects.length > 0 ? '#0f172a' : '#94a3b8', color: '#ffffff', border: 'none', borderRadius: '10px', fontWeight: '800', fontSize: '14px', cursor: clearSelectedSubjects.length > 0 ? 'pointer' : 'not-allowed' }}
                  >
                    Apply Clearance
                  </button>
                </div>
              </div>
            </form>
          )}

          <div style={{ background: '#ffffff', padding: '24px', borderRadius: '18px', border: '1.5px solid #fecaca' }}>
            <h4 style={{ margin: '0 0 4px 0', fontSize: '16px', fontWeight: '900', color: '#0f172a' }}>Complete Attendance Delete</h4>
            <p style={{ margin: '0 0 14px 0', fontSize: '12px', color: '#64748b' }}>
              Deletes all attendance records. Password verification is required.
            </p>
            <div style={{ background: '#fff1f2', border: '1px solid #fecdd3', padding: '18px', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ ...styles.label, fontSize: '11px' }}>Account Password</label>
                <input type="password" value={deleteAllPassword} onChange={e => setDeleteAllPassword(e.target.value)} placeholder="Enter your account password" style={styles.input} />
              </div>
              <div>
                <label style={{ ...styles.label, fontSize: '11px' }}>Type confirmation: DELETE ALL</label>
                <input type="text" value={deleteAllConfirmText} onChange={e => setDeleteAllConfirmText(e.target.value)} placeholder="DELETE ALL" style={styles.input} />
              </div>
            </div>
            <div style={{ marginTop: '14px', textAlign: 'right' }}>
              <button type="button" onClick={handleCompleteAttendanceDeleteAll} style={{ padding: '11px 20px', background: '#e11d48', color: '#ffffff', border: 'none', borderRadius: '10px', fontWeight: '800', fontSize: '13px', cursor: 'pointer' }}>
                🗑️ Delete Attendance
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW D: SHORTAGE REPORT (<85%) */}
      {activeTab === 'shortage' && (
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
                  <th style={{ padding: '12px 16px', color: '#fff' }}>Student &amp; Ad.No</th>
                  <th style={{ padding: '12px 16px', color: '#fff' }}>Class</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', color: '#fff' }}>Gross Present</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', color: '#fff' }}>Minus</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', color: '#fff' }}>Net %</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right', color: '#fff' }}>Clearance Form</th>
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

      {/* VIEW E: OLD SHUHOOD IMPORTER */}
      {activeTab === 'import_old' && userRole === 'admin' && (
        <div style={{ background: '#ffffff', padding: '24px', borderRadius: '16px', border: '1px solid #cbd5e1', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '19px', color: '#4f46e5', fontWeight: '900' }}>
              📂 Import Old Shuhood Data (JSON or Excel)
            </h3>
            <p style={{ margin: 0, fontSize: '13px', color: '#475569', fontWeight: '600', lineHeight: 1.5 }}>
              Upload <code>shuhood_semester_export.json</code> or an Excel/CSV sheet to import subject-wise attendance and minus logs by Admission Number.
            </p>
          </div>

          <input type="file" accept=".json,.xlsx,.xls,.csv" onChange={handleImportOldShuhoodFile} disabled={loading} style={styles.input} />

          <div style={{ padding: '16px', background: '#f5f3ff', borderRadius: '12px', border: '1.5px solid #c4b5fd', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <div style={{ fontWeight: '900', color: '#4c1d95', fontSize: '14px' }}>🔄 Sync Rehearsal Credits Anytime</div>
              <div style={{ fontSize: '12px', color: '#6d28d9', fontWeight: '600' }}>
                Click to apply any Event Leader rehearsal sessions to already-imported student records by date.
              </div>
            </div>
            <button type="button" onClick={handleSyncRehearsalCreditsToExistingRecords} disabled={loading} style={{ padding: '10px 18px', background: '#7c3aed', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '800', fontSize: '13px', cursor: 'pointer' }}>
              🔄 Auto-Apply Rehearsal Credits
            </button>
          </div>

          {importAuditReport && (
            <div style={{ padding: '16px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #cbd5e1', fontWeight: '800', fontSize: '13px' }}>
              ✅ Matched &amp; Imported: <strong style={{ color: '#059669' }}>{importAuditReport.importedCount}</strong> • ❌ In Old App Only: <strong style={{ color: '#dc2626' }}>{importAuditReport.notFoundInNewApp.length}</strong> • 📋 In New App Only: <strong style={{ color: '#0284c7' }}>{importAuditReport.missingFromOldExport.length}</strong>
            </div>
          )}
        </div>
      )}
    </div>
  );
}