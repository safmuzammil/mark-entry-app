'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { auth, db } from '../../lib/firebase';
import { signOut, updatePassword, onAuthStateChanged } from 'firebase/auth';
import { collection, getDocs, doc, getDoc, setDoc } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import InstallAppBanner from '../components/InstallAppBanner';

const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbxN_z56f3Q5O3OjsKFagUSqromiH0xTKTfro0zqJZN4ZB-FJLM3jERMigPXiOkfw-4/exec';

const CCE_LEVELS = { "Level 1": "15", "Level 2": "20", "Level 3": "25", "Level 4": "40" };

const styles = {
    card: { background: '#ffffff', padding: '24px', borderRadius: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: '1px solid #f1f5f9', marginBottom: '24px', boxSizing: 'border-box' },
    input: { width: '100%', padding: '12px 16px', borderRadius: '8px', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', color: '#0f172a', fontSize: '15px', outline: 'none', boxSizing: 'border-box' },
    label: { display: 'block', fontSize: '14px', fontWeight: '600', color: '#334155', marginBottom: '8px' },
    buttonPrimary: { padding: '12px 24px', background: '#2563eb', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '15px' },
    buttonSuccess: { padding: '14px 24px', background: '#10b981', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '16px', width: '100%', marginTop: '10px' },
    buttonDanger: { padding: '8px 14px', background: '#fee2e2', color: '#ef4444', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }
};

const sortStudentsByDepartment = (studentsList, classNameAlias) => {
    const classLower = String(classNameAlias || '').toLowerCase();
    let deptOrder = [];
    let classOrder = [];

    if (classLower.includes('qhf')) deptOrder = ['QURAN', 'HADITH', 'FIQH'];
    else if (classLower.includes('alc')) deptOrder = ['AQIDAH', 'LANGUAGE', 'CIVIL'];
    else if (classLower.includes('m10') || classLower.includes('u10')) {
        classOrder = ['qla3', 'hfc3'];
        deptOrder = ['QURAN', 'LANGUAGE', 'AQIDAH', 'HADITH', 'FIQH', 'CIVIL'];
    } else if (classLower.includes('fcl')) deptOrder = ['FIQH', 'CIVIL', 'LANGUAGE'];
    else if (classLower.includes('qha')) deptOrder = ['QURAN', 'HADITH', 'AQIDAH'];
    else if (classLower.includes('u8') || classLower.includes('u9')) {
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
            <p style={{ margin: '0 0 20px 0', fontSize: '14px', color: '#64748b' }}>Update your account password.</p>
            <form onSubmit={handlePasswordChange} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div><label style={styles.label}>New Password</label><input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required style={styles.input} /></div>
                <div><label style={styles.label}>Confirm New Password</label><input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required style={styles.input} /></div>
                <button type="submit" disabled={loading} style={styles.buttonPrimary}>{loading ? 'Updating...' : 'Update Password'}</button>
            </form>
            {status && <div style={{ marginTop: '16px', padding: '12px', borderRadius: '8px', fontSize: '14px', fontWeight: '600', backgroundColor: status.includes('Error') ? '#fee2e2' : '#d1fae5', color: status.includes('Error') ? '#ef4444' : '#10b981' }}>{status}</div>}
        </div>
    );
}

export default function TeacherPortal() {
    const router = useRouter();
    const [loggedInTeacher, setLoggedInTeacher] = useState(null);
    const [activeView, setActiveView] = useState('marks');
    const [selectedEnrollmentId, setSelectedEnrollmentId] = useState('');
    const [cceLevel, setCceLevel] = useState('Level 1');
    const assessmentMaxMark = CCE_LEVELS[cceLevel];
    
    const [allStudentsCache, setAllStudentsCache] = useState([]);
    const [classStudents, setClassStudents] = useState([]);
    const [studentMarks, setStudentMarks] = useState({});
    const [statusMsg, setStatusMsg] = useState('');

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (user && user.email && user.email.endsWith('@school.com')) {
                const safeUsername = user.email.split('@')[0];
                const docRef = doc(db, "teachers", safeUsername);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    const teacherData = docSnap.data();
                    setLoggedInTeacher(teacherData);
                    if (teacherData.enrollments && teacherData.enrollments.length > 0) {
                        setSelectedEnrollmentId(teacherData.enrollments[0].id);
                    }
                }
            } else {
                router.push('/');
            }
        });
        return () => unsubscribe();
    }, [router]);

    useEffect(() => {
        async function fetchStudents() {
            const sSnap = await getDocs(collection(db, 'students'));
            const sData = [];
            sSnap.forEach((doc) => sData.push(doc.data()));
            setAllStudentsCache(sData);
        }
        if (loggedInTeacher) fetchStudents();
    }, [loggedInTeacher]);

    useEffect(() => {
        if (!selectedEnrollmentId || allStudentsCache.length === 0 || !loggedInTeacher) return;
        const currentEnrollment = loggedInTeacher.enrollments.find(e => e.id === selectedEnrollmentId);
        if (!currentEnrollment) return;

        const matchedStudents = allStudentsCache.filter(student => currentEnrollment.studentIds.includes(student.regNo));
        const sortedStudents = sortStudentsByDepartment(matchedStudents, currentEnrollment.alias || `Grade ${currentEnrollment.grade} ${currentEnrollment.subject}`);
        setClassStudents(sortedStudents);
    }, [selectedEnrollmentId, allStudentsCache, loggedInTeacher]);

    useEffect(() => {
        if (!selectedEnrollmentId || classStudents.length === 0 || !loggedInTeacher) return;
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
            if (selectedEnrollmentId) localStorage.setItem(`draft_marks_${selectedEnrollmentId}`, JSON.stringify(updatedMarks));
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
        if (classStudents.length === 0) return alert('No students found to generate a template.');
        let csvContent = "data:text/csv;charset=utf-8,Ad.No,Student Name,Marks (Max " + assessmentMaxMark + ")\n";
        classStudents.forEach(student => { csvContent += `${student.adNo},"${student.firstName}",\n`; });
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        const currentEnrollment = loggedInTeacher.enrollments.find(e => e.id === selectedEnrollmentId);
        const safeTitle = (currentEnrollment?.alias || 'Class').replace(/[^a-zA-Z0-9]/g, '_');
        link.setAttribute("download", `${safeTitle}_Marks.csv`);
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

        setStatusMsg('Syncing marks to database...');
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
          setStatusMsg('Firebase updated! Backing up to Google Sheets...');
          const res = await fetch(WEB_APP_URL, { method: 'POST', body: JSON.stringify({ marks: marksPayload }) });
          const result = await res.json();
          if (result.status === 'success') {
              setStatusMsg('Marks saved successfully everywhere!');
              localStorage.removeItem(`draft_marks_${selectedEnrollmentId}`);
          } else setStatusMsg('Saved to Firebase, but Sheets backup error: ' + result.message);
        } catch (err) { setStatusMsg('Network error: ' + err.message); }
    };

    const handleLogout = async () => {
        await signOut(auth);
        router.push('/');
    };

    if (!loggedInTeacher) return <div style={{ padding: '40px', textAlign: 'center' }}>Loading Teacher Portal...</div>;

    const validMarks = classStudents.map(s => studentMarks[s.regNo]).filter(v => v !== undefined && v !== '').map(v => parseFloat(v)).filter(v => !isNaN(v));
    const highestScore = validMarks.length > 0 ? Math.max(...validMarks) : 0;
    const classAverage = validMarks.length > 0 ? (validMarks.reduce((a, b) => a + b, 0) / validMarks.length).toFixed(1) : 0;
    const passPercentage = validMarks.length > 0 ? ((validMarks.filter(m => m >= Number(assessmentMaxMark) * 0.4).length / validMarks.length) * 100).toFixed(0) : 0;
    const currentEnrollment = loggedInTeacher?.enrollments?.find(e => e.id === selectedEnrollmentId);

    return (
        <div style={{ minHeight: '100vh', backgroundColor: '#f0f2f5', padding: '16px 8px', fontFamily: 'Inter, system-ui, sans-serif', color: '#0f172a', boxSizing: 'border-box' }}>
            <div style={{ maxWidth: '1100px', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
                <InstallAppBanner />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', background: '#ffffff', padding: '16px 20px', borderRadius: '16px', border: '1px solid #e2e8f0', flexWrap: 'wrap', gap: '12px' }}>
                    <div>
                        <h1 style={{ margin: '0 0 4px 0', fontSize: '22px', fontWeight: '800' }}>Teacher Portal</h1>
                        <p style={{ margin: 0, color: '#64748b', fontSize: '14px' }}>Welcome back, <strong>{loggedInTeacher?.fullName}</strong></p>
                    </div>
                    <div style={{ display: 'flex', gap: '10px' }}>
                        <button onClick={() => setActiveView(activeView === 'marks' ? 'settings' : 'marks')} style={{ padding: '8px 14px', background: '#f8fafc', color: '#334155', border: '1px solid #cbd5e1', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }}>
                            {activeView === 'marks' ? '⚙️ Settings' : '⬅️ Back to Marks'}
                        </button>
                        <button onClick={handleLogout} style={styles.buttonDanger}>Logout</button>
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
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                              <button type="button" onClick={handleDownloadMarksTemplate} style={{ padding: '8px 14px', background: '#f8fafc', color: '#334155', border: '1px solid #cbd5e1', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }}>📥 Download Template</button>
                              <label style={{ padding: '8px 14px', background: '#0284c7', color: '#ffffff', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }}>📂 Upload Spreadsheet<input type="file" accept=".csv, .xlsx" onChange={handleUniversalUpload} style={{ display: 'none' }} /></label>
                            </div>
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
                                      <td style={{ padding: '14px 12px', color: '#0f172a', fontWeight: '800', fontSize: '15px' }}>{student.firstName}<br /><span style={{ fontSize: '12px', color: '#475569', fontWeight: '500' }}>Reg: {student.regNo}</span></td>
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
        </div>
    );
}