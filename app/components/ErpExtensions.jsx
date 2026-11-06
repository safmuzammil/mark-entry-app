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
  "Pathanamthitta", "Thiruvananthapuram", "Other"
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
      .erp-card-hover {
        transition: transform 0.18s ease, box-shadow 0.18s ease;
      }
      .erp-card-hover:hover {
        transform: translateY(-3px);
        box-shadow: 0 12px 24px rgba(15, 23, 42, 0.12) !important;
      }
      .erp-pill-readable {
        color: #0f172a !important;
        background-color: #ffffff !important;
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
  if ((a.includes('LOGIC') || a.includes('MANTIQ')) && (b.includes('LOGIC') || b.includes('MANTIQ'))) return true;
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
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCompletion, setFilterCompletion] = useState('All');
  const [filterConsultancyStatus, setFilterConsultancyStatus] = useState('All');
  const [editingStudent, setEditingStudent] = useState(null);
  const [modalInitialSection, setModalInitialSection] = useState('log');

  // 🌟 Minimalist Panel & Row Expansion State
  const [activeToolDrawer, setActiveToolDrawer] = useState('none'); // 'none' | 'filters' | 'bulk' | 'target' | 'pta'
  const [expandedRowRegNo, setExpandedRowRegNo] = useState(null);
  const [visibleCols, setVisibleCols] = useState({
    skills: false,
    contact: false
  });

  // 🌟 Class PTA WhatsApp Broadcast State (100% Restored!)
  const [classPtaMessage, setClassPtaMessage] = useState('');
  const [ptaGroupLink, setPtaGroupLink] = useState('');

  // 🌟 Outreach Coordinator Top-Level View Switcher ('dashboard' | 'usthads' | 'directory' | 'queue')
  const [outreachActiveSubTab, setOutreachActiveSubTab] = useState('directory');
  const [inspectingUsthadUsername, setInspectingUsthadUsername] = useState('');

  const [outreachRoleFilter, setOutreachRoleFilter] = useState('All');
  const [outreachDeptFilter, setOutreachDeptFilter] = useState('All');
  const [outreachClassFilter, setOutreachClassFilter] = useState('All');

  const [semesterTargetConfig, setSemesterTargetConfig] = useState({
    semesterName: 'Current Semester',
    minConsultations: 3,
    targetDeadline: '',
    guidelinesNote: 'Every Mentor Usthad must conduct at least 3 structured 1-on-1 sittings per mentee this semester.'
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
      const updated = {
        ...semesterTargetConfig,
        minConsultations: cleanMin,
        updatedBy: loggedInTeacher?.fullName || 'Admin / Outreach Coordinator',
        updatedAt: new Date().toISOString()
      };
      await setDoc(doc(db, 'systemCache', 'mentorshipConfig'), updated, { merge: true });
      setSemesterTargetConfig(updated);
      setActiveToolDrawer('none');
      alert(`✅ Semester Minimum Consultancy Target set to ${cleanMin} sittings per mentee!`);
    } catch (err) {
      alert('Failed to save target: ' + err.message);
    } finally {
      setIsSavingConfig(false);
    }
  };

  const getStudentConsultancyMetrics = (st) => {
    const logs = Array.isArray(st?.mentorLogs)
      ? st.mentorLogs
      : Array.isArray(st?.consultationLogs)
        ? st.consultationLogs
        : [];
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

    const isOverdue30 = daysSinceLast === null || daysSinceLast > 30;
    const isEscalated = String(latestLog?.wellbeingStatus || st?.latestWellbeingStatus || '').includes('Urgent');

    return { logs, count, minReq, metTarget, latestLog, lastDateStr, daysSinceLast, isOverdue30, isEscalated };
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
  const niicsStudentsList = students.filter(isStudentMyNiics);

  const hasClassDuty = myClassTeacherOf.length > 0 || classStudentsList.length > 0;
  const hasMentorDuty = Boolean(priv.isMentor) || menteeStudentsList.length > 0;

  const availableDutyTabs = [];
  if (!isAdmin && !isOutreachView) {
    if (hasClassDuty) availableDutyTabs.push({ id: 'CLASS', label: `🏫 Class ${myClassTeacherOf.join(', ') || ''} (${classStudentsList.length})` });
    if (hasMentorDuty) availableDutyTabs.push({ id: 'MENTEES', label: `🧭 My Mentees (${menteeStudentsList.length})` });
    if (isNiicsCoord) availableDutyTabs.push({ id: 'NIICS', label: `🎓 NIICS Urdu (${niicsStudentsList.length})` });
    if (availableDutyTabs.length > 1) {
      const combinedCount = students.filter(st => isStudentInMyClass(st) || isStudentMyMentee(st) || isStudentMyNiics(st)).length;
      availableDutyTabs.push({ id: 'ALL', label: `👥 Combined View (${combinedCount})` });
    }
  }

  const defaultTabMode = hasClassDuty ? 'CLASS' : hasMentorDuty ? 'MENTEES' : isNiicsCoord ? 'NIICS' : 'ALL';
  const [teacherViewMode, setTeacherViewMode] = useState(defaultTabMode);

  useEffect(() => {
    if (!isAdmin && !isOutreachView) {
      if (hasClassDuty && !hasMentorDuty && !isNiicsCoord) setTeacherViewMode('CLASS');
      else if (hasMentorDuty && !hasClassDuty && !isNiicsCoord) setTeacherViewMode('MENTEES');
      else if (isNiicsCoord && !hasClassDuty && !hasMentorDuty) setTeacherViewMode('NIICS');
    }
  }, [isAdmin, isOutreachView, hasClassDuty, hasMentorDuty, isNiicsCoord]);

  useEffect(() => {
    if (!isAdmin && myClassTeacherOf.length > 0) {
      getDoc(doc(db, 'systemCache', `ptaGroup_${myClassTeacherOf[0]}`)).then(snap => {
        if (snap.exists() && snap.data().link) setPtaGroupLink(snap.data().link);
      }).catch(() => {});
    }
  }, [isAdmin, myClassTeacherOf]);

  const savePtaGroupLink = async () => {
    if (!myClassTeacherOf[0]) return;
    const newLink = window.prompt(`Enter WhatsApp Group Invite Link for Class ${myClassTeacherOf[0]}:`, ptaGroupLink);
    if (newLink !== null) {
      try {
        await setDoc(doc(db, 'systemCache', `ptaGroup_${myClassTeacherOf[0]}`), { link: newLink.trim() }, { merge: true });
        setPtaGroupLink(newLink.trim());
        alert("✅ Class PTA Group Link saved!");
      } catch (err) { alert("Failed to save link."); }
    }
  };

  const openPtaGroupAndSend = () => {
    if (!ptaGroupLink) return alert("Please set the Class PTA WhatsApp Group Link first.");
    navigator.clipboard.writeText(classPtaMessage).then(() => {
      window.open(ptaGroupLink, '_blank');
      alert("✅ Message copied to clipboard! Paste it into the WhatsApp group.");
    }).catch(() => alert("Failed to copy message."));
  };

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
      if (!st.firstName?.toLowerCase().includes(q) && !String(st.adNo).toLowerCase().includes(q) && !st.district?.toLowerCase().includes(q)) return false;
    }
    const comp = computeStudentProfileCompletion(st);
    if (filterCompletion === 'Complete' && !comp.isComplete) return false;
    if (filterCompletion === 'Incomplete' && comp.isComplete) return false;

    const cMetrics = getStudentConsultancyMetrics(st);
    if (filterConsultancyStatus === 'TargetMet' && !cMetrics.metTarget) return false;
    if (filterConsultancyStatus === 'BelowTarget' && cMetrics.metTarget) return false;
    if (filterConsultancyStatus === 'ZeroSittings' && cMetrics.count > 0) return false;
    if (filterConsultancyStatus === 'Overdue30' && !cMetrics.isOverdue30) return false;
    if (filterConsultancyStatus === 'Escalated' && !cMetrics.isEscalated) return false;

    if (isAdmin || isOutreachView) {
      if (outreachRoleFilter === 'Mentors Assigned' && !st.mentorUsername) return false;
      if (outreachRoleFilter === 'No Mentor' && st.mentorUsername) return false;
      if (outreachDeptFilter !== 'All' && (st.department || 'GENERAL') !== outreachDeptFilter) return false;
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
  const overdue30Count = scopedStudents.filter(s => getStudentConsultancyMetrics(s).isOverdue30).length;
  const escalatedCount = scopedStudents.filter(s => getStudentConsultancyMetrics(s).isEscalated).length;
  const totalSittingsLoggedInScope = scopedStudents.reduce((acc, s) => acc + getStudentConsultancyMetrics(s).count, 0);

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

    return {
      teacher: t, totalMentees, metTargetMentees,
      pendingTargetMentees: totalMentees - metTargetMentees,
      zeroSittingMentees, totalSessions, latestSittingDate, targetCompletionPct, menteesList: tMentees
    };
  }).filter(row => row.totalMentees > 0 || row.teacher.outpassPrivileges?.isMentor);

  const handleBulkAssignMentor = async () => {
    if (selectedStudentRegs.length === 0) return alert('Please select at least one student using the checkboxes.');
    if (!targetMentorUsername) return alert('Please select a Mentor from the dropdown.');

    const mentorObj = teachers.find(t => t.username === targetMentorUsername);
    const isUnassign = targetMentorUsername === '__UNASSIGN__';

    setIsAssigningMentor(true);
    setMentorAssignStatus('');

    try {
      const newMentorUser = isUnassign ? '' : mentorObj.username;
      const newMentorName = isUnassign ? '' : mentorObj.fullName;

      await Promise.all(
        selectedStudentRegs.map(regNo =>
          setDoc(doc(db, 'students', String(regNo).toLowerCase()), {
            mentorUsername: newMentorUser,
            mentorName: newMentorName
          }, { merge: true })
        )
      );

      if (onStudentUpdated) {
        selectedStudentRegs.forEach(regNo => {
          const found = students.find(s => s.regNo === regNo);
          if (found) onStudentUpdated({ ...found, mentorUsername: newMentorUser, mentorName: newMentorName });
        });
      }

      setMentorAssignStatus(
        isUnassign
          ? `✅ Cleared mentor assignment for ${selectedStudentRegs.length} students.`
          : `✅ Assigned ${selectedStudentRegs.length} students as mentees to ${mentorObj.fullName}!`
      );
      setSelectedStudentRegs([]);
    } catch (err) {
      alert('Failed to assign mentor: ' + err.message);
    } finally {
      setIsAssigningMentor(false);
      setTimeout(() => setMentorAssignStatus(''), 5000);
    }
  };

  // 🌟 100% Restored: Bulk Assign Skill Tag to Checked Students!
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
                  padding: '9px 16px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: '700',
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
                  padding: '9px 16px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: '700',
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
                  padding: '9px 14px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  background: activeToolDrawer === 'bulk' ? '#eef2ff' : '#ffffff',
                  color: '#4f46e5',
                  border: '1px solid #c7d2fe'
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

      {/* SOFT PASTEL KPI STRIP */}
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
        /* MINIMALIST STUDENT MENTORSHIP TABLE */
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
                  {visibleCols.skills && <th style={{ padding: '14px 16px' }}>SKILLS &amp; PROFILE</th>}
                  {visibleCols.contact && <th style={{ padding: '14px 16px' }}>CONTACT</th>}
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

                        {visibleCols.skills && (
                          <td style={{ padding: '14px 16px', fontSize: '12px', color: '#475569' }}>
                            {(st.skills || []).length} Skills • {comp.pct}% Profile
                          </td>
                        )}
                        {visibleCols.contact && (
                          <td style={{ padding: '14px 16px', fontSize: '12px', color: '#475569' }}>
                            {st.parentWhatsapp || st.parentMobile || '—'}
                          </td>
                        )}

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
                          <td colSpan={8} style={{ padding: '16px 24px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
                              <div>
                                <div style={{ fontWeight: '700', fontSize: '13px', color: '#0f172a' }}>
                                  Latest Sitting: {cMetrics.lastDateStr || 'None'} • Profile Completion: {comp.pct}% • Skills: {(st.skills || []).join(', ') || 'None'}
                                </div>
                                {cMetrics.latestLog?.summary && (
                                  <div style={{ fontSize: '12px', color: '#475569', marginTop: '4px' }}>
                                    💬 "{cMetrics.latestLog.summary}"
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