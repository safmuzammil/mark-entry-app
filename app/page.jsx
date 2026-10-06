'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { auth, db } from '../lib/firebase';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import InstallAppBanner from './components/InstallAppBanner';


const styles = {
    card: { background: '#ffffff', padding: '40px 24px', borderRadius: '16px', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', border: '1px solid #e2e8f0', boxSizing: 'border-box' },
    input: { width: '100%', padding: '12px 16px', borderRadius: '8px', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', color: '#0f172a', fontSize: '15px', outline: 'none', boxSizing: 'border-box' },
    label: { display: 'block', fontSize: '14px', fontWeight: '600', color: '#334155', marginBottom: '8px' },
    buttonPrimary: { padding: '12px 24px', background: '#2563eb', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '15px', width: '100%' }
};

export default function UnifiedSchoolPortal() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loginError, setLoginError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const router = useRouter();

    const [userRole, setUserRole] = useState(null); 
    const [loggedInTeacherData, setLoggedInTeacherData] = useState(null);

    // 🌟 FIXED: Now checks for BOTH Admin and Teacher persistent sessions
    useEffect(() => {
        // 1. Check if admin is already logged in
        if (localStorage.getItem('isAdminAuth') === 'true') {
            setUserRole('admin');
        }

        // 2. Check if teacher is already logged in
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
        const safeUsername = rawUsername.replace(/[^a-z0-9_.-]/g, '');

        // 🌟 FIXED: Instantly load the Admin Dashboard without redirecting to a broken URL
        if (rawUsername === 'admin' && password === 'admin123') {
            localStorage.setItem('isAdminAuth', 'true');
            setUserRole('admin'); 
            setIsLoading(false);
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

    // 🌟 FIXED: Ensures the admin local storage is cleared when logging out
    const handleLogout = async () => {
        await signOut(auth);
        localStorage.removeItem('isAdminAuth');
        setUserRole(null);
        setLoggedInTeacherData(null);
        setUsername(''); 
        setPassword('');
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