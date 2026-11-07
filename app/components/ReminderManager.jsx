'use client';
import React, { useState, useEffect } from 'react';
import { db } from '../../lib/firebase';
import { doc, setDoc, getDoc, getDocs, collection } from 'firebase/firestore';
import {
  DEFAULT_SUBJECTS, CCE_LEVELS, HIFZ_LEVELS, styles
} from './erpConstants';
import {CollapsibleCard, openWhatsAppGroupAndCopy } from './ErpExtensions';

export default function ReminderManager() {
  const [weekName, setWeekName] = useState('Week 3');
  const [targetConfigs, setTargetConfigs] = useState({});
  const [message, setMessage] = useState('Please complete your mark entry for this week.');
  const [isActive, setIsActive] = useState(false);
  const [trackerData, setTrackerData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  // Minimalist Top Panel & Filter States
  const [activeTopPanel, setActiveTopPanel] = useState('none'); // 'none' | 'config' | 'whatsapp'
  const [statusFilter, setStatusFilter] = useState('All'); // 'All' | 'Pending' | 'Completed'
  const [searchQuery, setSearchQuery] = useState('');

  const [staffGroupLink, setStaffGroupLink] = useState('');
  const [editingGroupLink, setEditingGroupLink] = useState(false);

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
            const isUrdu = String(student.adNo || '').toUpperCase().startsWith('U');
            if (env.studentIds && Array.isArray(env.studentIds) && env.studentIds.length > 0) {
              const savedIds = env.studentIds.map(id => String(id).trim());
              if (savedIds.includes(student.regNo) || savedIds.includes(student.adNo)) return true;
            }
            let classMatch = studentClassesLower.some(cls => envAliasLower.includes(cls));
            if (!classMatch && envAliasLower.includes('m10')) {
              if (studentClassesLower.some(cls => cls.includes('3')) && !isUrdu) classMatch = true;
            }
            if (classMatch) {
              if (envLang.includes('urdu') && !envLang.includes('non')) return isUrdu;
              if (envLang.includes('gen') || envLang.includes('non') || envLang === '') return !isUrdu;
              return true;
            }
            return false;
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
              teacherName: teacher.fullName,
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

  const buildStaffGroupPendingReportText = () => {
    const pendingRows = trackerData.filter(r => r.missingCount > 0);
    const doneRows = trackerData.filter(r => r.missingCount === 0);
    const lines = [
      `*DARUL HUDA DEGREE SECTION — CCE MARK ENTRY REMINDER*`,
      `*Week:* ${weekName}`,
      `*Notice:* ${message}`,
      `-----------------------------------------`
    ];
    if (pendingRows.length > 0) {
      lines.push(`*⏳ PENDING / INCOMPLETE SUBMISSIONS (${pendingRows.length}):*`);
      pendingRows.forEach((r, i) => {
        const lvl = r.levelRequired === '50_1' ? 'Part 1 (/50)' : r.levelRequired === '50_2' ? 'Part 2 (/50)' : `Lvl (/${r.levelRequired})`;
        lines.push(`${i + 1}. *${r.teacherName}* — ${r.subject} [${lvl}]: *${r.missingCount} pending*`);
      });
    } else {
      lines.push(`✅ All targeted teachers have completed 100% of their mark entries for ${weekName}!`);
    }
    if (doneRows.length > 0) {
      lines.push(`\n*✅ COMPLETED (${doneRows.length}):*`);
      doneRows.forEach(r => {
        lines.push(`• ${r.teacherName} (${r.subject})`);
      });
    }
    return lines.join('\n');
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
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
              background: activeTopPanel === 'whatsapp' ? '#eef2ff' : '#ffffff',
              color: '#4f46e5',
              border: '1px solid #c7d2fe',
              borderRadius: '8px',
              fontWeight: '700',
              fontSize: '13px',
              cursor: 'pointer'
            }}
          >
            💬 Staff WA Reminder
          </button>
        </div>
      </div>

      {/* 🌟 MARKS-AUDITOR STYLE SOFT PASTEL KPI ROW */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
        <div onClick={() => setStatusFilter('All')} style={{ padding: '18px', borderRadius: '12px', background: '#f8fafc', border: '1px solid #e2e8f0', textAlign: 'center', cursor: 'pointer' }}>
          <span style={{ fontSize: '11px', fontWeight: '800', color: '#475569' }}>TARGETED BATCHES</span>
          <div style={{ fontSize: '26px', fontWeight: '900', color: '#0f172a', marginTop: '4px' }}>{trackerData.length}</div>
        </div>
        <div onClick={() => setStatusFilter('Completed')} style={{ padding: '18px', borderRadius: '12px', background: '#ecfdf5', border: '1px solid #a7f3d0', textAlign: 'center', cursor: 'pointer' }}>
          <span style={{ fontSize: '11px', fontWeight: '800', color: '#047857' }}>COMPLETED (100%)</span>
          <div style={{ fontSize: '26px', fontWeight: '900', color: '#065f46', marginTop: '4px' }}>{completedCount}</div>
        </div>
        <div onClick={() => setStatusFilter('Pending')} style={{ padding: '18px', borderRadius: '12px', background: '#fff1f2', border: '1px solid #fecdd3', textAlign: 'center', cursor: 'pointer' }}>
          <span style={{ fontSize: '11px', fontWeight: '800', color: '#be123c' }}>MISSING / PENDING</span>
          <div style={{ fontSize: '26px', fontWeight: '900', color: '#e11d48', marginTop: '4px' }}>{pendingCount}</div>
        </div>
        <div style={{ padding: '18px', borderRadius: '12px', background: '#eff6ff', border: '1px solid #bfdbfe', textAlign: 'center' }}>
          <span style={{ fontSize: '11px', fontWeight: '800', color: '#1d4ed8' }}>COMPLETION RATE</span>
          <div style={{ fontSize: '26px', fontWeight: '900', color: '#2563eb', marginTop: '4px' }}>{completionPct}%</div>
        </div>
      </div>

      {/* PANEL 1: CONFIGURE TARGETS (Opens only when clicked) */}
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

      {/* PANEL 2: WHATSAPP GROUP REMINDER (Opens only when clicked) */}
      {activeTopPanel === 'whatsapp' && (
        <div className="erp-slide-panel" style={styles.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <h4 style={{ margin: 0, fontSize: '15px', fontWeight: '800', color: '#0f172a' }}>Send Pending Report to Staff WhatsApp Group</h4>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>Copies the formatted list of pending submissions and opens your Staff WhatsApp Group.</p>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setEditingGroupLink(!editingGroupLink)} style={styles.buttonSecondary}>
                🔗 {staffGroupLink ? 'Edit Group Link' : 'Set Group Link'}
              </button>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(buildStaffGroupPendingReportText());
                  alert('✅ Copied Pending Mark Entry Report to clipboard!');
                }}
                style={styles.buttonSecondary}
              >
                📋 Copy Text
              </button>
              <button
                type="button"
                onClick={() => openWhatsAppGroupAndCopy(staffGroupLink, buildStaffGroupPendingReportText(), 'DHIU Staff WhatsApp Group')}
                style={styles.buttonPrimary}
              >
                💬 Open Staff Group &amp; Send
              </button>
            </div>
          </div>

          {editingGroupLink && (
            <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
              <input
                type="text"
                value={staffGroupLink}
                onChange={(e) => setStaffGroupLink(e.target.value)}
                placeholder="Paste Staff WhatsApp Group Invite Link..."
                style={{ ...styles.input, flex: 1 }}
              />
              <button type="button" onClick={handleSaveStaffGroupLink} style={styles.buttonPrimary}>Save Link</button>
            </div>
          )}
        </div>
      )}

      {/* 🌟 MINIMALIST COMPLETION TRACKER TABLE */}
      <div style={{ ...styles.card, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <input
            type="text"
            placeholder="🔍 Search teacher or subject..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ ...styles.input, maxWidth: '280px', padding: '7px 12px', fontSize: '13px' }}
          />
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
                  border: '1px solid #e2e8f0'
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

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
                  const lvlLabel = row.levelRequired === '50_1' ? 'Part 1 (/50)'
                    : row.levelRequired === '50_2' ? 'Part 2 (/50)'
                    : `Max ${row.levelRequired}`;
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
                        {row.missingCount === 0 ? (
                          <span style={{ background: '#dcfce7', color: '#15803d', padding: '4px 10px', borderRadius: '999px', fontWeight: '700', fontSize: '11px' }}>
                            Completed
                          </span>
                        ) : (
                          <span style={{ background: '#fff1f2', color: '#e11d48', padding: '4px 10px', borderRadius: '999px', fontWeight: '700', fontSize: '11px' }}>
                            {row.missingCount} Pending
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