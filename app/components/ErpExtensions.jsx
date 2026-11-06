'use client';
import React, { useState, useEffect } from 'react';
import { doc, setDoc, getDoc, getDocs, collection } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import {
  WEB_APP_URL, DHIU_LOGO_URL, DEFAULT_SUBJECTS, DEFAULT_CLASSES, DEPARTMENTS, styles
} from './erpConstants';

export const INDIAN_STATES = [
  "Kerala", "Karnataka", "Tamil Nadu", "Lakshadweep", "Maharashtra", "Uttar Pradesh",
  "Bihar", "West Bengal", "Assam", "Andhra Pradesh", "Telangana", "Delhi", "Gujarat",
  "Rajasthan", "Madhya Pradesh", "Punjab", "Haryana", "Jammu & Kashmir", "Jharkhand",
  "Odisha", "Chhattisgarh", "Uttarakhand", "Himachal Pradesh", "Goa", "Tripura",
  "Manipur", "Meghalaya", "Nagaland", "Arunachal Pradesh", "Mizoram", "Sikkim",
  "Puducherry", "Andaman & Nicobar", "Ladakh", "Chandigarh",
  "Dadra & Nagar Haveli and Daman & Diu", "Nepal", "Other"
];

export const KERALA_DISTRICTS = [
  "Malappuram", "Kozhikode", "Palakkad", "Thrissur", "Wayanad", "Kannur",
  "Kasaragod", "Ernakulam", "Alappuzha", "Kottayam", "Idukki", "Kollam",
  "Pathanamthitta", "Thiruvananthitta", "Thiruvananthapuram", "Other"
];

// ============================================================================
// 🎨 1. HIGH-CONTRAST CSS & SMOOTH SLIDING ANIMATIONS
// ============================================================================
export function HighContrastStyles() {
  return (
    <style>{`
      input, select, textarea {
        color: #0f172a !important;
        background-color: #ffffff !important;
        border: 1px solid #cbd5e1 !important;
        color-scheme: light !important;
        font-weight: 500 !important;
      }
      input::placeholder, textarea::placeholder {
        color: #94a3b8 !important;
        opacity: 1 !important;
        font-weight: 400 !important;
      }
      input:disabled, select:disabled {
        background-color: #f8fafc !important;
        color: #64748b !important;
        border-color: #e2e8f0 !important;
      }
      input:focus, select:focus, textarea:focus {
        outline: 2px solid #4f46e5 !important;
        border-color: #4f46e5 !important;
      }
      table th {
        color: #475569;
        font-weight: 800;
      }
      table td {
        color: #1e293b;
        font-weight: 500;
      }
      @keyframes erpSlideDown {
        from { opacity: 0; transform: translateY(-4px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .erp-slide-panel {
        animation: erpSlideDown 0.18s ease-out forwards;
      }
    `}</style>
  );
}

// ============================================================================
// 🪗 1B. REUSABLE MINIMALIST COLLAPSIBLE DRAWER
// ============================================================================
export function CollapsibleCard({
  title,
  subtitle,
  badgeText,
  defaultOpen = false,
  accentColor = '#4f46e5',
  icon = '✨',
  children
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div
      style={{
        background: '#ffffff',
        borderRadius: '14px',
        border: isOpen ? `1.5px solid ${accentColor}` : '1px solid #e2e8f0',
        boxShadow: '0 1px 3px rgba(15, 23, 42, 0.03)',
        marginBottom: '16px',
        overflow: 'hidden',
        transition: 'all 0.2s ease'
      }}
    >
      <div
        onClick={() => setIsOpen(prev => !prev)}
        style={{
          padding: '14px 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
          cursor: 'pointer',
          background: isOpen ? '#f8fafc' : '#ffffff',
          borderBottom: isOpen ? '1px solid #e2e8f0' : 'none',
          userSelect: 'none'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
          <span
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '8px',
              background: isOpen ? accentColor : '#f1f5f9',
              color: isOpen ? '#ffffff' : '#0f172a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '16px',
              flexShrink: 0
            }}
          >
            {icon}
          </span>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: '800', color: '#0f172a' }}>{title}</h3>
              {badgeText && (
                <span style={{ background: '#eef2ff', color: accentColor, padding: '2px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: '700' }}>
                  {badgeText}
                </span>
              )}
            </div>
            {subtitle && (
              <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#64748b', fontWeight: '500' }}>
                {subtitle}
              </p>
            )}
          </div>
        </div>

        <span
          style={{
            padding: '6px 12px',
            borderRadius: '8px',
            background: isOpen ? accentColor : '#f8fafc',
            color: isOpen ? '#ffffff' : '#475569',
            border: isOpen ? 'none' : '1px solid #e2e8f0',
            fontWeight: '700',
            fontSize: '12px',
            whiteSpace: 'nowrap'
          }}
        >
          {isOpen ? '▲ Hide' : '▼ Open'}
        </span>
      </div>

      {isOpen && (
        <div className="erp-slide-panel" style={{ padding: '20px' }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 🖼️ 2. CLIENT-SIDE PHOTO COMPRESSOR (~15KB WebP/JPEG)
// ============================================================================
export function compressImageFileToDataUrl(file, maxSize = 180, quality = 0.78) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > maxSize) { height = Math.round((height * maxSize) / width); width = maxSize; }
        } else {
          if (height > maxSize) { width = Math.round((width * maxSize) / height); height = maxSize; }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        let dataUrl = canvas.toDataURL("image/webp", quality);
        if (!dataUrl.startsWith("data:image/webp")) {
          dataUrl = canvas.toDataURL("image/jpeg", quality);
        }
        resolve(dataUrl);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ============================================================================
// 💬 3. DIRECT WHATSAPP, GROUP OPENER & EMAIL HELPERS
// ============================================================================
export function formatWhatsAppPhone(rawPhone) {
  if (!rawPhone) return '';
  let digits = String(rawPhone).replace(/\D/g, '');
  if (digits.length === 10) digits = '91' + digits;
  return digits;
}

export function openDirectWhatsApp(phoneNumber, messageText) {
  const cleanPhone = formatWhatsAppPhone(phoneNumber);
  if (!cleanPhone) {
    window.open(`https://wa.me/?text=${encodeURIComponent(messageText)}`, '_blank');
    return;
  }
  window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(messageText)}`, '_blank');
}

export function openWhatsAppGroupAndCopy(groupInviteUrl, messageText, groupLabel = 'WhatsApp Group') {
  if (navigator.clipboard && messageText) {
    navigator.clipboard.writeText(messageText).catch(() => {});
  }
  if (groupInviteUrl && groupInviteUrl.trim().startsWith('http')) {
    alert(`✅ Message copied to clipboard!\n\nOpening ${groupLabel} — simply Paste (Ctrl+V) and press Send.`);
    window.open(groupInviteUrl.trim(), '_blank');
  } else {
    window.open(`https://wa.me/?text=${encodeURIComponent(messageText)}`, '_blank');
  }
}

export async function sendDirectEmailNotification(webAppUrl, toEmail, subject, bodyText) {
  if (!toEmail || !toEmail.includes('@')) {
    return alert("No valid email address is saved for this person.");
  }
  try {
    const res = await fetch(webAppUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'sendEmail',
        to: toEmail.trim(),
        subject,
        body: bodyText
      })
    });
    const data = await res.json();
    if (data.status === 'success') {
      alert(`✅ Email sent to ${toEmail}!`);
    } else {
      window.open(`mailto:${toEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`);
    }
  } catch (err) {
    window.open(`mailto:${toEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`);
  }
}

// ============================================================================
// 🔔 3B. TARGETED PORTAL NOTIFICATION & MESSAGING SYSTEM (Admin / Teacher / Student)
// ============================================================================
export function formatNotificationTime12Hr(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

export function doesNotificationMatchUser(msg, viewerRole, viewerId, viewerAdNo = '', viewerClasses = []) {
  if (!msg || msg.active === false) return false;
  const dismissedBy = Array.isArray(msg.dismissedBy) ? msg.dismissedBy : [];
  const myKey = `${viewerRole}:${String(viewerId || '').toLowerCase()}`;
  if (dismissedBy.includes(myKey)) return false;

  // Sender can also view messages they sent if checking sent history, but for inbox:
  const tType = msg.targetType || '';
  const tVals = (Array.isArray(msg.targetValues) ? msg.targetValues : []).map(v => String(v || '').trim().toUpperCase());

  if (viewerRole === 'admin') {
    return tType === 'ALL_ADMINS' || tType === 'ALL_TEACHERS';
  }

  if (viewerRole === 'teacher') {
    const unameUp = String(viewerId || '').trim().toUpperCase();
    if (tType === 'ALL_TEACHERS') return true;
    if (tType === 'SPECIFIC_TEACHERS' && tVals.includes(unameUp)) return true;
    return false;
  }

  if (viewerRole === 'student') {
    const regUp = String(viewerId || '').trim().toUpperCase();
    const adUp = String(viewerAdNo || '').trim().toUpperCase();
    const clsUpList = (Array.isArray(viewerClasses) ? viewerClasses : [viewerClasses]).map(c => String(c || '').trim().toUpperCase());

    if (tType === 'ALL_STUDENTS') return true;
    if (tType === 'SPECIFIC_CLASSES' && clsUpList.some(c => tVals.includes(c))) return true;
    if ((tType === 'SPECIFIC_STUDENTS' || tType === 'MY_MENTEES' || tType === 'MY_CLASS_STUDENTS') && (tVals.includes(regUp) || tVals.includes(adUp))) {
      return true;
    }
    return false;
  }

  return false;
}

export function PortalNotificationBanner({
  viewerRole = 'student', // 'admin' | 'teacher' | 'student'
  viewerId = '',
  viewerAdNo = '',
  viewerClasses = [],
  canSendMessages = false,
  senderName = 'Faculty',
  senderRole = 'teacher',
  senderUsername = '',
  studentsList = [],
  teachersList = [],
  loggedInTeacher = null
}) {
  const [messages, setMessages] = useState([]);
  const [showInboxDrawer, setShowInboxDrawer] = useState(false);
  const [showComposerModal, setShowComposerModal] = useState(false);

  // Composer State
  const [targetType, setTargetType] = useState(viewerRole === 'admin' ? 'SPECIFIC_STUDENTS' : 'MY_MENTEES');
  const [selectedClasses, setSelectedClasses] = useState([]);
  const [recipientSearch, setRecipientSearch] = useState('');
  const [selectedRecipients, setSelectedRecipients] = useState([]); // Array of { id, label }
  const [msgTitle, setMsgTitle] = useState('');
  const [msgBody, setMsgBody] = useState('');
  const [sending, setSending] = useState(false);

  const loadNotifications = async () => {
    try {
      const snap = await getDoc(doc(db, 'systemCache', 'portalNotifications'));
      if (snap.exists() && Array.isArray(snap.data().items)) {
        setMessages(snap.data().items);
      } else {
        setMessages([]);
      }
    } catch (e) {
      console.error('Error loading portal notifications:', e);
    }
  };

  useEffect(() => {
    loadNotifications();
  }, [viewerRole, viewerId]);

  const myUnreadMessages = messages.filter(m =>
    doesNotificationMatchUser(m, viewerRole, viewerId, viewerAdNo, viewerClasses)
  );

  const mySentMessages = messages.filter(m =>
    canSendMessages &&
    ((senderUsername && String(m.senderUsername || '').toLowerCase() === String(senderUsername).toLowerCase()) ||
     (viewerRole === 'admin' && m.senderRole === 'admin'))
  );

  const handleDismissMessage = async (msgId) => {
    const myKey = `${viewerRole}:${String(viewerId || '').toLowerCase()}`;
    const updated = messages.map(m => {
      if (m.id !== msgId) return m;
      const cur = Array.isArray(m.dismissedBy) ? m.dismissedBy : [];
      return { ...m, dismissedBy: Array.from(new Set([...cur, myKey])) };
    });
    setMessages(updated);
    try {
      await setDoc(doc(db, 'systemCache', 'portalNotifications'), { items: updated }, { merge: true });
    } catch (e) {}
  };

  const handleDeleteSentMessage = async (msgId) => {
    const updated = messages.filter(m => m.id !== msgId);
    setMessages(updated);
    try {
      await setDoc(doc(db, 'systemCache', 'portalNotifications'), { items: updated }, { merge: true });
    } catch (e) {}
  };

  const handleSendPortalNotification = async (e) => {
    e.preventDefault();
    if (!msgBody.trim()) return alert('Please type a message.');

    let finalTargetValues = [];
    let targetSummaryLabel = '';

    const myUname = String(loggedInTeacher?.username || senderUsername || '').toLowerCase();
    const myCtClasses = loggedInTeacher?.outpassPrivileges?.classTeacherOf || [];

    if (targetType === 'ALL_STUDENTS') {
      targetSummaryLabel = 'All Students';
    } else if (targetType === 'ALL_TEACHERS') {
      targetSummaryLabel = 'All Teachers';
    } else if (targetType === 'SPECIFIC_CLASSES') {
      if (selectedClasses.length === 0) return alert('Please select at least one class.');
      finalTargetValues = selectedClasses;
      targetSummaryLabel = `Class ${selectedClasses.join(', ')}`;
    } else if (targetType === 'MY_MENTEES') {
      const mentees = studentsList.filter(s => String(s.mentorUsername || '').toLowerCase() === myUname);
      if (mentees.length === 0) return alert('You have no assigned mentees.');
      finalTargetValues = mentees.map(s => String(s.regNo || s.adNo).toUpperCase());
      targetSummaryLabel = `My Mentees (${mentees.length})`;
    } else if (targetType === 'MY_CLASS_STUDENTS') {
      const clsSt = studentsList.filter(s => (s.classes || []).some(c => myCtClasses.includes(c)));
      if (clsSt.length === 0) return alert('No students found in your designated class.');
      finalTargetValues = clsSt.map(s => String(s.regNo || s.adNo).toUpperCase());
      targetSummaryLabel = `My Class ${myCtClasses.join(', ')} (${clsSt.length})`;
    } else if (targetType === 'SPECIFIC_STUDENTS' || targetType === 'SPECIFIC_TEACHERS') {
      if (selectedRecipients.length === 0) return alert('Please select at least one recipient.');
      finalTargetValues = selectedRecipients.map(r => String(r.id).toUpperCase());
      targetSummaryLabel = selectedRecipients.map(r => r.label).join(', ');
    }

    setSending(true);
    try {
      const snap = await getDoc(doc(db, 'systemCache', 'portalNotifications'));
      const existing = snap.exists() && Array.isArray(snap.data().items) ? snap.data().items : [];

      const newMsg = {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        title: msgTitle.trim() || 'Official Portal Notification',
        body: msgBody.trim(),
        senderName: senderName || 'Faculty',
        senderRole,
        senderUsername: myUname || 'admin',
        targetType,
        targetValues: finalTargetValues,
        targetSummaryLabel,
        dismissedBy: [],
        active: true,
        createdAt: new Date().toISOString()
      };

      const nextItems = [newMsg, ...existing].slice(0, 120); // Keep latest 120 notifications fast
      await setDoc(doc(db, 'systemCache', 'portalNotifications'), {
        items: nextItems,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      setMessages(nextItems);
      setMsgTitle('');
      setMsgBody('');
      setSelectedRecipients([]);
      setShowComposerModal(false);
      alert(`✅ Notification sent to ${targetSummaryLabel}!`);
    } catch (err) {
      alert('Failed to send notification: ' + err.message);
    } finally {
      setSending(false);
    }
  };

  const searchMatches = React.useMemo(() => {
    const q = recipientSearch.trim().toLowerCase();
    if (!q) return [];
    if (targetType === 'SPECIFIC_TEACHERS') {
      return teachersList
        .filter(t => String(t.fullName || '').toLowerCase().includes(q) || String(t.username || '').toLowerCase().includes(q))
        .slice(0, 8)
        .map(t => ({ id: t.username, label: `${t.fullName} (@${t.username})` }));
    }
    return studentsList
      .filter(s => String(s.firstName || '').toLowerCase().includes(q) || String(s.adNo || '').toLowerCase().includes(q) || String(s.regNo || '').toLowerCase().includes(q))
      .slice(0, 8)
      .map(s => ({ id: s.regNo || s.adNo, label: `${s.firstName} (#${s.adNo} • ${(s.classes || []).join(',')})` }));
  }, [recipientSearch, targetType, studentsList, teachersList]);

  if (myUnreadMessages.length === 0 && !canSendMessages) return null;

  return (
    <div className="no-print" style={{ marginBottom: '18px' }}>
      {/* TOP BAR: UNREAD NOTIFICATION ALERT + SEND MESSAGE BUTTON */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', background: myUnreadMessages.length > 0 ? '#eef2ff' : '#ffffff', border: myUnreadMessages.length > 0 ? '1.5px solid #4f46e5' : '1px solid #e2e8f0', padding: '12px 18px', borderRadius: '12px' }}>
        <div
          onClick={() => setShowInboxDrawer(prev => !prev)}
          style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', flex: 1 }}
        >
          <span style={{ background: myUnreadMessages.length > 0 ? '#4f46e5' : '#f1f5f9', color: myUnreadMessages.length > 0 ? '#ffffff' : '#475569', padding: '5px 11px', borderRadius: '999px', fontSize: '12px', fontWeight: '800' }}>
            🔔 {myUnreadMessages.length} Unread Notification{myUnreadMessages.length === 1 ? '' : 's'}
          </span>
          {myUnreadMessages.length > 0 ? (
            <span style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a' }}>
              Latest from <strong>{myUnreadMessages[0].senderName}</strong>: &ldquo;{myUnreadMessages[0].title}&rdquo;
            </span>
          ) : (
            <span style={{ fontSize: '13px', color: '#64748b', fontWeight: '500' }}>
              Portal Notifications &amp; Direct Messages
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {(myUnreadMessages.length > 0 || mySentMessages.length > 0) && (
            <button
              type="button"
              onClick={() => setShowInboxDrawer(prev => !prev)}
              style={{ padding: '7px 12px', background: '#ffffff', color: '#334155', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}
            >
              {showInboxDrawer ? '▲ Hide Messages' : `▼ View Messages (${myUnreadMessages.length})`}
            </button>
          )}
          {canSendMessages && (
            <button
              type="button"
              onClick={() => setShowComposerModal(true)}
              style={{ padding: '8px 14px', background: '#4f46e5', color: '#ffffff', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}
            >
              📨 Send Portal Message
            </button>
          )}
        </div>
      </div>

      {/* EXPANDABLE INBOX & SENT MESSAGES DRAWER */}
      {(showInboxDrawer || (viewerRole === 'student' && myUnreadMessages.length > 0)) && (
        <div className="erp-slide-panel" style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {myUnreadMessages.map(msg => (
            <div key={msg.id} style={{ background: '#ffffff', border: '1px solid #c7d2fe', borderLeft: '4px solid #4f46e5', padding: '14px 18px', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: '240px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                  <span style={{ background: '#eef2ff', color: '#4f46e5', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: '800' }}>
                    From: {msg.senderName}
                  </span>
                  <span style={{ fontSize: '11px', color: '#64748b', fontWeight: '600' }}>
                    🕒 {formatNotificationTime12Hr(msg.createdAt)}
                  </span>
                </div>
                <div style={{ fontWeight: '800', fontSize: '14px', color: '#0f172a' }}>{msg.title}</div>
                <div style={{ fontSize: '13px', color: '#334155', marginTop: '4px', lineHeight: 1.45 }}>{msg.body}</div>
              </div>
              <button
                type="button"
                onClick={() => handleDismissMessage(msg.id)}
                style={{ padding: '6px 12px', background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', borderRadius: '8px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                ✓ Mark Read
              </button>
            </div>
          ))}

          {canSendMessages && showInboxDrawer && mySentMessages.length > 0 && (
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '12px 16px', borderRadius: '10px' }}>
              <div style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', marginBottom: '8px' }}>
                📤 Recently Sent by You ({mySentMessages.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {mySentMessages.slice(0, 5).map(m => (
                  <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#ffffff', padding: '8px 12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12px', gap: '8px', flexWrap: 'wrap' }}>
                    <div>
                      <strong>To [{m.targetSummaryLabel}]:</strong> {m.title} — <span style={{ color: '#475569' }}>{m.body}</span>
                      <span style={{ color: '#94a3b8', fontSize: '11px', marginLeft: '8px' }}>({formatNotificationTime12Hr(m.createdAt)})</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteSentMessage(m.id)}
                      style={{ background: 'transparent', border: 'none', color: '#e11d48', fontWeight: '700', fontSize: '11px', cursor: 'pointer' }}
                    >
                      🗑️ Recall
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* COMPOSER MODAL FOR ADMIN & TEACHERS */}
      {showComposerModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2400, padding: '16px' }}>
          <div style={{ background: '#ffffff', borderRadius: '16px', maxWidth: '600px', width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: '24px', border: '1px solid #e2e8f0', boxShadow: '0 20px 40px rgba(15,23,42,0.18)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: '#0f172a' }}>📨 Send Targeted Portal Notification</h3>
                <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>
                  Appears immediately as a notification banner on the selected students&apos; or teachers&apos; portal.
                </p>
              </div>
              <button type="button" onClick={() => setShowComposerModal(false)} style={styles.buttonSecondary}>✕</button>
            </div>

            <form onSubmit={handleSendPortalNotification} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={styles.label}>1. Select Recipient Group</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {[
                    { id: 'SPECIFIC_STUDENTS', label: '🎯 Specific Student(s)' },
                    ...(viewerRole === 'teacher' ? [
                      { id: 'MY_MENTEES', label: '🧭 All My Mentees' },
                      ...((loggedInTeacher?.outpassPrivileges?.classTeacherOf || []).length > 0
                        ? [{ id: 'MY_CLASS_STUDENTS', label: `🏫 My Class (${loggedInTeacher.outpassPrivileges.classTeacherOf.join(', ')})` }]
                        : [])
                    ] : []),
                    { id: 'SPECIFIC_CLASSES', label: '🏫 Specific Class(es)' },
                    { id: 'SPECIFIC_TEACHERS', label: '👨‍🏫 Specific Teacher(s)' },
                    ...(viewerRole === 'admin' ? [
                      { id: 'ALL_STUDENTS', label: '📢 All Students' },
                      { id: 'ALL_TEACHERS', label: '📢 All Teachers' }
                    ] : [])
                  ].map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => { setTargetType(opt.id); setSelectedRecipients([]); }}
                      style={{
                        padding: '7px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: '700', cursor: 'pointer',
                        border: targetType === opt.id ? '1px solid #4f46e5' : '1px solid #cbd5e1',
                        background: targetType === opt.id ? '#4f46e5' : '#f8fafc',
                        color: targetType === opt.id ? '#ffffff' : '#334155'
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {targetType === 'SPECIFIC_CLASSES' && (
                <div>
                  <label style={styles.label}>Select Target Class(es)</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {DEFAULT_CLASSES.map(cls => {
                      const act = selectedClasses.includes(cls);
                      return (
                        <button
                          key={cls}
                          type="button"
                          onClick={() => setSelectedClasses(prev => act ? prev.filter(c => c !== cls) : [...prev, cls])}
                          style={{
                            padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: '700', cursor: 'pointer',
                            border: act ? '1px solid #4f46e5' : '1px solid #cbd5e1',
                            background: act ? '#eef2ff' : '#ffffff',
                            color: act ? '#4f46e5' : '#334155'
                          }}
                        >
                          {act ? `✓ ${cls}` : cls}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {(targetType === 'SPECIFIC_STUDENTS' || targetType === 'SPECIFIC_TEACHERS') && (
                <div>
                  <label style={styles.label}>
                    Search &amp; Add {targetType === 'SPECIFIC_TEACHERS' ? 'Teacher(s)' : 'Student(s) (By Name or Ad.No)'}
                  </label>
                  <input
                    type="text"
                    value={recipientSearch}
                    onChange={e => setRecipientSearch(e.target.value)}
                    placeholder={targetType === 'SPECIFIC_TEACHERS' ? 'Type teacher name or @username...' : 'Type student name or Ad.No (e.g. 3551)...'}
                    style={styles.input}
                  />
                  {searchMatches.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                      {searchMatches.map(item => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            if (!selectedRecipients.some(r => r.id === item.id)) {
                              setSelectedRecipients(prev => [...prev, item]);
                            }
                            setRecipientSearch('');
                          }}
                          style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid #4f46e5', background: '#eef2ff', color: '#4f46e5', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}
                        >
                          + {item.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {selectedRecipients.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px', padding: '10px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      {selectedRecipients.map(r => (
                        <span key={r.id} style={{ background: '#4f46e5', color: '#ffffff', padding: '4px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: '700', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          {r.label}
                          <button type="button" onClick={() => setSelectedRecipients(prev => prev.filter(x => x.id !== r.id))} style={{ background: 'transparent', border: 'none', color: '#ffffff', cursor: 'pointer', fontWeight: '800' }}>✕</button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div>
                <label style={styles.label}>2. Notification Title</label>
                <input
                  type="text"
                  value={msgTitle}
                  onChange={e => setMsgTitle(e.target.value)}
                  placeholder="e.g. Meet for Consultancy Sitting / Submit CCE Work"
                  required
                  style={styles.input}
                />
              </div>

              <div>
                <label style={styles.label}>3. Message Content</label>
                <textarea
                  rows={3}
                  value={msgBody}
                  onChange={e => setMsgBody(e.target.value)}
                  placeholder="Type your message here..."
                  required
                  style={styles.input}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
                <button type="button" onClick={() => setShowComposerModal(false)} style={styles.buttonSecondary}>Cancel</button>
                <button type="submit" disabled={sending} style={styles.buttonPrimary}>
                  {sending ? 'Sending...' : '📨 Send Portal Notification'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
// ============================================================================
// 🧭 9. MINIMALIST MENTORSHIP & OUTREACH TAB (Class Teacher & Mentor Live Feed + FN/AN Monthly Days)
// ============================================================================
export function MentorAndOutreachTab({ students, teachers, loggedInTeacher, isAdmin = false, isOutreachView = false, onStudentUpdated }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCompletion, setFilterCompletion] = useState('All');
  const [filterConsultancyStatus, setFilterConsultancyStatus] = useState('All');
  const [editingStudent, setEditingStudent] = useState(null);
  const [modalInitialSection, setModalInitialSection] = useState('log');

  // Minimalist Panel & Row Expansion State
  const [activeToolDrawer, setActiveToolDrawer] = useState('none');
  const [expandedRowRegNo, setExpandedRowRegNo] = useState(null);
  const [visibleCols, setVisibleCols] = useState({
    skills: false,
    contact: false
  });

  const [outreachActiveSubTab, setOutreachActiveSubTab] = useState('directory');
  const [inspectingUsthadUsername, setInspectingUsthadUsername] = useState('');
  const [outreachClassFilter, setOutreachClassFilter] = useState('All');
  const [outreachRoleFilter, setOutreachRoleFilter] = useState('All');

  // 🌟 Class Teacher & Mentor Live Attendance / Period / FN-AN Daily Summary State
  const [liveOutpassesMap, setLiveOutpassesMap] = useState({});
  const [todayPeriodsCache, setTodayPeriodsCache] = useState([]);
  const [fnAnMonthSessionsCache, setFnAnMonthSessionsCache] = useState([]);
  const [selectedMonthForFnAn, setSelectedMonthForFnAn] = useState(() => new Date().toISOString().slice(0, 7));
  const [classTeacherFnAnFilter, setClassTeacherFnAnFilter] = useState('ALL'); // 'ALL' | 'ABSENT_GT_5' | 'PRESENT_ALL'

  const [semesterTargetConfig, setSemesterTargetConfig] = useState({
    semesterName: 'Current Semester',
    minConsultations: 3,
    targetDeadline: '',
    guidelinesNote: 'Minimum 3 structured 1-on-1 sittings per mentee this semester.'
  });
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  const [selectedStudentRegs, setSelectedStudentRegs] = useState([]);
  const [targetMentorUsername, setTargetMentorUsername] = useState('');
  const [bulkSkillInput, setBulkSkillInput] = useState('');
  const [isAssigningMentor, setIsAssigningMentor] = useState(false);
  const [mentorAssignStatus, setMentorAssignStatus] = useState('');

  const myUsername = String(loggedInTeacher?.username || '').trim().toLowerCase();
  const myFullNameLower = String(loggedInTeacher?.fullName || '').trim().toLowerCase();
  const priv = loggedInTeacher?.outpassPrivileges || {};
  const myClassTeacherOf = Array.isArray(priv.classTeacherOf) ? priv.classTeacherOf : [];
  const isNiicsCoord = Boolean(priv.isNiicsCoordinator);
  const canManageMentorAssignments = Boolean(isAdmin || isOutreachView || priv.isOutreachCoordinator || priv.isPrincipal);

  const normalizeCls = (str) => String(str || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  // Load active out-passes and today's period attendance feed for live presence
  useEffect(() => {
    async function loadLiveAttendanceAndPasses() {
      try {
        const todayStr = new Date().toISOString().split('T')[0];
        const [opSnap, idxSnap, cacheSnap] = await Promise.all([
          getDocs(collection(db, 'out_passes')),
          getDoc(doc(db, 'systemCache', `daySessionsIndex_${todayStr}`)),
          getDocs(collection(db, 'systemCache'))
        ]);

        const opMap = {};
        opSnap.forEach(d => {
          const data = d.data();
          const st = String(data.status || '').toUpperCase();
          if (st !== 'CANCELLED' && (st === 'OUTSIDE' || st === 'APPROVED' || st === 'ARRIVED_AT_GATE')) {
            const ad = String(data.adNo || '').trim().toUpperCase();
            const reg = String(data.studentRegNo || data.regNo || '').trim().toUpperCase();
            const matchSt = students.find(s => String(s.adNo || '').toUpperCase() === ad || String(s.regNo || '').toUpperCase() === reg);
            const key = matchSt ? matchSt.regNo : ad;
            if (key) {
              opMap[key] = {
                category: data.leaveCategory || data.category || 'General',
                destination: data.destination || 'Out',
                purpose: data.purpose || data.reason || '',
                teacherName: data.teacherName || 'Faculty'
              };
            }
          }
        });
        setLiveOutpassesMap(opMap);

        const list = idxSnap.exists() ? (idxSnap.data().sessions || []) : [];
        const fullSessions = [];
        for (const item of list) {
          const sSnap = await getDoc(doc(db, 'systemCache', item.sessionDocId));
          if (sSnap.exists()) fullSessions.push({ id: item.sessionDocId, ...sSnap.data() });
        }
        fullSessions.sort((a, b) => Number(a.session) - Number(b.session));
        setTodayPeriodsCache(fullSessions);

        const monthSessions = [];
        cacheSnap.forEach(d => {
          if (d.id.startsWith(`periodSession_${selectedMonthForFnAn}`)) {
            monthSessions.push({ id: d.id, ...d.data() });
          }
        });
        setFnAnMonthSessionsCache(monthSessions);
      } catch (e) {
        console.error('Error loading live tracking feed:', e);
      }
    }
    if (students.length > 0) loadLiveAttendanceAndPasses();
  }, [students, selectedMonthForFnAn]);

  useEffect(() => {
    getDoc(doc(db, 'systemCache', 'mentorshipConfig')).then(snap => {
      if (snap.exists()) setSemesterTargetConfig(prev => ({ ...prev, ...snap.data() }));
    }).catch(() => {});
  }, []);

  const handleSaveSemesterTargetConfig = async (e) => {
    e.preventDefault();
    setIsSavingConfig(true);
    try {
      const cleanMin = Math.max(1, Number(semesterTargetConfig.minConsultations) || 1);
      const updated = { ...semesterTargetConfig, minConsultations: cleanMin, updatedAt: new Date().toISOString() };
      await setDoc(doc(db, 'systemCache', 'mentorshipConfig'), updated, { merge: true });
      setSemesterTargetConfig(updated);
      setActiveToolDrawer('none');
      alert(`✅ Semester Target set to ${cleanMin} sittings!`);
    } catch (err) {
      alert('Failed to save target: ' + err.message);
    } finally {
      setIsSavingConfig(false);
    }
  };

  const getStudentConsultancyMetrics = (st) => {
    const logs = Array.isArray(st?.mentorLogs) ? st.mentorLogs : (st?.consultationLogs || []);
    const count = logs.length;
    const minReq = Number(semesterTargetConfig.minConsultations) || 3;
    const metTarget = count >= minReq;
    const latestLog = logs[0] || null;
    const lastDateStr = latestLog?.date || st?.lastMentorMeetingDate || '';
    let daysSinceLast = null;
    if (lastDateStr) {
      const diffMs = Date.now() - new Date(lastDateStr).getTime();
      daysSinceLast = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
    }
    return { logs, count, minReq, metTarget, latestLog, lastDateStr };
  };

  const isStudentMyMentee = (st) => {
    const stMentorUser = String(st.mentorUsername || '').trim().toLowerCase();
    const stMentorName = String(st.mentorName || '').trim().toLowerCase();
    return (myUsername && stMentorUser === myUsername) || (myFullNameLower && stMentorName === myFullNameLower);
  };

  const isStudentInMyClass = (st) => {
    const stClasses = Array.isArray(st.classes) ? st.classes : [st.class].filter(Boolean);
    const normStClasses = stClasses.map(c => normalizeCls(c));
    return myClassTeacherOf.some(c => normStClasses.includes(normalizeCls(c))) ||
           (myUsername && String(st.classTeacherUsername || '').trim().toLowerCase() === myUsername);
  };

  const isStudentMyNiics = (st) => isNiicsCoord && String(st.adNo || '').trim().toUpperCase().startsWith('U');

  const classStudentsList = students.filter(isStudentInMyClass);
  const menteeStudentsList = students.filter(isStudentMyMentee);
  const hasClassDuty = myClassTeacherOf.length > 0 || classStudentsList.length > 0;
  const hasMentorDuty = Boolean(priv.isMentor) || menteeStudentsList.length > 0;

  const availableDutyTabs = [];
  if (!isAdmin && !isOutreachView) {
    if (hasClassDuty) availableDutyTabs.push({ id: 'CLASS', label: `🏫 My Class ${myClassTeacherOf.join(', ')} (${classStudentsList.length})` });
    if (hasMentorDuty) availableDutyTabs.push({ id: 'MENTEES', label: `🧭 My Mentees (${menteeStudentsList.length})` });
    if (isNiicsCoord) availableDutyTabs.push({ id: 'NIICS', label: `🎓 NIICS Urdu Students` });
  }

  const [teacherViewMode, setTeacherViewMode] = useState(hasClassDuty ? 'CLASS' : 'MENTEES');

  const scopedStudents = students.filter(st => {
    if (isAdmin || isOutreachView) {
      if (inspectingUsthadUsername) return String(st.mentorUsername || '').toLowerCase() === inspectingUsthadUsername.toLowerCase();
      return true;
    }
    if (teacherViewMode === 'MENTEES') return isStudentMyMentee(st);
    if (teacherViewMode === 'CLASS') return isStudentInMyClass(st);
    if (teacherViewMode === 'NIICS') return isStudentMyNiics(st);
    return isStudentMyMentee(st) || isStudentInMyClass(st) || isStudentMyNiics(st);
  });

  const displayStudents = scopedStudents.filter(st => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      if (!st.firstName?.toLowerCase().includes(q) && !String(st.adNo).toLowerCase().includes(q)) return false;
    }
    const comp = computeStudentProfileCompletion(st);
    if (filterCompletion === 'Complete' && !comp.isComplete) return false;
    if (filterCompletion === 'Incomplete' && comp.isComplete) return false;

    const cMetrics = getStudentConsultancyMetrics(st);
    if (filterConsultancyStatus === 'TargetMet' && !cMetrics.metTarget) return false;
    if (filterConsultancyStatus === 'BelowTarget' && cMetrics.metTarget) return false;
    if (filterConsultancyStatus === 'ZeroSittings' && cMetrics.count > 0) return false;

    if (isAdmin || isOutreachView) {
      if (outreachRoleFilter === 'Mentors Assigned' && !st.mentorUsername) return false;
      if (outreachRoleFilter === 'No Mentor' && st.mentorUsername) return false;
      if (outreachClassFilter !== 'All') {
        const stClasses = Array.isArray(st.classes) ? st.classes : [st.class];
        if (!stClasses.includes(outreachClassFilter)) return false;
      }
    }
    return true;
  });

  const totalScope = scopedStudents.length;
  const targetMetCount = scopedStudents.filter(s => getStudentConsultancyMetrics(s).metTarget).length;
  const belowTargetCount = totalScope - targetMetCount;
  const totalSittingsLoggedInScope = scopedStudents.reduce((acc, s) => acc + getStudentConsultancyMetrics(s).count, 0);

  // 🌟 Compute Class Teacher Live Counts & FN/AN Monthly Summaries for Class
  const classLiveInsideCount = classStudentsList.filter(s => !liveOutpassesMap[s.regNo]).length;
  const classLiveOutsideCount = classStudentsList.filter(s => Boolean(liveOutpassesMap[s.regNo])).length;

  const classFnAnRows = React.useMemo(() => {
    if (!hasClassDuty || classStudentsList.length === 0) return [];
    return classStudentsList.map(st => {
      const reg = st.regNo;
      const ad = String(st.adNo || '').trim().toUpperCase();
      const dateMap = {};

      fnAnMonthSessionsCache.forEach(sess => {
        const attMap = sess.attendanceMap || {};
        const status = attMap[reg] || attMap[st.id] || attMap[ad];
        if (!status) return;

        const dStr = sess.date;
        const pNum = Number(sess.session) || 1;
        if (!dateMap[dStr]) dateMap[dStr] = { fnStatuses: [], anStatuses: [] };
        if (pNum <= 6) dateMap[dStr].fnStatuses.push(status);
        else dateMap[dStr].anStatuses.push(status);
      });

      let workingDaysHeld = 0;
      let totalDaysPresent = 0;
      let totalDaysAbsent = 0;
      const absentDatesDetails = [];

      Object.keys(dateMap).sort().forEach(dStr => {
        const { fnStatuses, anStatuses } = dateMap[dStr];
        const hasFn = fnStatuses.length > 0;
        const hasAn = anStatuses.length > 0;
        const isFnPresent = hasFn ? fnStatuses.some(c => c === 'P' || c === 'O') : false;
        const isAnPresent = hasAn ? anStatuses.some(c => c === 'P' || c === 'O') : false;

        if (hasFn && hasAn) {
          workingDaysHeld += 1;
          const dayPres = (isFnPresent ? 0.5 : 0) + (isAnPresent ? 0.5 : 0);
          const dayAbs = 1 - dayPres;
          totalDaysPresent += dayPres;
          totalDaysAbsent += dayAbs;
          if (dayAbs > 0) absentDatesDetails.push(`${dStr} (${!isFnPresent && !isAnPresent ? 'Full' : 'Half'})`);
        } else if (hasFn || hasAn) {
          workingDaysHeld += 0.5;
          const halfPres = (hasFn && isFnPresent) || (hasAn && isAnPresent) ? 0.5 : 0;
          const halfAbs = 0.5 - halfPres;
          totalDaysPresent += halfPres;
          totalDaysAbsent += halfAbs;
          if (halfAbs > 0) absentDatesDetails.push(`${dStr} (${hasFn ? 'FN' : 'AN'})`);
        }
      });

      const isAbsentMoreThan5Days = totalDaysAbsent >= 5;
      const dayAttPct = workingDaysHeld > 0 ? ((totalDaysPresent / workingDaysHeld) * 100).toFixed(1) : '100.0';

      return { student: st, workingDaysHeld, totalDaysPresent, totalDaysAbsent, dayAttPct, absentDatesDetails, isAbsentMoreThan5Days };
    });
  }, [hasClassDuty, classStudentsList, fnAnMonthSessionsCache]);

  const classAbsentGt5Count = classFnAnRows.filter(r => r.isAbsentMoreThan5Days).length;

  const filteredClassFnAnRows = classFnAnRows.filter(r => {
    if (classTeacherFnAnFilter === 'ABSENT_GT_5') return r.isAbsentMoreThan5Days;
    return true;
  });

  const usthadAuditRows = teachers.map(t => {
    const tUserLower = String(t.username || '').toLowerCase();
    const tMentees = students.filter(s => String(s.mentorUsername || '').toLowerCase() === tUserLower);
    const totalMentees = tMentees.length;
    let metTargetMentees = 0, zeroSittingMentees = 0, totalSessions = 0, latestSittingDate = '';
    tMentees.forEach(m => {
      const cm = getStudentConsultancyMetrics(m);
      totalSessions += cm.count;
      if (cm.metTarget) metTargetMentees++;
      if (cm.count === 0) zeroSittingMentees++;
      if (cm.lastDateStr && (!latestSittingDate || cm.lastDateStr > latestSittingDate)) latestSittingDate = cm.lastDateStr;
    });
    const targetCompletionPct = totalMentees > 0 ? Math.round((metTargetMentees / totalMentees) * 100) : 0;
    return { teacher: t, totalMentees, metTargetMentees, zeroSittingMentees, totalSessions, latestSittingDate, targetCompletionPct };
  }).filter(row => row.totalMentees > 0 || row.teacher.outpassPrivileges?.isMentor);

  const handleBulkAssignSkill = async () => {
    const cleanSkill = bulkSkillInput.trim();
    if (!cleanSkill) return alert('Please type a Skill name to assign (e.g. Arabic Debate).');
    if (selectedStudentRegs.length === 0) return alert('Please select at least one student using the checkboxes.');

    setIsAssigningMentor(true);
    try {
      await Promise.all(
        selectedStudentRegs.map(regNo => {
          const st = students.find(s => s.regNo === regNo);
          const curSkills = Array.isArray(st?.skills) ? st.skills : [];
          const nextSkills = Array.from(new Set([...curSkills, cleanSkill]));
          if (onStudentUpdated && st) onStudentUpdated({ ...st, skills: nextSkills });
          return setDoc(doc(db, 'students', String(regNo).toLowerCase()), { skills: nextSkills }, { merge: true });
        })
      );
      setMentorAssignStatus(`🏆 Added skill "${cleanSkill}" to ${selectedStudentRegs.length} students!`);
      setBulkSkillInput('');
      setSelectedStudentRegs([]);
    } catch (err) {
      alert('Failed to bulk-add skill: ' + err.message);
    } finally {
      setIsAssigningMentor(false);
      setTimeout(() => setMentorAssignStatus(''), 5000);
    }
  };

  const handleBulkAssignMentor = async () => {
    if (selectedStudentRegs.length === 0) return alert('Select students first.');
    if (!targetMentorUsername) return alert('Select a Mentor.');
    const mentorObj = teachers.find(t => t.username === targetMentorUsername);
    const isUnassign = targetMentorUsername === '__UNASSIGN__';
    setIsAssigningMentor(true);
    try {
      const newMentorUser = isUnassign ? '' : mentorObj.username;
      const newMentorName = isUnassign ? '' : mentorObj.fullName;
      await Promise.all(
        selectedStudentRegs.map(regNo =>
          setDoc(doc(db, 'students', String(regNo).toLowerCase()), { mentorUsername: newMentorUser, mentorName: newMentorName }, { merge: true })
        )
      );
      if (onStudentUpdated) {
        selectedStudentRegs.forEach(regNo => {
          const found = students.find(s => s.regNo === regNo);
          if (found) onStudentUpdated({ ...found, mentorUsername: newMentorUser, mentorName: newMentorName });
        });
      }
      setMentorAssignStatus(`✅ Updated mentor for ${selectedStudentRegs.length} students!`);
      setSelectedStudentRegs([]);
    } catch (err) {
      alert('Failed: ' + err.message);
    } finally {
      setIsAssigningMentor(false);
    }
  };

  const handleSingleStudentMentorChange = async (student, newMentorUsername) => {
    const mentorObj = teachers.find(t => t.username === newMentorUsername);
    const updatedUser = mentorObj ? mentorObj.username : '';
    const updatedName = mentorObj ? mentorObj.fullName : '';
    try {
      await setDoc(doc(db, 'students', String(student.regNo).toLowerCase()), { mentorUsername: updatedUser, mentorName: updatedName }, { merge: true });
      if (onStudentUpdated) onStudentUpdated({ ...student, mentorUsername: updatedUser, mentorName: updatedName });
    } catch (err) {}
  };

  const toggleSelectAllDisplayed = () => {
    const displayedRegs = displayStudents.map(s => s.regNo);
    const allChecked = displayedRegs.length > 0 && displayedRegs.every(r => selectedStudentRegs.includes(r));
    setSelectedStudentRegs(allChecked ? [] : displayedRegs);
  };

  return (
    <div>
      {editingStudent && (
        <StudentPortfolioModal
          student={editingStudent}
          canEditSkills={true}
          canViewConfidential={true}
          editorName={loggedInTeacher?.fullName || (isAdmin ? 'Admin' : 'Outreach Coordinator')}
          initialSection={modalInitialSection}
          semesterTarget={semesterTargetConfig.minConsultations}
          onClose={() => setEditingStudent(null)}
          onSaved={(updated) => {
            setEditingStudent(updated);
            if (onStudentUpdated) onStudentUpdated(updated);
          }}
        />
      )}

      {/* 🌟 MINIMALIST TOP BAR + ACTION BUTTONS */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {canManageMentorAssignments && (isAdmin || isOutreachView) ? (
            [
              { id: 'directory', label: `Students (${students.length})` },
              { id: 'usthads', label: `Usthad Audit (${usthadAuditRows.length})` },
              { id: 'queue', label: `Pending Sittings (${belowTargetCount})` }
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => { setOutreachActiveSubTab(tab.id); setInspectingUsthadUsername(''); }}
                style={{
                  padding: '9px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '700',
                  border: outreachActiveSubTab === tab.id ? '1px solid #4f46e5' : '1px solid #cbd5e1',
                  background: outreachActiveSubTab === tab.id ? '#4f46e5' : '#ffffff',
                  color: outreachActiveSubTab === tab.id ? '#ffffff' : '#334155'
                }}
              >
                {tab.label}
              </button>
            ))
          ) : (
            availableDutyTabs.map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setTeacherViewMode(tab.id)}
                style={{
                  padding: '9px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '700',
                  border: teacherViewMode === tab.id ? '1px solid #4f46e5' : '1px solid #cbd5e1',
                  background: teacherViewMode === tab.id ? '#4f46e5' : '#ffffff',
                  color: teacherViewMode === tab.id ? '#ffffff' : '#334155'
                }}
              >
                {tab.label}
              </button>
            ))
          )}
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {canManageMentorAssignments && (isAdmin || isOutreachView) && (
            <>
              <button
                type="button"
                onClick={() => setActiveToolDrawer(activeToolDrawer === 'bulk' ? 'none' : 'bulk')}
                style={{
                  padding: '9px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: '700', cursor: 'pointer',
                  background: activeToolDrawer === 'bulk' ? '#eef2ff' : '#ffffff',
                  color: '#4f46e5', border: '1px solid #c7d2fe'
                }}
              >
                🧭 Bulk Assign ({selectedStudentRegs.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveToolDrawer(activeToolDrawer === 'target' ? 'none' : 'target')}
                style={styles.buttonSecondary}
              >
                ⚙️ Target ({semesterTargetConfig.minConsultations} Sittings)
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setActiveToolDrawer(activeToolDrawer === 'filters' ? 'none' : 'filters')}
            style={styles.buttonSecondary}
          >
            🎛️ Filter &amp; Columns
          </button>
        </div>
      </div>

      {/* 🌟 CLASS TEACHER LIVE PRESENCE & TODAY'S PERIOD ATTENDANCE FEED */}
      {hasClassDuty && !isAdmin && !isOutreachView && teacherViewMode === 'CLASS' && (
        <div style={{ background: '#ffffff', padding: '20px', borderRadius: '16px', border: '1px solid #cbd5e1', marginBottom: '22px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px' }}>
            <div>
              <span style={{ background: '#ecfdf5', color: '#047857', padding: '3px 9px', borderRadius: '6px', fontSize: '11px', fontWeight: '800' }}>
                🏫 CLASS TEACHER LIVE FEED
              </span>
              <h3 style={{ margin: '4px 0 0', fontSize: '18px', fontWeight: '800', color: '#0f172a' }}>
                Class {myClassTeacherOf.join(', ')} — Campus Presence &amp; Today's Periods
              </h3>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', fontWeight: '700', color: '#475569' }}>Month:</span>
              <input type="month" value={selectedMonthForFnAn} onChange={e => setSelectedMonthForFnAn(e.target.value)} style={{ ...styles.input, width: '165px', padding: '6px 10px', fontSize: '12px', fontWeight: '700' }} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '18px' }}>
            <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
              <span style={{ fontSize: '10px', fontWeight: '800', color: '#64748b' }}>TOTAL CLASS STRENGTH</span>
              <div style={{ fontSize: '24px', fontWeight: '900', color: '#0f172a', marginTop: '4px' }}>{classStudentsList.length}</div>
            </div>
            <div style={{ background: '#ecfdf5', padding: '14px', borderRadius: '12px', border: '1px solid #a7f3d0', textAlign: 'center' }}>
              <span style={{ fontSize: '10px', fontWeight: '800', color: '#047857' }}>🟢 INSIDE CAMPUS</span>
              <div style={{ fontSize: '24px', fontWeight: '900', color: '#065f46', marginTop: '4px' }}>{classLiveInsideCount}</div>
            </div>
            <div style={{ background: '#fffbeb', padding: '14px', borderRadius: '12px', border: '1px solid #fde68a', textAlign: 'center' }}>
              <span style={{ fontSize: '10px', fontWeight: '800', color: '#b45309' }}>🟠 OFF-CAMPUS / OUTSIDE</span>
              <div style={{ fontSize: '24px', fontWeight: '900', color: '#d97706', marginTop: '4px' }}>{classLiveOutsideCount}</div>
            </div>
            <div style={{ background: '#fff1f2', padding: '14px', borderRadius: '12px', border: '1px solid #fecdd3', textAlign: 'center' }}>
              <span style={{ fontSize: '10px', fontWeight: '800', color: '#be123c' }}>🚨 ABSENT &ge; 5 DAYS ({selectedMonthForFnAn})</span>
              <div style={{ fontSize: '24px', fontWeight: '900', color: '#e11d48', marginTop: '4px' }}>{classAbsentGt5Count}</div>
            </div>
          </div>

          {/* Today's Period-by-Period Roll-Call Feed for Class */}
          <div style={{ marginBottom: '16px', background: '#f8fafc', padding: '14px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
            <div style={{ fontWeight: '800', fontSize: '13px', color: '#0f172a', marginBottom: '8px' }}>
              📅 Today's Period Attendance Feed (Periods 1 to 9):
            </div>
            {todayPeriodsCache.length === 0 ? (
              <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '600' }}>
                No period attendance recorded for today yet.
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {todayPeriodsCache.map(sess => {
                  const mapVals = Object.values(sess.attendanceMap || {});
                  const presC = mapVals.filter(v => v === 'P' || v === 'O').length;
                  const absC = mapVals.length - presC;
                  return (
                    <div key={sess.id} style={{ background: '#ffffff', border: '1px solid #cbd5e1', padding: '8px 12px', borderRadius: '8px', fontSize: '12px' }}>
                      <span style={{ background: '#4f46e5', color: '#ffffff', padding: '1px 6px', borderRadius: '4px', fontWeight: '800', fontSize: '10px' }}>
                        P{sess.session}
                      </span>
                      <strong style={{ marginLeft: '6px', color: '#0f172a' }}>{sess.classAlias || sess.subject}</strong>
                      <div style={{ fontSize: '11px', color: '#475569', marginTop: '2px' }}>
                        ✅ {presC} Pres • ❌ {absC} Abs ({sess.teacherName})
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* FN / AN Monthly Summary Table with Filter Pills */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ fontSize: '13px', fontWeight: '800', color: '#0f172a' }}>
              🌤️ Monthly Day Summary (Forenoon + Afternoon Sessions)
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {[
                { id: 'ALL', label: `All Students (${classFnAnRows.length})` },
                { id: 'ABSENT_GT_5', label: `🚨 Absent ≥ 5 Days (${classAbsentGt5Count})` }
              ].map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setClassTeacherFnAnFilter(p.id)}
                  style={{
                    padding: '5px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: '700', cursor: 'pointer',
                    border: classTeacherFnAnFilter === p.id ? '1px solid #4f46e5' : '1px solid #cbd5e1',
                    background: classTeacherFnAnFilter === p.id ? '#4f46e5' : '#ffffff',
                    color: classTeacherFnAnFilter === p.id ? '#ffffff' : '#334155'
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left', minWidth: '750px' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '10px', fontWeight: '800', textTransform: 'uppercase' }}>
                  <th style={{ padding: '10px 12px' }}>Student</th>
                  <th style={{ padding: '10px 12px' }}>Ad.No</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center' }}>Working Days</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center' }}>Days Present</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center' }}>Days Absent</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center' }}>Attendance %</th>
                  <th style={{ padding: '10px 12px' }}>Absent Dates &amp; Leave Reasons</th>
                </tr>
              </thead>
              <tbody>
                {filteredClassFnAnRows.map(r => (
                  <tr key={r.student.regNo} style={{ borderBottom: '1px solid #f1f5f9', background: r.isAbsentMoreThan5Days ? '#fff1f2' : '#ffffff' }}>
                    <td style={{ padding: '11px 12px', fontWeight: '700', color: '#0f172a' }}>{r.student.firstName}</td>
                    <td style={{ padding: '11px 12px', color: '#475569' }}>#{r.student.adNo}</td>
                    <td style={{ padding: '11px 12px', textAlign: 'center', fontWeight: '700' }}>{r.workingDaysHeld}d</td>
                    <td style={{ padding: '11px 12px', textAlign: 'center', fontWeight: '700', color: '#047857' }}>{r.totalDaysPresent}d</td>
                    <td style={{ padding: '11px 12px', textAlign: 'center', fontWeight: '800', color: r.totalDaysAbsent >= 5 ? '#e11d48' : '#334155' }}>
                      {r.totalDaysAbsent}d
                    </td>
                    <td style={{ padding: '11px 12px', textAlign: 'center' }}>
                      <span style={{ background: Number(r.dayAttPct) < 85 ? '#fee2e2' : '#dcfce7', color: Number(r.dayAttPct) < 85 ? '#e11d48' : '#15803d', padding: '2px 8px', borderRadius: '999px', fontWeight: '800' }}>
                        {r.dayAttPct}%
                      </span>
                    </td>
                    <td style={{ padding: '11px 12px', fontSize: '11px' }}>
                      {r.absentDatesDetails.length > 0 && (
                        <div style={{ color: '#e11d48', fontWeight: '600' }}>
                          📅 {r.absentDatesDetails.slice(0, 5).join(', ')}
                        </div>
                      )}
                      {r.leaveReasonsList.length > 0 ? (
                        <div style={{ color: '#475569', fontWeight: '600', marginTop: '2px' }}>
                          🪪 {r.leaveReasonsList.join(' • ')}
                        </div>
                      ) : r.totalDaysAbsent === 0 ? (
                        <span style={{ color: '#047857', fontWeight: '700' }}>✓ 100% Present</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SOFT PASTEL KPI STRIP (Matches Marks Auditor Style) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '14px', marginBottom: '20px' }}>
        <div style={{ padding: '16px', borderRadius: '12px', background: '#f8fafc', border: '1px solid #e2e8f0', textAlign: 'center' }}>
          <span style={{ fontSize: '11px', fontWeight: '800', color: '#475569' }}>STUDENTS IN SCOPE</span>
          <div style={{ fontSize: '24px', fontWeight: '900', color: '#0f172a', marginTop: '4px' }}>{totalScope}</div>
        </div>
        <div style={{ padding: '16px', borderRadius: '12px', background: '#ecfdf5', border: '1px solid #a7f3d0', textAlign: 'center' }}>
          <span style={{ fontSize: '11px', fontWeight: '800', color: '#047857' }}>MET TARGET (&ge;{semesterTargetConfig.minConsultations})</span>
          <div style={{ fontSize: '24px', fontWeight: '900', color: '#065f46', marginTop: '4px' }}>{targetMetCount}</div>
        </div>
        <div style={{ padding: '16px', borderRadius: '12px', background: '#fff1f2', border: '1px solid #fecdd3', textAlign: 'center' }}>
          <span style={{ fontSize: '11px', fontWeight: '800', color: '#be123c' }}>BELOW TARGET</span>
          <div style={{ fontSize: '24px', fontWeight: '900', color: '#e11d48', marginTop: '4px' }}>{belowTargetCount}</div>
        </div>
        <div style={{ padding: '16px', borderRadius: '12px', background: '#eff6ff', border: '1px solid #bfdbfe', textAlign: 'center' }}>
          <span style={{ fontSize: '11px', fontWeight: '800', color: '#1d4ed8' }}>TOTAL SITTINGS LOGGED</span>
          <div style={{ fontSize: '24px', fontWeight: '900', color: '#2563eb', marginTop: '4px' }}>{totalSittingsLoggedInScope}</div>
        </div>
      </div>

      {/* TOOL DRAWER 1: TARGET SETTER */}
      {activeToolDrawer === 'target' && (
        <form onSubmit={handleSaveSemesterTargetConfig} className="erp-slide-panel" style={styles.card}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', alignItems: 'end' }}>
            <div>
              <label style={styles.label}>Semester Name</label>
              <input
                type="text"
                value={semesterTargetConfig.semesterName}
                onChange={e => setSemesterTargetConfig({ ...semesterTargetConfig, semesterName: e.target.value })}
                style={styles.input}
              />
            </div>
            <div>
              <label style={styles.label}>Minimum Sittings per Mentee</label>
              <input
                type="number"
                min="1"
                max="20"
                value={semesterTargetConfig.minConsultations}
                onChange={e => setSemesterTargetConfig({ ...semesterTargetConfig, minConsultations: Number(e.target.value) })}
                style={styles.input}
              />
            </div>
            <div>
              <label style={styles.label}>Target Deadline</label>
              <input
                type="date"
                value={semesterTargetConfig.targetDeadline || ''}
                onChange={e => setSemesterTargetConfig({ ...semesterTargetConfig, targetDeadline: e.target.value })}
                style={styles.input}
              />
            </div>
            <button type="submit" disabled={isSavingConfig} style={styles.buttonPrimary}>
              {isSavingConfig ? 'Saving...' : 'Save Target'}
            </button>
          </div>
        </form>
      )}

      {/* TOOL DRAWER 2: BULK MENTOR & BULK SKILL ASSIGN */}
      {activeToolDrawer === 'bulk' && (
        <div className="erp-slide-panel" style={styles.card}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <select
                value={targetMentorUsername}
                onChange={(e) => setTargetMentorUsername(e.target.value)}
                style={{ ...styles.input, flex: 1 }}
              >
                <option value="">-- Select Mentor Usthad --</option>
                <option value="__UNASSIGN__">Clear Mentor</option>
                {teachers.map(t => (
                  <option key={t.username} value={t.username}>{t.fullName}</option>
                ))}
              </select>
              <button
                type="button"
                disabled={isAssigningMentor}
                onClick={handleBulkAssignMentor}
                style={{ ...styles.buttonPrimary, whiteSpace: 'nowrap' }}
              >
                Assign Mentor ({selectedStudentRegs.length})
              </button>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                placeholder="Type skill (e.g. Debate, Calligraphy)..."
                value={bulkSkillInput}
                onChange={e => setBulkSkillInput(e.target.value)}
                style={{ ...styles.input, flex: 1 }}
              />
              <button
                type="button"
                disabled={isAssigningMentor}
                onClick={handleBulkAssignSkill}
                style={{ ...styles.buttonSecondary, whiteSpace: 'nowrap' }}
              >
                + Bulk Skill
              </button>
              <button
                type="button"
                onClick={toggleSelectAllDisplayed}
                style={{ ...styles.buttonSecondary, whiteSpace: 'nowrap' }}
              >
                Select All ({displayStudents.length})
              </button>
            </div>
          </div>
          {mentorAssignStatus && (
            <div style={{ marginTop: '10px', color: '#047857', fontWeight: '700', fontSize: '13px' }}>
              {mentorAssignStatus}
            </div>
          )}
        </div>
      )}

      {/* TOOL DRAWER 3: FILTERS & EXTRA COLUMNS */}
      {activeToolDrawer === 'filters' && (
        <div className="erp-slide-panel" style={{ ...styles.card, background: '#f8fafc', padding: '16px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <select
                value={filterConsultancyStatus}
                onChange={(e) => setFilterConsultancyStatus(e.target.value)}
                style={styles.filterSelect}
              >
                <option value="All">All Consultancy Status</option>
                <option value="TargetMet">Met Target</option>
                <option value="BelowTarget">Below Target</option>
                <option value="ZeroSittings">Zero Sittings (0)</option>
              </select>
              <select
                value={filterCompletion}
                onChange={(e) => setFilterCompletion(e.target.value)}
                style={styles.filterSelect}
              >
                <option value="All">All Profile Status</option>
                <option value="Incomplete">Incomplete</option>
                <option value="Complete">Complete</option>
              </select>
              {(isAdmin || isOutreachView) && (
                <>
                  <select
                    value={outreachClassFilter}
                    onChange={(e) => setOutreachClassFilter(e.target.value)}
                    style={styles.filterSelect}
                  >
                    <option value="All">All Classes</option>
                    {DEFAULT_CLASSES.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <select
                    value={outreachRoleFilter}
                    onChange={(e) => setOutreachRoleFilter(e.target.value)}
                    style={styles.filterSelect}
                  >
                    <option value="All">All Mentor Status</option>
                    <option value="Mentors Assigned">Mentor Assigned</option>
                    <option value="No Mentor">Unassigned</option>
                  </select>
                </>
              )}
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', fontWeight: '800', color: '#64748b' }}>COLUMNS:</span>
              {[
                { key: 'skills', label: 'Skills & Profile %' },
                { key: 'contact', label: 'Phone & District' }
              ].map(col => (
                <button
                  key={col.key}
                  type="button"
                  onClick={() => setVisibleCols(prev => ({ ...prev, [col.key]: !prev[col.key] }))}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: '700',
                    cursor: 'pointer',
                    background: visibleCols[col.key] ? '#4f46e5' : '#ffffff',
                    color: visibleCols[col.key] ? '#ffffff' : '#475569',
                    border: '1px solid #cbd5e1'
                  }}
                >
                  {visibleCols[col.key] ? `✓ ${col.label}` : `+ ${col.label}`}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* USTHAD AUDIT VIEW */}
      {canManageMentorAssignments && (isAdmin || isOutreachView) && outreachActiveSubTab === 'usthads' ? (
        <div style={{ ...styles.card, padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '11px', fontWeight: '800', textTransform: 'uppercase' }}>
                <th style={{ padding: '14px 16px' }}>MENTOR USTHAD</th>
                <th style={{ padding: '14px 16px', textAlign: 'center' }}>MENTEES</th>
                <th style={{ padding: '14px 16px', textAlign: 'center' }}>SITTINGS HELD</th>
                <th style={{ padding: '14px 16px', textAlign: 'center' }}>MET TARGET</th>
                <th style={{ padding: '14px 16px', textAlign: 'right' }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {usthadAuditRows.map((row) => (
                <tr key={row.teacher.username} style={{ borderBottom: '1px solid #f1f5f9', background: '#ffffff' }}>
                  <td style={{ padding: '14px 16px', fontWeight: '700', color: '#0f172a' }}>
                    {row.teacher.fullName} <span style={{ color: '#94a3b8', fontSize: '12px' }}>(@{row.teacher.username})</span>
                  </td>
                  <td style={{ padding: '14px 16px', textAlign: 'center', fontWeight: '700' }}>{row.totalMentees}</td>
                  <td style={{ padding: '14px 16px', textAlign: 'center', fontWeight: '700', color: '#4f46e5' }}>{row.totalSessions}</td>
                  <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                    <span style={{ background: '#dcfce7', color: '#15803d', padding: '4px 10px', borderRadius: '999px', fontWeight: '700', fontSize: '11px' }}>
                      {row.metTargetMentees} / {row.totalMentees} ({row.targetCompletionPct}%)
                    </span>
                  </td>
                  <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                    <button
                      type="button"
                      onClick={() => { setInspectingUsthadUsername(row.teacher.username); setOutreachActiveSubTab('directory'); }}
                      style={{ padding: '6px 12px', background: '#eef2ff', color: '#4f46e5', border: 'none', borderRadius: '8px', fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}
                    >
                      👁️ View Mentees
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        /* MINIMALIST STUDENT MENTORSHIP & MENTEE ATTENDANCE TABLE */
        <div style={{ ...styles.card, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="🔍 Search student name or Ad.No..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ ...styles.input, maxWidth: '300px', padding: '8px 12px', fontSize: '13px' }}
            />
            {inspectingUsthadUsername && (
              <button type="button" onClick={() => setInspectingUsthadUsername('')} style={styles.buttonSecondary}>
                ✕ Clear Usthad Filter (@{inspectingUsthadUsername})
              </button>
            )}
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '11px', fontWeight: '800', textTransform: 'uppercase' }}>
                  {canManageMentorAssignments && (isAdmin || isOutreachView) && (
                    <th style={{ padding: '14px 12px', width: '40px' }}>
                      <input
                        type="checkbox"
                        checked={displayStudents.length > 0 && displayStudents.every(s => selectedStudentRegs.includes(s.regNo))}
                        onChange={toggleSelectAllDisplayed}
                      />
                    </th>
                  )}
                  <th style={{ padding: '14px 16px' }}>STUDENT NAME</th>
                  <th style={{ padding: '14px 16px' }}>AD.NO</th>
                  <th style={{ padding: '14px 16px' }}>CLASS &amp; MENTOR</th>
                  <th style={{ padding: '14px 16px' }}>CAMPUS &amp; ATTENDANCE STATUS</th>
                  <th style={{ padding: '14px 16px' }}>SITTINGS STATUS</th>
                  <th style={{ padding: '14px 16px', textAlign: 'right' }}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {displayStudents.map((st) => {
                  const comp = computeStudentProfileCompletion(st);
                  const cMetrics = getStudentConsultancyMetrics(st);
                  const isChecked = selectedStudentRegs.includes(st.regNo);
                  const isExpanded = expandedRowRegNo === st.regNo;
                  const liveOp = liveOutpassesMap[st.regNo];
                  const stStat = getStudentAttStat(st);
                  const stNetPres = Math.max(0, (stStat.presentCount || 0) - (stStat.minusCount || 0));
                  const stAttPct = stStat.totalPeriods > 0 ? ((stNetPres / stStat.totalPeriods) * 100).toFixed(1) : '100.0';

                  if (outreachActiveSubTab === 'queue' && cMetrics.metTarget && !cMetrics.isEscalated) return null;

                  return (
                    <React.Fragment key={st.regNo}>
                      <tr
                        onClick={() => setExpandedRowRegNo(isExpanded ? null : st.regNo)}
                        style={{ borderBottom: '1px solid #f1f5f9', background: isChecked || isExpanded ? '#f8fafc' : '#ffffff', cursor: 'pointer' }}
                      >
                        {canManageMentorAssignments && (isAdmin || isOutreachView) && (
                          <td style={{ padding: '14px 12px' }} onClick={e => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => setSelectedStudentRegs(prev => prev.includes(st.regNo) ? prev.filter(r => r !== st.regNo) : [...prev, st.regNo])}
                            />
                          </td>
                        )}
                        <td style={{ padding: '14px 16px', fontWeight: '700', color: '#0f172a' }}>{st.firstName}</td>
                        <td style={{ padding: '14px 16px', color: '#475569', fontWeight: '600' }}>{st.adNo}</td>
                        <td style={{ padding: '14px 16px' }} onClick={e => e.stopPropagation()}>
                          <span style={{ fontWeight: '700', color: '#334155', marginRight: '8px' }}>{(st.classes || []).join(', ')}</span>
                          {canManageMentorAssignments && (isAdmin || isOutreachView) ? (
                            <select
                              value={st.mentorUsername || ''}
                              onChange={(e) => handleSingleStudentMentorChange(st, e.target.value)}
                              style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12px' }}
                            >
                              <option value="">Unassigned</option>
                              {teachers.map(t => (
                                <option key={t.username} value={t.username}>{t.fullName}</option>
                              ))}
                            </select>
                          ) : (
                            <span style={{ fontSize: '12px', color: '#64748b' }}>• {st.mentorName || st.mentorUsername || 'Unassigned'}</span>
                          )}
                        </td>

                        <td style={{ padding: '14px 16px' }}>
                          {liveOp ? (
                            <span style={{ background: '#fef3c7', color: '#92400e', padding: '3px 9px', borderRadius: '999px', fontSize: '11px', fontWeight: '700' }}>
                              🟠 Out: {liveOp.destination}
                            </span>
                          ) : (
                            <span style={{ background: '#dcfce7', color: '#15803d', padding: '3px 9px', borderRadius: '999px', fontSize: '11px', fontWeight: '700' }}>
                              🟢 In Campus ({stAttPct}%)
                            </span>
                          )}
                        </td>

                        <td style={{ padding: '14px 16px' }}>
                          <span style={{
                            background: cMetrics.metTarget ? '#dcfce7' : cMetrics.count > 0 ? '#fef3c7' : '#fff1f2',
                            color: cMetrics.metTarget ? '#15803d' : cMetrics.count > 0 ? '#b45309' : '#e11d48',
                            padding: '4px 10px',
                            borderRadius: '999px',
                            fontSize: '11px',
                            fontWeight: '700'
                          }}>
                            {cMetrics.count} / {cMetrics.minReq} Sittings
                          </span>
                        </td>

                        <td style={{ padding: '14px 16px', textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                          <div style={{ display: 'inline-flex', gap: '8px' }}>
                            <button
                              type="button"
                              onClick={() => { setModalInitialSection('log'); setEditingStudent(st); }}
                              style={{ padding: '6px 12px', background: '#eef2ff', color: '#4f46e5', border: 'none', borderRadius: '8px', fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}
                            >
                              📝 Log Sitting
                            </button>
                            <button
                              type="button"
                              onClick={() => setExpandedRowRegNo(isExpanded ? null : st.regNo)}
                              style={{ padding: '6px 12px', background: '#f1f5f9', color: '#334155', border: 'none', borderRadius: '8px', fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}
                            >
                              👁️ {isExpanded ? 'Hide' : 'View'}
                            </button>
                          </div>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                          <td colSpan={7} style={{ padding: '16px 24px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
                              <div>
                                <div style={{ fontWeight: '700', fontSize: '13px', color: '#0f172a' }}>
                                  Attendance: {stAttPct}% Net • Total Periods: {stStat.totalPeriods} • Minus: -{stStat.minusCount || 0} • Skills: {(st.skills || []).join(', ') || 'None'}
                                </div>
                                {cMetrics.latestLog?.summary && (
                                  <div style={{ fontSize: '12px', color: '#475569', marginTop: '4px' }}>
                                    💬 Latest Sitting Notes: &ldquo;{cMetrics.latestLog.summary}&rdquo;
                                  </div>
                                )}
                              </div>
                              <div style={{ display: 'flex', gap: '8px' }}>
                                <button
                                  type="button"
                                  onClick={() => { setModalInitialSection('skills'); setEditingStudent(st); }}
                                  style={styles.buttonSecondary}
                                >
                                  🏆 Manage Skills &amp; Awards
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openDirectWhatsApp(st.parentWhatsapp || st.parentMobile, `Assalamu Alaikum, update regarding ${st.firstName} (#${st.adNo}):`)}
                                  style={styles.buttonSecondary}
                                >
                                  💬 Parent WA
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}