"use client";
import React, { useRef } from "react";

// 1. RE-EXPORT SHARED HELPERS & CONSTANTS (Zero Duplicates!)
export {
  DHIU_LOGO_URL,
  INDIAN_STATES,
  KERALA_DISTRICTS,
  compressImageFileToDataUrl,
  formatWhatsAppPhone,
  openDirectWhatsApp,
  sendDirectEmailNotification,
  ProfileAvatar as StudentAvatar // Re-uses your master avatar component
} from "../../components/ErpExtensions";

export { WEB_APP_URL } from "../../components/erpConstants";


// 2. OUT-PASS SPECIFIC CONSTANTS
export const SECURITY_KIOSK_PIN = "1234";
export const DEFAULT_GATE_WORKFLOW = true;
export const REALTIME_PASS_LIMIT = 250;

export const ADMIN_EMAILS = [
  "admin@school.com",
  "admin@dhiu.in",
  "admin@gmail.com",
  "dhdegreeclearance@gmail.com",
];

export const LEAVE_CATEGORIES = [
  "Friday",
  "Evening",
  "General",
  "Medical",
  "Monthly_Home",
  "1_Day",
  "2_Day",
  "Weekend_Thu_Sat",
  "Outreach",
  "Official",
  "Custom",
];

export const PRESET_PURPOSES = [
  "Monthly Home Leave",
  "Medical / Hospital Case",
  "Family Function / Visit",
  "Personal Purchase",
  "Bookplus / Stationery",
  "Department / Official Work",
  "Dental / Eye Checkup",
  "Home Leave"
];

export const PRESET_DESTINATIONS = [
  "Home",
  "Chemmad",
  "Bookplus",
  "Mampuram",
  "Tirurangadi Hospital",
  "Bank / ATM",
  "Barber Shop",
  "Medical Store",
];

export const HOURS_12 = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
export const MINUTES_60 = Array.from({ length: 60 }, (_, i) =>
  String(i).padStart(2, "0")
);


// 3. OUT-PASS TIME & MATH HELPERS
export function getLocalDateString(dateObj = new Date()) {
  const d = new Date(dateObj);
  if (isNaN(d.getTime())) return "2026-01-01";
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dateTo12HourParts(dateObj = new Date()) {
  const d = new Date(dateObj);
  if (isNaN(d.getTime())) {
    return {
      date: getLocalDateString(new Date()),
      hour: "10",
      minute: "00",
      ampm: "AM",
    };
  }
  let hrs = d.getHours();
  const ampm = hrs >= 12 ? "PM" : "AM";
  hrs = hrs % 12;
  if (hrs === 0) hrs = 12;
  const mins = String(d.getMinutes()).padStart(2, "0");
  return {
    date: getLocalDateString(d),
    hour: String(hrs),
    minute: mins,
    ampm,
  };
}

export function partsToISOString(dateStr, hour12, minuteStr, ampm) {
  if (!dateStr) return null;
  const [y, m, d] = String(dateStr).split("-").map(Number);
  if (!y || !m || !d) return null;
  let hr = parseInt(hour12, 10);
  if (isNaN(hr) || hr < 1 || hr > 12) hr = 12;
  const min = parseInt(minuteStr, 10) || 0;

  if (ampm === "PM" && hr < 12) hr += 12;
  if (ampm === "AM" && hr === 12) hr = 0;

  const constructed = new Date(y, m - 1, d, hr, min, 0, 0);
  return isNaN(constructed.getTime()) ? null : constructed.toISOString();
}

export function formatTime12Hour(isoString) {
  if (!isoString) return "—";
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return "—";
  return d
    .toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    })
    .toUpperCase();
}

export function formatDateTime12Hour(isoString, openReturnFlag = false) {
  if (openReturnFlag || !isoString) {
    return openReturnFlag ? "🏥 Open Return (No Fixed Time)" : "—";
  }
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return "—";
  const datePart = d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const timePart = d
    .toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    })
    .toUpperCase();
  return `${datePart}, ${timePart}`;
}

export function playBeep(isError = false) {
  try {
    if (typeof window === "undefined") return;
    if (navigator.vibrate) navigator.vibrate(isError ? [200, 100, 200] : 150);
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = isError ? "sawtooth" : "sine";
    osc.frequency.setValueAtTime(isError ? 220 : 1046.5, ctx.currentTime);
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (isError ? 0.35 : 0.14));
  } catch (e) {}
}

// 4. OUT-PASS UI COMPONENTS & STYLES
export function CustomDateTimePicker({
  title,
  dateValue,
  onDateChange,
  hourValue,
  onHourChange,
  minuteValue,
  onMinuteChange,
  ampmValue,
  onAmpmChange,
  onSetNow,
  previewLabel,
}) {
  const dateInputRef = useRef(null);
  const previewISO = partsToISOString(
    dateValue,
    hourValue,
    minuteValue,
    ampmValue
  );

  const shiftDateByDays = (offsetDays, resetToToday = false) => {
    const base = resetToToday
      ? new Date()
      : dateValue
      ? new Date(`${dateValue}T12:00:00`)
      : new Date();
    if (!resetToToday) {
      base.setDate(base.getDate() + offsetDays);
    }
    onDateChange(getLocalDateString(base));
  };

  return (
    <div style={styles.timePickerCard}>
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
        <div style={styles.timeSectionTitle}>{title}</div>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => shiftDateByDays(-1)}
            style={styles.miniDayStepBtn}
          >
            ◀ -1 Day
          </button>
          <button
            type="button"
            onClick={() => shiftDateByDays(0, true)}
            style={styles.miniDayStepBtn}
          >
            📅 Today
          </button>
          <button
            type="button"
            onClick={() => shiftDateByDays(1)}
            style={styles.miniDayStepBtn}
          >
            +1 Day ▶
          </button>
          {onSetNow && (
            <button
              type="button"
              onClick={onSetNow}
              style={{
                ...styles.miniDayStepBtn,
                background: "#ccfbf1",
                color: "#0f766e",
                borderColor: "#5eead4",
              }}
            >
              🕒 Set Now
            </button>
          )}
        </div>
      </div>

      <div style={styles.customDateTimeGrid}>
        <div>
          <span style={styles.subFieldLabel}>📅 Select Date:</span>
          <input
            ref={dateInputRef}
            type="date"
            value={dateValue || ""}
            onClick={() => {
              try {
                dateInputRef.current?.showPicker?.();
              } catch (e) {}
            }}
            onChange={(e) => onDateChange(e.target.value)}
            style={styles.dateInputBox}
          />
        </div>

        <div>
          <span style={styles.subFieldLabel}>🕒 Select Time (12-Hour):</span>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <select
              value={String(parseInt(hourValue || "12", 10))}
              onChange={(e) => onHourChange(e.target.value)}
              style={styles.timeSelectBox}
            >
              {HOURS_12.map((h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")} hr
                </option>
              ))}
            </select>
            <span style={{ fontWeight: 900, fontSize: 16, color: "#0f172a" }}>
              :
            </span>
            <select
              value={String(minuteValue || "00").padStart(2, "0")}
              onChange={(e) => onMinuteChange(e.target.value)}
              style={styles.timeSelectBox}
            >
              {MINUTES_60.map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
            <div style={styles.ampmToggleGroup}>
              {["AM", "PM"].map((period) => {
                const active = ampmValue === period;
                return (
                  <button
                    key={period}
                    type="button"
                    onClick={() => onAmpmChange(period)}
                    style={
                      active ? styles.ampmBtnActive : styles.ampmBtnInactive
                    }
                  >
                    {period}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div style={styles.timePreview12h}>
        {previewLabel || "Selected"}:{" "}
        <strong>{formatDateTime12Hour(previewISO)}</strong>
      </div>
    </div>
  );
}

export function getStatusBadgeStyle(pass, now) {
  const status = pass.status;
  const isOverdue =
    status === "OUTSIDE" &&
    !pass.isOpenReturn &&
    pass.permittedTo &&
    new Date(pass.permittedTo) < now;

  if (isOverdue) {
    return {
      background: "#fef2f2",
      color: "#b91c1c",
      border: "1px solid #fecaca",
      padding: "5px 10px",
      borderRadius: "999px",
      fontSize: "11px",
      fontWeight: 800,
      display: "inline-block",
    };
  }
  if (status === "ARRIVED_AT_GATE") {
    return {
      background: "#f3e8ff",
      color: "#6d28d9",
      border: "1px solid #d8b4fe",
      padding: "5px 10px",
      borderRadius: "999px",
      fontSize: "11px",
      fontWeight: 800,
      display: "inline-block",
    };
  }
  if (status === "APPROVED") {
    return {
      background: "#e0f2fe",
      color: "#0369a1",
      border: "1px solid #bae6fd",
      padding: "5px 10px",
      borderRadius: "999px",
      fontSize: "11px",
      fontWeight: 800,
      display: "inline-block",
    };
  }
  if (status === "OUTSIDE") {
    return {
      background: "#fffbeb",
      color: "#b45309",
      border: "1px solid #fde68a",
      padding: "5px 10px",
      borderRadius: "999px",
      fontSize: "11px",
      fontWeight: 800,
      display: "inline-block",
    };
  }
  if (status === "RETURNED") {
    return {
      background: "#ecfdf5",
      color: "#047857",
      border: "1px solid #a7f3d0",
      padding: "5px 10px",
      borderRadius: "999px",
      fontSize: "11px",
      fontWeight: 800,
      display: "inline-block",
    };
  }
  return {
    background: "#f1f5f9",
    color: "#334155",
    border: "1px solid #cbd5e1",
    padding: "5px 10px",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: 800,
    display: "inline-block",
  };
}

export const styles = {
  pageWrapper: {
    minHeight: "100vh",
    background: "#f1f5f9",
    padding: "20px 16px 48px",
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    color: "#0f172a",
  },
  container: {
    maxWidth: "1340px",
    margin: "0 auto",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "16px",
    background: "linear-gradient(135deg, #064e3b 0%, #0f766e 100%)",
    color: "#ffffff",
    padding: "20px 26px",
    borderRadius: "16px",
    boxShadow: "0 10px 25px -5px rgba(6, 78, 59, 0.25)",
    marginBottom: "20px",
  },
  uniBadge: {
    fontSize: "11px",
    letterSpacing: "1.4px",
    color: "#a7f3d0",
    fontWeight: 800,
    textTransform: "uppercase",
  },
  title: {
    margin: "3px 0 0",
    fontSize: "22px",
    fontWeight: 800,
    color: "#ffffff",
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    flexWrap: "wrap",
  },
  userPill: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    background: "rgba(15, 23, 42, 0.35)",
    border: "1px solid rgba(255, 255, 255, 0.2)",
    padding: "8px 14px",
    borderRadius: "999px",
  },
  roleDot: (isAdmin) => ({
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    background: isAdmin ? "#fbbf24" : "#34d399",
  }),
  backBtn: {
    background: "#ffffff",
    color: "#064e3b",
    padding: "9px 16px",
    borderRadius: "10px",
    fontSize: "13px",
    fontWeight: 800,
    textDecoration: "none",
    boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
  },
  navBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "12px",
    marginBottom: "22px",
  },
  navSegmentGroup: {
    display: "flex",
    gap: "8px",
    background: "#e2e8f0",
    padding: "6px",
    borderRadius: "14px",
    flexWrap: "wrap",
  },
  mainTabActive: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "10px 18px",
    borderRadius: "10px",
    border: "none",
    background: "#0f172a",
    color: "#ffffff",
    fontWeight: 700,
    fontSize: "14px",
    cursor: "pointer",
    boxShadow: "0 2px 8px rgba(15, 23, 42, 0.2)",
  },
  mainTabInactive: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "10px 18px",
    borderRadius: "10px",
    border: "none",
    background: "transparent",
    color: "#334155",
    fontWeight: 700,
    fontSize: "14px",
    cursor: "pointer",
  },
  tabCounterActive: {
    background: "#0d9488",
    color: "#ffffff",
    padding: "2px 8px",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: 800,
  },
  tabCounterInactive: {
    background: "#cbd5e1",
    color: "#1e293b",
    padding: "2px 8px",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: 800,
  },
  quickScanReturnHeaderBtn: {
    background: "#059669",
    color: "#ffffff",
    border: "none",
    padding: "11px 18px",
    borderRadius: "12px",
    fontWeight: 800,
    fontSize: "13px",
    cursor: "pointer",
    boxShadow: "0 4px 12px rgba(5, 150, 105, 0.25)",
  },
  twoColGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))",
    gap: "24px",
    alignItems: "start",
  },
  slipContainer: {
    background: "#ffffff",
    borderRadius: "16px",
    border: "1px solid #cbd5e1",
    overflow: "hidden",
    boxShadow: "0 4px 16px rgba(15, 23, 42, 0.05)",
  },
  slipBanner: {
    background: "linear-gradient(135deg, #0f766e 0%, #115e59 100%)",
    color: "#ffffff",
    padding: "18px 22px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "10px",
    borderBottom: "3px solid #f59e0b",
  },
  slipBannerSub: {
    fontSize: "10px",
    fontWeight: 800,
    letterSpacing: "1.2px",
    color: "#99f6e4",
  },
  slipBannerTitle: {
    margin: "2px 0 0",
    fontSize: "18px",
    fontWeight: 800,
    color: "#ffffff",
  },
  slipBody: {
    padding: "22px",
  },
  fieldLabel: {
    display: "block",
    fontSize: "13px",
    fontWeight: 800,
    color: "#0f172a",
    marginBottom: "8px",
  },
  subFieldLabel: {
    display: "block",
    fontSize: "11px",
    fontWeight: 700,
    color: "#475569",
    marginBottom: "5px",
  },
  timePickerCard: {
    background: "#f8fafc",
    border: "1.5px solid #cbd5e1",
    borderRadius: "12px",
    padding: "14px",
  },
  timeSectionTitle: {
    fontSize: "12px",
    fontWeight: 800,
    color: "#0f172a",
    textTransform: "uppercase",
  },
  customDateTimeGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: "12px",
    alignItems: "end",
  },
  dateInputBox: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: "10px",
    border: "1.5px solid #0d9488",
    fontSize: "14px",
    fontWeight: 700,
    color: "#0f172a",
    background: "#ffffff",
    cursor: "pointer",
  },
  timeSelectBox: {
    flex: 1,
    padding: "10px 8px",
    borderRadius: "10px",
    border: "1.5px solid #0d9488",
    fontSize: "14px",
    fontWeight: 800,
    color: "#0f172a",
    background: "#ffffff",
    cursor: "pointer",
  },
  ampmToggleGroup: {
    display: "flex",
    background: "#e2e8f0",
    padding: "3px",
    borderRadius: "10px",
    border: "1px solid #cbd5e1",
  },
  ampmBtnActive: {
    background: "#0f766e",
    color: "#ffffff",
    border: "none",
    borderRadius: "7px",
    padding: "7px 10px",
    fontSize: "12px",
    fontWeight: 800,
    cursor: "pointer",
  },
  ampmBtnInactive: {
    background: "transparent",
    color: "#334155",
    border: "none",
    borderRadius: "7px",
    padding: "7px 10px",
    fontSize: "12px",
    fontWeight: 700,
    cursor: "pointer",
  },
  miniDayStepBtn: {
    background: "#ffffff",
    color: "#334155",
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    padding: "4px 8px",
    fontSize: "11px",
    fontWeight: 800,
    cursor: "pointer",
  },
  timePreview12h: {
    marginTop: "10px",
    fontSize: "12px",
    fontWeight: 700,
    color: "#0f766e",
    background: "#f0fdfa",
    border: "1px solid #99f6e4",
    padding: "5px 10px",
    borderRadius: "8px",
    display: "inline-block",
  },
  medicalOpenBtnInactive: {
    background: "#e0f2fe",
    color: "#0369a1",
    border: "1.5px solid #7dd3fc",
    borderRadius: "999px",
    padding: "6px 14px",
    fontSize: "12px",
    fontWeight: 800,
    cursor: "pointer",
  },
  medicalOpenBtnActive: {
    background: "#0284c7",
    color: "#ffffff",
    border: "1.5px solid #0284c7",
    borderRadius: "999px",
    padding: "6px 14px",
    fontSize: "12px",
    fontWeight: 800,
    cursor: "pointer",
  },
  searchInput: {
    width: "100%",
    padding: "12px 75px 12px 14px",
    borderRadius: "10px",
    border: "1.5px solid #94a3b8",
    fontSize: "14px",
    color: "#0f172a",
    background: "#ffffff",
    fontWeight: 500,
  },
  searchInputSmall: {
    width: "100%",
    padding: "10px 75px 10px 14px",
    borderRadius: "10px",
    border: "1px solid #cbd5e1",
    fontSize: "13px",
    color: "#0f172a",
    background: "#ffffff",
  },
  searchClearIconBtn: {
    position: "absolute",
    right: "8px",
    top: "50%",
    transform: "translateY(-50%)",
    background: "#fee2e2",
    color: "#b91c1c",
    border: "1px solid #fecaca",
    borderRadius: "6px",
    padding: "4px 8px",
    fontSize: "11px",
    fontWeight: 800,
    cursor: "pointer",
  },
  barcodeScanBtn: {
    background: "#0f172a",
    color: "#ffffff",
    border: "none",
    borderRadius: "10px",
    padding: "0 18px",
    fontWeight: 800,
    fontSize: "13px",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  searchDropdown: {
    marginTop: "6px",
    background: "#ffffff",
    border: "1.5px solid #0d9488",
    borderRadius: "12px",
    boxShadow: "0 12px 24px rgba(15, 23, 42, 0.12)",
    maxHeight: "260px",
    overflowY: "auto",
    zIndex: 20,
  },
  dropdownHeader: {
    padding: "8px 14px",
    background: "#f0fdfa",
    color: "#0f766e",
    fontSize: "11px",
    fontWeight: 800,
    textTransform: "uppercase",
    borderBottom: "1px solid #ccfbf1",
  },
  dropdownRow: {
    padding: "11px 14px",
    borderBottom: "1px solid #f1f5f9",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    cursor: "pointer",
    background: "#ffffff",
  },
  selectedProfileCard: {
    background: "#f0fdfa",
    border: "2px solid #0d9488",
    borderRadius: "14px",
    padding: "16px",
  },
  changeStudentBtn: {
    background: "#fee2e2",
    color: "#b91c1c",
    border: "1px solid #fca5a5",
    borderRadius: "8px",
    padding: "7px 12px",
    fontSize: "12px",
    fontWeight: 800,
    cursor: "pointer",
  },
  monthOutingsBadge: {
    background: "#ffffff",
    color: "#0f172a",
    border: "1px solid #cbd5e1",
    padding: "2px 8px",
    borderRadius: "6px",
    fontSize: "12px",
  },
  duplicateWarningBox: {
    marginTop: "12px",
    background: "#fef2f2",
    border: "1px solid #fca5a5",
    color: "#991b1b",
    padding: "10px 12px",
    borderRadius: "8px",
    fontSize: "12px",
    fontWeight: 700,
  },
  textInput: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: "10px",
    border: "1.5px solid #cbd5e1",
    fontSize: "14px",
    color: "#0f172a",
    background: "#ffffff",
    fontWeight: 600,
  },
  chipGroup: {
    display: "flex",
    gap: "6px",
    flexWrap: "wrap",
    marginTop: "8px",
  },
  quickChip: {
    background: "#ffffff",
    color: "#334155",
    border: "1px solid #cbd5e1",
    borderRadius: "999px",
    padding: "6px 12px",
    fontSize: "12px",
    fontWeight: 700,
    cursor: "pointer",
  },
  quickChipActive: {
    background: "#0f766e",
    color: "#ffffff",
    border: "1px solid #0f766e",
    borderRadius: "999px",
    padding: "6px 12px",
    fontSize: "12px",
    fontWeight: 700,
    cursor: "pointer",
  },
  dateRowGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: "12px",
  },
  teacherSignatureBox: {
    background: "#f8fafc",
    border: "1px solid #cbd5e1",
    borderRadius: "12px",
    padding: "12px 16px",
    marginBottom: "18px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
  },
  verifiedAccountBadge: {
    background: "#dcfce7",
    color: "#166534",
    border: "1px solid #bbf7d0",
    padding: "4px 10px",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: 800,
  },
  primarySubmitBtn: {
    width: "100%",
    padding: "14px 20px",
    background: "#0f766e",
    color: "#ffffff",
    border: "none",
    borderRadius: "12px",
    fontSize: "15px",
    fontWeight: 800,
    boxShadow: "0 4px 14px rgba(15, 118, 110, 0.3)",
  },
  card: {
    background: "#ffffff",
    borderRadius: "16px",
    border: "1px solid #cbd5e1",
    padding: "22px",
    boxShadow: "0 4px 16px rgba(15, 23, 42, 0.05)",
  },
  cardHeaderRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "10px",
    marginBottom: "16px",
  },
  cardTitle: {
    margin: 0,
    fontSize: "18px",
    fontWeight: 800,
    color: "#0f172a",
  },
  cardSubtitle: {
    margin: "3px 0 0",
    fontSize: "13px",
    color: "#64748b",
  },
  scanReturnSmallBtn: {
    background: "#059669",
    color: "#ffffff",
    border: "none",
    borderRadius: "10px",
    padding: "9px 14px",
    fontSize: "12px",
    fontWeight: 800,
    cursor: "pointer",
  },
  segmentedBar: {
    display: "flex",
    gap: "6px",
    background: "#f1f5f9",
    padding: "5px",
    borderRadius: "12px",
    marginBottom: "14px",
    border: "1px solid #e2e8f0",
    flexWrap: "wrap",
  },
  segmentBtnActive: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
    padding: "8px 10px",
    borderRadius: "8px",
    border: "none",
    background: "#0f766e",
    color: "#ffffff",
    fontSize: "12px",
    fontWeight: 800,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  segmentBtnInactive: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
    padding: "8px 10px",
    borderRadius: "8px",
    border: "none",
    background: "transparent",
    color: "#334155",
    fontSize: "12px",
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  segmentBadgeActive: {
    background: "#ffffff",
    color: "#0f766e",
    padding: "2px 7px",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: 800,
  },
  segmentBadgeInactive: {
    background: "#cbd5e1",
    color: "#0f172a",
    padding: "2px 7px",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: 800,
  },
  emptyStateBox: {
    padding: "40px 20px",
    textAlign: "center",
    background: "#f8fafc",
    borderRadius: "12px",
    border: "1px dashed #cbd5e1",
  },
  passListScroll: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    maxHeight: "650px",
    overflowY: "auto",
    paddingRight: "4px",
  },
  passCardItem: {
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "12px",
    padding: "14px 16px",
  },
  adNoBadge: {
    background: "#e0f2fe",
    color: "#0369a1",
    border: "1px solid #bae6fd",
    padding: "2px 8px",
    borderRadius: "6px",
    fontSize: "12px",
    fontWeight: 800,
  },
  classPill: {
    background: "#f1f5f9",
    color: "#334155",
    border: "1px solid #cbd5e1",
    padding: "2px 8px",
    borderRadius: "6px",
    fontSize: "12px",
    fontWeight: 700,
  },
  classPillActive: {
    background: "#0f766e",
    color: "#ffffff",
    padding: "3px 10px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 700,
  },
  alreadyOutMiniTag: {
    background: "#fef2f2",
    color: "#dc2626",
    border: "1px solid #fecaca",
    padding: "2px 8px",
    borderRadius: "6px",
    fontSize: "11px",
    fontWeight: 800,
  },
  editPassBtn: {
    background: "#f1f5f9",
    color: "#0f172a",
    border: "1px solid #cbd5e1",
    borderRadius: "8px",
    padding: "7px 10px",
    fontSize: "12px",
    fontWeight: 800,
    cursor: "pointer",
  },
  editPassBtnSmall: {
    background: "#f1f5f9",
    color: "#0f172a",
    border: "1px solid #cbd5e1",
    borderRadius: "8px",
    padding: "6px 10px",
    fontSize: "12px",
    fontWeight: 800,
    cursor: "pointer",
  },
  markReturnedBtn: {
    background: "#059669",
    color: "#ffffff",
    border: "none",
    borderRadius: "8px",
    padding: "7px 12px",
    fontSize: "12px",
    fontWeight: 800,
    cursor: "pointer",
  },
  markReturnedBtnSmall: {
    background: "#059669",
    color: "#ffffff",
    border: "none",
    borderRadius: "8px",
    padding: "6px 12px",
    fontSize: "12px",
    fontWeight: 800,
    cursor: "pointer",
  },
  cancelPassBtn: {
    background: "#fff1f2",
    color: "#be123c",
    border: "1px solid #fecdd3",
    borderRadius: "6px",
    padding: "4px 10px",
    fontSize: "11px",
    fontWeight: 700,
    cursor: "pointer",
  },
  saveEditBtn: {
    background: "#0f766e",
    color: "#ffffff",
    border: "none",
    borderRadius: "10px",
    padding: "10px 18px",
    fontSize: "13px",
    fontWeight: 800,
    cursor: "pointer",
  },
  cancelEditBtn: {
    background: "#f1f5f9",
    color: "#334155",
    border: "1px solid #cbd5e1",
    borderRadius: "10px",
    padding: "10px 16px",
    fontSize: "13px",
    fontWeight: 700,
    cursor: "pointer",
  },
  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "16px",
    marginBottom: "20px",
  },
  kpiCard: {
    background: "#ffffff",
    padding: "18px 20px",
    borderRadius: "14px",
    border: "1px solid #e2e8f0",
    boxShadow: "0 2px 10px rgba(15, 23, 42, 0.04)",
    cursor: "pointer",
  },
  kpiTopRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  kpiLabel: {
    fontSize: "11px",
    fontWeight: 800,
    color: "#475569",
    letterSpacing: "0.5px",
  },
  kpiIconBox: (bg, color) => ({
    width: "34px",
    height: "34px",
    borderRadius: "10px",
    background: bg,
    color: color,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "16px",
  }),
  kpiNumber: {
    fontSize: "32px",
    fontWeight: 900,
    margin: "6px 0 4px",
  },
  kpiFooter: {
    fontSize: "12px",
    color: "#64748b",
    fontWeight: 500,
  },
  filterInput: {
    width: "100%",
    padding: "9px 12px",
    borderRadius: "8px",
    border: "1px solid #cbd5e1",
    fontSize: "13px",
    color: "#0f172a",
    background: "#ffffff",
  },
  filterSelect: {
    width: "100%",
    padding: "9px 12px",
    borderRadius: "8px",
    border: "1px solid #cbd5e1",
    fontSize: "13px",
    fontWeight: 600,
    color: "#0f172a",
    background: "#ffffff",
    cursor: "pointer",
  },
  exportCsvBtn: {
    background: "#0f172a",
    color: "#ffffff",
    border: "none",
    borderRadius: "8px",
    padding: "9px 14px",
    fontSize: "13px",
    fontWeight: 700,
    cursor: "pointer",
  },
  tableContainer: {
    background: "#ffffff",
    borderRadius: "16px",
    border: "1px solid #cbd5e1",
    overflowX: "auto",
    boxShadow: "0 4px 16px rgba(15, 23, 42, 0.04)",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    textAlign: "left",
    fontSize: "14px",
  },
  th: {
    padding: "14px 18px",
    background: "#f8fafc",
    borderBottom: "2px solid #e2e8f0",
    fontSize: "12px",
    fontWeight: 800,
    textTransform: "uppercase",
    color: "#334155",
    letterSpacing: "0.4px",
  },
  tr: {
    borderBottom: "1px solid #f1f5f9",
  },
  td: {
    padding: "14px 18px",
    verticalAlign: "middle",
    color: "#1e293b",
  },
  insideStatusBadge: {
    background: "#ecfdf5",
    color: "#047857",
    border: "1px solid #a7f3d0",
    padding: "5px 12px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 800,
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(15, 23, 42, 0.75)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    padding: "16px",
  },
  modalCard: {
    background: "#ffffff",
    padding: "24px",
    borderRadius: "16px",
    maxWidth: "420px",
    width: "100%",
    boxShadow: "0 20px 40px rgba(0,0,0,0.3)",
  },
  iconCloseBtn: {
    background: "#f1f5f9",
    color: "#334155",
    border: "1px solid #cbd5e1",
    borderRadius: "8px",
    width: "32px",
    height: "32px",
    fontWeight: 800,
    cursor: "pointer",
  },
  closeModalBtn: {
    marginTop: "16px",
    width: "100%",
    padding: "12px",
    background: "#dc2626",
    color: "#ffffff",
    border: "none",
    borderRadius: "10px",
    fontWeight: 800,
    fontSize: "14px",
    cursor: "pointer",
  },
};