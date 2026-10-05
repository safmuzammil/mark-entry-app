// app/page.jsx
import AdminPage from './admin/page';

export default function RootAdminPage() {
  return <AdminPage />;
}// app/page.jsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth, db } from '../lib/firebase';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import InstallAppBanner from './components/InstallAppBanner';

export default function UnifiedLoginScreen() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [errorMsg, setErrorMsg] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const router = useRouter();

    const handleLogin = async (e) => {
        e.preventDefault();
        setErrorMsg('');
        setIsLoading(true);

        const cleanUsername = username.trim().toLowerCase();

        // 1. ADMIN ROUTING CHECK
        // Change 'admin' and 'admin123' to your preferred master credentials
        if (cleanUsername === 'admin' && password === 'admin123') {
            // Optional: Set a session flag if you want to protect the admin route later
            localStorage.setItem('isAdminAuth', 'true'); 
            router.push('/admin');
            return;
        }

        // 2. TEACHER ROUTING CHECK
        try {
            // Create the invisible email format we used during teacher registration
            const fakeEmail = `${cleanUsername}@school.com`;
            await signInWithEmailAndPassword(auth, fakeEmail, password);
            
            // Verify they actually exist in the Firestore 'teachers' collection
            const teacherDoc = await getDoc(doc(db, 'teachers', cleanUsername));
            
            if (teacherDoc.exists()) {
                localStorage.setItem('teacherUsername', cleanUsername);
                router.push('/teacher'); // Route to teacher portal
            } else {
                setErrorMsg('Account exists, but teacher profile data is missing.');
                await signOut(auth);
            }
        } catch (err) {
            setErrorMsg('Invalid username or password.');
            console.error('Login Error:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const styles = {
        input: { width: '100%', padding: '14px 16px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '15px', outline: 'none', boxSizing: 'border-box' },
        button: { padding: '14px 24px', background: '#2563eb', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '16px', width: '100%', transition: '0.2s' }
    };

    return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f0f2f5', fontFamily: 'Inter, system-ui, sans-serif', padding: '20px' }}>
            <div style={{ width: '100%', maxWidth: '420px' }}>
                <InstallAppBanner />
                
                <div style={{ background: '#ffffff', padding: '40px', borderRadius: '16px', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', border: '1px solid #e2e8f0' }}>
                    <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                        <span style={{ fontSize: '40px', display: 'block', marginBottom: '10px' }}>🏫</span>
                        <h2 style={{ color: '#0f172a', margin: '0 0 8px 0', fontSize: '24px', fontWeight: '800' }}>School Portal Login</h2>
                        <p style={{ color: '#64748b', fontSize: '14px', margin: 0 }}>Enter your Admin or Teacher credentials</p>
                    </div>

                    <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#334155', marginBottom: '8px' }}>Username</label>
                            <input 
                                type="text" 
                                value={username} 
                                onChange={(e) => setUsername(e.target.value)} 
                                placeholder="e.g. admin or muzammil" 
                                required 
                                style={styles.input} 
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#334155', marginBottom: '8px' }}>Password</label>
                            <input 
                                type="password" 
                                value={password} 
                                onChange={(e) => setPassword(e.target.value)} 
                                placeholder="••••••••" 
                                required 
                                style={styles.input} 
                            />
                        </div>

                        {errorMsg && (
                            <div style={{ padding: '12px', background: '#fef2f2', color: '#b91c1c', borderRadius: '8px', fontSize: '14px', fontWeight: '600', textAlign: 'center' }}>
                                {errorMsg}
                            </div>
                        )}

                        <button type="submit" disabled={isLoading} style={{ ...styles.button, opacity: isLoading ? 0.7 : 1 }}>
                            {isLoading ? 'Authenticating...' : 'Sign In'}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}