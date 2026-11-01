'use client';
import React, { useState, useEffect } from 'react';
import { doc, setDoc, getDoc, getDocs, collection } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { 
  WEB_APP_URL, DHIU_LOGO_URL, DEFAULT_SUBJECTS, DEFAULT_CLASSES, DEPARTMENTS, styles 
} from './erpConstants';

// Complete list of all 28 Indian States, 8 Union Territories, and Nepal
export const INDIAN_STATES = [
  "Kerala",
  "Karnataka",
  "Tamil Nadu",
  "Lakshadweep",
  "Maharashtra",
  "Uttar Pradesh",
  "Bihar",
  "West Bengal",
  "Assam",
  "Andhra Pradesh",
  "Telangana",
  "Delhi",
  "Gujarat",
  "Rajasthan",
  "Madhya Pradesh",
  "Punjab",
  "Haryana",
  "Jammu & Kashmir",
  "Jharkhand",
  "Odisha",
  "Chhattisgarh",
  "Uttarakhand",
  "Himachal Pradesh",
  "Goa",
  "Tripura",
  "Manipur",
  "Meghalaya",
  "Nagaland",
  "Arunachal Pradesh",
  "Mizoram",
  "Sikkim",
  "Puducherry",
  "Andaman & Nicobar",
  "Ladakh",
  "Chandigarh",
  "Dadra & Nagar Haveli and Daman & Diu",
  "Nepal",
  "Other"
];

export const KERALA_DISTRICTS = [
  "Malappuram",
  "Kozhikode",
  "Palakkad",
  "Thrissur",
  "Wayanad",
  "Kannur",
  "Kasaragod",
  "Ernakulam",
  "Alappuzha",
  "Kottayam",
  "Idukki",
  "Kollam",
  "Pathanamthitta",
  "Thiruvananthapuram",
  "Other"
];

// ============================================================================
// 🎨 1. HIGH-CONTRAST CSS FIX
// ============================================================================
export function HighContrastStyles() {
  return (
    <style>{`
      input, select, textarea {
        color: #0f172a !important;
        background-color: #ffffff !important;
        border: 1.5px solid #94a3b8 !important;
        color-scheme: light !important;
        font-weight: 600 !important;
      }
      input::placeholder, textarea::placeholder {
        color: #64748b !important;
        opacity: 1 !important;
        font-weight: 500 !important;
      }
      input:disabled, select:disabled {
        background-color: #f1f5f9 !important;
        color: #475569 !important;
        border-color: #cbd5e1 !important;
      }
      input:focus, select:focus, textarea:focus {
        outline: 2px solid #00897b !important;
        border-color: #00897b !important;
      }
      table th {
        color: #0f172a;
        font-weight: 800;
      }
      table td {
        color: #1e293b;
        font-weight: 600;
      }
    `}</style>
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

// Copies message to clipboard AND opens the saved Staff Group or Class PTA Group link!
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

  // Known specific class codes (including common variants like ALC2 / QLA3)
  const KNOWN_SPECIFIC_CLASSES = [
    'QH1', 'AL1', 'ALC1', 'FC1',
    'QH2', 'AL2', 'ALC2', 'FC2',
    'QLA3', 'HFC3', 'QH3', 'AL3', 'FC3'
  ];

  // 1. If targetClass explicitly names a specific class (e.g., "FC2"), ONLY match students in that class!
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

  // 2. If the alias contains a specific class name (e.g., "FC2 Thamadun" or "QLA 3 Hifz"),
  // STRICTLY lock to that class and DO NOT fall back to generic Grade 2 or Grade 3!
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

  // 3. Otherwise, it's a generic grade-level batch (e.g., "M10", "U10", "M9", "U9", "M8", "U8", or "Grade 2")
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
        background: 'linear-gradient(135deg, #00897b 0%, #0f766e 100%)',
        color: '#ffffff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: '800',
        fontSize: Math.round(size * 0.42),
        overflow: 'hidden',
        border: '2px solid #99f6e4',
        cursor: onClick ? 'pointer' : 'default',
        boxShadow: '0 2px 5px rgba(0,0,0,0.1)'
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
// 📚 6. SINGLE-TEACHER PER SUBJECT SELECTOR (RADIO BEHAVIOR, 100% ENGLISH)
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
    <div style={{ background: '#f0fdfa', padding: '20px', borderRadius: '12px', border: '2px solid #0d9488', marginTop: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '14px' }}>
        <div>
          <h4 style={{ margin: 0, fontSize: '16px', color: '#0f172a', fontWeight: '800' }}>
            📚 Assign Subject Teachers (Batch: Grade {targetGrade} • {selectedClasses.join(', ') || 'Select a Class above'})
          </h4>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#334155', fontWeight: '600' }}>
            Select <strong>one teacher per subject</strong> below. The student will automatically be added to that teacher&apos;s class list.
            {designatedClassTeacher && (
              <span style={{ marginLeft: '8px', color: '#0f766e', fontWeight: '800' }}>
                • 🏫 Class Teacher &amp; Hifz: {designatedClassTeacher.fullName} (Auto-Assigned)
              </span>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            onClick={handleAutoSelectBestSingleTeacherPerSubject}
            style={{ padding: '8px 14px', background: '#00897b', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '800', fontSize: '12px', cursor: 'pointer' }}
          >
            ✓ Auto-Select 1 Teacher Per Subject
          </button>
          <button
            type="button"
            onClick={() => onChangeSelectedKeys([])}
            style={{ padding: '8px 12px', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '8px', fontWeight: '800', fontSize: '12px', cursor: 'pointer' }}
          >
            Clear All
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '10px' }}>
        {subjectMappings.map((item) => (
          <div key={item.subject} style={{ background: '#ffffff', padding: '12px', borderRadius: '10px', border: '1px solid #cbd5e1' }}>
            <div style={{ fontWeight: '800', fontSize: '13px', color: '#0f172a', marginBottom: '6px', borderBottom: '1px solid #f1f5f9', paddingBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>
              <span>📖 {item.subject}</span>
              {item.isHifz && designatedClassTeacher && (
                <span style={{ fontSize: '11px', color: '#059669' }}>🏫 Auto via Class Teacher</span>
              )}
            </div>

            {item.options.length === 0 ? (
              <div style={{ fontSize: '12px', color: item.isHifz && designatedClassTeacher ? '#0f766e' : '#94a3b8', fontWeight: '700' }}>
                {item.isHifz && designatedClassTeacher
                  ? `👨‍🏫 ${designatedClassTeacher.fullName} (Class Teacher)`
                  : `No teacher assigned for Grade ${targetGrade}`}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
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
                        alignItems: 'flex-start',
                        gap: '8px',
                        cursor: 'pointer',
                        fontSize: '12px',
                        padding: '7px 8px',
                        borderRadius: '8px',
                        background: isChecked ? '#ecfdf5' : '#f8fafc',
                        border: isChecked ? '2px solid #059669' : '1px solid #e2e8f0'
                      }}
                    >
                      <input
                        type="radio"
                        name={`subject_radio_${item.subject}`}
                        checked={isChecked}
                        readOnly
                        style={{ marginTop: '2px', width: '15px', height: '15px', accentColor: '#00897b' }}
                      />
                      <div>
                        <div style={{ fontWeight: '800', color: '#0f172a' }}>👨‍🏫 {opt.teacherName}</div>
                        <div style={{ color: '#0f766e', fontSize: '11px', fontWeight: '700' }}>
                          {opt.alias} ({opt.langTag})
                        </div>
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

      // 🌟 1. Deduplicate any existing double Hifz entries (e.g. "QLA 3 Hifz" vs "QLA3 Hifz")
      const seenHifzClasses = new Set();
      let updatedEnrollments = rawEnrollments.filter(e => {
        const isSubHifz = String(e.subject || '').toUpperCase() === 'HIFZ' || String(e.alias || '').toUpperCase().includes('HIFZ');
        if (!isSubHifz) return true;

        const normKey = normalizeCls(e.targetClass || e.alias).replace('HIFZ', '');
        if (normKey && seenHifzClasses.has(normKey)) {
          return false; // Remove duplicate Hifz slot
        }
        if (normKey) seenHifzClasses.add(normKey);
        return true;
      });

      // 🌟 2. Space-insensitive check before adding Hifz for designated Class Teacher classes
      ctClasses.forEach(clsName => {
        const normCls = normalizeCls(clsName);
        const gradeMatch = String(clsName).match(/\d+/);
        const gradeNum = gradeMatch ? gradeMatch[0] : '1';

        const hasHifzForClass = updatedEnrollments.some(e => {
          const isSubHifz = String(e.subject || '').toUpperCase() === 'HIFZ' || String(e.alias || '').toUpperCase().includes('HIFZ');
          const normTarget = normalizeCls(e.targetClass);
          const normAlias = normalizeCls(e.alias);
          return isSubHifz && (normTarget === normCls || normAlias.includes(normCls));
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
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '16px' }}>
      <div style={{ background: '#ffffff', borderRadius: '16px', maxWidth: '680px', width: '100%', maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 24px 48px rgba(0,0,0,0.35)', color: '#0f172a' }}>
        <div style={{ background: '#0f172a', color: '#ffffff', padding: '18px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '11px', color: '#38bdf8', fontWeight: '800', textTransform: 'uppercase' }}>ROLE-BASED ACCESS & LEAVE AUTHORITY MATRIX</div>
            <h3 style={{ margin: '4px 0 0', fontSize: '20px', fontWeight: '800', color: '#ffffff' }}>
              🔑 Configure Roles & Privileges: {teacher.fullName} (@{teacher.username})
            </h3>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', borderRadius: '8px', width: '32px', height: '32px', cursor: 'pointer', fontWeight: '800' }}>✕</button>
        </div>

        <div style={{ padding: '22px 24px' }}>
          <div style={{ fontSize: '13px', fontWeight: '900', color: '#0f172a', marginBottom: '10px', textTransform: 'uppercase' }}>
            1. Assign Institutional Roles (Multi-Select)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '10px', marginBottom: '20px' }}>
            {[
              { key: 'isMentor', title: '🧭 Academic Mentor', desc: 'Can be assigned mentees, log mentor consultations & update mentee profile details', bg: '#f0fdfa', border: '#14b8a6' },
              { key: 'isPrincipal', title: '👑 Principal Authority', desc: 'Universal approval for all leaves, Principal-locked students & Weekend leaves', bg: '#fef9c3', border: '#facc15' },
              { key: 'isNiicsCoordinator', title: '🎓 NIICS Coordinator (Urdu Principal)', desc: 'Acts as Principal for all Urdu students (Ad.No starting with U) across all leaves & portfolios', bg: '#fef3c7', border: '#f59e0b' },
              { key: 'isAcademicCoordinator', title: '📊 Academic Coordinator', desc: 'Unlocks Admin Mark Entry, Inspector & Academic Evaluation tabs inside Teacher Portal', bg: '#eff6ff', border: '#60a5fa' },
              { key: 'isOutreachCoordinator', title: '🌍 Outreach Coordinator', desc: 'Unlocks Outreach Mentor-Mentee dialogues tab, Bulk Mentor Assignment & Outreach Leave approval', bg: '#f0fdf4', border: '#4ade80' },
              { key: 'isOfficeSecretary', title: '🏢 Office Secretary', desc: 'Unlocks full Out-Pass Management, Live Campus Dashboard & Request Tracking', bg: '#faf5ff', border: '#c084fc' }
            ].map(role => (
              <label key={role.key} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '12px', borderRadius: '10px', background: priv[role.key] ? role.bg : '#f8fafc', border: `2px solid ${priv[role.key] ? role.border : '#cbd5e1'}`, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={Boolean(priv[role.key])}
                  onChange={(e) => setPriv({ ...priv, [role.key]: e.target.checked })}
                  style={{ width: '18px', height: '18px', marginTop: '2px', accentColor: '#00897b' }}
                />
                <div>
                  <div style={{ fontWeight: '800', fontSize: '14px', color: '#0f172a' }}>{role.title}</div>
                  <div style={{ fontSize: '12px', color: '#334155', fontWeight: '600', marginTop: '2px' }}>{role.desc}</div>
                </div>
              </label>
            ))}
          </div>

          <div style={{ marginBottom: '20px', background: '#f8fafc', padding: '14px', borderRadius: '12px', border: '1.5px solid #cbd5e1' }}>
            <div style={{ fontSize: '13px', fontWeight: '900', color: '#0f172a', marginBottom: '4px' }}>
              2. 🏫 Designated Class Teacher Of (Auto-Assigns Class Students & Hifz Mark Entry):
            </div>
            <p style={{ margin: '0 0 10px', fontSize: '12px', color: '#475569', fontWeight: '600' }}>
              Selecting a class below automatically assigns all students of that class to this teacher AND adds <strong>Hifz</strong> mark entry for that class under this teacher (without creating duplicates).
            </p>
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
                      padding: '8px 16px', borderRadius: '8px', fontWeight: '800', fontSize: '13px', cursor: 'pointer',
                      border: active ? '2px solid #00897b' : '1.5px solid #94a3b8',
                      background: active ? '#00897b' : '#ffffff',
                      color: active ? '#ffffff' : '#0f172a'
                    }}
                  >
                    {active ? `✓ Class ${cls} (+Hifz)` : cls}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ border: '1.5px solid #cbd5e1', borderRadius: '12px', overflow: 'hidden' }}>
            <div style={{ background: '#00897b', color: '#ffffff', padding: '10px 16px', fontWeight: '800', fontSize: '13px' }}>
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
                <label key={row.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #e2e8f0', alignItems: 'center', fontSize: '13px', fontWeight: '700', color: '#0f172a', cursor: 'pointer', background: '#ffffff' }}>
                  <span>{row.label}</span>
                  <input
                    type="checkbox"
                    checked={allowed}
                    onChange={(e) => {
                      const cur = priv.allowedCategories || [];
                      const next = e.target.checked ? [...cur, row.id] : cur.filter(x => x !== row.id);
                      setPriv({ ...priv, allowedCategories: next });
                    }}
                    style={{ width: '18px', height: '18px', accentColor: '#00897b' }}
                  />
                </label>
              );
            })}

            <label style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #e2e8f0', alignItems: 'center', fontSize: '13px', fontWeight: '800', color: '#0f172a', background: '#f0fdfa', cursor: 'pointer' }}>
              <span>🗓️ Weekend Leave Authority (Thu Eve ➔ Fri Eve / Sat)</span>
              <input
                type="checkbox"
                checked={Boolean(priv.canApproveWeekend || priv.isPrincipal)}
                onChange={(e) => setPriv({ ...priv, canApproveWeekend: e.target.checked })}
                style={{ width: '18px', height: '18px', accentColor: '#00897b' }}
              />
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
            <button type="button" onClick={onClose} style={{ padding: '10px 18px', background: '#e2e8f0', color: '#0f172a', border: 'none', borderRadius: '8px', fontWeight: '800', cursor: 'pointer' }}>Cancel</button>
            <button type="button" onClick={handleSave} disabled={saving} style={{ padding: '10px 22px', background: '#00897b', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '800', cursor: 'pointer' }}>
              {saving ? 'Saving...' : '💾 Save Roles & Privileges'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function StudentPortfolioModal({
  student,
  canEditSkills = true,
  canViewConfidential = true,
  editorName = 'Faculty',
  initialSection = 'log', // 'log' | 'skills' | 'profile'
  semesterTarget = 3,
  onClose,
  onSaved
}) {
  const [activeModalTab, setActiveModalTab] = useState(initialSection);
  const [saving, setSaving] = useState(false);

  // 1. Profile Contact Fields
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

  // 2. Skills & Achievements State
  const [skills, setSkills] = useState(Array.isArray(student?.skills) ? student.skills : []);
  const [newSkill, setNewSkill] = useState('');
  const [achievements, setAchievements] = useState(Array.isArray(student?.achievements) ? student.achievements : []);
  const [achTitle, setAchTitle] = useState('');
  const [achCategory, setAchCategory] = useState('Academic');
  const [achLevel, setAchLevel] = useState('Campus / Sibaq');
  const [achDate, setAchDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [achNotes, setAchNotes] = useState('');

  // 3. Structured Mentor-Mentee Consultation Logs State
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
    'CCE & Academic Progress',
    'Hifz & Tilawah',
    'Attendance & Punctuality',
    'Language Fluency (Ar/En/Ur)',
    'Sibaq & Co-Curricular',
    'Hostel & Peer Adjustment',
    'Personal / Family Wellbeing',
    'Career & Higher Studies'
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

  // Log a new Mentor-Mentee Sitting
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

  // Add Skill
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

  // Add Achievement
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
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2200, padding: '14px' }}>
      <div style={{ background: '#ffffff', borderRadius: '18px', maxWidth: '880px', width: '100%', maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 25px 50px rgba(0,0,0,0.35)', color: '#0f172a' }}>

        {/* TOP HEADER */}
        <div style={{ background: '#0f172a', color: '#ffffff', padding: '18px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', position: 'sticky', top: 0, zIndex: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <ProfileAvatar name={formData.firstName} code={student.adNo} photoUrl={formData.photoUrl} size={52} />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0, fontSize: '20px', fontWeight: '900', color: '#ffffff' }}>{formData.firstName}</h3>
                <span style={{ background: '#00897b', color: '#fff', padding: '3px 9px', borderRadius: '6px', fontSize: '12px', fontWeight: '800' }}>
                  Ad.No #{student.adNo}
                </span>
                <span style={{ background: targetMet ? '#16a34a' : '#ea580c', color: '#fff', padding: '3px 9px', borderRadius: '6px', fontSize: '12px', fontWeight: '800' }}>
                  🗣️ Sittings: {sittingsCount} / {semesterTarget} {targetMet ? '✅' : '⏳'}
                </span>
              </div>
              <div style={{ fontSize: '12px', color: '#cbd5e1', marginTop: '4px', fontWeight: '600' }}>
                Reg: {student.regNo} • Class {(student.classes || []).join(', ')} ({student.department || 'GENERAL'}) • Mentor: {student.mentorName || student.mentorUsername || 'Unassigned'}
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.15)', color: '#ffffff', border: 'none', borderRadius: '8px', width: '36px', height: '36px', fontWeight: '900', cursor: 'pointer', fontSize: '16px' }}>✕</button>
        </div>

        {/* MODAL NAVIGATION TABS */}
        <div style={{ display: 'flex', gap: '8px', background: '#f1f5f9', padding: '10px 20px', borderBottom: '1px solid #cbd5e1', flexWrap: 'wrap' }}>
          {[
            { id: 'log', label: `📝 Mentor-Mentee Consultancy Log (${mentorLogs.length})` },
            { id: 'skills', label: `🏆 Skills (${skills.length}) & Achievements (${achievements.length})` },
            { id: 'profile', label: '📱 Contact & Personal Profile' }
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveModalTab(tab.id)}
              style={{
                padding: '10px 16px',
                borderRadius: '8px',
                border: 'none',
                fontWeight: '800',
                fontSize: '13px',
                cursor: 'pointer',
                background: activeModalTab === tab.id ? '#0f766e' : '#ffffff',
                color: activeModalTab === tab.id ? '#ffffff' : '#0f172a'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div style={{ padding: '24px' }}>
          {/* TAB 1: MENTORSHIP CONSULTANCY LOGGER & HISTORY */}
          {activeModalTab === 'log' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
              <form onSubmit={handleAddConsultationLog} style={{ background: '#f0fdfa', border: '2px solid #0d9488', borderRadius: '14px', padding: '18px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                  <h4 style={{ margin: 0, fontSize: '16px', fontWeight: '900', color: '#0f766e' }}>
                    ➕ Record New Mentor-Mentee Consultancy Sitting
                  </h4>
                  <span style={{ fontSize: '12px', fontWeight: '800', color: '#047857', background: '#ccfbf1', padding: '4px 10px', borderRadius: '999px' }}>
                    Logged by: {editorName}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '14px', marginBottom: '14px' }}>
                  <div>
                    <label style={styles.label}>Sitting Date:</label>
                    <input type="date" value={sessionDate} onChange={e => setSessionDate(e.target.value)} required style={styles.input} />
                  </div>
                  <div>
                    <label style={styles.label}>Interaction Type:</label>
                    <select value={sessionType} onChange={e => setSessionType(e.target.value)} style={styles.input}>
                      <option value="1-on-1 Personal Sitting">🗣️ 1-on-1 Personal Sitting</option>
                      <option value="Academic & CCE Review">📊 Academic & CCE Review</option>
                      <option value="Tarbiyah & Spiritual Guidance">🕌 Tarbiyah & Spiritual Guidance</option>
                      <option value="Behavioral / Discipline Counseling">⚖️ Behavioral / Discipline Counseling</option>
                      <option value="Career & Higher Studies">🎓 Career & Higher Studies</option>
                      <option value="Parent Phone Consultation">👨‍👩‍👦 Parent Phone Consultation</option>
                    </select>
                  </div>
                  <div>
                    <label style={styles.label}>Student Status / Wellbeing:</label>
                    <select value={wellbeingStatus} onChange={e => setWellbeingStatus(e.target.value)} style={styles.input}>
                      <option value="Thriving / On Track">🟢 Thriving / On Track</option>
                      <option value="Needs Academic Support">🟡 Needs Academic Support</option>
                      <option value="Personal / Health Concern">🟠 Personal / Health Concern</option>
                      <option value="Urgent / Escalate to Outreach">🔴 Urgent / Escalate to Outreach</option>
                    </select>
                  </div>
                </div>

                <div style={{ marginBottom: '14px' }}>
                  <label style={styles.label}>Topics Discussed in Sitting (Click to select):</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {DISCUSSION_TOPICS.map(topic => {
                      const active = discussedTopics.includes(topic);
                      return (
                        <button
                          key={topic}
                          type="button"
                          onClick={() => toggleTopic(topic)}
                          style={{
                            padding: '6px 12px',
                            borderRadius: '999px',
                            fontSize: '12px',
                            fontWeight: '800',
                            cursor: 'pointer',
                            border: active ? '2px solid #0f766e' : '1px solid #cbd5e1',
                            background: active ? '#0f766e' : '#ffffff',
                            color: active ? '#ffffff' : '#334155'
                          }}
                        >
                          {active ? `✓ ${topic}` : `+ ${topic}`}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px', marginBottom: '14px' }}>
                  <div>
                    <label style={styles.label}>Consultation Summary & Observations:</label>
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
                      <label style={{ ...styles.label, color: '#b45309' }}>🔒 Confidential Faculty Note (Hidden from Student):</label>
                      <textarea
                        rows={3}
                        placeholder="Private family/financial/behavioral notes for Mentor & Outreach Coordinator only..."
                        value={confidentialNote}
                        onChange={e => setConfidentialNote(e.target.value)}
                        style={{ ...styles.input, resize: 'vertical', borderColor: '#fcd34d', background: '#fffbeb' }}
                      />
                    </div>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '14px', marginBottom: '16px' }}>
                  <div>
                    <label style={styles.label}>🎯 Next Action Plan / Target Given to Student:</label>
                    <input
                      type="text"
                      placeholder="e.g. Complete pending Fiqh Level 2 CCE work before next Friday..."
                      value={actionItem}
                      onChange={e => setActionItem(e.target.value)}
                      style={styles.input}
                    />
                  </div>
                  <div>
                    <label style={styles.label}>📅 Next Follow-Up Date:</label>
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

              {/* CONSULTATION TIMELINE HISTORY */}
              <div>
                <h4 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: '900', color: '#0f172a' }}>
                  📜 Past Consultancy Sittings History ({mentorLogs.length})
                </h4>
                {mentorLogs.length === 0 ? (
                  <div style={{ padding: '28px', background: '#f8fafc', borderRadius: '12px', border: '1px dashed #cbd5e1', textAlign: 'center', color: '#64748b', fontWeight: '700' }}>
                    No mentor-mentee sittings have been logged for this student yet.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {mentorLogs.map((log, index) => {
                      const isUrgent = String(log.wellbeingStatus || '').includes('Urgent');
                      const isSupport = String(log.wellbeingStatus || '').includes('Support') || String(log.wellbeingStatus || '').includes('Concern');
                      return (
                        <div key={log.id || index} style={{ padding: '16px', borderRadius: '12px', border: isUrgent ? '2px solid #dc2626' : '1px solid #cbd5e1', background: isUrgent ? '#fef2f2' : '#ffffff' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                              <span style={{ background: '#0f172a', color: '#fff', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '800' }}>
                                📅 {log.date || 'N/A'}
                              </span>
                              <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '800' }}>
                                {log.type || 'Sitting'}
                              </span>
                              <span style={{
                                background: isUrgent ? '#fee2e2' : isSupport ? '#fef3c7' : '#dcfce7',
                                color: isUrgent ? '#991b1b' : isSupport ? '#92400e' : '#166534',
                                padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '800'
                              }}>
                                {log.wellbeingStatus || 'Logged'}
                              </span>
                            </div>
                            <div style={{ fontSize: '12px', color: '#475569', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <span>👨‍🏫 By <strong>{log.loggedBy || 'Mentor'}</strong></span>
                              <button type="button" onClick={() => handleDeleteLog(log.id)} style={{ background: 'transparent', border: 'none', color: '#dc2626', cursor: 'pointer', fontWeight: '800', fontSize: '12px' }}>
                                🗑️ Delete
                              </button>
                            </div>
                          </div>

                          {Array.isArray(log.topics) && log.topics.length > 0 && (
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
                              {log.topics.map((t, idx) => (
                                <span key={idx} style={{ background: '#f1f5f9', color: '#334155', padding: '2px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: '700' }}>
                                  #{t}
                                </span>
                              ))}
                            </div>
                          )}

                          {log.summary && (
                            <div style={{ fontSize: '14px', color: '#0f172a', fontWeight: '600', marginBottom: '6px', lineHeight: 1.5 }}>
                              {log.summary}
                            </div>
                          )}

                          {canViewConfidential && log.confidential && (
                            <div style={{ fontSize: '13px', color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', padding: '8px 12px', borderRadius: '8px', marginTop: '6px', fontWeight: '700' }}>
                              🔒 <strong>Confidential Note:</strong> {log.confidential}
                            </div>
                          )}

                          {(log.actionPlan || log.nextFollowUpDate) && (
                            <div style={{ marginTop: '8px', padding: '8px 12px', background: '#f0fdfa', borderRadius: '8px', fontSize: '12px', color: '#0f766e', fontWeight: '800', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
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

          {/* TAB 2: SKILLS & ACHIEVEMENTS */}
          {activeModalTab === 'skills' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div style={{ background: '#f8fafc', padding: '18px', borderRadius: '14px', border: '1px solid #cbd5e1' }}>
                <h4 style={{ margin: '0 0 10px 0', fontSize: '16px', fontWeight: '900', color: '#0f172a' }}>
                  🌟 Student Skills & Talents ({skills.length})
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

                    <div style={{ marginBottom: '14px' }}>
                      <span style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', display: 'block', marginBottom: '6px', textTransform: 'uppercase' }}>
                        ⚡ Quick 1-Click Skill Tags:
                      </span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {QUICK_SKILL_SUGGESTIONS.map(sug => (
                          <button
                            key={sug}
                            type="button"
                            onClick={() => handleAddSkill(sug)}
                            style={{ padding: '5px 10px', borderRadius: '999px', border: '1px solid #0d9488', background: '#ffffff', color: '#0f766e', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}
                          >
                            + {sug}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px' }}>
                  {skills.length === 0 ? (
                    <span style={{ fontSize: '13px', color: '#64748b', fontWeight: '600' }}>No skills added yet.</span>
                  ) : (
                    skills.map((sk, i) => (
                      <span key={i} style={{ background: '#ccfbf1', color: '#0f766e', border: '1px solid #14b8a6', padding: '6px 12px', borderRadius: '999px', fontSize: '13px', fontWeight: '800', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                        ✦ {sk}
                        {canEditSkills && (
                          <button type="button" onClick={() => handleRemoveSkill(sk)} style={{ background: 'transparent', border: 'none', color: '#dc2626', fontWeight: '900', cursor: 'pointer' }}>
                            ✕
                          </button>
                        )}
                      </span>
                    ))
                  )}
                </div>
              </div>

              {/* ACHIEVEMENTS & SIBAQ LOG */}
              <div style={{ background: '#f8fafc', padding: '18px', borderRadius: '14px', border: '1px solid #cbd5e1' }}>
                <h4 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: '900', color: '#0f172a' }}>
                  🏅 Add New Achievement / Award / Sibaq Record
                </h4>
                {canEditSkills && (
                  <form onSubmit={handleAddAchievement} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '18px' }}>
                    <input type="text" placeholder="Award / Achievement Title..." value={achTitle} onChange={e => setAchTitle(e.target.value)} required style={styles.input} />
                    <select value={achCategory} onChange={e => setAchCategory(e.target.value)} style={styles.input}>
                      <option value="Academic">📚 Academic Excellence</option>
                      <option value="Sibaq / Arts Fest">🎨 Sibaq / Arts Fest</option>
                      <option value="Hifz & Quran">📖 Hifz & Quran</option>
                      <option value="Oratory & Debate">🎙️ Oratory & Debate</option>
                      <option value="Writing & Publication">✍️ Writing & Publication</option>
                      <option value="Sports & Leadership">🏆 Sports & Leadership</option>
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

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {achievements.map((ach, i) => (
                    <div key={ach.id || i} style={{ background: '#ffffff', padding: '14px', borderRadius: '10px', border: '1px solid #cbd5e1', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                      <div>
                        <div style={{ fontWeight: '800', fontSize: '15px', color: '#0f172a' }}>🏅 {ach.title}</div>
                        <div style={{ fontSize: '12px', color: '#475569', fontWeight: '700', marginTop: '4px' }}>
                          {ach.category} • {ach.level} • 📅 {ach.date} {ach.addedBy ? `• Verified by ${ach.addedBy}` : ''}
                        </div>
                        {ach.notes && <div style={{ fontSize: '13px', color: '#0f766e', fontWeight: '700', marginTop: '4px' }}>{ach.notes}</div>}
                      </div>
                      {canEditSkills && (
                        <button type="button" onClick={() => handleRemoveAchievement(ach.id)} style={{ background: '#fee2e2', color: '#dc2626', border: 'none', padding: '6px 10px', borderRadius: '6px', cursor: 'pointer', fontWeight: '800', fontSize: '12px' }}>
                          Delete
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: CONTACT & PERSONAL PROFILE */}
          {activeModalTab === 'profile' && (
            <form onSubmit={handleSaveProfileDetails} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', background: '#f8fafc', padding: '14px', borderRadius: '12px', border: '1px solid #cbd5e1' }}>
                <ProfileAvatar name={formData.firstName} code={student.adNo} photoUrl={formData.photoUrl} size={64} />
                <div>
                  <label style={styles.label}>Update Student Profile Photo:</label>
                  <input type="file" accept="image/*" onChange={handlePhotoUpload} style={{ fontSize: '13px' }} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
                <div>
                  <label style={styles.label}>Student Full Name:</label>
                  <input type="text" value={formData.firstName} onChange={e => setFormData({ ...formData, firstName: e.target.value })} style={styles.input} />
                </div>
                <div>
                  <label style={styles.label}>Student WhatsApp / Mobile:</label>
                  <input type="text" value={formData.whatsappNumber} onChange={e => setFormData({ ...formData, whatsappNumber: e.target.value })} placeholder="10-digit number" style={styles.input} />
                </div>
                <div>
                  <label style={styles.label}>Parent WhatsApp / Mobile:</label>
                  <input type="text" value={formData.parentWhatsapp} onChange={e => setFormData({ ...formData, parentWhatsapp: e.target.value })} placeholder="Parent 10-digit number" style={styles.input} />
                </div>
                <div>
                  <label style={styles.label}>Email Address:</label>
                  <input type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} placeholder="student@email.com" style={styles.input} />
                </div>
                <div>
                  <label style={styles.label}>State:</label>
                  <select value={formData.state} onChange={e => setFormData({ ...formData, state: e.target.value })} style={styles.input}>
                    {(INDIAN_STATES || ['Kerala', 'Karnataka', 'Bihar', 'Uttar Pradesh', 'West Bengal', 'Other']).map(st => (
                      <option key={st} value={st}>{st}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={styles.label}>District:</label>
                  <input type="text" value={formData.district} onChange={e => setFormData({ ...formData, district: e.target.value })} placeholder="e.g. Malappuram" style={styles.input} />
                </div>
                <div>
                  <label style={styles.label}>Madhab:</label>
                  <select value={formData.madhab} onChange={e => setFormData({ ...formData, madhab: e.target.value })} style={styles.input}>
                    <option value="SHAFI">SHAFI</option>
                    <option value="HANAFI">HANAFI</option>
                  </select>
                </div>
                <div>
                  <label style={styles.label}>Blood Group:</label>
                  <input type="text" value={formData.bloodGroup} onChange={e => setFormData({ ...formData, bloodGroup: e.target.value })} placeholder="e.g. O+" style={styles.input} />
                </div>
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

export function MentorAndOutreachTab({ students, teachers, loggedInTeacher, isAdmin = false, isOutreachView = false, onStudentUpdated }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCompletion, setFilterCompletion] = useState('All');
  const [filterConsultancyStatus, setFilterConsultancyStatus] = useState('All'); // 'All' | 'TargetMet' | 'BelowTarget' | 'ZeroSittings' | 'Overdue30' | 'Escalated'
  const [editingStudent, setEditingStudent] = useState(null);
  const [modalInitialSection, setModalInitialSection] = useState('log');

  const [classPtaMessage, setClassPtaMessage] = useState('');
  const [ptaGroupLink, setPtaGroupLink] = useState('');

  // 🌟 Outreach Coordinator Top-Level View Switcher
  const [outreachActiveSubTab, setOutreachActiveSubTab] = useState('directory'); // 'dashboard' | 'usthads' | 'directory' | 'queue'
  const [inspectingUsthadUsername, setInspectingUsthadUsername] = useState('');

  const [outreachRoleFilter, setOutreachRoleFilter] = useState('All');
  const [outreachDeptFilter, setOutreachDeptFilter] = useState('All');
  const [outreachClassFilter, setOutreachClassFilter] = useState('All');

  // 🌟 Semester Minimum Consultancy Target State (Saved in Firestore systemCache/mentorshipConfig)
  const [semesterTargetConfig, setSemesterTargetConfig] = useState({
    semesterName: 'Current Semester',
    minConsultations: 3,
    targetDeadline: '',
    guidelinesNote: 'Every Mentor Usthad must conduct at least 3 structured 1-on-1 sittings per mentee this semester.'
  });
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  // 🌟 Bulk Mentor & Bulk Skill Assignment State
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

  // Load Semester Minimum Consultancy Config from Firebase
  useEffect(() => {
    getDoc(doc(db, 'systemCache', 'mentorshipConfig')).then(snap => {
      if (snap.exists()) {
        setSemesterTargetConfig(prev => ({ ...prev, ...snap.data() }));
      }
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
      alert(`✅ Semester Minimum Consultancy Target set to ${cleanMin} sittings per mentee!`);
    } catch (err) {
      alert('Failed to save target: ' + err.message);
    } finally {
      setIsSavingConfig(false);
    }
  };

  // Helper: Get student's consultation metrics
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

    return {
      logs,
      count,
      minReq,
      metTarget,
      latestLog,
      lastDateStr,
      daysSinceLast,
      isOverdue30,
      isEscalated
    };
  };

  const isStudentMyMentee = (st) => {
    const stMentorUser = String(st.mentorUsername || '').trim().toLowerCase();
    const stMentorName = String(st.mentorName || '').trim().toLowerCase();
    return (myUsername && stMentorUser === myUsername) || (myFullNameLower && stMentorName === myFullNameLower);
  };

  const isStudentInMyClass = (st) => {
    const stClasses = Array.isArray(st.classes) ? st.classes : [st.class].filter(Boolean);
    const normStClasses = stClasses.map(c => normalizeCls(c));
    const matchesClassList = myClassTeacherOf.some(c => normStClasses.includes(normalizeCls(c)));
    const matchesCTUser = myUsername && String(st.classTeacherUsername || '').trim().toLowerCase() === myUsername;
    return matchesClassList || matchesCTUser;
  };

  const isStudentMyNiics = (st) => {
    const isUrduStudent = String(st.adNo || '').trim().toUpperCase().startsWith('U');
    return isNiicsCoord && isUrduStudent;
  };

  const classStudentsList = students.filter(isStudentInMyClass);
  const menteeStudentsList = students.filter(isStudentMyMentee);
  const niicsStudentsList = students.filter(isStudentMyNiics);

  const hasClassDuty = myClassTeacherOf.length > 0 || classStudentsList.length > 0;
  const hasMentorDuty = Boolean(priv.isMentor) || menteeStudentsList.length > 0;

  // 🌟 Build Duty-Based Tabs for Regular Teachers (Shows both ONLY if teacher has both duties!)
  const availableDutyTabs = [];
  if (!isAdmin && !isOutreachView) {
    if (hasClassDuty) {
      availableDutyTabs.push({
        id: 'CLASS',
        label: `🏫 Class ${myClassTeacherOf.join(', ') || ''} Students (${classStudentsList.length})`
      });
    }
    if (hasMentorDuty) {
      availableDutyTabs.push({
        id: 'MENTEES',
        label: `🧭 My Mentees (${menteeStudentsList.length})`
      });
    }
    if (isNiicsCoord) {
      availableDutyTabs.push({
        id: 'NIICS',
        label: `🎓 NIICS Urdu Students (${niicsStudentsList.length})`
      });
    }
    if (availableDutyTabs.length > 1) {
      const combinedCount = students.filter(st => isStudentInMyClass(st) || isStudentMyMentee(st) || isStudentMyNiics(st)).length;
      availableDutyTabs.push({
        id: 'ALL',
        label: `👥 Combined View (${combinedCount})`
      });
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

  // Scope students
  const scopedStudents = students.filter(st => {
    if (isAdmin || isOutreachView) {
      if (inspectingUsthadUsername) {
        return String(st.mentorUsername || '').toLowerCase() === inspectingUsthadUsername.toLowerCase();
      }
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
  const completeScope = scopedStudents.filter(s => computeStudentProfileCompletion(s).isComplete).length;
  const targetMetCount = scopedStudents.filter(s => getStudentConsultancyMetrics(s).metTarget).length;
  const belowTargetCount = totalScope - targetMetCount;
  const overdue30Count = scopedStudents.filter(s => getStudentConsultancyMetrics(s).isOverdue30).length;
  const escalatedCount = scopedStudents.filter(s => getStudentConsultancyMetrics(s).isEscalated).length;
  const totalSittingsLoggedInScope = scopedStudents.reduce((acc, s) => acc + getStudentConsultancyMetrics(s).count, 0);

  // 🌟 Build Usthad-Wise Consultancy Audit Summary (For Outreach Coordinator & Admin)
  const usthadAuditRows = teachers.map(t => {
    const tUserLower = String(t.username || '').toLowerCase();
    const tMentees = students.filter(s => String(s.mentorUsername || '').toLowerCase() === tUserLower);
    const totalMentees = tMentees.length;
    let metTargetMentees = 0;
    let zeroSittingMentees = 0;
    let totalSessions = 0;
    let latestSittingDate = '';

    tMentees.forEach(m => {
      const cm = getStudentConsultancyMetrics(m);
      totalSessions += cm.count;
      if (cm.metTarget) metTargetMentees++;
      if (cm.count === 0) zeroSittingMentees++;
      if (cm.lastDateStr && (!latestSittingDate || cm.lastDateStr > latestSittingDate)) {
        latestSittingDate = cm.lastDateStr;
      }
    });

    const targetCompletionPct = totalMentees > 0 ? Math.round((metTargetMentees / totalMentees) * 100) : 0;

    return {
      teacher: t,
      totalMentees,
      metTargetMentees,
      pendingTargetMentees: totalMentees - metTargetMentees,
      zeroSittingMentees,
      totalSessions,
      latestSittingDate,
      targetCompletionPct,
      menteesList: tMentees
    };
  }).filter(row => row.totalMentees > 0 || row.teacher.outpassPrivileges?.isMentor);

  // Bulk Assign Mentor
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
          if (found) {
            onStudentUpdated({ ...found, mentorUsername: newMentorUser, mentorName: newMentorName });
          }
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

  // 🌟 Bulk Assign Skill Tag to Selected Students
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

  const handleSingleStudentMentorChange = async (student, newMentorUsername) => {
    const mentorObj = teachers.find(t => t.username === newMentorUsername);
    const updatedUser = mentorObj ? mentorObj.username : '';
    const updatedName = mentorObj ? mentorObj.fullName : '';

    try {
      await setDoc(doc(db, 'students', String(student.regNo).toLowerCase()), {
        mentorUsername: updatedUser,
        mentorName: updatedName
      }, { merge: true });

      if (onStudentUpdated) {
        onStudentUpdated({ ...student, mentorUsername: updatedUser, mentorName: updatedName });
      }
    } catch (err) {
      alert('Error updating mentor: ' + err.message);
    }
  };

  const toggleSelectAllDisplayed = () => {
    const displayedRegs = displayStudents.map(s => s.regNo);
    const allChecked = displayedRegs.length > 0 && displayedRegs.every(r => selectedStudentRegs.includes(r));
    if (allChecked) {
      setSelectedStudentRegs(prev => prev.filter(r => !displayedRegs.includes(r)));
    } else {
      setSelectedStudentRegs(prev => Array.from(new Set([...prev, ...displayedRegs])));
    }
  };

  const cardContainerStyle = {
    background: '#ffffff',
    padding: '26px',
    borderRadius: '16px',
    boxShadow: '0 4px 20px rgba(15, 23, 42, 0.04)',
    border: '1px solid #cbd5e1',
    marginBottom: '24px'
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

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

      <div style={cardContainerStyle}>

        {/* 🌟 1. OUTREACH COORDINATOR & ADMIN: 4-TAB COMMAND NAVIGATION */}
        {canManageMentorAssignments && (isAdmin || isOutreachView) && (
          <div style={{ display: 'flex', gap: '10px', background: '#0f172a', padding: '10px', borderRadius: '14px', flexWrap: 'wrap', marginBottom: '22px' }}>
            {[
              { id: 'dashboard', label: '📊 1. Outreach Command & Target Setter' },
              { id: 'usthads', label: `👨‍🏫 2. Usthad-Wise Consultancy Audit (${usthadAuditRows.length})` },
              { id: 'directory', label: `👥 3. Student Directory, Skills & Bulk Assign (${students.length})` },
              { id: 'queue', label: `🚨 4. Pending Target & Escalated Queue (${belowTargetCount})` }
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setOutreachActiveSubTab(tab.id);
                  if (tab.id !== 'directory') setInspectingUsthadUsername('');
                }}
                style={{
                  flex: '1 1 210px',
                  padding: '12px 14px',
                  borderRadius: '10px',
                  border: 'none',
                  fontWeight: '800',
                  fontSize: '13px',
                  cursor: 'pointer',
                  background: outreachActiveSubTab === tab.id ? '#00897b' : 'rgba(255,255,255,0.1)',
                  color: '#ffffff'
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {/* 🌟 2. REGULAR TEACHER SUB-TAB SWITCHER (ONLY SHOWN IF TEACHER HAS BOTH CLASS & MENTOR DUTIES) */}
        {!isAdmin && !isOutreachView && availableDutyTabs.length > 1 && (
          <div style={{ display: 'flex', gap: '10px', background: '#f1f5f9', padding: '8px', borderRadius: '12px', flexWrap: 'wrap', marginBottom: '20px', border: '1px solid #cbd5e1' }}>
            {availableDutyTabs.map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setTeacherViewMode(tab.id)}
                style={{
                  flex: '1 1 200px',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  border: teacherViewMode === tab.id ? '2px solid #0f766e' : '1px solid transparent',
                  fontWeight: '800',
                  fontSize: '13px',
                  cursor: 'pointer',
                  background: teacherViewMode === tab.id ? '#00897b' : '#ffffff',
                  color: teacherViewMode === tab.id ? '#ffffff' : '#0f172a'
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {/* SEMESTER TARGET BANNER (VISIBLE TO ALL MENTORS & COORDINATORS) */}
        <div style={{ background: '#fffbeb', border: '1.5px solid #f59e0b', padding: '14px 18px', borderRadius: '12px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <span style={{ background: '#d97706', color: '#ffffff', padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: '900', textTransform: 'uppercase' }}>
              🎯 {semesterTargetConfig.semesterName || 'Semester'} Consultancy Mandate
            </span>
            <div style={{ fontSize: '14px', fontWeight: '800', color: '#78350f', marginTop: '4px' }}>
              Minimum Required Consultations: <strong>{semesterTargetConfig.minConsultations} Sittings per Mentee</strong>
              {semesterTargetConfig.targetDeadline ? ` • Target Deadline: ${semesterTargetConfig.targetDeadline}` : ''}
            </div>
            {semesterTargetConfig.guidelinesNote && (
              <div style={{ fontSize: '12px', color: '#92400e', fontWeight: '600', marginTop: '2px' }}>
                {semesterTargetConfig.guidelinesNote}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '11px', fontWeight: '800', color: '#92400e' }}>TARGET ACHIEVED IN SCOPE</div>
              <div style={{ fontSize: '20px', fontWeight: '900', color: '#047857' }}>
                {targetMetCount} / {totalScope} Students ({totalScope > 0 ? Math.round((targetMetCount / totalScope) * 100) : 0}%)
              </div>
            </div>
          </div>
        </div>

        {/* ============================================================
            SUB-TAB 1: OUTREACH COMMAND DASHBOARD & SEMESTER TARGET SETTER
           ============================================================ */}
        {canManageMentorAssignments && (isAdmin || isOutreachView) && outreachActiveSubTab === 'dashboard' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* SEMESTER TARGET SETTER FORM */}
            <form onSubmit={handleSaveSemesterTargetConfig} style={{ background: '#f0fdfa', border: '2px solid #0d9488', padding: '20px', borderRadius: '14px' }}>
              <h4 style={{ margin: '0 0 6px 0', fontSize: '17px', fontWeight: '900', color: '#0f766e' }}>
                ⚙️ Fix Minimum Mentor-Mentee Consultancy Target for Semester
              </h4>
              <p style={{ margin: '0 0 14px 0', fontSize: '13px', color: '#334155', fontWeight: '600' }}>
                Set the minimum number of 1-on-1 sittings every Mentor Usthad must complete with each assigned mentee this semester.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', marginBottom: '14px' }}>
                <div>
                  <label style={styles.label}>Semester Title:</label>
                  <input
                    type="text"
                    value={semesterTargetConfig.semesterName}
                    onChange={e => setSemesterTargetConfig({ ...semesterTargetConfig, semesterName: e.target.value })}
                    placeholder="e.g. Odd Semester 2026-27"
                    style={styles.input}
                  />
                </div>
                <div>
                  <label style={styles.label}>Minimum Sittings per Mentee:</label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={semesterTargetConfig.minConsultations}
                    onChange={e => setSemesterTargetConfig({ ...semesterTargetConfig, minConsultations: Number(e.target.value) })}
                    style={{ ...styles.input, fontWeight: '900', color: '#0f766e' }}
                  />
                </div>
                <div>
                  <label style={styles.label}>Semester Target Deadline:</label>
                  <input
                    type="date"
                    value={semesterTargetConfig.targetDeadline || ''}
                    onChange={e => setSemesterTargetConfig({ ...semesterTargetConfig, targetDeadline: e.target.value })}
                    style={styles.input}
                  />
                </div>
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label style={styles.label}>Coordinator Instructions / Guidelines for Mentors:</label>
                <input
                  type="text"
                  value={semesterTargetConfig.guidelinesNote || ''}
                  onChange={e => setSemesterTargetConfig({ ...semesterTargetConfig, guidelinesNote: e.target.value })}
                  placeholder="Instructions displayed on every Mentor's dashboard..."
                  style={styles.input}
                />
              </div>

              <button type="submit" disabled={isSavingConfig} style={styles.buttonPrimary}>
                {isSavingConfig ? 'Saving Target...' : '💾 Save Semester Minimum Consultancy Target'}
              </button>
            </form>

            {/* COMMAND KPI CARDS */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '16px' }}>
              <div style={{ padding: '18px', borderRadius: '12px', background: '#f8fafc', border: '1px solid #cbd5e1', textAlign: 'center' }}>
                <span style={{ fontSize: '11px', fontWeight: '800', color: '#64748b' }}>TOTAL SITTINGS LOGGED</span>
                <div style={{ fontSize: '30px', fontWeight: '900', color: '#0f172a', marginTop: '6px' }}>{totalSittingsLoggedInScope}</div>
              </div>
              <div style={{ padding: '18px', borderRadius: '12px', background: '#ecfdf5', border: '1px solid #a7f3d0', textAlign: 'center' }}>
                <span style={{ fontSize: '11px', fontWeight: '800', color: '#047857' }}>MET SEMESTER TARGET (&ge;{semesterTargetConfig.minConsultations})</span>
                <div style={{ fontSize: '30px', fontWeight: '900', color: '#059669', marginTop: '6px' }}>{targetMetCount}</div>
              </div>
              <div style={{ padding: '18px', borderRadius: '12px', background: '#fffbeb', border: '1px solid #fde68a', textAlign: 'center' }}>
                <span style={{ fontSize: '11px', fontWeight: '800', color: '#b45309' }}>BELOW TARGET (&lt;{semesterTargetConfig.minConsultations})</span>
                <div style={{ fontSize: '30px', fontWeight: '900', color: '#d97706', marginTop: '6px' }}>{belowTargetCount}</div>
              </div>
              <div style={{ padding: '18px', borderRadius: '12px', background: '#fee2e2', border: '1px solid #fecaca', textAlign: 'center' }}>
                <span style={{ fontSize: '11px', fontWeight: '800', color: '#991b1b' }}>NO SITTING IN 30+ DAYS</span>
                <div style={{ fontSize: '30px', fontWeight: '900', color: '#dc2626', marginTop: '6px' }}>{overdue30Count}</div>
              </div>
              <div style={{ padding: '18px', borderRadius: '12px', background: '#fef2f2', border: '2px solid #dc2626', textAlign: 'center' }}>
                <span style={{ fontSize: '11px', fontWeight: '900', color: '#dc2626' }}>🚨 ESCALATED CASES</span>
                <div style={{ fontSize: '30px', fontWeight: '900', color: '#dc2626', marginTop: '6px' }}>{escalatedCount}</div>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================
            SUB-TAB 2: USTHAD-WISE CONSULTANCY AUDIT & RELATIONSHIP TRACKER
           ============================================================ */}
        {canManageMentorAssignments && (isAdmin || isOutreachView) && outreachActiveSubTab === 'usthads' && (
          <div>
            <h4 style={{ margin: '0 0 6px 0', fontSize: '18px', fontWeight: '900', color: '#0f172a' }}>
              👨‍🏫 Individual Usthad Mentorship & Consultancy Progress Audit
            </h4>
            <p style={{ margin: '0 0 18px 0', fontSize: '13px', color: '#475569', fontWeight: '600' }}>
              Track how actively each Mentor Usthad is meeting his assigned mentees against the semester requirement of <strong>{semesterTargetConfig.minConsultations} sittings per mentee</strong>.
            </p>

            <div style={{ overflowX: 'auto', border: '1px solid #cbd5e1', borderRadius: '12px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px', minWidth: '880px' }}>
                <thead>
                  <tr style={{ background: '#0f172a', color: '#ffffff' }}>
                    <th style={{ padding: '14px 16px' }}>Mentor Usthad</th>
                    <th style={{ padding: '14px 16px', textAlign: 'center' }}>Assigned Mentees</th>
                    <th style={{ padding: '14px 16px', textAlign: 'center' }}>Total Sittings Held</th>
                    <th style={{ padding: '14px 16px', textAlign: 'center' }}>Met Target (&ge;{semesterTargetConfig.minConsultations})</th>
                    <th style={{ padding: '14px 16px', textAlign: 'center' }}>Never Met (0)</th>
                    <th style={{ padding: '14px 16px' }}>Semester Target Progress</th>
                    <th style={{ padding: '14px 16px', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {usthadAuditRows.map((row, idx) => (
                    <tr key={row.teacher.username} style={{ borderBottom: '1px solid #e2e8f0', background: idx % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                      <td style={{ padding: '14px 16px', fontWeight: '800', color: '#0f172a' }}>
                        {row.teacher.fullName}
                        <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '600' }}>
                          @{row.teacher.username} • Last Sitting: {row.latestSittingDate || 'None yet'}
                        </div>
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'center', fontWeight: '900', fontSize: '15px' }}>{row.totalMentees}</td>
                      <td style={{ padding: '14px 16px', textAlign: 'center', fontWeight: '800', color: '#0369a1', fontSize: '15px' }}>{row.totalSessions}</td>
                      <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                        <span style={{ background: '#dcfce7', color: '#166534', padding: '4px 10px', borderRadius: '6px', fontWeight: '800' }}>
                          {row.metTargetMentees} / {row.totalMentees}
                        </span>
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                        <span style={{ background: row.zeroSittingMentees > 0 ? '#fee2e2' : '#f1f5f9', color: row.zeroSittingMentees > 0 ? '#dc2626' : '#64748b', padding: '4px 10px', borderRadius: '6px', fontWeight: '800' }}>
                          {row.zeroSittingMentees}
                        </span>
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{ width: '110px', height: '8px', background: '#e2e8f0', borderRadius: '999px', overflow: 'hidden' }}>
                            <div style={{ width: `${row.targetCompletionPct}%`, height: '100%', background: row.targetCompletionPct >= 80 ? '#10b981' : row.targetCompletionPct >= 40 ? '#f59e0b' : '#ef4444' }} />
                          </div>
                          <span style={{ fontWeight: '800', fontSize: '13px' }}>{row.targetCompletionPct}%</span>
                        </div>
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            onClick={() => {
                              setInspectingUsthadUsername(row.teacher.username);
                              setOutreachActiveSubTab('directory');
                            }}
                            style={{ padding: '8px 12px', background: '#0f766e', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '800', fontSize: '12px', cursor: 'pointer' }}
                          >
                            🔍 Inspect Mentees ({row.totalMentees})
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              openDirectWhatsApp(
                                row.teacher.whatsappNumber || row.teacher.mobileNumber,
                                `Assalamu Alaikum Usthad ${row.teacher.fullName}, gentle reminder from DHIU Outreach Desk: For ${semesterTargetConfig.semesterName}, the minimum consultancy target is ${semesterTargetConfig.minConsultations} sittings per mentee. Currently ${row.metTargetMentees}/${row.totalMentees} of your mentees have completed this target. Please log your upcoming sittings on the portal.`
                              )
                            }
                            style={{ padding: '8px 12px', background: '#dcfce7', color: '#166534', border: 'none', borderRadius: '8px', fontWeight: '800', fontSize: '12px', cursor: 'pointer' }}
                          >
                            💬 WA Nudge
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ============================================================
            SUB-TAB 3 & 4 (OR REGULAR TEACHER VIEW): STUDENT DIRECTORY & ACTION QUEUE
           ============================================================ */}
        {((!isAdmin && !isOutreachView) || outreachActiveSubTab === 'directory' || outreachActiveSubTab === 'queue') && (
          <>
            {inspectingUsthadUsername && (
              <div style={{ background: '#e0f2fe', border: '2px solid #0284c7', padding: '12px 16px', borderRadius: '10px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: '800', color: '#0369a1', fontSize: '14px' }}>
                  🔍 Inspecting Mentees Assigned to: <strong>{teachers.find(t => t.username === inspectingUsthadUsername)?.fullName || inspectingUsthadUsername}</strong> ({scopedStudents.length} Mentees)
                </span>
                <button
                  type="button"
                  onClick={() => setInspectingUsthadUsername('')}
                  style={{ background: '#0284c7', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '6px', fontWeight: '800', cursor: 'pointer', fontSize: '12px' }}
                >
                  ✕ Show All Students
                </button>
              </div>
            )}

            {/* OUTREACH COORDINATOR & ADMIN: BULK MENTOR & BULK SKILL ASSIGNMENT PANEL */}
            {canManageMentorAssignments && (isAdmin || isOutreachView) && outreachActiveSubTab === 'directory' && (
              <div style={{ background: '#f0fdfa', border: '2px solid #0d9488', padding: '16px', borderRadius: '12px', marginBottom: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ fontWeight: '800', color: '#0f766e', fontSize: '14px' }}>
                    🧭 Outreach Coordinator Desk: Bulk Assign Mentor OR Bulk Add Skill ({selectedStudentRegs.length} Selected)
                  </div>
                  <button
                    type="button"
                    onClick={toggleSelectAllDisplayed}
                    style={{ background: '#ffffff', color: '#0f766e', border: '1.5px solid #0d9488', padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: '800', cursor: 'pointer' }}
                  >
                    ☑️ Select / Deselect Visible ({displayStudents.length})
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px' }}>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <select
                      value={targetMentorUsername}
                      onChange={(e) => setTargetMentorUsername(e.target.value)}
                      style={{ ...styles.input, flex: 1, borderColor: '#0d9488', fontWeight: '700' }}
                    >
                      <option value="">-- Select Mentor Usthad --</option>
                      <option value="__UNASSIGN__">❌ Unassign / Clear Mentor</option>
                      {teachers.map(t => (
                        <option key={t.username} value={t.username}>
                          {t.fullName} (@{t.username})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={isAssigningMentor}
                      onClick={handleBulkAssignMentor}
                      style={{ background: '#0d9488', color: '#ffffff', border: 'none', padding: '10px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: '800', cursor: 'pointer', whiteSpace: 'nowrap' }}
                    >
                      🚀 Assign Mentor
                    </button>
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      placeholder="Type skill (e.g. Debate, Calligraphy)..."
                      value={bulkSkillInput}
                      onChange={e => setBulkSkillInput(e.target.value)}
                      style={{ ...styles.input, flex: 1, borderColor: '#0284c7' }}
                    />
                    <button
                      type="button"
                      disabled={isAssigningMentor}
                      onClick={handleBulkAssignSkill}
                      style={{ background: '#0284c7', color: '#ffffff', border: 'none', padding: '10px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: '800', cursor: 'pointer', whiteSpace: 'nowrap' }}
                    >
                      🏆 + Bulk Skill
                    </button>
                  </div>
                </div>

                {mentorAssignStatus && (
                  <div style={{ padding: '10px 14px', background: '#dcfce7', color: '#166534', borderRadius: '8px', fontWeight: '800', fontSize: '13px' }}>
                    {mentorAssignStatus}
                  </div>
                )}
              </div>
            )}

            {/* CLASS TEACHER WHATSAPP PTA BROADCAST BAR */}
            {(!isAdmin && !isOutreachView && myClassTeacherOf.length > 0 && (teacherViewMode === 'CLASS' || teacherViewMode === 'ALL')) && (
              <div style={{ background: '#f0fdf4', border: '2px solid #22c55e', padding: '16px', borderRadius: '12px', marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '12px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: '800', color: '#166534', fontSize: '14px', marginBottom: '4px' }}>
                      👨‍👩‍👦 Class {myClassTeacherOf[0]} PTA / Parents WhatsApp Group Broadcast
                    </div>
                  </div>
                  <button type="button" onClick={savePtaGroupLink} style={{ background: '#ffffff', color: '#059669', border: '1px solid #10b981', padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: '800', cursor: 'pointer' }}>
                    🔗 Set Class {myClassTeacherOf[0]} WhatsApp Group Link
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    placeholder={`Type message for Class ${myClassTeacherOf[0]} PTA / Parents Group...`}
                    value={classPtaMessage}
                    onChange={(e) => setClassPtaMessage(e.target.value)}
                    style={{ ...styles.input, flex: '1 1 200px', borderColor: '#86efac' }}
                  />
                  <button type="button" onClick={openPtaGroupAndSend} style={{ background: '#16a34a', color: '#ffffff', border: 'none', padding: '10px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: '800', cursor: 'pointer' }}>
                    💬 Open Class {myClassTeacherOf[0]} PTA Group &amp; Send
                  </button>
                </div>
              </div>
            )}

            {/* SEARCH & CONSULTANCY FILTERS */}
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '18px', background: '#f8fafc', padding: '12px', borderRadius: '10px', border: '1px solid #cbd5e1' }}>
              <input type="text" placeholder="Search student name, Ad.No, or district..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} style={{ ...styles.input, flex: '1 1 200px' }} />

              <select value={filterConsultancyStatus} onChange={(e) => setFilterConsultancyStatus(e.target.value)} style={{ ...styles.input, flex: '1 1 210px', borderColor: '#0f766e', fontWeight: '800' }}>
                <option value="All">All Consultancy Statuses</option>
                <option value="TargetMet">✅ Met Semester Target (&ge;{semesterTargetConfig.minConsultations})</option>
                <option value="BelowTarget">⏳ Below Semester Target (&lt;{semesterTargetConfig.minConsultations})</option>
                <option value="ZeroSittings">⚠️ Zero Sittings Logged (0)</option>
                <option value="Overdue30">🔴 Overdue (&gt;30 Days Since Sitting)</option>
                <option value="Escalated">🚨 Escalated Urgent Cases</option>
              </select>

              <select value={filterCompletion} onChange={(e) => setFilterCompletion(e.target.value)} style={{ ...styles.input, flex: '1 1 170px' }}>
                <option value="All">All Profile Statuses</option>
                <option value="Incomplete">⚠️ Incomplete Profiles</option>
                <option value="Complete">✅ 100% Complete</option>
              </select>

              {(isAdmin || isOutreachView) && (
                <>
                  <select value={outreachClassFilter} onChange={(e) => setOutreachClassFilter(e.target.value)} style={{ ...styles.input, flex: '1 1 130px' }}>
                    <option value="All">All Classes</option>
                    {DEFAULT_CLASSES.map(c => <option key={c} value={c}>Class {c}</option>)}
                  </select>
                  <select value={outreachRoleFilter} onChange={(e) => setOutreachRoleFilter(e.target.value)} style={{ ...styles.input, flex: '1 1 160px' }}>
                    <option value="All">All Mentor Status</option>
                    <option value="Mentors Assigned">✅ Mentor Assigned</option>
                    <option value="No Mentor">⚠️ No Mentor</option>
                  </select>
                </>
              )}
            </div>

            {/* MAIN STUDENT CONSULTANCY & PORTFOLIO TABLE */}
            <div style={{ overflowX: 'auto', border: '1px solid #cbd5e1', borderRadius: '12px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px', minWidth: '1020px' }}>
                <thead>
                  <tr style={{ background: '#0f172a', color: '#ffffff' }}>
                    {canManageMentorAssignments && (isAdmin || isOutreachView) && (
                      <th style={{ padding: '14px 12px', width: '40px' }}>
                        <input
                          type="checkbox"
                          checked={displayStudents.length > 0 && displayStudents.every(s => selectedStudentRegs.includes(s.regNo))}
                          onChange={toggleSelectAllDisplayed}
                        />
                      </th>
                    )}
                    <th style={{ padding: '14px 16px', fontWeight: '800' }}>Student &amp; Ad.No</th>
                    <th style={{ padding: '14px 16px', fontWeight: '800' }}>Class &amp; Mentor</th>
                    <th style={{ padding: '14px 16px', fontWeight: '800' }}>Consultancy Progress (Target: {semesterTargetConfig.minConsultations})</th>
                    <th style={{ padding: '14px 16px', fontWeight: '800' }}>Skills &amp; Profile</th>
                    <th style={{ padding: '14px 16px', fontWeight: '800' }}>Contact Details</th>
                    <th style={{ padding: '14px 16px', fontWeight: '800', textAlign: 'right' }}>Quick Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {displayStudents.map((st, idx) => {
                    const comp = computeStudentProfileCompletion(st);
                    const cMetrics = getStudentConsultancyMetrics(st);
                    const isUrdu = String(st.adNo || '').toUpperCase().startsWith('U');
                    const autoCT = resolveClassTeacherForStudent(st, teachers);
                    const actualMentor = teachers.find(t => String(t.username || '').toLowerCase() === String(st.mentorUsername || '').toLowerCase());
                    const isChecked = selectedStudentRegs.includes(st.regNo);
                    const stSkills = Array.isArray(st.skills) ? st.skills : [];
                    const stAch = Array.isArray(st.achievements) ? st.achievements : [];

                    // In Queue mode, only show students below target or escalated
                    if (outreachActiveSubTab === 'queue' && cMetrics.metTarget && !cMetrics.isEscalated) {
                      return null;
                    }

                    return (
                      <tr key={st.regNo} style={{ borderBottom: '1px solid #e2e8f0', background: isChecked ? '#ccfbf1' : cMetrics.isEscalated ? '#fef2f2' : idx % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                        {canManageMentorAssignments && (isAdmin || isOutreachView) && (
                          <td style={{ padding: '14px 12px' }}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() =>
                                setSelectedStudentRegs(prev =>
                                  prev.includes(st.regNo) ? prev.filter(r => r !== st.regNo) : [...prev, st.regNo]
                                )
                              }
                            />
                          </td>
                        )}
                        <td style={{ padding: '14px 16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <ProfileAvatar name={st.firstName} code={st.adNo} photoUrl={st.photoUrl} size={42} onClick={() => { setModalInitialSection('log'); setEditingStudent(st); }} />
                            <div>
                              <div style={{ fontWeight: '800', color: '#0f172a', fontSize: '15px' }}>{st.firstName}</div>
                              <div style={{ fontSize: '12px', color: '#475569', fontWeight: '700' }}>Ad.No: #{st.adNo} • Reg: {st.regNo}</div>
                              {isUrdu && <span style={{ ...styles.badge, background: '#fef3c7', color: '#b45309', marginTop: '4px' }}>URDU</span>}
                            </div>
                          </div>
                        </td>

                        <td style={{ padding: '14px 16px', fontSize: '12px', fontWeight: '800' }}>
                          <div style={{ fontSize: '13px', marginBottom: '4px', color: '#0f172a' }}>{(st.classes || []).join(', ')} ({st.department || 'GENERAL'})</div>
                          {canManageMentorAssignments && (isAdmin || isOutreachView) ? (
                            <select
                              value={st.mentorUsername || ''}
                              onChange={(e) => handleSingleStudentMentorChange(st, e.target.value)}
                              style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #0d9488', fontSize: '12px', fontWeight: '700', background: '#ffffff', color: '#0f172a', maxWidth: '185px', marginBottom: '4px' }}
                            >
                              <option value="">⚠️ Unassigned</option>
                              {teachers.map(t => (
                                <option key={t.username} value={t.username}>{t.fullName}</option>
                              ))}
                            </select>
                          ) : (
                            <div style={{ color: '#0f766e', marginBottom: '2px' }}>
                              🧭 Mentor: {actualMentor ? actualMentor.fullName : (st.mentorName || 'Unassigned')}
                            </div>
                          )}
                          <div style={{ color: '#1d4ed8' }}>🏫 CT: {autoCT ? autoCT.fullName : (st.classTeacherUsername || 'Unassigned')}</div>
                        </td>

                        {/* CONSULTANCY PROGRESS COLUMN */}
                        <td style={{ padding: '14px 16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                            <span style={{
                              background: cMetrics.metTarget ? '#dcfce7' : cMetrics.count > 0 ? '#fef3c7' : '#fee2e2',
                              color: cMetrics.metTarget ? '#166534' : cMetrics.count > 0 ? '#92400e' : '#991b1b',
                              padding: '4px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: '900'
                            }}>
                              {cMetrics.metTarget ? '✅' : '⏳'} {cMetrics.count} / {cMetrics.minReq} Sittings
                            </span>
                            {cMetrics.isEscalated && (
                              <span style={{ background: '#dc2626', color: '#fff', padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: '900' }}>
                                🚨 URGENT
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '11px', color: '#475569', fontWeight: '700' }}>
                            {cMetrics.lastDateStr
                              ? `Last met: ${cMetrics.lastDateStr} (${cMetrics.daysSinceLast}d ago)`
                              : '⚠️ No sitting logged yet'}
                          </div>
                          {cMetrics.latestLog?.summary && (
                            <div style={{ fontSize: '11px', color: '#0f766e', fontWeight: '700', marginTop: '3px', maxWidth: '230px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              💬 "{cMetrics.latestLog.summary}"
                            </div>
                          )}
                        </td>

                        {/* SKILLS & PROFILE COMPLETION COLUMN */}
                        <td style={{ padding: '14px 16px' }}>
                          <div style={{ fontSize: '12px', fontWeight: '800', color: '#0f172a', marginBottom: '4px' }}>
                            🌟 {stSkills.length} Skills • 🏅 {stAch.length} Awards
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <div style={{ width: '90px', height: '7px', background: '#e2e8f0', borderRadius: '999px', overflow: 'hidden' }}>
                              <div style={{ width: `${comp.pct}%`, height: '100%', background: comp.isComplete ? '#10b981' : '#f59e0b' }} />
                            </div>
                            <span style={{ fontSize: '11px', fontWeight: '800', color: '#475569' }}>{comp.pct}% Profile</span>
                          </div>
                        </td>

                        <td style={{ padding: '14px 16px', fontSize: '12px', color: '#334155', fontWeight: '600' }}>
                          <div>📱 St: {st.whatsappNumber || st.mobileNumber || '—'}</div>
                          <div>👨‍👩‍👦 Par: {st.parentWhatsapp || st.parentMobile || '—'}</div>
                          <div style={{ color: '#64748b' }}>📍 {st.district || '—'}</div>
                        </td>

                        <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              onClick={() => { setModalInitialSection('log'); setEditingStudent(st); }}
                              style={{ padding: '8px 12px', background: '#0f766e', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '800', fontSize: '12px' }}
                            >
                              📝 Log Sitting ({cMetrics.count})
                            </button>
                            <button
                              type="button"
                              onClick={() => { setModalInitialSection('skills'); setEditingStudent(st); }}
                              style={{ padding: '8px 12px', background: '#0284c7', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '800', fontSize: '12px' }}
                            >
                              🏆 + Skill / Award
                            </button>
                            <button
                              type="button"
                              onClick={() => openDirectWhatsApp(st.parentWhatsapp || st.parentMobile, `Assalamu Alaikum, official message regarding ${st.firstName} (#${st.adNo}) from DHIU Mentor/Outreach Desk:`)}
                              style={{ padding: '8px 10px', background: '#dcfce7', color: '#166534', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '800', fontSize: '12px' }}
                            >
                              💬 WA
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}