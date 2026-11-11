"use client";

import React, { useState, useEffect, useMemo } from "react";
import { db } from "@/lib/firebase";
import {
  collection,
  doc,
  setDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  getDocs,
} from "firebase/firestore";
import { ProfileAvatar } from "@/app/components/ErpExtensions";
import { isWaiverActiveOnDate } from "@/app/components/erpConstants";

const ILLNESS_PRESETS = [
  "CUSTOM",
  "Acute Viral Fever / High Temperature",
  "Severe Stomach Flu / Food Poisoning",
  "Severe Migraine / Headache",
  "Vomiting / Acute Nausea",
  "Cold / Cough / Throat Infection",
  "Asthma / Respiratory Distress",
  "Bed Rest Advised by Doctor",
];

const QUICK_ILLNESS_CHIPS = [
  { label: "🤒 Fever / Flu", value: "Acute Viral Fever / High Temperature" },
  { label: "🤢 Stomach Ache", value: "Severe Stomach Flu / Food Poisoning" },
  { label: "🤕 Headache", value: "Severe Migraine / Headache" },
  { label: "🤮 Vomiting", value: "Vomiting / Acute Nausea" },
  { label: "🤧 Cold / Cough", value: "Cold / Cough / Throat Infection" },
];

const addDaysToToday = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
};

export default function SickInRoomSubTab({
  students = [],
  teachers = [],
  loggedInUser = null,
  isAdmin = false,
  classTeacherOf = [],
  onWaiverCreated = null,
}) {
  const [activeWaivers, setActiveWaivers] = useState([]);
  const [revokedWaivers, setRevokedWaivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewHistory, setViewHistory] = useState(false);
  const [selectedClassFilter, setSelectedClassFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  // Modal State (Streamlined: Reason & End Date Only)
  const [showGrantModal, setShowGrantModal] = useState(false);
  const [selectedStudentAd, setSelectedStudentAd] = useState("");
  const [studentSearchInput, setStudentSearchInput] = useState("");
  const [reasonPreset, setReasonPreset] = useState("CUSTOM");
  const [customReason, setCustomReason] = useState("");
  const [durationPreset, setDurationPreset] = useState("TODAY");
  const [validUntil, setValidUntil] = useState(() => addDaysToToday(0));
  const [savingWaiver, setSavingWaiver] = useState(false);

  // Overnight Bed-Rest Handshake Queue State
  const [handshakeQueue, setHandshakeQueue] = useState([]);
  const [handshakeLoading, setHandshakeLoading] = useState(false);

  // Allowed Classes & Grades for User (Permits own class + same grade class teachers + admin all campus)
  const allowedClassesAndGrades = useMemo(() => {
    if (isAdmin) return { isAdmin: true, allowedClasses: [], allowedGrades: [] };
    const myClasses = Array.isArray(classTeacherOf) ? classTeacherOf : [];
    const myGrades = new Set();
    myClasses.forEach(c => {
      const m = String(c).match(/\d+/);
      if (m) myGrades.add(m[0]);
    });
    return {
      isAdmin: false,
      allowedClasses: myClasses,
      allowedGrades: Array.from(myGrades)
    };
  }, [isAdmin, classTeacherOf]);

  const allowedClasses = allowedClassesAndGrades.allowedClasses;

  const canManageStudent = (st) => {
    if (isAdmin) return true;
    const { allowedClasses: myCls, allowedGrades: myGrd } = allowedClassesAndGrades;
    if (myCls.length === 0 && myGrd.length === 0) return false;
    const stClasses = Array.isArray(st.classes)
      ? st.classes
      : st.class
      ? [st.class]
      : [];
    // 1. Direct class match
    if (stClasses.some((c) => myCls.includes(c))) return true;
    // 2. Same-grade class teacher match
    const stGrades = stClasses.map(c => {
      const m = String(c).match(/\d+/);
      return m ? m[0] : null;
    }).filter(Boolean);
    return stGrades.some((g) => myGrd.includes(g));
  };

  // 1. Subscribe to campus_medical_waivers in real-time with explicit cleanup
  useEffect(() => {
    setLoading(true);
    const q = query(
      collection(db, "campus_medical_waivers"),
      where("waiverType", "==", "SICK_IN_ROOM"),
      orderBy("issuedAt", "desc"),
      limit(200)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const todayStr = new Date().toISOString().split("T")[0];
        const active = [];
        const revoked = [];
        snapshot.forEach((docSnap) => {
          const data = { id: docSnap.id, ...docSnap.data() };
          if (data.status === "ACTIVE" && isWaiverActiveOnDate(data, todayStr)) {
            active.push(data);
          } else {
            revoked.push(data);
          }
        });
        setActiveWaivers(active);
        setRevokedWaivers(revoked);
        setLoading(false);
      },
      (err) => {
        console.error("Error listening to sick waivers:", err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  // 2. Load Overnight Bed-Rest Handshake Queue from Night Attendance
  useEffect(() => {
    async function loadOvernightHandshakeQueue() {
      setHandshakeLoading(true);
      try {
        const todayStr = new Date().toISOString().split("T")[0];
        const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];

        const datesToCheck = [todayStr, yesterday];
        const candidates = [];

        for (const date of datesToCheck) {
          const docSnap = await getDocs(
            query(collection(db, "night_attendance"), where("date", "==", date), limit(1))
          );
          docSnap.forEach((d) => {
            const data = d.data();
            const classesMap = data.classes || {};
            Object.entries(classesMap).forEach(([clsName, clsData]) => {
              if (!isAdmin && allowedClasses.length > 0 && !allowedClasses.includes(clsName)) return;
              const statusMap = clsData.statusMap || {};
              Object.entries(statusMap).forEach(([adNo, status]) => {
                if (status === "SICK_ROOM" || status === "SICK") {
                  candidates.push({
                    adNo,
                    className: clsName,
                    nightDate: date,
                    nightSessionName: clsData.recordedByName || "Hostel Warden",
                  });
                }
              });
            });
          });
        }

        // Deduplicate and filter out candidates that already have an active waiver
        const activeAdNos = new Set(activeWaivers.map((w) => String(w.adNo).trim()));
        const uniqueCandidates = [];
        const seen = new Set();
        candidates.forEach((c) => {
          const key = String(c.adNo).trim();
          if (!activeAdNos.has(key) && !seen.has(key)) {
            seen.add(key);
            const st = students.find((s) => String(s.adNo).trim() === key);
            uniqueCandidates.push({
              ...c,
              studentName: st?.firstName || `Student #${c.adNo}`,
              regNo: st?.regNo || c.adNo,
            });
          }
        });

        setHandshakeQueue(uniqueCandidates);
      } catch (err) {
        console.error("Error loading handshake queue:", err);
      } finally {
        setHandshakeLoading(false);
      }
    }

    if (students.length > 0) {
      loadOvernightHandshakeQueue();
    }
  }, [students, activeWaivers, isAdmin, allowedClasses]);

  // Handle Granting Formal Waiver
  const handleGrantWaiver = async (e) => {
    e.preventDefault();
    if (!selectedStudentAd) {
      alert("Please select a student.");
      return;
    }

    const st = students.find((s) => String(s.adNo).trim() === String(selectedStudentAd).trim());
    if (!st) {
      alert("Student not found.");
      return;
    }

    if (!canManageStudent(st)) {
      alert("Permission denied. You can only grant leaves for your assigned class students.");
      return;
    }

    const effectiveReason = reasonPreset === "CUSTOM"
      ? (customReason.trim() || "Acute Illness / Bed Rest")
      : (customReason.trim() ? customReason.trim() : reasonPreset);
    const waiverId = `waiver_${Date.now()}_${st.adNo}`;
    const nowIso = new Date().toISOString();
    const todayStr = nowIso.split("T")[0];

    setSavingWaiver(true);
    try {
      const payload = {
        id: waiverId,
        studentRegNo: st.regNo || String(st.adNo),
        adNo: st.adNo,
        studentName: st.firstName || `Student #${st.adNo}`,
        className: st.studentClass || (st.classes && st.classes[0]) || st.class || "General",
        department: st.department || "GENERAL",
        waiverType: "SICK_IN_ROOM",
        injuryReason: effectiveReason,
        validUntil: validUntil || todayStr,
        roomNumber: null,
        notes: null,
        issuedBy: loggedInUser?.username || "teacher",
        issuedByName: loggedInUser?.fullName || loggedInUser?.username || "Class Teacher",
        issuedByRole: isAdmin ? "ADMIN" : "CLASS_TEACHER",
        issuedAt: nowIso,
        status: "ACTIVE",
        revokedAt: null,
        revokedBy: null,
        revokedByName: null,
        revocationNotes: null,
      };

      await setDoc(doc(db, "campus_medical_waivers", waiverId), payload);

      setShowGrantModal(false);
      setSelectedStudentAd("");
      setCustomReason("");
      setReasonPreset("CUSTOM");
      setDurationPreset("TODAY");
      setValidUntil(addDaysToToday(0));

      if (typeof onWaiverCreated === "function") {
        onWaiverCreated();
      }

      alert(`✅ Sick in Room Bed-Rest Waiver granted for ${st.firstName} (#${st.adNo})!`);
    } catch (err) {
      console.error("Error granting sick waiver:", err);
      alert("Error saving waiver: " + err.message);
    } finally {
      setSavingWaiver(false);
    }
  };

  // Handle Revoking Waiver (Mark Recovered)
  const handleRevokeWaiver = async (waiver) => {
    const confirmPrompt = `Mark ${waiver.studentName} (#${waiver.adNo}) as Recovered? This will end their bed-rest status and resume normal classroom roll-call.`;
    if (!window.confirm(confirmPrompt)) return;

    try {
      const nowIso = new Date().toISOString();
      await setDoc(
        doc(db, "campus_medical_waivers", waiver.id),
        {
          status: "REVOKED",
          revokedAt: nowIso,
          revokedBy: loggedInUser?.username || "teacher",
          revokedByName: loggedInUser?.fullName || loggedInUser?.username || "Class Teacher",
          revocationNotes: "Marked recovered by faculty",
        },
        { merge: true }
      );
      alert(`✅ Bed-rest waiver revoked. ${waiver.studentName} is marked recovered.`);
    } catch (err) {
      console.error("Error revoking waiver:", err);
      alert("Error revoking waiver: " + err.message);
    }
  };

  // Quick Action from Handshake Queue
  const handleQuickGrantFromQueue = (candidate) => {
    setSelectedStudentAd(candidate.adNo);
    setCustomReason("Overnight hostel bed rest reported by warden");
    setShowGrantModal(true);
  };

  // Eligible students for modal (Admin: all campus students, Class Teacher: own class + same grade classes)
  const eligibleStudents = useMemo(() => {
    return students.filter((s) => canManageStudent(s));
  }, [students, isAdmin, allowedClassesAndGrades]);

  // Reactive matching students for modal search by Name or Ad.No
  const matchingModalStudents = useMemo(() => {
    const q = studentSearchInput.trim().toLowerCase();
    if (!q) return eligibleStudents.slice(0, 12);
    return eligibleStudents.filter((st) => {
      const name = String(st.firstName || st.name || "").toLowerCase();
      const ad = String(st.adNo || "").toLowerCase();
      const reg = String(st.regNo || "").toLowerCase();
      const cls = Array.isArray(st.classes) ? st.classes.join(" ").toLowerCase() : String(st.class || "").toLowerCase();
      return name.includes(q) || ad.includes(q) || reg.includes(q) || cls.includes(q);
    }).slice(0, 15);
  }, [eligibleStudents, studentSearchInput]);

  const selectedStudentObj = useMemo(() => {
    if (!selectedStudentAd) return null;
    return eligibleStudents.find((s) => String(s.adNo).trim() === String(selectedStudentAd).trim()) ||
           students.find((s) => String(s.adNo).trim() === String(selectedStudentAd).trim());
  }, [selectedStudentAd, eligibleStudents, students]);

  // Filtered Display List
  const displayedWaivers = (viewHistory ? revokedWaivers : activeWaivers).filter((w) => {
    if (!isAdmin && allowedClasses.length > 0 && !allowedClasses.includes(w.className)) return false;
    if (selectedClassFilter !== "ALL" && w.className !== selectedClassFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = (w.studentName || "").toLowerCase().includes(q);
      const matchAd = String(w.adNo || "").includes(q);
      const matchReason = (w.injuryReason || "").toLowerCase().includes(q);
      return matchName || matchAd || matchReason;
    }
    return true;
  });

  return (
    <div style={{ padding: "8px 0" }}>
      {/* 🌟 OVERNIGHT HANDSHAKE QUEUE BANNER */}
      {handshakeQueue.length > 0 && (
        <div
          style={{
            background: "#fffbeb",
            border: "1.5px solid #fde68a",
            borderRadius: "12px",
            padding: "16px 18px",
            marginBottom: "20px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "20px" }}>🛌</span>
              <div>
                <strong style={{ color: "#92400e", fontSize: "14px" }}>
                  Overnight Bed-Rest Reports Awaiting Class Teacher Handshake ({handshakeQueue.length})
                </strong>
                <div style={{ fontSize: "12px", color: "#b45309", marginTop: "2px" }}>
                  Hostel wardens marked these residents sick in room during night roll-call. Confirm to grant official classroom medical leave.
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "10px", marginTop: "12px" }}>
            {handshakeQueue.map((c) => (
              <div
                key={c.adNo}
                style={{
                  background: "#ffffff",
                  border: "1px solid #fde68a",
                  borderRadius: "8px",
                  padding: "10px 12px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontWeight: "700", color: "#0f172a", fontSize: "13px" }}>
                    {c.studentName}
                  </div>
                  <div style={{ fontSize: "11px", color: "#64748b" }}>
                    #{c.adNo} • {c.className} • Night: {c.nightDate}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleQuickGrantFromQueue(c)}
                  style={{
                    background: "#fef3c7",
                    color: "#92400e",
                    border: "1px solid #fde68a",
                    borderRadius: "6px",
                    padding: "5px 10px",
                    fontSize: "11px",
                    fontWeight: "800",
                    cursor: "pointer",
                  }}
                >
                  + Grant Leave
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 🌟 TOOLBAR: KPI STRIP & ACTIONS */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "14px",
          marginBottom: "18px",
        }}
      >
        <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
          <div
            style={{
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: "10px",
              padding: "10px 16px",
              display: "flex",
              alignItems: "center",
              gap: "10px",
            }}
          >
            <span style={{ fontSize: "20px" }}>🤒</span>
            <div>
              <div style={{ fontSize: "11px", color: "#64748b", fontWeight: "700" }}>ACTIVE BED REST</div>
              <div style={{ fontSize: "18px", fontWeight: "900", color: "#b45309" }}>
                {activeWaivers.length} Student{activeWaivers.length === 1 ? "" : "s"}
              </div>
            </div>
          </div>

          <div
            style={{
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: "10px",
              padding: "10px 16px",
              display: "flex",
              alignItems: "center",
              gap: "10px",
            }}
          >
            <span style={{ fontSize: "20px" }}>🏫</span>
            <div>
              <div style={{ fontSize: "11px", color: "#64748b", fontWeight: "700" }}>MY SCOPE</div>
              <div style={{ fontSize: "13px", fontWeight: "800", color: "#0f172a" }}>
                {isAdmin ? "Central Admin (All Classes)" : allowedClasses.length > 0 ? `Class Teacher (${allowedClasses.join(", ")})` : "View Only"}
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => setViewHistory(!viewHistory)}
            style={{
              padding: "9px 15px",
              background: viewHistory ? "#0f172a" : "#f1f5f9",
              color: viewHistory ? "#ffffff" : "#475569",
              border: "1px solid #cbd5e1",
              borderRadius: "8px",
              fontSize: "12px",
              fontWeight: "700",
              cursor: "pointer",
            }}
          >
            {viewHistory ? "← Show Active Sick Students" : "📜 Show Revoked / History"}
          </button>

          {(isAdmin || allowedClasses.length > 0) && (
            <button
              type="button"
              onClick={() => {
                setSelectedStudentAd("");
                setShowGrantModal(true);
              }}
              style={{
                padding: "9px 18px",
                background: "#d97706",
                color: "#ffffff",
                border: "none",
                borderRadius: "8px",
                fontSize: "13px",
                fontWeight: "800",
                cursor: "pointer",
                boxShadow: "0 2px 4px rgba(217,119,6,0.25)",
              }}
            >
              + Grant Sick in Room Leave
            </button>
          )}
        </div>
      </div>

      {/* 🌟 FILTER BAR */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "10px",
          background: "#ffffff",
          padding: "12px 16px",
          borderRadius: "10px",
          border: "1px solid #e2e8f0",
          marginBottom: "16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <input
            type="text"
            placeholder="Search student, #AdNo, or illness..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              padding: "7px 12px",
              border: "1px solid #cbd5e1",
              borderRadius: "6px",
              fontSize: "12px",
              width: "240px",
            }}
          />

          {isAdmin && (
            <select
              value={selectedClassFilter}
              onChange={(e) => setSelectedClassFilter(e.target.value)}
              style={{
                padding: "7px 10px",
                border: "1px solid #cbd5e1",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: "600",
              }}
            >
              <option value="ALL">All Classes</option>
              {Array.from(new Set(students.map((s) => s.classes?.[0] || s.class).filter(Boolean)))
                .sort()
                .map((cls) => (
                  <option key={cls} value={cls}>
                    {cls}
                  </option>
                ))}
            </select>
          )}
        </div>

        <div style={{ fontSize: "12px", color: "#64748b", fontWeight: "600" }}>
          Showing <strong>{displayedWaivers.length}</strong> {viewHistory ? "historical" : "active"} bed-rest records
        </div>
      </div>

      {/* 🌟 ROSTER TABLE */}
      {loading ? (
        <div style={{ padding: "40px", textAlign: "center", color: "#64748b", fontWeight: "600" }}>
          Loading sick in room waivers...
        </div>
      ) : displayedWaivers.length === 0 ? (
        <div
          style={{
            background: "#ffffff",
            border: "1px dashed #cbd5e1",
            borderRadius: "12px",
            padding: "36px",
            textAlign: "center",
            color: "#64748b",
          }}
        >
          <div style={{ fontSize: "28px", marginBottom: "8px" }}>🛌</div>
          <div style={{ fontWeight: "700", fontSize: "15px", color: "#0f172a" }}>
            {viewHistory ? "No historical bed-rest waivers found." : "No students currently on Sick in Room leave."}
          </div>
          <div style={{ fontSize: "12px", marginTop: "4px" }}>
            {viewHistory ? "Revoked records will appear here." : "All residents are currently cleared for normal classroom attendance."}
          </div>
        </div>
      ) : (
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "12px",
            overflow: "hidden",
            boxShadow: "0 1px 3px rgba(15,23,42,0.04)",
          }}
        >
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "13px" }}>
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", color: "#475569", fontWeight: "800", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  <th style={{ padding: "12px 16px" }}>Student</th>
                  <th style={{ padding: "12px 16px" }}>Class</th>
                  <th style={{ padding: "12px 16px" }}>Illness / Reason</th>
                  <th style={{ padding: "12px 16px" }}>Validity</th>
                  <th style={{ padding: "12px 16px" }}>Issued On</th>
                  <th style={{ padding: "12px 16px" }}>Authorized By</th>
                  <th style={{ padding: "12px 16px", textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayedWaivers.map((w) => {
                  const isRevoked = w.status === "REVOKED";
                  return (
                    <tr
                      key={w.id}
                      style={{
                        borderBottom: "1px solid #f1f5f9",
                        background: isRevoked ? "#fcfcfc" : "#ffffff",
                      }}
                    >
                      <td style={{ padding: "14px 16px" }}>
                        <div style={{ fontWeight: "800", color: "#0f172a" }}>{w.studentName}</div>
                        <div style={{ fontSize: "11px", color: "#64748b" }}>Ad.No: #{w.adNo} • Reg: {w.studentRegNo || "-"}</div>
                      </td>
                      <td style={{ padding: "14px 16px", fontWeight: "700", color: "#4f46e5" }}>
                        {w.className}
                      </td>
                      <td style={{ padding: "14px 16px" }}>
                        <span
                          style={{
                            background: "#fffbeb",
                            color: "#b45309",
                            border: "1px solid #fde68a",
                            padding: "3px 8px",
                            borderRadius: "6px",
                            fontSize: "11px",
                            fontWeight: "800",
                          }}
                        >
                          🤒 {w.injuryReason}
                        </span>
                        {w.notes && (
                          <div style={{ fontSize: "11px", color: "#64748b", marginTop: "4px" }}>
                            &ldquo;{w.notes}&rdquo;
                          </div>
                        )}
                      </td>
                      <td style={{ padding: "14px 16px", color: "#475569", fontSize: "12px" }}>
                        {w.validUntil ? (
                          <span style={{ fontWeight: "700", color: "#065f46", background: "#ecfdf5", padding: "3px 8px", borderRadius: "6px", border: "1px solid #a7f3d0" }}>
                            Until {w.validUntil}
                          </span>
                        ) : (
                          <span style={{ fontWeight: "600", color: "#64748b" }}>Open-Ended</span>
                        )}
                      </td>
                      <td style={{ padding: "14px 16px", color: "#64748b", fontSize: "12px" }}>
                        {new Date(w.issuedAt).toLocaleDateString("en-IN", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                      <td style={{ padding: "14px 16px" }}>
                        <div style={{ fontWeight: "700", color: "#0f172a" }}>{w.issuedByName}</div>
                        <div style={{ fontSize: "11px", color: "#64748b" }}>{w.issuedByRole}</div>
                      </td>
                      <td style={{ padding: "14px 16px", textAlign: "right" }}>
                        {isRevoked ? (
                          <span style={{ fontSize: "11px", color: "#64748b", background: "#f1f5f9", padding: "3px 8px", borderRadius: "6px", fontWeight: "700" }}>
                            Recovered ({w.revokedAt ? new Date(w.revokedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "Yes"})
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleRevokeWaiver(w)}
                            style={{
                              background: "#ecfdf5",
                              color: "#047857",
                              border: "1px solid #a7f3d0",
                              borderRadius: "6px",
                              padding: "6px 12px",
                              fontSize: "12px",
                              fontWeight: "800",
                              cursor: "pointer",
                            }}
                          >
                            ✓ Mark Recovered
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 🌟 GRANT SICK IN ROOM MODAL */}
      {showGrantModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.6)",
            backdropFilter: "blur(2px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: "16px",
          }}
          onClick={() => setShowGrantModal(false)}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: "16px",
              padding: "24px",
              maxWidth: "520px",
              width: "100%",
              boxShadow: "0 20px 25px -5px rgba(0,0,0,0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "18px", color: "#0f172a", fontWeight: "800" }}>
                  🤒 Grant Sick in Room (Bed Rest)
                </h3>
                <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                  Excuses student from class periods and congregational Jamath to rest in hostel.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGrantModal(false)}
                style={{ background: "none", border: "none", fontSize: "18px", cursor: "pointer", color: "#64748b" }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleGrantWaiver}>
              <div style={{ marginBottom: "14px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "700", color: "#334155", marginBottom: "6px" }}>
                  Select Student * {isAdmin ? "(Admin: All Campus Students)" : "(Your Class & Same Grade Classes)"}
                </label>

                {selectedStudentObj ? (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 14px",
                      background: "#f0fdf4",
                      border: "1.5px solid #86efac",
                      borderRadius: "10px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <ProfileAvatar
                        name={selectedStudentObj.firstName}
                        code={selectedStudentObj.adNo}
                        photoUrl={selectedStudentObj.photoUrl}
                        size={36}
                      />
                      <div>
                        <div style={{ fontWeight: "800", fontSize: "13px", color: "#166534" }}>
                          {selectedStudentObj.firstName}
                        </div>
                        <div style={{ fontSize: "11px", color: "#15803d", fontWeight: "600" }}>
                          Ad.No: #{selectedStudentObj.adNo} • Class: {(selectedStudentObj.classes || [selectedStudentObj.class] || []).join(", ")}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedStudentAd("");
                        setStudentSearchInput("");
                      }}
                      style={{
                        background: "#fee2e2",
                        border: "1px solid #fca5a5",
                        color: "#dc2626",
                        borderRadius: "6px",
                        padding: "5px 10px",
                        fontSize: "11px",
                        fontWeight: "800",
                        cursor: "pointer",
                      }}
                    >
                      ✕ Change
                    </button>
                  </div>
                ) : (
                  <div>
                    <input
                      type="text"
                      placeholder="🔍 Type student name or Ad.No (e.g. Salman or 3456)..."
                      value={studentSearchInput}
                      onChange={(e) => setStudentSearchInput(e.target.value)}
                      autoFocus
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        border: "1.5px solid #cbd5e1",
                        borderRadius: "8px",
                        fontSize: "13px",
                        outline: "none",
                        boxSizing: "border-box",
                      }}
                    />
                    <div style={{ fontSize: "11px", color: "#64748b", margin: "6px 0 8px 2px", fontWeight: "600" }}>
                      {eligibleStudents.length} eligible students in scope. Tap a student to select:
                    </div>

                    <div
                      style={{
                        maxHeight: "180px",
                        overflowY: "auto",
                        border: "1px solid #e2e8f0",
                        borderRadius: "8px",
                        padding: "4px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "4px",
                        background: "#f8fafc",
                      }}
                    >
                      {matchingModalStudents.length === 0 ? (
                        <div style={{ padding: "12px", textAlign: "center", color: "#94a3b8", fontSize: "12px" }}>
                          No students matching &ldquo;{studentSearchInput}&rdquo;
                        </div>
                      ) : (
                        matchingModalStudents.map((st) => (
                          <div
                            key={st.adNo}
                            onClick={() => {
                              setSelectedStudentAd(st.adNo);
                              setStudentSearchInput("");
                            }}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              padding: "8px 10px",
                              borderRadius: "6px",
                              background: "#ffffff",
                              border: "1px solid #e2e8f0",
                              cursor: "pointer",
                              transition: "all 0.1s ease",
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                            onMouseLeave={(e) => (e.currentTarget.style.background = "#ffffff")}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <ProfileAvatar name={st.firstName} code={st.adNo} photoUrl={st.photoUrl} size={28} />
                              <div>
                                <span style={{ fontWeight: "700", fontSize: "12px", color: "#0f172a" }}>
                                  {st.firstName}
                                </span>
                                <span style={{ fontSize: "11px", color: "#64748b", marginLeft: "6px" }}>
                                  #{st.adNo}
                                </span>
                              </div>
                            </div>
                            <span
                              style={{
                                fontSize: "10px",
                                fontWeight: "800",
                                background: "#eef2ff",
                                color: "#4f46e5",
                                padding: "2px 6px",
                                borderRadius: "4px",
                              }}
                            >
                              {(st.classes || [st.class] || []).join(", ")}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* 1. REASON SELECTION */}
              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "700", color: "#334155", marginBottom: "6px" }}>
                  Reason / Diagnosis *
                </label>
                <select
                  value={reasonPreset}
                  onChange={(e) => {
                    const val = e.target.value;
                    setReasonPreset(val);
                    if (val !== "CUSTOM") {
                      setCustomReason(val);
                    }
                  }}
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    border: "1.5px solid #cbd5e1",
                    borderRadius: "8px",
                    fontSize: "13px",
                    background: "#ffffff",
                    marginBottom: "8px",
                  }}
                >
                  <option value="CUSTOM">✍️ Custom Reason / Specific Diagnosis...</option>
                  {ILLNESS_PRESETS.filter((p) => p !== "CUSTOM").map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>

                <input
                  type="text"
                  placeholder="e.g. Acute viral fever, severe cold, stomach ache..."
                  value={customReason}
                  onChange={(e) => {
                    setCustomReason(e.target.value);
                    if (reasonPreset !== "CUSTOM") setReasonPreset("CUSTOM");
                  }}
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    border: "1.5px solid #cbd5e1",
                    borderRadius: "8px",
                    fontSize: "13px",
                    boxSizing: "border-box",
                  }}
                />

                {/* 1-Tap Template Preset Chips */}
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "8px" }}>
                  {QUICK_ILLNESS_CHIPS.map((chip) => (
                    <button
                      key={chip.label}
                      type="button"
                      onClick={() => {
                        setReasonPreset("CUSTOM");
                        setCustomReason(chip.value);
                      }}
                      style={{
                        padding: "5px 10px",
                        borderRadius: "6px",
                        fontSize: "11px",
                        fontWeight: "700",
                        cursor: "pointer",
                        background: customReason === chip.value ? "#fef3c7" : "#f8fafc",
                        color: customReason === chip.value ? "#92400e" : "#475569",
                        border: customReason === chip.value ? "1.5px solid #f59e0b" : "1px solid #cbd5e1",
                        transition: "all 0.1s ease",
                      }}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 2. VALIDITY DURATION */}
              <div style={{ marginBottom: "20px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "700", color: "#334155", marginBottom: "6px" }}>
                  Validity Duration (Default: Today Only) *
                </label>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "8px" }}>
                  {[
                    { id: "TODAY", label: "Today Only", days: 0 },
                    { id: "1_DAY", label: "+1 Day (Tomorrow)", days: 1 },
                    { id: "2_DAYS", label: "+2 Days (Day After)", days: 2 },
                    { id: "CUSTOM", label: "📅 Custom Date", days: null },
                  ].map((btn) => (
                    <button
                      key={btn.id}
                      type="button"
                      onClick={() => {
                        setDurationPreset(btn.id);
                        if (btn.days !== null) {
                          setValidUntil(addDaysToToday(btn.days));
                        }
                      }}
                      style={{
                        padding: "6px 12px",
                        borderRadius: "6px",
                        fontSize: "11px",
                        fontWeight: "800",
                        cursor: "pointer",
                        background: durationPreset === btn.id ? "#0f172a" : "#f1f5f9",
                        color: durationPreset === btn.id ? "#ffffff" : "#475569",
                        border: durationPreset === btn.id ? "1px solid #0f172a" : "1px solid #cbd5e1",
                        transition: "all 0.1s ease",
                      }}
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>

                {durationPreset === "CUSTOM" && (
                  <input
                    type="date"
                    value={validUntil}
                    min={addDaysToToday(0)}
                    onChange={(e) => setValidUntil(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      border: "1.5px solid #cbd5e1",
                      borderRadius: "8px",
                      fontSize: "13px",
                      boxSizing: "border-box",
                      marginBottom: "8px",
                    }}
                  />
                )}

                <div
                  style={{
                    background: "#ecfdf5",
                    border: "1px solid #a7f3d0",
                    padding: "7px 12px",
                    borderRadius: "8px",
                    fontSize: "11px",
                    color: "#065f46",
                    fontWeight: "700",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <span>⏳</span>
                  <span>
                    Excuses student through <strong>{validUntil}</strong> (Auto-expires at Midnight)
                  </span>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <button
                  type="button"
                  onClick={() => setShowGrantModal(false)}
                  style={{
                    padding: "9px 16px",
                    background: "#f1f5f9",
                    color: "#475569",
                    border: "1px solid #cbd5e1",
                    borderRadius: "8px",
                    fontSize: "13px",
                    fontWeight: "700",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingWaiver}
                  style={{
                    padding: "9px 20px",
                    background: "#d97706",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "8px",
                    fontSize: "13px",
                    fontWeight: "800",
                    cursor: "pointer",
                  }}
                >
                  {savingWaiver ? "Saving..." : "Confirm & Grant Bed Rest"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
