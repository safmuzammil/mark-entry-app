"use client";
import React, { useState } from "react";
import {
  INDIAN_STATES,
  KERALA_DISTRICTS,
  LEAVE_CATEGORIES,
  formatDateTime12Hour,
  StudentAvatar,
  CustomDateTimePicker,
  getStatusBadgeStyle,
  styles,
} from "./outpassHelpers";

export default function OutpassAdminReports({
  students,
  insideStudents,
  currentlyOutsidePasses,
  overduePasses,
  unverifiedArrivalPasses,
  longLeave5DaysPasses,
  unapprovedLogs,
  passes,
  adminReportType,
  setAdminReportType,
  handleLoadFullHistoryForAdmin,
  loadingOlderHistory,
  handleExportCSV,
  getFilteredAdminPasses,
  adminSearch,
  setAdminSearch,
  reportStartDate,
  setReportStartDate,
  reportEndDate,
  setReportEndDate,
  classFilter,
  setClassFilter,
  allClasses,
  deptFilter,
  setDeptFilter,
  allDepartments,
  categoryFilter,
  setCategoryFilter,
  teacherFilter,
  setTeacherFilter,
  allTeachers,
  mentorFilter,
  setMentorFilter,
  teachersList,
  stateFilter,
  setStateFilter,
  districtFilter,
  setDistrictFilter,
  destinationFilter,
  setDestinationFilter,
  allDestinations,
  mealCheckDate,
  setMealCheckDate,
  mealCheckHour,
  setMealCheckHour,
  mealCheckMinute,
  setMealCheckMinute,
  mealCheckAmpm,
  setMealCheckAmpm,
  mealCheckTargetISO,
  mealTimeAbsentPasses,
  getFrequentAnalysis,
  getStudentPhotoByAdNo,
  getStudentByAdNo,
  setZoomPhotoStudent,
  getMonthlyOutCount,
  setPortfolioModalStudent,
  getOfficialTeacherName,
  now,
  handleShareWhatsApp,
  openEditPassModal,
  handleTeacherVerifyArrival,
}) {
  // 🌟 Properly placed inside the component! Hides the 10 extra filter dropdowns until clicked
  const [viewingLeaveHistoryStudent, setViewingLeaveHistoryStudent] = useState(null);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  // 🌟 DYNAMIC DISTRICT FILTER: Combines Kerala Districts with any custom typed districts from non-Kerala students!
  const dynamicDistricts = Array.from(
    new Set([
      ...KERALA_DISTRICTS,
      ...students
        .filter((s) => stateFilter === "ALL" || s.state === stateFilter)
        .map((s) => s.district)
        .filter(Boolean),
    ])
  );

  // Count how many advanced filters are currently active
  const activeFilterCount = [
    reportStartDate !== "",
    reportEndDate !== "",
    classFilter !== "ALL",
    deptFilter !== "ALL",
    categoryFilter !== "ALL",
    teacherFilter !== "ALL",
    mentorFilter !== "ALL",
    stateFilter !== "ALL",
    districtFilter !== "ALL",
    destinationFilter !== "ALL",
  ].filter(Boolean).length;

  return (
    <div>
      {/* MINIMALIST PASTEL KPI CARDS (Matches Marks Auditor Style) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          gap: 14,
          marginBottom: 18,
        }}
      >
        <div
          onClick={() => setAdminReportType("INSIDE")}
          style={{
            padding: 18,
            borderRadius: 14,
            background: "#ecfdf5",
            border: adminReportType === "INSIDE" ? "2px solid #059669" : "1px solid #a7f3d0",
            cursor: "pointer",
            textAlign: "center",
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 800, color: "#047857", textTransform: "uppercase" }}>
            ON-CAMPUS / PRESENT (TOTAL: {students.length})
          </span>
          <div style={{ fontSize: 28, fontWeight: 900, color: "#065f46", marginTop: 4 }}>
            {insideStudents.length}
          </div>
          <div style={{ fontSize: 11, color: "#047857", fontWeight: 600, marginTop: 2 }}>
            Students currently inside campus
          </div>
        </div>

        <div
          onClick={() => setAdminReportType("OUTSIDE")}
          style={{
            padding: 18,
            borderRadius: 14,
            background: "#fffbeb",
            border: adminReportType === "OUTSIDE" ? "2px solid #d97706" : "1px solid #fde68a",
            cursor: "pointer",
            textAlign: "center",
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 800, color: "#b45309", textTransform: "uppercase" }}>
            OFF-CAMPUS / OUTSIDE
          </span>
          <div style={{ fontSize: 28, fontWeight: 900, color: "#d97706", marginTop: 4 }}>
            {currentlyOutsidePasses.length}
          </div>
          <div style={{ fontSize: 11, color: "#92400e", fontWeight: 600, marginTop: 2 }}>
            Overdue: {overduePasses.length} • Unverified Return: {unverifiedArrivalPasses.length}
          </div>
        </div>

        <div
          onClick={() => setAdminReportType("LONG_LEAVE_5D")}
          style={{
            padding: 18,
            borderRadius: 14,
            background: "#eef2ff",
            border: adminReportType === "LONG_LEAVE_5D" ? "2px solid #4f46e5" : "1px solid #c7d2fe",
            cursor: "pointer",
            textAlign: "center",
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 800, color: "#4338ca", textTransform: "uppercase" }}>
            LEAVE &gt; 5 DAYS
          </span>
          <div style={{ fontSize: 28, fontWeight: 900, color: "#4f46e5", marginTop: 4 }}>
            {longLeave5DaysPasses.length}
          </div>
          <div style={{ fontSize: 11, color: "#4338ca", fontWeight: 600, marginTop: 2 }}>
            Students on single leave more than 5 days
          </div>
        </div>

        <div
          onClick={() => setAdminReportType("UNAPPROVED_GATE")}
          style={{
            padding: 18,
            borderRadius: 14,
            background: "#fff1f2",
            border: adminReportType === "UNAPPROVED_GATE" ? "2px solid #e11d48" : "1px solid #fecdd3",
            cursor: "pointer",
            textAlign: "center",
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 800, color: "#be123c", textTransform: "uppercase" }}>
            UNAPPROVED GATE SCANS
          </span>
          <div style={{ fontSize: 28, fontWeight: 900, color: "#e11d48", marginTop: 4 }}>
            {unapprovedLogs.length}
          </div>
          <div style={{ fontSize: 11, color: "#be123c", fontWeight: 600, marginTop: 2 }}>
            Red signal gate exit attempts without pass
          </div>
        </div>
      </div>

      {/* MINIMALIST REPORT SELECTOR & FILTER TOGGLE CARD */}
      <div
        style={{
          background: "#ffffff",
          borderRadius: 14,
          border: "1px solid #e2e8f0",
          marginBottom: 16,
          padding: "16px 18px",
          boxShadow: "0 1px 3px rgba(15, 23, 42, 0.03)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 10,
            marginBottom: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", flex: 1 }}>
            <input
              type="text"
              placeholder="🔍 Quick search student name, Ad.No, or destination..."
              value={adminSearch}
              onChange={(e) => setAdminSearch(e.target.value)}
              style={{
                ...styles.filterInput,
                maxWidth: 320,
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid #cbd5e1",
              }}
            />
            <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>
              Showing latest {passes.length} passes
            </span>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setShowAdvancedFilters((prev) => !prev)}
              style={{
                padding: "8px 14px",
                borderRadius: "8px",
                border: showAdvancedFilters || activeFilterCount > 0 ? "1px solid #4f46e5" : "1px solid #cbd5e1",
                background: showAdvancedFilters ? "#4f46e5" : activeFilterCount > 0 ? "#eef2ff" : "#ffffff",
                color: showAdvancedFilters ? "#ffffff" : activeFilterCount > 0 ? "#4f46e5" : "#334155",
                fontWeight: 700,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              🎛️ {showAdvancedFilters ? "Hide Filters" : `Filter Options${activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}`}
            </button>

            <button
              type="button"
              onClick={handleLoadFullHistoryForAdmin}
              disabled={loadingOlderHistory}
              style={{
                padding: "8px 14px",
                borderRadius: "8px",
                border: "1px solid #cbd5e1",
                background: "#ffffff",
                color: "#334155",
                fontWeight: 700,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {loadingOlderHistory ? "Loading Archive..." : "🔄 Load Older Archive"}
            </button>

            <button
              type="button"
              onClick={() => handleExportCSV(getFilteredAdminPasses())}
              style={{
                padding: "8px 14px",
                borderRadius: "8px",
                border: "none",
                background: "#0f172a",
                color: "#ffffff",
                fontWeight: 700,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              ⬇️ Export CSV
            </button>
          </div>
        </div>

        {/* UNIFIED MINIMALIST REPORT VIEW PILLS */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {[
            { id: "OUTSIDE", label: `Currently Off-Campus (${currentlyOutsidePasses.length})` },
            { id: "OVERDUE", label: `Overdue / Delayed (${overduePasses.length})` },
            { id: "UNVERIFIED", label: `Unverified Arrivals (${unverifiedArrivalPasses.length})` },
            { id: "UNAPPROVED_GATE", label: `Unapproved Gate Scans (${unapprovedLogs.length})` },
            { id: "LONG_LEAVE_5D", label: `Leave > 5 Days (${longLeave5DaysPasses.length})` },
            { id: "MEAL_ABSENTEES", label: `Meal Absentees` },
            { id: "FREQUENT_OUT", label: `Frequent Out-Pass` },
            { id: "FREQUENT_LATE", label: `Frequent Latecomers` },
            { id: "GROUP_PASSES", label: `Group Out-Pass` },
            { id: "INSIDE", label: `Present On-Campus (${insideStudents.length})` },
            { id: "HISTORY", label: `Master Log (${passes.length})` },
          ].map((rep) => {
            const active = adminReportType === rep.id;
            return (
              <button
                key={rep.id}
                type="button"
                onClick={() => setAdminReportType(rep.id)}
                style={{
                  padding: "7px 13px",
                  borderRadius: "8px",
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: "pointer",
                  border: active ? "1px solid #4f46e5" : "1px solid #e2e8f0",
                  background: active ? "#4f46e5" : "#f8fafc",
                  color: active ? "#ffffff" : "#475569",
                  transition: "all 0.15s ease",
                }}
              >
                {rep.label}
              </button>
            );
          })}
        </div>

        {/* 🌟 COLLAPSIBLE 10-CRITERIA ENTERPRISE FILTER GRID (Hidden until "Filter Options" is clicked!) */}
        {showAdvancedFilters && (
          <div
            className="erp-slide-panel"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))",
              gap: 10,
              marginTop: 14,
              padding: 14,
              background: "#f8fafc",
              borderRadius: 10,
              border: "1px solid #e2e8f0",
            }}
          >
            <div>
              <span style={styles.subFieldLabel}>From Date</span>
              <input
                type="date"
                value={reportStartDate}
                onChange={(e) => setReportStartDate(e.target.value)}
                style={styles.filterSelect}
              />
            </div>
            <div>
              <span style={styles.subFieldLabel}>To Date</span>
              <input
                type="date"
                value={reportEndDate}
                onChange={(e) => setReportEndDate(e.target.value)}
                style={styles.filterSelect}
              />
            </div>
            <div>
              <span style={styles.subFieldLabel}>Class</span>
              <select
                value={classFilter}
                onChange={(e) => setClassFilter(e.target.value)}
                style={styles.filterSelect}
              >
                {allClasses.map((c) => (
                  <option key={c} value={c}>
                    {c === "ALL" ? "All Classes" : `Class: ${c}`}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <span style={styles.subFieldLabel}>Department</span>
              <select
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
                style={styles.filterSelect}
              >
                {allDepartments.map((d) => (
                  <option key={d} value={d}>
                    {d === "ALL" ? "All Depts" : d}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <span style={styles.subFieldLabel}>Category</span>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                style={styles.filterSelect}
              >
                <option value="ALL">All Categories</option>
                {LEAVE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <span style={styles.subFieldLabel}>Permitting Teacher</span>
              <select
                value={teacherFilter}
                onChange={(e) => setTeacherFilter(e.target.value)}
                style={styles.filterSelect}
              >
                {allTeachers.map((t) => (
                  <option key={t} value={t}>
                    {t === "ALL" ? "All Teachers" : `By: ${t}`}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <span style={styles.subFieldLabel}>Assigned Mentor</span>
              <select
                value={mentorFilter}
                onChange={(e) => setMentorFilter(e.target.value)}
                style={styles.filterSelect}
              >
                <option value="ALL">All Mentors</option>
                {teachersList.map((t) => (
                  <option key={t.username} value={t.username}>
                    {t.fullName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <span style={styles.subFieldLabel}>State</span>
              <select
                value={stateFilter}
                onChange={(e) => setStateFilter(e.target.value)}
                style={styles.filterSelect}
              >
                <option value="ALL">All States</option>
                {INDIAN_STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <span style={styles.subFieldLabel}>District</span>
              <select
                value={districtFilter}
                onChange={(e) => setDistrictFilter(e.target.value)}
                style={styles.filterSelect}
              >
                <option value="ALL">All Districts</option>
                {dynamicDistricts.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <span style={styles.subFieldLabel}>Destination</span>
              <select
                value={destinationFilter}
                onChange={(e) => setDestinationFilter(e.target.value)}
                style={styles.filterSelect}
              >
                {allDestinations.map((dest) => (
                  <option key={dest} value={dest}>
                    {dest === "ALL" ? "All Places" : dest}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {adminReportType === "MEAL_ABSENTEES" && (
        <div style={{ ...styles.card, marginBottom: 18 }}>
          <h3 style={{ margin: "0 0 8px", color: "#0f172a", fontSize: 16, fontWeight: 800 }}>
            🍽️ Specific Time Absentees List (Friday Food Wastage Regulation)
          </h3>
          <div style={{ maxWidth: 580, marginBottom: 16 }}>
            <CustomDateTimePicker
              title="🕒 Check Campus Absentees At Specific Date & Time"
              dateValue={mealCheckDate}
              onDateChange={setMealCheckDate}
              hourValue={mealCheckHour}
              onHourChange={setMealCheckHour}
              minuteValue={mealCheckMinute}
              onMinuteChange={setMealCheckMinute}
              ampmValue={mealCheckAmpm}
              onAmpmChange={setMealCheckAmpm}
              previewLabel="🍽️ Meal Check Time"
            />
          </div>
          <div
            style={{
              padding: 14,
              background: "#ecfdf5",
              border: "1px solid #a7f3d0",
              borderRadius: 12,
              fontWeight: 800,
              color: "#065f46",
            }}
          >
            📊 Total Students Off-Campus at {formatDateTime12Hour(mealCheckTargetISO)}:{" "}
            <span style={{ fontSize: 18 }}>{mealTimeAbsentPasses.length} Students Absent</span>{" "}
            (Prepare food for {Math.max(0, students.length - mealTimeAbsentPasses.length)} present students)
          </div>
        </div>
      )}

      <div style={styles.tableContainer}>
        {adminReportType === "UNAPPROVED_GATE" ? (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Attempt Time</th>
                <th style={styles.th}>Student / Scanned ID</th>
                <th style={styles.th}>Class &amp; Dept</th>
                <th style={styles.th}>Security Alert Details</th>
              </tr>
            </thead>
            <tbody>
              {unapprovedLogs.map((log) => (
                <tr key={log.id} style={styles.tr}>
                  <td style={styles.td}>
                    <strong>{formatDateTime12Hour(log.timestamp)}</strong>
                  </td>
                  <td style={styles.td}>
                    <strong>{log.studentName}</strong> (#{log.adNo})
                  </td>
                  <td style={styles.td}>
                    {log.studentClass} • {log.department}
                  </td>
                  <td style={{ ...styles.td, color: "#e11d48", fontWeight: 700 }}>
                    🚨 {log.reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : adminReportType === "FREQUENT_OUT" || adminReportType === "FREQUENT_LATE" ? (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Rank</th>
                <th style={styles.th}>Student</th>
                <th style={styles.th}>Ad.No &amp; Class</th>
                <th style={styles.th}>Total Leaves</th>
                <th style={styles.th}>Late Returns</th>
                <th style={styles.th}>Last Destination</th>
              </tr>
            </thead>
            <tbody>
              {getFrequentAnalysis(adminReportType === "FREQUENT_LATE").map((item, idx) => (
                <tr key={item.adNo} style={styles.tr}>
                  <td style={styles.td}>
                    <strong>#{idx + 1}</strong>
                  </td>
                  <td style={styles.td}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <StudentAvatar
                        name={item.studentName}
                        adNo={item.adNo}
                        photoUrl={getStudentPhotoByAdNo(item.adNo)}
                        size={36}
                      />
                      <strong>{item.studentName}</strong>
                    </div>
                  </td>
                  <td style={styles.td}>
                    #{item.adNo} • Class {item.studentClass}
                  </td>
                  <td style={styles.td}>
                    <span style={styles.adNoBadge}>{item.count} leaves</span>
                  </td>
                  <td
                    style={{
                      ...styles.td,
                      color: item.lateCount > 0 ? "#e11d48" : "#059669",
                      fontWeight: 800,
                    }}
                  >
                    {item.lateCount} late
                  </td>
                  <td style={styles.td}>{item.lastDestination}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : adminReportType === "INSIDE" ? (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Student</th>
                <th style={styles.th}>Ad.No</th>
                <th style={styles.th}>Class, Dept &amp; District</th>
                <th style={styles.th}>Campus Status</th>
                <th style={styles.th}>Leaves This Month &amp; Actions</th>
              </tr>
            </thead>
            <tbody>
              {insideStudents
                .filter(
                  (s) =>
                    (classFilter === "ALL" || s.studentClass === classFilter) &&
                    (deptFilter === "ALL" || s.department === deptFilter) &&
                    (mentorFilter === "ALL" || s.mentorUsername === mentorFilter) &&
                    (stateFilter === "ALL" || s.state === stateFilter) &&
                    (districtFilter === "ALL" || s.district === districtFilter) &&
                    (s.name.toLowerCase().includes(adminSearch.toLowerCase()) ||
                      s.adNo.toLowerCase().includes(adminSearch.toLowerCase()))
                )
                .slice(0, 120)
                .map((s) => (
                  <tr key={s.id} style={styles.tr}>
                    <td style={styles.td}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <StudentAvatar
                          name={s.name}
                          adNo={s.adNo}
                          photoUrl={s.photoUrl}
                          size={38}
                          onClick={() => setZoomPhotoStudent(s)}
                        />
                        <strong>{s.name}</strong>
                      </div>
                    </td>
                    <td style={styles.td}>
                      <span style={styles.adNoBadge}>#{s.adNo}</span>
                    </td>
                    <td style={styles.td}>
                      Class {s.studentClass} • {s.department} • {s.district}
                    </td>
                    <td style={styles.td}>
                      <span style={styles.insideStatusBadge}>🟢 Present On-Campus</span>
                    </td>
                    <td style={styles.td}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <strong>{getMonthlyOutCount(s.adNo)}</strong>
                        <button
                          type="button"
                          onClick={() => setViewingLeaveHistoryStudent(s)}
                          style={styles.editPassBtnSmall}
                          title="View student out-pass & leave records"
                        >
                          👁️ View
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Student</th>
                <th style={styles.th}>Category &amp; Destination</th>
                <th style={styles.th}>Permitted Teacher</th>
                <th style={styles.th}>Permitted Schedule</th>
                <th style={styles.th}>Gate Crossing &amp; Verification</th>
                <th style={styles.th}>Status &amp; Action</th>
              </tr>
            </thead>
            <tbody>
              {(adminReportType === "MEAL_ABSENTEES"
                ? mealTimeAbsentPasses
                : getFilteredAdminPasses()
              )
                .slice(0, 120)
                .map((p) => {
                  const photoUrl = getStudentPhotoByAdNo(p.adNo);
                  const st = getStudentByAdNo(p.adNo);
                  return (
                    <tr key={p.id} style={styles.tr}>
                      <td style={styles.td}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <StudentAvatar
                            name={p.studentName}
                            adNo={p.adNo}
                            photoUrl={photoUrl}
                            size={40}
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
                            <div style={{ fontWeight: 800 }}>{p.studentName}</div>
                            <div style={{ fontSize: 12, color: "#475569" }}>
                              #{p.adNo} • {p.studentClass} • {p.district || st?.district || "—"}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td style={styles.td}>
                        <span
                          style={{
                            ...styles.classPill,
                            background: "#eef2ff",
                            color: "#4f46e5",
                          }}
                        >
                          {p.leaveCategory || "General"}
                        </span>
                        <div style={{ fontWeight: 700, marginTop: 4 }}>📍 {p.destination}</div>
                        <div style={{ fontSize: 12, color: "#64748b" }}>{p.purpose}</div>
                      </td>
                      <td style={styles.td}>
                        <strong>👨‍🏫 {getOfficialTeacherName(p.teacherName)}</strong>
                      </td>
                      <td style={styles.td}>
                        <div style={{ fontSize: 12 }}>
                          From: <strong>{formatDateTime12Hour(p.permittedFrom)}</strong>
                        </div>
                        <div style={{ fontSize: 12 }}>
                          To: <strong>{formatDateTime12Hour(p.permittedTo, p.isOpenReturn)}</strong>
                        </div>
                      </td>
                      <td style={styles.td}>
                        <div style={{ fontSize: 12 }}>
                          Gate Exit:{" "}
                          <strong>
                            {formatDateTime12Hour(p.gateDepartureTime || p.actualDepartureTime)}
                          </strong>
                        </div>
                        <div style={{ fontSize: 12 }}>
                          Gate Return:{" "}
                          <strong>
                            {formatDateTime12Hour(p.gateArrivalTime || p.actualReturnTime)}
                          </strong>
                        </div>
                        {p.teacherVerifiedTime && (
                          <div style={{ fontSize: 11, color: "#059669", fontWeight: 700 }}>
                            ✓ Verified: {formatDateTime12Hour(p.teacherVerifiedTime)}
                          </div>
                        )}
                      </td>
                      <td style={styles.td}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                          <span style={getStatusBadgeStyle(p, now)}>{p.status}</span>
                          <button
                            type="button"
                            title="WhatsApp Parent"
                            onClick={() => handleShareWhatsApp(p)}
                            style={{
                              ...styles.editPassBtnSmall,
                              background: "#dcfce7",
                              color: "#166534",
                            }}
                          >
                            💬 WA
                          </button>
                          {p.status !== "RETURNED" && p.status !== "CANCELLED" && (
                            <>
                              <button
                                type="button"
                                onClick={() => openEditPassModal(p)}
                                style={styles.editPassBtnSmall}
                              >
                                ✏️
                              </button>
                              <button
                                type="button"
                                onClick={() => handleTeacherVerifyArrival(p)}
                                style={styles.markReturnedBtnSmall}
                              >
                                ✓ Verify
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        )}
      </div>

      {/* 🌟 STUDENT OUT-PASS & LEAVE HISTORY MODAL */}
      {viewingLeaveHistoryStudent && (() => {
        const s = viewingLeaveHistoryStudent;
        const studentPasses = (passes || [])
          .filter((p) => String(p.adNo || "").toLowerCase() === String(s.adNo || "").toLowerCase())
          .sort((a, b) => new Date(b.permittedFrom || b.createdAt || 0) - new Date(a.permittedFrom || a.createdAt || 0));

        const activePass = studentPasses.find(
          (p) => p.status === "OUTSIDE" || p.status === "APPROVED" || p.status === "ARRIVED_AT_GATE"
        );
        const monthlyCount = getMonthlyOutCount(s.adNo);

        return (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(15, 23, 42, 0.65)",
              backdropFilter: "blur(4px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 9999,
              padding: 16,
            }}
          >
            <div
              style={{
                background: "#ffffff",
                borderRadius: 16,
                maxWidth: 680,
                width: "100%",
                maxHeight: "90vh",
                display: "flex",
                flexDirection: "column",
                boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)",
                overflow: "hidden",
                border: "1px solid #cbd5e1",
              }}
            >
              {/* Header */}
              <div
                style={{
                  padding: "16px 20px",
                  borderBottom: "1px solid #e2e8f0",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: "#f8fafc",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <StudentAvatar
                    name={s.name}
                    adNo={s.adNo}
                    photoUrl={s.photoUrl}
                    size={46}
                    onClick={() => setZoomPhotoStudent(s)}
                  />
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: "#0f172a" }}>
                      {s.name} <span style={{ color: "#4f46e5" }}>#{s.adNo}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "#64748b", fontWeight: 600, marginTop: 2 }}>
                      Class {s.studentClass} • {s.department} • {s.district || "Kerala"}
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => {
                      setPortfolioModalStudent(s);
                      setViewingLeaveHistoryStudent(null);
                    }}
                    style={{
                      padding: "6px 12px",
                      background: "#eef2ff",
                      color: "#4f46e5",
                      border: "1px solid #c7d2fe",
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                    title="Open Mentorship Sitting & Profile Modal"
                  >
                    🧭 Mentoring
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewingLeaveHistoryStudent(null)}
                    style={{
                      background: "transparent",
                      border: "none",
                      fontSize: 20,
                      fontWeight: 800,
                      color: "#64748b",
                      cursor: "pointer",
                      padding: 4,
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* KPI Ribbon */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: 10,
                  padding: "12px 20px",
                  background: "#ffffff",
                  borderBottom: "1px solid #f1f5f9",
                }}
              >
                <div style={{ background: "#f8fafc", padding: "8px 12px", borderRadius: 8, textAlign: "center" }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: "#64748b", textTransform: "uppercase" }}>
                    Leaves This Month
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: "#0f172a", marginTop: 2 }}>
                    {monthlyCount}
                  </div>
                </div>

                <div style={{ background: "#f8fafc", padding: "8px 12px", borderRadius: 8, textAlign: "center" }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: "#64748b", textTransform: "uppercase" }}>
                    Total Passes
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: "#0f172a", marginTop: 2 }}>
                    {studentPasses.length}
                  </div>
                </div>

                <div
                  style={{
                    background: activePass ? "#fff7ed" : "#ecfdf5",
                    padding: "8px 12px",
                    borderRadius: 8,
                    textAlign: "center",
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      color: activePass ? "#c2410c" : "#047857",
                      textTransform: "uppercase",
                    }}
                  >
                    Current Status
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 800,
                      color: activePass ? "#ea580c" : "#059669",
                      marginTop: 4,
                    }}
                  >
                    {activePass ? `🟠 ${activePass.status}` : "🟢 On-Campus"}
                  </div>
                </div>
              </div>

              {/* Passes List */}
              <div style={{ padding: "16px 20px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  📋 Recorded Out-Passes &amp; Leaves ({studentPasses.length})
                </div>

                {studentPasses.length === 0 ? (
                  <div
                    style={{
                      padding: 30,
                      background: "#f8fafc",
                      borderRadius: 12,
                      textAlign: "center",
                      color: "#64748b",
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    Zero out-passes recorded for {s.name} this semester.
                  </div>
                ) : (
                  studentPasses.map((p) => {
                    const badgeStyle = getStatusBadgeStyle(p.status);
                    return (
                      <div
                        key={p.id}
                        style={{
                          background: "#ffffff",
                          border: "1px solid #e2e8f0",
                          borderRadius: 12,
                          padding: "12px 16px",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          gap: 12,
                          boxShadow: "0 1px 3px rgba(15,23,42,0.03)",
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                            <span
                              style={{
                                padding: "3px 8px",
                                borderRadius: 6,
                                fontSize: 11,
                                fontWeight: 800,
                                background: "#f1f5f9",
                                color: "#334155",
                              }}
                            >
                              🏷️ {p.leaveCategory || "General"}
                            </span>
                            <span
                              style={{
                                ...badgeStyle,
                                padding: "3px 8px",
                                borderRadius: 6,
                                fontSize: 11,
                                fontWeight: 800,
                              }}
                            >
                              {p.status}
                            </span>
                            <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>
                              {p.permittedFrom ? formatDateTime12Hour(p.permittedFrom) : p.createdAt?.slice(0, 10)}
                            </span>
                          </div>

                          <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>
                            📍 {p.destination || "Not specified"}{" "}
                            {p.purpose && (
                              <span style={{ fontWeight: 500, color: "#475569" }}>
                                ({p.purpose})
                              </span>
                            )}
                          </div>

                          <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                            👨‍🏫 Permitted by: <strong>{p.teacherName || p.teacherUsername || "Faculty"}</strong>
                            {p.permittedTo && (
                              <span> • Return By: <strong>{formatDateTime12Hour(p.permittedTo, p.isOpenReturn)}</strong></span>
                            )}
                          </div>

                          {p.actualReturnTime && (
                            <div style={{ fontSize: 11, color: "#047857", fontWeight: 700, marginTop: 3 }}>
                              ✓ Returned to campus on {formatDateTime12Hour(p.actualReturnTime)}
                            </div>
                          )}
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                          <button
                            type="button"
                            onClick={() => handleShareWhatsApp(p)}
                            style={{
                              padding: "4px 8px",
                              fontSize: 11,
                              borderRadius: 6,
                              fontWeight: 700,
                              cursor: "pointer",
                              border: "1px solid #bbf7d0",
                              background: "#dcfce7",
                              color: "#166534",
                            }}
                          >
                            💬 WA
                          </button>
                          {p.status !== "RETURNED" && p.status !== "CANCELLED" && (
                            <button
                              type="button"
                              onClick={() => {
                                setViewingLeaveHistoryStudent(null);
                                openEditPassModal(p);
                              }}
                              style={styles.editPassBtnSmall}
                            >
                              ✏️ Edit
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Footer */}
              <div
                style={{
                  padding: "12px 20px",
                  borderTop: "1px solid #e2e8f0",
                  display: "flex",
                  justifyContent: "flex-end",
                  background: "#f8fafc",
                }}
              >
                <button
                  type="button"
                  onClick={() => setViewingLeaveHistoryStudent(null)}
                  style={styles.btnSecondary}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}