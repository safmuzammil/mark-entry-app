"use client";

export const dynamic = "force-dynamic";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { db, auth } from "@/lib/firebase";
import {
  collection,
  addDoc,
  getDocs,
  updateDoc,
  setDoc,
  doc,
  query,
  orderBy,
  limit,
  where,
  onSnapshot,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";

// ============================================================================
// 🔐 PRIVATE BETA / TEST MODE CONFIGURATION
// ============================================================================
// Keep true while testing with yourself & 1 colleague. Change to false when ready for all teachers!
const BETA_TEST_MODE_ONLY = true;

const ALLOWED_TEST_USERS = [
  "admin",
  "muzammil",      // 👈 Your username
  "sharafudheen",  // 👈 Your colleague's username
];

const SECURITY_KIOSK_PIN = "1234";
const DEFAULT_GATE_WORKFLOW = true;

// Performance Safeguard: Only stream the latest 250 passes in real-time (easily covers 150 Friday leaves without lag)
const REALTIME_PASS_LIMIT = 250;

const ADMIN_EMAILS = [
  "admin@dhiu.in",
  "admin@gmail.com",
  "dhdegreeclearance@gmail.com",
];

const LEAVE_CATEGORIES = [
  "General",
  "Friday",
  "Evening",
  "Outreach",
  "Medical",
  "Official",
];

const PRESET_DESTINATIONS = [
  "Chemmad",
  "Bookplus",
  "Mampuram",
  "Tirurangadi Hospital",
  "Bank / ATM",
  "Barber Shop",
  "Medical Store",
  "Home",
];

const DHIU_LOGO_URL =
  "https://ik.imagekit.io/syustaging/SYU_PREPROD/LOGO_XGQrxvsxO.webp?tr=w-3840";

// ============================================================================
// 🖼️ CLIENT-SIDE PHOTO COMPRESSOR (Shrinks 4MB photos to ~15KB so app never lags)
// ============================================================================
function compressImageFileToDataUrl(file, maxSize = 180, quality = 0.78) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxSize) {
            height = Math.round((height * maxSize) / width);
            width = maxSize;
          }
        } else {
          if (height > maxSize) {
            width = Math.round((width * maxSize) / height);
            height = maxSize;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        // Try WebP first for smallest size, fallback to JPEG
        let dataUrl = canvas.toDataURL("image/webp", quality);
        if (!dataUrl.startsWith("data:image/webp")) {
          dataUrl = canvas.toDataURL("image/jpeg", quality);
        }
        resolve(dataUrl);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ============================================================================
// 🕒 PURE DATE & 12-HOUR TIME HELPERS
// ============================================================================
function getLocalDateString(dateObj = new Date()) {
  const d = new Date(dateObj);
  if (isNaN(d.getTime())) return "2026-01-01";
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateTo12HourParts(dateObj = new Date()) {
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

function partsToISOString(dateStr, hour12, minuteStr, ampm) {
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

function formatTime12Hour(isoString) {
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

function formatDateTime12Hour(isoString, openReturnFlag = false) {
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

function playBeep(isError = false) {
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

// ============================================================================
// 🖼️ STUDENT AVATAR COMPONENT (Checks Firestore Photo -> /students/{adNo}.jpg -> Initials)
// ============================================================================
function StudentAvatar({ name, adNo, photoUrl, size = 44, onClick }) {
  const [imgStep, setImgStep] = useState(photoUrl ? 0 : 1);

  useEffect(() => {
    setImgStep(photoUrl ? 0 : 1);
  }, [photoUrl, adNo]);

  const initial = (name || "S").trim().charAt(0).toUpperCase();
  const srcToTry =
    imgStep === 0
      ? photoUrl
      : imgStep === 1 && adNo
      ? `/students/${adNo}.jpg`
      : null;

  return (
    <div
      onClick={onClick}
      title={onClick ? "Click to enlarge photo" : name}
      style={{
        width: size,
        height: size,
        minWidth: size,
        borderRadius: size > 48 ? "14px" : "10px",
        background: "linear-gradient(135deg, #0f766e 0%, #0d9488 100%)",
        color: "#ffffff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 800,
        fontSize: Math.round(size * 0.42),
        overflow: "hidden",
        border: "2px solid #99f6e4",
        cursor: onClick ? "zoom-in" : "default",
        position: "relative",
        boxShadow: "0 2px 6px rgba(15, 118, 110, 0.15)",
      }}
    >
      {srcToTry && imgStep < 2 ? (
        <img
          src={srcToTry}
          alt={name}
          loading="lazy"
          onError={() => setImgStep((prev) => prev + 1)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
        />
      ) : (
        <span>{initial}</span>
      )}
    </div>
  );
}

// ============================================================================
// 📅 CUSTOM 12-HOUR DATE & TIME PICKER
// ============================================================================
const HOURS_12 = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
const MINUTES_60 = Array.from({ length: 60 }, (_, i) =>
  String(i).padStart(2, "0")
);

function CustomDateTimePicker({
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

// ============================================================================
// 🚀 MAIN OUT-PASS PORTAL COMPONENT
// ============================================================================
export default function OutPassPortal() {
  // Auth & Distinct Role State
  // Roles: "admin" (Full Control + Reports + Settings) | "teacher" (Permit Leave + Verify Return Only) | "security" (Gate Scanner Only)
  const [currentUser, setCurrentUser] = useState(null);
  const [loggedUsername, setLoggedUsername] = useState("");
  const [staffName, setStaffName] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSecurityKiosk, setIsSecurityKiosk] = useState(false);
  const [securityPinInput, setSecurityPinInput] = useState("");
  const [authChecking, setAuthChecking] = useState(true);
  const [activeTab, setActiveTab] = useState("teacher"); // "teacher" | "security" | "admin" | "settings"

  const [useGatekeeperFlow, setUseGatekeeperFlow] = useState(
    DEFAULT_GATE_WORKFLOW
  );

  // Master Data
  const [students, setStudents] = useState([]);
  const [passes, setPasses] = useState([]);
  const [unapprovedLogs, setUnapprovedLogs] = useState([]);
  const [teachersMap, setTeachersMap] = useState({});
  const [teachersList, setTeachersList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlderHistory, setLoadingOlderHistory] = useState(false);

  // Teacher Issue Form State (Single & Group Out-Pass)
  const [isGroupMode, setIsGroupMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [selectedGroupStudents, setSelectedGroupStudents] = useState([]);
  const [leaveCategory, setLeaveCategory] = useState("General");
  const [destination, setDestination] = useState("");
  const [purpose, setPurpose] = useState("");
  const [selectedTeacherOverride, setSelectedTeacherOverride] = useState("");

  // Explicit 12-Hour Departure & Return State
  const [fromDate, setFromDate] = useState("2026-01-01");
  const [fromHour, setFromHour] = useState("10");
  const [fromMinute, setFromMinute] = useState("00");
  const [fromAmpm, setFromAmpm] = useState("AM");

  const [toDate, setToDate] = useState("2026-01-01");
  const [toHour, setToHour] = useState("12");
  const [toMinute, setToMinute] = useState("00");
  const [toAmpm, setToAmpm] = useState("PM");

  const [isOpenReturn, setIsOpenReturn] = useState(false);
  const [activeDurationChip, setActiveDurationChip] = useState("2h");

  const [submitting, setSubmitting] = useState(false);
  const [teacherStatusFilter, setTeacherStatusFilter] = useState("ALL");
  const [teacherSearch, setTeacherSearch] = useState("");

  // Security Gate Kiosk State
  const [gateBarcodeInput, setGateBarcodeInput] = useState("");
  const [gateScanResult, setGateScanResult] = useState(null);
  const gateInputRef = useRef(null);

  // Edit Existing Pass Modal State
  const [editingPass, setEditingPass] = useState(null);
  const [editLeaveCategory, setEditLeaveCategory] = useState("General");
  const [editFromDate, setEditFromDate] = useState("");
  const [editFromHour, setEditFromHour] = useState("10");
  const [editFromMinute, setEditFromMinute] = useState("00");
  const [editFromAmpm, setEditFromAmpm] = useState("AM");
  const [editToDate, setEditToDate] = useState("");
  const [editToHour, setEditToHour] = useState("12");
  const [editToMinute, setEditToMinute] = useState("00");
  const [editToAmpm, setEditToAmpm] = useState("PM");
  const [editIsOpenReturn, setEditIsOpenReturn] = useState(false);
  const [editDestination, setEditDestination] = useState("");
  const [editPurpose, setEditPurpose] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Digital Receipt & Photo Lightbox
  const [receiptPass, setReceiptPass] = useState(null);
  const [zoomPhotoStudent, setZoomPhotoStudent] = useState(null);

  // Camera Barcode Scanner State
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerMode, setScannerMode] = useState("teacher"); // "teacher" | "return" | "gate"
  const scannerRef = useRef(null);

  // Admin & Reports State
  const [adminReportType, setAdminReportType] = useState("OUTSIDE");
  const [reportStartDate, setReportStartDate] = useState("");
  const [reportEndDate, setReportEndDate] = useState("");
  const [classFilter, setClassFilter] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [teacherFilter, setTeacherFilter] = useState("ALL");
  const [adminSearch, setAdminSearch] = useState("");
  const [now, setNow] = useState(new Date());

  // Specific Time Absentees (Friday Meal / Food Wastage Regulator)
  const [mealCheckDate, setMealCheckDate] = useState(
    getLocalDateString(new Date())
  );
  const [mealCheckHour, setMealCheckHour] = useState("12");
  const [mealCheckMinute, setMealCheckMinute] = useState("30");
  const [mealCheckAmpm, setMealCheckAmpm] = useState("PM");

  // Admin Photo Upload (By Ad.No) & Disciplinary Settings State
  const [settingsSearch, setSettingsSearch] = useState("");
  const [editingStudentSettings, setEditingStudentSettings] = useState(null);
  const [studentPhotoInput, setStudentPhotoInput] = useState("");
  const [studentBlockedCategories, setStudentBlockedCategories] = useState([]);
  const [studentBlockReason, setStudentBlockReason] = useState("");
  const [savingStudentSettings, setSavingStudentSettings] = useState(false);
  const [bulkUploadProgress, setBulkUploadProgress] = useState("");

  const resetDefaultTimes = () => {
    const current = new Date();
    const twoHoursLater = new Date(current.getTime() + 2 * 60 * 60 * 1000);
    const fParts = dateTo12HourParts(current);
    const tParts = dateTo12HourParts(twoHoursLater);

    setFromDate(fParts.date);
    setFromHour(fParts.hour);
    setFromMinute(fParts.minute);
    setFromAmpm(fParts.ampm);

    setToDate(tParts.date);
    setToHour(tParts.hour);
    setToMinute(tParts.minute);
    setToAmpm(tParts.ampm);

    setIsOpenReturn(false);
    setActiveDurationChip("2h");
  };

  useEffect(() => {
    resetDefaultTimes();
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  const getOfficialTeacherName = (rawNameOrUsername) => {
    if (!rawNameOrUsername) return "Teacher";
    const cleaned = String(rawNameOrUsername)
      .replace(/\s*\(Direct\)\s*$/i, "")
      .trim();
    const key = cleaned.toLowerCase();
    const prefix = key.split("@")[0];
    return teachersMap[key] || teachersMap[prefix] || cleaned;
  };

  // 1. Auth & Optimized Real-Time Firestore Listeners
  useEffect(() => {
    let teacherLookupCache = {};

    const loadTeachersAndStudents = async () => {
      try {
        const teacherSnap = await getDocs(collection(db, "teachers"));
        const map = {};
        const tArr = [];
        teacherSnap.docs.forEach((d) => {
          const t = d.data();
          const officialName = (
            t.fullName ||
            t.name ||
            t.firstName ||
            ""
          ).trim();
          if (officialName) {
            tArr.push({
              username: t.username || d.id,
              fullName: officialName,
              phone: t.phone || "",
              designation: t.designation || "Faculty",
            });
            if (t.username) {
              const u = String(t.username).toLowerCase().trim();
              map[u] = officialName;
              map[u.split("@")[0]] = officialName;
            }
            if (t.email) {
              const em = String(t.email).toLowerCase().trim();
              map[em] = officialName;
              map[em.split("@")[0]] = officialName;
            }
            map[officialName.toLowerCase()] = officialName;
          }
        });
        tArr.sort((a, b) => a.fullName.localeCompare(b.fullName));
        setTeachersList(tArr);
        teacherLookupCache = map;
        setTeachersMap(map);

        const isLocalAdmin =
          typeof window !== "undefined" &&
          localStorage.getItem("isAdminAuth") === "true";

        if (isLocalAdmin) {
          setStaffName("Admin");
          setLoggedUsername("admin");
        } else if (auth.currentUser) {
          const email = (auth.currentUser.email || "").toLowerCase().trim();
          const prefix = email.split("@")[0];
          setLoggedUsername(prefix);
          if (map[email] || map[prefix]) {
            setStaffName(map[email] || map[prefix]);
          }
        }
      } catch (err) {
        console.error("Error loading teachers:", err);
      }

      try {
        const snap = await getDocs(collection(db, "students"));
        const list = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            regNo: String(data.regNo || d.id).trim(),
            adNo: String(data.adNo || data.regNo || data.rollNo || "").trim(),
            name: data.firstName || data.name || "Unknown Student",
            studentClass: Array.isArray(data.classes)
              ? data.classes[0] || "General"
              : data.class || "General",
            department: data.department || "GENERAL",
            photoUrl:
              data.photoUrl ||
              data.photo ||
              data.imageUrl ||
              data.avatar ||
              null,
            blockedCategories: Array.isArray(data.blockedLeaveCategories)
              ? data.blockedLeaveCategories
              : [],
            blockReason: data.leaveBlockReason || "",
            raw: data,
          };
        });
        setStudents(list);
      } catch (err) {
        console.error("Error loading students:", err);
      }
    };

    loadTeachersAndStudents();

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      const localAdminFlag =
        typeof window !== "undefined" &&
        localStorage.getItem("isAdminAuth") === "true";

      const emailIsAdmin =
        user?.email &&
        ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(
          user.email.toLowerCase()
        );

      const userHasAdminAccess = Boolean(localAdminFlag || emailIsAdmin);
      setIsAdmin(userHasAdminAccess);

      if (localAdminFlag) {
        setCurrentUser({ uid: "admin", email: "admin@dhiu.in" });
        setLoggedUsername("admin");
        setStaffName("Admin");
        setActiveTab("admin");
      } else if (user) {
        setCurrentUser(user);
        const emailLower = (user.email || "").toLowerCase().trim();
        const emailPrefix = emailLower.split("@")[0];
        setLoggedUsername(emailPrefix);

        let resolvedName =
          teacherLookupCache[emailLower] ||
          teacherLookupCache[emailPrefix] ||
          user.displayName ||
          emailPrefix ||
          "Teacher";

        setStaffName(emailIsAdmin ? "Admin" : resolvedName);
        setActiveTab(emailIsAdmin ? "admin" : "teacher");
      } else {
        setCurrentUser(null);
      }

      setAuthChecking(false);
    });

    // ⚡ PERFORMANCE OPTIMIZATION: Only stream the latest 250 passes in real-time so Friday 150+ passes never lag!
    const qPasses = query(
      collection(db, "out_passes"),
      orderBy("createdAt", "desc"),
      limit(REALTIME_PASS_LIMIT)
    );
    const unsubPasses = onSnapshot(
      qPasses,
      (snapshot) => {
        setPasses(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      () => setLoading(false)
    );

    const qUnapproved = query(
      collection(db, "outpass_unapproved_logs"),
      orderBy("timestamp", "desc"),
      limit(100)
    );
    const unsubUnapproved = onSnapshot(
      qUnapproved,
      (snapshot) => {
        setUnapprovedLogs(
          snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))
        );
      },
      () => {}
    );

    return () => {
      unsubAuth();
      unsubPasses();
      unsubUnapproved();
    };
  }, []);

  // Strict Role Guard: Teachers can ONLY stay on the "teacher" tab!
  useEffect(() => {
    if (!isAdmin && !isSecurityKiosk && activeTab !== "teacher") {
      setActiveTab("teacher");
    }
  }, [isAdmin, isSecurityKiosk, activeTab]);

  // Keep hardware barcode input focused when on Security Gate tab
  useEffect(() => {
    if (activeTab === "security") {
      setTimeout(() => gateInputRef.current?.focus(), 200);
    }
  }, [activeTab]);

  // On-Demand Full Historical Fetch for Admin Reports when querying older months
  const handleLoadFullHistoryForAdmin = async () => {
    setLoadingOlderHistory(true);
    try {
      const qAll = query(
        collection(db, "out_passes"),
        orderBy("createdAt", "desc"),
        limit(2000)
      );
      const snap = await getDocs(qAll);
      setPasses(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (err) {
      alert("Error loading older history: " + err.message);
    } finally {
      setLoadingOlderHistory(false);
    }
  };

  // Camera Barcode Scanner Effect
  useEffect(() => {
    let html5QrCode = null;

    if (scannerOpen) {
      import("html5-qrcode").then(({ Html5Qrcode }) => {
        html5QrCode = new Html5Qrcode("barcode-reader-region");
        scannerRef.current = html5QrCode;

        html5QrCode
          .start(
            { facingMode: "environment" },
            { fps: 10, qrbox: { width: 260, height: 140 } },
            (decodedText) => {
              handleBarcodeDetected(decodedText.trim());
            },
            () => {}
          )
          .catch((err) => {
            console.error("Camera start error:", err);
            alert("Could not access camera. Please allow camera permissions.");
            setScannerOpen(false);
          });
      });
    }

    return () => {
      if (scannerRef.current) {
        scannerRef.current
          .stop()
          .then(() => scannerRef.current.clear())
          .catch(() => {});
        scannerRef.current = null;
      }
    };
  }, [scannerOpen]);

  // ============================================================================
  // 📸 BULK & SINGLE PHOTO UPLOAD BY STUDENT AD.NO (Auto-Compressed!)
  // ============================================================================
  const handleBulkPhotoUploadByAdNo = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setBulkUploadProgress(`Processing 0 / ${files.length} photos...`);
    let matchedCount = 0;
    let unmatchedFiles = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      // Extract filename without extension: e.g., "U1107.jpg" -> "U1107"
      const rawFileName = file.name.replace(/\.[^/.]+$/, "").trim();
      setBulkUploadProgress(
        `Compressing & Uploading (${i + 1} / ${files.length}): ${file.name}...`
      );

      // Find student matching Ad.No or Reg.No
      const matchedStudent = students.find(
        (s) =>
          s.adNo.toLowerCase() === rawFileName.toLowerCase() ||
          s.regNo.toLowerCase() === rawFileName.toLowerCase()
      );

      if (!matchedStudent) {
        unmatchedFiles.push(file.name);
        continue;
      }

      try {
        const compressedDataUrl = await compressImageFileToDataUrl(file, 180, 0.78);
        await setDoc(
          doc(db, "students", matchedStudent.id),
          { photoUrl: compressedDataUrl },
          { merge: true }
        );
        matchedCount++;
        // Update local state immediately so photo appears right away
        setStudents((prev) =>
          prev.map((st) =>
            st.id === matchedStudent.id
              ? { ...st, photoUrl: compressedDataUrl }
              : st
          )
        );
      } catch (err) {
        console.error("Error uploading photo for", file.name, err);
      }
    }

    setBulkUploadProgress("");
    e.target.value = null;

    let summaryMsg = `✅ Successfully uploaded & linked ${matchedCount} student photo(s)!`;
    if (unmatchedFiles.length > 0) {
      summaryMsg += `\n\n⚠️ Could not find matching Ad.No for ${unmatchedFiles.length} file(s): ${unmatchedFiles.slice(0, 10).join(", ")}`;
    }
    alert(summaryMsg);
  };

  // Single Student Photo File Upload inside Modal
  const handleSingleStudentPhotoFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressedDataUrl = await compressImageFileToDataUrl(file, 180, 0.8);
      setStudentPhotoInput(compressedDataUrl);
    } catch (err) {
      alert("Failed to process image file.");
    }
    e.target.value = null;
  };

  // ============================================================================
  // 🛡️ SECURITY GATE BARCODE SCAN PROCESSOR
  // ============================================================================
  const processSecurityGateScan = async (rawCode) => {
    const code = String(rawCode || "").trim();
    if (!code) return;

    const studentObj = students.find(
      (s) =>
        s.adNo.toLowerCase() === code.toLowerCase() ||
        s.regNo.toLowerCase() === code.toLowerCase()
    );

    const matchingPass = passes.find(
      (p) =>
        (String(p.adNo).toLowerCase() === code.toLowerCase() ||
          (studentObj &&
            String(p.adNo).toLowerCase() ===
              studentObj.adNo.toLowerCase())) &&
        (p.status === "APPROVED" || p.status === "OUTSIDE")
    );

    const scanTimeISO = new Date().toISOString();

    if (matchingPass && matchingPass.status === "APPROVED") {
      playBeep(false);
      await updateDoc(doc(db, "out_passes", matchingPass.id), {
        status: "OUTSIDE",
        gateDepartureTime: scanTimeISO,
        actualDepartureTime: scanTimeISO,
      });
      setGateScanResult({
        allowed: true,
        actionType: "EXIT",
        student: studentObj || {
          name: matchingPass.studentName,
          adNo: matchingPass.adNo,
          studentClass: matchingPass.studentClass,
          department: matchingPass.department || "GENERAL",
          photoUrl: matchingPass.studentPhotoUrl,
        },
        pass: {
          ...matchingPass,
          status: "OUTSIDE",
          gateDepartureTime: scanTimeISO,
        },
        message: "✅ GREEN SIGNAL — PERMITTED TO EXIT CAMPUS",
        timestamp: scanTimeISO,
      });
      return;
    }

    if (matchingPass && matchingPass.status === "OUTSIDE") {
      playBeep(false);
      const isLate =
        !matchingPass.isOpenReturn &&
        matchingPass.permittedTo &&
        new Date(scanTimeISO) > new Date(matchingPass.permittedTo);

      await updateDoc(doc(db, "out_passes", matchingPass.id), {
        status: "ARRIVED_AT_GATE",
        gateArrivalTime: scanTimeISO,
        actualReturnTime: scanTimeISO,
        wasLateReturn: Boolean(isLate),
      });

      setGateScanResult({
        allowed: true,
        actionType: "ENTRY",
        student: studentObj || {
          name: matchingPass.studentName,
          adNo: matchingPass.adNo,
          studentClass: matchingPass.studentClass,
          department: matchingPass.department || "GENERAL",
          photoUrl: matchingPass.studentPhotoUrl,
        },
        pass: {
          ...matchingPass,
          status: "ARRIVED_AT_GATE",
          gateArrivalTime: scanTimeISO,
          wasLateReturn: Boolean(isLate),
        },
        message: isLate
          ? "⚠️ LATE RETURN RECORDED AT GATE — Student Must Meet Permitting Teacher"
          : "✅ ARRIVAL RECORDED AT GATE — Student Must Meet Permitting Teacher",
        timestamp: scanTimeISO,
      });
      return;
    }

    playBeep(true);
    const logEntry = {
      scannedId: code,
      adNo: studentObj?.adNo || code,
      studentName: studentObj?.name || "Unknown / Unregistered ID",
      studentClass: studentObj?.studentClass || "—",
      department: studentObj?.department || "—",
      photoUrl: studentObj?.photoUrl || null,
      timestamp: scanTimeISO,
      reason: "Scanned at Security Gate without an active Teacher Out-Pass",
    };

    try {
      await addDoc(collection(db, "outpass_unapproved_logs"), logEntry);
    } catch (e) {}

    setGateScanResult({
      allowed: false,
      actionType: "REJECTED",
      student: studentObj || {
        name: `Unrecognized / No Pass (#${code})`,
        adNo: code,
        studentClass: "—",
        department: "—",
        photoUrl: null,
      },
      pass: null,
      message: "🚨 RED SIGNAL — NOT ALLOWED! NO ACTIVE OUT-PASS FOUND",
      timestamp: scanTimeISO,
    });
  };

  const handleBarcodeDetected = (code) => {
    setScannerOpen(false);

    if (scannerMode === "gate") {
      processSecurityGateScan(code);
      return;
    }

    playBeep(false);
    if (scannerMode === "teacher") {
      const found = students.find(
        (s) =>
          s.adNo.toLowerCase() === code.toLowerCase() ||
          s.regNo.toLowerCase() === code.toLowerCase()
      );
      if (found) {
        if (isGroupMode) {
          if (!selectedGroupStudents.some((x) => x.adNo === found.adNo)) {
            setSelectedGroupStudents((prev) => [...prev, found]);
          }
        } else {
          setSelectedStudent(found);
        }
        setSearchQuery("");
      } else {
        setSearchQuery(code);
        alert(`Scanned ID "${code}", but no matching Ad.No was found.`);
      }
    } else if (scannerMode === "return") {
      const activePass = passes.find(
        (p) =>
          String(p.adNo).toLowerCase() === code.toLowerCase() &&
          (p.status === "OUTSIDE" || p.status === "ARRIVED_AT_GATE") &&
          (isAdmin ||
            p.teacherId === currentUser?.uid ||
            getOfficialTeacherName(p.teacherName).toLowerCase() ===
              getOfficialTeacherName(staffName).toLowerCase())
      );
      if (activePass) {
        handleTeacherVerifyArrival(activePass);
        alert(
          `✅ Verified return of ${activePass.studentName} (#${activePass.adNo})!`
        );
      } else {
        alert(
          `No active pass (permitted by you) found for scanned ID: ${code}`
        );
      }
    }
  };

  const getStudentByAdNo = (adNo) =>
    students.find(
      (s) => String(s.adNo).toLowerCase() === String(adNo).toLowerCase()
    );

  const getStudentPhotoByAdNo = (adNo) =>
    getStudentByAdNo(adNo)?.photoUrl || null;

  const getActivePassForStudent = (adNo) =>
    passes.find(
      (p) =>
        String(p.adNo).toLowerCase() === String(adNo).toLowerCase() &&
        (p.status === "APPROVED" ||
          p.status === "OUTSIDE" ||
          p.status === "ARRIVED_AT_GATE")
    );

  const isPassOverdue = (pass) => {
    if (!pass || pass.status !== "OUTSIDE") return false;
    if (pass.isOpenReturn || !pass.permittedTo) return false;
    return new Date(pass.permittedTo) < now;
  };

  const isMoreThan5DaysLeave = (pass) => {
    if (!pass || !pass.permittedFrom) return false;
    const start = new Date(pass.permittedFrom);
    const end = pass.actualReturnTime
      ? new Date(pass.actualReturnTime)
      : pass.permittedTo
      ? new Date(pass.permittedTo)
      : now;
    const diffDays = (end - start) / (1000 * 60 * 60 * 24);
    return diffDays >= 5;
  };

  const getMonthlyOutCount = (adNo) => {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return passes.filter(
      (p) =>
        String(p.adNo).toLowerCase() === String(adNo).toLowerCase() &&
        new Date(p.createdAt) >= startOfMonth
    ).length;
  };

  const getRemainingTimeText = (pass) => {
    if (pass.status === "ARRIVED_AT_GATE") {
      return `Arrived at Gate (${formatTime12Hour(
        pass.gateArrivalTime
      )}) — Waiting Teacher Verification`;
    }
    if (pass.status === "APPROVED") {
      return "Waiting for Student to Scan Out at Gate";
    }
    if (pass.isOpenReturn || !pass.permittedTo) {
      return "🏥 Open Return Time (Medical / Unspecified)";
    }
    const diffMs = new Date(pass.permittedTo) - now;
    const absMins = Math.round(Math.abs(diffMs) / 60000);
    const days = Math.floor(absMins / (60 * 24));
    const hrs = Math.floor((absMins % (60 * 24)) / 60);
    const mins = absMins % 60;

    let parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hrs > 0) parts.push(`${hrs}h`);
    parts.push(`${mins}m`);
    const timeStr = parts.join(" ");

    return diffMs < 0 ? `Overdue by ${timeStr}` : `${timeStr} remaining`;
  };

  const getBaseDepartureDate = () => {
    const iso = partsToISOString(fromDate, fromHour, fromMinute, fromAmpm);
    return iso ? new Date(iso) : new Date();
  };

  const setReturnFromDateObj = (endDateObj, chipId) => {
    setIsOpenReturn(false);
    const parts = dateTo12HourParts(endDateObj);
    setToDate(parts.date);
    setToHour(parts.hour);
    setToMinute(parts.minute);
    setToAmpm(parts.ampm);
    setActiveDurationChip(chipId);
  };

  const applyHoursDuration = (hours, chipId) => {
    const start = getBaseDepartureDate();
    const end = new Date(start.getTime() + hours * 60 * 60 * 1000);
    setReturnFromDateObj(end, chipId);
  };

  const applyUntilEvening = () => {
    const start = getBaseDepartureDate();
    const end = new Date(start);
    end.setHours(18, 0, 0, 0);
    setReturnFromDateObj(end, "6pm");
  };

  const applyDaysDuration = (days, chipId) => {
    const start = getBaseDepartureDate();
    const end = new Date(start);
    end.setDate(end.getDate() + days);
    end.setHours(18, 0, 0, 0);
    setReturnFromDateObj(end, chipId);
  };

  // ============================================================================
  // 📝 ISSUE SINGLE OR GROUP OUT-PASS
  // ============================================================================
  const handleIssuePass = async (e) => {
    e.preventDefault();
    const targetStudents = isGroupMode
      ? selectedGroupStudents
      : selectedStudent
      ? [selectedStudent]
      : [];

    if (targetStudents.length === 0) {
      return alert("Please select at least one student.");
    }
    if (!destination.trim() || !purpose.trim()) {
      return alert("Please enter both Destination and Purpose.");
    }

    const fromISO = partsToISOString(fromDate, fromHour, fromMinute, fromAmpm);
    if (!fromISO) {
      return alert("Please select a valid Departure Date and Time.");
    }

    let toISO = null;
    if (!isOpenReturn) {
      toISO = partsToISOString(toDate, toHour, toMinute, toAmpm);
      if (!toISO) {
        return alert(
          "Please select a Return Date & Time, or enable 'No Specific Return Time'."
        );
      }
    }

    for (const st of targetStudents) {
      const blockedList = st.blockedCategories || [];
      if (blockedList.includes("ALL") || blockedList.includes(leaveCategory)) {
        return alert(
          `🚫 DISCIPLINARY BLOCK: ${st.name} (#${st.adNo}) is blocked from taking "${leaveCategory}" leave.\nReason: ${
            st.blockReason || "Disciplinary restriction by Admin"
          }`
        );
      }

      const existingActive = getActivePassForStudent(st.adNo);
      if (existingActive) {
        return alert(
          `Cannot issue pass! ${st.name} (#${st.adNo}) already has an active pass (${existingActive.status}).`
        );
      }
    }

    setSubmitting(true);
    try {
      const nowISO = new Date().toISOString();
      const initialStatus = useGatekeeperFlow ? "APPROVED" : "OUTSIDE";
      const officialTeacher =
        isAdmin && selectedTeacherOverride
          ? selectedTeacherOverride
          : getOfficialTeacherName(staffName);

      const groupBatchId =
        targetStudents.length > 1 ? `GRP-${Date.now()}` : null;

      let lastCreatedPass = null;

      for (const st of targetStudents) {
        // Avoid storing huge base64 strings inside every pass document; StudentAvatar looks up the photo from `students` state by adNo!
        const newPassData = {
          adNo: st.adNo,
          studentName: st.name,
          studentClass: st.studentClass,
          department: st.department || "GENERAL",
          leaveCategory: leaveCategory || "General",
          destination: destination.trim(),
          purpose: purpose.trim(),
          permittedFrom: fromISO,
          permittedTo: isOpenReturn ? null : toISO,
          isOpenReturn: Boolean(isOpenReturn),
          isGroupPass: targetStudents.length > 1,
          groupId: groupBatchId,
          groupCount: targetStudents.length,
          teacherId: currentUser?.uid || "staff",
          teacherEmail: currentUser?.email || "",
          teacherName: officialTeacher,
          status: initialStatus,
          gateDepartureTime: useGatekeeperFlow ? null : fromISO,
          actualDepartureTime: useGatekeeperFlow ? null : fromISO,
          gateArrivalTime: null,
          actualReturnTime: null,
          teacherVerifiedTime: null,
          departureClerkName: officialTeacher,
          returnClerkName: null,
          wasLateReturn: false,
          createdAt: nowISO,
        };

        const docRef = await addDoc(collection(db, "out_passes"), newPassData);
        lastCreatedPass = { id: docRef.id, ...newPassData };
      }

      playBeep(false);
      setReceiptPass(lastCreatedPass);
      setSelectedStudent(null);
      setSelectedGroupStudents([]);
      setDestination("");
      setPurpose("");
    } catch (error) {
      console.error("Error issuing pass:", error);
      alert("Failed to create out-pass. Please check your connection.");
    } finally {
      setSubmitting(false);
    }
  };

  const openEditPassModal = (pass) => {
    const fDate = pass.permittedFrom ? new Date(pass.permittedFrom) : new Date();
    const tDate = pass.permittedTo
      ? new Date(pass.permittedTo)
      : new Date(fDate.getTime() + 2 * 60 * 60 * 1000);

    const fParts = dateTo12HourParts(fDate);
    const tParts = dateTo12HourParts(tDate);

    setEditingPass(pass);
    setEditLeaveCategory(pass.leaveCategory || "General");
    setEditDestination(pass.destination || "");
    setEditPurpose(pass.purpose || "");

    setEditFromDate(fParts.date);
    setEditFromHour(fParts.hour);
    setEditFromMinute(fParts.minute);
    setEditFromAmpm(fParts.ampm);

    setEditToDate(tParts.date);
    setEditToHour(tParts.hour);
    setEditToMinute(tParts.minute);
    setEditToAmpm(tParts.ampm);

    setEditIsOpenReturn(Boolean(pass.isOpenReturn || !pass.permittedTo));
  };

  const handleSaveEditedPass = async (e) => {
    e.preventDefault();
    if (!editingPass) return;

    const updatedFromISO = partsToISOString(
      editFromDate,
      editFromHour,
      editFromMinute,
      editFromAmpm
    );
    if (!updatedFromISO) return alert("Invalid Departure Date & Time.");

    let updatedToISO = null;
    if (!editIsOpenReturn) {
      updatedToISO = partsToISOString(
        editToDate,
        editToHour,
        editToMinute,
        editToAmpm
      );
      if (!updatedToISO) return alert("Invalid Return Date & Time.");
    }

    setSavingEdit(true);
    try {
      await updateDoc(doc(db, "out_passes", editingPass.id), {
        leaveCategory: editLeaveCategory,
        destination: editDestination.trim(),
        purpose: editPurpose.trim(),
        permittedFrom: updatedFromISO,
        permittedTo: editIsOpenReturn ? null : updatedToISO,
        isOpenReturn: Boolean(editIsOpenReturn),
      });
      setEditingPass(null);
    } catch (err) {
      alert("Failed to update out-pass details.");
    } finally {
      setSavingEdit(false);
    }
  };

  const handleTeacherVerifyArrival = async (pass) => {
    try {
      const verifyTime = new Date();
      const arrivalToCompare = pass.gateArrivalTime
        ? new Date(pass.gateArrivalTime)
        : verifyTime;
      const isLate =
        !pass.isOpenReturn &&
        pass.permittedTo &&
        arrivalToCompare > new Date(pass.permittedTo);

      await updateDoc(doc(db, "out_passes", pass.id), {
        status: "RETURNED",
        actualReturnTime: pass.gateArrivalTime || verifyTime.toISOString(),
        teacherVerifiedTime: verifyTime.toISOString(),
        returnClerkName: getOfficialTeacherName(staffName) || "Teacher",
        wasLateReturn: Boolean(isLate),
      });
      playBeep(false);
    } catch (err) {
      alert("Error updating return status.");
    }
  };

  const handleCancelPass = async (pass) => {
    if (!confirm(`Cancel out-pass for ${pass.studentName}?`)) return;
    try {
      await updateDoc(doc(db, "out_passes", pass.id), {
        status: "CANCELLED",
      });
    } catch (err) {}
  };

  const handleSaveStudentDisciplinarySettings = async (e) => {
    e.preventDefault();
    if (!editingStudentSettings) return;
    setSavingStudentSettings(true);
    try {
      await setDoc(
        doc(db, "students", editingStudentSettings.id),
        {
          photoUrl: studentPhotoInput.trim() || null,
          blockedLeaveCategories: studentBlockedCategories,
          leaveBlockReason: studentBlockReason.trim(),
        },
        { merge: true }
      );
      setStudents((prev) =>
        prev.map((s) =>
          s.id === editingStudentSettings.id
            ? {
                ...s,
                photoUrl: studentPhotoInput.trim() || null,
                blockedCategories: studentBlockedCategories,
                blockReason: studentBlockReason.trim(),
              }
            : s
        )
      );
      setEditingStudentSettings(null);
      alert("✅ Student photo & disciplinary leave settings updated!");
    } catch (err) {
      alert("Failed to save settings: " + err.message);
    } finally {
      setSavingStudentSettings(false);
    }
  };

  const handleShareWhatsApp = (pass) => {
    const text = [
      `*DARUL HUDA ISLAMIC UNIVERSITY*`,
      `*STUDENTS' DIGITAL OUT-PASS (SMS)*`,
      `--------------------------------`,
      `👤 *Student:* ${pass.studentName}`,
      `🆔 *Ad.No:* #${pass.adNo} | *Class:* ${pass.studentClass}`,
      `🏷️ *Category:* ${pass.leaveCategory || "General"}`,
      `📍 *Destination:* ${pass.destination}`,
      `📝 *Reason:* ${pass.purpose}`,
      `🚶‍♂️ *Permitted From:* ${formatDateTime12Hour(pass.permittedFrom)}`,
      `⏳ *Return By:* ${formatDateTime12Hour(
        pass.permittedTo,
        pass.isOpenReturn
      )}`,
      `👨‍🏫 *Permitted By:* ${getOfficialTeacherName(pass.teacherName)}`,
      `📌 *Status:* ${pass.status}`,
    ].join("\n");

    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  };

  const handleExportCSV = (rowsToExport) => {
    const listToUse = rowsToExport || passes;
    const headers = [
      "Ad.No",
      "Student Name",
      "Class",
      "Department",
      "Leave Category",
      "Destination",
      "Reason",
      "Permitted Teacher",
      "Permitted From",
      "Permitted To",
      "Gate Exit Time",
      "Gate Return Time",
      "Teacher Verified Time",
      "Status",
    ];
    const rows = listToUse.map((p) => [
      p.adNo,
      `"${(p.studentName || "").replace(/"/g, '""')}"`,
      p.studentClass,
      p.department || "",
      p.leaveCategory || "General",
      `"${(p.destination || "").replace(/"/g, '""')}"`,
      `"${(p.purpose || "").replace(/"/g, '""')}"`,
      `"${getOfficialTeacherName(p.teacherName).replace(/"/g, '""')}"`,
      `"${formatDateTime12Hour(p.permittedFrom)}"`,
      `"${formatDateTime12Hour(p.permittedTo, p.isOpenReturn)}"`,
      `"${formatDateTime12Hour(p.gateDepartureTime || p.actualDepartureTime)}"`,
      `"${formatDateTime12Hour(p.gateArrivalTime || p.actualReturnTime)}"`,
      `"${formatDateTime12Hour(p.teacherVerifiedTime)}"`,
      p.status,
    ]);
    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute(
      "download",
      `DHIU_OutPass_${adminReportType}_${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // ============================================================================
  // 📊 SCOPED LISTS (Strict Teacher Isolation vs Admin Global View)
  // ============================================================================
  // Teachers ONLY see passes they personally approved!
  const myPermittedPasses = passes.filter((p) => {
    if (currentUser?.uid && p.teacherId === currentUser.uid) return true;
    if (
      currentUser?.email &&
      p.teacherEmail &&
      p.teacherEmail.toLowerCase() === currentUser.email.toLowerCase()
    ) {
      return true;
    }
    if (
      staffName &&
      p.teacherName &&
      getOfficialTeacherName(p.teacherName).toLowerCase() ===
        getOfficialTeacherName(staffName).toLowerCase()
    ) {
      return true;
    }
    return false;
  });

  const myOutsideCount = myPermittedPasses.filter(
    (p) => p.status === "OUTSIDE" || p.status === "APPROVED"
  ).length;
  const myUnverifiedCount = myPermittedPasses.filter(
    (p) => p.status === "ARRIVED_AT_GATE"
  ).length;
  const myReturnedCount = myPermittedPasses.filter(
    (p) => p.status === "RETURNED"
  ).length;

  const filteredTeacherPasses = myPermittedPasses.filter((p) => {
    if (
      teacherStatusFilter === "OUTSIDE" &&
      p.status !== "OUTSIDE" &&
      p.status !== "APPROVED"
    )
      return false;
    if (
      teacherStatusFilter === "UNVERIFIED" &&
      p.status !== "ARRIVED_AT_GATE"
    )
      return false;
    if (teacherStatusFilter === "RETURNED" && p.status !== "RETURNED")
      return false;
    if (teacherSearch.trim()) {
      const q = teacherSearch.toLowerCase();
      return (
        p.studentName?.toLowerCase().includes(q) ||
        String(p.adNo).toLowerCase().includes(q) ||
        p.destination?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const currentlyOutsidePasses = passes.filter((p) => p.status === "OUTSIDE");
  const unverifiedArrivalPasses = passes.filter(
    (p) => p.status === "ARRIVED_AT_GATE"
  );
  const overduePasses = currentlyOutsidePasses.filter((p) => isPassOverdue(p));
  const longLeave5DaysPasses = passes.filter(
    (p) =>
      (p.status === "OUTSIDE" || p.status === "APPROVED") &&
      isMoreThan5DaysLeave(p)
  );

  const outsideAdNos = new Set(
    currentlyOutsidePasses.map((p) => String(p.adNo).toLowerCase())
  );
  const insideStudents = students.filter(
    (s) => !outsideAdNos.has(String(s.adNo).toLowerCase())
  );

  const mealCheckTargetISO = partsToISOString(
    mealCheckDate,
    mealCheckHour,
    mealCheckMinute,
    mealCheckAmpm
  );
  const mealTargetDateObj = mealCheckTargetISO
    ? new Date(mealCheckTargetISO)
    : now;

  const mealTimeAbsentPasses = passes.filter((p) => {
    if (p.status === "CANCELLED") return false;
    const from = p.permittedFrom ? new Date(p.permittedFrom) : null;
    if (!from || from > mealTargetDateObj) return false;
    const end = p.actualReturnTime
      ? new Date(p.actualReturnTime)
      : p.permittedTo
      ? new Date(p.permittedTo)
      : new Date(from.getTime() + 24 * 60 * 60 * 1000);
    return mealTargetDateObj >= from && mealTargetDateObj <= end;
  });

  const getFilteredAdminPasses = () => {
    return passes.filter((p) => {
      if (adminReportType === "OUTSIDE" && p.status !== "OUTSIDE") return false;
      if (adminReportType === "OVERDUE" && !isPassOverdue(p)) return false;
      if (adminReportType === "UNVERIFIED" && p.status !== "ARRIVED_AT_GATE")
        return false;
      if (adminReportType === "LONG_LEAVE_5D" && !isMoreThan5DaysLeave(p))
        return false;
      if (adminReportType === "GROUP_PASSES" && !p.isGroupPass) return false;

      if (reportStartDate) {
        const start = new Date(`${reportStartDate}T00:00:00`);
        if (new Date(p.createdAt) < start) return false;
      }
      if (reportEndDate) {
        const end = new Date(`${reportEndDate}T23:59:59`);
        if (new Date(p.createdAt) > end) return false;
      }
      if (classFilter !== "ALL" && p.studentClass !== classFilter) return false;
      if (
        categoryFilter !== "ALL" &&
        (p.leaveCategory || "General") !== categoryFilter
      )
        return false;
      if (
        teacherFilter !== "ALL" &&
        getOfficialTeacherName(p.teacherName) !== teacherFilter
      )
        return false;

      if (adminSearch.trim()) {
        const q = adminSearch.toLowerCase();
        return (
          p.studentName?.toLowerCase().includes(q) ||
          String(p.adNo).toLowerCase().includes(q) ||
          p.destination?.toLowerCase().includes(q) ||
          p.purpose?.toLowerCase().includes(q) ||
          getOfficialTeacherName(p.teacherName).toLowerCase().includes(q)
        );
      }
      return true;
    });
  };

  const getFrequentAnalysis = (onlyLate = false) => {
    const counts = {};
    passes.forEach((p) => {
      if (p.status === "CANCELLED") return;
      if (onlyLate && !p.wasLateReturn && !isPassOverdue(p)) return;
      const key = p.adNo;
      if (!counts[key]) {
        counts[key] = {
          adNo: p.adNo,
          studentName: p.studentName,
          studentClass: p.studentClass,
          count: 0,
          lateCount: 0,
          lastDestination: p.destination,
        };
      }
      counts[key].count += 1;
      if (p.wasLateReturn || isPassOverdue(p)) counts[key].lateCount += 1;
    });
    return Object.values(counts).sort((a, b) => b.count - a.count);
  };

  const allClasses = [
    "ALL",
    ...Array.from(
      new Set([
        ...students.map((s) => s.studentClass),
        ...passes.map((p) => p.studentClass),
      ])
    ).filter(Boolean),
  ];

  const allTeachers = [
    "ALL",
    ...Array.from(
      new Set(passes.map((p) => getOfficialTeacherName(p.teacherName)))
    ).filter(Boolean),
  ];

  const matchingStudents = searchQuery.trim()
    ? students
        .filter(
          (s) =>
            s.adNo.toLowerCase().includes(searchQuery.toLowerCase()) ||
            s.name.toLowerCase().includes(searchQuery.toLowerCase())
        )
        .slice(0, 8)
    : [];

  // ============================================================================
  // 🔒 ACCESS CONTROL: BETA TEST WHITELIST CHECK
  // ============================================================================
  const isWhitelistedTester =
    !BETA_TEST_MODE_ONLY ||
    isAdmin ||
    isSecurityKiosk ||
    ALLOWED_TEST_USERS.some(
      (u) =>
        u.toLowerCase() === loggedUsername.toLowerCase() ||
        staffName.toLowerCase().includes(u.toLowerCase())
    );

  if (!authChecking && !currentUser && !isAdmin && !isSecurityKiosk) {
    return (
      <div className="op-root" style={styles.pageWrapper}>
        <div
          style={{
            ...styles.card,
            maxWidth: 460,
            margin: "60px auto",
            textAlign: "center",
            padding: "32px 28px",
          }}
        >
          <img
            src={DHIU_LOGO_URL}
            alt="DHIU"
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              objectFit: "contain",
              marginBottom: 12,
            }}
          />
          <h2 style={{ margin: "0 0 8px", color: "#0f172a" }}>
            Out-Pass Portal Access
          </h2>
          <p style={{ color: "#475569", fontSize: 14, lineHeight: 1.6 }}>
            Sign in with your Teacher/Admin account on the main portal, or enter
            the Security Gate Kiosk PIN below.
          </p>

          <div
            style={{
              marginTop: 16,
              padding: 14,
              background: "#f8fafc",
              borderRadius: 12,
              border: "1px solid #cbd5e1",
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 800,
                color: "#0f172a",
                marginBottom: 8,
              }}
            >
              🛡️ Security Gate Tablet Kiosk Login
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="password"
                placeholder="Enter Security PIN..."
                value={securityPinInput}
                onChange={(e) => setSecurityPinInput(e.target.value)}
                style={styles.textInput}
              />
              <button
                type="button"
                onClick={() => {
                  if (securityPinInput === SECURITY_KIOSK_PIN) {
                    setIsSecurityKiosk(true);
                    setStaffName("Security Gate");
                    setActiveTab("security");
                  } else {
                    alert("Incorrect Security PIN.");
                  }
                }}
                style={{
                  ...styles.barcodeScanBtn,
                  background: "#0f766e",
                  padding: "0 16px",
                }}
              >
                Open Gate
              </button>
            </div>
          </div>

          <Link
            href="/"
            style={{
              ...styles.primarySubmitBtn,
              display: "inline-block",
              textDecoration: "none",
              marginTop: 18,
            }}
          >
            ← Return to Main Login Portal
          </Link>
        </div>
      </div>
    );
  }

  if (!authChecking && !isWhitelistedTester) {
    return (
      <div className="op-root" style={styles.pageWrapper}>
        <div
          style={{
            ...styles.card,
            maxWidth: 480,
            margin: "80px auto",
            textAlign: "center",
            padding: "36px 28px",
          }}
        >
          <div style={{ fontSize: 42, marginBottom: 12 }}>🧪</div>
          <h2 style={{ margin: "0 0 8px", color: "#0f172a" }}>
            Private Testing Mode Active
          </h2>
          <p style={{ color: "#475569", fontSize: 14, lineHeight: 1.6 }}>
            Hello <strong>{staffName}</strong> (<code>{loggedUsername}</code>),
            the Digital Out-Pass Portal is currently in private preview for
            initial testing.
          </p>
          <Link
            href="/"
            style={{
              ...styles.primarySubmitBtn,
              display: "inline-block",
              textDecoration: "none",
              marginTop: 18,
            }}
          >
            ← Back to Mark Entry Portal
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="op-root" style={styles.pageWrapper}>
      <style>{`
        .op-root * { box-sizing: border-box; }
        .op-root input, .op-root select, .op-root textarea {
          color: #0f172a !important;
          background-color: #ffffff !important;
          color-scheme: light !important;
          font-family: inherit;
        }
        .op-root input::placeholder { color: #94a3b8 !important; opacity: 1 !important; }
        .op-root input:focus, .op-root select:focus { outline: 2px solid #0d9488 !important; border-color: #0d9488 !important; }
        .op-root button { font-family: inherit; transition: all 0.15s ease; }
        .op-root button:active { transform: scale(0.98); }
        .op-student-item:hover { background-color: #f0fdfa !important; }
      `}</style>

      <div style={styles.container}>
        {/* BETA BANNER (Only shown to Admin) */}
        {BETA_TEST_MODE_ONLY && isAdmin && (
          <div
            style={{
              background: "#fffbeb",
              border: "1px solid #fcd34d",
              color: "#92400e",
              padding: "8px 16px",
              borderRadius: "10px",
              marginBottom: "12px",
              fontSize: "12px",
              fontWeight: 700,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <span>
              🧪 <strong>PRIVATE TEST MODE:</strong> Visible only to Admin &amp;
              whitelisted testers ({ALLOWED_TEST_USERS.join(", ")}).
            </span>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={useGatekeeperFlow}
                onChange={(e) => setUseGatekeeperFlow(e.target.checked)}
              />
              <span>
                Require Security Gate Scan for Departure/Arrival (4-Step Flow)
              </span>
            </label>
          </div>
        )}

        {/* HEADER */}
        <header style={styles.header}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <img
              src={DHIU_LOGO_URL}
              alt="DHIU Logo"
              style={{
                width: 52,
                height: 52,
                borderRadius: "50%",
                objectFit: "contain",
                backgroundColor: "#ffffff",
                padding: 2,
              }}
            />
            <div>
              <div style={styles.uniBadge}>
                DARUL HUDA ISLAMIC UNIVERSITY • CHEMMAD
              </div>
              <h1 style={styles.title}>
                {isAdmin
                  ? "Admin Out-Pass Command & Reports"
                  : isSecurityKiosk
                  ? "Security Gate Verification Kiosk"
                  : "Teacher Leave Permission Desk"}
              </h1>
            </div>
          </div>

          <div style={styles.headerRight}>
            <div style={styles.userPill}>
              <span style={styles.roleDot(isAdmin)} />
              <span style={{ color: "#cbd5e1", fontSize: 12 }}>
                {isAdmin ? "Admin:" : isSecurityKiosk ? "Gate:" : "Teacher:"}
              </span>
              <strong style={{ color: "#ffffff", fontSize: 13 }}>
                {getOfficialTeacherName(staffName)}
              </strong>
            </div>
            <Link href="/" style={styles.backBtn}>
              ← Mark Portal
            </Link>
          </div>
        </header>

        {/* =========================================================
            NAVIGATION BAR: STRICT ROLE SEPARATION
            - Teachers ONLY see the Teacher Leave Desk + Return Scanner
            - Admin sees Admin Dashboard/Reports, Photos/Settings, Security Gate, and Proxy Issue Desk
           ========================================================= */}
        <div style={styles.navBar}>
          <div style={styles.navSegmentGroup}>
            {!isSecurityKiosk && (
              <button
                type="button"
                onClick={() => setActiveTab("teacher")}
                style={
                  activeTab === "teacher"
                    ? styles.mainTabActive
                    : styles.mainTabInactive
                }
              >
                <span>
                  {isAdmin
                    ? "📝 Issue Leave (Proxy / Teacher Desk)"
                    : "👨‍🏫 Permit Student Leave"}
                </span>
                <span
                  style={
                    activeTab === "teacher"
                      ? styles.tabCounterActive
                      : styles.tabCounterInactive
                  }
                >
                  {myOutsideCount} My Active
                </span>
              </button>
            )}

            {isAdmin && (
              <>
                <button
                  type="button"
                  onClick={() => setActiveTab("admin")}
                  style={
                    activeTab === "admin"
                      ? styles.mainTabActive
                      : styles.mainTabInactive
                  }
                >
                  <span>📊 Admin Dashboard &amp; 14 Reports</span>
                  <span
                    style={
                      activeTab === "admin"
                        ? styles.tabCounterActive
                        : styles.tabCounterInactive
                    }
                  >
                    {currentlyOutsidePasses.length} Outside
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("settings")}
                  style={
                    activeTab === "settings"
                      ? styles.mainTabActive
                      : styles.mainTabInactive
                  }
                >
                  <span>📸 Upload Photos (Ad.No) &amp; Leave Blocks</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("security")}
                  style={
                    activeTab === "security"
                      ? styles.mainTabActive
                      : styles.mainTabInactive
                  }
                >
                  <span>🛡️ Security Gate View</span>
                </button>
              </>
            )}

            {isSecurityKiosk && (
              <button type="button" style={styles.mainTabActive}>
                <span>🛡️ Security Gate Scanner Kiosk</span>
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              setScannerMode(activeTab === "security" ? "gate" : "return");
              setScannerOpen(true);
            }}
            style={styles.quickScanReturnHeaderBtn}
          >
            📷{" "}
            {activeTab === "security"
              ? "Scan Gate ID Barcode"
              : "Scan Student ID for Return"}
          </button>
        </div>

        {/* =========================================================
            MODAL 1: CAMERA BARCODE SCANNER
           ========================================================= */}
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

        {/* =========================================================
            MODAL 2: STUDENT PHOTO ZOOM LIGHTBOX
           ========================================================= */}
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
                <strong>{zoomPhotoStudent.studentClass}</strong>
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

        {/* =========================================================
            MODAL 3: DIGITAL OUT-PASS SLIP RECEIPT
           ========================================================= */}
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
                  DARUL HUDA ISLAMIC UNIVERSITY
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
                    <div
                      style={{
                        fontSize: 17,
                        fontWeight: 800,
                        color: "#0f172a",
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
                    💬 Share via WhatsApp
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

        {/* =========================================================
            MODAL 4: EDIT EXISTING OUT-PASS
           ========================================================= */}
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
                    Extend or Modify Leave
                  </div>
                  <h3
                    style={{ margin: "2px 0 0", color: "#0f172a", fontSize: 18 }}
                  >
                    ✏️ {editingPass.studentName} (#{editingPass.adNo})
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
                    {savingEdit ? "Saving..." : "💾 Save Extended Leave"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* =========================================================
            TAB 1: TEACHER LEAVE PERMISSION DESK
            (Distinct Teacher Function: Permit Leave + Verify Return of Own Students)
           ========================================================= */}
        {activeTab === "teacher" && (
          <div style={styles.twoColGrid}>
            {/* LEFT: ISSUE FORM */}
            <div style={styles.slipContainer}>
              <div style={styles.slipBanner}>
                <div>
                  <div style={styles.slipBannerSub}>
                    TEACHER LEAVE PERMISSION DESK
                  </div>
                  <h2 style={styles.slipBannerTitle}>
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
                <div style={{ marginBottom: 18 }}>
                  <label style={styles.fieldLabel}>
                    1.{" "}
                    {isGroupMode
                      ? `Select Multiple Students for Group Out-Pass (${selectedGroupStudents.length} selected)`
                      : "Select Student (Scan Barcode or Search Ad.No / Name)"}
                  </label>

                  {(!selectedStudent || isGroupMode) && (
                    <div style={{ position: "relative" }}>
                      <div style={{ display: "flex", gap: 10 }}>
                        <div style={{ position: "relative", flex: 1 }}>
                          <input
                            type="text"
                            placeholder="Search by Admission No. (e.g. 3529) or Name..."
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
                            const isBlocked =
                              (st.blockedCategories || []).length > 0;
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
                                      • {st.department}
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
                              borderRadius: "50%",
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
                            onClick={() =>
                              setZoomPhotoStudent(selectedStudent)
                            }
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

                      {(selectedStudent.blockedCategories || []).length > 0 && (
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
                    </div>
                  )}
                </div>

                <form onSubmit={handleIssuePass}>
                  <div style={{ marginBottom: 18 }}>
                    <label style={styles.fieldLabel}>
                      2. Leave Category (Friday, Evening, Outreach, Medical,
                      Official, General)
                    </label>
                    <div style={styles.chipGroup}>
                      {LEAVE_CATEGORIES.map((cat) => {
                        const active = leaveCategory === cat;
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
                              }
                            }}
                            style={
                              active
                                ? styles.quickChipActive
                                : styles.quickChip
                            }
                          >
                            🏷️ {cat}
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
                      placeholder="Select below or type destination (e.g. Chemmad, Bookplus, Mampuram)..."
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
                        📅 +3 Days
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

                  {/* Teacher Name: Locked to the logged-in teacher for Teachers; Dropdown only for Admin Proxy */}
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
                        Permitting Teacher
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
                      (!selectedStudent && selectedGroupStudents.length === 0)
                    }
                    style={{
                      ...styles.primarySubmitBtn,
                      opacity:
                        submitting ||
                        (!selectedStudent &&
                          selectedGroupStudents.length === 0)
                          ? 0.55
                          : 1,
                    }}
                  >
                    {submitting
                      ? "Permitting Leave..."
                      : isGroupMode
                      ? `✅ Permit Group Leave (${selectedGroupStudents.length} Students)`
                      : "✅ Permit Student Leave"}
                  </button>
                </form>
              </div>
            </div>

            {/* RIGHT: ONLY THIS TEACHER'S PERMITTED STUDENTS */}
            <div style={styles.card}>
              <div style={styles.cardHeaderRow}>
                <div>
                  <h3 style={styles.cardTitle}>
                    📋 My Permitted Students ({myPermittedPasses.length})
                  </h3>
                  <p style={styles.cardSubtitle}>
                    Students whose leave was permitted by{" "}
                    <strong>{getOfficialTeacherName(staffName)}</strong>
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
                  placeholder="Filter my permitted students by name, Ad.No, or place..."
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
                                  {p.studentClass}
                                </span>
                                <span
                                  style={{
                                    ...styles.classPill,
                                    background: "#fef3c7",
                                    color: "#92400e",
                                  }}
                                >
                                  {p.leaveCategory || "General"}
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
                                    onClick={() =>
                                      handleTeacherVerifyArrival(p)
                                    }
                                    style={styles.markReturnedBtn}
                                  >
                                    ✓ Verify Arrival
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
        )}

        {/* =========================================================
            TAB 2: SECURITY GATE SCANNER KIOSK
           ========================================================= */}
        {activeTab === "security" && (isAdmin || isSecurityKiosk) && (
          <div style={styles.twoColGrid}>
            <div style={styles.card}>
              <h2 style={{ margin: "0 0 6px", fontSize: 20, color: "#0f172a" }}>
                🛡️ Security Gate ID Card Scanner (Hard &amp; Soft)
              </h2>
              <p style={{ margin: "0 0 16px", fontSize: 13, color: "#475569" }}>
                Scan student barcode using USB/Wireless Barcode Scanner or click
                Camera Scanner.
              </p>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  processSecurityGateScan(gateBarcodeInput);
                  setGateBarcodeInput("");
                }}
                style={{ display: "flex", gap: 10, marginBottom: 18 }}
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

              {gateScanResult && (
                <div
                  style={{
                    padding: 24,
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
                      background: gateScanResult.allowed
                        ? "#16a34a"
                        : "#dc2626",
                      color: "#ffffff",
                      fontWeight: 900,
                      fontSize: 15,
                      marginBottom: 16,
                    }}
                  >
                    {gateScanResult.message}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <StudentAvatar
                      name={gateScanResult.student?.name}
                      adNo={gateScanResult.student?.adNo}
                      photoUrl={getStudentPhotoByAdNo(
                        gateScanResult.student?.adNo
                      )}
                      size={120}
                    />
                    <div>
                      <h3
                        style={{
                          margin: 0,
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
                          🏷️ <strong>Leave Category:</strong>{" "}
                          {gateScanResult.pass.leaveCategory || "General"}
                        </div>
                        <div>
                          📍 <strong>Destination:</strong>{" "}
                          {gateScanResult.pass.destination} (
                          {gateScanResult.pass.purpose})
                        </div>
                        <div>
                          👨‍🏫 <strong>Permitted By:</strong>{" "}
                          {getOfficialTeacherName(
                            gateScanResult.pass.teacherName
                          )}
                        </div>
                        <div>
                          ⏳ <strong>Return Deadline:</strong>{" "}
                          {formatDateTime12Hour(
                            gateScanResult.pass.permittedTo,
                            gateScanResult.pass.isOpenReturn
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div style={styles.card}>
              <h3 style={styles.cardTitle}>
                🚪 Permitted Students Ready for Gate Crossing
              </h3>
              <p style={{ ...styles.cardSubtitle, marginBottom: 14 }}>
                Students with active permission waiting to exit or return at the
                gate
              </p>

              <div style={styles.passListScroll}>
                {passes
                  .filter(
                    (p) => p.status === "APPROVED" || p.status === "OUTSIDE"
                  )
                  .map((p) => (
                    <div
                      key={p.id}
                      style={{
                        ...styles.passCardItem,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 12,
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
                        />
                        <div>
                          <div style={{ fontWeight: 800, color: "#0f172a" }}>
                            {p.studentName}{" "}
                            <span style={styles.adNoBadge}>#{p.adNo}</span>
                          </div>
                          <div style={{ fontSize: 12, color: "#475569" }}>
                            📍 {p.destination} • By{" "}
                            {getOfficialTeacherName(p.teacherName)}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => processSecurityGateScan(p.adNo)}
                        style={{
                          ...styles.markReturnedBtn,
                          background:
                            p.status === "APPROVED" ? "#0284c7" : "#059669",
                        }}
                      >
                        {p.status === "APPROVED"
                          ? "🚪 Record Gate Exit"
                          : "🏁 Record Gate Return"}
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )}

        {/* =========================================================
            TAB 3: ADMIN LIVE DASHBOARD & 14 COMPREHENSIVE REPORTS
           ========================================================= */}
        {activeTab === "admin" && isAdmin && (
          <div>
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
                  <span style={styles.kpiIconBox("#d1fae5", "#059669")}>
                    🟢
                  </span>
                </div>
                <div style={{ ...styles.kpiNumber, color: "#059669" }}>
                  {insideStudents.length}
                </div>
                <div style={styles.kpiFooter}>
                  Students currently inside campus
                </div>
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
                  <span style={styles.kpiIconBox("#fef3c7", "#d97706")}>
                    🟠
                  </span>
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
                  <span style={styles.kpiIconBox("#ede9fe", "#7c3aed")}>
                    📅
                  </span>
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
                  <span style={styles.kpiIconBox("#fee2e2", "#dc2626")}>
                    🚨
                  </span>
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
                  📑 Select Report View (Showing latest {passes.length} passes
                  for zero lag):
                </span>
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

              <div
                style={{
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                  alignItems: "center",
                  marginTop: 14,
                  paddingTop: 12,
                  borderTop: "1px solid #e2e8f0",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>From:</span>
                  <input
                    type="date"
                    value={reportStartDate}
                    onChange={(e) => setReportStartDate(e.target.value)}
                    style={styles.filterSelect}
                  />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>To:</span>
                  <input
                    type="date"
                    value={reportEndDate}
                    onChange={(e) => setReportEndDate(e.target.value)}
                    style={styles.filterSelect}
                  />
                </div>

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

                <input
                  type="text"
                  placeholder="Search student, Ad.No, place..."
                  value={adminSearch}
                  onChange={(e) => setAdminSearch(e.target.value)}
                  style={{ ...styles.filterInput, maxWidth: 220 }}
                />

                <button
                  type="button"
                  onClick={() => handleExportCSV(getFilteredAdminPasses())}
                  style={styles.exportCsvBtn}
                >
                  ⬇️ Export CSV
                </button>
              </div>
            </div>

            {adminReportType === "MEAL_ABSENTEES" && (
              <div style={{ ...styles.card, marginBottom: 18 }}>
                <h3 style={{ margin: "0 0 8px", color: "#0f172a" }}>
                  🍽️ Specific Time Absentees List (Friday Food Wastage
                  Regulation)
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
                  {Math.max(0, students.length - mealTimeAbsentPasses.length)}{" "}
                  present students)
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
                    {getFrequentAnalysis(
                      adminReportType === "FREQUENT_LATE"
                    ).map((item, idx) => (
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
                          <span style={styles.adNoBadge}>
                            {item.count} leaves
                          </span>
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
                    ))}
                  </tbody>
                </table>
              ) : adminReportType === "INSIDE" ? (
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Student</th>
                      <th style={styles.th}>Ad.No</th>
                      <th style={styles.th}>Class &amp; Dept</th>
                      <th style={styles.th}>Campus Status</th>
                      <th style={styles.th}>Leaves This Month</th>
                    </tr>
                  </thead>
                  <tbody>
                    {insideStudents
                      .filter(
                        (s) =>
                          (classFilter === "ALL" ||
                            s.studentClass === classFilter) &&
                          (s.name
                            .toLowerCase()
                            .includes(adminSearch.toLowerCase()) ||
                            s.adNo
                              .toLowerCase()
                              .includes(adminSearch.toLowerCase()))
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
                              />
                              <strong>{s.name}</strong>
                            </div>
                          </td>
                          <td style={styles.td}>
                            <span style={styles.adNoBadge}>#{s.adNo}</span>
                          </td>
                          <td style={styles.td}>
                            Class {s.studentClass} • {s.department}
                          </td>
                          <td style={styles.td}>
                            <span style={styles.insideStatusBadge}>
                              🟢 Present On-Campus
                            </span>
                          </td>
                          <td style={styles.td}>
                            <strong>{getMonthlyOutCount(s.adNo)}</strong>
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
                                />
                                <div>
                                  <div style={{ fontWeight: 800 }}>
                                    {p.studentName}
                                  </div>
                                  <div
                                    style={{ fontSize: 12, color: "#475569" }}
                                  >
                                    #{p.adNo} • {p.studentClass}
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
                                        onClick={() =>
                                          handleTeacherVerifyArrival(p)
                                        }
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
        )}

        {/* =========================================================
            TAB 4: ADMIN PHOTO UPLOAD (BY AD.NO) & DISCIPLINARY BLOCKS
           ========================================================= */}
        {activeTab === "settings" && isAdmin && (
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
                  Select multiple photo files named after the student&apos;s
                  Admission Number (e.g. <code>3529.jpg</code>,{" "}
                  <code>U1107.png</code>). Each photo is automatically
                  compressed to ~15 KB so the app stays lightning-fast!
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
              ⚙️ Individual Student Photo &amp; Disciplinary Leave Restrictions
            </h3>
            <p style={{ ...styles.cardSubtitle, marginBottom: 16 }}>
              Search any student below to upload/replace their photo or block
              specific leave categories (e.g. Friday, Evening, or All Leaves).
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
                      {editingStudentSettings.name} (#
                      {editingStudentSettings.adNo})
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
                              setStudentBlockedCategories((prev) => [
                                ...prev,
                                cat,
                              ]);
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
                        s.name
                          .toLowerCase()
                          .includes(settingsSearch.toLowerCase()) ||
                        s.adNo
                          .toLowerCase()
                          .includes(settingsSearch.toLowerCase())
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
                          {(s.blockedCategories || []).length > 0 ? (
                            <span style={styles.alreadyOutMiniTag}>
                              🚫 Blocked: {s.blockedCategories.join(", ")} (
                              {s.blockReason || "Disciplinary"})
                            </span>
                          ) : (
                            <span style={styles.insideStatusBadge}>
                              ✓ All Leaves Allowed
                            </span>
                          )}
                        </td>
                        <td style={styles.td}>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingStudentSettings(s);
                              setStudentPhotoInput(s.photoUrl || "");
                              setStudentBlockedCategories(
                                s.blockedCategories || []
                              );
                              setStudentBlockReason(s.blockReason || "");
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
        )}
      </div>
    </div>
  );
}

function getStatusBadgeStyle(pass, now) {
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

const styles = {
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