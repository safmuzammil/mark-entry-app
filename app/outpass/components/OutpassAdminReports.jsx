"use client";
import React from "react";
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

  return (
    <div>
      {/* KPI Cards with Colored Icons */}
      <div style={styles.kpiGrid}>
        <div
          onClick={() => setAdminReportType("INSIDE")}
          style={{
            ...styles.kpiCard,
            borderTop: "4px solid #10b981",
          }}
        >
          <div style={styles.kpiTopRow}>
            <span style={styles.kpiLabel}>
              ON-CAMPUS / PRESENT (TOTAL: {students.length})
            </span>
            <span style={styles.kpiIconBox("#d1fae5", "#059669")}>🟢</span>
          </div>
          <div style={{ ...styles.kpiNumber, color: "#059669" }}>
            {insideStudents.length}
          </div>
          <div style={styles.kpiFooter}>Students currently inside campus</div>
        </div>

        <div
          onClick={() => setAdminReportType("OUTSIDE")}
          style={{
            ...styles.kpiCard,
            borderTop: "4px solid #f59e0b",
          }}
        >
          <div style={styles.kpiTopRow}>
            <span style={styles.kpiLabel}>OFF-CAMPUS / OUTSIDE</span>
            <span style={styles.kpiIconBox("#fef3c7", "#d97706")}>🟠</span>
          </div>
          <div style={{ ...styles.kpiNumber, color: "#d97706" }}>
            {currentlyOutsidePasses.length}
          </div>
          <div style={styles.kpiFooter}>
            Overdue: {overduePasses.length} • Unverified Return:{" "}
            {unverifiedArrivalPasses.length}
          </div>
        </div>

        <div
          onClick={() => setAdminReportType("LONG_LEAVE_5D")}
          style={{
            ...styles.kpiCard,
            borderTop: "4px solid #7c3aed",
          }}
        >
          <div style={styles.kpiTopRow}>
            <span style={styles.kpiLabel}>LEAVE &gt; 5 DAYS</span>
            <span style={styles.kpiIconBox("#ede9fe", "#7c3aed")}>📅</span>
          </div>
          <div style={{ ...styles.kpiNumber, color: "#7c3aed" }}>
            {longLeave5DaysPasses.length}
          </div>
          <div style={styles.kpiFooter}>
            Students on single leave more than 5 days
          </div>
        </div>

        <div
          onClick={() => setAdminReportType("UNAPPROVED_GATE")}
          style={{
            ...styles.kpiCard,
            borderTop: "4px solid #dc2626",
          }}
        >
          <div style={styles.kpiTopRow}>
            <span style={styles.kpiLabel}>UNAPPROVED GATE SCANS</span>
            <span style={styles.kpiIconBox("#fee2e2", "#dc2626")}>🚨</span>
          </div>
          <div style={{ ...styles.kpiNumber, color: "#dc2626" }}>
            {unapprovedLogs.length}
          </div>
          <div style={styles.kpiFooter}>
            Red signal gate exit attempts without pass
          </div>
        </div>
      </div>

      <div
        style={{
          ...styles.card,
          marginBottom: 16,
          padding: "16px 18px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 8,
            marginBottom: 10,
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 800,
              color: "#475569",
              textTransform: "uppercase",
            }}
          >
            📑 Select Report View (Showing latest {passes.length} passes for
            zero lag):
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={handleLoadFullHistoryForAdmin}
              disabled={loadingOlderHistory}
              style={styles.miniDayStepBtn}
            >
              {loadingOlderHistory
                ? "Loading Archive..."
                : "🔄 Load Older Archive (Up to 2,000 Passes)"}
            </button>
            <button
              type="button"
              onClick={() => handleExportCSV(getFilteredAdminPasses())}
              style={styles.exportCsvBtn}
            >
              ⬇️ Export CSV
            </button>
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {[
            {
              id: "OUTSIDE",
              label: `🟠 Currently Off-Campus (${currentlyOutsidePasses.length})`,
            },
            {
              id: "OVERDUE",
              label: `🚨 Overdue / Delayed (${overduePasses.length})`,
            },
            {
              id: "UNVERIFIED",
              label: `🟣 Unverified Arrivals (${unverifiedArrivalPasses.length})`,
            },
            {
              id: "UNAPPROVED_GATE",
              label: `🚫 Unapproved Gate Scans (${unapprovedLogs.length})`,
            },
            {
              id: "LONG_LEAVE_5D",
              label: `📅 Leave > 5 Days (${longLeave5DaysPasses.length})`,
            },
            {
              id: "MEAL_ABSENTEES",
              label: `🍽️ Specific Time / Friday Meal Absentees`,
            },
            {
              id: "FREQUENT_OUT",
              label: `📈 Frequent Out-Pass Analysis`,
            },
            {
              id: "FREQUENT_LATE",
              label: `⏳ Frequent Latecomer Analysis`,
            },
            { id: "GROUP_PASSES", label: `👥 Group Out-Pass Report` },
            {
              id: "INSIDE",
              label: `🟢 Present On-Campus (${insideStudents.length})`,
            },
            {
              id: "HISTORY",
              label: `📜 Complete Master Log (${passes.length})`,
            },
          ].map((rep) => (
            <button
              key={rep.id}
              type="button"
              onClick={() => setAdminReportType(rep.id)}
              style={
                adminReportType === rep.id
                  ? styles.quickChipActive
                  : styles.quickChip
              }
            >
              {rep.label}
            </button>
          ))}
        </div>

        {/* 11-CRITERIA ENTERPRISE FILTER GRID */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))",
            gap: 10,
            marginTop: 14,
            paddingTop: 12,
            borderTop: "1px solid #e2e8f0",
          }}
        >
          <div>
            <span style={styles.subFieldLabel}>Search Student/Place</span>
            <input
              type="text"
              placeholder="Student, Ad.No, place..."
              value={adminSearch}
              onChange={(e) => setAdminSearch(e.target.value)}
              style={styles.filterInput}
            />
          </div>
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
      </div>

      {adminReportType === "MEAL_ABSENTEES" && (
        <div style={{ ...styles.card, marginBottom: 18 }}>
          <h3 style={{ margin: "0 0 8px", color: "#0f172a" }}>
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
            📊 Total Students Off-Campus at{" "}
            {formatDateTime12Hour(mealCheckTargetISO)}:{" "}
            <span style={{ fontSize: 20 }}>
              {mealTimeAbsentPasses.length} Students Absent
            </span>{" "}
            (Prepare food for{" "}
            {Math.max(0, students.length - mealTimeAbsentPasses.length)} present
            students)
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
                  <td
                    style={{
                      ...styles.td,
                      color: "#dc2626",
                      fontWeight: 700,
                    }}
                  >
                    🚨 {log.reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : adminReportType === "FREQUENT_OUT" ||
          adminReportType === "FREQUENT_LATE" ? (
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
              {getFrequentAnalysis(adminReportType === "FREQUENT_LATE").map(
                (item, idx) => (
                  <tr key={item.adNo} style={styles.tr}>
                    <td style={styles.td}>
                      <strong>#{idx + 1}</strong>
                    </td>
                    <td style={styles.td}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
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
                        color: item.lateCount > 0 ? "#dc2626" : "#059669",
                        fontWeight: 800,
                      }}
                    >
                      {item.lateCount} late
                    </td>
                    <td style={styles.td}>{item.lastDestination}</td>
                  </tr>
                )
              )}
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
                    (mentorFilter === "ALL" ||
                      s.mentorUsername === mentorFilter) &&
                    (stateFilter === "ALL" || s.state === stateFilter) &&
                    (districtFilter === "ALL" ||
                      s.district === districtFilter) &&
                    (s.name.toLowerCase().includes(adminSearch.toLowerCase()) ||
                      s.adNo.toLowerCase().includes(adminSearch.toLowerCase()))
                )
                .slice(0, 120)
                .map((s) => (
                  <tr key={s.id} style={styles.tr}>
                    <td style={styles.td}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
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
                      <span style={styles.insideStatusBadge}>
                        🟢 Present On-Campus
                      </span>
                    </td>
                    <td style={styles.td}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <strong>{getMonthlyOutCount(s.adNo)}</strong>
                        <button
                          type="button"
                          onClick={() => setPortfolioModalStudent(s)}
                          style={styles.editPassBtnSmall}
                        >
                          🏆 Portfolio
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
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                          }}
                        >
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
                            <div style={{ fontWeight: 800 }}>
                              {p.studentName}
                            </div>
                            <div style={{ fontSize: 12, color: "#475569" }}>
                              #{p.adNo} • {p.studentClass} •{" "}
                              {p.district || st?.district || "—"}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td style={styles.td}>
                        <span
                          style={{
                            ...styles.classPill,
                            background: "#fef3c7",
                            color: "#92400e",
                          }}
                        >
                          {p.leaveCategory || "General"}
                        </span>
                        <div style={{ fontWeight: 700, marginTop: 4 }}>
                          📍 {p.destination}
                        </div>
                        <div style={{ fontSize: 12, color: "#64748b" }}>
                          {p.purpose}
                        </div>
                      </td>
                      <td style={styles.td}>
                        <strong>
                          👨‍🏫 {getOfficialTeacherName(p.teacherName)}
                        </strong>
                      </td>
                      <td style={styles.td}>
                        <div style={{ fontSize: 12 }}>
                          From:{" "}
                          <strong>
                            {formatDateTime12Hour(p.permittedFrom)}
                          </strong>
                        </div>
                        <div style={{ fontSize: 12 }}>
                          To:{" "}
                          <strong>
                            {formatDateTime12Hour(
                              p.permittedTo,
                              p.isOpenReturn
                            )}
                          </strong>
                        </div>
                      </td>
                      <td style={styles.td}>
                        <div style={{ fontSize: 12 }}>
                          Gate Exit:{" "}
                          <strong>
                            {formatDateTime12Hour(
                              p.gateDepartureTime || p.actualDepartureTime
                            )}
                          </strong>
                        </div>
                        <div style={{ fontSize: 12 }}>
                          Gate Return:{" "}
                          <strong>
                            {formatDateTime12Hour(
                              p.gateArrivalTime || p.actualReturnTime
                            )}
                          </strong>
                        </div>
                        {p.teacherVerifiedTime && (
                          <div
                            style={{
                              fontSize: 11,
                              color: "#059669",
                              fontWeight: 700,
                            }}
                          >
                            ✓ Verified:{" "}
                            {formatDateTime12Hour(p.teacherVerifiedTime)}
                          </div>
                        )}
                      </td>
                      <td style={styles.td}>
                        <div
                          style={{
                            display: "flex",
                            gap: 6,
                            flexWrap: "wrap",
                            alignItems: "center",
                          }}
                        >
                          <span style={getStatusBadgeStyle(p, now)}>
                            {p.status}
                          </span>
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
                          {p.status !== "RETURNED" &&
                            p.status !== "CANCELLED" && (
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
    </div>
  );
}