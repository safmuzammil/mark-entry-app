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
import {
  HighContrastStyles,
  MentorAndOutreachTab,
  PortalNotificationBanner
} from './components/ErpExtensions';

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
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const [adminTeachersList, setAdminTeachersList] = useState([]);
  const [adminStudentsList, setAdminStudentsList] = useState([]);
  const [activeOutpassesList, setActiveOutpassesList] = useState([]);
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
        getDocs(collection(db, 'students')),
        getDocs(collection(db, 'out_passes'))
      ]).then(([tSnap, sSnap, opSnap]) => {
        const tList = [];
        tSnap.forEach(d => tList.push(d.data()));
        tList.sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''));
        setAdminTeachersList(tList);
        if (tList.length > 0 && !proxyTeacherUsername) {
          setProxyTeacherUsername(tList[0].username);
        }

        const sList = [];
        sSnap.forEach(d => sList.push({ id: d.id, ...d.data() }));
        sList.sort((a, b) => (Number(a.rollNo) || 999) - (Number(b.rollNo) || 999));
        setAdminStudentsList(sList);

        const opList = [];
        opSnap.forEach(d => {
          const data = d.data();
          const st = String(data.status || '').toUpperCase();
          if (st === 'OUTSIDE' || st === 'APPROVED' || st === 'ARRIVED_AT_GATE') {
            opList.push({ id: d.id, ...data });
          }
        });
        setActiveOutpassesList(opList);
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
    const totalEnrollmentsCount = adminTeachersList.reduce((acc, t) => acc + (Array.isArray(t.enrollments) ? t.enrollments.length : 0), 0);

    // 🌟 Compute Real-Time Inside vs. Outside Campus Breakdown for Malayalam & Urdu (NIICS) Streams
    const outsideAdNosSet = new Set();
    const medicalAdNosSet = new Set();
    activeOutpassesList.forEach(p => {
      const ad = String(p.adNo || '').trim().toUpperCase();
      if (ad) {
        outsideAdNosSet.add(ad);
        if (String(p.leaveCategory || '').toLowerCase().includes('medical') || p.isOpenReturn) {
          medicalAdNosSet.add(ad);
        }
      }
    });

    const malayalamStudents = adminStudentsList.filter(s => !String(s.adNo || '').trim().toUpperCase().startsWith('U'));
    const urduStudents = adminStudentsList.filter(s => String(s.adNo || '').trim().toUpperCase().startsWith('U'));

    const malayalamOutsideCount = malayalamStudents.filter(s => outsideAdNosSet.has(String(s.adNo || '').trim().toUpperCase())).length;
    const malayalamInsideCount = Math.max(0, malayalamStudents.length - malayalamOutsideCount);
    const malayalamMedicalCount = malayalamStudents.filter(s => medicalAdNosSet.has(String(s.adNo || '').trim().toUpperCase())).length;

    const urduOutsideCount = urduStudents.filter(s => outsideAdNosSet.has(String(s.adNo || '').trim().toUpperCase())).length;
    const urduInsideCount = Math.max(0, urduStudents.length - urduOutsideCount);
    const urduMedicalCount = urduStudents.filter(s => medicalAdNosSet.has(String(s.adNo || '').trim().toUpperCase())).length;

    const totalOutsideCount = malayalamOutsideCount + urduOutsideCount;
    const totalInsideCount = Math.max(0, adminStudentsList.length - totalOutsideCount);
    const totalMedicalCount = malayalamMedicalCount + urduMedicalCount;

    const sidebarNavItems = [
      { id: 'dashboard', label: 'Dashboard', icon: '⊞', desc: 'Institutional overview & quick access' },
      { id: 'students', label: 'Students', icon: '👥', desc: 'Manage student profiles & subject mappings' },
      { id: 'teachers', label: 'Teachers', icon: '🎓', desc: 'Manage all faculty members and roles' },
      { id: 'attendance_minus', label: 'Period Attendance', icon: '📅', desc: 'Roll-call, monthly reports, minus & clearance' },
      { id: 'attendance', label: 'Night Attendance', icon: '🌙', desc: 'Hostel roll-call & out-pass verification' },
      { id: 'reports', label: 'Marks & Auditor', icon: '📊', desc: 'CCE mark auditor & level-by-level inspector' },
      { id: 'outpass', label: 'Out-Pass Portal', icon: '🪪', desc: 'Live campus movement & leave approvals' },
      { id: 'mentorship', label: 'Mentorship & Outreach', icon: '🧭', desc: 'Consultancy logs, skills & usthad audit' },
      { id: 'reminders', label: 'Weekly Reminders', icon: '🔔', desc: 'Academic target broadcasts & tracker' },
      { id: 'proxy_marks', label: 'Proxy Mark Entry', icon: '✍️', desc: 'Inspect or enter marks on behalf of faculty' }
    ];

    const currentTabObj = sidebarNavItems.find(x => x.id === activeAdminTab) || sidebarNavItems[0];

    return (
      <div style={{ minHeight: '100vh', display: 'flex', backgroundColor: '#f8fafc', fontFamily: 'Inter, system-ui, -apple-system, sans-serif', color: '#0f172a' }}>
        <HighContrastStyles />
        <style>{`
          @media (max-width: 960px) {
            .dhiu-sidebar {
              position: fixed !important;
              top: 0;
              left: 0;
              bottom: 0;
              z-index: 1200;
              transform: translateX(-100%);
              transition: transform 0.25s ease;
            }
            .dhiu-sidebar.open {
              transform: translateX(0);
            }
            .dhiu-mobile-menu-btn {
              display: inline-flex !important;
            }
          }
        `}</style>

        {mobileSidebarOpen && (
          <div
            onClick={() => setMobileSidebarOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.4)', zIndex: 1150 }}
          />
        )}

        {/* 🌟 LEFT SIDEBAR NAVIGATION (Named "DHIU Campus") */}
        <aside
          className={`dhiu-sidebar ${mobileSidebarOpen ? 'open' : ''}`}
          style={{
            width: '255px',
            minWidth: '255px',
            backgroundColor: '#ffffff',
            borderRight: '1px solid #e2e8f0',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            position: 'sticky',
            top: 0,
            height: '100vh',
            overflowY: 'auto',
            padding: '20px 14px',
            boxSizing: 'border-box'
          }}
        >
          <div>
            <div
              onClick={() => { setActiveAdminTab('dashboard'); setMobileSidebarOpen(false); }}
              style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '4px 10px 20px', borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}
            >
              <img src={DHIU_LOGO_URL} alt="DHIU" style={{ width: '40px', height: '40px', borderRadius: '10px', objectFit: 'contain', border: '1px solid #e2e8f0', padding: '2px' }} />
              <div>
                <div style={{ fontSize: '17px', fontWeight: '800', color: '#0f172a', lineHeight: 1.2 }}>DHIU Campus</div>
                <div style={{ fontSize: '10px', fontWeight: '800', color: '#4f46e5', letterSpacing: '0.6px', textTransform: 'uppercase', marginTop: '2px' }}>
                  🛡️ ADMIN PORTAL
                </div>
              </div>
            </div>

            <div style={{ fontSize: '11px', fontWeight: '800', color: '#94a3b8', letterSpacing: '0.8px', padding: '18px 12px 8px', textTransform: 'uppercase' }}>
              NAVIGATION
            </div>

            <nav style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {sidebarNavItems.map(item => {
                const isActive = activeAdminTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveAdminTab(item.id);
                      setMobileSidebarOpen(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      width: '100%',
                      padding: '11px 14px',
                      borderRadius: '10px',
                      border: isActive ? '1.5px solid #1e1b4b' : '1.5px solid transparent',
                      backgroundColor: isActive ? '#4f46e5' : 'transparent',
                      color: isActive ? '#ffffff' : '#475569',
                      fontWeight: isActive ? '700' : '600',
                      fontSize: '14px',
                      textAlign: 'left',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <span style={{ fontSize: '16px', opacity: isActive ? 1 : 0.75 }}>{item.icon}</span>
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <Link
              href="/outpass"
              style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', borderRadius: '8px', background: '#f8fafc', color: '#334155', textDecoration: 'none', fontSize: '13px', fontWeight: '700', border: '1px solid #e2e8f0' }}
            >
              <span>🛡️</span> Gate Security Kiosk
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', borderRadius: '8px', background: '#fff1f2', color: '#e11d48', border: '1px solid #ffe4e6', fontSize: '13px', fontWeight: '700', cursor: 'pointer', width: '100%', textAlign: 'left' }}
            >
              <span>🚪</span> Sign Out
            </button>
          </div>
        </aside>

        {/* 🌟 MAIN CONTENT AREA */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <header style={{ backgroundColor: '#ffffff', borderBottom: '1px solid #e2e8f0', padding: '14px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', position: 'sticky', top: 0, zIndex: 90 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button
                type="button"
                className="dhiu-mobile-menu-btn"
                onClick={() => setMobileSidebarOpen(true)}
                style={{ display: 'none', padding: '8px 12px', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', fontSize: '16px' }}
              >
                ☰
              </button>
              <span style={{ background: '#f8fafc', color: '#4f46e5', border: '1px solid #e2e8f0', padding: '6px 14px', borderRadius: '999px', fontSize: '11px', fontWeight: '800', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                🛡️ DEGREE SECTION ERP
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '18px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#f8fafc', padding: '7px 14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                <span style={{ fontSize: '16px', color: '#4f46e5' }}>🏢</span>
                <div>
                  <div style={{ fontSize: '12px', fontWeight: '800', color: '#0f172a' }}>Sayyid Muhammed Ali Shihab Thangal Building</div>
                  <div style={{ fontSize: '10px', color: '#64748b', fontWeight: '600' }}>Darul Huda Islamic University, Chemmad, Kerala, India</div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#4f46e5', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '800', fontSize: '14px' }}>
                  A
                </div>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: '800', color: '#0f172a' }}>ADMIN USER</div>
                  <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '600' }}>Admin</div>
                </div>
              </div>
            </div>
          </header>

          <main style={{ padding: '28px', maxWidth: '1280px', width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
            <InstallAppBanner />

            {/* 🌟 TARGETED PORTAL NOTIFICATION CENTER FOR ADMIN */}
            <PortalNotificationBanner
              viewerRole="admin"
              viewerId="admin"
              canSendMessages={true}
              senderName="Central Admin"
              senderRole="admin"
              senderUsername="admin"
              studentsList={adminStudentsList}
              teachersList={adminTeachersList}
            />

            {activeAdminTab !== 'teachers' && activeAdminTab !== 'students' && (
              <div style={{ marginBottom: '22px' }}>
                <h1 style={{ margin: 0, fontSize: '24px', fontWeight: '800', color: '#0f172a' }}>{currentTabObj.label}</h1>
                <p style={{ margin: '4px 0 0', fontSize: '14px', color: '#64748b', fontWeight: '500' }}>{currentTabObj.desc}</p>
              </div>
            )}

            {activeAdminTab === 'dashboard' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
                {/* 🌟 UPGRADED KPI STRIP WITH LIVE INSIDE vs. OUTSIDE CAMPUS FOR BOTH STREAMS */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(235px, 1fr))', gap: '16px' }}>
                  <div
                    onClick={() => setActiveAdminTab('outpass')}
                    style={{ background: '#f8fafc', padding: '20px', borderRadius: '14px', border: '1px solid #e2e8f0', textAlign: 'center', cursor: 'pointer' }}
                  >
                    <span style={{ fontSize: '11px', fontWeight: '800', color: '#475569', textTransform: 'uppercase' }}>TOTAL CAMPUS STRENGTH</span>
                    <div style={{ fontSize: '28px', fontWeight: '900', color: '#0f172a', marginTop: '6px' }}>{adminStudentsList.length}</div>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
                      <span style={{ background: '#dcfce7', color: '#15803d', padding: '3px 9px', borderRadius: '999px', fontSize: '11px', fontWeight: '800' }}>
                        🟢 {totalInsideCount} Inside
                      </span>
                      <span style={{ background: '#fef3c7', color: '#b45309', padding: '3px 9px', borderRadius: '999px', fontSize: '11px', fontWeight: '800' }}>
                        🟠 {totalOutsideCount} Out {totalMedicalCount > 0 ? `(🏥 ${totalMedicalCount} Med)` : ''}
                      </span>
                    </div>
                  </div>

                  <div
                    onClick={() => setActiveAdminTab('outpass')}
                    style={{ background: '#ecfdf5', padding: '20px', borderRadius: '14px', border: '1px solid #a7f3d0', textAlign: 'center', cursor: 'pointer' }}
                  >
                    <span style={{ fontSize: '11px', fontWeight: '800', color: '#047857', textTransform: 'uppercase' }}>MALAYALAM (GENERAL) STREAM</span>
                    <div style={{ fontSize: '28px', fontWeight: '900', color: '#065f46', marginTop: '6px' }}>
                      {malayalamStudents.length}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
                      <span style={{ background: '#ffffff', color: '#047857', border: '1px solid #a7f3d0', padding: '3px 9px', borderRadius: '999px', fontSize: '11px', fontWeight: '800' }}>
                        🟢 {malayalamInsideCount} Inside
                      </span>
                      <span style={{ background: '#ffffff', color: '#d97706', border: '1px solid #fde68a', padding: '3px 9px', borderRadius: '999px', fontSize: '11px', fontWeight: '800' }}>
                        🟠 {malayalamOutsideCount} Outside
                      </span>
                    </div>
                  </div>

                  <div
                    onClick={() => setActiveAdminTab('outpass')}
                    style={{ background: '#fff1f2', padding: '20px', borderRadius: '14px', border: '1px solid #fecdd3', textAlign: 'center', cursor: 'pointer' }}
                  >
                    <span style={{ fontSize: '11px', fontWeight: '800', color: '#be123c', textTransform: 'uppercase' }}>URDU (NIICS) STREAM</span>
                    <div style={{ fontSize: '28px', fontWeight: '900', color: '#9f1239', marginTop: '6px' }}>
                      {urduStudents.length}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
                      <span style={{ background: '#ffffff', color: '#047857', border: '1px solid #a7f3d0', padding: '3px 9px', borderRadius: '999px', fontSize: '11px', fontWeight: '800' }}>
                        🟢 {urduInsideCount} Inside
                      </span>
                      <span style={{ background: '#ffffff', color: '#e11d48', border: '1px solid #fecdd3', padding: '3px 9px', borderRadius: '999px', fontSize: '11px', fontWeight: '800' }}>
                        🟠 {urduOutsideCount} Outside
                      </span>
                    </div>
                  </div>

                  <div
                    onClick={() => setActiveAdminTab('teachers')}
                    style={{ background: '#eff6ff', padding: '20px', borderRadius: '14px', border: '1px solid #bfdbfe', textAlign: 'center', cursor: 'pointer' }}
                  >
                    <span style={{ fontSize: '11px', fontWeight: '800', color: '#1d4ed8', textTransform: 'uppercase' }}>FACULTY &amp; COURSES</span>
                    <div style={{ fontSize: '28px', fontWeight: '900', color: '#1e40af', marginTop: '6px' }}>
                      {adminTeachersList.length} <span style={{ fontSize: '15px', fontWeight: '700', color: '#64748b' }}>({totalEnrollmentsCount} Batches)</span>
                    </div>
                    <div style={{ marginTop: '10px', fontSize: '11px', fontWeight: '700', color: '#1d4ed8' }}>
                      Active Subject Batches &amp; Mentors
                    </div>
                  </div>
                </div>

                {/* CLEAN MINIMALIST MODULE CARDS (Without "Open Module ->" text!) */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: '16px' }}>
                  {sidebarNavItems.filter(i => i.id !== 'dashboard').map(item => (
                    <div
                      key={item.id}
                      onClick={() => setActiveAdminTab(item.id)}
                      style={{
                        background: '#ffffff',
                        padding: '22px',
                        borderRadius: '14px',
                        border: '1px solid #e2e8f0',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '14px',
                        boxShadow: '0 1px 3px rgba(15, 23, 42, 0.03)',
                        transition: 'border-color 0.15s ease, transform 0.15s ease'
                      }}
                    >
                      <div style={{ width: '44px', height: '44px', borderRadius: '10px', background: '#eef2ff', color: '#4f46e5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', flexShrink: 0 }}>
                        {item.icon}
                      </div>
                      <div>
                        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800', color: '#0f172a' }}>{item.label}</h3>
                        <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b', fontWeight: '500', lineHeight: 1.4 }}>{item.desc}</p>
                      </div>
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
                onStudentsUpdated={(nextStudents) => setAdminStudentsList(nextStudents)}
                onTeachersUpdated={(nextTeachers) => setAdminTeachersList(nextTeachers)}
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
                <div style={{ ...styles.card, background: '#f8fafc', border: '1px solid #cbd5e1', marginBottom: '20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '16px', color: '#0f172a', fontWeight: '800' }}>👨‍🏫 Select Faculty Account to Inspect / Enter Marks:</h3>
                    </div>
                    <select value={proxyTeacherUsername} onChange={(e) => setProxyTeacherUsername(e.target.value)} style={{ ...styles.input, maxWidth: '360px' }}>
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
                    embeddedInAdmin={true}
                    onLogout={() => setActiveAdminTab('teachers')}
                  />
                )}
              </div>
            )}
          </main>
        </div>
      </div>
    );
  }

  if (userRole === 'teacher') {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <HighContrastStyles />
        <TeacherPortalView loggedInTeacher={loggedInTeacherData} onLogout={handleLogout} />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc', fontFamily: 'Inter, system-ui, sans-serif', padding: '16px' }}>
      <HighContrastStyles />
      <div style={{ width: '100%', maxWidth: '420px' }}>
        <InstallAppBanner />
        <div style={{ background: '#ffffff', padding: '38px 32px', borderRadius: '16px', boxShadow: '0 4px 20px rgba(15, 23, 42, 0.05)', border: '1px solid #e2e8f0' }}>
          <div style={{ textAlign: 'center', marginBottom: '28px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <img src={DHIU_LOGO_URL} alt="DHIU Logo" style={{ width: '68px', height: '68px', borderRadius: '50%', objectFit: 'contain', marginBottom: '12px' }} />
            <h2 style={{ color: '#0f172a', margin: '0 0 6px 0', fontSize: '24px', fontWeight: '800' }}>DHIU Campus ERP</h2>
            <p style={{ color: '#64748b', fontSize: '14px', margin: 0, fontWeight: '500' }}>Sign in as Student, Faculty, or Admin</p>
          </div>

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <div>
              <label style={styles.label}>Username or Reg.No</label>
              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. admin, teacher_name, or 726007" required style={styles.input} />
            </div>
            <div>
              <label style={styles.label}>Password or Admission No. (Ad.No)</label>
              <div style={{ position: 'relative' }}>
                <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="•••••••• or U1278" required style={{ ...styles.input, paddingRight: '65px' }} />
                <button type="button" onClick={() => setShowPassword(!showPassword)} style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#4f46e5', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}>
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            {loginError && <div style={{ padding: '12px', background: '#fff1f2', color: '#e11d48', borderRadius: '8px', fontSize: '13px', fontWeight: '700', textAlign: 'center', border: '1px solid #ffe4e6' }}>{loginError}</div>}
            <button type="submit" disabled={isLoading} style={{ ...styles.buttonPrimary, width: '100%', padding: '13px', fontWeight: '700' }}>
              {isLoading ? 'Signing In...' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}