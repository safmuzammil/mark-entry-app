'use client';
import * as XLSX from 'xlsx';
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
// 📊 4. STUDENT PROFILE COMPLETION RATE CALCULATOR & AUTO CLASS TEACHER HELPER
// ============================================================================
export function computeStudentProfileCompletion(student) {
  if (!student) return { pct: 0, missing: [], isComplete: false };
  const checks = [
    { label: 'Photo', ok: Boolean(student.photoUrl) },
    { label: 'Student Phone', ok: Boolean(student.mobileNumber || student.whatsappNumber) },
    { label: 'Email', ok: Boolean(student.email && String(student.email).includes('@')) },
    { label: 'Parent WhatsApp', ok: Boolean(student.parentWhatsapp || student.parentMobile) },
    { label: 'District & State', ok: Boolean(student.district && student.state) },
    { label: 'Class & Dept', ok: Boolean((student.classes || []).length > 0 && student.department) },
    { label: 'Mentor', ok: Boolean(student.mentorUsername) },
    { label: 'Skills', ok: Boolean(Array.isArray(student.skills) && student.skills.length > 0) }
  ];
  const completedCount = checks.filter(c => c.ok).length;
  const pct = Math.round((completedCount / checks.length) * 100);
  const missing = checks.filter(c => !c.ok).map(c => c.label);
  return {
    pct,
    completedCount,
    totalFields: checks.length,
    missing,
    isComplete: missing.length === 0
  };
}

export function resolveClassTeacherForStudent(student, teachersList = []) {
  const stClasses = Array.isArray(student?.classes) ? student.classes : [student?.studentClass].filter(Boolean);
  for (const t of teachersList) {
    const ctClasses = t.outpassPrivileges?.classTeacherOf || t.classTeacherOf || [];
    if (ctClasses.some(c => stClasses.includes(c))) {
      return t;
    }
  }
  if (student?.classTeacherUsername) {
    return teachersList.find(t => String(t.username || '').toLowerCase() === String(student.classTeacherUsername).toLowerCase()) || null;
  }
  return null;
}

export function checkSmartSubjectMatch(dbKey, expectedSub) {
  const a = String(dbKey || '').trim().toUpperCase();
  const b = String(expectedSub || '').trim().toUpperCase();
  const isAUsul = a === 'U :FIQH' || a === 'U:FIQH' || a.includes('U :FIQH') || a.includes('U:FIQH');
  const isBUsul = b === 'U :FIQH' || b === 'U:FIQH' || b.includes('U :FIQH') || b.includes('U:FIQH');

  if (isAUsul || isBUsul) return isAUsul && isBUsul;
  if (a === 'FIQH' || b === 'FIQH') return a === 'FIQH' && b === 'FIQH';
  if (a === b) return true;
  const isALogic = a.includes('LOGIC') || a.includes('MANTIQ') || a.includes('DIRASATH') || a.includes('ADYAN');
  const isBLogic = b.includes('LOGIC') || b.includes('MANTIQ') || b.includes('DIRASATH') || b.includes('ADYAN');
  if (isALogic && isBLogic) return true;
  if ((a.includes('AQIDAH') || a.includes('AQEEDA')) && (b.includes('AQIDAH') || b.includes('AQEEDA'))) return true;
  if ((a.includes('THAMADUN') || a.includes('THAMADAN')) && (b.includes('THAMADUN') || b.includes('THAMADAN'))) return true;
  return false;
}

export function doesClassMatchAlias(studentClasses, targetClass, alias, grade) {
  const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const stClassesNorm = (Array.isArray(studentClasses) ? studentClasses : [studentClasses])
    .filter(Boolean)
    .map(c => norm(c));

  if (stClassesNorm.length === 0) return false;

  const targetNorm = norm(targetClass);
  const aliasNorm = norm(alias);
  const aliasUpper = String(alias || '').toUpperCase();

  const KNOWN_SPECIFIC_CLASSES = [
    'QH1', 'AL1', 'ALC1', 'FC1',
    'QH2', 'AL2', 'ALC2', 'FC2',
    'QLA3', 'HFC3', 'QH3', 'AL3', 'FC3'
  ];

  const specificTarget = KNOWN_SPECIFIC_CLASSES.find(
    cls => targetNorm === cls || targetNorm.includes(cls)
  );
  if (specificTarget) {
    return stClassesNorm.some(sc =>
      sc === specificTarget ||
      (specificTarget === 'ALC2' && sc === 'AL2') ||
      (specificTarget === 'AL2' && sc === 'ALC2') ||
      (specificTarget === 'ALC1' && sc === 'AL1') ||
      (specificTarget === 'AL1' && sc === 'ALC1')
    );
  }

  const specificInAlias = KNOWN_SPECIFIC_CLASSES.filter(cls => aliasNorm.includes(cls));
  if (specificInAlias.length > 0) {
    return stClassesNorm.some(sc =>
      specificInAlias.some(cls =>
        sc === cls ||
        (cls === 'ALC2' && sc === 'AL2') ||
        (cls === 'AL2' && sc === 'ALC2') ||
        (cls === 'ALC1' && sc === 'AL1') ||
        (cls === 'AL1' && sc === 'ALC1')
      )
    );
  }

  let stGrade = '1';
  if (stClassesNorm.some(c => c.includes('10') || c.includes('3'))) stGrade = '3';
  else if (stClassesNorm.some(c => c.includes('9') || c.includes('2'))) stGrade = '2';

  if (/\b(M10|U10)\b/.test(aliasUpper) || aliasUpper.includes('GRADE 3')) return stGrade === '3';
  if (/\b(M9|U9)\b/.test(aliasUpper) || aliasUpper.includes('GRADE 2')) return stGrade === '2';
  if (/\b(M8|U8)\b/.test(aliasUpper) || aliasUpper.includes('GRADE 1')) return stGrade === '1';

  if (grade && (!targetNorm || targetNorm.includes('GRADE') || targetNorm === 'ALL')) {
    return String(grade).trim() === stGrade;
  }

  return false;
}

// ============================================================================
// 👤 5. REUSABLE AVATAR COMPONENT
// ============================================================================
export function ProfileAvatar({ name, code, photoUrl, size = 40, onClick }) {
  const [step, setStep] = useState(photoUrl ? 0 : 1);
  useEffect(() => { setStep(photoUrl ? 0 : 1); }, [photoUrl, code]);
  const initial = (name || 'U').trim().charAt(0).toUpperCase();
  const srcToTry = step === 0 ? photoUrl : step === 1 && code ? `/students/${code}.jpg` : null;

  return (
    <div
      onClick={onClick}
      style={{
        width: size,
        height: size,
        minWidth: size,
        borderRadius: '50%',
        background: '#4f46e5',
        color: '#ffffff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: '700',
        fontSize: Math.round(size * 0.42),
        overflow: 'hidden',
        border: '1.5px solid #e0e7ff',
        cursor: onClick ? 'pointer' : 'default'
      }}
    >
      {srcToTry && step < 2 ? (
        <img
          src={srcToTry}
          alt={name}
          onError={() => setStep(prev => prev + 1)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <span>{initial}</span>
      )}
    </div>
  );
}

// ============================================================================
// 📚 6. SINGLE-TEACHER PER SUBJECT SELECTOR
// ============================================================================
export function SubjectTeacherSelector({
  selectedClasses = [],
  adNo = '',
  teachersList = [],
  selectedEnrollmentKeys = [],
  onChangeSelectedKeys
}) {
  const detectedGrades = Array.from(
    new Set(
      selectedClasses
        .map(c => {
          const match = String(c).match(/\d+/);
          return match ? match[0] : null;
        })
        .filter(Boolean)
    )
  );
  const targetGrade = detectedGrades[0] || '1';
  const selectedClassesUpper = selectedClasses.map(c => String(c).trim().toUpperCase());
  const isUrduStudent = String(adNo || '').trim().toUpperCase().startsWith('U');

  const designatedClassTeacher = teachersList.find(t =>
    (t.outpassPrivileges?.classTeacherOf || []).some(c => selectedClassesUpper.includes(String(c).toUpperCase()))
  );

  const subjectMappings = DEFAULT_SUBJECTS.map(subName => {
    const subUpper = subName.toUpperCase();
    const matchingOptions = [];

    teachersList.forEach(teacher => {
      (teacher.enrollments || []).forEach(env => {
        const envSub = String(env.subject || '').trim();
        const envAlias = String(env.alias || '').trim();
        const isSubjectMatch = checkSmartSubjectMatch(
          envAlias.toUpperCase().includes('U :FIQH') ? 'U :FIQH' : envSub,
          subName
        );

        if (
          isSubjectMatch &&
          doesClassMatchAlias(selectedClasses, env.targetClass, env.alias, env.grade)
        ) {
          matchingOptions.push({
            key: `${teacher.username}:::${env.id}`,
            teacherUsername: teacher.username,
            teacherName: teacher.fullName,
            envId: env.id,
            targetClass: env.targetClass || `Grade ${env.grade}`,
            alias: env.alias || `${env.targetClass || `Grade ${env.grade}`} - ${env.subject}`,
            langTag: env.langTag || 'General'
          });
        }
      });
    });

    return {
      subject: subName,
      isHifz: subUpper === 'HIFZ',
      options: matchingOptions
    };
  });

  const handleSelectSingleTeacherForSubject = (subjectOptions, chosenKey) => {
    const optionKeysForThisSubject = new Set(subjectOptions.map(o => o.key));
    const alreadySelected = selectedEnrollmentKeys.includes(chosenKey);
    const filteredKeys = selectedEnrollmentKeys.filter(k => !optionKeysForThisSubject.has(k));

    if (alreadySelected) {
      onChangeSelectedKeys(filteredKeys);
    } else {
      onChangeSelectedKeys([...filteredKeys, chosenKey]);
    }
  };

  const handleAutoSelectBestSingleTeacherPerSubject = () => {
    const autoKeys = [];
    subjectMappings.forEach(item => {
      if (item.options.length === 0) return;

      const bestMatch =
        item.options.find(o => {
          const langLower = String(o.langTag || '').toLowerCase();
          const exactCls = selectedClassesUpper.includes(String(o.targetClass || '').toUpperCase());
          const langMatches = isUrduStudent
            ? langLower.includes('urdu') && !langLower.includes('non')
            : !langLower.includes('urdu') || langLower.includes('non');
          return exactCls && langMatches;
        }) ||
        item.options.find(o => {
          const langLower = String(o.langTag || '').toLowerCase();
          return isUrduStudent
            ? langLower.includes('urdu') && !langLower.includes('non')
            : !langLower.includes('urdu') || langLower.includes('non');
        }) ||
        item.options[0];

      if (bestMatch) autoKeys.push(bestMatch.key);
    });
    onChangeSelectedKeys(autoKeys);
  };

  return (
    <div style={{ background: '#ffffff', padding: '18px', borderRadius: '12px', border: '1px solid #e2e8f0', marginTop: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '14px' }}>
        <div>
          <h4 style={{ margin: 0, fontSize: '15px', color: '#0f172a', fontWeight: '800' }}>
            📚 Assign Subject Teachers (Batch: Grade {targetGrade} • {selectedClasses.join(', ') || 'Select a Class above'})
          </h4>
          <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#475569', fontWeight: '500' }}>
            Select <strong>one teacher per subject</strong> below.
            {designatedClassTeacher && (
              <span style={{ marginLeft: '8px', color: '#4f46e5', fontWeight: '700' }}>
                • 🏫 Class Teacher &amp; Hifz: {designatedClassTeacher.fullName} (Auto-Assigned)
              </span>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="button" onClick={handleAutoSelectBestSingleTeacherPerSubject} style={styles.buttonPrimary}>
            ✓ Auto-Select 1 Teacher Per Subject
          </button>
          <button type="button" onClick={() => onChangeSelectedKeys([])} style={styles.buttonSecondary}>
            Clear All
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(235px, 1fr))', gap: '10px' }}>
        {subjectMappings.map((item) => (
          <div key={item.subject} style={{ background: '#f8fafc', padding: '12px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
            <div style={{ fontWeight: '800', fontSize: '12px', color: '#0f172a', marginBottom: '6px', display: 'flex', justifyContent: 'space-between' }}>
              <span>📖 {item.subject}</span>
              {item.isHifz && designatedClassTeacher && (
                <span style={{ fontSize: '10px', color: '#047857' }}>🏫 Auto CT</span>
              )}
            </div>

            {item.options.length === 0 ? (
              <div style={{ fontSize: '11px', color: '#64748b' }}>
                {item.isHifz && designatedClassTeacher ? `👨‍🏫 ${designatedClassTeacher.fullName} (Class Teacher)` : `No teacher assigned for Grade ${targetGrade}`}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                {item.options.map(opt => {
                  const isChecked = selectedEnrollmentKeys.includes(opt.key);
                  return (
                    <label
                      key={opt.key}
                      onClick={(e) => {
                        e.preventDefault();
                        handleSelectSingleTeacherForSubject(item.options, opt.key);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        cursor: 'pointer',
                        fontSize: '12px',
                        padding: '6px 8px',
                        borderRadius: '6px',
                        background: isChecked ? '#eef2ff' : '#ffffff',
                        border: isChecked ? '1.5px solid #4f46e5' : '1px solid #e2e8f0'
                      }}
                    >
                      <input type="radio" name={`subject_radio_${item.subject}`} checked={isChecked} readOnly style={{ accentColor: '#4f46e5' }} />
                      <div>
                        <div style={{ fontWeight: '700', color: '#0f172a' }}>👨‍🏫 {opt.teacherName}</div>
                        <div style={{ color: '#64748b', fontSize: '10px' }}>{opt.alias} ({opt.langTag})</div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export async function syncStudentToSelectedTeacherEnrollments(studentRegNo, selectedEnrollmentKeys = []) {
  if (!studentRegNo) return;
  const selectedSet = new Set(selectedEnrollmentKeys);

  const teacherSnap = await getDocs(collection(db, 'teachers'));
  const updates = [];

  teacherSnap.forEach(d => {
    const tData = d.data();
    const tUser = tData.username || d.id;
    let changed = false;

    const updatedEnrollments = (tData.enrollments || []).map(env => {
      const key = `${tUser}:::${env.id}`;
      const curIds = Array.isArray(env.studentIds) ? env.studentIds : [];
      const hasStudent = curIds.includes(studentRegNo);

      if (selectedSet.has(key) && !hasStudent) {
        changed = true;
        return { ...env, studentIds: [...curIds, studentRegNo] };
      } else if (!selectedSet.has(key) && hasStudent) {
        changed = true;
        return { ...env, studentIds: curIds.filter(id => id !== studentRegNo) };
      }
      return env;
    });

    if (changed) {
      updates.push(setDoc(doc(db, 'teachers', tUser), { enrollments: updatedEnrollments }, { merge: true }));
    }
  });

  if (updates.length > 0) await Promise.all(updates);
}

// ============================================================================
// 🔑 7. TEACHER PRIVILEGE MODAL (Includes Weekend Leave Authority!)
// ============================================================================
export function TeacherPrivilegeModal({ teacher, onClose, onSaved }) {
  const [priv, setPriv] = useState({
    isPrincipal: false,
    isNiicsCoordinator: false,
    isMentor: false,
    isOutreachCoordinator: false,
    isAcademicCoordinator: false,
    isOfficeSecretary: false,
    classTeacherOf: [],
    allowedCategories: ['Friday', 'Evening'],
    canApproveWeekend: false,
    canApproveOutreach: false,
    canViewReports: false,
    ...(teacher?.outpassPrivileges || {})
  });
  const [saving, setSaving] = useState(false);

  if (!teacher) return null;

  const normalizeCls = (str) => String(str || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  const handleSave = async () => {
    setSaving(true);
    try {
      const ctClasses = priv.classTeacherOf || [];
      const updatedPriv = {
        ...priv,
        canApproveOutreach: Boolean(priv.isOutreachCoordinator || priv.canApproveOutreach || priv.isPrincipal),
        canViewReports: Boolean(priv.isPrincipal || priv.isOfficeSecretary || priv.canViewReports)
      };

      let rawEnrollments = Array.isArray(teacher.enrollments) ? [...teacher.enrollments] : [];
      const seenHifzClasses = new Set();
      let updatedEnrollments = rawEnrollments.filter(e => {
        const isSubHifz = String(e.subject || '').toUpperCase() === 'HIFZ' || String(e.alias || '').toUpperCase().includes('HIFZ');
        if (!isSubHifz) return true;
        const normKey = normalizeCls(e.targetClass || e.alias).replace('HIFZ', '');
        if (normKey && seenHifzClasses.has(normKey)) return false;
        if (normKey) seenHifzClasses.add(normKey);
        return true;
      });

      ctClasses.forEach(clsName => {
        const normCls = normalizeCls(clsName);
        const gradeMatch = String(clsName).match(/\d+/);
        const gradeNum = gradeMatch ? gradeMatch[0] : '1';
        const hasHifzForClass = updatedEnrollments.some(e => {
          const isSubHifz = String(e.subject || '').toUpperCase() === 'HIFZ' || String(e.alias || '').toUpperCase().includes('HIFZ');
          return isSubHifz && (normalizeCls(e.targetClass) === normCls || normalizeCls(e.alias).includes(normCls));
        });
        if (!hasHifzForClass) {
          updatedEnrollments.push({
            id: `hifz_${normCls}`,
            grade: gradeNum,
            targetClass: clsName,
            subject: 'Hifz',
            alias: `${clsName} Hifz`,
            langTag: '',
            studentIds: []
          });
        }
      });

      const activeRolesList = ['Teacher'];
      if (updatedPriv.isPrincipal) activeRolesList.push('Principal');
      if (updatedPriv.isNiicsCoordinator) activeRolesList.push('NIICS Coordinator');
      if (updatedPriv.isMentor) activeRolesList.push('Mentor');
      if (ctClasses.length > 0) activeRolesList.push('Class Teacher');
      if (updatedPriv.isAcademicCoordinator) activeRolesList.push('Academic Coordinator');
      if (updatedPriv.isOutreachCoordinator) activeRolesList.push('Outreach Coordinator');
      if (updatedPriv.isOfficeSecretary) activeRolesList.push('Office Secretary');

      await setDoc(doc(db, 'teachers', teacher.username), {
        roleCategory: updatedPriv.isPrincipal
          ? 'Principal'
          : ctClasses.length > 0
          ? `Class Teacher (${ctClasses.join(', ')})`
          : updatedPriv.isMentor
          ? 'Mentor'
          : (teacher.roleCategory || 'Teacher'),
        roles: activeRolesList,
        enrollments: updatedEnrollments,
        outpassPrivileges: updatedPriv
      }, { merge: true });

      alert(`✅ Roles, Class Teacher Hifz Assignment & Privileges updated for ${teacher.fullName}!`);
      if (onSaved) onSaved();
      onClose();
    } catch (err) {
      alert("Error saving privileges: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '16px' }}>
      <div style={{ background: '#ffffff', borderRadius: '16px', maxWidth: '660px', width: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 40px rgba(15,23,42,0.2)', border: '1px solid #e2e8f0', color: '#0f172a' }}>
        <div style={{ padding: '18px 24px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '11px', color: '#4f46e5', fontWeight: '800', textTransform: 'uppercase' }}>ROLE-BASED ACCESS &amp; LEAVE AUTHORITY</div>
            <h3 style={{ margin: '2px 0 0', fontSize: '18px', fontWeight: '800', color: '#0f172a' }}>
              🔑 Configure Roles &amp; Privileges: {teacher.fullName} (@{teacher.username})
            </h3>
          </div>
          <button onClick={onClose} style={styles.buttonSecondary}>✕</button>
        </div>

        <div style={{ padding: '22px 24px' }}>
          <div style={{ fontSize: '12px', fontWeight: '800', color: '#475569', marginBottom: '10px', textTransform: 'uppercase' }}>
            1. Assign Institutional Roles (Multi-Select)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '10px', marginBottom: '18px' }}>
            {[
              { key: 'isMentor', title: '🧭 Academic Mentor', desc: 'Can be assigned mentees, log consultations & update mentee profiles' },
              { key: 'isPrincipal', title: '👑 Principal Authority', desc: 'Universal approval for all leaves, Principal-locked students & Weekend leaves' },
              { key: 'isNiicsCoordinator', title: '🎓 NIICS Coordinator (Urdu Principal)', desc: 'Acts as Principal for all Urdu students (Ad.No starting with U)' },
              { key: 'isAcademicCoordinator', title: '📊 Academic Coordinator', desc: 'Unlocks Admin Mark Entry, Inspector & Academic Evaluation tabs' },
              { key: 'isOutreachCoordinator', title: '🌍 Outreach Coordinator', desc: 'Unlocks Outreach Mentor-Mentee dialogues & Bulk Mentor Assignment' },
              { key: 'isOfficeSecretary', title: '🏢 Office Secretary', desc: 'Unlocks full Out-Pass Management & Live Campus Dashboard' }
            ].map(role => (
              <label key={role.key} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '12px', borderRadius: '10px', background: priv[role.key] ? '#eef2ff' : '#f8fafc', border: `1.5px solid ${priv[role.key] ? '#4f46e5' : '#e2e8f0'}`, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={Boolean(priv[role.key])}
                  onChange={(e) => setPriv({ ...priv, [role.key]: e.target.checked })}
                  style={{ marginTop: '2px', accentColor: '#4f46e5' }}
                />
                <div>
                  <div style={{ fontWeight: '700', fontSize: '13px', color: '#0f172a' }}>{role.title}</div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>{role.desc}</div>
                </div>
              </label>
            ))}
          </div>

          <div style={{ marginBottom: '18px', background: '#f8fafc', padding: '14px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: '12px', fontWeight: '800', color: '#0f172a', marginBottom: '8px' }}>
              2. 🏫 Designated Class Teacher Of (Auto-Assigns Class Students &amp; Hifz Mark Entry):
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {DEFAULT_CLASSES.map(cls => {
                const active = (priv.classTeacherOf || []).includes(cls);
                return (
                  <button
                    key={cls}
                    type="button"
                    onClick={() => {
                      const cur = priv.classTeacherOf || [];
                      const next = active ? cur.filter(c => c !== cls) : [...cur, cls];
                      setPriv({ ...priv, classTeacherOf: next });
                    }}
                    style={{
                      padding: '6px 14px', borderRadius: '8px', fontWeight: '700', fontSize: '12px', cursor: 'pointer',
                      border: active ? '1.5px solid #4f46e5' : '1px solid #cbd5e1',
                      background: active ? '#4f46e5' : '#ffffff',
                      color: active ? '#ffffff' : '#334155'
                    }}
                  >
                    {active ? `✓ Class ${cls} (+Hifz)` : cls}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
            <div style={{ background: '#f8fafc', padding: '10px 16px', fontWeight: '800', fontSize: '12px', color: '#475569', borderBottom: '1px solid #e2e8f0' }}>
              3. Out-Pass Leave Category Permissions
            </div>
            {[
              { id: 'Evening', label: '🌇 Evening Leaves (For Assigned Mentees & Class Students)' },
              { id: 'Friday', label: '🕌 Friday Leave (Standard Friday Outing)' },
              { id: 'General', label: '🏫 Class-Hour General & Medical Leaves (For Assigned Class)' },
              { id: 'Official', label: '📋 Official / Department Work Leave' }
            ].map(row => {
              const allowed = (priv.allowedCategories || []).includes(row.id);
              return (
                <label key={row.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '13px', fontWeight: '600', color: '#0f172a', cursor: 'pointer' }}>
                  <span>{row.label}</span>
                  <input
                    type="checkbox"
                    checked={allowed}
                    onChange={(e) => {
                      const cur = priv.allowedCategories || [];
                      const next = e.target.checked ? [...cur, row.id] : cur.filter(x => x !== row.id);
                      setPriv({ ...priv, allowedCategories: next });
                    }}
                  />
                </label>
              );
            })}

            <label style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', alignItems: 'center', fontSize: '13px', fontWeight: '700', color: '#4f46e5', background: '#eef2ff', cursor: 'pointer' }}>
              <span>🗓️ Weekend Leave Authority (Thu Eve ➔ Fri Eve / Sat)</span>
              <input
                type="checkbox"
                checked={Boolean(priv.canApproveWeekend || priv.isPrincipal)}
                onChange={(e) => setPriv({ ...priv, canApproveWeekend: e.target.checked })}
                style={{ width: '16px', height: '16px', accentColor: '#4f46e5' }}
              />
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
            <button type="button" onClick={onClose} style={styles.buttonSecondary}>Cancel</button>
            <button type="button" onClick={handleSave} disabled={saving} style={styles.buttonPrimary}>
              {saving ? 'Saving...' : '💾 Save Roles & Privileges'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 🏆 8. STUDENT PORTFOLIO & CONSULTANCY MODAL (100% Full Features Restored!)
// ============================================================================
export function StudentPortfolioModal({
  student,
  canEditSkills = true,
  canViewConfidential = true,
  editorName = 'Faculty',
  initialSection = 'log',
  semesterTarget = 3,
  onClose,
  onSaved
}) {
  const [activeModalTab, setActiveModalTab] = useState(initialSection);
  const [saving, setSaving] = useState(false);

  const [formData, setFormData] = useState({
    firstName: student?.firstName || '',
    whatsappNumber: student?.whatsappNumber || student?.mobileNumber || '',
    parentWhatsapp: student?.parentWhatsapp || student?.parentMobile || '',
    email: student?.email || '',
    state: student?.state || 'Kerala',
    district: student?.district || '',
    address: student?.address || '',
    bloodGroup: student?.bloodGroup || '',
    madhab: student?.madhab || 'SHAFI',
    photoUrl: student?.photoUrl || ''
  });

  const [skills, setSkills] = useState(Array.isArray(student?.skills) ? student.skills : []);
  const [newSkill, setNewSkill] = useState('');
  const [achievements, setAchievements] = useState(Array.isArray(student?.achievements) ? student.achievements : []);
  const [achTitle, setAchTitle] = useState('');
  const [achCategory, setAchCategory] = useState('Academic');
  const [achLevel, setAchLevel] = useState('Campus / Class Level');
  const [achDate, setAchDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [achNotes, setAchNotes] = useState('');

  const existingLogs = Array.isArray(student?.mentorLogs)
    ? student.mentorLogs
    : Array.isArray(student?.consultationLogs)
      ? student.consultationLogs
      : [];
  const [mentorLogs, setMentorLogs] = useState(existingLogs);

  const [sessionDate, setSessionDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [sessionType, setSessionType] = useState('1-on-1 Personal Sitting');
  const [wellbeingStatus, setWellbeingStatus] = useState('Thriving / On Track');
  const [discussedTopics, setDiscussedTopics] = useState(['CCE & Academic Progress']);
  const [summaryNote, setSummaryNote] = useState('');
  const [confidentialNote, setConfidentialNote] = useState('');
  const [actionItem, setActionItem] = useState('');
  const [nextFollowUpDate, setNextFollowUpDate] = useState('');

  if (!student) return null;

  const DISCUSSION_TOPICS = [
    'CCE & Academic Progress', 'Hifz & Tilawah', 'Attendance & Punctuality',
    'Language Fluency (Ar/En/Ur)', 'Sibaq & Co-Curricular',
    'Hostel & Peer Adjustment', 'Personal / Family Wellbeing', 'Career & Higher Studies'
  ];

  const QUICK_SKILL_SUGGESTIONS = [
    'Public Speaking', 'Arabic Oratory', 'English Oratory', 'Urdu Oratory',
    'Academic Research', 'Calligraphy', 'Graphic Design', 'Web / Tech Skills',
    'Leadership', 'Debate', 'Content Writing', 'Qiraat & Tajweed'
  ];

  const toggleTopic = (topic) => {
    setDiscussedTopics(prev =>
      prev.includes(topic) ? prev.filter(t => t !== topic) : [...prev, topic]
    );
  };

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressImageFileToDataUrl(file, 320, 0.78);
      setFormData(prev => ({ ...prev, photoUrl: dataUrl }));
    } catch (err) {
      alert('Could not process image: ' + err.message);
    }
  };

  const saveUpdatedStudentToFirestore = async (patchObj, successMessage) => {
    setSaving(true);
    try {
      const docId = String(student.regNo || student.id).toLowerCase().trim();
      await setDoc(doc(db, 'students', docId), patchObj, { merge: true });
      const updatedStudent = { ...student, ...patchObj };
      if (onSaved) onSaved(updatedStudent);
      if (successMessage) alert(successMessage);
    } catch (err) {
      alert('Failed to save to database: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleAddConsultationLog = async (e) => {
    e.preventDefault();
    if (!summaryNote.trim() && !actionItem.trim()) {
      return alert('Please enter a short summary or action plan for this sitting.');
    }

    const newLogEntry = {
      id: `log_${Date.now()}`,
      date: sessionDate,
      type: sessionType,
      wellbeingStatus,
      topics: discussedTopics,
      summary: summaryNote.trim(),
      confidential: confidentialNote.trim(),
      actionPlan: actionItem.trim(),
      nextFollowUpDate: nextFollowUpDate || '',
      loggedBy: editorName,
      createdAt: new Date().toISOString()
    };

    const updatedLogs = [newLogEntry, ...mentorLogs];
    setMentorLogs(updatedLogs);

    await saveUpdatedStudentToFirestore(
      {
        mentorLogs: updatedLogs,
        lastMentorMeetingDate: sessionDate,
        latestWellbeingStatus: wellbeingStatus
      },
      '✅ Consultancy sitting logged successfully!'
    );

    setSummaryNote('');
    setConfidentialNote('');
    setActionItem('');
    setNextFollowUpDate('');
  };

  const handleDeleteLog = async (logId) => {
    if (!window.confirm('Delete this consultation record?')) return;
    const updatedLogs = mentorLogs.filter(l => l.id !== logId);
    setMentorLogs(updatedLogs);
    await saveUpdatedStudentToFirestore({
      mentorLogs: updatedLogs,
      lastMentorMeetingDate: updatedLogs[0]?.date || ''
    });
  };

  const handleAddSkill = async (skillToAdd) => {
    const clean = String(skillToAdd || newSkill).trim();
    if (!clean) return;
    if (skills.some(s => s.toLowerCase() === clean.toLowerCase())) {
      setNewSkill('');
      return;
    }
    const updatedSkills = [...skills, clean];
    setSkills(updatedSkills);
    setNewSkill('');
    await saveUpdatedStudentToFirestore({ skills: updatedSkills });
  };

  const handleRemoveSkill = async (skillToRemove) => {
    const updatedSkills = skills.filter(s => s !== skillToRemove);
    setSkills(updatedSkills);
    await saveUpdatedStudentToFirestore({ skills: updatedSkills });
  };

  const handleAddAchievement = async (e) => {
    e.preventDefault();
    if (!achTitle.trim()) return alert('Please enter the achievement title.');
    const newAch = {
      id: `ach_${Date.now()}`,
      title: achTitle.trim(),
      category: achCategory,
      level: achLevel,
      date: achDate,
      notes: achNotes.trim(),
      addedBy: editorName
    };
    const updatedAch = [newAch, ...achievements];
    setAchievements(updatedAch);
    setAchTitle('');
    setAchNotes('');
    await saveUpdatedStudentToFirestore({ achievements: updatedAch }, '🏅 Achievement added to student portfolio!');
  };

  const handleRemoveAchievement = async (achId) => {
    const updatedAch = achievements.filter(a => a.id !== achId);
    setAchievements(updatedAch);
    await saveUpdatedStudentToFirestore({ achievements: updatedAch });
  };

  const handleSaveProfileDetails = async (e) => {
    e.preventDefault();
    await saveUpdatedStudentToFirestore(
      {
        ...formData,
        mobileNumber: formData.whatsappNumber,
        parentMobile: formData.parentWhatsapp
      },
      '✅ Student contact & profile details updated!'
    );
  };

  const sittingsCount = mentorLogs.length;
  const targetMet = sittingsCount >= Number(semesterTarget || 1);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2200, padding: '14px' }}>
      <div style={{ background: '#ffffff', borderRadius: '16px', maxWidth: '860px', width: '100%', maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 24px 48px rgba(15,23,42,0.2)', border: '1px solid #e2e8f0', color: '#0f172a' }}>

        <div style={{ padding: '18px 24px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', position: 'sticky', top: 0, background: '#ffffff', zIndex: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <ProfileAvatar name={formData.firstName} code={student.adNo} photoUrl={formData.photoUrl} size={48} />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0, fontSize: '19px', fontWeight: '800', color: '#0f172a' }}>{formData.firstName}</h3>
                <span style={{ background: '#eef2ff', color: '#4f46e5', padding: '3px 9px', borderRadius: '6px', fontSize: '12px', fontWeight: '700' }}>
                  Ad.No #{student.adNo}
                </span>
                <span style={{ background: targetMet ? '#dcfce7' : '#fef3c7', color: targetMet ? '#15803d' : '#92400e', padding: '3px 9px', borderRadius: '6px', fontSize: '12px', fontWeight: '700' }}>
                  🗣️ Sittings: {sittingsCount} / {semesterTarget} {targetMet ? '✅' : '⏳'}
                </span>
              </div>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '3px', fontWeight: '500' }}>
                Reg: {student.regNo} • Class {(student.classes || []).join(', ')} ({student.department || 'GENERAL'}) • Mentor: {student.mentorName || student.mentorUsername || 'Unassigned'}
              </div>
            </div>
          </div>
          <button onClick={onClose} style={styles.buttonSecondary}>✕ Close</button>
        </div>

        <div style={{ display: 'flex', gap: '8px', background: '#f8fafc', padding: '10px 24px', borderBottom: '1px solid #e2e8f0', flexWrap: 'wrap' }}>
          {[
            { id: 'log', label: `📝 Consultancy Log (${mentorLogs.length})` },
            { id: 'skills', label: `🏆 Skills (${skills.length}) & Achievements (${achievements.length})` },
            { id: 'profile', label: '📱 Contact & Personal Profile' }
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveModalTab(tab.id)}
              style={{
                padding: '9px 16px',
                borderRadius: '8px',
                border: activeModalTab === tab.id ? '1px solid #4f46e5' : '1px solid transparent',
                fontWeight: '700',
                fontSize: '13px',
                cursor: 'pointer',
                background: activeModalTab === tab.id ? '#4f46e5' : 'transparent',
                color: activeModalTab === tab.id ? '#ffffff' : '#475569'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div style={{ padding: '24px' }}>
          {activeModalTab === 'log' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <form onSubmit={handleAddConsultationLog} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '18px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                  <h4 style={{ margin: 0, fontSize: '15px', fontWeight: '800', color: '#0f172a' }}>
                    ➕ Record New Mentor-Mentee Consultancy Sitting
                  </h4>
                  <span style={{ fontSize: '12px', fontWeight: '700', color: '#4f46e5', background: '#eef2ff', padding: '4px 10px', borderRadius: '999px' }}>
                    Logged by: {editorName}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '12px' }}>
                  <div>
                    <label style={styles.label}>Sitting Date</label>
                    <input type="date" value={sessionDate} onChange={e => setSessionDate(e.target.value)} required style={styles.input} />
                  </div>
                  <div>
                    <label style={styles.label}>Interaction Type</label>
                    <select value={sessionType} onChange={e => setSessionType(e.target.value)} style={styles.input}>
                      <option value="1-on-1 Personal Sitting">🗣️ 1-on-1 Personal Sitting</option>
                      <option value="Academic & CCE Review">📊 Academic &amp; CCE Review</option>
                      <option value="Tarbiyah & Spiritual Guidance">🕌 Tarbiyah &amp; Spiritual Guidance</option>
                      <option value="Behavioral / Discipline Counseling">⚖️ Behavioral / Discipline Counseling</option>
                      <option value="Career & Higher Studies">🎓 Career &amp; Higher Studies</option>
                      <option value="Parent Phone Consultation">👨‍👩‍👦 Parent Phone Consultation</option>
                    </select>
                  </div>
                  <div>
                    <label style={styles.label}>Student Status / Wellbeing</label>
                    <select value={wellbeingStatus} onChange={e => setWellbeingStatus(e.target.value)} style={styles.input}>
                      <option value="Thriving / On Track">🟢 Thriving / On Track</option>
                      <option value="Needs Academic Support">🟡 Needs Academic Support</option>
                      <option value="Personal / Health Concern">🟠 Personal / Health Concern</option>
                      <option value="Urgent / Escalate to Outreach">🔴 Urgent / Escalate to Outreach</option>
                    </select>
                  </div>
                </div>

                <div style={{ marginBottom: '12px' }}>
                  <label style={styles.label}>Topics Discussed in Sitting (Click to select)</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {DISCUSSION_TOPICS.map(topic => {
                      const active = discussedTopics.includes(topic);
                      return (
                        <button
                          key={topic}
                          type="button"
                          onClick={() => toggleTopic(topic)}
                          style={{
                            padding: '5px 11px',
                            borderRadius: '999px',
                            fontSize: '12px',
                            fontWeight: '700',
                            cursor: 'pointer',
                            border: active ? '1.5px solid #4f46e5' : '1px solid #cbd5e1',
                            background: active ? '#eef2ff' : '#ffffff',
                            color: active ? '#4f46e5' : '#475569'
                          }}
                        >
                          {active ? `✓ ${topic}` : `+ ${topic}`}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '12px', marginBottom: '12px' }}>
                  <div>
                    <label style={styles.label}>Consultation Summary &amp; Observations</label>
                    <textarea
                      rows={3}
                      placeholder="Summarize how the student is progressing, challenges discussed, and advice given..."
                      value={summaryNote}
                      onChange={e => setSummaryNote(e.target.value)}
                      style={{ ...styles.input, resize: 'vertical' }}
                    />
                  </div>
                  {canViewConfidential && (
                    <div>
                      <label style={{ ...styles.label, color: '#b45309' }}>🔒 Confidential Faculty Note (Hidden from Student)</label>
                      <textarea
                        rows={3}
                        placeholder="Private family/financial/behavioral notes for Mentor & Outreach Coordinator only..."
                        value={confidentialNote}
                        onChange={e => setConfidentialNote(e.target.value)}
                        style={{ ...styles.input, resize: 'vertical', borderColor: '#fde68a', background: '#fffbeb' }}
                      />
                    </div>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px', marginBottom: '14px' }}>
                  <div>
                    <label style={styles.label}>🎯 Next Action Plan / Target Given to Student</label>
                    <input
                      type="text"
                      placeholder="e.g. Complete pending Fiqh Level 2 CCE work before next Friday..."
                      value={actionItem}
                      onChange={e => setActionItem(e.target.value)}
                      style={styles.input}
                    />
                  </div>
                  <div>
                    <label style={styles.label}>📅 Next Follow-Up Date</label>
                    <input
                      type="date"
                      value={nextFollowUpDate}
                      onChange={e => setNextFollowUpDate(e.target.value)}
                      style={styles.input}
                    />
                  </div>
                </div>

                <button type="submit" disabled={saving} style={{ ...styles.buttonPrimary, width: '100%' }}>
                  {saving ? 'Saving Consultation...' : '💾 Save Consultation Sitting to Record'}
                </button>
              </form>

              <div>
                <h4 style={{ margin: '0 0 12px 0', fontSize: '15px', fontWeight: '800', color: '#0f172a' }}>
                  📜 Past Consultancy Sittings History ({mentorLogs.length})
                </h4>
                {mentorLogs.length === 0 ? (
                  <div style={{ padding: '24px', background: '#f8fafc', borderRadius: '12px', border: '1px dashed #cbd5e1', textAlign: 'center', color: '#64748b', fontWeight: '600' }}>
                    No mentor-mentee sittings have been logged for this student yet.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {mentorLogs.map((log, index) => {
                      const isUrgent = String(log.wellbeingStatus || '').includes('Urgent');
                      const isSupport = String(log.wellbeingStatus || '').includes('Support') || String(log.wellbeingStatus || '').includes('Concern');
                      return (
                        <div key={log.id || index} style={{ padding: '16px', borderRadius: '12px', border: isUrgent ? '1.5px solid #e11d48' : '1px solid #e2e8f0', background: isUrgent ? '#fff1f2' : '#ffffff' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                              <span style={{ background: '#0f172a', color: '#fff', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '700' }}>
                                📅 {log.date || 'N/A'}
                              </span>
                              <span style={{ background: '#eef2ff', color: '#4f46e5', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '700' }}>
                                {log.type || 'Sitting'}
                              </span>
                              <span style={{
                                background: isUrgent ? '#ffe4e6' : isSupport ? '#fef3c7' : '#dcfce7',
                                color: isUrgent ? '#be123c' : isSupport ? '#92400e' : '#15803d',
                                padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '700'
                              }}>
                                {log.wellbeingStatus || 'Logged'}
                              </span>
                            </div>
                            <div style={{ fontSize: '12px', color: '#475569', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <span>👨‍🏫 By <strong>{log.loggedBy || 'Mentor'}</strong></span>
                              <button type="button" onClick={() => handleDeleteLog(log.id)} style={{ background: 'transparent', border: 'none', color: '#e11d48', cursor: 'pointer', fontWeight: '700', fontSize: '12px' }}>
                                🗑️ Delete
                              </button>
                            </div>
                          </div>

                          {Array.isArray(log.topics) && log.topics.length > 0 && (
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
                              {log.topics.map((t, idx) => (
                                <span key={idx} style={{ background: '#f1f5f9', color: '#334155', padding: '2px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: '600' }}>
                                  #{t}
                                </span>
                              ))}
                            </div>
                          )}

                          {log.summary && (
                            <div style={{ fontSize: '13px', color: '#0f172a', fontWeight: '500', marginBottom: '6px', lineHeight: 1.5 }}>
                              {log.summary}
                            </div>
                          )}

                          {canViewConfidential && log.confidential && (
                            <div style={{ fontSize: '12px', color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', padding: '8px 12px', borderRadius: '8px', marginTop: '6px', fontWeight: '600' }}>
                              🔒 <strong>Confidential Note:</strong> {log.confidential}
                            </div>
                          )}

                          {(log.actionPlan || log.nextFollowUpDate) && (
                            <div style={{ marginTop: '8px', padding: '8px 12px', background: '#f8fafc', borderRadius: '8px', fontSize: '12px', color: '#4f46e5', fontWeight: '700', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                              {log.actionPlan && <span>🎯 Action Plan: {log.actionPlan}</span>}
                              {log.nextFollowUpDate && <span>⏰ Next Follow-Up: {log.nextFollowUpDate}</span>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeModalTab === 'skills' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                <h4 style={{ margin: '0 0 10px 0', fontSize: '15px', fontWeight: '800', color: '#0f172a' }}>
                  🌟 Student Skills &amp; Talents ({skills.length})
                </h4>

                {canEditSkills && (
                  <>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
                      <input
                        type="text"
                        placeholder="Type a custom skill (e.g. Urdu Poetry, Python, Qiraat)..."
                        value={newSkill}
                        onChange={e => setNewSkill(e.target.value)}
                        style={{ ...styles.input, flex: '1 1 240px' }}
                      />
                      <button type="button" onClick={() => handleAddSkill(newSkill)} style={styles.buttonPrimary}>
                        + Add Skill
                      </button>
                    </div>

                    <div style={{ marginBottom: '12px' }}>
                      <span style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', display: 'block', marginBottom: '6px', textTransform: 'uppercase' }}>
                        ⚡ Quick 1-Click Skill Tags:
                      </span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {QUICK_SKILL_SUGGESTIONS.map(sug => (
                          <button
                            key={sug}
                            type="button"
                            onClick={() => handleAddSkill(sug)}
                            style={{ padding: '4px 10px', borderRadius: '999px', border: '1px solid #cbd5e1', background: '#ffffff', color: '#475569', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}
                          >
                            + {sug}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {skills.length === 0 ? (
                    <span style={{ fontSize: '12px', color: '#64748b' }}>No skills added yet.</span>
                  ) : (
                    skills.map((sk, i) => (
                      <span key={i} style={{ background: '#eef2ff', color: '#4f46e5', border: '1px solid #c7d2fe', padding: '5px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: '700', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        ✦ {sk}
                        {canEditSkills && (
                          <button type="button" onClick={() => handleRemoveSkill(sk)} style={{ background: 'transparent', border: 'none', color: '#e11d48', fontWeight: '800', cursor: 'pointer' }}>
                            ✕
                          </button>
                        )}
                      </span>
                    ))
                  )}
                </div>
              </div>

              <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                <h4 style={{ margin: '0 0 12px 0', fontSize: '15px', fontWeight: '800', color: '#0f172a' }}>
                  🏅 Add New Achievement / Award / Sibaq Record
                </h4>
                {canEditSkills && (
                  <form onSubmit={handleAddAchievement} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '10px', marginBottom: '16px' }}>
                    <input type="text" placeholder="Award / Achievement Title..." value={achTitle} onChange={e => setAchTitle(e.target.value)} required style={styles.input} />
                    <select value={achCategory} onChange={e => setAchCategory(e.target.value)} style={styles.input}>
                      <option value="Academic">📚 Academic Excellence</option>
                      <option value="Sibaq / Arts Fest">🎨 Sibaq / Arts Fest</option>
                      <option value="Hifz & Quran">📖 Hifz &amp; Quran</option>
                      <option value="Oratory & Debate">🎙️ Oratory &amp; Debate</option>
                      <option value="Writing & Publication">✍️ Writing &amp; Publication</option>
                      <option value="Sports & Leadership">🏆 Sports &amp; Leadership</option>
                    </select>
                    <select value={achLevel} onChange={e => setAchLevel(e.target.value)} style={styles.input}>
                      <option value="Campus / Class Level">🏫 Campus / Class Level</option>
                      <option value="DHIU Central / Sibaq">🎓 DHIU Central / Sibaq</option>
                      <option value="State / National Level">🌍 State / National Level</option>
                    </select>
                    <input type="date" value={achDate} onChange={e => setAchDate(e.target.value)} style={styles.input} />
                    <input type="text" placeholder="Short note / prize rank (e.g. 1st Prize A Grade)..." value={achNotes} onChange={e => setAchNotes(e.target.value)} style={{ ...styles.input, gridColumn: '1 / -1' }} />
                    <button type="submit" disabled={saving} style={{ ...styles.buttonPrimary, gridColumn: '1 / -1' }}>
                      🏅 Save Achievement to Student Record
                    </button>
                  </form>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {achievements.map((ach, i) => (
                    <div key={ach.id || i} style={{ background: '#ffffff', padding: '12px 14px', borderRadius: '10px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                      <div>
                        <div style={{ fontWeight: '700', fontSize: '14px', color: '#0f172a' }}>🏅 {ach.title}</div>
                        <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                          {ach.category} • {ach.level} • 📅 {ach.date} {ach.addedBy ? `• Verified by ${ach.addedBy}` : ''}
                        </div>
                        {ach.notes && <div style={{ fontSize: '12px', color: '#4f46e5', fontWeight: '600', marginTop: '3px' }}>{ach.notes}</div>}
                      </div>
                      {canEditSkills && (
                        <button type="button" onClick={() => handleRemoveAchievement(ach.id)} style={styles.buttonDanger}>
                          Delete
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeModalTab === 'profile' && (
            <form onSubmit={handleSaveProfileDetails} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', background: '#f8fafc', padding: '14px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                <ProfileAvatar name={formData.firstName} code={student.adNo} photoUrl={formData.photoUrl} size={60} />
                <div>
                  <label style={styles.label}>Update Student Profile Photo</label>
                  <input type="file" accept="image/*" onChange={handlePhotoUpload} style={{ fontSize: '13px' }} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '12px' }}>
                <div><label style={styles.label}>Student Full Name</label><input type="text" value={formData.firstName} onChange={e => setFormData({ ...formData, firstName: e.target.value })} style={styles.input} /></div>
                <div><label style={styles.label}>Student WhatsApp / Mobile</label><input type="text" value={formData.whatsappNumber} onChange={e => setFormData({ ...formData, whatsappNumber: e.target.value })} style={styles.input} /></div>
                <div><label style={styles.label}>Parent WhatsApp / Mobile</label><input type="text" value={formData.parentWhatsapp} onChange={e => setFormData({ ...formData, parentWhatsapp: e.target.value })} style={styles.input} /></div>
                <div><label style={styles.label}>Email Address</label><input type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} style={styles.input} /></div>
                <div>
                  <label style={styles.label}>State</label>
                  <select value={formData.state} onChange={e => setFormData({ ...formData, state: e.target.value })} style={styles.input}>
                    {INDIAN_STATES.map(st => <option key={st} value={st}>{st}</option>)}
                  </select>
                </div>
                <div><label style={styles.label}>District</label><input type="text" value={formData.district} onChange={e => setFormData({ ...formData, district: e.target.value })} style={styles.input} /></div>
                <div>
                  <label style={styles.label}>Madhab</label>
                  <select value={formData.madhab} onChange={e => setFormData({ ...formData, madhab: e.target.value })} style={styles.input}>
                    <option value="SHAFI">SHAFI</option>
                    <option value="HANAFI">HANAFI</option>
                  </select>
                </div>
                <div><label style={styles.label}>Blood Group</label><input type="text" value={formData.bloodGroup} onChange={e => setFormData({ ...formData, bloodGroup: e.target.value })} placeholder="e.g. O+" style={styles.input} /></div>
              </div>

              <button type="submit" disabled={saving} style={styles.buttonPrimary}>
                {saving ? 'Saving Profile...' : '💾 Save Student Contact & Profile'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 🧭 9. MINIMALIST MENTORSHIP & OUTREACH TAB (100% Features Restored + Clean UI!)


// ============================================================================
export function MentorAndOutreachTab({ students, teachers, loggedInTeacher, isAdmin = false, isOutreachView = false, onStudentUpdated }) {
  // Fallback attendance stat reader (uses data stored on student.periodAttendance)
  const getStudentAttStat = (st) => {
    return st?.periodAttendance || {
      totalPeriods: 0,
      presentCount: 0,
      officialCount: 0,
      medicalCount: 0,
      minusCount: 0,
      minusLogs: [],
      subjectWise: {}
    };
  };

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
  const [classTeacherSubView, setClassTeacherSubView] = useState('daily_register'); // 'daily_register' | 'monthly_summary' | 'full_month_matrix'
  const [selectedRegisterDate, setSelectedRegisterDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [registerVerificationStatus, setRegisterVerificationStatus] = useState(null);
  const [isVerifyingRegister, setIsVerifyingRegister] = useState(false);

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
  const [adminClassFilter, setAdminClassFilter] = useState('QLA3');

  const resolvedClassTeacherClasses = React.useMemo(() => {
    const set = new Set();
    const addClean = (val) => {
      if (!val) return;
      if (Array.isArray(val)) {
        val.filter(Boolean).forEach(c => set.add(String(c).trim().toUpperCase()));
      } else if (typeof val === 'string') {
        val.split(',').map(s => s.trim().toUpperCase()).filter(Boolean).forEach(c => set.add(c));
      }
    };
    addClean(priv.classTeacherOf);
    addClean(loggedInTeacher?.classTeacherOf);

    if (myUsername && myUsername !== 'admin') {
      students.forEach(st => {
        const ctUser = String(st.classTeacherUsername || st.classTeacher || '').trim().toLowerCase();
        const ctName = String(st.classTeacherName || '').trim().toLowerCase();
        if ((ctUser && ctUser === myUsername) || (ctName && ctName === myFullNameLower)) {
          const stClasses = Array.isArray(st.classes) ? st.classes : [st.class].filter(Boolean);
          stClasses.forEach(c => set.add(String(c).trim().toUpperCase()));
        }
      });
    }
    return Array.from(set);
  }, [priv, loggedInTeacher, students, myUsername, myFullNameLower]);

  const myClassTeacherOf = resolvedClassTeacherClasses;
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

  const classStudentsList = isAdmin
    ? students.filter(s => (Array.isArray(s.classes) ? s.classes : [s.class]).includes(adminClassFilter))
    : students.filter(isStudentInMyClass);
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

      // 🌟 Compute leaveReasonsList safely for student
      const liveOp = liveOutpassesMap[reg] || liveOutpassesMap[ad];
      const leaveReasonsList = liveOp ? [`${liveOp.category || 'Leave'}${liveOp.destination ? ` (${liveOp.destination})` : ''}`] : [];

      return { student: st, workingDaysHeld, totalDaysPresent, totalDaysAbsent, dayAttPct, absentDatesDetails, isAbsentMoreThan5Days, leaveReasonsList };
    });
  }, [hasClassDuty, classStudentsList, fnAnMonthSessionsCache, liveOutpassesMap]);

  const classAbsentGt5Count = classFnAnRows.filter(r => r.isAbsentMoreThan5Days).length;

  const filteredClassFnAnRows = classFnAnRows.filter(r => {
    if (classTeacherFnAnFilter === 'ABSENT_GT_5') return r.isAbsentMoreThan5Days;
    return true;
  });

  // 🌟 Available working dates in the selected month for this class
  const classWorkingDatesInMonth = React.useMemo(() => {
    const datesSet = new Set();
    fnAnMonthSessionsCache.forEach(sess => {
      if (sess.date && String(sess.date).startsWith(selectedMonthForFnAn)) {
        datesSet.add(sess.date);
      }
    });
    return Array.from(datesSet).sort();
  }, [fnAnMonthSessionsCache, selectedMonthForFnAn]);

  // Load verification status when selectedRegisterDate changes
  useEffect(() => {
    if (!myClassTeacherOf || myClassTeacherOf.length === 0 || !selectedRegisterDate) return;
    const targetCls = isAdmin ? adminClassFilter : myClassTeacherOf[0];
    if (!targetCls) return;
    const docId = `classRegisterVerification_${targetCls}_${selectedRegisterDate}`;
    getDoc(doc(db, 'systemCache', docId))
      .then(snap => {
        if (snap.exists()) setRegisterVerificationStatus(snap.data());
        else setRegisterVerificationStatus(null);
      })
      .catch(() => setRegisterVerificationStatus(null));
  }, [myClassTeacherOf, selectedRegisterDate]);

  // Handle Class Teacher Verifying & Signing the Register
  const handleVerifyDailyRegister = async () => {
    if (!myClassTeacherOf || myClassTeacherOf.length === 0) return;
    setIsVerifyingRegister(true);
    try {
      const targetCls = isAdmin ? adminClassFilter : myClassTeacherOf[0];
    if (!targetCls) return;
    const docId = `classRegisterVerification_${targetCls}_${selectedRegisterDate}`;
      const verificationRecord = {
        classAlias: myClassTeacherOf[0],
        date: selectedRegisterDate,
        verifiedBy: loggedInTeacher?.fullName || loggedInTeacher?.username || 'Class Teacher',
        verifiedByUsername: loggedInTeacher?.username || '',
        verifiedAt: new Date().toISOString(),
        studentCount: classStudentsList.length
      };
      await setDoc(doc(db, 'systemCache', docId), verificationRecord, { merge: true });
      setRegisterVerificationStatus(verificationRecord);
      alert(`✅ Attendance Register for ${selectedRegisterDate} has been officially verified and signed by ${verificationRecord.verifiedBy}!`);
    } catch (err) {
      alert('Error verifying register: ' + err.message);
    } finally {
      setIsVerifyingRegister(false);
    }
  };

  // Export Full Month Working Day Register Matrix to Excel
  const handleExportClassRegisterExcel = () => {
    if (classStudentsList.length === 0) return alert('No students in class to export.');
    try {
      const headers = ['Roll No', 'Admission No', 'Student Name', 'Department'];
      classWorkingDatesInMonth.forEach(d => {
        headers.push(`${d} (FN)`);
        headers.push(`${d} (AN)`);
        headers.push(`${d} (Day)`);
      });
      headers.push('Working Days Held', 'Days Present', 'Days Absent', 'Attendance %');

      const rows = classStudentsList.map((st, idx) => {
        const row = [
          st.rollNo || idx + 1,
          st.adNo || '-',
          st.firstName,
          st.department || 'GENERAL'
        ];

        let wDays = 0;
        let dPres = 0;

        classWorkingDatesInMonth.forEach(dStr => {
          const daySessions = fnAnMonthSessionsCache.filter(s => s.date === dStr);
          const fnSess = daySessions.filter(s => Number(s.session) <= 6);
          const anSess = daySessions.filter(s => Number(s.session) > 6);

          const hasFn = fnSess.length > 0;
          const hasAn = anSess.length > 0;

          const isFnPres = hasFn ? fnSess.some(s => {
            const val = (s.attendanceMap || {})[st.regNo] || (s.attendanceMap || {})[st.adNo];
            return val === 'P' || val === 'O';
          }) : false;

          const isAnPres = hasAn ? anSess.some(s => {
            const val = (s.attendanceMap || {})[st.regNo] || (s.attendanceMap || {})[st.adNo];
            return val === 'P' || val === 'O';
          }) : false;

          let dayCredit = 0;
          if (hasFn && hasAn) {
            wDays += 1;
            dayCredit = (isFnPres ? 0.5 : 0) + (isAnPres ? 0.5 : 0);
            dPres += dayCredit;
          } else if (hasFn || hasAn) {
            wDays += 0.5;
            dayCredit = (hasFn && isFnPres) || (hasAn && isAnPres) ? 0.5 : 0;
            dPres += dayCredit;
          }

          row.push(hasFn ? (isFnPres ? 'P' : 'A') : '-');
          row.push(hasAn ? (isAnPres ? 'P' : 'A') : '-');
          row.push(dayCredit.toFixed(1));
        });

        const dAbs = Math.max(0, wDays - dPres);
        const pct = wDays > 0 ? ((dPres / wDays) * 100).toFixed(1) + '%' : '100.0%';

        row.push(wDays, dPres, dAbs, pct);
        return row;
      });

      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Class Attendance Register');
      XLSX.writeFile(wb, `Attendance_Register_Class_${myClassTeacherOf.join('_')}_${selectedMonthForFnAn}.xlsx`);
    } catch (e) {
      alert('Error exporting register: ' + e.message);
    }
  };

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
      {((hasClassDuty && !isOutreachView && teacherViewMode === 'CLASS') || (isAdmin && !isOutreachView)) && (
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

          {/* 🌟 CLASS TEACHER ATTENDANCE REGISTER SUB-TABS */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '2px solid #e2e8f0', paddingBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {[
                { id: 'daily_register', label: '📋 Working Day Register (FN & AN)', icon: '📅' },
                { id: 'monthly_summary', label: '🌤️ Monthly Day Summary', icon: '📊' },
                { id: 'full_month_matrix', label: '📑 Full Month Matrix Grid', icon: '🗂️' }
              ].map(tb => (
                <button
                  key={tb.id}
                  type="button"
                  onClick={() => setClassTeacherSubView(tb.id)}
                  style={{
                    padding: '8px 14px',
                    borderRadius: '8px',
                    fontWeight: '800',
                    fontSize: '12px',
                    cursor: 'pointer',
                    border: classTeacherSubView === tb.id ? '2px solid #4f46e5' : '1px solid #cbd5e1',
                    background: classTeacherSubView === tb.id ? '#eef2ff' : '#ffffff',
                    color: classTeacherSubView === tb.id ? '#4f46e5' : '#475569',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <span>{tb.icon}</span> {tb.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                type="button"
                onClick={handleExportClassRegisterExcel}
                style={{ ...styles.buttonSecondary, padding: '7px 12px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <span>📥</span> Export Register to Excel
              </button>
            </div>
          </div>

          {/* VIEW 1: DAILY WORKING DAY REGISTER (FORENOON & AFTERNOON ROLL CALL) */}
          {classTeacherSubView === 'daily_register' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ background: '#f8fafc', padding: '14px 18px', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '13px', fontWeight: '800', color: '#0f172a' }}>
                    Select Working Date:
                  </span>
                  <input
                    type="date"
                    value={selectedRegisterDate}
                    onChange={e => setSelectedRegisterDate(e.target.value)}
                    style={{ ...styles.input, width: '160px', padding: '6px 10px', fontSize: '12px', fontWeight: '700' }}
                  />
                  {classWorkingDatesInMonth.length > 0 && (
                    <select
                      value={selectedRegisterDate}
                      onChange={e => setSelectedRegisterDate(e.target.value)}
                      style={{ ...styles.input, width: 'auto', padding: '6px 10px', fontSize: '12px', fontWeight: '600' }}
                    >
                      <option value="">-- Jump to Working Date ({classWorkingDatesInMonth.length}) --</option>
                      {classWorkingDatesInMonth.map(d => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  {registerVerificationStatus ? (
                    <span style={{ background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', padding: '6px 12px', borderRadius: '8px', fontSize: '11px', fontWeight: '800' }}>
                      ✓ Verified &amp; Signed by {registerVerificationStatus.verifiedBy} on {new Date(registerVerificationStatus.verifiedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={handleVerifyDailyRegister}
                      disabled={isVerifyingRegister}
                      style={{ ...styles.buttonPrimary, background: '#059669', padding: '7px 14px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                      <span>✍️</span> {isVerifyingRegister ? 'Signing...' : `Verify & Sign Register (${selectedRegisterDate})`}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => window.print()}
                    style={{ ...styles.buttonSecondary, padding: '7px 12px', fontSize: '12px' }}
                  >
                    🖨️ Print Day Sheet
                  </button>
                </div>
              </div>

              {/* Working Day Register Table */}
              <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left', minWidth: '780px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', color: '#475569', fontSize: '10px', fontWeight: '800', textTransform: 'uppercase' }}>
                      <th style={{ padding: '10px 12px', width: '40px' }}>#</th>
                      <th style={{ padding: '10px 12px' }}>Student Name</th>
                      <th style={{ padding: '10px 12px' }}>Ad.No</th>
                      <th style={{ padding: '10px 12px', textAlign: 'center' }}>
                        🌅 FORENOON (Periods 1–6)
                        <div style={{ fontSize: '9px', fontWeight: '600', color: '#64748b' }}>Present in any = Present</div>
                      </th>
                      <th style={{ padding: '10px 12px', textAlign: 'center' }}>
                        🌇 AFTERNOON (Periods 7–9)
                        <div style={{ fontSize: '9px', fontWeight: '600', color: '#64748b' }}>Present in any = Present</div>
                      </th>
                      <th style={{ padding: '10px 12px', textAlign: 'center' }}>Day Result</th>
                      <th style={{ padding: '10px 12px' }}>Period Breakdown Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const daySessions = fnAnMonthSessionsCache.filter(s => s.date === selectedRegisterDate);
                      const fnSess = daySessions.filter(s => Number(s.session) <= 6).sort((a,b) => a.session - b.session);
                      const anSess = daySessions.filter(s => Number(s.session) > 6).sort((a,b) => a.session - b.session);

                      if (daySessions.length === 0) {
                        return (
                          <tr>
                            <td colSpan={7} style={{ padding: '30px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                              No period attendance sessions recorded on <strong>{selectedRegisterDate}</strong> for this class yet.
                            </td>
                          </tr>
                        );
                      }

                      return classStudentsList.map((st, idx) => {
                        const reg = st.regNo;
                        const ad = String(st.adNo || '').trim().toUpperCase();

                        const fnDetails = fnSess.map(s => {
                          const val = (s.attendanceMap || {})[reg] || (s.attendanceMap || {})[st.id] || (s.attendanceMap || {})[ad] || 'A';
                          return { session: s.session, subject: s.subject || s.classAlias, status: val };
                        });

                        const anDetails = anSess.map(s => {
                          const val = (s.attendanceMap || {})[reg] || (s.attendanceMap || {})[st.id] || (s.attendanceMap || {})[ad] || 'A';
                          return { session: s.session, subject: s.subject || s.classAlias, status: val };
                        });

                        const isFnPres = fnSess.length > 0 ? fnDetails.some(p => p.status === 'P' || p.status === 'O') : null;
                        const isAnPres = anSess.length > 0 ? anDetails.some(p => p.status === 'P' || p.status === 'O') : null;

                        const isFullPres = isFnPres && isAnPres;
                        const isHalfPres = (isFnPres && !isAnPres) || (!isFnPres && isAnPres);

                        return (
                          <tr key={st.regNo} style={{ borderBottom: '1px solid #f1f5f9', background: !isFnPres && !isAnPres ? '#fff1f2' : '#ffffff' }}>
                            <td style={{ padding: '10px 12px', color: '#64748b', fontWeight: '700' }}>{st.rollNo || idx + 1}</td>
                            <td style={{ padding: '10px 12px', fontWeight: '700', color: '#0f172a' }}>{st.firstName}</td>
                            <td style={{ padding: '10px 12px', color: '#475569', fontWeight: '600' }}>#{st.adNo}</td>

                            {/* FN Status */}
                            <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                              {fnSess.length === 0 ? (
                                <span style={{ color: '#94a3b8' }}>— No FN —</span>
                              ) : isFnPres ? (
                                <span style={{ background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', padding: '3px 10px', borderRadius: '999px', fontWeight: '800', fontSize: '11px' }}>
                                  🟢 FN PRESENT (0.5d)
                                </span>
                              ) : (
                                <span style={{ background: '#fff1f2', color: '#be123c', border: '1px solid #fecdd3', padding: '3px 10px', borderRadius: '999px', fontWeight: '800', fontSize: '11px' }}>
                                  🔴 FN ABSENT (0.0d)
                                </span>
                              )}
                            </td>

                            {/* AN Status */}
                            <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                              {anSess.length === 0 ? (
                                <span style={{ color: '#94a3b8' }}>— No AN —</span>
                              ) : isAnPres ? (
                                <span style={{ background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', padding: '3px 10px', borderRadius: '999px', fontWeight: '800', fontSize: '11px' }}>
                                  🟢 AN PRESENT (0.5d)
                                </span>
                              ) : (
                                <span style={{ background: '#fff1f2', color: '#be123c', border: '1px solid #fecdd3', padding: '3px 10px', borderRadius: '999px', fontWeight: '800', fontSize: '11px' }}>
                                  🔴 AN ABSENT (0.0d)
                                </span>
                              )}
                            </td>

                            {/* Day Result */}
                            <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: '800' }}>
                              {isFullPres ? (
                                <span style={{ color: '#047857', background: '#dcfce7', padding: '3px 8px', borderRadius: '6px' }}>
                                  1.0d Full
                                </span>
                              ) : isHalfPres ? (
                                <span style={{ color: '#d97706', background: '#fef3c7', padding: '3px 8px', borderRadius: '6px' }}>
                                  0.5d Half
                                </span>
                              ) : (
                                <span style={{ color: '#e11d48', background: '#fee2e2', padding: '3px 8px', borderRadius: '6px' }}>
                                  0.0d Absent
                                </span>
                              )}
                            </td>

                            {/* Period Breakdown */}
                            <td style={{ padding: '10px 12px', fontSize: '11px' }}>
                              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                {[...fnDetails, ...anDetails].map((p, pIdx) => (
                                  <span
                                    key={pIdx}
                                    style={{
                                      padding: '1px 5px',
                                      borderRadius: '4px',
                                      fontSize: '10px',
                                      fontWeight: '700',
                                      background: p.status === 'P' || p.status === 'O' ? '#ecfdf5' : '#fee2e2',
                                      color: p.status === 'P' || p.status === 'O' ? '#047857' : '#be123c',
                                      border: p.status === 'P' || p.status === 'O' ? '1px solid #a7f3d0' : '1px solid #fecdd3'
                                    }}
                                  >
                                    P{p.session}:{p.status}
                                  </span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* VIEW 2: MONTHLY SUMMARY TABLE WITH FILTERS */}
          {classTeacherSubView === 'monthly_summary' && (
            <div>
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
                      {(Array.isArray(r.leaveReasonsList) && r.leaveReasonsList.length > 0) ? (
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

          {/* VIEW 3: FULL MONTH ATTENDANCE MATRIX GRID */}
          {classTeacherSubView === 'full_month_matrix' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '600' }}>
                Displaying all working days in {selectedMonthForFnAn}. Each column displays Forenoon (FN) and Afternoon (AN) status.
              </div>
              <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', textAlign: 'center', minWidth: '920px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: '800' }}>
                      <th style={{ padding: '8px 10px', textAlign: 'left', position: 'sticky', left: 0, background: '#f8fafc', zIndex: 2 }}>Student</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left' }}>Ad.No</th>
                      {classWorkingDatesInMonth.map(dStr => (
                        <th key={dStr} style={{ padding: '6px 8px', borderLeft: '1px solid #e2e8f0' }}>
                          <div>{dStr.slice(8)}</div>
                          <div style={{ fontSize: '9px', color: '#64748b' }}>FN | AN</div>
                        </th>
                      ))}
                      <th style={{ padding: '8px 10px', background: '#ecfdf5', color: '#047857' }}>Pres</th>
                      <th style={{ padding: '8px 10px', background: '#fff1f2', color: '#be123c' }}>Abs</th>
                      <th style={{ padding: '8px 10px' }}>Att %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {classStudentsList.map((st, idx) => {
                      let wDays = 0;
                      let dPres = 0;

                      return (
                        <tr key={st.regNo} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '8px 10px', textAlign: 'left', fontWeight: '700', color: '#0f172a', position: 'sticky', left: 0, background: '#ffffff', zIndex: 1 }}>
                            {st.firstName}
                          </td>
                          <td style={{ padding: '8px 10px', textAlign: 'left', color: '#64748b' }}>#{st.adNo}</td>

                          {classWorkingDatesInMonth.map(dStr => {
                            const daySessions = fnAnMonthSessionsCache.filter(s => s.date === dStr);
                            const fnSess = daySessions.filter(s => Number(s.session) <= 6);
                            const anSess = daySessions.filter(s => Number(s.session) > 6);

                            const hasFn = fnSess.length > 0;
                            const hasAn = anSess.length > 0;

                            const isFnPres = hasFn ? fnSess.some(s => {
                              const val = (s.attendanceMap || {})[st.regNo] || (s.attendanceMap || {})[st.adNo];
                              return val === 'P' || val === 'O';
                            }) : false;

                            const isAnPres = hasAn ? anSess.some(s => {
                              const val = (s.attendanceMap || {})[st.regNo] || (s.attendanceMap || {})[st.adNo];
                              return val === 'P' || val === 'O';
                            }) : false;

                            if (hasFn && hasAn) {
                              wDays += 1;
                              dPres += (isFnPres ? 0.5 : 0) + (isAnPres ? 0.5 : 0);
                            } else if (hasFn || hasAn) {
                              wDays += 0.5;
                              dPres += (hasFn && isFnPres) || (hasAn && isAnPres) ? 0.5 : 0;
                            }

                            return (
                              <td key={dStr} style={{ padding: '6px 4px', borderLeft: '1px solid #f1f5f9' }}>
                                <span style={{ color: isFnPres ? '#059669' : '#e11d48', fontWeight: '800' }}>
                                  {hasFn ? (isFnPres ? 'P' : 'A') : '-'}
                                </span>
                                <span style={{ color: '#cbd5e1', margin: '0 2px' }}>|</span>
                                <span style={{ color: isAnPres ? '#059669' : '#e11d48', fontWeight: '800' }}>
                                  {hasAn ? (isAnPres ? 'P' : 'A') : '-'}
                                </span>
                              </td>
                            );
                          })}

                          <td style={{ padding: '8px 10px', fontWeight: '800', color: '#047857', background: '#f0fdf4' }}>
                            {dPres}d
                          </td>
                          <td style={{ padding: '8px 10px', fontWeight: '800', color: '#e11d48', background: '#fef2f2' }}>
                            {Math.max(0, wDays - dPres)}d
                          </td>
                          <td style={{ padding: '8px 10px', fontWeight: '800' }}>
                            {wDays > 0 ? ((dPres / wDays) * 100).toFixed(1) + '%' : '100%'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
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