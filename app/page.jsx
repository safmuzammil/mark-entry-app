'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { auth, db } from '../lib/firebase';
// 🌟 THE FIX: All necessary Firebase Auth functions are now imported correctly here
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, getAuth, signOut, updatePassword, onAuthStateChanged } from 'firebase/auth';
import { doc, setDoc, getDoc, getDocs, collection, deleteDoc, arrayUnion } from 'firebase/firestore';
import { getApp, initializeApp } from 'firebase/app';
import * as XLSX from 'xlsx';
import InstallAppBanner from './components/InstallAppBanner';

const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbxN_z56f3Q5O3OjsKFagUSqromiH0xTKTfro0zqJZN4ZB-FJLM3jERMigPXiOkfw-4/exec';

const DEFAULT_SUBJECTS = ["Thafseer", "Hadith", "Fiqh", "U :FIQH", "Aqidah", "Balagha", "Logic", "English", "Adab", "Urdu", "Social Science", "Thamadun", "Specialization", "Hifz"];
const DEFAULT_CLASSES = ["QH1", "AL1", "FC1", "QH2", "AL2", "FC2", "QLA3", "HFC3"];
const GRADES = ["1", "2", "3"];
const DEPARTMENTS = ["QURAN", "LANGUAGE", "AQIDAH", "HADITH", "FIQH", "CIVIL"];
const MADHABS = ["Hanafi", "Shafi", "General"];

const CCE_LEVELS = {
  "Level 1": "15",
  "Level 2": "20",
  "Level 3": "25",
  "Level 4": "40"
};

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
    card: { background: '#ffffff', padding: '24px', borderRadius: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: '1px solid #f1f5f9', marginBottom: '24px', boxSizing: 'border-box' },
    input: { width: '100%', padding: '12px 16px', borderRadius: '8px', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', color: '#0f172a', fontSize: '15px', outline: 'none', boxSizing: 'border-box' },
    label: { display: 'block', fontSize: '14px', fontWeight: '600', color: '#334155', marginBottom: '8px' },
    buttonPrimary: { padding: '12px 24px', background: '#2563eb', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '15px' },
    buttonSuccess: { padding: '14px 24px', background: '#10b981', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '16px', width: '100%', marginTop: '10px' },
    buttonWarning: { padding: '14px 24px', background: '#f59e0b', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '16px', width: '100%', marginTop: '10px' },
    buttonDanger: { padding: '8px 14px', background: '#fee2e2', color: '#ef4444', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' },
    sectionTitle: { margin: '0 0 20px 0', fontSize: '20px', color: '#0f172a', fontWeight: '700', borderBottom: '2px solid #f1f5f9', paddingBottom: '12px' },
    badge: { display: 'inline-block', padding: '4px 8px', borderRadius: '6px', fontSize: '12px', fontWeight: '700' },
    filterSelect: { padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none', fontSize: '13px', backgroundColor: '#ffffff', color: '#0f172a', fontWeight: '600', cursor: 'pointer' }
};

// --- SMART MIXED-CLASS SORTER (MULTI-TIERED) ---
const sortStudentsByDepartment = (studentsList, classNameAlias) => {
    const classLower = String(classNameAlias || '').toLowerCase();
    let deptOrder = [];
    let classOrder = [];

    if (classLower.includes('qhf')) {
        deptOrder = ['QURAN', 'HADITH', 'FIQH'];
    } else if (classLower.includes('alc')) {
        deptOrder = ['AQIDAH', 'LANGUAGE', 'CIVIL'];
    } else if (classLower.includes('m10') || classLower.includes('u10')) {
        classOrder = ['qla3', 'hfc3'];
        deptOrder = ['QURAN', 'LANGUAGE', 'AQIDAH', 'HADITH', 'FIQH', 'CIVIL'];
    } else if (classLower.includes('fcl')) {
        deptOrder = ['FIQH', 'CIVIL', 'LANGUAGE'];
    } else if (classLower.includes('qha')) {
        deptOrder = ['QURAN', 'HADITH', 'AQIDAH'];
    } else if (classLower.includes('u8') || classLower.includes('u9')) {
        classOrder = ['qh', 'fc', 'al'];
        deptOrder = ['QURAN', 'HADITH', 'FIQH', 'CIVIL', 'AQIDAH', 'LANGUAGE'];
    }

    if (deptOrder.length === 0 && classOrder.length === 0) {
        return [...studentsList].sort((a, b) => (Number(a.rollNo) || 999) - (Number(b.rollNo) || 999));
    }

    return [...studentsList].sort((a, b) => {
        if (classOrder.length > 0) {
            const aClasses = (a.classes || [a.className] || []).map(c => String(c).toLowerCase());
            const bClasses = (b.classes || [b.className] || []).map(c => String(c).toLowerCase());
            let classIndexA = 999, classIndexB = 999;
            classOrder.forEach((prefix, i) => {
                if (classIndexA === 999 && aClasses.some(c => c.includes(prefix))) classIndexA = i;
                if (classIndexB === 999 && bClasses.some(c => c.includes(prefix))) classIndexB = i;
            });
            if (classIndexA !== classIndexB) return classIndexA - classIndexB;
        }

        if (deptOrder.length > 0) {
            const deptA = String(a.department || '').toUpperCase();
            const deptB = String(b.department || '').toUpperCase();
            let indexA = deptOrder.indexOf(deptA);
            let indexB = deptOrder.indexOf(deptB);
            if (indexA === -1) indexA = 999;
            if (indexB === -1) indexB = 999;
            if (indexA !== indexB) return indexA - indexB;
        }

        return (Number(a.rollNo) || 999) - (Number(b.rollNo) || 999);
    });
};

// ==========================================
// 1. TEACHER COMPONENTS
// ==========================================
function TeacherPasswordSettings() {
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [status, setStatus] = useState('');
    const [loading, setLoading] = useState(false);

    const handlePasswordChange = async (e) => {
        e.preventDefault();
        if (newPassword.length < 6) return setStatus('Password must be at least 6 characters.');
        if (newPassword !== confirmPassword) return setStatus('Passwords do not match.');
        setLoading(true);
        setStatus('');
        try {
            const user = auth.currentUser;
            if (!user) throw new Error("No active user session found. Please log in again.");
            await updatePassword(user, newPassword);
            setStatus('Password updated successfully!');
            setNewPassword(''); setConfirmPassword('');
        } catch (err) {
            if (err.code === 'auth/requires-recent-login') {
                setStatus('For security, please log out and log back in before changing your password.');
            } else {
                setStatus('Error: ' + err.message);
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ ...styles.card, maxWidth: '450px', margin: '0 auto' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', color: '#0f172a' }}>🔒 Change Your Password</h3>
            <p style={{ margin: '0 0 20px 0', fontSize: '14px', color: '#64748b' }}>Update your account password. You will use this new password the next time you log in.</p>
            <form onSubmit={handlePasswordChange} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                    <label style={styles.label}>New Password</label>
                    <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="At least 6 characters" required style={styles.input} />
                </div>
                <div>
                    <label style={styles.label}>Confirm New Password</label>
                    <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Re-type new password" required style={styles.input} />
                </div>
                <button type="submit" disabled={loading} style={styles.buttonPrimary}>{loading ? 'Updating...' : 'Update Password'}</button>
            </form>
            {status && (
                <div style={{ marginTop: '16px', padding: '12px', borderRadius: '8px', fontSize: '14px', fontWeight: '600', backgroundColor: status.includes('Error') || status.includes('must') || status.includes('not match') ? '#fee2e2' : '#d1fae5', color: status.includes('Error') || status.includes('must') || status.includes('not match') ? '#ef4444' : '#10b981' }}>
                    {status}
                </div>
            )}
        </div>
    );
}

function TeacherPortalView({ loggedInTeacher, onLogout }) {
    const [activeView, setActiveView] = useState('marks');
    const [selectedEnrollmentId, setSelectedEnrollmentId] = useState(loggedInTeacher?.enrollments?.[0]?.id || '');
    const [cceLevel, setCceLevel] = useState('Level 1');
    const assessmentMaxMark = CCE_LEVELS[cceLevel];
    
    const [allStudentsCache, setAllStudentsCache] = useState([]);
    const [classStudents, setClassStudents] = useState([]);
    const [studentMarks, setStudentMarks] = useState({});
    const [statusMsg, setStatusMsg] = useState('');

    useEffect(() => {
        async function fetchStudents() {
            const sSnap = await getDocs(collection(db, 'students'));
            const sData = [];
            sSnap.forEach((doc) => sData.push(doc.data()));
            setAllStudentsCache(sData);
        }
        fetchStudents();
    }, []);

    useEffect(() => {
        if (!selectedEnrollmentId || allStudentsCache.length === 0) return;
        const currentEnrollment = loggedInTeacher.enrollments.find(e => e.id === selectedEnrollmentId);
        if (!currentEnrollment) return;

        const matchedStudents = allStudentsCache.filter(student => 
          currentEnrollment.studentIds.includes(student.regNo)
        );
        
        const sortedStudents = sortStudentsByDepartment(matchedStudents, currentEnrollment.alias || `Grade ${currentEnrollment.grade} ${currentEnrollment.subject}`);
        setClassStudents(sortedStudents);
    }, [selectedEnrollmentId, allStudentsCache, loggedInTeacher]);

    useEffect(() => {
        if (!selectedEnrollmentId || classStudents.length === 0) return;
        const currentEnrollment = loggedInTeacher.enrollments.find(e => e.id === selectedEnrollmentId);
        if(!currentEnrollment) return;

        async function fetchExistingMarks() {
          try {
            let newMarks = {};
            for(let student of classStudents) {
               const docSnap = await getDoc(doc(db, 'marks', student.regNo));
               if(docSnap.exists()) {
                  const mData = docSnap.data();
                  if(mData[currentEnrollment.subject] && mData[currentEnrollment.subject][assessmentMaxMark] !== undefined) {
                     newMarks[student.regNo] = mData[currentEnrollment.subject][assessmentMaxMark];
                  }
               }
            }
            setStudentMarks(newMarks);
          } catch (err) { console.error("Error loading marks", err); }
        }
        fetchExistingMarks();
    }, [selectedEnrollmentId, assessmentMaxMark, classStudents, loggedInTeacher]);

    const handleMarkChange = (studentRegNo, value) => {
        if (value === '' || /^\d*(\.\d{0,2})?$/.test(value)) {
            const updatedMarks = { ...studentMarks, [studentRegNo]: value };
            setStudentMarks(updatedMarks);
            if (selectedEnrollmentId) {
                localStorage.setItem(`draft_marks_${selectedEnrollmentId}`, JSON.stringify(updatedMarks));
            }
        }
    };

    const handleKeyDown = (e, currentIndex) => {
        if (e.key === 'Enter' || e.key === 'ArrowDown') {
          e.preventDefault();
          const nextInput = document.querySelector(`input[data-index="${currentIndex + 1}"]`);
          if (nextInput) nextInput.focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          const prevInput = document.querySelector(`input[data-index="${currentIndex - 1}"]`);
          if (prevInput) prevInput.focus();
        }
    };

    useEffect(() => {
        if (selectedEnrollmentId) {
            const savedDraft = localStorage.getItem(`draft_marks_${selectedEnrollmentId}`);
            if (savedDraft) setStudentMarks(JSON.parse(savedDraft));
        }
    }, [selectedEnrollmentId]);

    const handleDownloadMarksTemplate = () => {
        if (classStudents.length === 0) return alert('No students found in this class to generate a template.');
        let csvContent = "data:text/csv;charset=utf-8,Ad.No,Student Name,Marks (Max " + assessmentMaxMark + ")\n";
        classStudents.forEach(student => { csvContent += `${student.adNo},"${student.firstName}",\n`; });
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        const currentEnrollment = loggedInTeacher.enrollments.find(e => e.id === selectedEnrollmentId);
        const safeTitle = (currentEnrollment?.alias || 'Class').replace(/[^a-zA-Z0-9]/g, '_');
        link.setAttribute("download", `${safeTitle}_${cceLevel.replace(' ', '')}_Marks.csv`);
        document.body.appendChild(link); link.click(); document.body.removeChild(link);
    };

    const handleUniversalUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        const fileExtension = file.name.split('.').pop().toLowerCase();

        const processSheetData = (sheetData) => {
          const newMarks = { ...studentMarks }; 
          let updatedCount = 0, errorCount = 0;
          const maxAllowed = Number(assessmentMaxMark);

          sheetData.forEach((row) => {
            const rawAdNo = String(row['Ad.No'] || row['AdNo'] || row['AdmissionNo'] || row['RegNo'] || '').trim();
            const keys = Object.keys(row);
            const marksStr = String(row['Marks'] || row['Mark'] || row['Score'] || row[keys[keys.length - 1]] || '').trim();
            
            if (rawAdNo && marksStr !== '') {
              const markVal = parseFloat(marksStr);
              const matchedStudent = classStudents.find(s => String(s.adNo).trim() === rawAdNo);
              if (matchedStudent) {
                if (!isNaN(markVal) && markVal <= maxAllowed && markVal >= 0) {
                  newMarks[matchedStudent.regNo] = marksStr;
                  updatedCount++;
                } else { errorCount++; }
              }
            }
          });
          setStudentMarks(newMarks);
          alert(`Imported marks for ${updatedCount} students (Skipped ${errorCount} invalid). Review table and click save.`);
        };

        if (fileExtension === 'csv' || fileExtension === 'txt') {
          reader.onload = (event) => {
            const workbook = XLSX.read(event.target.result, { type: 'string' });
            processSheetData(XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]));
          };
          reader.readAsText(file);
        } else {
          reader.onload = (event) => {
            const workbook = XLSX.read(new Uint8Array(event.target.result), { type: 'array' });
            processSheetData(XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]));
          };
          reader.readAsArrayBuffer(file);
        }
        e.target.value = null; 
    };

    const handleBulkSubmit = async (e) => {
        e.preventDefault();
        let marksPayload = [];
        const currentEnrollment = loggedInTeacher.enrollments.find(e => e.id === selectedEnrollmentId);
        const maxNumber = Number(assessmentMaxMark);

        let sheetReadySubject = currentEnrollment.subject.trim();
        if (sheetReadySubject.toUpperCase() === 'MANTIQ') sheetReadySubject = 'Logic';

        setStatusMsg('Syncing marks...');
        const firestorePromises = [];
        for (let student of classStudents) {
          let val = studentMarks[student.regNo];
          if (val !== undefined && val !== '') {
            if (parseFloat(val) > maxNumber) return alert(`Marks for ${student.firstName} exceed limit!`);
            marksPayload.push({ studentId: student.regNo, subject: sheetReadySubject, maxMarks: assessmentMaxMark, marksObtained: val });
            firestorePromises.push(setDoc(doc(db, 'marks', student.regNo), { [currentEnrollment.subject]: { [assessmentMaxMark]: Number(val) } }, { merge: true }));
          }
        }

        try {
          await Promise.all(firestorePromises);
          const res = await fetch(WEB_APP_URL, { method: 'POST', body: JSON.stringify({ marks: marksPayload }) });
          const result = await res.json();
          if (result.status === 'success') {
              setStatusMsg('Marks saved successfully!');
              localStorage.removeItem(`draft_marks_${selectedEnrollmentId}`);
          } else {
              setStatusMsg('Firebase updated, but Sheets backup error: ' + result.message);
          }
        } catch (err) { setStatusMsg('Network error: ' + err.message); }
    };

    const validMarks = classStudents.map(s => studentMarks[s.regNo]).filter(v => v !== undefined && v !== '').map(v => parseFloat(v)).filter(v => !isNaN(v));
    const highestScore = validMarks.length > 0 ? Math.max(...validMarks) : 0;
    const classAverage = validMarks.length > 0 ? (validMarks.reduce((a, b) => a + b, 0) / validMarks.length).toFixed(1) : 0;
    const passPercentage = validMarks.length > 0 ? ((validMarks.filter(m => m >= Number(assessmentMaxMark) * 0.4).length / validMarks.length) * 100).toFixed(0) : 0;
    const currentEnrollment = loggedInTeacher?.enrollments?.find(e => e.id === selectedEnrollmentId);

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', background: '#ffffff', padding: '16px 20px', borderRadius: '16px', border: '1px solid #e2e8f0', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h1 style={{ margin: '0 0 4px 0', fontSize: '22px', fontWeight: '800' }}>Teacher Portal</h1>
                <p style={{ margin: 0, color: '#64748b', fontSize: '14px' }}>Welcome, <strong>{loggedInTeacher?.fullName}</strong></p>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={() => setActiveView(activeView === 'marks' ? 'settings' : 'marks')} style={{ padding: '8px 14px', background: '#f8fafc', color: '#334155', border: '1px solid #cbd5e1', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }}>
                    {activeView === 'marks' ? '⚙️ Settings' : '⬅️ Back to Marks'}
                </button>
                <button onClick={onLogout} style={styles.buttonDanger}>Logout</button>
              </div>
            </div>

            {activeView === 'settings' ? <TeacherPasswordSettings /> : (
                <>
                    <div style={styles.card}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
                        <div>
                          <label style={styles.label}>Select Assigned Subject:</label>
                          <select value={selectedEnrollmentId} onChange={(e) => setSelectedEnrollmentId(e.target.value)} style={{ ...styles.input, cursor: 'pointer' }}>
                            {(loggedInTeacher?.enrollments || []).map(env => (
                              <option key={env.id} value={env.id}>{env.alias || `Grade ${env.grade} ${env.subject}`} ({env.langTag || 'Gen'})</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label style={styles.label}>Select Task Level:</label>
                          <select value={cceLevel} onChange={(e) => setCceLevel(e.target.value)} style={{ ...styles.input, cursor: 'pointer' }}>
                            {Object.keys(CCE_LEVELS).map(level => <option key={level} value={level}>{level} (Max {CCE_LEVELS[level]} Marks)</option>)}
                          </select>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '20px' }}>
                      <div style={{ background: '#ffffff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                        <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 'bold' }}>CLASS AVERAGE</span>
                        <div style={{ fontSize: '22px', fontWeight: '800', marginTop: '4px' }}>{classAverage} / {assessmentMaxMark}</div>
                      </div>
                      <div style={{ background: '#ffffff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                        <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 'bold' }}>HIGHEST SCORE</span>
                        <div style={{ fontSize: '22px', fontWeight: '800', color: '#10b981', marginTop: '4px' }}>{highestScore} / {assessmentMaxMark}</div>
                      </div>
                      <div style={{ background: '#ffffff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                        <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 'bold' }}>PASSING RATE</span>
                        <div style={{ fontSize: '22px', fontWeight: '800', color: '#2563eb', marginTop: '4px' }}>{passPercentage}%</div>
                      </div>
                    </div>

                    <form onSubmit={handleBulkSubmit} style={styles.card}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', borderBottom: '2px solid #f1f5f9', paddingBottom: '12px', marginBottom: '20px', gap: '12px' }}>
                        <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '700' }}>Enrolled Students ({classStudents.length})</h3>
                      </div>
                      
                      {classStudents.length === 0 ? (
                        <div style={{ padding: '30px', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '12px', textAlign: 'center', color: '#64748b', fontSize: '14px' }}>No students assigned to this subject.</div>
                      ) : (
                        <div style={{ width: '100%', overflowX: 'auto', marginBottom: '20px' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px', minWidth: '550px' }}>
                            <thead>
                              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #cbd5e1' }}>
                                <th style={{ padding: '12px', width: '60px' }}>Sn</th>
                                <th style={{ padding: '12px' }}>Ad.No</th>
                                <th style={{ padding: '12px' }}>Student Name</th>
                                <th style={{ padding: '12px' }}>Department</th>
                                <th style={{ padding: '12px' }}>Marks (Max: {assessmentMaxMark})</th>
                              </tr>
                            </thead>
                            <tbody>
                              {classStudents.map((student, index) => (
                                <tr key={student.regNo} style={{ borderBottom: '1px solid #e2e8f0' }}>
                                  <td style={{ padding: '12px', fontWeight: '600', color: '#64748b' }}>{student.rollNo || '-'}</td>
                                  <td style={{ padding: '12px', fontWeight: '600' }}>{student.adNo}</td>
                                  <td style={{ padding: '14px 12px', color: '#0f172a', fontWeight: '800', fontSize: '15px' }}>
                                    {student.firstName}
                                    <br /><span style={{ fontSize: '12px', color: '#475569', fontWeight: '500' }}>Reg: {student.regNo}</span>
                                  </td>
                                  <td style={{ padding: '12px', color: '#0369a1', fontSize: '12px', fontWeight: 'bold' }}>{student.department}</td>
                                  <td style={{ padding: '12px' }}>
                                    <input 
                                      type="number" max={assessmentMaxMark} min="0" step="any" data-index={index} 
                                      value={studentMarks[student.regNo] !== undefined ? studentMarks[student.regNo] : ''} 
                                      onChange={(e) => handleMarkChange(student.regNo, e.target.value)}
                                      onKeyDown={(e) => handleKeyDown(e, index)}
                                      placeholder={`/ ${assessmentMaxMark}`}
                                      style={{ padding: '8px 12px', width: '110px', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none', fontSize: '14px' }}
                                    />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      <button type="submit" disabled={classStudents.length === 0} style={styles.buttonSuccess}>Save / Update All Marks</button>
                    </form>
                    {statusMsg && <div style={{ padding: '14px', background: '#ecfdf5', borderRadius: '8px', color: '#065f46', fontWeight: '600', textAlign: 'center' }}>{statusMsg}</div>}
                </>
            )}
        </div>
    );
}

// ==========================================
// 2. ADMIN COMPONENTS
// ==========================================
function TeacherManager() {
    const [username, setUsername] = useState('');
    const [originalUsername, setOriginalUsername] = useState('');
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

    const handleEditClick = (teacher) => {
        setIsEditing(true);
        setUsername(teacher.username);
        setOriginalUsername(teacher.username);
        setFullName(teacher.fullName);
        setPassword('');
        setSubjectEnrollments(teacher.enrollments || []);
        setEditingEnrollmentId(null);
        setStatusMsg(`Editing profile for ${teacher.fullName}.`);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const resetForm = () => {
        setIsEditing(false);
        setUsername(''); setOriginalUsername(''); setFullName('');
        setPassword('123sms'); setSubjectEnrollments([]); setEditingEnrollmentId(null); setStatusMsg('');
    };

    const handleAddOrUpdateTeacher = async (e) => {
        e.preventDefault();
        setIsLoading(true);
        setStatusMsg(isEditing ? 'Updating teacher credentials...' : 'Registering teacher securely...');
        const safeUsername = username.toLowerCase().replace(/[^a-z0-9_.-]/g, '');
        const fakeEmail = `${safeUsername}@school.com`;

        const primaryApp = getApp();
        let secondaryApp;
        try { secondaryApp = getApp("SecondaryApp"); } 
        catch (err) { secondaryApp = initializeApp(primaryApp.options, "SecondaryApp"); }
        const secondaryAuth = getAuth(secondaryApp);

        try {
            if (!isEditing) {
                await createUserWithEmailAndPassword(secondaryAuth, fakeEmail, password);
                await setDoc(doc(db, 'teachers', safeUsername), { fullName, username: safeUsername, enrollments: subjectEnrollments }, { merge: true });
                setStatusMsg('Teacher successfully registered!');
            } else {
                const isUsernameChanged = safeUsername !== originalUsername;
                if (isUsernameChanged || (password && password.trim().length > 0)) {
                    const activePassword = password && password.trim().length >= 6 ? password.trim() : '123sms';
                    try { await createUserWithEmailAndPassword(secondaryAuth, fakeEmail, activePassword); } catch (authErr) { if (authErr.code !== 'auth/email-already-in-use') throw authErr; }
                }
                await setDoc(doc(db, 'teachers', safeUsername), { fullName, username: safeUsername, enrollments: subjectEnrollments }, { merge: true });
                if (isUsernameChanged && originalUsername) { await deleteDoc(doc(db, 'teachers', originalUsername)); }
                setStatusMsg(`Teacher updated successfully!`);
            }
            await signOut(secondaryAuth);
            setIsLoading(false);
            fetchTeachersAndStudents();
            resetForm();
        } catch (err) {
            setIsLoading(false);
            setStatusMsg('Error: ' + err.message);
        }
    };

    const handleDeleteClick = async (teacherUsername) => {
        if (window.confirm(`Delete ${teacherUsername}?`)) {
            try { await deleteDoc(doc(db, 'teachers', teacherUsername)); fetchTeachersAndStudents(); } catch (err) { alert("Failed to delete."); }
        }
    };

    const handleAddSubject = () => {
        const newId = Date.now().toString();
        setSubjectEnrollments([...subjectEnrollments, { id: newId, grade: newGrade, subject: newSubject, alias: `Grade ${newGrade} ${newSubject}`, langTag: 'Gen', studentIds: [] }]);
    };

    const handleRemoveSubject = (id) => {
        setSubjectEnrollments(subjectEnrollments.filter(e => e.id !== id));
        if (editingEnrollmentId === id) setEditingEnrollmentId(null);
    };

    const openStudentPicker = (enrollment) => {
        setEditingEnrollmentId(enrollment.id);
        setTempSelectedStudents([...enrollment.studentIds]);
        setFilterGrade(enrollment.grade || 'All');
        setGroupAlias(enrollment.alias || `Grade ${enrollment.grade} ${enrollment.subject}`);
        setGroupLangTag(enrollment.langTag || 'Gen');
    };

    const toggleStudentInSubject = (regNo) => {
        if (tempSelectedStudents.includes(regNo)) setTempSelectedStudents(tempSelectedStudents.filter(id => id !== regNo));
        else setTempSelectedStudents([...tempSelectedStudents, regNo]);
    };

    const toggleSelectAllFiltered = (filteredList) => {
        const allFilteredIds = filteredList.map(s => s.regNo);
        const areAllSelected = allFilteredIds.every(id => tempSelectedStudents.includes(id));
        if (areAllSelected) setTempSelectedStudents(tempSelectedStudents.filter(id => !allFilteredIds.includes(id)));
        else setTempSelectedStudents(Array.from(new Set([...tempSelectedStudents, ...allFilteredIds])));
    };

    const toggleFilterDepartment = (dept) => {
        if (filterDepartments.includes(dept)) setFilterDepartments(filterDepartments.filter(d => d !== dept));
        else setFilterDepartments([...filterDepartments, dept]);
    };

    const autoGenerateSmartName = () => {
        const currentEnrollment = subjectEnrollments.find(e => e.id === editingEnrollmentId);
        if (!currentEnrollment) return;
        const deptPrefix = filterDepartments.length > 0 ? filterDepartments.map(d => d[0]).join('') : 'ALL';
        const gradeString = filterGrade !== 'All' ? filterGrade : currentEnrollment.grade;
        setGroupAlias(`${deptPrefix}${gradeString} ${currentEnrollment.subject}`);
        setGroupLangTag(filterUrdu === 'All' ? 'Gen' : filterUrdu);
    };

    const saveStudentAssignments = () => {
        setSubjectEnrollments(subjectEnrollments.map(env => env.id === editingEnrollmentId ? { ...env, studentIds: tempSelectedStudents, alias: groupAlias, langTag: groupLangTag } : env));
        setEditingEnrollmentId(null);
    };

    const isUrduStudent = (adNo) => (adNo || '').toUpperCase().includes('U');

    const filteredPickerStudents = allStudents.filter(student => {
        const classes = student.classes || (student.className ? [student.className] : []);
        const levels = new Set();
        classes.forEach(c => { const m = c.match(/\d+/); if (m) levels.add(m[0]); });
        if (filterGrade !== 'All' && !levels.has(filterGrade)) return false;
        if (filterDepartments.length > 0 && !filterDepartments.includes((student.department || '').toUpperCase())) return false;
        if (filterMadhab !== 'All' && (student.madhab || 'General') !== filterMadhab) return false;
        if (filterUrdu === 'Urdu' && !isUrduStudent(student.adNo)) return false;
        if (filterUrdu === 'Non-Urdu' && isUrduStudent(student.adNo)) return false;
        return true;
    });

    return (
        <div>
            <div style={{ ...styles.card, borderLeft: isEditing ? '6px solid #f59e0b' : '1px solid #f1f5f9' }}>
                <h3 style={styles.sectionTitle}>{isEditing ? `Editing Teacher: ${originalUsername}` : 'Register Individual Teacher'}</h3>
                <form onSubmit={handleAddOrUpdateTeacher} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
                        <div>
                            <label style={styles.label}>Full Name</label>
                            <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Muzammil Hudawi" required style={styles.input} />
                        </div>
                        <div>
                            <label style={styles.label}>Username</label>
                            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. muzammil" required style={styles.input} />
                        </div>
                        <div>
                            <label style={styles.label}>Password</label>
                            <input type={showTeacherPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" required={!isEditing} style={styles.input} />
                        </div>
                    </div>

                    <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '12px' }}>
                        <h4 style={{ margin: '0 0 12px 0' }}>Assign Teaching Subjects</h4>
                        <div style={{ display: 'flex', gap: '15px', marginBottom: '15px', flexWrap: 'wrap' }}>
                            <select value={newGrade} onChange={(e) => setNewGrade(e.target.value)} style={{ ...styles.input, width: '130px' }}>
                                {GRADES.map(g => <option key={g} value={g}>Grade {g}</option>)}
                            </select>
                            <select value={newSubject} onChange={(e) => setNewSubject(e.target.value)} style={{ ...styles.input, flex: 1 }}>
                                {DEFAULT_SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                            <button type="button" onClick={handleAddSubject} style={styles.buttonPrimary}>+ Add Subject</button>
                        </div>

                        {subjectEnrollments.map(enroll => (
                            <div key={enroll.id} style={{ border: '1px solid #cbd5e1', borderRadius: '8px', marginBottom: '10px', background: '#fff' }}>
                                <div style={{ padding: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                                    <strong>{enroll.alias}</strong> ({enroll.studentIds?.length || 0} students)
                                    <div>
                                        <button type="button" onClick={() => openStudentPicker(enroll)} style={{ padding: '6px 12px', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', marginRight: '8px' }}>Assign Students</button>
                                        <button type="button" onClick={() => handleRemoveSubject(enroll.id)} style={{ padding: '6px 10px', background: '#fee2e2', color: '#ef4444', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>X</button>
                                    </div>
                                </div>
                                {editingEnrollmentId === enroll.id && (
                                    <div style={{ padding: '15px', background: '#f1f5f9', borderTop: '1px solid #cbd5e1' }}>
                                        <div style={{ display: 'flex', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
                                            <input type="text" value={groupAlias} onChange={e => setGroupAlias(e.target.value)} placeholder="Display Name" style={{ ...styles.input, flex: 2 }} />
                                            <button type="button" onClick={autoGenerateSmartName} style={{ padding: '8px 12px', background: '#0284c7', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>Auto-Fill Name</button>
                                        </div>
                                        <div style={{ maxHeight: '200px', overflowY: 'auto', background: '#fff', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '8px' }}>
                                            <label style={{ display: 'block', padding: '6px', fontWeight: 'bold', borderBottom: '1px solid #e2e8f0', cursor: 'pointer' }}>
                                                <input type="checkbox" onChange={() => toggleSelectAllFiltered(filteredPickerStudents)} checked={filteredPickerStudents.length > 0 && filteredPickerStudents.every(s => tempSelectedStudents.includes(s.regNo))} style={{ marginRight: '8px' }} />
                                                Select All ({filteredPickerStudents.length})
                                            </label>
                                            {filteredPickerStudents.map(s => (
                                                <label key={s.regNo} style={{ display: 'block', padding: '6px', borderBottom: '1px solid #f1f5f9', cursor: 'pointer', fontSize: '14px' }}>
                                                    <input type="checkbox" checked={tempSelectedStudents.includes(s.regNo)} onChange={() => toggleStudentInSubject(s.regNo)} style={{ marginRight: '8px' }} />
                                                    {s.adNo} - {s.firstName} ({s.department || 'GENERAL'})
                                                </label>
                                            ))}
                                        </div>
                                        <div style={{ marginTop: '10px', textAlign: 'right' }}>
                                            <button type="button" onClick={saveStudentAssignments} style={{ padding: '8px 16px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>Done</button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    <button type="submit" disabled={isLoading} style={isEditing ? styles.buttonWarning : styles.buttonSuccess}>
                        {isLoading ? 'Saving...' : isEditing ? 'Update Teacher' : 'Register Teacher'}
                    </button>
                </form>
                {statusMsg && <div style={{ marginTop: '15px', padding: '12px', background: '#ecfdf5', borderRadius: '8px', color: '#065f46', fontWeight: '600' }}>{statusMsg}</div>}
            </div>

            <div style={styles.card}>
                <h3 style={styles.sectionTitle}>Teachers Directory</h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
                    <thead>
                        <tr style={{ background: '#f8fafc', borderBottom: '2px solid #cbd5e1' }}>
                            <th style={{ padding: '12px' }}>Name & Username</th>
                            <th style={{ padding: '12px' }}>Enrollments</th>
                            <th style={{ padding: '12px' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {registeredTeachers.map((t, idx) => (
                            <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0' }}>
                                <td style={{ padding: '12px' }}><strong>{t.fullName}</strong><br />@{t.username}</td>
                                <td style={{ padding: '12px' }}>{t.enrollments?.map((e, i) => <span key={i} style={{ display: 'inline-block', background: '#f1f5f9', padding: '4px 8px', borderRadius: '4px', margin: '2px', fontSize: '12px' }}>{e.alias}</span>)}</td>
                                <td style={{ padding: '12px' }}>
                                    <button onClick={() => handleEditClick(t)} style={{ padding: '6px 12px', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', marginRight: '6px' }}>Edit</button>
                                    <button onClick={() => handleDeleteClick(t.username)} style={{ padding: '6px 12px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>Delete</button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

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
            <div style={styles.card}>
                <h3 style={styles.sectionTitle}>Mass Upload Students</h3>
                <p style={{ fontSize: '14px', color: '#64748b', marginBottom: '20px' }}>Upload CSV columns: <strong>rollNo, regNo, adNo, firstName, classes, department, madhab</strong>.</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '15px' }}>
                    <button onClick={handleDownloadTemplate} style={{ padding: '12px 20px', background: '#f8fafc', color: '#334155', border: '1px solid #cbd5e1', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '14px' }}>📥 Download CSV Template</button>
                    <label style={{ display: 'inline-flex', alignItems: 'center', padding: '12px 20px', background: '#0284c7', color: '#ffffff', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '14px' }}>📂 Upload Completed CSV <input type="file" accept=".csv" onChange={handleCSVUpload} style={{ display: 'none' }} /></label>
                </div>
            </div>

            <div style={{ ...styles.card, borderLeft: isEditing ? '6px solid #f59e0b' : '1px solid #f1f5f9' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
                    <h3 style={styles.sectionTitle}>{isEditing ? `Editing Student: ${regNo}` : 'Register Student'}</h3>
                    {isEditing && <button type="button" onClick={resetForm} style={{ padding: '8px 16px', background: '#e2e8f0', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Cancel</button>}
                </div>

                <form onSubmit={handleAddOrUpdateStudent} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
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

function ReportManager() {
    const [registeredStudents, setRegisteredStudents] = useState([]);
    const [overallMarksCache, setOverallMarksCache] = useState({});
    const [filteredResults, setFilteredResults] = useState([]);

    const [isLoading, setIsLoading] = useState(false);
    const [isBackgroundSyncing, setIsBackgroundSyncing] = useState(false);
    const [statusMsg, setStatusMsg] = useState('');

    const [searchQuery, setSearchQuery] = useState('');
    const [auditPreset, setAuditPreset] = useState('ALL'); 
    const [exportDepartment, setExportDepartment] = useState('All');
    const [exportClassFilter, setExportClassFilter] = useState('All');
    const [exportMetric, setExportMetric] = useState('STATUS');
    const [exportSubject, setExportSubject] = useState(DEFAULT_SUBJECTS[0]);
    const [thresholdCondition, setThresholdCondition] = useState('Below');
    const [thresholdScore, setThresholdScore] = useState(40);

    const [inspectorClass, setInspectorClass] = useState(DEFAULT_CLASSES[0]);
    const [inspectorSubject, setInspectorSubject] = useState(DEFAULT_SUBJECTS[0]);
    const [subjectLevelMarks, setSubjectLevelMarks] = useState({});
    const [isInspecting, setIsInspecting] = useState(false);
    const [inspectorMode, setInspectorMode] = useState('class'); 
    const [allTeachers, setAllTeachers] = useState([]);
    const [inspectorTeacherUsername, setInspectorTeacherUsername] = useState('');
    const [inspectorTeacherEnrollmentId, setInspectorTeacherEnrollmentId] = useState('');

    const fetchReportData = async () => {
        try {
            const querySnapshot = await getDocs(collection(db, 'students'));
            const studentsData = [];
            querySnapshot.forEach((doc) => studentsData.push(doc.data()));
            studentsData.sort((a, b) => (Number(a.rollNo) || 999) - (Number(b.rollNo) || 999));
            setRegisteredStudents(studentsData);

            const tSnap = await getDocs(collection(db, 'teachers'));
            const tData = [];
            tSnap.forEach((doc) => tData.push(doc.data()));
            setAllTeachers(tData);
            if (tData.length > 0) {
                setInspectorTeacherUsername(tData[0].username);
                if (tData[0].enrollments?.length > 0) {
                    setInspectorTeacherEnrollmentId(tData[0].enrollments[0].id);
                }
            }

            const cacheDocRef = doc(db, 'systemCache', 'adminReportCache');
            const cacheSnap = await getDoc(cacheDocRef);

            if (cacheSnap.exists()) {
                setOverallMarksCache(cacheSnap.data().marksData || {});
                setIsLoading(false); 
            } else {
                setIsLoading(false); 
            }

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

    const generateFilteredList = () => {
        const filtered = registeredStudents.filter((student) => {
            if (searchQuery.trim()) {
                const query = searchQuery.trim().toLowerCase();
                const name = (student.firstName || '').toLowerCase();
                const adNo = (student.adNo || '').toLowerCase();
                const regNo = (student.regNo || '').toLowerCase();
                if (!name.includes(query) && !adNo.includes(query) && !regNo.includes(query)) {
                    return false;
                }
            }

            if (exportDepartment !== 'All' && (student.department || '').toUpperCase() !== exportDepartment.toUpperCase()) return false;
            if (exportClassFilter !== 'All' && !(student.classes || []).includes(exportClassFilter)) return false;

            if (auditPreset === 'ALL') return true;

            const marksInfo = overallMarksCache[student.regNo];

            if (auditPreset === 'MISSING') {
                if (!marksInfo || !marksInfo.overall || !marksInfo.overall['STATUS'] || marksInfo.overall['STATUS'] === '-' || marksInfo.overall['STATUS'] === '') return true;
                return false;
            }

            if (!marksInfo) return false;

            let scoreToCompareStr = '';
            if (exportMetric === 'STATUS') scoreToCompareStr = marksInfo.overall?.['STATUS'];
            else if (exportMetric === '1400') scoreToCompareStr = marksInfo.overall?.['1400'];
            else if (exportMetric === '420') scoreToCompareStr = marksInfo.overall?.['420'];
            else if (exportMetric === 'SUBJECT') scoreToCompareStr = marksInfo.subjects?.[exportSubject.toUpperCase()];

            if (!scoreToCompareStr || scoreToCompareStr === '-' || scoreToCompareStr === '') return false;
            const score = parseFloat(String(scoreToCompareStr).replace('%', ''));
            if (isNaN(score)) return false;

            if (auditPreset === 'FAIL' && score >= 40) return false;
            if (auditPreset === 'TOP' && score < 80) return false;

            if (auditPreset === 'CUSTOM') {
                if (thresholdCondition === 'Below' && score >= Number(thresholdScore)) return false;
                if (thresholdCondition === 'Above' && score < Number(thresholdScore)) return false;
            }

            return true;
        });

        const mappedResults = filtered.map((s) => {
            let printedMetric = 'Missing / -';
            const info = overallMarksCache[s.regNo];
            if (info) {
                if (exportMetric === 'STATUS') printedMetric = info.overall?.['STATUS'] || 'Missing';
                else if (exportMetric === '1400') printedMetric = info.overall?.['1400'] || 'Missing';
                else if (exportMetric === '420') printedMetric = info.overall?.['420'] || 'Missing';
                else if (exportMetric === 'SUBJECT') printedMetric = info.subjects?.[exportSubject.toUpperCase()] || 'Missing';
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
        const info = overallMarksCache[s.regNo];
        return info && info.overall && info.overall['STATUS'] && info.overall['STATUS'] !== '-';
    }).length;
    const missingMarksCount = totalStudentsCount - studentsWithMarks;

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

            let matchedStudents = [];
            let activeSubject = '';
            let sorterAlias = ''; 

            if (inspectorMode === 'class') {
                activeSubject = inspectorSubject;
                sorterAlias = inspectorClass;
                matchedStudents = allStudents.filter(s => (s.classes || []).includes(inspectorClass));
            } 
            else if (inspectorMode === 'teacher') {
                const selectedTeacher = teachersList.find(t => t.username === inspectorTeacherUsername);
                const selectedEnrollment = selectedTeacher?.enrollments?.find(e => e.id === inspectorTeacherEnrollmentId);

                if (!selectedEnrollment) {
                    alert("No valid assignment selected for this teacher.");
                    setIsInspecting(false);
                    return;
                }

                activeSubject = selectedEnrollment.subject;
                sorterAlias = selectedEnrollment.alias || '';
                const envAliasLower = String(selectedEnrollment.alias || '').trim().toLowerCase();
                const envLang = (selectedEnrollment.langTag || '').toLowerCase();

                matchedStudents = allStudents.filter(student => {
                    const studentClassesLower = (student.classes || []).map(c => String(c).trim().toLowerCase());
                    const sReg = String(student.regNo || '').trim();
                    const sAd = String(student.adNo || '').trim();
                    const sId = String(student.id || '').trim();
                    const isUrdu = String(student.adNo || '').toUpperCase().startsWith('U');

                    if (selectedEnrollment.studentIds && Array.isArray(selectedEnrollment.studentIds)) {
                        const savedIds = selectedEnrollment.studentIds.map(id => String(id).trim());
                        if (savedIds.includes(sReg) || savedIds.includes(sAd) || savedIds.includes(sId)) {
                            return true;
                        }
                    }

                    let classMatch = studentClassesLower.some(cls => envAliasLower.includes(cls));

                    if (!classMatch && envAliasLower.includes('m10')) {
                        const isGrade3 = studentClassesLower.some(cls => cls.includes('3'));
                        if (isGrade3 && !isUrdu) classMatch = true; 
                    }

                    if (classMatch) {
                        if (envLang.includes('urdu') && !envLang.includes('non')) return isUrdu;
                        if (envLang.includes('gen') || envLang.includes('non') || envLang === '') return !isUrdu;
                        return true;
                    }
                    return false;
                });
            }

            matchedStudents = sortStudentsByDepartment(matchedStudents, sorterAlias);

            const marksRecord = {};
            const teacherRecord = {};

            for (const student of matchedStudents) {
                let markSnap = null;
                const possibleKeys = [student.regNo, student.id, student.adNo, student.admissionNo].filter(Boolean);
                for (const key of possibleKeys) {
                    markSnap = await getDoc(doc(db, 'marks', String(key).trim()));
                    if (markSnap.exists()) break;
                }

                if (markSnap && markSnap.exists()) {
                    const studentMarksData = markSnap.data();
                    const foundSubjectKey = Object.keys(studentMarksData).find(
                        k => k.trim().toUpperCase() === activeSubject.trim().toUpperCase()
                    );
                    marksRecord[student.regNo || student.id] = foundSubjectKey ? studentMarksData[foundSubjectKey] : {};
                } else {
                    marksRecord[student.regNo || student.id] = {};
                }

                if (inspectorMode === 'teacher') {
                    teacherRecord[student.regNo || student.id] = teachersList.find(t => t.username === inspectorTeacherUsername)?.fullName || 'Assigned';
                } else {
                    let assignedTeacher = 'Unassigned';
                    const studentClassesLower = (student.classes || []).map(c => String(c).trim().toLowerCase());
                    if (!studentClassesLower.includes(inspectorClass.toLowerCase())) {
                        studentClassesLower.push(inspectorClass.toLowerCase());
                    }

                    const isUrdu = String(student.adNo || '').toUpperCase().startsWith('U');
                    const sReg = String(student.regNo || '').trim();
                    const sAd = String(student.adNo || '').trim();
                    const sId = String(student.id || '').trim();

                    for (const teacher of teachersList) {
                        const matchingEnv = teacher.enrollments.find(env => {
                            const envSub = (env.subject || '').trim().toUpperCase();
                            const inspSub = inspectorSubject.trim().toUpperCase();
                            const envAliasUpper = String(env.alias || '').trim().toUpperCase();

                            const isSubjectMatch = 
                                (envSub === inspSub) || 
                                (inspSub === 'LOGIC' && envSub === 'MANTIQ') || 
                                (inspSub === 'MANTIQ' && envSub === 'LOGIC') ||
                                envAliasUpper.includes(inspSub);

                            if (!isSubjectMatch) return false;

                            if (env.studentIds && Array.isArray(env.studentIds)) {
                                const savedIds = env.studentIds.map(id => String(id).trim());
                                if (savedIds.includes(sReg) || savedIds.includes(sAd) || savedIds.includes(sId)) {
                                    return true;
                                }
                            }

                            const envAliasLower = String(env.alias || '').trim().toLowerCase();
                            let classMatch = studentClassesLower.some(cls => envAliasLower.includes(cls));

                            if (!classMatch && envAliasLower.includes('m10')) {
                                const isGrade3 = studentClassesLower.some(cls => cls.includes('3'));
                                if (isGrade3 && !isUrdu) {
                                    classMatch = true; 
                                }
                            }

                            if (classMatch) {
                                const envLang = (env.langTag || '').toLowerCase();
                                let langMatch = false;

                                if (envLang.includes('urdu') && !envLang.includes('non')) {
                                    langMatch = isUrdu; 
                                } else if (envLang.includes('gen') || envLang.includes('non') || envLang === '') {
                                    langMatch = !isUrdu; 
                                } else {
                                    langMatch = true; 
                                }
                                return langMatch;
                            }
                            return false;
                        });

                        if (matchingEnv) {
                            assignedTeacher = teacher.fullName || teacher.id;
                            break; 
                        }
                    }
                    teacherRecord[student.regNo || student.id] = assignedTeacher;
                }
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
            <div style={styles.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '15px' }}>
                    <div>
                        <h3 style={{ margin: '0 0 6px 0', fontSize: '20px', color: '#0f172a', fontWeight: '800' }}>⚡ Student Marks Auditor & Filter</h3>
                        <p style={{ margin: 0, fontSize: '14px', color: '#64748b' }}>Instant multi-parameter audit across all registered students without external quotas.</p>
                    </div>
                    <span style={{ fontSize: '13px', color: '#047857', background: '#ecfdf5', padding: '6px 14px', borderRadius: '20px', fontWeight: '700', border: '1px solid #a7f3d0' }}>
                        ⚡ 100% Free & Realtime
                    </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                    <div style={{ padding: '16px', borderRadius: '12px', background: '#f8fafc', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                        <span style={{ fontSize: '12px', fontWeight: '700', color: '#64748b' }}>TOTAL ENROLLED</span>
                        <div style={{ fontSize: '24px', fontWeight: '800', color: '#0f172a', marginTop: '4px' }}>{totalStudentsCount}</div>
                    </div>
                    <div style={{ padding: '16px', borderRadius: '12px', background: '#ecfdf5', border: '1px solid #a7f3d0', textAlign: 'center' }}>
                        <span style={{ fontSize: '12px', fontWeight: '700', color: '#047857' }}>MARKS RECORDED</span>
                        <div style={{ fontSize: '24px', fontWeight: '800', color: '#047857', marginTop: '4px' }}>{studentsWithMarks}</div>
                    </div>
                    <div style={{ padding: '16px', borderRadius: '12px', background: '#fee2e2', border: '1px solid #fecaca', textAlign: 'center' }}>
                        <span style={{ fontSize: '12px', fontWeight: '700', color: '#991b1b' }}>MISSING / INCOMPLETE</span>
                        <div style={{ fontSize: '24px', fontWeight: '800', color: '#dc2626', marginTop: '4px' }}>{missingMarksCount}</div>
                    </div>
                    <div style={{ padding: '16px', borderRadius: '12px', background: '#eff6ff', border: '1px solid #bfdbfe', textAlign: 'center' }}>
                        <span style={{ fontSize: '12px', fontWeight: '700', color: '#1e40af' }}>COMPLETION RATE</span>
                        <div style={{ fontSize: '24px', fontWeight: '800', color: '#2563eb', marginTop: '4px' }}>
                            {totalStudentsCount > 0 ? `${((studentsWithMarks / totalStudentsCount) * 100).toFixed(0)}%` : '0%'}
                        </div>
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '16px' }}>
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
                        <input 
                            type="text" 
                            value={searchQuery} 
                            onChange={(e) => setSearchQuery(e.target.value)} 
                            placeholder="Type student name or Ad.No..." 
                            style={styles.input} 
                        />
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
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', padding: '16px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
                        <div>
                            <label style={styles.label}>Metric:</label>
                            <select value={exportMetric} onChange={(e) => setExportMetric(e.target.value)} style={styles.input}>
                                <option value="STATUS">Overall Percentage (%)</option>
                                <option value="1400">Total out of 1400</option>
                                <option value="420">Total out of 420</option>
                                <option value="SUBJECT">Specific Subject</option>
                            </select>
                        </div>
                        {exportMetric === 'SUBJECT' && (
                            <div>
                                <label style={styles.label}>Subject:</label>
                                <select value={exportSubject} onChange={(e) => setExportSubject(e.target.value)} style={styles.input}>
                                    {DEFAULT_SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>
                        )}
                        <div>
                            <label style={styles.label}>Rule:</label>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <select value={thresholdCondition} onChange={(e) => setThresholdCondition(e.target.value)} style={{ ...styles.input, flex: 1 }}>
                                    <option value="Below">Below</option>
                                    <option value="Above">Above or Equal</option>
                                </select>
                                <input type="number" value={thresholdScore} onChange={(e) => setThresholdScore(e.target.value)} style={{ ...styles.input, flex: 1 }} />
                            </div>
                        </div>
                    </div>
                )}

                <button 
                    onClick={generateFilteredList} 
                    style={{ ...styles.buttonPrimary, width: '100%', background: '#2563eb', padding: '14px', fontSize: '16px', fontWeight: '700' }}
                >
                    🔍 Run Filter & Audit List
                </button>

                {statusMsg && (
                    <div style={{ marginTop: '16px', padding: '12px 16px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', color: '#166534', fontWeight: '600' }}>
                        {statusMsg}
                    </div>
                )}

                {filteredResults.length > 0 && (
                    <div style={{ border: '1px solid #cbd5e1', borderRadius: '12px', overflow: 'hidden', marginTop: '20px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '16px', borderBottom: '1px solid #cbd5e1', flexWrap: 'wrap', gap: '10px' }}>
                            <h4 style={{ margin: 0, color: '#0f172a', fontWeight: '800' }}>Audit Results ({filteredResults.length} students)</h4>
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
                                    <tr style={{ borderBottom: '2px solid #cbd5e1' }}>
                                        <th style={{ padding: '12px', color: '#0f172a', fontWeight: '800' }}>Ad.No</th>
                                        <th style={{ padding: '12px', color: '#0f172a', fontWeight: '800' }}>Name</th>
                                        <th style={{ padding: '12px', color: '#0f172a', fontWeight: '800' }}>Department</th>
                                        <th style={{ padding: '12px', color: '#0f172a', fontWeight: '800' }}>Class</th>
                                        <th style={{ padding: '12px', color: '#0f172a', fontWeight: '800' }}>Score / Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredResults.map((student, idx) => (
                                        <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0', background: idx % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                                            <td style={{ padding: '12px', fontWeight: '800', color: '#0f172a' }}>{student.adNo}</td>
                                            <td style={{ padding: '12px', color: '#0f172a', fontWeight: '700' }}>{student.firstName}</td>
                                            <td style={{ padding: '12px' }}>
                                                <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '800' }}>
                                                    {student.department || 'GENERAL'}
                                                </span>
                                            </td>
                                            <td style={{ padding: '12px', color: '#334155', fontWeight: '700' }}>{(student.classes || []).join(', ')}</td>
                                            <td style={{ padding: '12px' }}>
                                                <span style={{
                                                    color: String(student.displayMetric).includes('Missing') ? '#dc2626' : '#047857',
                                                    fontWeight: '800',
                                                    fontSize: '15px'
                                                }}>
                                                    {student.displayMetric}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>

            <div style={styles.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
                    <h3 style={styles.sectionTitle}>🔍 Level-by-Level Mark Inspector</h3>
                </div>
                
                <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
                    <button 
                        onClick={() => { setInspectorMode('class'); setSubjectLevelMarks({}); }}
                        style={{ padding: '10px 18px', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', border: '1px solid #cbd5e1', background: inspectorMode === 'class' ? '#2563eb' : '#f8fafc', color: inspectorMode === 'class' ? '#ffffff' : '#334155' }}
                    >
                        Filter by Class & Subject
                    </button>
                    <button 
                        onClick={() => { setInspectorMode('teacher'); setSubjectLevelMarks({}); }}
                        style={{ padding: '10px 18px', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', border: '1px solid #cbd5e1', background: inspectorMode === 'teacher' ? '#2563eb' : '#f8fafc', color: inspectorMode === 'teacher' ? '#ffffff' : '#334155' }}
                    >
                        Filter by Teacher
                    </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '20px' }}>
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
                                <select 
                                    value={inspectorTeacherEnrollmentId} 
                                    onChange={(e) => setInspectorTeacherEnrollmentId(e.target.value)} 
                                    style={styles.input}
                                >
                                    {allTeachers.find(t => t.username === inspectorTeacherUsername)?.enrollments?.map(env => (
                                        <option key={env.id} value={env.id}>
                                            {env.alias || `${env.grade} ${env.subject}`} ({env.langTag || 'Gen'})
                                        </option>
                                    )) || <option value="">No assignments found</option>}
                                </select>
                            </div>
                        </>
                    )}

                    <div style={{ display: 'flex', alignItems: 'end' }}>
                        <button 
                            onClick={fetchClassSubjectMarks} 
                            disabled={inspectorMode === 'teacher' && !inspectorTeacherEnrollmentId}
                            style={{ ...styles.buttonPrimary, width: '100%', background: '#0284c7', opacity: (inspectorMode === 'teacher' && !inspectorTeacherEnrollmentId) ? 0.5 : 1 }}
                        >
                            {isInspecting ? 'Loading...' : 'Inspect Marks'}
                        </button>
                    </div>
                </div>

                {subjectLevelMarks.students && subjectLevelMarks.students.length > 0 && (
                    <div style={{ marginTop: '20px', overflowX: 'auto', border: '1px solid #cbd5e1', borderRadius: '12px' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px', minWidth: '800px' }}>
                            <thead>
                                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #cbd5e1' }}>
                                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800' }}>Roll</th>
                                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800' }}>Ad.No</th>
                                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800' }}>Student Name</th>
                                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800' }}>Level 1 (15)</th>
                                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800' }}>Level 2 (20)</th>
                                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800' }}>Level 3 (25)</th>
                                    <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800' }}>Level 4 (40)</th>
                                    <th style={{ padding: '14px 16px', color: '#1e40af', fontWeight: '800' }}>Total Score</th>
                                    {inspectorMode === 'class' && <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800' }}>Assigned Teacher</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {subjectLevelMarks.students.map((student, idx) => {
                                    const marks = subjectLevelMarks.records[student.regNo || student.id] || {};
                                    const teacherName = subjectLevelMarks.teachers[student.regNo || student.id] || 'Unassigned';
                                    const m1 = parseFloat(marks['15']) || 0;
                                    const m2 = parseFloat(marks['20']) || 0;
                                    const m3 = parseFloat(marks['25']) || 0;
                                    const m4 = parseFloat(marks['40']) || 0;
                                    const total = m1 + m2 + m3 + m4;

                                    return (
                                        <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0', background: idx % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                                            <td style={{ padding: '14px 16px', fontWeight: '800', color: '#0f172a' }}>{student.rollNo || '-'}</td>
                                            <td style={{ padding: '14px 16px', fontWeight: '800', color: '#0f172a' }}>{student.adNo}</td>
                                            <td style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '700' }}>
                                                {student.firstName}
                                                <br/>
                                                <span style={{ fontSize: '12px', color: '#64748b', fontWeight: '500' }}>{student.regNo}</span>
                                            </td>
                                            <td style={{ padding: '14px 16px' }}>
                                                <span style={{ fontSize: '15px', fontWeight: '800', color: marks['15'] !== undefined ? '#0f172a' : '#cbd5e1' }}>
                                                    {marks['15'] !== undefined ? marks['15'] : '-'}
                                                </span>
                                            </td>
                                            <td style={{ padding: '14px 16px' }}>
                                                <span style={{ fontSize: '15px', fontWeight: '800', color: marks['20'] !== undefined ? '#0f172a' : '#cbd5e1' }}>
                                                    {marks['20'] !== undefined ? marks['20'] : '-'}
                                                </span>
                                            </td>
                                            <td style={{ padding: '14px 16px' }}>
                                                <span style={{ fontSize: '15px', fontWeight: '800', color: marks['25'] !== undefined ? '#0f172a' : '#cbd5e1' }}>
                                                    {marks['25'] !== undefined ? marks['25'] : '-'}
                                                </span>
                                            </td>
                                            <td style={{ padding: '14px 16px' }}>
                                                <span style={{ fontSize: '15px', fontWeight: '800', color: marks['40'] !== undefined ? '#0f172a' : '#cbd5e1' }}>
                                                    {marks['40'] !== undefined ? marks['40'] : '-'}
                                                </span>
                                            </td>
                                            <td style={{ padding: '14px 16px' }}>
                                                {total > 0 ? (
                                                    <span style={{ background: '#dbeafe', color: '#1e40af', padding: '6px 12px', borderRadius: '6px', fontWeight: '800', fontSize: '15px' }}>
                                                        {total}
                                                    </span>
                                                ) : (
                                                    <span style={{ color: '#94a3b8', fontWeight: '700' }}>-</span>
                                                )}
                                            </td>
                                            {inspectorMode === 'class' && (
                                                <td style={{ padding: '14px 16px', color: teacherName === 'Unassigned' ? '#dc2626' : '#047857', fontWeight: '700' }}>
                                                    {teacherName}
                                                </td>
                                            )}
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

export default function UnifiedSchoolPortal() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loginError, setLoginError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const router = useRouter();

    const [userRole, setUserRole] = useState(null); 
    const [loggedInTeacherData, setLoggedInTeacherData] = useState(null);

    // 🌟 Ensure session persists if teacher reloads the page
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (user && user.email && user.email.endsWith('@school.com')) {
                const safeUsername = user.email.split('@')[0];
                const docRef = doc(db, "teachers", safeUsername);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    setLoggedInTeacherData(docSnap.data());
                    setUserRole('teacher');
                }
            }
        });
        return () => unsubscribe();
    }, []);

    const handleLogin = async (e) => {
        e.preventDefault();
        setLoginError('');
        setIsLoading(true);

        const rawUsername = username.trim().toLowerCase();
        
        // 🌟 Sanitizes login exactly like registration so spaces don't break the database match
        const safeUsername = rawUsername.replace(/[^a-z0-9_.-]/g, '');

        if (rawUsername === 'admin' && password === 'admin123') {
            localStorage.setItem('isAdminAuth', 'true');
            router.push('/admin'); 
            return;
        }

        try {
            const fakeEmail = `${safeUsername}@school.com`;
            await signInWithEmailAndPassword(auth, fakeEmail, password.trim());
            
            const docRef = doc(db, "teachers", safeUsername);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                setLoggedInTeacherData(docSnap.data());
                setUserRole('teacher');
            } else {
                setLoginError('Teacher profile data not found.');
                await signOut(auth);
            }
        } catch (err) {
            console.error("Login Error:", err);
            // 🌟 Provides smart error messaging to help you debug
            if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
                setLoginError('Incorrect password or username.');
            } else if (err.code === 'auth/user-not-found') {
                setLoginError('Username does not exist in the database.');
            } else {
                setLoginError('Login failed. Please check credentials.');
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleLogout = async () => {
        await signOut(auth);
        setUserRole(null);
        setLoggedInTeacherData(null);
        setUsername(''); setPassword('');
    };

    if (userRole === 'admin') {
        return (
            <div style={{ minHeight: '100vh', backgroundColor: '#f0f2f5', padding: '24px 16px', fontFamily: 'Inter, system-ui, sans-serif' }}>
                <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
                    <InstallAppBanner />
                    
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', background: '#ffffff', padding: '20px 24px', borderRadius: '16px', border: '1px solid #e2e8f0', flexWrap: 'wrap', gap: '15px' }}>
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                            <h1 style={{ margin: '0 15px 0 0', fontSize: '20px', fontWeight: '800' }}>Admin Dashboard</h1>
                        </div>
                        <button onClick={handleLogout} style={styles.buttonDanger}>Logout</button>
                    </div>

                    {/* Renders the full admin tabs */}
                    <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
                        <button onClick={() => window.scrollTo(0, document.getElementById('teachers').offsetTop)} style={{ padding: '10px 18px', background: '#f8fafc', color: '#334155', border: '1px solid #cbd5e1', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>Manage Teachers</button>
                        <button onClick={() => window.scrollTo(0, document.getElementById('students').offsetTop)} style={{ padding: '10px 18px', background: '#f8fafc', color: '#334155', border: '1px solid #cbd5e1', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>Manage Students</button>
                        <button onClick={() => window.scrollTo(0, document.getElementById('reports').offsetTop)} style={{ padding: '10px 18px', background: '#f8fafc', color: '#334155', border: '1px solid #cbd5e1', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>Reports & Export</button>
                    </div>

                    <div id="teachers"><TeacherManager /></div>
                    <div id="students"><StudentManager /></div>
                    <div id="reports"><ReportManager /></div>

                </div>
            </div>
        );
    }

    if (userRole === 'teacher') {
        return (
            <div style={{ minHeight: '100vh', backgroundColor: '#f0f2f5', padding: '24px 16px', fontFamily: 'Inter, system-ui, sans-serif' }}>
                <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
                    <InstallAppBanner />
                    <TeacherPortalView loggedInTeacher={loggedInTeacherData} onLogout={handleLogout} />
                </div>
            </div>
        );
    }

    return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f0f2f5', fontFamily: 'Inter, system-ui, sans-serif', padding: '16px', boxSizing: 'border-box' }}>
            <div style={{ width: '100%', maxWidth: '420px' }}>
                <InstallAppBanner />
                <div style={{ background: '#ffffff', padding: '40px 24px', borderRadius: '16px', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', border: '1px solid #e2e8f0', boxSizing: 'border-box' }}>
                    <div style={{ textAlign: 'center', marginBottom: '28px' }}>
                        <span style={{ fontSize: '36px', display: 'block', marginBottom: '8px' }}>🏫</span>
                        <h2 style={{ color: '#0f172a', margin: '0 0 8px 0', fontSize: '24px', fontWeight: '800' }}>School Portal</h2>
                        <p style={{ color: '#64748b', fontSize: '14px', margin: 0 }}>Sign in with your Admin or Teacher account</p>
                    </div>

                    <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                        <div>
                            <label style={styles.label}>Username</label>
                            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. admin or username" required style={styles.input} />
                        </div>
                        <div>
                            <label style={styles.label}>Password</label>
                            <div style={{ display: 'flex', position: 'relative' }}>
                                <input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required style={styles.input} />
                                <button type="button" onClick={() => setShowPassword(!showPassword)} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#2563eb', fontWeight: '600', cursor: 'pointer' }}>{showPassword ? "Hide" : "Show"}</button>
                            </div>
                        </div>

                        {loginError && <div style={{ padding: '10px', background: '#fef2f2', color: '#b91c1c', borderRadius: '8px', fontSize: '13px', fontWeight: '600', textAlign: 'center' }}>{loginError}</div>}

                        <button type="submit" disabled={isLoading} style={{ ...styles.buttonPrimary, width: '100%', opacity: isLoading ? 0.7 : 1 }}>
                            {isLoading ? 'Signing In...' : 'Sign In'}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}