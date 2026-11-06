"use client";
import React, { useState } from "react";
import {
  LEAVE_CATEGORIES,
  PRESET_DESTINATIONS,
  dateTo12HourParts,
  formatDateTime12Hour,
  StudentAvatar,
  CustomDateTimePicker,
  getStatusBadgeStyle,
  styles,
} from "./outpassHelpers";

const QUICK_DESTINATIONS = Array.from(
  new Set([
    "Home",
    "Chemmad Town",
    "Hospital / Clinic",
    "Bookplus / Stationery",
    "Mosque (Jumu'ah)",
    "Bank / ATM",
    "Barber Shop",
    "Kozhikode",
    "Malappuram",
    ...(PRESET_DESTINATIONS || []),
  ])
);

const QUICK_REASONS = [
  "Monthly 3-Day Home Leave",
  "Medical / Hospital Case",
  "Friday Jumu'ah / Outing",
  "Bookplus / Stationery",
  "Personal / Essential Purchase",
  "Department / Official Work",
  "Family Function / Visit",
  "Dental / Eye Checkup",
  "Home Leave",
];

export default function OutpassTeacherDesk({
  myPrivileges,
  hasPrincipalPower,
  classFilter,
  students,
  passes,
  isGroupMode,
  setIsGroupMode,
  selectedStudent,
  setSelectedStudent,
  selectedGroupStudents,
  setSelectedGroupStudents,
  leaveCategory,
  setLeaveCategory,
  destination,
  setDestination,
  purpose,
  setPurpose,
  applyDaysDuration,
  applyHoursDuration,
  applyUntilEvening,
  isPassOverdue,
  getOfficialTeacherName,
  staffName,
  handleBulkVerifyClassReturn,
  autoOpenParentWA,
  setAutoOpenParentWA,
  searchQuery,
  setSearchQuery,
  setScannerMode,
  setScannerOpen,
  matchingStudents,
  getActivePassForStudent,
  setZoomPhotoStudent,
  setPortfolioModalStudent,
  getMonthlyOutCount,
  activePermissionCheck,
  handleIssuePass,
  activeDurationChip,
  isOpenReturn,
  setIsOpenReturn,
  fromDate,
  setFromDate,
  fromHour,
  setFromHour,
  fromMinute,
  setFromMinute,
  fromAmpm,
  setFromAmpm,
  toDate,
  setToDate,
  toHour,
  setToHour,
  toMinute,
  setToMinute,
  toAmpm,
  setToAmpm,
  isAdmin,
  selectedTeacherOverride,
  setSelectedTeacherOverride,
  teachersList,
  submitting,
  myPermittedPasses,
  myOutsideCount,
  myUnverifiedCount,
  myReturnedCount,
  teacherStatusFilter,
  setTeacherStatusFilter,
  teacherSearch,
  setTeacherSearch,
  filteredTeacherPasses,
  getStudentPhotoByAdNo,
  getStudentByAdNo,
  getRemainingTimeText,
  now,
  handleShareWhatsApp,
  setReceiptPass,
  openEditPassModal,
  handleTeacherVerifyArrival,
  handleCancelPass,
}) {
  const [showHomeBatchTools, setShowHomeBatchTools] = useState(false);
  const showStudentSearchBox = isGroupMode ? true : !selectedStudent;

  const myActiveClasses = hasPrincipalPower
    ? classFilter !== "ALL"
      ? [classFilter]
      : ["QH1", "AL1", "FC1", "QH2", "AL2", "FC2", "QLA3", "HFC3"]
    : myPrivileges.classTeacherOf || [];

  const activeClassHomePassesCount = passes.filter(
    (p) =>
      (myActiveClasses.includes(p.studentClass) ||
        (myPrivileges.isNiicsCoordinator &&
          String(p.adNo || "").toUpperCase().startsWith("U"))) &&
      (p.status === "OUTSIDE" ||
        p.status === "ARRIVED_AT_GATE" ||
        p.status === "APPROVED")
  ).length;

  return (
    <>
      {/* 🏠 MINIMALIST COLLAPSIBLE MONTHLY 3-DAY HOME LEAVE BAR FOR CLASS TEACHERS */}
      {((myPrivileges.classTeacherOf || []).length > 0 ||
        hasPrincipalPower ||
        myPrivileges.isNiicsCoordinator) && (
        <div
          style={{
            background: "#ffffff",
            borderRadius: 14,
            border: showHomeBatchTools ? "1.5px solid #4f46e5" : "1px solid #e2e8f0",
            marginBottom: 18,
            overflow: "hidden",
            boxShadow: "0 1px 3px rgba(15, 23, 42, 0.03)",
          }}
        >
          <div
            onClick={() => setShowHomeBatchTools((prev) => !prev)}
            style={{
              padding: "14px 18px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              cursor: "pointer",
              background: showHomeBatchTools ? "#f8fafc" : "#ffffff",
              flexWrap: "wrap",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span
                style={{
                  background: "#eef2ff",
                  color: "#4f46e5",
                  padding: "4px 10px",
                  borderRadius: 8,
                  fontSize: 11,
                  fontWeight: 800,
                }}
              >
                🏠 CLASS TEACHER BATCH TOOLS
              </span>
              <span style={{ fontSize: 14, fontWeight: 800, color: "#0f172a" }}>
                Monthly 3-Day Home Leave Generator, Bulk Return &amp; Latecomers Report
              </span>
              {activeClassHomePassesCount > 0 && (
                <span
                  style={{
                    background: "#ecfdf5",
                    color: "#047857",
                    padding: "3px 9px",
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 800,
                  }}
                >
                  {activeClassHomePassesCount} Active Out
                </span>
              )}
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#4f46e5" }}>
              {showHomeBatchTools ? "▲ Hide Tools" : "▼ Open Batch Tools"}
            </span>
          </div>

          {showHomeBatchTools && (
            <div
              style={{
                padding: "16px 18px",
                borderTop: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 12,
              }}
            >
              <p style={{ margin: 0, fontSize: 12, color: "#64748b", fontWeight: 500 }}>
                Load all Kerala students of your class for 3-Day Home Leave, verify returned students in one click, or copy the Principal report.
              </p>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => {
                    const targetCls = (myPrivileges.classTeacherOf || [])[0] || "QLA3";
                    const batchStudents = students.filter((s) => {
                      if (
                        myPrivileges.isNiicsCoordinator &&
                        !hasPrincipalPower &&
                        (myPrivileges.classTeacherOf || []).length === 0
                      ) {
                        return String(s.adNo || "").toUpperCase().startsWith("U");
                      }
                      return s.studentClass === targetCls && (s.state || "Kerala") === "Kerala";
                    });
                    setIsGroupMode(true);
                    setSelectedGroupStudents(batchStudents);
                    setLeaveCategory("Monthly_Home");
                    setDestination("Home");
                    setPurpose("Monthly 3-Day Home Leave");
                    applyDaysDuration(3, "3d");
                    alert(
                      `✅ Loaded ${batchStudents.length} students for 3-Day Monthly Home Leave!\n\nYou can also search and add any Non-Kerala students in the search box below before clicking "Permit Group Leave".`
                    );
                  }}
                  style={{
                    padding: "9px 14px",
                    background: "#4f46e5",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: 8,
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  🏠 1. Load Class Students (3-Day Home)
                </button>

                {activeClassHomePassesCount > 0 && handleBulkVerifyClassReturn && (
                  <button
                    type="button"
                    onClick={handleBulkVerifyClassReturn}
                    style={{
                      padding: "9px 14px",
                      background: "#10b981",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: 8,
                      fontWeight: 700,
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    ✅ 2. Bulk Mark Returned ({activeClassHomePassesCount})
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    const classHomePasses = passes.filter(
                      (p) =>
                        (myActiveClasses.includes(p.studentClass) ||
                          (myPrivileges.isNiicsCoordinator &&
                            String(p.adNo || "").toUpperCase().startsWith("U"))) &&
                        (p.leaveCategory === "Monthly_Home" ||
                          String(p.destination || "").toLowerCase().includes("home")) &&
                        p.status !== "CANCELLED"
                    );

                    const unpermittedLate = classHomePasses.filter(
                      (p) => (isPassOverdue(p) || p.wasLateReturn) && !p.extensionReason
                    );
                    const permittedExtensions = classHomePasses.filter((p) =>
                      Boolean(p.extensionReason)
                    );

                    const reportLines = [
                      `*DARUL HUDA DEGREE SECTION — MONTHLY HOME LEAVE REPORT*`,
                      `*Scope:* ${
                        myPrivileges.isNiicsCoordinator
                          ? "NIICS Urdu Students"
                          : `Class ${myActiveClasses.join(", ")}`
                      } | *By:* ${getOfficialTeacherName(staffName)}`,
                      `*Date:* ${new Date().toLocaleDateString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}`,
                      `-----------------------------------------`,
                      `*🚨 UNPERMITTED LATE / NOT RETURNED STUDENTS (${unpermittedLate.length}):*`,
                      ...(unpermittedLate.length === 0
                        ? ["None — All students returned on time!"]
                        : unpermittedLate.map(
                            (p, i) =>
                              `${i + 1}. *${p.studentName}* (#${p.adNo}, ${
                                p.studentClass
                              }) — Due: ${formatDateTime12Hour(p.permittedTo)} [${
                                p.status === "RETURNED" ? "Returned Late" : "Still Outside"
                              }]`
                          )),
                      ``,
                      `*⏳ PERMITTED EXTENSIONS (${permittedExtensions.length}):*`,
                      ...(permittedExtensions.length === 0
                        ? ["None"]
                        : permittedExtensions.map(
                            (p, i) =>
                              `${i + 1}. *${p.studentName}* (#${
                                p.adNo
                              }) — Extended till ${formatDateTime12Hour(
                                p.permittedTo
                              )} (Reason: ${p.extensionReason})`
                          )),
                    ];

                    navigator.clipboard.writeText(reportLines.join("\n"));
                    alert(
                      `✅ Copied Monthly Home Leave Latecomers Report (${unpermittedLate.length} unpermitted late, ${permittedExtensions.length} permitted extensions) to clipboard!`
                    );
                  }}
                  style={{
                    padding: "9px 14px",
                    background: "#fff1f2",
                    color: "#e11d48",
                    border: "1px solid #ffe4e6",
                    borderRadius: 8,
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  📋 3. Copy Latecomers Report
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div style={styles.twoColGrid}>
        {/* LEFT: MINIMALIST ISSUE FORM */}
        <div
          style={{
            background: "#ffffff",
            borderRadius: 14,
            border: "1px solid #e2e8f0",
            overflow: "hidden",
            boxShadow: "0 1px 3px rgba(15, 23, 42, 0.03)",
          }}
        >
          <div
            style={{
              padding: "16px 20px",
              borderBottom: "1px solid #f1f5f9",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 10,
              background: "#f8fafc",
            }}
          >
            <div>
              <div style={{ fontSize: 10, fontWeight: 800, color: "#4f46e5", letterSpacing: "0.6px", textTransform: "uppercase" }}>
                TEACHER LEAVE PERMISSION DESK
              </div>
              <h2 style={{ margin: "2px 0 0", fontSize: 18, fontWeight: 800, color: "#0f172a" }}>
                Permit Student Out-Pass
              </h2>
            </div>

            <button
              type="button"
              onClick={() => {
                setIsGroupMode(!isGroupMode);
                setSelectedStudent(null);
                setSelectedGroupStudents([]);
              }}
              style={{
                background: isGroupMode ? "#4f46e5" : "#ffffff",
                color: isGroupMode ? "#ffffff" : "#334155",
                border: isGroupMode ? "1px solid #4f46e5" : "1px solid #cbd5e1",
                padding: "7px 14px",
                borderRadius: "8px",
                fontSize: "12px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {isGroupMode ? "👥 Group Pass Mode (ON)" : "👤 Single Student (Switch to Group)"}
            </button>
          </div>

          <div style={styles.slipBody}>
            {/* Compact Authority Strip */}
            <div
              style={{
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                padding: "8px 12px",
                borderRadius: 8,
                marginBottom: 12,
                fontSize: 11,
                color: "#475569",
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                alignItems: "center",
              }}
            >
              <strong>Authority:</strong>
              <span>Friday (All) • Evening (Mentees)</span>
              {(myPrivileges.classTeacherOf || []).length > 0 && (
                <span style={{ color: "#047857", fontWeight: 700 }}>
                  • CT: {myPrivileges.classTeacherOf.join(", ")}
                </span>
              )}
              {myPrivileges.isNiicsCoordinator && (
                <span style={{ color: "#b45309", fontWeight: 700 }}>• NIICS Coordinator</span>
              )}
              {hasPrincipalPower && (
                <span style={{ color: "#4f46e5", fontWeight: 700 }}>• Principal Override</span>
              )}
            </div>

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                color: "#334155",
                cursor: "pointer",
                marginBottom: 16,
              }}
            >
              <input
                type="checkbox"
                checked={autoOpenParentWA}
                onChange={(e) => setAutoOpenParentWA(e.target.checked)}
              />
              💬 Auto-open Parent&apos;s WhatsApp chat when permitting Home Leave
            </label>

            <div style={{ marginBottom: 18 }}>
              <label style={styles.fieldLabel}>
                1.{" "}
                {isGroupMode
                  ? `Select Multiple Students (${selectedGroupStudents.length} selected)`
                  : "Select Student (Scan ID or Search Ad.No / Name)"}
              </label>

              {showStudentSearchBox && (
                <div style={{ position: "relative" }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <div style={{ position: "relative", flex: 1 }}>
                      <input
                        type="text"
                        placeholder="Search by Admission No. (e.g. 3529 or U1278) or Name..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={styles.searchInput}
                      />
                      {searchQuery && (
                        <button
                          type="button"
                          onClick={() => setSearchQuery("")}
                          style={styles.searchClearIconBtn}
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setScannerMode("teacher");
                        setScannerOpen(true);
                      }}
                      style={{
                        padding: "0 14px",
                        background: "#ffffff",
                        color: "#334155",
                        border: "1px solid #cbd5e1",
                        borderRadius: 8,
                        fontWeight: 700,
                        fontSize: 12,
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      📷 Scan ID
                    </button>
                  </div>

                  {matchingStudents.length > 0 && (
                    <div style={styles.searchDropdown}>
                      <div style={styles.dropdownHeader}>
                        Matching Students ({matchingStudents.length})
                      </div>
                      {matchingStudents.map((st) => {
                        const activePass = getActivePassForStudent(st.adNo);
                        const isBlocked = Array.isArray(st.blockedCategories)
                          ? st.blockedCategories.length > 0
                          : false;
                        return (
                          <div
                            key={st.id}
                            className="op-student-item"
                            onClick={() => {
                              if (isGroupMode) {
                                if (!selectedGroupStudents.some((x) => x.adNo === st.adNo)) {
                                  setSelectedGroupStudents((prev) => [...prev, st]);
                                }
                              } else {
                                setSelectedStudent(st);
                              }
                              setSearchQuery("");
                            }}
                            style={styles.dropdownRow}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                              <StudentAvatar
                                name={st.name}
                                adNo={st.adNo}
                                photoUrl={st.photoUrl}
                                size={36}
                              />
                              <div>
                                <div style={{ fontWeight: 700, color: "#0f172a", fontSize: 13 }}>
                                  {st.name}
                                </div>
                                <div style={{ fontSize: 11, color: "#64748b" }}>
                                  Ad.No: <strong style={{ color: "#4f46e5" }}>#{st.adNo}</strong> • {st.department} • {st.district}
                                </div>
                              </div>
                            </div>

                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              {st.requiresPrincipalApproval && (
                                <span style={styles.alreadyOutMiniTag}>👑 Principal Only</span>
                              )}
                              {isBlocked && (
                                <span style={styles.alreadyOutMiniTag}>🚫 Restricted</span>
                              )}
                              {activePass && (
                                <span style={styles.alreadyOutMiniTag}>Active Pass</span>
                              )}
                              <span style={styles.classPill}>Class {st.studentClass}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {isGroupMode && selectedGroupStudents.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 6,
                    marginTop: 10,
                    background: "#f8fafc",
                    padding: 10,
                    borderRadius: 10,
                    border: "1px solid #cbd5e1",
                    maxHeight: 160,
                    overflowY: "auto",
                  }}
                >
                  {selectedGroupStudents.map((st) => (
                    <div
                      key={st.adNo}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        background: "#ffffff",
                        border: "1px solid #cbd5e1",
                        padding: "5px 10px",
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      <span>
                        {st.name} (#{st.adNo})
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedGroupStudents((prev) =>
                            prev.filter((x) => x.adNo !== st.adNo)
                          )
                        }
                        style={{
                          background: "transparent",
                          color: "#e11d48",
                          border: "none",
                          cursor: "pointer",
                          fontWeight: 800,
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {!isGroupMode && selectedStudent && (
                <div style={styles.selectedProfileCard}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <StudentAvatar
                        name={selectedStudent.name}
                        adNo={selectedStudent.adNo}
                        photoUrl={selectedStudent.photoUrl}
                        size={48}
                        onClick={() => setZoomPhotoStudent(selectedStudent)}
                      />
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 16, fontWeight: 800, color: "#0f172a" }}>
                            {selectedStudent.name}
                          </span>
                          <span style={styles.classPillActive}>
                            Class {selectedStudent.studentClass}
                          </span>
                          <button
                            type="button"
                            onClick={() => setPortfolioModalStudent(selectedStudent)}
                            style={{
                              padding: "3px 9px",
                              background: "#ffffff",
                              color: "#4f46e5",
                              border: "1px solid #c7d2fe",
                              borderRadius: 6,
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            👁️ View Portfolio
                          </button>
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: "#475569",
                            marginTop: 4,
                            display: "flex",
                            gap: 12,
                            flexWrap: "wrap",
                          }}
                        >
                          <span>
                            Ad.No: <strong>#{selectedStudent.adNo}</strong>
                          </span>
                          <span>
                            Mentor: <strong>{selectedStudent.mentorUsername || "—"}</strong>
                          </span>
                          <span>
                            Outings this month: <strong>{getMonthlyOutCount(selectedStudent.adNo)}</strong>
                          </span>
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setSelectedStudent(null)}
                      style={styles.changeStudentBtn}
                    >
                      ✕ Change
                    </button>
                  </div>

                  {Array.isArray(selectedStudent.blockedCategories) &&
                    selectedStudent.blockedCategories.length > 0 && (
                      <div style={styles.duplicateWarningBox}>
                        🚫 <strong>Disciplinary Block Active:</strong> Blocked categories:{" "}
                        <strong>{selectedStudent.blockedCategories.join(", ")}</strong>
                        {selectedStudent.blockReason && ` — Reason: ${selectedStudent.blockReason}`}
                      </div>
                    )}

                  {!activePermissionCheck.allowed && (
                    <div style={styles.duplicateWarningBox}>{activePermissionCheck.reason}</div>
                  )}
                </div>
              )}
            </div>

            <form onSubmit={handleIssuePass}>
              {/* 2. LEAVE CATEGORY QUICK-SELECT PILLS */}
              <div style={{ marginBottom: 18 }}>
                <label style={styles.fieldLabel}>2. Select Leave Category</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {LEAVE_CATEGORIES.map((cat) => {
                    const active = leaveCategory === cat;
                    const labelText =
                      cat === "Weekend_Thu_Sat"
                        ? "Weekend (Thu–Sat)"
                        : cat === "Monthly_Home"
                        ? "Monthly Home (3d)"
                        : cat;
                    return (
                      <button
                        type="button"
                        key={cat}
                        onClick={() => {
                          setLeaveCategory(cat);
                          if (cat === "Medical") {
                            setIsOpenReturn(true);
                            setActiveDurationChip("open");
                          } else if (cat === "Evening") {
                            applyUntilEvening();
                          } else if (cat === "Monthly_Home") {
                            setDestination("Home");
                            setPurpose("Monthly 3-Day Home Leave");
                            applyDaysDuration(3, "3d");
                          } else if (cat === "Weekend_Thu_Sat") {
                            applyDaysDuration(2, "2d");
                          }
                        }}
                        style={{
                          padding: "7px 13px",
                          borderRadius: "8px",
                          fontSize: "12px",
                          fontWeight: 700,
                          cursor: "pointer",
                          border: active ? "1px solid #4f46e5" : "1px solid #cbd5e1",
                          background: active ? "#4f46e5" : "#ffffff",
                          color: active ? "#ffffff" : "#334155",
                        }}
                      >
                        {labelText}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 🌟 3. DESTINATION QUICK-SELECT BUTTONS ABOVE INPUT */}
              <div style={{ marginBottom: 18 }}>
                <label style={styles.fieldLabel}>3. Destination (Click Quick-Select or Type)</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                  {QUICK_DESTINATIONS.map((place) => {
                    const active = destination === place;
                    return (
                      <button
                        type="button"
                        key={place}
                        onClick={() => setDestination(place)}
                        style={{
                          padding: "6px 12px",
                          borderRadius: "8px",
                          fontSize: "12px",
                          fontWeight: 700,
                          cursor: "pointer",
                          border: active ? "1px solid #4f46e5" : "1px solid #e2e8f0",
                          background: active ? "#4f46e5" : "#f8fafc",
                          color: active ? "#ffffff" : "#475569",
                        }}
                      >
                        📍 {place}
                      </button>
                    );
                  })}
                </div>
                <input
                  type="text"
                  placeholder="Or type custom destination..."
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  style={styles.textInput}
                  required
                />
              </div>

              {/* 🌟 4. PURPOSE / REASON QUICK-SELECT BUTTONS ABOVE INPUT */}
              <div style={{ marginBottom: 18 }}>
                <label style={styles.fieldLabel}>
                  4. Purpose / Reason for Leave (Click Quick-Select or Type)
                </label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                  {QUICK_REASONS.map((rsn) => {
                    const active = purpose === rsn;
                    return (
                      <button
                        type="button"
                        key={rsn}
                        onClick={() => setPurpose(rsn)}
                        style={{
                          padding: "6px 12px",
                          borderRadius: "8px",
                          fontSize: "12px",
                          fontWeight: 700,
                          cursor: "pointer",
                          border: active ? "1px solid #4f46e5" : "1px solid #e2e8f0",
                          background: active ? "#4f46e5" : "#f8fafc",
                          color: active ? "#ffffff" : "#475569",
                        }}
                      >
                        ✓ {rsn}
                      </button>
                    );
                  })}
                </div>
                <input
                  type="text"
                  placeholder="Or type custom reason..."
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  style={styles.textInput}
                  required
                />
              </div>

              {/* 5. SCHEDULE & DURATION PRESETS */}
              <div style={{ marginBottom: 18 }}>
                <label style={styles.fieldLabel}>5. Permitted Date &amp; Time Schedule</label>

                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 6,
                    marginBottom: 12,
                    background: "#f8fafc",
                    padding: "10px",
                    borderRadius: "10px",
                    border: "1px solid #e2e8f0",
                  }}
                >
                  {[
                    { id: "1h", label: "⏱️ +1 Hr", fn: () => applyHoursDuration(1, "1h") },
                    { id: "2h", label: "⏱️ +2 Hrs", fn: () => applyHoursDuration(2, "2h") },
                    { id: "6pm", label: "🌇 Today 6:00 PM", fn: applyUntilEvening },
                    { id: "1d", label: "📅 +1 Day", fn: () => applyDaysDuration(1, "1d") },
                    { id: "3d", label: "📅 +3 Days", fn: () => applyDaysDuration(3, "3d") },
                  ].map((d) => {
                    const active = activeDurationChip === d.id && !isOpenReturn;
                    return (
                      <button
                        key={d.id}
                        type="button"
                        onClick={d.fn}
                        style={{
                          padding: "6px 12px",
                          borderRadius: "8px",
                          fontSize: "12px",
                          fontWeight: 700,
                          cursor: "pointer",
                          border: active ? "1px solid #4f46e5" : "1px solid #cbd5e1",
                          background: active ? "#4f46e5" : "#ffffff",
                          color: active ? "#ffffff" : "#334155",
                        }}
                      >
                        {d.label}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setIsOpenReturn(!isOpenReturn)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: "8px",
                      fontSize: "12px",
                      fontWeight: 700,
                      cursor: "pointer",
                      border: isOpenReturn ? "1px solid #059669" : "1px solid #cbd5e1",
                      background: isOpenReturn ? "#10b981" : "#ffffff",
                      color: isOpenReturn ? "#ffffff" : "#334155",
                    }}
                  >
                    {isOpenReturn ? "✓ 🏥 Open Return (Medical)" : "🏥 Open Return (Medical)"}
                  </button>
                </div>

                <CustomDateTimePicker
                  title="🚶‍♂️ Permitted From (Date & Time)"
                  dateValue={fromDate}
                  onDateChange={setFromDate}
                  hourValue={fromHour}
                  onHourChange={setFromHour}
                  minuteValue={fromMinute}
                  onMinuteChange={setFromMinute}
                  ampmValue={fromAmpm}
                  onAmpmChange={setFromAmpm}
                  onSetNow={() => {
                    const p = dateTo12HourParts(new Date());
                    setFromDate(p.date);
                    setFromHour(p.hour);
                    setFromMinute(p.minute);
                    setFromAmpm(p.ampm);
                  }}
                  previewLabel="🕒 Permitted From"
                />

                {!isOpenReturn && (
                  <div style={{ marginTop: 12 }}>
                    <CustomDateTimePicker
                      title="⏳ To Date & Time (Return Deadline)"
                      dateValue={toDate}
                      onDateChange={setToDate}
                      hourValue={toHour}
                      onHourChange={setToHour}
                      minuteValue={toMinute}
                      onMinuteChange={setToMinute}
                      ampmValue={toAmpm}
                      onAmpmChange={setToAmpm}
                      previewLabel="⏳ Must Return By"
                    />
                  </div>
                )}
              </div>

              <div style={styles.teacherSignatureBox}>
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#64748b",
                      textTransform: "uppercase",
                      marginBottom: 4,
                    }}
                  >
                    Permitting Teacher (Degree Section)
                  </div>
                  {isAdmin ? (
                    <select
                      value={selectedTeacherOverride || getOfficialTeacherName(staffName)}
                      onChange={(e) => setSelectedTeacherOverride(e.target.value)}
                      style={styles.textInput}
                    >
                      <option value={getOfficialTeacherName(staffName)}>
                        {getOfficialTeacherName(staffName)} (Admin)
                      </option>
                      {teachersList.map((t) => (
                        <option key={t.username} value={t.fullName}>
                          {t.fullName}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>
                      👨‍🏫 {getOfficialTeacherName(staffName)}
                    </div>
                  )}
                </div>
                <span style={styles.verifiedAccountBadge}>✓ Verified</span>
              </div>

              <button
                type="submit"
                disabled={
                  submitting ||
                  (!selectedStudent && selectedGroupStudents.length === 0) ||
                  !activePermissionCheck.allowed
                }
                style={{
                  ...styles.primarySubmitBtn,
                  background: !activePermissionCheck.allowed ? "#e11d48" : "#4f46e5",
                  opacity:
                    submitting ||
                    (!selectedStudent && selectedGroupStudents.length === 0) ||
                    !activePermissionCheck.allowed
                      ? 0.55
                      : 1,
                }}
              >
                {!activePermissionCheck.allowed
                  ? "🔒 Leave Restricted (See Notice Above)"
                  : submitting
                  ? "Permitting Leave..."
                  : isGroupMode
                  ? `✅ Permit Group Leave (${selectedGroupStudents.length} Students)`
                  : "✅ Permit Student Leave"}
              </button>
            </form>
          </div>
        </div>

        {/* RIGHT: PERMITTED & CLASS STUDENTS */}
        <div style={styles.card}>
          <div style={styles.cardHeaderRow}>
            <div>
              <h3 style={styles.cardTitle}>
                📋 My Permitted &amp; Class Students ({myPermittedPasses.length})
              </h3>
              <p style={styles.cardSubtitle}>
                Leaves permitted by <strong>{getOfficialTeacherName(staffName)}</strong>
                {(myPrivileges.classTeacherOf || []).length > 0 &&
                  ` + Class ${myPrivileges.classTeacherOf.join(", ")}`}
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                setScannerMode("return");
                setScannerOpen(true);
              }}
              style={styles.scanReturnSmallBtn}
            >
              📷 Scan Return
            </button>
          </div>

          <div style={styles.segmentedBar}>
            {[
              { id: "ALL", label: "All Mine", count: myPermittedPasses.length },
              { id: "OUTSIDE", label: "Active Out", count: myOutsideCount },
              { id: "UNVERIFIED", label: "Verify Arrival", count: myUnverifiedCount },
              { id: "RETURNED", label: "Returned", count: myReturnedCount },
            ].map((tab) => {
              const active = teacherStatusFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setTeacherStatusFilter(tab.id)}
                  style={active ? styles.segmentBtnActive : styles.segmentBtnInactive}
                >
                  <span>{tab.label}</span>
                  <span style={active ? styles.segmentBadgeActive : styles.segmentBadgeInactive}>
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          <div style={{ position: "relative", marginBottom: 14 }}>
            <input
              type="text"
              placeholder="🔍 Filter students by name, Ad.No, or place..."
              value={teacherSearch}
              onChange={(e) => setTeacherSearch(e.target.value)}
              style={styles.searchInputSmall}
            />
          </div>

          {filteredTeacherPasses.length === 0 ? (
            <div style={styles.emptyStateBox}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
              <div style={{ fontWeight: 700, color: "#334155" }}>No permitted leaves found</div>
            </div>
          ) : (
            <div style={styles.passListScroll}>
              {filteredTeacherPasses.map((p) => {
                const isOverdue = isPassOverdue(p);
                const photoUrl = getStudentPhotoByAdNo(p.adNo);
                const stObj = getStudentByAdNo(p.adNo);
                return (
                  <div
                    key={p.id}
                    style={{
                      ...styles.passCardItem,
                      borderLeft:
                        p.status === "ARRIVED_AT_GATE"
                          ? "4px solid #4f46e5"
                          : p.status === "OUTSIDE"
                          ? isOverdue
                            ? "4px solid #e11d48"
                            : "4px solid #f59e0b"
                          : p.status === "APPROVED"
                          ? "4px solid #0284c7"
                          : "4px solid #10b981",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: 12,
                        flexWrap: "wrap",
                      }}
                    >
                      <div style={{ display: "flex", gap: 12, flex: 1, minWidth: 220 }}>
                        <StudentAvatar
                          name={p.studentName}
                          adNo={p.adNo}
                          photoUrl={photoUrl}
                          size={44}
                          onClick={() =>
                            setZoomPhotoStudent({
                              name: p.studentName,
                              adNo: p.adNo,
                              studentClass: p.studentClass,
                              photoUrl,
                            })
                          }
                        />
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <span style={{ fontWeight: 800, fontSize: 14, color: "#0f172a" }}>
                              {p.studentName}
                            </span>
                            <span style={styles.adNoBadge}>#{p.adNo}</span>
                            <span style={styles.classPill}>{p.studentClass}</span>
                            <span
                              style={{
                                ...styles.classPill,
                                background: "#eef2ff",
                                color: "#4f46e5",
                              }}
                            >
                              {p.leaveCategory ? p.leaveCategory : "General"}
                            </span>
                          </div>

                          <div style={{ fontSize: 13, color: "#1e293b", marginTop: 4, fontWeight: 600 }}>
                            📍 {p.destination} — <span style={{ color: "#64748b" }}>{p.purpose}</span>
                          </div>

                          {p.extensionReason && (
                            <div style={{ fontSize: 12, color: "#047857", fontWeight: 700, marginTop: 3 }}>
                              ⏳ Permitted Extension: {p.extensionReason}
                            </div>
                          )}

                          <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>
                            <div>
                              🕒 Permitted: <strong>{formatDateTime12Hour(p.permittedFrom)}</strong> ➔{" "}
                              <strong>{formatDateTime12Hour(p.permittedTo, p.isOpenReturn)}</strong>
                            </div>
                            {p.gateDepartureTime && (
                              <div>
                                🚪 Gate Exit: <strong>{formatDateTime12Hour(p.gateDepartureTime)}</strong>
                              </div>
                            )}
                            {p.gateArrivalTime && (
                              <div style={{ color: "#4f46e5", fontWeight: 700 }}>
                                🏁 Gate Arrival: {formatDateTime12Hour(p.gateArrivalTime)}
                              </div>
                            )}
                          </div>

                          <div
                            style={{
                              marginTop: 4,
                              fontSize: 12,
                              fontWeight: 700,
                              color: isOverdue ? "#e11d48" : "#047857",
                            }}
                          >
                            ⏱️ {getRemainingTimeText(p)}
                          </div>
                        </div>
                      </div>

                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-end",
                          gap: 6,
                        }}
                      >
                        <span style={getStatusBadgeStyle(p, now)}>
                          {p.status === "ARRIVED_AT_GATE"
                            ? "🟣 GATE ARRIVED (UNVERIFIED)"
                            : p.status === "APPROVED"
                            ? "🔵 PERMITTED (AT CAMPUS)"
                            : p.status === "OUTSIDE" && isOverdue
                            ? "🚨 OVERDUE"
                            : p.status}
                        </span>

                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                          {stObj && (
                            <button
                              type="button"
                              onClick={() => setPortfolioModalStudent(stObj)}
                              style={styles.editPassBtn}
                            >
                              👁️ View
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleShareWhatsApp(p)}
                            style={{
                              ...styles.editPassBtn,
                              background: "#dcfce7",
                              color: "#166534",
                            }}
                          >
                            💬 Parent WA
                          </button>
                          <button
                            type="button"
                            onClick={() => setReceiptPass(p)}
                            style={styles.editPassBtn}
                          >
                            🎫 Slip
                          </button>
                          {(p.status === "OUTSIDE" ||
                            p.status === "APPROVED" ||
                            p.status === "ARRIVED_AT_GATE") && (
                            <>
                              <button
                                type="button"
                                onClick={() => openEditPassModal(p)}
                                style={styles.editPassBtn}
                              >
                                ✏️ Extend
                              </button>
                              <button
                                type="button"
                                onClick={() => handleTeacherVerifyArrival(p)}
                                style={styles.markReturnedBtn}
                              >
                                ✓ Mark Returned
                              </button>
                            </>
                          )}
                        </div>

                        {(p.status === "APPROVED" || p.status === "OUTSIDE") && (
                          <button
                            type="button"
                            onClick={() => handleCancelPass(p)}
                            style={styles.cancelPassBtn}
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}