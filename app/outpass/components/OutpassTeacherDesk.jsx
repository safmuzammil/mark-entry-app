"use client";
import React, { useState, useMemo } from "react";
import {
  LEAVE_CATEGORIES,
  PRESET_DESTINATIONS,
  dateTo12HourParts,
  formatDateTime12Hour,
  getLocalDateString,
  StudentAvatar,
  CustomDateTimePicker,
  getStatusBadgeStyle,
  styles,
} from "./outpassHelpers";

const QUICK_DESTINATIONS = Array.from(
  new Set([
    "Home",
    "Chemmad",
    "Bookplus",
    "Mampuram",
    "Tirurangadi Hospital",
    "Bank / ATM",
    "Barber Shop",
    "Medical Store",
    "Kozhikode",
    "Malappuram",
    ...(PRESET_DESTINATIONS || []),
  ])
);

const QUICK_PURPOSES = [
  "Monthly 3-Day Home Leave",
  "Bookplus / Stationery",
  "Medical / Hospital Case",
  "Friday Jumu'ah / Outing",
  "Personal Purchase",
  "Department / Official Work",
  "Family Function / Visit",
  "Dental / Eye Checkup",
  "Home Leave",
];

export default function OutpassTeacherDesk({
  activeLeaveSubTab = "outpass",
  setActiveLeaveSubTab,
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
  const [selectedMonthlyDays, setSelectedMonthlyDays] = useState(3);
  const [isCustomDestActive, setIsCustomDestActive] = useState(false);
  const [isCustomPurposeActive, setIsCustomPurposeActive] = useState(false);
  const [customCategoryText, setCustomCategoryText] = useState("");

  const [homeLeaveStreamMode, setHomeLeaveStreamMode] = useState("MALAYALI_ONLY");
  const [batchCustomSearch, setBatchCustomSearch] = useState("");
  const [lateComerScopeFilter, setLateComerScopeFilter] = useState("ALL");

  const showStudentSearchBox = isGroupMode ? true : !selectedStudent;

  const myActiveClasses = hasPrincipalPower
    ? classFilter !== "ALL"
      ? [classFilter]
      : ["QH1", "AL1", "FC1", "QH2", "AL2", "FC2", "QLA3", "HFC3"]
    : myPrivileges.classTeacherOf || [];

  const isUrduAdNo = (adNo) =>
    String(adNo || "")
      .trim()
      .toUpperCase()
      .startsWith("U");

  const activeClassHomePassesCount = passes.filter(
    (p) =>
      (myActiveClasses.includes(p.studentClass) ||
        (myPrivileges.isNiicsCoordinator && isUrduAdNo(p.adNo))) &&
      (p.status === "OUTSIDE" ||
        p.status === "ARRIVED_AT_GATE" ||
        p.status === "APPROVED")
  ).length;

  const batchCustomMatches = useMemo(() => {
    const q = batchCustomSearch.trim().toLowerCase();
    if (!q) return [];
    return students
      .filter(
        (s) =>
          String(s.adNo || "").toLowerCase().includes(q) ||
          String(s.name || s.firstName || "").toLowerCase().includes(q)
      )
      .slice(0, 6);
  }, [batchCustomSearch, students]);

  const habitualLateComersList = useMemo(() => {
    const map = {};
    const myOfficialName = getOfficialTeacherName(staffName).toLowerCase();

    myPermittedPasses.forEach((p) => {
      if (p.status === "CANCELLED") return;
      const isLate = Boolean(p.wasLateReturn || isPassOverdue(p));
      if (!isLate) return;

      const isMyAssignedClass = (myPrivileges.classTeacherOf || []).includes(
        p.studentClass
      );
      const isPermittedByMe =
        getOfficialTeacherName(p.teacherName).toLowerCase() === myOfficialName;

      if (lateComerScopeFilter === "MY_CLASS" && !isMyAssignedClass) return;
      if (lateComerScopeFilter === "MY_PERMITTED" && !isPermittedByMe) return;

      const key = String(p.adNo || "").trim().toUpperCase();
      if (!key) return;

      if (!map[key]) {
        const stObj = getStudentByAdNo(p.adNo);
        map[key] = {
          adNo: p.adNo,
          studentName: p.studentName || stObj?.name || "Student",
          studentClass: p.studentClass || stObj?.studentClass || "—",
          photoUrl: getStudentPhotoByAdNo(p.adNo),
          lateCount: 0,
          currentlyOverdue: false,
          isMyAssignedClass,
          isPermittedByMe,
          incidents: [],
        };
      }
      map[key].lateCount += 1;
      if (isPassOverdue(p)) map[key].currentlyOverdue = true;
      map[key].incidents.push({
        id: p.id,
        destination: p.destination,
        category: p.leaveCategory || "General",
        permittedTo: p.permittedTo,
        actualReturnTime: p.actualReturnTime || p.gateArrivalTime,
        status: p.status,
        teacherName: getOfficialTeacherName(p.teacherName),
      });
    });

    return Object.values(map)
      .filter((item) => {
        if (!teacherSearch.trim()) return true;
        const q = teacherSearch.toLowerCase();
        return (
          item.studentName.toLowerCase().includes(q) ||
          String(item.adNo).toLowerCase().includes(q) ||
          String(item.studentClass).toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.lateCount - a.lateCount);
  }, [
    myPermittedPasses,
    lateComerScopeFilter,
    teacherSearch,
    myPrivileges.classTeacherOf,
    staffName,
    now,
  ]);

  const formatCategoryLabel = (cat) => {
    if (cat === "Weekend_Thu_Sat") return "Weekend (Thu Eve – Sat)";
    if (cat === "Monthly_Home") return "🏠 Monthly Home (3 Days)";
    return cat || "General";
  };

  const handleSelectCategoryOption = (cat) => {
    setLeaveCategory(cat);
    if (cat === "Medical") {
      setIsOpenReturn(true);
    } else if (cat === "Evening") {
      applyUntilEvening();
    } else if (cat === "Monthly_Home") {
      setDestination("Home");
      setPurpose("Monthly 3-Day Home Leave");
      applyDaysDuration(3, "3d");
    } else if (cat === "Weekend_Thu_Sat") {
      applyDaysDuration(2, "2d");
    }
  };

  const handleLoadHomeLeaveStudents = (streamOverride) => {
    const modeToUse = streamOverride || homeLeaveStreamMode;
    const targetClasses =
      (myPrivileges.classTeacherOf || []).length > 0
        ? myPrivileges.classTeacherOf
        : myActiveClasses;

    const batchStudents = students.filter((s) => {
      const inTargetClass = targetClasses.includes(s.studentClass);
      if (
        myPrivileges.isNiicsCoordinator &&
        !hasPrincipalPower &&
        (myPrivileges.classTeacherOf || []).length === 0
      ) {
        return isUrduAdNo(s.adNo);
      }
      if (!inTargetClass) return false;

      const isUrdu = isUrduAdNo(s.adNo);
      if (modeToUse === "MALAYALI_ONLY") {
        return !isUrdu;
      }
      if (modeToUse === "URDU_ONLY") {
        return isUrdu;
      }
      return true;
    });

    setIsGroupMode(true);
    setSelectedGroupStudents(batchStudents);
    setLeaveCategory("Monthly_Home");
    setDestination("Home");
    setPurpose("Monthly 3-Day Home Leave");
    applyDaysDuration(selectedMonthlyDays, `${selectedMonthlyDays}d`);
  };

  if (activeLeaveSubTab === "my_permitted") {
    return (
      <div style={styles.card}>
        <div style={styles.cardHeaderRow}>
          <div>
            <h3 style={styles.cardTitle}>
              📋 My Permitted &amp; Class Students ({myPermittedPasses.length})
            </h3>
            <p style={styles.cardSubtitle}>
              Leaves permitted by{" "}
              <strong>{getOfficialTeacherName(staffName)}</strong>
              {(myPrivileges.classTeacherOf || []).length > 0 &&
                ` + Class ${myPrivileges.classTeacherOf.join(", ")}`}
            </p>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {setActiveLeaveSubTab && (
              <button
                type="button"
                onClick={() => setActiveLeaveSubTab("outpass")}
                style={styles.editPassBtn}
              >
                ➕ Issue New Outpass
              </button>
            )}
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
        </div>

        <div style={styles.segmentedBar}>
          {[
            { id: "ALL", label: "All Mine", count: myPermittedPasses.length },
            { id: "OUTSIDE", label: "Active Out", count: myOutsideCount },
            {
              id: "UNVERIFIED",
              label: "⚠️ Verify Arrival",
              count: myUnverifiedCount,
            },
            { id: "RETURNED", label: "Returned", count: myReturnedCount },
            {
              id: "ALL_CAMPUS_OUTSIDE",
              label: "🌍 All Campus Outside",
              count: passes.filter((p) => p.status === "OUTSIDE" || p.status === "APPROVED").length,
            },
            {
              id: "LATE_COMERS",
              label: "🚨 Habitual Late Comers",
              count: habitualLateComersList.length,
            },
          ].map((tab) => {
            const active = teacherStatusFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setTeacherStatusFilter(tab.id)}
                style={
                  active ? styles.segmentBtnActive : styles.segmentBtnInactive
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

        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "center",
            marginBottom: 14,
          }}
        >
          <div style={{ position: "relative", flex: 1, minWidth: 240 }}>
            <input
              type="text"
              placeholder="Filter students by name, Ad.No, or place..."
              value={teacherSearch}
              onChange={(e) => setTeacherSearch(e.target.value)}
              style={styles.searchInputSmall}
            />
          </div>

          {teacherStatusFilter === "LATE_COMERS" && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[
                { id: "ALL", label: "All Scope" },
                { id: "MY_CLASS", label: "🏫 My Assigned Class" },
                { id: "MY_PERMITTED", label: "👨‍🏫 Permitted By Me" },
              ].map((sc) => (
                <button
                  key={sc.id}
                  type="button"
                  onClick={() => setLateComerScopeFilter(sc.id)}
                  style={{
                    padding: "7px 12px",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 800,
                    cursor: "pointer",
                    border:
                      lateComerScopeFilter === sc.id
                        ? "1.5px solid #e11d48"
                        : "1px solid #cbd5e1",
                    background:
                      lateComerScopeFilter === sc.id ? "#fff1f2" : "#ffffff",
                    color:
                      lateComerScopeFilter === sc.id ? "#be123c" : "#334155",
                  }}
                >
                  {sc.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {teacherStatusFilter === "ALL_CAMPUS_OUTSIDE" ? (
          (() => {
            const allCampusOut = passes.filter((p) => {
              if (p.status !== "OUTSIDE" && p.status !== "APPROVED") return false;
              if (!teacherSearch.trim()) return true;
              const q = teacherSearch.toLowerCase();
              return (
                p.studentName?.toLowerCase().includes(q) ||
                String(p.adNo).toLowerCase().includes(q) ||
                String(p.studentClass).toLowerCase().includes(q) ||
                p.destination?.toLowerCase().includes(q) ||
                getOfficialTeacherName(p.teacherName).toLowerCase().includes(q)
              );
            });

            if (allCampusOut.length === 0) {
              return (
                <div style={styles.emptyStateBox}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>🏫</div>
                  <div style={{ fontWeight: 700, color: "#334155" }}>
                    All students are currently inside campus!
                  </div>
                </div>
              );
            }

            return (
              <div style={styles.passListScroll}>
                {allCampusOut.map((p) => {
                  const isOverdue = isPassOverdue(p);
                  const photoUrl = getStudentPhotoByAdNo(p.adNo);
                  return (
                    <div
                      key={p.id}
                      style={{
                        ...styles.passCardItem,
                        borderLeft: isOverdue ? "4px solid #e11d48" : "4px solid #f59e0b",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
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
                              <span style={{ fontWeight: 800, fontSize: 15, color: "#0f172a" }}>
                                {p.studentName}
                              </span>
                              <span style={styles.adNoBadge}>#{p.adNo}</span>
                              <span style={styles.classPill}>Class {p.studentClass}</span>
                              <span style={{ ...styles.classPill, background: "#eef2ff", color: "#4f46e5" }}>
                                {p.leaveCategory || "General"}
                              </span>
                            </div>

                            <div style={{ fontSize: 13, color: "#1e293b", marginTop: 4, fontWeight: 600 }}>
                              📍 {p.destination} — <span style={{ color: "#64748b" }}>{p.purpose}</span>
                            </div>

                            <div style={{ fontSize: 12, color: "#0f172a", marginTop: 4, background: "#f8fafc", padding: "6px 10px", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                              <div>
                                👨‍🏫 <strong>Permitted By:</strong> Usthad {getOfficialTeacherName(p.teacherName)}
                                {p.teacherPhone ? ` (📞 ${p.teacherPhone})` : ""}
                              </div>
                              <div style={{ marginTop: 2 }}>
                                🕒 <strong>Time Limit:</strong> {formatDateTime12Hour(p.permittedFrom)} ➔{" "}
                                <strong style={{ color: isOverdue ? "#e11d48" : "#047857" }}>
                                  {formatDateTime12Hour(p.permittedTo, p.isOpenReturn)}
                                </strong>
                              </div>
                            </div>

                            <div style={{ marginTop: 4, fontSize: 12, fontWeight: 800, color: isOverdue ? "#e11d48" : "#047857" }}>
                              ⏱️ {getRemainingTimeText(p)}
                            </div>
                          </div>
                        </div>

                        <span style={getStatusBadgeStyle(p, now)}>
                          {p.status === "OUTSIDE" && isOverdue ? "🚨 OVERDUE OUTSIDE" : p.status === "OUTSIDE" ? "🟠 OUTSIDE CAMPUS" : "🔵 PERMITTED"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()
        ) : teacherStatusFilter === "LATE_COMERS" ? (
          habitualLateComersList.length === 0 ? (
            <div style={styles.emptyStateBox}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
              <div style={{ fontWeight: 700, color: "#334155" }}>
                Zero Habitual Late Comers Found!
              </div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                All students in your permitted list and assigned class returned on
                time.
              </div>
            </div>
          ) : (
            <div style={styles.passListScroll}>
              {habitualLateComersList.map((item, idx) => {
                const stObj = getStudentByAdNo(item.adNo);
                return (
                  <div
                    key={item.adNo}
                    style={{
                      ...styles.passCardItem,
                      borderLeft: "4px solid #e11d48",
                      background: item.currentlyOverdue ? "#fff1f2" : "#f8fafc",
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
                      <div style={{ display: "flex", gap: 12, flex: 1 }}>
                        <StudentAvatar
                          name={item.studentName}
                          adNo={item.adNo}
                          photoUrl={item.photoUrl}
                          size={44}
                          onClick={() =>
                            setZoomPhotoStudent({
                              name: item.studentName,
                              adNo: item.adNo,
                              studentClass: item.studentClass,
                              photoUrl: item.photoUrl,
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
                              #{idx + 1} • {item.studentName}
                            </span>
                            <span style={styles.adNoBadge}>#{item.adNo}</span>
                            <span style={styles.classPill}>
                              Class {item.studentClass}
                            </span>
                            {item.isMyAssignedClass && (
                              <span
                                style={{
                                  ...styles.classPill,
                                  background: "#ecfdf5",
                                  color: "#047857",
                                }}
                              >
                                🏫 My Class Student
                              </span>
                            )}
                            {item.isPermittedByMe && (
                              <span
                                style={{
                                  ...styles.classPill,
                                  background: "#eef2ff",
                                  color: "#4f46e5",
                                }}
                              >
                                👨‍🏫 Permitted By Me
                              </span>
                            )}
                          </div>

                          <div
                            style={{
                              marginTop: 6,
                              display: "flex",
                              flexDirection: "column",
                              gap: 4,
                            }}
                          >
                            {item.incidents.slice(0, 4).map((inc) => (
                              <div
                                key={inc.id}
                                style={{
                                  fontSize: 12,
                                  color: "#334155",
                                  background: "#ffffff",
                                  padding: "5px 9px",
                                  borderRadius: 6,
                                  border: "1px solid #fecdd3",
                                }}
                              >
                                📍 <strong>{inc.destination}</strong> (
                                {inc.category}) • Due:{" "}
                                <strong>
                                  {formatDateTime12Hour(inc.permittedTo)}
                                </strong>
                                {inc.actualReturnTime
                                  ? ` • Returned: ${formatDateTime12Hour(
                                      inc.actualReturnTime
                                    )}`
                                  : " • 🚨 Still Outside / Overdue"}
                              </div>
                            ))}
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
                        <span
                          style={{
                            background: "#e11d48",
                            color: "#ffffff",
                            padding: "5px 12px",
                            borderRadius: 999,
                            fontSize: 12,
                            fontWeight: 800,
                          }}
                        >
                          🚨 {item.lateCount} Late Return{item.lateCount > 1 ? "s" : ""}
                        </span>

                        {stObj && (
                          <button
                            type="button"
                            onClick={() => setPortfolioModalStudent(stObj)}
                            style={styles.editPassBtn}
                          >
                            🏆 Portfolio
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : filteredTeacherPasses.length === 0 ? (
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
                              background: "#eef2ff",
                              color: "#4f46e5",
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
                          <span style={{ color: "#64748b" }}>{p.purpose}</span>
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
                              style={{ color: "#4f46e5", fontWeight: 700 }}
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
                          ? !p.isOpenReturn &&
                            p.permittedTo &&
                            new Date(now) > new Date(p.permittedTo)
                            ? "⛔ EXPIRED RETURN DEADLINE (BLOCKED)"
                            : "🔵 PERMITTED (AT CAMPUS)"
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
    );
  }

  // ============================================================================
  // SUB-TAB 1: GATE OUTPASS PERMISSION DESK
  // ============================================================================
  return (
    <>
      {/* 🏠 CLASS TEACHER HOME LEAVE MODULE */}
      {((myPrivileges.classTeacherOf || []).length > 0 ||
        hasPrincipalPower ||
        myPrivileges.isNiicsCoordinator) && (
        <div
          style={{
            background: "#ffffff",
            borderRadius: 14,
            border: showHomeBatchTools
              ? "1.5px solid #4f46e5"
              : "1px solid #e2e8f0",
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
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
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
                🏠 CLASS TEACHER HOME LEAVE MODULE
              </span>
              <span style={{ fontSize: 14, fontWeight: 800, color: "#0f172a" }}>
                Monthly Home Leave Generator, Stream Toggle &amp; Bulk Return
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
                flexDirection: "column",
                gap: 14,
              }}
            >
              {/* ROW 1: STREAM TOGGLE (MALAYALI ONLY vs URDU ONLY vs ALL) */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 10,
                  background: "#f8fafc",
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid #e2e8f0",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: "#0f172a" }}>
                    1. Select Stream Filter:
                  </span>
                  {[
                    { id: "MALAYALI_ONLY", label: "🌴 Malayali Only Students" },
                    { id: "URDU_ONLY", label: "🎓 Urdu Only Students (#U...)" },
                    { id: "ALL", label: "👥 All Class Students" },
                  ].map((opt) => {
                    const active = homeLeaveStreamMode === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setHomeLeaveStreamMode(opt.id);
                          handleLoadHomeLeaveStudents(opt.id);
                        }}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 8,
                          fontSize: 12,
                          fontWeight: 800,
                          cursor: "pointer",
                          border: active ? "1.5px solid #4f46e5" : "1px solid #cbd5e1",
                          background: active ? "#4f46e5" : "#ffffff",
                          color: active ? "#ffffff" : "#334155",
                        }}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>

                {/* Custom Student Search Adder right inside Batch Module */}
                <div style={{ position: "relative", minWidth: 260, flex: "1 1 260px", maxWidth: 360 }}>
                  <input
                    type="text"
                    placeholder="➕ Search & add custom student (Name / Ad.No)..."
                    value={batchCustomSearch}
                    onChange={(e) => setBatchCustomSearch(e.target.value)}
                    style={{
                      ...styles.textInput,
                      padding: "7px 12px",
                      fontSize: 12,
                    }}
                  />
                  {batchCustomMatches.length > 0 && (
                    <div
                      style={{
                        position: "absolute",
                        top: "100%",
                        left: 0,
                        right: 0,
                        background: "#ffffff",
                        border: "1.5px solid #4f46e5",
                        borderRadius: 10,
                        boxShadow: "0 10px 25px rgba(15,23,42,0.15)",
                        zIndex: 50,
                        marginTop: 4,
                        maxHeight: 200,
                        overflowY: "auto",
                      }}
                    >
                      {batchCustomMatches.map((st) => {
                        const alreadyInGroup = selectedGroupStudents.some(
                          (x) => x.adNo === st.adNo
                        );
                        return (
                          <div
                            key={st.id}
                            onClick={() => {
                              setIsGroupMode(true);
                              if (!alreadyInGroup) {
                                setSelectedGroupStudents((prev) => [...prev, st]);
                              }
                              setBatchCustomSearch("");
                            }}
                            style={{
                              padding: "8px 12px",
                              borderBottom: "1px solid #f1f5f9",
                              cursor: "pointer",
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              fontSize: 12,
                              fontWeight: 700,
                            }}
                          >
                            <span>
                              {st.name} (#{st.adNo} • {st.studentClass})
                            </span>
                            <span
                              style={{
                                color: alreadyInGroup ? "#10b981" : "#4f46e5",
                                fontWeight: 800,
                              }}
                            >
                              {alreadyInGroup ? "✓ Added" : "+ Add"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* ROW 2: ACTION BUTTONS */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => handleLoadHomeLeaveStudents(homeLeaveStreamMode)}
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
                    🏠 Load Selected Stream ({homeLeaveStreamMode === "MALAYALI_ONLY" ? "Malayali Only" : homeLeaveStreamMode === "URDU_ONLY" ? "Urdu Only" : "All Class"})
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
                      ✅ Bulk Mark Returned ({activeClassHomePassesCount} Active)
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      const classHomePasses = passes.filter(
                        (p) =>
                          (myActiveClasses.includes(p.studentClass) ||
                            (myPrivileges.isNiicsCoordinator &&
                              isUrduAdNo(p.adNo))) &&
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
                        `*Scope:* Class ${myActiveClasses.join(", ")} | *By:* ${getOfficialTeacherName(staffName)}`,
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
                                `${i + 1}. *${p.studentName} (#${p.adNo}, ${p.studentClass})* — Due: ${formatDateTime12Hour(p.permittedTo)} [${p.status === "RETURNED" ? "Returned Late" : "Still Outside"}]`
                            )),
                        ``,
                        `*⏳ PERMITTED EXTENSIONS (${permittedExtensions.length}):*`,
                        ...(permittedExtensions.length === 0
                          ? ["None"]
                          : permittedExtensions.map(
                              (p, i) =>
                                `${i + 1}. *${p.studentName} (#${p.adNo})* — Extended till ${formatDateTime12Hour(p.permittedTo)} (Reason: ${p.extensionReason})`
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
                    📋 Copy Latecomers Report for Principal
                  </button>
                </div>

                {selectedGroupStudents.length > 0 && (
                  <span style={{ fontSize: 12, fontWeight: 800, color: "#4f46e5" }}>
                    ✓ {selectedGroupStudents.length} Students Loaded in Group Below
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* FULL-WIDTH SINGLE-COLUMN OUTPASS ISSUE FORM */}
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
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: "#4f46e5",
                letterSpacing: "0.6px",
                textTransform: "uppercase",
              }}
            >
              DEGREE SECTION • TEACHER LEAVE PERMISSION DESK
            </div>
            <h2
              style={{
                margin: "2px 0 0",
                fontSize: 18,
                fontWeight: 800,
                color: "#0f172a",
              }}
            >
              Permit Student Out-Pass
            </h2>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
                border: isGroupMode
                  ? "1px solid #4f46e5"
                  : "1px solid #cbd5e1",
                padding: "7px 14px",
                borderRadius: "8px",
                fontSize: "12px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {isGroupMode
                ? "👥 Group Out-Pass Mode (ON)"
                : "👤 Single Student (Click for Group Pass)"}
            </button>

            {setActiveLeaveSubTab && (
              <button
                type="button"
                onClick={() => setActiveLeaveSubTab("my_permitted")}
                style={{
                  background: "#eef2ff",
                  color: "#4f46e5",
                  border: "1px solid #c7d2fe",
                  padding: "7px 14px",
                  borderRadius: "8px",
                  fontSize: "12px",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                📋 View My Permitted &amp; Class Students ({myPermittedPasses.length})
              </button>
            )}
          </div>
        </div>

        <div style={styles.slipBody}>
          {/* Authority Badges */}
          <div
            style={{
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              padding: "9px 12px",
              borderRadius: 10,
              marginBottom: 12,
              fontSize: 11,
              color: "#334155",
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              alignItems: "center",
            }}
          >
            <strong>🔑 Authority:</strong>
            <span style={styles.adNoBadge}>🕌 Friday (All)</span>
            <span style={styles.adNoBadge}>🌇 Evening (Mentees)</span>
            {(myPrivileges.classTeacherOf || []).length > 0 && (
              <span style={styles.insideStatusBadge}>
                🏫 CT: {myPrivileges.classTeacherOf.join(", ")}
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
                🎓 NIICS Coordinator
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
            💬 Automatically open Parent&apos;s WhatsApp chat when permitting
            Home Leave
          </label>

          {/* 1. STUDENT SEARCH / SCAN */}
          <div style={{ marginBottom: 18 }}>
            <label style={styles.fieldLabel}>
              1.{" "}
              {isGroupMode
                ? `Select Multiple Students for Group Out-Pass (${selectedGroupStudents.length} selected)`
                : "Select Student (Scan Barcode or Search Ad.No / Name)"}
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
                              <div style={{ fontSize: 12, color: "#475569" }}>
                                Ad.No:{" "}
                                <strong style={{ color: "#4f46e5" }}>
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
                  background: "#f8fafc",
                  padding: 12,
                  borderRadius: 12,
                  border: "1px solid #cbd5e1",
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
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
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
                            color: "#4f46e5",
                            border: "1px solid #c7d2fe",
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
                          <strong style={{ color: "#4f46e5" }}>
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
                          📍 {selectedStudent.district}, {selectedStudent.state}
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
            {/* 2. LEAVE CATEGORY */}
            <div style={{ marginBottom: 16 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 6,
                }}
              >
                <label style={styles.fieldLabel}>2. Leave Category</label>
                {!leaveCategory ? (
                  <span
                    style={{ fontSize: 11, fontWeight: 800, color: "#e11d48" }}
                  >
                    ⚠️ Mandatory: Please select category
                  </span>
                ) : (
                  <span
                    style={{ fontSize: 11, fontWeight: 700, color: "#16a34a" }}
                  >
                    ✓ Selected: {formatCategoryLabel(leaveCategory)}
                  </span>
                )}
              </div>

              <select
                value={leaveCategory || ""}
                onChange={(e) => handleSelectCategoryOption(e.target.value)}
                style={{
                  ...styles.textInput,
                  width: "100%",
                  fontSize: "16px",
                  minHeight: "44px",
                  padding: "8px 12px",
                  fontWeight: 700,
                  color: leaveCategory ? "#0f172a" : "#64748b",
                  background: "#f8fafc",
                  border: "1.5px solid #cbd5e1",
                  borderRadius: "8px",
                  marginBottom: 8,
                  cursor: "pointer",
                }}
              >
                <option value="">-- Select Leave Category --</option>
                <option value="Custom">✍️ Custom Leave Category...</option>
                {LEAVE_CATEGORIES.filter((c) => c !== "Custom").map((cat) => (
                  <option key={cat} value={cat}>
                    {formatCategoryLabel(cat)}
                  </option>
                ))}
              </select>

              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  marginBottom: 8,
                }}
              >
                {[
                  { id: "Monthly_Home", label: "🏠 Monthly Home" },
                  { id: "Evening", label: "☀️ Evening" },
                  { id: "Friday", label: "🕌 Friday" },
                ].map((chip) => {
                  const active = leaveCategory === chip.id;
                  return (
                    <button
                      type="button"
                      key={chip.id}
                      onClick={() => handleSelectCategoryOption(chip.id)}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 8,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                        border: active
                          ? "1.5px solid #4f46e5"
                          : "1px solid #cbd5e1",
                        background: active ? "#4f46e5" : "#ffffff",
                        color: active ? "#ffffff" : "#334155",
                      }}
                    >
                      {chip.label}
                    </button>
                  );
                })}
              </div>

              {leaveCategory === "Monthly_Home" && (
                <div
                  style={{
                    marginTop: 4,
                    padding: "10px 14px",
                    background: "#eef2ff",
                    borderRadius: 8,
                    border: "1px solid #c7d2fe",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{ fontSize: 12, fontWeight: 700, color: "#3730a3" }}
                  >
                    🏠 Monthly Leave Duration:
                  </span>
                  {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => {
                        setSelectedMonthlyDays(d);
                        applyDaysDuration(d, `${d}d`);
                      }}
                      style={{
                        padding: "5px 12px",
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 800,
                        cursor: "pointer",
                        border:
                          selectedMonthlyDays === d
                            ? "1.5px solid #4f46e5"
                            : "1px solid #cbd5e1",
                        background:
                          selectedMonthlyDays === d ? "#4f46e5" : "#ffffff",
                        color:
                          selectedMonthlyDays === d ? "#ffffff" : "#475569",
                      }}
                    >
                      {d} {d === 1 ? "Day" : "Days"}
                    </button>
                  ))}
                </div>
              )}

              {leaveCategory === "Custom" && (
                <div style={{ marginTop: 8 }}>
                  <input
                    type="text"
                    placeholder="Type custom leave category name..."
                    value={customCategoryText}
                    onChange={(e) => {
                      setCustomCategoryText(e.target.value);
                      setPurpose(
                        e.target.value
                          ? `Custom Leave: ${e.target.value}`
                          : ""
                      );
                    }}
                    style={{
                      ...styles.textInput,
                      width: "100%",
                      fontSize: "16px",
                      minHeight: "44px",
                    }}
                    autoFocus
                  />
                </div>
              )}
            </div>

            {/* 3. DESTINATION */}
            <div style={{ marginBottom: 16 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 6,
                }}
              >
                <label style={styles.fieldLabel}>3. Destination</label>
                {!destination ? (
                  <span
                    style={{ fontSize: 11, fontWeight: 800, color: "#e11d48" }}
                  >
                    ⚠️ Mandatory: Please select or enter destination
                  </span>
                ) : (
                  <span
                    style={{ fontSize: 11, fontWeight: 700, color: "#16a34a" }}
                  >
                    ✓ Selected: 📍 {destination}
                  </span>
                )}
              </div>

              <select
                value={
                  isCustomDestActive ||
                  (destination && !QUICK_DESTINATIONS.includes(destination))
                    ? "CUSTOM"
                    : destination || ""
                }
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "CUSTOM") {
                    setIsCustomDestActive(true);
                  } else if (val) {
                    setDestination(val);
                    setIsCustomDestActive(false);
                  } else {
                    setDestination("");
                    setIsCustomDestActive(false);
                  }
                }}
                style={{
                  ...styles.textInput,
                  width: "100%",
                  fontSize: "16px",
                  minHeight: "44px",
                  padding: "8px 12px",
                  fontWeight: 700,
                  color: destination ? "#0f172a" : "#64748b",
                  background: "#f8fafc",
                  border: "1.5px solid #cbd5e1",
                  borderRadius: "8px",
                  marginBottom: 8,
                  cursor: "pointer",
                }}
              >
                <option value="">-- Select Destination --</option>
                <option value="CUSTOM">✍️ Custom Destination / Place...</option>
                {QUICK_DESTINATIONS.map((place) => (
                  <option key={place} value={place}>
                    📍 {place}
                  </option>
                ))}
              </select>

              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  marginBottom: 8,
                }}
              >
                {["Home", "Chemmad", "Bookplus"].map((place) => {
                  const active = destination === place && !isCustomDestActive;
                  return (
                    <button
                      type="button"
                      key={place}
                      onClick={() => {
                        setDestination(place);
                        setIsCustomDestActive(false);
                      }}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 8,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                        border: active
                          ? "1.5px solid #4f46e5"
                          : "1px solid #cbd5e1",
                        background: active ? "#4f46e5" : "#ffffff",
                        color: active ? "#ffffff" : "#334155",
                      }}
                    >
                      📍 {place}
                    </button>
                  );
                })}
              </div>

              {(isCustomDestActive ||
                (destination &&
                  !QUICK_DESTINATIONS.includes(destination))) && (
                <input
                  type="text"
                  placeholder="Type custom destination..."
                  value={destination}
                  onChange={(e) => {
                    setDestination(e.target.value);
                    setIsCustomDestActive(true);
                  }}
                  style={{
                    ...styles.textInput,
                    width: "100%",
                    fontSize: "16px",
                    minHeight: "44px",
                  }}
                  autoFocus
                  required
                />
              )}
            </div>

            {/* 4. PURPOSE / REASON */}
            <div style={{ marginBottom: 16 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 6,
                }}
              >
                <label style={styles.fieldLabel}>
                  4. Purpose / Reason for Leave
                </label>
                {!purpose ? (
                  <span
                    style={{ fontSize: 11, fontWeight: 800, color: "#e11d48" }}
                  >
                    ⚠️ Mandatory: Please select or enter purpose
                  </span>
                ) : (
                  <span
                    style={{ fontSize: 11, fontWeight: 700, color: "#16a34a" }}
                  >
                    ✓ Selected: 📝 {purpose}
                  </span>
                )}
              </div>

              <select
                value={
                  isCustomPurposeActive ||
                  (purpose && !QUICK_PURPOSES.includes(purpose))
                    ? "CUSTOM"
                    : purpose || ""
                }
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "CUSTOM") {
                    setIsCustomPurposeActive(true);
                  } else if (val) {
                    setPurpose(val);
                    setIsCustomPurposeActive(false);
                  } else {
                    setPurpose("");
                    setIsCustomPurposeActive(false);
                  }
                }}
                style={{
                  ...styles.textInput,
                  width: "100%",
                  fontSize: "16px",
                  minHeight: "44px",
                  padding: "8px 12px",
                  fontWeight: 700,
                  color: purpose ? "#0f172a" : "#64748b",
                  background: "#f8fafc",
                  border: "1.5px solid #cbd5e1",
                  borderRadius: "8px",
                  marginBottom: 8,
                  cursor: "pointer",
                }}
              >
                <option value="">-- Select Purpose / Reason --</option>
                <option value="CUSTOM">✍️ Custom Purpose / Reason...</option>
                {QUICK_PURPOSES.map((rsn) => (
                  <option key={rsn} value={rsn}>
                    📝 {rsn}
                  </option>
                ))}
              </select>

              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  marginBottom: 8,
                }}
              >
                {[
                  "Monthly 3-Day Home Leave",
                  "Medical / Hospital Case",
                  "Personal Purchase",
                ].map((rsn) => {
                  const active = purpose === rsn && !isCustomPurposeActive;
                  return (
                    <button
                      type="button"
                      key={rsn}
                      onClick={() => {
                        setPurpose(rsn);
                        setIsCustomPurposeActive(false);
                      }}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 8,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                        border: active
                          ? "1.5px solid #4f46e5"
                          : "1px solid #cbd5e1",
                        background: active ? "#4f46e5" : "#ffffff",
                        color: active ? "#ffffff" : "#334155",
                      }}
                    >
                      📝 {rsn}
                    </button>
                  );
                })}
              </div>

              {(isCustomPurposeActive ||
                (purpose && !QUICK_PURPOSES.includes(purpose))) && (
                <input
                  type="text"
                  placeholder="Type custom reason for leave..."
                  value={purpose}
                  onChange={(e) => {
                    setPurpose(e.target.value);
                    setIsCustomPurposeActive(true);
                  }}
                  style={{
                    ...styles.textInput,
                    width: "100%",
                    fontSize: "16px",
                    minHeight: "44px",
                  }}
                  autoFocus
                  required
                />
              )}
            </div>

            {/* 5. SCHEDULE & OPTIONAL OPEN RETURN TOGGLE */}
            <div style={{ marginBottom: 18 }}>
              <label style={styles.fieldLabel}>
                5. Permitted Date &amp; Time Schedule
              </label>

              <div style={{ marginBottom: 12 }}>
                <button
                  type="button"
                  onClick={() => {
                    const next = !isOpenReturn;
                    setIsOpenReturn(next);
                  }}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 14px",
                    borderRadius: "10px",
                    fontSize: "13px",
                    fontWeight: 700,
                    cursor: "pointer",
                    border: isOpenReturn
                      ? "1.5px solid #059669"
                      : "1px solid #cbd5e1",
                    background: isOpenReturn ? "#ecfdf5" : "#f8fafc",
                    color: isOpenReturn ? "#065f46" : "#334155",
                    minHeight: "44px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: "16px" }}>🏥</span>
                    <span>Open-Ended Return (No fixed return deadline)</span>
                  </div>
                  <span
                    style={{
                      padding: "3px 9px",
                      borderRadius: "999px",
                      fontSize: "11px",
                      fontWeight: 800,
                      background: isOpenReturn ? "#10b981" : "#e2e8f0",
                      color: isOpenReturn ? "#ffffff" : "#64748b",
                    }}
                  >
                    {isOpenReturn ? "✓ ACTIVE" : "OFF"}
                  </span>
                </button>
              </div>

              <CustomDateTimePicker
                title="🚶‍♂️ Permitted From (Date & Time)"
                minDate={getLocalDateString(new Date())}
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
                    minDate={fromDate || getLocalDateString(new Date())}
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
                  <div
                    style={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}
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
                  ? "#e11d48"
                  : "#4f46e5",
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
    </>
  );
}