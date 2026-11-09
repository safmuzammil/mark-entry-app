'use client';
import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { db } from '../../lib/firebase';
import { doc, getDoc, getDocs, setDoc, collection, query, orderBy, limit, writeBatch } from 'firebase/firestore';
import { DEFAULT_CLASSES, styles, DHIU_LOGO_URL } from './erpConstants';
import { ProfileAvatar } from './ErpExtensions';

function getStudentAttStat(st) {
  if (st && st.periodAttendance && typeof st.periodAttendance === 'object') {
    return st.periodAttendance;
  }
  return { totalPeriods: 0, presentCount: 0, officialCount: 0, medicalCount: 0, permittedCount: 0, minusCount: 0, subjectWise: {}, minusLogs: [] };
}

function normalizeSubKey(s) {
  return String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function getDatesBetween(startStr, endStr) {
  if (!startStr) return [];
  if (!endStr || startStr === endStr) return [startStr];
  const dates = [];
  let curr = new Date(`${startStr}T00:00:00`);
  const stop = new Date(`${endStr}T00:00:00`);
  while (curr <= stop) {
    const y = curr.getFullYear();
    const m = String(curr.getMonth() + 1).padStart(2, '0');
    const d = String(curr.getDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${d}`);
    curr.setDate(curr.getDate() + 1);
  }
  return dates;
}

export default function AbsenceClearanceManager({
  userRole = 'admin',
  loggedInUser = null,
  localStudents = [],
  localTeachers = [],
  onStudentsUpdated = null
}) {
  const [clearanceSubTab, setClearanceSubTab] = useState('issue'); // 'issue' | 'inspect' | 'registry'

  // --- ISSUE NEW CLEARANCE STATE ---
  const [clearAdNo, setClearAdNo] = useState('');
  const [fetchedClearStudentsList, setFetchedClearStudentsList] = useState([]);
  const [fetchedAbsentPeriodSessions, setFetchedAbsentPeriodSessions] = useState([]); // [{ sessionDocId, date, session, subject, classAlias, teacherName, absentStudentRegs }]
  const [selectedClearSessionIds, setSelectedClearSessionIds] = useState([]);
  const [fetchedAbsentSubjects, setFetchedAbsentSubjects] = useState([]);
  const [showLegacySubjectFallback, setShowLegacySubjectFallback] = useState(false);
  const [clearSelectedSubjects, setClearSelectedSubjects] = useState([]);
  const [clearReason, setClearReason] = useState('official'); // 'official' | 'medical' | 'permitted'
  const [clearDateMode, setClearDateMode] = useState('single'); // 'single' | 'range'
  const [clearDate, setClearDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [clearStartDate, setClearStartDate] = useState('');
  const [clearEndDate, setClearEndDate] = useState('');
  const [fetchingClearance, setFetchingClearance] = useState(false);
  const [clearanceRemarks, setClearanceRemarks] = useState('');
  const [issuedClearanceCerts, setIssuedClearanceCerts] = useState([]);
  const [loading, setLoading] = useState(false);

  // --- INSPECT & EDIT CLEARANCES STATE ---
  const [inspectAdNo, setInspectAdNo] = useState('');
  const [inspectStudent, setInspectStudent] = useState(null);
  const [inspectDateStart, setInspectDateStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [inspectDateEnd, setInspectDateEnd] = useState(() => new Date().toISOString().split('T')[0]);
  const [inspectFilterStatus, setInspectFilterStatus] = useState('ALL'); // 'ALL' | 'CLEARED' | 'ABSENT'
  const [inspectSessionsList, setInspectSessionsList] = useState([]);
  const [selectedInspectSessionIds, setSelectedInspectSessionIds] = useState([]);
  const [fetchingInspect, setFetchingInspect] = useState(false);
  const [editingCertRemarksId, setEditingCertRemarksId] = useState(null);
  const [editedRemarksText, setEditedRemarksText] = useState('');

  // --- REGISTRY STATE ---
  const [registryCertificates, setRegistryCertificates] = useState([]);
  const [loadingRegistry, setLoadingRegistry] = useState(false);
  const [registrySearch, setRegistrySearch] = useState('');
  const [registryReasonFilter, setRegistryReasonFilter] = useState('ALL');

  // --- PRINTABLE CERTIFICATE MODAL STATE ---
  const [activeCertToPrint, setActiveCertToPrint] = useState(null);

  // Load existing registry certificates
  const loadRegistryCertificates = async () => {
    setLoadingRegistry(true);
    try {
      const snap = await getDocs(query(collection(db, 'clearance_certificates'), orderBy('issuedAt', 'desc'), limit(150)));
      const list = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() }));
      setRegistryCertificates(list);
    } catch (err) {
      console.warn('Failed to load certificates from clearance_certificates collection, falling back to students:', err);
      // Fallback: collect from localStudents
      const allCerts = [];
      localStudents.forEach(st => {
        const stat = getStudentAttStat(st);
        const certs = stat.clearanceCertificates || [];
        certs.forEach(c => allCerts.push(c));
      });
      allCerts.sort((a, b) => String(b.issuedAt || '').localeCompare(String(a.issuedAt || '')));
      setRegistryCertificates(allCerts);
    } finally {
      setLoadingRegistry(false);
    }
  };

  useEffect(() => {
    if (clearanceSubTab === 'registry') {
      loadRegistryCertificates();
    }
  }, [clearanceSubTab]);

  // ==========================================
  // 1. FETCH ABSENT PERIOD SESSIONS FOR CLEARANCE
  // ==========================================
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

          // Check which of the fetched students were marked Absent ('A') in this exact period
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
      alert('Error fetching period sessions: ' + err.message);
    } finally {
      setFetchingClearance(false);
    }
  };

  // ==========================================
  // 2. SAVE & APPLY OFFICIAL ATTENDANCE CLEARANCE
  // ==========================================
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
          } else {
            attMap[regNo] = 'O';
            curStat.presentCount = Math.min(curStat.totalPeriods || 9999, (curStat.presentCount || 0) + 1);
            curStat.permittedCount = (curStat.permittedCount || 0) + 1;
            subObj.present = Math.min(subObj.total || 9999, (subObj.present || 0) + 1);
            subObj.permitted = (subObj.permitted || 0) + 1;
          }
        });

        if (sData) {
          batch.set(sRef, { attendanceMap: attMap, updatedAt: new Date().toISOString() }, { merge: true });
        }
      }

      // 2. Apply Legacy Subject Fallback Clearance (If selected)
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

      // Generate Official Clearance Certificates
      const newCerts = [];
      const nowIso = new Date().toISOString();
      const targetDates = clearDateMode === 'single' ? [clearDate] : getDatesBetween(clearStartDate, clearEndDate);

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
          reason: clearReason,
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
          status: 'ISSUED'
        };

        newCerts.push(certObj);
        batch.set(doc(db, 'clearance_certificates', certDocId), certObj);

        const curStat = studentStatsDraft[student.regNo];
        if (curStat) {
          curStat.clearanceCertificates = [
            certObj,
            ...(Array.isArray(curStat.clearanceCertificates) ? curStat.clearanceCertificates : []).slice(0, 15)
          ];
        }
      });

      await batch.commit();

      if (typeof onStudentsUpdated === 'function') {
        const nextStudents = localStudents.map(s => updatedMap[s.regNo] || s);
        onStudentsUpdated(nextStudents);
      }

      setIssuedClearanceCerts(newCerts);
      if (newCerts.length > 0) {
        setActiveCertToPrint(newCerts[0]);
      }

      alert(`✅ Successfully cleared attendance for ${fetchedClearStudentsList.length} student(s) across ${selectedPeriodObjs.length} period session(s)!`);
      setFetchedClearStudentsList([]);
      setFetchedAbsentPeriodSessions([]);
      setSelectedClearSessionIds([]);
      setClearSelectedSubjects([]);
      setClearanceRemarks('');
    } catch (err) {
      console.error('Error saving clearance:', err);
      alert('Error saving clearance: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // ==========================================
  // 3. INSPECT & EDIT CLEARANCES
  // ==========================================
  const handleLoadInspectStudent = async (targetAdNo) => {
    const qAd = String(targetAdNo || inspectAdNo).trim().toUpperCase();
    if (!qAd) return alert('Please enter student Admission Number.');

    const foundSt = localStudents.find(
      s => String(s.adNo || '').trim().toUpperCase() === qAd ||
           String(s.regNo || '').trim().toUpperCase() === qAd
    );
    if (!foundSt) return alert(`No student found for #${qAd}`);

    setInspectStudent(foundSt);
    setFetchingInspect(true);
    setInspectSessionsList([]);
    setSelectedInspectSessionIds([]);

    try {
      const dates = getDatesBetween(inspectDateStart, inspectDateEnd);
      const list = [];

      for (const dStr of dates) {
        const idxSnap = await getDoc(doc(db, 'systemCache', `daySessionsIndex_${dStr}`));
        if (!idxSnap.exists()) continue;

        const sessList = idxSnap.data().sessions || [];
        for (const item of sessList) {
          const sSnap = await getDoc(doc(db, 'systemCache', item.sessionDocId));
          if (!sSnap.exists()) continue;
          const sData = sSnap.data();
          const attMap = sData.attendanceMap || {};
          const status = attMap[foundSt.regNo] || attMap[foundSt.id] || attMap[foundSt.adNo] || 'P';

          if (inspectFilterStatus === 'CLEARED' && status !== 'O' && status !== 'M') continue;
          if (inspectFilterStatus === 'ABSENT' && status !== 'A') continue;

          list.push({
            sessionDocId: item.sessionDocId,
            date: dStr,
            session: Number(sData.session || item.session || 1),
            subject: normalizeSubKey(sData.subject || item.subject || ''),
            classAlias: sData.classAlias || sData.subject || '',
            teacherName: sData.teacherName || 'Faculty',
            status: status === 'O' ? 'CLEARED (OFFICIAL)' : status === 'M' ? 'CLEARED (MEDICAL)' : status === 'A' ? 'ABSENT' : 'PRESENT'
          });
        }
      }

      list.sort((a, b) => b.date.localeCompare(a.date) || b.session - a.session);
      setInspectSessionsList(list);
    } catch (err) {
      console.error('Error inspecting student sessions:', err);
      alert('Error inspecting sessions: ' + err.message);
    } finally {
      setFetchingInspect(false);
    }
  };

  const handleRevokeSessionClearance = async (sessionItem) => {
    if (!inspectStudent) return;
    if (!window.confirm(`Are you sure you want to REVOKE clearance for Period ${sessionItem.session} on ${sessionItem.date}? This will restore the absence.`)) return;

    setLoading(true);
    try {
      const sRef = doc(db, 'systemCache', sessionItem.sessionDocId);
      const sSnap = await getDoc(sRef);
      if (sSnap.exists()) {
        const attMap = { ...(sSnap.data().attendanceMap || {}) };
        attMap[inspectStudent.regNo] = 'A';
        await setDoc(sRef, { attendanceMap: attMap, updatedAt: new Date().toISOString() }, { merge: true });
      }

      const stDocId = String(inspectStudent.id || inspectStudent.regNo);
      const curStat = JSON.parse(JSON.stringify(getStudentAttStat(inspectStudent)));
      const subKey = normalizeSubKey(sessionItem.subject);

      if (curStat.subjectWise && curStat.subjectWise[subKey]) {
        const subObj = curStat.subjectWise[subKey];
        if (sessionItem.status.includes('OFFICIAL')) {
          curStat.presentCount = Math.max(0, (curStat.presentCount || 0) - 1);
          curStat.officialCount = Math.max(0, (curStat.officialCount || 0) - 1);
          subObj.present = Math.max(0, (subObj.present || 0) - 1);
          subObj.official = Math.max(0, (subObj.official || 0) - 1);
        } else if (sessionItem.status.includes('MEDICAL')) {
          curStat.medicalCount = Math.max(0, (curStat.medicalCount || 0) - 1);
          subObj.medical = Math.max(0, (subObj.medical || 0) - 1);
        }
        if (!Array.isArray(subObj.absentDates)) subObj.absentDates = [];
        if (!subObj.absentDates.includes(sessionItem.date)) subObj.absentDates.push(sessionItem.date);
      }

      await setDoc(doc(db, 'students', stDocId), { periodAttendance: curStat }, { merge: true });

      const updatedSt = { ...inspectStudent, periodAttendance: curStat };
      setInspectStudent(updatedSt);
      if (typeof onStudentsUpdated === 'function') {
        onStudentsUpdated(localStudents.map(s => s.regNo === updatedSt.regNo ? updatedSt : s));
      }

      alert('✅ Clearance revoked and marked Absent.');
      handleLoadInspectStudent(inspectStudent.adNo);
    } catch (err) {
      console.error('Error revoking clearance:', err);
      alert('Error revoking clearance: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveEditedRemarks = async (certId) => {
    if (!editedRemarksText.trim()) return alert('Remarks cannot be empty.');
    try {
      await setDoc(doc(db, 'clearance_certificates', certId), {
        remarks: editedRemarksText.trim(),
        updatedAt: new Date().toISOString()
      }, { merge: true });
      alert('✅ Clearance remarks updated.');
      setEditingCertRemarksId(null);
      loadRegistryCertificates();
    } catch (e) {
      alert('Error updating remarks: ' + e.message);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* PRINTABLE OFFICIAL ABSENCE & SHORTAGE CLEARANCE FORM MODAL */}
      {activeCertToPrint && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2500, padding: '16px' }}>
          <div style={{ background: '#ffffff', padding: '32px', borderRadius: '16px', maxWidth: '720px', width: '100%', color: '#0f172a', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #0f172a', paddingBottom: '14px', marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <img src={DHIU_LOGO_URL} alt="DHIU" style={{ width: '52px', height: '52px', objectFit: 'contain' }} />
                <div>
                  <h3 style={{ margin: 0, fontSize: '20px', fontWeight: '900' }}>DARUL HUDA DEGREE INSTITUTION</h3>
                  <div style={{ fontSize: '13px', fontWeight: '800', color: '#059669' }}>OFFICIAL ATTENDANCE CLEARANCE CERTIFICATE</div>
                </div>
              </div>
              <button onClick={() => setActiveCertToPrint(null)} className="no-print" style={{ background: '#fee2e2', color: '#dc2626', border: 'none', padding: '8px 12px', borderRadius: '8px', fontWeight: '800', cursor: 'pointer' }}>✕ Close</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '13px', marginBottom: '20px', background: '#f8fafc', padding: '16px', borderRadius: '10px', border: '1px solid #cbd5e1' }}>
              <div><strong>Certificate No:</strong> <code>{activeCertToPrint.certNumber || activeCertToPrint.id}</code></div>
              <div><strong>Issue Date:</strong> {String(activeCertToPrint.issuedAt || '').split('T')[0] || 'Today'}</div>
              <div><strong>Student Name:</strong> {activeCertToPrint.studentName}</div>
              <div><strong>Admission No:</strong> #{activeCertToPrint.adNo} (Reg: {activeCertToPrint.regNo})</div>
              <div><strong>Class:</strong> {(activeCertToPrint.classes || []).join(', ')}</div>
              <div><strong>Reason Category:</strong> <span style={{ textTransform: 'uppercase', fontWeight: '800', color: '#059669' }}>{activeCertToPrint.reason}</span></div>
            </div>

            <div style={{ border: '1px solid #cbd5e1', borderRadius: '10px', padding: '16px', marginBottom: '20px', fontSize: '13px', background: '#ffffff' }}>
              <strong style={{ color: '#0f172a' }}>Official Justification &amp; Authority Remarks:</strong>
              <p style={{ margin: '6px 0 0', color: '#334155', fontStyle: 'italic', lineHeight: 1.6 }}>
                &ldquo;{activeCertToPrint.remarks}&rdquo;
              </p>
              {Array.isArray(activeCertToPrint.clearedSessions) && activeCertToPrint.clearedSessions.length > 0 && (
                <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px dashed #e2e8f0' }}>
                  <strong>Cleared Period Sessions ({activeCertToPrint.clearedSessions.length}):</strong>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                    {activeCertToPrint.clearedSessions.map((s, idx) => (
                      <span key={idx} style={{ background: '#ecfdf5', color: '#065f46', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '700' }}>
                        {s.date} • Period {s.session} ({s.subject})
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginTop: '36px', textAlign: 'center', fontSize: '12px', fontWeight: '800' }}>
              <div style={{ borderTop: '1.5px solid #0f172a', paddingTop: '8px' }}>Authorized Staff Signature</div>
              <div style={{ borderTop: '1.5px solid #0f172a', paddingTop: '8px' }}>Class Teacher Signature</div>
              <div style={{ borderTop: '1.5px solid #0f172a', paddingTop: '8px' }}>Principal / Academic HoD</div>
            </div>

            <div className="no-print" style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button type="button" onClick={() => window.print()} style={styles.buttonPrimary}>
                🖨️ Print Clearance Certificate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOP NAVIGATION HEADER & SUB-TABS */}
      <div style={{ background: '#ffffff', padding: '18px 24px', borderRadius: '14px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '24px' }}>🎟️</span>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: '#0f172a' }}>
              Official Absence Clearance Desk
            </h2>
            <span style={{ background: '#fef3c7', color: '#b45309', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: '800' }}>
              Admin Exclusive
            </span>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
            Authorize and grant legitimate absence waivers for official college duties, medical hospitalization, and rehearsal performances.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', background: '#f1f5f9', padding: '4px', borderRadius: '10px' }}>
          {[
            { id: 'issue', label: '🎟️ Issue New Clearance' },
            { id: 'inspect', label: '🔍 Inspect & Edit Clearances' },
            { id: 'registry', label: '📜 Certificates Registry' }
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setClearanceSubTab(tab.id)}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                fontWeight: '800',
                fontSize: '13px',
                cursor: 'pointer',
                border: 'none',
                background: clearanceSubTab === tab.id ? '#4f46e5' : 'transparent',
                color: clearanceSubTab === tab.id ? '#ffffff' : '#64748b',
                boxShadow: clearanceSubTab === tab.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                transition: 'all 0.15s ease'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ============================================================
          VIEW 1: ISSUE NEW CLEARANCE
         ============================================================ */}
      {clearanceSubTab === 'issue' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <form onSubmit={handleSaveClearance} style={styles.card}>
            {/* STEP 1: STUDENT ADMISSION NUMBER INPUT */}
            <div style={{ background: '#f8fafc', padding: '18px', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '18px' }}>
              <label style={{ ...styles.label, fontSize: '14px', fontWeight: '800', color: '#0f172a', marginBottom: '10px' }}>
                Step 1: Enter Admission Number(s) &amp; Date Scope
              </label>
              <div style={{ display: 'flex', gap: '10px', marginBottom: '14px', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  value={clearAdNo}
                  onChange={e => setClearAdNo(e.target.value)}
                  placeholder="Enter comma-separated Ad.Nos (e.g. 3551, 3392, U1107)..."
                  style={{ ...styles.input, flex: '1 1 300px' }}
                />
                <button
                  type="button"
                  onClick={handleFetchStudentForClearance}
                  disabled={fetchingClearance}
                  style={{ ...styles.buttonPrimary, whiteSpace: 'nowrap' }}
                >
                  {fetchingClearance ? '⏳ Fetching Absences...' : '🔍 Find Absences'}
                </button>
              </div>

              <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    type="button"
                    onClick={() => setClearDateMode('single')}
                    style={{
                      padding: '6px 14px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: '700',
                      cursor: 'pointer',
                      border: clearDateMode === 'single' ? '1px solid #4f46e5' : '1px solid #cbd5e1',
                      background: clearDateMode === 'single' ? '#4f46e5' : '#ffffff',
                      color: clearDateMode === 'single' ? '#ffffff' : '#475569'
                    }}
                  >
                    Single Date
                  </button>
                  <button
                    type="button"
                    onClick={() => setClearDateMode('range')}
                    style={{
                      padding: '6px 14px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: '700',
                      cursor: 'pointer',
                      border: clearDateMode === 'range' ? '1px solid #4f46e5' : '1px solid #cbd5e1',
                      background: clearDateMode === 'range' ? '#4f46e5' : '#ffffff',
                      color: clearDateMode === 'range' ? '#ffffff' : '#475569'
                    }}
                  >
                    Date Range
                  </button>
                </div>

                {clearDateMode === 'single' ? (
                  <input
                    type="date"
                    value={clearDate}
                    onChange={e => setClearDate(e.target.value)}
                    style={{ ...styles.input, width: 'auto', padding: '6px 12px' }}
                  />
                ) : (
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input
                      type="date"
                      value={clearStartDate}
                      onChange={e => setClearStartDate(e.target.value)}
                      style={{ ...styles.input, width: 'auto', padding: '6px 10px' }}
                    />
                    <span style={{ fontSize: '12px', color: '#64748b' }}>to</span>
                    <input
                      type="date"
                      value={clearEndDate}
                      onChange={e => setClearEndDate(e.target.value)}
                      style={{ ...styles.input, width: 'auto', padding: '6px 10px' }}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* FETCHED STUDENTS CHIPS */}
            {fetchedClearStudentsList.length > 0 && (
              <div style={{ marginBottom: '18px', padding: '14px', background: '#ecfdf5', borderRadius: '10px', border: '1px solid #a7f3d0' }}>
                <div style={{ fontSize: '13px', fontWeight: '800', color: '#065f46', marginBottom: '8px' }}>
                  Target Students for Clearance ({fetchedClearStudentsList.length}):
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {fetchedClearStudentsList.map(st => (
                    <span key={st.regNo} style={{ background: '#ffffff', border: '1px solid #a7f3d0', padding: '4px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: '700', color: '#047857' }}>
                      {st.firstName} (#{st.adNo} • {(st.classes || []).join(', ')})
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* STEP 2: GRANULAR ABSENT PERIOD CHECKBOX LIST */}
            {fetchedClearStudentsList.length > 0 && (
              <div style={{ marginBottom: '18px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <label style={{ ...styles.label, fontSize: '14px', fontWeight: '800', color: '#0f172a' }}>
                    Step 2: Select Specific Absent Periods to Clear
                  </label>
                  {fetchedAbsentPeriodSessions.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        if (selectedClearSessionIds.length === fetchedAbsentPeriodSessions.length) {
                          setSelectedClearSessionIds([]);
                        } else {
                          setSelectedClearSessionIds(fetchedAbsentPeriodSessions.map(x => x.sessionDocId));
                        }
                      }}
                      style={{ fontSize: '12px', color: '#4f46e5', background: 'transparent', border: 'none', cursor: 'pointer', fontWeight: '700' }}
                    >
                      {selectedClearSessionIds.length === fetchedAbsentPeriodSessions.length ? 'Deselect All' : 'Select All Absent Periods'}
                    </button>
                  )}
                </div>

                {fetchingClearance ? (
                  <div style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>Scanning attendance sessions for absences...</div>
                ) : fetchedAbsentPeriodSessions.length === 0 ? (
                  <div style={{ padding: '20px', background: '#f8fafc', borderRadius: '10px', border: '1px dashed #cbd5e1', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                    🎉 No period absences found for the selected students on these dates!
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '280px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '10px', background: '#ffffff' }}>
                    {fetchedAbsentPeriodSessions.map(p => {
                      const isChecked = selectedClearSessionIds.includes(p.sessionDocId);
                      return (
                        <div
                          key={p.sessionDocId}
                          onClick={() => {
                            setSelectedClearSessionIds(prev =>
                              prev.includes(p.sessionDocId)
                                ? prev.filter(x => x !== p.sessionDocId)
                                : [...prev, p.sessionDocId]
                            );
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '10px 14px',
                            borderRadius: '8px',
                            background: isChecked ? '#eef2ff' : '#f8fafc',
                            border: isChecked ? '1px solid #6366f1' : '1px solid #e2e8f0',
                            cursor: 'pointer'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {}}
                              style={{ cursor: 'pointer' }}
                            />
                            <div>
                              <div style={{ fontWeight: '800', fontSize: '13px', color: '#0f172a' }}>
                                📅 {p.date} • Period {p.session}: <span style={{ color: '#4f46e5' }}>{p.subject}</span>
                              </div>
                              <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                                👨‍🏫 Faculty: {p.teacherName} • Absent: <strong>{p.absentStudentNames}</strong>
                              </div>
                            </div>
                          </div>
                          <span style={{ background: '#fee2e2', color: '#dc2626', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: '800' }}>
                            ABSENT
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* STEP 3: CLEARANCE REASON & JUSTIFICATION */}
            {fetchedClearStudentsList.length > 0 && (
              <div style={{ background: '#f8fafc', padding: '18px', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '18px' }}>
                <label style={{ ...styles.label, fontSize: '14px', fontWeight: '800', color: '#0f172a', marginBottom: '10px' }}>
                  Step 3: Clearance Reason &amp; Official Remarks
                </label>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginBottom: '14px' }}>
                  {[
                    { id: 'official', label: '🏛️ Official College Duty / Outreach', desc: 'Approved representation or field task', countAsPresent: true },
                    { id: 'medical', label: '🏥 Medical / Hospitalization Leave', desc: 'Medical case under doctor advice', countAsPresent: false },
                    { id: 'permitted', label: '🎭 Rehearsal / Special Waiver', desc: 'Special institution approved activity', countAsPresent: true }
                  ].map(r => (
                    <div
                      key={r.id}
                      onClick={() => setClearReason(r.id)}
                      style={{
                        padding: '12px 14px',
                        borderRadius: '10px',
                        border: clearReason === r.id ? '2px solid #4f46e5' : '1px solid #cbd5e1',
                        background: clearReason === r.id ? '#eef2ff' : '#ffffff',
                        cursor: 'pointer'
                      }}
                    >
                      <div style={{ fontWeight: '800', fontSize: '13px', color: clearReason === r.id ? '#4f46e5' : '#0f172a' }}>{r.label}</div>
                      <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>{r.desc}</div>
                    </div>
                  ))}
                </div>

                <div>
                  <label style={styles.label}>Official Remarks / Justification (Will appear on Certificate)</label>
                  <input
                    type="text"
                    value={clearanceRemarks}
                    onChange={e => setClearanceRemarks(e.target.value)}
                    placeholder="e.g. Participated in University Outreach Program with prior principal approval..."
                    style={styles.input}
                  />
                </div>
              </div>
            )}

            {fetchedClearStudentsList.length > 0 && (
              <button
                type="submit"
                disabled={loading || selectedClearSessionIds.length === 0}
                style={{
                  ...styles.buttonPrimary,
                  padding: '14px 20px',
                  fontSize: '15px',
                  fontWeight: '800',
                  opacity: selectedClearSessionIds.length === 0 ? 0.6 : 1
                }}
              >
                {loading ? '⏳ Applying Official Clearance...' : `🎟️ Clear ${selectedClearSessionIds.length} Absent Period(s) for ${fetchedClearStudentsList.length} Student(s)`}
              </button>
            )}
          </form>
        </div>
      )}

      {/* ============================================================
          VIEW 2: INSPECT & EDIT CLEARANCES
         ============================================================ */}
      {clearanceSubTab === 'inspect' && (
        <div style={styles.card}>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'end', marginBottom: '20px', background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
            <div>
              <label style={styles.label}>Student Admission Number</label>
              <input
                type="text"
                value={inspectAdNo}
                onChange={e => setInspectAdNo(e.target.value)}
                placeholder="e.g. 3551 or U1107"
                style={{ ...styles.input, width: '160px' }}
              />
            </div>
            <div>
              <label style={styles.label}>Date From</label>
              <input
                type="date"
                value={inspectDateStart}
                onChange={e => setInspectDateStart(e.target.value)}
                style={{ ...styles.input, width: 'auto' }}
              />
            </div>
            <div>
              <label style={styles.label}>Date To</label>
              <input
                type="date"
                value={inspectDateEnd}
                onChange={e => setInspectDateEnd(e.target.value)}
                style={{ ...styles.input, width: 'auto' }}
              />
            </div>
            <div>
              <label style={styles.label}>Status Filter</label>
              <select
                value={inspectFilterStatus}
                onChange={e => setInspectFilterStatus(e.target.value)}
                style={{ ...styles.input, width: 'auto' }}
              >
                <option value="ALL">All Recorded Sessions</option>
                <option value="CLEARED">Cleared Only (Official / Medical)</option>
                <option value="ABSENT">Absent Only</option>
              </select>
            </div>
            <button
              type="button"
              onClick={() => handleLoadInspectStudent(inspectAdNo)}
              disabled={fetchingInspect}
              style={styles.buttonPrimary}
            >
              {fetchingInspect ? '⏳ Searching...' : '🔍 Inspect Sessions'}
            </button>
          </div>

          {inspectStudent && (
            <div style={{ marginBottom: '16px', padding: '14px', background: '#f1f5f9', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <strong style={{ fontSize: '15px', color: '#0f172a' }}>{inspectStudent.firstName}</strong> (#{inspectStudent.adNo}) • Class: <strong>{(inspectStudent.classes || []).join(', ')}</strong>
              </div>
              <div style={{ fontSize: '13px', color: '#475569' }}>
                Found <strong>{inspectSessionsList.length}</strong> period session(s)
              </div>
            </div>
          )}

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '11px', fontWeight: '800', textTransform: 'uppercase' }}>
                  <th style={{ padding: '12px 14px' }}>#</th>
                  <th style={{ padding: '12px 14px' }}>DATE</th>
                  <th style={{ padding: '12px 14px' }}>PERIOD</th>
                  <th style={{ padding: '12px 14px' }}>SUBJECT</th>
                  <th style={{ padding: '12px 14px' }}>FACULTY</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center' }}>STATUS</th>
                  <th style={{ padding: '12px 14px', textAlign: 'right' }}>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {inspectSessionsList.length === 0 ? (
                  <tr>
                    <td colSpan="7" style={{ padding: '28px', textAlign: 'center', color: '#64748b', fontWeight: '600' }}>
                      {fetchingInspect ? 'Loading sessions...' : 'No sessions match your search criteria.'}
                    </td>
                  </tr>
                ) : (
                  inspectSessionsList.map((item, idx) => (
                    <tr key={item.sessionDocId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '12px 14px', color: '#64748b' }}>{idx + 1}</td>
                      <td style={{ padding: '12px 14px', fontWeight: '700' }}>{item.date}</td>
                      <td style={{ padding: '12px 14px' }}>Period {item.session}</td>
                      <td style={{ padding: '12px 14px', fontWeight: '700', color: '#4f46e5' }}>{item.subject}</td>
                      <td style={{ padding: '12px 14px', color: '#475569' }}>{item.teacherName}</td>
                      <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                        <span style={{
                          padding: '3px 10px',
                          borderRadius: '999px',
                          fontSize: '11px',
                          fontWeight: '800',
                          background: item.status.includes('CLEARED') ? '#ecfdf5' : item.status === 'ABSENT' ? '#ffe4e6' : '#f8fafc',
                          color: item.status.includes('CLEARED') ? '#047857' : item.status === 'ABSENT' ? '#e11d48' : '#64748b'
                        }}>
                          {item.status}
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                        {item.status.includes('CLEARED') && (
                          <button
                            type="button"
                            onClick={() => handleRevokeSessionClearance(item)}
                            disabled={loading}
                            style={{ padding: '4px 10px', background: '#fff1f2', color: '#e11d48', border: '1px solid #fecdd3', borderRadius: '6px', fontSize: '11px', fontWeight: '700', cursor: 'pointer' }}
                          >
                            Revoke Clearance
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ============================================================
          VIEW 3: CERTIFICATES REGISTRY
         ============================================================ */}
      {clearanceSubTab === 'registry' && (
        <div style={styles.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                type="text"
                value={registrySearch}
                onChange={e => setRegistrySearch(e.target.value)}
                placeholder="🔍 Search student, Ad.No or certificate..."
                style={{ ...styles.input, width: '260px' }}
              />
              <select
                value={registryReasonFilter}
                onChange={e => setRegistryReasonFilter(e.target.value)}
                style={{ ...styles.input, width: 'auto' }}
              >
                <option value="ALL">All Reason Types</option>
                <option value="official">Official Duty Only</option>
                <option value="medical">Medical Only</option>
                <option value="permitted">Rehearsal / Special Only</option>
              </select>
            </div>
            <button
              type="button"
              onClick={loadRegistryCertificates}
              disabled={loadingRegistry}
              style={styles.buttonSecondary}
            >
              🔄 Refresh List
            </button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '11px', fontWeight: '800', textTransform: 'uppercase' }}>
                  <th style={{ padding: '12px 14px' }}>#</th>
                  <th style={{ padding: '12px 14px' }}>CERT NUMBER</th>
                  <th style={{ padding: '12px 14px' }}>STUDENT NAME</th>
                  <th style={{ padding: '12px 14px' }}>AD.NO</th>
                  <th style={{ padding: '12px 14px' }}>REASON</th>
                  <th style={{ padding: '12px 14px' }}>PERIODS</th>
                  <th style={{ padding: '12px 14px' }}>ISSUED AT</th>
                  <th style={{ padding: '12px 14px', textAlign: 'right' }}>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {registryCertificates
                  .filter(c => {
                    if (registryReasonFilter !== 'ALL' && c.reason !== registryReasonFilter) return false;
                    if (registrySearch.trim()) {
                      const q = registrySearch.trim().toLowerCase();
                      const matchName = String(c.studentName || '').toLowerCase().includes(q);
                      const matchAd = String(c.adNo || '').toLowerCase().includes(q);
                      const matchCert = String(c.certNumber || c.id || '').toLowerCase().includes(q);
                      if (!matchName && !matchAd && !matchCert) return false;
                    }
                    return true;
                  })
                  .map((c, idx) => (
                    <tr key={c.id || idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '12px 14px', color: '#64748b' }}>{idx + 1}</td>
                      <td style={{ padding: '12px 14px', fontWeight: '700', color: '#0f172a' }}>
                        <code>{c.certNumber || c.id}</code>
                      </td>
                      <td style={{ padding: '12px 14px', fontWeight: '700' }}>{c.studentName}</td>
                      <td style={{ padding: '12px 14px', color: '#475569' }}>#{c.adNo}</td>
                      <td style={{ padding: '12px 14px' }}>
                        <span style={{
                          padding: '2px 8px',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontWeight: '800',
                          textTransform: 'uppercase',
                          background: c.reason === 'official' ? '#ecfdf5' : c.reason === 'medical' ? '#fef3c7' : '#eef2ff',
                          color: c.reason === 'official' ? '#047857' : c.reason === 'medical' ? '#b45309' : '#4338ca'
                        }}>
                          {c.reason}
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px', color: '#64748b' }}>
                        {Array.isArray(c.clearedSessions) ? `${c.clearedSessions.length} periods` : 'Legacy'}
                      </td>
                      <td style={{ padding: '12px 14px', color: '#64748b', fontSize: '12px' }}>
                        {String(c.issuedAt || '').split('T')[0]}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                        <button
                          type="button"
                          onClick={() => setActiveCertToPrint(c)}
                          style={{ padding: '5px 12px', background: '#f8fafc', color: '#334155', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '11px', fontWeight: '800', cursor: 'pointer' }}
                        >
                          🖨️ View &amp; Print
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
