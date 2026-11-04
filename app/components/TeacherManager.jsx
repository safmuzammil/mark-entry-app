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
  WEB_APP_URL, DEFAULT_SUBJECTS, DEFAULT_CLASSES,
  GRADES, styles
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
  'Speech Practice',
  'PKV',
  'Economics DG D3',
  'Arabic Debate',
  'Urdu Debate',
  'English Oratory',
  'General Assembly'
];

export default function TeacherManager({ onOpenProxyMarks }) {
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

  // 🌟 Attendance-Only (Non-Mark) Subject Mode State
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

  // 🌟 Add Standard or Attendance-Only (Non-Mark) Subject Enrollment
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
      isAttendanceOnly: Boolean(isNonMarkMode), // 🌟 Marks as Attendance-Only if checkbox is ticked!
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

      // Deduplicate any double Hifz slots first
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

      // If marked as Event Leader and has no rehearsal slot yet, create one automatically
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
    setPassword('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteClick = async (teacherUsername) => {
    if (window.confirm(`Are you sure you want to delete @${teacherUsername}?\n(Any attendance or marks already saved in student records will remain intact.)`)) {
      try {
        await deleteDoc(doc(db, 'teachers', teacherUsername));
        fetchInitialData();
      } catch (err) {
        alert("Failed to delete.");
      }
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

  const toggleSelectAllTeachers = () => {
    if (selectedTeacherUsernames.length === registeredTeachers.length) {
      setSelectedTeacherUsernames([]);
    } else {
      setSelectedTeacherUsernames(registeredTeachers.map(t => t.username));
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

      {/* 1. CUSTOM PARTIAL CSV & PC FOLDER PHOTO UPLOADER FOR TEACHERS */}
      <div style={styles.card}>
        <h3 style={styles.sectionTitle}>📂 Teachers CSV Uploader &amp; Bulk PC Folder Photo Uploader</h3>
        <p style={{ margin: '0 0 12px', fontSize: '13px', color: '#334155', fontWeight: '600' }}>
          Select specific teacher fields to generate a custom partial CSV template, OR select teacher photos from a PC folder named by their username (e.g. <code>yusuf.jpg</code>):
        </p>

        <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1.5px solid #cbd5e1', marginBottom: '14px' }}>
          <div style={{ fontSize: '12px', fontWeight: '800', color: '#0f172a', marginBottom: '8px' }}>
            ☑️ Select fields to include in your Partial CSV Template (`username` and `fullName` are included automatically):
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {TEACHER_PARTIAL_FIELDS.map(f => {
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

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" onClick={handleDownloadCustomPartialTeacherCSV} style={{ padding: '10px 16px', background: '#00897b', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}>
            📥 Download Custom Partial CSV ({selectedPartialCols.length} Fields)
          </button>
          <button type="button" onClick={handleDownloadFullTeacherCSV} style={{ padding: '10px 16px', background: '#f8fafc', color: '#0f172a', border: '1.5px solid #94a3b8', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}>
            📥 Full Master Template (All Fields)
          </button>
          <label style={{ padding: '10px 18px', background: '#0284c7', color: '#ffffff', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}>
            📤 Upload Completed CSV (Full or Partial)
            <input type="file" accept=".csv" onChange={handleTeacherCSVUpload} style={{ display: 'none' }} />
          </label>
          <label style={{ padding: '10px 18px', background: '#0f172a', color: '#ffffff', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}>
            📸 Select Teacher Photos from PC Folder (Named by Username)
            <input type="file" accept="image/*" multiple onChange={handleBulkTeacherPhotoUploadFromFolder} style={{ display: 'none' }} />
          </label>
          {bulkTeacherPhotoProgress && <span style={{ fontWeight: '800', color: '#0284c7', fontSize: '13px' }}>⏳ {bulkTeacherPhotoProgress}</span>}
        </div>
      </div>

      {/* 2. REGISTER / EDIT TEACHER FORM WITH MULTI-ROLE & ATTENDANCE-ONLY SUBJECTS */}
      <div style={{ ...styles.card, borderLeft: isEditing ? '6px solid #f59e0b' : '1px solid #cbd5e1' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={styles.sectionTitle}>{isEditing ? `Editing Teacher: ${username}` : 'Register Teacher, Roles & Subject Assignments'}</h3>
          {isEditing && <button type="button" onClick={resetForm} style={{ padding: '8px 16px', background: '#e2e8f0', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '800' }}>Cancel</button>}
        </div>

        <form onSubmit={handleAddOrUpdateTeacher} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
            <div><label style={styles.label}>Full Name</label><input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} required style={styles.input} /></div>
            <div><label style={styles.label}>Username</label><input type="text" value={username} onChange={(e) => setUsername(e.target.value)} disabled={isEditing} required style={styles.input} /></div>
            <div>
              <label style={styles.label}>{isEditing ? 'Password (Only for new account)' : 'Initial Password (Min 6 chars)'}</label>
              <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={isEditing ? "Teachers can change password in their portal..." : "Min 6 chars"} required={!isEditing} style={styles.input} />
            </div>
            <div><label style={styles.label}>Designation</label><input type="text" value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="e.g. Faculty, Senior Lecturer" style={styles.input} /></div>
            <div><label style={styles.label}>Mobile Number</label><input type="text" value={mobileNumber} onChange={(e) => setMobileNumber(e.target.value)} placeholder="9876543210" style={styles.input} /></div>
            <div><label style={styles.label}>WhatsApp Number</label><input type="text" value={whatsappNumber} onChange={(e) => setWhatsappNumber(e.target.value)} placeholder="9876543210" style={styles.input} /></div>
            <div><label style={styles.label}>Email Address</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teacher@dhiu.in" style={styles.input} /></div>
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
            <div>
              <label style={styles.label}>Single Teacher Photo</label>
              <input type="file" accept="image/*" onChange={handleTeacherPhotoUpload} style={styles.input} />
            </div>
          </div>

          <div style={{ background: '#f8fafc', padding: '18px', borderRadius: '12px', border: '1.5px solid #cbd5e1' }}>
            <h4 style={{ margin: '0 0 8px 0', fontSize: '15px', color: '#0f172a', fontWeight: '800' }}>
              🛡️ Assign Institutional Roles &amp; Class Teacher Authority (Multi-Select)
            </h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '14px' }}>
              {[
                { label: '🧭 Mentor (Can be assigned mentees)', state: isMentorRole, setter: setIsMentorRole },
                { label: '👑 Principal', state: isPrincipalRole, setter: setIsPrincipalRole },
                { label: '🎓 NIICS Coordinator (Urdu Principal)', state: isNiicsCoordRole, setter: setIsNiicsCoordRole },
                { label: '📊 Academic Coordinator', state: isAcademicCoordRole, setter: setIsAcademicCoordRole },
                { label: '🌍 Outreach Coordinator', state: isOutreachCoordRole, setter: setIsOutreachCoordRole },
                { label: '🏢 Office Secretary', state: isOfficeSecRole, setter: setIsOfficeSecRole },
                { label: '🎭 Event / Arts Fest Rehearsal Leader (Temp Attendance Only)', state: isEventLeaderRole, setter: setIsEventLeaderRole }
              ].map((r, i) => (
                <label
                  key={i}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '8px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '800',
                    background: r.state ? '#0f172a' : '#ffffff',
                    color: r.state ? '#ffffff' : '#0f172a',
                    border: '1.5px solid #94a3b8'
                  }}
                >
                  <input type="checkbox" checked={r.state} onChange={(e) => r.setter(e.target.checked)} style={{ accentColor: '#00897b', width: '16px', height: '16px' }} />
                  {r.label}
                </label>
              ))}
            </div>

            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '12px' }}>
              <div style={{ fontSize: '13px', fontWeight: '800', color: '#0f172a', marginBottom: '6px' }}>
                🏫 Designated Class Teacher For (Automatically links all students of that class + assigns <strong>Hifz</strong> mark entry):
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
                        padding: '7px 14px', borderRadius: '8px', fontWeight: '800', fontSize: '13px', cursor: 'pointer',
                        border: active ? '2px solid #00897b' : '1.5px solid #94a3b8',
                        background: active ? '#00897b' : '#ffffff',
                        color: active ? '#ffffff' : '#0f172a'
                      }}
                    >
                      {active ? `✓ Class ${cls} (+Hifz)` : cls}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div style={{ background: '#f0fdfa', padding: '20px', borderRadius: '12px', border: '2px solid #0d9488' }}>
            <h4 style={{ margin: '0 0 6px 0', fontSize: '16px', color: '#0f172a', fontWeight: '800' }}>
              📚 Assign Grade, Class &amp; Subject Taught
            </h4>
            <p style={{ margin: '0 0 12px 0', fontSize: '13px', color: '#334155', fontWeight: '600' }}>
              Assign regular academic subjects (with marks) OR tick the checkbox below to add an <strong>Attendance-Only Period (No Marks — e.g. Speech Practice, PKV, Debate)</strong>.
            </p>

            {/* 🌟 FIXED PLACEMENT: Attendance-Only Toggle Bar cleanly ABOVE the 4 dropdowns! */}
            <div style={{ marginBottom: '14px', padding: '12px 16px', background: isNonMarkMode ? '#fffbeb' : '#ffffff', borderRadius: '10px', border: isNonMarkMode ? '2px solid #d97706' : '1.5px solid #0d9488', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', fontWeight: '800', color: isNonMarkMode ? '#b45309' : '#0f766e', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={Boolean(isNonMarkMode)}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setIsNonMarkMode(checked);
                    if (checked) setEnvSubject('Speech Practice');
                    else setEnvSubject(DEFAULT_SUBJECTS[0] || 'Thafseer');
                  }}
                  style={{ width: '18px', height: '18px', accentColor: '#d97706' }}
                />
                📅 Attendance-Only Period (No Marks — e.g., Speech Practice, PKV, Economics — Hidden from Mark Entry &amp; Student Mark Sheet)
              </label>

              {isNonMarkMode && (
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {QUICK_NON_MARK_SUBJECTS.map(qSub => (
                    <button
                      key={qSub}
                      type="button"
                      onClick={() => setEnvSubject(qSub)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: '999px',
                        fontSize: '11px',
                        fontWeight: '800',
                        cursor: 'pointer',
                        border: envSubject === qSub ? '2px solid #b45309' : '1px solid #fcd34d',
                        background: envSubject === qSub ? '#d97706' : '#ffffff',
                        color: envSubject === qSub ? '#ffffff' : '#92400e'
                      }}
                    >
                      {qSub}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-end', marginBottom: '16px', background: '#ffffff', padding: '16px', borderRadius: '10px', border: '1px solid #cbd5e1' }}>
              <div style={{ flex: '1 1 110px' }}>
                <label style={styles.label}>1. Grade</label>
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

              <div style={{ flex: '1 1 140px' }}>
                <label style={styles.label}>2. Class / Batch</label>
                <select value={envTargetClass} onChange={(e) => setEnvTargetClass(e.target.value)} style={styles.input}>
                  {DEFAULT_CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
                  <option value={`Grade ${envGrade}`}>All Grade {envGrade}</option>
                  {isNonMarkMode && <option value="CUSTOM">Custom Student Group</option>}
                </select>
              </div>

              <div style={{ flex: '2 1 200px' }}>
                <label style={styles.label}>
                  {isNonMarkMode ? '3. Attendance-Only Period Name' : '3. Academic Subject'}
                </label>
                {isNonMarkMode ? (
                  <input
                    type="text"
                    value={envSubject}
                    onChange={(e) => setEnvSubject(e.target.value)}
                    placeholder="Type period name (e.g. Speech Practice, PKV)..."
                    style={{ ...styles.input, borderColor: '#d97706', backgroundColor: '#fffbeb', fontWeight: '800' }}
                  />
                ) : (
                  <select value={envSubject} onChange={(e) => setEnvSubject(e.target.value)} style={styles.input}>
                    {DEFAULT_SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                )}
              </div>

              <div style={{ flex: '1 1 130px' }}>
                <label style={styles.label}>4. Medium / Tag</label>
                <select value={envLangTag} onChange={(e) => setEnvLangTag(e.target.value)} style={styles.input}>
                  <option value="">General (All)</option>
                  <option value="Urdu">Urdu Only</option>
                  <option value="Non-Urdu">Non-Urdu Only</option>
                </select>
              </div>

              <button
                type="button"
                onClick={handleAddEnrollment}
                style={{
                  ...styles.buttonPrimary,
                  padding: '12px 20px',
                  background: isNonMarkMode ? '#d97706' : '#00897b'
                }}
              >
                {isNonMarkMode ? '+ Add Attendance Period' : '+ Add Subject'}
              </button>
            </div>

            {enrollments.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '10px' }}>
                {enrollments.map((env) => (
                  <div key={env.id} style={{ background: '#ffffff', padding: '12px 16px', borderRadius: '10px', border: env.isAttendanceOnly ? '2px solid #f59e0b' : '1.5px solid #cbd5e1', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: '800', fontSize: '14px', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <span>📖 {env.alias || `${env.targetClass || `Grade ${env.grade}`} ${env.subject}`}</span>
                        {env.isAttendanceOnly && (
                          <span style={{ background: '#fef3c7', color: '#b45309', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: '900' }}>
                            ATTENDANCE ONLY
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '12px', color: '#0f766e', fontWeight: '700', marginTop: '2px' }}>
                        Grade {env.grade} • {env.langTag || 'General'} • {(env.studentIds || []).length} manual IDs
                      </div>
                    </div>
                    <button type="button" onClick={() => handleRemoveEnrollment(env.id)} style={{ padding: '6px 10px', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '6px', fontWeight: '800', cursor: 'pointer', fontSize: '12px' }}>
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button type="submit" disabled={isLoading} style={isEditing ? styles.buttonWarning : styles.buttonSuccess}>
            {isLoading ? 'Processing...' : isEditing ? 'Update Teacher Profile & Roles' : 'Register Teacher'}
          </button>
        </form>

        {statusMsg && (
          <div style={{ marginTop: '20px', padding: '16px', background: statusMsg.includes('Error') ? '#fee2e2' : '#ecfdf5', borderRadius: '8px', color: statusMsg.includes('Error') ? '#991b1b' : '#065f46', fontWeight: '800' }}>
            {statusMsg}
          </div>
        )}
      </div>

      {/* 3. BROADCAST COMPOSER */}
      <div style={{ ...styles.card, background: '#eff6ff', border: '2px solid #3b82f6' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: '#1e3a8a' }}>
              📢 Broadcast Message to Teachers (Portal Banner + Email + Individual/Group WhatsApp)
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#1e40af', fontWeight: '600' }}>
              Select specific teachers below, or send directly to the Official Staff WhatsApp Group.
            </p>
          </div>
          <span style={{ background: '#1d4ed8', color: '#ffffff', padding: '6px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: '800' }}>
            {selectedTeacherUsernames.length === 0 ? `All Teachers (${registeredTeachers.length})` : `${selectedTeacherUsernames.length} Teacher(s) Selected`}
          </span>
        </div>

        <div style={{ background: '#ffffff', padding: '12px', borderRadius: '10px', border: '1px solid #bfdbfe', marginBottom: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: '800', color: '#1e3a8a' }}>
              👥 Click Teachers to Select Recipients:
            </span>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button type="button" onClick={() => setSelectedTeacherUsernames(registeredTeachers.map(t => t.username))} style={{ padding: '4px 10px', background: '#dbeafe', color: '#1e40af', border: 'none', borderRadius: '6px', fontSize: '11px', fontWeight: '800', cursor: 'pointer' }}>
                Select All
              </button>
              <button type="button" onClick={() => setSelectedTeacherUsernames([])} style={{ padding: '4px 10px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '6px', fontSize: '11px', fontWeight: '800', cursor: 'pointer' }}>
                Clear Selection (Send to All)
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', maxHeight: '110px', overflowY: 'auto' }}>
            {registeredTeachers.map(t => {
              const active = selectedTeacherUsernames.includes(t.username);
              return (
                <button
                  key={t.username}
                  type="button"
                  onClick={() => toggleSelectTeacherForBroadcast(t.username)}
                  style={{
                    padding: '5px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: '700', cursor: 'pointer',
                    background: active ? '#1d4ed8' : '#f8fafc',
                    color: active ? '#ffffff' : '#0f172a',
                    border: active ? '1.5px solid #1d4ed8' : '1px solid #cbd5e1'
                  }}
                >
                  {active ? `✓ ${t.fullName}` : t.fullName}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '12px', marginBottom: '12px' }}>
          <input
            type="text"
            placeholder="Title (e.g. Urgent Faculty Meeting / Mark Entry Notice)"
            value={broadcastTitle}
            onChange={(e) => setBroadcastTitle(e.target.value)}
            style={styles.input}
          />
          <input
            type="text"
            placeholder="Type your message for Teachers' Portal Banner, Email & WhatsApp..."
            value={broadcastBody}
            onChange={(e) => setBroadcastBody(e.target.value)}
            style={styles.input}
          />
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
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
            style={{ padding: '10px 16px', background: '#1d4ed8', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}
          >
            📌 1. Pin Top Banner ({selectedTeacherUsernames.length === 0 ? 'All' : selectedTeacherUsernames.length})
          </button>

          <button
            type="button"
            onClick={async () => {
              if (!broadcastBody.trim()) return alert("Please type a message first.");
              const targets = selectedTeacherUsernames.length > 0
                ? registeredTeachers.filter(t => selectedTeacherUsernames.includes(t.username))
                : registeredTeachers;
              const withEmail = targets.filter(t => t.email && t.email.includes('@'));
              if (withEmail.length === 0) return alert("No email addresses saved for the selected teachers.");
              for (const t of withEmail) {
                await sendDirectEmailNotification(
                  WEB_APP_URL,
                  t.email,
                  broadcastTitle || 'DHIU Faculty Broadcast',
                  `Assalamu Alaikum ${t.fullName},\n\n${broadcastTitle ? broadcastTitle + '\n' : ''}${broadcastBody}`
                );
              }
            }}
            style={{ padding: '10px 16px', background: '#0284c7', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}
          >
            ✉️ 2. Email Selected Teachers
          </button>

          <button
            type="button"
            onClick={() => {
              if (!broadcastBody.trim()) return alert("Please type a message first.");
              const targets = selectedTeacherUsernames.length > 0
                ? registeredTeachers.filter(t => selectedTeacherUsernames.includes(t.username))
                : registeredTeachers;
              const withPhone = targets.filter(t => t.whatsappNumber || t.mobileNumber);
              if (withPhone.length === 0) return alert("No WhatsApp numbers saved for the selected teachers.");
              withPhone.forEach((t, idx) => {
                const msg = `*DHIU DEGREE SECTION NOTICE*\n*${broadcastTitle || 'Announcement'}*\n\nAssalamu Alaikum ${t.fullName},\n${broadcastBody}`;
                setTimeout(() => {
                  openDirectWhatsApp(t.whatsappNumber || t.mobileNumber, msg);
                }, idx * 600);
              });
            }}
            style={{ padding: '10px 16px', background: '#16a34a', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}
          >
            💬 3. WhatsApp Selected Teachers
          </button>

          <button
            type="button"
            onClick={() => {
              const msg = `*DHIU DEGREE SECTION — STAFF NOTICE*\n*${broadcastTitle || 'Official Announcement'}*\n\n${broadcastBody || 'Assalamu Alaikum,'}`;
              openWhatsAppGroupAndCopy(staffGroupLink, msg, 'DHIU Staff WhatsApp Group');
            }}
            style={{ padding: '10px 16px', background: '#0f766e', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}
          >
            👥 4. Open Staff WhatsApp Group &amp; Send
          </button>

          <button
            type="button"
            onClick={async () => {
              await setDoc(doc(db, 'systemCache', 'teacherBroadcast'), { active: false }, { merge: true });
              alert("Cleared active broadcast banner from Teacher Portals.");
            }}
            style={{ padding: '10px 14px', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', fontSize: '12px' }}
          >
            ✕ Clear Banner
          </button>
        </div>
      </div>

      {/* 4. TEACHERS DIRECTORY */}
      <div style={styles.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <h3 style={{ ...styles.sectionTitle, margin: 0, borderBottom: 'none' }}>🛡️ Users, Faculty &amp; Privileges Directory</h3>
          {selectedTeacherUsernames.length > 0 && (
            <button type="button" onClick={() => setSelectedTeacherUsernames([])} style={{ padding: '6px 12px', background: '#f1f5f9', color: '#0f172a', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '12px', fontWeight: '800', cursor: 'pointer' }}>
              Clear Selection ({selectedTeacherUsernames.length})
            </button>
          )}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px', minWidth: '880px' }}>
            <thead>
              <tr style={{ background: '#00a8b5', color: '#ffffff' }}>
                <th style={{ padding: '12px 14px', width: '42px', color: '#ffffff' }}>
                  <input
                    type="checkbox"
                    checked={registeredTeachers.length > 0 && selectedTeacherUsernames.length === registeredTeachers.length}
                    onChange={toggleSelectAllTeachers}
                    style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                  />
                </th>
                <th style={{ padding: '12px 14px', fontWeight: '800', color: '#ffffff' }}>Sn</th>
                <th style={{ padding: '12px 14px', fontWeight: '800', color: '#ffffff' }}>Teacher &amp; Username</th>
                <th style={{ padding: '12px 14px', fontWeight: '800', color: '#ffffff' }}>Roles &amp; Class Teacher</th>
                <th style={{ padding: '12px 14px', fontWeight: '800', color: '#ffffff' }}>Contact &amp; Location</th>
                <th style={{ padding: '12px 14px', fontWeight: '800', color: '#ffffff' }}>Subjects Taught</th>
                <th style={{ padding: '12px 14px', fontWeight: '800', color: '#ffffff', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {registeredTeachers.map((teacher, index) => {
                const priv = teacher.outpassPrivileges || {};
                const isSelected = selectedTeacherUsernames.includes(teacher.username);
                const isLeader = Boolean(teacher.isEventLeader || teacher.roleCategory === 'Event Leader');

                return (
                  <tr key={index} style={{ borderBottom: '1px solid #e2e8f0', background: isSelected ? '#eff6ff' : '#ffffff' }}>
                    <td style={{ padding: '12px 14px' }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelectTeacherForBroadcast(teacher.username)}
                        style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                      />
                    </td>
                    <td style={{ padding: '12px 14px', fontWeight: '700', color: '#64748b' }}>{index + 1}</td>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <ProfileAvatar name={teacher.fullName} code={teacher.username} photoUrl={teacher.photoUrl} size={38} />
                        <div>
                          <div style={{ fontWeight: '800', color: '#0f172a' }}>{teacher.fullName}</div>
                          <div style={{ fontSize: '12px', color: '#64748b' }}>@{teacher.username} • {teacher.designation || 'Faculty'}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {isLeader && <span style={{ ...styles.badge, background: '#ede9fe', color: '#6d28d9' }}>🎭 Event Leader</span>}
                        {priv.isPrincipal && <span style={{ ...styles.badge, background: '#fef08a', color: '#854d0e' }}>👑 Principal</span>}
                        {priv.isNiicsCoordinator && <span style={{ ...styles.badge, background: '#fef3c7', color: '#92400e' }}>🎓 NIICS</span>}
                        {(!isLeader && priv.isMentor !== false) && <span style={{ ...styles.badge, background: '#f0fdfa', color: '#0f766e' }}>🧭 Mentor</span>}
                        {(priv.classTeacherOf || []).length > 0 && (
                          <span style={{ ...styles.badge, background: '#dcfce7', color: '#166534' }}>🏫 CT: {priv.classTeacherOf.join(', ')}</span>
                        )}
                        {priv.isOutreachCoordinator && <span style={{ ...styles.badge, background: '#ffedd5', color: '#c2410c' }}>🌍 Outreach</span>}
                        {priv.isAcademicCoordinator && <span style={{ ...styles.badge, background: '#dbeafe', color: '#1e40af' }}>📊 Academic</span>}
                        {priv.isOfficeSecretary && <span style={{ ...styles.badge, background: '#f3e8ff', color: '#6d28d9' }}>🏢 Secretary</span>}
                      </div>
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: '12px', color: '#334155' }}>
                      <div>📱 {teacher.whatsappNumber || teacher.mobileNumber || '—'}</div>
                      <div>📍 {teacher.district || 'Malappuram'}, {teacher.state || 'Kerala'}</div>
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {(teacher.enrollments || []).map((env, i) => (
                          <span
                            key={i}
                            style={{
                              display: 'inline-block',
                              background: env.isAttendanceOnly ? '#fffbeb' : '#f1f5f9',
                              color: env.isAttendanceOnly ? '#b45309' : '#0f172a',
                              padding: '4px 8px',
                              borderRadius: '6px',
                              fontSize: '12px',
                              fontWeight: '800',
                              border: env.isAttendanceOnly ? '1px solid #fcd34d' : '1px solid #cbd5e1'
                            }}
                          >
                            {env.alias || env.subject} {env.isAttendanceOnly ? '[Att-Only]' : ''} ({(env.studentIds || []).length})
                          </span>
                        ))}
                      </div>
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        <button onClick={() => setPrivilegeModalTeacher(teacher)} style={{ padding: '7px 12px', background: '#00a8b5', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '800', fontSize: '12px' }}>
                          🔑 Roles &amp; Leaves
                        </button>
                        <button onClick={() => openDirectWhatsApp(teacher.whatsappNumber || teacher.mobileNumber, `Assalamu Alaikum ${teacher.fullName}, message from DHIU Admin:`)} style={{ padding: '7px 10px', background: '#dcfce7', color: '#166534', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '800', fontSize: '12px' }}>
                          💬 WA
                        </button>
                        <button onClick={() => sendDirectEmailNotification(WEB_APP_URL, teacher.email, 'DHIU Admin Message', `Assalamu Alaikum ${teacher.fullName},`)} style={{ padding: '7px 10px', background: '#e0f2fe', color: '#0369a1', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '800', fontSize: '12px' }}>
                          ✉️ Mail
                        </button>
                        {onOpenProxyMarks && !isLeader && (
                          <button onClick={() => onOpenProxyMarks(teacher.username)} style={{ padding: '7px 12px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '12px' }}>
                            📝 Marks
                          </button>
                        )}
                        <button onClick={() => handleEditClick(teacher)} style={{ padding: '7px 12px', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '12px' }}>Edit</button>
                        <button onClick={() => handleDeleteClick(teacher.username)} style={{ padding: '7px 12px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '12px' }}>Delete</button>
                      </div>
                    </td>
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