'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../../lib/firebase';
import { doc, getDocs, setDoc, collection } from 'firebase/firestore';
import { DEFAULT_CLASSES, DEFAULT_SUBJECTS, DEPARTMENTS, MADHABS, styles } from './erpConstants';
import { isAttendanceOnlyEnrollment } from './PeriodAttendanceManager';
import { ProfileAvatar } from './ErpExtensions';

const QUICK_COURSE_SUGGESTIONS = [
  ...DEFAULT_SUBJECTS,
  'Speech Practice',
  'Arabic Debate',
  'Urdu Debate',
  'English Oratory',
  'PKV',
  'RP',
  'Economics DG D3',
  'General Assembly',
  'Civil Studies'
];

export default function SubjectManager({
  preloadedTeachers = [],
  preloadedStudents = [],
  onTeachersUpdated,
  onStudentsUpdated
}) {
  const [teachers, setTeachers] = useState(preloadedTeachers);
  const [students, setStudents] = useState(preloadedStudents);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [classFilter, setClassFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL'); // 'ALL' | 'MARK' | 'ATTENDANCE_ONLY'

  // Modal States
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingSubject, setEditingSubject] = useState(null); // when editing existing
  const [viewingStudentsSubject, setViewingStudentsSubject] = useState(null); // modal to view enrolled students
  const [managingStudentsSubject, setManagingStudentsSubject] = useState(null); // modal to add/remove students

  // Form Fields for Add / Edit
  const [subName, setSubName] = useState('');
  const [subAlias, setSubAlias] = useState('');
  const [subTargetClass, setSubTargetClass] = useState('QLA3');
  const [subCustomClass, setSubCustomClass] = useState('');
  const [subIsAttendanceOnly, setSubIsAttendanceOnly] = useState(false);
  const [subTeacherUsername, setSubTeacherUsername] = useState('');
  const [subSelectedStudentIds, setSubSelectedStudentIds] = useState([]);
  const [subStudentSearch, setSubStudentSearch] = useState('');
  const [subModalClassFilter, setSubModalClassFilter] = useState('ALL');
  const [subModalDeptFilter, setSubModalDeptFilter] = useState('ALL');
  const [subModalMadhabFilter, setSubModalMadhabFilter] = useState('ALL');
  const [subModalStreamFilter, setSubModalStreamFilter] = useState('ALL');
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState({ text: '', type: '' });

  // Load from Firestore if preloaded is empty
  useEffect(() => {
    async function loadData() {
      if (teachers.length > 0 && students.length > 0) return;
      setLoading(true);
      try {
        const [tSnap, sSnap] = await Promise.all([
          getDocs(collection(db, 'teachers')),
          getDocs(collection(db, 'students'))
        ]);
        const tList = tSnap.docs.map(d => ({ docId: d.id, ...d.data() }));
        const sList = sSnap.docs.map(d => ({ docId: d.id, ...d.data() }));
        setTeachers(tList);
        setStudents(sList);
        if (onTeachersUpdated) onTeachersUpdated(tList);
        if (onStudentsUpdated) onStudentsUpdated(sList);
      } catch (err) {
        console.error('Error loading subject catalog:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  useEffect(() => {
    if (preloadedTeachers && preloadedTeachers.length > 0) setTeachers(preloadedTeachers);
  }, [preloadedTeachers]);

  useEffect(() => {
    if (preloadedStudents && preloadedStudents.length > 0) setStudents(preloadedStudents);
  }, [preloadedStudents]);

  // Derive all active subject enrollments across teachers
  const allSubjectBatches = useMemo(() => {
    const list = [];
    teachers.forEach(teacher => {
      const enrollments = Array.isArray(teacher.enrollments) ? teacher.enrollments : [];
      enrollments.forEach(env => {
        // Exclude rehearsal leader temporary slots and hifz
        if (env.isRehearsalSlot) return;
        const subNameClean = String(env.subject || env.Sub || '').trim();
        const aliasClean = String(env.alias || env.Alias || subNameClean).trim();
        const up = (subNameClean + ' ' + aliasClean).toUpperCase();

        // Dirasathul Adyan is suppressed in favor of Logic
        if (up.includes('DIRASATH') || up.includes('ADYAN')) return;

        // Detect enrolled student objects
        const envStudentIds = Array.isArray(env.studentIds) ? env.studentIds.map(x => String(x).toUpperCase().trim()) : [];
        const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

        let enrolledStudents = [];
        if (envStudentIds.length > 0) {
          enrolledStudents = students.filter(st => {
            const sReg = String(st.regNo || '').toUpperCase().trim();
            const sAd = String(st.adNo || '').toUpperCase().trim();
            const sId = String(st.id || '').toUpperCase().trim();
            return envStudentIds.includes(sReg) || envStudentIds.includes(sAd) || envStudentIds.includes(sId);
          });
        } else {
          // Fall back to target class match
          let tCls = String(env.targetClass || '').toUpperCase().trim();
          if (!tCls || tCls === 'GENERAL' || tCls === 'CUSTOM') {
            const m = String(aliasClean || '').match(/\b(QLA3|HFC3|FC2|AL2|QH2|FC1|QH1|AL1|QHF2|ALC2|M10)\b/i);
            if (m) tCls = m[0].toUpperCase();
          }
          if (tCls && tCls !== 'CUSTOM' && tCls !== 'GENERAL') {
            enrolledStudents = students.filter(st => {
              const stClasses = Array.isArray(st.classes) ? st.classes : [st.class];
              return stClasses.some(c => norm(c) === norm(tCls) || norm(c).includes(norm(tCls)));
            });
          }
        }

        let effectiveClass = env.targetClass;
        if (!effectiveClass || effectiveClass === 'General' || effectiveClass === 'CUSTOM') {
          const m = String(aliasClean || '').match(/\b(QLA3|HFC3|FC2|AL2|QH2|FC1|QH1|AL1|QHF2|ALC2|M10)\b/i);
          if (m) effectiveClass = m[0].toUpperCase();
        }

        const isAttOnly = isAttendanceOnlyEnrollment(env);

        list.push({
          id: env.id || `env_${Math.random()}`,
          subject: subNameClean || 'General Course',
          alias: aliasClean,
          targetClass: effectiveClass || 'General',
          isAttendanceOnly: isAttOnly,
          isHifz: String(env.subject || '').toUpperCase() === 'HIFZ',
          studentIds: env.studentIds || [],
          enrolledStudents,
          enrolledCount: enrolledStudents.length,
          teacherUsername: teacher.username,
          teacherName: teacher.fullName || teacher.username,
          teacherPhoto: teacher.photoUrl || '',
          teacherDesignation: teacher.designation || 'Faculty'
        });
      });
    });
    return list;
  }, [teachers, students]);

  // Auto-fill alias when subject name or target class changes
  const handleSubjectNameChange = (name) => {
    setSubName(name);
    const cls = subTargetClass === 'CUSTOM' ? subCustomClass : subTargetClass;
    if (cls && name) {
      setSubAlias(`${cls} ${name}`.trim());
    }
  };

  const handleClassChange = (cls) => {
    setSubTargetClass(cls);
    const effectiveCls = cls === 'CUSTOM' ? subCustomClass : cls;
    if (effectiveCls && subName) {
      setSubAlias(`${effectiveCls} ${subName}`.trim());
    }
  };

  // Open Add Modal
  const openAddSubjectModal = () => {
    setEditingSubject(null);
    setSubName('');
    setSubAlias('');
    setSubTargetClass(DEFAULT_CLASSES[0] || 'QLA3');
    setSubCustomClass('');
    setSubIsAttendanceOnly(false);
    setSubTeacherUsername(teachers[0]?.username || '');
    // Default: select all students of the chosen class
    const initialClass = DEFAULT_CLASSES[0] || 'QLA3';
    const classSts = students.filter(s => {
      const clsArr = Array.isArray(s.classes) ? s.classes : [s.class];
      return clsArr.some(c => String(c).toUpperCase().includes(initialClass.toUpperCase()));
    });
    setSubSelectedStudentIds(classSts.map(s => String(s.regNo || s.adNo)));
    setSubStudentSearch('');
    setSubModalClassFilter('ALL');
    setSubModalDeptFilter('ALL');
    setSubModalMadhabFilter('ALL');
    setSubModalStreamFilter('ALL');
    setShowAddModal(true);
  };

  // Open Edit Modal
  const openEditSubjectModal = (item) => {
    setEditingSubject(item);
    setSubName(item.subject);
    setSubAlias(item.alias);
    const isStandardClass = DEFAULT_CLASSES.includes(item.targetClass);
    if (isStandardClass) {
      setSubTargetClass(item.targetClass);
      setSubCustomClass('');
    } else {
      setSubTargetClass('CUSTOM');
      setSubCustomClass(item.targetClass);
    }
    setSubIsAttendanceOnly(item.isAttendanceOnly);
    setSubTeacherUsername(item.teacherUsername);
    setSubSelectedStudentIds(item.studentIds && item.studentIds.length > 0
      ? item.studentIds
      : item.enrolledStudents.map(s => String(s.regNo || s.adNo))
    );
    setSubStudentSearch('');
    setSubModalClassFilter('ALL');
    setSubModalDeptFilter('ALL');
    setSubModalMadhabFilter('ALL');
    setSubModalStreamFilter('ALL');
    setShowAddModal(true);
  };

  // Quick Select All from target class
  const handleSelectAllClassStudents = () => {
    const cls = (subTargetClass === 'CUSTOM' ? subCustomClass : subTargetClass).trim().toUpperCase();
    if (!cls) return;
    const matched = students.filter(s => {
      const clsArr = Array.isArray(s.classes) ? s.classes : [s.class];
      return clsArr.some(c => String(c).toUpperCase().replace(/[^A-Z0-9]/g, '').includes(cls.replace(/[^A-Z0-9]/g, '')));
    });
    const ids = matched.map(s => String(s.regNo || s.adNo));
    setSubSelectedStudentIds(ids);
  };

  // Toggle single student
  const handleToggleStudentSelection = (stId) => {
    const str = String(stId);
    setSubSelectedStudentIds(prev =>
      prev.includes(str) ? prev.filter(x => x !== str) : [...prev, str]
    );
  };

  // Save Add / Edit Subject
  const handleSaveSubject = async (e) => {
    e.preventDefault();
    if (!subName.trim()) return alert('Please enter a Subject Name.');
    const effectiveClass = (subTargetClass === 'CUSTOM' ? subCustomClass : subTargetClass).trim();
    if (!effectiveClass) return alert('Please specify a Class or Batch.');
    if (!subTeacherUsername) return alert('Please select a Teacher to assign to this Subject.');

    setSubmitting(true);
    setStatusMessage({ text: 'Saving subject course...', type: 'info' });

    try {
      const selectedTeacher = teachers.find(t => t.username === subTeacherUsername);
      if (!selectedTeacher) throw new Error('Selected teacher account not found.');

      const enrollmentId = editingSubject ? editingSubject.id : `env_${Date.now()}`;
      const finalAlias = subAlias.trim() || `${effectiveClass} ${subName.trim()}`;
      const gradeMatch = effectiveClass.match(/\d+/);
      const gradeNum = gradeMatch ? gradeMatch[0] : '1';

      const newEnrollmentObj = {
        id: enrollmentId,
        subject: subName.trim(),
        Sub: subName.trim(),
        alias: finalAlias,
        Alias: finalAlias,
        targetClass: effectiveClass,
        isAttendanceOnly: Boolean(subIsAttendanceOnly),
        grade: gradeNum,
        studentIds: subSelectedStudentIds,
        updatedAt: new Date().toISOString()
      };

      // 1. Update the Teacher document in Firestore
      let updatedTeachers = [...teachers];

      // If editing and teacher changed, remove from old teacher
      if (editingSubject && editingSubject.teacherUsername !== subTeacherUsername) {
        const oldTeacher = teachers.find(t => t.username === editingSubject.teacherUsername);
        if (oldTeacher) {
          const oldEnvs = (oldTeacher.enrollments || []).filter(e => e.id !== editingSubject.id);
          await setDoc(doc(db, 'teachers', oldTeacher.username), { enrollments: oldEnvs }, { merge: true });
          updatedTeachers = updatedTeachers.map(t => t.username === oldTeacher.username ? { ...t, enrollments: oldEnvs } : t);
        }
      }

      // Add or update in target teacher
      const targetTeacherEnvs = Array.isArray(selectedTeacher.enrollments) ? [...selectedTeacher.enrollments] : [];
      const existingEnvIdx = targetTeacherEnvs.findIndex(e => e.id === enrollmentId);
      if (existingEnvIdx >= 0) {
        targetTeacherEnvs[existingEnvIdx] = { ...targetTeacherEnvs[existingEnvIdx], ...newEnrollmentObj };
      } else {
        targetTeacherEnvs.push(newEnrollmentObj);
      }

      await setDoc(doc(db, 'teachers', selectedTeacher.username), { enrollments: targetTeacherEnvs }, { merge: true });
      updatedTeachers = updatedTeachers.map(t => t.username === selectedTeacher.username ? { ...t, enrollments: targetTeacherEnvs } : t);

      // 2. Update Student documents in Firestore with attendanceEnrollmentIds
      const selectedStudentSet = new Set(subSelectedStudentIds.map(x => String(x).toUpperCase()));
      const updatedStudents = students.map(st => {
        const sReg = String(st.regNo || '').toUpperCase();
        const sAd = String(st.adNo || '').toUpperCase();
        const isSelected = selectedStudentSet.has(sReg) || selectedStudentSet.has(sAd);
        const existingAttIds = Array.isArray(st.attendanceEnrollmentIds) ? st.attendanceEnrollmentIds : [];

        let newAttIds;
        if (isSelected) {
          newAttIds = Array.from(new Set([...existingAttIds, enrollmentId]));
        } else {
          newAttIds = existingAttIds.filter(id => id !== enrollmentId);
        }

        if (newAttIds.length !== existingAttIds.length) {
          // Fire-and-forget individual student update
          setDoc(doc(db, 'students', String(st.regNo).toLowerCase()), {
            attendanceEnrollmentIds: newAttIds
          }, { merge: true }).catch(() => {});
          return { ...st, attendanceEnrollmentIds: newAttIds };
        }
        return st;
      });

      // 3. Update local & parent states
      setTeachers(updatedTeachers);
      setStudents(updatedStudents);
      if (onTeachersUpdated) onTeachersUpdated(updatedTeachers);
      if (onStudentsUpdated) onStudentsUpdated(updatedStudents);

      setStatusMessage({ text: `✅ Subject "${finalAlias}" saved successfully!`, type: 'success' });
      setShowAddModal(false);
      setEditingSubject(null);
    } catch (err) {
      console.error('Error saving subject:', err);
      alert(`Failed to save subject: ${err.message}`);
      setStatusMessage({ text: `❌ Error: ${err.message}`, type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  // Delete Subject Confirmation
  const handleDeleteSubject = async (item) => {
    if (!window.confirm(`Are you sure you want to delete the subject "${item.alias}"?\nThis will unassign it from ${item.teacherName}. (Attendance history is safely preserved).`)) {
      return;
    }

    try {
      const teacher = teachers.find(t => t.username === item.teacherUsername);
      if (teacher) {
        const updatedEnvs = (teacher.enrollments || []).filter(e => e.id !== item.id);
        await setDoc(doc(db, 'teachers', teacher.username), { enrollments: updatedEnvs }, { merge: true });

        const updatedTeachers = teachers.map(t =>
          t.username === teacher.username ? { ...t, enrollments: updatedEnvs } : t
        );
        setTeachers(updatedTeachers);
        if (onTeachersUpdated) onTeachersUpdated(updatedTeachers);
      }
      setStatusMessage({ text: `🗑️ Subject "${item.alias}" removed successfully!`, type: 'success' });
    } catch (err) {
      console.error('Error deleting subject:', err);
      alert(`Failed to delete subject: ${err.message}`);
    }
  };

  // Filtered Subject Batches
  const filteredSubjects = useMemo(() => {
    return allSubjectBatches.filter(item => {
      // Search
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const matches =
          item.subject.toLowerCase().includes(q) ||
          item.alias.toLowerCase().includes(q) ||
          item.targetClass.toLowerCase().includes(q) ||
          item.teacherName.toLowerCase().includes(q) ||
          item.teacherUsername.toLowerCase().includes(q);
        if (!matches) return false;
      }
      // Class filter
      if (classFilter !== 'ALL') {
        const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!norm(item.targetClass).includes(norm(classFilter)) && !norm(item.alias).includes(norm(classFilter))) {
          return false;
        }
      }
      // Type filter
      if (typeFilter === 'MARK' && item.isAttendanceOnly) return false;
      if (typeFilter === 'ATTENDANCE_ONLY' && !item.isAttendanceOnly) return false;

      return true;
    });
  }, [allSubjectBatches, searchTerm, classFilter, typeFilter]);

  // KPI Calculations
  const totalCourses = allSubjectBatches.length;
  const markEntryCourses = allSubjectBatches.filter(s => !s.isAttendanceOnly).length;
  const attendanceOnlyCourses = allSubjectBatches.filter(s => s.isAttendanceOnly).length;
  const uniqueTeachersCount = new Set(allSubjectBatches.map(s => s.teacherUsername)).size;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 🌟 KPI SUMMARY STRIP */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
        <div style={{ background: '#ffffff', padding: '18px 20px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
          <div style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>TOTAL SUBJECT BATCHES</div>
          <div style={{ fontSize: '26px', fontWeight: '900', color: '#0f172a', marginTop: '4px' }}>{totalCourses}</div>
          <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>Across all classes &amp; faculty</div>
        </div>

        <div style={{ background: '#ffffff', padding: '18px 20px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
          <div style={{ fontSize: '11px', fontWeight: '800', color: '#047857', textTransform: 'uppercase' }}>MARK ENTRY + ATTENDANCE</div>
          <div style={{ fontSize: '26px', fontWeight: '900', color: '#047857', marginTop: '4px' }}>{markEntryCourses}</div>
          <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>Curriculum exam subjects</div>
        </div>

        <div style={{ background: '#ffffff', padding: '18px 20px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
          <div style={{ fontSize: '11px', fontWeight: '800', color: '#d97706', textTransform: 'uppercase' }}>ATTENDANCE ONLY COURSES</div>
          <div style={{ fontSize: '26px', fontWeight: '900', color: '#d97706', marginTop: '4px' }}>{attendanceOnlyCourses}</div>
          <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>Speech, debate, non-mark batches</div>
        </div>

        <div style={{ background: '#ffffff', padding: '18px 20px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
          <div style={{ fontSize: '11px', fontWeight: '800', color: '#4f46e5', textTransform: 'uppercase' }}>ASSIGNED FACULTY</div>
          <div style={{ fontSize: '26px', fontWeight: '900', color: '#4f46e5', marginTop: '4px' }}>{uniqueTeachersCount}</div>
          <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>Active instructors taking courses</div>
        </div>
      </div>

      {/* 🌟 ACTION BAR: SEARCH, FILTERS & ADD BUTTON */}
      <div style={{ background: '#ffffff', padding: '16px 20px', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', flex: 1, minWidth: '280px' }}>
          <input
            type="text"
            placeholder="🔍 Search by subject, class, alias or teacher..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ ...styles.input, maxWidth: '340px' }}
          />

          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            style={{ ...styles.input, maxWidth: '170px' }}
          >
            <option value="ALL">All Classes</option>
            {DEFAULT_CLASSES.map(cls => (
              <option key={cls} value={cls}>Class {cls}</option>
            ))}
          </select>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            style={{ ...styles.input, maxWidth: '190px' }}
          >
            <option value="ALL">All Types</option>
            <option value="MARK">Mark Entry + Att</option>
            <option value="ATTENDANCE_ONLY">Attendance Only</option>
          </select>
        </div>

        <button
          type="button"
          onClick={openAddSubjectModal}
          style={{
            padding: '10px 18px',
            background: '#4f46e5',
            color: '#ffffff',
            border: 'none',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: '800',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            boxShadow: '0 2px 4px rgba(79, 70, 229, 0.2)'
          }}
        >
          <span>➕</span> Add New Subject
        </button>
      </div>

      {statusMessage.text && (
        <div style={{
          padding: '12px 18px',
          borderRadius: '8px',
          fontSize: '13px',
          fontWeight: '700',
          background: statusMessage.type === 'success' ? '#ecfdf5' : statusMessage.type === 'error' ? '#fff1f2' : '#eff6ff',
          color: statusMessage.type === 'success' ? '#047857' : statusMessage.type === 'error' ? '#e11d48' : '#1d4ed8',
          border: `1px solid ${statusMessage.type === 'success' ? '#a7f3d0' : statusMessage.type === 'error' ? '#fecdd3' : '#bfdbfe'}`
        }}>
          {statusMessage.text}
        </div>
      )}

      {/* 🌟 SUBJECT TILE CARDS GRID */}
      {filteredSubjects.length === 0 ? (
        <div style={{ background: '#ffffff', padding: '48px 24px', borderRadius: '14px', border: '1px dashed #cbd5e1', textAlign: 'center', color: '#64748b' }}>
          <div style={{ fontSize: '36px', marginBottom: '8px' }}>📚</div>
          <div style={{ fontSize: '16px', fontWeight: '800', color: '#0f172a' }}>No Subjects Found</div>
          <p style={{ margin: '6px 0 16px', fontSize: '13px' }}>
            {searchTerm || classFilter !== 'ALL' || typeFilter !== 'ALL'
              ? 'No subjects match the selected filters.'
              : 'No subjects have been created yet. Click "+ Add New Subject" to create one.'}
          </p>
          <button
            type="button"
            onClick={openAddSubjectModal}
            style={{ padding: '8px 16px', background: '#4f46e5', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '800', cursor: 'pointer' }}
          >
            + Add New Subject
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '18px' }}>
          {filteredSubjects.map(item => (
            <div
              key={item.id + item.teacherUsername}
              style={{
                background: '#ffffff',
                borderRadius: '14px',
                border: '1px solid #e2e8f0',
                padding: '20px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '16px',
                boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
                transition: 'transform 0.15s ease, box-shadow 0.15s ease'
              }}
            >
              {/* Top Meta: Subject Name, Badges & Class */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '8px' }}>
                  <h3 style={{ margin: 0, fontSize: '17px', fontWeight: '900', color: '#0f172a' }}>
                    {item.alias || item.subject}
                  </h3>
                  <span style={{
                    padding: '3px 8px',
                    borderRadius: '999px',
                    fontSize: '10px',
                    fontWeight: '800',
                    textTransform: 'uppercase',
                    whiteSpace: 'nowrap',
                    background: item.isAttendanceOnly ? '#fef3c7' : '#ecfdf5',
                    color: item.isAttendanceOnly ? '#b45309' : '#047857',
                    border: `1px solid ${item.isAttendanceOnly ? '#fde68a' : '#a7f3d0'}`
                  }}>
                    {item.isAttendanceOnly ? 'Attendance Only' : 'Mark Entry + Att'}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ background: '#f1f5f9', color: '#334155', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: '700' }}>
                    Class: {item.targetClass}
                  </span>
                  {item.subject !== item.alias && (
                    <span style={{ background: '#f8fafc', color: '#64748b', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: '600', border: '1px solid #e2e8f0' }}>
                      Canonical: {item.subject}
                    </span>
                  )}
                </div>
              </div>

              {/* Faculty Assigned Row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: '#f8fafc', padding: '10px 14px', borderRadius: '10px', border: '1px solid #f1f5f9' }}>
                <ProfileAvatar
                  photoUrl={item.teacherPhoto}
                  name={item.teacherName}
                  size={38}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase' }}>Assigned Faculty</div>
                  <div style={{ fontSize: '13px', fontWeight: '800', color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.teacherName}
                  </div>
                  <div style={{ fontSize: '11px', color: '#4f46e5', fontWeight: '600' }}>
                    @{item.teacherUsername}
                  </div>
                </div>
              </div>

              {/* Enrolled Students & Actions */}
              <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '15px' }}>👥</span>
                  <span style={{ fontSize: '13px', fontWeight: '800', color: '#0f172a' }}>
                    {item.enrolledCount} Students
                  </span>
                  <button
                    type="button"
                    onClick={() => setViewingStudentsSubject(item)}
                    style={{ background: 'transparent', border: 'none', color: '#4f46e5', fontSize: '11px', fontWeight: '700', cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    View List
                  </button>
                </div>

                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    type="button"
                    onClick={() => openEditSubjectModal(item)}
                    title="Edit Subject & Students"
                    style={{ padding: '6px 10px', background: '#eef2ff', color: '#4f46e5', border: '1px solid #c7d2fe', borderRadius: '6px', fontSize: '11px', fontWeight: '700', cursor: 'pointer' }}
                  >
                    ✏️ Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteSubject(item)}
                    title="Delete Subject"
                    style={{ padding: '6px 10px', background: '#fff1f2', color: '#e11d48', border: '1px solid #ffe4e6', borderRadius: '6px', fontSize: '11px', fontWeight: '700', cursor: 'pointer' }}
                  >
                    🗑️
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 🌟 MODAL: ADD / EDIT NEW SUBJECT */}
      {showAddModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '16px'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '16px',
            width: '100%',
            maxWidth: '680px',
            maxHeight: '90vh',
            overflowY: 'auto',
            padding: '28px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
            display: 'flex',
            flexDirection: 'column',
            gap: '18px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '19px', fontWeight: '900', color: '#0f172a' }}>
                  {editingSubject ? `✏️ Edit Subject: ${editingSubject.alias}` : '➕ Add New Subject Course'}
                </h2>
                <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#64748b' }}>
                  Configure course details, mark entry mode, faculty teacher and enrolled students.
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setShowAddModal(false); setEditingSubject(null); }}
                style={{ background: '#f1f5f9', border: 'none', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer', fontWeight: '800' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveSubject} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* 1. Subject Name with suggestions */}
              <div>
                <label style={{ ...styles.label, marginBottom: '6px', display: 'block' }}>
                  Subject Name *Mandatory
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Logic, Hadith, Speech Practice, etc."
                  value={subName}
                  onChange={(e) => handleSubjectNameChange(e.target.value)}
                  style={styles.input}
                  list="quick-course-suggestions"
                />
                <datalist id="quick-course-suggestions">
                  {QUICK_COURSE_SUGGESTIONS.map(s => <option key={s} value={s} />)}
                </datalist>
              </div>

              {/* 2. Target Class & Alias */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                <div>
                  <label style={{ ...styles.label, marginBottom: '6px', display: 'block' }}>
                    Target Class / Batch *Mandatory
                  </label>
                  <select
                    value={subTargetClass}
                    onChange={(e) => handleClassChange(e.target.value)}
                    style={styles.input}
                  >
                    {DEFAULT_CLASSES.map(cls => (
                      <option key={cls} value={cls}>Class {cls}</option>
                    ))}
                    <option value="CUSTOM">Custom / Multi-Class</option>
                  </select>
                  {subTargetClass === 'CUSTOM' && (
                    <input
                      type="text"
                      placeholder="Enter custom class name (e.g. ALL, DEBATE_B1)"
                      value={subCustomClass}
                      onChange={(e) => {
                        setSubCustomClass(e.target.value);
                        if (subName) setSubAlias(`${e.target.value} ${subName}`.trim());
                      }}
                      style={{ ...styles.input, marginTop: '8px' }}
                      required
                    />
                  )}
                </div>

                <div>
                  <label style={{ ...styles.label, marginBottom: '6px', display: 'block' }}>
                    Display Alias / Code
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. QLA3 Logic"
                    value={subAlias}
                    onChange={(e) => setSubAlias(e.target.value)}
                    style={styles.input}
                  />
                </div>
              </div>

              {/* 3. Subject Type (Mark Entry vs Attendance Only) */}
              <div>
                <label style={{ ...styles.label, marginBottom: '8px', display: 'block' }}>
                  Subject Type &amp; Purpose
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '12px 14px',
                    borderRadius: '10px',
                    border: !subIsAttendanceOnly ? '2px solid #047857' : '1px solid #cbd5e1',
                    background: !subIsAttendanceOnly ? '#ecfdf5' : '#ffffff',
                    cursor: 'pointer'
                  }}>
                    <input
                      type="radio"
                      name="subType"
                      checked={!subIsAttendanceOnly}
                      onChange={() => setSubIsAttendanceOnly(false)}
                    />
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: '800', color: !subIsAttendanceOnly ? '#047857' : '#0f172a' }}>
                        📊 Mark Entry + Period Att
                      </div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>
                        Regular academic subject with CCE exam marks &amp; roll-call attendance.
                      </div>
                    </div>
                  </label>

                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '12px 14px',
                    borderRadius: '10px',
                    border: subIsAttendanceOnly ? '2px solid #d97706' : '1px solid #cbd5e1',
                    background: subIsAttendanceOnly ? '#fffbeb' : '#ffffff',
                    cursor: 'pointer'
                  }}>
                    <input
                      type="radio"
                      name="subType"
                      checked={subIsAttendanceOnly}
                      onChange={() => setSubIsAttendanceOnly(true)}
                    />
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: '800', color: subIsAttendanceOnly ? '#d97706' : '#0f172a' }}>
                        📅 Attendance Only
                      </div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>
                        Co-curricular, speech, seminar or non-mark attendance course.
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              {/* 4. Assign Teacher */}
              <div>
                <label style={{ ...styles.label, marginBottom: '6px', display: 'block' }}>
                  Assign Faculty / Teacher *Mandatory
                </label>
                <select
                  required
                  value={subTeacherUsername}
                  onChange={(e) => setSubTeacherUsername(e.target.value)}
                  style={styles.input}
                >
                  <option value="">-- Select Teacher --</option>
                  {teachers.map(t => (
                    <option key={t.username} value={t.username}>
                      {t.fullName} (@{t.username}) — {t.designation || 'Faculty'}
                    </option>
                  ))}
                </select>
              </div>

              {/* 5. Assign Students */}
              <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px', background: '#f8fafc' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
                  <div>
                    <label style={{ ...styles.label, margin: 0 }}>
                      Enrolled Students ({subSelectedStudentIds.length} Selected)
                    </label>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>
                      Assign all students from the class or hand-pick specific candidates.
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={handleSelectAllClassStudents}
                      style={{ padding: '6px 12px', background: '#eef2ff', color: '#4f46e5', border: '1px solid #c7d2fe', borderRadius: '6px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}
                    >
                      ⚡ Select All Class Students
                    </button>
                    <button
                      type="button"
                      onClick={() => setSubSelectedStudentIds([])}
                      style={{ padding: '6px 12px', background: '#f1f5f9', color: '#64748b', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}
                    >
                      Clear Selection
                    </button>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px', marginBottom: '10px' }}>
                  <select
                    value={subModalClassFilter}
                    onChange={(e) => setSubModalClassFilter(e.target.value)}
                    style={{ ...styles.input, fontSize: '11px', padding: '6px 8px' }}
                  >
                    <option value="ALL">All Classes</option>
                    {DEFAULT_CLASSES.map(c => <option key={c} value={c}>Class {c}</option>)}
                  </select>

                  <select
                    value={subModalDeptFilter}
                    onChange={(e) => setSubModalDeptFilter(e.target.value)}
                    style={{ ...styles.input, fontSize: '11px', padding: '6px 8px' }}
                  >
                    <option value="ALL">All Departments</option>
                    {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>

                  <select
                    value={subModalMadhabFilter}
                    onChange={(e) => setSubModalMadhabFilter(e.target.value)}
                    style={{ ...styles.input, fontSize: '11px', padding: '6px 8px' }}
                  >
                    <option value="ALL">All Madhabs</option>
                    <option value="Shafi">Shafi</option>
                    <option value="Hanafi">Hanafi</option>
                  </select>

                  <select
                    value={subModalStreamFilter}
                    onChange={(e) => setSubModalStreamFilter(e.target.value)}
                    style={{ ...styles.input, fontSize: '11px', padding: '6px 8px' }}
                  >
                    <option value="ALL">All Categories</option>
                    <option value="URDU">Urdu Stream Only</option>
                    <option value="NON_URDU">Non-Urdu Only</option>
                  </select>
                </div>

                <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                  <input
                    type="text"
                    placeholder="Filter students in list by name or ad.no..."
                    value={subStudentSearch}
                    onChange={(e) => setSubStudentSearch(e.target.value)}
                    style={{ ...styles.input, fontSize: '12px', padding: '8px 12px', flex: 1, margin: 0 }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const visibleStudents = students.filter(st => {
                        const stClasses = Array.isArray(st.classes) ? st.classes : [st.class];
                        const isUrdu = String(st.adNo || '').toUpperCase().startsWith('U');
                        if (subModalClassFilter !== 'ALL' && !stClasses.includes(subModalClassFilter)) return false;
                        if (subModalDeptFilter !== 'ALL' && String(st.department || '').toUpperCase() !== subModalDeptFilter.toUpperCase()) return false;
                        if (subModalMadhabFilter !== 'ALL' && String(st.madhab || '').toUpperCase() !== subModalMadhabFilter.toUpperCase()) return false;
                        if (subModalStreamFilter === 'URDU' && !isUrdu) return false;
                        if (subModalStreamFilter === 'NON_URDU' && isUrdu) return false;
                        if (subStudentSearch.trim()) {
                          const q = subStudentSearch.toLowerCase();
                          const sName = String(st.firstName || st.name || '').toLowerCase();
                          const sAd = String(st.adNo || '').toLowerCase();
                          const sReg = String(st.regNo || '').toLowerCase();
                          if (!sName.includes(q) && !sAd.includes(q) && !sReg.includes(q)) return false;
                        }
                        return true;
                      });
                      const ids = visibleStudents.map(s => String(s.regNo || s.adNo));
                      setSubSelectedStudentIds(prev => Array.from(new Set([...prev, ...ids])));
                    }}
                    style={{ padding: '6px 12px', background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', borderRadius: '6px', fontSize: '11px', fontWeight: '700', cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    ✓ Select Filtered
                  </button>
                </div>

                <div style={{ maxHeight: '200px', overflowY: 'auto', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '8px' }}>
                  {students
                    .filter(st => {
                      const stClasses = Array.isArray(st.classes) ? st.classes : [st.class];
                      const isUrdu = String(st.adNo || '').toUpperCase().startsWith('U');
                      if (subModalClassFilter !== 'ALL' && !stClasses.includes(subModalClassFilter)) return false;
                      if (subModalDeptFilter !== 'ALL' && String(st.department || '').toUpperCase() !== subModalDeptFilter.toUpperCase()) return false;
                      if (subModalMadhabFilter !== 'ALL' && String(st.madhab || '').toUpperCase() !== subModalMadhabFilter.toUpperCase()) return false;
                      if (subModalStreamFilter === 'URDU' && !isUrdu) return false;
                      if (subModalStreamFilter === 'NON_URDU' && isUrdu) return false;

                      if (!subStudentSearch.trim()) {
                        if (subModalClassFilter === 'ALL' && subModalDeptFilter === 'ALL' && subModalMadhabFilter === 'ALL' && subModalStreamFilter === 'ALL') {
                          // Default initial view: prioritize selected class or already selected
                          const curCls = (subTargetClass === 'CUSTOM' ? subCustomClass : subTargetClass).toUpperCase();
                          const stCls = Array.isArray(st.classes) ? st.classes.join(' ') : (st.class || '');
                          if (curCls && curCls !== 'CUSTOM' && stCls.toUpperCase().includes(curCls)) return true;
                          return subSelectedStudentIds.includes(String(st.regNo)) || subSelectedStudentIds.includes(String(st.adNo));
                        }
                        return true;
                      }
                      const q = subStudentSearch.toLowerCase();
                      const sName = String(st.firstName || st.name || '').toLowerCase();
                      const sAd = String(st.adNo || '').toLowerCase();
                      const sReg = String(st.regNo || '').toLowerCase();
                      const sCls = String(Array.isArray(st.classes) ? st.classes.join(' ') : (st.class || '')).toLowerCase();
                      return sName.includes(q) || sAd.includes(q) || sReg.includes(q) || sCls.includes(q);
                    })
                    .map(st => {
                      const idKey = String(st.regNo || st.adNo);
                      const isChecked = subSelectedStudentIds.includes(idKey) || subSelectedStudentIds.includes(String(st.adNo)) || subSelectedStudentIds.includes(String(st.regNo));
                      const stCls = Array.isArray(st.classes) ? st.classes.join(', ') : (st.class || '');
                      const isUrdu = String(st.adNo || '').toUpperCase().startsWith('U');
                      return (
                        <label
                          key={st.id || idKey}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '6px 8px',
                            borderRadius: '6px',
                            background: isChecked ? '#f0fdf4' : 'transparent',
                            cursor: 'pointer',
                            fontSize: '12px',
                            borderBottom: '1px solid #f8fafc'
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleToggleStudentSelection(idKey)}
                          />
                          <span style={{ fontWeight: '800', color: isUrdu ? '#d97706' : '#2563eb', minWidth: '55px' }}>
                            #{st.adNo}
                          </span>
                          <span style={{ flex: 1, color: '#334155', fontWeight: '600' }}>
                            {st.firstName || st.name}
                          </span>
                          <span style={{ color: '#64748b', fontSize: '10px', background: '#f1f5f9', padding: '2px 5px', borderRadius: '4px' }}>
                            {stCls}
                          </span>
                          {st.department && (
                            <span style={{ color: '#475569', fontSize: '10px', background: '#e2e8f0', padding: '2px 5px', borderRadius: '4px' }}>
                              {st.department}
                            </span>
                          )}
                          <span style={{
                            fontSize: '10px',
                            fontWeight: '700',
                            padding: '2px 5px',
                            borderRadius: '4px',
                            background: String(st.madhab).toLowerCase() === 'hanafi' ? '#fef3c7' : '#ecfdf5',
                            color: String(st.madhab).toLowerCase() === 'hanafi' ? '#92400e' : '#047857'
                          }}>
                            {st.madhab || 'Shafi'}
                          </span>
                        </label>
                      );
                    })}
                </div>
              </div>

              {/* Submit Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => { setShowAddModal(false); setEditingSubject(null); }}
                  style={{ padding: '10px 18px', background: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1', borderRadius: '8px', fontWeight: '800', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    padding: '10px 22px',
                    background: '#4f46e5',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: '800',
                    cursor: submitting ? 'not-allowed' : 'pointer',
                    opacity: submitting ? 0.7 : 1
                  }}
                >
                  {submitting ? 'Saving...' : editingSubject ? 'Update Subject' : 'Create & Assign Subject'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 🌟 MODAL: VIEW ENROLLED STUDENTS LIST */}
      {viewingStudentsSubject && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '16px'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '16px',
            width: '100%',
            maxWidth: '560px',
            maxHeight: '85vh',
            overflowY: 'auto',
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '900', color: '#0f172a' }}>
                  👥 Enrolled Students — {viewingStudentsSubject.alias}
                </h3>
                <div style={{ fontSize: '12px', color: '#64748b' }}>
                  Faculty: {viewingStudentsSubject.teacherName} • Total Enrolled: {viewingStudentsSubject.enrolledCount}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewingStudentsSubject(null)}
                style={{ background: '#f1f5f9', border: 'none', borderRadius: '50%', width: '30px', height: '30px', cursor: 'pointer', fontWeight: '800' }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '420px', overflowY: 'auto' }}>
              {viewingStudentsSubject.enrolledStudents.length === 0 ? (
                <div style={{ padding: '24px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                  No students currently mapped. Click "Edit" to assign students.
                </div>
              ) : (
                viewingStudentsSubject.enrolledStudents.map((st, idx) => (
                  <div
                    key={st.id || idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '10px 14px',
                      background: '#f8fafc',
                      borderRadius: '8px',
                      border: '1px solid #f1f5f9'
                    }}
                  >
                    <ProfileAvatar photoUrl={st.photoUrl} name={st.firstName || st.name} size={34} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: '800', color: '#0f172a' }}>
                        {idx + 1}. {st.firstName || st.name}
                      </div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>
                        Ad.No: #{st.adNo} • Reg: {st.regNo}
                      </div>
                    </div>
                    <span style={{ fontSize: '11px', fontWeight: '700', background: '#eef2ff', color: '#4f46e5', padding: '3px 8px', borderRadius: '6px' }}>
                      {Array.isArray(st.classes) ? st.classes.join(', ') : (st.class || 'Class')}
                    </span>
                  </div>
                ))
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                onClick={() => {
                  const subjectToEdit = viewingStudentsSubject;
                  setViewingStudentsSubject(null);
                  openEditSubjectModal(subjectToEdit);
                }}
                style={{ padding: '8px 16px', background: '#4f46e5', color: '#ffffff', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '800', cursor: 'pointer' }}
              >
                ✏️ Edit Student Enrollment
              </button>
              <button
                type="button"
                onClick={() => setViewingStudentsSubject(null)}
                style={{ padding: '8px 16px', background: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '12px', fontWeight: '800', cursor: 'pointer' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
