'use client';
import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { db } from '../../lib/firebase';
import {
  createUserWithEmailAndPassword,
  getAuth,
  signOut,
  setPersistence,
  inMemoryPersistence
} from 'firebase/auth';
import { doc, setDoc, getDoc, getDocs, collection, deleteDoc, arrayUnion } from 'firebase/firestore';
import { getApp, initializeApp } from 'firebase/app';
import { DEFAULT_CLASSES, DEPARTMENTS, MADHABS, styles } from './erpConstants';
import {
  INDIAN_STATES, KERALA_DISTRICTS, CollapsibleCard,
  compressImageFileToDataUrl, openDirectWhatsApp,
  ProfileAvatar, SubjectTeacherSelector, syncStudentToSelectedTeacherEnrollments,
  StudentPortfolioModal, computeStudentProfileCompletion, resolveClassTeacherForStudent
} from './ErpExtensions';

const STUDENT_PARTIAL_FIELDS = [
  { key: 'parentWhatsapp', label: "Parent's WhatsApp Number" },
  { key: 'parentMobile', label: "Parent's Mobile Number" },
  { key: 'whatsappNumber', label: "Student's WhatsApp Number" },
  { key: 'mobileNumber', label: "Student's Phone Number" },
  { key: 'email', label: "Student's Email" },
  { key: 'state', label: 'State / Country' },
  { key: 'district', label: 'District / Province' },
  { key: 'mentorUsername', label: 'Mentor Username' },
  { key: 'department', label: 'Department' },
  { key: 'madhab', label: 'Madhab' },
  { key: 'classes', label: 'Class / Batch' },
  { key: 'skills', label: 'Skills (Comma separated)' }
];

export default function StudentManager() {
  const [rollNo, setRollNo] = useState('');
  const [regNo, setRegNo] = useState('');
  const [adNo, setAdNo] = useState('');
  const [firstName, setFirstName] = useState('');
  const [department, setDepartment] = useState(DEPARTMENTS[0]);
  const [madhab, setMadhab] = useState('Hanafi');
  const [selectedClasses, setSelectedClasses] = useState(['QLA3']);
  const [availableStudentClasses, setAvailableStudentClasses] = useState(DEFAULT_CLASSES);
  const [customClassInput, setCustomClassInput] = useState('');
  const [showStudentPassword, setShowStudentPassword] = useState(false);

  const [selectedPartialCols, setSelectedPartialCols] = useState(['parentWhatsapp', 'email', 'district']);
  const [bulkPhotoProgress, setBulkPhotoProgress] = useState('');

  const [state, setState] = useState('Kerala');
  const [district, setDistrict] = useState('Malappuram');
  const [email, setEmail] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [parentMobile, setParentMobile] = useState('');
  const [parentWhatsapp, setParentWhatsapp] = useState('');
  const [mentorUsername, setMentorUsername] = useState('');
  const [requiresPrincipalApproval, setRequiresPrincipalApproval] = useState(false);
  const [photoUrl, setPhotoUrl] = useState('');
  const [selectedSubjectEnrollmentKeys, setSelectedSubjectEnrollmentKeys] = useState([]);

  const [registeredStudents, setRegisteredStudents] = useState([]);
  const [teachersList, setTeachersList] = useState([]);
  const [selectedRows, setSelectedRows] = useState([]);
  const [portfolioModalStudent, setPortfolioModalStudent] = useState(null);

  const [bulkMentor, setBulkMentor] = useState('');
  const [bulkReplaceClass, setBulkReplaceClass] = useState('');
  const [bulkDept, setBulkDept] = useState('');
  const [bulkMadhab, setBulkMadhab] = useState('');
  const [bulkAddClass, setBulkAddClass] = useState('');
  const [bulkPrincipalLock, setBulkPrincipalLock] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [filterCompletion, setFilterCompletion] = useState('All');
  const [filterLevel, setFilterLevel] = useState('All');
  const [filterClass, setFilterClass] = useState('All');
  const [filterDepartments, setFilterDepartments] = useState([]);
  const [filterMadhab, setFilterMadhab] = useState('All');
  const [filterLanguage, setFilterLanguage] = useState('All');
  const [filterMentor, setFilterMentor] = useState('All');
  const [filterState, setFilterState] = useState('All');
  const [filterDistrict, setFilterDistrict] = useState('All');

  const [isEditing, setIsEditing] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const [isRegNoEditMode, setIsRegNoEditMode] = useState(false);
  const [regNoDrafts, setRegNoDrafts] = useState({});

  const fetchStudents = async () => {
    try {
      const [querySnapshot, tSnap] = await Promise.all([
        getDocs(collection(db, 'students')),
        getDocs(collection(db, 'teachers'))
      ]);
      const studentsData = [];
      querySnapshot.forEach((d) => studentsData.push(d.data()));
      studentsData.sort((a, b) => (Number(a.rollNo) || 999) - (Number(b.rollNo) || 999));
      setRegisteredStudents(studentsData);

      const tData = [];
      tSnap.forEach((d) => tData.push(d.data()));
      tData.sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''));
      setTeachersList(tData);
    } catch (err) { console.error(err); }
  };

  useEffect(() => { fetchStudents(); }, []);

  const handleBulkPhotoUploadFromPCFolder = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setBulkPhotoProgress(`Processing 0 / ${files.length} photos...`);
    let matchedCount = 0;
    let unmatchedNames = [];

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const baseName = f.name.replace(/\.[^/.]+$/, "").trim().toLowerCase();
      setBulkPhotoProgress(`Compressing & Saving (${i + 1}/${files.length}): ${f.name}...`);

      const matchedStudent = registeredStudents.find(
        s => String(s.adNo || '').trim().toLowerCase() === baseName ||
             String(s.regNo || '').trim().toLowerCase() === baseName
      );

      if (!matchedStudent) {
        unmatchedNames.push(f.name);
        continue;
      }

      try {
        const compressedDataUrl = await compressImageFileToDataUrl(f, 180, 0.78);
        await setDoc(doc(db, 'students', matchedStudent.regNo), { photoUrl: compressedDataUrl }, { merge: true });
        matchedCount++;
      } catch (err) {}
    }

    setBulkPhotoProgress('');
    e.target.value = null;
    let msg = `✅ Successfully uploaded & linked ${matchedCount} student photo(s) by Ad.No!`;
    if (unmatchedNames.length > 0) {
      msg += `\n\n⚠️ Could not match ${unmatchedNames.length} file(s) to any Ad.No: ${unmatchedNames.slice(0, 8).join(', ')}`;
    }
    alert(msg);
    fetchStudents();
  };

  const togglePartialCol = (colKey) => {
    if (selectedPartialCols.includes(colKey)) {
      setSelectedPartialCols(selectedPartialCols.filter(k => k !== colKey));
    } else {
      setSelectedPartialCols([...selectedPartialCols, colKey]);
    }
  };

  const handleDownloadMasterTemplate = () => {
    const csvContent = "data:text/csv;charset=utf-8,rollNo,regNo,adNo,firstName,classes,department,madhab,state,district,email,mobileNumber,whatsappNumber,parentMobile,parentWhatsapp,mentorUsername,skills\n1,726007,U1278,ABBU SHAHMA,\"QH1\",QURAN,Shafi,Kerala,Malappuram,abbu@gmail.com,9876543210,9876543210,9876543211,9876543211,sharafudheen,\"Debate, Calligraphy\"";
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute("download", "student_full_master_template.csv");
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const handleDownloadCustomPartialTemplate = () => {
    if (selectedPartialCols.length === 0) {
      return alert("Please select at least one field above to generate your custom partial CSV template.");
    }
    const headers = ['adNo', 'regNo', 'firstName', ...selectedPartialCols];
    const sourceList = filteredStudents.length > 0 ? filteredStudents : registeredStudents;

    const rows = sourceList.length > 0
      ? sourceList.map(st => {
          return headers.map(h => {
            if (h === 'adNo') return st.adNo || '';
            if (h === 'regNo') return st.regNo || '';
            if (h === 'firstName') return `"${(st.firstName || '').replace(/"/g, '""')}"`;
            if (h === 'classes') return `"${(Array.isArray(st.classes) ? st.classes.join(', ') : (st.classes || ''))}"`;
            if (h === 'skills') return `"${(Array.isArray(st.skills) ? st.skills.join(', ') : '')}"`;
            return `"${String(st[h] || '').replace(/"/g, '""')}"`;
          }).join(',');
        })
      : [`3529,726001,"Sample Student",${selectedPartialCols.map(() => '').join(',')}`];

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows].join('\n');
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute("download", `student_partial_${selectedPartialCols.join('_')}.csv`);
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const toggleStudentClass = (cls) => {
    if (selectedClasses.includes(cls)) setSelectedClasses(selectedClasses.filter(c => c !== cls));
    else setSelectedClasses([...selectedClasses, cls]);
  };

  const handleAddCustomClass = (e) => {
    e.preventDefault();
    if (!customClassInput.trim()) return;
    const newClass = customClassInput.trim();
    if (!availableStudentClasses.includes(newClass)) setAvailableStudentClasses([...availableStudentClasses, newClass]);
    if (!selectedClasses.includes(newClass)) setSelectedClasses([...selectedClasses, newClass]);
    setCustomClassInput('');
  };

  const handleAddOrUpdateStudent = async (e) => {
    e.preventDefault();
    if (selectedClasses.length === 0) return alert('Please select at least one class or batch.');
    setIsLoading(true);
    setStatusMsg(isEditing ? 'Updating student profile & subject teachers...' : 'Registering student & mapping to subject teachers...');
    const safeRegNo = regNo.toLowerCase().replace(/[^a-z0-9_.-]/g, '');
    const safeAdNo = adNo.trim();
    const safeRollNo = Number(rollNo);
    const fakeEmail = `${safeRegNo}@student.school.com`;
    const firebasePassword = safeAdNo.length < 6 ? safeAdNo.padStart(6, '0') : safeAdNo;

    const autoCT = resolveClassTeacherForStudent({ classes: selectedClasses }, teachersList);

    try {
      if (!isEditing) {
        try {
          const primaryApp = getApp();
          let secondaryApp;
          try { secondaryApp = getApp("SecondaryApp"); } catch (err) { secondaryApp = initializeApp(primaryApp.options, "SecondaryApp"); }
          const secondaryAuth = getAuth(secondaryApp);
          await setPersistence(secondaryAuth, inMemoryPersistence);
          await createUserWithEmailAndPassword(secondaryAuth, fakeEmail, firebasePassword);
          await signOut(secondaryAuth);
        } catch (e) {
          console.error("Auth creation skipped or failed:", e);
        }
      }
      await setDoc(doc(db, 'students', safeRegNo), {
        rollNo: safeRollNo,
        regNo: safeRegNo,
        adNo: safeAdNo,
        firstName,
        department: department.toUpperCase(),
        madhab,
        classes: selectedClasses,
        state,
        district: district.trim(),
        email,
        mobileNumber,
        whatsappNumber: whatsappNumber || mobileNumber,
        parentMobile,
        parentWhatsapp: parentWhatsapp || parentMobile,
        mentorUsername,
        classTeacherUsername: autoCT ? autoCT.username : '',
        requiresPrincipalApproval: Boolean(requiresPrincipalApproval),
        photoUrl: photoUrl || null
      }, { merge: true });

      await syncStudentToSelectedTeacherEnrollments(safeRegNo, selectedSubjectEnrollmentKeys);
      setIsLoading(false);
      setStatusMsg(isEditing ? '✅ Student profile & subject teacher mappings updated!' : '✅ Student registered & added to selected teachers\' classes!');
      fetchStudents();
      resetForm();
    } catch (err) {
      setIsLoading(false);
      setStatusMsg('Error: ' + err.message);
    }
  };

  const handleBulkUpdate = async () => {
    if (selectedRows.length === 0) return;
    if (!bulkMentor && !bulkReplaceClass && !bulkDept && !bulkMadhab && !bulkAddClass && bulkPrincipalLock === '') {
      return alert('Please choose at least one bulk action (e.g., Assign Mentor or Set Class).');
    }
    if (!window.confirm(`Apply changes to ${selectedRows.length} selected students?`)) return;
    setIsLoading(true);
    setStatusMsg(`Updating ${selectedRows.length} students...`);
    try {
      const promises = selectedRows.map(rNo => {
        const updateData = {};
        if (bulkMentor) updateData.mentorUsername = bulkMentor === '__CLEAR__' ? '' : bulkMentor;
        if (bulkReplaceClass) {
          updateData.classes = [bulkReplaceClass];
          const autoCT = resolveClassTeacherForStudent({ classes: [bulkReplaceClass] }, teachersList);
          if (autoCT) updateData.classTeacherUsername = autoCT.username;
        } else if (bulkAddClass) {
          updateData.classes = arrayUnion(bulkAddClass.trim());
        }
        if (bulkDept) updateData.department = bulkDept;
        if (bulkMadhab) updateData.madhab = bulkMadhab;
        if (bulkPrincipalLock !== '') updateData.requiresPrincipalApproval = bulkPrincipalLock === 'true';
        return setDoc(doc(db, 'students', rNo), updateData, { merge: true });
      });
      await Promise.all(promises);
      setIsLoading(false);
      setStatusMsg(`✅ Successfully updated ${selectedRows.length} students!`);
      setSelectedRows([]);
      setBulkMentor(''); setBulkReplaceClass(''); setBulkDept(''); setBulkMadhab(''); setBulkAddClass(''); setBulkPrincipalLock('');
      if (bulkAddClass && !availableStudentClasses.includes(bulkAddClass.trim())) setAvailableStudentClasses([...availableStudentClasses, bulkAddClass.trim()]);
      fetchStudents();
    } catch (err) {
      setIsLoading(false);
      setStatusMsg('Error: ' + err.message);
    }
  };

  const handleCSVUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const workbook = XLSX.read(event.target.result, { type: 'string' });
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
      if (rows.length === 0) return alert('No valid rows found in CSV.');
      setIsLoading(true);
      setStatusMsg(`Processing ${rows.length} student rows...`);
      try {
        const primaryApp = getApp();
        let secondaryApp;
        try { secondaryApp = getApp("SecondaryApp"); } catch (err) { secondaryApp = initializeApp(primaryApp.options, "SecondaryApp"); }
        const secondaryAuth = getAuth(secondaryApp);
        await setPersistence(secondaryAuth, inMemoryPersistence);

        let updatedCount = 0;
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          const rawAdNo = String(r.adNo || r['Ad.No'] || '').trim();
          const rawRegNo = String(r.regNo || r['Reg.No'] || '').trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
          const existing = registeredStudents.find(s => (rawRegNo && s.regNo === rawRegNo) || (rawAdNo && String(s.adNo).toLowerCase() === rawAdNo.toLowerCase()));
          const targetRegNo = rawRegNo || existing?.regNo;
          if (!targetRegNo) continue;

          const payload = { regNo: targetRegNo };
          if (rawAdNo) payload.adNo = rawAdNo;
          if (r.rollNo !== undefined && r.rollNo !== '') payload.rollNo = Number(r.rollNo);
          if (r.firstName !== undefined && r.firstName !== '') payload.firstName = String(r.firstName).trim();
          if (r.classes !== undefined && r.classes !== '') {
            const clsArr = String(r.classes).split(',').map(c => c.trim()).filter(Boolean);
            payload.classes = clsArr;
            const autoCT = resolveClassTeacherForStudent({ classes: clsArr }, teachersList);
            if (autoCT) payload.classTeacherUsername = autoCT.username;
          }
          if (r.department !== undefined && r.department !== '') payload.department = String(r.department).trim().toUpperCase();
          if (r.madhab !== undefined && r.madhab !== '') payload.madhab = String(r.madhab).trim();
          if (r.state !== undefined && r.state !== '') payload.state = String(r.state).trim();
          if (r.district !== undefined && r.district !== '') payload.district = String(r.district).trim();
          if (r.email !== undefined && r.email !== '') payload.email = String(r.email).trim();
          if (r.mobileNumber !== undefined && r.mobileNumber !== '') payload.mobileNumber = String(r.mobileNumber).trim();
          if (r.whatsappNumber !== undefined && r.whatsappNumber !== '') payload.whatsappNumber = String(r.whatsappNumber).trim();
          if (r.parentMobile !== undefined && r.parentMobile !== '') payload.parentMobile = String(r.parentMobile).trim();
          if (r.parentWhatsapp !== undefined && r.parentWhatsapp !== '') payload.parentWhatsapp = String(r.parentWhatsapp).trim();
          if (r.mentorUsername !== undefined && r.mentorUsername !== '') payload.mentorUsername = String(r.mentorUsername).trim().toLowerCase();
          if (r.requiresPrincipalApproval !== undefined && r.requiresPrincipalApproval !== '') payload.requiresPrincipalApproval = String(r.requiresPrincipalApproval).toLowerCase() === 'true';
          if (r.skills !== undefined && r.skills !== '') payload.skills = String(r.skills).split(',').map(s => s.trim()).filter(Boolean);

          if (!existing && rawAdNo) {
            const fakeEmail = `${targetRegNo}@student.school.com`;
            const firebasePassword = rawAdNo.length < 6 ? rawAdNo.padStart(6, '0') : rawAdNo;
            try { await createUserWithEmailAndPassword(secondaryAuth, fakeEmail, firebasePassword); } catch (e) {}
          }

          await setDoc(doc(db, 'students', targetRegNo), payload, { merge: true });
          updatedCount++;
        }

        await signOut(secondaryAuth);
        setIsLoading(false);
        setStatusMsg(`✅ Successfully updated ${updatedCount} students!`);
        fetchStudents();
      } catch (err) {
        setIsLoading(false);
        setStatusMsg('Error: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = null;
  };

  const handleEditClick = (student) => {
    setIsEditing(true);
    setRollNo(student.rollNo || '');
    setRegNo(student.regNo);
    setAdNo(student.adNo);
    setFirstName(student.firstName);
    setDepartment(student.department || DEPARTMENTS[0]);
    setMadhab(student.madhab || 'Hanafi');
    setState(student.state || 'Kerala');
    setDistrict(student.district || 'Malappuram');
    setEmail(student.email || '');
    setMobileNumber(student.mobileNumber || '');
    setWhatsappNumber(student.whatsappNumber || '');
    setParentMobile(student.parentMobile || '');
    setParentWhatsapp(student.parentWhatsapp || '');
    setMentorUsername(student.mentorUsername || '');
    setRequiresPrincipalApproval(Boolean(student.requiresPrincipalApproval));
    setPhotoUrl(student.photoUrl || '');

    const currentKeys = [];
    teachersList.forEach(t => {
      (t.enrollments || []).forEach(env => {
        if ((env.studentIds || []).includes(student.regNo)) {
          currentKeys.push(`${t.username}:::${env.id}`);
        }
      });
    });
    setSelectedSubjectEnrollmentKeys(currentKeys);

    const stuClasses = getSafeClassesArray(student);
    setSelectedClasses(stuClasses);
    const newAvailable = [...availableStudentClasses];
    let changed = false;
    stuClasses.forEach(c => { if (!newAvailable.includes(c)) { newAvailable.push(c); changed = true; } });
    if (changed) setAvailableStudentClasses(newAvailable);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteClick = async (studentRegNo) => {
    if (window.confirm(`Delete student ${studentRegNo}?`)) {
      try { await deleteDoc(doc(db, 'students', studentRegNo)); fetchStudents(); } catch (err) { alert("Failed to delete."); }
    }
  };

  const resetForm = () => {
    setIsEditing(false); setRollNo(''); setRegNo(''); setAdNo(''); setFirstName('');
    setDepartment(DEPARTMENTS[0]); setMadhab('Hanafi'); setSelectedClasses(['QLA3']);
    setState('Kerala'); setDistrict('Malappuram'); setEmail(''); setMobileNumber('');
    setWhatsappNumber(''); setParentMobile(''); setParentWhatsapp('');
    setMentorUsername(''); setRequiresPrincipalApproval(false);
    setPhotoUrl(''); setSelectedSubjectEnrollmentKeys([]); setStatusMsg('');
  };

  const getSafeClassesArray = (student) => {
    if (Array.isArray(student.classes)) return student.classes;
    if (typeof student.classes === 'string') return [student.classes];
    if (student.className) return [student.className];
    return [];
  };

  const getStudentLevels = (student) => {
    const classes = getSafeClassesArray(student);
    const levels = new Set();
    classes.forEach(c => { const match = String(c).match(/\d+/); if (match) levels.add(match[0]); });
    return Array.from(levels);
  };

  const isUrduStudent = (adNo) => (adNo || '').toUpperCase().includes('U');

  const toggleFilterDirectoryDept = (dept) => {
    if (filterDepartments.includes(dept)) setFilterDepartments(filterDepartments.filter(d => d !== dept));
    else setFilterDepartments([...filterDepartments, dept]);
  };

  const filteredStudents = registeredStudents.filter((student) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      if (!(student.firstName || '').toLowerCase().includes(q) && !String(student.adNo || '').toLowerCase().includes(q) && !String(student.regNo || '').toLowerCase().includes(q)) return false;
    }
    const comp = computeStudentProfileCompletion(student);
    if (filterCompletion === 'Complete' && !comp.isComplete) return false;
    if (filterCompletion === 'Incomplete' && comp.isComplete) return false;

    if (filterLevel !== 'All' && !getStudentLevels(student).includes(filterLevel)) return false;
    if (filterClass !== 'All' && !getSafeClassesArray(student).includes(filterClass)) return false;
    if (filterDepartments.length > 0 && !filterDepartments.includes((student.department || '').toUpperCase())) return false;
    if (filterMadhab !== 'All' && (student.madhab || 'General') !== filterMadhab) return false;
    if (filterLanguage === 'Urdu' && !isUrduStudent(student.adNo)) return false;
    if (filterLanguage === 'Non-Urdu' && isUrduStudent(student.adNo)) return false;
    if (filterMentor !== 'All' && (student.mentorUsername || '') !== filterMentor) return false;
    if (filterState !== 'All' && (student.state || 'Kerala') !== filterState) return false;
    if (filterDistrict !== 'All' && (student.district || '') !== filterDistrict) return false;
    return true;
  });

  const totalStudentsCount = registeredStudents.length;
  const completeStudentsCount = registeredStudents.filter(s => computeStudentProfileCompletion(s).isComplete).length;
  const incompleteStudentsCount = totalStudentsCount - completeStudentsCount;
  const overallCompletionPct = totalStudentsCount > 0
    ? Math.round(registeredStudents.reduce((acc, s) => acc + computeStudentProfileCompletion(s).pct, 0) / totalStudentsCount)
    : 0;

  const toggleRowSelect = (regNo) => {
    if (selectedRows.includes(regNo)) setSelectedRows(selectedRows.filter(id => id !== regNo));
    else setSelectedRows([...selectedRows, regNo]);
  };

  const toggleSelectAll = (filteredArray) => {
    if (selectedRows.length === filteredArray.length) setSelectedRows([]);
    else setSelectedRows(filteredArray.map(s => s.regNo));
  };

  const handleRegNoDraftChange = (oldRegNo, val) => {
    setRegNoDrafts(prev => ({ ...prev, [oldRegNo]: val }));
  };

  const executeRegNoMigration = async () => {
    const updates = Object.entries(regNoDrafts).filter(([oldReg, newReg]) => newReg && newReg.trim() !== '' && newReg !== oldReg);
    if (updates.length === 0) return alert('No changes entered. Please type a new RegNo for at least one student.');
    if (!window.confirm(`Are you sure you want to migrate ${updates.length} Registration Numbers?`)) return;

    setIsLoading(true);
    setStatusMsg(`Migrating ${updates.length} students... Please wait.`);

    try {
      const primaryApp = getApp();
      let secondaryApp;
      try { secondaryApp = getApp("SecondaryApp"); } catch (err) { secondaryApp = initializeApp(primaryApp.options, "SecondaryApp"); }
      const secondaryAuth = getAuth(secondaryApp);
      await setPersistence(secondaryAuth, inMemoryPersistence);

      for (const [oldReg, newRegRaw] of updates) {
        const newReg = newRegRaw.toLowerCase().replace(/[^a-z0-9_.-]/g, '');
        const studentSnap = await getDoc(doc(db, 'students', oldReg));
        const markSnap = await getDoc(doc(db, 'marks', oldReg));

        if (studentSnap.exists()) {
          const studentData = studentSnap.data();
          studentData.regNo = newReg;
          const fakeEmail = `${newReg}@student.school.com`;
          const safeAdNo = String(studentData.adNo).trim();
          const firebasePassword = safeAdNo.length < 6 ? safeAdNo.padStart(6, '0') : safeAdNo;

          try { await createUserWithEmailAndPassword(secondaryAuth, fakeEmail, firebasePassword); } catch (authErr) {}

          await setDoc(doc(db, 'students', newReg), studentData);
          if (markSnap.exists()) await setDoc(doc(db, 'marks', newReg), markSnap.data());
          await deleteDoc(doc(db, 'students', oldReg));
          if (markSnap.exists()) await deleteDoc(doc(db, 'marks', oldReg));
        }
      }

      await signOut(secondaryAuth);
      setRegNoDrafts({});
      setIsRegNoEditMode(false);
      setStatusMsg(`Successfully migrated ${updates.length} students!`);
      fetchStudents();
    } catch (err) {
      setStatusMsg('Migration Error: ' + err.message);
    }
    setIsLoading(false);
  };

  return (
    <div>
      {portfolioModalStudent && (
        <StudentPortfolioModal
          student={portfolioModalStudent}
          canEditSkills={true}
          canViewConfidential={true}
          editorName="Admin"
          onClose={() => setPortfolioModalStudent(null)}
          onSaved={fetchStudents}
        />
      )}

      {/* 🌟 SLIDING DRAWER 1: CUSTOM PARTIAL CSV & PC FOLDER MULTI-PHOTO UPLOADER */}
      <CollapsibleCard
        title="Students CSV Uploader & Bulk PC Folder Photo Uploader (By Ad.No)"
        subtitle="Click to open custom CSV template downloader, bulk CSV uploader, or bulk student photo linker"
        badgeText="CSV & Photos"
        icon="🗄️"
        accentColor="#0284c7"
        defaultOpen={false}
      >
        <p style={{ fontSize: '13px', color: '#334155', marginTop: 0, marginBottom: '12px', lineHeight: '1.5', fontWeight: '600' }}>
          Select the specific student columns you want to update via CSV, OR select all student photos from a folder on your PC named with their Admission Number (e.g. <code>3529.jpg</code>, <code>U1278.png</code>):
        </p>

        <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1.5px solid #cbd5e1', marginBottom: '14px' }}>
          <div style={{ fontSize: '12px', fontWeight: '800', color: '#0f172a', marginBottom: '8px' }}>
            ☑️ Select fields to include in your Partial CSV Template (`adNo`, `regNo`, and `firstName` are included automatically):
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {STUDENT_PARTIAL_FIELDS.map(f => {
              const active = selectedPartialCols.includes(f.key);
              return (
                <label
                  key={f.key}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: '800',
                    background: active ? '#00897b' : '#ffffff',
                    color: active ? '#ffffff' : '#0f172a',
                    border: active ? '1.5px solid #00897b' : '1.5px solid #94a3b8'
                  }}
                >
                  <input type="checkbox" checked={active} onChange={() => togglePartialCol(f.key)} style={{ display: 'none' }} />
                  {active ? `✓ ${f.label}` : `+ ${f.label}`}
                </label>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
          <button type="button" onClick={handleDownloadCustomPartialTemplate} style={{ padding: '10px 16px', background: '#00897b', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}>
            📥 Download Custom Partial CSV ({selectedPartialCols.length} Selected Fields)
          </button>
          <button type="button" onClick={handleDownloadMasterTemplate} style={{ padding: '10px 16px', background: '#f8fafc', color: '#0f172a', border: '1.5px solid #94a3b8', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}>
            📥 Full Master Template (All Fields)
          </button>
          <label style={{ display: 'inline-flex', alignItems: 'center', padding: '10px 18px', background: '#0284c7', color: '#ffffff', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}>
            📂 Upload Completed CSV (Full or Partial)
            <input type="file" accept=".csv" onChange={handleCSVUpload} style={{ display: 'none' }} />
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', padding: '10px 18px', background: '#0f172a', color: '#ffffff', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}>
            📸 Select Student Photos from PC Folder (Named by Ad.No e.g. 3529.jpg)
            <input type="file" accept="image/*" multiple onChange={handleBulkPhotoUploadFromPCFolder} style={{ display: 'none' }} />
          </label>
          {bulkPhotoProgress && <span style={{ fontWeight: '800', color: '#0284c7', fontSize: '13px' }}>⏳ {bulkPhotoProgress}</span>}
        </div>
      </CollapsibleCard>

      {/* 🌟 SLIDING DRAWER 2: STUDENT REGISTRATION & 14-SUBJECT TEACHER MAPPER (Auto-Opens When Editing!) */}
      <CollapsibleCard
        key={isEditing ? `edit_${regNo}` : 'new_student'}
        title={isEditing ? `✏️ Editing Student: ${firstName} (${regNo})` : 'Register New Student & Assign Subject Teachers'}
        subtitle="Click to open student registration form and 14-subject teacher mapper"
        badgeText={isEditing ? 'Editing Mode' : '+ Add Student'}
        icon={isEditing ? '✏️' : '👨‍🎓'}
        accentColor={isEditing ? '#f59e0b' : '#0f766e'}
        defaultOpen={isEditing}
      >
        {isEditing && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
            <button type="button" onClick={resetForm} style={{ padding: '8px 16px', background: '#e2e8f0', color: '#0f172a', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '800', fontSize: '12px' }}>
              ✕ Cancel Editing
            </button>
          </div>
        )}

        <form onSubmit={handleAddOrUpdateStudent} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ background: '#f8fafc', padding: '18px', borderRadius: '12px', border: '1.5px solid #cbd5e1' }}>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '15px', color: '#0f172a', fontWeight: '800' }}>
              1. Select Student&apos;s Class / Batch (Automatically assigns Class Teacher &amp; Hifz Teacher):
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(105px, 1fr))', gap: '10px', background: '#ffffff', padding: '12px', border: '1px solid #cbd5e1', borderRadius: '8px', marginBottom: '12px' }}>
              {availableStudentClasses.map(cls => (
                <label key={cls} style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '14px', color: '#0f172a', fontWeight: '800' }}>
                  <input type="checkbox" checked={selectedClasses.includes(cls)} onChange={() => toggleStudentClass(cls)} style={{ marginRight: '8px', accentColor: '#00897b', width: '16px', height: '16px' }} /> {cls}
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <input type="text" value={customClassInput} onChange={(e) => setCustomClassInput(e.target.value)} placeholder="Or custom group (e.g. Mixed_Urdu)..." style={{ ...styles.input, flex: '1 1 220px' }} />
              <button type="button" onClick={handleAddCustomClass} style={{ padding: '10px 16px', background: '#0f172a', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}>Add Custom Group</button>
            </div>

            <SubjectTeacherSelector
              selectedClasses={selectedClasses}
              adNo={adNo}
              teachersList={teachersList}
              selectedEnrollmentKeys={selectedSubjectEnrollmentKeys}
              onChangeSelectedKeys={setSelectedSubjectEnrollmentKeys}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '16px' }}>
            <div><label style={styles.label}>Sn (Roll No)</label><input type="number" value={rollNo} onChange={(e) => setRollNo(e.target.value)} required style={styles.input} /></div>
            <div><label style={styles.label}>First Name</label><input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} required style={styles.input} /></div>
            <div><label style={styles.label}>Reg.No (Username)</label><input type="text" value={regNo} onChange={(e) => setRegNo(e.target.value)} disabled={isEditing} required style={styles.input} /></div>
            <div>
              <label style={styles.label}>Ad.No {isUrduStudent(adNo) && <span style={{ color: '#d97706' }}>★ Urdu</span>}</label>
              <div style={{ display: 'flex', position: 'relative' }}>
                <input type={showStudentPassword || isEditing ? "text" : "password"} value={adNo} onChange={(e) => setAdNo(e.target.value)} required style={styles.input} />
                {!isEditing && <button type="button" onClick={() => setShowStudentPassword(!showStudentPassword)} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#2563eb', fontWeight: '800', cursor: 'pointer' }}>{showStudentPassword ? "Hide" : "Show"}</button>}
              </div>
            </div>
            <div><label style={styles.label}>Department</label><select value={department} onChange={(e) => setDepartment(e.target.value)} style={styles.input}>{DEPARTMENTS.map(dept => <option key={dept} value={dept}>{dept}</option>)}</select></div>
            <div><label style={styles.label}>Madhab</label><select value={madhab} onChange={(e) => setMadhab(e.target.value)} style={styles.input}>{MADHABS.map(m => <option key={m} value={m}>{m}</option>)}</select></div>

            <div>
              <label style={styles.label}>State / Country</label>
              <select
                value={state}
                onChange={(e) => {
                  const nextState = e.target.value;
                  setState(nextState);
                  if (nextState === 'Kerala' && !KERALA_DISTRICTS.includes(district)) {
                    setDistrict('Malappuram');
                  } else if (nextState !== 'Kerala' && KERALA_DISTRICTS.includes(district)) {
                    setDistrict('');
                  }
                }}
                style={styles.input}
              >
                {INDIAN_STATES.map(st => <option key={st} value={st}>{st}</option>)}
              </select>
            </div>

            <div>
              <label style={styles.label}>
                {state === 'Kerala' ? 'District (Kerala)' : 'District / Province / City (Type)'}
              </label>
              {state === 'Kerala' ? (
                <select value={district} onChange={(e) => setDistrict(e.target.value)} style={styles.input}>
                  {KERALA_DISTRICTS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              ) : (
                <input
                  type="text"
                  value={district}
                  onChange={(e) => setDistrict(e.target.value)}
                  placeholder="Type district, province, or city..."
                  style={styles.input}
                />
              )}
            </div>

            <div><label style={styles.label}>Student Email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={styles.input} /></div>
            <div><label style={styles.label}>Student Phone Number</label><input type="text" value={mobileNumber} onChange={(e) => setMobileNumber(e.target.value)} style={styles.input} /></div>
            <div><label style={styles.label}>Student WhatsApp Number</label><input type="text" value={whatsappNumber} onChange={(e) => setWhatsappNumber(e.target.value)} style={styles.input} /></div>
            <div><label style={styles.label}>Parent Mobile Number</label><input type="text" value={parentMobile} onChange={(e) => setParentMobile(e.target.value)} style={styles.input} /></div>
            <div><label style={styles.label}>Parent WhatsApp Number</label><input type="text" value={parentWhatsapp} onChange={(e) => setParentWhatsapp(e.target.value)} style={styles.input} /></div>
            <div>
              <label style={styles.label}>Assigned Mentor (Optional)</label>
              <select value={mentorUsername} onChange={(e) => setMentorUsername(e.target.value)} style={styles.input}>
                <option value="">-- Assign Later / None --</option>
                {teachersList.map(t => <option key={t.username} value={t.username}>{t.fullName} (@{t.username})</option>)}
              </select>
            </div>
            <div>
              <label style={styles.label}>Single Student Photo (Optional)</label>
              <input type="file" accept="image/*" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setPhotoUrl(await compressImageFileToDataUrl(f, 180, 0.8)); }} style={styles.input} />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#fef2f2', padding: '12px 16px', borderRadius: '10px', border: '1.5px solid #fca5a5' }}>
            <input type="checkbox" checked={requiresPrincipalApproval} onChange={(e) => setRequiresPrincipalApproval(e.target.checked)} style={{ width: '18px', height: '18px', accentColor: '#dc2626' }} />
            <span style={{ fontSize: '13px', fontWeight: '800', color: '#991b1b' }}>👑 Special Restriction: Require Principal Approval Only for all Out-Pass Leaves of this student</span>
          </div>

          <button type="submit" disabled={isLoading} style={isEditing ? styles.buttonWarning : styles.buttonSuccess}>
            {isLoading ? 'Processing...' : isEditing ? 'Update Student Profile & Subject Teachers' : 'Register Student & Map to Selected Teachers'}
          </button>
        </form>
      </CollapsibleCard>

      {statusMsg && (
        <div style={{ marginBottom: '18px', padding: '14px 18px', background: statusMsg.includes('Error') ? '#fee2e2' : '#ecfdf5', borderRadius: '12px', color: statusMsg.includes('Error') ? '#991b1b' : '#065f46', fontWeight: '800', border: `1px solid ${statusMsg.includes('Error') ? '#fecaca' : '#a7f3d0'}` }}>
          {statusMsg}
        </div>
      )}

      {/* 3. STUDENTS DIRECTORY WITH PROFILE COMPLETION KPI BANNER & BULK GROUP ASSIGNMENT */}
      <div style={styles.card}>
        <h3 style={styles.sectionTitle}>⚡ Student Profile Completion Rate &amp; Directory ({filteredStudents.length} of {registeredStudents.length})</h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '22px' }}>
          <div onClick={() => setFilterCompletion('All')} style={{ padding: '18px', borderRadius: '14px', background: '#f8fafc', border: '1px solid #e2e8f0', textAlign: 'center', cursor: 'pointer' }}>
            <span style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', letterSpacing: '0.5px' }}>TOTAL ENROLLED</span>
            <div style={{ fontSize: '26px', fontWeight: '900', color: '#0f172a', marginTop: '6px' }}>{totalStudentsCount}</div>
          </div>
          <div onClick={() => setFilterCompletion('Complete')} style={{ padding: '18px', borderRadius: '14px', background: '#ecfdf5', border: '1px solid #a7f3d0', textAlign: 'center', cursor: 'pointer' }}>
            <span style={{ fontSize: '11px', fontWeight: '800', color: '#047857', letterSpacing: '0.5px' }}>COMPLETE PROFILES (100%)</span>
            <div style={{ fontSize: '26px', fontWeight: '900', color: '#047857', marginTop: '6px' }}>{completeStudentsCount}</div>
          </div>
          <div onClick={() => setFilterCompletion('Incomplete')} style={{ padding: '18px', borderRadius: '14px', background: '#fee2e2', border: '1px solid #fecaca', textAlign: 'center', cursor: 'pointer' }}>
            <span style={{ fontSize: '11px', fontWeight: '800', color: '#991b1b', letterSpacing: '0.5px' }}>MISSING / INCOMPLETE</span>
            <div style={{ fontSize: '26px', fontWeight: '900', color: '#dc2626', marginTop: '6px' }}>{incompleteStudentsCount}</div>
          </div>
          <div style={{ padding: '18px', borderRadius: '14px', background: '#eff6ff', border: '1px solid #bfdbfe', textAlign: 'center' }}>
            <span style={{ fontSize: '11px', fontWeight: '800', color: '#1e40af', letterSpacing: '0.5px' }}>PROFILE COMPLETION RATE</span>
            <div style={{ fontSize: '26px', fontWeight: '900', color: '#2563eb', marginTop: '6px' }}>{overallCompletionPct}%</div>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', marginBottom: '18px', background: '#f8fafc', padding: '12px', borderRadius: '12px', border: '1px solid #cbd5e1' }}>
          <button
            onClick={() => { setIsRegNoEditMode(!isRegNoEditMode); setRegNoDrafts({}); }}
            style={{ padding: '8px 14px', background: isRegNoEditMode ? '#fef3c7' : '#ffffff', color: isRegNoEditMode ? '#d97706' : '#0f172a', border: `1.5px solid ${isRegNoEditMode ? '#fcd34d' : '#94a3b8'}`, borderRadius: '8px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}
          >
            {isRegNoEditMode ? 'Cancel Edit Mode' : '✏️ Mass Edit RegNo'}
          </button>

          <input type="text" placeholder="🔍 Search Name, Ad.No..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} style={{ ...styles.filterSelect, minWidth: '175px' }} />

          <select value={filterCompletion} onChange={(e) => setFilterCompletion(e.target.value)} style={styles.filterSelect}>
            <option value="All">All Profile Status</option>
            <option value="Incomplete">⚠️ Incomplete Profiles</option>
            <option value="Complete">✅ 100% Complete</option>
          </select>

          {DEPARTMENTS.map(d => (
            <label key={d} style={{ fontSize: '12px', color: '#0f172a', background: filterDepartments.includes(d) ? '#dbeafe' : '#ffffff', padding: '6px 10px', borderRadius: '6px', cursor: 'pointer', border: filterDepartments.includes(d) ? '2px solid #3b82f6' : '1.5px solid #94a3b8', fontWeight: '800' }}>
              <input type="checkbox" checked={filterDepartments.includes(d)} onChange={() => toggleFilterDirectoryDept(d)} style={{ display: 'none' }} />
              {d}
            </label>
          ))}

          <select value={filterLevel} onChange={(e) => setFilterLevel(e.target.value)} style={styles.filterSelect}>
            <option value="All">All Levels</option><option value="1">Level 1</option><option value="2">Level 2</option><option value="3">Level 3</option>
          </select>
          <select value={filterClass} onChange={(e) => setFilterClass(e.target.value)} style={styles.filterSelect}>
            <option value="All">All Classes</option>
            {availableStudentClasses.map(cls => <option key={cls} value={cls}>{cls}</option>)}
          </select>
          <select value={filterMentor} onChange={(e) => setFilterMentor(e.target.value)} style={styles.filterSelect}>
            <option value="All">All Mentors</option>
            {teachersList.map(t => <option key={t.username} value={t.username}>Mentor: {t.fullName}</option>)}
          </select>
          <select value={filterState} onChange={(e) => setFilterState(e.target.value)} style={styles.filterSelect}>
            <option value="All">All States</option>
            {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filterMadhab} onChange={(e) => setFilterMadhab(e.target.value)} style={styles.filterSelect}>
            <option value="All">All Madhabs</option>
            {MADHABS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <select value={filterLanguage} onChange={(e) => setFilterLanguage(e.target.value)} style={styles.filterSelect}>
            <option value="All">All Streams</option><option value="Urdu">Urdu Only</option><option value="Non-Urdu">Non-Urdu</option>
          </select>
        </div>

        {selectedRows.length > 0 && !isRegNoEditMode && (
          <div className="erp-slide-panel" style={{ padding: '16px', background: '#eff6ff', border: '2px solid #3b82f6', borderRadius: '12px', marginBottom: '22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <strong style={{ color: '#1e3a8a', fontSize: '15px', display: 'block' }}>
                ☑️ {selectedRows.length} Students Selected
              </strong>
              <span style={{ fontSize: '12px', color: '#1e40af', fontWeight: '600' }}>
                Assign this group of students to a Mentor or move them to a Class below:
              </span>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <select value={bulkMentor} onChange={(e) => setBulkMentor(e.target.value)} style={{ ...styles.filterSelect, borderColor: '#2563eb' }}>
                <option value="">🧭 Assign Mentor to Group...</option>
                <option value="__CLEAR__">✕ Clear Mentor</option>
                {teachersList.map(t => <option key={t.username} value={t.username}>Mentor: {t.fullName}</option>)}
              </select>

              <select value={bulkReplaceClass} onChange={(e) => setBulkReplaceClass(e.target.value)} style={{ ...styles.filterSelect, borderColor: '#059669' }}>
                <option value="">🏫 Move Group to Class...</option>
                {DEFAULT_CLASSES.map(cls => <option key={cls} value={cls}>Set Class: {cls}</option>)}
              </select>

              <select value={bulkDept} onChange={(e) => setBulkDept(e.target.value)} style={styles.filterSelect}>
                <option value="">Set Dept...</option>
                {DEPARTMENTS.map(dept => <option key={dept} value={dept}>{dept}</option>)}
              </select>

              <select value={bulkMadhab} onChange={(e) => setBulkMadhab(e.target.value)} style={styles.filterSelect}>
                <option value="">Set Madhab...</option>
                {MADHABS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>

              <select value={bulkPrincipalLock} onChange={(e) => setBulkPrincipalLock(e.target.value)} style={styles.filterSelect}>
                <option value="">Principal Lock...</option>
                <option value="true">👑 Lock to Principal</option>
                <option value="false">Unlock</option>
              </select>

              <input type="text" value={bulkAddClass} onChange={(e) => setBulkAddClass(e.target.value)} placeholder="Add extra group tag..." style={{ padding: '8px 12px', borderRadius: '6px', border: '1.5px solid #94a3b8', fontSize: '13px', width: '140px' }} />

              <button onClick={handleBulkUpdate} style={{ padding: '9px 18px', background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}>
                ✓ Apply to {selectedRows.length} Students
              </button>
            </div>
          </div>
        )}

        {isRegNoEditMode && (
          <div style={{ padding: '16px', background: '#fffbeb', border: '2px dashed #f59e0b', borderRadius: '10px', marginBottom: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <strong style={{ color: '#b45309', fontSize: '15px', display: 'block' }}>⚠️ Mass RegNo Migration Mode Active</strong>
              <span style={{ fontSize: '13px', color: '#92400e', fontWeight: '600' }}>Type the new registration number next to the students you want to correct, then click Migrate.</span>
            </div>
            <button onClick={executeRegNoMigration} disabled={isLoading} style={{ padding: '12px 24px', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', fontSize: '15px' }}>
              {isLoading ? 'Migrating...' : '🚀 Migrate Entered RegNos'}
            </button>
          </div>
        )}

        <div style={{ width: '100%', overflowX: 'auto', border: '1px solid #cbd5e1', borderRadius: '14px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px', minWidth: '960px' }}>
            <thead>
              <tr style={{ background: '#0f172a', color: '#ffffff' }}>
                {!isRegNoEditMode && (
                  <th style={{ padding: '14px', width: '40px', color: '#ffffff' }}><input type="checkbox" checked={filteredStudents.length > 0 && selectedRows.length === filteredStudents.length} onChange={() => toggleSelectAll(filteredStudents)} style={{ width: '16px', height: '16px', cursor: 'pointer' }} /></th>
                )}
                <th style={{ padding: '14px', fontWeight: '800', color: '#ffffff' }}>Sn</th>
                <th style={{ padding: '14px', fontWeight: '800', color: '#ffffff' }}>Reg.No</th>
                {isRegNoEditMode && <th style={{ padding: '14px', color: '#fef08a', fontWeight: '800' }}>Type New Reg.No</th>}
                <th style={{ padding: '14px', fontWeight: '800', color: '#ffffff' }}>Student &amp; Ad.No</th>
                <th style={{ padding: '14px', fontWeight: '800', color: '#ffffff' }}>Mentor, Class Teacher &amp; Location</th>
                <th style={{ padding: '14px', fontWeight: '800', color: '#ffffff' }}>Classes &amp; Dept</th>
                <th style={{ padding: '14px', fontWeight: '800', color: '#ffffff' }}>Profile Completion</th>
                {!isRegNoEditMode && <th style={{ padding: '14px', fontWeight: '800', color: '#ffffff', textAlign: 'right' }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filteredStudents.map((student, index) => {
                const isUrdu = isUrduStudent(student.adNo);
                const safeClasses = getSafeClassesArray(student);
                const comp = computeStudentProfileCompletion(student);
                const autoCT = resolveClassTeacherForStudent(student, teachersList);

                return (
                  <tr key={index} style={{ borderBottom: '1px solid #e2e8f0', background: selectedRows.includes(student.regNo) || regNoDrafts[student.regNo] ? '#f0f9ff' : index % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                    {!isRegNoEditMode && (
                      <td style={{ padding: '12px 14px' }}><input type="checkbox" checked={selectedRows.includes(student.regNo)} onChange={() => toggleRowSelect(student.regNo)} style={{ width: '16px', height: '16px', cursor: 'pointer' }} /></td>
                    )}
                    <td style={{ padding: '12px 14px', fontWeight: '700', color: '#475569' }}>{student.rollNo || '-'}</td>
                    <td style={{ padding: '12px 14px', fontWeight: '800', color: '#0f172a' }}>{student.regNo}</td>

                    {isRegNoEditMode && (
                      <td style={{ padding: '12px 14px' }}>
                        <input
                          type="text"
                          value={regNoDrafts[student.regNo] || ''}
                          onChange={(e) => handleRegNoDraftChange(student.regNo, e.target.value)}
                          placeholder="Enter correction..."
                          style={{ width: '100%', padding: '8px 12px', border: '2px solid #94a3b8', borderRadius: '6px', fontWeight: '700' }}
                        />
                      </td>
                    )}

                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <ProfileAvatar name={student.firstName} code={student.adNo} photoUrl={student.photoUrl} size={38} onClick={() => setPortfolioModalStudent(student)} />
                        <div>
                          <div style={{ fontWeight: '800', color: '#0f172a' }}>{student.firstName}</div>
                          <span style={{ fontSize: '12px', color: '#475569', fontWeight: '700' }}>Ad: #{student.adNo}</span>
                          {isUrdu && <span style={{ ...styles.badge, background: '#fef3c7', color: '#b45309', marginLeft: '6px' }}>URDU</span>}
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: '12px', color: '#1e293b' }}>
                      <div>🧭 Mentor: <strong style={{ color: '#0f766e' }}>{student.mentorUsername || '—'}</strong></div>
                      <div>🏫 Class Teacher: <strong style={{ color: '#1d4ed8' }}>{autoCT ? autoCT.fullName : (student.classTeacherUsername || 'Auto')}</strong></div>
                      <div>📍 {student.district || '—'}, {student.state || 'Kerala'}</div>
                      {student.requiresPrincipalApproval && <span style={{ ...styles.badge, background: '#fef2f2', color: '#dc2626' }}>👑 Principal Only</span>}
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        <span style={{ ...styles.badge, background: '#e0f2fe', color: '#0369a1' }}>{student.department || 'GENERAL'}</span>
                        {safeClasses.map((c, i) => (
                          <span key={i} style={{ background: '#f1f5f9', color: '#0f172a', padding: '3px 7px', borderRadius: '6px', fontSize: '11px', fontWeight: '800', border: '1px solid #cbd5e1' }}>{c}</span>
                        ))}
                      </div>
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ width: '70px', height: '7px', background: '#e2e8f0', borderRadius: '999px', overflow: 'hidden' }}>
                          <div style={{ width: `${comp.pct}%`, height: '100%', background: comp.pct === 100 ? '#10b981' : comp.pct >= 60 ? '#f59e0b' : '#ef4444' }} />
                        </div>
                        <span style={{ fontSize: '12px', fontWeight: '800', color: comp.pct === 100 ? '#047857' : '#b45309' }}>{comp.pct}%</span>
                      </div>
                    </td>
                    {!isRegNoEditMode && (
                      <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          <button onClick={() => setPortfolioModalStudent(student)} style={{ padding: '6px 10px', background: '#f0fdfa', color: '#0f766e', border: '1px solid #0d9488', borderRadius: '6px', cursor: 'pointer', fontWeight: '800', fontSize: '12px' }}>🏆 Portfolio</button>
                          <button onClick={() => openDirectWhatsApp(student.parentWhatsapp || student.parentMobile, `Assalamu Alaikum, official update regarding ${student.firstName} (#${student.adNo}) from DHIU Portal:`)} style={{ padding: '6px 10px', background: '#dcfce7', color: '#166534', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '800', fontSize: '12px' }}>💬 WA</button>
                          <button onClick={() => handleEditClick(student)} style={{ padding: '6px 10px', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '800', fontSize: '12px' }}>Edit</button>
                          <button onClick={() => handleDeleteClick(student.regNo)} style={{ padding: '6px 10px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '800', fontSize: '12px' }}>Delete</button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}