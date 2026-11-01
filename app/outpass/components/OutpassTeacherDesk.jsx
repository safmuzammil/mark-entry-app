"use client";
import React from "react";
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
      {/* 🏠 MONTHLY 3-DAY HOME LEAVE & 1-CLICK BULK RETURN MODULE FOR CLASS TEACHERS */}
      {((myPrivileges.classTeacherOf || []).length > 0 ||
        hasPrincipalPower ||
        myPrivileges.isNiicsCoordinator) && (
        <div
          style={{
            ...styles.card,
            marginBottom: 20,
            background: "#f0fdf4",
            border: "2px solid #0d9488",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <div>
              <span
                style={{
                  background: "#0f766e",
                  color: "#ffffff",
                  padding: "3px 10px",
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 900,
                }}
              >
                🏠 CLASS TEACHER &amp; NIICS MONTHLY 3-DAY HOME LEAVE MODULE
              </span>
              <h3
                style={{
                  margin: "6px 0 2px",
                  fontSize: 18,
                  fontWeight: 800,
                  color: "#0f172a",
                }}
              >
                Monthly Home Leave Batch Generator, Bulk Return &amp; Principal
                Report
              </h3>
              <p
                style={{
                  margin: 0,
                  fontSize: 12,
                  color: "#166534",
                  fontWeight: 600,
                }}
              >
                Load all Kerala students of your class for 3-Day Home Leave,
                verify all returned students in one click, or copy the
                Unpermitted Latecomers list for the Principal.
              </p>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => {
                  const targetCls =
                    (myPrivileges.classTeacherOf || [])[0] || "QLA3";
                  const batchStudents = students.filter((s) => {
                    if (
                      myPrivileges.isNiicsCoordinator &&
                      !hasPrincipalPower &&
                      (myPrivileges.classTeacherOf || []).length === 0
                    ) {
                      return String(s.adNo || "")
                        .toUpperCase()
                        .startsWith("U");
                    }
                    return (
                      s.studentClass === targetCls &&
                      (s.state || "Kerala") === "Kerala"
                    );
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
                  padding: "10px 14px",
                  background: "#0f766e",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: 8,
                  fontWeight: 800,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                🏠 1. Load Class Students (3-Day Home Leave)
              </button>

              {activeClassHomePassesCount > 0 && handleBulkVerifyClassReturn && (
                <button
                  type="button"
                  onClick={handleBulkVerifyClassReturn}
                  style={{
                    padding: "10px 14px",
                    background: "#059669",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: 8,
                    fontWeight: 800,
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  ✅ 2. Bulk Mark Returned ({activeClassHomePassesCount} Active)
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  const classHomePasses = passes.filter(
                    (p) =>
                      (myActiveClasses.includes(p.studentClass) ||
                        (myPrivileges.isNiicsCoordinator &&
                          String(p.adNo || "")
                            .toUpperCase()
                            .startsWith("U"))) &&
                      (p.leaveCategory === "Monthly_Home" ||
                        String(p.destination || "")
                          .toLowerCase()
                          .includes("home")) &&
                      p.status !== "CANCELLED"
                  );

                  const unpermittedLate = classHomePasses.filter(
                    (p) =>
                      (isPassOverdue(p) || p.wasLateReturn) &&
                      !p.extensionReason
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
                            `${i + 1}. *${p.studentName}* (#${
                              p.adNo
                            }, ${p.studentClass}) — Due: ${formatDateTime12Hour(
                              p.permittedTo
                            )} [${
                              p.status === "RETURNED"
                                ? "Returned Late"
                                : "Still Outside"
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
                  padding: "10px 14px",
                  background: "#dc2626",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: 8,
                  fontWeight: 800,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                📋 3. Copy Latecomers Report for Principal
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={styles.twoColGrid}>
        {/* LEFT: ISSUE FORM */}
        <div style={styles.slipContainer}>
          <div style={styles.slipBanner}>
            <div>
              <div style={styles.slipBannerSub}>
                DEGREE SECTION • TEACHER LEAVE PERMISSION DESK
              </div>
              <h2 style={styles.slipBannerTitle}>Permit Student Out-Pass</h2>
            </div>

            <button
              type="button"
              onClick={() => {
                setIsGroupMode(!isGroupMode);
                setSelectedStudent(null);
                setSelectedGroupStudents([]);
              }}
              style={{
                background: isGroupMode
                  ? "#f59e0b"
                  : "rgba(255,255,255,0.2)",
                color: "#ffffff",
                border: "1px solid rgba(255,255,255,0.4)",
                padding: "7px 14px",
                borderRadius: "999px",
                fontSize: "12px",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              {isGroupMode
                ? "👥 Group Out-Pass Mode (ON)"
                : "👤 Single Student (Click for Group Pass)"}
            </button>
          </div>

          <div style={styles.slipBody}>
            <div
              style={{
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                padding: "10px 14px",
                borderRadius: 10,
                marginBottom: 12,
                fontSize: 12,
                color: "#334155",
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                alignItems: "center",
              }}
            >
              <strong>🔑 Your Leave Authority:</strong>
              <span style={styles.adNoBadge}>🕌 Friday (All)</span>
              <span style={styles.adNoBadge}>🌇 Evening (Mentees)</span>
              {(myPrivileges.classTeacherOf || []).length > 0 && (
                <span style={styles.insideStatusBadge}>
                  🏫 Class Teacher: {myPrivileges.classTeacherOf.join(", ")}
                </span>
              )}
              {myPrivileges.isNiicsCoordinator && (
                <span
                  style={{
                    ...styles.adNoBadge,
                    background: "#fef3c7",
                    color: "#92400e",
                  }}
                >
                  🎓 NIICS Coordinator (Urdu Principal)
                </span>
              )}
              {(hasPrincipalPower || myPrivileges.canApproveWeekend) && (
                <span
                  style={{
                    ...styles.adNoBadge,
                    background: "#f3e8ff",
                    color: "#6d28d9",
                  }}
                >
                  🗓️ Thu–Sat Weekend
                </span>
              )}
              {(hasPrincipalPower ||
                myPrivileges.canApproveOutreach ||
                myPrivileges.isOutreachCoordinator) && (
                <span
                  style={{
                    ...styles.adNoBadge,
                    background: "#ffedd5",
                    color: "#c2410c",
                  }}
                >
                  🌍 Outreach
                </span>
              )}
              {hasPrincipalPower && (
                <span
                  style={{
                    ...styles.adNoBadge,
                    background: "#fef08a",
                    color: "#854d0e",
                  }}
                >
                  👑 Principal Override
                </span>
              )}
            </div>

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "#f0fdf4",
                border: "1px solid #86efac",
                padding: "8px 12px",
                borderRadius: 10,
                fontSize: 12,
                fontWeight: 800,
                color: "#166534",
                cursor: "pointer",
                marginBottom: 16,
              }}
            >
              <input
                type="checkbox"
                checked={autoOpenParentWA}
                onChange={(e) => setAutoOpenParentWA(e.target.checked)}
              />
              💬 Automatically open Parent&apos;s WhatsApp chat when permitting
              Home Leave
            </label>

            <div style={{ marginBottom: 18 }}>
              <label style={styles.fieldLabel}>
                1.{" "}
                {isGroupMode
                  ? `Select Multiple Students for Group Out-Pass (${selectedGroupStudents.length} selected)`
                  : "Select Student (Scan Barcode or Search Ad.No / Name)"}
              </label>

              {showStudentSearchBox && (
                <div style={{ position: "relative" }}>
                  <div style={{ display: "flex", gap: 10 }}>
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
                          ✕ Clear
                        </button>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setScannerMode("teacher");
                        setScannerOpen(true);
                      }}
                      style={styles.barcodeScanBtn}
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
                                if (
                                  !selectedGroupStudents.some(
                                    (x) => x.adNo === st.adNo
                                  )
                                ) {
                                  setSelectedGroupStudents((prev) => [
                                    ...prev,
                                    st,
                                  ]);
                                }
                              } else {
                                setSelectedStudent(st);
                              }
                              setSearchQuery("");
                            }}
                            style={styles.dropdownRow}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 12,
                              }}
                            >
                              <StudentAvatar
                                name={st.name}
                                adNo={st.adNo}
                                photoUrl={st.photoUrl}
                                size={38}
                              />
                              <div>
                                <div
                                  style={{
                                    fontWeight: 700,
                                    color: "#0f172a",
                                    fontSize: 14,
                                  }}
                                >
                                  {st.name}
                                </div>
                                <div
                                  style={{
                                    fontSize: 12,
                                    color: "#475569",
                                  }}
                                >
                                  Ad.No:{" "}
                                  <strong style={{ color: "#0d9488" }}>
                                    #{st.adNo}
                                  </strong>{" "}
                                  • {st.department} • {st.district}, {st.state}
                                </div>
                              </div>
                            </div>

                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                              }}
                            >
                              {st.requiresPrincipalApproval && (
                                <span style={styles.alreadyOutMiniTag}>
                                  👑 Principal Only
                                </span>
                              )}
                              {isBlocked && (
                                <span style={styles.alreadyOutMiniTag}>
                                  🚫 Restricted
                                </span>
                              )}
                              {activePass && (
                                <span style={styles.alreadyOutMiniTag}>
                                  Active Pass
                                </span>
                              )}
                              <span style={styles.classPill}>
                                Class {st.studentClass}
                              </span>
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
                    gap: 8,
                    marginTop: 12,
                    background: "#f0fdfa",
                    padding: 12,
                    borderRadius: 12,
                    border: "1.5px solid #0d9488",
                    maxHeight: 180,
                    overflowY: "auto",
                  }}
                >
                  {selectedGroupStudents.map((st) => (
                    <div
                      key={st.adNo}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        background: "#ffffff",
                        border: "1px solid #99f6e4",
                        padding: "6px 10px",
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: 800,
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
                          background: "#fee2e2",
                          color: "#dc2626",
                          border: "none",
                          borderRadius: 999,
                          width: 20,
                          height: 20,
                          cursor: "pointer",
                          fontWeight: 900,
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
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 14,
                      }}
                    >
                      <StudentAvatar
                        name={selectedStudent.name}
                        adNo={selectedStudent.adNo}
                        photoUrl={selectedStudent.photoUrl}
                        size={56}
                        onClick={() => setZoomPhotoStudent(selectedStudent)}
                      />
                      <div>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            flexWrap: "wrap",
                          }}
                        >
                          <span
                            style={{
                              fontSize: 18,
                              fontWeight: 800,
                              color: "#0f172a",
                            }}
                          >
                            {selectedStudent.name}
                          </span>
                          <span style={styles.classPillActive}>
                            Class {selectedStudent.studentClass}
                          </span>
                          <span style={styles.classPill}>
                            {selectedStudent.department}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setPortfolioModalStudent(selectedStudent)
                            }
                            style={{
                              padding: "3px 10px",
                              background: "#ffffff",
                              color: "#0f766e",
                              border: "1px solid #0d9488",
                              borderRadius: 999,
                              fontSize: 11,
                              fontWeight: 800,
                              cursor: "pointer",
                            }}
                          >
                            🏆 Portfolio &amp; Details
                          </button>
                        </div>
                        <div
                          style={{
                            fontSize: 13,
                            color: "#334155",
                            marginTop: 4,
                            display: "flex",
                            gap: 14,
                            flexWrap: "wrap",
                          }}
                        >
                          <span>
                            Ad.No:{" "}
                            <strong style={{ color: "#0f766e" }}>
                              #{selectedStudent.adNo}
                            </strong>
                          </span>
                          <span>
                            👨‍🏫 Mentor:{" "}
                            <strong>
                              {selectedStudent.mentorUsername
                                ? selectedStudent.mentorUsername
                                : "—"}
                            </strong>
                          </span>
                          <span>
                            📍 {selectedStudent.district},{" "}
                            {selectedStudent.state}
                          </span>
                          <span style={styles.monthOutingsBadge}>
                            📊 Outings this month:{" "}
                            <strong>
                              {getMonthlyOutCount(selectedStudent.adNo)}
                            </strong>
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
                        🚫 <strong>Disciplinary Block Active:</strong> Blocked
                        categories:{" "}
                        <strong>
                          {selectedStudent.blockedCategories.join(", ")}
                        </strong>
                        {selectedStudent.blockReason &&
                          ` — Reason: ${selectedStudent.blockReason}`}
                      </div>
                    )}

                  {!activePermissionCheck.allowed && (
                    <div style={styles.duplicateWarningBox}>
                      {activePermissionCheck.reason}
                    </div>
                  )}
                </div>
              )}
            </div>

            <form onSubmit={handleIssuePass}>
              <div style={{ marginBottom: 18 }}>
                <label style={styles.fieldLabel}>
                  2. Leave Category (Friday, Evening, General, Medical, Monthly
                  3-Day Home, Weekend, Outreach, Official)
                </label>
                <div style={styles.chipGroup}>
                  {LEAVE_CATEGORIES.map((cat) => {
                    const active = leaveCategory === cat;
                    const labelText =
                      cat === "Weekend_Thu_Sat"
                        ? "Weekend (Thu Eve – Sat)"
                        : cat === "Monthly_Home"
                        ? "🏠 Monthly Home (3 Days)"
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
                        style={
                          active ? styles.quickChipActive : styles.quickChip
                        }
                      >
                        🏷️ {labelText}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ marginBottom: 18 }}>
                <label style={styles.fieldLabel}>
                  3. Destination (Select from Chips or Type)
                </label>
                <input
                  type="text"
                  placeholder="Select below or type destination (e.g. Home, Chemmad, Bookplus)..."
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  style={styles.textInput}
                  required
                />
                <div style={styles.chipGroup}>
                  {PRESET_DESTINATIONS.map((place) => (
                    <button
                      type="button"
                      key={place}
                      onClick={() => setDestination(place)}
                      style={
                        destination === place
                          ? styles.quickChipActive
                          : styles.quickChip
                      }
                    >
                      📍 {place}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 18 }}>
                <label style={styles.fieldLabel}>
                  4. Purpose / Reason for Leave
                </label>
                <input
                  type="text"
                  placeholder="Specify reason for leaving campus..."
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  style={styles.textInput}
                  required
                />
                <div style={styles.chipGroup}>
                  {[
                    "Monthly 3-Day Home Leave",
                    "Bookplus / Stationery",
                    "Medical / Hospital Case",
                    "Friday Jumu'ah / Outing",
                    "Personal Purchase",
                    "Department / Official Work",
                    "Home Leave",
                  ].map((rsn) => (
                    <button
                      type="button"
                      key={rsn}
                      onClick={() => setPurpose(rsn)}
                      style={
                        purpose === rsn
                          ? styles.quickChipActive
                          : styles.quickChip
                      }
                    >
                      📝 {rsn}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 18 }}>
                <label style={styles.fieldLabel}>
                  5. Permitted Date &amp; Time Schedule
                </label>

                <div
                  style={{
                    ...styles.chipGroup,
                    marginTop: 0,
                    marginBottom: 12,
                    background: "#f8fafc",
                    padding: "10px",
                    borderRadius: "12px",
                    border: "1px solid #cbd5e1",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => applyHoursDuration(1, "1h")}
                    style={
                      activeDurationChip === "1h" && !isOpenReturn
                        ? styles.quickChipActive
                        : styles.quickChip
                    }
                  >
                    ⏱️ +1 Hr
                  </button>
                  <button
                    type="button"
                    onClick={() => applyHoursDuration(2, "2h")}
                    style={
                      activeDurationChip === "2h" && !isOpenReturn
                        ? styles.quickChipActive
                        : styles.quickChip
                    }
                  >
                    ⏱️ +2 Hrs
                  </button>
                  <button
                    type="button"
                    onClick={applyUntilEvening}
                    style={
                      activeDurationChip === "6pm" && !isOpenReturn
                        ? styles.quickChipActive
                        : styles.quickChip
                    }
                  >
                    🌇 Today 6:00 PM
                  </button>
                  <button
                    type="button"
                    onClick={() => applyDaysDuration(1, "1d")}
                    style={
                      activeDurationChip === "1d" && !isOpenReturn
                        ? styles.quickChipActive
                        : styles.quickChip
                    }
                  >
                    📅 +1 Day
                  </button>
                  <button
                    type="button"
                    onClick={() => applyDaysDuration(3, "3d")}
                    style={
                      activeDurationChip === "3d" && !isOpenReturn
                        ? styles.quickChipActive
                        : styles.quickChip
                    }
                  >
                    📅 +3 Days (Monthly Home)
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsOpenReturn(!isOpenReturn)}
                    style={
                      isOpenReturn
                        ? styles.medicalOpenBtnActive
                        : styles.medicalOpenBtnInactive
                    }
                  >
                    {isOpenReturn
                      ? "✓ 🏥 Open Return (Medical)"
                      : "🏥 Open Return (Medical)"}
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
                      value={
                        selectedTeacherOverride ||
                        getOfficialTeacherName(staffName)
                      }
                      onChange={(e) =>
                        setSelectedTeacherOverride(e.target.value)
                      }
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
                    <div
                      style={{
                        fontSize: 16,
                        fontWeight: 800,
                        color: "#0f172a",
                      }}
                    >
                      👨‍🏫 {getOfficialTeacherName(staffName)}
                    </div>
                  )}
                </div>
                <span style={styles.verifiedAccountBadge}>
                  ✓ Verified Teacher
                </span>
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
                  background: !activePermissionCheck.allowed
                    ? "#dc2626"
                    : "#0f766e",
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
                📋 My Permitted &amp; Class Students ({myPermittedPasses.length}
                )
              </h3>
              <p style={styles.cardSubtitle}>
                Leaves permitted by{" "}
                <strong>{getOfficialTeacherName(staffName)}</strong>
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
              {
                id: "ALL",
                label: "All Mine",
                count: myPermittedPasses.length,
              },
              {
                id: "OUTSIDE",
                label: "Active Out",
                count: myOutsideCount,
              },
              {
                id: "UNVERIFIED",
                label: "⚠️ Verify Arrival",
                count: myUnverifiedCount,
              },
              {
                id: "RETURNED",
                label: "Returned",
                count: myReturnedCount,
              },
            ].map((tab) => {
              const active = teacherStatusFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setTeacherStatusFilter(tab.id)}
                  style={
                    active
                      ? styles.segmentBtnActive
                      : styles.segmentBtnInactive
                  }
                >
                  <span>{tab.label}</span>
                  <span
                    style={
                      active
                        ? styles.segmentBadgeActive
                        : styles.segmentBadgeInactive
                    }
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          <div style={{ position: "relative", marginBottom: 14 }}>
            <input
              type="text"
              placeholder="Filter students by name, Ad.No, or place..."
              value={teacherSearch}
              onChange={(e) => setTeacherSearch(e.target.value)}
              style={styles.searchInputSmall}
            />
          </div>

          {filteredTeacherPasses.length === 0 ? (
            <div style={styles.emptyStateBox}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
              <div style={{ fontWeight: 700, color: "#334155" }}>
                No permitted leaves found
              </div>
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
                          ? "5px solid #7c3aed"
                          : p.status === "OUTSIDE"
                          ? isOverdue
                            ? "5px solid #dc2626"
                            : "5px solid #f59e0b"
                          : p.status === "APPROVED"
                          ? "5px solid #0284c7"
                          : "5px solid #10b981",
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
                      <div
                        style={{
                          display: "flex",
                          gap: 12,
                          flex: 1,
                          minWidth: 220,
                        }}
                      >
                        <StudentAvatar
                          name={p.studentName}
                          adNo={p.adNo}
                          photoUrl={photoUrl}
                          size={46}
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
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              flexWrap: "wrap",
                            }}
                          >
                            <span
                              style={{
                                fontWeight: 800,
                                fontSize: 15,
                                color: "#0f172a",
                              }}
                            >
                              {p.studentName}
                            </span>
                            <span style={styles.adNoBadge}>#{p.adNo}</span>
                            <span style={styles.classPill}>
                              {p.studentClass} (Degree)
                            </span>
                            <span
                              style={{
                                ...styles.classPill,
                                background: "#fef3c7",
                                color: "#92400e",
                              }}
                            >
                              {p.leaveCategory ? p.leaveCategory : "General"}
                            </span>
                          </div>

                          <div
                            style={{
                              fontSize: 13,
                              color: "#1e293b",
                              marginTop: 4,
                              fontWeight: 600,
                            }}
                          >
                            📍 {p.destination} —{" "}
                            <span style={{ color: "#64748b" }}>
                              {p.purpose}
                            </span>
                          </div>

                          {p.extensionReason && (
                            <div
                              style={{
                                fontSize: 12,
                                color: "#047857",
                                fontWeight: 800,
                                marginTop: 3,
                              }}
                            >
                              ⏳ Permitted Extension: {p.extensionReason}
                            </div>
                          )}

                          <div
                            style={{
                              fontSize: 12,
                              color: "#475569",
                              marginTop: 4,
                            }}
                          >
                            <div>
                              🕒 Permitted:{" "}
                              <strong>
                                {formatDateTime12Hour(p.permittedFrom)}
                              </strong>{" "}
                              ➔{" "}
                              <strong>
                                {formatDateTime12Hour(
                                  p.permittedTo,
                                  p.isOpenReturn
                                )}
                              </strong>
                            </div>
                            {p.gateDepartureTime && (
                              <div>
                                🚪 Gate Exit:{" "}
                                <strong>
                                  {formatDateTime12Hour(p.gateDepartureTime)}
                                </strong>
                              </div>
                            )}
                            {p.gateArrivalTime && (
                              <div
                                style={{
                                  color: "#6d28d9",
                                  fontWeight: 700,
                                }}
                              >
                                🏁 Gate Arrival:{" "}
                                {formatDateTime12Hour(p.gateArrivalTime)}
                              </div>
                            )}
                          </div>

                          <div
                            style={{
                              marginTop: 4,
                              fontSize: 12,
                              fontWeight: 700,
                              color: isOverdue ? "#dc2626" : "#0f766e",
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

                        <div
                          style={{
                            display: "flex",
                            gap: 6,
                            flexWrap: "wrap",
                            justifyContent: "flex-end",
                          }}
                        >
                          {stObj && (
                            <button
                              type="button"
                              onClick={() => setPortfolioModalStudent(stObj)}
                              style={styles.editPassBtn}
                            >
                              🏆 Portfolio
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

                        {(p.status === "APPROVED" ||
                          p.status === "OUTSIDE") && (
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