"use client";
import React from "react";
import {
  WEB_APP_URL,
  LEAVE_CATEGORIES,
  formatDateTime12Hour,
  sendDirectEmailNotification,
  StudentAvatar,
  CustomDateTimePicker,
  styles,
} from "./outpassHelpers";

export default function OutpassModals({
  scannerOpen,
  setScannerOpen,
  zoomPhotoStudent,
  setZoomPhotoStudent,
  receiptPass,
  setReceiptPass,
  getStudentPhotoByAdNo,
  getOfficialTeacherName,
  handleShareWhatsApp,
  getStudentByAdNo,
  buildPassWhatsAppText,
  editingPass,
  setEditingPass,
  handleSaveEditedPass,
  editLeaveCategory,
  setEditLeaveCategory,
  editDestination,
  setEditDestination,
  editPurpose,
  setEditPurpose,
  editExtensionReason,
  setEditExtensionReason,
  editFromDate,
  setEditFromDate,
  editFromHour,
  setEditFromHour,
  editFromMinute,
  setEditFromMinute,
  editFromAmpm,
  setEditFromAmpm,
  editIsOpenReturn,
  setEditIsOpenReturn,
  editToDate,
  setEditToDate,
  editToHour,
  setEditToHour,
  editToMinute,
  setEditToMinute,
  editToAmpm,
  setEditToAmpm,
  savingEdit,
}) {
  return (
    <>
      {/* MODAL 1: CAMERA BARCODE SCANNER */}
      {scannerOpen && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCard}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 10,
              }}
            >
              <h3 style={{ margin: 0, color: "#0f172a", fontSize: 18 }}>
                📷 Scan Student ID Barcode
              </h3>
              <button
                type="button"
                onClick={() => setScannerOpen(false)}
                style={styles.iconCloseBtn}
              >
                ✕
              </button>
            </div>
            <div
              id="barcode-reader-region"
              style={{
                width: "100%",
                minHeight: "250px",
                background: "#0f172a",
                borderRadius: "12px",
                overflow: "hidden",
              }}
            />
            <button
              type="button"
              onClick={() => setScannerOpen(false)}
              style={styles.closeModalBtn}
            >
              Cancel &amp; Close Camera
            </button>
          </div>
        </div>
      )}

      {/* MODAL 2: STUDENT PHOTO ZOOM LIGHTBOX */}
      {zoomPhotoStudent && (
        <div
          style={styles.modalOverlay}
          onClick={() => setZoomPhotoStudent(null)}
        >
          <div
            style={{
              ...styles.modalCard,
              maxWidth: 360,
              textAlign: "center",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                marginBottom: 14,
              }}
            >
              <StudentAvatar
                name={zoomPhotoStudent.name}
                adNo={zoomPhotoStudent.adNo}
                photoUrl={zoomPhotoStudent.photoUrl}
                size={180}
              />
            </div>
            <h3 style={{ margin: "0 0 4px", color: "#0f172a" }}>
              {zoomPhotoStudent.name}
            </h3>
            <p style={{ margin: 0, color: "#475569", fontSize: 13 }}>
              Ad.No: <strong>#{zoomPhotoStudent.adNo}</strong> • Class{" "}
              <strong>{zoomPhotoStudent.studentClass}</strong> • DEGREE SECTION
            </p>
            <button
              type="button"
              onClick={() => setZoomPhotoStudent(null)}
              style={{ ...styles.closeModalBtn, background: "#0f172a" }}
            >
              Close Preview
            </button>
          </div>
        </div>
      )}

      {/* MODAL 3: DIGITAL OUT-PASS SLIP RECEIPT (WITH DEGREE SECTION & TEACHER PHONE) */}
      {receiptPass && (
        <div style={styles.modalOverlay}>
          <div
            style={{
              ...styles.modalCard,
              maxWidth: 460,
              padding: 0,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                background: "#064e3b",
                color: "#ffffff",
                padding: "16px 20px",
                textAlign: "center",
                borderBottom: "3px solid #f59e0b",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: "#a7f3d0",
                  fontWeight: 800,
                  letterSpacing: 1,
                }}
              >
                DARUL HUDA ISLAMIC UNIVERSITY • DEGREE SECTION
              </div>
              <h3 style={{ margin: "4px 0 0", fontSize: 18 }}>
                STUDENTS&apos; DIGITAL OUT-PASS
              </h3>
            </div>

            <div style={{ padding: "20px" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  background: "#f0fdfa",
                  padding: "12px",
                  borderRadius: "12px",
                  border: "1px solid #99f6e4",
                  marginBottom: 14,
                }}
              >
                <StudentAvatar
                  name={receiptPass.studentName}
                  adNo={receiptPass.adNo}
                  photoUrl={getStudentPhotoByAdNo(receiptPass.adNo)}
                  size={56}
                />
                <div>
                  <span
                    style={{
                      background: "#0f766e",
                      color: "#ffffff",
                      padding: "2px 8px",
                      borderRadius: 6,
                      fontSize: 10,
                      fontWeight: 900,
                    }}
                  >
                    🎓 DEGREE SECTION
                  </span>
                  <div
                    style={{
                      fontSize: 17,
                      fontWeight: 800,
                      color: "#0f172a",
                      marginTop: 2,
                    }}
                  >
                    {receiptPass.studentName}
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: "#0f766e",
                      fontWeight: 700,
                    }}
                  >
                    Ad.No: #{receiptPass.adNo} • Class{" "}
                    {receiptPass.studentClass}
                  </div>
                </div>
              </div>

              <div
                style={{ fontSize: 13, lineHeight: 1.8, color: "#1e293b" }}
              >
                <div>
                  🏷️ <strong>Category:</strong>{" "}
                  {receiptPass.leaveCategory || "General"}
                  {receiptPass.isGroupPass &&
                    ` (Group Pass: ${receiptPass.groupCount} Students)`}
                </div>
                <div>
                  📍 <strong>Destination:</strong> {receiptPass.destination}
                </div>
                <div>
                  📝 <strong>Purpose:</strong> {receiptPass.purpose}
                </div>
                <div>
                  🚶‍♂️ <strong>Permitted From:</strong>{" "}
                  {formatDateTime12Hour(receiptPass.permittedFrom)}
                </div>
                <div>
                  ⏳ <strong>Return Deadline:</strong>{" "}
                  <strong style={{ color: "#0f766e" }}>
                    {formatDateTime12Hour(
                      receiptPass.permittedTo,
                      receiptPass.isOpenReturn
                    )}
                  </strong>
                </div>
                <div>
                  👨‍🏫 <strong>Permitted Teacher:</strong>{" "}
                  {getOfficialTeacherName(receiptPass.teacherName)}
                  {receiptPass.teacherPhone && (
                    <span style={{ color: "#0369a1", fontWeight: 800 }}>
                      {" "}
                      (📞 {receiptPass.teacherPhone})
                    </span>
                  )}
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 10,
                  marginTop: 18,
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  onClick={() => handleShareWhatsApp(receiptPass)}
                  style={{
                    flex: 1,
                    padding: "12px",
                    background: "#16a34a",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "10px",
                    fontWeight: 800,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  💬 Open Parent WhatsApp Directly
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const st = getStudentByAdNo(receiptPass.adNo);
                    sendDirectEmailNotification(
                      WEB_APP_URL,
                      receiptPass.studentEmail || st?.email,
                      `DHIU Degree Section Out-Pass: ${receiptPass.studentName}`,
                      buildPassWhatsAppText(receiptPass)
                    );
                  }}
                  style={{
                    padding: "12px 14px",
                    background: "#0284c7",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "10px",
                    fontWeight: 800,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  ✉️ Email
                </button>
                <button
                  type="button"
                  onClick={() => setReceiptPass(null)}
                  style={{
                    padding: "12px 18px",
                    background: "#e2e8f0",
                    color: "#0f172a",
                    border: "none",
                    borderRadius: "10px",
                    fontWeight: 800,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: EXTEND / MODIFY LEAVE (WITH PERMITTED EXTENSION REASON) */}
      {editingPass && (
        <div style={styles.modalOverlay}>
          <div
            style={{
              ...styles.modalCard,
              maxWidth: "600px",
              maxHeight: "92vh",
              overflowY: "auto",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 14,
                borderBottom: "1px solid #e2e8f0",
                paddingBottom: 10,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    color: "#0f766e",
                    textTransform: "uppercase",
                  }}
                >
                  Class Teacher / Admin Leave Extension
                </div>
                <h3
                  style={{ margin: "2px 0 0", color: "#0f172a", fontSize: 18 }}
                >
                  ✏️ Permit Extension: {editingPass.studentName} (#
                  {editingPass.adNo})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingPass(null)}
                style={styles.iconCloseBtn}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveEditedPass}>
              <div style={styles.dateRowGrid}>
                <div style={{ marginBottom: 12 }}>
                  <label style={styles.subFieldLabel}>Leave Category</label>
                  <select
                    value={editLeaveCategory}
                    onChange={(e) => setEditLeaveCategory(e.target.value)}
                    style={styles.textInput}
                  >
                    {LEAVE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={styles.subFieldLabel}>Destination</label>
                  <input
                    type="text"
                    value={editDestination}
                    onChange={(e) => setEditDestination(e.target.value)}
                    style={styles.textInput}
                    required
                  />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={styles.subFieldLabel}>Purpose / Reason</label>
                  <input
                    type="text"
                    value={editPurpose}
                    onChange={(e) => setEditPurpose(e.target.value)}
                    style={styles.textInput}
                    required
                  />
                </div>
              </div>

              {setEditExtensionReason && (
                <div style={{ marginBottom: 12 }}>
                  <label style={styles.subFieldLabel}>
                    ✅ Class Teacher Extension Permission Note (Marks student as
                    Permitted Extension so they are excluded from Unpermitted
                    Latecomers list):
                  </label>
                  <input
                    type="text"
                    value={editExtensionReason || ""}
                    onChange={(e) => setEditExtensionReason(e.target.value)}
                    placeholder="e.g. Permitted 1 extra day due to fever / train delay..."
                    style={styles.textInput}
                  />
                </div>
              )}

              <CustomDateTimePicker
                title="🚶‍♂️ Departure Date & Time"
                dateValue={editFromDate}
                onDateChange={setEditFromDate}
                hourValue={editFromHour}
                onHourChange={setEditFromHour}
                minuteValue={editFromMinute}
                onMinuteChange={setEditFromMinute}
                ampmValue={editFromAmpm}
                onAmpmChange={setEditFromAmpm}
                previewLabel="🕒 Leaving"
              />

              <div style={{ marginTop: 12 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 8,
                  }}
                >
                  <span style={styles.subFieldLabel}>
                    Extend / Update Return Schedule:
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditIsOpenReturn(!editIsOpenReturn)}
                    style={
                      editIsOpenReturn
                        ? styles.medicalOpenBtnActive
                        : styles.medicalOpenBtnInactive
                    }
                  >
                    {editIsOpenReturn
                      ? "✓ 🏥 Open Return Active"
                      : "🏥 Set Open Return"}
                  </button>
                </div>

                {!editIsOpenReturn && (
                  <CustomDateTimePicker
                    title="⏳ Extended Return Date & Time"
                    dateValue={editToDate}
                    onDateChange={setEditToDate}
                    hourValue={editToHour}
                    onHourChange={setEditToHour}
                    minuteValue={editToMinute}
                    onMinuteChange={setEditToMinute}
                    ampmValue={editToAmpm}
                    onAmpmChange={setEditToAmpm}
                    previewLabel="⏳ Return By"
                  />
                )}
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 10,
                  marginTop: 18,
                  justifyContent: "flex-end",
                }}
              >
                <button
                  type="button"
                  onClick={() => setEditingPass(null)}
                  style={styles.cancelEditBtn}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  style={styles.saveEditBtn}
                >
                  {savingEdit ? "Saving..." : "💾 Save Permitted Extension"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}