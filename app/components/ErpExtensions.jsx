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

export function doesClassMatchAlias(studentClasses = [], envTargetClass = '', envAlias = '', envGrade = '') {
  const classesUpper = studentClasses.map(c => String(c || '').trim().toUpperCase());
  const targetUpper = String(envTargetClass || '').trim().toUpperCase();
  const aliasUpper = String(envAlias || '').trim().toUpperCase();
  const gradeStr = String(envGrade || '').trim();

  if (targetUpper && classesUpper.includes(targetUpper)) return true;
  if (classesUpper.some(cls => aliasUpper.includes(cls))) return true;

  const hasQH1 = classesUpper.includes('QH1');
  const hasAL1 = classesUpper.includes('AL1');
  const hasFC1 = classesUpper.includes('FC1');
  const hasQH2 = classesUpper.includes('QH2');
  const hasAL2 = classesUpper.includes('AL2');
  const hasFC2 = classesUpper.includes('FC2');
  const hasGrade3 = classesUpper.includes('QLA3') || classesUpper.includes('HFC3') || classesUpper.some(c => c.includes('3'));
  const hasGrade2 = hasQH2 || hasAL2 || hasFC2 || classesUpper.some(c => c.includes('2'));
  const hasGrade1 = hasQH1 || hasAL1 || hasFC1 || classesUpper.some(c => c.includes('1'));

  if (aliasUpper.includes('QHA1') && (hasQH1 || hasAL1)) return true;
  if (aliasUpper.includes('FCL1') && (hasFC1 || hasAL1)) return true;
  if (aliasUpper.includes('QHF1') && (hasQH1 || hasFC1)) return true;
  if (aliasUpper.includes('ALC1') && (hasAL1 || hasFC1)) return true;

  if (aliasUpper.includes('QHA2') && (hasQH2 || hasAL2)) return true;
  if (aliasUpper.includes('FCL2') && (hasFC2 || hasAL2)) return true;
  if (aliasUpper.includes('QHF2') && (hasQH2 || hasFC2)) return true;
  if (aliasUpper.includes('ALC2') && (hasAL2 || hasFC2)) return true;

  if ((aliasUpper.includes('M10') || aliasUpper.includes('U10') || gradeStr === '3') && hasGrade3) return true;
  if ((aliasUpper.includes('M9') || aliasUpper.includes('U9') || gradeStr === '2') && hasGrade2) return true;
  if ((aliasUpper.includes('M8') || aliasUpper.includes('U8') || gradeStr === '1') && hasGrade1) return true;

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

// ============================================================================
// 🏆 7. 360° STUDENT PORTFOLIO, CONTACT EDITOR (WITH DYNAMIC DISTRICT) & LOGS
// ============================================================================
export function StudentPortfolioModal({
  student,
  canEditSkills = false,
  canViewConfidential = false,
  editorName = 'Faculty',
  onClose,
  onSaved
}) {
  const [activeTab, setActiveTab] = useState('contact');

  const [mobileNumber, setMobileNumber] = useState(student?.mobileNumber || '');
  const [whatsappNumber, setWhatsappNumber] = useState(student?.whatsappNumber || '');
  const [email, setEmail] = useState(student?.email || '');
  const [parentMobile, setParentMobile] = useState(student?.parentMobile || '');
  const [parentWhatsapp, setParentWhatsapp] = useState(student?.parentWhatsapp || '');
  const [state, setState] = useState(student?.state || 'Kerala');
  const [district, setDistrict] = useState(student?.district || 'Malappuram');
  const [photoUrl, setPhotoUrl] = useState(student?.photoUrl || '');

  const [skillsList, setSkillsList] = useState(Array.isArray(student?.skills) ? student.skills : []);
  const [newSkillInput, setNewSkillInput] = useState('');
  const [achievementsList, setAchievementsList] = useState(Array.isArray(student?.achievements) ? student.achievements : []);
  const [achTitle, setAchTitle] = useState('');
  const [achCategory, setAchCategory] = useState('Academic');
  const [achLevel, setAchLevel] = useState('Campus Level');
  const [achDate, setAchDate] = useState(new Date().toISOString().slice(0, 10));
  const [achNotes, setAchNotes] = useState('');

  const [economicBackground, setEconomicBackground] = useState(student?.economicBackground || '');
  const [familyDetails, setFamilyDetails] = useState(student?.familyDetails || '');
  const [behavioralNotes, setBehavioralNotes] = useState(student?.behavioralNotes || '');
  const [consultations, setConsultations] = useState(Array.isArray(student?.consultations) ? student.consultations : []);
  const [consultType, setConsultType] = useState('Academic & Personal');
  const [consultSummary, setConsultSummary] = useState('');
  const [consultActionPlan, setConsultActionPlan] = useState('');
  const [saving, setSaving] = useState(false);

  if (!student) return null;

  const liveCompletion = computeStudentProfileCompletion({
    ...student,
    photoUrl,
    mobileNumber,
    whatsappNumber,
    email,
    parentMobile,
    parentWhatsapp,
    state,
    district,
    skills: skillsList
  });

  const handleAddSkill = (skillStr) => {
    const val = (skillStr || newSkillInput).trim();
    if (!val) return;
    if (!skillsList.includes(val)) setSkillsList([...skillsList, val]);
    setNewSkillInput('');
  };

  const handleAddAchievement = (e) => {
    e.preventDefault();
    if (!achTitle.trim()) return alert("Please enter an achievement title.");
    const newItem = {
      id: Date.now().toString(),
      title: achTitle.trim(),
      category: achCategory,
      level: achLevel,
      date: achDate,
      notes: achNotes.trim(),
      addedBy: editorName
    };
    setAchievementsList([newItem, ...achievementsList]);
    setAchTitle('');
    setAchNotes('');
  };

  const handleAddConsultation = (e) => {
    e.preventDefault();
    if (!consultSummary.trim()) return alert("Please enter consultation notes.");
    const newLog = {
      id: Date.now().toString(),
      date: new Date().toISOString().slice(0, 10),
      type: consultType,
      summary: consultSummary.trim(),
      actionPlan: consultActionPlan.trim(),
      mentorName: editorName
    };
    setConsultations([newLog, ...consultations]);
    setConsultSummary('');
    setConsultActionPlan('');
  };

  const handleSavePortfolio = async () => {
    setSaving(true);
    try {
      const updatePayload = {
        mobileNumber: mobileNumber.trim(),
        whatsappNumber: (whatsappNumber || mobileNumber).trim(),
        email: email.trim(),
        parentMobile: parentMobile.trim(),
        parentWhatsapp: (parentWhatsapp || parentMobile).trim(),
        state,
        district: district.trim(),
        photoUrl: photoUrl || null,
        skills: skillsList,
        achievements: achievementsList,
        economicBackground: economicBackground.trim(),
        familyDetails: familyDetails.trim(),
        behavioralNotes: behavioralNotes.trim(),
        consultations
      };
      await setDoc(doc(db, 'students', student.regNo), updatePayload, { merge: true });
      if (onSaved) onSaved({ ...student, ...updatePayload });
      alert(`✅ Student profile & records saved for ${student.firstName}!`);
      onClose();
    } catch (err) {
      alert("Error saving records: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const boxInput = { width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1.5px solid #94a3b8', fontSize: '14px', color: '#0f172a', background: '#ffffff', boxSizing: 'border-box', fontWeight: '600' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '16px' }}>
      <div style={{ background: '#ffffff', borderRadius: '18px', maxWidth: '780px', width: '100%', maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 24px 48px rgba(0,0,0,0.35)' }}>
        <div style={{ background: 'linear-gradient(135deg, #00897b 0%, #0f766e 100%)', color: '#ffffff', padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <ProfileAvatar name={student.firstName} code={student.adNo} photoUrl={photoUrl} size={56} />
            <div>
              <div style={{ fontSize: '11px', fontWeight: '800', color: '#99f6e4', letterSpacing: '1px' }}>
                360° STUDENT PROFILE • COMPLETION: {liveCompletion.pct}%
              </div>
              <h3 style={{ margin: '2px 0 0', fontSize: '20px', fontWeight: '800', color: '#ffffff' }}>{student.firstName} (#{student.adNo})</h3>
              <div style={{ fontSize: '12px', color: '#ccfbf1', marginTop: '2px', fontWeight: '600' }}>
                Reg: {student.regNo} • Class: {(student.classes || []).join(', ')} • Dept: {student.department || 'GENERAL'}
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', border: 'none', borderRadius: '8px', width: '34px', height: '34px', cursor: 'pointer', fontWeight: '800' }}>✕</button>
        </div>

        <div style={{ display: 'flex', gap: '8px', padding: '12px 24px', background: '#f1f5f9', borderBottom: '1px solid #cbd5e1', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setActiveTab('contact')}
            style={{
              padding: '8px 16px', borderRadius: '8px', border: 'none', fontWeight: '800', fontSize: '13px', cursor: 'pointer',
              background: activeTab === 'contact' ? '#00897b' : '#ffffff',
              color: activeTab === 'contact' ? '#ffffff' : '#0f172a'
            }}
          >
            📞 Contact, Parents & Location ({liveCompletion.pct}%)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('skills')}
            style={{
              padding: '8px 16px', borderRadius: '8px', border: 'none', fontWeight: '800', fontSize: '13px', cursor: 'pointer',
              background: activeTab === 'skills' ? '#00897b' : '#ffffff',
              color: activeTab === 'skills' ? '#ffffff' : '#0f172a'
            }}
          >
            🏆 Skills & Achievements ({skillsList.length + achievementsList.length})
          </button>
          {canViewConfidential && (
            <button
              type="button"
              onClick={() => setActiveTab('mentor_records')}
              style={{
                padding: '8px 16px', borderRadius: '8px', border: 'none', fontWeight: '800', fontSize: '13px', cursor: 'pointer',
                background: activeTab === 'mentor_records' ? '#0f172a' : '#ffffff',
                color: activeTab === 'mentor_records' ? '#ffffff' : '#0f172a'
              }}
            >
              🔒 Mentor Consultation & Family Log ({consultations.length})
            </button>
          )}
        </div>

        <div style={{ padding: '22px' }}>
          {activeTab === 'contact' ? (
            <div>
              <div style={{ marginBottom: '16px', padding: '12px 16px', borderRadius: '10px', background: liveCompletion.isComplete ? '#ecfdf5' : '#fffbeb', border: `1px solid ${liveCompletion.isComplete ? '#a7f3d0' : '#fcd34d'}` }}>
                <div style={{ fontWeight: '800', fontSize: '13px', color: liveCompletion.isComplete ? '#047857' : '#b45309' }}>
                  {liveCompletion.isComplete
                    ? '✅ Profile is 100% Complete!'
                    : `⚠️ Profile is ${liveCompletion.pct}% Complete — Missing: ${liveCompletion.missing.join(', ')}`}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '14px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '800', marginBottom: '4px' }}>Student Phone Number</label>
                  <input type="text" value={mobileNumber} disabled={!canEditSkills} onChange={(e) => setMobileNumber(e.target.value)} placeholder="e.g. 9876543210" style={boxInput} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '800', marginBottom: '4px' }}>Student WhatsApp Number</label>
                  <input type="text" value={whatsappNumber} disabled={!canEditSkills} onChange={(e) => setWhatsappNumber(e.target.value)} placeholder="e.g. 9876543210" style={boxInput} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '800', marginBottom: '4px' }}>Student Email Address</label>
                  <input type="email" value={email} disabled={!canEditSkills} onChange={(e) => setEmail(e.target.value)} placeholder="student@gmail.com" style={boxInput} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '800', marginBottom: '4px' }}>Parent Mobile Number</label>
                  <input type="text" value={parentMobile} disabled={!canEditSkills} onChange={(e) => setParentMobile(e.target.value)} placeholder="e.g. 9876543211" style={boxInput} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '800', marginBottom: '4px' }}>Parent WhatsApp Number</label>
                  <input type="text" value={parentWhatsapp} disabled={!canEditSkills} onChange={(e) => setParentWhatsapp(e.target.value)} placeholder="e.g. 9876543211" style={boxInput} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '800', marginBottom: '4px' }}>State / Country</label>
                  <select
                    value={state}
                    disabled={!canEditSkills}
                    onChange={(e) => {
                      const nextState = e.target.value;
                      setState(nextState);
                      if (nextState === 'Kerala' && !KERALA_DISTRICTS.includes(district)) {
                        setDistrict('Malappuram');
                      } else if (nextState !== 'Kerala' && KERALA_DISTRICTS.includes(district)) {
                        setDistrict('');
                      }
                    }}
                    style={boxInput}
                  >
                    {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '800', marginBottom: '4px' }}>
                    {state === 'Kerala' ? 'District (Kerala)' : 'District / Province / City (Type)'}
                  </label>
                  {state === 'Kerala' ? (
                    <select value={district} disabled={!canEditSkills} onChange={(e) => setDistrict(e.target.value)} style={boxInput}>
                      {KERALA_DISTRICTS.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={district}
                      disabled={!canEditSkills}
                      onChange={(e) => setDistrict(e.target.value)}
                      placeholder="Type district, province, or city..."
                      style={boxInput}
                    />
                  )}
                </div>
                {canEditSkills && (
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: '800', marginBottom: '4px' }}>Update Student Photo</label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (f) setPhotoUrl(await compressImageFileToDataUrl(f, 180, 0.8));
                      }}
                      style={boxInput}
                    />
                  </div>
                )}
              </div>
            </div>
          ) : activeTab === 'skills' ? (
            <>
              <div style={{ marginBottom: '22px' }}>
                <h4 style={{ margin: '0 0 10px', fontSize: '15px', fontWeight: '800', color: '#0f172a' }}>🌟 Recognized Skills & Talents</h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                  {skillsList.length === 0 ? (
                    <span style={{ fontSize: '13px', color: '#475569', fontWeight: '600' }}>No skills recorded yet.</span>
                  ) : (
                    skillsList.map((sk, idx) => (
                      <span key={idx} style={{ background: '#f0fdfa', color: '#0f766e', border: '1.5px solid #0d9488', padding: '6px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: '800', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        ✦ {sk}
                        {canEditSkills && (
                          <button type="button" onClick={() => setSkillsList(skillsList.filter(s => s !== sk))} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontWeight: '900', padding: 0 }}>✕</button>
                        )}
                      </span>
                    ))
                  )}
                </div>

                {canEditSkills && (
                  <div>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                      <input
                        type="text"
                        placeholder="Add skill (e.g. Urdu Poetry, Debate, Calligraphy)..."
                        value={newSkillInput}
                        onChange={(e) => setNewSkillInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddSkill(); } }}
                        style={boxInput}
                      />
                      <button type="button" onClick={() => handleAddSkill()} style={{ padding: '10px 18px', background: '#00897b', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '800', whiteSpace: 'nowrap', cursor: 'pointer' }}>+ Add Skill</button>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {["Arabic Oratory", "Urdu Literature", "English Debate", "Hifz Mastery", "Calligraphy", "Research & Writing", "IT & Web Design", "Leadership"].map(preset => (
                        <button key={preset} type="button" onClick={() => handleAddSkill(preset)} style={{ background: '#f1f5f9', color: '#0f172a', border: '1px solid #94a3b8', borderRadius: '6px', padding: '4px 8px', fontSize: '11px', fontWeight: '700', cursor: 'pointer' }}>
                          + {preset}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <h4 style={{ margin: '0 0 10px', fontSize: '15px', fontWeight: '800', color: '#0f172a' }}>🏆 Achievements & Awards Log ({achievementsList.length})</h4>
                {canEditSkills && (
                  <form onSubmit={handleAddAchievement} style={{ background: '#f8fafc', padding: '14px', borderRadius: '12px', border: '1.5px solid #cbd5e1', marginBottom: '14px' }}>
                    <div style={{ fontSize: '12px', fontWeight: '800', color: '#00897b', marginBottom: '10px' }}>➕ LOG NEW ACHIEVEMENT</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px', marginBottom: '10px' }}>
                      <input type="text" placeholder="Achievement Title (e.g. 1st Prize Sibaq)" value={achTitle} onChange={(e) => setAchTitle(e.target.value)} style={boxInput} />
                      <select value={achCategory} onChange={(e) => setAchCategory(e.target.value)} style={boxInput}>
                        {["Academic", "Arts / Sibaq", "Oratory / Debate", "Publication / Research", "Sports", "Leadership / Service"].map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <select value={achLevel} onChange={(e) => setAchLevel(e.target.value)} style={boxInput}>
                        {["Campus Level", "Zone Level", "University / DHIU", "State Level", "National / International"].map(l => <option key={l} value={l}>{l}</option>)}
                      </select>
                      <input type="date" value={achDate} onChange={(e) => setAchDate(e.target.value)} style={boxInput} />
                    </div>
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <input type="text" placeholder="Additional notes or details..." value={achNotes} onChange={(e) => setAchNotes(e.target.value)} style={boxInput} />
                      <button type="submit" style={{ padding: '10px 18px', background: '#0284c7', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '800', whiteSpace: 'nowrap', cursor: 'pointer' }}>+ Add to Log</button>
                    </div>
                  </form>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '240px', overflowY: 'auto' }}>
                  {achievementsList.length === 0 ? (
                    <div style={{ padding: '20px', textAlign: 'center', background: '#f8fafc', borderRadius: '10px', color: '#475569', fontSize: '13px', fontWeight: '600' }}>
                      No achievements logged for this student yet.
                    </div>
                  ) : (
                    achievementsList.map((ach) => (
                      <div key={ach.id} style={{ padding: '12px 14px', borderRadius: '10px', border: '1px solid #cbd5e1', background: '#ffffff', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                        <div>
                          <div style={{ fontWeight: '800', color: '#0f172a', fontSize: '14px' }}>🏅 {ach.title}</div>
                          <div style={{ fontSize: '12px', color: '#334155', marginTop: '3px', fontWeight: '600' }}>
                            <span style={{ background: '#fef3c7', color: '#92400e', padding: '2px 6px', borderRadius: '4px', fontWeight: '800', marginRight: '6px' }}>{ach.category}</span>
                            <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '2px 6px', borderRadius: '4px', fontWeight: '800', marginRight: '6px' }}>{ach.level}</span>
                            <span>📅 {ach.date} • Recorded by <strong>{ach.addedBy}</strong></span>
                          </div>
                          {ach.notes && <div style={{ fontSize: '12px', color: '#1e293b', marginTop: '4px' }}>{ach.notes}</div>}
                        </div>
                        {canEditSkills && (
                          <button type="button" onClick={() => setAchievementsList(achievementsList.filter(a => a.id !== ach.id))} style={{ background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '6px', padding: '4px 8px', fontSize: '11px', fontWeight: '800', cursor: 'pointer' }}>Delete</button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          ) : (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginBottom: '18px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '800', color: '#0f172a', marginBottom: '4px' }}>🏠 Economic & Financial Background</label>
                  <textarea rows={2} value={economicBackground} onChange={(e) => setEconomicBackground(e.target.value)} placeholder="e.g. Middle class, scholarship recipient, father's occupation..." style={boxInput} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '800', color: '#0f172a', marginBottom: '4px' }}>👨‍👩‍👧 Family Details & Support</label>
                  <textarea rows={2} value={familyDetails} onChange={(e) => setFamilyDetails(e.target.value)} placeholder="Siblings, family educational background, guardian notes..." style={boxInput} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '800', color: '#0f172a', marginBottom: '4px' }}>📋 Behavioral & Character Observations</label>
                  <textarea rows={2} value={behavioralNotes} onChange={(e) => setBehavioralNotes(e.target.value)} placeholder="Punctuality, hostel conduct, special attention needed..." style={boxInput} />
                </div>
              </div>

              <form onSubmit={handleAddConsultation} style={{ background: '#f8fafc', padding: '14px', borderRadius: '12px', border: '1.5px solid #cbd5e1', marginBottom: '16px' }}>
                <div style={{ fontSize: '12px', fontWeight: '800', color: '#0f172a', marginBottom: '10px' }}>🗣️ LOG NEW MENTOR-MENTEE CONSULTATION / DIALOGUE</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '10px', marginBottom: '10px' }}>
                  <select value={consultType} onChange={(e) => setConsultType(e.target.value)} style={boxInput}>
                    <option value="Academic & CCE">Academic & CCE Review</option>
                    <option value="Personal & Wellbeing">Personal & Wellbeing</option>
                    <option value="Outreach & Career">Outreach & Career</option>
                    <option value="Family / Financial">Family / Financial</option>
                    <option value="Behavioral Guidance">Behavioral Guidance</option>
                  </select>
                  <input type="text" placeholder="Discussion Summary / Dialogue Notes..." value={consultSummary} onChange={(e) => setConsultSummary(e.target.value)} style={boxInput} />
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <input type="text" placeholder="Next Action Plan / Follow-up goal..." value={consultActionPlan} onChange={(e) => setConsultActionPlan(e.target.value)} style={boxInput} />
                  <button type="submit" style={{ padding: '10px 18px', background: '#0f172a', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '800', whiteSpace: 'nowrap', cursor: 'pointer' }}>+ Log Session</button>
                </div>
              </form>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '220px', overflowY: 'auto' }}>
                {consultations.length === 0 ? (
                  <div style={{ padding: '16px', textAlign: 'center', color: '#475569', background: '#f8fafc', borderRadius: '8px', fontSize: '13px', fontWeight: '600' }}>
                    No mentor consultations recorded yet.
                  </div>
                ) : (
                  consultations.map(c => (
                    <div key={c.id} style={{ padding: '12px', borderRadius: '10px', border: '1px solid #cbd5e1', background: '#ffffff' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: '800', color: '#0f766e' }}>
                        <span>📌 {c.type} • Mentor: {c.mentorName}</span>
                        <span>📅 {c.date}</span>
                      </div>
                      <div style={{ fontSize: '13px', color: '#0f172a', fontWeight: '700', marginTop: '4px' }}>{c.summary}</div>
                      {c.actionPlan && <div style={{ fontSize: '12px', color: '#475569', marginTop: '3px', fontWeight: '600' }}>🎯 Action Plan: {c.actionPlan}</div>}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px', borderTop: '1px solid #e2e8f0', paddingTop: '16px' }}>
            <button type="button" onClick={onClose} style={{ padding: '10px 18px', background: '#e2e8f0', color: '#0f172a', border: 'none', borderRadius: '8px', fontWeight: '800', cursor: 'pointer' }}>Close</button>
            {(canEditSkills || canViewConfidential) && (
              <button type="button" onClick={handleSavePortfolio} disabled={saving} style={{ padding: '10px 20px', background: '#00897b', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '800', cursor: 'pointer' }}>
                {saving ? 'Saving...' : '💾 Save All Student Records'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
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

export function MentorAndOutreachTab({ students, teachers, loggedInTeacher, isAdmin = false, isOutreachView = false, onStudentUpdated }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCompletion, setFilterCompletion] = useState('All');
  const [editingStudent, setEditingStudent] = useState(null);

  const [classPtaMessage, setClassPtaMessage] = useState('');
  const [ptaGroupLink, setPtaGroupLink] = useState('');

  const [outreachRoleFilter, setOutreachRoleFilter] = useState('All');
  const [outreachDeptFilter, setOutreachDeptFilter] = useState('All');
  const [outreachClassFilter, setOutreachClassFilter] = useState('All');

  // 🌟 Bulk & Direct Mentor Assignment State (For Outreach Coordinator & Admin)
  const [selectedStudentRegs, setSelectedStudentRegs] = useState([]);
  const [targetMentorUsername, setTargetMentorUsername] = useState('');
  const [isAssigningMentor, setIsAssigningMentor] = useState(false);
  const [mentorAssignStatus, setMentorAssignStatus] = useState('');

  const myUsername = String(loggedInTeacher?.username || '').trim().toLowerCase();
  const myFullNameLower = String(loggedInTeacher?.fullName || '').trim().toLowerCase();
  const priv = loggedInTeacher?.outpassPrivileges || {};
  const myClassTeacherOf = Array.isArray(priv.classTeacherOf) ? priv.classTeacherOf : [];
  const isNiicsCoord = Boolean(priv.isNiicsCoordinator);
  const canManageMentorAssignments = Boolean(isAdmin || isOutreachView || priv.isOutreachCoordinator || priv.isPrincipal);

  const normalizeCls = (str) => String(str || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  // Check if student is assigned to this teacher as Mentee
  const isStudentMyMentee = (st) => {
    const stMentorUser = String(st.mentorUsername || '').trim().toLowerCase();
    const stMentorName = String(st.mentorName || '').trim().toLowerCase();
    return (myUsername && stMentorUser === myUsername) || (myFullNameLower && stMentorName === myFullNameLower);
  };

  // Check if student belongs to this teacher's Class
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

  // 🌟 Determine Teacher's Active Duties
  const hasClassDuty = myClassTeacherOf.length > 0 || classStudentsList.length > 0;
  const hasMentorDuty = Boolean(priv.isMentor) || menteeStudentsList.length > 0;

  // 🌟 Build Duty-Based Tabs:
  // Only show both tabs if the teacher has BOTH Class Duty and Mentor Duty (or NIICS).
  // Otherwise, lock directly to their single assigned duty!
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

  // Default to their specific duty tab (e.g. 'CLASS' if Class Teacher, 'MENTEES' if Mentor only)
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

  // 🌟 Filter students based on Admin/Outreach or the Teacher's active duty tab
  const scopedStudents = students.filter(st => {
    if (isAdmin || isOutreachView) return true;

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
  const incompleteScope = totalScope - completeScope;
  const scopeCompletionPct = totalScope > 0 ? Math.round(scopedStudents.reduce((acc, s) => acc + computeStudentProfileCompletion(s).pct, 0) / totalScope) : 0;

  // 🌟 Outreach Coordinator & Admin: Bulk or Single Mentor Assignment
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
          editorName={loggedInTeacher?.fullName || (isAdmin ? 'Admin' : 'Teacher')}
          onClose={() => setEditingStudent(null)}
          onSaved={onStudentUpdated}
        />
      )}

      <div style={cardContainerStyle}>

        {/* 🌟 SUB-TAB SWITCHER: ONLY SHOWN IF TEACHER HAS BOTH CLASS & MENTORING DUTIES */}
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
                  color: teacherViewMode === tab.id ? '#ffffff' : '#0f172a',
                  boxShadow: teacherViewMode === tab.id ? '0 4px 10px rgba(0, 137, 123, 0.25)' : 'none'
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
          <span style={{ background: '#00897b', color: '#ffffff', padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: '800', textTransform: 'uppercase' }}>
            {isAdmin
              ? 'ADMIN MENTORSHIP VIEW'
              : isOutreachView
                ? '🌍 OUTREACH COORDINATOR & MENTOR ASSIGNMENT DESK'
                : teacherViewMode === 'MENTEES'
                  ? '🧭 MY MENTEES VIEW'
                  : teacherViewMode === 'CLASS'
                    ? `🏫 CLASS TEACHER VIEW (CLASS ${myClassTeacherOf.join(', ')})`
                    : teacherViewMode === 'NIICS'
                      ? '🎓 NIICS COORDINATOR VIEW'
                      : '👥 COMBINED MENTOR & CLASS VIEW'}
          </span>
          <h3 style={{ margin: 0, fontSize: '19px', color: '#0f172a', fontWeight: '800' }}>
            Student Contact Details, Profile Completion &amp; Mentorship ({totalScope} Students)
          </h3>
        </div>

        {/* 🌟 OUTREACH COORDINATOR & ADMIN: BULK MENTOR ASSIGNMENT PANEL */}
        {canManageMentorAssignments && (isAdmin || isOutreachView) && (
          <div style={{ background: '#f0fdfa', border: '2px solid #0d9488', padding: '16px', borderRadius: '12px', marginBottom: '22px' }}>
            <div style={{ fontWeight: '800', color: '#0f766e', fontSize: '14px', marginBottom: '6px' }}>
              🧭 Outreach Coordinator Desk: Assign Selected Students to a Mentor
            </div>
            <div style={{ fontSize: '12px', color: '#334155', fontWeight: '600', marginBottom: '12px' }}>
              Filter students below by Class, Department, or Unassigned status, check the boxes next to students, and assign them to any Mentor in one click. You can also change a student's mentor directly inside their table row.
            </div>

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
              <select
                value={targetMentorUsername}
                onChange={(e) => setTargetMentorUsername(e.target.value)}
                style={{ ...styles.input, flex: '1 1 260px', borderColor: '#0d9488', fontWeight: '700' }}
              >
                <option value="">-- Select Target Mentor Faculty --</option>
                <option value="__UNASSIGN__">❌ Unassign / Clear Mentor</option>
                {teachers.map(t => (
                  <option key={t.username} value={t.username}>
                    {t.fullName} (@{t.username}) {t.outpassPrivileges?.isMentor ? '• 🧭 Mentor' : ''}
                  </option>
                ))}
              </select>

              <button
                type="button"
                disabled={isAssigningMentor}
                onClick={handleBulkAssignMentor}
                style={{ background: '#0d9488', color: '#ffffff', border: 'none', padding: '12px 18px', borderRadius: '8px', fontSize: '13px', fontWeight: '800', cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                {isAssigningMentor ? 'Saving...' : `🚀 Assign ${selectedStudentRegs.length} Selected Students to Mentor`}
              </button>

              <button
                type="button"
                onClick={toggleSelectAllDisplayed}
                style={{ background: '#ffffff', color: '#0f766e', border: '1.5px solid #0d9488', padding: '11px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: '800', cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                ☑️ Select / Deselect Visible ({displayStudents.length})
              </button>
            </div>

            {mentorAssignStatus && (
              <div style={{ marginTop: '12px', padding: '10px 14px', background: '#dcfce7', color: '#166534', borderRadius: '8px', fontWeight: '800', fontSize: '13px' }}>
                {mentorAssignStatus}
              </div>
            )}
          </div>
        )}

        {/* CLASS TEACHER WHATSAPP PTA BROADCAST BAR */}
        {(!isAdmin && !isOutreachView && myClassTeacherOf.length > 0 && (teacherViewMode === 'CLASS' || teacherViewMode === 'ALL')) && (
          <div style={{ background: '#f0fdf4', border: '2px solid #22c55e', padding: '16px', borderRadius: '12px', marginBottom: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '12px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: '800', color: '#166534', fontSize: '14px', marginBottom: '4px' }}>
                  👨‍👩‍👦 Class {myClassTeacherOf[0]} PTA / Parents WhatsApp Group Broadcast
                </div>
                <div style={{ fontSize: '12px', color: '#15803d', fontWeight: '600' }}>
                  Type an announcement for Class {myClassTeacherOf[0]} parents below and click <strong>Open Class PTA WhatsApp Group</strong> (auto-copies message &amp; opens group directly).
                </div>
              </div>
              <button type="button" onClick={savePtaGroupLink} style={{ background: '#ffffff', color: '#059669', border: '1px solid #10b981', padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: '800', cursor: 'pointer', whiteSpace: 'nowrap' }}>
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
              <button type="button" onClick={openPtaGroupAndSend} style={{ background: '#16a34a', color: '#ffffff', border: 'none', padding: '10px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: '800', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                💬 Open Class {myClassTeacherOf[0]} PTA Group &amp; Send
              </button>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '22px' }}>
          <div onClick={() => setFilterCompletion('All')} style={{ padding: '20px', borderRadius: '12px', background: '#f8fafc', border: '1px solid #e2e8f0', textAlign: 'center', cursor: 'pointer' }}>
            <span style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', letterSpacing: '0.5px' }}>TOTAL IN SCOPE</span>
            <div style={{ fontSize: '32px', fontWeight: '900', color: '#0f172a', margin: '8px 0' }}>{totalScope}</div>
          </div>
          <div onClick={() => setFilterCompletion('Complete')} style={{ padding: '20px', borderRadius: '12px', background: '#ecfdf5', border: '1px solid #a7f3d0', textAlign: 'center', cursor: 'pointer' }}>
            <span style={{ fontSize: '11px', fontWeight: '800', color: '#047857', letterSpacing: '0.5px' }}>100% COMPLETE PROFILES</span>
            <div style={{ fontSize: '32px', fontWeight: '900', color: '#059669', margin: '8px 0' }}>{completeScope}</div>
          </div>
          <div onClick={() => setFilterCompletion('Incomplete')} style={{ padding: '20px', borderRadius: '12px', background: '#fee2e2', border: '1px solid #fecaca', textAlign: 'center', cursor: 'pointer' }}>
            <span style={{ fontSize: '11px', fontWeight: '800', color: '#991b1b', letterSpacing: '0.5px' }}>MISSING / INCOMPLETE DETAILS</span>
            <div style={{ fontSize: '32px', fontWeight: '900', color: '#dc2626', margin: '8px 0' }}>{incompleteScope}</div>
          </div>
          <div style={{ padding: '20px', borderRadius: '12px', background: '#eff6ff', border: '1px solid #bfdbfe', textAlign: 'center' }}>
            <span style={{ fontSize: '11px', fontWeight: '800', color: '#1e40af', letterSpacing: '0.5px' }}>PROFILE COMPLETION RATE</span>
            <div style={{ fontSize: '32px', fontWeight: '900', color: '#2563eb', margin: '8px 0' }}>{scopeCompletionPct}%</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '20px', background: '#f8fafc', padding: '12px', borderRadius: '10px', border: '1px solid #cbd5e1' }}>
          <input type="text" placeholder="Search student name, Ad.No, or district..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} style={{ ...styles.input, flex: '1 1 200px' }} />
          <select value={filterCompletion} onChange={(e) => setFilterCompletion(e.target.value)} style={{ ...styles.input, flex: '1 1 180px' }}>
            <option value="All">All Completion Statuses</option>
            <option value="Incomplete">⚠️ Incomplete Profiles Only</option>
            <option value="Complete">✅ 100% Complete Only</option>
          </select>
          {(isAdmin || isOutreachView) && (
            <>
              <select value={outreachClassFilter} onChange={(e) => setOutreachClassFilter(e.target.value)} style={{ ...styles.input, flex: '1 1 150px' }}>
                <option value="All">All Classes</option>
                {DEFAULT_CLASSES.map(c => <option key={c} value={c}>Class {c}</option>)}
              </select>
              <select value={outreachDeptFilter} onChange={(e) => setOutreachDeptFilter(e.target.value)} style={{ ...styles.input, flex: '1 1 160px' }}>
                <option value="All">All Departments</option>
                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <select value={outreachRoleFilter} onChange={(e) => setOutreachRoleFilter(e.target.value)} style={{ ...styles.input, flex: '1 1 180px', borderColor: '#0d9488' }}>
                <option value="All">All Mentorship Status</option>
                <option value="Mentors Assigned">✅ Mentors Assigned</option>
                <option value="No Mentor">⚠️ Unassigned (No Mentor)</option>
              </select>
            </>
          )}
        </div>

        <div style={{ overflowX: 'auto', border: '1px solid #cbd5e1', borderRadius: '12px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px', minWidth: '950px' }}>
            <thead>
              <tr style={{ background: '#0f172a', color: '#ffffff' }}>
                {canManageMentorAssignments && (isAdmin || isOutreachView) && (
                  <th style={{ padding: '14px 12px', width: '42px' }}>
                    <input
                      type="checkbox"
                      checked={displayStudents.length > 0 && displayStudents.every(s => selectedStudentRegs.includes(s.regNo))}
                      onChange={toggleSelectAllDisplayed}
                    />
                  </th>
                )}
                <th style={{ padding: '14px 16px', fontWeight: '800', color: '#ffffff' }}>Student &amp; Ad.No</th>
                <th style={{ padding: '14px 16px', fontWeight: '800', color: '#ffffff' }}>Class &amp; Mentor</th>
                <th style={{ padding: '14px 16px', fontWeight: '800', color: '#ffffff' }}>Student &amp; Parent Contact</th>
                <th style={{ padding: '14px 16px', fontWeight: '800', color: '#ffffff' }}>State &amp; District</th>
                <th style={{ padding: '14px 16px', fontWeight: '800', color: '#ffffff' }}>Profile Completion Rate</th>
                <th style={{ padding: '14px 16px', fontWeight: '800', color: '#ffffff', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayStudents.map((st, idx) => {
                const comp = computeStudentProfileCompletion(st);
                const isUrdu = String(st.adNo || '').toUpperCase().startsWith('U');
                const autoCT = resolveClassTeacherForStudent(st, teachers);
                const actualMentor = teachers.find(t => String(t.username || '').toLowerCase() === String(st.mentorUsername || '').toLowerCase());
                const isChecked = selectedStudentRegs.includes(st.regNo);

                return (
                  <tr key={st.regNo} style={{ borderBottom: '1px solid #e2e8f0', background: isChecked ? '#ccfbf1' : idx % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
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
                        <ProfileAvatar name={st.firstName} code={st.adNo} photoUrl={st.photoUrl} size={42} onClick={() => setEditingStudent(st)} />
                        <div>
                          <div style={{ fontWeight: '800', color: '#0f172a', fontSize: '15px' }}>{st.firstName}</div>
                          <div style={{ fontSize: '12px', color: '#475569', fontWeight: '700' }}>Ad.No: #{st.adNo} • Reg: {st.regNo}</div>
                          {isUrdu && <span style={{ ...styles.badge, background: '#fef3c7', color: '#b45309', marginTop: '4px' }}>URDU</span>}
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: '12px', color: '#0f172a', fontWeight: '800' }}>
                      <div style={{ fontSize: '14px', marginBottom: '4px' }}>{(st.classes || []).join(', ')} ({st.department || 'GENERAL'})</div>
                      {canManageMentorAssignments && (isAdmin || isOutreachView) ? (
                        <div style={{ marginBottom: '4px' }}>
                          <span style={{ color: '#0f766e', display: 'block', marginBottom: '2px' }}>🧭 Assign Mentor:</span>
                          <select
                            value={st.mentorUsername || ''}
                            onChange={(e) => handleSingleStudentMentorChange(st, e.target.value)}
                            style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #0d9488', fontSize: '12px', fontWeight: '700', background: '#ffffff', color: '#0f172a', maxWidth: '190px' }}
                          >
                            <option value="">Unassigned</option>
                            {teachers.map(t => (
                              <option key={t.username} value={t.username}>{t.fullName}</option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <div style={{ color: '#0f766e', marginBottom: '2px' }}>
                          🧭 Mentor: <br />{actualMentor ? actualMentor.fullName : (st.mentorName || 'Unassigned')}
                        </div>
                      )}
                      <div style={{ color: '#1d4ed8' }}>🏫 CT: {autoCT ? autoCT.fullName : (st.classTeacherUsername || 'Unassigned')}</div>
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: '12px', color: '#334155' }}>
                      <div style={{ marginBottom: '4px' }}>📱 Student: {st.whatsappNumber || st.mobileNumber || '—'}</div>
                      <div style={{ marginBottom: '4px' }}>👨‍👩‍👦 Parent WA: {st.parentWhatsapp || st.parentMobile || '—'}</div>
                      <div>✉️ Email: {st.email || '—'}</div>
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: '12px', color: '#1e293b' }}>
                      <div style={{ fontWeight: '800', fontSize: '13px' }}>📍 {st.district || '—'}</div>
                      <div style={{ color: '#64748b' }}>{st.state || 'Kerala'}</div>
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                        <div style={{ width: '120px', height: '8px', background: '#e2e8f0', borderRadius: '999px', overflow: 'hidden' }}>
                          <div style={{ width: `${comp.pct}%`, height: '100%', background: comp.isComplete ? '#10b981' : comp.pct >= 60 ? '#f59e0b' : '#ef4444' }} />
                        </div>
                        <span style={{ fontSize: '13px', fontWeight: '800', color: comp.isComplete ? '#047857' : '#b45309' }}>{comp.pct}%</span>
                      </div>
                      {!comp.isComplete && (
                        <div style={{ fontSize: '11px', color: '#dc2626', fontWeight: '700' }}>
                          Missing: {comp.missing.join(', ')}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        <button onClick={() => setEditingStudent(st)} style={{ padding: '8px 14px', background: '#0f766e', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '800', fontSize: '13px' }}>
                          ✏️ Edit Details / Log
                        </button>
                        <button onClick={() => openDirectWhatsApp(st.parentWhatsapp || st.parentMobile, `Assalamu Alaikum, official message regarding ${st.firstName} (#${st.adNo}) from DHIU Mentor/Class Teacher:`)} style={{ padding: '8px 14px', background: '#dcfce7', color: '#166534', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '800', fontSize: '13px' }}>
                          💬 Parent WA
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}