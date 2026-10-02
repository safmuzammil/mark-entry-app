'use client';
import { useState } from 'react';
import { auth, db } from '../../lib/firebase'; 
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';

const styles = {
  pageBackground: { minHeight: '100vh', backgroundColor: '#f0f2f5', padding: '40px 20px', fontFamily: 'Inter, system-ui, sans-serif', color: '#0f172a' },
  card: { background: '#ffffff', padding: '32px', borderRadius: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.05)', border: '1px solid #f1f5f9', marginBottom: '24px' },
  input: { width: '100%', padding: '12px 16px', borderRadius: '8px', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', color: '#0f172a', fontSize: '15px', outline: 'none', boxSizing: 'border-box' },
  label: { display: 'block', fontSize: '14px', fontWeight: '600', color: '#334155', marginBottom: '8px' },
  buttonPrimary: { padding: '12px 24px', background: '#2563eb', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '15px', transition: '0.2s' },
  buttonDanger: { padding: '10px 20px', background: '#fee2e2', color: '#ef4444', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '14px', transition: '0.2s' },
  badge: { display: 'inline-block', padding: '6px 12px', borderRadius: '8px', fontSize: '13px', fontWeight: '700' }
};

const printStyles = `
  @media print {
    body { background: #ffffff !important; color: #000000 !important; }
    button, input, select { display: none !important; }
    div { box-shadow: none !important; border: none !important; }
    .no-print { display: none !important; }
  }
`;

export default function StudentDashboard() {
  const [regNo, setRegNo] = useState(''); 
  const [password, setPassword] = useState('');
  
  const [authenticated, setAuthenticated] = useState(false);
  const [loggedInStudent, setLoggedInStudent] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const [isLoadingMarks, setIsLoadingMarks] = useState(false);
  const [subjectAggregates, setSubjectAggregates] = useState([]);
  const [overallStats, setOverallStats] = useState({ total1400: '-', total420: '-', rank: '-', overallStatus: '-' });

  const handleLogin = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setIsLoading(true);

    const safeRegNo = regNo.toLowerCase().replace(/[^a-z0-9_.-]/g, '');
    const fakeEmail = `${safeRegNo}@student.school.com`;
    const safeAdNo = password.trim(); 
    const firebasePassword = safeAdNo.length < 6 ? safeAdNo.padStart(6, '0') : safeAdNo;

    try {
      await signInWithEmailAndPassword(auth, fakeEmail, firebasePassword);
      const docRef = doc(db, "students", safeRegNo);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const studentData = docSnap.data();
        setLoggedInStudent(studentData);
        setAuthenticated(true);
        
        const tSnap = await getDocs(collection(db, 'teachers'));
        const mySubjects = new Set();
        
        tSnap.forEach(tDoc => {
          const tData = tDoc.data();
          (tData.enrollments || []).forEach(env => {
            if (env.studentIds && env.studentIds.includes(safeRegNo)) {
              mySubjects.add(env.subject);
            }
          });
        });

        const expectedSubjectsArray = Array.from(mySubjects);
        fetchStudentMarksFromFirebase(safeRegNo, expectedSubjectsArray); 

      } else {
        setErrorMsg('Student profile not found in database.');
      }
    } catch (err) {
      console.error("Login Error:", err.message);
      setErrorMsg('Invalid Registration Number or Admission Number.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setAuthenticated(false);
    setLoggedInStudent(null);
    setRegNo('');
    setPassword('');
    setSubjectAggregates([]);
    setOverallStats({ total1400: '-', total420: '-', rank: '-', overallStatus: '-' });
  };

  const fetchStudentMarksFromFirebase = async (studentRegNo, expectedSubjects) => {
    setIsLoadingMarks(true);
    try {
      const docSnap = await getDoc(doc(db, 'marks', studentRegNo));
      const marksData = docSnap.exists() ? docSnap.data() : {};

      const allMarksSnap = await getDocs(collection(db, 'marks'));
      let allScores = [];
      allMarksSnap.forEach(d => {
         let sTotal = 0;
         const data = d.data();
         Object.keys(data).forEach(sub => {
            if (typeof data[sub] === 'object') {
               Object.values(data[sub]).forEach(val => sTotal += Number(val));
            }
         });
         allScores.push({ id: d.id, total: sTotal });
      });
      allScores.sort((a,b) => b.total - a.total);
      let myRank = allScores.findIndex(s => s.id === studentRegNo) + 1;

      processMarksLocally(marksData, expectedSubjects, myRank);

    } catch (err) {
      console.error("Error loading marks from Firebase:", err);
    } finally {
      setIsLoadingMarks(false);
    }
  };

  // --- NEW MATH LOGIC (Matches Google Sheets) ---
  const processMarksLocally = (marksData, expectedSubjects, myRank) => {
    let total1400 = 0;
    let total420 = 0;
    let hasAnyOverallData = false;
    const subjectList = [];

    expectedSubjects.forEach(sub => {
      const normKey = sub.charAt(0).toUpperCase() + sub.slice(1).toLowerCase(); 
      const subMarks = marksData[sub] || {};
      
      let l1 = subMarks['15'] !== undefined ? Number(subMarks['15']) : '-';
      let l2 = subMarks['20'] !== undefined ? Number(subMarks['20']) : '-';
      let l3 = subMarks['25'] !== undefined ? Number(subMarks['25']) : '-';
      let l4 = subMarks['40'] !== undefined ? Number(subMarks['40']) : '-';

      let subSumObtained = 0;
      let subSumMax = 0; 
      let hasData = false;

      if (l1 !== '-') { subSumObtained += l1; subSumMax += 15; hasData = true; }
      if (l2 !== '-') { subSumObtained += l2; subSumMax += 20; hasData = true; }
      if (l3 !== '-') { subSumObtained += l3; subSumMax += 25; hasData = true; }
      if (l4 !== '-') { subSumObtained += l4; subSumMax += 40; hasData = true; }

      let total100 = hasData ? subSumObtained : '-';
      let sem30 = hasData ? Number((subSumObtained * 0.3).toFixed(1)) : '-';
      
      let status = hasData && subSumMax > 0 
        ? ((subSumObtained / subSumMax) * 100).toFixed(0) + '%' 
        : '-';

      if (hasData) {
        total1400 += total100;
        total420 += sem30;
        hasAnyOverallData = true;
      }

      subjectList.push({
        subject: normKey,
        assessments: { '15': l1, '20': l2, '25': l3, '40': l4 },
        total100: total100,
        total30: sem30,
        status: status,
        hasData
      });
    });

    let overallStatus = '-';
    if (hasAnyOverallData) {
      let overallObtained = total1400 + total420;
      let overallMax = 1820; 
      overallStatus = ((overallObtained / overallMax) * 100).toFixed(2) + '%';
    }

    setSubjectAggregates(subjectList);
    setOverallStats({
      total1400: hasAnyOverallData ? total1400 : '-',
      total420: hasAnyOverallData ? total420.toFixed(1) : '-',
      rank: hasAnyOverallData ? myRank : '-',
      overallStatus: overallStatus
    });
  };

  const handlePrintReportCard = () => {
    window.print();
  };

  if (!authenticated) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f0f2f5', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div style={{ background: '#ffffff', padding: '48px', borderRadius: '16px', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', width: '100%', maxWidth: '420px', border: '1px solid #e2e8f0' }}>
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <h2 style={{ color: '#0f172a', margin: '0 0 12px 0', fontSize: '28px', fontWeight: '800' }}>Student Portal</h2>
            <p style={{ color: '#64748b', fontSize: '15px', margin: 0 }}>Secure Login</p>
          </div>
          
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <label style={styles.label}>Registration Number</label>
              <input type="text" value={regNo} onChange={(e) => setRegNo(e.target.value)} placeholder="e.g. 726007" required style={styles.input} />
            </div>
            <div>
              <label style={styles.label}>Admission Number</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="e.g. U1278" required style={styles.input} />
            </div>
            <button type="submit" disabled={isLoading} style={{ ...styles.buttonPrimary, opacity: isLoading ? 0.7 : 1 }}>
              {isLoading ? 'Authenticating...' : 'Login to View Marks'}
            </button>
            {errorMsg && <p style={{ color: '#ef4444', fontSize: '14px', textAlign: 'center', margin: 0, fontWeight: '600', background: '#fee2e2', padding: '10px', borderRadius: '8px' }}>{errorMsg}</p>}
          </form>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.pageBackground}>
      <style dangerouslySetInnerHTML={{ __html: printStyles }} />
      <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
        
        {/* Header with Print Report Card Option */}
        <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', background: '#ffffff', padding: '24px 32px', borderRadius: '16px', boxShadow: '0 4px 6px rgba(0,0,0,0.02)', border: '1px solid #e2e8f0' }}>
          <div>
            <h1 style={{ margin: '0 0 4px 0', fontSize: '24px', color: '#0f172a', fontWeight: '800' }}>Student Academic Record</h1>
            <p style={{ margin: 0, color: '#64748b', fontSize: '15px' }}>
              Welcome, <strong style={{ color: '#0f172a' }}>{loggedInStudent?.firstName}</strong> ({loggedInStudent?.regNo})
            </p>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={handlePrintReportCard} style={{ padding: '10px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>
              🖨️ Print / Save PDF
            </button>
            <button onClick={handleLogout} style={styles.buttonDanger}>Logout</button>
          </div>
        </div>

        {/* Profile Card */}
        <div style={{ ...styles.card, padding: '20px 32px' }}>
          <div style={{ display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 'bold', textTransform: 'uppercase' }}>Department</span><br/>
              <span style={{ ...styles.badge, background: '#e0f2fe', color: '#0369a1', marginTop: '4px' }}>{loggedInStudent?.department || 'General'}</span>
            </div>
            {loggedInStudent?.classes && (
              <div>
                <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 'bold', textTransform: 'uppercase' }}>Enrolled Groups</span><br/>
                <div style={{ display: 'flex', gap: '6px', marginTop: '4px', flexWrap: 'wrap' }}>
                  {loggedInStudent.classes.map((cls, i) => (
                    <span key={i} style={{ ...styles.badge, background: '#f1f5f9', color: '#334155' }}>{cls}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Top 4 Summary Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '24px' }}>
          
          <div style={{ background: '#ffffff', padding: '24px', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px rgba(0,0,0,0.02)', textAlign: 'center' }}>
            <h4 style={{ margin: '0 0 10px 0', color: '#64748b', fontSize: '14px', textTransform: 'uppercase' }}>Total Aggregate</h4>
            <div style={{ fontSize: '32px', fontWeight: '900', color: '#0f172a' }}>
              {overallStats.total1400} <span style={{ fontSize: '18px', color: '#94a3b8', fontWeight: '600' }}>/ 1400</span>
            </div>
          </div>
          
          <div style={{ background: '#ffffff', padding: '24px', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px rgba(0,0,0,0.02)', textAlign: 'center' }}>
            <h4 style={{ margin: '0 0 10px 0', color: '#64748b', fontSize: '14px', textTransform: 'uppercase' }}>Total Sem Score</h4>
            <div style={{ fontSize: '32px', fontWeight: '900', color: '#0f172a' }}>
              {overallStats.total420} <span style={{ fontSize: '18px', color: '#94a3b8', fontWeight: '600' }}>/ 420</span>
            </div>
          </div>

          <div style={{ background: '#ffffff', padding: '24px', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px rgba(0,0,0,0.02)', textAlign: 'center' }}>
            <h4 style={{ margin: '0 0 10px 0', color: '#64748b', fontSize: '14px', textTransform: 'uppercase' }}>Class Rank</h4>
            <div style={{ fontSize: '32px', fontWeight: '900', color: '#3b82f6' }}>
              {overallStats.rank !== '-' ? `#${overallStats.rank}` : '-'}
            </div>
          </div>

          <div style={{ background: '#ffffff', padding: '24px', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px rgba(0,0,0,0.02)', textAlign: 'center' }}>
            <h4 style={{ margin: '0 0 10px 0', color: '#64748b', fontSize: '14px', textTransform: 'uppercase' }}>Overall Status</h4>
            <div style={{ fontSize: '32px', fontWeight: '900', color: '#10b981' }}>
              {overallStats.overallStatus}
            </div>
          </div>

        </div>

        {/* Detailed Marks Table */}
        <div style={styles.card}>
          <h3 style={styles.sectionTitle}>Curriculum & Detailed Performance Breakdown</h3>
          
          {isLoadingMarks ? (
            <p style={{ textAlign: 'center', color: '#64748b', padding: '20px' }}>Loading your latest data securely...</p>
          ) : subjectAggregates.length === 0 ? (
            <div style={{ padding: '20px', background: '#fef9c3', color: '#854d0e', borderRadius: '8px', border: '1px solid #fef08a', textAlign: 'center', fontWeight: '500' }}>
              You are not currently enrolled in any subjects.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', fontSize: '14px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #cbd5e1' }}>
                    <th style={{ padding: '16px', color: '#334155', textAlign: 'left' }}>Subject</th>
                    <th style={{ padding: '16px', color: '#334155' }}>L1 (15)</th>
                    <th style={{ padding: '16px', color: '#334155' }}>L2 (20)</th>
                    <th style={{ padding: '16px', color: '#334155' }}>L3 (25)</th>
                    <th style={{ padding: '16px', color: '#334155' }}>L4 (40)</th>
                    <th style={{ padding: '16px', color: '#0f172a', fontWeight: '900', borderLeft: '1px solid #e2e8f0' }}>Total (100)</th>
                    <th style={{ padding: '16px', color: '#0f172a', fontWeight: '900' }}>Sem (30)</th>
                    <th style={{ padding: '16px', color: '#0f172a', fontWeight: '900' }}>Status (%)</th>
                  </tr>
                </thead>
                <tbody>
                  {subjectAggregates.map((data, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0', background: idx % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                      <td style={{ padding: '16px', fontWeight: '700', color: '#0f172a', textAlign: 'left' }}>{data.subject}</td>
                      
                      {!data.hasData ? (
                        <td colSpan="7" style={{ padding: '16px', textAlign: 'center', color: '#94a3b8', fontStyle: 'italic', fontWeight: '600' }}>
                          Marks pending upload
                        </td>
                      ) : (
                        <>
                          <td style={{ padding: '16px', color: '#3b82f6', fontWeight: '600' }}>{data.assessments?.['15'] || '-'}</td>
                          <td style={{ padding: '16px', color: '#3b82f6', fontWeight: '600' }}>{data.assessments?.['20'] || '-'}</td>
                          <td style={{ padding: '16px', color: '#3b82f6', fontWeight: '600' }}>{data.assessments?.['25'] || '-'}</td>
                          <td style={{ padding: '16px', color: '#3b82f6', fontWeight: '600' }}>{data.assessments?.['40'] || '-'}</td>
                          
                          <td style={{ padding: '16px', fontWeight: '800', color: '#0f172a', borderLeft: '1px solid #e2e8f0' }}>{data.total100}</td>
                          <td style={{ padding: '16px', fontWeight: '800', color: '#0f172a' }}>{data.total30}</td>
                          <td style={{ padding: '16px' }}>
                            <span style={{ 
                              ...styles.badge, 
                              background: data.status !== '-' ? '#e0f2fe' : '#f1f5f9', 
                              color: data.status !== '-' ? '#0369a1' : '#64748b'
                            }}>
                              {data.status}
                            </span>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}