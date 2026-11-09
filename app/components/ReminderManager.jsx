'use client';
import React, { useState, useEffect } from 'react';
import { db } from '../../lib/firebase';
import { doc, setDoc, getDoc, getDocs, collection } from 'firebase/firestore';
import {
  DEFAULT_SUBJECTS, CCE_LEVELS, HIFZ_LEVELS, styles
} from './erpConstants';
import { CollapsibleCard, openWhatsAppGroupAndCopy } from './ErpExtensions';

export default function ReminderManager() {
  const [weekName, setWeekName] = useState('Week 5');
  const [targetConfigs, setTargetConfigs] = useState({});
  const [message, setMessage] = useState('Please complete your mark entry for this week.');
  const [isActive, setIsActive] = useState(false);
  const [trackerData, setTrackerData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  // Minimalist Top Panel & Filter States
  const [activeTopPanel, setActiveTopPanel] = useState('none'); // 'none' | 'config' | 'whatsapp'
  const [statusFilter, setStatusFilter] = useState('All'); // 'All' | 'NotStarted' | 'Partially' | 'Completed' | 'Pending'
  const [searchQuery, setSearchQuery] = useState('');

  // WhatsApp and Clipboard Sharing States
  const [staffGroupLink, setStaffGroupLink] = useState('');
  const [editingGroupLink, setEditingGroupLink] = useState(false);
  const [whatsappReportScope, setWhatsappReportScope] = useState('full'); // 'full' | 'NotStarted' | 'Partially' | 'Completed' | 'Incomplete'
  const [copiedToast, setCopiedToast] = useState(null);

  const normalizeConfigToMapOfArrays = (rawConfigs) => {
    const normalized = {};
    if (!rawConfigs || typeof rawConfigs !== 'object') return normalized;
    Object.keys(rawConfigs).forEach(sub => {
      const val = rawConfigs[sub];
      if (Array.isArray(val)) {
        if (val.length > 0) normalized[sub] = val;
      } else if (val) {
        normalized[sub] = [String(val)];
      }
    });
    return normalized;
  };

  const fetchTrackerData = async () => {
    setIsLoading(true);
    try {
      const [tSnap, sSnap, mSnap, cacheSnap, groupSnap] = await Promise.all([
        getDocs(collection(db, 'teachers')),
        getDocs(collection(db, 'students')),
        getDocs(collection(db, 'marks')),
        getDoc(doc(db, 'systemCache', 'activeReminder')),
        getDoc(doc(db, 'systemCache', 'whatsappGroups'))
      ]);

      if (groupSnap.exists() && groupSnap.data().staffGroupLink) {
        setStaffGroupLink(groupSnap.data().staffGroupLink);
      }

      let activeConfigs = {};

      if (cacheSnap.exists()) {
        const data = cacheSnap.data();
        setWeekName(data.weekName || 'Week 1');
        setMessage(data.message || '');
        setIsActive(data.active || false);

        if (data.targetConfigs) {
          activeConfigs = normalizeConfigToMapOfArrays(data.targetConfigs);
        } else if (data.targetSubjects) {
          let migratedConf = {};
          const fallbackLvl = data.level || "15";
          if (data.targetSubjects.includes('All')) {
            DEFAULT_SUBJECTS.forEach(s => { migratedConf[s] = [s.toUpperCase() === 'HIFZ' ? '50_1' : fallbackLvl]; });
          } else {
            data.targetSubjects.forEach(s => { if (s !== 'All') migratedConf[s] = [s.toUpperCase() === 'HIFZ' ? '50_1' : fallbackLvl]; });
          }
          activeConfigs = migratedConf;
        }
        setTargetConfigs(activeConfigs);
      }

      const students = []; sSnap.forEach(d => students.push({ id: d.id, ...d.data() }));
      const marks = {}; mSnap.forEach(d => marks[d.id] = d.data());
      const trackList = [];

      tSnap.forEach(tDoc => {
        const teacher = tDoc.data();
        if (!teacher.enrollments) return;

        teacher.enrollments.forEach(env => {
          const exactSubject = (env.alias?.toUpperCase().includes('U :FIQH') || env.subject?.toUpperCase().includes('U :FIQH')) ? 'U :FIQH' : (env.subject || '');
          const actUp = exactSubject.toUpperCase();

          const matchingSubKey = Object.keys(activeConfigs).find(k => k.toUpperCase() === actUp);
          if (!matchingSubKey) return;

          const rawLevels = activeConfigs[matchingSubKey];
          const requiredLevelsArray = Array.isArray(rawLevels) ? rawLevels : [rawLevels];

          const envAliasLower = String(env.alias || '').trim().toLowerCase();
          const envLang = (env.langTag || '').toLowerCase();

          const matchedStudents = students.filter(student => {
            const studentClassesLower = (student.classes || []).map(c => String(c).trim().toLowerCase());
            let matchesClass = false;
            if (envAliasLower && studentClassesLower.some(c => envAliasLower.includes(c) || c.includes(envAliasLower))) {
              matchesClass = true;
            } else if (env.classes && Array.isArray(env.classes)) {
              matchesClass = env.classes.some(ec => studentClassesLower.includes(String(ec).trim().toLowerCase()));
            } else if (env.class) {
              matchesClass = studentClassesLower.includes(String(env.class).trim().toLowerCase());
            }

            if (!matchesClass) return false;
            if (envLang && student.secondLanguage) {
              return student.secondLanguage.trim().toLowerCase() === envLang;
            }
            return true;
          });

          if (matchedStudents.length === 0) return;

          requiredLevelsArray.forEach(requiredLevel => {
            let missingCount = 0;
            matchedStudents.forEach(st => {
              const stMarks = marks[st.regNo] || marks[st.id] || marks[st.adNo];
              let hasMark = false;
              if (stMarks) {
                const foundKey = Object.keys(stMarks).find(k => {
                  const kUp = k.trim().toUpperCase();
                  if (actUp.includes('U :FIQH') || actUp.includes('U:FIQH')) return kUp.includes('U :FIQH') || kUp.includes('U:FIQH');
                  if (actUp === 'FIQH') return kUp === 'FIQH';
                  return kUp === actUp;
                });

                if (foundKey && stMarks[foundKey] && stMarks[foundKey][requiredLevel] !== undefined && stMarks[foundKey][requiredLevel] !== '') {
                  hasMark = true;
                }
              }
              if (!hasMark) missingCount++;
            });

            trackList.push({
              teacherName: teacher.fullName || teacher.username || 'Faculty',
              subject: env.alias || env.subject,
              levelRequired: requiredLevel,
              totalEnrolled: matchedStudents.length,
              missingCount: missingCount,
              enteredCount: matchedStudents.length - missingCount,
              isComplete: missingCount === 0
            });
          });
        });
      });
      setTrackerData(trackList);
    } catch (err) { console.error(err); }
    setIsLoading(false);
  };

  useEffect(() => { fetchTrackerData(); }, []);

  const handleSave = async () => {
    setIsLoading(true);
    await setDoc(doc(db, 'systemCache', 'activeReminder'), {
      weekName: weekName,
      targetConfigs: targetConfigs,
      message: message,
      active: isActive,
      updatedAt: new Date().toISOString()
    });
    setActiveTopPanel('none');
    alert('✅ Reminder settings updated and broadcasted to portals!');
    fetchTrackerData();
  };

  const handleSaveStaffGroupLink = async () => {
    await setDoc(doc(db, 'systemCache', 'whatsappGroups'), { staffGroupLink: staffGroupLink.trim() }, { merge: true });
    setEditingGroupLink(false);
    alert('✅ Saved Official Staff WhatsApp Group Invite Link!');
  };

  const toggleSubjectConfig = (sub) => {
    setTargetConfigs(prev => {
      const newConf = { ...prev };
      if (newConf[sub] && newConf[sub].length > 0) {
        delete newConf[sub];
      } else {
        newConf[sub] = [sub.toUpperCase() === 'HIFZ' ? "50_1" : "15"];
      }
      return newConf;
    });
  };

  const toggleSubjectLevel = (sub, levelVal) => {
    setTargetConfigs(prev => {
      const currentLevels = Array.isArray(prev[sub]) ? prev[sub] : (prev[sub] ? [prev[sub]] : []);
      let updatedLevels;
      if (currentLevels.includes(levelVal)) {
        updatedLevels = currentLevels.filter(l => l !== levelVal);
      } else {
        updatedLevels = [...currentLevels, levelVal];
      }
      const newConf = { ...prev };
      if (updatedLevels.length === 0) {
        delete newConf[sub];
      } else {
        newConf[sub] = updatedLevels;
      }
      return newConf;
    });
  };

  const completedCount = trackerData.filter(r => r.missingCount === 0).length;
  const notStartedCount = trackerData.filter(r => r.enteredCount === 0 && r.totalEnrolled > 0).length;
  const partiallyCount = trackerData.filter(r => r.enteredCount > 0 && r.missingCount > 0).length;
  const pendingCount = trackerData.length - completedCount;
  const completionPct = trackerData.length > 0 ? Math.round((completedCount / trackerData.length) * 100) : 0;

  // Filtered rows for the table view
  const filteredTrackerRows = trackerData.filter(row => {
    if (statusFilter === 'Pending' && row.missingCount === 0) return false;
    if (statusFilter === 'Completed' && row.missingCount > 0) return false;
    if (statusFilter === 'NotStarted' && (row.enteredCount > 0 || row.totalEnrolled === 0)) return false;
    if (statusFilter === 'Partially' && (row.enteredCount === 0 || row.missingCount === 0)) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      if (!row.teacherName?.toLowerCase().includes(q) && !row.subject?.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // =========================================================================
  // 🌟 STRUCTURED REPORT BUILDER FOR CLIPBOARD & WHATSAPP
  // Gives exact group breakdown: Not Started, Partially Marked / Pending, Completed Full
  // =========================================================================
  const getLevelLabel = (r) => {
    return r.levelRequired === '50_1' ? 'Part 1 (/50)'
      : r.levelRequired === '50_2' ? 'Part 2 (/50)'
      : `Max ${r.levelRequired}`;
  };

  const groupRowsByTeacher = (rows) => {
    const map = {};
    rows.forEach(r => {
      const tName = r.teacherName || 'Faculty';
      if (!map[tName]) map[tName] = [];
      map[tName].push(r);
    });
    return map;
  };

  const buildReportMessage = (scope = 'full') => {
    const notStartedRows = trackerData.filter(r => r.enteredCount === 0 && r.totalEnrolled > 0);
    const partiallyRows = trackerData.filter(r => r.enteredCount > 0 && r.missingCount > 0);
    const completedRows = trackerData.filter(r => r.missingCount === 0);
    const incompleteRows = trackerData.filter(r => r.missingCount > 0);

    const lines = [
      `🏛️ *DARUL HUDA ISLAMIC UNIVERSITY — DEGREE SECTION*`,
      `📢 *WEEKLY CCE MARK ENTRY TRACKER REPORT*`,
      `*Target Academic Week:* ${weekName}`,
      `*Notice:* ${message || 'Please complete mark entry for targeted subjects.'}`,
      `*Overall Status:* ${completedRows.length}/${trackerData.length} Batches Complete (${completionPct}%)`,
      `📊 *Summary:* 🔴 Not Started: *${notStartedRows.length}* | 🟡 In Progress: *${partiallyRows.length}* | 🟢 Completed Full: *${completedRows.length}*`,
      `-----------------------------------------`
    ];

    if (scope === 'NotStarted') {
      lines.push(`\n🔴 *1. NOT STARTED YET (${notStartedRows.length} Batches — 0% Entered):*`);
      if (notStartedRows.length === 0) {
        lines.push(`🎉 Alhamdulillah! No batches are in 'Not Started' status.`);
      } else {
        const byTeacher = groupRowsByTeacher(notStartedRows);
        Object.entries(byTeacher).forEach(([tName, items], idx) => {
          lines.push(`\n*${idx + 1}. Usthad ${tName}:*`);
          items.forEach(it => {
            lines.push(`   ▫ ${it.subject} [${getLevelLabel(it)}] — *0/${it.totalEnrolled} entered* (All ${it.totalEnrolled} pending)`);
          });
        });
      }
    } else if (scope === 'Partially') {
      lines.push(`\n🟡 *2. PARTIALLY MARKED / PENDING (${partiallyRows.length} Batches):*`);
      if (partiallyRows.length === 0) {
        lines.push(`🎉 No batches currently in partial progress.`);
      } else {
        const byTeacher = groupRowsByTeacher(partiallyRows);
        Object.entries(byTeacher).forEach(([tName, items], idx) => {
          lines.push(`\n*${idx + 1}. Usthad ${tName}:*`);
          items.forEach(it => {
            lines.push(`   ▫ ${it.subject} [${getLevelLabel(it)}] — *${it.enteredCount}/${it.totalEnrolled} marked* (*${it.missingCount} pending*)`);
          });
        });
      }
    } else if (scope === 'Completed') {
      lines.push(`\n🟢 *3. COMPLETED FULL (${completedRows.length} Batches — 100% Entered):*`);
      if (completedRows.length === 0) {
        lines.push(`No batches completed yet for this week.`);
      } else {
        const byTeacher = groupRowsByTeacher(completedRows);
        Object.entries(byTeacher).forEach(([tName, items], idx) => {
          lines.push(`\n*${idx + 1}. Usthad ${tName}:*`);
          items.forEach(it => {
            lines.push(`   ▫ ${it.subject} [${getLevelLabel(it)}] — *${it.totalEnrolled}/${it.totalEnrolled} completed* ✅`);
          });
        });
      }
    } else if (scope === 'Incomplete') {
      lines.push(`\n⚠️ *INCOMPLETE & PENDING SUBMISSIONS (${incompleteRows.length} Batches):*`);
      if (notStartedRows.length > 0) {
        lines.push(`\n🔴 *A. NOT STARTED YET (${notStartedRows.length} Batches):*`);
        const byTeacher = groupRowsByTeacher(notStartedRows);
        Object.entries(byTeacher).forEach(([tName, items], idx) => {
          lines.push(`*${idx + 1}. Usthad ${tName}:*`);
          items.forEach(it => {
            lines.push(`   ▫ ${it.subject} [${getLevelLabel(it)}] — 0/${it.totalEnrolled} entered`);
          });
        });
      }
      if (partiallyRows.length > 0) {
        lines.push(`\n🟡 *B. PARTIALLY MARKED (${partiallyRows.length} Batches):*`);
        const byTeacher = groupRowsByTeacher(partiallyRows);
        Object.entries(byTeacher).forEach(([tName, items], idx) => {
          lines.push(`*${idx + 1}. Usthad ${tName}:*`);
          items.forEach(it => {
            lines.push(`   ▫ ${it.subject} [${getLevelLabel(it)}] — ${it.enteredCount}/${it.totalEnrolled} entered (*${it.missingCount} pending*)`);
          });
        });
      }
    } else {
      // FULL 3-GROUP BREAKDOWN REPORT
      if (notStartedRows.length > 0) {
        lines.push(`\n🔴 *GROUP 1: NOT STARTED YET (${notStartedRows.length} Batches):*`);
        const byTeacher = groupRowsByTeacher(notStartedRows);
        Object.entries(byTeacher).forEach(([tName, items], idx) => {
          lines.push(`*${idx + 1}. Usthad ${tName}:*`);
          items.forEach(it => {
            lines.push(`   ▫ ${it.subject} [${getLevelLabel(it)}] — 0/${it.totalEnrolled} entered`);
          });
        });
      }

      if (partiallyRows.length > 0) {
        lines.push(`\n🟡 *GROUP 2: PARTIALLY MARKED / PENDING (${partiallyRows.length} Batches):*`);
        const byTeacher = groupRowsByTeacher(partiallyRows);
        Object.entries(byTeacher).forEach(([tName, items], idx) => {
          lines.push(`*${idx + 1}. Usthad ${tName}:*`);
          items.forEach(it => {
            lines.push(`   ▫ ${it.subject} [${getLevelLabel(it)}] — ${it.enteredCount}/${it.totalEnrolled} entered (*${it.missingCount} pending*)`);
          });
        });
      }

      if (completedRows.length > 0) {
        lines.push(`\n🟢 *GROUP 3: COMPLETED FULL (${completedRows.length} Batches):*`);
        const byTeacher = groupRowsByTeacher(completedRows);
        Object.entries(byTeacher).forEach(([tName, items], idx) => {
          lines.push(`*${idx + 1}. Usthad ${tName}:*`);
          items.forEach(it => {
            lines.push(`   ▫ ${it.subject} [${getLevelLabel(it)}] — ${it.totalEnrolled}/${it.totalEnrolled} done ✅`);
          });
        });
      }
    }

    lines.push(`\n-----------------------------------------`);
    lines.push(`_Broadcasted via DHIU Degree Section ERP Portal on ${new Date().toLocaleDateString('en-GB')}_`);
    return lines.join('\n');
  };

  const copyReportToClipboard = (scope, label) => {
    const text = buildReportMessage(scope);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
    }
    setCopiedToast(`Copied ${label || 'report'} to clipboard! Ready to paste into WhatsApp.`);
    setTimeout(() => setCopiedToast(null), 4000);
  };

  const shareReportViaWhatsApp = (scope) => {
    const text = buildReportMessage(scope);
    openWhatsAppGroupAndCopy(staffGroupLink, text, 'DHIU Staff WhatsApp Group');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>

      {/* 🌟 FLOATING / INLINE COPY TOAST NOTIFICATION */}
      {copiedToast && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: 3000,
          background: '#064e3b',
          color: '#ffffff',
          padding: '14px 22px',
          borderRadius: '10px',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.25)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          fontSize: '13px',
          fontWeight: '700',
          animation: 'erpSlideUp 0.25s ease'
        }}>
          <span>📋</span>
          <span>{copiedToast}</span>
          <button
            onClick={() => setCopiedToast(null)}
            style={{ background: 'transparent', border: 'none', color: '#a7f3d0', cursor: 'pointer', fontSize: '15px', marginLeft: '10px' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* 🌟 MINIMALIST TOP ACTION BAR */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{
            background: isActive ? '#dcfce7' : '#f1f5f9',
            color: isActive ? '#15803d' : '#475569',
            padding: '5px 12px',
            borderRadius: '999px',
            fontSize: '12px',
            fontWeight: '700'
          }}>
            {isActive ? `● Active (${weekName})` : '○ Paused'}
          </span>
          <span style={{ fontSize: '13px', color: '#64748b', fontWeight: '500' }}>
            {message}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setActiveTopPanel(activeTopPanel === 'config' ? 'none' : 'config')}
            style={{
              padding: '9px 16px',
              background: activeTopPanel === 'config' ? '#4f46e5' : '#ffffff',
              color: activeTopPanel === 'config' ? '#ffffff' : '#0f172a',
              border: '1px solid #cbd5e1',
              borderRadius: '8px',
              fontWeight: '700',
              fontSize: '13px',
              cursor: 'pointer'
            }}
          >
            ⚙️ Configure Targets ({Object.keys(targetConfigs).length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTopPanel(activeTopPanel === 'whatsapp' ? 'none' : 'whatsapp')}
            style={{
              padding: '9px 16px',
              background: activeTopPanel === 'whatsapp' ? '#4f46e5' : '#ffffff',
              color: activeTopPanel === 'whatsapp' ? '#ffffff' : '#4f46e5',
              border: '1px solid #c7d2fe',
              borderRadius: '8px',
              fontWeight: '700',
              fontSize: '13px',
              cursor: 'pointer'
            }}
          >
            💬 Staff WA Reminder &amp; Reports
          </button>
        </div>
      </div>

      {/* 🌟 MARKS-AUDITOR STYLE SOFT PASTEL KPI ROW */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
        <div
          onClick={() => setStatusFilter('All')}
          style={{ padding: '18px', borderRadius: '12px', background: '#f8fafc', border: statusFilter === 'All' ? '2px solid #4f46e5' : '1px solid #e2e8f0', textAlign: 'center', cursor: 'pointer' }}
          title="Click to view all batches"
        >
          <span style={{ fontSize: '11px', fontWeight: '800', color: '#475569' }}>TARGETED BATCHES</span>
          <div style={{ fontSize: '26px', fontWeight: '900', color: '#0f172a', marginTop: '4px' }}>{trackerData.length}</div>
        </div>
        <div
          onClick={() => setStatusFilter('Completed')}
          style={{ padding: '18px', borderRadius: '12px', background: '#ecfdf5', border: statusFilter === 'Completed' ? '2px solid #059669' : '1px solid #a7f3d0', textAlign: 'center', cursor: 'pointer' }}
          title="Click to filter Completed batches"
        >
          <span style={{ fontSize: '11px', fontWeight: '800', color: '#047857' }}>COMPLETED (100%)</span>
          <div style={{ fontSize: '26px', fontWeight: '900', color: '#065f46', marginTop: '4px' }}>{completedCount}</div>
        </div>
        <div
          onClick={() => setStatusFilter('Pending')}
          style={{ padding: '18px', borderRadius: '12px', background: '#fff1f2', border: statusFilter === 'Pending' ? '2px solid #e11d48' : '1px solid #fecdd3', textAlign: 'center', cursor: 'pointer' }}
          title="Click to filter Incomplete batches"
        >
          <span style={{ fontSize: '11px', fontWeight: '800', color: '#be123c' }}>MISSING / PENDING</span>
          <div style={{ fontSize: '26px', fontWeight: '900', color: '#e11d48', marginTop: '4px' }}>{pendingCount}</div>
        </div>
        <div style={{ padding: '18px', borderRadius: '12px', background: '#eff6ff', border: '1px solid #bfdbfe', textAlign: 'center' }}>
          <span style={{ fontSize: '11px', fontWeight: '800', color: '#1d4ed8' }}>COMPLETION RATE</span>
          <div style={{ fontSize: '26px', fontWeight: '900', color: '#2563eb', marginTop: '4px' }}>{completionPct}%</div>
        </div>
      </div>

      {/* PANEL 1: CONFIGURE TARGETS */}
      {activeTopPanel === 'config' && (
        <div className="erp-slide-panel" style={styles.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800', color: '#0f172a' }}>Configure Weekly Mark Entry Targets</h3>
            <button type="button" onClick={() => setActiveTopPanel('none')} style={styles.buttonSecondary}>✕ Close</button>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', marginBottom: '16px' }}>
            <div style={{ flex: '1 1 160px' }}>
              <label style={styles.label}>Academic Week</label>
              <input type="text" value={weekName} onChange={(e) => setWeekName(e.target.value)} style={styles.input} />
            </div>
            <div style={{ flex: '2 1 300px' }}>
              <label style={styles.label}>Reminder Notice Text</label>
              <input type="text" value={message} onChange={(e) => setMessage(e.target.value)} style={styles.input} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '10px', background: '#f8fafc', padding: '14px', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
            {DEFAULT_SUBJECTS.map(sub => {
              const isSubHifz = sub.toUpperCase() === 'HIFZ';
              const levelOptions = isSubHifz ? HIFZ_LEVELS : CCE_LEVELS;
              const selectedLevels = Array.isArray(targetConfigs[sub])
                ? targetConfigs[sub]
                : (targetConfigs[sub] ? [String(targetConfigs[sub])] : []);
              const isSubjectChecked = selectedLevels.length > 0;

              return (
                <div key={sub} style={{ background: isSubjectChecked ? '#eef2ff' : '#ffffff', padding: '10px 12px', borderRadius: '10px', border: `1px solid ${isSubjectChecked ? '#4f46e5' : '#e2e8f0'}` }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer', color: '#0f172a', fontWeight: '700' }}>
                    <input type="checkbox" checked={isSubjectChecked} onChange={() => toggleSubjectConfig(sub)} style={{ accentColor: '#4f46e5' }} />
                    {sub}
                  </label>

                  {isSubjectChecked && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '8px', paddingTop: '6px', borderTop: '1px dashed #c7d2fe' }}>
                      {Object.entries(levelOptions).map(([name, val]) => {
                        const isLvlSelected = selectedLevels.includes(val);
                        const shortLabel = isSubHifz ? name.replace(' (Max 50)', '') : `${name.replace('Level ', 'L')} (/${val})`;
                        return (
                          <button
                            key={val}
                            type="button"
                            onClick={() => toggleSubjectLevel(sub, val)}
                            style={{
                              padding: '3px 8px',
                              borderRadius: '6px',
                              fontSize: '11px',
                              fontWeight: '700',
                              cursor: 'pointer',
                              border: isLvlSelected ? '1px solid #4f46e5' : '1px solid #cbd5e1',
                              background: isLvlSelected ? '#4f46e5' : '#ffffff',
                              color: isLvlSelected ? '#ffffff' : '#475569'
                            }}
                          >
                            {isLvlSelected ? `✓ ${shortLabel}` : shortLabel}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontWeight: '700', fontSize: '13px', color: '#0f172a', cursor: 'pointer' }}>
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} style={{ width: '16px', height: '16px', accentColor: '#4f46e5' }} />
              Enable Active Reminder Banner on Portals
            </label>
            <button onClick={handleSave} disabled={isLoading} style={styles.buttonPrimary}>
              {isLoading ? 'Saving...' : 'Save & Broadcast'}
            </button>
          </div>
        </div>
      )}

      {/* 🌟 PANEL 2: WHATSAPP GROUP REMINDER & DETAILED REPORT DESK */}
      {activeTopPanel === 'whatsapp' && (
        <div className="erp-slide-panel" style={{ ...styles.card, border: '1.5px solid #a5b4fc', background: '#ffffff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <h4 style={{ margin: 0, fontSize: '16px', fontWeight: '800', color: '#0f172a' }}>
                📱 Staff WhatsApp Group Sharing &amp; Categorized Reports
              </h4>
              <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#64748b' }}>
                Copy detailed reports to clipboard or broadcast directly to your Staff WhatsApp Group with exact status groups: <strong>Not Started</strong>, <strong>Partially Marked</strong>, and <strong>Completed Full</strong>.
              </p>
            </div>
            <button type="button" onClick={() => setActiveTopPanel('none')} style={styles.buttonSecondary}>✕ Close</button>
          </div>

          {/* STAFF GROUP INVITE LINK CONFIGURATION */}
          <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: editingGroupLink ? '8px' : '0' }}>
              <div style={{ fontSize: '13px', color: '#0f172a' }}>
                <strong>Staff WhatsApp Group Link:</strong>{' '}
                {staffGroupLink ? (
                  <a href={staffGroupLink} target="_blank" rel="noreferrer" style={{ color: '#059669', fontWeight: '700', textDecoration: 'none' }}>
                    🔗 {staffGroupLink}
                  </a>
                ) : (
                  <span style={{ color: '#e11d48', fontStyle: 'italic' }}>Not configured yet. Add group invite link to open group with 1-click.</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setEditingGroupLink(!editingGroupLink)}
                style={{ ...styles.buttonSecondary, fontSize: '11px', padding: '5px 10px' }}
              >
                {editingGroupLink ? '✕ Cancel' : staffGroupLink ? '✏️ Change Link' : '➕ Add Group Link'}
              </button>
            </div>

            {editingGroupLink && (
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                <input
                  type="text"
                  value={staffGroupLink}
                  onChange={(e) => setStaffGroupLink(e.target.value)}
                  placeholder="Paste WhatsApp Group Invite Link (e.g. https://chat.whatsapp.com/L123abc...)"
                  style={{ ...styles.input, flex: 1, padding: '7px 12px', fontSize: '12px' }}
                />
                <button type="button" onClick={handleSaveStaffGroupLink} style={{ ...styles.buttonPrimary, fontSize: '12px', padding: '7px 14px' }}>
                  Save Link
                </button>
              </div>
            )}
          </div>

          {/* REPORT CONTENT SCOPE SELECTOR */}
          <div style={{ marginBottom: '14px' }}>
            <label style={{ ...styles.label, fontSize: '13px', fontWeight: '800', color: '#0f172a', marginBottom: '8px' }}>
              Select Report Content to Copy or Broadcast:
            </label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {[
                { id: 'full', label: `📊 Full 3-Group Report (All ${trackerData.length})` },
                { id: 'NotStarted', label: `🔴 Not Started Only (${notStartedCount})` },
                { id: 'Partially', label: `🟡 Partially Marked Only (${partiallyCount})` },
                { id: 'Completed', label: `🟢 Completed Only (${completedCount})` },
                { id: 'Incomplete', label: `⚠️ All Incomplete (${pendingCount})` }
              ].map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setWhatsappReportScope(opt.id)}
                  style={{
                    padding: '7px 14px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: '700',
                    cursor: 'pointer',
                    border: whatsappReportScope === opt.id ? '2px solid #4f46e5' : '1px solid #cbd5e1',
                    background: whatsappReportScope === opt.id ? '#eef2ff' : '#ffffff',
                    color: whatsappReportScope === opt.id ? '#4f46e5' : '#334155'
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* ACTION BUTTONS */}
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '16px' }}>
            <button
              type="button"
              onClick={() => copyReportToClipboard(whatsappReportScope, `${whatsappReportScope} Report`)}
              style={{ ...styles.buttonSecondary, background: '#ffffff', color: '#0f172a', fontWeight: '800', padding: '9px 16px', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              📋 Copy to Clipboard
            </button>

            <button
              type="button"
              onClick={() => shareReportViaWhatsApp(whatsappReportScope)}
              style={{ ...styles.buttonPrimary, background: '#059669', padding: '9px 18px', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '800' }}
            >
              💬 Open Staff Group &amp; Send
            </button>

            <button
              type="button"
              onClick={() => {
                const text = buildReportMessage(whatsappReportScope);
                window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
              }}
              style={{ ...styles.buttonSecondary, color: '#059669', borderColor: '#a7f3d0', background: '#ecfdf5', fontWeight: '700', padding: '9px 14px' }}
            >
              📱 Direct WhatsApp Link
            </button>
          </div>

          {/* LIVE MESSAGE PREVIEW */}
          <div>
            <div style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', marginBottom: '6px' }}>
              Live Message Preview (Formatted for WhatsApp):
            </div>
            <textarea
              readOnly
              rows={8}
              value={buildReportMessage(whatsappReportScope)}
              style={{
                ...styles.input,
                fontFamily: 'monospace',
                fontSize: '11px',
                lineHeight: 1.5,
                background: '#f8fafc',
                color: '#1e293b',
                borderRadius: '8px'
              }}
            />
          </div>
        </div>
      )}

      {/* 🌟 TRACKER TABLE WITH INTEGRATED FILTER & QUICK-COPY BAR */}
      <div style={{ ...styles.card, padding: 0, overflow: 'hidden' }}>
        {/* FILTER & INSTANT CLIPBOARD COPY BAR */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="🔍 Search teacher or subject..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ ...styles.input, maxWidth: '240px', padding: '7px 12px', fontSize: '12px' }}
            />

            {/* STATUS FILTER PILLS */}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {[
                { id: 'All', label: `All (${trackerData.length})` },
                { id: 'NotStarted', label: `🔴 Not Started (${notStartedCount})` },
                { id: 'Partially', label: `🟡 Partially Marked (${partiallyCount})` },
                { id: 'Completed', label: `🟢 Fully Marked (${completedCount})` }
              ].map(f => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setStatusFilter(f.id)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: '700',
                    cursor: 'pointer',
                    background: statusFilter === f.id ? '#4f46e5' : '#f8fafc',
                    color: statusFilter === f.id ? '#ffffff' : '#475569',
                    border: '1px solid #e2e8f0',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* 🌟 DIRECT QUICK-COPY & SHARE ACTIONS FOR CURRENT FILTER */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => {
                const targetScope = statusFilter === 'All' ? 'full' : statusFilter;
                const label = statusFilter === 'All' ? 'Full 3-Group Report' : statusFilter === 'NotStarted' ? 'Not Started List' : statusFilter === 'Partially' ? 'Pending List' : 'Completed List';
                copyReportToClipboard(targetScope, label);
              }}
              style={{
                padding: '6px 12px',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: '800',
                cursor: 'pointer',
                background: '#f8fafc',
                color: '#0f172a',
                border: '1px solid #cbd5e1',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px'
              }}
              title="Copy active filter list to clipboard"
            >
              📋 Copy {statusFilter === 'All' ? 'Full Report' : statusFilter === 'NotStarted' ? `Not Started (${notStartedCount})` : statusFilter === 'Partially' ? `Pending (${partiallyCount})` : `Completed (${completedCount})`}
            </button>

            <button
              type="button"
              onClick={() => {
                const targetScope = statusFilter === 'All' ? 'full' : statusFilter;
                shareReportViaWhatsApp(targetScope);
              }}
              style={{
                padding: '6px 12px',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: '800',
                cursor: 'pointer',
                background: '#ecfdf5',
                color: '#047857',
                border: '1px solid #a7f3d0',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px'
              }}
              title="Share active filter list to Staff WhatsApp Group"
            >
              💬 Share WA
            </button>
          </div>
        </div>

        {/* COMPLETION TRACKER TABLE */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '11px', fontWeight: '800', textTransform: 'uppercase' }}>
                <th style={{ padding: '14px 16px' }}>#</th>
                <th style={{ padding: '14px 16px' }}>TEACHER</th>
                <th style={{ padding: '14px 16px' }}>SUBJECT BATCH</th>
                <th style={{ padding: '14px 16px', textAlign: 'center' }}>TARGET LEVEL</th>
                <th style={{ padding: '14px 16px', textAlign: 'center' }}>PROGRESS</th>
                <th style={{ padding: '14px 16px', textAlign: 'right' }}>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {filteredTrackerRows.length === 0 ? (
                <tr><td colSpan="6" style={{ padding: '28px', textAlign: 'center', color: '#64748b' }}>No matching records found.</td></tr>
              ) : (
                filteredTrackerRows.map((row, idx) => {
                  const lvlLabel = getLevelLabel(row);
                  const isNotStarted = row.enteredCount === 0 && row.totalEnrolled > 0;
                  const isPartial = row.enteredCount > 0 && row.missingCount > 0;
                  const isDone = row.missingCount === 0;

                  return (
                    <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9', background: '#ffffff' }}>
                      <td style={{ padding: '14px 16px', color: '#64748b' }}>{idx + 1}</td>
                      <td style={{ padding: '14px 16px', fontWeight: '700', color: '#0f172a' }}>{row.teacherName}</td>
                      <td style={{ padding: '14px 16px', color: '#334155', fontWeight: '600' }}>{row.subject}</td>
                      <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                        <span style={{ background: '#f1f5f9', color: '#475569', padding: '3px 8px', borderRadius: '6px', fontWeight: '700', fontSize: '11px' }}>
                          {lvlLabel}
                        </span>
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'center', fontWeight: '600', color: '#475569' }}>
                        {row.enteredCount} / {row.totalEnrolled}
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        {isDone ? (
                          <span style={{ background: '#dcfce7', color: '#15803d', padding: '4px 10px', borderRadius: '999px', fontWeight: '700', fontSize: '11px' }}>
                            Completed
                          </span>
                        ) : isNotStarted ? (
                          <span style={{ background: '#fee2e2', color: '#dc2626', padding: '4px 10px', borderRadius: '999px', fontWeight: '700', fontSize: '11px' }}>
                            🔴 Not Started ({row.missingCount})
                          </span>
                        ) : (
                          <span style={{ background: '#fef3c7', color: '#b45309', padding: '4px 10px', borderRadius: '999px', fontWeight: '700', fontSize: '11px' }}>
                            🟡 {row.missingCount} Pending
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
