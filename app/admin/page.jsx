'use client';
import { useState, useEffect } from 'react';
import { auth, db } from '../../lib/firebase';
import { createUserWithEmailAndPassword, getAuth, signOut } from 'firebase/auth';
// Change your existing import from this:
// import { doc, setDoc, getDocs, collection, deleteDoc, arrayUnion } from 'firebase/firestore';

// To this (adding getDoc):
import { doc, setDoc, getDoc, getDocs, collection, deleteDoc, arrayUnion } from 'firebase/firestore';
import { getApp, initializeApp } from 'firebase/app';

const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbxN_z56f3Q5O3OjsKFagUSqromiH0xTKTfro0zqJZN4ZB-FJLM3jERMigPXiOkfw-4/exec';

const DEFAULT_SUBJECTS = ["Thafseer", "Hadith", "Fiqh", "Aqidah", "Balagha", "Logic", "English", "Adab", "Urdu", "Social Science", "Thamadun", "Hifz"];
const DEFAULT_CLASSES = ["QH1", "AL1", "FC1", "QH2", "AL2", "FC2", "QLA3", "HFC3"];
const GRADES = ["1", "2", "3"];
const DEPARTMENTS = ["QURAN", "LANGUAGE", "AQIDAH", "HADITH", "FIQH", "CIVIL"];
const MADHABS = ["Hanafi", "Shafi", "General"];


const parseCSVLine = (str) => {
    let arr = [];
    let quote = false;
    let current = '';
    for (let i = 0; i < str.length; i++) {
        let char = str[i];
        if (char === '"') quote = !quote;
        else if (char === ',' && !quote) { arr.push(current); current = ''; }
        else current += char;
    }
    arr.push(current);
    return arr;
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const styles = {
    card: { background: '#ffffff', padding: '32px', borderRadius: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: '1px solid #f1f5f9', marginBottom: '32px' },
    input: { width: '100%', padding: '12px 16px', borderRadius: '8px', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', color: '#0f172a', fontSize: '15px', outline: 'none', boxSizing: 'border-box' },
    label: { display: 'block', fontSize: '14px', fontWeight: '600', color: '#334155', marginBottom: '8px' },
    buttonPrimary: { padding: '12px 24px', background: '#2563eb', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '15px', transition: '0.2s' },
    buttonSuccess: { padding: '14px 24px', background: '#10b981', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '16px', width: '100%', marginTop: '10px' },
    buttonWarning: { padding: '14px 24px', background: '#f59e0b', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '16px', width: '100%', marginTop: '10px' },
    sectionTitle: { margin: '0 0 20px 0', fontSize: '20px', color: '#0f172a', fontWeight: '700', borderBottom: '2px solid #f1f5f9', paddingBottom: '12px' },
    badge: { display: 'inline-block', padding: '4px 8px', borderRadius: '6px', fontSize: '12px', fontWeight: '700' },
    filterSelect: { padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none', fontSize: '13px', backgroundColor: '#ffffff', color: '#0f172a', fontWeight: '600', cursor: 'pointer' }
};

// ==========================================
// COMPONENT 1: TEACHER MANAGEMENT TAB
// ==========================================
function TeacherManager() {
    const [username, setUsername] = useState('');
    const [fullName, setFullName] = useState('');
    const [password, setPassword] = useState('123sms');
    const [showTeacherPassword, setShowTeacherPassword] = useState(false);

    const [subjectEnrollments, setSubjectEnrollments] = useState([]);
    const [newGrade, setNewGrade] = useState('1');
    const [newSubject, setNewSubject] = useState(DEFAULT_SUBJECTS[0]);

    const [allStudents, setAllStudents] = useState([]);
    const [editingEnrollmentId, setEditingEnrollmentId] = useState(null);
    const [tempSelectedStudents, setTempSelectedStudents] = useState([]);

    const [groupAlias, setGroupAlias] = useState('');
    const [groupLangTag, setGroupLangTag] = useState('Gen');

    const [filterGrade, setFilterGrade] = useState('All');
    const [filterMadhab, setFilterMadhab] = useState('All');
    const [filterUrdu, setFilterUrdu] = useState('All');
    const [filterDepartments, setFilterDepartments] = useState([]);

    const [registeredTeachers, setRegisteredTeachers] = useState([]);
    const [isEditing, setIsEditing] = useState(false);
    const [statusMsg, setStatusMsg] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const fetchTeachersAndStudents = async () => {
        try {
            const tSnap = await getDocs(collection(db, 'teachers'));
            const tData = [];
            tSnap.forEach((doc) => tData.push(doc.data()));
            setRegisteredTeachers(tData);

            const sSnap = await getDocs(collection(db, 'students'));
            const sData = [];
            sSnap.forEach((doc) => sData.push(doc.data()));
            sData.sort((a, b) => (Number(a.rollNo) || 999) - (Number(b.rollNo) || 999));
            setAllStudents(sData);
        } catch (err) { console.error(err); }
    };

    useEffect(() => { fetchTeachersAndStudents(); }, []);

    const handleDownloadTemplate = () => {
        const csvContent = "data:text/csv;charset=utf-8,username,fullName,password,assignments\nmuzammil,Muzammil Hudawi,123sms,AL2:Thafseer,Hadith|Mixed_Urdu:Urdu";
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", "teacher_upload_template.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleAddSubject = () => {
        const newId = Date.now().toString();
        setSubjectEnrollments([...subjectEnrollments, {
            id: newId,
            grade: newGrade,
            subject: newSubject,
            alias: `Grade ${newGrade} ${newSubject}`,
            langTag: 'Gen',
            studentIds: []
        }]);
    };

    const handleRemoveSubject = (id) => {
        if (window.confirm("Remove this subject assignment?")) {
            setSubjectEnrollments(subjectEnrollments.filter(e => e.id !== id));
            if (editingEnrollmentId === id) setEditingEnrollmentId(null);
        }
    };

    const openStudentPicker = (enrollment) => {
        setEditingEnrollmentId(enrollment.id);
        setTempSelectedStudents([...enrollment.studentIds]);
        setFilterGrade(enrollment.grade || 'All');
        setGroupAlias(enrollment.alias || `Grade ${enrollment.grade} ${enrollment.subject}`);
        setGroupLangTag(enrollment.langTag || 'Gen');
    };

    const toggleStudentInSubject = (regNo) => {
        if (tempSelectedStudents.includes(regNo)) {
            setTempSelectedStudents(tempSelectedStudents.filter(id => id !== regNo));
        } else {
            setTempSelectedStudents([...tempSelectedStudents, regNo]);
        }
    };

    const toggleSelectAllFiltered = (filteredList) => {
        const allFilteredIds = filteredList.map(s => s.regNo);
        const areAllSelected = allFilteredIds.every(id => tempSelectedStudents.includes(id));

        if (areAllSelected) {
            setTempSelectedStudents(tempSelectedStudents.filter(id => !allFilteredIds.includes(id)));
        } else {
            const newSelections = new Set([...tempSelectedStudents, ...allFilteredIds]);
            setTempSelectedStudents(Array.from(newSelections));
        }
    };

    const toggleFilterDepartment = (dept) => {
        if (filterDepartments.includes(dept)) setFilterDepartments(filterDepartments.filter(d => d !== dept));
        else setFilterDepartments([...filterDepartments, dept]);
    };

    const autoGenerateSmartName = () => {
        const currentEnroll = subjectEnrollments.find(e => e.id === editingEnrollmentId);
        if (!currentEnroll) return;

        const deptPrefix = filterDepartments.length > 0
            ? filterDepartments.map(d => d[0]).join('')
            : 'ALL';

        const gradeString = filterGrade !== 'All' ? filterGrade : currentEnroll.grade;
        const madhabString = filterMadhab !== 'All' ? `${filterMadhab} ` : '';

        setGroupAlias(`${madhabString}${deptPrefix}${gradeString} ${currentEnroll.subject}`);
        setGroupLangTag(filterUrdu === 'All' ? 'Gen' : filterUrdu);
    };

    const saveStudentAssignments = () => {
        setSubjectEnrollments(subjectEnrollments.map(env =>
            env.id === editingEnrollmentId ? { ...env, studentIds: tempSelectedStudents, alias: groupAlias, langTag: groupLangTag } : env
        ));
        setEditingEnrollmentId(null);
    };

    const handleAddOrUpdateTeacher = async (e) => {
        e.preventDefault();
        setIsLoading(true);
        setStatusMsg(isEditing ? 'Updating teacher profile...' : 'Registering teacher securely...');

        const safeUsername = username.toLowerCase().replace(/[^a-z0-9_.-]/g, '');
        const fakeEmail = `${safeUsername}@school.com`;

        try {
            if (!isEditing) await createUserWithEmailAndPassword(auth, fakeEmail, password);
            await setDoc(doc(db, 'teachers', safeUsername), {
                fullName,
                username: safeUsername,
                enrollments: subjectEnrollments
            }, { merge: true });

            setIsLoading(false);
            setStatusMsg(isEditing ? 'Teacher updated successfully!' : 'Teacher successfully registered!');
            fetchTeachersAndStudents();
            resetForm();
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
            const text = event.target.result;
            const lines = text.split('\n');
            let teachersArray = [];
            for (let i = 1; i < lines.length; i++) {
                let line = lines[i].trim();
                if (!line) continue;
                let cols = parseCSVLine(line);
                if (cols.length >= 4) {
                    const assignmentsString = cols[3].trim();
                    const assignmentParts = assignmentsString.split('|');
                    const assignmentsData = [];
                    for (let part of assignmentParts) {
                        const [cls, subsStr] = part.split(':');
                        if (cls && subsStr) {
                            const subs = subsStr.split(',').map(s => s.trim());
                            assignmentsData.push({ className: cls.trim(), subjects: subs });
                        }
                    }
                    teachersArray.push({
                        username: cols[0].toLowerCase().replace(/[^a-z0-9_.-]/g, ''),
                        fullName: cols[1].trim(),
                        password: cols[2].trim(),
                        assignments: assignmentsData
                    });
                }
            }
            if (teachersArray.length === 0) return alert('No valid rows found in CSV.');
            setIsLoading(true);
            setStatusMsg(`Preparing to upload ${teachersArray.length} teachers...`);
            try {
                const primaryApp = getApp();
                let secondaryApp;
                try { secondaryApp = getApp("SecondaryApp"); } catch (err) { secondaryApp = initializeApp(primaryApp.options, "SecondaryApp"); }
                const secondaryAuth = getAuth(secondaryApp);

                for (let i = 0; i < teachersArray.length; i++) {
                    const t = teachersArray[i];
                    const fakeEmail = `${t.username}@school.com`;

                    setStatusMsg(`Registering teacher ${i + 1} of ${teachersArray.length}...`);
                    await delay(2000);

                    try {
                        await createUserWithEmailAndPassword(secondaryAuth, fakeEmail, t.password);
                    }
                    catch (authErr) {
                        if (authErr.code === 'auth/too-many-requests') {
                            throw new Error("Firebase temporary lock. Please wait 5 minutes before retrying.");
                        }
                        if (authErr.code !== 'auth/email-already-in-use') throw authErr;
                    }
                    await setDoc(doc(db, 'teachers', t.username), { fullName: t.fullName, username: t.username, assignments: t.assignments });
                }

                await signOut(secondaryAuth);
                setIsLoading(false);
                setStatusMsg(`Successfully mapped ${teachersArray.length} teachers!`);
                fetchTeachersAndStudents();
            } catch (err) {
                setIsLoading(false);
                setStatusMsg('Error during mass upload: ' + err.message);
            }
        };
        reader.readAsText(file);
    };

    const handleEditClick = (teacher) => {
        setIsEditing(true);
        setUsername(teacher.username);
        setFullName(teacher.fullName);
        setSubjectEnrollments(teacher.enrollments || []);
        setEditingEnrollmentId(null);
        setStatusMsg(`Editing profile for ${teacher.fullName}.`);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleDeleteClick = async (teacherUsername) => {
        if (window.confirm(`Delete ${teacherUsername}?`)) {
            try { await deleteDoc(doc(db, 'teachers', teacherUsername)); fetchTeachersAndStudents(); setStatusMsg(`${teacherUsername} deleted.`); }
            catch (err) { alert("Failed to delete teacher."); }
        }
    };

    const resetForm = () => {
        setIsEditing(false); setUsername(''); setFullName(''); setPassword('123sms');
        setSubjectEnrollments([]); setEditingEnrollmentId(null); setStatusMsg('');
    };

    const getStudentLevels = (student) => {
        const classes = student.classes || (student.className ? [student.className] : []);
        const levels = new Set();
        classes.forEach(c => { const match = c.match(/\d+/); if (match) levels.add(match[0]); });
        return Array.from(levels);
    };

    const isUrduStudent = (adNo) => (adNo || '').toUpperCase().includes('U');

    const filteredPickerStudents = allStudents.filter(student => {
        if (filterGrade !== 'All' && !getStudentLevels(student).includes(filterGrade)) return false;
        if (filterDepartments.length > 0 && !filterDepartments.includes((student.department || '').toUpperCase())) return false;
        if (filterMadhab !== 'All' && (student.madhab || 'General') !== filterMadhab) return false;
        if (filterUrdu === 'Urdu' && !isUrduStudent(student.adNo)) return false;
        if (filterUrdu === 'Non-Urdu' && isUrduStudent(student.adNo)) return false;
        return true;
    });

    return (
        <div>
            <div style={{ ...styles.card, borderLeft: isEditing ? '6px solid #f59e0b' : '1px solid #f1f5f9' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <h3 style={styles.sectionTitle}>{isEditing ? `Editing Teacher: ${username}` : 'Register Individual Teacher'}</h3>
                    {isEditing && <button onClick={resetForm} style={{ padding: '8px 16px', background: '#e2e8f0', color: '#334155', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Cancel Edit</button>}
                </div>

                <form onSubmit={handleAddOrUpdateTeacher} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                        <div>
                            <label style={styles.label}>Full Name</label>
                            <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Muzammil Hudawi" required style={styles.input} />
                        </div>
                        <div>
                            <label style={styles.label}>Username</label>
                            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. muzammil" disabled={isEditing} required style={{ ...styles.input, backgroundColor: isEditing ? '#f1f5f9' : '#ffffff', color: isEditing ? '#94a3b8' : '#0f172a' }} />
                        </div>
                    </div>

                    {!isEditing && (
                        <div>
                            <label style={styles.label}>Initial Password</label>
                            <div style={{ display: 'flex', position: 'relative' }}>
                                <input type={showTeacherPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} required style={styles.input} />
                                <button type="button" onClick={() => setShowTeacherPassword(!showTeacherPassword)} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#2563eb', fontWeight: '600', cursor: 'pointer' }}>{showTeacherPassword ? "Hide" : "Show"}</button>
                            </div>
                        </div>
                    )}

                    <div style={{ background: '#f8fafc', padding: '24px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                        <h4 style={{ margin: '0 0 16px 0', fontSize: '16px', color: '#1e293b' }}>1. Add Teaching Subjects</h4>
                        <div style={{ display: 'flex', gap: '15px', marginBottom: '20px' }}>
                            <select value={newGrade} onChange={(e) => setNewGrade(e.target.value)} style={{ ...styles.input, width: '150px', cursor: 'pointer' }}>
                                {GRADES.map(g => <option key={g} value={g}>Grade {g}</option>)}
                            </select>
                            <select value={newSubject} onChange={(e) => setNewSubject(e.target.value)} style={{ ...styles.input, flex: 1, cursor: 'pointer' }}>
                                {DEFAULT_SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                            <button type="button" onClick={handleAddSubject} style={{ ...styles.buttonPrimary, background: '#3b82f6' }}>+ Add Subject</button>
                        </div>

                        <h4 style={{ margin: '0 0 12px 0', fontSize: '15px', color: '#334155' }}>2. Assign Students to Subjects</h4>
                        {subjectEnrollments.length === 0 && <p style={{ fontSize: '14px', color: '#64748b' }}>No subjects added yet.</p>}

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {subjectEnrollments.map(enroll => (
                                <div key={enroll.id} style={{ border: '1px solid #cbd5e1', borderRadius: '8px', overflow: 'hidden' }}>

                                    <div style={{ background: '#ffffff', padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div>
                                            <strong style={{ fontSize: '16px', color: '#0f172a' }}>{enroll.alias || `Grade ${enroll.grade} ${enroll.subject}`}</strong>
                                            <sub style={{ marginLeft: '4px', color: '#64748b', fontWeight: 'bold' }}>{enroll.langTag || 'Gen'}</sub>
                                            <span style={{ marginLeft: '15px', fontSize: '13px', color: '#64748b', fontWeight: 'bold' }}>({enroll.studentIds?.length || 0} Students Assigned)</span>
                                        </div>
                                        <div style={{ display: 'flex', gap: '10px' }}>
                                            <button type="button" onClick={() => openStudentPicker(enroll)} style={{ padding: '8px 16px', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>Assign Students</button>
                                            <button type="button" onClick={() => handleRemoveSubject(enroll.id)} style={{ padding: '8px 12px', background: '#fee2e2', color: '#ef4444', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>X</button>
                                        </div>
                                    </div>

                                    {/* STUDENT PICKER PANEL */}
                                    {editingEnrollmentId === enroll.id && (
                                        <div style={{ background: '#f1f5f9', padding: '20px', borderTop: '1px solid #cbd5e1' }}>

                                            {/* Smart Name Customization Box */}
                                            <div style={{ padding: '15px', background: '#e0f2fe', borderRadius: '8px', marginBottom: '15px', border: '1px solid #bae6fd' }}>
                                                <label style={{ display: 'block', fontSize: '13px', fontWeight: 'bold', color: '#0369a1', marginBottom: '8px' }}>Display Name in Teacher Dashboard:</label>
                                                <div style={{ display: 'flex', gap: '10px' }}>
                                                    <input type="text" value={groupAlias} onChange={e => setGroupAlias(e.target.value)} placeholder="e.g. QHF1 Thafseer" style={{ ...styles.input, flex: 2 }} />
                                                    <input type="text" value={groupLangTag} onChange={e => setGroupLangTag(e.target.value)} placeholder="Subscript (e.g. Urdu)" style={{ ...styles.input, flex: 1 }} />
                                                    <button type="button" onClick={autoGenerateSmartName} style={{ padding: '8px 16px', background: '#0284c7', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>
                                                        ✨ Auto-Fill from Filters
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Filters */}
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '15px', alignItems: 'center' }}>
                                                <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#334155', marginRight: '5px' }}>Filter Depts:</span>
                                                {DEPARTMENTS.map(d => (
                                                    <label key={d} style={{ display: 'flex', alignItems: 'center', fontSize: '12px', color: '#0f172a', background: filterDepartments.includes(d) ? '#dbeafe' : '#ffffff', padding: '6px 10px', borderRadius: '6px', cursor: 'pointer', border: filterDepartments.includes(d) ? '2px solid #3b82f6' : '1px solid #cbd5e1', fontWeight: '600' }}>
                                                        <input type="checkbox" checked={filterDepartments.includes(d)} onChange={() => toggleFilterDepartment(d)} style={{ display: 'none' }} />
                                                        {d}
                                                    </label>
                                                ))}
                                                {filterDepartments.length > 0 && (
                                                    <button type="button" onClick={() => setFilterDepartments([])} style={{ fontSize: '12px', background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontWeight: 'bold', marginLeft: '5px' }}>Clear Depts</button>
                                                )}
                                            </div>

                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '15px' }}>
                                                <select value={filterGrade} onChange={e => setFilterGrade(e.target.value)} style={styles.filterSelect}>
                                                    <option value="All">All Grades</option>
                                                    <option value="1">Grade 1</option><option value="2">Grade 2</option><option value="3">Grade 3</option>
                                                </select>
                                                <select value={filterMadhab} onChange={e => setFilterMadhab(e.target.value)} style={styles.filterSelect}>
                                                    <option value="All">All Madhabs</option>
                                                    {MADHABS.map(m => <option key={m} value={m}>{m}</option>)}
                                                </select>
                                                <select value={filterUrdu} onChange={e => setFilterUrdu(e.target.value)} style={styles.filterSelect}>
                                                    <option value="All">All Languages</option>
                                                    <option value="Urdu">Urdu (U)</option><option value="Non-Urdu">Non-Urdu</option>
                                                </select>
                                            </div>

                                            {/* Directory List */}
                                            <div style={{ maxHeight: '300px', overflowY: 'auto', background: '#fff', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '10px' }}>
                                                <label style={{ display: 'block', padding: '10px', borderBottom: '2px solid #e2e8f0', cursor: 'pointer', fontWeight: 'bold', color: '#2563eb' }}>
                                                    <input type="checkbox" onChange={() => toggleSelectAllFiltered(filteredPickerStudents)} checked={filteredPickerStudents.length > 0 && filteredPickerStudents.every(s => tempSelectedStudents.includes(s.regNo))} style={{ marginRight: '10px', accentColor: '#2563eb' }} />
                                                    Select/Deselect All in Current View ({filteredPickerStudents.length} Students)
                                                </label>
                                                {filteredPickerStudents.map(student => (
                                                    <label key={student.regNo} style={{ display: 'block', padding: '10px', borderBottom: '1px solid #f1f5f9', cursor: 'pointer', fontSize: '14px', color: '#334155' }}>
                                                        <input type="checkbox" checked={tempSelectedStudents.includes(student.regNo)} onChange={() => toggleStudentInSubject(student.regNo)} style={{ marginRight: '10px', accentColor: '#2563eb' }} />
                                                        <strong>{student.adNo}</strong> - {student.firstName}
                                                        <span style={{ fontSize: '11px', color: '#0369a1', background: '#e0f2fe', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold', marginLeft: '8px' }}>{student.department || 'GENERAL'}</span>
                                                        <span style={{ fontSize: '11px', color: '#7e22ce', background: '#f3e8ff', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold', marginLeft: '6px' }}>{student.madhab || 'General'}</span>
                                                        {isUrduStudent(student.adNo) && <span style={{ fontSize: '11px', color: '#b45309', background: '#fef3c7', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold', marginLeft: '6px' }}>URDU</span>}
                                                    </label>
                                                ))}
                                            </div>

                                            <div style={{ marginTop: '15px', textAlign: 'right' }}>
                                                <button type="button" onClick={saveStudentAssignments} style={{ padding: '10px 20px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>
                                                    Save Enrollments
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    <button type="submit" disabled={isLoading} style={isEditing ? styles.buttonWarning : styles.buttonSuccess}>
                        {isLoading ? 'Processing...' : isEditing ? 'Update Teacher Profile' : 'Register Teacher'}
                    </button>
                </form>
                {statusMsg && <div style={{ marginTop: '20px', padding: '16px', background: statusMsg.includes('Error') ? '#fee2e2' : '#ecfdf5', border: `1px solid ${statusMsg.includes('Error') ? '#fecaca' : '#a7f3d0'}`, borderRadius: '8px', color: statusMsg.includes('Error') ? '#991b1b' : '#065f46', fontWeight: '600' }}>{statusMsg}</div>}
            </div>

            <div style={styles.card}>
                <h3 style={styles.sectionTitle}>Teachers Directory</h3>
                <div style={{ width: '100%', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '15px' }}>
                        <thead>
                            <tr style={{ background: '#f8fafc', borderBottom: '2px solid #cbd5e1' }}>
                                <th style={{ padding: '16px', color: '#334155' }}>Name & Username</th>
                                <th style={{ padding: '16px', color: '#334155' }}>Assigned Subject Groups</th>
                                <th style={{ padding: '16px', color: '#334155' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {registeredTeachers.map((teacher, index) => (
                                <tr key={index} style={{ borderBottom: '1px solid #e2e8f0' }}>
                                    <td style={{ padding: '16px' }}><strong style={{ color: '#0f172a' }}>{teacher.fullName}</strong><br /><span style={{ color: '#64748b', fontSize: '13px' }}>@{teacher.username}</span></td>
                                    <td style={{ padding: '16px' }}>
                                        {teacher.enrollments?.map((e, i) => (
                                            <div key={i} style={{ display: 'inline-block', background: '#f1f5f9', color: '#0f172a', padding: '6px 10px', borderRadius: '6px', margin: '4px', fontSize: '13px', border: '1px solid #e2e8f0' }}>
                                                <strong>{e.alias || `Grade ${e.grade} ${e.subject}`}</strong>
                                                <sub style={{ color: '#64748b', marginLeft: '4px', fontWeight: 'bold' }}>{e.langTag || 'Gen'}</sub>
                                                <span style={{ color: '#2563eb', marginLeft: '6px' }}>({e.studentIds?.length || 0})</span>
                                            </div>
                                        ))}
                                    </td>
                                    <td style={{ padding: '16px' }}>
                                        <button onClick={() => handleEditClick(teacher)} style={{ padding: '8px 16px', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', marginRight: '8px', fontWeight: '600' }}>Edit</button>
                                        <button onClick={() => handleDeleteClick(teacher.username)} style={{ padding: '8px 16px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600' }}>Delete</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

        </div>
    );
}

// ==========================================
// COMPONENT 2: STUDENT MANAGEMENT TAB
// ==========================================
function StudentManager() {
    const [rollNo, setRollNo] = useState('');
    const [regNo, setRegNo] = useState('');
    const [adNo, setAdNo] = useState('');
    const [firstName, setFirstName] = useState('');
    const [department, setDepartment] = useState(DEPARTMENTS[0]);
    const [madhab, setMadhab] = useState('Hanafi');
    const [selectedClasses, setSelectedClasses] = useState([]);
    const [availableStudentClasses, setAvailableStudentClasses] = useState(DEFAULT_CLASSES);
    const [customClassInput, setCustomClassInput] = useState('');
    const [showStudentPassword, setShowStudentPassword] = useState(false);
    const [registeredStudents, setRegisteredStudents] = useState([]);
    const [selectedRows, setSelectedRows] = useState([]);
    const [bulkDept, setBulkDept] = useState('');
    const [bulkMadhab, setBulkMadhab] = useState('');
    const [bulkAddClass, setBulkAddClass] = useState('');

    const [filterLevel, setFilterLevel] = useState('All');
    const [filterClass, setFilterClass] = useState('All');
    const [filterDepartments, setFilterDepartments] = useState([]);
    const [filterMadhab, setFilterMadhab] = useState('All');
    const [filterLanguage, setFilterLanguage] = useState('All');

    const [isEditing, setIsEditing] = useState(false);
    const [statusMsg, setStatusMsg] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const fetchStudents = async () => {
        try {
            const querySnapshot = await getDocs(collection(db, 'students'));
            const studentsData = [];
            querySnapshot.forEach((doc) => studentsData.push(doc.data()));
            studentsData.sort((a, b) => (Number(a.rollNo) || 999) - (Number(b.rollNo) || 999));
            setRegisteredStudents(studentsData);
        } catch (err) { console.error(err); }
    };

    useEffect(() => { fetchStudents(); }, []);

    const handleDownloadTemplate = () => {
        const csvContent = "data:text/csv;charset=utf-8,rollNo,regNo,adNo,firstName,classes,department,madhab\n1,726007,U1278,ABBU SHAHMA,\"QH1, Mixed_Urdu\",QURAN,Shafi\n2,726031,3668,Abdullah Fayiz M,QH1,HADITH,Hanafi";
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", "student_upload_template.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
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
        if (selectedClasses.length === 0) return alert('Please select at least one class or group.');
        setIsLoading(true); setStatusMsg(isEditing ? 'Updating student profile...' : 'Registering student securely...');
        const safeRegNo = regNo.toLowerCase().replace(/[^a-z0-9_.-]/g, '');
        const safeAdNo = adNo.trim();
        const safeRollNo = Number(rollNo);
        const fakeEmail = `${safeRegNo}@student.school.com`;
        const firebasePassword = safeAdNo.length < 6 ? safeAdNo.padStart(6, '0') : safeAdNo;
        try {
            if (!isEditing) await createUserWithEmailAndPassword(auth, fakeEmail, firebasePassword);
            await setDoc(doc(db, 'students', safeRegNo), { rollNo: safeRollNo, regNo: safeRegNo, adNo: safeAdNo, firstName, department: department.toUpperCase(), madhab: madhab, classes: selectedClasses }, { merge: true });
            setIsLoading(false); setStatusMsg(isEditing ? 'Student updated successfully!' : 'Student registered successfully!');
            fetchStudents(); resetForm();
        } catch (err) { setIsLoading(false); setStatusMsg('Error: ' + err.message); }
    };

    const handleBulkUpdate = async () => {
        if (selectedRows.length === 0) return;
        if (!bulkDept && !bulkMadhab && !bulkAddClass) return alert('Select update option.');
        if (!window.confirm(`Apply changes to ${selectedRows.length} students?`)) return;
        setIsLoading(true); setStatusMsg(`Updating ${selectedRows.length} students...`);
        try {
            const promises = selectedRows.map(regNo => {
                const updateData = {};
                if (bulkDept) updateData.department = bulkDept;
                if (bulkMadhab) updateData.madhab = bulkMadhab;
                if (bulkAddClass) updateData.classes = arrayUnion(bulkAddClass.trim());
                return setDoc(doc(db, 'students', regNo), updateData, { merge: true });
            });
            await Promise.all(promises);
            setIsLoading(false); setStatusMsg(`Successfully updated!`);
            setSelectedRows([]); setBulkDept(''); setBulkMadhab(''); setBulkAddClass('');
            if (bulkAddClass && !availableStudentClasses.includes(bulkAddClass.trim())) setAvailableStudentClasses([...availableStudentClasses, bulkAddClass.trim()]);
            fetchStudents();
        } catch (err) { setIsLoading(false); setStatusMsg('Error: ' + err.message); }
    };

    const handleCSVUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (event) => {
            const text = event.target.result;
            const lines = text.split('\n');
            let studentsArray = [];
            for (let i = 1; i < lines.length; i++) {
                let line = lines[i].trim();
                if (!line) continue;
                let cols = parseCSVLine(line);
                if (cols.length >= 5) {
                    studentsArray.push({
                        rollNo: Number(cols[0].trim()),
                        regNo: cols[1].toLowerCase().replace(/[^a-z0-9_.-]/g, ''),
                        adNo: cols[2].trim(),
                        firstName: cols[3].trim(),
                        classes: cols[4].split(',').map(c => c.trim()).filter(Boolean),
                        department: cols[5] ? cols[5].trim().toUpperCase() : 'GENERAL',
                        madhab: cols[6] ? cols[6].trim() : 'Hanafi'
                    });
                }
            }
            if (studentsArray.length === 0) return alert('No valid rows found in CSV. Please ensure the template format is used.');
            setIsLoading(true);
            setStatusMsg(`Registering ${studentsArray.length} students with rate-limiting...`);
            try {
                const primaryApp = getApp();
                let secondaryApp;
                try { secondaryApp = getApp("SecondaryApp"); } catch (err) { secondaryApp = initializeApp(primaryApp.options, "SecondaryApp"); }
                const secondaryAuth = getAuth(secondaryApp);

                for (let i = 0; i < studentsArray.length; i++) {
                    const s = studentsArray[i];
                    const fakeEmail = `${s.regNo}@student.school.com`;
                    const firebasePassword = s.adNo.length < 6 ? s.adNo.padStart(6, '0') : s.adNo;

                    setStatusMsg(`Registering student ${i + 1} of ${studentsArray.length}...`);
                    await delay(2000);

                    try {
                        await createUserWithEmailAndPassword(secondaryAuth, fakeEmail, firebasePassword);
                    } catch (authErr) {
                        if (authErr.code === 'auth/too-many-requests') throw new Error("Firebase temporary spam lock. Please wait 5 minutes before continuing.");
                        if (authErr.code !== 'auth/email-already-in-use') throw authErr;
                    }

                    await setDoc(doc(db, 'students', s.regNo), {
                        rollNo: s.rollNo, regNo: s.regNo, adNo: s.adNo, firstName: s.firstName,
                        department: s.department, madhab: s.madhab, classes: s.classes
                    }, { merge: true });
                }

                await signOut(secondaryAuth);
                setIsLoading(false); setStatusMsg(`Successfully registered ${studentsArray.length} students!`);
                fetchStudents();
            } catch (err) { setIsLoading(false); setStatusMsg('Error: ' + err.message); }
        };
        reader.readAsText(file);
    };

    const handleEditClick = (student) => {
        setIsEditing(true); setRollNo(student.rollNo || ''); setRegNo(student.regNo); setAdNo(student.adNo); setFirstName(student.firstName); setDepartment(student.department || DEPARTMENTS[0]); setMadhab(student.madhab || 'Hanafi');
        const stuClasses = student.classes || (student.className ? [student.className] : []);
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

    const resetForm = () => { setIsEditing(false); setRollNo(''); setRegNo(''); setAdNo(''); setFirstName(''); setDepartment(DEPARTMENTS[0]); setMadhab('Hanafi'); setSelectedClasses([]); setStatusMsg(''); };

    const getStudentLevels = (student) => {
        const classes = student.classes || (student.className ? [student.className] : []);
        const levels = new Set();
        classes.forEach(c => { const match = c.match(/\d+/); if (match) levels.add(match[0]); });
        return Array.from(levels);
    };

    const isUrduStudent = (adNo) => (adNo || '').toUpperCase().includes('U');

    const toggleFilterDirectoryDept = (dept) => {
        if (filterDepartments.includes(dept)) setFilterDepartments(filterDepartments.filter(d => d !== dept));
        else setFilterDepartments([...filterDepartments, dept]);
    };

    const filteredStudents = registeredStudents.filter((student) => {
        if (filterLevel !== 'All' && !getStudentLevels(student).includes(filterLevel)) return false;
        if (filterClass !== 'All' && !(student.classes || [student.className]).includes(filterClass)) return false;
        if (filterDepartments.length > 0 && !filterDepartments.includes((student.department || '').toUpperCase())) return false;
        if (filterMadhab !== 'All' && (student.madhab || 'General') !== filterMadhab) return false;
        if (filterLanguage === 'Urdu' && !isUrduStudent(student.adNo)) return false;
        if (filterLanguage === 'Non-Urdu' && isUrduStudent(student.adNo)) return false;
        return true;
    });

    const toggleRowSelect = (regNo) => {
        if (selectedRows.includes(regNo)) setSelectedRows(selectedRows.filter(id => id !== regNo));
        else setSelectedRows([...selectedRows, regNo]);
    };

    const toggleSelectAll = (filteredArray) => {
        if (selectedRows.length === filteredArray.length) setSelectedRows([]);
        else setSelectedRows(filteredArray.map(s => s.regNo));
    };

    return (
        <div>
            {/* 1. MASS UPLOAD CARD */}
            <div style={styles.card}>
                <h3 style={styles.sectionTitle}>Mass Upload Students</h3>
                <p style={{ fontSize: '14px', color: '#64748b', marginBottom: '20px' }}>Upload CSV columns: <strong>rollNo, regNo, adNo, firstName, classes, department, madhab</strong>.</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '15px' }}>
                    <button onClick={handleDownloadTemplate} style={{ padding: '12px 20px', background: '#f8fafc', color: '#334155', border: '1px solid #cbd5e1', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '14px' }}>📥 Download CSV Template</button>
                    <label style={{ display: 'inline-flex', alignItems: 'center', padding: '12px 20px', background: '#0284c7', color: '#ffffff', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '14px' }}>📂 Upload Completed CSV <input type="file" accept=".csv" onChange={handleCSVUpload} style={{ display: 'none' }} /></label>
                </div>
            </div>

            {/* 2. REGISTER / EDIT STUDENT FORM CARD */}
            <div style={{ ...styles.card, borderLeft: isEditing ? '6px solid #f59e0b' : '1px solid #f1f5f9' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
                    <h3 style={styles.sectionTitle}>{isEditing ? `Editing Student: ${regNo}` : 'Register Student'}</h3>
                    {isEditing && <button type="button" onClick={resetForm} style={{ padding: '8px 16px', background: '#e2e8f0', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Cancel</button>}
                </div>

                <form onSubmit={handleAddOrUpdateStudent} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    {/* Responsive form grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
                        <div>
                            <label style={styles.label}>Sn (Roll No)</label>
                            <input type="number" value={rollNo} onChange={(e) => setRollNo(e.target.value)} required style={styles.input} />
                        </div>
                        <div>
                            <label style={styles.label}>First Name</label>
                            <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} required style={styles.input} />
                        </div>
                        <div>
                            <label style={styles.label}>Department</label>
                            <select value={department} onChange={(e) => setDepartment(e.target.value)} style={{ ...styles.input, cursor: 'pointer' }}>
                                {DEPARTMENTS.map(dept => <option key={dept} value={dept}>{dept}</option>)}
                            </select>
                        </div>
                        <div>
                            <label style={styles.label}>Madhab</label>
                            <select value={madhab} onChange={(e) => setMadhab(e.target.value)} style={{ ...styles.input, cursor: 'pointer' }}>
                                {MADHABS.map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '24px' }}>
                        <div>
                            <label style={styles.label}>Reg.no (Username)</label>
                            <input type="text" value={regNo} onChange={(e) => setRegNo(e.target.value)} disabled={isEditing} required style={{ ...styles.input, backgroundColor: isEditing ? '#f1f5f9' : '#ffffff', color: isEditing ? '#94a3b8' : '#0f172a' }} />
                        </div>
                        <div>
                            <label style={styles.label}>
                                Ad.No {isEditing ? '' : '(Password)'}
                                {isUrduStudent(adNo) && <span style={{ marginLeft: '8px', color: '#d97706', fontSize: '12px' }}>★ Urdu Student Detected</span>}
                            </label>
                            <div style={{ display: 'flex', position: 'relative' }}>
                                <input type={showStudentPassword || isEditing ? "text" : "password"} value={adNo} onChange={(e) => setAdNo(e.target.value)} required style={styles.input} />
                                {!isEditing && <button type="button" onClick={() => setShowStudentPassword(!showStudentPassword)} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#2563eb', fontWeight: '600', cursor: 'pointer' }}>{showStudentPassword ? "Hide" : "Show"}</button>}
                            </div>
                        </div>
                    </div>

                    <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', boxSizing: 'border-box' }}>
                        <h4 style={{ margin: '0 0 16px 0', fontSize: '16px', color: '#1e293b' }}>Assign to Classes / Groups</h4>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '12px', background: '#ffffff', padding: '16px', border: '1px solid #cbd5e1', borderRadius: '8px', marginBottom: '16px' }}>
                            {availableStudentClasses.map(cls => (
                                <label key={cls} style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '14px', color: '#334155' }}>
                                    <input type="checkbox" checked={selectedClasses.includes(cls)} onChange={() => toggleStudentClass(cls)} style={{ marginRight: '8px', accentColor: '#2563eb', width: '16px', height: '16px' }} /> {cls}
                                </label>
                            ))}
                        </div>
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                            <input type="text" value={customClassInput} onChange={(e) => setCustomClassInput(e.target.value)} placeholder="Or custom group (e.g. Mixed_Urdu)..." style={{ ...styles.input, flex: '1 1 200px' }} />
                            <button type="button" onClick={handleAddCustomClass} style={{ padding: '8px 14px', background: '#cbd5e1', color: '#334155', border: 'none', borderRadius: '6px', fontWeight: '600', cursor: 'pointer' }}>Add Custom Group</button>
                        </div>
                    </div>

                    <button type="submit" disabled={isLoading} style={isEditing ? styles.buttonWarning : styles.buttonSuccess}>
                        {isLoading ? 'Processing...' : isEditing ? 'Update Student Profile' : 'Register Student'}
                    </button>
                </form>
                {statusMsg && <div style={{ marginTop: '20px', padding: '16px', background: statusMsg.includes('Error') ? '#fee2e2' : '#ecfdf5', border: `1px solid ${statusMsg.includes('Error') ? '#fecaca' : '#a7f3d0'}`, borderRadius: '8px', color: statusMsg.includes('Error') ? '#991b1b' : '#065f46', fontWeight: '600' }}>{statusMsg}</div>}
            </div>

            {/* 3. STUDENTS DIRECTORY CARD WITH SCROLLABLE TABLE */}
            <div style={styles.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px', marginBottom: '20px' }}>
                    <div>
                        <h3 style={{ margin: '0 0 4px 0', fontSize: '18px', color: '#0f172a' }}>Students Directory (For Profile Edits)</h3>
                        <span style={{ fontSize: '13px', color: '#64748b' }}>Showing {filteredStudents.length} of {registeredStudents.length} total students</span>
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginRight: '10px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#334155' }}>Filter Depts:</span>
                            {DEPARTMENTS.map(d => (
                                <label key={d} style={{ display: 'flex', alignItems: 'center', fontSize: '12px', color: '#0f172a', background: filterDepartments.includes(d) ? '#dbeafe' : '#ffffff', padding: '6px 10px', borderRadius: '6px', cursor: 'pointer', border: filterDepartments.includes(d) ? '2px solid #3b82f6' : '1px solid #cbd5e1', fontWeight: '600' }}>
                                    <input type="checkbox" checked={filterDepartments.includes(d)} onChange={() => toggleFilterDirectoryDept(d)} style={{ display: 'none' }} />
                                    {d}
                                </label>
                            ))}
                            {filterDepartments.length > 0 && <button type="button" onClick={() => setFilterDepartments([])} style={{ fontSize: '12px', background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontWeight: 'bold' }}>Clear</button>}
                        </div>

                        <select value={filterLevel} onChange={(e) => setFilterLevel(e.target.value)} style={styles.filterSelect}>
                            <option value="All">All Levels</option><option value="1">Level 1</option><option value="2">Level 2</option><option value="3">Level 3</option>
                        </select>
                        <select value={filterClass} onChange={(e) => setFilterClass(e.target.value)} style={styles.filterSelect}>
                            <option value="All">All Classes</option>
                            {availableStudentClasses.map(cls => <option key={cls} value={cls}>{cls}</option>)}
                        </select>
                        <select value={filterMadhab} onChange={(e) => setFilterMadhab(e.target.value)} style={styles.filterSelect}>
                            <option value="All">All Madhabs</option>
                            {MADHABS.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                        <select value={filterLanguage} onChange={(e) => setFilterLanguage(e.target.value)} style={styles.filterSelect}>
                            <option value="All">All Languages</option><option value="Urdu">Urdu Only</option><option value="Non-Urdu">Non-Urdu</option>
                        </select>
                    </div>
                </div>

                {selectedRows.length > 0 && (
                    <div style={{ padding: '16px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '15px' }}>
                        <div><strong style={{ color: '#1e40af' }}>{selectedRows.length} students selected</strong></div>
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <select value={bulkDept} onChange={(e) => setBulkDept(e.target.value)} style={styles.filterSelect}><option value="">Set Dept -</option>{DEPARTMENTS.map(dept => <option key={dept} value={dept}>{dept}</option>)}</select>
                            <select value={bulkMadhab} onChange={(e) => setBulkMadhab(e.target.value)} style={styles.filterSelect}><option value="">Set Madhab -</option>{MADHABS.map(m => <option key={m} value={m}>{m}</option>)}</select>
                            <span style={{ color: '#94a3b8', margin: '0 5px' }}>|</span>
                            <input type="text" value={bulkAddClass} onChange={(e) => setBulkAddClass(e.target.value)} placeholder="Assign Group..." style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none', fontSize: '14px', width: '250px', maxWidth: '100%' }} />
                            <button onClick={handleBulkUpdate} style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>Apply</button>
                        </div>
                    </div>
                )}

                {/* Mobile-friendly scrollable wrapper for the directory table */}
                <div style={{ width: '100%', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '15px', minWidth: '750px' }}>
                        <thead>
                            <tr style={{ background: '#f8fafc', borderBottom: '2px solid #cbd5e1' }}>
                                <th style={{ padding: '16px', width: '40px' }}><input type="checkbox" checked={filteredStudents.length > 0 && selectedRows.length === filteredStudents.length} onChange={() => toggleSelectAll(filteredStudents)} style={{ accentColor: '#2563eb', width: '16px', height: '16px', cursor: 'pointer' }} /></th>
                                <th style={{ padding: '16px', color: '#334155' }}>Sn</th>
                                <th style={{ padding: '16px', color: '#334155' }}>Reg / Ad.No</th>
                                <th style={{ padding: '16px', color: '#334155' }}>Name</th>
                                <th style={{ padding: '16px', color: '#334155' }}>Profile</th>
                                <th style={{ padding: '16px', color: '#334155' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredStudents.map((student, index) => {
                                const isUrdu = isUrduStudent(student.adNo);
                                const levels = getStudentLevels(student);

                                return (
                                    <tr key={index} style={{ borderBottom: '1px solid #e2e8f0', background: selectedRows.includes(student.regNo) ? '#f0f9ff' : 'transparent' }}>
                                        <td style={{ padding: '16px' }}><input type="checkbox" checked={selectedRows.includes(student.regNo)} onChange={() => toggleRowSelect(student.regNo)} style={{ accentColor: '#2563eb', width: '16px', height: '16px', cursor: 'pointer' }} /></td>
                                        <td style={{ padding: '16px', fontWeight: '600', color: '#64748b' }}>{student.rollNo || '-'}</td>
                                        <td style={{ padding: '16px', fontWeight: '600', color: '#0f172a' }}>{student.regNo}<br /><span style={{ fontSize: '12px', color: '#64748b' }}>Ad: {student.adNo}</span>{isUrdu && <span style={{ ...styles.badge, background: '#fef3c7', color: '#b45309', marginLeft: '6px' }}>URDU</span>}</td>
                                        <td style={{ padding: '16px', color: '#334155' }}>{student.firstName}</td>
                                        <td style={{ padding: '16px' }}>
                                            <span style={{ ...styles.badge, background: '#e0f2fe', color: '#0369a1', display: 'block', marginBottom: '4px', width: 'fit-content' }}>{student.department || 'GENERAL'}</span>
                                            <span style={{ ...styles.badge, background: '#f3e8ff', color: '#7e22ce', width: 'fit-content' }}>{student.madhab || 'Hanafi'}</span>
                                        </td>
                                        <td style={{ padding: '16px' }}>
                                            {(student.classes || [student.className]).map((c, i) => (
                                                <span key={i} style={{ display: 'inline-block', background: '#f1f5f9', color: '#0f172a', padding: '4px 8px', borderRadius: '6px', fontSize: '12px', fontWeight: 'bold', border: '1px solid #e2e8f0', margin: '2px' }}>{c}</span>
                                            ))}
                                            {levels.map((lvl, i) => (
                                                <span key={`lvl-${i}`} style={{ display: 'inline-block', background: '#ecfdf5', color: '#047857', padding: '4px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 'bold', border: '1px solid #a7f3d0', margin: '2px' }}>Level {lvl}</span>
                                            ))}
                                        </td>
                                        <td style={{ padding: '16px' }}>
                                            <button onClick={() => handleEditClick(student)} style={{ padding: '8px 16px', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', marginRight: '8px', fontWeight: '600' }}>Edit</button>
                                            <button onClick={() => handleDeleteClick(student.regNo)} style={{ padding: '8px 16px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600' }}>Delete</button>
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

// ==========================================
// COMPONENT 3: NEW REPORT & EXPORT MANAGER
// ==========================================
// ==========================================
// COMPONENT 3: REPORT & AI ASSISTANT MANAGER
// ==========================================
// ==========================================
// COMPONENT 3: REPORT & AI ASSISTANT MANAGER (AUTO-SYNC)
// ==========================================
function ReportManager() {
    const [registeredStudents, setRegisteredStudents] = useState([]);
    const [overallMarksCache, setOverallMarksCache] = useState({});
    const [filteredResults, setFilteredResults] = useState([]);

    const [isLoading, setIsLoading] = useState(false);
    const [isBackgroundSyncing, setIsBackgroundSyncing] = useState(false);
    const [statusMsg, setStatusMsg] = useState('');

    // Filter States
    const [thresholdScore, setThresholdScore] = useState(40);
    const [thresholdCondition, setThresholdCondition] = useState('Below');
    const [exportDepartment, setExportDepartment] = useState('All');
    const [exportClassFilter, setExportClassFilter] = useState('All');
    const [exportMetric, setExportMetric] = useState('STATUS');
    const [exportSubject, setExportSubject] = useState(DEFAULT_SUBJECTS[0]);

    // --- Add these new state variables with your other useState hooks ---
    const [inspectorClass, setInspectorClass] = useState(DEFAULT_CLASSES[0]);
    const [inspectorSubject, setInspectorSubject] = useState(DEFAULT_SUBJECTS[0]);
    const [subjectLevelMarks, setSubjectLevelMarks] = useState({});
    const [isInspecting, setIsInspecting] = useState(false);
    // AI Assistant States
    const [chatMessages, setChatMessages] = useState([
        {
            role: 'assistant',
            text: 'Hello! I can answer questions about students, departments, class enrollments, and marks. Ask me anything like: "List all students in HFC3 with no marks recorded" or "Which students in HADITH scored below 40%?"'
        }
    ]);
    const [chatInput, setChatInput] = useState('');
    const [isAiLoading, setIsAiLoading] = useState(false);

    // --- AUTOMATED STALE-WHILE-REVALIDATE LOADER ---
    const fetchReportData = async () => {
        try {
            // 1. Load student profiles from Firestore quickly
            const querySnapshot = await getDocs(collection(db, 'students'));
            const studentsData = [];
            querySnapshot.forEach((doc) => studentsData.push(doc.data()));
            studentsData.sort((a, b) => (Number(a.rollNo) || 999) - (Number(b.rollNo) || 999));
            setRegisteredStudents(studentsData);

            // 2. Load cached marks from Firestore instantly for zero-wait display
            const cacheDocRef = doc(db, 'systemCache', 'adminReportCache');
            const cacheSnap = await getDoc(cacheDocRef);

            if (cacheSnap.exists()) {
                setOverallMarksCache(cacheSnap.data().marksData || {});
                setIsLoading(false); // Page is interactive immediately!
            } else {
                setIsLoading(true); // Only show full loader if cache is completely empty
            }

            // 3. Automatically sync with Google Sheets quietly in the background
            backgroundSyncWithGoogleSheets();

        } catch (err) {
            console.error('Error fetching report data:', err);
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

                // Update Firestore cache silently
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

    // --- AI Chat Handler ---
    const handleSendMessage = async (e) => {
        e.preventDefault();
        const promptText = chatInput.trim();
        if (!promptText || isAiLoading) return;

        const updatedHistory = [...chatMessages, { role: 'user', text: promptText }];
        setChatMessages(updatedHistory);
        setChatInput('');
        setIsAiLoading(true);

        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: promptText })
            });

            const data = await res.json();

            if (res.ok && data && data.reply) {
                setChatMessages([...updatedHistory, { role: 'assistant', text: data.reply }]);
            } else {
                const errorDetail = data?.error || data?.message || 'Failed to retrieve response.';
                setChatMessages([
                    ...updatedHistory,
                    { role: 'assistant', text: `⚠️ Error: ${errorDetail}` }
                ]);
            }
        } catch (err) {
            setChatMessages([
                ...updatedHistory,
                { role: 'assistant', text: '⚠️ Network or parsing error communicating with the AI service.' }
            ]);
        } finally {
            setIsAiLoading(false);
        }
    };

    // --- Manual Filter Handler ---
    const generateFilteredList = () => {
        const filtered = registeredStudents.filter((student) => {
            if (exportDepartment !== 'All' && (student.department || '').toUpperCase() !== exportDepartment.toUpperCase()) return false;
            if (exportClassFilter !== 'All' && !(student.classes || []).includes(exportClassFilter)) return false;

            const marksInfo = overallMarksCache[student.regNo];
            if (!marksInfo) return false;

            let scoreToCompareStr = '';
            if (exportMetric === 'STATUS') scoreToCompareStr = marksInfo.overall?.['STATUS'];
            else if (exportMetric === '1400') scoreToCompareStr = marksInfo.overall?.['1400'];
            else if (exportMetric === '420') scoreToCompareStr = marksInfo.overall?.['420'];
            else if (exportMetric === 'SUBJECT') scoreToCompareStr = marksInfo.subjects?.[exportSubject.toUpperCase()];

            if (!scoreToCompareStr || scoreToCompareStr === '-' || scoreToCompareStr === '') return false;

            const score = parseFloat(String(scoreToCompareStr).replace('%', ''));
            if (isNaN(score)) return false;

            if (thresholdCondition === 'Below' && score >= Number(thresholdScore)) return false;
            if (thresholdCondition === 'Above' && score < Number(thresholdScore)) return false;

            return true;
        });

        const mappedResults = filtered.map((s) => {
            let printedMetric = 'N/A';
            const info = overallMarksCache[s.regNo];
            if (info) {
                if (exportMetric === 'STATUS') printedMetric = info.overall?.['STATUS'];
                else if (exportMetric === '1400') printedMetric = info.overall?.['1400'];
                else if (exportMetric === '420') printedMetric = info.overall?.['420'];
                else if (exportMetric === 'SUBJECT') printedMetric = info.subjects?.[exportSubject.toUpperCase()];
            }
            return { ...s, displayMetric: printedMetric };
        });

        setFilteredResults(mappedResults);
        if (mappedResults.length === 0) setStatusMsg(`No students match the criteria (${thresholdCondition} ${thresholdScore}).`);
        else setStatusMsg(`Found ${mappedResults.length} students matching your filters.`);
    };

    // --- Add this fetch function before your component's return statement ---
    const [inspectorTeacherName, setInspectorTeacherName] = useState('');

  const fetchClassSubjectMarks = async () => {
    setIsInspecting(true);
    try {
      // 1. Fetch all students belonging to the selected class group
      const studentSnap = await getDocs(collection(db, 'students'));
      const matchedStudents = [];
      studentSnap.forEach(docSnap => {
        const data = docSnap.data();
        const studentObj = { id: docSnap.id, ...data };
        if ((studentObj.classes || []).includes(inspectorClass)) {
          matchedStudents.push(studentObj);
        }
      });
      matchedStudents.sort((a, b) => (Number(a.rollNo) || 999) - (Number(b.rollNo) || 999));

      // 2. Fetch all teachers and map students to their respective teachers for this subject
      const teacherSnap = await getDocs(collection(db, 'teachers'));
      const studentTeacherMap = {};

      teacherSnap.forEach(tDoc => {
        const tData = tDoc.data();
        const teacherName = tData.fullName || tDoc.id;
        
        if (tData.enrollments && Array.isArray(tData.enrollments)) {
          tData.enrollments.forEach(env => {
            const isMatchingSubject = (env.subject || '').toUpperCase() === inspectorSubject.toUpperCase();
            
            if (isMatchingSubject) {
              // Check if enrollment explicitly lists student IDs
              if (env.studentIds && Array.isArray(env.studentIds)) {
                env.studentIds.forEach(sRegNo => {
                  studentTeacherMap[sRegNo] = teacherName;
                });
              }

              // Check if enrollment targets the class group (e.g. alias or grade matches inspectorClass)
              const targetsClass = (env.alias || '').toLowerCase().includes(inspectorClass.toLowerCase()) || 
                                   String(env.grade || '').toLowerCase().includes(inspectorClass.toLowerCase());
              
              if (targetsClass) {
                matchedStudents.forEach(student => {
                  if (student.regNo) studentTeacherMap[student.regNo] = teacherName;
                  if (student.id) studentTeacherMap[student.id] = teacherName;
                  if (student.adNo) studentTeacherMap[student.adNo] = teacherName;
                });
              }
            }
          });
        }
      });

      // 3. Fetch marks and assign the resolved teacher name for each student
      const marksRecord = {};
      const teacherRecord = {};

      for (const student of matchedStudents) {
        let markSnap = null;
        const possibleKeys = [student.regNo, student.id, student.adNo, student.admissionNo].filter(Boolean);
        
        for (const key of possibleKeys) {
          markSnap = await getDoc(doc(db, 'marks', String(key)));
          if (markSnap.exists()) break;
        }

        if (markSnap && markSnap.exists()) {
          const studentMarksData = markSnap.data();
          const foundSubjectKey = Object.keys(studentMarksData).find(
            k => k.toUpperCase() === inspectorSubject.toUpperCase()
          );
          marksRecord[student.regNo || student.id] = foundSubjectKey ? studentMarksData[foundSubjectKey] : {};
        } else {
          marksRecord[student.regNo || student.id] = {};
        }

        // Resolve teacher name using regNo, id, or adNo
        teacherRecord[student.regNo || student.id] = 
          studentTeacherMap[student.regNo] || 
          studentTeacherMap[student.id] || 
          studentTeacherMap[student.adNo] || 
          'Unassigned';
      }

      setSubjectLevelMarks({ students: matchedStudents, records: marksRecord, teachers: teacherRecord });
    } catch (err) {
      console.error('Error fetching subject level marks:', err);
    } finally {
      setIsInspecting(false);
    }
  };

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

    return (
        <div>
            {/* 1. AI ASSISTANT CHAT PANEL */}
            <div style={styles.card}>
                <h3 style={styles.sectionTitle}>🤖 AI Database Query Assistant</h3>
                <p style={{ fontSize: '14px', color: '#64748b', marginBottom: '20px' }}>
                    Ask questions in natural language. Gemini will directly inspect your Firestore database and provide detailed insights.
                </p>

                <div style={{
                    maxHeight: '320px',
                    overflowY: 'auto',
                    background: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    borderRadius: '12px',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    marginBottom: '16px'
                }}>
                    {chatMessages.map((msg, index) => {
                        const isUser = msg.role === 'user';
                        return (
                            <div
                                key={index}
                                style={{
                                    alignSelf: isUser ? 'flex-end' : 'flex-start',
                                    maxWidth: '85%',
                                    background: isUser ? '#2563eb' : '#ffffff',
                                    color: isUser ? '#ffffff' : '#0f172a',
                                    padding: '12px 16px',
                                    borderRadius: isUser ? '14px 14px 2px 14px' : '14px 14px 14px 2px',
                                    boxShadow: '0 2px 4px rgba(0,0,0,0.04)',
                                    border: isUser ? 'none' : '1px solid #e2e8f0',
                                    fontSize: '14px',
                                    lineHeight: '1.5',
                                    whiteSpace: 'pre-wrap'
                                }}
                            >
                                {msg.text}
                            </div>
                        );
                    })}
                    {isAiLoading && (
                        <div style={{
                            alignSelf: 'flex-start',
                            background: '#ffffff',
                            color: '#64748b',
                            padding: '10px 14px',
                            borderRadius: '12px',
                            fontSize: '13px',
                            border: '1px solid #e2e8f0'
                        }}>
                            Analyzing database records...
                        </div>
                    )}
                </div>

                <form onSubmit={handleSendMessage} style={{ display: 'flex', gap: '12px' }}>
                    <input
                        type="text"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        placeholder="e.g. Which students in HFC3 have zero marks recorded?"
                        disabled={isAiLoading}
                        style={{ ...styles.input, flex: 1 }}
                    />
                    <button
                        type="submit"
                        disabled={isAiLoading || !chatInput.trim()}
                        style={{
                            ...styles.buttonPrimary,
                            opacity: isAiLoading || !chatInput.trim() ? 0.6 : 1,
                            whiteSpace: 'nowrap'
                        }}
                    >
                        {isAiLoading ? 'Searching...' : 'Ask AI'}
                    </button>
                </form>
            </div>

            {/* 2. MANUAL EXPORT CARD WITH AUTO-SYNC STATUS & FILTER CONTROLS */}
            <div style={styles.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '2px solid #f1f5f9', paddingBottom: '12px', flexWrap: 'wrap', gap: '15px' }}>
                    <div>
                        <h3 style={{ margin: 0, fontSize: '20px', color: '#0f172a', fontWeight: '700' }}>Manual Custom Reports & Export</h3>
                        <p style={{ margin: '4px 0 0 0', fontSize: '14px', color: '#64748b' }}>
                            {isBackgroundSyncing ? '🔄 Automatically syncing with Google Sheets...' : '✅ Data up to date with Google Sheets'}
                        </p>
                    </div>
                </div>

                {isLoading ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>Loading report cache...</div>
                ) : (
                    <>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '15px' }}>
                            <div>
                                <label style={styles.label}>Metric to Evaluate:</label>
                                <select value={exportMetric} onChange={(e) => setExportMetric(e.target.value)} style={{ ...styles.input, background: '#f8fafc' }}>
                                    <option value="STATUS">Overall Percentage (%)</option>
                                    <option value="1400">Total out of 1400</option>
                                    <option value="420">Total out of 420</option>
                                    <option value="SUBJECT">Specific Subject Score</option>
                                </select>
                            </div>

                            {exportMetric === 'SUBJECT' && (
                                <div>
                                    <label style={styles.label}>Select Subject:</label>
                                    <select value={exportSubject} onChange={(e) => setExportSubject(e.target.value)} style={styles.input}>
                                        {DEFAULT_SUBJECTS.map((sub) => <option key={sub} value={sub}>{sub}</option>)}
                                    </select>
                                </div>
                            )}

                            <div>
                                <label style={styles.label}>Threshold Rule:</label>
                                <div style={{ display: 'flex', gap: '10px' }}>
                                    <select value={thresholdCondition} onChange={(e) => setThresholdCondition(e.target.value)} style={{ ...styles.input, flex: 1 }}>
                                        <option value="Below">Below</option>
                                        <option value="Above">Above or Equal to</option>
                                    </select>
                                    <input type="number" value={thresholdScore} onChange={(e) => setThresholdScore(e.target.value)} placeholder="Score" style={{ ...styles.input, flex: 1 }} />
                                </div>
                            </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', alignItems: 'end', marginBottom: '24px' }}>
                            <div>
                                <label style={styles.label}>Target Department:</label>
                                <select value={exportDepartment} onChange={(e) => setExportDepartment(e.target.value)} style={styles.input}>
                                    <option value="All">All Departments</option>
                                    {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                                </select>
                            </div>
                            <div>
                                <label style={styles.label}>Target Class Group:</label>
                                <select value={exportClassFilter} onChange={(e) => setExportClassFilter(e.target.value)} style={styles.input}>
                                    <option value="All">All Classes</option>
                                    {DEFAULT_CLASSES.map((cls) => <option key={cls} value={cls}>{cls}</option>)}
                                </select>
                            </div>
                            <div>
                                <button onClick={generateFilteredList} style={{ ...styles.buttonPrimary, background: '#2563eb', width: '100%' }}>
                                    🔍 Generate Preview
                                </button>
                            </div>
                        </div>
                    </>
                )}

                {statusMsg && <div style={{ padding: '16px', background: '#e0f2fe', borderRadius: '8px', color: '#0369a1', fontWeight: '600', marginBottom: '20px' }}>{statusMsg}</div>}

                {/* 3. FILTER RESULTS PREVIEW TABLE (Appears directly beneath the controls) */}
                {filteredResults.length > 0 && (
                    <div style={{ border: '1px solid #cbd5e1', borderRadius: '12px', overflow: 'hidden', marginTop: '20px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '16px', borderBottom: '1px solid #cbd5e1', flexWrap: 'wrap', gap: '10px' }}>
                            <h4 style={{ margin: 0, color: '#0f172a' }}>Filter Results ({filteredResults.length} records)</h4>
                            <div style={{ display: 'flex', gap: '10px' }}>
                                <button onClick={handleCopyToClipboard} style={{ padding: '8px 16px', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>
                                    📋 Copy Table
                                </button>
                                <button onClick={handleDownloadExcel} style={{ padding: '8px 16px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>
                                    📊 Download CSV
                                </button>
                            </div>
                        </div>

                        <div style={{ overflowX: 'auto', maxHeight: '400px' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
                                <thead style={{ position: 'sticky', top: 0, background: '#ffffff', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                                    <tr>
                                        <th style={{ padding: '12px', color: '#334155' }}>Ad.No</th>
                                        <th style={{ padding: '12px', color: '#334155' }}>Name</th>
                                        <th style={{ padding: '12px', color: '#334155' }}>Department</th>
                                        <th style={{ padding: '12px', color: '#334155' }}>Class</th>
                                        <th style={{ padding: '12px', color: '#0f172a', fontWeight: '900' }}>Score</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredResults.map((student, idx) => (
                                        <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0', background: idx % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                                            <td style={{ padding: '12px', fontWeight: '600', color: '#0f172a' }}>{student.adNo}</td>
                                            <td style={{ padding: '12px', color: '#334155' }}>{student.firstName}</td>
                                            <td style={{ padding: '12px' }}>
                                                <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold' }}>
                                                    {student.department || 'GENERAL'}
                                                </span>
                                            </td>
                                            <td style={{ padding: '12px', color: '#64748b', fontWeight: '600' }}>{(student.classes || []).join(', ')}</td>
                                            <td style={{ padding: '12px', color: '#10b981', fontWeight: '900', fontSize: '16px' }}>{student.displayMetric}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>

            {/* 4. CLASS & SUBJECT LEVEL-BY-LEVEL MARK INSPECTOR CARD */}
            <div style={styles.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
                    <h3 style={styles.sectionTitle}>🔍 Class & Subject Level-by-Level Mark Inspector</h3>
                </div>
                <p style={{ fontSize: '14px', color: '#64748b', marginBottom: '20px' }}>
                    Select a class and subject to inspect student marks across all CCE assessment levels (Level 1 to Level 4).
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '20px' }}>
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
                    <div style={{ display: 'flex', alignItems: 'end' }}>
                        <button onClick={fetchClassSubjectMarks} style={{ ...styles.buttonPrimary, width: '100%', background: '#0284c7' }}>
                            {isInspecting ? 'Loading...' : 'Inspect Marks'}
                        </button>
                    </div>
                </div>

                {subjectLevelMarks.students && subjectLevelMarks.students.length > 0 && (
                    <div style={{ overflowX: 'auto', marginTop: '20px', border: '1px solid #cbd5e1', borderRadius: '12px', background: '#ffffff' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px', minWidth: '700px' }}>
                            <thead>
                                <tr style={{ background: '#f1f5f9', borderBottom: '2px solid #cbd5e1' }}>
                                    <th style={{ padding: '14px', color: '#0f172a', fontWeight: '700' }}>Roll</th>
                                    <th style={{ padding: '14px', color: '#0f172a', fontWeight: '700' }}>Ad.No</th>
                                    <th style={{ padding: '14px', color: '#0f172a', fontWeight: '700' }}>Student Name</th>
                                    <th style={{ padding: '14px', color: '#0f172a', fontWeight: '700', textAlign: 'center' }}>Level 1 (15)</th>
                                    <th style={{ padding: '14px', color: '#0f172a', fontWeight: '700', textAlign: 'center' }}>Level 2 (20)</th>
                                    <th style={{ padding: '14px', color: '#0f172a', fontWeight: '700', textAlign: 'center' }}>Level 3 (25)</th>
                                    <th style={{ padding: '14px', color: '#0f172a', fontWeight: '700', textAlign: 'center' }}>Level 4 (40)</th>
                                    <th style={{ padding: '14px', color: '#2563eb', fontWeight: '800', textAlign: 'center' }}>Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                {subjectLevelMarks.students.map((student, idx) => {
                                    const studentKey = student.regNo || student.id;
                                    const recs = subjectLevelMarks.records[studentKey] || {};

                                    // Get the specific teacher assigned to this student for this subject
                                    const studentTeacher = subjectLevelMarks.teachers?.[studentKey] || 'Unassigned';

                                    const l1 = Number(recs['15']) || 0;
                                    const l2 = Number(recs['20']) || 0;
                                    const l3 = Number(recs['25']) || 0;
                                    const l4 = Number(recs['40']) || 0;
                                    const total = l1 + l2 + l3 + l4;

                                    return (
                                        <tr key={studentKey} style={{ borderBottom: '1px solid #e2e8f0', background: idx % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                                            <td style={{ padding: '14px', fontWeight: '700', color: '#475569' }}>{student.rollNo || '-'}</td>
                                            <td style={{ padding: '14px', fontWeight: '700', color: '#0f172a' }}>{student.adNo}</td>
                                            <td style={{ padding: '14px' }}>
                                                <div style={{ color: '#0f172a', fontWeight: '600' }}>{student.firstName}</div>

                                                {/* Teacher's name styled like fading placeholder text without any prefix text */}
                                                <div style={{ fontSize: '12px', color: '#94a3b8', fontStyle: 'italic', fontWeight: '400', marginTop: '2px' }}>
                                                    {studentTeacher}
                                                </div>
                                            </td>
                                            <td style={{ padding: '14px', textAlign: 'center', color: '#334155', fontWeight: '500' }}>{recs['15'] !== undefined ? recs['15'] : '-'}</td>
                                            <td style={{ padding: '14px', textAlign: 'center', color: '#334155', fontWeight: '500' }}>{recs['20'] !== undefined ? recs['20'] : '-'}</td>
                                            <td style={{ padding: '14px', textAlign: 'center', color: '#334155', fontWeight: '500' }}>{recs['25'] !== undefined ? recs['25'] : '-'}</td>
                                            <td style={{ padding: '14px', textAlign: 'center', color: '#334155', fontWeight: '500' }}>{recs['40'] !== undefined ? recs['40'] : '-'}</td>
                                            <td style={{ padding: '14px', textAlign: 'center', fontWeight: '800', color: '#2563eb', fontSize: '15px' }}>{total > 0 ? total : '-'}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}

// ==========================================
// MAIN DASHBOARD COMPONENT (WRAPPER)
// ==========================================
export default function CentralAdminDashboard() {
    const [isAdminAuth, setIsAdminAuth] = useState(false);
    const [adminPassword, setAdminPassword] = useState('');
    const [showAdminPassword, setShowAdminPassword] = useState(false);
    const [activeTab, setActiveTab] = useState('reports');

    const handleAdminLogin = (e) => {
        e.preventDefault();
        if (adminPassword === 'admin123') setIsAdminAuth(true); else alert('Incorrect Admin Password');
    };

    if (!isAdminAuth) {
        return (
            <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f0f2f5', fontFamily: 'Inter, system-ui, sans-serif' }}>
                <div style={{ background: '#ffffff', padding: '48px', borderRadius: '16px', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', width: '100%', maxWidth: '420px', border: '1px solid #e2e8f0' }}>
                    <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                        <h2 style={{ color: '#0f172a', margin: '0 0 12px 0', fontSize: '28px', fontWeight: '800', letterSpacing: '-0.5px' }}>Admin Portal</h2>
                        <p style={{ color: '#64748b', fontSize: '15px', margin: 0 }}>Enter master password</p>
                    </div>
                    <form onSubmit={handleAdminLogin} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        <div style={{ display: 'flex', position: 'relative' }}>
                            <input type={showAdminPassword ? "text" : "password"} value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} required style={styles.input} />
                            <button type="button" onClick={() => setShowAdminPassword(!showAdminPassword)} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#2563eb', fontWeight: '600', cursor: 'pointer', fontSize: '14px' }}>{showAdminPassword ? "Hide" : "Show"}</button>
                        </div>
                        <button type="submit" style={styles.buttonPrimary}>Access System</button>
                    </form>
                </div>
            </div>
        );
    }

    return (
        <div style={{ minHeight: '100vh', backgroundColor: '#f0f2f5', padding: '40px 20px', fontFamily: 'Inter, system-ui, sans-serif' }}>
            <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px', background: '#ffffff', padding: '24px 32px', borderRadius: '16px', boxShadow: '0 4px 6px rgba(0,0,0,0.02)', border: '1px solid #e2e8f0' }}>
                    <div style={{ display: 'flex', gap: '24px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <h1 style={{ margin: '0 24px 0 0', fontSize: '24px', color: '#0f172a', fontWeight: '800', borderRight: '2px solid #e2e8f0', paddingRight: '24px' }}>Dashboard</h1>
                        <button onClick={() => setActiveTab('teachers')} style={{ padding: '10px 20px', background: activeTab === 'teachers' ? '#2563eb' : 'transparent', color: activeTab === 'teachers' ? '#ffffff' : '#64748b', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '15px' }}>👨‍🏫 Manage Teachers</button>
                        <button onClick={() => setActiveTab('students')} style={{ padding: '10px 20px', background: activeTab === 'students' ? '#2563eb' : 'transparent', color: activeTab === 'students' ? '#ffffff' : '#64748b', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '15px' }}>👨‍🎓 Manage Students</button>
                        <button onClick={() => setActiveTab('reports')} style={{ padding: '10px 20px', background: activeTab === 'reports' ? '#2563eb' : 'transparent', color: activeTab === 'reports' ? '#ffffff' : '#64748b', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '15px' }}>📊 Reports & Export</button>
                    </div>
                    <button onClick={() => setIsAdminAuth(false)} style={{ padding: '10px 20px', background: '#fee2e2', color: '#ef4444', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '14px' }}>Logout</button>
                </div>

                {activeTab === 'teachers' && <TeacherManager />}
                {activeTab === 'students' && <StudentManager />}
                {activeTab === 'reports' && <ReportManager />}
            </div>
        </div>
    );
}