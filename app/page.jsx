'use client';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { auth, db } from '../lib/firebase';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from 'firebase/auth';
import { doc, getDoc, getDocs, collection } from 'firebase/firestore';

import InstallAppBanner from './components/InstallAppBanner';
import TeacherPortalView from './components/TeacherPortalView';
import TeacherManager from './components/TeacherManager';
import StudentManager from './components/StudentManager';
import ReportManager from './components/ReportManager';
import ReminderManager from './components/ReminderManager';
import NightAttendanceManager from './components/NightAttendanceManager';
import OutPassPortal from './outpass/page';
import PeriodAttendanceManager from './components/PeriodAttendanceManager';
import { DHIU_LOGO_URL, styles } from './components/erpConstants';
import { HighContrastStyles, MentorAndOutreachTab } from './components/ErpExtensions';

const ADMIN_AUTH_EMAILS = [
  'admin@school.com',
  'admin@dhiu.in',
  'admin@gmail.com',
  'dhdegreeclearance@gmail.com'
];

export default function UnifiedSchoolPortal() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const [userRole, setUserRole] = useState(null); // 'admin' | 'teacher'
  const [loggedInTeacherData, setLoggedInTeacherData] = useState(null);
  const [activeAdminTab, setActiveAdminTab] = useState('dashboard');

  const [adminTeachersList, setAdminTeachersList] = useState([]);
  const [adminStudentsList, setAdminStudentsList] = useState([]);
  const [proxyTeacherUsername, setProxyTeacherUsername] = useState('');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user || !user.email) {
        setUserRole(null);
        setLoggedInTeacherData(null);
        return;
      }

      const emailLower = user.email.toLowerCase().trim();

      if (ADMIN_AUTH_EMAILS.includes(emailLower)) {
        setUserRole('admin');
        return;
      }

      if (emailLower.endsWith('@student.school.com')) {
        router.push('/student');
        return;
      }

      if (emailLower.endsWith('@school.com')) {
        const safeUsername = emailLower.split('@')[0];
        const docSnap = await getDoc(doc(db, 'teachers', safeUsername));
        if (docSnap.exists()) {
          setLoggedInTeacherData(docSnap.data());
          setUserRole('teacher');
        }
      }
    });
    return () => unsubscribe();
  }, [router]);

  useEffect(() => {
    if (userRole === 'admin') {
      Promise.all([
        getDocs(collection(db, 'teachers')),
        getDocs(collection(db, 'students'))
      ]).then(([tSnap, sSnap]) => {
        const tList = [];
        tSnap.forEach(d => tList.push(d.data()));
        tList.sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''));
        setAdminTeachersList(tList);
        if (tList.length > 0 && !proxyTeacherUsername) {
          setProxyTeacherUsername(tList[0].username);
        }

        const sList = [];
        sSnap.forEach(d => sList.push(d.data()));
        sList.sort((a, b) => (Number(a.rollNo) || 999) - (Number(b.rollNo) || 999));
        setAdminStudentsList(sList);
      }).catch(err => console.error('Error loading admin data:', err));
    }
  }, [userRole]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    setIsLoading(true);

    const rawInput = username.trim().toLowerCase();
    const cleanPassword = password.trim();

    try {
      const usernamePrefix = rawInput.split('@')[0];
      const safeUsername = usernamePrefix.replace(/[^a-z0-9_.-]/g, '');

      let isStudentLogin = false;
      let finalTargetEmail = '';

      if (rawInput.includes('@')) {
        finalTargetEmail = rawInput;
        isStudentLogin = finalTargetEmail.endsWith('@student.school.com');
        const firebasePassword = isStudentLogin
          ? (cleanPassword.length < 6 ? cleanPassword.padStart(6, '0') : cleanPassword)
          : cleanPassword;

        await signInWithEmailAndPassword(auth, finalTargetEmail, firebasePassword);
      } else {
        const studentPassword = cleanPassword.length < 6 ? cleanPassword.padStart(6, '0') : cleanPassword;
        const studentEmailAttempt = `${safeUsername}@student.school.com`;
        const teacherEmailAttempt = `${safeUsername}@school.com`;

        try {
          await signInWithEmailAndPassword(auth, studentEmailAttempt, studentPassword);
          isStudentLogin = true;
          finalTargetEmail = studentEmailAttempt;
        } catch (studentErr) {
          try {
            await signInWithEmailAndPassword(auth, teacherEmailAttempt, cleanPassword);
            isStudentLogin = false;
            finalTargetEmail = teacherEmailAttempt;
          } catch (teacherErr) {
            if (safeUsername === 'admin' && cleanPassword.length >= 6) {
              await createUserWithEmailAndPassword(auth, 'admin@school.com', cleanPassword);
              isStudentLogin = false;
              finalTargetEmail = 'admin@school.com';
            } else {
              throw teacherErr;
            }
          }
        }
      }

      if (isStudentLogin || finalTargetEmail.endsWith('@student.school.com')) {
        router.push('/student');
        return;
      }

      if (ADMIN_AUTH_EMAILS.includes(finalTargetEmail.toLowerCase())) {
        setUserRole('admin');
      } else {
        const docSnap = await getDoc(doc(db, 'teachers', safeUsername));
        if (docSnap.exists()) {
          setLoggedInTeacherData(docSnap.data());
          setUserRole('teacher');
        } else {
          setLoginError('User profile data not found.');
          await signOut(auth);
        }
      }
    } catch (err) {
      setLoginError('Incorrect username/Reg.No or password/Ad.No.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setUserRole(null);
    setLoggedInTeacherData(null);
    setUsername('');
    setPassword('');
  };

  if (userRole === 'admin') {
    const selectedProxyTeacher = adminTeachersList.find(t => t.username === proxyTeacherUsername);

    const metroTiles = [
      { id: 'students', title: '1. Student Management', sub: 'Registration, 14-Subject Auto-Map & CSV', icon: '👨‍🎓', bg: '#0284c7', action: () => setActiveAdminTab('students') },
      { id: 'teachers', title: '2. Teachers & Roles', sub: 'Assign Roles, NIICS, Privileges & Broadcast', icon: '🛡️', bg: '#dc2626', action: () => setActiveAdminTab('teachers') },
      { id: 'reports', title: '3. Student Filtering & Marks', sub: 'Marks Auditor, Inspector & Analytics', icon: '📊', bg: '#0891b2', action: () => setActiveAdminTab('reports') },
      { id: 'outpass', title: '4. Out-Pass Portal', sub: 'Live Campus Movement & Leave Tracking', icon: '🪪', bg: '#65a30d', action: () => setActiveAdminTab('outpass') },
      { id: 'mentorship', title: '5. Mentor & Performance', sub: 'Mentee Consultations, Skills & Outreach', icon: '🧭', bg: '#0d9488', action: () => setActiveAdminTab('mentorship') },
      { id: 'proxy_marks', title: '6. Proxy Mark Entry', sub: 'Enter or Unlock Marks for Any Teacher', icon: '📝', bg: '#ea580c', action: () => setActiveAdminTab('proxy_marks') },
      { id: 'reminders', title: '7. Weekly Reminders', sub: 'Notice Board & Staff Group Tracker', icon: '🔔', bg: '#9333ea', action: () => setActiveAdminTab('reminders') },
      { id: 'attendance', title: '8. Night Attendance', sub: 'Daily Roll-Call, Out-Pass Sync & Absentees', icon: '🌙', bg: '#1e293b', action: () => setActiveAdminTab('attendance') },
      { id: 'attendance_minus', title: '9. Period Attendance & Minus', sub: 'Period Roll-Call, Minus, Clearance & Shortage', icon: '📅', bg: '#be123c', action: () => setActiveAdminTab('attendance_minus') }
    ];

    const totalEnrollmentsCount = adminTeachersList.reduce((acc, t) => acc + (Array.isArray(t.enrollments) ? t.enrollments.length : 0), 0);

    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#f1f5f9', fontFamily: 'Inter, system-ui, sans-serif', color: '#0f172a' }}>
        <HighContrastStyles />

        <div style={{ background: '#00a8b5', color: '#ffffff', padding: '14px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', position: 'sticky', top: 0, zIndex: 100 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', cursor: 'pointer' }} onClick={() => setActiveAdminTab('dashboard')}>
            <span style={{ fontSize: '22px', background: 'rgba(255,255,255,0.2)', padding: '6px 10px', borderRadius: '8px' }}>☰</span>
            <img src={DHIU_LOGO_URL} alt="DHIU" style={{ width: '44px', height: '44px', borderRadius: '50%', background: '#fff', padding: '2px', objectFit: 'contain' }} />
            <div>
              <div style={{ fontSize: '18px', fontWeight: '800' }}>Darul Huda Degree Institution</div>
              <div style={{ fontSize: '11px', color: '#e0f2fe', fontWeight: '700' }}>Central Admin ERP • Marks, Out-Pass, Period &amp; Night Attendance &amp; Mentorship</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            {activeAdminTab !== 'dashboard' && (
              <button onClick={() => setActiveAdminTab('dashboard')} style={{ padding: '8px 14px', background: '#ffffff', color: '#00a8b5', border: 'none', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', fontSize: '13px' }}>
                🏠 Dashboard Tiles
              </button>
            )}
            <Link href="/outpass" style={{ padding: '8px 14px', background: '#0f172a', color: '#ffffff', borderRadius: '8px', fontWeight: '800', textDecoration: 'none', fontSize: '13px' }}>
              🛡️ Full-Screen Gate Kiosk
            </Link>
            <button onClick={handleLogout} style={styles.buttonDanger}>Logout</button>
          </div>
        </div>

        <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '24px 16px' }}>
          <InstallAppBanner />

          <div style={{ background: '#ffffff', padding: '12px 18px', borderRadius: '12px', border: '1px solid #cbd5e1', marginBottom: '22px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {[
                { id: 'dashboard', label: '🏠 Home Grid' },
                { id: 'students', label: '1. Students' },
                { id: 'teachers', label: '2. Teachers & Roles' },
                { id: 'reports', label: '3. Marks & Reports' },
                { id: 'outpass', label: '4. 🪪 Out-Pass Portal' },
                { id: 'mentorship', label: '5. 🧭 Mentorship' },
                { id: 'proxy_marks', label: '6. 📝 Proxy Marks' },
                { id: 'reminders', label: '7. 🔔 Reminders' },
                { id: 'attendance', label: '8. 🌙 Night Attendance' },
                { id: 'attendance_minus', label: '9. 📅 Period Attendance & Clearance' }
              ].map(t => (
                <button
                  key={t.id}
                  onClick={() => setActiveAdminTab(t.id)}
                  style={{
                    padding: '8px 13px', borderRadius: '8px', border: 'none', fontSize: '13px', fontWeight: '800', cursor: 'pointer',
                    background: activeAdminTab === t.id ? '#00a8b5' : '#f1f5f9',
                    color: activeAdminTab === t.id ? '#ffffff' : '#0f172a'
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {activeAdminTab === 'dashboard' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              {/* SHUHOOD-STYLE INSTITUTIONAL SUMMARY CARDS */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                <div style={{ background: '#ffffff', padding: '20px', borderRadius: '14px', border: '1px solid #cbd5e1', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
                  <span style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>Total Students</span>
                  <div style={{ fontSize: '28px', fontWeight: '900', color: '#0f172a', marginTop: '6px' }}>{adminStudentsList.length}</div>
                  <span style={{ fontSize: '11px', color: '#059669', fontWeight: '700' }}>Active Enrolled</span>
                </div>

                <div style={{ background: '#ffffff', padding: '20px', borderRadius: '14px', border: '1px solid #cbd5e1', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
                  <span style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>Total Teachers</span>
                  <div style={{ fontSize: '28px', fontWeight: '900', color: '#0f172a', marginTop: '6px' }}>{adminTeachersList.length}</div>
                  <span style={{ fontSize: '11px', color: '#2563eb', fontWeight: '700' }}>Faculty Members</span>
                </div>

                <div style={{ background: '#ffffff', padding: '20px', borderRadius: '14px', border: '1px solid #cbd5e1', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
                  <span style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>Malayalam Students</span>
                  <div style={{ fontSize: '28px', fontWeight: '900', color: '#0f766e', marginTop: '6px' }}>
                    {adminStudentsList.filter(s => !String(s.adNo || '').toUpperCase().startsWith('U')).length}
                  </div>
                  <span style={{ fontSize: '11px', color: '#0f766e', fontWeight: '700' }}>General Stream</span>
                </div>

                <div style={{ background: '#ffffff', padding: '20px', borderRadius: '14px', border: '1px solid #cbd5e1', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
                  <span style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>Urdu Students</span>
                  <div style={{ fontSize: '28px', fontWeight: '900', color: '#d97706', marginTop: '6px' }}>
                    {adminStudentsList.filter(s => String(s.adNo || '').toUpperCase().startsWith('U')).length}
                  </div>
                  <span style={{ fontSize: '11px', color: '#d97706', fontWeight: '700' }}>NIICS / Urdu Stream</span>
                </div>

                <div style={{ background: '#ffffff', padding: '20px', borderRadius: '14px', border: '1px solid #cbd5e1', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
                  <span style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>Active Courses</span>
                  <div style={{ fontSize: '28px', fontWeight: '900', color: '#be123c', marginTop: '6px' }}>{totalEnrollmentsCount}</div>
                  <span style={{ fontSize: '11px', color: '#be123c', fontWeight: '700' }}>Subject Batches</span>
                </div>
              </div>

              {/* 9 METRO TILES */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
                {metroTiles.map((item) => (
                  <div
                    key={item.id}
                    onClick={item.action}
                    style={{
                      background: item.bg,
                      padding: '26px 22px',
                      borderRadius: '16px',
                      color: '#ffffff',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      textAlign: 'center',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                    }}
                  >
                    <div style={{ fontSize: '40px', marginBottom: '12px' }}>{item.icon}</div>
                    <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: '900' }}>{item.title}</h3>
                    <p style={{ margin: 0, fontSize: '12px', fontWeight: '600', opacity: 0.92 }}>{item.sub}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeAdminTab === 'teachers' && (
            <TeacherManager
              onOpenProxyMarks={(teacherUsername) => {
                setProxyTeacherUsername(teacherUsername);
                setActiveAdminTab('proxy_marks');
              }}
            />
          )}
          {activeAdminTab === 'students' && <StudentManager />}
          {activeAdminTab === 'reports' && <ReportManager />}

          {activeAdminTab === 'attendance_minus' && (
            <PeriodAttendanceManager
              userRole="admin"
              loggedInUser={{ username: 'admin', fullName: 'Central Admin' }}
              preloadedStudents={adminStudentsList}
              preloadedTeachers={adminTeachersList}
            />
          )}

          {activeAdminTab === 'reminders' && <ReminderManager />}

          {activeAdminTab === 'outpass' && (
            <OutPassPortal
              embeddedMode={true}
              isAdminProp={true}
              preloadedStudents={adminStudentsList}
              preloadedTeachers={adminTeachersList}
            />
          )}

          {activeAdminTab === 'attendance' && (
            <NightAttendanceManager
              isAdmin={true}
              preloadedStudents={adminStudentsList}
              preloadedTeachers={adminTeachersList}
            />
          )}

          {activeAdminTab === 'mentorship' && (
            <MentorAndOutreachTab
              students={adminStudentsList}
              teachers={adminTeachersList}
              isAdmin={true}
              isOutreachView={true}
              onStudentUpdated={(updated) => setAdminStudentsList(prev => prev.map(s => s.regNo === updated.regNo ? updated : s))}
            />
          )}

          {activeAdminTab === 'proxy_marks' && (
            <div>
              <div style={{ ...styles.card, background: '#ecfdf5', border: '2px solid #10b981', marginBottom: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '20px', color: '#065f46', fontWeight: '800' }}>👨‍🏫 Admin Proxy Mode: Select Teacher Account</h3>
                  </div>
                  <select value={proxyTeacherUsername} onChange={(e) => setProxyTeacherUsername(e.target.value)} style={{ ...styles.input, maxWidth: '380px' }}>
                    {adminTeachersList.map(t => (
                      <option key={t.username} value={t.username}>{t.fullName} (@{t.username})</option>
                    ))}
                  </select>
                </div>
              </div>
              {selectedProxyTeacher && (
                <TeacherPortalView
                  key={selectedProxyTeacher.username}
                  loggedInTeacher={selectedProxyTeacher}
                  onLogout={() => setActiveAdminTab('teachers')}
                />
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (userRole === 'teacher') {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#f0f2f5', padding: '28px 16px', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <HighContrastStyles />
        <div style={{ maxWidth: '1260px', margin: '0 auto' }}>
          <InstallAppBanner />
          <TeacherPortalView loggedInTeacher={loggedInTeacherData} onLogout={handleLogout} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f0f2f5', fontFamily: 'Inter, system-ui, sans-serif', padding: '16px' }}>
      <HighContrastStyles />
      <div style={{ width: '100%', maxWidth: '440px' }}>
        <InstallAppBanner />
        <div style={{ background: '#ffffff', padding: '40px 32px', borderRadius: '16px', boxShadow: '0 10px 25px rgba(0,0,0,0.08)', border: '1px solid #cbd5e1' }}>
          <div style={{ textAlign: 'center', marginBottom: '32px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <img src={DHIU_LOGO_URL} alt="DHIU Logo" style={{ width: '76px', height: '76px', borderRadius: '50%', objectFit: 'contain', marginBottom: '12px' }} />
            <h2 style={{ color: '#0f172a', margin: '0 0 8px 0', fontSize: '26px', fontWeight: '800' }}>School Portal</h2>
            <p style={{ color: '#475569', fontSize: '15px', margin: 0, fontWeight: '600' }}>Sign in as Student, Teacher, or Admin</p>
          </div>

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <label style={styles.label}>Username or Reg.No</label>
              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. admin, teacher_name, or 726007" required style={styles.input} />
            </div>
            <div>
              <label style={styles.label}>Password or Admission No. (Ad.No)</label>
              <div style={{ position: 'relative' }}>
                <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="•••••••• or U1278" required style={{ ...styles.input, paddingRight: '65px' }} />
                <button type="button" onClick={() => setShowPassword(!showPassword)} style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#2563eb', fontWeight: '800', cursor: 'pointer' }}>
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            {loginError && <div style={{ padding: '12px', background: '#fef2f2', color: '#b91c1c', borderRadius: '8px', fontSize: '14px', fontWeight: '700', textAlign: 'center' }}>{loginError}</div>}
            <button type="submit" disabled={isLoading} style={{ ...styles.buttonPrimary, width: '100%', padding: '14px', fontWeight: '800' }}>
              {isLoading ? 'Signing In...' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}