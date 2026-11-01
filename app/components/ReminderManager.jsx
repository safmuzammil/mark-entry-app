'use client';
import React, { useState, useEffect } from 'react';
import { db } from '../../lib/firebase';
import { doc, setDoc, getDoc, getDocs, collection } from 'firebase/firestore';
import {
  DEFAULT_SUBJECTS, CCE_LEVELS, HIFZ_LEVELS, styles
} from './erpConstants';
import { openWhatsAppGroupAndCopy } from './ErpExtensions';

export default function ReminderManager() {
  const [weekName, setWeekName] = useState('Week 3');
  const [targetConfigs, setTargetConfigs] = useState({});
  const [message, setMessage] = useState('Please complete your mark entry for this week.');
  const [isActive, setIsActive] = useState(false);
  const [trackerData, setTrackerData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  // Staff WhatsApp Group Link State
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
    alert('Reminder settings updated and broadcasted to teachers & students!');
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

  return (
    <div style={styles.card}>
      <h3 style={styles.sectionTitle}>📅 Weekly Mark Entry Reminder &amp; Staff WhatsApp Group Tracker</h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginBottom: '24px', background: '#f8fafc', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px' }}>
          <div style={{ flex: '1 1 150px' }}>
            <label style={styles.label}>Academic Week:</label>
            <input type="text" value={weekName} onChange={(e) => setWeekName(e.target.value)} placeholder="e.g. Week 3" style={styles.input} />
          </div>
          <div style={{ flex: '2 1 300px' }}>
            <label style={styles.label}>Reminder Message for Teachers &amp; Students:</label>
            <input type="text" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. Please complete your mark entry for this week." style={styles.input} />
          </div>
        </div>

        <div>
          <label style={styles.label}>Select Subjects &amp; Check One or Multiple Levels:</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', background: '#ffffff', padding: '20px', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
            {DEFAULT_SUBJECTS.map(sub => {
              const isSubHifz = sub.toUpperCase() === 'HIFZ';
              const levelOptions = isSubHifz ? HIFZ_LEVELS : CCE_LEVELS;
              const selectedLevels = Array.isArray(targetConfigs[sub])
                ? targetConfigs[sub]
                : (targetConfigs[sub] ? [String(targetConfigs[sub])] : []);
              const isSubjectChecked = selectedLevels.length > 0;

              return (
                <div key={sub} style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: isSubjectChecked ? '#eff6ff' : '#f8fafc', padding: '10px 14px', borderRadius: '10px', border: `1px solid ${isSubjectChecked ? '#93c5fd' : '#e2e8f0'}` }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', cursor: 'pointer', color: '#0f172a', fontWeight: '800' }}>
                    <input type="checkbox" checked={isSubjectChecked} onChange={() => toggleSubjectConfig(sub)} style={{ width: '16px', height: '16px', accentColor: '#2563eb' }} />
                    {sub}
                  </label>

                  {isSubjectChecked && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', paddingTop: '4px', borderTop: '1px dashed #bfdbfe' }}>
                      {Object.entries(levelOptions).map(([name, val]) => {
                        const isLvlSelected = selectedLevels.includes(val);
                        const shortLabel = isSubHifz ? name.replace(' (Max 50)', '') : `${name.replace('Level ', 'Lvl ')} (/${val})`;
                        return (
                          <button
                            key={val}
                            type="button"
                            onClick={() => toggleSubjectLevel(sub, val)}
                            style={{
                              padding: '4px 10px',
                              borderRadius: '6px',
                              fontSize: '12px',
                              fontWeight: '800',
                              cursor: 'pointer',
                              border: isLvlSelected ? '1px solid #2563eb' : '1px solid #cbd5e1',
                              background: isLvlSelected ? '#2563eb' : '#ffffff',
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
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', flexWrap: 'wrap', marginTop: '8px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '700', color: isActive ? '#047857' : '#64748b', background: isActive ? '#d1fae5' : '#e2e8f0', padding: '12px 16px', borderRadius: '8px', cursor: 'pointer', border: `1px solid ${isActive ? '#34d399' : '#cbd5e1'}` }}>
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} style={{ width: '18px', height: '18px' }} />
            {isActive ? 'Reminder is ACTIVE' : 'Reminder is OFF'}
          </label>
          <button onClick={handleSave} disabled={isLoading} style={{ ...styles.buttonPrimary, padding: '12px 24px', margin: 0 }}>
            {isLoading ? 'Saving...' : '💾 Save & Broadcast to Portal'}
          </button>
        </div>
      </div>

      {/* STAFF WHATSAPP GROUP REMINDER BAR */}
      <div style={{ background: '#f0fdf4', border: '2px solid #16a34a', padding: '16px 20px', borderRadius: '12px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h4 style={{ margin: 0, color: '#14532d', fontSize: '16px', fontWeight: '800' }}>
              💬 Send Pending Mark Entry Reminder to Official Staff WhatsApp Group
            </h4>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#166534', fontWeight: '600' }}>
              Automatically copies the formatted pending teachers list and opens your Staff WhatsApp Group directly.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setEditingGroupLink(!editingGroupLink)}
              style={{ padding: '9px 14px', background: '#ffffff', color: '#15803d', border: '1px solid #86efac', borderRadius: '8px', fontWeight: '800', fontSize: '12px', cursor: 'pointer' }}
            >
              🔗 {staffGroupLink ? 'Edit Staff Group Link' : 'Set Staff WhatsApp Group Link'}
            </button>
            <button
              type="button"
              onClick={() => {
                const text = buildStaffGroupPendingReportText();
                navigator.clipboard.writeText(text);
                alert('✅ Copied formatted Pending Mark Entry Report to clipboard!');
              }}
              style={{ padding: '9px 14px', background: '#f59e0b', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '800', fontSize: '12px', cursor: 'pointer' }}
            >
              📋 Copy Report Text
            </button>
            <button
              type="button"
              onClick={() => {
                const text = buildStaffGroupPendingReportText();
                openWhatsAppGroupAndCopy(staffGroupLink, text, 'DHIU Staff WhatsApp Group');
              }}
              style={{ padding: '9px 18px', background: '#16a34a', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '800', fontSize: '13px', cursor: 'pointer' }}
            >
              💬 Open Staff WhatsApp Group &amp; Send
            </button>
          </div>
        </div>

        {editingGroupLink && (
          <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
            <input
              type="text"
              value={staffGroupLink}
              onChange={(e) => setStaffGroupLink(e.target.value)}
              placeholder="Paste Staff WhatsApp Group Invite Link (https://chat.whatsapp.com/...)..."
              style={{ ...styles.input, flex: 1 }}
            />
            <button type="button" onClick={handleSaveStaffGroupLink} style={{ padding: '10px 18px', background: '#15803d', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: '800', cursor: 'pointer' }}>
              Save Link
            </button>
          </div>
        )}
      </div>

      <h4 style={{ margin: '0 0 16px 0', color: '#0f172a', fontWeight: '800' }}>
        Teacher Completion Tracker ({weekName})
      </h4>
      <div style={{ overflowX: 'auto', border: '1px solid #cbd5e1', borderRadius: '12px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '15px', minWidth: '800px' }}>
          <thead>
            <tr style={{ background: '#f1f5f9', borderBottom: '2px solid #cbd5e1' }}>
              <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800' }}>Teacher Name</th>
              <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800' }}>Subject Assignment</th>
              <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', textAlign: 'center' }}>Target Level</th>
              <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', textAlign: 'center' }}>Enrolled</th>
              <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', textAlign: 'center' }}>Missing</th>
              <th style={{ padding: '14px 16px', color: '#0f172a', fontWeight: '800', textAlign: 'center' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {trackerData.length === 0 ? (
              <tr><td colSpan="6" style={{ padding: '20px', textAlign: 'center', color: '#64748b' }}>No teachers match this week&apos;s active targets.</td></tr>
            ) : (
              trackerData.map((row, idx) => {
                const lvlLabel = row.levelRequired === '50_1' ? 'Part 1 (/50)'
                  : row.levelRequired === '50_2' ? 'Part 2 (/50)'
                    : `Max ${row.levelRequired}`;
                return (
                  <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0', background: '#ffffff' }}>
                    <td style={{ padding: '14px 16px', fontWeight: '800', color: '#0f172a' }}>{row.teacherName}</td>
                    <td style={{ padding: '14px 16px', color: '#334155', fontWeight: '700' }}>{row.subject}</td>
                    <td style={{ padding: '14px 16px', textAlign: 'center' }}><span style={{ background: '#e0f2fe', color: '#0369a1', padding: '4px 8px', borderRadius: '6px', fontWeight: '800', fontSize: '13px' }}>{lvlLabel}</span></td>
                    <td style={{ padding: '14px 16px', textAlign: 'center', fontWeight: '700', color: '#64748b' }}>{row.totalEnrolled}</td>
                    <td style={{ padding: '14px 16px', textAlign: 'center', fontWeight: '800', color: row.missingCount > 0 ? '#ef4444' : '#10b981' }}>{row.missingCount}</td>
                    <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                      {row.missingCount === 0 ? (
                        <span style={{ background: '#d1fae5', color: '#047857', padding: '6px 12px', borderRadius: '6px', fontWeight: '800', fontSize: '13px' }}>✅ DONE</span>
                      ) : row.enteredCount > 0 ? (
                        <span style={{ background: '#fef3c7', color: '#d97706', padding: '6px 12px', borderRadius: '6px', fontWeight: '800', fontSize: '13px' }}>⏳ IN PROGRESS</span>
                      ) : (
                        <span style={{ background: '#fee2e2', color: '#dc2626', padding: '6px 12px', borderRadius: '6px', fontWeight: '800', fontSize: '13px' }}>❌ PENDING</span>
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
  );
}