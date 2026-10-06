'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { auth, db } from '../lib/firebase';
import { createUserWithEmailAndPassword, getAuth, signOut, updatePassword } from 'firebase/auth';
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
        try {
            const user = auth.currentUser;
            if (!user) throw new Error("No active user session found.");
            await updatePassword(user, newPassword);
            setStatus('Password updated successfully!');
            setNewPassword(''); setConfirmPassword('');
        } catch (err) {
            setStatus('Error: ' + err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ ...styles.card, maxWidth: '450px', margin: '0 auto' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', color: '#0f172a' }}>🔒 Change Your Password</h3>
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
            {status && <div style={{ marginTop: '16px', padding: '12px', borderRadius: '8px', fontSize: '14px', fontWeight: '600', backgroundColor: status.includes('Error') ? '#fee2e2' : '#d1fae5', color: status.includes('Error') ? '#ef4444' : '#10b981' }}>{status}</div>}
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

    // 🌟 FIXED: Allows up to two decimal places (e.g., 5.55)
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
                      <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: '700' }}>Enrolled Students ({classStudents.length})</h3>
                      <div style={{ width: '100%', overflowX: 'auto', marginBottom: '20px' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px', minWidth: '550px' }}>
                            <thead>
                              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #cbd5e1' }}>
                                <th style={{ padding: '12px' }}>Sn</th>
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
                                  {/* 🌟 High Contrast Student Names */}
                                  <td style={{ padding: '12px', color: '#0f172a', fontWeight: '700', fontSize: '15px' }}>
                                    {student.firstName}
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
                      <button type="submit" style={styles.buttonSuccess}>Save / Update All Marks</button>
                    </form>
                    {statusMsg && <div style={{ padding: '14px', background: '#ecfdf5', borderRadius: '8px', color: '#065f46', fontWeight: '600', textAlign: 'center' }}>{statusMsg}</div>}
                </>
            )}
        </div>
    );
}

// ==========================================
// ADMIN PORTAL VIEW (Redirects to /admin)
// ==========================================
function AdminPortalView() {
    const router = useRouter();

    useEffect(() => {
        router.push('/admin'); // Automatically route to your dedicated admin page
    }, [router]);

    return (
        <div style={{ textAlign: 'center', padding: '40px' }}>
            <p>Redirecting to Admin Dashboard...</p>
        </div>
    );
}

// ==========================================
// MAIN UNIFIED LOGIN SCREEN
// ==========================================
export default function UnifiedSchoolPortal() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loginError, setLoginError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const router = useRouter();

    const [userRole, setUserRole] = useState(null); 
    const [loggedInTeacherData, setLoggedInTeacherData] = useState(null);

const handleLogin = async (e) => {
        e.preventDefault();
        setLoginError('');
        setIsLoading(true);

        // 1. Get the raw typed username
        const rawUsername = username.trim().toLowerCase();
        
        // 🌟 2. THE FIX: Remove all spaces and invalid characters so it perfectly matches the database
        const safeUsername = rawUsername.replace(/[^a-z0-9_.-]/g, '');

        // 3. Admin Check
        if (rawUsername === 'admin' && password === 'admin123') {
            localStorage.setItem('isAdminAuth', 'true');
            router.push('/admin');
            return;
        }

        // 4. Teacher Check
        try {
            // 🌟 Use the safeUsername to create the email
            const fakeEmail = `${safeUsername}@school.com`;
            await signInWithEmailAndPassword(auth, fakeEmail, password.trim());
            
            // 🌟 Use the safeUsername to look up the document
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
            // 🌟 SMART ERRORS: This will now explicitly tell you if the password is wrong or the user doesn't exist
            if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
                setLoginError('Incorrect password or username.');
            } else if (err.code === 'auth/user-not-found') {
                setLoginError('Username does not exist in the database.');
            } else {
                setLoginError(`Login failed: ${err.message}`);
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
        return <AdminPortalView />;
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