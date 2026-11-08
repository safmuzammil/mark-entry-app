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
import { doc, setDoc, getDoc, getDocs, collection, deleteDoc } from 'firebase/firestore';
import { getApp, initializeApp } from 'firebase/app';
import {
  WEB_APP_URL, DEFAULT_SUBJECTS, DEFAULT_CLASSES, GRADES, styles
} from './erpConstants';
import {
  INDIAN_STATES, KERALA_DISTRICTS,
  compressImageFileToDataUrl, openDirectWhatsApp, openWhatsAppGroupAndCopy,
  sendDirectEmailNotification, ProfileAvatar, TeacherPrivilegeModal
} from './ErpExtensions';

const TEACHER_PARTIAL_FIELDS = [
  { key: 'fullName', label: 'Full Name' },
  { key: 'designation', label: 'Designation' },
  { key: 'roleCategory', label: 'Role Category (Teacher/Principal)' },
  { key: 'mobileNumber', label: 'Mobile Number' },
  { key: 'whatsappNumber', label: 'WhatsApp Number' },
  { key: 'email', label: 'Email Address' },
  { key: 'state', label: 'State / Country' },
  { key: 'district', label: 'District / Province' },
  { key: 'classTeacherOf', label: 'Class Teacher Of (e.g. QLA3)' },
  { key: 'password', label: 'Initial Password (For New Accounts)' }
];

const QUICK_NON_MARK_SUBJECTS = [
  'Speech Practice', 'PKV', 'Economics DG D3', 'Arabic Debate',
  'Urdu Debate', 'English Oratory', 'General Assembly'
];

export default function TeacherManager({ onOpenProxyMarks }) {
  // 🌟 Minimalist Top Action Panel Toggles ('none' | 'add' | 'import' | 'broadcast' | 'filters')
  const [activeTopPanel, setActiveTopPanel] = useState('none');
  const [expandedTeacherUsername, setExpandedTeacherUsername] = useState(null);
  const [resetModalTeacher, setResetModalTeacher] = useState(null);
  const [newResetPassword, setNewResetPassword] = useState('');
  const [resetSuccessData, setResetSuccessData] = useState(null);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [visibleCols, setVisibleCols] = useState({
    roles: false,
    contact: false,
    subjects: false
  });
  const [teacherSearch, setTeacherSearch] = useState('');
  const [teacherRoleFilter, setTeacherRoleFilter] = useState('All');

  const [selectedTeacherUsernames, setSelectedTeacherUsernames] = useState([]);
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastBody, setBroadcastBody] = useState('');
  const [staffGroupLink, setStaffGroupLink] = useState('');

  const [selectedPartialCols, setSelectedPartialCols] = useState(['whatsappNumber', 'email']);
  const [bulkTeacherPhotoProgress, setBulkTeacherPhotoProgress] = useState('');

  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [designation, setDesignation] = useState('Faculty');
  const [mobileNumber, setMobileNumber] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [email, setEmail] = useState('');
  const [state, setState] = useState('Kerala');
  const [district, setDistrict] = useState('Malappuram');
  const [photoUrl, setPhotoUrl] = useState('');
  const [enrollments, setEnrollments] = useState([]);

  const [isMentorRole, setIsMentorRole] = useState(true);
  const [isPrincipalRole, setIsPrincipalRole] = useState(false);
  const [isNiicsCoordRole, setIsNiicsCoordRole] = useState(false);
  const [isAcademicCoordRole, setIsAcademicCoordRole] = useState(false);
  const [isOutreachCoordRole, setIsOutreachCoordRole] = useState(false);
  const [isOfficeSecRole, setIsOfficeSecRole] = useState(false);
  const [isEventLeaderRole, setIsEventLeaderRole] = useState(false);
  const [classTeacherOf, setClassTeacherOf] = useState([]);
  const [isNonMarkMode, setIsNonMarkMode] = useState(false);

  const [registeredTeachers, setRegisteredTeachers] = useState([]);
  const [privilegeModalTeacher, setPrivilegeModalTeacher] = useState(null);

  const [isEditing, setIsEditing] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const [envGrade, setEnvGrade] = useState('1');
  const [envTargetClass, setEnvTargetClass] = useState(DEFAULT_CLASSES[0]);
  const [envSubject, setEnvSubject] = useState(DEFAULT_SUBJECTS[0]);
  const [envLangTag, setEnvLangTag] = useState('');

  const normalizeCls = (str) => String(str || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  const fetchInitialData = async () => {
    try {
      const [tSnap, groupSnap] = await Promise.all([
        getDocs(collection(db, 'teachers')),
        getDoc(doc(db, 'systemCache', 'whatsappGroups'))
      ]);
      const teachersData = [];
      tSnap.forEach(d => teachersData.push(d.data()));
      teachersData.sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''));
      setRegisteredTeachers(teachersData);

      if (groupSnap.exists() && groupSnap.data().staffGroupLink) {
        setStaffGroupLink(groupSnap.data().staffGroupLink);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => { fetchInitialData(); }, []);

  const handleTeacherPhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const compressed = await compressImageFileToDataUrl(file, 180, 0.8);
    setPhotoUrl(compressed);
  };

  const handleBulkTeacherPhotoUploadFromFolder = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setBulkTeacherPhotoProgress(`Processing 0 / ${files.length} photos...`);
    let matchedCount = 0;

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const baseName = f.name.replace(/\.[^/.]+$/, "").trim().toLowerCase();
      setBulkTeacherPhotoProgress(`Compressing (${i + 1}/${files.length}): ${f.name}...`);

      const matchedTeacher = registeredTeachers.find(
        t => String(t.username || '').trim().toLowerCase() === baseName
      );
      if (!matchedTeacher) continue;

      try {
        const compressedDataUrl = await compressImageFileToDataUrl(f, 180, 0.78);
        await setDoc(doc(db, 'teachers', matchedTeacher.username), { photoUrl: compressedDataUrl }, { merge: true });
        matchedCount++;
      } catch (err) {}
    }

    setBulkTeacherPhotoProgress('');
    e.target.value = null;
    alert(`✅ Uploaded and linked ${matchedCount} teacher photo(s) by username!`);
    fetchInitialData();
  };

  const togglePartialCol = (colKey) => {
    if (selectedPartialCols.includes(colKey)) {
      setSelectedPartialCols(selectedPartialCols.filter(k => k !== colKey));
    } else {
      setSelectedPartialCols([...selectedPartialCols, colKey]);
    }
  };

  const toggleClassTeacherClass = (cls) => {
    if (classTeacherOf.includes(cls)) {
      setClassTeacherOf(classTeacherOf.filter(c => c !== cls));
    } else {
      setClassTeacherOf([...classTeacherOf, cls]);
    }
  };

  const handleDownloadFullTeacherCSV = () => {
    const csv = 'data:text/csv;charset=utf-8,username,fullName,password,designation,roleCategory,mobileNumber,whatsappNumber,email,state,district,classTeacherOf\nyusuf,"Usthad Yusuf",yusuf123,Principal,Principal,9876543210,9876543210,yusuf@dhiu.in,Kerala,Malappuram,QH1';
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csv));
    link.setAttribute('download', 'teacher_full_registration_template.csv');
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const handleDownloadCustomPartialTeacherCSV = () => {
    if (selectedPartialCols.length === 0) {
      return alert("Please select at least one field to include in your custom partial CSV template.");
    }
    const headers = ['username', 'fullName', ...selectedPartialCols.filter(c => c !== 'fullName')];
    const rows = registeredTeachers.length > 0
      ? registeredTeachers.map(t => {
          return headers.map(h => {
            if (h === 'username') return t.username || '';
            if (h === 'fullName') return `"${(t.fullName || '').replace(/"/g, '""')}"`;
            if (h === 'classTeacherOf') return `"${((t.outpassPrivileges?.classTeacherOf) || []).join(', ')}"`;
            if (h === 'password') return '';
            return `"${String(t[h] || '').replace(/"/g, '""')}"`;
          }).join(',');
        })
      : [`yusuf,"Usthad Yusuf",${selectedPartialCols.filter(c => c !== 'fullName').map(() => '').join(',')}`];

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows].join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', `teacher_partial_${selectedPartialCols.join('_')}.csv`);
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const handleTeacherCSVUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const workbook = XLSX.read(ev.target.result, { type: 'string' });
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
      if (rows.length === 0) return alert("No rows found in CSV.");
      setIsLoading(true);
      setStatusMsg(`Updating ${rows.length} teachers...`);
      const primaryApp = getApp();
      let secondaryApp;
      try { secondaryApp = getApp("SecondaryApp"); } catch (err) { secondaryApp = initializeApp(primaryApp.options, "SecondaryApp"); }
      const secondaryAuth = getAuth(secondaryApp);
      await setPersistence(secondaryAuth, inMemoryPersistence);

      for (const row of rows) {
        const rawUser = String(row.username || row.Username || '').trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
        if (!rawUser) continue;
        const existingTeacher = registeredTeachers.find(t => t.username === rawUser);
        const payload = { username: rawUser };

        if (row.fullName !== undefined && row.fullName !== '') payload.fullName = String(row.fullName).trim();
        if (row.designation !== undefined && row.designation !== '') payload.designation = String(row.designation).trim();
        if (row.roleCategory !== undefined && row.roleCategory !== '') payload.roleCategory = String(row.roleCategory).trim();
        if (row.mobileNumber !== undefined && row.mobileNumber !== '') payload.mobileNumber = String(row.mobileNumber).trim();
        if (row.whatsappNumber !== undefined && row.whatsappNumber !== '') payload.whatsappNumber = String(row.whatsappNumber).trim();
        if (row.email !== undefined && row.email !== '') payload.email = String(row.email).trim();
        if (row.state !== undefined && row.state !== '') payload.state = String(row.state).trim();
        if (row.district !== undefined && row.district !== '') payload.district = String(row.district).trim();

        if (row.classTeacherOf !== undefined && row.classTeacherOf !== '') {
          const ct = String(row.classTeacherOf).split(',').map(x => x.trim()).filter(Boolean);
          let updatedEnrollments = Array.isArray(existingTeacher?.enrollments) ? [...existingTeacher.enrollments] : [];
          ct.forEach(clsName => {
            const normCls = normalizeCls(clsName);
            const gradeMatch = String(clsName).match(/\d+/);
            const gradeNum = gradeMatch ? gradeMatch[0] : '1';
            const hasHifz = updatedEnrollments.some(e => {
              const isSubHifz = String(e.subject || '').toUpperCase() === 'HIFZ' || String(e.alias || '').toUpperCase().includes('HIFZ');
              return isSubHifz && (normalizeCls(e.targetClass) === normCls || normalizeCls(e.alias).includes(normCls));
            });
            if (!hasHifz) {
              updatedEnrollments.push({
                id: `hifz_${normCls}`,
                grade: gradeNum,
                targetClass: clsName,
                subject: 'Hifz',
                alias: `${clsName} Hifz`,
                langTag: '',
                studentIds: []
              });
            }
          });
          payload.enrollments = updatedEnrollments;
          payload.outpassPrivileges = {
            ...(existingTeacher?.outpassPrivileges || {}),
            classTeacherOf: ct,
            allowedCategories: ['Friday', 'Evening', ...(ct.length > 0 ? ['General', 'Medical'] : [])]
          };
        }

        const pwd = String(row.password || '').trim();
        if (pwd.length >= 6) {
          try { await createUserWithEmailAndPassword(secondaryAuth, `${rawUser}@school.com`, pwd); } catch (err) {}
        }
        await setDoc(doc(db, 'teachers', rawUser), payload, { merge: true });
      }
      await signOut(secondaryAuth);
      setIsLoading(false);
      setStatusMsg(`✅ Successfully updated ${rows.length} teachers!`);
      fetchInitialData();
    };
    reader.readAsText(file);
    e.target.value = null;
  };

  const handleAddEnrollment = () => {
    const cleanSub = String(envSubject || '').trim();
    if (!cleanSub || !envTargetClass) return alert("Please select Grade, Class, and Subject.");

    const generatedAlias = envTargetClass === 'CUSTOM'
      ? cleanSub
      : `${envTargetClass} ${cleanSub}`;

    const newEnv = {
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      grade: envGrade,
      targetClass: envTargetClass,
      subject: cleanSub,
      alias: generatedAlias,
      langTag: envLangTag,
      isAttendanceOnly: Boolean(isNonMarkMode),
      studentIds: []
    };
    setEnrollments([...enrollments, newEnv]);
    setEnvLangTag('');
  };

  const handleRemoveEnrollment = (id) => setEnrollments(enrollments.filter(env => env.id !== id));

  const handleAddOrUpdateTeacher = async (e) => {
    e.preventDefault();
    if (!isEditing && password.trim().length < 6) {
      return alert("Password must be at least 6 characters.");
    }
    if (isEditing && password.trim().length > 0 && password.trim().length < 6) {
      return alert("New password must be at least 6 characters.");
    }

    setIsLoading(true);
    setStatusMsg(isEditing ? 'Updating teacher profile & roles...' : 'Registering teacher securely...');
    const safeUsername = username.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
    const fakeEmail = `${safeUsername}@school.com`;

    try {
      if (!isEditing || password.trim().length >= 6) {
        const primaryApp = getApp();
        let secondaryApp;
        try { secondaryApp = getApp("SecondaryApp"); } catch (err) { secondaryApp = initializeApp(primaryApp.options, "SecondaryApp"); }
        const secondaryAuth = getAuth(secondaryApp);
        await setPersistence(secondaryAuth, inMemoryPersistence);

        try {
          await createUserWithEmailAndPassword(secondaryAuth, fakeEmail, password.trim());
        } catch (authErr) {
          if (authErr.code !== 'auth/email-already-in-use') throw authErr;
        }
        await signOut(secondaryAuth);
      }

      const seenHifz = new Set();
      let finalEnrollments = enrollments.filter(e => {
        const isSubHifz = String(e.subject || '').toUpperCase() === 'HIFZ' || String(e.alias || '').toUpperCase().includes('HIFZ');
        if (!isSubHifz) return true;
        const normKey = normalizeCls(e.targetClass || e.alias).replace('HIFZ', '');
        if (normKey && seenHifz.has(normKey)) return false;
        if (normKey) seenHifz.add(normKey);
        return true;
      });

      classTeacherOf.forEach(clsName => {
        const normCls = normalizeCls(clsName);
        const gradeMatch = String(clsName).match(/\d+/);
        const gradeNum = gradeMatch ? gradeMatch[0] : '1';
        const alreadyHasHifz = finalEnrollments.some(env => {
          const isSubHifz = String(env.subject || '').toUpperCase() === 'HIFZ' || String(env.alias || '').toUpperCase().includes('HIFZ');
          return isSubHifz && (normalizeCls(env.targetClass) === normCls || normalizeCls(env.alias).includes(normCls));
        });
        if (!alreadyHasHifz) {
          finalEnrollments.push({
            id: `hifz_${normCls}`,
            grade: gradeNum,
            targetClass: clsName,
            subject: 'Hifz',
            alias: `${clsName} Hifz`,
            langTag: '',
            studentIds: []
          });
        }
      });

      if (isEventLeaderRole && finalEnrollments.length === 0) {
        finalEnrollments.push({
          id: `rehearsal_${safeUsername}`,
          grade: 'ALL',
          targetClass: 'CUSTOM',
          subject: 'Arts Fest Rehearsal',
          alias: 'Arts Fest Rehearsal',
          isAttendanceOnly: true,
          isRehearsalSlot: true,
          studentIds: []
        });
      }

      const activeRolesList = isEventLeaderRole ? ['Event Leader'] : ['Teacher'];
      if (!isEventLeaderRole) {
        if (isMentorRole) activeRolesList.push('Mentor');
        if (classTeacherOf.length > 0) activeRolesList.push('Class Teacher');
        if (isPrincipalRole) activeRolesList.push('Principal');
        if (isNiicsCoordRole) activeRolesList.push('NIICS Coordinator');
        if (isAcademicCoordRole) activeRolesList.push('Academic Coordinator');
        if (isOutreachCoordRole) activeRolesList.push('Outreach Coordinator');
        if (isOfficeSecRole) activeRolesList.push('Office Secretary');
      }

      const primaryRoleLabel = isEventLeaderRole
        ? 'Event Leader'
        : isPrincipalRole
          ? 'Principal'
          : classTeacherOf.length > 0
            ? `Class Teacher (${classTeacherOf.join(', ')})`
            : isNiicsCoordRole
              ? 'NIICS Coordinator'
              : isAcademicCoordRole
                ? 'Academic Coordinator'
                : isOutreachCoordRole
                  ? 'Outreach Coordinator'
                  : isOfficeSecRole
                    ? 'Office Secretary'
                    : isMentorRole
                      ? 'Mentor & Faculty'
                      : 'Teacher';

      const teacherDocData = {
        fullName,
        username: safeUsername,
        designation: isEventLeaderRole ? 'Event Attendance Leader' : designation,
        roleCategory: primaryRoleLabel,
        isEventLeader: Boolean(isEventLeaderRole),
        roles: activeRolesList,
        mobileNumber,
        whatsappNumber: whatsappNumber || mobileNumber,
        email,
        state,
        district: district.trim(),
        photoUrl: photoUrl || null,
        enrollments: finalEnrollments,
        ...(password.trim().length >= 6 ? {
          password: password.trim(),
          passwordUpdatedAt: new Date().toISOString(),
          passwordUpdatedBy: 'admin'
        } : {}),
        outpassPrivileges: {
          isPrincipal: Boolean(isPrincipalRole),
          isNiicsCoordinator: Boolean(isNiicsCoordRole),
          isMentor: Boolean(isMentorRole && !isEventLeaderRole),
          isAcademicCoordinator: Boolean(isAcademicCoordRole),
          isOutreachCoordinator: Boolean(isOutreachCoordRole),
          isOfficeSecretary: Boolean(isOfficeSecRole),
          classTeacherOf,
          allowedCategories: [
            'Friday',
            'Evening',
            ...(classTeacherOf.length > 0 ? ['General', 'Medical'] : [])
          ],
          canApproveWeekend: Boolean(isPrincipalRole),
          canApproveOutreach: Boolean(isOutreachCoordRole || isPrincipalRole),
          canViewReports: Boolean(isPrincipalRole || isOfficeSecRole || isAcademicCoordRole || isNiicsCoordRole)
        }
      };

      await setDoc(doc(db, 'teachers', safeUsername), teacherDocData, { merge: true });

      setIsLoading(false);
      setStatusMsg(isEditing ? '✅ Teacher profile, roles & subjects updated!' : '✅ Teacher registered successfully!');
      fetchInitialData();
      resetForm();
      setActiveTopPanel('none');
    } catch (err) {
      setIsLoading(false);
      setStatusMsg('Error: ' + err.message);
    }
  };

  const handleEditClick = (teacher) => {
    const priv = teacher.outpassPrivileges || {};
    setIsEditing(true);
    setFullName(teacher.fullName || '');
    setUsername(teacher.username || '');
    setDesignation(teacher.designation || 'Faculty');
    setMobileNumber(teacher.mobileNumber || '');
    setWhatsappNumber(teacher.whatsappNumber || '');
    setEmail(teacher.email || '');
    setState(teacher.state || 'Kerala');
    setDistrict(teacher.district || 'Malappuram');
    setPhotoUrl(teacher.photoUrl || '');
    setEnrollments(teacher.enrollments || []);
    setIsMentorRole(priv.isMentor !== undefined ? Boolean(priv.isMentor) : true);
    setIsPrincipalRole(Boolean(priv.isPrincipal || teacher.roleCategory === 'Principal'));
    setIsNiicsCoordRole(Boolean(priv.isNiicsCoordinator));
    setIsAcademicCoordRole(Boolean(priv.isAcademicCoordinator));
    setIsOutreachCoordRole(Boolean(priv.isOutreachCoordinator));
    setIsOfficeSecRole(Boolean(priv.isOfficeSecretary));
    setIsEventLeaderRole(Boolean(teacher.isEventLeader || teacher.roleCategory === 'Event Leader'));
    setClassTeacherOf(Array.isArray(priv.classTeacherOf) ? priv.classTeacherOf : []);
    setPassword(teacher.password || '');
    setActiveTopPanel('add');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteClick = async (teacherUsername) => {
    if (window.confirm(`Are you sure you want to delete @${teacherUsername}?`)) {
      try {
        await deleteDoc(doc(db, 'teachers', teacherUsername));
        fetchInitialData();
      } catch (err) {
        alert("Failed to delete.");
      }
    }
  };

  const handleBulkDeleteSelectedTeachers = async () => {
    if (selectedTeacherUsernames.length === 0) return;
    if (!window.confirm(`Delete ${selectedTeacherUsernames.length} selected teacher(s)?`)) return;
    setIsLoading(true);
    try {
      await Promise.all(selectedTeacherUsernames.map(u => deleteDoc(doc(db, 'teachers', u))));
      setSelectedTeacherUsernames([]);
      fetchInitialData();
    } catch (err) {
      alert("Error deleting selected teachers.");
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setIsEditing(false); setFullName(''); setUsername(''); setPassword('');
    setDesignation('Faculty'); setMobileNumber(''); setWhatsappNumber(''); setEmail('');
    setState('Kerala'); setDistrict('Malappuram'); setPhotoUrl('');
    setIsMentorRole(true); setIsPrincipalRole(false); setIsNiicsCoordRole(false); setIsAcademicCoordRole(false);
    setIsOutreachCoordRole(false); setIsOfficeSecRole(false); setIsEventLeaderRole(false);
    setClassTeacherOf([]); setIsNonMarkMode(false);
    setEnrollments([]); setStatusMsg('');
  };

  const toggleSelectTeacherForBroadcast = (uname) => {
    if (selectedTeacherUsernames.includes(uname)) {
      setSelectedTeacherUsernames(selectedTeacherUsernames.filter(u => u !== uname));
    } else {
      setSelectedTeacherUsernames([...selectedTeacherUsernames, uname]);
    }
  };

  const filteredTeachers = registeredTeachers.filter(t => {
    if (teacherSearch.trim()) {
      const q = teacherSearch.trim().toLowerCase();
      if (!String(t.fullName || '').toLowerCase().includes(q) && !String(t.username || '').toLowerCase().includes(q)) return false;
    }
    const priv = t.outpassPrivileges || {};
    if (teacherRoleFilter === 'ClassTeacher' && !(priv.classTeacherOf || []).length) return false;
    if (teacherRoleFilter === 'Mentor' && priv.isMentor === false) return false;
    if (teacherRoleFilter === 'Coordinator' && !priv.isPrincipal && !priv.isNiicsCoordinator && !priv.isOutreachCoordinator && !priv.isAcademicCoordinator) return false;
    if (teacherRoleFilter === 'EventLeader' && !t.isEventLeader) return false;
    return true;
  });

  const toggleSelectAllTeachers = () => {
    if (selectedTeacherUsernames.length === filteredTeachers.length) {
      setSelectedTeacherUsernames([]);
    } else {
      setSelectedTeacherUsernames(filteredTeachers.map(t => t.username));
    }
  };

  const handleOpenResetModal = (teacher) => {
    setResetModalTeacher(teacher);
    setNewResetPassword(teacher.password || '');
    setResetSuccessData(null);
  };

  const handleGenerateRandomPassword = () => {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    let rand = '';
    for (let i = 0; i < 4; i++) rand += chars.charAt(Math.floor(Math.random() * chars.length));
    const u = (resetModalTeacher?.username || 'teacher').slice(0, 4);
    setNewResetPassword(`${u}@${rand}`);
  };

  const handleSaveResetPassword = async (e) => {
    e.preventDefault();
    if (!resetModalTeacher) return;
    if (newResetPassword.trim().length < 6) {
      return alert('Password must be at least 6 characters.');
    }

    setIsResettingPassword(true);
    const safeUser = resetModalTeacher.username.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
    const cleanPwd = newResetPassword.trim();
    const fakeEmail = `${safeUser}@school.com`;
    const nowIso = new Date().toISOString();

    try {
      // 1. Update Firestore teacher document
      await setDoc(doc(db, 'teachers', safeUser), {
        password: cleanPwd,
        passwordUpdatedAt: nowIso,
        passwordUpdatedBy: 'admin'
      }, { merge: true });

      // 2. Try to sync with Firebase Auth
      try {
        const primaryApp = getApp();
        let secondaryApp;
        try { secondaryApp = getApp("SecondaryApp"); } catch (err) { secondaryApp = initializeApp(primaryApp.options, "SecondaryApp"); }
        const secondaryAuth = getAuth(secondaryApp);
        await setPersistence(secondaryAuth, inMemoryPersistence);

        try {
          await createUserWithEmailAndPassword(secondaryAuth, fakeEmail, cleanPwd);
        } catch (createErr) {
          if (createErr.code === 'auth/email-already-in-use') {
            const oldPwd = resetModalTeacher.password;
            if (oldPwd) {
              try {
                await signInWithEmailAndPassword(secondaryAuth, fakeEmail, oldPwd);
                await updatePassword(secondaryAuth.currentUser, cleanPwd);
              } catch (_) {}
            }
          }
        }
        await signOut(secondaryAuth);
      } catch (authErr) {
        console.warn('Auth sync notice:', authErr);
      }

      // 3. Update local state
      const updatedTeacher = {
        ...resetModalTeacher,
        password: cleanPwd,
        passwordUpdatedAt: nowIso
      };
      setRegisteredTeachers(prev => (prev || []).map(t => t.username === safeUser ? updatedTeacher : t)); fetchInitialData();

      setResetSuccessData({
        username: safeUser,
        fullName: resetModalTeacher.fullName,
        password: cleanPwd,
        loginUrl: typeof window !== 'undefined' ? window.location.origin : 'https://mark-entry-app.vercel.app'
      });
    } catch (err) {
      alert('Error resetting password: ' + err.message);
    } finally {
      setIsResettingPassword(false);
    }
  };

  return (
    <div>
      {privilegeModalTeacher && (
        <TeacherPrivilegeModal
          teacher={privilegeModalTeacher}
          onClose={() => setPrivilegeModalTeacher(null)}
          onSaved={fetchInitialData}
        />
      )}

      {/* 🌟 SHUHOOD MINIMALIST HEADER + ACTION BUTTONS (Matches Screenshot 1) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px', marginBottom: '22px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '26px', fontWeight: '800', color: '#0f172a' }}>Teacher Management</h1>
          <p style={{ margin: '4px 0 0', fontSize: '14px', color: '#64748b', fontWeight: '500' }}>
            Manage all faculty members and their details efficiently.
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
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: '0 2px 6px rgba(79, 70, 229, 0.25)'
            }}
          >
            {activeTopPanel === 'add' ? '✕ Close Form' : '＋ Add Teacher'}
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
            onClick={() => setActiveTopPanel(activeTopPanel === 'broadcast' ? 'none' : 'broadcast')}
            style={{
              padding: '10px 16px',
              background: activeTopPanel === 'broadcast' ? '#eef2ff' : '#ffffff',
              color: '#334155',
              border: '1px solid #cbd5e1',
              borderRadius: '10px',
              fontWeight: '700',
              fontSize: '13px',
              cursor: 'pointer'
            }}
          >
            📢 Broadcast
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

      {statusMsg && (
        <div style={{ marginBottom: '18px', padding: '12px 16px', background: statusMsg.includes('Error') ? '#fff1f2' : '#ecfdf5', borderRadius: '10px', color: statusMsg.includes('Error') ? '#e11d48' : '#047857', fontWeight: '700', fontSize: '13px', border: `1px solid ${statusMsg.includes('Error') ? '#ffe4e6' : '#a7f3d0'}` }}>
          {statusMsg}
        </div>
      )}

      {/* PANEL 1: IMPORT CSV & PHOTOS (Opens only when clicked) */}
      {activeTopPanel === 'import' && (
        <div className="erp-slide-panel" style={styles.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800', color: '#0f172a' }}>Teachers CSV &amp; Bulk Photo Uploader</h3>
            <button type="button" onClick={() => setActiveTopPanel('none')} style={styles.buttonSecondary}>✕ Close</button>
          </div>
          <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0', marginBottom: '14px' }}>
            <div style={{ fontSize: '12px', fontWeight: '700', color: '#475569', marginBottom: '8px' }}>
              Select fields for Partial CSV Template (`username` and `fullName` included automatically):
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {TEACHER_PARTIAL_FIELDS.map(f => {
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

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" onClick={handleDownloadCustomPartialTeacherCSV} style={styles.buttonPrimary}>
              📥 Download Partial CSV ({selectedPartialCols.length})
            </button>
            <button type="button" onClick={handleDownloadFullTeacherCSV} style={styles.buttonSecondary}>
              📥 Full Master Template
            </button>
            <label style={{ ...styles.buttonSecondary, background: '#eef2ff', color: '#4f46e5', borderColor: '#c7d2fe', display: 'inline-flex', alignItems: 'center' }}>
              📤 Upload CSV
              <input type="file" accept=".csv" onChange={handleTeacherCSVUpload} style={{ display: 'none' }} />
            </label>
            <label style={{ ...styles.buttonSecondary, display: 'inline-flex', alignItems: 'center' }}>
              📸 Bulk Link Photos (By Username)
              <input type="file" accept="image/*" multiple onChange={handleBulkTeacherPhotoUploadFromFolder} style={{ display: 'none' }} />
            </label>
            {bulkTeacherPhotoProgress && <span style={{ fontWeight: '700', color: '#4f46e5', fontSize: '12px' }}>⏳ {bulkTeacherPhotoProgress}</span>}
          </div>
        </div>
      )}

      {/* PANEL 2: ADD / EDIT TEACHER FORM (Opens only when "+ Add Teacher" or "Edit" is clicked) */}
      {activeTopPanel === 'add' && (
        <div className="erp-slide-panel" style={styles.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px' }}>
            <h3 style={{ margin: 0, fontSize: '17px', fontWeight: '800', color: '#0f172a' }}>
              {isEditing ? `Edit Teacher: ${fullName} (@${username})` : 'Register New Teacher'}
            </h3>
            <button type="button" onClick={() => { resetForm(); setActiveTopPanel('none'); }} style={styles.buttonSecondary}>Cancel</button>
          </div>

          <form onSubmit={handleAddOrUpdateTeacher} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '14px' }}>
              <div><label style={styles.label}>Full Name</label><input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} required style={styles.input} /></div>
              <div><label style={styles.label}>Username</label><input type="text" value={username} onChange={(e) => setUsername(e.target.value)} disabled={isEditing} required style={styles.input} /></div>
              <div>
                <label style={styles.label}>{isEditing ? 'New Password (Optional)' : 'Initial Password (Min 6 chars)'}</label>
                <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min 6 chars" required={!isEditing} style={styles.input} />
              </div>
              <div><label style={styles.label}>Designation</label><input type="text" value={designation} onChange={(e) => setDesignation(e.target.value)} style={styles.input} /></div>
              <div><label style={styles.label}>Mobile Number</label><input type="text" value={mobileNumber} onChange={(e) => setMobileNumber(e.target.value)} style={styles.input} /></div>
              <div><label style={styles.label}>WhatsApp Number</label><input type="text" value={whatsappNumber} onChange={(e) => setWhatsappNumber(e.target.value)} style={styles.input} /></div>
              <div><label style={styles.label}>Email Address</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={styles.input} /></div>
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
              <div>
                <label style={styles.label}>Profile Photo</label>
                <input type="file" accept="image/*" onChange={handleTeacherPhotoUpload} style={styles.input} />
              </div>
            </div>

            <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '12px', fontWeight: '800', color: '#0f172a', marginBottom: '10px', textTransform: 'uppercase' }}>
                Institutional Roles &amp; Class Teacher Assignment
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '14px' }}>
                {[
                  { label: 'Mentor', state: isMentorRole, setter: setIsMentorRole },
                  { label: 'Principal', state: isPrincipalRole, setter: setIsPrincipalRole },
                  { label: 'NIICS Coordinator', state: isNiicsCoordRole, setter: setIsNiicsCoordRole },
                  { label: 'Academic Coordinator', state: isAcademicCoordRole, setter: setIsAcademicCoordRole },
                  { label: 'Outreach Coordinator', state: isOutreachCoordRole, setter: setIsOutreachCoordRole },
                  { label: 'Office Secretary', state: isOfficeSecRole, setter: setIsOfficeSecRole },
                  { label: 'Event Rehearsal Leader', state: isEventLeaderRole, setter: setIsEventLeaderRole }
                ].map((r, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => r.setter(!r.state)}
                    style={{
                      padding: '7px 13px', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: '700',
                      background: r.state ? '#4f46e5' : '#ffffff',
                      color: r.state ? '#ffffff' : '#334155',
                      border: r.state ? '1px solid #4f46e5' : '1px solid #cbd5e1'
                    }}
                  >
                    {r.state ? `✓ ${r.label}` : r.label}
                  </button>
                ))}
              </div>

              <div style={{ fontSize: '12px', fontWeight: '700', color: '#475569', marginBottom: '8px' }}>
                Class Teacher Of (Auto-assigns Hifz):
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {DEFAULT_CLASSES.map(cls => {
                  const active = classTeacherOf.includes(cls);
                  return (
                    <button
                      key={cls}
                      type="button"
                      onClick={() => toggleClassTeacherClass(cls)}
                      style={{
                        padding: '6px 12px', borderRadius: '8px', fontWeight: '700', fontSize: '12px', cursor: 'pointer',
                        border: active ? '1.5px solid #4f46e5' : '1px solid #cbd5e1',
                        background: active ? '#eef2ff' : '#ffffff',
                        color: active ? '#4f46e5' : '#334155'
                      }}
                    >
                      {active ? `✓ ${cls}` : cls}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
                <div style={{ fontSize: '12px', fontWeight: '800', color: '#0f172a', textTransform: 'uppercase' }}>
                  Assign Subjects Taught ({enrollments.length})
                </div>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: '700', color: '#4f46e5', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={Boolean(isNonMarkMode)}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setIsNonMarkMode(checked);
                      setEnvSubject(checked ? 'Speech Practice' : (DEFAULT_SUBJECTS[0] || 'Thafseer'));
                    }}
                  />
                  Attendance-Only Period (No Marks — e.g. PKV, Speech Practice)
                </label>
              </div>

              {isNonMarkMode && (
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
                  {QUICK_NON_MARK_SUBJECTS.map(qSub => (
                    <button
                      key={qSub}
                      type="button"
                      onClick={() => setEnvSubject(qSub)}
                      style={{
                        padding: '4px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: '700', cursor: 'pointer',
                        border: envSubject === qSub ? '1px solid #4f46e5' : '1px solid #cbd5e1',
                        background: envSubject === qSub ? '#eef2ff' : '#ffffff',
                        color: envSubject === qSub ? '#4f46e5' : '#475569'
                      }}
                    >
                      {qSub}
                    </button>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'flex-end', marginBottom: '12px' }}>
                <div style={{ flex: '1 1 100px' }}>
                  <label style={styles.label}>Grade</label>
                  <select
                    value={envGrade}
                    onChange={(e) => {
                      const g = e.target.value;
                      setEnvGrade(g);
                      const matchingCls = DEFAULT_CLASSES.find(c => c.includes(g));
                      if (matchingCls) setEnvTargetClass(matchingCls);
                    }}
                    style={styles.input}
                  >
                    {GRADES.map(g => <option key={g} value={g}>Grade {g}</option>)}
                  </select>
                </div>

                <div style={{ flex: '1 1 130px' }}>
                  <label style={styles.label}>Class</label>
                  <select value={envTargetClass} onChange={(e) => setEnvTargetClass(e.target.value)} style={styles.input}>
                    {DEFAULT_CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
                    <option value={`Grade ${envGrade}`}>All Grade {envGrade}</option>
                    {isNonMarkMode && <option value="CUSTOM">Custom Group</option>}
                  </select>
                </div>

                <div style={{ flex: '2 1 180px' }}>
                  <label style={styles.label}>Subject</label>
                  {isNonMarkMode ? (
                    <input type="text" value={envSubject} onChange={(e) => setEnvSubject(e.target.value)} style={styles.input} />
                  ) : (
                    <select value={envSubject} onChange={(e) => setEnvSubject(e.target.value)} style={styles.input}>
                      {DEFAULT_SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  )}
                </div>

                <div style={{ flex: '1 1 120px' }}>
                  <label style={styles.label}>Stream</label>
                  <select value={envLangTag} onChange={(e) => setEnvLangTag(e.target.value)} style={styles.input}>
                    <option value="">General</option>
                    <option value="Urdu">Urdu Only</option>
                    <option value="Non-Urdu">Non-Urdu</option>
                  </select>
                </div>

                <button type="button" onClick={handleAddEnrollment} style={styles.buttonPrimary}>
                  + Add Subject
                </button>
              </div>

              {enrollments.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {enrollments.map((env) => (
                    <span key={env.id} style={{ background: '#ffffff', padding: '6px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '12px', fontWeight: '700', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                      {env.alias || env.subject} {env.isAttendanceOnly ? '(Att-Only)' : ''}
                      <button type="button" onClick={() => handleRemoveEnrollment(env.id)} style={{ background: 'transparent', border: 'none', color: '#e11d48', fontWeight: '800', cursor: 'pointer' }}>✕</button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <button type="submit" disabled={isLoading} style={styles.buttonPrimary}>
              {isLoading ? 'Saving...' : isEditing ? 'Save Updated Teacher Profile' : 'Register Teacher'}
            </button>
          </form>
        </div>
      )}

      {/* PANEL 3: BROADCAST COMPOSER (Opens only when clicked) */}
      {activeTopPanel === 'broadcast' && (
        <div className="erp-slide-panel" style={styles.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800', color: '#0f172a' }}>
              Broadcast Notice ({selectedTeacherUsernames.length === 0 ? `All ${registeredTeachers.length} Teachers` : `${selectedTeacherUsernames.length} Selected`})
            </h3>
            <button type="button" onClick={() => setActiveTopPanel('none')} style={styles.buttonSecondary}>✕ Close</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '12px', marginBottom: '12px' }}>
            <input type="text" placeholder="Notice Title..." value={broadcastTitle} onChange={(e) => setBroadcastTitle(e.target.value)} style={styles.input} />
            <input type="text" placeholder="Type message for Portal Banner, Email, or WhatsApp..." value={broadcastBody} onChange={(e) => setBroadcastBody(e.target.value)} style={styles.input} />
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={async () => {
                if (!broadcastBody.trim()) return alert("Please enter a broadcast message.");
                await setDoc(doc(db, 'systemCache', 'teacherBroadcast'), {
                  title: broadcastTitle.trim() || 'Admin Broadcast Notice',
                  message: broadcastBody.trim(),
                  targetTeachers: selectedTeacherUsernames,
                  active: true,
                  updatedAt: new Date().toISOString()
                }, { merge: true });
                alert("✅ Broadcast Banner pinned to Teacher Portals!");
              }}
              style={styles.buttonPrimary}
            >
              📌 Pin Portal Banner
            </button>
            <button
              type="button"
              onClick={() => {
                const msg = `*DHIU DEGREE SECTION — STAFF NOTICE*\n*${broadcastTitle || 'Official Announcement'}*\n\n${broadcastBody || 'Assalamu Alaikum,'}`;
                openWhatsAppGroupAndCopy(staffGroupLink, msg, 'DHIU Staff WhatsApp Group');
              }}
              style={styles.buttonSecondary}
            >
              💬 Send to Staff WA Group
            </button>
            <button
              type="button"
              onClick={async () => {
                await setDoc(doc(db, 'systemCache', 'teacherBroadcast'), { active: false }, { merge: true });
                alert("Cleared active broadcast banner.");
              }}
              style={styles.buttonDanger}
            >
              Clear Active Banner
            </button>
          </div>
        </div>
      )}

      {/* PANEL 4: FILTER & COLUMN TOGGLE BAR (Opens only when clicked) */}
      {activeTopPanel === 'filters' && (
        <div className="erp-slide-panel" style={{ ...styles.card, padding: '16px 20px', background: '#f8fafc' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                type="text"
                placeholder="🔍 Search faculty name or @username..."
                value={teacherSearch}
                onChange={e => setTeacherSearch(e.target.value)}
                style={{ ...styles.input, width: '240px', padding: '8px 12px' }}
              />
              <select value={teacherRoleFilter} onChange={e => setTeacherRoleFilter(e.target.value)} style={styles.filterSelect}>
                <option value="All">All Roles ({registeredTeachers.length})</option>
                <option value="ClassTeacher">Class Teachers</option>
                <option value="Mentor">Mentors</option>
                <option value="Coordinator">Principals &amp; Coordinators</option>
                <option value="EventLeader">Event Rehearsal Leaders</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>Show Columns:</span>
              {[
                { key: 'roles', label: 'Roles & CT' },
                { key: 'contact', label: 'Phone & Location' },
                { key: 'subjects', label: 'Subjects Taught' }
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
        </div>
      )}

      {/* 🌟 MINIMALIST SHUHOOD FACULTY TABLE (Matches Screenshot 1) */}
      <div style={{ ...styles.card, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <input
            type="text"
            placeholder="🔍 Quick search teacher..."
            value={teacherSearch}
            onChange={e => setTeacherSearch(e.target.value)}
            style={{ ...styles.input, maxWidth: '260px', padding: '7px 12px', fontSize: '13px' }}
          />
          <button
            type="button"
            disabled={selectedTeacherUsernames.length === 0}
            onClick={handleBulkDeleteSelectedTeachers}
            style={{
              padding: '7px 14px',
              background: selectedTeacherUsernames.length > 0 ? '#e11d48' : '#fda4af',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              fontWeight: '700',
              fontSize: '12px',
              cursor: selectedTeacherUsernames.length > 0 ? 'pointer' : 'not-allowed'
            }}
          >
            Delete Selected ({selectedTeacherUsernames.length})
          </button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '11px', fontWeight: '800', textTransform: 'uppercase' }}>
                <th style={{ padding: '14px 16px', width: '40px' }}>
                  <input
                    type="checkbox"
                    checked={filteredTeachers.length > 0 && selectedTeacherUsernames.length === filteredTeachers.length}
                    onChange={toggleSelectAllTeachers}
                  />
                </th>
                <th style={{ padding: '14px 16px', width: '60px' }}>#</th>
                <th style={{ padding: '14px 16px' }}>NAME</th>
                <th style={{ padding: '14px 16px' }}>SERIAL / USERNAME</th>
                {visibleCols.roles && <th style={{ padding: '14px 16px' }}>ROLES &amp; CLASS</th>}
                {visibleCols.contact && <th style={{ padding: '14px 16px' }}>CONTACT</th>}
                {visibleCols.subjects && <th style={{ padding: '14px 16px' }}>SUBJECTS</th>}
                <th style={{ padding: '14px 16px' }}>STATUS</th>
                <th style={{ padding: '14px 16px', textAlign: 'right' }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filteredTeachers.map((teacher, index) => {
                const priv = teacher.outpassPrivileges || {};
                const isSelected = selectedTeacherUsernames.includes(teacher.username);
                const isExpanded = expandedTeacherUsername === teacher.username;
                const isLeader = Boolean(teacher.isEventLeader || teacher.roleCategory === 'Event Leader');

                return (
                  <React.Fragment key={teacher.username}>
                    <tr
                      onClick={() => setExpandedTeacherUsername(isExpanded ? null : teacher.username)}
                      style={{ borderBottom: '1px solid #f1f5f9', background: isSelected || isExpanded ? '#f8fafc' : '#ffffff', cursor: 'pointer' }}
                    >
                      <td style={{ padding: '14px 16px' }} onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectTeacherForBroadcast(teacher.username)}
                        />
                      </td>
                      <td style={{ padding: '14px 16px', color: '#64748b', fontWeight: '600' }}>{index + 1}</td>
                      <td style={{ padding: '14px 16px', fontWeight: '700', color: '#0f172a', textTransform: 'uppercase' }}>
                        {teacher.fullName}
                      </td>
                      <td style={{ padding: '14px 16px', color: '#475569', fontWeight: '600' }}>
                        T{String(index + 1).padStart(2, '0')} <span style={{ color: '#94a3b8', fontSize: '12px' }}>(@{teacher.username})</span>
                      </td>

                      {visibleCols.roles && (
                        <td style={{ padding: '14px 16px', fontSize: '12px', color: '#334155' }}>
                          {teacher.roleCategory || 'Teacher'}
                        </td>
                      )}
                      {visibleCols.contact && (
                        <td style={{ padding: '14px 16px', fontSize: '12px', color: '#334155' }}>
                          {teacher.whatsappNumber || teacher.mobileNumber || '—'}
                        </td>
                      )}
                      {visibleCols.subjects && (
                        <td style={{ padding: '14px 16px', fontSize: '12px', color: '#334155' }}>
                          {(teacher.enrollments || []).map(e => e.alias || e.subject).join(', ') || '—'}
                        </td>
                      )}

                      <td style={{ padding: '14px 16px' }}>
                        <span style={{ background: '#dcfce7', color: '#15803d', padding: '4px 12px', borderRadius: '999px', fontSize: '11px', fontWeight: '700' }}>
                          Active
                        </span>
                      </td>

                      <td style={{ padding: '14px 16px', textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
                          <button
                            type="button"
                            onClick={() => handleOpenResetModal(teacher)}
                            style={{ padding: '6px 12px', background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', borderRadius: '8px', fontWeight: '800', fontSize: '12px', cursor: 'pointer' }}
                            title="Reset or Change Faculty Password"
                          >
                            🔑 Reset Password
                          </button>
                          <button
                            type="button"
                            onClick={() => handleEditClick(teacher)}
                            style={{ padding: '6px 12px', background: '#eef2ff', color: '#4f46e5', border: 'none', borderRadius: '8px', fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}
                          >
                            ✏️ Edit Profile
                          </button>
                          <button
                            type="button"
                            onClick={() => setExpandedTeacherUsername(isExpanded ? null : teacher.username)}
                            style={{ padding: '6px 12px', background: '#f1f5f9', color: '#334155', border: 'none', borderRadius: '8px', fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}
                          >
                            👁️ {isExpanded ? 'Hide' : 'View'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteClick(teacher.username)}
                            style={{ padding: '6px 10px', background: 'transparent', color: '#e11d48', border: 'none', fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}
                          >
                            🗑️ Delete
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* 🌟 EXPANDABLE TEACHER DETAILS ROW (Shown only when "View" or Row is clicked!) */}
                    {isExpanded && (
                      <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                        <td colSpan={9} style={{ padding: '18px 24px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '18px' }}>
                            <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
                              <ProfileAvatar name={teacher.fullName} code={teacher.username} photoUrl={teacher.photoUrl} size={48} />
                              <div>
                                <div style={{ fontWeight: '800', fontSize: '15px', color: '#0f172a' }}>{teacher.fullName} (@{teacher.username})</div>
                                <div style={{ fontSize: '12px', color: '#475569', marginTop: '3px' }}>
                                  📱 {teacher.whatsappNumber || teacher.mobileNumber || 'No phone'} • ✉️ {teacher.email || 'No email'} • 📍 {teacher.district || 'Malappuram'}, {teacher.state || 'Kerala'}
                                </div>
                                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
                                  {(priv.classTeacherOf || []).length > 0 && (
                                    <span style={{ ...styles.badge, background: '#dcfce7', color: '#166534' }}>Class Teacher: {priv.classTeacherOf.join(', ')}</span>
                                  )}
                                  {priv.isPrincipal && <span style={{ ...styles.badge, background: '#fef3c7', color: '#92400e' }}>Principal</span>}
                                  {priv.isNiicsCoordinator && <span style={{ ...styles.badge, background: '#fef3c7', color: '#92400e' }}>NIICS Coordinator</span>}
                                  {priv.isOutreachCoordinator && <span style={{ ...styles.badge, background: '#e0f2fe', color: '#0369a1' }}>Outreach Coordinator</span>}
                                  {priv.isAcademicCoordinator && <span style={{ ...styles.badge, background: '#eef2ff', color: '#4f46e5' }}>Academic Coordinator</span>}
                                </div>
                              </div>
                            </div>

                            <div style={{ flex: 1, minWidth: '240px' }}>
                              <div style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', marginBottom: '6px' }}>
                                Assigned Subjects ({(teacher.enrollments || []).length})
                              </div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                {(teacher.enrollments || []).map((env, i) => (
                                  <span key={i} style={{ background: '#ffffff', border: '1px solid #cbd5e1', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '600', color: '#334155' }}>
                                    {env.alias || env.subject} {env.isAttendanceOnly ? '(Att-Only)' : ''}
                                  </span>
                                ))}
                              </div>
                            </div>

                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                              <button type="button" onClick={() => setPrivilegeModalTeacher(teacher)} style={styles.buttonPrimary}>
                                🔑 Configure Roles &amp; Leaves
                              </button>
                              {onOpenProxyMarks && !isLeader && (
                                <button type="button" onClick={() => onOpenProxyMarks(teacher.username)} style={styles.buttonSecondary}>
                                  📝 Open Proxy Marks
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => openDirectWhatsApp(teacher.whatsappNumber || teacher.mobileNumber, `Assalamu Alaikum ${teacher.fullName},`)}
                                style={styles.buttonSecondary}
                              >
                                💬 WhatsApp
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
      {/* 🌟 DEDICATED ADMIN FACULTY PASSWORD RESET MODAL */}
      {resetModalTeacher && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 99999,
            padding: '16px'
          }}
          onClick={() => { if (!isResettingPassword) { setResetModalTeacher(null); setResetSuccessData(null); } }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '16px',
              maxWidth: '480px',
              width: '100%',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
              border: '1px solid #cbd5e1',
              overflow: 'hidden'
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ background: '#0f172a', padding: '16px 20px', color: '#ffffff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '20px' }}>🔑</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800' }}>Reset Faculty Password</h3>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>Admin Credentials Manager</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setResetModalTeacher(null); setResetSuccessData(null); }}
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '20px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: '20px' }}>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '14px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <ProfileAvatar name={resetModalTeacher.fullName} code={resetModalTeacher.username} photoUrl={resetModalTeacher.photoUrl} size={42} />
                <div>
                  <div style={{ fontWeight: '800', color: '#0f172a', fontSize: '15px' }}>{resetModalTeacher.fullName}</div>
                  <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                    Username: <strong style={{ color: '#0284c7' }}>@{resetModalTeacher.username}</strong>
                  </div>
                </div>
              </div>

              {!resetSuccessData ? (
                <form onSubmit={handleSaveResetPassword}>
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <label style={{ fontSize: '12px', fontWeight: '800', color: '#334155' }}>
                        Set New Password *
                      </label>
                      <button
                        type="button"
                        onClick={handleGenerateRandomPassword}
                        style={{ background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', borderRadius: '6px', padding: '3px 8px', fontSize: '11px', fontWeight: '700', cursor: 'pointer' }}
                      >
                        🎲 Generate Random
                      </button>
                    </div>
                    <input
                      type="text"
                      value={newResetPassword}
                      onChange={e => setNewResetPassword(e.target.value)}
                      placeholder="Enter minimum 6 characters..."
                      required
                      minLength={6}
                      style={{ ...styles.input, fontSize: '14px', fontWeight: '700', letterSpacing: '0.5px' }}
                    />
                    <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                      Teacher will use this password to sign in with username <strong>@{resetModalTeacher.username}</strong>.
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                    <button
                      type="button"
                      onClick={() => setResetModalTeacher(null)}
                      style={{ ...styles.buttonSecondary, flex: 1, padding: '10px' }}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isResettingPassword}
                      style={{ ...styles.buttonPrimary, flex: 2, padding: '10px', background: '#2563eb' }}
                    >
                      {isResettingPassword ? 'Updating Password...' : '💾 Save & Update Password'}
                    </button>
                  </div>
                </form>
              ) : (
                <div>
                  <div style={{ background: '#ecfdf5', border: '1.5px solid #6ee7b7', borderRadius: '12px', padding: '14px', marginBottom: '16px' }}>
                    <div style={{ color: '#065f46', fontWeight: '800', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span>✅</span> Password Reset Successfully!
                    </div>
                    <div style={{ fontSize: '12px', color: '#047857', marginTop: '4px' }}>
                      Teacher credentials have been updated and are ready to use.
                    </div>
                  </div>

                  <div style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '10px', padding: '12px 14px', fontSize: '12px', color: '#1e293b', marginBottom: '16px', lineHeight: '1.6' }}>
                    <div><strong>Portal URL:</strong> {resetSuccessData.loginUrl}</div>
                    <div><strong>Username:</strong> {resetSuccessData.username}</div>
                    <div><strong>Password:</strong> <span style={{ background: '#fef3c7', padding: '2px 6px', borderRadius: '4px', fontWeight: '800', color: '#92400e' }}>{resetSuccessData.password}</span></div>
                  </div>

                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => {
                        const txt = `Assalamu Alaikum Usthad ${resetSuccessData.fullName},\n\nYour DHIU Portal login credentials have been updated:\n\n🌐 Portal: ${resetSuccessData.loginUrl}\n👤 Username: ${resetSuccessData.username}\n🔑 Password: ${resetSuccessData.password}\n\nPlease sign in to take period attendance and record marks.`;
                        navigator.clipboard.writeText(txt);
                        alert('📋 Copied login credentials to clipboard!');
                      }}
                      style={{ flex: 1, padding: '9px 12px', background: '#2563eb', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '800', fontSize: '12px', cursor: 'pointer' }}
                    >
                      📋 Copy Credentials
                    </button>

                    {resetModalTeacher.whatsappNumber && (
                      <button
                        type="button"
                        onClick={() => {
                          const txt = `Assalamu Alaikum Usthad ${resetSuccessData.fullName},\n\nYour DHIU Portal login credentials have been updated:\n\n🌐 Portal: ${resetSuccessData.loginUrl}\n👤 Username: ${resetSuccessData.username}\n🔑 Password: ${resetSuccessData.password}\n\nPlease sign in to take period attendance and record marks.`;
                          const cleanNum = resetModalTeacher.whatsappNumber.replace(/[^0-9]/g, '');
                          const url = `https://wa.me/${cleanNum.length === 10 ? '91' + cleanNum : cleanNum}?text=${encodeURIComponent(txt)}`;
                          window.open(url, '_blank');
                        }}
                        style={{ flex: 1, padding: '9px 12px', background: '#16a34a', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '800', fontSize: '12px', cursor: 'pointer' }}
                      >
                        💬 Send WhatsApp
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => { setResetModalTeacher(null); setResetSuccessData(null); }}
                      style={{ width: '100%', marginTop: '6px', padding: '8px', background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1', borderRadius: '8px', fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}