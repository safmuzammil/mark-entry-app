"use client";
import React, { useState } from "react";
import {
  formatDateTime12Hour,
  openDirectWhatsApp,
  StudentAvatar,
  styles,
} from "./outpassHelpers";

export default function OutpassSecurityKiosk({
  gateInputRef,
  gateBarcodeInput,
  setGateBarcodeInput,
  processSecurityGateScan,
  setScannerMode,
  setScannerOpen,
  gateScanResult,
  getStudentPhotoByAdNo,
  getOfficialTeacherName,
  passes,
  setZoomPhotoStudent,
  autoNotifyParentOnGateScan,
  setAutoNotifyParentOnGateScan,
}) {
  const [kioskListSearch, setKioskListSearch] = useState("");
  const [kioskFilterMode, setKioskFilterMode] = useState("ALL");

  const waitingExitCount = passes.filter((p) => p.status === "APPROVED").length;
  const currentlyOutCount = passes.filter((p) => p.status === "OUTSIDE").length;

  const activeGatePasses = passes.filter((p) => {
    if (p.status !== "APPROVED" && p.status !== "OUTSIDE") return false;
    if (kioskFilterMode !== "ALL" && p.status !== kioskFilterMode) return false;
    if (kioskListSearch.trim()) {
      const q = kioskListSearch.toLowerCase();
      return (
        (p.studentName || "").toLowerCase().includes(q) ||
        String(p.adNo || "").toLowerCase().includes(q) ||
        (p.destination || "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div style={styles.twoColGrid}>
      {/* LEFT COLUMN: BARCODE SCANNER & GREEN/RED SIGNAL DISPLAY */}
      <div style={styles.card}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            flexWrap: "wrap",
            gap: 10,
            marginBottom: 8,
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
              🎓 DARUL HUDA DEGREE SECTION • GATE KIOSK
            </span>
            <h2 style={{ margin: "6px 0 4px", fontSize: 20, color: "#0f172a" }}>
              🛡️ Security Gate ID Card Scanner
            </h2>
            <p style={{ margin: 0, fontSize: 13, color: "#475569" }}>
              Scan student barcode using USB/Wireless Scanner or Camera.
            </p>
          </div>

          <div style={{ display: "flex", gap: 6 }}>
            <span
              style={{
                background: "#e0f2fe",
                color: "#0369a1",
                border: "1px solid #bae6fd",
                padding: "5px 10px",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 800,
              }}
            >
              🚪 Ready to Exit: {waitingExitCount}
            </span>
            <span
              style={{
                background: "#fffbeb",
                color: "#b45309",
                border: "1px solid #fde68a",
                padding: "5px 10px",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 800,
              }}
            >
              🏃‍♂️ Outside: {currentlyOutCount}
            </span>
          </div>
        </div>

        {setAutoNotifyParentOnGateScan && (
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
              marginBottom: 12,
            }}
          >
            <input
              type="checkbox"
              checked={Boolean(autoNotifyParentOnGateScan)}
              onChange={(e) =>
                setAutoNotifyParentOnGateScan(e.target.checked)
              }
            />
            💬 Auto-Open Parent&apos;s WhatsApp when Student Scans Out/In for
            Home Leave
          </label>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            processSecurityGateScan(gateBarcodeInput);
            setGateBarcodeInput("");
          }}
          style={{ display: "flex", gap: 10, marginTop: 10, marginBottom: 18 }}
        >
          <input
            ref={gateInputRef}
            type="text"
            placeholder="Scan ID Barcode or type Ad.No and press Enter..."
            value={gateBarcodeInput}
            onChange={(e) => setGateBarcodeInput(e.target.value)}
            style={{
              ...styles.searchInput,
              fontSize: 16,
              fontWeight: 800,
              border: "2px solid #0f766e",
            }}
            autoFocus
          />
          <button
            type="submit"
            style={{
              ...styles.barcodeScanBtn,
              background: "#0f766e",
              padding: "0 22px",
            }}
          >
            Verify ID
          </button>
          <button
            type="button"
            onClick={() => {
              setScannerMode("gate");
              setScannerOpen(true);
            }}
            style={styles.barcodeScanBtn}
          >
            📷 Camera
          </button>
        </form>

        {gateScanResult ? (
          <div
            style={{
              padding: 22,
              borderRadius: 16,
              border: gateScanResult.allowed
                ? "3px solid #16a34a"
                : "3px solid #dc2626",
              background: gateScanResult.allowed ? "#f0fdf4" : "#fef2f2",
              textAlign: "center",
            }}
          >
            <div
              style={{
                display: "inline-block",
                padding: "8px 18px",
                borderRadius: 999,
                background: gateScanResult.allowed ? "#16a34a" : "#dc2626",
                color: "#ffffff",
                fontWeight: 900,
                fontSize: 15,
                marginBottom: 12,
              }}
            >
              {gateScanResult.message}
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
              }}
            >
              <StudentAvatar
                name={gateScanResult.student?.name}
                adNo={gateScanResult.student?.adNo}
                photoUrl={getStudentPhotoByAdNo(gateScanResult.student?.adNo)}
                size={115}
                onClick={() =>
                  setZoomPhotoStudent &&
                  setZoomPhotoStudent({
                    name: gateScanResult.student?.name,
                    adNo: gateScanResult.student?.adNo,
                    studentClass: gateScanResult.student?.studentClass,
                    photoUrl: getStudentPhotoByAdNo(
                      gateScanResult.student?.adNo
                    ),
                  })
                }
              />
              <div>
                <span
                  style={{
                    background: "#0f172a",
                    color: "#facc15",
                    padding: "3px 10px",
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 900,
                  }}
                >
                  🎓 DEGREE SECTION STUDENT
                </span>
                <h3
                  style={{
                    margin: "6px 0 0",
                    fontSize: 22,
                    fontWeight: 900,
                    color: "#0f172a",
                  }}
                >
                  {gateScanResult.student?.name}
                </h3>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 800,
                    color: "#0f766e",
                    marginTop: 4,
                  }}
                >
                  Ad.No: #{gateScanResult.student?.adNo} • Class:{" "}
                  {gateScanResult.student?.studentClass} (
                  {gateScanResult.student?.department})
                </div>
              </div>

              {gateScanResult.pass && (
                <div
                  style={{
                    width: "100%",
                    background: "#ffffff",
                    padding: 14,
                    borderRadius: 12,
                    border: "1px solid #cbd5e1",
                    textAlign: "left",
                    fontSize: 13,
                    lineHeight: 1.7,
                  }}
                >
                  <div>
                    🏫 <strong>Section:</strong>{" "}
                    <strong style={{ color: "#0f766e" }}>
                      DEGREE SECTION
                    </strong>
                  </div>
                  <div>
                    🏷️ <strong>Leave Category:</strong>{" "}
                    {gateScanResult.pass.leaveCategory || "General"}
                  </div>
                  <div>
                    📍 <strong>Destination:</strong>{" "}
                    {gateScanResult.pass.destination} (
                    {gateScanResult.pass.purpose})
                  </div>
                  <div>
                    ⏳ <strong>Return Deadline:</strong>{" "}
                    {formatDateTime12Hour(
                      gateScanResult.pass.permittedTo,
                      gateScanResult.pass.isOpenReturn
                    )}
                  </div>
                  <div
                    style={{
                      marginTop: 8,
                      paddingTop: 8,
                      borderTop: "1px dashed #cbd5e1",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: 8,
                    }}
                  >
                    <div>
                      👨‍🏫 <strong>Permitted By:</strong>{" "}
                      <strong>
                        {getOfficialTeacherName(
                          gateScanResult.pass.teacherName
                        )}
                      </strong>
                      {gateScanResult.pass.teacherPhone && (
                        <div style={{ color: "#0369a1", fontWeight: 800 }}>
                          📞 Teacher Phone: {gateScanResult.pass.teacherPhone}
                        </div>
                      )}
                    </div>

                    {/* GATEMAN SUSPICION CONTACT TEACHER BUTTONS */}
                    {gateScanResult.pass.teacherPhone && (
                      <div style={{ display: "flex", gap: 6 }}>
                        <a
                          href={`tel:${gateScanResult.pass.teacherPhone}`}
                          style={{
                            background: "#0284c7",
                            color: "#ffffff",
                            padding: "6px 12px",
                            borderRadius: 8,
                            fontSize: 12,
                            fontWeight: 800,
                            textDecoration: "none",
                          }}
                        >
                          📞 Call Teacher
                        </a>
                        <button
                          type="button"
                          onClick={() =>
                            openDirectWhatsApp(
                              gateScanResult.pass.teacherPhone,
                              `Assalamu Alaikum Usthad, Security Gate inquiry regarding Degree Section student ${gateScanResult.student?.name} (#${gateScanResult.student?.adNo}):`
                            )
                          }
                          style={{
                            background: "#16a34a",
                            color: "#ffffff",
                            border: "none",
                            padding: "6px 12px",
                            borderRadius: 8,
                            fontSize: 12,
                            fontWeight: 800,
                            cursor: "pointer",
                          }}
                        >
                          💬 WA Teacher
                        </button>
                      </div>
                    )}
                  </div>

                  {/* 1-TAP PARENT WHATSAPP ON GATE EXIT OR SAFE RETURN */}
                  {gateScanResult.parentWhatsAppMessage && (
                    <div style={{ marginTop: 10 }}>
                      <button
                        type="button"
                        onClick={() =>
                          openDirectWhatsApp(
                            gateScanResult.parentPhone,
                            gateScanResult.parentWhatsAppMessage
                          )
                        }
                        style={{
                          width: "100%",
                          padding: "10px",
                          background: "#15803d",
                          color: "#ffffff",
                          border: "none",
                          borderRadius: 8,
                          fontWeight: 800,
                          fontSize: 13,
                          cursor: "pointer",
                        }}
                      >
                        💬 Send Parent WhatsApp:{" "}
                        {gateScanResult.actionType === "ENTRY"
                          ? '"Safely Reached College"'
                          : '"Coming Home on Leave"'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div
            style={{
              padding: "36px 20px",
              textAlign: "center",
              background: "#f8fafc",
              borderRadius: 14,
              border: "2px dashed #cbd5e1",
              color: "#64748b",
            }}
          >
            <div style={{ fontSize: 38, marginBottom: 8 }}>🪪</div>
            <div style={{ fontWeight: 800, color: "#0f172a", fontSize: 15 }}>
              Ready to Scan Degree Section Student ID Card
            </div>
            <div style={{ fontSize: 13, marginTop: 4 }}>
              Scan barcode or type Admission Number above to verify exit/entry
              permission.
            </div>
          </div>
        )}
      </div>

      {/* RIGHT COLUMN: PERMITTED STUDENTS READY FOR GATE CROSSING */}
      <div style={styles.card}>
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
          <div>
            <h3 style={styles.cardTitle}>
              🚪 Permitted Degree Students Ready for Gate Crossing (
              {activeGatePasses.length})
            </h3>
            <p style={styles.cardSubtitle}>
              Includes Permitting Teacher&apos;s phone number for gate
              verification
            </p>
          </div>
        </div>

        <div style={styles.segmentedBar}>
          {[
            {
              id: "ALL",
              label: "All Active",
              count: waitingExitCount + currentlyOutCount,
            },
            {
              id: "APPROVED",
              label: "🚪 Ready to Exit",
              count: waitingExitCount,
            },
            {
              id: "OUTSIDE",
              label: "🏁 Outside (Returning)",
              count: currentlyOutCount,
            },
          ].map((tab) => {
            const active = kioskFilterMode === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setKioskFilterMode(tab.id)}
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

        <div style={{ marginBottom: 14 }}>
          <input
            type="text"
            placeholder="Quick search student by Ad.No, Name, or Destination..."
            value={kioskListSearch}
            onChange={(e) => setKioskListSearch(e.target.value)}
            style={styles.searchInputSmall}
          />
        </div>

        <div style={styles.passListScroll}>
          {activeGatePasses.length === 0 ? (
            <div style={styles.emptyStateBox}>
              <div style={{ fontSize: 30, marginBottom: 6 }}>✅</div>
              <div style={{ fontWeight: 700, color: "#334155" }}>
                No students waiting in this queue
              </div>
            </div>
          ) : (
            activeGatePasses.map((p) => (
              <div
                key={p.id}
                style={{
                  ...styles.passCardItem,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                  borderLeft:
                    p.status === "APPROVED"
                      ? "5px solid #0284c7"
                      : "5px solid #f59e0b",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <StudentAvatar
                    name={p.studentName}
                    adNo={p.adNo}
                    photoUrl={getStudentPhotoByAdNo(p.adNo)}
                    size={48}
                    onClick={() =>
                      setZoomPhotoStudent &&
                      setZoomPhotoStudent({
                        name: p.studentName,
                        adNo: p.adNo,
                        studentClass: p.studentClass,
                        photoUrl: getStudentPhotoByAdNo(p.adNo),
                      })
                    }
                  />
                  <div>
                    <div style={{ fontWeight: 800, color: "#0f172a" }}>
                      {p.studentName}{" "}
                      <span style={styles.adNoBadge}>#{p.adNo}</span>{" "}
                      <span style={styles.classPill}>
                        {p.studentClass} (Degree)
                      </span>
                    </div>
                    <div
                      style={{ fontSize: 12, color: "#475569", marginTop: 2 }}
                    >
                      📍 {p.destination} • 👨‍🏫 By{" "}
                      <strong>{getOfficialTeacherName(p.teacherName)}</strong>
                      {p.teacherPhone && (
                        <span style={{ color: "#0284c7", fontWeight: 800 }}>
                          {" "}
                          (📞 {p.teacherPhone})
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "#0f766e",
                        fontWeight: 700,
                        marginTop: 2,
                      }}
                    >
                      ⏳ Return By:{" "}
                      {formatDateTime12Hour(p.permittedTo, p.isOpenReturn)}
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {p.teacherPhone && (
                    <a
                      href={`tel:${p.teacherPhone}`}
                      title="Call Permitting Teacher"
                      style={{
                        background: "#e0f2fe",
                        color: "#0369a1",
                        padding: "7px 10px",
                        borderRadius: 8,
                        fontSize: 12,
                        fontWeight: 800,
                        textDecoration: "none",
                      }}
                    >
                      📞 Teacher
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => processSecurityGateScan(p.adNo)}
                    style={{
                      ...styles.markReturnedBtn,
                      background:
                        p.status === "APPROVED" ? "#0284c7" : "#059669",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {p.status === "APPROVED"
                      ? "🚪 Record Gate Exit"
                      : "🏁 Record Gate Return"}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}