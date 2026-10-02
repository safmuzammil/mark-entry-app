'use client';
import { useState, useEffect } from 'react';
import { auth, db } from '../../lib/firebase';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { collection, getDocs, doc, getDoc, setDoc } from 'firebase/firestore'; // Added setDoc

const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbxN_z56f3Q5O3OjsKFagUSqromiH0xTKTfro0zqJZN4ZB-FJLM3jERMigPXiOkfw-4/exec';

const CCE_LEVELS = {
  "Level 1": "15",
  "Level 2": "20",
  "Level 3": "25",
  "Level 4": "40"
};

const styles = {
  pageBackground: { minHeight: '100vh', backgroundColor: '#f0f2f5', padding: '40px 20px', fontFamily: 'Inter, system-ui, sans-serif', color: '#0f172a' },
  card: { background: '#ffffff', padding: '32px', borderRadius: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: '1px solid #f1f5f9', marginBottom: '32px' },
  input: { width: '100%', padding: '12px 16px', borderRadius: '8px', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', color: '#0f172a', fontSize: '15px', outline: 'none', boxSizing: 'border-box' },
  label: { display: 'block', fontSize: '14px', fontWeight: '600', color: '#334155', marginBottom: '8px' },
  buttonPrimary: { padding: '12px 24px', background: '#2563eb', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '15px', transition: '0.2s' },
  buttonSuccess: { padding: '14px 24px', background: '#10b981', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '16px', width: '100%' },
  buttonDanger: { padding: '10px 20px', background: '#fee2e2', color: '#ef4444', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '14px', transition: '0.2s' },
  sectionTitle: { margin: '0 0 20px 0', fontSize: '20px', color: '#0f172a', fontWeight: '700', borderBottom: '2px solid #f1f5f9', paddingBottom: '12px' }
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

export default function TeacherDashboard() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loggedInTeacher, setLoggedInTeacher] = useState(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState('');
  const [cceLevel, setCceLevel] = useState('Level 1');
  const assessmentMaxMark = CCE_LEVELS[cceLevel];
  
  const [allStudentsCache, setAllStudentsCache] = useState([]);
  const [classStudents, setClassStudents] = useState([]);
  const [studentMarks, setStudentMarks] = useState({});
  const [statusMsg, setStatusMsg] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!username) return setLoginError('Please enter your username.');
    const safeUsername = username.toLowerCase().trim();
    const fakeEmail = `${safeUsername}@school.com`;

    try {
      await signInWithEmailAndPassword(auth, fakeEmail, password.trim());
      const docRef = doc(db, "teachers", safeUsername);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const teacherData = docSnap.data();
        setLoggedInTeacher(teacherData);
        setIsAuthenticated(true);
        setLoginError('');

        if (teacherData.enrollments && teacherData.enrollments.length > 0) {
          setSelectedEnrollmentId(teacherData.enrollments[0].id);
        }

        const sSnap = await getDocs(collection(db, 'students'));
        const sData = [];
        sSnap.forEach((doc) => sData.push(doc.data()));
        setAllStudentsCache(sData);

      } else { setLoginError('Teacher profile not found.'); }
    } catch (err) { setLoginError('Invalid username or password.'); }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setIsAuthenticated(false);
    setLoggedInTeacher(null);
    setUsername(''); setPassword('');
    setClassStudents([]); setAllStudentsCache([]);
  };

  useEffect(() => {
    if (!isAuthenticated || !selectedEnrollmentId || allStudentsCache.length === 0) return;
    const currentEnrollment = loggedInTeacher.enrollments.find(e => e.id === selectedEnrollmentId);
    if (!currentEnrollment) return;

    const matchedStudents = allStudentsCache.filter(student => 
      currentEnrollment.studentIds.includes(student.regNo)
    );
    
    matchedStudents.sort((a, b) => (Number(a.rollNo) || 999) - (Number(b.rollNo) || 999));
    setClassStudents(matchedStudents);
  }, [isAuthenticated, selectedEnrollmentId, allStudentsCache, loggedInTeacher]);

  // UPGRADED: Fetch existing marks directly from fast Firestore instead of slow Google Sheets
  useEffect(() => {
    if (!isAuthenticated || !selectedEnrollmentId || classStudents.length === 0) return;
    const currentEnrollment = loggedInTeacher.enrollments.find(e => e.id === selectedEnrollmentId);
    if(!currentEnrollment) return;

    async function fetchExistingMarksFromFirebase() {
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
    fetchExistingMarksFromFirebase();
  }, [isAuthenticated, selectedEnrollmentId, assessmentMaxMark, classStudents, loggedInTeacher]);

  const handleMarkChange = (studentRegNo, value) => {
    setStudentMarks({ ...studentMarks, [studentRegNo]: value });
  };

  // --- UPGRADED: DYNAMIC CSV TEMPLATE (Ad.No ONLY) ---
  const handleDownloadMarksTemplate = () => {
    if (classStudents.length === 0) return alert('No students found in this class to generate a template.');
    
    // Header only uses Ad.No
    let csvContent = "data:text/csv;charset=utf-8,Ad.No,Student Name,Marks (Max " + assessmentMaxMark + ")\n";
    
    classStudents.forEach(student => {
      // Export Ad.No and Name. Leave the marks column blank.
      csvContent += `${student.adNo},"${student.firstName}",\n`; 
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    
    const currentEnrollment = loggedInTeacher.enrollments.find(e => e.id === selectedEnrollmentId);
    const safeTitle = (currentEnrollment?.alias || 'Class').replace(/[^a-zA-Z0-9]/g, '_');
    link.setAttribute("download", `${safeTitle}_${cceLevel.replace(' ', '')}_Marks.csv`);
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // --- UPGRADED: UPLOAD PROCESS FOR Ad.No ---
  const handleCSVUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      const lines = text.split('\n');
      
      const newMarks = { ...studentMarks }; 
      let updatedCount = 0;
      let errorCount = 0;
      const maxAllowed = Number(assessmentMaxMark);

      for (let i = 1; i < lines.length; i++) {
        let line = lines[i].trim();
        if (!line) continue;
        
        let cols = parseCSVLine(line); 
        if (cols.length >= 3) { // Expecting Ad.No, Name, Marks
          const rawAdNo = cols[0].trim(); // Read the Ad.No from column 1
          const marksStr = cols[cols.length - 1].trim(); 
          
          if (marksStr !== '') {
            const markVal = parseFloat(marksStr);
            
            // Match the student perfectly by Ad.No
            const matchedStudent = classStudents.find(s => s.adNo === rawAdNo);
            
            if (matchedStudent) {
              if (!isNaN(markVal) && markVal <= maxAllowed && markVal >= 0) {
                // Apply the mark to the student's unique Registration Number under the hood!
                newMarks[matchedStudent.regNo] = marksStr;
                updatedCount++;
              } else {
                errorCount++;
              }
            }
          }
        }
      }
      
      setStudentMarks(newMarks);
      
      if (errorCount > 0) {
        alert(`Extracted marks for ${updatedCount} students, but skipped ${errorCount} invalid marks. Review table and click 'Save All Marks'.`);
      } else {
        alert(`Successfully imported marks for ${updatedCount} students. Review table and click 'Save All Marks'.`);
      }
    };
    reader.readAsText(file);
    e.target.value = null; 
  };

  // --- UPGRADED: SAVE MARKS TO FIRESTORE & SHEETS ---
  const handleBulkSubmit = async (e) => {
    e.preventDefault();
    let marksPayload = [];
    const currentEnrollment = loggedInTeacher.enrollments.find(e => e.id === selectedEnrollmentId);
    const maxNumber = Number(assessmentMaxMark);

    setStatusMsg('Syncing marks to high-speed database...');
    
    // 1. Save to Firebase Firestore instantly
    const firestorePromises = [];
    for (let student of classStudents) {
      let val = studentMarks[student.regNo];
      if (val !== undefined && val !== '') {
        if (parseFloat(val) > maxNumber) return alert(`Marks for ${student.firstName} exceed limit!`);
        
        // Push payload for Google Sheets backup
        marksPayload.push({
          studentId: student.regNo,
          subject: currentEnrollment.subject,
          maxMarks: assessmentMaxMark, 
          marksObtained: val
        });

        // Save directly to Firestore for lightning-fast student portal loading
        firestorePromises.push(
          setDoc(doc(db, 'marks', student.regNo), {
            [currentEnrollment.subject]: {
              [assessmentMaxMark]: Number(val)
            }
          }, { merge: true })
        );
      }
    }

    try {
      await Promise.all(firestorePromises); // Wait for Firebase save
      setStatusMsg('Firebase updated! Backing up to Google Sheets...');
      
      // 2. Background Backup to Google Sheets
      const res = await fetch(WEB_APP_URL, { method: 'POST', body: JSON.stringify({ marks: marksPayload }) });
      const result = await res.json();
      if (result.status === 'success') setStatusMsg('Marks saved successfully everywhere!');
      else setStatusMsg('Saved to Firebase, but Sheets backup error: ' + result.message);
    } catch (err) { setStatusMsg('Network error: ' + err.message); }
  };

  const validMarks = classStudents
    .map(student => studentMarks[student.regNo])
    .filter(val => val !== undefined && val !== '')
    .map(val => parseFloat(val))
    .filter(val => !isNaN(val));

  const totalStudentsWithMarks = validMarks.length;
  const highestScore = totalStudentsWithMarks > 0 ? Math.max(...validMarks) : 0;
  const classAverage = totalStudentsWithMarks > 0 ? (validMarks.reduce((acc, curr) => acc + curr, 0) / totalStudentsWithMarks).toFixed(1) : 0;
  const passingThreshold = Number(assessmentMaxMark) * 0.4;
  const passingCount = validMarks.filter(m => m >= passingThreshold).length;
  const passPercentage = totalStudentsWithMarks > 0 ? ((passingCount / totalStudentsWithMarks) * 100).toFixed(0) : 0;

  if (!isAuthenticated) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f0f2f5', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div style={{ background: '#ffffff', padding: '48px', borderRadius: '16px', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', width: '100%', maxWidth: '420px', border: '1px solid #e2e8f0' }}>
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <h2 style={{ color: '#0f172a', margin: '0 0 12px 0', fontSize: '28px', fontWeight: '800' }}>Teacher Portal</h2>
            <p style={{ color: '#64748b', fontSize: '15px', margin: 0 }}>Log in to access your subjects</p>
          </div>
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div><label style={styles.label}>Username</label><input type="text" value={username} onChange={(e) => setUsername(e.target.value)} required style={styles.input} /></div>
            <div>
              <label style={styles.label}>Password</label>
              <div style={{ display: 'flex', position: 'relative' }}>
                <input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} required style={styles.input} />
                <button type="button" onClick={() => setShowPassword(!showPassword)} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#2563eb', fontWeight: '600', cursor: 'pointer' }}>{showPassword ? "Hide" : "Show"}</button>
              </div>
            </div>
            <button type="submit" style={styles.buttonPrimary}>Sign In</button>
            {loginError && <p style={{ color: '#ef4444', fontSize: '14px', textAlign: 'center', margin: 0, fontWeight: '600' }}>{loginError}</p>}
          </form>
        </div>
      </div>
    );
  }

  const currentEnrollment = loggedInTeacher?.enrollments?.find(e => e.id === selectedEnrollmentId);

  return (
    <div style={styles.pageBackground}>
      <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px', background: '#ffffff', padding: '24px 32px', borderRadius: '16px', boxShadow: '0 4px 6px rgba(0,0,0,0.02)', border: '1px solid #e2e8f0' }}>
          <div>
            <h1 style={{ margin: '0 0 4px 0', fontSize: '24px', color: '#0f172a', fontWeight: '800' }}>Teacher Mark Entry</h1>
            <p style={{ margin: 0, color: '#64748b', fontSize: '15px' }}>Welcome back, <strong style={{ color: '#0f172a' }}>{loggedInTeacher?.fullName}</strong></p>
          </div>
          <button onClick={handleLogout} style={styles.buttonDanger}>Logout</button>
        </div>
        
        <div style={styles.card}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
            <div>
              <label style={styles.label}>Select Assigned Subject:</label>
              <select value={selectedEnrollmentId} onChange={(e) => setSelectedEnrollmentId(e.target.value)} style={{ ...styles.input, cursor: 'pointer' }}>
                {(loggedInTeacher?.enrollments || []).map(env => (
                  <option key={env.id} value={env.id}>
                    {env.alias || `Grade ${env.grade} ${env.subject}`} ({env.langTag || 'Gen'})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={styles.label}>Select Task Level:</label>
              <select value={cceLevel} onChange={(e) => setCceLevel(e.target.value)} style={{ ...styles.input, cursor: 'pointer' }}>
                {Object.keys(CCE_LEVELS).map(level => (
                  <option key={level} value={level}>{level} (Max {CCE_LEVELS[level]} Marks)</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '24px' }}>
          <div style={{ background: '#ffffff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'center', boxShadow: '0 4px 6px rgba(0,0,0,0.02)' }}>
            <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 'bold' }}>CLASS AVERAGE</span>
            <div style={{ fontSize: '24px', fontWeight: '800', color: '#0f172a', marginTop: '4px' }}>{classAverage} / {assessmentMaxMark}</div>
          </div>
          <div style={{ background: '#ffffff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'center', boxShadow: '0 4px 6px rgba(0,0,0,0.02)' }}>
            <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 'bold' }}>HIGHEST SCORE</span>
            <div style={{ fontSize: '24px', fontWeight: '800', color: '#10b981', marginTop: '4px' }}>{highestScore} / {assessmentMaxMark}</div>
          </div>
          <div style={{ background: '#ffffff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'center', boxShadow: '0 4px 6px rgba(0,0,0,0.02)' }}>
            <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 'bold' }}>PASSING RATE</span>
            <div style={{ fontSize: '24px', fontWeight: '800', color: '#2563eb', marginTop: '4px' }}>{passPercentage}%</div>
          </div>
        </div>

        <form onSubmit={handleBulkSubmit} style={styles.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', borderBottom: '2px solid #f1f5f9', paddingBottom: '12px', marginBottom: '20px', gap: '15px' }}>
            <h3 style={{ margin: 0, fontSize: '20px', color: '#0f172a', fontWeight: '700' }}>
              Enrolled Students: {currentEnrollment?.alias || `Grade ${currentEnrollment?.grade} ${currentEnrollment?.subject}`} 
              <sub style={{ color: '#64748b', marginLeft: '6px', fontWeight: 'bold' }}>{currentEnrollment?.langTag || 'Gen'}</sub>
              <span style={{ fontSize: '14px', color: '#64748b', marginLeft: '10px' }}>({classStudents.length} students)</span>
            </h3>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="button" onClick={handleDownloadMarksTemplate} style={{ padding: '8px 16px', background: '#f8fafc', color: '#334155', border: '1px solid #cbd5e1', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }}>
                📥 Download Template
              </button>
              <label style={{ padding: '8px 16px', background: '#0284c7', color: '#ffffff', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '13px', display: 'flex', alignItems: 'center' }}>
                📂 Upload CSV Marks
                <input type="file" accept=".csv" onChange={handleCSVUpload} style={{ display: 'none' }} />
              </label>
            </div>
          </div>
          
          {classStudents.length === 0 ? (
            <div style={{ padding: '30px', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '12px', textAlign: 'center', color: '#64748b', fontSize: '15px' }}>
              No students have been assigned to this subject. Please ask the Admin to map students in the Admin Portal.
            </div>
          ) : (
            <div style={{ overflowX: 'auto', marginBottom: '24px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '15px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #cbd5e1' }}>
                    <th style={{ padding: '16px', color: '#334155', width: '60px' }}>Sn</th>
                    <th style={{ padding: '16px', color: '#334155' }}>Ad.No</th>
                    <th style={{ padding: '16px', color: '#334155' }}>Student Name</th>
                    <th style={{ padding: '16px', color: '#334155' }}>Marks Obtained (Max: {assessmentMaxMark})</th>
                  </tr>
                </thead>
                <tbody>
                  {classStudents.map((student, index) => (
                    <tr key={student.regNo} style={{ borderBottom: '1px solid #e2e8f0', background: index % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                      <td style={{ padding: '16px', fontWeight: '600', color: '#64748b' }}>{student.rollNo || '-'}</td>
                      <td style={{ padding: '16px', fontWeight: '600', color: '#0f172a' }}>{student.adNo}</td>
                      <td style={{ padding: '16px', color: '#334155' }}>{student.firstName}</td>
                      <td style={{ padding: '16px' }}>
                        <input 
                          type="number" 
                          max={assessmentMaxMark} 
                          min="0" 
                          step="0.1"
                          value={studentMarks[student.regNo] !== undefined ? studentMarks[student.regNo] : ''} 
                          onChange={(e) => handleMarkChange(student.regNo, e.target.value)}
                          placeholder={`/ ${assessmentMaxMark}`}
                          style={{ padding: '10px 14px', width: '120px', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none', fontSize: '14px', color: '#0f172a', backgroundColor: '#ffffff' }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <button type="submit" disabled={classStudents.length === 0} style={{ ...styles.buttonSuccess, opacity: classStudents.length === 0 ? 0.5 : 1 }}>
            Save / Update All Marks
          </button>
        </form>

        {statusMsg && (
          <div style={{ padding: '16px', background: statusMsg.includes('Error') ? '#fee2e2' : '#ecfdf5', border: `1px solid ${statusMsg.includes('Error') ? '#fecaca' : '#a7f3d0'}`, borderRadius: '8px', color: statusMsg.includes('Error') ? '#991b1b' : '#065f46', fontWeight: '600', textAlign: 'center' }}>
            {statusMsg}
          </div>
        )}
      </div>
    </div>
  );
}