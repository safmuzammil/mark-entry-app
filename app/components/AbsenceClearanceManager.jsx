'use client';
import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { auth, db } from '../../lib/firebase';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { doc, getDoc, getDocs, setDoc, deleteDoc, collection, writeBatch } from 'firebase/firestore';
import { DEFAULT_CLASSES, styles, DHIU_LOGO_URL } from './erpConstants';
import { ProfileAvatar } from './ErpExtensions';

function getStudentAttStat(st) {
  if (st && st.periodAttendance && typeof st.periodAttendance === 'object') {
    return st.periodAttendance;
  }
  return {
    totalPeriods: 0,
    presentCount: 0,
    officialCount: 0,
    medicalCount: 0,
    permittedCount: 0,
    minusCount: 0,
    subjectWise: {},
    minusLogs: []
  };
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
  let safety = 0;
  while (curr <= stop && safety < 180) {
    const y = curr.getFullYear();
    const m = String(curr.getMonth() + 1).padStart(2, '0');
    const d = String(curr.getDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${d}`);
    curr.setDate(curr.getDate() + 1);
    safety++;
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

  // --- 1. ISSUE NEW CLEARANCE STATE (With Class Filter & Name/Ad.No Search Before Search) ---
  const [issueClassFilter, setIssueClassFilter] = useState('ALL');
  const [issueStudentSearch, setIssueStudentSearch] = useState('');
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
  const [clearStartDate, setClearStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split('T')[0];
  });
  const [clearEndDate, setClearEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [fetchingClearance, setFetchingClearance] = useState(false);
  const [clearanceRemarks, setClearanceRemarks] = useState('');
  const [loading, setLoading] = useState(false);

  // --- 2. CLEARANCE HISTORY & ADMIN VERIFICATION STATE ---
  const [clearanceHistoryList, setClearanceHistoryList] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [historyClassFilter, setHistoryClassFilter] = useState('ALL');
  const [historyTypeFilter, setHistoryTypeFilter] = useState('ALL');
  const [historyVerifyFilter, setHistoryVerifyFilter] = useState('ALL');
  const [historyDateFrom, setHistoryDateFrom] = useState('');
  const [historyDateTo, setHistoryDateTo] = useState('');
  const [inspectingHistoryItem, setInspectingHistoryItem] = useState(null);
  const [verifyingHistoryItem, setVerifyingHistoryItem] = useState(null);
  const [verifyNotesInput, setVerifyNotesInput] = useState('');

  // --- 3. FAST INSPECT & EDIT STUDENT SESSIONS STATE (With Class Filter & Name/Ad.No Search) ---
  const [inspectClassFilter, setInspectClassFilter] = useState('ALL');
  const [inspectSearchText, setInspectSearchText] = useState('');
  const [inspectAdNo, setInspectAdNo] = useState('');
  const [inspectStudent, setInspectStudent] = useState(null);
  const [inspectDateStart, setInspectDateStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [inspectDateEnd, setInspectDateEnd] = useState(() => new Date().toISOString().split('T')[0]);
  const [inspectFilterStatus, setInspectFilterStatus] = useState('ALL');
  const [inspectSessionsList, setInspectSessionsList] = useState([]);
  const [fetchingInspect, setFetchingInspect] = useState(false);

  // --- 4. PRINTABLE CERTIFICATE MODAL STATE ---
  const [activeCertToPrint, setActiveCertToPrint] = useState(null);

  // --- 5. HIGH-SECURITY SCOPED ATTENDANCE DELETE STATE (Period + Night + Extra Only) ---
  const [delDateScope, setDelDateScope] = useState('DATE_RANGE'); // 'DATE_RANGE' | 'ALL_DATES'
  const [delStartDate, setDelStartDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [delEndDate, setDelEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [delClassScope, setDelClassScope] = useState('ALL'); // 'ALL' or specific class
  const [delIncludePeriod, setDelIncludePeriod] = useState(true);
  const [delIncludeNight, setDelIncludeNight] = useState(true);
  const [delIncludeExtra, setDelIncludeExtra] = useState(true);
  const [delSafetyChecked, setDelSafetyChecked] = useState(false);
  const [delPassword, setDelPassword] = useState('');
  const [delConfirmPhrase, setDelConfirmPhrase] = useState('');
  const [deletingAttendance, setDeletingAttendance] = useState(false);

  // Filtered students for Step 1 Issue Clearance
  const issueFilteredStudents = useMemo(() => {
    return localStudents.filter(st => {
      const stCls = Array.isArray(st.classes) ? st.classes : [st.class];
      if (issueClassFilter !== 'ALL' && !stCls.includes(issueClassFilter)) return false;
      if (issueStudentSearch.trim()) {
        const q = issueStudentSearch.trim().toLowerCase();
        const matchName = String(st.firstName || '').toLowerCase().includes(q);
        const matchAd = String(st.adNo || '').toLowerCase().includes(q);
        const matchReg = String(st.regNo || '').toLowerCase().includes(q);
        if (!matchName && !matchAd && !matchReg) return false;
      }
      return true;
    });
  }, [localStudents, issueClassFilter, issueStudentSearch]);

  // Filtered students for Inspect Student Sessions
  const inspectFilteredStudents = useMemo(() => {
    return localStudents.filter(st => {
      const stCls = Array.isArray(st.classes) ? st.classes : [st.class];
      if (inspectClassFilter !== 'ALL' && !stCls.includes(inspectClassFilter)) return false;
      if (inspectSearchText.trim()) {
        const q = inspectSearchText.trim().toLowerCase();
        const matchName = String(st.firstName || '').toLowerCase().includes(q);
        const matchAd = String(st.adNo || '').toLowerCase().includes(q);
        const matchReg = String(st.regNo || '').toLowerCase().includes(q);
        if (!matchName && !matchAd && !matchReg) return false;
      }
      return true;
    });
  }, [localStudents, inspectClassFilter, inspectSearchText]);

  const addStudentToClearanceInput = (st) => {
    if (!st || !st.adNo) return;
    const adStr = String(st.adNo).trim();
    const existingTokens = clearAdNo
      .split(/[,;\s]+/)
      .map(t => t.replace(/^#/, '').trim())
      .filter(Boolean);
    if (!existingTokens.some(t => t.toUpperCase() === adStr.toUpperCase())) {
      existingTokens.push(adStr);
    }
    setClearAdNo(existingTokens.join(', '));
  };

  // ==========================================
  // LOAD CLEARANCE HISTORY (Index-Free & Automatic on Mount)
  // ==========================================
  const loadClearanceHistory = async () => {
    setLoadingHistory(true);
    try {
      const list = [];
      const seenIds = new Set();

      const normalizeCertDoc = (id, data) => {
        const isMed =
          data.reason === 'medical' ||
          data.clearanceType === 'MEDICAL_LEAVE' ||
          String(data.clearanceTypeLabel || '').toLowerCase().includes('medical');
        const stMatch = localStudents.find(
          s =>
            String(s.adNo || '').toUpperCase() === String(data.studentAdNo || data.adNo || '').toUpperCase() ||
            String(s.regNo || '').toUpperCase() === String(data.studentRegNo || data.regNo || '').toUpperCase()
        );
        return {
          id,
          certNumber: data.certNumber || id,
          studentRegNo: data.studentRegNo || data.regNo || stMatch?.regNo || '',
          studentAdNo: data.studentAdNo || data.adNo || stMatch?.adNo || '',
          studentName: data.studentName || stMatch?.firstName || 'Student',
          studentClasses:
            Array.isArray(data.studentClasses) && data.studentClasses.length > 0
              ? data.studentClasses
              : Array.isArray(data.classes) && data.classes.length > 0
              ? data.classes
              : stMatch?.classes || [],
          department: data.department || stMatch?.department || 'GENERAL',
          clearanceType: isMed ? 'MEDICAL_LEAVE' : 'OFFICIAL_PRESENT',
          clearanceTypeLabel: isMed ? '🏥 Medical Leave' : '🏛️ Official Leave (Present)',
          reason: data.reason || (isMed ? 'medical' : 'official'),
          remarks: data.remarks || '',
          dates: Array.isArray(data.dates) ? data.dates : [],
          totalPeriodsCleared:
            Number(data.totalPeriodsCleared) ||
            (Array.isArray(data.clearedSessions) ? data.clearedSessions.length : 1),
          clearedSessions: Array.isArray(data.clearedSessions) ? data.clearedSessions : [],
          clearedLegacySubjects: Array.isArray(data.clearedLegacySubjects) ? data.clearedLegacySubjects : [],
          issuedByUsername: data.issuedByUsername || data.clearedBy || 'admin',
          issuedByName: data.issuedByName || data.clearedBy || 'Central Admin',
          issuedByRole: data.issuedByRole || data.clearedByRole || 'admin',
          issuedAt: data.issuedAt || data.createdAt || new Date().toISOString(),
          verificationStatus:
            data.verificationStatus === 'VERIFIED' || data.status === 'VERIFIED'
              ? 'VERIFIED'
              : 'PENDING',
          verifiedBy: data.verifiedBy || null,
          verifiedByName: data.verifiedByName || null,
          verifiedAt: data.verifiedAt || null,
          verificationNotes: data.verificationNotes || ''
        };
      };

      const [histSnap, certSnap] = await Promise.all([
        getDocs(collection(db, 'clearance_history')).catch(() => null),
        getDocs(collection(db, 'clearance_certificates')).catch(() => null)
      ]);

      if (histSnap) {
        histSnap.forEach(d => {
          const rec = normalizeCertDoc(d.id, d.data() || {});
          const dedupKey = rec.certNumber || d.id;
          if (!seenIds.has(dedupKey) && !seenIds.has(d.id)) {
            seenIds.add(dedupKey);
            seenIds.add(d.id);
            list.push(rec);
          }
        });
      }

      if (certSnap) {
        certSnap.forEach(d => {
          const rec = normalizeCertDoc(d.id, d.data() || {});
          const dedupKey = rec.certNumber || d.id;
          if (!seenIds.has(dedupKey) && !seenIds.has(d.id)) {
            seenIds.add(dedupKey);
            seenIds.add(d.id);
            list.push(rec);
          }
        });
      }

      // Also scan localStudents periodAttendance.clearanceCertificates
      localStudents.forEach(st => {
        const stat = getStudentAttStat(st);
        const certs = stat.clearanceCertificates || [];
        certs.forEach(c => {
          const cId = c.id || c.certNumber;
          if (cId && !seenIds.has(cId)) {
            seenIds.add(cId);
            list.push(
              normalizeCertDoc(cId, {
                ...c,
                studentRegNo: st.regNo,
                studentAdNo: st.adNo,
                studentName: st.firstName,
                studentClasses: st.classes || [st.class] || []
              })
            );
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
    loadClearanceHistory();
  }, [localStudents.length]);

  const filteredClearanceHistory = useMemo(() => {
    return clearanceHistoryList.filter(item => {
      if (historyClassFilter !== 'ALL') {
        const clsArr = Array.isArray(item.studentClasses) ? item.studentClasses : [item.studentClasses];
        if (!clsArr.includes(historyClassFilter)) return false;
      }
      if (historyTypeFilter !== 'ALL' && item.clearanceType !== historyTypeFilter) return false;
      if (historyVerifyFilter !== 'ALL' && item.verificationStatus !== historyVerifyFilter) return false;
      if (historyDateFrom) {
        const itemDate = (item.dates && item.dates[0]) || String(item.issuedAt || '').split('T')[0];
        if (itemDate < historyDateFrom) return false;
      }
      if (historyDateTo) {
        const itemDate = (item.dates && item.dates[0]) || String(item.issuedAt || '').split('T')[0];
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
  }, [
    clearanceHistoryList,
    historyClassFilter,
    historyTypeFilter,
    historyVerifyFilter,
    historyDateFrom,
    historyDateTo,
    historySearch
  ]);

  const historyKpis = useMemo(() => {
    const total = clearanceHistoryList.length;
    const medical = clearanceHistoryList.filter(
      i => i.clearanceType === 'MEDICAL_LEAVE' || i.reason === 'medical'
    ).length;
    const official = clearanceHistoryList.filter(
      i => i.clearanceType === 'OFFICIAL_PRESENT' || i.reason === 'official' || i.reason === 'permitted'
    ).length;
    const verified = clearanceHistoryList.filter(i => i.verificationStatus === 'VERIFIED').length;
    const pending = total - verified;
    return { total, medical, official, verified, pending };
  }, [clearanceHistoryList]);

  // ==========================================
  // 1. ULTRA-FAST FETCH ABSENT PERIOD SESSIONS FOR CLEARANCE
  // ==========================================
  const handleFetchStudentForClearance = async (overrideQuery) => {
    const rawQ = String(overrideQuery !== undefined ? overrideQuery : clearAdNo).trim();
    if (!rawQ) return alert('Please select a student from the filter or enter an Admission Number / Name.');

    const tokens = rawQ
      .split(/[,;\n]+/)
      .map(t => t.replace(/^#/, '').trim())
      .filter(Boolean);
    const foundStudents = [];
    const unmatched = [];

    tokens.forEach(tok => {
      const upTok = tok.toUpperCase();
      const lowTok = tok.toLowerCase();
      let match = localStudents.find(
        s =>
          String(s.adNo || '').trim().toUpperCase() === upTok ||
          String(s.regNo || '').trim().toUpperCase() === upTok
      );
      if (!match && /^\d+$/.test(upTok)) {
        match = localStudents.find(s => String(s.adNo || '').trim().toUpperCase() === 'U' + upTok);
      }
      if (!match) {
        match =
          localStudents.find(s => String(s.firstName || '').trim().toLowerCase() === lowTok) ||
          localStudents.find(s => String(s.firstName || '').trim().toLowerCase().includes(lowTok));
      }
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
      const targetDates =
        clearDateMode === 'single' ? [clearDate] : getDatesBetween(clearStartDate, clearEndDate);

      // Fetch all daySessionsIndex docs in parallel
      const indexSnaps = await Promise.all(
        targetDates.map(dStr => getDoc(doc(db, 'systemCache', `daySessionsIndex_${dStr}`)))
      );

      const sessionsNeedingDocRead = [];
      const allResolvedSessions = [];

      indexSnaps.forEach((idxSnap, idx) => {
        if (!idxSnap.exists()) return;
        const dStr = targetDates[idx];
        const sessList = idxSnap.data().sessions || [];
        sessList.forEach(item => {
          if (item.attendanceMap && typeof item.attendanceMap === 'object') {
            allResolvedSessions.push({ ...item, date: dStr });
          } else if (item.sessionDocId) {
            sessionsNeedingDocRead.push({ ...item, date: dStr });
          }
        });
      });

      if (sessionsNeedingDocRead.length > 0) {
        const fetchedDocs = await Promise.all(
          sessionsNeedingDocRead.map(item => getDoc(doc(db, 'systemCache', item.sessionDocId)))
        );
        fetchedDocs.forEach((sSnap, idx) => {
          if (sSnap.exists()) {
            allResolvedSessions.push({
              ...sessionsNeedingDocRead[idx],
              ...sSnap.data(),
              sessionDocId: sessionsNeedingDocRead[idx].sessionDocId,
              date: sessionsNeedingDocRead[idx].date
            });
          }
        });
      }

      const absentSessionItems = [];
      allResolvedSessions.forEach(sData => {
        const attMap = sData.attendanceMap || {};
        const absentStInThisPeriod = foundStudents.filter(st => {
          const status = attMap[st.regNo] || attMap[st.id] || attMap[st.adNo];
          return status === 'A';
        });

        if (absentStInThisPeriod.length > 0) {
          absentSessionItems.push({
            sessionDocId: sData.sessionDocId || sData.id,
            date: sData.date,
            session: Number(sData.session || 1),
            subject: normalizeSubKey(sData.subject || ''),
            classAlias: sData.classAlias || sData.subject || '',
            teacherName: sData.teacherName || 'Faculty',
            absentStudentRegs: absentStInThisPeriod.map(x => x.regNo),
            absentStudentAdNos: absentStInThisPeriod.map(x => x.adNo),
            absentStudentNames: absentStInThisPeriod.map(x => `${x.firstName} (#${x.adNo})`).join(', ')
          });
        }
      });

      absentSessionItems.sort((a, b) => a.date.localeCompare(b.date) || a.session - b.session);
      setFetchedAbsentPeriodSessions(absentSessionItems);
      setSelectedClearSessionIds(absentSessionItems.map(x => x.sessionDocId));

      const subSet = new Set();
      foundStudents.forEach(st => {
        const stat = getStudentAttStat(st);
        const subWise = stat.subjectWise || {};
        Object.entries(subWise).forEach(([subKey, sObj]) => {
          const absDates = Array.isArray(sObj.absentDates) ? sObj.absentDates : [];
          const hasAbsenceInScope = absDates.some(d =>
            clearDateMode === 'single'
              ? d === clearDate
              : (!clearStartDate || d >= clearStartDate) && (!clearEndDate || d <= clearEndDate)
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
  const handleAutoClearRehearsalAbsences = async () => {
    if (fetchedClearStudentsList.length === 0) return alert('Please fetch students first.');
    setLoading(true);
    try {
      const cacheSnap = await getDocs(collection(db, 'systemCache'));
      const rehearsalCreditsMap = {};
      cacheSnap.forEach(d => {
        if (!d.id.startsWith('rehearsalSession_')) return;
        const rData = d.data();
        const rDate = rData.date;
        const sessId = rData.sessionId;
        const weight = Number(rData.weight || 2);
        (rData.presentRegNos || []).forEach(reg => {
          if (!rehearsalCreditsMap[reg]) rehearsalCreditsMap[reg] = {};
          if (!rehearsalCreditsMap[reg][rDate]) {
            rehearsalCreditsMap[reg][rDate] = { sessionsDone: new Set(), weightEarned: 0 };
          }
          const entry = rehearsalCreditsMap[reg][rDate];
          if (!entry.sessionsDone.has(sessId)) {
            entry.sessionsDone.add(sessId);
            entry.weightEarned += weight;
          }
        });
      });

      const batch = writeBatch(db);
      const updatedMap = {};
      let totalPeriodsCleared = 0;

      fetchedClearStudentsList.forEach(st => {
        const studentRehDates = rehearsalCreditsMap[st.regNo];
        if (!studentRehDates) return;

        const nextStat = JSON.parse(JSON.stringify(getStudentAttStat(st)));
        if (!nextStat.subjectWise) nextStat.subjectWise = {};
        if (!nextStat.appliedRehearsalDates) nextStat.appliedRehearsalDates = {};

        let clearedForStudent = 0;
        const subKeys = Object.keys(nextStat.subjectWise);

        Object.keys(studentRehDates).forEach(rehDateStr => {
          const earnedWeight = studentRehDates[rehDateStr].weightEarned || 0;
          const alreadyApplied = Number(nextStat.appliedRehearsalDates[rehDateStr] || 0);
          let creditsToApply = Math.max(0, earnedWeight - alreadyApplied);
          if (creditsToApply <= 0) return;

          let clearedOnDate = 0;
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
              clearedOnDate += 1;
              clearedForStudent += 1;
            }
          }
          if (clearedOnDate > 0) {
            nextStat.appliedRehearsalDates[rehDateStr] = alreadyApplied + clearedOnDate;
          }
        });

        if (clearedForStudent > 0) {
          totalPeriodsCleared += clearedForStudent;
          const docId = String(st.id || st.regNo || '').trim();
          batch.set(doc(db, 'students', docId), { periodAttendance: nextStat }, { merge: true });
          updatedMap[st.regNo] = { ...st, periodAttendance: nextStat };
        }
      });

      if (totalPeriodsCleared > 0) {
        await batch.commit();
        if (typeof onStudentsUpdated === 'function') {
          onStudentsUpdated(localStudents.map(s => updatedMap[s.regNo] || s));
        }
        alert(`🎉 Auto-cleared ${totalPeriodsCleared} absent period(s) using Event Leader rehearsal timestamps!`);
        handleFetchStudentForClearance(clearAdNo);
      } else {
        alert('ℹ️ No matching absent dates found with unapplied rehearsal attendance.');
      }
    } catch (err) {
      alert('Error applying rehearsal credits: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // ==========================================
  // 2. SAVE & APPLY OFFICIAL ATTENDANCE CLEARANCE
  // ==========================================
  const handleSaveClearance = async e => {
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

      const studentStatsDraft = {};
      fetchedClearStudentsList.forEach(st => {
        studentStatsDraft[st.regNo] = JSON.parse(JSON.stringify(getStudentAttStat(st)));
        if (!studentStatsDraft[st.regNo].subjectWise) studentStatsDraft[st.regNo].subjectWise = {};
      });

      const selectedPeriodObjs = fetchedAbsentPeriodSessions.filter(p =>
        selectedClearSessionIds.includes(p.sessionDocId)
      );
      const sessionDocUpdates = [];

      const sessionSnaps = await Promise.all(
        selectedPeriodObjs.map(pItem => getDoc(doc(db, 'systemCache', pItem.sessionDocId)))
      );

      for (let idx = 0; idx < selectedPeriodObjs.length; idx++) {
        const pItem = selectedPeriodObjs[idx];
        const sRef = doc(db, 'systemCache', pItem.sessionDocId);
        const sSnap = sessionSnaps[idx];
        const sData = sSnap.exists() ? sSnap.data() : null;
        const attMap = sData?.attendanceMap ? { ...sData.attendanceMap } : {};

        pItem.absentStudentRegs.forEach(regNo => {
          const curStat = studentStatsDraft[regNo];
          if (!curStat) return;

          const subKey = normalizeSubKey(pItem.subject);
          if (!curStat.subjectWise[subKey]) {
            curStat.subjectWise[subKey] = {
              total: 1,
              present: 0,
              official: 0,
              medical: 0,
              permitted: 0,
              absentDates: [],
              medicalDates: []
            };
          }
          const subObj = curStat.subjectWise[subKey];
          if (!Array.isArray(subObj.absentDates)) subObj.absentDates = [];
          if (!Array.isArray(subObj.medicalDates)) subObj.medicalDates = [];

          const dateIdx = subObj.absentDates.indexOf(pItem.date);
          if (dateIdx !== -1) subObj.absentDates.splice(dateIdx, 1);

          if (isMedical) {
            attMap[regNo] = 'M';
            curStat.medicalCount = (curStat.medicalCount || 0) + 1;
            subObj.medical = (subObj.medical || 0) + 1;
            if (!subObj.medicalDates.includes(pItem.date)) {
              subObj.medicalDates.push(pItem.date);
            }
          } else {
            attMap[regNo] = 'O';
            curStat.presentCount = Math.min(curStat.totalPeriods || 9999, (curStat.presentCount || 0) + 1);
            curStat.officialCount = (curStat.officialCount || 0) + 1;
            subObj.official = (subObj.official || 0) + 1;
            subObj.present = Math.min(subObj.total || 9999, (subObj.present || 0) + 1);
          }
        });

        if (sData) {
          sessionDocUpdates.push({ date: pItem.date, sessionDocId: pItem.sessionDocId, sRef, attMap });
        }
      }

      const nowIso = new Date().toISOString();
      const targetDates = (
        clearDateMode === 'single' ? [clearDate] : getDatesBetween(clearStartDate, clearEndDate)
      ).slice(0, 60);
      const newHistoryRecords = [];

      fetchedClearStudentsList.forEach(student => {
        const studentAbsencesForThisUser = selectedPeriodObjs.filter(p =>
          p.absentStudentRegs.includes(student.regNo)
        );
        const totalPeriodsForStudent =
          studentAbsencesForThisUser.length ||
          clearSelectedSubjects.length ||
          selectedPeriodObjs.length ||
          1;

        const certNumber = `DHIU/CLR/${new Date().getFullYear()}/${
          student.adNo || student.regNo
        }/${Math.floor(1000 + Math.random() * 9000)}`;
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
          remarks:
            clearanceRemarks ||
            (isMedical
              ? `Excused Medical Leave granted by ${loggedInUser?.fullName || 'Central Admin'}`
              : `Official duty cleared by ${loggedInUser?.fullName || 'Central Admin'}`),
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

        const curStat = studentStatsDraft[student.regNo];
        if (curStat) {
          curStat.clearanceCertificates = [
            histObj,
            ...(Array.isArray(curStat.clearanceCertificates) ? curStat.clearanceCertificates : []).slice(0, 20)
          ];
        }
      });

      const writeOperations = [];

      sessionDocUpdates.forEach(({ sRef, attMap }) => {
        writeOperations.push(b =>
          b.set(sRef, { attendanceMap: attMap, updatedAt: new Date().toISOString() }, { merge: true })
        );
      });

      fetchedClearStudentsList.forEach(student => {
        const docId = String(student.id || student.regNo || '').trim();
        const finalStat = studentStatsDraft[student.regNo];
        writeOperations.push(b =>
          b.set(doc(db, 'students', docId), { periodAttendance: finalStat }, { merge: true })
        );
        updatedMap[student.regNo] = { ...student, periodAttendance: finalStat };
      });

      newHistoryRecords.forEach(histObj => {
        writeOperations.push(b => b.set(doc(db, 'clearance_history', histObj.id), histObj));
        writeOperations.push(b =>
          b.set(doc(db, 'clearance_certificates', histObj.id), {
            ...histObj,
            regNo: histObj.studentRegNo,
            adNo: histObj.studentAdNo,
            status: 'ISSUED',
            dates: histObj.dates.slice(0, 50)
          })
        );
      });

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
      setFetchedAbsentPeriodSessions(prev =>
        prev.filter(p => !selectedClearSessionIds.includes(p.sessionDocId))
      );
      setSelectedClearSessionIds([]);

      if (newHistoryRecords.length > 0) {
        setActiveCertToPrint(newHistoryRecords[0]);
      }

      alert(
        isMedical
          ? `✅ Recorded MEDICAL LEAVE for ${fetchedClearStudentsList.length} student(s) across ${selectedPeriodObjs.length} period(s)!`
          : `✅ Cleared attendance as OFFICIAL DUTY for ${fetchedClearStudentsList.length} student(s) across ${selectedPeriodObjs.length} period(s)!`
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
        status: 'VERIFIED',
        verifiedBy: verifierUsername,
        verifiedByName: verifierName,
        verifiedAt: nowIso,
        verificationNotes: customNotes.trim() || 'Formally verified and approved by Central Admin.'
      };

      await Promise.all([
        setDoc(doc(db, 'clearance_history', histItem.id), verifiedUpdate, { merge: true }).catch(() => {}),
        setDoc(doc(db, 'clearance_certificates', histItem.id), verifiedUpdate, { merge: true }).catch(() => {})
      ]);

      // Also update inside student's clearanceCertificates array so it persists everywhere
      const targetSt = localStudents.find(
        s =>
          String(s.regNo) === String(histItem.studentRegNo) ||
          String(s.adNo) === String(histItem.studentAdNo)
      );
      if (targetSt) {
        const curStat = JSON.parse(JSON.stringify(getStudentAttStat(targetSt)));
        if (Array.isArray(curStat.clearanceCertificates)) {
          curStat.clearanceCertificates = curStat.clearanceCertificates.map(c =>
            c.id === histItem.id || c.certNumber === histItem.certNumber
              ? { ...c, ...verifiedUpdate }
              : c
          );
          await setDoc(
            doc(db, 'students', String(targetSt.id || targetSt.regNo)),
            { periodAttendance: curStat },
            { merge: true }
          );
        }
      }

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

  const handleExportHistoryExcel = () => {
    if (filteredClearanceHistory.length === 0) return alert('No clearance records to export.');
    const rows = filteredClearanceHistory.map((item, idx) => ({
      '#': idx + 1,
      'Certificate Ref': item.certNumber || item.id,
      'Issue Date': String(item.issuedAt || '').split('T')[0],
      'Student Name': item.studentName,
      'Admission No': item.studentAdNo,
      'Class': Array.isArray(item.studentClasses)
        ? item.studentClasses.join(', ')
        : item.studentClasses,
      'Clearance Type':
        item.clearanceType === 'MEDICAL_LEAVE' ? 'Medical Leave' : 'Official Leave (Present)',
      'Total Periods Cleared': item.totalPeriodsCleared || 0,
      'Target Dates': (item.dates || []).join(', '),
      'Issued By': `${item.issuedByName} (@${item.issuedByUsername})`,
      'Verification Status':
        item.verificationStatus === 'VERIFIED' ? 'Verified' : 'Pending Verification',
      'Remarks': item.remarks || '-'
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Absence Clearances');
    XLSX.writeFile(
      wb,
      `DHIU_Absence_Clearance_History_${new Date().toISOString().split('T')[0]}.xlsx`
    );
  };

  // ==========================================
  // 4. ULTRA-FAST PARALLEL INSPECT & EDIT STUDENT SESSIONS
  // ==========================================
  const handleLoadInspectStudent = async targetQuery => {
    const rawQ = String(targetQuery !== undefined ? targetQuery : inspectAdNo || inspectSearchText)
      .replace(/^#/, '')
      .trim();
    if (!rawQ) return alert('Please select a student from the class/search list or enter their Admission Number.');

    const upQ = rawQ.toUpperCase();
    const lowQ = rawQ.toLowerCase();

    let foundSt = localStudents.find(
      s =>
        String(s.adNo || '').trim().toUpperCase() === upQ ||
        String(s.regNo || '').trim().toUpperCase() === upQ
    );
    if (!foundSt && /^\d+$/.test(upQ)) {
      foundSt = localStudents.find(s => String(s.adNo || '').trim().toUpperCase() === 'U' + upQ);
    }
    if (!foundSt) {
      foundSt =
        localStudents.find(s => String(s.firstName || '').trim().toLowerCase() === lowQ) ||
        localStudents.find(s => String(s.firstName || '').trim().toLowerCase().includes(lowQ));
    }

    if (!foundSt) return alert(`No student found matching "${rawQ}".`);

    setInspectStudent(foundSt);
    setInspectAdNo(foundSt.adNo);
    setFetchingInspect(true);
    setInspectSessionsList([]);

    try {
      const dates = getDatesBetween(inspectDateStart, inspectDateEnd);

      // Parallel fetch of all daySessionsIndex_{date} docs at once!
      const indexSnaps = await Promise.all(
        dates.map(dStr => getDoc(doc(db, 'systemCache', `daySessionsIndex_${dStr}`)))
      );

      const resolvedSessions = [];
      const missingMapItems = [];

      indexSnaps.forEach((idxSnap, idx) => {
        if (!idxSnap.exists()) return;
        const dStr = dates[idx];
        const sessList = idxSnap.data().sessions || [];
        sessList.forEach(item => {
          if (item.attendanceMap && typeof item.attendanceMap === 'object') {
            resolvedSessions.push({ ...item, date: dStr });
          } else if (item.sessionDocId) {
            missingMapItems.push({ ...item, date: dStr });
          }
        });
      });

      if (missingMapItems.length > 0) {
        const fetchedSnaps = await Promise.all(
          missingMapItems.map(item => getDoc(doc(db, 'systemCache', item.sessionDocId)))
        );
        fetchedSnaps.forEach((sSnap, i) => {
          if (sSnap.exists()) {
            resolvedSessions.push({
              ...missingMapItems[i],
              ...sSnap.data(),
              sessionDocId: missingMapItems[i].sessionDocId,
              date: missingMapItems[i].date
            });
          }
        });
      }

      const list = [];
      const sReg = String(foundSt.regNo || '').trim();
      const sId = String(foundSt.id || '').trim();
      const sAd = String(foundSt.adNo || '').trim().toUpperCase();

      resolvedSessions.forEach(sData => {
        const attMap = sData.attendanceMap || {};
        const status = attMap[sReg] || attMap[sId] || attMap[sAd] || attMap[foundSt.adNo];
        if (!status) return; // Only include sessions where this student was enrolled/recorded!

        if (inspectFilterStatus === 'MEDICAL' && status !== 'M') return;
        if (inspectFilterStatus === 'OFFICIAL' && status !== 'O') return;
        if (inspectFilterStatus === 'CLEARED' && status !== 'O' && status !== 'M') return;
        if (inspectFilterStatus === 'ABSENT' && status !== 'A') return;

        let displayStatus = 'PRESENT';
        if (status === 'M') displayStatus = 'MEDICAL_LEAVE';
        else if (status === 'O') displayStatus = 'OFFICIAL_PRESENT';
        else if (status === 'L') displayStatus = 'PERMITTED_LEAVE';
        else if (status === 'A') displayStatus = 'ABSENT';

        list.push({
          sessionDocId: sData.sessionDocId || sData.id,
          date: sData.date,
          session: Number(sData.session || 1),
          subject: normalizeSubKey(sData.subject || sData.classAlias || ''),
          classAlias: sData.classAlias || sData.subject || '',
          teacherName: sData.teacherName || 'Faculty',
          rawStatus: status,
          displayStatus
        });
      });

      list.sort((a, b) => b.date.localeCompare(a.date) || a.session - b.session);
      setInspectSessionsList(list);
    } catch (err) {
      console.error('Error inspecting student sessions:', err);
      alert('Error inspecting sessions: ' + err.message);
    } finally {
      setFetchingInspect(false);
    }
  };

  const handleChangeInspectSessionStatus = async (sessionItem, newStatus) => {
    if (!inspectStudent || sessionItem.rawStatus === newStatus) return;
    setLoading(true);
    try {
      const sRef = doc(db, 'systemCache', sessionItem.sessionDocId);
      const sSnap = await getDoc(sRef);
      if (sSnap.exists()) {
        const attMap = { ...(sSnap.data().attendanceMap || {}) };
        attMap[inspectStudent.regNo] = newStatus;
        await setDoc(sRef, { attendanceMap: attMap, updatedAt: new Date().toISOString() }, { merge: true });
      }

      // Also update daySessionsIndex_{date} so future reads are instant
      const idxRef = doc(db, 'systemCache', `daySessionsIndex_${sessionItem.date}`);
      const idxSnap = await getDoc(idxRef);
      if (idxSnap.exists()) {
        const list = (idxSnap.data().sessions || []).map(s => {
          if (s.sessionDocId === sessionItem.sessionDocId && s.attendanceMap) {
            return { ...s, attendanceMap: { ...s.attendanceMap, [inspectStudent.regNo]: newStatus } };
          }
          return s;
        });
        await setDoc(idxRef, { sessions: list }, { merge: true });
      }

      const stDocId = String(inspectStudent.id || inspectStudent.regNo);
      const curStat = JSON.parse(JSON.stringify(getStudentAttStat(inspectStudent)));
      const subKey = normalizeSubKey(sessionItem.subject);

      if (curStat.subjectWise && curStat.subjectWise[subKey]) {
        const subObj = curStat.subjectWise[subKey];
        const prev = sessionItem.rawStatus;
        if (!Array.isArray(subObj.absentDates)) subObj.absentDates = [];

        if (prev === 'P' || prev === 'O') {
          curStat.presentCount = Math.max(0, (curStat.presentCount || 0) - 1);
          subObj.present = Math.max(0, (subObj.present || 0) - 1);
        }
        if (prev === 'O') {
          curStat.officialCount = Math.max(0, (curStat.officialCount || 0) - 1);
          subObj.official = Math.max(0, (subObj.official || 0) - 1);
        } else if (prev === 'M') {
          curStat.medicalCount = Math.max(0, (curStat.medicalCount || 0) - 1);
          subObj.medical = Math.max(0, (subObj.medical || 0) - 1);
        } else if (prev === 'A') {
          subObj.absentDates = subObj.absentDates.filter(d => d !== sessionItem.date);
        }

        if (newStatus === 'P' || newStatus === 'O') {
          curStat.presentCount = Math.min(curStat.totalPeriods || 9999, (curStat.presentCount || 0) + 1);
          subObj.present = Math.min(subObj.total || 9999, (subObj.present || 0) + 1);
        }
        if (newStatus === 'O') {
          curStat.officialCount = (curStat.officialCount || 0) + 1;
          subObj.official = (subObj.official || 0) + 1;
        } else if (newStatus === 'M') {
          curStat.medicalCount = (curStat.medicalCount || 0) + 1;
          subObj.medical = (subObj.medical || 0) + 1;
        } else if (newStatus === 'A') {
          if (!subObj.absentDates.includes(sessionItem.date)) subObj.absentDates.push(sessionItem.date);
        }
      }

      await setDoc(doc(db, 'students', stDocId), { periodAttendance: curStat }, { merge: true });

      const updatedSt = { ...inspectStudent, periodAttendance: curStat };
      setInspectStudent(updatedSt);
      setInspectSessionsList(prev =>
        prev.map(item =>
          item.sessionDocId === sessionItem.sessionDocId
            ? { ...item, rawStatus: newStatus }
            : item
        )
      );
      if (typeof onStudentsUpdated === 'function') {
        onStudentsUpdated(localStudents.map(s => (s.regNo === updatedSt.regNo ? updatedSt : s)));
      }
    } catch (err) {
      alert('Error updating session status: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // ==========================================
  // 5. HIGH-SECURITY SCOPED ATTENDANCE DELETE (Period + Night + Extra Only)
  // ==========================================
  const expectedDeletePhrase =
    delDateScope === 'ALL_DATES'
      ? delClassScope === 'ALL'
        ? 'DELETE ALL'
        : `DELETE ${delClassScope}`
      : delClassScope === 'ALL'
      ? 'DELETE RANGE'
      : `DELETE ${delClassScope}`;

  const handleExecuteScopedAttendanceDelete = async () => {
    if (!delSafetyChecked) {
      return alert('⚠️ Please check the safety confirmation checkbox first.');
    }
    if (!delIncludePeriod && !delIncludeNight && !delIncludeExtra) {
      return alert('⚠️ Please select at least one attendance type (Period, Night, or Extra) to delete.');
    }
    if (delConfirmPhrase.trim().toUpperCase() !== expectedDeletePhrase.toUpperCase()) {
      return alert(`⚠️ Exact confirmation phrase required! Please type: ${expectedDeletePhrase}`);
    }
    if (!delPassword.trim()) {
      return alert('⚠️ Please enter your Admin account password to authorize this deletion.');
    }

    const scopeSummary = `${
      delClassScope === 'ALL' ? 'ALL CLASSES' : `CLASS ${delClassScope} ONLY`
    } for ${
      delDateScope === 'ALL_DATES'
        ? 'ALL DATES (ENTIRE SEMESTER)'
        : `DATE RANGE ${delStartDate} to ${delEndDate}`
    }`;

    if (
      !window.confirm(
        `🚨 HIGH-RISK ADMIN CONFIRMATION:\n\nYou are about to permanently delete [${[
          delIncludePeriod ? 'Period Attendance' : null,
          delIncludeNight ? 'Night Attendance' : null,
          delIncludeExtra ? 'Extra Attendance' : null
        ]
          .filter(Boolean)
          .join(', ')}] for ${scopeSummary}.\n\nStudent profiles, CCE marks, and other ERP data will NOT be touched.\n\nAre you 100% sure you want to proceed?`
      )
    ) {
      return;
    }

    setDeletingAttendance(true);
    try {
      // Verify Admin password with Firebase Auth if logged in via email
      if (auth?.currentUser?.email) {
        try {
          const cred = EmailAuthProvider.credential(auth.currentUser.email, delPassword.trim());
          await reauthenticateWithCredential(auth.currentUser, cred);
        } catch (authErr) {
          setDeletingAttendance(false);
          return alert('⛔ Incorrect Admin Password! Attendance deletion aborted.');
        }
      }

      const targetStudents = localStudents.filter(st => {
        if (delClassScope === 'ALL') return true;
        const stCls = Array.isArray(st.classes) ? st.classes : [st.class];
        return stCls.includes(delClassScope);
      });
      const targetRegSet = new Set(
        targetStudents.flatMap(s => [
          String(s.regNo || '').trim(),
          String(s.id || '').trim(),
          String(s.adNo || '').trim().toUpperCase()
        ]).filter(Boolean)
      );

      const datesInScope =
        delDateScope === 'DATE_RANGE' ? getDatesBetween(delStartDate, delEndDate) : [];
      const datesInScopeSet = new Set(datesInScope);

      // 1. DELETE / UPDATE PERIOD ATTENDANCE
      if (delIncludePeriod) {
        if (delDateScope === 'ALL_DATES') {
          const updatedMap = {};
          for (let i = 0; i < targetStudents.length; i += 350) {
            const chunk = targetStudents.slice(i, i + 350);
            const batch = writeBatch(db);
            chunk.forEach(st => {
              const docId = String(st.id || st.regNo || '').trim();
              const emptyStat = {
                totalPeriods: 0,
                presentCount: 0,
                officialCount: 0,
                medicalCount: 0,
                permittedCount: 0,
                minusCount: 0,
                minusLogs: [],
                subjectWise: {},
                updatedAt: new Date().toISOString()
              };
              batch.set(doc(db, 'students', docId), { periodAttendance: emptyStat }, { merge: true });
              updatedMap[st.regNo] = { ...st, periodAttendance: emptyStat };
            });
            await batch.commit();
          }
          if (typeof onStudentsUpdated === 'function') {
            onStudentsUpdated(localStudents.map(s => updatedMap[s.regNo] || s));
          }
        } else {
          // Date-Range Period Attendance Delete
          const studentDeltas = {}; // regNo -> { total: 0, pres: 0, off: 0, med: 0, subDeltas: {} }
          targetStudents.forEach(st => {
            studentDeltas[st.regNo] = { total: 0, pres: 0, off: 0, med: 0, subDeltas: {} };
          });

          for (const dStr of datesInScope) {
            const idxRef = doc(db, 'systemCache', `daySessionsIndex_${dStr}`);
            const idxSnap = await getDoc(idxRef);
            if (!idxSnap.exists()) continue;
            const sessList = idxSnap.data().sessions || [];
            const remainingSessions = [];

            for (const item of sessList) {
              const sRef = doc(db, 'systemCache', item.sessionDocId);
              const sSnap = await getDoc(sRef);
              const sData = sSnap.exists() ? sSnap.data() : item;
              const attMap = { ...(sData.attendanceMap || {}) };
              const subKey = normalizeSubKey(sData.subject || item.subject || '');

              targetStudents.forEach(st => {
                const reg = st.regNo;
                const val = attMap[reg] || attMap[st.id] || attMap[st.adNo];
                if (!val) return;

                const dObj = studentDeltas[reg];
                dObj.total += 1;
                if (val === 'P' || val === 'O') dObj.pres += 1;
                if (val === 'O') dObj.off += 1;
                if (val === 'M') dObj.med += 1;

                if (!dObj.subDeltas[subKey]) {
                  dObj.subDeltas[subKey] = { total: 0, pres: 0, off: 0, med: 0, dates: [] };
                }
                dObj.subDeltas[subKey].total += 1;
                if (val === 'P' || val === 'O') dObj.subDeltas[subKey].pres += 1;
                if (val === 'O') dObj.subDeltas[subKey].off += 1;
                if (val === 'M') dObj.subDeltas[subKey].med += 1;
                dObj.subDeltas[subKey].dates.push(dStr);

                delete attMap[reg];
                delete attMap[st.id];
                delete attMap[st.adNo];
              });

              if (delClassScope === 'ALL' || Object.keys(attMap).length === 0) {
                await deleteDoc(sRef).catch(() => {});
              } else {
                await setDoc(sRef, { attendanceMap: attMap }, { merge: true });
                remainingSessions.push({ ...item, attendanceMap: attMap });
              }
            }

            if (delClassScope === 'ALL' || remainingSessions.length === 0) {
              await deleteDoc(idxRef).catch(() => {});
            } else {
              await setDoc(idxRef, { sessions: remainingSessions }, { merge: true });
            }
          }

          // Subtract deleted period counts from targetStudents
          const updatedMap = {};
          for (let i = 0; i < targetStudents.length; i += 350) {
            const chunk = targetStudents.slice(i, i + 350);
            const batch = writeBatch(db);
            chunk.forEach(st => {
              const dObj = studentDeltas[st.regNo];
              const curStat = JSON.parse(JSON.stringify(getStudentAttStat(st)));
              curStat.totalPeriods = Math.max(0, (curStat.totalPeriods || 0) - (dObj?.total || 0));
              curStat.presentCount = Math.max(0, (curStat.presentCount || 0) - (dObj?.pres || 0));
              curStat.officialCount = Math.max(0, (curStat.officialCount || 0) - (dObj?.off || 0));
              curStat.medicalCount = Math.max(0, (curStat.medicalCount || 0) - (dObj?.med || 0));

              curStat.minusLogs = (curStat.minusLogs || []).filter(
                l => !datesInScopeSet.has(String(l.date || '').slice(0, 10))
              );
              curStat.minusCount = curStat.minusLogs.reduce(
                (acc, l) => acc + (Number(l.count) || 0),
                0
              );

              if (curStat.subjectWise) {
                Object.keys(curStat.subjectWise).forEach(k => {
                  const sNorm = normalizeSubKey(k);
                  const sd = dObj?.subDeltas[sNorm];
                  const swItem = curStat.subjectWise[k];
                  if (sd && swItem) {
                    swItem.total = Math.max(0, (swItem.total || 0) - sd.total);
                    swItem.present = Math.max(0, (swItem.present || 0) - sd.pres);
                    swItem.official = Math.max(0, (swItem.official || 0) - sd.off);
                    swItem.medical = Math.max(0, (swItem.medical || 0) - sd.med);
                  }
                  if (Array.isArray(swItem?.absentDates)) {
                    swItem.absentDates = swItem.absentDates.filter(d => !datesInScopeSet.has(d));
                  }
                });
              }

              const docId = String(st.id || st.regNo || '').trim();
              batch.set(doc(db, 'students', docId), { periodAttendance: curStat }, { merge: true });
              updatedMap[st.regNo] = { ...st, periodAttendance: curStat };
            });
            await batch.commit();
          }

          if (typeof onStudentsUpdated === 'function') {
            onStudentsUpdated(localStudents.map(s => updatedMap[s.regNo] || s));
          }
        }
      }

      // 2. DELETE NIGHT ATTENDANCE IN SCOPE
      if (delIncludeNight) {
        const naSnap = await getDocs(collection(db, 'night_attendance')).catch(() => null);
        if (naSnap) {
          for (const dDoc of naSnap.docs) {
            const dStr = dDoc.id;
            if (delDateScope === 'DATE_RANGE' && !datesInScopeSet.has(dStr)) continue;
            if (delClassScope === 'ALL') {
              await deleteDoc(doc(db, 'night_attendance', dStr)).catch(() => {});
            } else {
              const data = dDoc.data() || {};
              const classesMap = { ...(data.classes || {}) };
              const preMap = { ...(data.preRecordedAbsences || {}) };
              delete classesMap[delClassScope];
              delete preMap[delClassScope];
              await setDoc(
                doc(db, 'night_attendance', dStr),
                { classes: classesMap, preRecordedAbsences: preMap },
                { merge: true }
              );
            }
          }
        }
      }

      // 3. DELETE EXTRA ATTENDANCE IN SCOPE
      if (delIncludeExtra) {
        const exSnap = await getDocs(collection(db, 'night_extra_attendance')).catch(() => null);
        if (exSnap) {
          for (const eDoc of exSnap.docs) {
            const eData = eDoc.data() || {};
            if (delDateScope === 'DATE_RANGE' && !datesInScopeSet.has(eData.date)) continue;
            if (delClassScope !== 'ALL' && eData.className !== delClassScope) continue;
            await deleteDoc(doc(db, 'night_extra_attendance', eDoc.id)).catch(() => {});
          }
        }
      }

      setDelPassword('');
      setDelConfirmPhrase('');
      setDelSafetyChecked(false);
      alert(`✅ Successfully deleted selected attendance records for ${scopeSummary}!`);
    } catch (err) {
      console.error('Error deleting attendance:', err);
      alert('Error deleting attendance: ' + err.message);
    } finally {
      setDeletingAttendance(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* PRINTABLE CERTIFICATE MODAL */}
      {activeCertToPrint && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2500, padding: '16px' }}>
          <div style={{ background: '#ffffff', padding: '32px', borderRadius: '16px', maxWidth: '740px', width: '100%', color: '#0f172a', maxHeight: '92vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #0f172a', paddingBottom: '14px', marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <img src={DHIU_LOGO_URL} alt="DHIU" style={{ width: '56px', height: '56px', objectFit: 'contain' }} />
                <div>
                  <h3 style={{ margin: 0, fontSize: '20px', fontWeight: '900' }}>DARUL HUDA ISLAMIC UNIVERSITY</h3>
                  <div style={{ fontSize: '13px', fontWeight: '800', color: activeCertToPrint.clearanceType === 'MEDICAL_LEAVE' ? '#d97706' : '#059669' }}>
                    {activeCertToPrint.clearanceType === 'MEDICAL_LEAVE'
                      ? '🏥 Official Medical Leave Certificate (Excused)'
                      : '🎟️ Official Attendance Clearance Certificate (Present)'}
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
              <div><strong>Issued Date:</strong> {String(activeCertToPrint.issuedAt || '').split('T')[0]}</div>
              <div><strong>Student Name:</strong> <strong>{activeCertToPrint.studentName}</strong></div>
              <div><strong>Admission No:</strong> #{activeCertToPrint.studentAdNo || activeCertToPrint.adNo}</div>
              <div><strong>Class Batch:</strong> {Array.isArray(activeCertToPrint.studentClasses) ? activeCertToPrint.studentClasses.join(', ') : ''}</div>
              <div><strong>Total Periods Cleared:</strong> {activeCertToPrint.totalPeriodsCleared || 1}</div>
            </div>

            <div style={{ border: '1px solid #cbd5e1', borderRadius: '10px', padding: '16px', marginBottom: '20px', fontSize: '13px' }}>
              <strong>Official Approval &amp; Authority Statement:</strong>
              <p style={{ margin: '6px 0 0', fontStyle: 'italic' }}>&ldquo;{activeCertToPrint.remarks}&rdquo;</p>
            </div>

            <div className="no-print" style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button type="button" onClick={() => window.print()} style={styles.buttonPrimary}>
                🖨️ Print Certificate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADMIN VERIFICATION MODAL */}
      {verifyingHistoryItem && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2600, padding: '16px' }}>
          <div style={{ background: '#ffffff', padding: '28px', borderRadius: '16px', maxWidth: '520px', width: '100%' }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '18px', fontWeight: '800' }}>✅ Verify Attendance Clearance</h3>
            <p style={{ fontSize: '13px', color: '#475569', marginBottom: '16px' }}>
              Verify clearance issued for <strong>{verifyingHistoryItem.studentName}</strong> (#{verifyingHistoryItem.studentAdNo}) covering {verifyingHistoryItem.totalPeriodsCleared} period(s).
            </p>
            <div style={{ marginBottom: '16px' }}>
              <label style={styles.label}>Admin Verification Notes (Optional):</label>
              <textarea
                rows={3}
                value={verifyNotesInput}
                onChange={e => setVerifyNotesInput(e.target.value)}
                placeholder="e.g. Medical certificate / official letter verified..."
                style={{ ...styles.input, width: '100%' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button type="button" onClick={() => setVerifyingHistoryItem(null)} style={styles.buttonSecondary}>Cancel</button>
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

      {/* SESSION INSPECTION MODAL FOR HISTORY ROW */}
      {inspectingHistoryItem && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2600, padding: '16px' }}>
          <div style={{ background: '#ffffff', padding: '28px', borderRadius: '16px', maxWidth: '640px', width: '100%', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '17px', fontWeight: '800' }}>
                📋 Cleared Sessions: #{inspectingHistoryItem.studentAdNo} ({inspectingHistoryItem.studentName})
              </h3>
              <button onClick={() => setInspectingHistoryItem(null)} style={{ background: '#fee2e2', color: '#dc2626', border: 'none', padding: '6px 10px', borderRadius: '6px', fontWeight: '800', cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ marginBottom: '14px', fontSize: '13px', background: '#f8fafc', padding: '12px', borderRadius: '8px' }}>
              <div><strong>Clearance Type:</strong> {inspectingHistoryItem.clearanceTypeLabel}</div>
              <div><strong>Dates:</strong> {(inspectingHistoryItem.dates || []).join(', ')}</div>
              <div><strong>Remarks:</strong> {inspectingHistoryItem.remarks}</div>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #cbd5e1' }}>
                  <th style={{ padding: '8px 10px' }}>Date</th>
                  <th style={{ padding: '8px 10px' }}>Period</th>
                  <th style={{ padding: '8px 10px' }}>Subject</th>
                  <th style={{ padding: '8px 10px' }}>Faculty</th>
                </tr>
              </thead>
              <tbody>
                {(inspectingHistoryItem.clearedSessions || []).map((s, sIdx) => (
                  <tr key={sIdx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '8px 10px', fontWeight: '700' }}>{s.date}</td>
                    <td style={{ padding: '8px 10px' }}>Period {s.session}</td>
                    <td style={{ padding: '8px 10px', fontWeight: '700', color: '#4f46e5' }}>{s.subject}</td>
                    <td style={{ padding: '8px 10px', color: '#64748b' }}>{s.teacherName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TOP NAVIGATION HEADER & SUB-TABS */}
      <div style={{ background: '#ffffff', padding: '18px 24px', borderRadius: '14px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
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
            Filter students by Class or Name/Ad.No, issue Medical or Official clearances, verify clearance history, and inspect sessions instantaneously.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', background: '#f1f5f9', padding: '4px', borderRadius: '10px', flexWrap: 'wrap' }}>
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
                color: clearanceSubTab === tab.id ? '#ffffff' : '#475569'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ============================================================
          VIEW 1: ISSUE NEW CLEARANCE (With Filters Before Search!)
         ============================================================ */}
      {clearanceSubTab === 'issue' && (
        <div style={styles.card}>
          <form onSubmit={handleSaveClearance}>
            <div style={{ background: '#f8fafc', padding: '18px', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '18px' }}>
              <label style={{ ...styles.label, fontSize: '14px', fontWeight: '800', color: '#0f172a', marginBottom: '12px' }}>
                Step 1: Filter by Class / Search Student Name or Ad.No &amp; Select Dates
              </label>

              {/* 🌟 FILTERS BEFORE SEARCH: 1. CLASS FILTER | 2. STUDENT DROPDOWN | 3. NAME/AD.NO SEARCH */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '10px', marginBottom: '12px', background: '#ffffff', padding: '12px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                <div>
                  <label style={styles.label}>1. Filter by Class</label>
                  <select
                    value={issueClassFilter}
                    onChange={e => setIssueClassFilter(e.target.value)}
                    style={{ ...styles.input, fontWeight: '700' }}
                  >
                    <option value="ALL">All Classes ({localStudents.length})</option>
                    {DEFAULT_CLASSES.map(c => (
                      <option key={c} value={c}>Class {c}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={styles.label}>2. Select Student from Class ({issueFilteredStudents.length})</label>
                  <select
                    value=""
                    onChange={e => {
                      const chosen = localStudents.find(s => s.adNo === e.target.value || s.regNo === e.target.value);
                      if (chosen) addStudentToClearanceInput(chosen);
                    }}
                    style={{ ...styles.input, fontWeight: '700' }}
                  >
                    <option value="">-- Click to Add Student --</option>
                    {issueFilteredStudents.map(st => (
                      <option key={st.regNo} value={st.adNo}>
                        {st.firstName} (#{st.adNo} • {(st.classes || []).join(',')})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={styles.label}>3. Search by Student Name or Ad.No</label>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <input
                      type="text"
                      value={issueStudentSearch}
                      onChange={e => setIssueStudentSearch(e.target.value)}
                      placeholder="Type Name or Ad.No..."
                      style={{ ...styles.input, flex: 1 }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (issueFilteredStudents.length > 0) {
                          addStudentToClearanceInput(issueFilteredStudents[0]);
                          setIssueStudentSearch('');
                        } else {
                          alert('No matching student found.');
                        }
                      }}
                      style={{ ...styles.buttonSecondary, whiteSpace: 'nowrap', padding: '8px 12px' }}
                    >
                      ➕ Add
                    </button>
                  </div>
                </div>
              </div>

              {/* QUICK MATCH PILLS WHEN TYPING IN SEARCH BOX */}
              {issueStudentSearch.trim().length > 0 && issueFilteredStudents.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
                  {issueFilteredStudents.slice(0, 8).map(st => (
                    <button
                      key={st.regNo}
                      type="button"
                      onClick={() => {
                        addStudentToClearanceInput(st);
                        setIssueStudentSearch('');
                      }}
                      style={{ padding: '5px 10px', borderRadius: '999px', background: '#eef2ff', color: '#4f46e5', border: '1px solid #c7d2fe', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}
                    >
                      + {st.firstName} (#{st.adNo} • {(st.classes || []).join(',')})
                    </button>
                  ))}
                </div>
              )}

              {/* TARGET ADMISSION NUMBERS / NAMES INPUT + FIND ABSENCES BUTTON */}
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '12px' }}>
                <input
                  type="text"
                  value={clearAdNo}
                  onChange={e => setClearAdNo(e.target.value)}
                  placeholder="Selected Ad.Nos or Student Names (e.g. 3551, 3527, U1107)..."
                  style={{ ...styles.input, flex: '1 1 300px', fontWeight: '700' }}
                />
                {clearAdNo && (
                  <button
                    type="button"
                    onClick={() => {
                      setClearAdNo('');
                      setFetchedClearStudentsList([]);
                      setFetchedAbsentPeriodSessions([]);
                    }}
                    style={styles.buttonSecondary}
                  >
                    ✕ Clear
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleFetchStudentForClearance(clearAdNo)}
                  disabled={fetchingClearance}
                  style={{ ...styles.buttonPrimary, whiteSpace: 'nowrap', padding: '10px 20px' }}
                >
                  {fetchingClearance ? '⏳ Searching Absences...' : '🔍 Find Absences'}
                </button>
              </div>

              {/* DATE SCOPE CONTROLS */}
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

          {/* FETCHED STUDENTS CHIPS + REHEARSAL AUTO-CLEAR BUTTON */}
            {fetchedClearStudentsList.length > 0 && (
              <div style={{ marginBottom: '18px', padding: '14px', background: '#ecfdf5', borderRadius: '10px', border: '1px solid #a7f3d0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: '800', color: '#065f46', marginBottom: '6px' }}>
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
                <button
                  type="button"
                  onClick={handleAutoClearRehearsalAbsences}
                  disabled={loading}
                  style={{ ...styles.buttonPrimary, background: '#059669', padding: '8px 14px', fontSize: '12px', fontWeight: '800' }}
                >
                  🎭 Auto-Apply Rehearsal Credits
                </button>
              </div>
            )}

            {/* STEP 2: CANDIDATE ABSENT PERIODS */}
            {fetchedClearStudentsList.length > 0 && (
              <div style={{ marginBottom: '18px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
                  <div>
                    <label style={{ ...styles.label, fontSize: '15px', fontWeight: '900', color: '#0f172a', marginBottom: '2px' }}>
                      Step 2: Candidate Absent Periods ({fetchedAbsentPeriodSessions.length} Found)
                    </label>
                  </div>

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
                  )}
                </div>

                {fetchingClearance ? (
                  <div style={{ padding: '28px', textAlign: 'center', color: '#64748b', background: '#f8fafc', borderRadius: '12px' }}>
                    ⏳ Scanning attendance sessions for absences...
                  </div>
                ) : fetchedAbsentPeriodSessions.length === 0 ? (
                  <div style={{ padding: '24px', background: '#f0fdf4', borderRadius: '12px', border: '1.5px dashed #86efac', textAlign: 'center', color: '#166534', fontSize: '14px', fontWeight: '700' }}>
                    🎉 No unexcused period absences found for the selected students on these dates!
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
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
                            borderRadius: '10px',
                            background: isChecked ? '#eff6ff' : '#ffffff',
                            border: isChecked ? '1.5px solid #3b82f6' : '1px solid #e2e8f0',
                            cursor: 'pointer'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <input type="checkbox" checked={isChecked} readOnly />
                            <div>
                              <div style={{ fontWeight: '800', fontSize: '13px', color: '#0f172a' }}>
                                📅 {p.date} • Period {p.session}: <span style={{ color: '#2563eb' }}>{p.subject}</span>
                              </div>
                              <div style={{ fontSize: '11px', color: '#64748b' }}>
                                👨‍🏫 Faculty: {p.teacherName} • Absent: <strong style={{ color: '#dc2626' }}>{p.absentStudentNames}</strong>
                              </div>
                            </div>
                          </div>
                          <span style={{ background: '#fef2f2', color: '#dc2626', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: '800' }}>
                            ABSENT
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* STEP 3: CLEARANCE TYPE & SUBMIT */}
            {fetchedClearStudentsList.length > 0 && (
              <div style={{ background: '#f8fafc', padding: '18px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                <label style={{ ...styles.label, fontSize: '14px', fontWeight: '800', color: '#0f172a', marginBottom: '10px' }}>
                  Step 3: Clearance Type &amp; Justification
                </label>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px', marginBottom: '14px' }}>
                  {[
                    { id: 'medical', label: '🏥 Medical Leave (Excused M)' },
                    { id: 'official', label: '🏛️ Official Duty (Present O)' },
                    { id: 'permitted', label: '🎭 Rehearsal / Special Duty (Present O)' }
                  ].map(r => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setClearReason(r.id)}
                      style={{
                        padding: '10px 14px',
                        borderRadius: '10px',
                        border: clearReason === r.id ? '2px solid #2563eb' : '1px solid #cbd5e1',
                        background: clearReason === r.id ? '#eff6ff' : '#ffffff',
                        color: clearReason === r.id ? '#1d4ed8' : '#0f172a',
                        fontWeight: '800',
                        fontSize: '13px',
                        cursor: 'pointer'
                      }}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>

                <div style={{ marginBottom: '14px' }}>
                  <label style={styles.label}>Official Remarks / Justification:</label>
                  <input
                    type="text"
                    value={clearanceRemarks}
                    onChange={e => setClearanceRemarks(e.target.value)}
                    placeholder="e.g. Medical fitness certificate submitted / Official outreach representation..."
                    style={styles.input}
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading || selectedClearSessionIds.length === 0}
                  style={{
                    ...styles.buttonPrimary,
                    width: '100%',
                    padding: '14px',
                    fontSize: '14px',
                    fontWeight: '800',
                    background: clearReason === 'medical' ? '#e11d48' : '#2563eb'
                  }}
                >
                  {loading
                    ? '⏳ Applying Official Clearance...'
                    : clearReason === 'medical'
                    ? `🏥 Record Medical Leave for ${selectedClearSessionIds.length} Selected Period(s)`
                    : `🏛️ Clear ${selectedClearSessionIds.length} Period(s) as Official Duty`}
                </button>
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '20px' }}>
            <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '800' }}>TOTAL CLEARANCES</div>
              <div style={{ fontSize: '24px', fontWeight: '900', color: '#0f172a', marginTop: '2px' }}>{historyKpis.total}</div>
            </div>
            <div style={{ background: '#fffbeb', padding: '14px 16px', borderRadius: '12px', border: '1px solid #fde68a' }}>
              <div style={{ fontSize: '11px', color: '#b45309', fontWeight: '800' }}>🏥 MEDICAL LEAVES</div>
              <div style={{ fontSize: '24px', fontWeight: '900', color: '#b45309', marginTop: '2px' }}>{historyKpis.medical}</div>
            </div>
            <div style={{ background: '#ecfdf5', padding: '14px 16px', borderRadius: '12px', border: '1px solid #a7f3d0' }}>
              <div style={{ fontSize: '11px', color: '#047857', fontWeight: '800' }}>🏛️ OFFICIAL (PRESENT)</div>
              <div style={{ fontSize: '24px', fontWeight: '900', color: '#047857', marginTop: '2px' }}>{historyKpis.official}</div>
            </div>
            <div style={{ background: '#f0fdf4', padding: '14px 16px', borderRadius: '12px', border: '1px solid #bbf7d0' }}>
              <div style={{ fontSize: '11px', color: '#15803d', fontWeight: '800' }}>✅ VERIFIED BY ADMIN</div>
              <div style={{ fontSize: '24px', fontWeight: '900', color: '#15803d', marginTop: '2px' }}>{historyKpis.verified}</div>
            </div>
            <div style={{ background: '#fff1f2', padding: '14px 16px', borderRadius: '12px', border: '1px solid #fecdd3' }}>
              <div style={{ fontSize: '11px', color: '#be123c', fontWeight: '800' }}>⏳ PENDING VERIFICATION</div>
              <div style={{ fontSize: '24px', fontWeight: '900', color: '#be123c', marginTop: '2px' }}>{historyKpis.pending}</div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <select
                value={historyClassFilter}
                onChange={e => setHistoryClassFilter(e.target.value)}
                style={{ ...styles.input, width: 'auto', padding: '7px 12px', fontSize: '12px', fontWeight: '700' }}
              >
                <option value="ALL">All Classes</option>
                {DEFAULT_CLASSES.map(c => (
                  <option key={c} value={c}>Class {c}</option>
                ))}
              </select>

              <input
                type="text"
                value={historySearch}
                onChange={e => setHistorySearch(e.target.value)}
                placeholder="🔍 Search name, Ad.No or ref..."
                style={{ ...styles.input, width: '210px', padding: '7px 12px', fontSize: '12px' }}
              />

              <select
                value={historyTypeFilter}
                onChange={e => setHistoryTypeFilter(e.target.value)}
                style={{ ...styles.input, width: 'auto', padding: '7px 12px', fontSize: '12px', fontWeight: '700' }}
              >
                <option value="ALL">All Clearance Types</option>
                <option value="MEDICAL_LEAVE">🏥 Medical Leave Only</option>
                <option value="OFFICIAL_PRESENT">🏛️ Official Leave Only</option>
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

            <div style={{ display: 'flex', gap: '8px' }}>
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
                            {isMed ? '🏥 Medical Leave' : '🏛️ Official (Present)'}
                          </span>
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'center', fontWeight: '800' }}>
                          {item.totalPeriodsCleared || 1}
                        </td>
                        <td style={{ padding: '12px 14px', maxWidth: '180px' }}>
                          <div style={{ fontSize: '11px', color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.remarks}>
                            {item.remarks || '-'}
                          </div>
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <div style={{ fontWeight: '700', color: '#0f172a' }}>{item.issuedByName || 'Admin'}</div>
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
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '6px' }}>
                            <button
                              type="button"
                              onClick={() => setInspectingHistoryItem(item)}
                              style={{ padding: '4px 8px', background: '#f8fafc', color: '#334155', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '11px', fontWeight: '700', cursor: 'pointer' }}
                            >
                              👁️ Sessions
                            </button>
                            {!isVer && (
                              <button
                                type="button"
                                onClick={() => setVerifyingHistoryItem(item)}
                                style={{ padding: '4px 8px', background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', borderRadius: '6px', fontSize: '11px', fontWeight: '800', cursor: 'pointer' }}
                              >
                                ✅ Verify
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setActiveCertToPrint(item)}
                              style={{ padding: '4px 8px', background: '#eef2ff', color: '#4338ca', border: '1px solid #c7d2fe', borderRadius: '6px', fontSize: '11px', fontWeight: '700', cursor: 'pointer' }}
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
          VIEW 3: ULTRA-FAST INSPECT & EDIT STUDENT SESSIONS (With Class Filter + Name/Ad.No Search!)
         ============================================================ */}
      {clearanceSubTab === 'inspect' && (
        <div style={styles.card}>
          <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '20px' }}>
            {/* 🌟 ROW 1: FILTER BY CLASS + SELECT STUDENT DROPDOWN + SEARCH BY NAME OR AD.NO */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '12px', marginBottom: '12px' }}>
              <div>
                <label style={styles.label}>1. Filter by Class</label>
                <select
                  value={inspectClassFilter}
                  onChange={e => setInspectClassFilter(e.target.value)}
                  style={{ ...styles.input, fontWeight: '700' }}
                >
                  <option value="ALL">All Classes ({localStudents.length})</option>
                  {DEFAULT_CLASSES.map(c => (
                    <option key={c} value={c}>Class {c}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={styles.label}>2. Select Student from Class ({inspectFilteredStudents.length})</label>
                <select
                  value={inspectStudent?.adNo || ''}
                  onChange={e => {
                    const ad = e.target.value;
                    if (ad) {
                      setInspectAdNo(ad);
                      handleLoadInspectStudent(ad);
                    }
                  }}
                  style={{ ...styles.input, fontWeight: '700' }}
                >
                  <option value="">-- Choose Student --</option>
                  {inspectFilteredStudents.map(st => (
                    <option key={st.regNo} value={st.adNo}>
                      {st.firstName} (#{st.adNo} • {(st.classes || []).join(',')})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={styles.label}>3. Search by Student Name or Ad.No</label>
                <input
                  type="text"
                  value={inspectSearchText}
                  onChange={e => {
                    setInspectSearchText(e.target.value);
                    setInspectAdNo(e.target.value);
                  }}
                  placeholder="Type Student Name or #Ad.No (e.g. 3551)..."
                  style={{ ...styles.input, fontWeight: '700' }}
                />
              </div>
            </div>

            {/* QUICK CLICKABLE MATCHES WHEN TYPING NAME/AD.NO */}
            {inspectSearchText.trim().length > 0 && inspectFilteredStudents.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
                {inspectFilteredStudents.slice(0, 8).map(st => (
                  <button
                    key={st.regNo}
                    type="button"
                    onClick={() => {
                      setInspectAdNo(st.adNo);
                      setInspectSearchText('');
                      handleLoadInspectStudent(st.adNo);
                    }}
                    style={{ padding: '5px 12px', borderRadius: '999px', background: '#eef2ff', color: '#4f46e5', border: '1px solid #c7d2fe', fontSize: '12px', fontWeight: '800', cursor: 'pointer' }}
                  >
                    🔍 {st.firstName} (#{st.adNo} • {(st.classes || []).join(',')})
                  </button>
                ))}
              </div>
            )}

            {/* ROW 2: DATE RANGE + STATUS FILTER + PROPER SEARCH BUTTON */}
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'end', paddingTop: '12px', borderTop: '1px solid #e2e8f0' }}>
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
                  <option value="ABSENT">❌ Absent Only</option>
                  <option value="MEDICAL">🏥 Medical Leave Only</option>
                  <option value="OFFICIAL">🏛️ Official Leave Only</option>
                  <option value="CLEARED">All Cleared (Medical + Official)</option>
                </select>
              </div>
              <button
                type="button"
                onClick={() => handleLoadInspectStudent(inspectAdNo || inspectSearchText)}
                disabled={fetchingInspect}
                style={{ ...styles.buttonPrimary, padding: '10px 22px', fontWeight: '800' }}
              >
                {fetchingInspect ? '⏳ Searching...' : '🔍 Search & Inspect Sessions'}
              </button>
            </div>
          </div>

          {inspectStudent && (
            <div style={{ marginBottom: '16px', padding: '14px 18px', background: '#eef2ff', borderRadius: '10px', border: '1px solid #c7d2fe', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <strong style={{ fontSize: '16px', color: '#0f172a' }}>{inspectStudent.firstName}</strong>{' '}
                <span style={{ color: '#4f46e5', fontWeight: '800' }}>(#{inspectStudent.adNo})</span> • Class: <strong>{(inspectStudent.classes || []).join(', ')}</strong>
              </div>
              <div style={{ fontSize: '13px', color: '#3730a3', fontWeight: '800' }}>
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
                  <th style={{ padding: '12px 14px', textAlign: 'right' }}>CHANGE STATUS</th>
                </tr>
              </thead>
              <tbody>
                {inspectSessionsList.length === 0 ? (
                  <tr>
                    <td colSpan="7" style={{ padding: '28px', textAlign: 'center', color: '#64748b', fontWeight: '600' }}>
                      {fetchingInspect
                        ? '⚡ Fast-scanning sessions...'
                        : 'Select a student and click "🔍 Search & Inspect Sessions" to view their period sessions.'}
                    </td>
                  </tr>
                ) : (
                  inspectSessionsList.map((item, idx) => {
                    const isMed = item.rawStatus === 'M';
                    const isOff = item.rawStatus === 'O';
                    const isAbs = item.rawStatus === 'A';
                    const isPres = item.rawStatus === 'P';
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
                            background: isMed ? '#fef3c7' : isOff ? '#ccfbf1' : isAbs ? '#fee2e2' : '#dcfce7',
                            color: isMed ? '#b45309' : isOff ? '#0f766e' : isAbs ? '#dc2626' : '#15803d'
                          }}>
                            {isMed ? '🤒 Medical' : isOff ? '🏛️ Official' : isAbs ? '🔴 Absent' : '🟢 Present'}
                          </span>
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '6px' }}>
                            {[
                              { code: 'P', label: '🟢 Pres', bg: '#dcfce7', col: '#15803d' },
                              { code: 'A', label: '🔴 Abs', bg: '#fee2e2', col: '#dc2626' },
                              { code: 'M', label: '🤒 Sick', bg: '#fef3c7', col: '#b45309' },
                              { code: 'O', label: '🏛️ Official', bg: '#ccfbf1', col: '#0f766e' }
                            ].map(btn => (
                              <button
                                key={btn.code}
                                type="button"
                                disabled={loading || item.rawStatus === btn.code}
                                onClick={() => handleChangeInspectSessionStatus(item, btn.code)}
                                style={{
                                  padding: '4px 8px',
                                  borderRadius: '6px',
                                  fontSize: '11px',
                                  fontWeight: '800',
                                  border: '1px solid #cbd5e1',
                                  background: item.rawStatus === btn.code ? '#0f172a' : btn.bg,
                                  color: item.rawStatus === btn.code ? '#ffffff' : btn.col,
                                  cursor: item.rawStatus === btn.code ? 'default' : 'pointer'
                                }}
                              >
                                {btn.label}
                              </button>
                            ))}
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
          HIGH-SECURITY SCOPED ATTENDANCE DELETE CARD (Period + Night + Extra Only)
         ============================================================ */}
      {userRole === 'admin' && (
        <div style={{ ...styles.card, border: '1.5px solid #fecdd3', background: '#ffffff' }}>
          <h3 style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: '800', color: '#0f172a' }}>
            Complete / Scoped Attendance Delete
          </h3>
          <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: '#64748b' }}>
            Deletes strictly attendance records (Period Attendance, Night Attendance, and Extra Attendance) by Date Range or All Dates, for All Students or a Specific Class. Student profiles, CCE marks, and other portal data are never touched.
          </p>

          <div style={{ background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: '12px', padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ fontSize: '13px', fontWeight: '800', color: '#e11d48' }}>
              🚨 High-risk action: this permanently deletes the selected attendance records.
            </div>

            {/* 1. SELECT DATE SCOPE & CLASS SCOPE */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', background: '#ffffff', padding: '14px', borderRadius: '10px', border: '1px solid #fecdd3' }}>
              <div>
                <label style={styles.label}>1. Target Class Scope</label>
                <select
                  value={delClassScope}
                  onChange={e => setDelClassScope(e.target.value)}
                  style={{ ...styles.input, fontWeight: '800' }}
                >
                  <option value="ALL">All Classes (Every Student)</option>
                  {DEFAULT_CLASSES.map(c => (
                    <option key={c} value={c}>Only Class {c} Students</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={styles.label}>2. Date Range Mode</label>
                <select
                  value={delDateScope}
                  onChange={e => setDelDateScope(e.target.value)}
                  style={{ ...styles.input, fontWeight: '800' }}
                >
                  <option value="DATE_RANGE">Specific Date Range (From ➔ To)</option>
                  <option value="ALL_DATES">All Dates (Complete Semester Reset)</option>
                </select>
              </div>

              {delDateScope === 'DATE_RANGE' && (
                <>
                  <div>
                    <label style={styles.label}>From Date</label>
                    <input
                      type="date"
                      value={delStartDate}
                      onChange={e => setDelStartDate(e.target.value)}
                      style={styles.input}
                    />
                  </div>
                  <div>
                    <label style={styles.label}>To Date</label>
                    <input
                      type="date"
                      value={delEndDate}
                      onChange={e => setDelEndDate(e.target.value)}
                      style={styles.input}
                    />
                  </div>
                </>
              )}
            </div>

            {/* 2. ATTENDANCE TYPES TO INCLUDE */}
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', background: '#ffffff', padding: '12px 14px', borderRadius: '10px', border: '1px solid #fecdd3', fontSize: '13px', fontWeight: '700' }}>
              <span style={{ color: '#0f172a', fontWeight: '800' }}>3. Attendance Types to Delete:</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <input type="checkbox" checked={delIncludePeriod} onChange={e => setDelIncludePeriod(e.target.checked)} />
                Period Attendance
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <input type="checkbox" checked={delIncludeNight} onChange={e => setDelIncludeNight(e.target.checked)} />
                Night Attendance
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <input type="checkbox" checked={delIncludeExtra} onChange={e => setDelIncludeExtra(e.target.checked)} />
                Extra Attendance
              </label>
            </div>

            {/* 3. MANDATORY INTENTIONALITY CHECKBOX */}
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#ffffff', padding: '10px 14px', borderRadius: '8px', border: '1px solid #fda4af', fontSize: '13px', fontWeight: '700', color: '#9f1239', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={delSafetyChecked}
                onChange={e => setDelSafetyChecked(e.target.checked)}
                style={{ width: '16px', height: '16px' }}
              />
              I confirm that I intentionally want to delete the selected attendance records for {delClassScope === 'ALL' ? 'ALL CLASSES' : `CLASS ${delClassScope}`} ({delDateScope === 'ALL_DATES' ? 'All Dates' : `${delStartDate} to ${delEndDate}`}).
            </label>

            {/* 4. PASSWORD & CONFIRMATION PHRASE */}
            <div>
              <label style={{ fontSize: '12px', fontWeight: '700', color: '#334155', display: 'block', marginBottom: '6px' }}>
                Account Password
              </label>
              <input
                type="password"
                value={delPassword}
                onChange={e => setDelPassword(e.target.value)}
                placeholder="Enter your account password"
                style={styles.input}
              />
              <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                Enter the current password of the logged-in admin account.
              </div>
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: '700', color: '#334155', display: 'block', marginBottom: '6px' }}>
                Type confirmation: <strong>{expectedDeletePhrase}</strong>
              </label>
              <input
                type="text"
                value={delConfirmPhrase}
                onChange={e => setDelConfirmPhrase(e.target.value)}
                placeholder={expectedDeletePhrase}
                style={styles.input}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '14px' }}>
            <button
              type="button"
              onClick={handleExecuteScopedAttendanceDelete}
              disabled={deletingAttendance || !delSafetyChecked}
              style={{
                padding: '10px 20px',
                background: '#e11d48',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontWeight: '800',
                fontSize: '13px',
                cursor: deletingAttendance || !delSafetyChecked ? 'not-allowed' : 'pointer',
                opacity: deletingAttendance || !delSafetyChecked ? 0.6 : 1
              }}
            >
              {deletingAttendance ? '⏳ Deleting Attendance...' : '🗑️ Delete Attendance'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}