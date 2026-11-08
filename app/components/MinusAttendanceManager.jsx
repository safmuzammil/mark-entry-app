'use client';
import React, { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { db } from '../../lib/firebase';
import { doc, setDoc, writeBatch } from 'firebase/firestore';
import { DEFAULT_CLASSES, styles } from './erpConstants';
import { ProfileAvatar } from './ErpExtensions';

const QUICK_MINUS_REASONS = [
  'Jamath Missing',
  'Late Entry to Campus / Class',
  'Hostel Disciplinary Violation',
  'Dress Code / Uniform Issue',
  'Classroom Misconduct',
  'Unexcused Roll-Call Absence',
  'Library Misconduct',
  'Cell Phone / Gadget Violation'
];

export default function MinusAttendanceManager({
  userRole = 'admin', // 'admin' | 'teacher'
  loggedInUser = null,
  activeTeacherObj = null,
  localStudents = [],
  localTeachers = [],
  onStudentsUpdated = null
}) {
  const [activeSubTab, setActiveSubTab] = useState('add'); // 'add' | 'history' | 'excel'

  // --- Add Minus State ---
  const [minusSearchQuery, setMinusSearchQuery] = useState('');
  const [selectedStudentsList, setSelectedStudentsList] = useState([]);
  const [selectedSingleStudent, setSelectedSingleStudent] = useState(null);
  const [minusCount, setMinusCount] = useState(3);
  const [adminOnBehalfOfUsername, setAdminOnBehalfOfUsername] = useState('admin');
  const [minusReason, setMinusReason] = useState('');
  const [minusDate, setMinusDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [quickClassFilter, setQuickClassFilter] = useState('');

  // --- Manage & Filter State ---
  const [tableSearch, setTableSearch] = useState('');
  const [filterClass, setFilterClass] = useState('ALL');
  const [filterTeacher, setFilterTeacher] = useState('ALL');
  const [filterDateRange, setFilterDateRange] = useState('ALL'); // 'ALL' | 'TODAY' | 'WEEK' | 'MONTH'

  // --- Edit Modal State ---
  const [editingLogItem, setEditingLogItem] = useState(null); // { log, student }
  const [editMinusCount, setEditMinusCount] = useState(3);
  const [editMinusReason, setEditMinusReason] = useState('');
  const [editIssuedByUsername, setEditIssuedByUsername] = useState('admin');

  // --- Async & Status State ---
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState({ text: '', type: '' });
  const [excelReport, setExcelReport] = useState(null);

  // Helper to extract student periodAttendance structure safely
  const getStudentAttStat = (st) => {
    const p = st?.periodAttendance || {};
    return {
      presentCount: Number(p.presentCount) || 0,
      totalPeriods: Number(p.totalPeriods) || 0,
      minusCount: Number(p.minusCount) || 0,
      minusLogs: Array.isArray(p.minusLogs) ? p.minusLogs : [],
      subjectWise: typeof p.subjectWise === 'object' && p.subjectWise !== null ? p.subjectWise : {}
    };
  };

  // Ownership Matcher: Teacher can ONLY modify (and view) minus records THEY issued
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

  // Autocomplete matching students for Add Minus input
  const lastToken = minusSearchQuery.split(',').pop().trim().toLowerCase();
  const matchingStudents = useMemo(() => {
    if (!lastToken || lastToken.length < 2) return [];
    return localStudents.filter(s => {
      const ad = String(s.adNo || '').toLowerCase();
      const name = String(s.firstName || s.name || '').toLowerCase();
      const reg = String(s.regNo || '').toLowerCase();
      return ad.includes(lastToken) || name.includes(lastToken) || reg.includes(lastToken);
    }).slice(0, 8);
  }, [lastToken, localStudents]);

  // Handle adding comma-separated Admission Numbers (e.g. "3551, 3392, U1107")
  const handleAddCommaSeparatedStudents = () => {
    const rawTokens = minusSearchQuery.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
    if (rawTokens.length === 0) return;

    const added = [];
    rawTokens.forEach(tok => {
      const cleanTok = tok.replace('#', '');
      const found = localStudents.find(s => {
        const sAd = String(s.adNo || '').toUpperCase().replace('#', '');
        const sReg = String(s.regNo || '').toUpperCase();
        const sName = String(s.firstName || s.name || '').toUpperCase();
        return sAd === cleanTok || sReg === cleanTok || sName.includes(cleanTok);
      });
      if (found && !selectedStudentsList.some(x => x.regNo === found.regNo)) {
        added.push(found);
      }
    });

    if (added.length > 0) {
      setSelectedStudentsList(prev => [...prev, ...added]);
      if (!selectedSingleStudent) setSelectedSingleStudent(added[0]);
      setMinusSearchQuery('');
      setStatusMsg({ text: `Added ${added.length} student(s) to deduction list.`, type: 'info' });
    } else {
      alert(`Could not find any matching students for: "${minusSearchQuery}". Try admission numbers like 3551 or U1107.`);
    }
  };

  // Add all students of a specific class
  const handleAddEntireClass = (clsName) => {
    if (!clsName) return;
    const clsStudents = localStudents.filter(s => (s.classes || [s.class]).some(c => String(c).toUpperCase() === clsName.toUpperCase()));
    if (clsStudents.length === 0) return alert(`No students found in class ${clsName}.`);

    const newOnes = clsStudents.filter(s => !selectedStudentsList.some(x => x.regNo === s.regNo));
    setSelectedStudentsList(prev => [...prev, ...newOnes]);
    if (!selectedSingleStudent && newOnes.length > 0) setSelectedSingleStudent(newOnes[0]);
    setStatusMsg({ text: `Added ${newOnes.length} students from class ${clsName}.`, type: 'info' });
  };

  // Save Minus (Single or Multi-student batch)
  const handleSaveMinus = async (e) => {
    e.preventDefault();
    const countNum = Math.abs(Number(minusCount));
    if (isNaN(countNum) || countNum <= 0) return alert('Please enter a valid positive number of periods to deduct.');
    if (!minusReason.trim()) return alert('Please specify a reason for this minus attendance.');

    const targets = selectedStudentsList.length > 0
      ? selectedStudentsList
      : selectedSingleStudent
        ? [selectedSingleStudent]
        : [];

    if (targets.length === 0) return alert('Please select or add at least one student first.');

    setLoading(true);
    setStatusMsg({ text: 'Applying minus deduction(s)...', type: 'info' });

    try {
      const batch = writeBatch(db);
      const updatedMap = {};
      const dateToUse = minusDate || new Date().toISOString().split('T')[0];
      let issuerName = loggedInUser?.fullName || activeTeacherObj?.fullName || (userRole === 'admin' ? 'Central Admin' : 'Faculty');
      let issuerUname = String(loggedInUser?.username || activeTeacherObj?.username || (userRole === 'admin' ? 'admin' : 'faculty')).toLowerCase();

      if (userRole === 'admin') {
        if (adminOnBehalfOfUsername === 'admin') {
          issuerName = 'Central Admin';
          issuerUname = 'admin';
        } else {
          const chosenTeacher = localTeachers.find(t => t.username === adminOnBehalfOfUsername);
          if (chosenTeacher) {
            issuerName = chosenTeacher.fullName || 'Faculty';
            issuerUname = chosenTeacher.username;
          }
        }
      }

      targets.forEach((targetSt, idx) => {
        const st = localStudents.find(s => s.regNo === targetSt.regNo) || targetSt;
        const docId = String(st.id || st.regNo || '').trim();
        const curStat = JSON.parse(JSON.stringify(getStudentAttStat(st)));

        const newLog = {
          id: `minus_${Date.now()}_${idx}`,
          date: dateToUse,
          count: countNum,
          reason: minusReason.trim(),
          issuedBy: issuerName,
          issuedByUsername: issuerUname,
          createdAt: new Date().toISOString()
        };

        const updatedLogs = [newLog, ...(curStat.minusLogs || [])];
        curStat.minusLogs = updatedLogs;
        // Strictly applies ONLY to total minusCount - NEVER touches subjectWise
        curStat.minusCount = updatedLogs.reduce((sum, item) => sum + (Number(item.count) || 0), 0);

        batch.set(doc(db, 'students', docId), { periodAttendance: curStat }, { merge: true });
        updatedMap[st.regNo] = { ...st, periodAttendance: curStat };
      });

      await batch.commit();

      if (onStudentsUpdated) {
        onStudentsUpdated(localStudents.map(s => updatedMap[s.regNo] || s));
      }

      setStatusMsg({
        text: `✅ Deducted -${countNum} period(s) from ${targets.length} student(s) successfully! Total attendance updated.`,
        type: 'success'
      });
      setSelectedStudentsList([]);
      setSelectedSingleStudent(null);
      setMinusReason('');
      setMinusCount(3);
      if (userRole === 'admin') setAdminOnBehalfOfUsername('admin');
    } catch (err) {
      console.error('Error applying minus:', err);
      setStatusMsg({ text: '❌ Failed to save minus: ' + err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  // Save Edit of an existing minus log
  const handleSaveEditMinus = async (e) => {
    e.preventDefault();
    if (!editingLogItem) return;
    const { log, student } = editingLogItem;
    const newCount = Math.abs(Number(editMinusCount));
    if (isNaN(newCount) || newCount <= 0) return alert('Please enter a valid positive number of periods.');
    if (!editMinusReason.trim()) return alert('Please enter a reason.');

    if (!canUserModifyMinusLog(log)) {
      return alert('⛔ Permission Denied: You can only edit minus entries that YOU issued.');
    }

    setLoading(true);
    try {
      const docId = String(student.id || student.regNo || '').trim();
      const curStat = JSON.parse(JSON.stringify(getStudentAttStat(student)));

      let updatedIssuerName = log.issuedBy;
      let updatedIssuerUsername = log.issuedByUsername;
      if (userRole === 'admin') {
        if (editIssuedByUsername === 'admin') {
          updatedIssuerName = 'Central Admin';
          updatedIssuerUsername = 'admin';
        } else {
          const chosenTeacher = localTeachers.find(t => t.username === editIssuedByUsername);
          if (chosenTeacher) {
            updatedIssuerName = chosenTeacher.fullName || 'Faculty';
            updatedIssuerUsername = chosenTeacher.username;
          }
        }
      }

      const updatedLogs = (curStat.minusLogs || []).map(l => {
        if (l.id === log.id) {
          return {
            ...l,
            count: newCount,
            reason: editMinusReason.trim(),
            issuedBy: updatedIssuerName,
            issuedByUsername: updatedIssuerUsername,
            editedAt: new Date().toISOString().split('T')[0]
          };
        }
        return l;
      });

      curStat.minusLogs = updatedLogs;
      curStat.minusCount = updatedLogs.reduce((sum, item) => sum + (Number(item.count) || 0), 0);

      await setDoc(doc(db, 'students', docId), { periodAttendance: curStat }, { merge: true });

      const updatedSt = { ...student, periodAttendance: curStat };
      if (onStudentsUpdated) {
        onStudentsUpdated(localStudents.map(s => s.regNo === student.regNo ? updatedSt : s));
      }

      setStatusMsg({
        text: `✅ Updated minus record for ${student.firstName} to -${newCount} period(s).`,
        type: 'success'
      });
      setEditingLogItem(null);
    } catch (err) {
      alert('Error updating minus record: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Delete Minus log (Restores the periods to the student)
  const handleDeleteMinus = async (logItem, studentObj) => {
    if (!canUserModifyMinusLog(logItem)) {
      return alert('⛔ Permission Denied: You can only delete minus entries that YOU issued.');
    }

    if (!window.confirm(`Restore +${logItem.count} period(s) to ${studentObj.firstName} (#${studentObj.adNo}) and permanently delete this minus record?`)) {
      return;
    }

    setLoading(true);
    try {
      const docId = String(studentObj.id || studentObj.regNo || '').trim();
      const curStat = JSON.parse(JSON.stringify(getStudentAttStat(studentObj)));

      const updatedLogs = (curStat.minusLogs || []).filter(l => l.id !== logItem.id);
      curStat.minusLogs = updatedLogs;
      curStat.minusCount = updatedLogs.reduce((sum, item) => sum + (Number(item.count) || 0), 0);

      await setDoc(doc(db, 'students', docId), { periodAttendance: curStat }, { merge: true });

      const updatedSt = { ...studentObj, periodAttendance: curStat };
      if (onStudentsUpdated) {
        onStudentsUpdated(localStudents.map(s => s.regNo === studentObj.regNo ? updatedSt : s));
      }

      setStatusMsg({
        text: `✅ Restored ${logItem.count} period(s) to ${studentObj.firstName}. Record deleted.`,
        type: 'success'
      });
    } catch (err) {
      alert('Error deleting minus record: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Flatten and Filter all minus records according to userRole and filters
  const allFlattenedMinusRecords = useMemo(() => {
    const list = [];
    const todayStr = new Date().toISOString().split('T')[0];

    localStudents.forEach(st => {
      const stat = getStudentAttStat(st);
      const stClasses = Array.isArray(st.classes) ? st.classes : [st.class];

      (stat.minusLogs || []).forEach(log => {
        const isMine = canUserModifyMinusLog(log);

        // 🌟 Strict Rule: Teachers can ONLY see minus records THEY issued
        if (userRole !== 'admin' && !isMine) {
          return;
        }

        // Filter: Teacher (Admin only)
        if (userRole === 'admin' && filterTeacher !== 'ALL') {
          const lTeacher = String(log.issuedByUsername || log.issuedBy || '').toLowerCase();
          if (!lTeacher.includes(filterTeacher.toLowerCase())) return;
        }

        // Filter: Class
        if (filterClass !== 'ALL') {
          if (!stClasses.some(c => String(c).toUpperCase() === filterClass.toUpperCase())) return;
        }

        // Filter: Date Range
        if (filterDateRange === 'TODAY' && log.date !== todayStr) return;
        if (filterDateRange === 'WEEK') {
          const logDate = new Date(log.date);
          const diffDays = (new Date() - logDate) / (1000 * 60 * 60 * 24);
          if (diffDays > 7 || diffDays < 0) return;
        }
        if (filterDateRange === 'MONTH') {
          const curMonth = todayStr.slice(0, 7);
          if (!String(log.date).startsWith(curMonth)) return;
        }

        // Search Query
        if (tableSearch.trim()) {
          const q = tableSearch.toLowerCase().trim();
          const matchName = String(st.firstName || st.name || '').toLowerCase().includes(q);
          const matchAd = String(st.adNo || '').toLowerCase().includes(q);
          const matchReg = String(st.regNo || '').toLowerCase().includes(q);
          const matchReason = String(log.reason || '').toLowerCase().includes(q);
          const matchBy = String(log.issuedBy || '').toLowerCase().includes(q);
          if (!matchName && !matchAd && !matchReg && !matchReason && !matchBy) return;
        }

        list.push({
          log,
          student: st,
          isMine
        });
      });
    });

    // Sort newest date first
    return list.sort((a, b) => (b.log.date || '').localeCompare(a.log.date || '') || (b.log.createdAt || '').localeCompare(a.log.createdAt || ''));
  }, [localStudents, userRole, filterTeacher, filterClass, filterDateRange, tableSearch]);

  // Summary Metrics
  const summaryMetrics = useMemo(() => {
    let totalDeductedPeriods = 0;
    const affectedStudentsSet = new Set();

    allFlattenedMinusRecords.forEach(item => {
      totalDeductedPeriods += Number(item.log.count) || 0;
      affectedStudentsSet.add(item.student.regNo);
    });

    return {
      totalPeriods: totalDeductedPeriods,
      affectedStudents: affectedStudentsSet.size,
      totalRecords: allFlattenedMinusRecords.length
    };
  }, [allFlattenedMinusRecords]);

  // Bulk Excel Upload Handler (For Admin)
  const handleBulkExcelUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setStatusMsg({ text: 'Reading and validating Excel file...', type: 'info' });

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName]);

      if (rows.length === 0) throw new Error('Excel sheet is empty.');

      const successes = [];
      const failures = [];
      const batch = writeBatch(db);
      const updatedMap = {};
      const todayStr = new Date().toISOString().split('T')[0];

      rows.forEach((row, idx) => {
        const rawAd = String(row['Admission No'] || row['AdNo'] || row['Ad.No'] || row['AD NO'] || '').trim().replace('#', '');
        if (!rawAd) {
          failures.push({ row: idx + 2, reason: 'Missing Admission Number' });
          return;
        }

        const st = localStudents.find(s => String(s.adNo || '').toUpperCase().replace('#', '') === rawAd.toUpperCase());
        if (!st) {
          failures.push({ row: idx + 2, adNo: rawAd, reason: 'Student not found in database' });
          return;
        }

        const countVal = Math.abs(Number(row['Minus'] || row['Count'] || row['Periods'] || 3));
        const reasonVal = String(row['Reason'] || 'Disciplinary Minus').trim();
        const dateVal = String(row['Date'] || todayStr).trim();
        const teacherVal = String(row['Teacher'] || loggedInUser?.fullName || 'Central Admin').trim();

        const baseSt = updatedMap[st.regNo] || st;
        const curStat = JSON.parse(JSON.stringify(getStudentAttStat(baseSt)));

        const newLog = {
          id: `excel_minus_${Date.now()}_${idx}`,
          date: dateVal,
          count: countVal,
          reason: reasonVal,
          issuedBy: teacherVal,
          issuedByUsername: 'admin',
          createdAt: new Date().toISOString()
        };

        const updatedLogs = [newLog, ...(curStat.minusLogs || [])];
        curStat.minusLogs = updatedLogs;
        curStat.minusCount = updatedLogs.reduce((sum, item) => sum + (Number(item.count) || 0), 0);

        const docId = String(st.id || st.regNo || '').trim();
        batch.set(doc(db, 'students', docId), { periodAttendance: curStat }, { merge: true });
        updatedMap[st.regNo] = { ...st, periodAttendance: curStat };

        successes.push({ adNo: rawAd, name: st.firstName, count: countVal, reason: reasonVal });
      });

      if (successes.length > 0) {
        await batch.commit();
        if (onStudentsUpdated) {
          onStudentsUpdated(localStudents.map(s => updatedMap[s.regNo] || s));
        }
      }

      setExcelReport({
        total: rows.length,
        successCount: successes.length,
        failureCount: failures.length,
        failures
      });

      setStatusMsg({
        text: `✅ Excel Processed: Applied ${successes.length} minus deduction(s). Failures: ${failures.length}`,
        type: successes.length > 0 ? 'success' : 'error'
      });
    } catch (err) {
      alert('Error processing Excel: ' + err.message);
    } finally {
      setLoading(false);
      e.target.value = null;
    }
  };

  // Download Sample Template
  const handleDownloadSampleExcel = () => {
    const sampleData = [
      { 'Admission No': '3551', 'Minus': 2, 'Reason': 'Jamath Missing', 'Date': new Date().toISOString().split('T')[0], 'Teacher': 'Assigned Usthad' },
      { 'Admission No': 'U1107', 'Minus': 1, 'Reason': 'Late Entry to Campus', 'Date': new Date().toISOString().split('T')[0], 'Teacher': 'Assigned Usthad' }
    ];
    const ws = XLSX.utils.json_to_sheet(sampleData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Minus_Attendance');
    XLSX.writeFile(wb, 'Sample_Minus_Attendance_Template.xlsx');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 🌟 HEADER & SUMMARY CARDS BAR */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px', background: '#ffffff', padding: '18px 22px', borderRadius: '14px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: '#0f172a' }}>
              ⚖️ Disciplinary Minus Attendance Desk
            </h2>
            <span style={{
              background: userRole === 'admin' ? '#f1f5f9' : '#eef2ff',
              color: userRole === 'admin' ? '#334155' : '#4f46e5',
              border: userRole === 'admin' ? '1px solid #cbd5e1' : '1px solid #c7d2fe',
              padding: '3px 10px',
              borderRadius: '999px',
              fontSize: '11px',
              fontWeight: '800'
            }}>
              {userRole === 'admin' ? '🛡️ Admin Full Access' : `👨‍🏫 Issued by You (@${loggedInUser?.username || activeTeacherObj?.username || 'faculty'})`}
            </span>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
            Deductions strictly apply to student total campus attendance percentage. Individual subject registers are never reduced.
          </p>
        </div>

        {/* Sub-tab navigation pills */}
        <div style={{ display: 'flex', gap: '8px' }}>
          {[
            { id: 'add', label: '➕ Deduct Minus' },
            { id: 'history', label: `📋 Minus History (${summaryMetrics.totalRecords})` },
            ...(userRole === 'admin' ? [{ id: 'excel', label: '📊 Bulk Excel' }] : [])
          ].map(t => {
            const isAct = activeSubTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveSubTab(t.id)}
                style={{
                  padding: '9px 16px',
                  borderRadius: '10px',
                  fontWeight: '700',
                  fontSize: '13px',
                  cursor: 'pointer',
                  border: isAct ? '1px solid #4f46e5' : '1px solid #cbd5e1',
                  background: isAct ? '#4f46e5' : '#ffffff',
                  color: isAct ? '#ffffff' : '#334155',
                  boxShadow: isAct ? '0 4px 12px rgba(79, 70, 229, 0.25)' : 'none',
                  transition: 'all 0.15s ease'
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* METRICS ROW */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
        <div style={{ background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: '12px', padding: '16px' }}>
          <div style={{ fontSize: '11px', fontWeight: '800', color: '#be123c', textTransform: 'uppercase' }}>
            {userRole === 'admin' ? 'Total Campus Minus Periods' : 'Minus Periods Issued by You'}
          </div>
          <div style={{ fontSize: '28px', fontWeight: '900', color: '#e11d48', marginTop: '4px' }}>
            -{summaryMetrics.totalPeriods}
          </div>
          <div style={{ fontSize: '11px', color: '#9f1239', marginTop: '2px' }}>
            Reduced strictly from total attendance
          </div>
        </div>

        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px' }}>
          <div style={{ fontSize: '11px', fontWeight: '800', color: '#475569', textTransform: 'uppercase' }}>
            {userRole === 'admin' ? 'Affected Students' : 'Students You Penalized'}
          </div>
          <div style={{ fontSize: '28px', fontWeight: '900', color: '#0f172a', marginTop: '4px' }}>
            {summaryMetrics.affectedStudents}
          </div>
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
            Unique student records
          </div>
        </div>

        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px' }}>
          <div style={{ fontSize: '11px', fontWeight: '800', color: '#475569', textTransform: 'uppercase' }}>
            Disciplinary Records
          </div>
          <div style={{ fontSize: '28px', fontWeight: '900', color: '#0f172a', marginTop: '4px' }}>
            {summaryMetrics.totalRecords}
          </div>
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
            Individual logged infractions
          </div>
        </div>
      </div>

      {/* STATUS BANNER */}
      {statusMsg.text && (
        <div style={{
          padding: '12px 18px',
          borderRadius: '10px',
          fontSize: '13px',
          fontWeight: '700',
          background: statusMsg.type === 'success' ? '#ecfdf5' : statusMsg.type === 'error' ? '#fff1f2' : '#eef2ff',
          color: statusMsg.type === 'success' ? '#047857' : statusMsg.type === 'error' ? '#e11d48' : '#4f46e5',
          border: statusMsg.type === 'success' ? '1px solid #a7f3d0' : statusMsg.type === 'error' ? '1px solid #fecdd3' : '1px solid #c7d2fe'
        }}>
          {statusMsg.text}
        </div>
      )}

      {/* ============================================================
          SUB-TAB 1: DEDUCT MINUS ATTENDANCE
         ============================================================ */}
      {activeSubTab === 'add' && (
        <div style={{ ...styles.card, maxWidth: '820px', margin: '0 auto', width: '100%' }}>
          <h3 style={{ margin: '0 0 6px 0', fontSize: '16px', fontWeight: '800', color: '#0f172a' }}>
            ➕ Issue Disciplinary Minus Attendance
          </h3>
          <p style={{ margin: '0 0 18px 0', fontSize: '13px', color: '#64748b' }}>
            Select one or multiple students to deduct attendance periods.
          </p>

          <form onSubmit={handleSaveMinus} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {/* Quick Class Shortcut */}
            <div>
              <label style={styles.label}>1. Quick Filter or Add by Class Batch (Optional)</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {DEFAULT_CLASSES.map(cls => (
                  <button
                    key={cls}
                    type="button"
                    onClick={() => handleAddEntireClass(cls)}
                    style={{
                      padding: '5px 10px',
                      background: '#f8fafc',
                      border: '1px solid #cbd5e1',
                      borderRadius: '6px',
                      fontSize: '11px',
                      fontWeight: '700',
                      cursor: 'pointer'
                    }}
                    title={`Add all students in ${cls}`}
                  >
                    + Class {cls}
                  </button>
                ))}
              </div>
            </div>

            {/* Search Input */}
            <div>
              <label style={styles.label}>2. Search &amp; Add Student(s) (Comma-separated Ad.Nos allowed)</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  value={minusSearchQuery}
                  onChange={e => setMinusSearchQuery(e.target.value)}
                  placeholder="Type Ad.Nos (e.g. 3551, 3392, U1107) or student name..."
                  style={{ ...styles.input, flex: 1 }}
                />
                <button
                  type="button"
                  onClick={handleAddCommaSeparatedStudents}
                  style={{ ...styles.buttonPrimary, whiteSpace: 'nowrap' }}
                >
                  ➕ Add to List
                </button>
              </div>

              {/* Autocomplete Dropdown Pills */}
              {matchingStudents.length > 0 && (
                <div style={{ marginTop: '8px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {matchingStudents.map(st => (
                    <button
                      key={st.regNo}
                      type="button"
                      onClick={() => {
                        if (!selectedStudentsList.some(x => x.regNo === st.regNo)) {
                          setSelectedStudentsList(prev => [...prev, st]);
                          if (!selectedSingleStudent) setSelectedSingleStudent(st);
                        }
                        setMinusSearchQuery('');
                      }}
                      style={{
                        padding: '4px 10px',
                        background: '#ffffff',
                        border: '1px solid #cbd5e1',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontWeight: '700',
                        cursor: 'pointer'
                      }}
                    >
                      + {st.firstName} (#{st.adNo} • {(st.classes || [st.class]).join(',')})
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Selected Students List */}
            {selectedStudentsList.length > 0 && (
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontSize: '12px', fontWeight: '800', color: '#0f172a' }}>
                    Selected Target Students ({selectedStudentsList.length}):
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedStudentsList([])}
                    style={{ background: 'transparent', border: 'none', color: '#e11d48', fontSize: '11px', fontWeight: '700', cursor: 'pointer' }}
                  >
                    Clear All
                  </button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', maxHeight: '160px', overflowY: 'auto' }}>
                  {selectedStudentsList.map(st => (
                    <span
                      key={st.regNo}
                      style={{
                        background: '#ffffff',
                        border: '1px solid #cbd5e1',
                        borderRadius: '999px',
                        padding: '4px 10px',
                        fontSize: '12px',
                        fontWeight: '700',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      {st.firstName} (#{st.adNo})
                      <button
                        type="button"
                        onClick={() => setSelectedStudentsList(prev => prev.filter(x => x.regNo !== st.regNo))}
                        style={{ border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontWeight: '900' }}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Deduction Details */}
            <div style={{ display: 'grid', gridTemplateColumns: userRole === 'admin' ? 'repeat(auto-fit, minmax(180px, 1fr))' : 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
              <div>
                <label style={styles.label}>3. Periods to Deduct *</label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={minusCount}
                  onChange={e => setMinusCount(e.target.value)}
                  required
                  style={styles.input}
                />
              </div>

              <div>
                <label style={styles.label}>4. Deduction Date</label>
                <input
                  type="date"
                  value={minusDate}
                  onChange={e => setMinusDate(e.target.value)}
                  required
                  style={styles.input}
                />
              </div>

              {userRole === 'admin' && (
                <div>
                  <label style={styles.label}>5. Imposed on Behalf of</label>
                  <select
                    value={adminOnBehalfOfUsername}
                    onChange={e => setAdminOnBehalfOfUsername(e.target.value)}
                    style={styles.input}
                  >
                    <option value="admin">🏛️ Central Admin</option>
                    {localTeachers
                      .filter(t => !t.isEventLeader)
                      .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''))
                      .map(t => (
                        <option key={t.username} value={t.username}>
                          👨‍🏫 Usthad {t.fullName} (@{t.username})
                        </option>
                      ))}
                  </select>
                </div>
              )}
            </div>

            {/* Reason with Quick Chips */}
            <div>
              <label style={styles.label}>{userRole === 'admin' ? '6. Disciplinary Reason *' : '5. Disciplinary Reason *'}</label>
              <input
                type="text"
                value={minusReason}
                onChange={e => setMinusReason(e.target.value)}
                placeholder="e.g. Jamath missing on Sunday Fajr..."
                required
                style={styles.input}
              />
              <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {QUICK_MINUS_REASONS.map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setMinusReason(r)}
                    style={{
                      padding: '4px 8px',
                      background: minusReason === r ? '#eef2ff' : '#f8fafc',
                      color: minusReason === r ? '#4f46e5' : '#475569',
                      border: minusReason === r ? '1px solid #c7d2fe' : '1px solid #cbd5e1',
                      borderRadius: '6px',
                      fontSize: '11px',
                      fontWeight: '600',
                      cursor: 'pointer'
                    }}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || selectedStudentsList.length === 0}
              style={{
                ...styles.buttonPrimary,
                padding: '12px 20px',
                fontSize: '14px',
                background: selectedStudentsList.length > 0 ? '#e11d48' : '#94a3b8'
              }}
            >
              {loading ? 'Applying Deductions...' : `⚖️ Deduct -${minusCount} Period(s) from ${selectedStudentsList.length} Student(s)`}
            </button>
          </form>
        </div>
      )}

      {/* ============================================================
          SUB-TAB 2: MINUS HISTORY & FILTERS TABLE
         ============================================================ */}
      {activeSubTab === 'history' && (
        <div style={{ ...styles.card, padding: '18px 22px' }}>
          {/* FILTER CONTROLS BAR */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', flex: 1 }}>
              <input
                type="text"
                value={tableSearch}
                onChange={e => setTableSearch(e.target.value)}
                placeholder="Search student, Ad.No, reason or Usthad..."
                style={{ ...styles.input, maxWidth: '280px' }}
              />

              <select
                value={filterClass}
                onChange={e => setFilterClass(e.target.value)}
                style={{ ...styles.input, width: 'auto' }}
              >
                <option value="ALL">All Classes</option>
                {DEFAULT_CLASSES.map(c => <option key={c} value={c}>Class {c}</option>)}
              </select>

              {userRole === 'admin' && (
                <select
                  value={filterTeacher}
                  onChange={e => setFilterTeacher(e.target.value)}
                  style={{ ...styles.input, width: 'auto' }}
                >
                  <option value="ALL">All Faculty Members</option>
                  {localTeachers.map(t => (
                    <option key={t.username} value={t.username}>
                      {t.fullName} (@{t.username})
                    </option>
                  ))}
                </select>
              )}

              <select
                value={filterDateRange}
                onChange={e => setFilterDateRange(e.target.value)}
                style={{ ...styles.input, width: 'auto' }}
              >
                <option value="ALL">All Dates</option>
                <option value="TODAY">Today Only</option>
                <option value="WEEK">Past 7 Days</option>
                <option value="MONTH">This Month</option>
              </select>
            </div>

            <div style={{ fontSize: '13px', fontWeight: '700', color: '#475569' }}>
              Showing {allFlattenedMinusRecords.length} record(s)
            </div>
          </div>

          {/* TABLE OF MINUS RECORDS */}
          {allFlattenedMinusRecords.length === 0 ? (
            <div style={{ padding: '36px', textAlign: 'center', background: '#f8fafc', borderRadius: '12px', color: '#64748b' }}>
              <div style={{ fontSize: '24px', marginBottom: '6px' }}>🍃</div>
              <div style={{ fontWeight: '800', color: '#0f172a' }}>No Disciplinary Minus Records Found</div>
              <div style={{ fontSize: '12px', marginTop: '4px' }}>
                {userRole === 'teacher' ? 'You have not issued any minus attendance deductions matching these filters.' : 'No records match the current search or filter criteria.'}
              </div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: '800' }}>
                    <th style={{ padding: '12px 14px' }}>Student</th>
                    <th style={{ padding: '12px 14px' }}>Class</th>
                    <th style={{ padding: '12px 14px' }}>Deduction</th>
                    <th style={{ padding: '12px 14px' }}>Reason</th>
                    <th style={{ padding: '12px 14px' }}>Date</th>
                    <th style={{ padding: '12px 14px' }}>Issued By</th>
                    <th style={{ padding: '12px 14px', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {allFlattenedMinusRecords.map(({ log, student, isMine }) => {
                    const stClasses = Array.isArray(student.classes) ? student.classes.join(', ') : student.class;
                    return (
                      <tr key={log.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '12px 14px' }}>
                          <div style={{ fontWeight: '800', color: '#0f172a' }}>{student.firstName}</div>
                          <div style={{ fontSize: '11px', color: '#64748b' }}>#{student.adNo} • Reg: {student.regNo}</div>
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <span style={{ background: '#f1f5f9', padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: '800', color: '#334155' }}>
                            {stClasses || 'General'}
                          </span>
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <span style={{ background: '#fff1f2', color: '#e11d48', border: '1px solid #fecdd3', padding: '4px 9px', borderRadius: '999px', fontWeight: '800', fontSize: '12px' }}>
                            -{log.count} Period{log.count === 1 ? '' : 's'}
                          </span>
                        </td>
                        <td style={{ padding: '12px 14px', maxWidth: '240px' }}>
                          <div style={{ color: '#0f172a', fontWeight: '600' }}>{log.reason}</div>
                          {log.editedAt && (
                            <span style={{ fontSize: '10px', color: '#94a3b8' }}>(Edited {log.editedAt})</span>
                          )}
                        </td>
                        <td style={{ padding: '12px 14px', whiteSpace: 'nowrap', color: '#475569' }}>
                          {log.date}
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <div style={{ fontWeight: '700', color: '#334155' }}>{log.issuedBy || 'Faculty'}</div>
                          {log.issuedByUsername && (
                            <div style={{ fontSize: '11px', color: '#94a3b8' }}>@{log.issuedByUsername}</div>
                          )}
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {isMine && (
                            <div style={{ display: 'inline-flex', gap: '6px' }}>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingLogItem({ log, student });
                                  setEditMinusCount(log.count);
                                  setEditMinusReason(log.reason);
                                  setEditIssuedByUsername(log.issuedByUsername || 'admin');
                                }}
                                style={{
                                  padding: '4px 10px',
                                  background: '#f8fafc',
                                  border: '1px solid #c7d2fe',
                                  color: '#4f46e5',
                                  borderRadius: '6px',
                                  fontWeight: '700',
                                  fontSize: '11px',
                                  cursor: 'pointer'
                                }}
                              >
                                ✏️ Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteMinus(log, student)}
                                style={{
                                  padding: '4px 10px',
                                  background: '#fff1f2',
                                  border: '1px solid #fecdd3',
                                  color: '#e11d48',
                                  borderRadius: '6px',
                                  fontWeight: '700',
                                  fontSize: '11px',
                                  cursor: 'pointer'
                                }}
                              >
                                🗑️ Delete
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ============================================================
          SUB-TAB 3: BULK EXCEL UPLOAD (ADMIN ONLY)
         ============================================================ */}
      {activeSubTab === 'excel' && userRole === 'admin' && (
        <div style={{ ...styles.card, maxWidth: '780px', margin: '0 auto', width: '100%' }}>
          <h3 style={{ margin: '0 0 6px 0', fontSize: '16px', fontWeight: '800', color: '#0f172a' }}>
            📊 Bulk Import Minus Attendance via Excel
          </h3>
          <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: '#64748b' }}>
            Upload an Excel file (.xlsx) containing columns: <strong>Admission No</strong>, <strong>Minus</strong>, <strong>Reason</strong>, and <strong>Date</strong>.
          </p>

          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '18px' }}>
            <label style={{ ...styles.buttonPrimary, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              📁 Select Excel File (.xlsx)
              <input
                type="file"
                accept=".xlsx, .xls"
                onChange={handleBulkExcelUpload}
                style={{ display: 'none' }}
              />
            </label>

            <button
              type="button"
              onClick={handleDownloadSampleExcel}
              style={styles.buttonSecondary}
            >
              📥 Download Sample Template (.xlsx)
            </button>
          </div>

          {excelReport && (
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px' }}>
              <div style={{ fontWeight: '800', fontSize: '14px', color: '#0f172a', marginBottom: '8px' }}>
                Excel Import Summary:
              </div>
              <div style={{ display: 'flex', gap: '14px', fontSize: '13px', marginBottom: '12px' }}>
                <span style={{ color: '#047857', fontWeight: '700' }}>✅ Successes: {excelReport.successCount}</span>
                <span style={{ color: '#e11d48', fontWeight: '700' }}>❌ Failures: {excelReport.failureCount}</span>
                <span style={{ color: '#64748b' }}>Total Rows: {excelReport.total}</span>
              </div>

              {excelReport.failures.length > 0 && (
                <div style={{ maxHeight: '160px', overflowY: 'auto', background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: '8px', padding: '10px' }}>
                  <div style={{ fontSize: '11px', fontWeight: '800', color: '#be123c', marginBottom: '6px' }}>
                    Failed Rows Details:
                  </div>
                  {excelReport.failures.map((f, i) => (
                    <div key={i} style={{ fontSize: '12px', color: '#9f1239', marginBottom: '4px' }}>
                      Row {f.row}: {f.adNo ? `[#${f.adNo}]` : ''} {f.reason}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ============================================================
          EDIT MINUS MODAL
         ============================================================ */}
      {editingLogItem && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2500, padding: '16px' }}>
          <div style={{ background: '#ffffff', borderRadius: '16px', maxWidth: '480px', width: '100%', padding: '24px', border: '1px solid #e2e8f0', boxShadow: '0 20px 40px rgba(15,23,42,0.18)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '17px', fontWeight: '800', color: '#0f172a' }}>
                  ✏️ Edit Minus Record
                </h3>
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                  For {editingLogItem.student.firstName} (#{editingLogItem.student.adNo})
                </div>
              </div>
              <button type="button" onClick={() => setEditingLogItem(null)} style={styles.buttonSecondary}>✕</button>
            </div>

            <form onSubmit={handleSaveEditMinus} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={styles.label}>Periods to Deduct *</label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={editMinusCount}
                  onChange={e => setEditMinusCount(e.target.value)}
                  required
                  style={styles.input}
                />
              </div>

              <div>
                <label style={styles.label}>Reason for Minus *</label>
                <input
                  type="text"
                  value={editMinusReason}
                  onChange={e => setEditMinusReason(e.target.value)}
                  required
                  style={styles.input}
                />
              </div>

              {userRole === 'admin' && (
                <div>
                  <label style={styles.label}>Imposed on Behalf of</label>
                  <select
                    value={editIssuedByUsername}
                    onChange={e => setEditIssuedByUsername(e.target.value)}
                    style={styles.input}
                  >
                    <option value="admin">🏛️ Central Admin</option>
                    {localTeachers
                      .filter(t => !t.isEventLeader)
                      .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''))
                      .map(t => (
                        <option key={t.username} value={t.username}>
                          👨‍🏫 Usthad {t.fullName} (@{t.username})
                        </option>
                      ))}
                  </select>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button type="button" onClick={() => setEditingLogItem(null)} style={styles.buttonSecondary}>
                  Cancel
                </button>
                <button type="submit" disabled={loading} style={styles.buttonPrimary}>
                  {loading ? 'Saving...' : '💾 Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
