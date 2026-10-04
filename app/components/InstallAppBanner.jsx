'use client';
import { useState, useEffect } from 'react';

export default function InstallAppBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    // 1. Check if app is already installed and running standalone
    const isRunningStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    if (isRunningStandalone) {
      setIsStandalone(true);
      return;
    }

    // 2. Check if user is on iOS Safari
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIosDevice = /iphone|ipad|ipod/.test(userAgent);
    setIsIOS(isIosDevice);

    // 3. Catch Android / Chrome install prompt event
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  // Do not show banner if already installed or user dismissed it
  if (isStandalone || isDismissed) return null;

  // Handler for Android / Chrome install click
  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
        setIsDismissed(true);
      }
    } else if (isIOS) {
      setShowIOSInstructions(true);
    }
  };

  // Only render if install prompt is available or on iOS
  if (!deferredPrompt && !isIOS) return null;

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
            style={{
              padding: '6px 14px',
              backgroundColor: '#2563eb',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              fontWeight: '600',
              fontSize: '13px',
              cursor: 'pointer'
            }}
          >
            Install
          </button>
          <button
            onClick={() => setIsDismissed(true)}
            style={{
              padding: '4px 8px',
              background: 'transparent',
              color: '#94a3b8',
              border: 'none',
              fontSize: '16px',
              cursor: 'pointer'
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* iOS Safari Instruction Drawer */}
      {showIOSInstructions && (
        <div style={{
          backgroundColor: '#334155',
          padding: '10px 12px',
          borderRadius: '8px',
          fontSize: '12px',
          lineHeight: '1.5',
          borderLeft: '4px solid #38bdf8'
        }}>
          To install on iPhone/iPad: tap the <strong>Share</strong> button (📤) in Safari, then select <strong>Add to Home Screen</strong> (➕).
        </div>
      )}
    </div>
  );
}