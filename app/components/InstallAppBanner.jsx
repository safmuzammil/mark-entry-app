'use client';
import { useState, useEffect } from 'react';

export default function InstallAppBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [deviceType, setDeviceType] = useState('desktop'); // 'ios', 'android', 'desktop'
  const [isStandalone, setIsStandalone] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    // 1. Check if the app is already installed
    const isRunningStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    if (isRunningStandalone) {
      setIsStandalone(true);
      return;
    }

    // 2. Detect Mobile Device Type
    const userAgent = window.navigator.userAgent.toLowerCase();
    if (/iphone|ipad|ipod/.test(userAgent)) {
      setDeviceType('ios');
    } else if (/android/.test(userAgent)) {
      setDeviceType('android');
    }

    // 3. Listen for Android's native automated prompt
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  // Hide entirely if already installed, dismissed, or on a desktop computer
  if (isStandalone || isDismissed || deviceType === 'desktop') return null;

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      // Trigger the native Android/Chrome prompt
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
        setIsDismissed(true);
      }
    } else {
      // If the prompt is blocked (e.g. opened in WhatsApp, or strict Chrome rules), show manual instructions
      setShowInstructions(true);
    }
  };

  return (
    <div style={{
      backgroundColor: '#1e293b',
      color: '#ffffff',
      padding: '12px 16px',
      borderRadius: '12px',
      marginBottom: '16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '22px' }}>📱</span>
          <div>
            <strong style={{ fontSize: '14px', display: 'block' }}>Install as Mobile App</strong>
            <span style={{ fontSize: '12px', color: '#94a3b8' }}>Access directly from your home screen</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            onClick={handleInstallClick}
            style={{ padding: '6px 14px', backgroundColor: '#2563eb', color: '#ffffff', border: 'none', borderRadius: '6px', fontWeight: '600', fontSize: '13px', cursor: 'pointer' }}
          >
            Install
          </button>
          <button
            onClick={() => setIsDismissed(true)}
            style={{ padding: '4px 8px', background: 'transparent', color: '#94a3b8', border: 'none', fontSize: '16px', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* iOS Manual Instructions */}
      {showInstructions && deviceType === 'ios' && (
        <div style={{ backgroundColor: '#334155', padding: '10px 12px', borderRadius: '8px', fontSize: '12px', lineHeight: '1.5', borderLeft: '4px solid #38bdf8' }}>
          To install on iPhone: tap the <strong>Share</strong> button (📤) at the bottom of Safari, then select <strong>Add to Home Screen</strong> (➕).
        </div>
      )}

      {/* Android Manual Instructions (Fallback for blocked automated prompts) */}
      {showInstructions && deviceType === 'android' && !deferredPrompt && (
        <div style={{ backgroundColor: '#334155', padding: '10px 12px', borderRadius: '8px', fontSize: '12px', lineHeight: '1.5', borderLeft: '4px solid #10b981' }}>
          To install: tap the <strong>3-dots menu (⋮)</strong> in the top corner of Chrome, then select <strong>Install app</strong> or <strong>Add to Home screen</strong>. <br/>
          <em style={{ color: '#94a3b8' }}>(Note: If you opened this link inside an app like WhatsApp, open it in Chrome first!)</em>
        </div>
      )}
    </div>
  );
}