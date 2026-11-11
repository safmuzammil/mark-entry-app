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
  const [clearanceSubTab, setClearanceSubTab] = useState('issue'); // 'issue' | 'history' | 'inspect'

  // --- 1. ISSUE NEW CLEARANCE STATE ---
  const [clearAdNo, setClearAdNo] = useState('');
  const [fetchedClearStudentsList, setFetchedClearStudentsList] = useState([]);
  const [fetchedAbsentPeriodSessions, setFetchedAbsentPeriodSessions] = useState([]);
  const [selectedClearSessionIds, setSelectedClearSessionIds] = useState([]);
  const [fetchedAbsentSubjects, setFetchedAbsentSubjects] = useState([]);
  const [showLegacySubjectFallback, setShowLegacySubjectFallback] = useState(false);
  const [clearSelectedSubjects, setClearSelectedSubjects] = useState([]);
  const [clearReason, setClearReason] = useState('medical'); // 'medical' | 'official' | 'permitted'
  const [clearDateMode, setClearDateMode] = useState('single'); // 'single' | 'range'
  const [clearDate, setClearDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [clearStartDate, setClearStartDate] = useState('');
  const [clearEndDate, setClearEndDate] = useState('');
  const [fetchingClearance, setFetchingClearance] = useState(false);
  const [clearanceRemarks, setClearanceRemarks] = useState('');
  const [loading, setLoading] = useState(false);

  // --- 2. CLEARANCE HISTORY & ADMIN VERIFICATION STATE ---
  const [clearanceHistoryList, setClearanceHistoryList] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [historyTypeFilter, setHistoryTypeFilter] = useState('ALL'); // 'ALL' | 'MEDICAL_LEAVE' | 'OFFICIAL_PRESENT'
  const [historyVerifyFilter, setHistoryVerifyFilter] = useState('ALL'); // 'ALL' | 'PENDING' | 'VERIFIED'
  const [historyDateFrom, setHistoryDateFrom] = useState('');
  const [historyDateTo, setHistoryDateTo] = useState('');
  const [inspectingHistoryItem, setInspectingHistoryItem] = useState(null);
  const [verifyingHistoryItem, setVerifyingHistoryItem] = useState(null);
  const [verifyNotesInput, setVerifyNotesInput] = useState('');

  // --- 3. INSPECT & EDIT STUDENT SESSIONS STATE ---
  const [inspectAdNo, setInspectAdNo] = useState('');
  const [inspectStudent, setInspectStudent] = useState(null);
  const [inspectDateStart, setInspectDateStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [inspectDateEnd, setInspectDateEnd] = useState(() => new Date().toISOString().split('T')[0]);
  const [inspectFilterStatus, setInspectFilterStatus] = useState('ALL'); // 'ALL' | 'MEDICAL' | 'OFFICIAL' | 'ABSENT' | 'CLEARED'
  const [inspectSessionsList, setInspectSessionsList] = useState([]);
  const [fetchingInspect, setFetchingInspect] = useState(false);

  // --- 4. PRINTABLE CERTIFICATE MODAL STATE ---
  const [activeCertToPrint, setActiveCertToPrint] = useState(null);

  // Load existing clearance history
  const loadClearanceHistory = async () => {
    setLoadingHistory(true);
    try {
      const list = [];
      const seenIds = new Set();

      // 1. Check clearance_history collection
      try {
        const histSnap = await getDocs(query(collection(db, 'clearance_history'), orderBy('issuedAt', 'desc'), limit(200)));
        histSnap.forEach(d => {
          if (!seenIds.has(d.id)) {
            seenIds.add(d.id);
            list.push({ id: d.id, ...d.data() });
          }
        });
      } catch (err) {
        console.warn('clearance_history collection read notice:', err);
      }

      // 2. Check clearance_certificates collection for backward compatibility
      try {
        const certSnap = await getDocs(query(collection(db, 'clearance_certificates'), orderBy('issuedAt', 'desc'), limit(150)));
        certSnap.forEach(d => {
          if (!seenIds.has(d.id)) {
            seenIds.add(d.id);
            const data = d.data();
            const isMed = data.reason === 'medical' || data.clearanceType === 'MEDICAL_LEAVE';
            list.push({
              id: d.id,
              certNumber: data.certNumber || d.id,
              studentRegNo: data.regNo,
              studentAdNo: data.adNo,
              studentName: data.studentName,
              studentClasses: data.classes || [],
              department: data.department || 'GENERAL',
              clearanceType: isMed ? 'MEDICAL_LEAVE' : 'OFFICIAL_PRESENT',
              clearanceTypeLabel: isMed ? '🏥 Medical Leave' : '🏛️ Official Leave (Present)',
              reason: data.reason || (isMed ? 'medical' : 'official'),
              remarks: data.remarks || '',
              dates: data.dates || [],
              totalPeriodsCleared: Array.isArray(data.clearedSessions) ? data.clearedSessions.length : (data.totalPeriodsCleared || 1),
              clearedSessions: data.clearedSessions || [],
              clearedLegacySubjects: data.clearedLegacySubjects || [],
              issuedByUsername: data.clearedBy || 'admin',
              issuedByName: data.clearedBy || 'Central Admin',
              issuedByRole: data.clearedByRole || 'admin',
              issuedAt: data.issuedAt || new Date().toISOString(),
              verificationStatus: data.verificationStatus || 'PENDING',
              verifiedBy: data.verifiedBy || null,
              verifiedByName: data.verifiedByName || null,
              verifiedAt: data.verifiedAt || null,
              verificationNotes: data.verificationNotes || ''
            });
          }
        });
      } catch (certErr) {
        console.warn('clearance_certificates collection read notice:', certErr);
      }

      // 3. Fallback: collect from localStudents periodAttendance
      localStudents.forEach(st => {
        const stat = getStudentAttStat(st);
        const certs = stat.clearanceCertificates || [];
        certs.forEach(c => {
          const cId = c.id || c.certNumber;
          if (cId && !seenIds.has(cId)) {
            seenIds.add(cId);
            const isMed = c.reason === 'medical' || c.clearanceType === 'MEDICAL_LEAVE';
            list.push({
              id: cId,
              certNumber: c.certNumber || cId,
              studentRegNo: st.regNo,
              studentAdNo: st.adNo,
              studentName: st.firstName,
              studentClasses: st.classes || [st.class] || [],
              department: st.department || 'GENERAL',
              clearanceType: isMed ? 'MEDICAL_LEAVE' : 'OFFICIAL_PRESENT',
              clearanceTypeLabel: isMed ? '🏥 Medical Leave' : '🏛️ Official Leave (Present)',
              reason: c.reason || (isMed ? 'medical' : 'official'),
              remarks: c.remarks || '',
              dates: c.dates || [],
              totalPeriodsCleared: Array.isArray(c.clearedSessions) ? c.clearedSessions.length : 1,
              clearedSessions: c.clearedSessions || [],
              clearedLegacySubjects: c.clearedLegacySubjects || [],
              issuedByUsername: c.clearedBy || 'admin',
              issuedByName: c.clearedBy || 'Central Admin',
              issuedByRole: 'admin',
              issuedAt: c.issuedAt || new Date().toISOString(),
              verificationStatus: c.verificationStatus || 'PENDING',
              verifiedBy: c.verifiedBy || null,
              verifiedByName: c.verifiedByName || null,
              verifiedAt: c.verifiedAt || null,
              verificationNotes: c.verificationNotes || ''
            });
          }
        });
      });

      list.sort((a, b) => String(b.issuedAt || '').localeCompare(String(a.issuedAt || '')));
      setClearanceHistoryList(list);
    } catch (err) {
      console.error('Error loading clearance history:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    if (clearanceSubTab === 'history') {
      loadClearanceHistory();
    }
  }, [clearanceSubTab]);

  // Filtered clearance history list
  const filteredClearanceHistory = useMemo(() => {
    return clearanceHistoryList.filter(item => {
      if (historyTypeFilter !== 'ALL' && item.clearanceType !== historyTypeFilter) return false;
      if (historyVerifyFilter !== 'ALL' && item.verificationStatus !== historyVerifyFilter) return false;
      if (historyDateFrom) {
        const itemDate = String(item.issuedAt || '').split('T')[0];
        if (itemDate < historyDateFrom) return false;
      }
      if (historyDateTo) {
        const itemDate = String(item.issuedAt || '').split('T')[0];
        if (itemDate > historyDateTo) return false;
      }
      if (historySearch.trim()) {
        const q = historySearch.trim().toLowerCase();
        const matchName = String(item.studentName || '').toLowerCase().includes(q);
        const matchAd = String(item.studentAdNo || '').toLowerCase().includes(q);
        const matchCert = String(item.certNumber || item.id || '').toLowerCase().includes(q);
        const matchIssuer = String(item.issuedByName || item.issuedByUsername || '').toLowerCase().includes(q);
        if (!matchName && !matchAd && !matchCert && !matchIssuer) return false;
      }
      return true;
    });
  }, [clearanceHistoryList, historyTypeFilter, historyVerifyFilter, historyDateFrom, historyDateTo, historySearch]);

  // Live KPI Summary
  const historyKpis = useMemo(() => {
    const total = clearanceHistoryList.length;
    const medical = clearanceHistoryList.filter(i => i.clearanceType === 'MEDICAL_LEAVE' || i.reason === 'medical').length;
    const official = clearanceHistoryList.filter(i => i.clearanceType === 'OFFICIAL_PRESENT' || i.reason === 'official' || i.reason === 'permitted').length;
    const verified = clearanceHistoryList.filter(i => i.verificationStatus === 'VERIFIED').length;
    const pending = total - verified;
    return { total, medical, official, verified, pending };
  }, [clearanceHistoryList]);

  // ==========================================
  // 1. FETCH ABSENT PERIOD SESSIONS FOR CLEARANCE
  // ==========================================
  const handleFetchStudentForClearance = async () => {
    if (!clearAdNo.trim()) return alert('Please enter one or more Student Admission Numbers (e.g. 3551, U1107).');

    const tokens = clearAdNo.split(/[,;\s\n]+/).map(t => t.replace(/^#/, '').trim().toUpperCase()).filter(Boolean);
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

      // 🌟 STEP A: IN-MEMORY PRE-FILTERING via student absentDates
      const knownAbsentDateSet = new Set();
      let hasAnyRecordedStats = false;

      foundStudents.forEach(st => {
        const stat = getStudentAttStat(st);
        const subWise = stat.subjectWise || {};
        Object.values(subWise).forEach(subObj => {
          if (Array.isArray(subObj.absentDates) && subObj.absentDates.length > 0) {
            hasAnyRecordedStats = true;
            subObj.absentDates.forEach(d => knownAbsentDateSet.add(d));
          }
        });
      });

      // If students have recorded absent dates, intersect with requested date range to prune 80-95% of queries!
      const candidateDates = (hasAnyRecordedStats && knownAbsentDateSet.size > 0)
        ? targetDates.filter(d => knownAbsentDateSet.has(d))
        : targetDates;

      const absentSessionItems = [];

      // 🌟 STEP B & C: CHUNKED PARALLEL INGESTION (Batches of 10 dates)
      const DATE_CHUNK_SIZE = 10;
      for (let i = 0; i < candidateDates.length; i += DATE_CHUNK_SIZE) {
        const dateChunk = candidateDates.slice(i, i + DATE_CHUNK_SIZE);
        const indexSnaps = await Promise.all(
          dateChunk.map(dStr => getDoc(doc(db, 'systemCache', `daySessionsIndex_${dStr}`)))
        );

        const candidateSessionIds = [];
        indexSnaps.forEach((idxSnap, idx) => {
          if (idxSnap.exists()) {
            const sessList = idxSnap.data().sessions || [];
            sessList.forEach(item => {
              if (item.sessionDocId) {
                candidateSessionIds.push({ ...item, date: dateChunk[idx] });
              }
            });
          }
        });

        // 🌟 STEP D: BOUNDED PARALLEL SESSION READS (Max 10 concurrent requests)
        const SESSION_CHUNK_SIZE = 10;
        for (let j = 0; j < candidateSessionIds.length; j += SESSION_CHUNK_SIZE) {
          const sessChunk = candidateSessionIds.slice(j, j + SESSION_CHUNK_SIZE);
          const sessSnaps = await Promise.all(
            sessChunk.map(item => getDoc(doc(db, 'systemCache', item.sessionDocId)))
          );

          sessSnaps.forEach((sSnap, sIdx) => {
            if (!sSnap.exists()) return;
            const item = sessChunk[sIdx];
            const sData = sSnap.data();
            const attMap = sData.attendanceMap || {};

            // Check if ANY of our target students were marked ABSENT in this session
            const absentStInThisPeriod = foundStudents.filter(st => {
              const status = attMap[st.regNo] || attMap[st.id] || attMap[st.adNo];
              return status === 'A';
            });

            if (absentStInThisPeriod.length > 0) {
              absentSessionItems.push({
                sessionDocId: item.sessionDocId,
                date: item.date,
                session: Number(sData.session || item.session || 1),
                subject: normalizeSubKey(sData.subject || item.subject || ''),
                classAlias: sData.classAlias || sData.subject || item.subject || '',
                teacherName: sData.teacherName || 'Faculty',
                absentStudentRegs: absentStInThisPeriod.map(x => x.regNo),
                absentStudentAdNos: absentStInThisPeriod.map(x => x.adNo),
                absentStudentNames: absentStInThisPeriod.map(x => `${x.firstName} (#${x.adNo})`).join(', ')
              });
            }
          });
        }
      }

      absentSessionItems.sort((a, b) => a.date.localeCompare(b.date) || a.session - b.session);
      setFetchedAbsentPeriodSessions(absentSessionItems);
      // Automatically pre-select all found absent periods
      setSelectedClearSessionIds(absentSessionItems.map(x => x.sessionDocId));

      // Also check legacy subjectWise absentDates
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
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (fetchedClearStudentsList.length === 0) return alert('Please fetch students first.');
    if (selectedClearSessionIds.length === 0 && clearSelectedSubjects.length === 0) {
      return alert('Please select at least one absent period (or subject) to clear.');
    }

    setLoading(true);
    try {
      const updatedMap = {};
      const isMedical = clearReason === 'medical';
      const clearanceType = isMedical ? 'MEDICAL_LEAVE' : 'OFFICIAL_PRESENT';
      const clearanceTypeLabel = isMedical ? '🏥 Medical Leave (Excused)' : '🏛️ Official Duty (Present)';

      // Clone student stats for batch update
      const studentStatsDraft = {};
      fetchedClearStudentsList.forEach(st => {
        studentStatsDraft[st.regNo] = JSON.parse(JSON.stringify(getStudentAttStat(st)));
        if (!studentStatsDraft[st.regNo].subjectWise) studentStatsDraft[st.regNo].subjectWise = {};
      });

      // 1. Prepare Session Updates in systemCache
      const selectedPeriodObjs = fetchedAbsentPeriodSessions.filter(p => selectedClearSessionIds.includes(p.sessionDocId));
      const sessionDocUpdates = [];

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
            curStat.subjectWise[subKey] = { total: 1, present: 0, official: 0, medical: 0, permitted: 0, absentDates: [], medicalDates: [] };
          }
          const subObj = curStat.subjectWise[subKey];
          if (!Array.isArray(subObj.absentDates)) subObj.absentDates = [];
          if (!Array.isArray(subObj.medicalDates)) subObj.medicalDates = [];

          // Remove date from unexcused absentDates
          const dateIdx = subObj.absentDates.indexOf(pItem.date);
          if (dateIdx !== -1) subObj.absentDates.splice(dateIdx, 1);

          if (isMedical) {
            // 🌟 MEDICAL LEAVE: 'M' (Excused medical absence)
            attMap[regNo] = 'M';
            curStat.medicalCount = (curStat.medicalCount || 0) + 1;
            subObj.medical = (subObj.medical || 0) + 1;
            if (!subObj.medicalDates.includes(pItem.date)) {
              subObj.medicalDates.push(pItem.date);
            }
          } else {
            // 🌟 OFFICIAL DUTY: 'P' (Normal Present)
            attMap[regNo] = 'P';
            curStat.presentCount = Math.min(curStat.totalPeriods || 9999, (curStat.presentCount || 0) + 1);
            if (clearReason === 'official') {
              curStat.officialCount = (curStat.officialCount || 0) + 1;
              subObj.official = (subObj.official || 0) + 1;
            } else {
              curStat.permittedCount = (curStat.permittedCount || 0) + 1;
              subObj.permitted = (subObj.permitted || 0) + 1;
            }
            subObj.present = Math.min(subObj.total || 9999, (subObj.present || 0) + 1);
          }
        });

        if (sData) {
          sessionDocUpdates.push({ sRef, attMap });
        }
      }

      // 2. Apply Legacy Subject Fallback Clearance (if selected)
      if (clearSelectedSubjects.length > 0) {
        fetchedClearStudentsList.forEach(student => {
          const curStat = studentStatsDraft[student.regNo];
          clearSelectedSubjects.forEach(sub => {
            const subKey = normalizeSubKey(sub);
            if (!curStat.subjectWise[subKey]) {
              curStat.subjectWise[subKey] = { total: 0, present: 0, official: 0, medical: 0, permitted: 0, absentDates: [], medicalDates: [] };
            }
            const subObj = curStat.subjectWise[subKey];
            if (!Array.isArray(subObj.absentDates)) subObj.absentDates = [];
            if (!Array.isArray(subObj.medicalDates)) subObj.medicalDates = [];

            const matchingDates = subObj.absentDates.filter(d =>
              clearDateMode === 'single' ? d === clearDate : (d >= clearStartDate && d <= clearEndDate)
            );
            const countToClear = Math.max(1, matchingDates.length);
            subObj.absentDates = subObj.absentDates.filter(d => !matchingDates.includes(d));

            if (isMedical) {
              curStat.medicalCount = (curStat.medicalCount || 0) + countToClear;
              subObj.medical = (subObj.medical || 0) + countToClear;
              matchingDates.forEach(d => {
                if (!subObj.medicalDates.includes(d)) subObj.medicalDates.push(d);
              });
            } else {
              curStat.presentCount = Math.min(curStat.totalPeriods || 9999, (curStat.presentCount || 0) + countToClear);
              subObj.present = Math.min(subObj.total || 9999, (subObj.present || 0) + countToClear);
              if (clearReason === 'official') {
                curStat.officialCount = (curStat.officialCount || 0) + countToClear;
                subObj.official = (subObj.official || 0) + countToClear;
              } else {
                curStat.permittedCount = (curStat.permittedCount || 0) + countToClear;
                subObj.permitted = (subObj.permitted || 0) + countToClear;
              }
            }
          });
        });
      }

      // 🌟 3. COMPILE HISTORY & MIRROR RECORDS
      const nowIso = new Date().toISOString();
      const targetDates = (clearDateMode === 'single' ? [clearDate] : getDatesBetween(clearStartDate, clearEndDate)).slice(0, 60);
      const newHistoryRecords = [];

      fetchedClearStudentsList.forEach(student => {
        const studentAbsencesForThisUser = selectedPeriodObjs.filter(p => p.absentStudentRegs.includes(student.regNo));
        const totalPeriodsForStudent = studentAbsencesForThisUser.length || clearSelectedSubjects.length || selectedPeriodObjs.length || 1;

        const certNumber = `DHIU/CLR/${new Date().getFullYear()}/${student.adNo || student.regNo}/${Math.floor(1000 + Math.random() * 9000)}`;
        const histDocId = `clearance_hist_${Date.now()}_${student.regNo}`;

        const histObj = {
          id: histDocId,
          certNumber,
          studentRegNo: String(student.regNo || '').trim(),
          studentAdNo: student.adNo,
          studentName: student.firstName,
          studentClasses: student.classes || [student.class] || [],
          department: student.department || 'GENERAL',
          clearanceType,
          clearanceTypeLabel,
          reason: clearReason,
          reasonLabel: isMedical
            ? 'Medical / Hospitalization Leave (Excused)'
            : clearReason === 'official'
            ? 'Official College Duty / Outreach (Normal Present)'
            : 'Special Rehearsal Duty / Waiver (Normal Present)',
          remarks: clearanceRemarks || (isMedical
            ? `Excused Medical Leave granted by ${loggedInUser?.fullName || 'Central Admin'}`
            : `Official duty cleared as Normal Present by ${loggedInUser?.fullName || 'Central Admin'}`),
          dateMode: clearDateMode,
          dates: targetDates,
          totalPeriodsCleared: totalPeriodsForStudent,
          clearedSessions: studentAbsencesForThisUser.map(p => ({
            sessionDocId: p.sessionDocId,
            date: p.date,
            session: p.session,
            subject: p.subject,
            teacherName: p.teacherName,
            originalStatus: 'ABSENT',
            newStatus: isMedical ? 'MEDICAL_LEAVE' : 'PRESENT'
          })),
          clearedLegacySubjects: clearSelectedSubjects,
          issuedByUsername: loggedInUser?.username || 'admin',
          issuedByName: loggedInUser?.fullName || loggedInUser?.username || 'Central Admin',
          issuedByRole: userRole,
          issuedAt: nowIso,
          verificationStatus: 'PENDING',
          verifiedBy: null,
          verifiedByName: null,
          verifiedAt: null,
          verificationNotes: ''
        };

        newHistoryRecords.push(histObj);

        // Store in student object local certs cache
        const curStat = studentStatsDraft[student.regNo];
        if (curStat) {
          curStat.clearanceCertificates = [
            histObj,
            ...(Array.isArray(curStat.clearanceCertificates) ? curStat.clearanceCertificates : []).slice(0, 20)
          ];
        }
      });

      // 🌟 4. COMPILE ALL BATCH WRITE OPERATIONS
      const writeOperations = [];

      // A. Session document updates
      sessionDocUpdates.forEach(({ sRef, attMap }) => {
        writeOperations.push(b => b.set(sRef, { attendanceMap: attMap, updatedAt: new Date().toISOString() }, { merge: true }));
      });

      // B. Student document updates
      fetchedClearStudentsList.forEach(student => {
        const docId = String(student.id || student.regNo || '').trim();
        const finalStat = studentStatsDraft[student.regNo];
        writeOperations.push(b => b.set(doc(db, 'students', docId), { periodAttendance: finalStat }, { merge: true }));
        updatedMap[student.regNo] = { ...student, periodAttendance: finalStat };
      });

      // C. Clearance history & legacy mirror writes
      newHistoryRecords.forEach(histObj => {
        writeOperations.push(b => b.set(doc(db, 'clearance_history', histObj.id), histObj));
        writeOperations.push(b => b.set(doc(db, 'clearance_certificates', histObj.id), {
          ...histObj,
          regNo: histObj.studentRegNo,
          adNo: histObj.studentAdNo,
          status: 'ISSUED', // Required by isValidClearanceCert
          dates: histObj.dates.slice(0, 50)
        }));
      });

      // 🌟 D. EXECUTE SEQUENTIAL BATCH CHUNKING (<= 250 operations per batch)
      const BATCH_CHUNK_SIZE = 250;
      for (let i = 0; i < writeOperations.length; i += BATCH_CHUNK_SIZE) {
        const currentBatch = writeBatch(db);
        const chunk = writeOperations.slice(i, i + BATCH_CHUNK_SIZE);
        chunk.forEach(op => op(currentBatch));
        await currentBatch.commit();
      }

      if (typeof onStudentsUpdated === 'function') {
        const nextStudents = localStudents.map(s => updatedMap[s.regNo] || s);
        onStudentsUpdated(nextStudents);
      }

      setClearanceHistoryList(prev => [...newHistoryRecords, ...prev]);

      if (newHistoryRecords.length > 0) {
        setActiveCertToPrint(newHistoryRecords[0]);
      }

      alert(
        isMedical
          ? `✅ Successfully recorded MEDICAL LEAVE for ${fetchedClearStudentsList.length} student(s) across ${selectedPeriodObjs.length} period session(s)!`
          : `✅ Successfully cleared attendance as NORMAL PRESENT for ${fetchedClearStudentsList.length} student(s) across ${selectedPeriodObjs.length} period session(s)!`
      );
    } catch (err) {
      console.error('Error saving clearance:', err);
      alert('Error saving clearance: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // ==========================================
  // 3. ADMIN VERIFICATION ACTIONS
  // ==========================================
  const handleVerifyClearanceHistory = async (histItem, customNotes = '') => {
    setLoading(true);
    try {
      const nowIso = new Date().toISOString();
      const verifierUsername = loggedInUser?.username || 'admin';
      const verifierName = loggedInUser?.fullName || 'Central Admin';
      const verifiedUpdate = {
        verificationStatus: 'VERIFIED',
        verifiedBy: verifierUsername,
        verifiedByName: verifierName,
        verifiedAt: nowIso,
        verificationNotes: customNotes.trim() || 'Formally verified and approved by Central Admin.'
      };

      await setDoc(doc(db, 'clearance_history', histItem.id), verifiedUpdate, { merge: true });
      await setDoc(doc(db, 'clearance_certificates', histItem.id), verifiedUpdate, { merge: true });

      setClearanceHistoryList(prev =>
        prev.map(item => (item.id === histItem.id ? { ...item, ...verifiedUpdate } : item))
      );

      alert(`✅ Clearance for #${histItem.studentAdNo} (${histItem.studentName}) marked as VERIFIED!`);
      setVerifyingHistoryItem(null);
      setVerifyNotesInput('');
    } catch (err) {
      console.error('Error verifying clearance history item:', err);
      alert('Error verifying clearance: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Export clearance history to Excel
  const handleExportHistoryExcel = () => {
    if (filteredClearanceHistory.length === 0) return alert('No clearance records to export.');

    const rows = filteredClearanceHistory.map((item, idx) => ({
      '#': idx + 1,
      'Certificate Ref': item.certNumber || item.id,
      'Issue Date': String(item.issuedAt || '').split('T')[0],
      'Student Name': item.studentName,
      'Admission No': item.studentAdNo,
      'Reg No': item.studentRegNo,
      'Class': Array.isArray(item.studentClasses) ? item.studentClasses.join(', ') : item.studentClasses,
      'Clearance Type': item.clearanceType === 'MEDICAL_LEAVE' ? 'Medical Leave' : 'Normal Present (Official Leave)',
      'Reason Category': item.reason,
      'Total Periods Cleared': item.totalPeriodsCleared || 0,
      'Target Dates': (item.dates || []).join(', '),
      'Issued By': `${item.issuedByName} (@${item.issuedByUsername})`,
      'Verification Status': item.verificationStatus === 'VERIFIED' ? 'Verified' : 'Pending Verification',
      'Verified By': item.verifiedByName ? `${item.verifiedByName} on ${String(item.verifiedAt || '').split('T')[0]}` : '-',
      'Verification Notes': item.verificationNotes || '-',
      'Remarks': item.remarks || '-'
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Absence Clearances');
    XLSX.writeFile(wb, `DHIU_Absence_Clearance_History_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // ==========================================
  // 4. INSPECT & EDIT STUDENT SESSIONS
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

          if (inspectFilterStatus === 'MEDICAL' && status !== 'M') continue;
          if (inspectFilterStatus === 'OFFICIAL' && status !== 'O' && status !== 'P') continue;
          if (inspectFilterStatus === 'CLEARED' && status !== 'O' && status !== 'M') continue;
          if (inspectFilterStatus === 'ABSENT' && status !== 'A') continue;

          let displayStatus = 'PRESENT';
          if (status === 'M') displayStatus = 'MEDICAL_LEAVE';
          else if (status === 'O') displayStatus = 'OFFICIAL_PRESENT';
          else if (status === 'A') displayStatus = 'ABSENT';

          list.push({
            sessionDocId: item.sessionDocId,
            date: dStr,
            session: Number(sData.session || item.session || 1),
            subject: normalizeSubKey(sData.subject || item.subject || ''),
            classAlias: sData.classAlias || sData.subject || '',
            teacherName: sData.teacherName || 'Faculty',
            rawStatus: status,
            displayStatus
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
    const isMedRevoke = sessionItem.rawStatus === 'M';
    const confirmPrompt = isMedRevoke
      ? `Revoke Medical Leave for Period ${sessionItem.session} on ${sessionItem.date}? This will restore the absence.`
      : `Revoke clearance for Period ${sessionItem.session} on ${sessionItem.date}? This will restore the absence.`;

    if (!window.confirm(confirmPrompt)) return;

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
        if (sessionItem.rawStatus === 'M') {
          curStat.medicalCount = Math.max(0, (curStat.medicalCount || 0) - 1);
          subObj.medical = Math.max(0, (subObj.medical || 0) - 1);
          if (Array.isArray(subObj.medicalDates)) {
            subObj.medicalDates = subObj.medicalDates.filter(d => d !== sessionItem.date);
          }
        } else {
          curStat.presentCount = Math.max(0, (curStat.presentCount || 0) - 1);
          subObj.present = Math.max(0, (subObj.present || 0) - 1);
          if (sessionItem.rawStatus === 'O') {
            curStat.officialCount = Math.max(0, (curStat.officialCount || 0) - 1);
            subObj.official = Math.max(0, (subObj.official || 0) - 1);
          }
        }
        if (!Array.isArray(subObj.absentDates)) subObj.absentDates = [];
        if (!subObj.absentDates.includes(sessionItem.date)) subObj.absentDates.push(sessionItem.date);
      }

      await setDoc(doc(db, 'students', stDocId), { periodAttendance: curStat }, { merge: true });

      const updatedSt = { ...inspectStudent, periodAttendance: curStat };
      setInspectStudent(updatedSt);
      if (typeof onStudentsUpdated === 'function') {
        onStudentsUpdated(localStudents.map(s => (s.regNo === updatedSt.regNo ? updatedSt : s)));
      }

      alert('✅ Clearance revoked and student restored to Absent.');
      handleLoadInspectStudent(inspectStudent.adNo);
    } catch (err) {
      console.error('Error revoking clearance:', err);
      alert('Error revoking clearance: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* 🌟 1. PRINTABLE OFFICIAL ABSENCE & MEDICAL LEAVE CERTIFICATE MODAL */}
      {activeCertToPrint && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2500, padding: '16px' }}>
          <div style={{ background: '#ffffff', padding: '32px', borderRadius: '16px', maxWidth: '740px', width: '100%', color: '#0f172a', maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #0f172a', paddingBottom: '14px', marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <img src={DHIU_LOGO_URL} alt="DHIU" style={{ width: '56px', height: '56px', objectFit: 'contain' }} />
                <div>
                  <h3 style={{ margin: 0, fontSize: '20px', fontWeight: '900', color: '#0f172a' }}>
                    DARUL HUDA ISLAMIC UNIVERSITY
                  </h3>
                  <div style={{ fontSize: '13px', fontWeight: '800', color: activeCertToPrint.clearanceType === 'MEDICAL_LEAVE' ? '#d97706' : '#059669', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    {activeCertToPrint.clearanceType === 'MEDICAL_LEAVE'
                      ? '🏥 Official Medical Leave Certificate (Excused)'
                      : '🎟️ Official Attendance Clearance Certificate (Normal Present)'}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setActiveCertToPrint(null)}
                className="no-print"
                style={{ background: '#fee2e2', color: '#dc2626', border: 'none', padding: '8px 14px', borderRadius: '8px', fontWeight: '800', cursor: 'pointer' }}
              >
                ✕ Close
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '13px', marginBottom: '20px', background: '#f8fafc', padding: '16px', borderRadius: '10px', border: '1px solid #cbd5e1' }}>
              <div><strong>Reference No:</strong> <code>{activeCertToPrint.certNumber || activeCertToPrint.id}</code></div>
              <div><strong>Issued Date:</strong> {String(activeCertToPrint.issuedAt || '').split('T')[0] || 'Today'}</div>
              <div><strong>Student Name:</strong> <strong style={{ color: '#0f172a' }}>{activeCertToPrint.studentName}</strong></div>
              <div><strong>Admission No:</strong> #{activeCertToPrint.studentAdNo || activeCertToPrint.adNo} (Reg: {activeCertToPrint.studentRegNo || activeCertToPrint.regNo})</div>
              <div><strong>Class Batch:</strong> {Array.isArray(activeCertToPrint.studentClasses) ? activeCertToPrint.studentClasses.join(', ') : (activeCertToPrint.classes || []).join(', ')}</div>
              <div>
                <strong>Recorded Status:</strong>{' '}
                <span style={{
                  padding: '3px 10px',
                  borderRadius: '999px',
                  fontSize: '11px',
                  fontWeight: '800',
                  background: activeCertToPrint.clearanceType === 'MEDICAL_LEAVE' ? '#fef3c7' : '#ecfdf5',
                  color: activeCertToPrint.clearanceType === 'MEDICAL_LEAVE' ? '#b45309' : '#047857'
                }}>
                  {activeCertToPrint.clearanceType === 'MEDICAL_LEAVE' ? '🏥 Medical Leave' : '✅ Normal Present'}
                </span>
              </div>
            </div>

            <div style={{ border: '1px solid #cbd5e1', borderRadius: '10px', padding: '16px', marginBottom: '20px', fontSize: '13px', background: '#ffffff' }}>
              <strong style={{ color: '#0f172a' }}>Official Approval &amp; Authority Statement:</strong>
              <p style={{ margin: '6px 0 0', color: '#334155', fontStyle: 'italic', lineHeight: 1.6 }}>
                &ldquo;{activeCertToPrint.remarks}&rdquo;
              </p>

              {activeCertToPrint.verificationStatus === 'VERIFIED' && (
                <div style={{ marginTop: '10px', padding: '8px 12px', background: '#ecfdf5', borderRadius: '6px', border: '1px solid #a7f3d0', fontSize: '12px', color: '#047857', fontWeight: '700' }}>
                  ✅ Formally verified by {activeCertToPrint.verifiedByName || 'Central Admin'} on {String(activeCertToPrint.verifiedAt || '').split('T')[0]}.
                  {activeCertToPrint.verificationNotes ? ` (${activeCertToPrint.verificationNotes})` : ''}
                </div>
              )}

              {Array.isArray(activeCertToPrint.clearedSessions) && activeCertToPrint.clearedSessions.length > 0 && (
                <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px dashed #e2e8f0' }}>
                  <strong>Cleared Sessions ({activeCertToPrint.clearedSessions.length}):</strong>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                    {activeCertToPrint.clearedSessions.map((s, idx) => (
                      <span key={idx} style={{
                        background: activeCertToPrint.clearanceType === 'MEDICAL_LEAVE' ? '#fef3c7' : '#ecfdf5',
                        color: activeCertToPrint.clearanceType === 'MEDICAL_LEAVE' ? '#92400e' : '#065f46',
                        padding: '3px 8px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: '700',
                        border: activeCertToPrint.clearanceType === 'MEDICAL_LEAVE' ? '1px solid #fde68a' : '1px solid #a7f3d0'
                      }}>
                        {s.date} • Period {s.session} ({s.subject}) → {s.newStatus === 'MEDICAL_LEAVE' ? '🏥 Medical Leave' : '✅ Present'}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginTop: '36px', textAlign: 'center', fontSize: '12px', fontWeight: '800' }}>
              <div style={{ borderTop: '1.5px solid #0f172a', paddingTop: '8px' }}>Authorized Officer / Admin</div>
              <div style={{ borderTop: '1.5px solid #0f172a', paddingTop: '8px' }}>Class Teacher</div>
              <div style={{ borderTop: '1.5px solid #0f172a', paddingTop: '8px' }}>Principal / Academic HoD</div>
            </div>

            <div className="no-print" style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button type="button" onClick={() => window.print()} style={styles.buttonPrimary}>
                🖨️ Print Certificate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🌟 2. ADMIN VERIFICATION MODAL */}
      {verifyingHistoryItem && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2600, padding: '16px' }}>
          <div style={{ background: '#ffffff', padding: '28px', borderRadius: '16px', maxWidth: '520px', width: '100%', color: '#0f172a', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)' }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '18px', fontWeight: '800' }}>
              ✅ Verify Attendance Clearance
            </h3>
            <p style={{ fontSize: '13px', color: '#475569', marginBottom: '16px' }}>
              You are verifying the {verifyingHistoryItem.clearanceType === 'MEDICAL_LEAVE' ? 'Medical Leave' : 'Official Leave'} clearance issued for <strong>{verifyingHistoryItem.studentName}</strong> (#{verifyingHistoryItem.studentAdNo}) covering {verifyingHistoryItem.totalPeriodsCleared} periods.
            </p>
            <div style={{ marginBottom: '16px' }}>
              <label style={styles.label}>Admin Verification Notes / Document Ref (Optional):</label>
              <textarea
                rows={3}
                value={verifyNotesInput}
                onChange={e => setVerifyNotesInput(e.target.value)}
                placeholder="e.g. Doctor certificate verified & filed in academic records..."
                style={{ ...styles.input, width: '100%', resize: 'vertical' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                onClick={() => {
                  setVerifyingHistoryItem(null);
                  setVerifyNotesInput('');
                }}
                style={styles.buttonSecondary}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleVerifyClearanceHistory(verifyingHistoryItem, verifyNotesInput)}
                disabled={loading}
                style={{ ...styles.buttonPrimary, background: '#059669' }}
              >
                {loading ? '⏳ Verifying...' : '✅ Confirm & Mark Verified'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🌟 3. SESSION INSPECTION MODAL */}
      {inspectingHistoryItem && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2600, padding: '16px' }}>
          <div style={{ background: '#ffffff', padding: '28px', borderRadius: '16px', maxWidth: '640px', width: '100%', color: '#0f172a', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '17px', fontWeight: '800' }}>
                📋 Session Breakdown: #{inspectingHistoryItem.studentAdNo} ({inspectingHistoryItem.studentName})
              </h3>
              <button onClick={() => setInspectingHistoryItem(null)} style={{ background: '#fee2e2', color: '#dc2626', border: 'none', padding: '6px 10px', borderRadius: '6px', fontWeight: '800', cursor: 'pointer' }}>✕</button>
            </div>

            <div style={{ marginBottom: '14px', fontSize: '13px', background: '#f8fafc', padding: '12px', borderRadius: '8px' }}>
              <div><strong>Clearance Type:</strong> {inspectingHistoryItem.clearanceType === 'MEDICAL_LEAVE' ? '🏥 Medical Leave' : '🏛️ Official Leave (Present)'}</div>
              <div><strong>Dates:</strong> {(inspectingHistoryItem.dates || []).join(', ')}</div>
              <div><strong>Remarks:</strong> {inspectingHistoryItem.remarks}</div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #cbd5e1', color: '#475569', fontWeight: '800' }}>
                    <th style={{ padding: '8px 10px' }}>Date</th>
                    <th style={{ padding: '8px 10px' }}>Period</th>
                    <th style={{ padding: '8px 10px' }}>Subject</th>
                    <th style={{ padding: '8px 10px' }}>Faculty</th>
                    <th style={{ padding: '8px 10px', textAlign: 'center' }}>Cleared As</th>
                  </tr>
                </thead>
                <tbody>
                  {(inspectingHistoryItem.clearedSessions || []).map((s, sIdx) => (
                    <tr key={sIdx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '8px 10px', fontWeight: '700' }}>{s.date}</td>
                      <td style={{ padding: '8px 10px' }}>Period {s.session}</td>
                      <td style={{ padding: '8px 10px', fontWeight: '700', color: '#4f46e5' }}>{s.subject}</td>
                      <td style={{ padding: '8px 10px', color: '#64748b' }}>{s.teacherName}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                        <span style={{
                          padding: '2px 8px',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontWeight: '800',
                          background: s.newStatus === 'MEDICAL_LEAVE' ? '#fef3c7' : '#ecfdf5',
                          color: s.newStatus === 'MEDICAL_LEAVE' ? '#b45309' : '#047857'
                        }}>
                          {s.newStatus === 'MEDICAL_LEAVE' ? '🏥 Medical Leave' : '✅ Present'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TOP NAVIGATION HEADER & SUB-TABS */}
      <div style={{ background: '#ffffff', padding: '18px 24px', borderRadius: '14px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px', boxShadow: '0 1px 3px rgba(15,23,42,0.05)' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '24px' }}>🎟️</span>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: '#0f172a' }}>
              Official Absence &amp; Medical Leave Clearance Desk
            </h2>
            <span style={{ background: '#fef3c7', color: '#b45309', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: '800' }}>
              Admin Exclusive
            </span>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
            Authorize and grant legitimate absence waivers: record <strong>Medical Leave</strong> (excused) or clear <strong>Official Leave</strong> as <strong>Normal Present</strong>, with full audit history and admin verification.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', background: '#f1f5f9', padding: '4px', borderRadius: '10px' }}>
          {[
            { id: 'issue', label: '🎟️ Issue New Clearance' },
            { id: 'history', label: `📋 Clearance History & Verification (${historyKpis.total})` },
            { id: 'inspect', label: '🔍 Inspect Student Sessions' }
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setClearanceSubTab(tab.id)}
              style={{
                padding: '8px 14px',
                borderRadius: '8px',
                border: 'none',
                fontWeight: '700',
                fontSize: '12px',
                cursor: 'pointer',
                background: clearanceSubTab === tab.id ? '#4f46e5' : 'transparent',
                color: clearanceSubTab === tab.id ? '#ffffff' : '#475569',
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
        <div style={styles.card}>
          <form onSubmit={handleSaveClearance}>
            {/* STEP 1: STUDENTS & DATE SELECTION */}
            <div style={{ background: '#f8fafc', padding: '18px', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '18px' }}>
              <label style={{ ...styles.label, fontSize: '14px', fontWeight: '800', color: '#0f172a', marginBottom: '8px' }}>
                Step 1: Target Students &amp; Dates for Clearance
              </label>

              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '12px' }}>
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

            {/* STEP 2: GRANULAR ABSENT PERIOD WORKSPACE (GROUPED BY STUDENT) */}
            {fetchedClearStudentsList.length > 0 && (
              <div style={{ marginBottom: '18px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
                  <div>
                    <label style={{ ...styles.label, fontSize: '15px', fontWeight: '900', color: '#0f172a', marginBottom: '2px' }}>
                      Step 2: Candidate Absent Periods (Grouped by Student)
                    </label>
                    <div style={{ fontSize: '12px', color: '#64748b' }}>
                      Found {fetchedAbsentPeriodSessions.length} total absent period session(s) across {fetchedClearStudentsList.length} student(s).
                    </div>
                  </div>

                  {fetchedAbsentPeriodSessions.length > 0 && (
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <button
                        type="button"
                        onClick={() => {
                          if (selectedClearSessionIds.length === fetchedAbsentPeriodSessions.length) {
                            setSelectedClearSessionIds([]);
                          } else {
                            setSelectedClearSessionIds(fetchedAbsentPeriodSessions.map(x => x.sessionDocId));
                          }
                        }}
                        style={{
                          padding: '6px 12px',
                          borderRadius: '6px',
                          fontSize: '12px',
                          color: '#4f46e5',
                          background: '#eef2ff',
                          border: '1px solid #c7d2fe',
                          cursor: 'pointer',
                          fontWeight: '800'
                        }}
                      >
                        {selectedClearSessionIds.length === fetchedAbsentPeriodSessions.length ? '✕ Deselect All' : '✓ Select All Periods'}
                      </button>
                    </div>
                  )}
                </div>

                {fetchingClearance ? (
                  <div style={{ padding: '36px', textAlign: 'center', color: '#64748b', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: '18px', marginBottom: '8px' }}>⏳</div>
                    <div style={{ fontWeight: '700' }}>Scanning attendance sessions for absences...</div>
                  </div>
                ) : fetchedAbsentPeriodSessions.length === 0 ? (
                  <div style={{ padding: '24px', background: '#f0fdf4', borderRadius: '12px', border: '1.5px dashed #86efac', textAlign: 'center', color: '#166534', fontSize: '14px', fontWeight: '700' }}>
                    🎉 No unexcused period absences found for the selected students on these dates!
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    {fetchedClearStudentsList.map(st => {
                      const stSessions = fetchedAbsentPeriodSessions.filter(p =>
                        (p.absentStudentRegs && p.absentStudentRegs.includes(st.regNo)) ||
                        (p.absentStudentAdNos && p.absentStudentAdNos.includes(st.adNo))
                      );
                      if (stSessions.length === 0) return null;

                      const allStSelected = stSessions.every(p => selectedClearSessionIds.includes(p.sessionDocId));
                      const someStSelected = stSessions.some(p => selectedClearSessionIds.includes(p.sessionDocId));

                      return (
                        <div
                          key={st.regNo || st.adNo}
                          style={{
                            background: '#ffffff',
                            borderRadius: '12px',
                            border: '1.5px solid #e2e8f0',
                            overflow: 'hidden',
                            boxShadow: '0 1px 3px rgba(15,23,42,0.04)'
                          }}
                        >
                          {/* STUDENT GROUP HEADER */}
                          <div
                            style={{
                              padding: '10px 14px',
                              background: '#f8fafc',
                              borderBottom: '1px solid #e2e8f0',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              flexWrap: 'wrap',
                              gap: '8px'
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <ProfileAvatar name={st.firstName} code={st.adNo} photoUrl={st.photoUrl} size={32} />
                              <div>
                                <span style={{ fontWeight: '800', fontSize: '13px', color: '#0f172a' }}>{st.firstName}</span>
                                <span style={{ fontSize: '12px', color: '#64748b', marginLeft: '6px' }}>
                                  #{st.adNo} • {(st.classes || [st.class]).join(', ')}
                                </span>
                              </div>
                              <span
                                style={{
                                  background: '#fee2e2',
                                  color: '#dc2626',
                                  padding: '2px 8px',
                                  borderRadius: '999px',
                                  fontSize: '11px',
                                  fontWeight: '800'
                                }}
                              >
                                {stSessions.length} Absent Period{stSessions.length > 1 ? 's' : ''}
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                const stDocIds = stSessions.map(x => x.sessionDocId);
                                if (allStSelected) {
                                  setSelectedClearSessionIds(prev => prev.filter(id => !stDocIds.includes(id)));
                                } else {
                                  setSelectedClearSessionIds(prev => Array.from(new Set([...prev, ...stDocIds])));
                                }
                              }}
                              style={{
                                padding: '4px 10px',
                                borderRadius: '6px',
                                fontSize: '11px',
                                fontWeight: '800',
                                cursor: 'pointer',
                                background: allStSelected ? '#e0e7ff' : '#ffffff',
                                color: allStSelected ? '#4338ca' : '#475569',
                                border: allStSelected ? '1px solid #c7d2fe' : '1px solid #cbd5e1'
                              }}
                            >
                              {allStSelected ? '✕ Deselect Student' : '✓ Select Student'}
                            </button>
                          </div>

                          {/* PERIOD ITEMS */}
                          <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {stSessions.map(p => {
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
                                    padding: '8px 12px',
                                    borderRadius: '8px',
                                    background: isChecked ? '#eff6ff' : '#ffffff',
                                    border: isChecked ? '1.5px solid #93c5fd' : '1px solid #f1f5f9',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease'
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
                                      <div style={{ fontWeight: '800', fontSize: '12px', color: '#0f172a' }}>
                                        📅 {p.date} • Period {p.session}: <span style={{ color: '#2563eb' }}>{p.subject}</span>
                                      </div>
                                      <div style={{ fontSize: '11px', color: '#64748b' }}>
                                        👨‍🏫 Faculty: {p.teacherName || 'Class Teacher'}
                                      </div>
                                    </div>
                                  </div>

                                  <span
                                    style={{
                                      background: '#fef2f2',
                                      color: '#dc2626',
                                      border: '1px solid #fecdd3',
                                      padding: '2px 8px',
                                      borderRadius: '6px',
                                      fontSize: '11px',
                                      fontWeight: '800'
                                    }}
                                  >
                                    ABSENT
                                  </span>
                                </div>
                              );
                            })}
                          </div>
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
                <label style={{ ...styles.label, fontSize: '15px', fontWeight: '900', color: '#0f172a', marginBottom: '10px' }}>
                  Step 3: Clearance Type &amp; Applied Status Effect
                </label>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px', marginBottom: '14px' }}>
                  {[
                    {
                      id: 'medical',
                      label: '🏥 Medical Leave (Excused)',
                      desc: 'Recorded and displayed distinctly as Medical Leave with light red styling. Excused without modifying normal presence ratios.',
                      badge: '🏥 Medical Leave (Rose)',
                      badgeBg: '#fff1f2',
                      badgeBorder: '#fecdd3',
                      badgeColor: '#b91c1c'
                    },
                    {
                      id: 'official',
                      label: '🏛️ Official Duty (Present)',
                      desc: 'Authorized institutional representation. Cleared and recorded as Official Duty with light blue styling in reports and registers.',
                      badge: '🏛️ Official Duty (Blue)',
                      badgeBg: '#eff6ff',
                      badgeBorder: '#bfdbfe',
                      badgeColor: '#1d4ed8'
                    },
                    {
                      id: 'permitted',
                      label: '🎭 Rehearsal / Approved Special Duty',
                      desc: 'Special campus duty representation - cleared as verified duty presence.',
                      badge: '🏛️ Approved Duty (Blue)',
                      badgeBg: '#eff6ff',
                      badgeBorder: '#bfdbfe',
                      badgeColor: '#1d4ed8'
                    }
                  ].map(r => (
                    <div
                      key={r.id}
                      onClick={() => setClearReason(r.id)}
                      style={{
                        padding: '14px 16px',
                        borderRadius: '10px',
                        border: clearReason === r.id ? '2px solid #2563eb' : '1px solid #cbd5e1',
                        background: clearReason === r.id ? '#eff6ff' : '#ffffff',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontWeight: '800', fontSize: '13px', color: clearReason === r.id ? '#1d4ed8' : '#0f172a' }}>{r.label}</div>
                      </div>
                      <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', lineHeight: 1.4 }}>{r.desc}</div>
                      <div style={{ marginTop: '8px' }}>
                        <span style={{
                          padding: '3px 8px',
                          borderRadius: '6px',
                          fontSize: '10px',
                          fontWeight: '800',
                          background: r.badgeBg,
                          border: `1px solid ${r.badgeBorder}`,
                          color: r.badgeColor
                        }}>
                          Result: {r.badge}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                <div>
                  <label style={styles.label}>Official Remarks / Justification (Appears on Certificate &amp; History):</label>
                  <input
                    type="text"
                    value={clearanceRemarks}
                    onChange={e => setClearanceRemarks(e.target.value)}
                    placeholder="e.g. Admitted under doctor care; medical fitness certificate submitted..."
                    style={styles.input}
                  />
                </div>
              </div>
            )}

            {fetchedClearStudentsList.length > 0 && (
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  type="submit"
                  disabled={loading || selectedClearSessionIds.length === 0}
                  style={{
                    ...styles.buttonPrimary,
                    padding: '14px 22px',
                    fontSize: '14px',
                    fontWeight: '800',
                    background: clearReason === 'medical' ? '#e11d48' : '#2563eb',
                    opacity: selectedClearSessionIds.length === 0 ? 0.6 : 1
                  }}
                >
                  {loading
                    ? '⏳ Applying Official Clearance...'
                    : clearReason === 'medical'
                    ? `🏥 Record Medical Leave for ${selectedClearSessionIds.length} Selected Period(s)`
                    : `🏛️ Clear ${selectedClearSessionIds.length} Period(s) as Official Duty`}
                </button>

                {fetchedAbsentPeriodSessions.length > 0 && selectedClearSessionIds.length < fetchedAbsentPeriodSessions.length && (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => {
                      setSelectedClearSessionIds(fetchedAbsentPeriodSessions.map(x => x.sessionDocId));
                    }}
                    style={{
                      padding: '14px 18px',
                      borderRadius: '8px',
                      border: '1.5px solid #cbd5e1',
                      background: '#ffffff',
                      color: '#475569',
                      fontSize: '13px',
                      fontWeight: '800',
                      cursor: 'pointer'
                    }}
                  >
                    ⚡ Select All Found ({fetchedAbsentPeriodSessions.length} Absences)
                  </button>
                )}
              </div>
            )}
          </form>
        </div>
      )}

      {/* ============================================================
          VIEW 2: CLEARANCE HISTORY & ADMIN VERIFICATION DESK
         ============================================================ */}
      {clearanceSubTab === 'history' && (
        <div style={styles.card}>
          {/* LIVE KPI METRICS STRIP */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '20px' }}>
            <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '800', textTransform: 'uppercase' }}>Total Clearances</div>
              <div style={{ fontSize: '24px', fontWeight: '900', color: '#0f172a', marginTop: '2px' }}>{historyKpis.total}</div>
            </div>
            <div style={{ background: '#fffbeb', padding: '14px 16px', borderRadius: '12px', border: '1px solid #fde68a' }}>
              <div style={{ fontSize: '11px', color: '#b45309', fontWeight: '800', textTransform: 'uppercase' }}>🏥 Medical Leaves</div>
              <div style={{ fontSize: '24px', fontWeight: '900', color: '#b45309', marginTop: '2px' }}>{historyKpis.medical}</div>
            </div>
            <div style={{ background: '#ecfdf5', padding: '14px 16px', borderRadius: '12px', border: '1px solid #a7f3d0' }}>
              <div style={{ fontSize: '11px', color: '#047857', fontWeight: '800', textTransform: 'uppercase' }}>🏛️ Official (Present)</div>
              <div style={{ fontSize: '24px', fontWeight: '900', color: '#047857', marginTop: '2px' }}>{historyKpis.official}</div>
            </div>
            <div style={{ background: '#f0fdf4', padding: '14px 16px', borderRadius: '12px', border: '1px solid #bbf7d0' }}>
              <div style={{ fontSize: '11px', color: '#15803d', fontWeight: '800', textTransform: 'uppercase' }}>✅ Verified by Admin</div>
              <div style={{ fontSize: '24px', fontWeight: '900', color: '#15803d', marginTop: '2px' }}>{historyKpis.verified}</div>
            </div>
            <div style={{ background: '#fff1f2', padding: '14px 16px', borderRadius: '12px', border: '1px solid #fecdd3' }}>
              <div style={{ fontSize: '11px', color: '#be123c', fontWeight: '800', textTransform: 'uppercase' }}>⏳ Pending Verification</div>
              <div style={{ fontSize: '24px', fontWeight: '900', color: '#be123c', marginTop: '2px' }}>{historyKpis.pending}</div>
            </div>
          </div>

          {/* INTERACTIVE FILTERS & EXPORT */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                type="text"
                value={historySearch}
                onChange={e => setHistorySearch(e.target.value)}
                placeholder="🔍 Search name, Ad.No or ref..."
                style={{ ...styles.input, width: '220px', padding: '7px 12px', fontSize: '12px' }}
              />

              <select
                value={historyTypeFilter}
                onChange={e => setHistoryTypeFilter(e.target.value)}
                style={{ ...styles.input, width: 'auto', padding: '7px 12px', fontSize: '12px', fontWeight: '700' }}
              >
                <option value="ALL">All Clearance Types</option>
                <option value="MEDICAL_LEAVE">🏥 Medical Leave Only</option>
                <option value="OFFICIAL_PRESENT">🏛️ Official Leave (Present) Only</option>
              </select>

              <select
                value={historyVerifyFilter}
                onChange={e => setHistoryVerifyFilter(e.target.value)}
                style={{ ...styles.input, width: 'auto', padding: '7px 12px', fontSize: '12px', fontWeight: '700' }}
              >
                <option value="ALL">All Statuses</option>
                <option value="PENDING">⏳ Pending Verification</option>
                <option value="VERIFIED">✅ Verified Only</option>
              </select>

              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <input
                  type="date"
                  value={historyDateFrom}
                  onChange={e => setHistoryDateFrom(e.target.value)}
                  style={{ ...styles.input, width: 'auto', padding: '6px 8px', fontSize: '11px' }}
                />
                <span style={{ fontSize: '11px', color: '#64748b' }}>to</span>
                <input
                  type="date"
                  value={historyDateTo}
                  onChange={e => setHistoryDateTo(e.target.value)}
                  style={{ ...styles.input, width: 'auto', padding: '6px 8px', fontSize: '11px' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                type="button"
                onClick={loadClearanceHistory}
                disabled={loadingHistory}
                style={{ ...styles.buttonSecondary, fontSize: '12px', padding: '7px 12px' }}
              >
                🔄 Refresh
              </button>
              <button
                type="button"
                onClick={handleExportHistoryExcel}
                style={{ ...styles.buttonPrimary, background: '#059669', fontSize: '12px', padding: '7px 14px' }}
              >
                📥 Export Excel
              </button>
            </div>
          </div>

          {/* CLEARANCE HISTORY AUDIT TABLE */}
          <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '11px', fontWeight: '800', textTransform: 'uppercase' }}>
                  <th style={{ padding: '12px 14px' }}>#</th>
                  <th style={{ padding: '12px 14px' }}>DATE / REF</th>
                  <th style={{ padding: '12px 14px' }}>STUDENT NAME</th>
                  <th style={{ padding: '12px 14px' }}>CLEARANCE TYPE</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center' }}>PERIODS</th>
                  <th style={{ padding: '12px 14px' }}>REMARKS</th>
                  <th style={{ padding: '12px 14px' }}>ISSUED BY</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center' }}>VERIFICATION</th>
                  <th style={{ padding: '12px 14px', textAlign: 'right' }}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {filteredClearanceHistory.length === 0 ? (
                  <tr>
                    <td colSpan="9" style={{ padding: '32px', textAlign: 'center', color: '#64748b', fontWeight: '600' }}>
                      {loadingHistory ? 'Loading clearance history...' : 'No clearance records match your current filter.'}
                    </td>
                  </tr>
                ) : (
                  filteredClearanceHistory.map((item, idx) => {
                    const isMed = item.clearanceType === 'MEDICAL_LEAVE' || item.reason === 'medical';
                    const isVer = item.verificationStatus === 'VERIFIED';
                    return (
                      <tr key={item.id || idx} style={{ borderBottom: '1px solid #f1f5f9', background: '#ffffff' }}>
                        <td style={{ padding: '12px 14px', color: '#64748b' }}>{idx + 1}</td>
                        <td style={{ padding: '12px 14px' }}>
                          <div style={{ fontWeight: '700', color: '#0f172a' }}>{String(item.issuedAt || '').split('T')[0]}</div>
                          <code style={{ fontSize: '10px', color: '#64748b' }}>{item.certNumber || item.id}</code>
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <div style={{ fontWeight: '700', color: '#0f172a' }}>{item.studentName}</div>
                          <div style={{ fontSize: '11px', color: '#64748b' }}>
                            #{item.studentAdNo} • {Array.isArray(item.studentClasses) ? item.studentClasses.join(', ') : item.studentClasses}
                          </div>
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <span style={{
                            padding: '3px 10px',
                            borderRadius: '999px',
                            fontSize: '11px',
                            fontWeight: '800',
                            background: isMed ? '#fef3c7' : '#ecfdf5',
                            color: isMed ? '#b45309' : '#047857'
                          }}>
                            {isMed ? '🏥 Medical Leave' : '🏛️ Normal Present'}
                          </span>
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                          <span style={{ fontWeight: '800', color: '#0f172a' }}>{item.totalPeriodsCleared || 1}</span>
                          <div style={{ fontSize: '10px', color: '#64748b' }}>
                            {(item.dates || []).length} day(s)
                          </div>
                        </td>
                        <td style={{ padding: '12px 14px', maxWidth: '180px' }}>
                          <div style={{ fontSize: '11px', color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.remarks}>
                            {item.remarks || '-'}
                          </div>
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <div style={{ fontWeight: '700', color: '#0f172a' }}>{item.issuedByName || 'Admin'}</div>
                          <div style={{ fontSize: '10px', color: '#64748b' }}>@{item.issuedByUsername || 'admin'}</div>
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                          <span style={{
                            padding: '3px 10px',
                            borderRadius: '999px',
                            fontSize: '11px',
                            fontWeight: '800',
                            background: isVer ? '#ecfdf5' : '#fffbeb',
                            color: isVer ? '#047857' : '#b45309'
                          }}>
                            {isVer ? '✅ Verified' : '⏳ Pending'}
                          </span>
                          {isVer && item.verifiedByName && (
                            <div style={{ fontSize: '9px', color: '#047857', marginTop: '2px' }}>
                              by {item.verifiedByName}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '6px' }}>
                            <button
                              type="button"
                              onClick={() => setInspectingHistoryItem(item)}
                              style={{ padding: '4px 8px', background: '#f8fafc', color: '#334155', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '11px', fontWeight: '700', cursor: 'pointer' }}
                              title="Inspect session breakdown"
                            >
                              👁️ Sessions
                            </button>
                            {!isVer && (
                              <button
                                type="button"
                                onClick={() => setVerifyingHistoryItem(item)}
                                style={{ padding: '4px 8px', background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', borderRadius: '6px', fontSize: '11px', fontWeight: '800', cursor: 'pointer' }}
                                title="Mark clearance verified"
                              >
                                ✅ Verify
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setActiveCertToPrint(item)}
                              style={{ padding: '4px 8px', background: '#eef2ff', color: '#4338ca', border: '1px solid #c7d2fe', borderRadius: '6px', fontSize: '11px', fontWeight: '700', cursor: 'pointer' }}
                              title="View printable certificate"
                            >
                              📜 Cert
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ============================================================
          VIEW 3: INSPECT & EDIT STUDENT SESSIONS
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
                style={{ ...styles.input, width: 'auto', fontWeight: '700' }}
              >
                <option value="ALL">All Recorded Sessions</option>
                <option value="MEDICAL">🏥 Medical Leave Only</option>
                <option value="OFFICIAL">🏛️ Official Leave (Present)</option>
                <option value="ABSENT">❌ Absent Only</option>
                <option value="CLEARED">All Cleared (Medical + Official)</option>
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

          <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '11px', fontWeight: '800', textTransform: 'uppercase' }}>
                  <th style={{ padding: '12px 14px' }}>#</th>
                  <th style={{ padding: '12px 14px' }}>DATE</th>
                  <th style={{ padding: '12px 14px' }}>PERIOD</th>
                  <th style={{ padding: '12px 14px' }}>SUBJECT</th>
                  <th style={{ padding: '12px 14px' }}>FACULTY</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center' }}>RECORDED STATUS</th>
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
                  inspectSessionsList.map((item, idx) => {
                    const isMed = item.rawStatus === 'M';
                    const isOff = item.rawStatus === 'O';
                    const isAbs = item.rawStatus === 'A';
                    return (
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
                            background: isMed ? '#fef3c7' : isOff ? '#ecfdf5' : isAbs ? '#fee2e2' : '#f0fdf4',
                            color: isMed ? '#b45309' : isOff ? '#047857' : isAbs ? '#dc2626' : '#15803d'
                          }}>
                            {isMed ? '🏥 Medical Leave' : isOff ? '🏛️ Official Leave (Present)' : isAbs ? '❌ Absent' : '✅ Present'}
                          </span>
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                          {(isMed || isOff) && (
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
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
}
