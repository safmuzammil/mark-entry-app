'use client';
import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { db } from '../../lib/firebase';
import { doc, getDoc, getDocs, setDoc, collection, writeBatch } from 'firebase/firestore';
import { DEFAULT_CLASSES, styles } from './erpConstants';
import { CollapsibleCard, openDirectWhatsApp } from './ErpExtensions';
import { REHEARSAL_SESSIONS } from './PeriodAttendanceManager';
import AbsenceClearanceManager from './AbsenceClearanceManager';

export default function PeriodAttendanceMinusAndClearance({
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
  // --- 1. MINUS ATTENDANCE STATE ---
  const [minusSubTab, setMinusSubTab] = useState('add'); // 'add' | 'manage' | 'excel'
  const [minusSearchQuery, setMinusSearchQuery] = useState('');
  const [selectedMinusStudent, setSelectedMinusStudent] = useState(null);
  const [selectedMinusStudentsList, setSelectedMinusStudentsList] = useState([]);
  const [minusCount, setMinusCount] = useState(1);
  const [minusReason, setMinusReason] = useState('');
  const [editingMinusLog, setEditingMinusLog] = useState(null);
  const [minusTableSearch, setMinusTableSearch] = useState('');
  const [minusTeacherFilter, setMinusTeacherFilter] = useState('ALL');

  // --- 2. PERIOD-BASED MULTI-STUDENT CLEARANCE & SHORTAGE STATE ---
  const [clearAdNo, setClearAdNo] = useState('');
  const [fetchedClearStudentsList, setFetchedClearStudentsList] = useState([]);
  const [fetchedAbsentPeriodSessions, setFetchedAbsentPeriodSessions] = useState([]); // [{ sessionDocId, date, session, subject, classAlias, teacherName, absentStudentRegs }]
  const [selectedClearSessionIds, setSelectedClearSessionIds] = useState([]);
  const [fetchedAbsentSubjects, setFetchedAbsentSubjects] = useState([]);
  const [showLegacySubjectFallback, setShowLegacySubjectFallback] = useState(false);
  const [clearSelectedSubjects, setClearSelectedSubjects] = useState([]);
  const [clearReason, setClearReason] = useState('official');
  const [clearDateMode, setClearDateMode] = useState('single');
  const [clearDate, setClearDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [clearStartDate, setClearStartDate] = useState('');
  const [clearEndDate, setClearEndDate] = useState('');
  const [fetchingClearance, setFetchingClearance] = useState(false);
  const [clearanceRemarks, setClearanceRemarks] = useState('');
  const [issuedClearanceCerts, setIssuedClearanceCerts] = useState([]);
  const [activeCertToPrint, setActiveCertToPrint] = useState(null);

  // --- 2b. CLEARANCE INSPECTION & ATTENDANCE CORRECTION STATE ---
  const [clearanceSubTab, setClearanceSubTab] = useState('issue'); // 'issue' | 'inspect'
  const [inspectAdNo, setInspectAdNo] = useState('3606');
  const [inspectStudent, setInspectStudent] = useState(null);
  const [inspectDateStart, setInspectDateStart] = useState('2026-10-15');
  const [inspectDateEnd, setInspectDateEnd] = useState(() => new Date().toISOString().split('T')[0]);
  const [inspectFilterStatus, setInspectFilterStatus] = useState('ALL'); // 'ALL' | 'CLEARED' | 'ABSENT'
  const [inspectSessionsList, setInspectSessionsList] = useState([]);
  const [selectedInspectSessionIds, setSelectedInspectSessionIds] = useState([]);
  const [fetchingInspect, setFetchingInspect] = useState(false);
  const [editingCertRemarksId, setEditingCertRemarksId] = useState(null);
  const [editedRemarksText, setEditedRemarksText] = useState('');

  const [deleteAllPassword, setDeleteAllPassword] = useState('');
  const [deleteAllConfirmText, setDeleteAllConfirmText] = useState('');
  const [shortageClassFilter, setShortageClassFilter] = useState('ALL');
  const [importAuditReport, setImportAuditReport] = useState(null);
  const [bulkMinusResultReport, setBulkMinusResultReport] = useState(null);

  // 🌟 Scoped teacher privileges and student rosters for Shortage & Minus
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

  const teacherAllowedClasses = React.useMemo(() => {
    const set = new Set(myCtClasses);
    (attendanceEnrollments || []).forEach(env => {
      if (env.targetClass) set.add(String(env.targetClass).toUpperCase().trim());
      const enrolled = getStudentsForEnrollment ? getStudentsForEnrollment(env) : [];
      enrolled.forEach(st => {
        (st.classes || [st.class] || []).filter(Boolean).forEach(c => set.add(String(c).toUpperCase().trim()));
      });
    });
    return Array.from(set);
  }, [myCtClasses, attendanceEnrollments, getStudentsForEnrollment]);

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
  }, [attendanceEnrollments, getStudentsForEnrollment, myCtClasses, localStudents]);

  const shortageDropdownClasses = userRole === 'admin'
    ? DEFAULT_CLASSES
    : teacherAllowedClasses;

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
        const docId = String(st.id || st.regNo || '').trim();
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
          const docId = String(st.id || st.regNo || '').trim();
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
      const docId = String(studentObj.id || studentObj.regNo || '').trim();
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

  // Flexible Date Parser for Excel / CSV Imports:
  // Supports Day-Month-Year (DD-MM-YYYY, DD/MM/YYYY, DD MM YYYY, DD.MM.YYYY), YYYY-MM-DD, and Excel numeric serial timestamps
  const parseFlexDateToISO = (rawDate) => {
    if (!rawDate && rawDate !== 0) return null;

    // 1. JavaScript Date object
    if (rawDate instanceof Date && !isNaN(rawDate.getTime())) {
      const y = rawDate.getFullYear();
      const m = String(rawDate.getMonth() + 1).padStart(2, '0');
      const d = String(rawDate.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }

    // 2. Excel numeric serial date (e.g. 46333)
    if (typeof rawDate === 'number' && !isNaN(rawDate) && rawDate > 1000) {
      const utcDays = Math.floor(rawDate - 25569);
      const date = new Date(utcDays * 86400 * 1000);
      if (!isNaN(date.getTime())) {
        const y = date.getUTCFullYear();
        const m = String(date.getUTCMonth() + 1).padStart(2, '0');
        const d = String(date.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
      }
    }

    const str = String(rawDate).trim();
    if (!str) return null;

    // Split by / or - or . or whitespace
    const parts = str.split(/[\/\-\.\s]+/).filter(Boolean);

    if (parts.length === 3) {
      let day, month, year;
      if (parts[0].length === 4) {
        // YYYY-MM-DD
        year = parseInt(parts[0], 10);
        month = parseInt(parts[1], 10);
        day = parseInt(parts[2], 10);
      } else {
        // Default: Day-Month-Year (DD-MM-YYYY or DD/MM/YYYY or DD MM YYYY)
        day = parseInt(parts[0], 10);
        month = parseInt(parts[1], 10);
        year = parseInt(parts[2], 10);
        if (year < 100) year += 2000;
      }

      if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
        if (year >= 2000 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
          const mm = String(month).padStart(2, '0');
          const dd = String(day).padStart(2, '0');
          return `${year}-${mm}-${dd}`;
        }
      }
    }

    const dt = new Date(str);
    if (!isNaN(dt.getTime())) {
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const d = String(dt.getDate()).padStart(2, '0');
      if (y >= 2000 && y <= 2100) {
        return `${y}-${m}-${d}`;
      }
    }

    return null;
  };

  const handleDownloadBulkMinusTemplate = () => {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    const formattedDate = `${dd}-${mm}-${yyyy}`;

    const sampleRows = [
      {
        'Admission No': 'U1115',
        'Student Name': 'FARHAN AKHTAR (Urdu Stream: Prefix uppercase U required)',
        'Date': formattedDate,
        'Minus': 1,
        'Reason': 'Late arrival to class',
        'Teacher': loggedInUser?.fullName || 'Central Admin'
      },
      {
        'Admission No': '3529',
        'Student Name': 'Muhammed Shahid C (General Stream)',
        'Date': formattedDate,
        'Minus': 1,
        'Reason': 'Classroom disturbance',
        'Teacher': loggedInUser?.fullName || 'Central Admin'
      }
    ];

    const ws = XLSX.utils.json_to_sheet(sampleRows);
    ws['!cols'] = [
      { wch: 18 }, // Admission No
      { wch: 48 }, // Student Name (reference only)
      { wch: 16 }, // Date (DD-MM-YYYY)
      { wch: 10 }, // Minus
      { wch: 28 }, // Reason
      { wch: 24 }  // Teacher
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Bulk Minus Template');
    XLSX.writeFile(wb, `Bulk_Minus_Attendance_Template_${formattedDate}.xlsx`);
  };

  const handleBulkMinusExcelUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setBulkMinusResultReport(null);
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { raw: true, defval: '' });

      if (rows.length === 0) {
        setLoading(false);
        return alert('The selected Excel file contains no data rows.');
      }

      const batch = writeBatch(db);
      const updatedMap = {};
      const failures = [];
      const successes = [];
      const defaultTodayISO = new Date().toISOString().split('T')[0];

      rows.forEach((row, idx) => {
        const rowNumber = idx + 2; // 1-based index (Row 1 is headers)
        const rawAd = row['Admission No'] || row['Admission Number'] || row['Admission'] || row['Adm. No.'] || row['Ad.No'] || row['Ad Number'] || row['adNo'] || row['AdNo'] || row.admissionNumber || row['Admission No (Urdu prefix U, e.g. U1115)'];
        const studentNameInFile = String(row['Student Name'] || row['Name'] || row.name || row.student || '').trim();

        if (!rawAd || String(rawAd).trim() === '') {
          failures.push({
            rowNumber,
            admissionNo: '(Blank)',
            studentName: studentNameInFile || '—',
            reason: 'Admission Number is empty or missing.'
          });
          return;
        }

        // Strict Admission Number Lookup (Student Name is ignored to prevent spelling / casing mismatch)
        let cleanAd = String(rawAd).replace(/^[#\s]+/, '').trim();
        // If it starts with lowercase 'u' followed by digits (e.g. u1115), automatically capitalize to U1115
        if (/^u/i.test(cleanAd)) {
          cleanAd = 'U' + cleanAd.slice(1).trim();
        }

        const st = localStudents.find(s => {
          const sAd = String(s.adNo || '').replace(/^[#\s]+/, '').trim();
          const sReg = String(s.regNo || '').replace(/^[#\s]+/, '').trim();
          return (
            sAd.toUpperCase() === cleanAd.toUpperCase() ||
            sReg.toUpperCase() === cleanAd.toUpperCase()
          );
        });

        if (!st) {
          const isUrduAd = cleanAd.toUpperCase().startsWith('U');
          failures.push({
            rowNumber,
            admissionNo: cleanAd,
            studentName: studentNameInFile || '—',
            reason: isUrduAd
              ? `Urdu student with Ad.No '${cleanAd}' not found in database. Please verify the admission number.`
              : isNaN(cleanAd)
              ? `Student with Ad.No '${cleanAd}' not found. If this is an Urdu student, ensure uppercase 'U' is at the beginning (e.g. U${cleanAd}).`
              : `Student with Admission No '${cleanAd}' not found in database.`
          });
          return;
        }

        // Validate and flex-parse date (DD-MM-YYYY, DD/MM/YYYY, DD MM YYYY, etc.)
        const rawDate = row['Date'] || row['date'] || row['Date (DD-MM-YYYY)'] || row['Attendance Date'];
        let dateISO = parseFlexDateToISO(rawDate);
        if (!dateISO) {
          if (!rawDate || String(rawDate).trim() === '') {
            dateISO = defaultTodayISO;
          } else {
            failures.push({
              rowNumber,
              admissionNo: cleanAd,
              studentName: studentNameInFile || st.firstName,
              reason: `Invalid Date '${rawDate}'. Expected Day-Month-Year (e.g. 07-11-2026 or 07/11/2026).`
            });
            return;
          }
        }

        // Validate minus count
        const rawMinusVal = row.Minus ?? row.minus ?? row.Count ?? row.count ?? 1;
        const rawMinus = Math.abs(Number(rawMinusVal));
        if (isNaN(rawMinus) || rawMinus <= 0) {
          failures.push({
            rowNumber,
            admissionNo: cleanAd,
            studentName: studentNameInFile || st.firstName,
            reason: `Invalid minus count '${rawMinusVal}'. Must be a positive number.`
          });
          return;
        }

        const baseSt = updatedMap[st.regNo] || st;
        const curStat = JSON.parse(JSON.stringify(getStudentAttStat(baseSt)));
        const newLog = {
          id: `excel_minus_${Date.now()}_${idx}`,
          date: dateISO,
          count: rawMinus,
          reason: String(row.Reason || row.reason || 'Disciplinary Deduction').trim(),
          issuedBy: String(row.Teacher || row.teacher || row['Teacher Name'] || row.By || row['Issued By'] || loggedInUser?.fullName || 'Central Admin').trim(),
          issuedByUsername: String(row['Teacher Username'] || row.teacherUsername || loggedInUser?.username || 'admin').toLowerCase().trim()
        };

        curStat.minusLogs = [newLog, ...(curStat.minusLogs || [])];
        curStat.minusCount = curStat.minusLogs.reduce((sum, l) => sum + (Number(l.count) || 0), 0);

        const docId = String(st.id || st.regNo || '').trim();
        batch.set(doc(db, 'students', docId), { periodAttendance: curStat }, { merge: true });
        updatedMap[st.regNo] = { ...st, periodAttendance: curStat };

        successes.push({
          rowNumber,
          admissionNo: cleanAd,
          studentName: st.firstName,
          minusCount: rawMinus,
          reason: newLog.reason,
          date: dateISO
        });
      });

      if (successes.length > 0) {
        await batch.commit();
        syncUpdatedStudentsState(updatedMap);
      }

      setBulkMinusResultReport({
        totalRows: rows.length,
        successCount: successes.length,
        failures,
        successes
      });

      if (failures.length === 0) {
        setStatusMsg(`✅ Successfully applied minus deductions for all ${successes.length} student(s) from Excel!`);
      } else if (successes.length > 0) {
        setStatusMsg(`⚠️ Applied ${successes.length} minus deduction(s), but ${failures.length} row(s) had issues (see details below).`);
      } else {
        setStatusMsg(`❌ Could not import records: all ${failures.length} row(s) had errors (see details below).`);
      }
    } catch (err) {
      console.error('Excel upload error:', err);
      alert('Excel upload error: ' + err.message);
    } finally {
      setLoading(false);
      e.target.value = null;
    }
  };

  // =========================================================================
  // 🌟 2. PERIOD-BASED MULTI-STUDENT CLEARANCE DESK (Fetches Exact Absent Periods!)
  // =========================================================================
  const toggleClearanceSessionId = (sessDocId) => {
    setSelectedClearSessionIds(prev =>
      prev.includes(sessDocId) ? prev.filter(id => id !== sessDocId) : [...prev, sessDocId]
    );
  };

  const toggleClearanceSubject = (sub) => {
    setClearSelectedSubjects(prev => prev.includes(sub) ? prev.filter(s => s !== sub) : [...prev, sub]);
  };

  const getDatesBetween = (startStr, endStr) => {
    if (!startStr || !endStr) return [];
    const dates = [];
    const cur = new Date(startStr);
    const end = new Date(endStr);
    let safety = 0;
    while (cur <= end && safety < 65) {
      dates.push(cur.toISOString().split('T')[0]);
      cur.setDate(cur.getDate() + 1);
      safety++;
    }
    return dates;
  };

  const handleFetchStudentForClearance = async () => {
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
      setFetchedAbsentPeriodSessions([]);
      setFetchedAbsentSubjects([]);
      return alert(`No students found for: ${unmatched.join(', ')}`);
    }

    setFetchedClearStudentsList(foundStudents);
    setSelectedClearSessionIds([]);
    setClearSelectedSubjects([]);
    setFetchingClearance(true);

    try {
      const targetDates = clearDateMode === 'single'
        ? [clearDate]
        : getDatesBetween(clearStartDate, clearEndDate);

      const absentSessionItems = [];

      for (const dStr of targetDates) {
        if (!dStr) continue;
        const idxSnap = await getDoc(doc(db, 'systemCache', `daySessionsIndex_${dStr}`));
        if (!idxSnap.exists()) continue;

        const sessList = idxSnap.data().sessions || [];
        for (const item of sessList) {
          const sSnap = await getDoc(doc(db, 'systemCache', item.sessionDocId));
          if (!sSnap.exists()) continue;
          const sData = sSnap.data();
          const attMap = sData.attendanceMap || {};

          // Check which of the fetched students were marked Absent ('A') in this exact period!
          const absentStInThisPeriod = foundStudents.filter(st => {
            const code = attMap[st.regNo] || attMap[st.id] || attMap[st.adNo];
            return code === 'A';
          });

          if (absentStInThisPeriod.length > 0) {
            absentSessionItems.push({
              sessionDocId: item.sessionDocId,
              date: dStr,
              session: Number(sData.session || item.session || 1),
              subject: normalizeSubKey(sData.subject || item.subject || ''),
              classAlias: sData.classAlias || sData.subject || item.subject || '',
              teacherName: sData.teacherName || 'Faculty',
              absentStudentRegs: absentStInThisPeriod.map(x => x.regNo),
              absentStudentNames: absentStInThisPeriod.map(x => `${x.firstName} (#${x.adNo})`).join(', ')
            });
          }
        }
      }

      absentSessionItems.sort((a, b) => a.date.localeCompare(b.date) || a.session - b.session);
      setFetchedAbsentPeriodSessions(absentSessionItems);
      // Pre-select all found absent periods automatically for 1-click convenience!
      setSelectedClearSessionIds(absentSessionItems.map(x => x.sessionDocId));

      // Also check legacy subjectWise absentDates in case of older imported data without period numbers
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

      const matchedLegacySubs = Array.from(subSet);
      setFetchedAbsentSubjects(matchedLegacySubs);
      setShowLegacySubjectFallback(absentSessionItems.length === 0 && matchedLegacySubs.length > 0);
    } catch (err) {
      console.error('Error fetching period sessions for clearance:', err);
    } finally {
      setFetchingClearance(false);
    }
  };

  const handleSaveClearance = async (e) => {
    e.preventDefault();
    if (fetchedClearStudentsList.length === 0) return alert('Please fetch students first.');
    if (selectedClearSessionIds.length === 0 && clearSelectedSubjects.length === 0) {
      return alert('Please select at least one absent period (or legacy subject) to clear.');
    }

    setLoading(true);
    try {
      const batch = writeBatch(db);
      const updatedMap = {};

      // Clone student stats for batch update
      const studentStatsDraft = {};
      fetchedClearStudentsList.forEach(st => {
        studentStatsDraft[st.regNo] = JSON.parse(JSON.stringify(getStudentAttStat(st)));
        if (!studentStatsDraft[st.regNo].subjectWise) studentStatsDraft[st.regNo].subjectWise = {};
      });

      // 1. Apply Period-Specific Clearance (Updates both systemCache session & student stats!)
      const selectedPeriodObjs = fetchedAbsentPeriodSessions.filter(p => selectedClearSessionIds.includes(p.sessionDocId));

      for (const pItem of selectedPeriodObjs) {
        const sRef = doc(db, 'systemCache', pItem.sessionDocId);
        const sSnap = await getDoc(sRef);
        const sData = sSnap.exists() ? sSnap.data() : null;
        const attMap = sData?.attendanceMap ? { ...sData.attendanceMap } : {};

        pItem.absentStudentRegs.forEach(regNo => {
          const curStat = studentStatsDraft[regNo];
          if (!curStat) return;

          const subKey = normalizeSubKey(pItem.subject);
          if (!curStat.subjectWise[subKey]) {
            curStat.subjectWise[subKey] = { total: 1, present: 0, official: 0, medical: 0, permitted: 0, absentDates: [] };
          }
          const subObj = curStat.subjectWise[subKey];
          if (!Array.isArray(subObj.absentDates)) subObj.absentDates = [];

          // Remove one instance of this date from absentDates
          const dateIdx = subObj.absentDates.indexOf(pItem.date);
          if (dateIdx !== -1) subObj.absentDates.splice(dateIdx, 1);

          if (clearReason === 'official') {
            attMap[regNo] = 'O';
            curStat.presentCount = Math.min(curStat.totalPeriods || 9999, (curStat.presentCount || 0) + 1);
            curStat.officialCount = (curStat.officialCount || 0) + 1;
            subObj.present = Math.min(subObj.total || 9999, (subObj.present || 0) + 1);
            subObj.official = (subObj.official || 0) + 1;
          } else if (clearReason === 'medical') {
            attMap[regNo] = 'M';
            curStat.medicalCount = (curStat.medicalCount || 0) + 1;
            subObj.medical = (subObj.medical || 0) + 1;
          } else if (clearReason === 'permitted') {
            attMap[regNo] = 'L';
            curStat.permittedCount = (curStat.permittedCount || 0) + 1;
            subObj.permitted = (subObj.permitted || 0) + 1;
            // 🌟 Does NOT inflate presentCount
          } else {
            attMap[regNo] = 'O';
            curStat.presentCount = Math.min(curStat.totalPeriods || 9999, (curStat.presentCount || 0) + 1);
            curStat.officialCount = (curStat.officialCount || 0) + 1;
            subObj.present = Math.min(subObj.total || 9999, (subObj.present || 0) + 1);
            subObj.official = (subObj.official || 0) + 1;
          }
        });

        if (sData) {
          batch.set(sRef, { attendanceMap: attMap, updatedAt: new Date().toISOString() }, { merge: true });
        }
      }

      // 2. Apply Legacy Subject Fallback Clearance (If any legacy subject checkboxes were selected)
      if (clearSelectedSubjects.length > 0) {
        fetchedClearStudentsList.forEach(student => {
          const curStat = studentStatsDraft[student.regNo];
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
        });
      }

      // Commit updated student documents
      fetchedClearStudentsList.forEach(student => {
        const docId = String(student.id || student.regNo || '').trim();
        const finalStat = studentStatsDraft[student.regNo];
        batch.set(doc(db, 'students', docId), { periodAttendance: finalStat }, { merge: true });
        updatedMap[student.regNo] = { ...student, periodAttendance: finalStat };
      });

      // Generate and store Official Clearance Certificates for all cleared students
      const newCerts = [];
      const nowIso = new Date().toISOString();
      const targetDates = clearDateMode === 'single' ? [clearDate] : getDatesBetween(clearStartDate, clearEndDate);

      // Read current portal notifications so we can append clearance notifications
      let existingNotifs = [];
      try {
        const notifSnap = await getDoc(doc(db, 'systemCache', 'portalNotifications'));
        if (notifSnap.exists() && Array.isArray(notifSnap.data().items)) {
          existingNotifs = notifSnap.data().items;
        }
      } catch (ne) {
        console.warn('Could not read existing portal notifications:', ne);
      }

      const newNotifItems = [];

      fetchedClearStudentsList.forEach(student => {
        const certNumber = `DHIU/CLR/${new Date().getFullYear()}/${student.adNo || student.regNo}/${Math.floor(1000 + Math.random() * 9000)}`;
        const certDocId = `cert_${Date.now()}_${student.regNo}`;
        const certObj = {
          id: certDocId,
          certNumber,
          regNo: student.regNo,
          adNo: student.adNo,
          studentName: student.firstName,
          classes: student.classes || [],
          department: student.department || 'GENERAL',
          dateMode: clearDateMode,
          dates: targetDates,
          reason: clearReason, // 'official' | 'medical' | 'permitted'
          remarks: clearanceRemarks || `Official attendance clearance granted by ${loggedInUser?.fullName || 'Attendance Clearance Desk'}`,
          clearedSessions: selectedPeriodObjs.map(p => ({
            sessionDocId: p.sessionDocId,
            date: p.date,
            session: p.session,
            subject: p.subject,
            teacherName: p.teacherName
          })),
          clearedLegacySubjects: clearSelectedSubjects,
          clearedBy: loggedInUser?.fullName || loggedInUser?.username || 'Attendance Clearance Desk',
          clearedByRole: userRole,
          issuedAt: nowIso,
          status: 'ISSUED', // 'ISSUED' | 'CONFIRMED'
          studentConfirmedAt: null
        };

        newCerts.push(certObj);

        // Store in clearance_certificates and clearance_history collection
        batch.set(doc(db, 'clearance_certificates', certDocId), certObj);
        batch.set(doc(db, 'clearance_history', certDocId), {
          ...certObj,
          studentRegNo: String(student.regNo || '').trim(),
          studentAdNo: student.adNo,
          studentClasses: student.classes || [],
          clearanceType: clearReason === 'medical' ? 'MEDICAL_LEAVE' : clearReason === 'permitted' ? 'PERMITTED_LEAVE' : 'OFFICIAL_PRESENT',
          clearanceTypeLabel: clearReason === 'medical' ? '🏥 Medical Leave (Excused)' : clearReason === 'permitted' ? '🎟️ Permitted Leave (Excused)' : '🏛️ Official Duty (Present)',
          totalPeriodsCleared: selectedPeriodObjs.length || clearSelectedSubjects.length || 1,
          issuedByUsername: loggedInUser?.username || 'admin',
          issuedByName: loggedInUser?.fullName || 'Central Admin',
          issuedAt: nowIso,
          verificationStatus: 'PENDING',
          verifiedBy: null,
          verifiedByName: null,
          verifiedAt: null,
          verificationNotes: ''
        });

        // Append to student's periodAttendance stat
        const curStat = studentStatsDraft[student.regNo];
        if (curStat) {
          curStat.clearanceCertificates = [
            certObj,
            ...(Array.isArray(curStat.clearanceCertificates) ? curStat.clearanceCertificates : []).slice(0, 15)
          ];
        }

        // Add targeted portal notification item for student
        newNotifItems.push({
          id: `notif_clr_${Date.now()}_${student.regNo}`,
          createdAt: nowIso,
          senderName: 'Attendance Clearance Desk',
          senderRole: 'admin',
          senderUsername: loggedInUser?.username || 'admin',
          title: `🎟️ Attendance Clearance Certificate Issued (#${certNumber})`,
          body: `Your attendance clearance for ${targetDates.join(', ')} (${clearReason.toUpperCase()}) has been approved. Please view and confirm your certificate in your Student Portal.`,
          priority: 'HIGH',
          targetType: 'SPECIFIC_STUDENTS',
          targetValues: [student.regNo, student.adNo],
          certificateId: certDocId,
          active: true
        });
      });

      // Update portalNotifications cache
      if (newNotifItems.length > 0) {
        batch.set(doc(db, 'systemCache', 'portalNotifications'), {
          items: [...newNotifItems, ...existingNotifs].slice(0, 100),
          updatedAt: nowIso
        }, { merge: true });
      }

      await batch.commit();
      syncUpdatedStudentsState(updatedMap);
      setIssuedClearanceCerts(newCerts);
      setStatusMsg(`✅ Applied [${clearReason.toUpperCase()}] clearance & issued ${newCerts.length} Official Certificate(s) directly to Student Portal!`);
      setFetchedAbsentPeriodSessions(prev => prev.filter(p => !selectedClearSessionIds.includes(p.sessionDocId)));
      setSelectedClearSessionIds([]);
      setClearSelectedSubjects([]);
      setClearanceRemarks('');
    } catch (err) {
      setStatusMsg('❌ Error: ' + err.message);
    } finally {
      setLoading(false);
      setTimeout(() => setStatusMsg(''), 6000);
    }
  };

  // 🌟 2b. CLEARANCE & ATTENDANCE INSPECTOR & CORRECTION HANDLERS
  const handleLoadInspectStudent = async (targetInput, customStart, customEnd) => {
    const rawInput = String(targetInput !== undefined ? targetInput : inspectAdNo).trim();
    if (!rawInput) return alert('Please enter a student Admission Number (e.g. 3606, U1115).');

    const cleanTok = rawInput.replace(/^#/, '').toLowerCase().trim();
    let match = localStudents.find(
      s => String(s.adNo || '').trim().toLowerCase() === cleanTok ||
           String(s.regNo || '').trim().toLowerCase() === cleanTok
    );
    if (!match && !cleanTok.startsWith('u')) {
      match = localStudents.find(s => String(s.adNo || '').trim().toLowerCase() === 'u' + cleanTok);
    }
    if (!match) {
      match = localStudents.find(s => String(s.firstName || '').trim().toLowerCase().includes(cleanTok));
    }

    if (!match) {
      setInspectStudent(null);
      setInspectSessionsList([]);
      return alert(`Student #${cleanTok.toUpperCase()} not found in student database.`);
    }

    setInspectStudent(match);
    setSelectedInspectSessionIds([]);
    setFetchingInspect(true);

    try {
      const sDate = customStart !== undefined ? customStart : (inspectDateStart || '2026-08-30');
      const eDate = customEnd !== undefined ? customEnd : (inspectDateEnd || new Date().toISOString().split('T')[0]);
      const datesToLoad = getDatesBetween(sDate, eDate);

      const studentClass = String(match.className || (Array.isArray(match.classes) ? match.classes[0] : '') || '').trim().toUpperCase();
      const studentStat = getStudentAttStat(match);
      const studentSubs = studentStat?.subjectWise || {};

      const foundSessions = [];

      for (const dStr of datesToLoad) {
        if (!dStr) continue;
        const idxSnap = await getDoc(doc(db, 'systemCache', `daySessionsIndex_${dStr}`));
        if (!idxSnap.exists()) continue;

        const sessList = idxSnap.data().sessions || [];
        for (const item of sessList) {
          const itemClass = String(item.classAlias || '').trim().toUpperCase();
          const subKey = normalizeSubKey(item.subject);
          const takesSubject = !!studentSubs[subKey];
          const classMatches = !studentClass || !itemClass || itemClass === studentClass || itemClass.includes(studentClass) || studentClass.includes(itemClass);

          if (!classMatches && !takesSubject) continue;

          const sSnap = await getDoc(doc(db, 'systemCache', item.sessionDocId));
          if (!sSnap.exists()) continue;
          const sData = sSnap.data();
          const attMap = sData.attendanceMap || {};

          const status = attMap[match.regNo] || attMap[match.id] || attMap[match.adNo];
          if (status) {
            foundSessions.push({
              sessionDocId: item.sessionDocId,
              date: dStr,
              session: Number(sData.session || item.session || 1),
              subject: subKey || item.subject || '',
              classAlias: sData.classAlias || item.classAlias || '',
              teacherName: sData.teacherName || item.teacherName || 'Faculty',
              currentStatus: status
            });
          }
        }
      }

      foundSessions.sort((a, b) => b.date.localeCompare(a.date) || a.session - b.session);
      setInspectSessionsList(foundSessions);
    } catch (err) {
      console.error('Error fetching student sessions for inspection:', err);
      alert('Error loading sessions: ' + err.message);
    } finally {
      setFetchingInspect(false);
    }
  };

  const handleUpdateSessionStatus = async (targetSessionDocIds, newStatus) => {
    if (!inspectStudent) return;
    if (!targetSessionDocIds || targetSessionDocIds.length === 0) {
      return alert('Please select at least one session to update.');
    }

    const actionLabel = newStatus === 'A' ? 'REVERT TO ABSENT (A)' : newStatus === 'O' ? 'SET TO OFFICIAL CLEARANCE (O)' : newStatus === 'M' ? 'SET TO MEDICAL LEAVE (M)' : 'SET TO PRESENT (P)';
    if (!window.confirm(`Are you sure you want to ${actionLabel} for ${targetSessionDocIds.length} session(s)?`)) return;

    setLoading(true);
    try {
      const batch = writeBatch(db);
      const curStat = JSON.parse(JSON.stringify(getStudentAttStat(inspectStudent)));
      if (!curStat.subjectWise) curStat.subjectWise = {};

      const updatedSessions = [...inspectSessionsList];

      for (const sessDocId of targetSessionDocIds) {
        const sessItem = updatedSessions.find(s => s.sessionDocId === sessDocId);
        if (!sessItem) continue;

        const prevStatus = sessItem.currentStatus;
        if (prevStatus === newStatus) continue;

        const subKey = normalizeSubKey(sessItem.subject);
        if (!curStat.subjectWise[subKey]) {
          curStat.subjectWise[subKey] = { total: 1, present: 0, official: 0, medical: 0, permitted: 0, absentDates: [] };
        }
        const subObj = curStat.subjectWise[subKey];
        if (!Array.isArray(subObj.absentDates)) subObj.absentDates = [];

        // 1. Remove previous status impact
        if (prevStatus === 'P') {
          curStat.presentCount = Math.max(0, (curStat.presentCount || 0) - 1);
          subObj.present = Math.max(0, (subObj.present || 0) - 1);
        } else if (prevStatus === 'O') {
          curStat.presentCount = Math.max(0, (curStat.presentCount || 0) - 1);
          curStat.officialCount = Math.max(0, (curStat.officialCount || 0) - 1);
          subObj.present = Math.max(0, (subObj.present || 0) - 1);
          subObj.official = Math.max(0, (subObj.official || 0) - 1);
        } else if (prevStatus === 'M') {
          curStat.medicalCount = Math.max(0, (curStat.medicalCount || 0) - 1);
          subObj.medical = Math.max(0, (subObj.medical || 0) - 1);
        } else if (prevStatus === 'L') {
          curStat.permittedCount = Math.max(0, (curStat.permittedCount || 0) - 1);
          subObj.permitted = Math.max(0, (subObj.permitted || 0) - 1);
        } else if (prevStatus === 'A') {
          const idx = subObj.absentDates.indexOf(sessItem.date);
          if (idx !== -1) subObj.absentDates.splice(idx, 1);
        }

        // 2. Apply new status impact
        if (newStatus === 'A') {
          if (!subObj.absentDates.includes(sessItem.date)) {
            subObj.absentDates.push(sessItem.date);
          }
        } else if (newStatus === 'P') {
          curStat.presentCount = Math.min(curStat.totalPeriods || 9999, (curStat.presentCount || 0) + 1);
          subObj.present = Math.min(subObj.total || 9999, (subObj.present || 0) + 1);
          const idx = subObj.absentDates.indexOf(sessItem.date);
          if (idx !== -1) subObj.absentDates.splice(idx, 1);
        } else if (newStatus === 'O') {
          curStat.presentCount = Math.min(curStat.totalPeriods || 9999, (curStat.presentCount || 0) + 1);
          curStat.officialCount = (curStat.officialCount || 0) + 1;
          subObj.present = Math.min(subObj.total || 9999, (subObj.present || 0) + 1);
          subObj.official = (subObj.official || 0) + 1;
          const idx = subObj.absentDates.indexOf(sessItem.date);
          if (idx !== -1) subObj.absentDates.splice(idx, 1);
        } else if (newStatus === 'M') {
          curStat.medicalCount = (curStat.medicalCount || 0) + 1;
          subObj.medical = (subObj.medical || 0) + 1;
          const idx = subObj.absentDates.indexOf(sessItem.date);
          if (idx !== -1) subObj.absentDates.splice(idx, 1);
        } else if (newStatus === 'L') {
          curStat.permittedCount = (curStat.permittedCount || 0) + 1;
          subObj.permitted = (subObj.permitted || 0) + 1;
          const idx = subObj.absentDates.indexOf(sessItem.date);
          if (idx !== -1) subObj.absentDates.splice(idx, 1);
        }

        // 3. Update session doc in systemCache
        const sRef = doc(db, 'systemCache', sessDocId);
        const sSnap = await getDoc(sRef);
        if (sSnap.exists()) {
          const attMap = { ...(sSnap.data().attendanceMap || {}) };
          attMap[inspectStudent.regNo] = newStatus;
          if (inspectStudent.adNo) attMap[inspectStudent.adNo] = newStatus;
          batch.set(sRef, { attendanceMap: attMap, updatedAt: new Date().toISOString() }, { merge: true });
        }

        sessItem.currentStatus = newStatus;
      }

      // 4. Update student document
      const docId = String(inspectStudent.id || inspectStudent.regNo || '').trim();
      batch.set(doc(db, 'students', docId), { periodAttendance: curStat }, { merge: true });

      await batch.commit();

      const updatedSt = { ...inspectStudent, periodAttendance: curStat };
      setInspectStudent(updatedSt);
      setInspectSessionsList(updatedSessions);
      syncUpdatedStudentsState({ [inspectStudent.regNo]: updatedSt });
      setSelectedInspectSessionIds([]);
      setStatusMsg(`✅ Successfully updated ${targetSessionDocIds.length} session(s) to [${newStatus}]!`);
    } catch (err) {
      console.error('Error updating session status:', err);
      alert('Failed to update session status: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRevokeCertificate = async (cert) => {
    if (!window.confirm(`Revoke/Delete Clearance Certificate #${cert.certNumber}?`)) return;
    setLoading(true);
    try {
      const batch = writeBatch(db);
      if (cert.id) {
        batch.delete(doc(db, 'clearance_certificates', cert.id));
      }
      const curStat = JSON.parse(JSON.stringify(getStudentAttStat(inspectStudent)));
      curStat.clearanceCertificates = (curStat.clearanceCertificates || []).filter(
        c => c.id !== cert.id && c.certNumber !== cert.certNumber
      );
      const docId = String(inspectStudent.id || inspectStudent.regNo || '').trim();
      batch.set(doc(db, 'students', docId), { periodAttendance: curStat }, { merge: true });

      await batch.commit();

      const updatedSt = { ...inspectStudent, periodAttendance: curStat };
      setInspectStudent(updatedSt);
      syncUpdatedStudentsState({ [inspectStudent.regNo]: updatedSt });
      setStatusMsg(`✅ Certificate #${cert.certNumber} revoked successfully.`);
    } catch (err) {
      console.error('Error revoking certificate:', err);
      alert('Failed to revoke certificate: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveCertRemarks = async (cert) => {
    if (!editedRemarksText.trim()) return alert('Remarks cannot be empty.');
    setLoading(true);
    try {
      const batch = writeBatch(db);
      if (cert.id) {
        batch.set(doc(db, 'clearance_certificates', cert.id), { remarks: editedRemarksText }, { merge: true });
      }
      const curStat = JSON.parse(JSON.stringify(getStudentAttStat(inspectStudent)));
      curStat.clearanceCertificates = (curStat.clearanceCertificates || []).map(c => {
        if (c.id === cert.id || c.certNumber === cert.certNumber) {
          return { ...c, remarks: editedRemarksText };
        }
        return c;
      });
      const docId = String(inspectStudent.id || inspectStudent.regNo || '').trim();
      batch.set(doc(db, 'students', docId), { periodAttendance: curStat }, { merge: true });

      await batch.commit();

      const updatedSt = { ...inspectStudent, periodAttendance: curStat };
      setInspectStudent(updatedSt);
      syncUpdatedStudentsState({ [inspectStudent.regNo]: updatedSt });
      setEditingCertRemarksId(null);
      setEditedRemarksText('');
      setStatusMsg('✅ Updated certificate remarks.');
    } catch (err) {
      console.error('Error saving remarks:', err);
      alert('Failed to save remarks: ' + err.message);
    } finally {
      setLoading(false);
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
          const docId = String(st.id || st.regNo || '').trim();
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

  const handleAutoClearRehearsalAbsences = async () => {
    if (fetchedClearStudentsList.length === 0) return alert('Please fetch students first.');
    setLoading(true);
    setStatusMsg('⏳ Checking Event Leader rehearsal attendance stamps by date...');
    try {
      const rehearsalCreditsMap = await fetchRehearsalCreditsByRegAndDate();
      const batch = writeBatch(db);
      const updatedMap = {};
      let totalPeriodsCleared = 0;

      fetchedClearStudentsList.forEach(st => {
        const studentRehDates = rehearsalCreditsMap[st.regNo];
        if (!studentRehDates) return;

        const curStat = getStudentAttStat(st);
        const { stat: nextStat, cleared } = applyDateBasedRehearsalCreditsToStat(curStat, studentRehDates);

        if (cleared > 0) {
          totalPeriodsCleared += cleared;
          const docId = String(st.id || st.regNo || '').trim();
          batch.set(doc(db, 'students', docId), { periodAttendance: nextStat }, { merge: true });
          updatedMap[st.regNo] = { ...st, periodAttendance: nextStat };
        }
      });

      if (totalPeriodsCleared > 0) {
        await batch.commit();
        syncUpdatedStudentsState(updatedMap);
        setStatusMsg(`🎉 Auto-cleared ${totalPeriodsCleared} absent period(s) using Event Leader rehearsal timestamps!`);
        handleFetchStudentForClearance();
      } else {
        setStatusMsg('ℹ️ No matching absent dates found with rehearsal attendance.');
      }
    } catch (err) {
      setStatusMsg('❌ Error: ' + err.message);
    } finally {
      setLoading(false);
      setTimeout(() => setStatusMsg(''), 6000);
    }
  };

  // =========================================================================
  // 🌟 3. IMPORT OLD ATTENDANCE DATA (Supports Full Granular Date-by-Date Sessions!)
  // =========================================================================
  const executeImportFromJson = async (jsonMap) => {
    const updatedMap = {};
    let importedCount = 0;
    const notFoundInNewApp = [];
    const nameDiffWarnings = [];
    const matchedNewRegs = new Set();

    // Determine students list (handles full granular export, legacy students map, or flat array)
    let rawStudentsObj = jsonMap.students || jsonMap.attendance || jsonMap;
    const entries = Array.isArray(rawStudentsObj)
      ? rawStudentsObj
      : Object.entries(rawStudentsObj)
          .filter(([k]) => k !== 'sessions' && k !== 'dayIndexes' && k !== 'teachers' && k !== 'metadata' && k !== 'version' && k !== 'exportedAt')
          .map(([k, v]) => ({ jsonKey: k, ...v }));

    // 1. Batch Write Students & Period Attendance Summary (Chunk size 50 for safety)
    for (let i = 0; i < entries.length; i += 50) {
      const chunk = entries.slice(i, i + 50);
      const batch = writeBatch(db);

      chunk.forEach(item => {
        const rawAd = item.adNo || item.admissionNumber || item.admission_number || item.jsonKey || '';
        let cleanAd = String(rawAd).trim().toUpperCase();
        if (cleanAd.startsWith('#')) cleanAd = cleanAd.slice(1).trim();
        if (!cleanAd) return;

        let st = localStudents.find(s =>
          String(s.adNo || '').trim().toUpperCase() === cleanAd ||
          String(s.regNo || '').trim().toUpperCase() === cleanAd ||
          String(s.id || '').trim().toUpperCase() === cleanAd
        );

        if (!st && /^\d{3,5}$/.test(cleanAd)) {
          st = localStudents.find(s => String(s.adNo || '').trim().toUpperCase() === 'U' + cleanAd);
        }

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

        const docId = String(st.id || st.regNo || '').trim();
        const existingPatt = st.periodAttendance || {};
        const existingMinusLogs = Array.isArray(existingPatt.minusLogs) ? existingPatt.minusLogs : [];
        const newMinusLogs = Array.isArray(item.minusLogs) ? item.minusLogs : [];
        const mergedMinusLogs = [...existingMinusLogs];
        newMinusLogs.forEach(ml => {
          if (!mergedMinusLogs.some(em => (em.id && em.id === ml.id) || (em.date === ml.date && em.reason === ml.reason && em.count === ml.count))) {
            mergedMinusLogs.push(ml);
          }
        });
        const totalMinusCount = mergedMinusLogs.reduce((acc, m) => acc + (Number(m.count) || 0), 0);

        const periodAttendance = {
          totalPeriods: calcTotal,
          presentCount: calcPresent,
          officialCount: Number(item.officialCount) || 0,
          medicalCount: Number(item.medicalCount) || 0,
          permittedCount: 0,
          minusCount: totalMinusCount,
          minusLogs: mergedMinusLogs,
          subjectWise: subjData,
          appliedRehearsalDates: existingPatt.appliedRehearsalDates || {},
          updatedAt: new Date().toISOString()
        };

        batch.set(doc(db, 'students', docId), { periodAttendance }, { merge: true });
        updatedMap[st.regNo] = { ...st, periodAttendance };
        importedCount++;
      });
      await batch.commit();
    }

    // 2. Batch Write Granular Period Sessions (Chunk size 80)
    let importedSessionsCount = 0;
    const sessionsList = Array.isArray(jsonMap.sessions) ? jsonMap.sessions : [];
    if (sessionsList.length > 0) {
      setStatusMsg(`⏳ Saving ${sessionsList.length} date-by-date period sessions (Periods 1 to 9)...`);
      for (let i = 0; i < sessionsList.length; i += 80) {
        const chunk = sessionsList.slice(i, i + 80);
        const batch = writeBatch(db);

        chunk.forEach(s => {
          const safeAlias = String(s.classAlias || s.subject || 'Subject').trim();
          const sessionDocId = s.sessionDocId || `periodSession_${s.date}_${safeAlias.replace(/[^a-zA-Z0-9]/g, '_')}_S${s.session || 1}`;

          const TEACHER_MAPPING = {
            'abdussalam_baqavi': 'abdussalambaqavi',
            'aboobacker_sidheeq_hudawi': 'sidheeqhudawi',
            'ajmal_hudawi': 'ajmalhudawi',
            'ashraf_alimi': 'ashraf',
            'aswim_saeed_hudawi': 'aswimhudawi',
            'c.yousuf_faizy': 'yousuffaisy',
            'hassan_nawaz_alimi': 'hassan',
            'hassankutty_baqavi': 'hasankutty',
            'mohammed_hudawi': 'muhammedhudawi',
            'muhammed_ali_hudawi_pi': 'pihudawi',
            'muhammed_ali_shihab_hudawi': 'shihabhudawi',
            'munavir_hudawi': 'munawir',
            'musthaqeem_faizy': 'musthaqeem',
            'muzammil_hudawi': 'muzammil',
            'niyas_hudawi': 'niyas',
            'sayyed_shahul_hameed_hudawi': 'thangal',
            'shabeer_hudawi': 'shabeer',
            'shajahan_hudawi': 'shajahanhudawi',
            'shamsu_sir': 'shamsu',
            'shanid_hudawi': 'shanid',
            'sharafudheen_hudawi': 'sharafu',
            'shuaib_hudawi': 'shuaibhudawi',
            'siraj_hudawi': 'sirajhudawi',
            'yoonus_hudawi': 'yoonushudawi'
          };

          const rawSubStr = String(s.subject || '').trim();
          let cleanSub = rawSubStr;
          const upSub = rawSubStr.toUpperCase();
          if (upSub.includes('THAFSEER')) cleanSub = 'Thafseer';
          else if (upSub.includes('HADEES')) cleanSub = 'Hadith';
          else if (upSub.includes('U:FIQH') || upSub.includes('U: FIQH')) cleanSub = 'U :FIQH';
          else if (upSub.includes('FIQH')) cleanSub = 'Fiqh';
          else if (upSub.includes('AQEED')) cleanSub = 'Aqidah';
          else if (upSub.includes('BALAG')) cleanSub = 'Balagha';
          else if (upSub.includes('MANTHIQ')) cleanSub = 'Logic';
          else if (upSub.includes('ENGLISH')) cleanSub = 'English';
          else if (upSub.includes('ADAB')) cleanSub = 'Adab';
          else if (upSub.includes('URDU')) cleanSub = 'Urdu';
          else if (upSub === 'SS' || upSub.startsWith('SS ') || upSub.endsWith(' SS')) cleanSub = 'Social Science';
          else if (upSub.includes('THAMAD')) cleanSub = 'Thamadun';
          else if (upSub.includes('DIRASATHUL ADYAN') || upSub.includes('DIRASATH') || upSub.includes('ADYAN')) cleanSub = 'Logic';

          const normalizedMap = {};
          Object.entries(s.attendanceMap || {}).forEach(([adOrReg, status]) => {
            const cleanK = String(adOrReg).trim().toUpperCase();
            const matched = localStudents.find(st => 
              String(st.adNo || '').trim().toUpperCase() === cleanK ||
              String(st.regNo || '').trim().toUpperCase() === cleanK
            );
            if (matched) {
              normalizedMap[matched.regNo] = status;
            } else {
              normalizedMap[adOrReg] = status;
            }
          });

          const rawTeacherUser = String(s.teacherUsername || 'admin').toLowerCase().trim();
          const mappedTeacherUser = TEACHER_MAPPING[rawTeacherUser] || rawTeacherUser;
          const matchedTeacherObj = localTeachers.find(ct => ct.username === mappedTeacherUser);

          batch.set(doc(db, 'systemCache', sessionDocId), {
            date: s.date,
            session: Number(s.session) || 1,
            subject: cleanSub,
            classAlias: s.classAlias,
            teacherUsername: mappedTeacherUser,
            teacherName: matchedTeacherObj?.fullName || String(s.teacherName || 'Faculty').trim(),
            attendanceMap: normalizedMap,
            updatedAt: new Date().toISOString()
          }, { merge: true });

          importedSessionsCount++;
        });
        await batch.commit();
      }
    }

    // 3. Batch Write Daily Sessions Indexes (Chunk size 50)
    const dayIndexesObj = jsonMap.dayIndexes || {};
    const dayDates = Object.keys(dayIndexesObj);
    if (dayDates.length > 0) {
      setStatusMsg(`⏳ Indexing ${dayDates.length} calendar dates...`);
      for (let i = 0; i < dayDates.length; i += 50) {
        const chunk = dayDates.slice(i, i + 50);
        const batch = writeBatch(db);

        chunk.forEach(dStr => {
          batch.set(doc(db, 'systemCache', `daySessionsIndex_${dStr}`), {
            date: dStr,
            sessions: dayIndexesObj[dStr] || []
          }, { merge: true });
        });
        await batch.commit();
      }
    }

    // 4. Batch Write Teacher Enrollments & Allocations
    const teachersList = Array.isArray(jsonMap.teachers) ? jsonMap.teachers : [];
    let importedTeachersCount = 0;
    if (teachersList.length > 0) {
      setStatusMsg(`⏳ Linking ${teachersList.length} teacher subject allocations...`);
      const batch = writeBatch(db);
      const TEACHER_MAPPING = {
        'abdussalam_baqavi': 'abdussalambaqavi',
        'aboobacker_sidheeq_hudawi': 'sidheeqhudawi',
        'ajmal_hudawi': 'ajmalhudawi',
        'ashraf_alimi': 'ashraf',
        'aswim_saeed_hudawi': 'aswimhudawi',
        'c.yousuf_faizy': 'yousuffaisy',
        'hassan_nawaz_alimi': 'hassan',
        'hassankutty_baqavi': 'hasankutty',
        'mohammed_hudawi': 'muhammedhudawi',
        'muhammed_ali_hudawi_pi': 'pihudawi',
        'muhammed_ali_shihab_hudawi': 'shihabhudawi',
        'munavir_hudawi': 'munawir',
        'musthaqeem_faizy': 'musthaqeem',
        'muzammil_hudawi': 'muzammil',
        'niyas_hudawi': 'niyas',
        'sayyed_shahul_hameed_hudawi': 'thangal',
        'shabeer_hudawi': 'shabeer',
        'shajahan_hudawi': 'shajahanhudawi',
        'shamsu_sir': 'shamsu',
        'shanid_hudawi': 'shanid',
        'sharafudheen_hudawi': 'sharafu',
        'shuaib_hudawi': 'shuaibhudawi',
        'siraj_hudawi': 'sirajhudawi',
        'yoonus_hudawi': 'yoonushudawi'
      };

      teachersList.forEach(t => {
        const rawUsername = String(t.username || '').toLowerCase().trim();
        if (!rawUsername) return;
        const safeUsername = TEACHER_MAPPING[rawUsername] || rawUsername;
        const existingT = localTeachers.find(x => x.username === safeUsername);
        const mergedEnrollments = [...(existingT?.enrollments || [])];
        (t.enrollments || []).forEach(env => {
          if (!mergedEnrollments.some(e => e.id === env.id || e.alias === env.alias)) {
            mergedEnrollments.push(env);
          }
        });
        batch.set(doc(db, 'teachers', safeUsername), {
          fullName: existingT?.fullName || t.fullName || t.name,
          username: safeUsername,
          role: t.role || existingT?.role || 'teacher',
          enrollments: mergedEnrollments
        }, { merge: true });
        importedTeachersCount++;
      });
      await batch.commit();
    }

    const missingFromOldExport = localStudents
      .filter(s => !matchedNewRegs.has(s.regNo))
      .map(s => ({ adNo: s.adNo, name: s.firstName, className: (s.classes || []).join(', ') }));

    setImportAuditReport({ importedCount, totalAutoCleared: 0, notFoundInNewApp, nameDiffWarnings, missingFromOldExport });
    syncUpdatedStudentsState(updatedMap);
    setStatusMsg(
      `🎉 Successfully imported ${importedCount} students` +
      (importedSessionsCount > 0 ? `, ${importedSessionsCount} period sessions across ${dayDates.length} dates` : '') +
      (importedTeachersCount > 0 ? `, and ${importedTeachersCount} teachers` : '') +
      '!'
    );
  };

  const handleAutoSyncBundledHuzoorData = async () => {
    setLoading(true);
    setStatusMsg('⏳ Fetching bundled Huzoor Server Granular Dataset...');
    setImportAuditReport(null);
    try {
      const res = await fetch('/shuhood_full_granular_export.json');
      if (!res.ok) throw new Error('Could not fetch dataset from server: ' + res.statusText);
      const jsonMap = await res.json();
      await executeImportFromJson(jsonMap);
    } catch (err) {
      console.error('Auto sync error:', err);
      setStatusMsg('❌ Sync failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleImportOldShuhoodFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setImportAuditReport(null);
    setStatusMsg('⏳ Importing old attendance and minus history...');

    try {
      const ext = file.name.split('.').pop().toLowerCase();
      if (ext === 'json') {
        const textContent = await file.text();
        const jsonMap = JSON.parse(textContent);
        await executeImportFromJson(jsonMap);
        return;
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
          const docId = String(st.id || st.regNo || '').trim();
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
        const { stat: nextStat, cleared } = applyDateBasedRehearsalCreditsToStat(curStat, stCredits);

        if (cleared > 0) {
          totalCleared += cleared;
          const docId = String(st.id || st.regNo || '').trim();
          batch.set(doc(db, 'students', docId), { periodAttendance: nextStat }, { merge: true });
          updatedMap[st.regNo] = { ...st, periodAttendance: nextStat };
        }
      });

      if (totalCleared > 0) {
        await batch.commit();
        syncUpdatedStudentsState(updatedMap);
        setStatusMsg(`🎉 Successfully synced & auto-cleared ${totalCleared} rehearsal absent period(s)!`);
      } else {
        setStatusMsg('ℹ️ All rehearsal credits are already up to date.');
      }
    } catch (err) {
      setStatusMsg('❌ Sync error: ' + err.message);
    } finally {
      setLoading(false);
      setTimeout(() => setStatusMsg(''), 6000);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* ============================================================
          VIEW B: MINUS ATTENDANCE
         ============================================================ */}
      {activeTab === 'minus_attendance' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', background: '#ffffff', padding: '16px 20px', borderRadius: '14px', border: '1px solid #e2e8f0' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: '#0f172a' }}>
                ⚖️ Disciplinary Minus Attendance
              </h2>
              <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>
                Deduct periods from student attendance for jamath missing, discipline, or misconduct.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {[
                { id: 'add', label: '➕ Deduct Minus' },
                { id: 'manage', label: '📋 View Minus History' },
                { id: 'excel', label: '📊 Upload Excel' }
              ].map(sub => (
                <button
                  key={sub.id}
                  type="button"
                  onClick={() => setMinusSubTab(sub.id)}
                  style={{
                    padding: '8px 14px',
                    borderRadius: '8px',
                    fontWeight: '700',
                    fontSize: '12px',
                    cursor: 'pointer',
                    border: minusSubTab === sub.id ? '1px solid #4f46e5' : '1px solid #cbd5e1',
                    background: minusSubTab === sub.id ? '#4f46e5' : '#ffffff',
                    color: minusSubTab === sub.id ? '#ffffff' : '#334155'
                  }}
                >
                  {sub.label}
                </button>
              ))}
            </div>
          </div>

          {minusSubTab === 'add' && (
            <div style={{ ...styles.card, maxWidth: '780px' }}>
              <form onSubmit={handleSaveMinus} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ fontWeight: '800', fontSize: '15px', color: '#0f172a', borderBottom: '1px solid #f1f5f9', paddingBottom: '10px' }}>
                  {editingMinusLog ? `✏️ Edit Minus Record (${selectedMinusStudent?.firstName})` : '➕ Deduct Minus Attendance (Single or Multi-Student)'}
                </div>

                {!editingMinusLog && (
                  <div>
                    <label style={styles.label}>Search &amp; Add Student(s) by Admission Number or Name</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        type="text"
                        value={minusSearchQuery}
                        onChange={e => setMinusSearchQuery(e.target.value)}
                        placeholder="Type comma-separated Ad.Nos (e.g. 3551, 3392, U1107)..."
                        style={{ ...styles.input, flex: 1 }}
                      />
                      <button
                        type="button"
                        onClick={handleAddCommaSeparatedMinusStudents}
                        style={{ ...styles.buttonPrimary, whiteSpace: 'nowrap' }}
                      >
                        ➕ Add to List
                      </button>
                    </div>

                    {matchingMinusStudents.length > 0 && (
                      <div style={{ marginTop: '6px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '6px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {matchingMinusStudents.map(st => (
                          <button
                            key={st.regNo}
                            type="button"
                            onClick={() => {
                              setSelectedMinusStudentsList(prev => prev.some(x => x.regNo === st.regNo) ? prev : [...prev, st]);
                              setSelectedMinusStudent(st);
                              setMinusSearchQuery('');
                            }}
                            style={{ padding: '4px 10px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '11px', fontWeight: '700', cursor: 'pointer' }}
                          >
                            + {st.firstName} (#{st.adNo})
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* SELECTED STUDENTS PILLS */}
                {selectedMinusStudentsList.length > 0 && !editingMinusLog && (
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '14px' }}>
                    <div style={{ fontSize: '12px', fontWeight: '800', color: '#0f172a', marginBottom: '8px' }}>
                      Selected Students ({selectedMinusStudentsList.length}):
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      {selectedMinusStudentsList.map(st => (
                        <span key={st.regNo} style={{ background: '#eef2ff', color: '#4f46e5', padding: '5px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: '700', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          {st.firstName} (#{st.adNo})
                          <button
                            type="button"
                            onClick={() => setSelectedMinusStudentsList(prev => prev.filter(x => x.regNo !== st.regNo))}
                            style={{ background: 'none', border: 'none', color: '#ef4444', fontWeight: '900', cursor: 'pointer' }}
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px' }}>
                  <div>
                    <label style={styles.label}>Minus Periods</label>
                    <input
                      type="number"
                      min="1"
                      max="50"
                      value={minusCount}
                      onChange={e => setMinusCount(Math.max(1, parseInt(e.target.value) || 1))}
                      style={styles.input}
                    />
                  </div>
                  <div>
                    <label style={styles.label}>Reason for Deduction</label>
                    <input
                      type="text"
                      value={minusReason}
                      onChange={e => setMinusReason(e.target.value)}
                      placeholder="e.g. Subh Jamath Missing 5/11/26..."
                      style={styles.input}
                      required
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
                  {editingMinusLog && (
                    <button
                      type="button"
                      onClick={() => { setEditingMinusLog(null); setMinusReason(''); setMinusCount(1); }}
                      style={styles.buttonSecondary}
                    >
                      Cancel Edit
                    </button>
                  )}
                  <button type="submit" disabled={loading} style={styles.buttonDanger}>
                    {editingMinusLog ? '💾 Update Minus Record' : `🚨 Deduct -${minusCount} Period(s)`}
                  </button>
                </div>
              </form>
            </div>
          )}

          {minusSubTab === 'excel' && (
            <div style={{ ...styles.card, maxWidth: '780px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '14px' }}>
                <div>
                  <h3 style={{ margin: '0 0 6px 0', fontSize: '17px', fontWeight: '800', color: '#0f172a' }}>
                    📊 Bulk Minus Attendance Excel Import
                  </h3>
                  <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
                    Upload an Excel (.xlsx, .xls) or CSV file with minus records to update student balances in bulk.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleDownloadBulkMinusTemplate}
                  style={{
                    padding: '9px 16px',
                    borderRadius: '8px',
                    border: '1.5px solid #4f46e5',
                    background: '#eef2ff',
                    color: '#4f46e5',
                    fontSize: '13px',
                    fontWeight: '800',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <span>⬇️</span> Download Template (.xlsx)
                </button>
              </div>

              {/* Helpful Import Guidance & Rules Notice */}
              <div style={{ padding: '14px 16px', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '13px', lineHeight: 1.6, marginBottom: '16px' }}>
                <div style={{ fontWeight: '800', color: '#0f172a', marginBottom: '4px' }}>
                  📌 Important Import Rules &amp; Guidelines:
                </div>
                <ul style={{ margin: 0, paddingLeft: '20px', color: '#334155' }}>
                  <li>
                    <strong>Student Matching by Admission No Only:</strong> Student matching is performed strictly by <code>Admission No</code>. The <code>Student Name</code> column is for your visual reference only and will not fail if there are spelling or casing differences.
                  </li>
                  <li>
                    <strong>Urdu Stream Students:</strong> For Urdu stream students, the Admission No. <strong>must include the uppercase &apos;U&apos; prefix</strong> at the beginning (e.g. <code>U1115</code>, <code>U1107</code>). General students have plain numbers (e.g. <code>3529</code>).
                  </li>
                  <li>
                    <strong>Date Format:</strong> Enter dates as <strong>Day-Month-Year</strong> (e.g. <code>07-11-2026</code>, <code>07/11/2026</code>, or <code>07 11 2026</code>). Standard ISO dates (<code>2026-11-07</code>) and Excel date cells are also accepted.
                  </li>
                  <li>
                    <strong>Columns:</strong> <code>Admission No</code>, <code>Date</code>, <code>Minus</code>, <code>Reason</code>, <code>Teacher</code>.
                  </li>
                </ul>
              </div>

              <div style={{ marginTop: '10px' }}>
                <label style={{ ...styles.label, marginBottom: '6px' }}>
                  Select Completed Excel / CSV Sheet to Import:
                </label>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleBulkMinusExcelUpload}
                  disabled={loading}
                  style={{ ...styles.input, padding: '10px 14px', cursor: 'pointer' }}
                />
              </div>

              {/* DETAILED IMPORT SUMMARY & MISMATCH AUDIT REPORT */}
              {bulkMinusResultReport && (
                <div style={{
                  marginTop: '18px',
                  padding: '16px 18px',
                  borderRadius: '12px',
                  border: bulkMinusResultReport.failures.length > 0 ? '1.5px solid #fecdd3' : '1.5px solid #a7f3d0',
                  background: bulkMinusResultReport.failures.length > 0 ? '#fff1f2' : '#f0fdf4',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
                    <div>
                      <h4 style={{ margin: '0 0 6px', fontSize: '15px', fontWeight: '800', color: bulkMinusResultReport.failures.length > 0 ? '#991b1b' : '#166534' }}>
                        {bulkMinusResultReport.failures.length > 0
                          ? `⚠️ Import Summary: ${bulkMinusResultReport.failures.length} Issue(s) Found`
                          : `✅ Import Complete: All Records Successfully Applied!`}
                      </h4>
                      <p style={{ margin: 0, fontSize: '13px', color: '#475569' }}>
                        Total Rows in File: <strong>{bulkMinusResultReport.totalRows}</strong> • Successfully Applied: <strong style={{ color: '#16a34a' }}>{bulkMinusResultReport.successCount}</strong> • Skipped / Issues: <strong style={{ color: '#dc2626' }}>{bulkMinusResultReport.failures.length}</strong>
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {bulkMinusResultReport.successCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setMinusSubTab('manage')}
                          style={{ padding: '6px 12px', borderRadius: '6px', background: '#059669', color: '#ffffff', border: 'none', fontSize: '12px', fontWeight: '800', cursor: 'pointer' }}
                        >
                          📋 View History Register
                        </button>
                      )}
                      {bulkMinusResultReport.failures.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            const text = `BULK MINUS IMPORT ISSUES REPORT\n-------------------------------\n` +
                              bulkMinusResultReport.failures.map(f => `• Excel Row ${f.rowNumber}: Ad.No "${f.admissionNo}" (${f.studentName}) -> Reason: ${f.reason}`).join('\n');
                            navigator.clipboard.writeText(text);
                            alert('Copied all issue details to clipboard!');
                          }}
                          style={{ padding: '6px 12px', borderRadius: '6px', background: '#ffffff', border: '1px solid #cbd5e1', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}
                        >
                          📋 Copy Issue Details
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setBulkMinusResultReport(null)}
                        style={{ padding: '6px 12px', borderRadius: '6px', background: '#ffffff', border: '1px solid #cbd5e1', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}
                      >
                        ✕ Dismiss
                      </button>
                    </div>
                  </div>

                  {bulkMinusResultReport.failures.length > 0 && (
                    <div style={{ marginTop: '14px', maxHeight: '260px', overflowY: 'auto', background: '#ffffff', borderRadius: '8px', border: '1px solid #fecdd3', padding: '6px' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                        <thead>
                          <tr style={{ borderBottom: '1.5px solid #f1f5f9', color: '#475569', background: '#f8fafc' }}>
                            <th style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>Excel Row</th>
                            <th style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>Ad.No in File</th>
                            <th style={{ padding: '7px 10px' }}>Name in File</th>
                            <th style={{ padding: '7px 10px' }}>Problem / Error Details</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bulkMinusResultReport.failures.map((f, i) => (
                            <tr key={i} style={{ borderBottom: '1px solid #f8fafc', background: i % 2 === 0 ? '#ffffff' : '#fff5f5' }}>
                              <td style={{ padding: '7px 10px', fontWeight: '800', color: '#dc2626', whiteSpace: 'nowrap' }}>Row {f.rowNumber}</td>
                              <td style={{ padding: '7px 10px', fontWeight: '700', whiteSpace: 'nowrap' }}>{f.admissionNo}</td>
                              <td style={{ padding: '7px 10px', color: '#64748b' }}>{f.studentName}</td>
                              <td style={{ padding: '7px 10px', color: '#991b1b', fontWeight: '600' }}>{f.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {minusSubTab === 'manage' && (
            <>
              {bulkMinusResultReport?.failures?.length > 0 && (
                <div style={{ marginBottom: '14px', padding: '12px 16px', background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                  <div style={{ fontSize: '13px', color: '#991b1b', fontWeight: '700' }}>
                    ⚠️ Notice: Your last Excel import had {bulkMinusResultReport.failures.length} skipped row(s) due to unrecognized admission numbers or format issues.
                  </div>
                  <button
                    type="button"
                    onClick={() => setMinusSubTab('excel')}
                    style={{ padding: '6px 14px', background: '#991b1b', color: '#ffffff', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: '800', cursor: 'pointer' }}
                  >
                    🔍 Review Mismatch Details
                  </button>
                </div>
              )}

              <div style={{ ...styles.card, padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800', color: '#0f172a' }}>
                    📋 Minus History Register ({allFlattenedMinusRecords.length} records)
                  </h3>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <input
                    type="text"
                    value={minusTableSearch}
                    onChange={e => setMinusTableSearch(e.target.value)}
                    placeholder="Search student or reason..."
                    style={{ ...styles.input, maxWidth: '200px', padding: '6px 12px', fontSize: '12px' }}
                  />
                  <button type="button" onClick={handleExportMinusRecordsExcel} style={styles.buttonPrimary}>
                    ⬇️ Export Excel
                  </button>
                </div>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '11px', fontWeight: '800', textTransform: 'uppercase' }}>
                      <th style={{ padding: '12px 16px' }}>DATE</th>
                      <th style={{ padding: '12px 16px' }}>STUDENT</th>
                      <th style={{ padding: '12px 16px' }}>AD.NO</th>
                      <th style={{ padding: '12px 16px' }}>CLASS</th>
                      <th style={{ padding: '12px 16px', textAlign: 'center' }}>MINUS</th>
                      <th style={{ padding: '12px 16px' }}>REASON</th>
                      <th style={{ padding: '12px 16px' }}>ISSUED BY</th>
                      <th style={{ padding: '12px 16px', textAlign: 'right' }}>ACTIONS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allFlattenedMinusRecords.length === 0 ? (
                      <tr>
                        <td colSpan="8" style={{ padding: '24px', textAlign: 'center', color: '#64748b', fontWeight: '600' }}>
                          No minus attendance records found.
                        </td>
                      </tr>
                    ) : (
                      allFlattenedMinusRecords.map(r => (
                        <tr key={r.log.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '12px 16px', color: '#64748b' }}>{r.log.date || '—'}</td>
                          <td style={{ padding: '12px 16px', fontWeight: '700', color: '#0f172a' }}>{r.studentName}</td>
                          <td style={{ padding: '12px 16px', color: '#475569' }}>#{r.adNo}</td>
                          <td style={{ padding: '12px 16px', fontWeight: '600', color: '#0f766e' }}>{r.className}</td>
                          <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                            <span style={{ background: '#ffe4e6', color: '#e11d48', padding: '3px 8px', borderRadius: '6px', fontWeight: '800', fontSize: '12px' }}>
                              -{r.log.count}
                            </span>
                          </td>
                          <td style={{ padding: '12px 16px', color: '#334155' }}>{r.log.reason || 'Disciplinary Deduction'}</td>
                          <td style={{ padding: '12px 16px', color: '#64748b' }}>{r.log.issuedBy || 'Admin'}</td>
                          <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                            {r.isMine && (
                              <div style={{ display: 'inline-flex', gap: '6px' }}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingMinusLog(r.log);
                                    setSelectedMinusStudent(r.studentObj);
                                    setMinusCount(r.log.count || 1);
                                    setMinusReason(r.log.reason || '');
                                    setMinusSubTab('add');
                                  }}
                                  style={{ padding: '4px 8px', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '11px', fontWeight: '700', cursor: 'pointer' }}
                                >
                                  ✏️ Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteMinus(r.studentObj, r.log)}
                                  style={{ padding: '4px 8px', background: '#fff1f2', border: '1px solid #fecdd3', color: '#e11d48', borderRadius: '6px', fontSize: '11px', fontWeight: '700', cursor: 'pointer' }}
                                >
                                  🗑️ Delete
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            </>
          )}
        </div>
      )}

      {/* ============================================================
          VIEW C: ATTENDANCE CLEARANCE DESK (With Step 2 Absent Period Selector)
         ============================================================ */}
    {activeTab === 'clearance' && userRole === 'admin' && (
     <AbsenceClearanceManager
       userRole={userRole}
       loggedInUser={loggedInUser}
       localStudents={localStudents}
       localTeachers={localTeachers}
       onStudentsUpdated={(nextStudents) => {
         const map = {};
         nextStudents.forEach(s => { map[s.regNo] = s; });
         syncUpdatedStudentsState(map);
       }}
     />
   )}
      {/* ============================================================
          VIEW D: SHORTAGE ATTENDANCE DESK (< 85%)
         ============================================================ */}
      {activeTab === 'shortage' && (
        <div style={styles.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: '#0f172a' }}>
                🚨 Attendance Shortage Notice (&lt; 85% Net Attendance)
              </h3>
              <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>
                Students at risk of exam hall debarment due to low attendance and disciplinary deductions.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <select
                value={shortageClassFilter}
                onChange={e => setShortageClassFilter(e.target.value)}
                style={{ ...styles.input, width: 'auto', fontWeight: '700' }}
              >
                <option value="ALL">{userRole === 'admin' ? 'All Classes' : `All My Classes (${shortageDropdownClasses.length})`}</option>
                {shortageDropdownClasses.map(c => (
                  <option key={c} value={c}>
                    Class {c}{myCtClasses.includes(c) ? ' (Class Teacher)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: '#fff1f2', borderBottom: '1px solid #fecdd3', color: '#be123c', fontSize: '11px', fontWeight: '800', textTransform: 'uppercase' }}>
                  <th style={{ padding: '12px 14px' }}>#</th>
                  <th style={{ padding: '12px 14px' }}>STUDENT NAME</th>
                  <th style={{ padding: '12px 14px' }}>AD.NO</th>
                  <th style={{ padding: '12px 14px' }}>CLASS</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center' }}>TOTAL PERIODS</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center' }}>PRESENT</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center' }}>MINUS</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center' }}>NET %</th>
                  <th style={{ padding: '12px 14px', textAlign: 'right' }}>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {localStudents
                  .filter(st => {
                    if (userRole !== 'admin') {
                      const reg = String(st.regNo || st.id || '').trim();
                      const ad = String(st.adNo || '').trim().toUpperCase();
                      const stClasses = (st.classes || [st.class] || []).map(c => String(c).toUpperCase().trim());
                      const isCtStudent = stClasses.some(c => myCtClasses.includes(c));
                      const isTeachingStudent = teacherAllowedStudentRegs.has(reg) || teacherAllowedStudentRegs.has(ad) || teacherAllowedStudentRegs.has(st.regNo);
                      if (!isCtStudent && !isTeachingStudent) return false;
                    }
                    const stCls = (st.classes || [])[0] || st.class || '';
                    if (shortageClassFilter !== 'ALL' && !stCls.includes(shortageClassFilter)) return false;
                    const stat = getStudentAttStat(st);
                    const totP = Number(stat.totalPeriods) || 0;
                    if (totP <= 0) return false;
                    const presP = Number(stat.presentCount) || 0;
                    const minusC = Number(stat.minusCount) || 0;
                    const netPres = Math.max(0, presP - minusC);
                    return ((netPres / totP) * 100) < 85;
                  })
                  .map((st, idx) => {
                    const stat = getStudentAttStat(st);
                    const totP = Number(stat.totalPeriods) || 0;
                    const presP = Number(stat.presentCount) || 0;
                    const minusC = Number(stat.minusCount) || 0;
                    const netPres = Math.max(0, presP - minusC);
                    const netPct = ((netPres / totP) * 100).toFixed(1);

                    return (
                      <tr key={st.regNo} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '12px 14px', color: '#64748b' }}>{idx + 1}</td>
                        <td style={{ padding: '12px 14px', fontWeight: '700', color: '#0f172a' }}>{st.firstName}</td>
                        <td style={{ padding: '12px 14px', color: '#475569' }}>#{st.adNo}</td>
                        <td style={{ padding: '12px 14px', fontWeight: '700', color: '#0f766e' }}>{(st.classes || []).join(', ')}</td>
                        <td style={{ padding: '12px 14px', textAlign: 'center' }}>{totP}</td>
                        <td style={{ padding: '12px 14px', textAlign: 'center', color: '#047857' }}>{presP}</td>
                        <td style={{ padding: '12px 14px', textAlign: 'center', color: '#e11d48' }}>-{minusC}</td>
                        <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                          <span style={{ background: '#ffe4e6', color: '#e11d48', padding: '3px 10px', borderRadius: '999px', fontWeight: '800', fontSize: '12px' }}>
                            {netPct}%
                          </span>
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                          <button
                            type="button"
                            onClick={() => openDirectWhatsApp(
                              st.parentWhatsapp || st.parentMobile,
                              `Assalamu Alaikum, urgent notice regarding ${st.firstName} (#${st.adNo}): Current semester attendance is ${netPct}% (Below 85% requirement). Please contact the academic office.`
                            )}
                            style={{ padding: '5px 10px', background: '#f8fafc', color: '#334155', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '11px', fontWeight: '700', cursor: 'pointer' }}
                          >
                            💬 WhatsApp Parent
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ============================================================
          VIEW E: OLD DATA IMPORTER (With Granular Session & Day Index Support)
         ============================================================ */}
      {activeTab === 'import_old' && userRole === 'admin' && (
        <div style={{ ...styles.card, display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <h3 style={{ margin: '0 0 6px 0', fontSize: '18px', color: '#0f172a', fontWeight: '800' }}>
              📂 Import Old Attendance Data (JSON or Excel)
            </h3>
            <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
              Upload <code>shuhood_full_granular_export.json</code>, <code>shuhood_semester_export.json</code>, or an Excel/CSV sheet to import full date-by-date period sessions, teacher allocations, subject breakdowns, and minus logs.
            </p>
          </div>

          <div style={{ padding: '16px 18px', background: '#eef2ff', borderRadius: '12px', border: '1.5px solid #c7d2fe', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <div style={{ fontWeight: '800', color: '#312e81', fontSize: '15px' }}>⚡ 1-Click Fast Sync Bundled Huzoor Dataset</div>
              <div style={{ fontSize: '12px', color: '#4338ca', marginTop: '2px' }}>
                Directly imports 2,700 granular period sessions across 55 dates with 1-9 periods (FN 1-6 &amp; AN 7-9) and 270 students.
              </div>
            </div>
            <button
              type="button"
              onClick={handleAutoSyncBundledHuzoorData}
              disabled={loading}
              style={{ ...styles.buttonPrimary, background: '#4f46e5', padding: '12px 22px', fontSize: '14px', fontWeight: '800' }}
            >
              ⚡ 1-Click Sync Now
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13px', fontWeight: '700', color: '#475569' }}>Or Upload Custom Export File (.json, .xlsx, .csv):</label>
            <input type="file" accept=".json,.xlsx,.xls,.csv" onChange={handleImportOldShuhoodFile} disabled={loading} style={styles.input} />
          </div>

          <div style={{ padding: '14px 16px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <div style={{ fontWeight: '800', color: '#0f172a', fontSize: '14px' }}>🔄 Sync Rehearsal Credits Anytime</div>
              <div style={{ fontSize: '12px', color: '#64748b' }}>
                Click to apply any Event Leader rehearsal sessions to already-imported student records by date.
              </div>
            </div>
            <button type="button" onClick={handleSyncRehearsalCreditsToExistingRecords} disabled={loading} style={styles.buttonPrimary}>
              🔄 Auto-Apply Rehearsal Credits
            </button>
          </div>

          {importAuditReport && (
            <div style={{ padding: '14px', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0', fontWeight: '700', fontSize: '13px' }}>
              ✅ Matched &amp; Imported: <strong style={{ color: '#047857' }}>{importAuditReport.importedCount}</strong> • ❌ In Old App Only: <strong style={{ color: '#e11d48' }}>{importAuditReport.notFoundInNewApp.length}</strong> • 📋 In New App Only: <strong style={{ color: '#4f46e5' }}>{importAuditReport.missingFromOldExport.length}</strong>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
