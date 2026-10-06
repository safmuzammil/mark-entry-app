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

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (user && user.email && user.email.endsWith('@school.com')) {
                router.push('/teacher');
            }
        });
        return () => unsubscribe();
    }, [router]);

    const handleLogin = async (e) => {
        e.preventDefault();
        setLoginError('');
        setIsLoading(true);

        const rawUsername = username.trim().toLowerCase();
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
                router.push('/teacher');
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

    return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f0f2f5', fontFamily: 'Inter, system-ui, sans-serif', padding: '16px', boxSizing: 'border-box' }}>
            <div style={{ width: '100%', maxWidth: '420px' }}>
                <InstallAppBanner />
                <div style={styles.card}>
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

                        <button type="submit" disabled={isLoading} style={{ ...styles.buttonPrimary, opacity: isLoading ? 0.7 : 1 }}>
                            {isLoading ? 'Signing In...' : 'Sign In'}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}