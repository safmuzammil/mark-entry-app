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
  INDIAN_STATES, KERALA_DISTRICTS,
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
  // 🌟 Minimalist Top Action Panel Toggles ('none' | 'add' | 'import' | 'filters')
  const [activeTopPanel, setActiveTopPanel] = useState('none');
  const [expandedStudentRegNo, setExpandedStudentRegNo] = useState(null);
  const [visibleCols, setVisibleCols] = useState({
    regNo: false,
    mentor: false,
    location: false,
    completion: false
  });

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
    alert(`✅ Uploaded & linked ${matchedCount} student photo(s) by Ad.No!`);
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
      return alert("Please select at least one field above.");
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
    setStatusMsg(isEditing ? 'Updating student profile...' : 'Registering student...');
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
        } catch (e) {}
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
      setStatusMsg(isEditing ? '✅ Student profile updated!' : '✅ Student registered successfully!');
      fetchStudents();
      resetForm();
      setActiveTopPanel('none');
    } catch (err) {
      setIsLoading(false);
      setStatusMsg('Error: ' + err.message);
    }
  };

  const handleBulkUpdate = async () => {
    if (selectedRows.length === 0) return;
    if (!bulkMentor && !bulkReplaceClass && !bulkDept && !bulkMadhab && !bulkAddClass && bulkPrincipalLock === '') {
      return alert('Please choose at least one bulk action.');
    }
    if (!window.confirm(`Apply changes to ${selectedRows.length} selected students?`)) return;
    setIsLoading(true);
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
      setStatusMsg(`✅ Updated ${selectedRows.length} students!`);
      setSelectedRows([]);
      setBulkMentor(''); setBulkReplaceClass(''); setBulkDept(''); setBulkMadhab(''); setBulkAddClass(''); setBulkPrincipalLock('');
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
        setStatusMsg(`✅ Updated ${updatedCount} students!`);
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
    setActiveTopPanel('add');
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
    if (updates.length === 0) return alert('No changes entered.');
    if (!window.confirm(`Migrate ${updates.length} Registration Numbers?`)) return;

    setIsLoading(true);
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
      setStatusMsg(`✅ Migrated ${updates.length} students!`);
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

      {/* 🌟 SHUHOOD MINIMALIST HEADER + ACTION BUTTONS */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px', marginBottom: '22px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '26px', fontWeight: '800', color: '#0f172a' }}>Student Management</h1>
          <p style={{ margin: '4px 0 0', fontSize: '14px', color: '#64748b', fontWeight: '500' }}>
            Manage student enrollments, subject mappings, and profile records ({filteredStudents.length} of {registeredStudents.length}).
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => {
              if (activeTopPanel === 'add') {
                setActiveTopPanel('none');
                resetForm();
              } else {
                setActiveTopPanel('add');
              }
            }}
            style={{
              padding: '10px 18px',
              background: '#4f46e5',
              color: '#ffffff',
              border: 'none',
              borderRadius: '10px',
              fontWeight: '700',
              fontSize: '13px',
              cursor: 'pointer',
              boxShadow: '0 2px 6px rgba(79, 70, 229, 0.25)'
            }}
          >
            {activeTopPanel === 'add' ? '✕ Close Form' : '＋ Add Student'}
          </button>

          <button
            type="button"
            onClick={() => setActiveTopPanel(activeTopPanel === 'import' ? 'none' : 'import')}
            style={{
              padding: '10px 18px',
              background: activeTopPanel === 'import' ? '#eef2ff' : '#ffffff',
              color: '#4f46e5',
              border: '1px solid #c7d2fe',
              borderRadius: '10px',
              fontWeight: '700',
              fontSize: '13px',
              cursor: 'pointer'
            }}
          >
            ⬆️ Import CSV / Photos
          </button>

          <button
            type="button"
            onClick={() => setActiveTopPanel(activeTopPanel === 'filters' ? 'none' : 'filters')}
            style={{
              padding: '10px 16px',
              background: activeTopPanel === 'filters' ? '#eef2ff' : '#ffffff',
              color: '#334155',
              border: '1px solid #cbd5e1',
              borderRadius: '10px',
              fontWeight: '700',
              fontSize: '13px',
              cursor: 'pointer'
            }}
          >
            🎛️ Filter &amp; Columns
          </button>
        </div>
      </div>

      {/* MARKS-AUDITOR STYLE SOFT PASTEL KPI STRIP */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', marginBottom: '20px' }}>
        <div onClick={() => setFilterCompletion('All')} style={{ padding: '16px', borderRadius: '12px', background: '#f8fafc', border: '1px solid #e2e8f0', textAlign: 'center', cursor: 'pointer' }}>
          <span style={{ fontSize: '11px', fontWeight: '800', color: '#475569' }}>TOTAL ENROLLED</span>
          <div style={{ fontSize: '24px', fontWeight: '900', color: '#0f172a', marginTop: '4px' }}>{totalStudentsCount}</div>
        </div>
        <div onClick={() => setFilterCompletion('Complete')} style={{ padding: '16px', borderRadius: '12px', background: '#ecfdf5', border: '1px solid #a7f3d0', textAlign: 'center', cursor: 'pointer' }}>
          <span style={{ fontSize: '11px', fontWeight: '800', color: '#047857' }}>COMPLETE PROFILES</span>
          <div style={{ fontSize: '24px', fontWeight: '900', color: '#065f46', marginTop: '4px' }}>{completeStudentsCount}</div>
        </div>
        <div onClick={() => setFilterCompletion('Incomplete')} style={{ padding: '16px', borderRadius: '12px', background: '#fff1f2', border: '1px solid #fecdd3', textAlign: 'center', cursor: 'pointer' }}>
          <span style={{ fontSize: '11px', fontWeight: '800', color: '#be123c' }}>MISSING / INCOMPLETE</span>
          <div style={{ fontSize: '24px', fontWeight: '900', color: '#e11d48', marginTop: '4px' }}>{incompleteStudentsCount}</div>
        </div>
        <div style={{ padding: '16px', borderRadius: '12px', background: '#eff6ff', border: '1px solid #bfdbfe', textAlign: 'center' }}>
          <span style={{ fontSize: '11px', fontWeight: '800', color: '#1d4ed8' }}>COMPLETION RATE</span>
          <div style={{ fontSize: '24px', fontWeight: '900', color: '#2563eb', marginTop: '4px' }}>{overallCompletionPct}%</div>
        </div>
      </div>

      {statusMsg && (
        <div style={{ marginBottom: '18px', padding: '12px 16px', background: statusMsg.includes('Error') ? '#fff1f2' : '#ecfdf5', borderRadius: '10px', color: statusMsg.includes('Error') ? '#e11d48' : '#047857', fontWeight: '700', fontSize: '13px' }}>
          {statusMsg}
        </div>
      )}

      {/* PANEL 1: IMPORT CSV & PHOTOS */}
      {activeTopPanel === 'import' && (
        <div className="erp-slide-panel" style={styles.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800', color: '#0f172a' }}>Students CSV &amp; Bulk Folder Photo Uploader</h3>
            <button type="button" onClick={() => setActiveTopPanel('none')} style={styles.buttonSecondary}>✕ Close</button>
          </div>

          <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0', marginBottom: '14px' }}>
            <div style={{ fontSize: '12px', fontWeight: '700', color: '#475569', marginBottom: '8px' }}>
              Select fields to include in Partial CSV Template (`adNo`, `regNo`, and `firstName` included automatically):
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {STUDENT_PARTIAL_FIELDS.map(f => {
                const active = selectedPartialCols.includes(f.key);
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => togglePartialCol(f.key)}
                    style={{
                      padding: '6px 12px', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: '700',
                      background: active ? '#4f46e5' : '#ffffff',
                      color: active ? '#ffffff' : '#334155',
                      border: active ? '1px solid #4f46e5' : '1px solid #cbd5e1'
                    }}
                  >
                    {active ? `✓ ${f.label}` : `+ ${f.label}`}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
            <button type="button" onClick={handleDownloadCustomPartialTemplate} style={styles.buttonPrimary}>
              📥 Download Partial CSV ({selectedPartialCols.length})
            </button>
            <button type="button" onClick={handleDownloadMasterTemplate} style={styles.buttonSecondary}>
              📥 Full Master Template
            </button>
            <label style={{ ...styles.buttonSecondary, background: '#eef2ff', color: '#4f46e5', borderColor: '#c7d2fe', display: 'inline-flex', alignItems: 'center' }}>
              📂 Upload CSV
              <input type="file" accept=".csv" onChange={handleCSVUpload} style={{ display: 'none' }} />
            </label>
            <label style={{ ...styles.buttonSecondary, display: 'inline-flex', alignItems: 'center' }}>
              📸 Bulk Link Photos (By Ad.No)
              <input type="file" accept="image/*" multiple onChange={handleBulkPhotoUploadFromPCFolder} style={{ display: 'none' }} />
            </label>
            {bulkPhotoProgress && <span style={{ fontWeight: '700', color: '#4f46e5', fontSize: '12px' }}>⏳ {bulkPhotoProgress}</span>}
          </div>
        </div>
      )}

      {/* PANEL 2: REGISTER / EDIT STUDENT */}
      {activeTopPanel === 'add' && (
        <div className="erp-slide-panel" style={styles.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px' }}>
            <h3 style={{ margin: 0, fontSize: '17px', fontWeight: '800', color: '#0f172a' }}>
              {isEditing ? `Edit Student: ${firstName} (${regNo})` : 'Register Student & Assign Subject Teachers'}
            </h3>
            <button type="button" onClick={() => { resetForm(); setActiveTopPanel('none'); }} style={styles.buttonSecondary}>Cancel</button>
          </div>

          <form onSubmit={handleAddOrUpdateStudent} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '12px', fontWeight: '800', color: '#0f172a', marginBottom: '10px', textTransform: 'uppercase' }}>
                1. Select Student Class / Batch
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
                {availableStudentClasses.map(cls => {
                  const active = selectedClasses.includes(cls);
                  return (
                    <button
                      key={cls}
                      type="button"
                      onClick={() => toggleStudentClass(cls)}
                      style={{
                        padding: '6px 14px', borderRadius: '8px', fontWeight: '700', fontSize: '12px', cursor: 'pointer',
                        background: active ? '#4f46e5' : '#ffffff',
                        color: active ? '#ffffff' : '#334155',
                        border: active ? '1px solid #4f46e5' : '1px solid #cbd5e1'
                      }}
                    >
                      {active ? `✓ ${cls}` : cls}
                    </button>
                  );
                })}
              </div>

              <SubjectTeacherSelector
                selectedClasses={selectedClasses}
                adNo={adNo}
                teachersList={teachersList}
                selectedEnrollmentKeys={selectedSubjectEnrollmentKeys}
                onChangeSelectedKeys={setSelectedSubjectEnrollmentKeys}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
              <div><label style={styles.label}>Roll No</label><input type="number" value={rollNo} onChange={(e) => setRollNo(e.target.value)} required style={styles.input} /></div>
              <div><label style={styles.label}>Full Name</label><input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} required style={styles.input} /></div>
              <div><label style={styles.label}>Reg.No (Login ID)</label><input type="text" value={regNo} onChange={(e) => setRegNo(e.target.value)} disabled={isEditing} required style={styles.input} /></div>
              <div><label style={styles.label}>Admission No (Ad.No)</label><input type="text" value={adNo} onChange={(e) => setAdNo(e.target.value)} required style={styles.input} /></div>
              <div><label style={styles.label}>Department</label><select value={department} onChange={(e) => setDepartment(e.target.value)} style={styles.input}>{DEPARTMENTS.map(dept => <option key={dept} value={dept}>{dept}</option>)}</select></div>
              <div><label style={styles.label}>Madhab</label><select value={madhab} onChange={(e) => setMadhab(e.target.value)} style={styles.input}>{MADHABS.map(m => <option key={m} value={m}>{m}</option>)}</select></div>
              <div>
                <label style={styles.label}>State / Country</label>
                <select value={state} onChange={(e) => setState(e.target.value)} style={styles.input}>
                  {INDIAN_STATES.map(st => <option key={st} value={st}>{st}</option>)}
                </select>
              </div>
              <div>
                <label style={styles.label}>District</label>
                {state === 'Kerala' ? (
                  <select value={district} onChange={(e) => setDistrict(e.target.value)} style={styles.input}>
                    {KERALA_DISTRICTS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                ) : (
                  <input type="text" value={district} onChange={(e) => setDistrict(e.target.value)} style={styles.input} />
                )}
              </div>
              <div><label style={styles.label}>Student Email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={styles.input} /></div>
              <div><label style={styles.label}>Student WhatsApp</label><input type="text" value={whatsappNumber} onChange={(e) => setWhatsappNumber(e.target.value)} style={styles.input} /></div>
              <div><label style={styles.label}>Parent WhatsApp</label><input type="text" value={parentWhatsapp} onChange={(e) => setParentWhatsapp(e.target.value)} style={styles.input} /></div>
              <div>
                <label style={styles.label}>Assigned Mentor</label>
                <select value={mentorUsername} onChange={(e) => setMentorUsername(e.target.value)} style={styles.input}>
                  <option value="">-- Assign Later --</option>
                  {teachersList.map(t => <option key={t.username} value={t.username}>{t.fullName}</option>)}
                </select>
              </div>
              <div>
                <label style={styles.label}>Photo</label>
                <input type="file" accept="image/*" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setPhotoUrl(await compressImageFileToDataUrl(f, 180, 0.8)); }} style={styles.input} />
              </div>
            </div>

            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: '700', color: '#be123c', cursor: 'pointer' }}>
              <input type="checkbox" checked={requiresPrincipalApproval} onChange={(e) => setRequiresPrincipalApproval(e.target.checked)} />
              👑 Require Principal Approval Only for Out-Pass Leaves
            </label>

            <button type="submit" disabled={isLoading} style={styles.buttonPrimary}>
              {isLoading ? 'Processing...' : isEditing ? 'Update Student Profile' : 'Register Student'}
            </button>
          </form>
        </div>
      )}

      {/* PANEL 3: FILTER & COLUMNS DRAWER (Opens only when clicked) */}
      {activeTopPanel === 'filters' && (
        <div className="erp-slide-panel" style={{ ...styles.card, background: '#f8fafc', padding: '16px 20px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
              <select value={filterClass} onChange={(e) => setFilterClass(e.target.value)} style={styles.filterSelect}>
                <option value="All">All Classes</option>
                {availableStudentClasses.map(cls => <option key={cls} value={cls}>{cls}</option>)}
              </select>
              <select value={filterMentor} onChange={(e) => setFilterMentor(e.target.value)} style={styles.filterSelect}>
                <option value="All">All Mentors</option>
                {teachersList.map(t => <option key={t.username} value={t.username}>{t.fullName}</option>)}
              </select>
              <select value={filterLanguage} onChange={(e) => setFilterLanguage(e.target.value)} style={styles.filterSelect}>
                <option value="All">All Streams</option><option value="Urdu">Urdu Only</option><option value="Non-Urdu">Non-Urdu</option>
              </select>
              <select value={filterCompletion} onChange={(e) => setFilterCompletion(e.target.value)} style={styles.filterSelect}>
                <option value="All">All Profile Status</option>
                <option value="Incomplete">Incomplete</option>
                <option value="Complete">Complete</option>
              </select>
              <button
                type="button"
                onClick={() => { setIsRegNoEditMode(!isRegNoEditMode); setRegNoDrafts({}); }}
                style={styles.buttonSecondary}
              >
                {isRegNoEditMode ? 'Cancel RegNo Edit' : '✏️ Mass Edit RegNo'}
              </button>
            </div>

            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>Columns:</span>
              {[
                { key: 'regNo', label: 'Reg.No' },
                { key: 'mentor', label: 'Mentor & CT' },
                { key: 'location', label: 'District & State' },
                { key: 'completion', label: 'Profile %' }
              ].map(col => (
                <button
                  key={col.key}
                  type="button"
                  onClick={() => setVisibleCols(prev => ({ ...prev, [col.key]: !prev[col.key] }))}
                  style={{
                    padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: '700', cursor: 'pointer',
                    background: visibleCols[col.key] ? '#4f46e5' : '#ffffff',
                    color: visibleCols[col.key] ? '#ffffff' : '#475569',
                    border: '1px solid #cbd5e1'
                  }}
                >
                  {visibleCols[col.key] ? `✓ ${col.label}` : `+ ${col.label}`}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {DEPARTMENTS.map(d => (
              <button
                key={d}
                type="button"
                onClick={() => toggleFilterDirectoryDept(d)}
                style={{
                  fontSize: '11px', padding: '5px 10px', borderRadius: '6px', cursor: 'pointer', fontWeight: '700',
                  background: filterDepartments.includes(d) ? '#4f46e5' : '#ffffff',
                  color: filterDepartments.includes(d) ? '#ffffff' : '#475569',
                  border: '1px solid #cbd5e1'
                }}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* BULK ACTION BAR (Appears only when checkboxes are ticked) */}
      {selectedRows.length > 0 && !isRegNoEditMode && (
        <div className="erp-slide-panel" style={{ padding: '14px 18px', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: '12px', marginBottom: '18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <strong style={{ color: '#3730a3', fontSize: '14px' }}>
            ☑️ {selectedRows.length} Students Checked
          </strong>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={bulkMentor} onChange={(e) => setBulkMentor(e.target.value)} style={styles.filterSelect}>
              <option value="">Assign Mentor...</option>
              <option value="__CLEAR__">Clear Mentor</option>
              {teachersList.map(t => <option key={t.username} value={t.username}>{t.fullName}</option>)}
            </select>
            <select value={bulkReplaceClass} onChange={(e) => setBulkReplaceClass(e.target.value)} style={styles.filterSelect}>
              <option value="">Move to Class...</option>
              {DEFAULT_CLASSES.map(cls => <option key={cls} value={cls}>{cls}</option>)}
            </select>
            <select value={bulkDept} onChange={(e) => setBulkDept(e.target.value)} style={styles.filterSelect}>
              <option value="">Set Dept...</option>
              {DEPARTMENTS.map(dept => <option key={dept} value={dept}>{dept}</option>)}
            </select>
            <button onClick={handleBulkUpdate} style={styles.buttonPrimary}>
              Apply to {selectedRows.length}
            </button>
          </div>
        </div>
      )}

      {isRegNoEditMode && (
        <div style={{ padding: '14px 18px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px', marginBottom: '18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong style={{ color: '#92400e', fontSize: '13px' }}>Mass RegNo Edit Mode Active</strong>
          <button onClick={executeRegNoMigration} disabled={isLoading} style={styles.buttonPrimary}>
            Migrate RegNos
          </button>
        </div>
      )}

      {/* 🌟 MINIMALIST SHUHOOD STUDENT DIRECTORY TABLE */}
      <div style={{ ...styles.card, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <input
            type="text"
            placeholder="🔍 Search student name, Ad.No, or Reg.No..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ ...styles.input, maxWidth: '300px', padding: '8px 12px', fontSize: '13px' }}
          />
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <select value={filterClass} onChange={(e) => setFilterClass(e.target.value)} style={styles.filterSelect}>
              <option value="All">All Classes</option>
              {availableStudentClasses.map(cls => <option key={cls} value={cls}>{cls}</option>)}
            </select>
          </div>
        </div>

        <div style={{ width: '100%', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '11px', fontWeight: '800', textTransform: 'uppercase' }}>
                {!isRegNoEditMode && (
                  <th style={{ padding: '14px 16px', width: '40px' }}>
                    <input type="checkbox" checked={filteredStudents.length > 0 && selectedRows.length === filteredStudents.length} onChange={() => toggleSelectAll(filteredStudents)} />
                  </th>
                )}
                <th style={{ padding: '14px 16px', width: '55px' }}>#</th>
                <th style={{ padding: '14px 16px' }}>NAME</th>
                <th style={{ padding: '14px 16px' }}>ADMISSION NO</th>
                {visibleCols.regNo && <th style={{ padding: '14px 16px' }}>REG.NO</th>}
                {isRegNoEditMode && <th style={{ padding: '14px 16px' }}>NEW REG.NO</th>}
                <th style={{ padding: '14px 16px' }}>CLASS &amp; DEPT</th>
                {visibleCols.mentor && <th style={{ padding: '14px 16px' }}>MENTOR &amp; CT</th>}
                {visibleCols.location && <th style={{ padding: '14px 16px' }}>LOCATION</th>}
                {visibleCols.completion && <th style={{ padding: '14px 16px' }}>PROFILE %</th>}
                <th style={{ padding: '14px 16px' }}>STATUS</th>
                {!isRegNoEditMode && <th style={{ padding: '14px 16px', textAlign: 'right' }}>ACTIONS</th>}
              </tr>
            </thead>
            <tbody>
              {filteredStudents.map((student, index) => {
                const safeClasses = getSafeClassesArray(student);
                const comp = computeStudentProfileCompletion(student);
                const autoCT = resolveClassTeacherForStudent(student, teachersList);
                const isExpanded = expandedStudentRegNo === student.regNo;

                return (
                  <React.Fragment key={student.regNo}>
                    <tr
                      onClick={() => setExpandedStudentRegNo(isExpanded ? null : student.regNo)}
                      style={{ borderBottom: '1px solid #f1f5f9', background: selectedRows.includes(student.regNo) || isExpanded ? '#f8fafc' : '#ffffff', cursor: 'pointer' }}
                    >
                      {!isRegNoEditMode && (
                        <td style={{ padding: '14px 16px' }} onClick={e => e.stopPropagation()}>
                          <input type="checkbox" checked={selectedRows.includes(student.regNo)} onChange={() => toggleRowSelect(student.regNo)} />
                        </td>
                      )}
                      <td style={{ padding: '14px 16px', color: '#64748b', fontWeight: '600' }}>{student.rollNo || index + 1}</td>
                      <td style={{ padding: '14px 16px', fontWeight: '700', color: '#0f172a' }}>
                        {student.firstName}
                        {student.requiresPrincipalApproval && (
                          <span style={{ marginLeft: '6px', background: '#fff1f2', color: '#e11d48', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: '800' }}>
                            Principal Lock
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '14px 16px', color: '#475569', fontWeight: '600' }}>
                        {student.adNo}
                      </td>
                      {visibleCols.regNo && <td style={{ padding: '14px 16px', color: '#64748b' }}>{student.regNo}</td>}

                      {isRegNoEditMode && (
                        <td style={{ padding: '14px 16px' }} onClick={e => e.stopPropagation()}>
                          <input
                            type="text"
                            value={regNoDrafts[student.regNo] || ''}
                            onChange={(e) => handleRegNoDraftChange(student.regNo, e.target.value)}
                            placeholder="New Reg.No..."
                            style={{ ...styles.input, padding: '6px 10px' }}
                          />
                        </td>
                      )}

                      <td style={{ padding: '14px 16px' }}>
                        <span style={{ fontWeight: '700', color: '#334155' }}>{safeClasses.join(', ')}</span>
                        <span style={{ color: '#94a3b8', fontSize: '12px', marginLeft: '6px' }}>• {student.department || 'GEN'}</span>
                      </td>

                      {visibleCols.mentor && (
                        <td style={{ padding: '14px 16px', fontSize: '12px', color: '#475569' }}>
                          {student.mentorUsername || '—'}
                        </td>
                      )}
                      {visibleCols.location && (
                        <td style={{ padding: '14px 16px', fontSize: '12px', color: '#475569' }}>
                          {student.district || '—'}, {student.state || 'Kerala'}
                        </td>
                      )}
                      {visibleCols.completion && (
                        <td style={{ padding: '14px 16px', fontSize: '12px', fontWeight: '700', color: comp.pct === 100 ? '#047857' : '#d97706' }}>
                          {comp.pct}%
                        </td>
                      )}

                      <td style={{ padding: '14px 16px' }}>
                        <span style={{ background: '#dcfce7', color: '#15803d', padding: '4px 12px', borderRadius: '999px', fontSize: '11px', fontWeight: '700' }}>
                          Active
                        </span>
                      </td>

                      {!isRegNoEditMode && (
                        <td style={{ padding: '14px 16px', textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                          <div style={{ display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
                            <button
                              type="button"
                              onClick={() => handleEditClick(student)}
                              style={{ padding: '6px 12px', background: '#eef2ff', color: '#4f46e5', border: 'none', borderRadius: '8px', fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}
                            >
                              ✏️ Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => setExpandedStudentRegNo(isExpanded ? null : student.regNo)}
                              style={{ padding: '6px 12px', background: '#f1f5f9', color: '#334155', border: 'none', borderRadius: '8px', fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}
                            >
                              👁️ {isExpanded ? 'Hide' : 'View'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteClick(student.regNo)}
                              style={{ padding: '6px 10px', background: 'transparent', color: '#e11d48', border: 'none', fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}
                            >
                              🗑️ Delete
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>

                    {/* 🌟 EXPANDABLE STUDENT DETAILS ROW (Shown only when "View" or Row is clicked!) */}
                    {isExpanded && (
                      <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                        <td colSpan={12} style={{ padding: '18px 24px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                              <ProfileAvatar name={student.firstName} code={student.adNo} photoUrl={student.photoUrl} size={48} />
                              <div>
                                <div style={{ fontWeight: '800', fontSize: '15px', color: '#0f172a' }}>
                                  {student.firstName} <span style={{ color: '#4f46e5' }}>(Ad.No: #{student.adNo} • Reg: {student.regNo})</span>
                                </div>
                                <div style={{ fontSize: '12px', color: '#475569', marginTop: '4px' }}>
                                  🧭 Mentor: <strong>{student.mentorUsername || 'Unassigned'}</strong> • 🏫 Class Teacher: <strong>{autoCT ? autoCT.fullName : 'Auto'}</strong> • Profile: <strong>{comp.pct}% Complete</strong>
                                </div>
                                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '3px' }}>
                                  📱 Student: {student.whatsappNumber || student.mobileNumber || '—'} • 👨‍👩‍👦 Parent: {student.parentWhatsapp || student.parentMobile || '—'} • 📍 {student.district || '—'}, {student.state || 'Kerala'}
                                </div>
                              </div>
                            </div>

                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                              <button type="button" onClick={() => setPortfolioModalStudent(student)} style={styles.buttonPrimary}>
                                🏆 Open Portfolio &amp; Consultancy Logs
                              </button>
                              <button
                                type="button"
                                onClick={() => openDirectWhatsApp(student.parentWhatsapp || student.parentMobile, `Assalamu Alaikum, official update regarding ${student.firstName} (#${student.adNo}):`)}
                                style={styles.buttonSecondary}
                              >
                                💬 Parent WhatsApp
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}