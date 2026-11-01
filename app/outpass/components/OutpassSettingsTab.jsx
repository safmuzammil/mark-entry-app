"use client";
import React from "react";
import {
  LEAVE_CATEGORIES,
  StudentAvatar,
  styles,
} from "./outpassHelpers";

export default function OutpassSettingsTab({
  bulkUploadProgress,
  handleBulkPhotoUploadByAdNo,
  settingsSearch,
  setSettingsSearch,
  editingStudentSettings,
  setEditingStudentSettings,
  handleSaveStudentDisciplinarySettings,
  studentPhotoInput,
  setStudentPhotoInput,
  handleSingleStudentPhotoFile,
  studentPrincipalLock,
  setStudentPrincipalLock,
  studentBlockedCategories,
  setStudentBlockedCategories,
  studentBlockReason,
  setStudentBlockReason,
  savingStudentSettings,
  students,
}) {
  return (
    <div style={styles.card}>
      {/* BULK PHOTO UPLOADER CARD */}
      <div
        style={{
          background: "#f0fdfa",
          border: "2px dashed #0d9488",
          borderRadius: 16,
          padding: 20,
          marginBottom: 24,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <div>
          <h3 style={{ margin: "0 0 6px", color: "#0f172a" }}>
            📸 Bulk Upload Student Photos (Named by Student Ad.No)
          </h3>
          <p style={{ margin: 0, fontSize: 13, color: "#0f766e" }}>
            Select multiple photo files named after the student&apos;s Admission
            Number (e.g. <code>3529.jpg</code>, <code>U1107.png</code>). Each
            photo is automatically compressed to ~15 KB so the app stays
            lightning-fast!
          </p>
          {bulkUploadProgress && (
            <div
              style={{
                marginTop: 8,
                fontWeight: 800,
                color: "#0284c7",
                fontSize: 13,
              }}
            >
              ⏳ {bulkUploadProgress}
            </div>
          )}
        </div>

        <label
          style={{
            background: "#0f766e",
            color: "#ffffff",
            padding: "12px 20px",
            borderRadius: 12,
            fontWeight: 800,
            fontSize: 14,
            cursor: "pointer",
            boxShadow: "0 4px 12px rgba(15, 118, 110, 0.25)",
            whiteSpace: "nowrap",
          }}
        >
          📂 Select Photos (e.g. 3529.jpg, U1107.png)
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={handleBulkPhotoUploadByAdNo}
            style={{ display: "none" }}
          />
        </label>
      </div>

      <h3 style={styles.cardTitle}>
        ⚙️ Individual Student Photo, Principal Lock &amp; Disciplinary Leave
        Restrictions
      </h3>
      <p style={{ ...styles.cardSubtitle, marginBottom: 16 }}>
        Search any student below to upload/replace their photo, lock leave to
        Principal only, or block specific leave categories (e.g. Friday,
        Evening, or All Leaves).
      </p>

      <input
        type="text"
        placeholder="Search student by Ad.No or Name..."
        value={settingsSearch}
        onChange={(e) => setSettingsSearch(e.target.value)}
        style={{ ...styles.searchInput, marginBottom: 16 }}
      />

      {editingStudentSettings && (
        <form
          onSubmit={handleSaveStudentDisciplinarySettings}
          style={{
            background: "#f8fafc",
            border: "2px solid #0d9488",
            borderRadius: 14,
            padding: 18,
            marginBottom: 20,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              marginBottom: 14,
            }}
          >
            <StudentAvatar
              name={editingStudentSettings.name}
              adNo={editingStudentSettings.adNo}
              photoUrl={studentPhotoInput}
              size={64}
            />
            <div>
              <h4 style={{ margin: "0 0 4px" }}>
                {editingStudentSettings.name} (#{editingStudentSettings.adNo})
              </h4>
              <label
                style={{
                  display: "inline-block",
                  background: "#0284c7",
                  color: "#ffffff",
                  padding: "6px 12px",
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                📷 Upload Photo File from Device
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleSingleStudentPhotoFile}
                  style={{ display: "none" }}
                />
              </label>
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontWeight: 800,
                color: "#991b1b",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              <input
                type="checkbox"
                checked={studentPrincipalLock}
                onChange={(e) => setStudentPrincipalLock(e.target.checked)}
              />
              👑 Require Principal Approval Only for this Student&apos;s Leaves
            </label>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={styles.subFieldLabel}>
              Block Specific Leave Categories (Disciplinary Action):
            </label>
            <div style={styles.chipGroup}>
              {["ALL", ...LEAVE_CATEGORIES].map((cat) => {
                const blocked = studentBlockedCategories.includes(cat);
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => {
                      if (blocked) {
                        setStudentBlockedCategories((prev) =>
                          prev.filter((x) => x !== cat)
                        );
                      } else {
                        setStudentBlockedCategories((prev) => [...prev, cat]);
                      }
                    }}
                    style={{
                      ...styles.quickChip,
                      background: blocked ? "#dc2626" : "#ffffff",
                      color: blocked ? "#ffffff" : "#334155",
                      borderColor: blocked ? "#dc2626" : "#cbd5e1",
                    }}
                  >
                    {blocked ? `🚫 Blocked: ${cat}` : `Allow ${cat}`}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={styles.subFieldLabel}>
              Disciplinary Block Reason (Shown to Teachers):
            </label>
            <input
              type="text"
              placeholder="e.g. Late return disciplinary action"
              value={studentBlockReason}
              onChange={(e) => setStudentBlockReason(e.target.value)}
              style={styles.textInput}
            />
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="submit"
              disabled={savingStudentSettings}
              style={styles.saveEditBtn}
            >
              {savingStudentSettings ? "Saving..." : "💾 Save Settings"}
            </button>
            <button
              type="button"
              onClick={() => setEditingStudentSettings(null)}
              style={styles.cancelEditBtn}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div style={styles.tableContainer}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Photo &amp; Name</th>
              <th style={styles.th}>Ad.No &amp; Class</th>
              <th style={styles.th}>Blocked Leave Categories</th>
              <th style={styles.th}>Action</th>
            </tr>
          </thead>
          <tbody>
            {students
              .filter(
                (s) =>
                  !settingsSearch.trim() ||
                  s.name.toLowerCase().includes(settingsSearch.toLowerCase()) ||
                  s.adNo.toLowerCase().includes(settingsSearch.toLowerCase())
              )
              .slice(0, 60)
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
                        size={40}
                      />
                      <strong>{s.name}</strong>
                    </div>
                  </td>
                  <td style={styles.td}>
                    #{s.adNo} • {s.studentClass} ({s.department})
                  </td>
                  <td style={styles.td}>
                    {s.requiresPrincipalApproval && (
                      <span
                        style={{
                          ...styles.alreadyOutMiniTag,
                          marginRight: 6,
                        }}
                      >
                        👑 Principal Only
                      </span>
                    )}
                    {(s.blockedCategories || []).length > 0 ? (
                      <span style={styles.alreadyOutMiniTag}>
                        🚫 Blocked: {s.blockedCategories.join(", ")} (
                        {s.blockReason || "Disciplinary"})
                      </span>
                    ) : (
                      !s.requiresPrincipalApproval && (
                        <span style={styles.insideStatusBadge}>
                          ✓ All Leaves Allowed
                        </span>
                      )
                    )}
                  </td>
                  <td style={styles.td}>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingStudentSettings(s);
                        setStudentPhotoInput(s.photoUrl || "");
                        setStudentBlockedCategories(s.blockedCategories || []);
                        setStudentBlockReason(s.blockReason || "");
                        setStudentPrincipalLock(
                          Boolean(s.requiresPrincipalApproval)
                        );
                      }}
                      style={styles.editPassBtnSmall}
                    >
                      📷 Photo / Block Leave
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}