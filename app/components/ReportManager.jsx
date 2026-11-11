'use client';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import { auth, db } from '../../lib/firebase';
import { createUserWithEmailAndPassword, getAuth, signOut, updatePassword } from 'firebase/auth';
import { doc, setDoc, getDoc, getDocs, collection, deleteDoc, arrayUnion } from 'firebase/firestore';
import { getApp, initializeApp } from 'firebase/app';
import {
  WEB_APP_URL, DHIU_LOGO_URL, DEFAULT_SUBJECTS, DEFAULT_CLASSES,
  GRADES, DEPARTMENTS, MADHABS, CCE_LEVELS, HIFZ_LEVELS,
  OUTPASS_BETA_TESTERS, parseCSVLine, delay, styles, sortStudentsByDepartment
} from './erpConstants';
import {
  INDIAN_STATES, KERALA_DISTRICTS, HighContrastStyles,
  compressImageFileToDataUrl, openDirectWhatsApp, sendDirectEmailNotification,
  ProfileAvatar, SubjectTeacherSelector, syncStudentToSelectedTeacherEnrollments,
  StudentPortfolioModal, TeacherPrivilegeModal, MentorAndOutreachTab
} from './ErpExtensions';

// 🌟 STRICT SUBJECT ISOLATION HELPER
// Prevents an enrollment with subject "English" from matching "Aqidah" or "Logic" and separates Fiqh from U:Fiqh
const isStrictMatchingSubject = (targetSub, envSubRaw, envAliasRaw) => {
  const tUp = String(targetSub || '').trim().toUpperCase();
  const sUp = String(envSubRaw || '').trim().toUpperCase();
  const aUp = String(envAliasRaw || '').trim().toUpperCase();

  // 1. Check if the teacher's enrollment alias explicitly names a DIFFERENT subject
  const explicitSubjects = [
    { key: 'U :FIQH', tokens: ['U :FIQH', 'U:FIQH', 'USUL'] },
    { key: 'FIQH', tokens: ['FIQH'] },
    { key: 'THAFSEER', tokens: ['THAFSEER', 'TAFSEER', 'TAFSIR'] },
    { key: 'HADITH', tokens: ['HADITH', 'HADEETH'] },
    { key: 'AQIDAH', tokens: ['AQIDAH', 'AQEEDAH'] },
    { key: 'BALAGHA', tokens: ['BALAGHA'] },
    { key: 'LOGIC', tokens: ['LOGIC', 'MANTIQ'] },
    { key: 'ENGLISH', tokens: ['ENGLISH'] },
    { key: 'ADAB', tokens: ['ADAB'] },
    { key: 'URDU', tokens: ['URDU'] },
    { key: 'SOCIAL SCIENCE', tokens: ['SOCIAL SCIENCE', 'SOCIAL'] },
    { key: 'THAMADUN', tokens: ['THAMADUN', 'TAMADDUN'] },
    { key: 'SPECIALIZATION', tokens: ['SPECIALIZATION', 'TAKASSUS'] },
    { key: 'HIFZ', tokens: ['HIFZ'] }
  ];

  // Determine the true subject of the enrollment (Alias overrides misconfigured dropdown slot!)
  let detectedSubFromAlias = null;
  for (const item of explicitSubjects) {
    if (item.key === 'FIQH') {
      const isUsul = aUp.includes('U :FIQH') || aUp.includes('U:FIQH') || aUp.includes('USUL');
      if (!isUsul && aUp.includes('FIQH')) {
        detectedSubFromAlias = 'FIQH';
        break;
      }
    } else if (item.tokens.some(tok => aUp.includes(tok))) {
      detectedSubFromAlias = item.key;
      break;
    }
  }

  const effectiveEnvSub = detectedSubFromAlias || (sUp === 'MANTIQ' ? 'LOGIC' : sUp);
  const normalizedTarget = (tUp === 'U:FIQH' || tUp.includes('USUL')) ? 'U :FIQH' : (tUp === 'MANTIQ' ? 'LOGIC' : tUp);

  if (normalizedTarget === 'U :FIQH') {
    return effectiveEnvSub === 'U :FIQH' || sUp.includes('U :FIQH') || sUp.includes('U:FIQH');
  }
  if (normalizedTarget === 'FIQH') {
    const isUsul = effectiveEnvSub === 'U :FIQH' || sUp.includes('U :FIQH') || sUp.includes('U:FIQH') || aUp.includes('U :FIQH') || aUp.includes('USUL');
    return effectiveEnvSub === 'FIQH' && !isUsul;
  }
  return effectiveEnvSub === normalizedTarget;
};

export default function ReportManager() {
  const [registeredStudents, setRegisteredStudents] = useState([]);
  const [overallMarksCache, setOverallMarksCache] = useState({});
  const [filteredResults, setFilteredResults] = useState([]);
  const [localFirebaseMarks, setLocalFirebaseMarks] = useState({});

  const [isLoading, setIsLoading] = useState(false);
  const [isBackgroundSyncing, setIsBackgroundSyncing] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  // 1. Auditor Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [auditPreset, setAuditPreset] = useState('ALL');
  const [exportDepartment, setExportDepartment] = useState('All');
  const [exportClassFilter, setExportClassFilter] = useState('All');
  const [exportMetric, setExportMetric] = useState('STATUS');
  const [exportSubject, setExportSubject] = useState(DEFAULT_SUBJECTS[0]);
  const [thresholdCondition, setThresholdCondition] = useState('Below');
  const [thresholdScore, setThresholdScore] = useState(40);

  // 2. Inspector State
  const [inspectorClass, setInspectorClass] = useState(DEFAULT_CLASSES[0]);
  const [inspectorSubject, setInspectorSubject] = useState(DEFAULT_SUBJECTS[0]);
  const [subjectLevelMarks, setSubjectLevelMarks] = useState({});
  const [isInspecting, setIsInspecting] = useState(false);
  const [inspectorMode, setInspectorMode] = useState('class');
  const [allTeachers, setAllTeachers] = useState([]);
  const [inspectorTeacherUsername, setInspectorTeacherUsername] = useState('');
  const [inspectorTeacherEnrollmentId, setInspectorTeacherEnrollmentId] = useState('');

  // 3. Analytics State
  const [analyticsMode, setAnalyticsMode] = useState('grade');
  const [analyticsGrade, setAnalyticsGrade] = useState('1');
  const [analyticsTeacherUsername, setAnalyticsTeacherUsername] = useState('');
  const [analyticsData, setAnalyticsData] = useState(null);
  const [isFetchingAnalytics, setIsFetchingAnalytics] = useState(false);

  // 🌟 4. Batch Student Subject & Mentor Assignment State
  const [batchMode, setBatchMode] = useState('subject'); // 'subject' | 'mentor' | 'classteacher'
  const [batchSearch, setBatchSearch] = useState('');
  const [batchGradeFilter, setBatchGradeFilter] = useState('All'); // 'All' | '1' | '2' | '3'
  const [batchClassFilter, setBatchClassFilter] = useState('All');
  const [batchDeptFilter, setBatchDeptFilter] = useState('All');
  const [batchMadhabFilter, setBatchMadhabFilter] = useState('All'); // 'All' | 'SHAFI' | 'HANAFI'
  const [batchStreamFilter, setBatchStreamFilter] = useState('All'); // 'All' | 'URDU' | 'GENERAL'
  const [selectedBatchRegNos, setSelectedBatchRegNos] = useState([]);
  const [batchTargetTeacher, setBatchTargetTeacher] = useState('');
  const [batchTargetEnrollmentId, setBatchTargetEnrollmentId] = useState('');
  const [batchStatusMsg, setBatchStatusMsg] = useState('');
  const [isSavingBatch, setIsSavingBatch] = useState(false);

  const fetchReportData = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, 'students'));
      const studentsData = [];
      querySnapshot.forEach((docSnap) => studentsData.push({ id: docSnap.id, ...docSnap.data() }));
      studentsData.sort((a, b) => (Number(a.rollNo) || 999) - (Number(b.rollNo) || 999));
      setRegisteredStudents(studentsData);

      const tSnap = await getDocs(collection(db, 'teachers'));
      const tData = [];
      tSnap.forEach((docSnap) => tData.push({ id: docSnap.id, ...docSnap.data() }));
      tData.sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''));
      setAllTeachers(tData);

      if (tData.length > 0) {
        setInspectorTeacherUsername(tData[0].username);
        setAnalyticsTeacherUsername(tData[0].username);
        setBatchTargetTeacher(tData[0].username);
        if (tData[0].enrollments?.length > 0) {
          setInspectorTeacherEnrollmentId(tData[0].enrollments[0].id);
          setBatchTargetEnrollmentId(tData[0].enrollments[0].id);
        }
      }

      const mSnap = await getDocs(collection(db, 'marks'));
      const mData = {};
      mSnap.forEach(d => { mData[d.id] = d.data(); });
      setLocalFirebaseMarks(mData);

      const cacheDocRef = doc(db, 'systemCache', 'adminReportCache');
      const cacheSnap = await getDoc(cacheDocRef);

      if (cacheSnap.exists()) {
        setOverallMarksCache(cacheSnap.data().marksData || {});
        setIsLoading(false);
      } else {
        setIsLoading(false);
      }

      backgroundSyncWithGoogleSheets();
      syncStudentPortalMetaInBackground(studentsData, tData, mData);
    } catch (err) {
      console.error('Error fetching report data:', err);
      setIsLoading(false);
    }
  };

  // 🌟 Automatically syncs clean Teacher Directory & Class Ranks to systemCache/studentPortalMeta
  const syncStudentPortalMetaInBackground = async (studentsList, teachersList, marksMap) => {
    try {
      const classGroups = {};
      studentsList.forEach(st => {
        const sMarks = marksMap[st.regNo] || marksMap[st.id] || {};
        let total = 0;
        Object.keys(sMarks).forEach(subKey => {
          const subObj = sMarks[subKey] || {};
          Object.values(subObj).forEach(val => {
            if (val !== '' && !isNaN(Number(val))) total += Number(val);
          });
        });
        const primaryClass = (st.classes || ['GENERAL'])[0];
        if (!classGroups[primaryClass]) classGroups[primaryClass] = [];
        classGroups[primaryClass].push({ regNo: st.regNo, total });
      });

      const classRanks = {};
      Object.keys(classGroups).forEach(cls => {
        const peers = classGroups[cls];
        peers.sort((a, b) => b.total - a.total);
        peers.forEach((p, idx) => {
          classRanks[p.regNo] = { rank: idx + 1, totalPeers: peers.length };
        });
      });

      const teacherDirectory = teachersList.map(t => ({
        username: t.username,
        fullName: t.fullName,
        designation: t.designation || 'Faculty',
        whatsappNumber: t.whatsappNumber || t.mobileNumber || '',
        email: t.email || '',
        classTeacherOf: t.outpassPrivileges?.classTeacherOf || [],
        enrollments: (t.enrollments || []).map(ev => ({
          id: ev.id,
          grade: ev.grade,
          targetClass: ev.targetClass || '',
          subject: ev.subject,
          alias: ev.alias,
          langTag: ev.langTag,
          studentIds: ev.studentIds || []
        }))
      }));

      await setDoc(doc(db, 'systemCache', 'studentPortalMeta'), {
        classRanks,
        teacherDirectory,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } catch (e) {
      console.error('Portal meta background sync error:', e);
    }
  };

  // 🌟 One-click database repair for mislabeled Teacher Subject Slots (e.g. "QLA3 Logic" or "M10 Aqidah" inside "English")
  const handleRepairMislabeledTeacherSubjects = async () => {
    if (!window.confirm('This will scan all teachers and fix enrollments where the Alias says "Logic" or "Aqidah" (or another subject) but the Subject field was accidentally saved as "English". Continue?')) return;
    setIsLoading(true);
    let fixedCount = 0;

    try {
      const tSnap = await getDocs(collection(db, 'teachers'));
      const updatedTeachers = [];

      for (const tDoc of tSnap.docs) {
        const tData = tDoc.data();
        let changed = false;
        const fixedEnrollments = (tData.enrollments || []).map(env => {
          const aliasUp = String(env.alias || '').toUpperCase();
          const subUp = String(env.subject || '').toUpperCase();
          let correctedSubject = env.subject;

          if (aliasUp.includes('U :FIQH') || aliasUp.includes('U:FIQH') || aliasUp.includes('USUL')) {
            if (subUp !== 'U :FIQH') { correctedSubject = 'U :FIQH'; changed = true; fixedCount++; }
          } else if (aliasUp.includes('AQIDAH') || aliasUp.includes('AQEEDAH')) {
            if (subUp !== 'AQIDAH') { correctedSubject = 'Aqidah'; changed = true; fixedCount++; }
          } else if (aliasUp.includes('LOGIC') || aliasUp.includes('MANTIQ')) {
            if (subUp !== 'LOGIC') { correctedSubject = 'Logic'; changed = true; fixedCount++; }
          } else if (aliasUp.includes('THAFSEER') || aliasUp.includes('TAFSEER')) {
            if (subUp !== 'THAFSEER') { correctedSubject = 'Thafseer'; changed = true; fixedCount++; }
          } else if (aliasUp.includes('HADITH')) {
            if (subUp !== 'HADITH') { correctedSubject = 'Hadith'; changed = true; fixedCount++; }
          } else if (aliasUp.includes('BALAGHA')) {
            if (subUp !== 'BALAGHA') { correctedSubject = 'Balagha'; changed = true; fixedCount++; }
          } else if (aliasUp.includes('ADAB')) {
            if (subUp !== 'ADAB') { correctedSubject = 'Adab'; changed = true; fixedCount++; }
          } else if (aliasUp.includes('THAMADUN')) {
            if (subUp !== 'THAMADUN') { correctedSubject = 'Thamadun'; changed = true; fixedCount++; }
          } else if (aliasUp.includes('SOCIAL')) {
            if (subUp !== 'SOCIAL SCIENCE') { correctedSubject = 'Social Science'; changed = true; fixedCount++; }
          } else if (aliasUp.includes('FIQH') && !aliasUp.includes('U :FIQH') && !aliasUp.includes('U:FIQH')) {
            if (subUp !== 'FIQH') { correctedSubject = 'Fiqh'; changed = true; fixedCount++; }
          }

          return { ...env, subject: correctedSubject };
        });

        if (changed) {
          await setDoc(doc(db, 'teachers', tDoc.id), { enrollments: fixedEnrollments }, { merge: true });
          updatedTeachers.push({ ...tData, enrollments: fixedEnrollments });
        } else {
          updatedTeachers.push(tData);
        }
      }

      setAllTeachers(updatedTeachers);
      await syncStudentPortalMetaInBackground(registeredStudents, updatedTeachers, localFirebaseMarks);
      alert(`✅ Repaired ${fixedCount} mislabeled subject assignments and refreshed the Student Portal cache!`);
    } catch (err) {
      alert('Error repairing subjects: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const backgroundSyncWithGoogleSheets = async () => {
    setIsBackgroundSyncing(true);
    try {
      const res = await fetch(`${WEB_APP_URL}?action=getAllAdminReportData`);
      const result = await res.json();
      if (result.status === 'success') {
        const freshData = result.data || {};
        setOverallMarksCache(freshData);
        await setDoc(doc(db, 'systemCache', 'adminReportCache'), {
          marksData: freshData,
          lastUpdated: new Date().toISOString()
        });
      }
    } catch (err) {
      console.error('Background sheet sync error:', err);
    } finally {
      setIsBackgroundSyncing(false);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReportData();
  }, []);

  // Helper to compute a student's local metric using the exact Google Sheet formula:
  // SUM(Marks Entered) / SUM(Max Marks of Entered Levels)
  const computeStudentLocalMetrics = (student) => {
    const stMarks = localFirebaseMarks[student.regNo] || localFirebaseMarks[student.id] || localFirebaseMarks[student.adNo];
    if (!stMarks || Object.keys(stMarks).length === 0) {
      return {
        hasAnyData: false,
        total1400: 0,
        total490: 0,
        overallPct: 0,
        getSubjectScore: () => null,
        getSubjectStatusPct: () => null
      };
    }

    let total1400 = 0;
    let total490 = 0;
    let totalEnteredObtained = 0;
    let totalEnteredMaxPossible = 0;
    let hasAnyData = false;

    const findMatchingKey = (targetSub) => {
      const exactSub = targetSub.trim().toUpperCase();
      return Object.keys(stMarks).find(k => {
        const kUp = k.trim().toUpperCase();
        const isActUsul = exactSub.includes('U :FIQH') || exactSub.includes('U:FIQH');
        const isKUsul = kUp.includes('U :FIQH') || kUp.includes('U:FIQH');
        if (isActUsul) return isKUsul;
        if (exactSub === 'FIQH') return kUp === 'FIQH' && !isKUsul;
        if (exactSub === 'LOGIC' || exactSub === 'MANTIQ') return kUp === 'LOGIC' || kUp === 'MANTIQ';
        return kUp === exactSub;
      });
    };

    const getSubjectStatusPct = (targetSub) => {
      const exactSub = targetSub.trim().toUpperCase();
      const foundKey = findMatchingKey(targetSub);
      if (!foundKey || !stMarks[foundKey]) return null;

      const m = stMarks[foundKey];
      let subObtained = 0;
      let subMaxPossible = 0;

      if (exactSub === 'HIFZ') {
        if (m['50_1'] !== undefined && m['50_1'] !== '' && !isNaN(parseFloat(m['50_1']))) {
          subObtained += parseFloat(m['50_1']);
          subMaxPossible += 50;
        }
        if (m['50_2'] !== undefined && m['50_2'] !== '' && !isNaN(parseFloat(m['50_2']))) {
          subObtained += parseFloat(m['50_2']);
          subMaxPossible += 50;
        }
      } else {
        ['15', '20', '25', '40'].forEach(lvl => {
          if (m[lvl] !== undefined && m[lvl] !== '' && !isNaN(parseFloat(m[lvl]))) {
            subObtained += parseFloat(m[lvl]);
            subMaxPossible += Number(lvl);
          }
        });
      }

      if (subMaxPossible === 0) return null;
      return Number(((subObtained / subMaxPossible) * 100).toFixed(2));
    };

    const getSubjectScore = (targetSub) => {
      const exactSub = targetSub.trim().toUpperCase();
      const foundKey = findMatchingKey(targetSub);
      if (!foundKey || !stMarks[foundKey]) return null;

      const m = stMarks[foundKey];
      let t100 = 0;
      let subHasData = false;

      if (exactSub === 'HIFZ') {
        if (m['50_1'] !== undefined && m['50_1'] !== '' && !isNaN(parseFloat(m['50_1']))) { t100 += parseFloat(m['50_1']); subHasData = true; }
        if (m['50_2'] !== undefined && m['50_2'] !== '' && !isNaN(parseFloat(m['50_2']))) { t100 += parseFloat(m['50_2']); subHasData = true; }
        return subHasData ? Number(t100.toFixed(1)) : null;
      } else {
        ['15', '20', '25', '40'].forEach(lvl => {
          if (m[lvl] !== undefined && m[lvl] !== '' && !isNaN(parseFloat(m[lvl]))) {
            t100 += parseFloat(m[lvl]);
            subHasData = true;
          }
        });
        return subHasData ? Number(((t100 / 100) * 30).toFixed(1)) : null;
      }
    };

    Object.keys(stMarks).forEach(subKey => {
      const m = stMarks[subKey];
      if (!m || typeof m !== 'object') return;
      const isHifz = subKey.trim().toUpperCase() === 'HIFZ';
      let subSumObtained = 0;
      let subMaxPossible = 0;

      if (isHifz) {
        if (m['50_1'] !== undefined && m['50_1'] !== '' && !isNaN(parseFloat(m['50_1']))) {
          subSumObtained += parseFloat(m['50_1']);
          subMaxPossible += 50;
        }
        if (m['50_2'] !== undefined && m['50_2'] !== '' && !isNaN(parseFloat(m['50_2']))) {
          subSumObtained += parseFloat(m['50_2']);
          subMaxPossible += 50;
        }
      } else {
        ['15', '20', '25', '40'].forEach(lvl => {
          if (m[lvl] !== undefined && m[lvl] !== '' && !isNaN(parseFloat(m[lvl]))) {
            subSumObtained += parseFloat(m[lvl]);
            subMaxPossible += Number(lvl);
          }
        });
      }

      if (subMaxPossible > 0) {
        hasAnyData = true;
        total1400 += subSumObtained;
        total490 += isHifz ? subSumObtained : Number(((subSumObtained / 100) * 30).toFixed(1));
        totalEnteredObtained += subSumObtained;
        totalEnteredMaxPossible += subMaxPossible;
      }
    });

    const overallPct = totalEnteredMaxPossible > 0
      ? Number(((totalEnteredObtained / totalEnteredMaxPossible) * 100).toFixed(2))
      : 0;

    return {
      hasAnyData,
      total1400,
      total490: Number(total490.toFixed(1)),
      overallPct,
      getSubjectScore,
      getSubjectStatusPct
    };
  };

  const generateFilteredList = () => {
    const filtered = registeredStudents.filter((student) => {
      if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase();
        const name = (student.firstName || '').toLowerCase();
        const adNo = String(student.adNo || '').toLowerCase();
        const regNo = String(student.regNo || '').toLowerCase();
        if (!name.includes(query) && !adNo.includes(query) && !regNo.includes(query)) {
          return false;
        }
      }

      if (exportDepartment !== 'All' && (student.department || '').toUpperCase() !== exportDepartment.toUpperCase()) return false;
      if (exportClassFilter !== 'All' && !(student.classes || []).includes(exportClassFilter)) return false;

      if (auditPreset === 'ALL') return true;

      const metrics = computeStudentLocalMetrics(student);

      if (auditPreset === 'MISSING') {
        return !metrics.hasAnyData;
      }

      if (!metrics.hasAnyData) return false;

      if (auditPreset === 'FAIL') return metrics.overallPct < 40;
      if (auditPreset === 'TOP') return metrics.overallPct >= 80;

      if (auditPreset === 'CUSTOM') {
        let score = null;
        if (exportMetric === 'STATUS') score = metrics.overallPct;
        else if (exportMetric === 'SUBJECT_STATUS') score = metrics.getSubjectStatusPct(exportSubject);
        else if (exportMetric === '1400') score = metrics.total1400;
        else if (exportMetric === '490') score = metrics.total490;
        else if (exportMetric === 'SUBJECT') score = metrics.getSubjectScore(exportSubject);

        if (score === null || isNaN(score)) return false;
        if (thresholdCondition === 'Below' && score >= Number(thresholdScore)) return false;
        if (thresholdCondition === 'Above' && score < Number(thresholdScore)) return false;
      }

      return true;
    });

    const mappedResults = filtered.map((s) => {
      let printedMetric = 'Missing / -';
      const metrics = computeStudentLocalMetrics(s);

      if (auditPreset === 'FAIL' || auditPreset === 'TOP') {
        printedMetric = metrics.hasAnyData ? `${metrics.overallPct.toFixed(2)}%` : 'Missing / -';
      } else if (exportMetric === 'SUBJECT_STATUS') {
        const subPct = metrics.getSubjectStatusPct(exportSubject);
        printedMetric = subPct !== null ? `${subPct.toFixed(2)}%` : 'Missing / -';
      } else if (exportMetric === 'SUBJECT') {
        const subScore = metrics.getSubjectScore(exportSubject);
        printedMetric = subScore !== null ? subScore.toString() : 'Missing / -';
      } else if (metrics.hasAnyData) {
        if (exportMetric === 'STATUS') printedMetric = `${metrics.overallPct.toFixed(2)}%`;
        else if (exportMetric === '490') printedMetric = metrics.total490.toFixed(1);
        else if (exportMetric === '1400') printedMetric = metrics.total1400.toString();
      }

      return { ...s, displayMetric: printedMetric };
    });

    let sortedMappedResults = [...mappedResults];
    if (exportClassFilter !== 'All') {
      sortedMappedResults = sortStudentsByDepartment(sortedMappedResults, exportClassFilter);
    } else {
      sortedMappedResults.sort((a, b) => (Number(a.rollNo) || 999) - (Number(b.rollNo) || 999));
    }

    setFilteredResults(sortedMappedResults);
    if (sortedMappedResults.length === 0) setStatusMsg(`No students match the criteria.`);
    else setStatusMsg(`Found ${sortedMappedResults.length} students matching your filter criteria.`);
  };

  const totalStudentsCount = registeredStudents.length;
  const studentsWithMarks = registeredStudents.filter(s => {
    const stMarks = localFirebaseMarks[s.regNo] || localFirebaseMarks[s.id] || localFirebaseMarks[s.adNo];
    return stMarks && Object.keys(stMarks).length > 0;
  }).length;
  const missingMarksCount = totalStudentsCount - studentsWithMarks;

  // 🌟 UPGRADED INSPECTOR WITH PRIORITY SCORING (Fixes Munavir vs Shamsu Sir & Fiqh vs U:Fiqh)
 const fetchClassSubjectMarks = async () => {
    setIsInspecting(true);
    try {
      const studentSnap = await getDocs(collection(db, 'students'));
      const allStudents = [];
      studentSnap.forEach(docSnap => {
        allStudents.push({ id: docSnap.id, ...docSnap.data() });
      });

      const teacherSnap = await getDocs(collection(db, 'teachers'));
      const teachersList = [];
      teacherSnap.forEach(tDoc => {
        teachersList.push({ id: tDoc.id, fullName: tDoc.data().fullName, username: tDoc.data().username, enrollments: tDoc.data().enrollments || [] });
      });

      let activeSubject = '';
      let sorterAlias = '';
      let targetTeacherName = '';
      let targetEnv = null;

      if (inspectorMode === 'class') {
        activeSubject = inspectorSubject;
        sorterAlias = inspectorClass;
      } else if (inspectorMode === 'teacher') {
        const selectedTeacher = teachersList.find(t => t.username === inspectorTeacherUsername);
        targetEnv = selectedTeacher?.enrollments?.find(e => e.id === inspectorTeacherEnrollmentId);

        if (!targetEnv) {
          alert("No valid assignment selected for this teacher.");
          setIsInspecting(false);
          return;
        }

        const rawSub = (targetEnv.subject || '').trim();
        const rawAlias = (targetEnv.alias || '').trim();

        if (rawSub.toUpperCase() === 'U :FIQH' || rawSub.toUpperCase() === 'U:FIQH' || rawAlias.toUpperCase().includes('U :FIQH') || rawAlias.toUpperCase().includes('U:FIQH')) {
          activeSubject = 'U :FIQH';
        } else if (rawAlias.toUpperCase().includes('AQIDAH')) {
          activeSubject = 'Aqidah';
        } else if (rawAlias.toUpperCase().includes('LOGIC') || rawAlias.toUpperCase().includes('MANTIQ')) {
          activeSubject = 'Logic';
        } else if (rawSub.toUpperCase() === 'FIQH' || rawAlias.toUpperCase().includes('FIQH')) {
          activeSubject = 'FIQH';
        } else {
          activeSubject = rawSub;
        }

        sorterAlias = targetEnv.alias || '';
        targetTeacherName = selectedTeacher.fullName;
      }

      const marksRecord = {};
      const teacherRecord = {};
      let finalMatchedStudents = [];

      for (const student of allStudents) {
        const studentClassesLower = (student.classes || []).map(c => String(c).trim().toLowerCase());
        const sReg = String(student.regNo || '').trim().toUpperCase();
        const sAd = String(student.adNo || '').trim().toUpperCase();
        const sId = String(student.id || '').trim().toUpperCase();
        const isUrdu = sAd.startsWith('U');

        let stGrade = '1';
        if (studentClassesLower.some(c => c.includes('10') || c.includes('3'))) stGrade = '3';
        else if (studentClassesLower.some(c => c.includes('9') || c.includes('2'))) stGrade = '2';

        let assignedTeacher = 'Unassigned';
        let shouldInclude = false;

        if (inspectorMode === 'class') {
          const targetClassLower = inspectorClass.toLowerCase();
          let classMatch = studentClassesLower.some(c => c === targetClassLower || c.includes(targetClassLower));

          if (!classMatch) continue;
          shouldInclude = true;

          // 🌟 FIXED PRIORITY SCORING FOR INSPECTOR (Supports shared Urdu/General classes like HFC3 English & QH1 Adab)
          let bestScore = 0;
          for (const teacher of teachersList) {
            for (const env of (teacher.enrollments || [])) {
              if (!isStrictMatchingSubject(activeSubject, env.subject, env.alias)) continue;

              const envLang = String(env.langTag || '').trim().toLowerCase();
              const envAliasLower = String(env.alias || '').trim().toLowerCase();
              const envTargetLower = String(env.targetClass || '').trim().toLowerCase();

              let score = 0;

              // 1. Direct Student ID match (Highest Priority: 10)
              if (env.studentIds && env.studentIds.length > 0) {
                const savedIds = env.studentIds.map(id => String(id).trim().toUpperCase());
                if (savedIds.includes(sReg) || savedIds.includes(sAd) || savedIds.includes(sId)) {
                  score = 10;
                }
              }

              const isStrictlyUrduOnly = (envLang.includes('urdu') && !envLang.includes('non')) || /\bu(8|9|10)\b/.test(envAliasLower);
              const isStrictlyNonUrduOnly = envLang.includes('non-urdu') || envLang.includes('non urdu') || /\bm(8|9|10)\b/.test(envAliasLower);

              if (score === 0) {
                if (isStrictlyUrduOnly && !isUrdu) continue;
                if (isStrictlyNonUrduOnly && isUrdu) continue;

                // 2. Exact Class Match (e.g. HFC3 English, QH1 Adab, QH1 Social Science, QH1 Thamadun)
                const hasExactClass = studentClassesLower.some(cls => cls && (envAliasLower.includes(cls) || envTargetLower.includes(cls)));
                if (hasExactClass) {
                  if (isUrdu && isStrictlyUrduOnly) score = 6;
                  else if (!isUrdu && !isStrictlyUrduOnly) score = 6;
                  else score = 5; // Shared class (both Urdu & General students in QH1/HFC3 match!)
                }
              }

              // 3. Generic Grade Match (U8/M8, U9/M9, U10/M10)
              if (score === 0) {
                let gMatch = false;
                if (envAliasLower.includes('m10') && stGrade === '3' && !isUrdu) gMatch = true;
                if (envAliasLower.includes('m9') && stGrade === '2' && !isUrdu) gMatch = true;
                if (envAliasLower.includes('m8') && stGrade === '1' && !isUrdu) gMatch = true;
                if (envAliasLower.includes('u10') && stGrade === '3' && isUrdu) gMatch = true;
                if (envAliasLower.includes('u9') && stGrade === '2' && isUrdu) gMatch = true;
                if (envAliasLower.includes('u8') && stGrade === '1' && isUrdu) gMatch = true;

                if (!gMatch && (envAliasLower.includes(`grade ${stGrade}`) || envTargetLower.includes(`grade ${stGrade}`))) {
                  if (!(envLang.includes('gen') && isUrdu)) gMatch = true;
                }
                if (gMatch) score = 3;
              }

              if (score > bestScore) {
                bestScore = score;
                assignedTeacher = teacher.fullName;
              }
            }
          }
        } else if (inspectorMode === 'teacher') {
          if (!targetEnv) continue;

          const envAliasLower = String(targetEnv.alias || '').trim().toLowerCase();
          const envTargetLower = String(targetEnv.targetClass || '').trim().toLowerCase();
          const envLang = String(targetEnv.langTag || '').trim().toLowerCase();

          let matchesEnv = false;

          if (targetEnv.studentIds && targetEnv.studentIds.length > 0) {
            const savedIds = targetEnv.studentIds.map(id => String(id).trim().toUpperCase());
            if (savedIds.includes(sReg) || savedIds.includes(sAd) || savedIds.includes(sId)) matchesEnv = true;
          }

          if (!matchesEnv) {
            const isStrictlyUrduOnly = (envLang.includes('urdu') && !envLang.includes('non')) || /\bu(8|9|10)\b/.test(envAliasLower);
            const isStrictlyNonUrduOnly = envLang.includes('non-urdu') || envLang.includes('non urdu') || /\bm(8|9|10)\b/.test(envAliasLower);

            if (!(isStrictlyUrduOnly && !isUrdu) && !(isStrictlyNonUrduOnly && isUrdu)) {
              let hasExactClass = studentClassesLower.some(cls => cls && (envAliasLower.includes(cls) || envTargetLower.includes(cls)));
              if (hasExactClass) {
                matchesEnv = true;
              } else {
                let gMatch = false;
                if (envAliasLower.includes('m10') && stGrade === '3' && !isUrdu) gMatch = true;
                if (envAliasLower.includes('m9') && stGrade === '2' && !isUrdu) gMatch = true;
                if (envAliasLower.includes('m8') && stGrade === '1' && !isUrdu) gMatch = true;
                if (envAliasLower.includes('u10') && stGrade === '3' && isUrdu) gMatch = true;
                if (envAliasLower.includes('u9') && stGrade === '2' && isUrdu) gMatch = true;
                if (envAliasLower.includes('u8') && stGrade === '1' && isUrdu) gMatch = true;
                if (gMatch) matchesEnv = true;
              }
            }
          }

          if (!matchesEnv) continue;
          shouldInclude = true;
          assignedTeacher = targetTeacherName;
        }

        if (!shouldInclude) continue;

        teacherRecord[student.regNo || student.id] = assignedTeacher;
        finalMatchedStudents.push(student);

        const studentMarksData = localFirebaseMarks[student.regNo] || localFirebaseMarks[student.id] || localFirebaseMarks[student.adNo];
        if (studentMarksData) {
          const foundSubjectKey = Object.keys(studentMarksData).find(k => {
            const kUp = k.trim().toUpperCase();
            const actUp = activeSubject.trim().toUpperCase();
            const isActUsul = actUp === 'U :FIQH' || actUp === 'U:FIQH';
            const isKUpUsul = kUp === 'U :FIQH' || kUp === 'U:FIQH';
            if (isActUsul) return isKUpUsul;
            if (actUp === 'FIQH') return kUp === 'FIQH' && !isKUpUsul;
            if (actUp === 'LOGIC' || actUp === 'MANTIQ') return kUp === 'LOGIC' || kUp === 'MANTIQ';
            return kUp === actUp;
          });
          marksRecord[student.regNo || student.id] = foundSubjectKey ? studentMarksData[foundSubjectKey] : {};
        } else {
          marksRecord[student.regNo || student.id] = {};
        }
      }

      const safeSorterAlias = sorterAlias || inspectorClass || '';
      finalMatchedStudents = sortStudentsByDepartment(finalMatchedStudents, safeSorterAlias);
      setSubjectLevelMarks({ students: finalMatchedStudents, records: marksRecord, teachers: teacherRecord });

    } catch (err) {
      console.error('Error fetching subject level marks:', err);
      alert("Error generating report: " + err.message);
    } finally {
      setIsInspecting(false);
    }
  };
  const handleForceSyncAllToSheets = async () => {
    if (!window.confirm("This will push all database marks to Google Sheets in safe sequential batches. Continue?")) return;

    setIsLoading(true);
    setStatusMsg('Gathering all marks from database...');

    try {
      const marksSnap = await getDocs(collection(db, 'marks'));
      const batchMap = {};

      marksSnap.forEach(docSnap => {
        const studentId = docSnap.id;
        const data = docSnap.data();

        Object.keys(data).forEach(subjectKey => {
          const levels = data[subjectKey];
          Object.keys(levels).forEach(levelMax => {
            const rawScore = levels[levelMax];
            if (rawScore !== undefined && rawScore !== '') {
              const stObj = (adminStudentsList || []).find(s => s.regNo === studentId || s.id === studentId || s.adNo === studentId);
              const targetClassStr = stObj ? String(stObj.class || (stObj.classes || [])[0] || '').trim().toUpperCase() : '';

              // Skip Specialization (max 30) from Google Sheets per system specs
              if (String(subjectKey).toUpperCase().includes('SPECIALIZATION') || String(levelMax) === '30') return;
              if (!targetClassStr) return;

              const batchKey = `${targetClassStr}___${subjectKey}___${levelMax}`;
              if (!batchMap[batchKey]) {
                batchMap[batchKey] = {
                  targetClass: targetClassStr,
                  subject: subjectKey,
                  maxMarks: levelMax,
                  marks: []
                };
              }

              batchMap[batchKey].marks.push({
                studentId: studentId,
                regNo: studentId,
                adNo: stObj?.adNo || '',
                targetClass: targetClassStr,
                class: targetClassStr,
                subject: subjectKey,
                maxMarks: levelMax,
                marksObtained: rawScore,
                score: rawScore
              });
            }
          });
        });
      });

      const batches = Object.values(batchMap);

      if (batches.length === 0) {
        setStatusMsg('No marks found in database to sync.');
        setIsLoading(false);
        return;
      }

      let totalSyncedMarks = 0;
      let failedBatches = 0;
      let lastErrMsg = '';

      for (let i = 0; i < batches.length; i++) {
        const b = batches[i];
        setStatusMsg(`⏳ Syncing batch ${i + 1} of ${batches.length}: Class ${b.targetClass} • ${b.subject} (${b.maxMarks}M) [${b.marks.length} students]...`);

        try {
          const res = await fetch(WEB_APP_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({
              targetClass: b.targetClass,
              subject: b.subject,
              maxMarks: b.maxMarks,
              marks: b.marks
            })
          });

          const result = await res.json();
          if (result.status === 'success') {
            totalSyncedMarks += b.marks.length;
          } else {
            failedBatches++;
            lastErrMsg = result.message || 'Unknown error';
            console.warn(`Batch ${b.targetClass} ${b.subject} warning:`, result.message);
          }
        } catch (postErr) {
          failedBatches++;
          lastErrMsg = postErr.message;
          console.error(`Batch ${b.targetClass} ${b.subject} network error:`, postErr);
        }

        // Brief 150ms pacing between batches to respect Google Sheets write lock
        await new Promise(r => setTimeout(r, 150));
      }

      if (failedBatches === 0) {
        setStatusMsg(`✅ Successfully synced ALL ${totalSyncedMarks} marks across ${batches.length} course batches to Google Sheets!`);
      } else {
        setStatusMsg(`⚠️ Completed: ${totalSyncedMarks} marks synced. (${failedBatches} batches failed or had non-standard columns: ${lastErrMsg})`);
      }
    } catch (err) {
      console.error(err);
      setStatusMsg('❌ Error gathering marks from database: ' + err.message);
    }
    setIsLoading(false);
  };

  const generateAnalytics = async () => {
    setIsFetchingAnalytics(true);
    try {
      let targetEnrollments = [];

      if (analyticsMode === 'grade') {
        allTeachers.forEach(t => {
          (t.enrollments || []).forEach(env => {
            const envAliasLower = String(env.alias || '').trim().toLowerCase();
            let envGrade = '1';
            if (envAliasLower.includes('10') || envAliasLower.includes('3')) envGrade = '3';
            else if (envAliasLower.includes('9') || envAliasLower.includes('2')) envGrade = '2';
            else if (String(env.grade) === '3') envGrade = '3';
            else if (String(env.grade) === '2') envGrade = '2';

            if (envGrade === analyticsGrade) {
              targetEnrollments.push({ ...env, teacherName: t.fullName });
            }
          });
        });
      } else {
        const t = allTeachers.find(x => x.username === analyticsTeacherUsername);
        if (t) targetEnrollments = (t.enrollments || []).map(env => ({ ...env, teacherName: t.fullName }));
      }

      const results = [];
      const allMarks = localFirebaseMarks;

      for (const env of targetEnrollments) {
        const envAliasLower = String(env.alias || '').trim().toLowerCase();
        const envLang = (env.langTag || '').toLowerCase();

        const matchedStudents = registeredStudents.filter(student => {
          const studentClassesLower = (student.classes || []).map(c => String(c).trim().toLowerCase());
          const isUrdu = String(student.adNo || '').toUpperCase().startsWith('U');

          if (env.studentIds && Array.isArray(env.studentIds) && env.studentIds.length > 0) {
            const savedIds = env.studentIds.map(id => String(id).trim());
            if (savedIds.includes(student.regNo) || savedIds.includes(student.adNo)) return true;
          }

          let classMatch = studentClassesLower.some(cls => envAliasLower.includes(cls));
          if (!classMatch && envAliasLower.includes('m10')) {
            if (studentClassesLower.some(cls => cls.includes('3')) && !isUrdu) classMatch = true;
          }

          if (classMatch) {
            if (envLang.includes('urdu') && !envLang.includes('non')) return isUrdu;
            if (envLang.includes('gen') || envLang.includes('non') || envLang === '') return !isUrdu;
            return true;
          }
          return false;
        });

        let sum15 = 0, sum20 = 0, sum25 = 0, sum40 = 0, sum100 = 0;

        let exactSubject = (env.alias?.toUpperCase().includes('U :FIQH') || env.subject?.toUpperCase().includes('U :FIQH')) ? 'U :FIQH' : (env.subject || '').trim();
        let isEnvHifz = exactSubject.toUpperCase() === 'HIFZ';

        matchedStudents.forEach(st => {
          const stMarksData = allMarks[st.regNo] || allMarks[st.id] || allMarks[st.adNo];
          if (stMarksData) {
            const foundSubjectKey = Object.keys(stMarksData).find(k => {
              const kUp = k.trim().toUpperCase();
              const actUp = exactSubject.trim().toUpperCase();
              if (actUp.includes('U :FIQH') || actUp.includes('U:FIQH')) return kUp.includes('U :FIQH') || kUp.includes('U:FIQH');
              if (actUp === 'FIQH') return kUp === 'FIQH';
              return kUp === actUp;
            });

            if (foundSubjectKey && stMarksData[foundSubjectKey]) {
              const m = stMarksData[foundSubjectKey];
              let t100 = 0;
              if (isEnvHifz) {
                if (m['50_1'] !== undefined && m['50_1'] !== '') { sum15 += parseFloat(m['50_1']); t100 += parseFloat(m['50_1']); }
                if (m['50_2'] !== undefined && m['50_2'] !== '') { sum20 += parseFloat(m['50_2']); t100 += parseFloat(m['50_2']); }
              } else {
                if (m['15'] !== undefined && m['15'] !== '') { sum15 += parseFloat(m['15']); t100 += parseFloat(m['15']); }
                if (m['20'] !== undefined && m['20'] !== '') { sum20 += parseFloat(m['20']); t100 += parseFloat(m['20']); }
                if (m['25'] !== undefined && m['25'] !== '') { sum25 += parseFloat(m['25']); t100 += parseFloat(m['25']); }
                if (m['40'] !== undefined && m['40'] !== '') { sum40 += parseFloat(m['40']); t100 += parseFloat(m['40']); }
              }
              sum100 += t100;
            }
          }
        });

        const totalEnrolled = matchedStudents.length;

        results.push({
          id: env.id,
          subjectName: env.alias || env.subject,
          teacherName: env.teacherName,
          avg15: totalEnrolled > 0 ? (sum15 / totalEnrolled).toFixed(1) : '-',
          avg20: totalEnrolled > 0 ? (sum20 / totalEnrolled).toFixed(1) : '-',
          avg25: isEnvHifz ? '-' : (totalEnrolled > 0 ? (sum25 / totalEnrolled).toFixed(1) : '-'),
          avg40: isEnvHifz ? '-' : (totalEnrolled > 0 ? (sum40 / totalEnrolled).toFixed(1) : '-'),
          avg100: totalEnrolled > 0 ? (sum100 / totalEnrolled).toFixed(1) : '-',
          avg30: isEnvHifz ? '-' : (totalEnrolled > 0 ? (((sum100 / totalEnrolled) / 100) * 30).toFixed(1) : '-'),
          studentCount: totalEnrolled
        });
      }

      setAnalyticsData(results);
    } catch (error) {
      console.error(error);
      alert("Failed to load averages. Error: " + error.message);
    } finally {
      setIsFetchingAnalytics(false);
    }
  };

  // ==========================================
  // 🌟 4. BATCH STUDENT FILTER & ASSIGNMENT HANDLERS
  // ==========================================
  // EXPORT HANDLERS
  // ==========================================
  const handleDownloadExcel = () => {
    if (filteredResults.length === 0) return;
    let csvContent = 'data:text/csv;charset=utf-8,Roll No,Ad.No,First Name,Department,Class,Metric Value\n';
    filteredResults.forEach((s) => {
      csvContent += `${s.rollNo || ''},${s.adNo || ''},"${s.firstName || ''}",${s.department || ''},"${(s.classes || []).join(', ')}",${s.displayMetric || '-'}\n`;
    });
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Filtered_Report_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCopyToClipboard = () => {
    if (filteredResults.length === 0) return;
    let tsvContent = 'Roll No\tAd.No\tFirst Name\tDepartment\tClass\tMetric Value\n';
    filteredResults.forEach((s) => {
      tsvContent += `${s.rollNo || ''}\t${s.adNo || ''}\t${s.firstName || ''}\t${s.department || ''}\t${(s.classes || []).join(', ')}\t${s.displayMetric || '-'}\n`;
    });

    navigator.clipboard.writeText(tsvContent).then(() => {
      alert('Successfully copied table to clipboard!');
    }).catch((err) => {
      alert('Failed to copy to clipboard: ' + err);
    });
  };

  let isHifzInsp = false;
  if (inspectorMode === 'class') {
    isHifzInsp = inspectorSubject.toUpperCase() === 'HIFZ';
  } else {
    const selectedTeacher = allTeachers.find(t => t.username === inspectorTeacherUsername);
    const selectedEnv = selectedTeacher?.enrollments?.find(e => e.id === inspectorTeacherEnrollmentId);
    isHifzInsp = selectedEnv?.subject?.toUpperCase() === 'HIFZ';
  }

  const handleDownloadInspectorExcel = () => {
    if (!subjectLevelMarks.students || subjectLevelMarks.students.length === 0) return alert("No data to download.");

    let csvContent = isHifzInsp
      ? 'data:text/csv;charset=utf-8,Roll,Ad.No,Student Name,Reg.No,Part 1 (50),Part 2 (50),-,-,Total (/100),Scaled (/30)'
      : 'data:text/csv;charset=utf-8,Roll,Ad.No,Student Name,Reg.No,Lvl 1 (15),Lvl 2 (20),Lvl 3 (25),Lvl 4 (40),Total (/100),Scaled (/30)';
    if (inspectorMode === 'class') csvContent += ',Teacher';
    csvContent += '\n';

    subjectLevelMarks.students.forEach((student) => {
      const marks = subjectLevelMarks.records[student.regNo || student.id] || {};
      const teacherName = subjectLevelMarks.teachers[student.regNo || student.id] || 'Unassigned';
      const m1 = parseFloat(marks[isHifzInsp ? '50_1' : '15']) || 0;
      const m2 = parseFloat(marks[isHifzInsp ? '50_2' : '20']) || 0;
      const m3 = isHifzInsp ? 0 : (parseFloat(marks['25']) || 0);
      const m4 = isHifzInsp ? 0 : (parseFloat(marks['40']) || 0);
      const total100 = m1 + m2 + m3 + m4;
      const scaled30 = isHifzInsp ? '-' : (total100 > 0 ? ((total100 / 100) * 30).toFixed(1) : '-');

      const safeName = (student.firstName || '').replace(/"/g, '""');
      const c1 = marks[isHifzInsp ? '50_1' : '15'] ?? '-';
      const c2 = marks[isHifzInsp ? '50_2' : '20'] ?? '-';
      const c3 = isHifzInsp ? '-' : (marks['25'] ?? '-');
      const c4 = isHifzInsp ? '-' : (marks['40'] ?? '-');

      csvContent += `${student.rollNo || '-'},${student.adNo},"${safeName}",${student.regNo},${c1},${c2},${c3},${c4},${total100 > 0 ? total100 : '-'},${scaled30}`;
      if (inspectorMode === 'class') csvContent += `,"${teacherName}"`;
      csvContent += '\n';
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Mark_Inspector_${new Date().toLocaleDateString().replace(/\//g, '-')}.csv`);
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const handleCopyInspectorToClipboard = () => {
    if (!subjectLevelMarks.students || subjectLevelMarks.students.length === 0) return alert("No data to copy.");

    let tsvContent = isHifzInsp
      ? 'Roll\tAd.No\tStudent Name\tReg.No\tPart 1 (50)\tPart 2 (50)\t-\t-\tTotal (/100)\tScaled (/30)'
      : 'Roll\tAd.No\tStudent Name\tReg.No\tLvl 1 (15)\tLvl 2 (20)\tLvl 3 (25)\tLvl 4 (40)\tTotal (/100)\tScaled (/30)';
    if (inspectorMode === 'class') tsvContent += '\tTeacher';
    tsvContent += '\n';

    subjectLevelMarks.students.forEach((student) => {
      const marks = subjectLevelMarks.records[student.regNo || student.id] || {};
      const teacherName = subjectLevelMarks.teachers[student.regNo || student.id] || 'Unassigned';
      const m1 = parseFloat(marks[isHifzInsp ? '50_1' : '15']) || 0;
      const m2 = parseFloat(marks[isHifzInsp ? '50_2' : '20']) || 0;
      const m3 = isHifzInsp ? 0 : (parseFloat(marks['25']) || 0);
      const m4 = isHifzInsp ? 0 : (parseFloat(marks['40']) || 0);
      const total100 = m1 + m2 + m3 + m4;
      const scaled30 = isHifzInsp ? '-' : (total100 > 0 ? ((total100 / 100) * 30).toFixed(1) : '-');

      const c1 = marks[isHifzInsp ? '50_1' : '15'] ?? '-';
      const c2 = marks[isHifzInsp ? '50_2' : '20'] ?? '-';
      const c3 = isHifzInsp ? '-' : (marks['25'] ?? '-');
      const c4 = isHifzInsp ? '-' : (marks['40'] ?? '-');

      tsvContent += `${student.rollNo || '-'}\t${student.adNo}\t${student.firstName || ''}\t${student.regNo}\t${c1}\t${c2}\t${c3}\t${c4}\t${total100 > 0 ? total100 : '-'}\t${scaled30}`;
      if (inspectorMode === 'class') tsvContent += `\t${teacherName}`;
      tsvContent += '\n';
    });

    navigator.clipboard.writeText(tsvContent).then(() => alert('✅ Inspector Table copied to clipboard!'));
  };

  const handleDownloadAnalyticsExcel = () => {
    if (!analyticsData || analyticsData.length === 0) return alert("No data to download.");
    let csvContent = 'data:text/csv;charset=utf-8,Subject / Assignment,Teacher,Students,Avg Lvl 1 (15),Avg Lvl 2 (20),Avg Lvl 3 (25),Avg Lvl 4 (40),Avg Total (/100),Avg Scaled (/30)\n';

    analyticsData.forEach((row) => {
      csvContent += `"${row.subjectName}","${row.teacherName || 'Unknown'}",${row.studentCount},${row.avg15},${row.avg20},${row.avg25},${row.avg40},${row.avg100},${row.avg30}\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Averages_Analytics_${new Date().toLocaleDateString().replace(/\//g, '-')}.csv`);
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const handleCopyAnalyticsToClipboard = () => {
    if (!analyticsData || analyticsData.length === 0) return alert("No data to copy.");
    let tsvContent = 'Subject / Assignment\tTeacher\tStudents\tAvg Lvl 1 (15)\tAvg Lvl 2 (20)\tAvg Lvl 3 (25)\tAvg Lvl 4 (40)\tAvg Total (/100)\tAvg Scaled (/30)\n';

    analyticsData.forEach((row) => {
      tsvContent += `${row.subjectName}\t${row.teacherName || 'Unknown'}\t${row.studentCount}\t${row.avg15}\t${row.avg20}\t${row.avg25}\t${row.avg40}\t${row.avg100}\t${row.avg30}\n`;
    });

    navigator.clipboard.writeText(tsvContent).then(() => alert('✅ Analytics Table copied to clipboard!'));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>

      {/* 🌟 1. ADVANCED STUDENT MARKS AUDITOR */}
      <div style={styles.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h3 style={{ margin: '0 0 6px 0', fontSize: '20px', color: '#0f172a', fontWeight: '800' }}>⚡ Student Marks Auditor & Filter</h3>
            <p style={{ margin: 0, fontSize: '15px', color: '#64748b' }}>Instant multi-parameter audit across all registered students without external quotas.</p>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={handleRepairMislabeledTeacherSubjects}
              style={{ padding: '8px 14px', background: '#fef3c7', color: '#92400e', border: '1px solid #f59e0b', borderRadius: '8px', fontWeight: '800', fontSize: '12px', cursor: 'pointer' }}
            >
              🛠️ Auto-Fix Mislabeled Teacher Subjects (Aqidah/Logic under English)
            </button>
            <span style={{ fontSize: '13px', color: '#047857', background: '#ecfdf5', padding: '6px 14px', borderRadius: '20px', fontWeight: '800', border: '1px solid #a7f3d0' }}>
              ⚡ 100% Free & Realtime
            </span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '28px' }}>
          <div style={{ padding: '20px', borderRadius: '12px', background: '#f8fafc', border: '1px solid #e2e8f0', textAlign: 'center' }}>
            <span style={{ fontSize: '12px', fontWeight: '800', color: '#64748b', letterSpacing: '0.5px' }}>TOTAL ENROLLED</span>
            <div style={{ fontSize: '24px', fontWeight: '800', color: '#0f172a', marginTop: '8px' }}>{totalStudentsCount}</div>
          </div>
          <div style={{ padding: '20px', borderRadius: '12px', background: '#ecfdf5', border: '1px solid #a7f3d0', textAlign: 'center' }}>
            <span style={{ fontSize: '12px', fontWeight: '800', color: '#047857', letterSpacing: '0.5px' }}>MARKS RECORDED</span>
            <div style={{ fontSize: '24px', fontWeight: '800', color: '#047857', marginTop: '8px' }}>{studentsWithMarks}</div>
          </div>
          <div style={{ padding: '20px', borderRadius: '12px', background: '#fee2e2', border: '1px solid #fecaca', textAlign: 'center' }}>
            <span style={{ fontSize: '12px', fontWeight: '800', color: '#991b1b', letterSpacing: '0.5px' }}>MISSING / INCOMPLETE</span>
            <div style={{ fontSize: '24px', fontWeight: '800', color: '#dc2626', marginTop: '8px' }}>{missingMarksCount}</div>
          </div>
          <div style={{ padding: '20px', borderRadius: '12px', background: '#eff6ff', border: '1px solid #bfdbfe', textAlign: 'center' }}>
            <span style={{ fontSize: '12px', fontWeight: '800', color: '#1e40af', letterSpacing: '0.5px' }}>COMPLETION RATE</span>
            <div style={{ fontSize: '24px', fontWeight: '800', color: '#2563eb', marginTop: '8px' }}>
              {totalStudentsCount > 0 ? `${((studentsWithMarks / totalStudentsCount) * 100).toFixed(0)}%` : '0%'}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '20px' }}>
          <div>
            <label style={styles.label}>Quick Status Preset:</label>
            <select value={auditPreset} onChange={(e) => setAuditPreset(e.target.value)} style={{ ...styles.input, fontWeight: '700' }}>
              <option value="ALL">Show All Students</option>
              <option value="MISSING">⚠ Missing / Zero Marks Only</option>
              <option value="FAIL">📉 Needs Attention (&lt; 40%)</option>
              <option value="TOP">⭐ Top Achievers (&ge; 80%)</option>
              <option value="CUSTOM">⚙ Custom Score Threshold</option>
            </select>
          </div>

          <div>
            <label style={styles.label}>Search by Name / Ad.No:</label>
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Type student name or Ad.No..." style={styles.input} />
          </div>

          <div>
            <label style={styles.label}>Class Filter:</label>
            <select value={exportClassFilter} onChange={(e) => setExportClassFilter(e.target.value)} style={styles.input}>
              <option value="All">All Classes</option>
              {DEFAULT_CLASSES.map(cls => <option key={cls} value={cls}>{cls}</option>)}
            </select>
          </div>

          <div>
            <label style={styles.label}>Department:</label>
            <select value={exportDepartment} onChange={(e) => setExportDepartment(e.target.value)} style={styles.input}>
              <option value="All">All Departments</option>
              {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>

        {auditPreset === 'CUSTOM' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px', padding: '20px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '20px' }}>
            <div>
              <label style={styles.label}>Metric:</label>
              <select value={exportMetric} onChange={(e) => setExportMetric(e.target.value)} style={styles.input}>
                <option value="STATUS">Current Status Percentage (%)</option>
                <option value="SUBJECT_STATUS">Specific Subject Current Status (%)</option>
                <option value="490">Total out of 490</option>
                <option value="1400">Total out of 1400</option>
                <option value="SUBJECT">Specific Subject Scaled (/30)</option>
              </select>
            </div>
            {(exportMetric === 'SUBJECT' || exportMetric === 'SUBJECT_STATUS') && (
              <div>
                <label style={styles.label}>Subject:</label>
                <select value={exportSubject} onChange={(e) => setExportSubject(e.target.value)} style={styles.input}>
                  {DEFAULT_SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            )}
            <div>
              <label style={styles.label}>Rule:</label>
              <div style={{ display: 'flex', gap: '10px' }}>
                <select value={thresholdCondition} onChange={(e) => setThresholdCondition(e.target.value)} style={{ ...styles.input, flex: 1 }}>
                  <option value="Below">Below</option>
                  <option value="Above">Above or Equal</option>
                </select>
                <input type="number" value={thresholdScore} onChange={(e) => setThresholdScore(e.target.value)} style={{ ...styles.input, flex: 1 }} />
              </div>
            </div>
          </div>
        )}

        <button onClick={generateFilteredList} style={{ ...styles.buttonPrimary, width: '100%', background: '#2563eb', padding: '16px', fontSize: '16px', fontWeight: '800' }}>
          🔍 Run Filter & Audit List
        </button>
        <button onClick={handleForceSyncAllToSheets} disabled={isLoading} style={{ ...styles.buttonPrimary, width: '100%', background: '#059669', padding: '16px', fontSize: '16px', fontWeight: '800', marginTop: '12px' }}>
          {isLoading ? 'Syncing with Google Sheets...' : '🟢 Force Sync ALL Marks to Google Sheets'}
        </button>

        {statusMsg && (
          <div style={{ marginTop: '20px', padding: '16px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', color: '#166534', fontWeight: '700' }}>
            {statusMsg}
          </div>
        )}

        {filteredResults.length > 0 && (
          <div style={{ border: '1px solid #cbd5e1', borderRadius: '12px', overflow: 'hidden', marginTop: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '16px 20px', borderBottom: '1px solid #cbd5e1', flexWrap: 'wrap', gap: '12px' }}>
              <h4 style={{ margin: 0, color: '#0f172a', fontWeight: '800', fontSize: '16px' }}>Audit Results ({filteredResults.length} students)</h4>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={handleCopyToClipboard} style={{ padding: '8px 16px', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '700', cursor: 'pointer', fontSize: '14px' }}>📋 Copy Table</button>
                <button onClick={handleDownloadExcel} style={{ padding: '8px 16px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '700', cursor: 'pointer', fontSize: '14px' }}>📊 Download CSV</button>
              </div>
            </div>

            <div style={{ overflowX: 'auto', maxHeight: '400px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '15px', minWidth: '700px' }}>
                <thead style={{ position: 'sticky', top: 0, background: '#ffffff', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                  <tr style={{ borderBottom: '2px solid #cbd5e1' }}>
                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', width: '100px' }}>Ad.No</th>
                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800' }}>Name</th>
                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', width: '150px' }}>Department</th>
                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', width: '120px' }}>Class</th>
                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', width: '180px', textAlign: 'right' }}>
                      {(auditPreset === 'FAIL' || auditPreset === 'TOP' || exportMetric === 'STATUS')
                        ? 'Current Status (%)'
                        : exportMetric === 'SUBJECT_STATUS'
                          ? `${exportSubject} Status (%)`
                          : exportMetric === '490'
                            ? 'Score (/490)'
                            : exportMetric === '1400'
                              ? 'Score (/1400)'
                              : `${exportSubject} Score`}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredResults.map((student, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0', background: idx % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                      <td style={{ padding: '14px 16px', fontWeight: '800', color: '#0f172a', verticalAlign: 'middle' }}>{student.adNo}</td>
                      <td style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '700', verticalAlign: 'middle' }}>{student.firstName}</td>
                      <td style={{ padding: '14px 16px', verticalAlign: 'middle' }}>
                        <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '6px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '800' }}>{student.department || 'GENERAL'}</span>
                      </td>
                      <td style={{ padding: '14px 16px', color: '#334155', fontWeight: '700', verticalAlign: 'middle' }}>{(student.classes || []).join(', ')}</td>
                      <td style={{ padding: '14px 16px', textAlign: 'right', verticalAlign: 'middle' }}>
                        <span style={{ color: String(student.displayMetric).includes('Missing') ? '#dc2626' : '#047857', fontWeight: '800', fontSize: '16px' }}>{student.displayMetric}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* 🌟 2. LEVEL-BY-LEVEL INSPECTOR */}
      <div style={styles.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
          <h3 style={styles.sectionTitle}>🔍 Level-by-Level Mark Inspector</h3>
        </div>

        <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
          <button onClick={() => { setInspectorMode('class'); setSubjectLevelMarks({}); }} style={{ padding: '12px 20px', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', border: '1px solid #cbd5e1', background: inspectorMode === 'class' ? '#2563eb' : '#f8fafc', color: inspectorMode === 'class' ? '#ffffff' : '#334155', fontSize: '14px' }}>
            Filter by Class & Subject
          </button>
          <button onClick={() => { setInspectorMode('teacher'); setSubjectLevelMarks({}); }} style={{ padding: '12px 20px', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', border: '1px solid #cbd5e1', background: inspectorMode === 'teacher' ? '#2563eb' : '#f8fafc', color: inspectorMode === 'teacher' ? '#ffffff' : '#334155', fontSize: '14px' }}>
            Filter by Teacher
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '24px' }}>
          {inspectorMode === 'class' && (
            <>
              <div>
                <label style={styles.label}>Select Class Group:</label>
                <select value={inspectorClass} onChange={(e) => setInspectorClass(e.target.value)} style={styles.input}>
                  {DEFAULT_CLASSES.map(cls => <option key={cls} value={cls}>{cls}</option>)}
                </select>
              </div>
              <div>
                <label style={styles.label}>Select Subject:</label>
                <select value={inspectorSubject} onChange={(e) => setInspectorSubject(e.target.value)} style={styles.input}>
                  {DEFAULT_SUBJECTS.map(sub => <option key={sub} value={sub}>{sub}</option>)}
                </select>
              </div>
            </>
          )}

          {inspectorMode === 'teacher' && (
            <>
              <div>
                <label style={styles.label}>Select Teacher:</label>
                <select
                  value={inspectorTeacherUsername}
                  onChange={(e) => {
                    setInspectorTeacherUsername(e.target.value);
                    const teacher = allTeachers.find(t => t.username === e.target.value);
                    if (teacher && teacher.enrollments?.length > 0) {
                      setInspectorTeacherEnrollmentId(teacher.enrollments[0].id);
                    } else {
                      setInspectorTeacherEnrollmentId('');
                    }
                  }}
                  style={styles.input}
                >
                  {allTeachers.map(t => <option key={t.username} value={t.username}>{t.fullName}</option>)}
                </select>
              </div>
              <div>
                <label style={styles.label}>Select Assignment:</label>
                <select value={inspectorTeacherEnrollmentId} onChange={(e) => setInspectorTeacherEnrollmentId(e.target.value)} style={styles.input}>
                  {allTeachers.find(t => t.username === inspectorTeacherUsername)?.enrollments?.map(env => (
                    <option key={env.id} value={env.id}>{env.alias || `${env.grade} ${env.subject}`} ({env.langTag || 'Gen'})</option>
                  )) || <option value="">No assignments found</option>}
                </select>
              </div>
            </>
          )}

          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button
              onClick={fetchClassSubjectMarks}
              disabled={inspectorMode === 'teacher' && !inspectorTeacherEnrollmentId}
              style={{ ...styles.buttonPrimary, width: '100%', background: '#0284c7', padding: '12px', fontWeight: '800', opacity: (inspectorMode === 'teacher' && !inspectorTeacherEnrollmentId) ? 0.5 : 1 }}
            >
              {isInspecting ? 'Loading...' : 'Inspect Marks'}
            </button>
          </div>
        </div>

        {subjectLevelMarks.students && subjectLevelMarks.students.length > 0 && (
          <div style={{ marginTop: '24px', border: '1px solid #cbd5e1', borderRadius: '12px', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '16px 20px', borderBottom: '1px solid #cbd5e1', flexWrap: 'wrap', gap: '12px' }}>
              <h4 style={{ margin: 0, color: '#0f172a', fontWeight: '800', fontSize: '16px' }}>
                Inspector Results ({subjectLevelMarks.students.length} students)
              </h4>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={handleCopyInspectorToClipboard} style={{ padding: '8px 16px', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}>📋 Copy Table</button>
                <button onClick={handleDownloadInspectorExcel} style={{ padding: '8px 16px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}>📊 Download CSV</button>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '15px', minWidth: '950px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #cbd5e1' }}>
                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', width: '60px' }}>Roll</th>
                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', width: '100px' }}>Ad.No</th>
                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800' }}>Student Name</th>
                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', width: '90px' }}>{isHifzInsp ? 'Part 1 (50)' : 'Lvl 1 (15)'}</th>
                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', width: '90px' }}>{isHifzInsp ? 'Part 2 (50)' : 'Lvl 2 (20)'}</th>
                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', width: '90px' }}>{isHifzInsp ? '-' : 'Lvl 3 (25)'}</th>
                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', width: '90px' }}>{isHifzInsp ? '-' : 'Lvl 4 (40)'}</th>
                    <th style={{ padding: '14px 16px', color: '#1e40af', fontWeight: '800', width: '100px' }}>Total (/100)</th>
                    <th style={{ padding: '14px 16px', color: '#047857', fontWeight: '800', width: '100px' }}>Scaled (/30)</th>
                    {inspectorMode === 'class' && <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', width: '160px' }}>Teacher</th>}
                  </tr>
                </thead>
                <tbody>
                  {subjectLevelMarks.students.map((student, idx) => {
                    const marks = subjectLevelMarks.records[student.regNo || student.id] || {};
                    const teacherName = subjectLevelMarks.teachers[student.regNo || student.id] || 'Unassigned';
                    const m1 = parseFloat(marks[isHifzInsp ? '50_1' : '15']) || 0;
                    const m2 = parseFloat(marks[isHifzInsp ? '50_2' : '20']) || 0;
                    const m3 = isHifzInsp ? 0 : (parseFloat(marks['25']) || 0);
                    const m4 = isHifzInsp ? 0 : (parseFloat(marks['40']) || 0);
                    const total100 = m1 + m2 + m3 + m4;
                    const scaled30 = isHifzInsp ? '-' : (total100 > 0 ? ((total100 / 100) * 30).toFixed(1) : '-');

                    return (
                      <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0', background: idx % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                        <td style={{ padding: '14px 16px', fontWeight: '800', color: '#0f172a', verticalAlign: 'middle' }}>{student.rollNo || '-'}</td>
                        <td style={{ padding: '14px 16px', fontWeight: '800', color: '#0f172a', verticalAlign: 'middle' }}>{student.adNo}</td>
                        <td style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '700', verticalAlign: 'middle' }}>
                          {student.firstName}
                          <br />
                          <span style={{ fontSize: '13px', color: '#64748b', fontWeight: '600' }}>{student.regNo}</span>
                        </td>
                        <td style={{ padding: '14px 16px', verticalAlign: 'middle' }}><span style={{ fontSize: '15px', fontWeight: '800', color: marks[isHifzInsp ? '50_1' : '15'] !== undefined ? '#0f172a' : '#cbd5e1' }}>{marks[isHifzInsp ? '50_1' : '15'] !== undefined ? marks[isHifzInsp ? '50_1' : '15'] : '-'}</span></td>
                        <td style={{ padding: '14px 16px', verticalAlign: 'middle' }}><span style={{ fontSize: '15px', fontWeight: '800', color: marks[isHifzInsp ? '50_2' : '20'] !== undefined ? '#0f172a' : '#cbd5e1' }}>{marks[isHifzInsp ? '50_2' : '20'] !== undefined ? marks[isHifzInsp ? '50_2' : '20'] : '-'}</span></td>
                        <td style={{ padding: '14px 16px', verticalAlign: 'middle' }}><span style={{ fontSize: '15px', fontWeight: '800', color: isHifzInsp ? '#cbd5e1' : (marks['25'] !== undefined ? '#0f172a' : '#cbd5e1') }}>{isHifzInsp ? '-' : (marks['25'] !== undefined ? marks['25'] : '-')}</span></td>
                        <td style={{ padding: '14px 16px', verticalAlign: 'middle' }}><span style={{ fontSize: '15px', fontWeight: '800', color: isHifzInsp ? '#cbd5e1' : (marks['40'] !== undefined ? '#0f172a' : '#cbd5e1') }}>{isHifzInsp ? '-' : (marks['40'] !== undefined ? marks['40'] : '-')}</span></td>
                        <td style={{ padding: '14px 16px', verticalAlign: 'middle' }}>
                          {total100 > 0 ? <span style={{ background: '#dbeafe', color: '#1e40af', padding: '6px 10px', borderRadius: '6px', fontWeight: '800', fontSize: '15px' }}>{total100}</span> : <span style={{ color: '#94a3b8', fontWeight: '700' }}>-</span>}
                        </td>
                        <td style={{ padding: '14px 16px', verticalAlign: 'middle' }}>
                          {scaled30 !== '-' ? <span style={{ background: '#d1fae5', color: '#047857', padding: '6px 10px', borderRadius: '6px', fontWeight: '800', fontSize: '15px' }}>{scaled30}</span> : <span style={{ color: '#94a3b8', fontWeight: '700' }}>-</span>}
                        </td>
                        {inspectorMode === 'class' && (
                          <td style={{ padding: '14px 16px', color: teacherName === 'Unassigned' ? '#dc2626' : '#047857', fontWeight: '700', verticalAlign: 'middle' }}>
                            {teacherName}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* 🌟 3. CLASS & TEACHER AVERAGES ANALYTICS */}
      <div style={styles.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
          <h3 style={styles.sectionTitle}>📊 Subject & Teacher Averages Analytics</h3>
        </div>

        <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
          <button onClick={() => { setAnalyticsMode('grade'); setAnalyticsData(null); }} style={{ padding: '12px 20px', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', border: '1px solid #cbd5e1', background: analyticsMode === 'grade' ? '#2563eb' : '#f8fafc', color: analyticsMode === 'grade' ? '#ffffff' : '#334155', fontSize: '14px' }}>
            Average by Grade
          </button>
          <button onClick={() => { setAnalyticsMode('teacher'); setAnalyticsData(null); }} style={{ padding: '12px 20px', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', border: '1px solid #cbd5e1', background: analyticsMode === 'teacher' ? '#2563eb' : '#f8fafc', color: analyticsMode === 'teacher' ? '#ffffff' : '#334155', fontSize: '14px' }}>
            Average by Teacher
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '24px' }}>
          {analyticsMode === 'grade' ? (
            <div>
              <label style={styles.label}>Select Grade Level:</label>
              <select value={analyticsGrade} onChange={e => setAnalyticsGrade(e.target.value)} style={styles.input}>
                <option value="1">Grade 1 (u8, m8, 1st years)</option>
                <option value="2">Grade 2 (u9, m9, 2nd years)</option>
                <option value="3">Grade 3 (u10, m10, 3rd years)</option>
              </select>
            </div>
          ) : (
            <div>
              <label style={styles.label}>Select Teacher:</label>
              <select value={analyticsTeacherUsername} onChange={e => setAnalyticsTeacherUsername(e.target.value)} style={styles.input}>
                {allTeachers.map(t => <option key={t.username} value={t.username}>{t.fullName}</option>)}
              </select>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button onClick={generateAnalytics} disabled={isFetchingAnalytics} style={{ ...styles.buttonPrimary, width: '100%', background: '#0284c7', padding: '12px', fontWeight: '800' }}>
              {isFetchingAnalytics ? 'Calculating Averages...' : 'Generate Averages'}
            </button>
          </div>
        </div>

        {analyticsData && (
          <div style={{ marginTop: '24px', border: '1px solid #cbd5e1', borderRadius: '12px', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '16px 20px', borderBottom: '1px solid #cbd5e1', flexWrap: 'wrap', gap: '12px' }}>
              <h4 style={{ margin: 0, color: '#0f172a', fontWeight: '800', fontSize: '16px' }}>
                Averages Data
              </h4>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={handleCopyAnalyticsToClipboard} style={{ padding: '8px 16px', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}>📋 Copy Table</button>
                <button onClick={handleDownloadAnalyticsExcel} style={{ padding: '8px 16px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}>📊 Download CSV</button>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px', minWidth: '950px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #cbd5e1' }}>
                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800' }}>Subject / Assignment</th>
                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800' }}>Teacher</th>
                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', textAlign: 'center' }}>Students</th>
                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', textAlign: 'center' }}>Avg Lvl 1 (15)</th>
                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', textAlign: 'center' }}>Avg Lvl 2 (20)</th>
                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', textAlign: 'center' }}>Avg Lvl 3 (25)</th>
                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', textAlign: 'center' }}>Avg Lvl 4 (40)</th>
                    <th style={{ padding: '14px 16px', color: '#1e40af', fontWeight: '800', textAlign: 'center' }}>Avg Total (/100)</th>
                    <th style={{ padding: '14px 16px', color: '#047857', fontWeight: '800', textAlign: 'center' }}>Avg Scaled (/30)</th>
                  </tr>
                </thead>
                <tbody>
                  {analyticsData.length === 0 ? (
                    <tr>
                      <td colSpan="9" style={{ padding: '20px', textAlign: 'center', color: '#64748b', fontWeight: '600' }}>No subjects found for this selection.</td>
                    </tr>
                  ) : (
                    analyticsData.map((row, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0', background: idx % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                        <td style={{ padding: '14px 16px', fontWeight: '800', color: '#0f172a' }}>{row.subjectName}</td>
                        <td style={{ padding: '14px 16px', fontWeight: '600', color: '#334155' }}>{row.teacherName || 'Unknown'}</td>
                        <td style={{ padding: '14px 16px', textAlign: 'center' }}><span style={{ background: '#f1f5f9', padding: '4px 8px', borderRadius: '6px', fontWeight: '700' }}>{row.studentCount}</span></td>
                        <td style={{ padding: '14px 16px', textAlign: 'center', fontWeight: '700', color: row.avg15 === '-' ? '#cbd5e1' : '#0f172a' }}>{row.avg15}</td>
                        <td style={{ padding: '14px 16px', textAlign: 'center', fontWeight: '700', color: row.avg20 === '-' ? '#cbd5e1' : '#0f172a' }}>{row.avg20}</td>
                        <td style={{ padding: '14px 16px', textAlign: 'center', fontWeight: '700', color: row.avg25 === '-' ? '#cbd5e1' : '#0f172a' }}>{row.avg25}</td>
                        <td style={{ padding: '14px 16px', textAlign: 'center', fontWeight: '700', color: row.avg40 === '-' ? '#cbd5e1' : '#0f172a' }}>{row.avg40}</td>
                        <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                          {row.avg100 !== '-' ? <span style={{ background: '#dbeafe', color: '#1e40af', padding: '4px 8px', borderRadius: '6px', fontWeight: '800' }}>{row.avg100}</span> : <span style={{ color: '#94a3b8' }}>-</span>}
                        </td>
                        <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                          {row.avg30 !== '-' ? <span style={{ background: '#d1fae5', color: '#047857', padding: '4px 8px', borderRadius: '6px', fontWeight: '800' }}>{row.avg30}</span> : <span style={{ color: '#94a3b8' }}>-</span>}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}