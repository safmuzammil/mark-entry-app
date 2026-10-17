"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { db, auth } from "@/lib/firebase";
import {
  collection,
  addDoc,
  getDocs,
  updateDoc,
  doc,
  query,
  orderBy,
  onSnapshot,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";

// ============================================================================
// 🔧 MASTER CONFIGURATION SWITCHES
// 1. Set USE_STRICT_GATEKEEPER to `true` later when you add a Gatekeeper!
const USE_STRICT_GATEKEEPER = false;

// 2. Add any Admin emails here (in addition to your main app's `isAdminAuth` session)
const ADMIN_EMAILS = [
  "admin@dhiu.in",
  "admin@gmail.com",
  "dhdegreeclearance@gmail.com",
];
// ============================================================================

export default function OutPassPortal() {
  // Auth & Strict Role State
  const [currentUser, setCurrentUser] = useState(null);
  const [staffName, setStaffName] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [activeTab, setActiveTab] = useState("teacher"); // "teacher" | "gatekeeper" | "admin"

  // Master Data
  const [students, setStudents] = useState([]);
  const [passes, setPasses] = useState([]);
  const [loading, setLoading] = useState(true);

  // Teacher Issue Form State
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [destination, setDestination] = useState("");
  const [purpose, setPurpose] = useState("");
  const [permittedFrom, setPermittedFrom] = useState("");
  const [permittedTo, setPermittedTo] = useState("");
  const [activeDurationChip, setActiveDurationChip] = useState("2h");
  const [submitting, setSubmitting] = useState(false);
  const [teacherStatusFilter, setTeacherStatusFilter] = useState("ALL"); // "ALL" | "OUTSIDE" | "RETURNED"
  const [teacherSearch, setTeacherSearch] = useState("");

  // Barcode Scanner State
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerMode, setScannerMode] = useState("teacher"); // "teacher" | "return" | "gate"
  const [gateScanResult, setGateScanResult] = useState(null);
  const scannerRef = useRef(null);

  // Admin Filter State
  const [adminViewMode, setAdminViewMode] = useState("OUTSIDE"); // "OUTSIDE" | "INSIDE" | "HISTORY"
  const [classFilter, setClassFilter] = useState("ALL");
  const [teacherFilter, setTeacherFilter] = useState("ALL");
  const [adminSearch, setAdminSearch] = useState("");
  const [now, setNow] = useState(new Date());

  // Live clock for overdue & countdown calculation every 30 seconds
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  // Default datetime helper for inputs
  const formatDateTimeLocal = (date) => {
    const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
  };

  // Initialize Default Times (+2 hours by default)
  const resetDefaultTimes = () => {
    const current = new Date();
    const twoHoursLater = new Date(current.getTime() + 2 * 60 * 60 * 1000);
    setPermittedFrom(formatDateTimeLocal(current));
    setPermittedTo(formatDateTimeLocal(twoHoursLater));
    setActiveDurationChip("2h");
  };

  useEffect(() => {
    resetDefaultTimes();
  }, []);

  // 1. Check Auth, Verify Admin vs Teacher Role, & Load Data
  useEffect(() => {
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

      if (user) {
        setCurrentUser(user);
        let resolvedName =
          user.displayName ||
          user.email?.split("@")[0]?.replace(/[._]/g, " ") ||
          "Teacher";

        try {
          const teacherSnap = await getDocs(collection(db, "teachers"));
          const matchedTeacher = teacherSnap.docs
            .map((d) => d.data())
            .find(
              (t) =>
                t.email &&
                user.email &&
                t.email.toLowerCase() === user.email.toLowerCase()
            );
          if (matchedTeacher?.name || matchedTeacher?.firstName) {
            resolvedName = matchedTeacher.name || matchedTeacher.firstName;
          }
        } catch (e) {
          // Fallback to email display name
        }

        setStaffName(
          userHasAdminAccess && !user ? "Administrator" : resolvedName
        );
      } else if (localAdminFlag) {
        setCurrentUser({ uid: "admin", email: "admin" });
        setStaffName("Administrator");
        setActiveTab("admin");
      } else {
        setCurrentUser(null);
      }

      setAuthChecking(false);
    });

    // Fetch Master Students List
    const fetchStudents = async () => {
      try {
        const snap = await getDocs(collection(db, "students"));
        const list = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            adNo: String(data.adNo || data.regNo || data.rollNo || "").trim(),
            name: data.firstName || data.name || "Unknown Student",
            studentClass: Array.isArray(data.classes)
              ? data.classes[0] || "General"
              : data.class || data.department || "General",
            raw: data,
          };
        });
        setStudents(list);
      } catch (err) {
        console.error("Error loading students:", err);
      }
    };

    fetchStudents();

    // Real-time listener for Out-Passes
    const q = query(collection(db, "out_passes"), orderBy("createdAt", "desc"));
    const unsubPasses = onSnapshot(
      q,
      (snapshot) => {
        const passList = snapshot.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));
        setPasses(passList);
        setLoading(false);
      },
      (err) => {
        console.error("Error listening to out_passes:", err);
        setLoading(false);
      }
    );

    return () => {
      unsubAuth();
      unsubPasses();
    };
  }, []);

  // Security guard: Prevent non-admins from switching to the "admin" tab
  useEffect(() => {
    if (!isAdmin && activeTab === "admin") {
      setActiveTab("teacher");
    }
  }, [isAdmin, activeTab]);

  // 2. Barcode Camera Scanner Handler
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
            alert(
              "Could not access camera. Please allow camera permissions or use manual search."
            );
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

  const handleBarcodeDetected = (code) => {
    setScannerOpen(false);

    if (scannerMode === "teacher") {
      const found = students.find(
        (s) => s.adNo.toLowerCase() === code.toLowerCase()
      );
      if (found) {
        setSelectedStudent(found);
        setSearchQuery("");
      } else {
        setSearchQuery(code);
        alert(`Scanned ID "${code}", but no matching Ad.No was found.`);
      }
    } else if (scannerMode === "return") {
      const activePass = passes.find(
        (p) =>
          String(p.adNo).toLowerCase() === code.toLowerCase() &&
          p.status === "OUTSIDE" &&
          (isAdmin ||
            p.teacherId === currentUser?.uid ||
            p.teacherEmail === currentUser?.email ||
            p.teacherName === staffName)
      );
      if (activePass) {
        handleConfirmReturn(activePass);
        alert(
          `✅ Marked ${activePass.studentName} (#${activePass.adNo}) as RETURNED!`
        );
      } else {
        alert(
          `No active OUTSIDE pass (approved by you) found for scanned ID: ${code}`
        );
      }
    } else if (scannerMode === "gate") {
      handleGateLookupByAdNo(code);
    }
  };

  // Helper: Check if student already has an active pass
  const getActivePassForStudent = (adNo) => {
    return passes.find(
      (p) =>
        String(p.adNo).toLowerCase() === String(adNo).toLowerCase() &&
        (p.status === "APPROVED" || p.status === "OUTSIDE")
    );
  };

  // Helper: Count how many times student went out this month
  const getMonthlyOutCount = (adNo) => {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return passes.filter(
      (p) =>
        String(p.adNo).toLowerCase() === String(adNo).toLowerCase() &&
        new Date(p.createdAt) >= startOfMonth
    ).length;
  };

  // Helper: Format live remaining time or overdue duration
  const getRemainingTimeText = (permittedToISO) => {
    const diffMs = new Date(permittedToISO) - now;
    const absMins = Math.round(Math.abs(diffMs) / 60000);
    const hrs = Math.floor(absMins / 60);
    const mins = absMins % 60;
    const timeStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
    return diffMs < 0 ? `Overdue by ${timeStr}` : `${timeStr} remaining`;
  };

  // Quick Duration Setter
  const applyDuration = (hours, chipId) => {
    const start = permittedFrom ? new Date(permittedFrom) : new Date();
    const end = new Date(start.getTime() + hours * 60 * 60 * 1000);
    setPermittedTo(formatDateTimeLocal(end));
    setActiveDurationChip(chipId);
  };

  const applyUntilEvening = () => {
    const end = new Date();
    end.setHours(18, 0, 0, 0);
    setPermittedTo(formatDateTimeLocal(end));
    setActiveDurationChip("6pm");
  };

  // 3. Teacher Submit: Issue Out-Pass
  const handleIssuePass = async (e) => {
    e.preventDefault();
    if (!selectedStudent) return alert("Please select or scan a student first.");
    if (!destination.trim() || !purpose.trim()) {
      return alert("Please enter both Destination and Purpose.");
    }

    const existingActive = getActivePassForStudent(selectedStudent.adNo);
    if (existingActive) {
      return alert(
        `Cannot issue pass! ${selectedStudent.name} is already marked as ${existingActive.status} (Permitted by ${existingActive.teacherName}).`
      );
    }

    setSubmitting(true);
    try {
      const nowISO = new Date().toISOString();
      const initialStatus = USE_STRICT_GATEKEEPER ? "APPROVED" : "OUTSIDE";

      await addDoc(collection(db, "out_passes"), {
        adNo: selectedStudent.adNo,
        studentName: selectedStudent.name,
        studentClass: selectedStudent.studentClass,
        destination: destination.trim(),
        purpose: purpose.trim(),
        permittedFrom: new Date(permittedFrom).toISOString(),
        permittedTo: new Date(permittedTo).toISOString(),
        teacherId: currentUser?.uid || "staff",
        teacherEmail: currentUser?.email || "",
        teacherName: staffName || "Teacher",
        status: initialStatus,
        actualDepartureTime: USE_STRICT_GATEKEEPER ? null : nowISO,
        actualReturnTime: null,
        departureClerkName: USE_STRICT_GATEKEEPER
          ? null
          : `${staffName || "Teacher"} (Direct)`,
        returnClerkName: null,
        wasLateReturn: false,
        createdAt: nowISO,
      });

      setSelectedStudent(null);
      setDestination("");
      setPurpose("");
      resetDefaultTimes();
    } catch (error) {
      console.error("Error issuing pass:", error);
      alert("Failed to create out-pass. Please check your connection.");
    } finally {
      setSubmitting(false);
    }
  };

  // 4. Gatekeeper & Return Actions
  const handleGateLookupByAdNo = (adNoInput) => {
    const activePass = getActivePassForStudent(adNoInput);
    if (activePass) {
      setGateScanResult(activePass);
    } else {
      alert(
        `No active pass found for Ad.No: ${adNoInput}. Student does NOT have permission!`
      );
      setGateScanResult(null);
    }
  };

  const handleConfirmDeparture = async (pass) => {
    try {
      const passRef = doc(db, "out_passes", pass.id);
      await updateDoc(passRef, {
        status: "OUTSIDE",
        actualDepartureTime: new Date().toISOString(),
        departureClerkName: staffName || "Gatekeeper",
      });
      setGateScanResult(null);
    } catch (err) {
      console.error("Error marking departure:", err);
      alert("Error updating departure status.");
    }
  };

  const handleConfirmReturn = async (pass) => {
    try {
      const returnTime = new Date();
      const allowedUntil = new Date(pass.permittedTo);
      const isLate = returnTime > allowedUntil;

      const passRef = doc(db, "out_passes", pass.id);
      await updateDoc(passRef, {
        status: "RETURNED",
        actualReturnTime: returnTime.toISOString(),
        returnClerkName: staffName || "Staff",
        wasLateReturn: isLate,
      });
      setGateScanResult(null);
    } catch (err) {
      console.error("Error marking return:", err);
      alert("Error updating return status.");
    }
  };

  const handleCancelPass = async (pass) => {
    if (!confirm(`Cancel out-pass for ${pass.studentName}?`)) return;
    try {
      await updateDoc(doc(db, "out_passes", pass.id), {
        status: "CANCELLED",
      });
    } catch (err) {
      console.error("Error cancelling pass:", err);
    }
  };

  // Export CSV for Admin
  const handleExportCSV = () => {
    const headers = [
      "Ad.No",
      "Student Name",
      "Class",
      "Destination",
      "Reason",
      "Permitted Teacher",
      "Permitted From",
      "Permitted To",
      "Actual Departure",
      "Actual Return",
      "Status",
    ];
    const rows = passes.map((p) => [
      p.adNo,
      `"${(p.studentName || "").replace(/"/g, '""')}"`,
      p.studentClass,
      `"${(p.destination || "").replace(/"/g, '""')}"`,
      `"${(p.purpose || "").replace(/"/g, '""')}"`,
      `"${(p.teacherName || "").replace(/"/g, '""')}"`,
      p.permittedFrom ? new Date(p.permittedFrom).toLocaleString("en-IN") : "",
      p.permittedTo ? new Date(p.permittedTo).toLocaleString("en-IN") : "",
      p.actualDepartureTime
        ? new Date(p.actualDepartureTime).toLocaleString("en-IN")
        : "",
      p.actualReturnTime
        ? new Date(p.actualReturnTime).toLocaleString("en-IN")
        : "",
      p.status,
    ]);
    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute(
      "download",
      `DHIU_OutPass_Report_${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // ============================================================================
  // STRICT DATA SEPARATION:
  // ============================================================================
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
      p.teacherName.toLowerCase() === staffName.toLowerCase()
    ) {
      return true;
    }
    return false;
  });

  const myOutsideCount = myPermittedPasses.filter(
    (p) => p.status === "OUTSIDE"
  ).length;
  const myReturnedCount = myPermittedPasses.filter(
    (p) => p.status === "RETURNED"
  ).length;

  const filteredTeacherPasses = myPermittedPasses.filter((p) => {
    if (teacherStatusFilter === "OUTSIDE" && p.status !== "OUTSIDE")
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

  // Global Lists (Strictly for Admin / Gatekeeper)
  const approvedWaitingPasses = passes.filter((p) => p.status === "APPROVED");
  const currentlyOutsidePasses = passes.filter((p) => p.status === "OUTSIDE");
  const overduePasses = currentlyOutsidePasses.filter(
    (p) => new Date(p.permittedTo) < now
  );

  const outsideAdNos = new Set(
    currentlyOutsidePasses.map((p) => String(p.adNo).toLowerCase())
  );
  const insideStudents = students.filter(
    (s) => !outsideAdNos.has(String(s.adNo).toLowerCase())
  );

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
    ...Array.from(new Set(passes.map((p) => p.teacherName))).filter(Boolean),
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

  // Block unauthenticated users
  if (!authChecking && !currentUser && !isAdmin) {
    return (
      <div className="op-root" style={styles.pageWrapper}>
        <div
          style={{
            ...styles.card,
            maxWidth: 460,
            margin: "80px auto",
            textAlign: "center",
            padding: "36px 28px",
          }}
        >
          <div style={{ fontSize: 42, marginBottom: 12 }}>🔒</div>
          <h2 style={{ margin: "0 0 8px", color: "#0f172a" }}>
            Staff Login Required
          </h2>
          <p style={{ color: "#475569", fontSize: 14, lineHeight: 1.6 }}>
            Please sign in with your Teacher or Administrator account on the
            main portal to access the Students&apos; Out-Pass System.
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
            ← Return to Login Portal
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="op-root" style={styles.pageWrapper}>
      {/* Scoped CSS Reset so globals.css NEVER makes text or buttons invisible */}
      <style>{`
        .op-root * {
          box-sizing: border-box;
        }
        .op-root input, .op-root select, .op-root textarea {
          color: #0f172a !important;
          background-color: #ffffff !important;
          font-family: inherit;
        }
        .op-root input::placeholder {
          color: #94a3b8 !important;
          opacity: 1 !important;
        }
        .op-root input:focus, .op-root select:focus {
          outline: 2px solid #0d9488 !important;
          border-color: #0d9488 !important;
        }
        .op-root button {
          font-family: inherit;
          transition: all 0.15s ease;
        }
        .op-root button:active {
          transform: scale(0.98);
        }
        .op-student-item:hover {
          background-color: #f0fdfa !important;
        }
      `}</style>

      <div style={styles.container}>
        {/* =========================================================
            TOP INSTITUTIONAL HEADER
           ========================================================= */}
        <header style={styles.header}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={styles.logoCircle}>🪪</div>
            <div>
              <div style={styles.uniBadge}>
                DARUL HUDA ISLAMIC UNIVERSITY • CHEMMAD
              </div>
              <h1 style={styles.title}>
                Students&apos; Movement &amp; Out-Pass Portal
              </h1>
            </div>
          </div>

          <div style={styles.headerRight}>
            <div style={styles.userPill}>
              <span style={styles.roleDot(isAdmin)} />
              <span style={{ color: "#cbd5e1", fontSize: 12 }}>
                {isAdmin ? "Admin:" : "Teacher:"}
              </span>
              <strong style={{ color: "#ffffff", fontSize: 13 }}>
                {staffName || "Staff"}
              </strong>
            </div>
            <Link href="/" style={styles.backBtn}>
              ← Main Portal
            </Link>
          </div>
        </header>

        {/* =========================================================
            NAVIGATION BAR (Teacher vs Admin Strictly Separated)
           ========================================================= */}
        <div style={styles.navBar}>
          <div style={styles.navSegmentGroup}>
            <button
              type="button"
              onClick={() => setActiveTab("teacher")}
              style={
                activeTab === "teacher"
                  ? styles.mainTabActive
                  : styles.mainTabInactive
              }
            >
              <span>👨‍🏫 Teacher Out-Pass Desk</span>
              <span
                style={
                  activeTab === "teacher"
                    ? styles.tabCounterActive
                    : styles.tabCounterInactive
                }
              >
                {myOutsideCount} Active Out
              </span>
            </button>

            {USE_STRICT_GATEKEEPER && (
              <button
                type="button"
                onClick={() => setActiveTab("gatekeeper")}
                style={
                  activeTab === "gatekeeper"
                    ? styles.mainTabActive
                    : styles.mainTabInactive
                }
              >
                <span>🛂 Gatekeeper Scanner</span>
              </button>
            )}

            {isAdmin && (
              <button
                type="button"
                onClick={() => setActiveTab("admin")}
                style={
                  activeTab === "admin"
                    ? styles.mainTabActive
                    : styles.mainTabInactive
                }
              >
                <span>📊 Admin Live Dashboard</span>
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
            )}
          </div>

          {/* Quick Scan to Return Button Always Accessible */}
          <button
            type="button"
            onClick={() => {
              setScannerMode("return");
              setScannerOpen(true);
            }}
            style={styles.quickScanReturnHeaderBtn}
          >
            📷 Scan Returning Student ID
          </button>
        </div>

        {/* =========================================================
            BARCODE CAMERA MODAL
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
                  {scannerMode === "return"
                    ? "📷 Scan ID to Mark Returned"
                    : "📷 Scan Student ID Barcode"}
                </h3>
                <button
                  type="button"
                  onClick={() => setScannerOpen(false)}
                  style={styles.iconCloseBtn}
                >
                  ✕
                </button>
              </div>
              <p
                style={{
                  fontSize: 13,
                  color: "#475569",
                  marginTop: 0,
                  marginBottom: 14,
                }}
              >
                Align the Student ID card barcode inside the frame below.
              </p>
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
            TAB 1: TEACHER PORTAL (ISSUE LEAVE & MY APPROVED STUDENTS)
           ========================================================= */}
        {activeTab === "teacher" && (
          <div style={styles.twoColGrid}>
            {/* LEFT COLUMN: OFFICIAL DIGITAL OUT-PASS SLIP FORM */}
            <div style={styles.slipContainer}>
              <div style={styles.slipBanner}>
                <div>
                  <div style={styles.slipBannerSub}>
                    OFFICIAL MOVEMENT PERMISSION
                  </div>
                  <h2 style={styles.slipBannerTitle}>
                    Issue Student Out-Pass (SMS)
                  </h2>
                </div>
                <div style={styles.slipDatePill}>
                  📅{" "}
                  {new Date().toLocaleDateString("en-IN", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })}
                </div>
              </div>

              <div style={styles.slipBody}>
                {/* STEP 1: STUDENT SELECTION */}
                <div style={{ marginBottom: 20 }}>
                  <label style={styles.fieldLabel}>
                    1. Select Student (Scan Barcode or Search Ad.No / Name)
                  </label>

                  {!selectedStudent ? (
                    <div style={{ position: "relative" }}>
                      <div style={{ display: "flex", gap: 10 }}>
                        <div style={{ position: "relative", flex: 1 }}>
                          <input
                            type="text"
                            placeholder="Search by Admission No. (e.g. 4512) or Name..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            style={styles.searchInput}
                          />
                          {searchQuery && (
                            <button
                              type="button"
                              onClick={() => setSearchQuery("")}
                              title="Clear search"
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
                          📷 Scan ID Card
                        </button>
                      </div>

                      {/* Auto-complete Dropdown */}
                      {matchingStudents.length > 0 && (
                        <div style={styles.searchDropdown}>
                          <div style={styles.dropdownHeader}>
                            Matching Students ({matchingStudents.length})
                          </div>
                          {matchingStudents.map((st) => {
                            const activePass = getActivePassForStudent(st.adNo);
                            return (
                              <div
                                key={st.id}
                                className="op-student-item"
                                onClick={() => {
                                  setSelectedStudent(st);
                                  setSearchQuery("");
                                }}
                                style={styles.dropdownRow}
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 10,
                                  }}
                                >
                                  <div style={styles.studentAvatarMini}>
                                    {st.name.charAt(0).toUpperCase()}
                                  </div>
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
                                      </strong>
                                    </div>
                                  </div>
                                </div>

                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                  }}
                                >
                                  {activePass && (
                                    <span style={styles.alreadyOutMiniTag}>
                                      Currently Outside
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

                      {searchQuery.trim() && matchingStudents.length === 0 && (
                        <div style={styles.noMatchBox}>
                          No student found matching &ldquo;{searchQuery}&rdquo;.
                        </div>
                      )}
                    </div>
                  ) : (
                    /* SELECTED STUDENT PROFILE CARD */
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
                          <div style={styles.studentAvatarLarge}>
                            {selectedStudent.name.charAt(0).toUpperCase()}
                          </div>
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
                          ✕ Change Student
                        </button>
                      </div>

                      {/* Duplicate Pass Warning Banner */}
                      {getActivePassForStudent(selectedStudent.adNo) && (
                        <div style={styles.duplicateWarningBox}>
                          ⚠️ <strong>Active Pass Alert:</strong> This student is
                          already marked{" "}
                          <strong>
                            {
                              getActivePassForStudent(selectedStudent.adNo)
                                .status
                            }
                          </strong>{" "}
                          (Permitted by{" "}
                          {
                            getActivePassForStudent(selectedStudent.adNo)
                              .teacherName
                          }
                          ). They must be marked returned before issuing a new
                          pass.
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* STEP 2: DESTINATION & PURPOSE */}
                <form onSubmit={handleIssuePass}>
                  <div style={{ marginBottom: 18 }}>
                    <label style={styles.fieldLabel}>
                      2. Destination (Where is the student going?)
                    </label>
                    <input
                      type="text"
                      placeholder="Enter destination (e.g. Chemmad Town, Hospital, Home)..."
                      value={destination}
                      onChange={(e) => setDestination(e.target.value)}
                      style={styles.textInput}
                      required
                    />
                    <div style={styles.chipGroup}>
                      {[
                        "Chemmad Town",
                        "Tirurangadi Hospital",
                        "Bank / ATM",
                        "Barber Shop",
                        "Medical Store",
                        "Home",
                      ].map((place) => {
                        const isSelected = destination === place;
                        return (
                          <button
                            type="button"
                            key={place}
                            onClick={() => setDestination(place)}
                            style={
                              isSelected
                                ? styles.quickChipActive
                                : styles.quickChip
                            }
                          >
                            📍 {place}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div style={{ marginBottom: 18 }}>
                    <label style={styles.fieldLabel}>
                      3. Purpose / Reason for Outing
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
                        "Medical / Consultation",
                        "Personal Purchase",
                        "Department / Official Work",
                        "Banking / ATM",
                        "Emergency Home Leave",
                      ].map((rsn) => {
                        const isSelected = purpose === rsn;
                        return (
                          <button
                            type="button"
                            key={rsn}
                            onClick={() => setPurpose(rsn)}
                            style={
                              isSelected
                                ? styles.quickChipActive
                                : styles.quickChip
                            }
                          >
                            📝 {rsn}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* STEP 3: PERMITTED TIME WINDOW */}
                  <div style={{ marginBottom: 18 }}>
                    <label style={styles.fieldLabel}>
                      4. Permitted Date &amp; Time Allowed
                    </label>
                    <div style={styles.dateRowGrid}>
                      <div>
                        <span style={styles.subFieldLabel}>
                          Departure From:
                        </span>
                        <input
                          type="datetime-local"
                          value={permittedFrom}
                          onChange={(e) => setPermittedFrom(e.target.value)}
                          style={styles.textInput}
                          required
                        />
                      </div>
                      <div>
                        <span style={styles.subFieldLabel}>
                          Must Return Before:
                        </span>
                        <input
                          type="datetime-local"
                          value={permittedTo}
                          onChange={(e) => {
                            setPermittedTo(e.target.value);
                            setActiveDurationChip("custom");
                          }}
                          style={styles.textInput}
                          required
                        />
                      </div>
                    </div>

                    {/* Quick Duration Chips */}
                    <div style={{ ...styles.chipGroup, marginTop: 10 }}>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: "#475569",
                          alignSelf: "center",
                          marginRight: 4,
                        }}
                      >
                        Quick Duration:
                      </span>
                      {[
                        { id: "1h", label: "⏱️ +1 Hour", hrs: 1 },
                        { id: "2h", label: "⏱️ +2 Hours", hrs: 2 },
                        { id: "4h", label: "⏱️ +4 Hours", hrs: 4 },
                      ].map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => applyDuration(d.hrs, d.id)}
                          style={
                            activeDurationChip === d.id
                              ? styles.quickChipActive
                              : styles.quickChip
                          }
                        >
                          {d.label}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={applyUntilEvening}
                        style={
                          activeDurationChip === "6pm"
                            ? styles.quickChipActive
                            : styles.quickChip
                        }
                      >
                        🌇 Until 6:00 PM
                      </button>
                    </div>
                  </div>

                  {/* STEP 4: LOCKED TEACHER SIGNATURE */}
                  <div style={styles.teacherSignatureBox}>
                    <div>
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#64748b",
                          textTransform: "uppercase",
                        }}
                      >
                        Permitted By Teacher (Digital Signature)
                      </div>
                      <div
                        style={{
                          fontSize: 15,
                          fontWeight: 800,
                          color: "#0f172a",
                          marginTop: 2,
                        }}
                      >
                        👨‍🏫 {staffName}
                      </div>
                    </div>
                    <span style={styles.verifiedAccountBadge}>
                      ✓ Verified Account
                    </span>
                  </div>

                  <button
                    type="submit"
                    disabled={submitting || !selectedStudent}
                    style={{
                      ...styles.primarySubmitBtn,
                      opacity: submitting || !selectedStudent ? 0.55 : 1,
                      cursor:
                        submitting || !selectedStudent
                          ? "not-allowed"
                          : "pointer",
                    }}
                  >
                    {submitting
                      ? "Issuing Digital Out-Pass..."
                      : USE_STRICT_GATEKEEPER
                      ? "✅ Issue Out-Pass & Send to Gatekeeper"
                      : "✅ Approve & Mark Student OUTSIDE Now"}
                  </button>
                </form>
              </div>
            </div>

            {/* RIGHT COLUMN: MY APPROVED STUDENTS (SCOPED TO THIS TEACHER) */}
            <div style={styles.card}>
              <div style={styles.cardHeaderRow}>
                <div>
                  <h3 style={styles.cardTitle}>
                    📋 My Permitted Students
                  </h3>
                  <p style={styles.cardSubtitle}>
                    Live status of students permitted by{" "}
                    <strong style={{ color: "#0f172a" }}>{staffName}</strong>
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

              {/* Segmented Filter Control (Crystal Clear Readability) */}
              <div style={styles.segmentedBar}>
                {[
                  {
                    id: "ALL",
                    label: "All My Passes",
                    count: myPermittedPasses.length,
                  },
                  {
                    id: "OUTSIDE",
                    label: "Currently Outside",
                    count: myOutsideCount,
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

              {/* Search within Teacher's passes */}
              <div style={{ position: "relative", marginBottom: 14 }}>
                <input
                  type="text"
                  placeholder="Filter your approved students by name, Ad.No, or place..."
                  value={teacherSearch}
                  onChange={(e) => setTeacherSearch(e.target.value)}
                  style={styles.searchInputSmall}
                />
                {teacherSearch && (
                  <button
                    type="button"
                    onClick={() => setTeacherSearch("")}
                    style={styles.searchClearIconBtn}
                  >
                    ✕ Clear
                  </button>
                )}
              </div>

              {/* List of Teacher's Approved Passes */}
              {filteredTeacherPasses.length === 0 ? (
                <div style={styles.emptyStateBox}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
                  <div
                    style={{
                      fontWeight: 700,
                      color: "#334155",
                      fontSize: 15,
                    }}
                  >
                    No Out-Passes Found
                  </div>
                  <div
                    style={{
                      color: "#64748b",
                      fontSize: 13,
                      marginTop: 4,
                    }}
                  >
                    Students you permit will appear here with their live return
                    status.
                  </div>
                </div>
              ) : (
                <div style={styles.passListScroll}>
                  {filteredTeacherPasses.map((p) => {
                    const isOverdue =
                      p.status === "OUTSIDE" && new Date(p.permittedTo) < now;
                    return (
                      <div
                        key={p.id}
                        style={{
                          ...styles.passCardItem,
                          borderLeft:
                            p.status === "OUTSIDE"
                              ? isOverdue
                                ? "5px solid #dc2626"
                                : "5px solid #f59e0b"
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
                          <div style={{ flex: 1, minWidth: 200 }}>
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
                                  fontWeight: 800,
                                  fontSize: 16,
                                  color: "#0f172a",
                                }}
                              >
                                {p.studentName}
                              </span>
                              <span style={styles.adNoBadge}>#{p.adNo}</span>
                              <span style={styles.classPill}>
                                Class {p.studentClass}
                              </span>
                            </div>

                            <div
                              style={{
                                fontSize: 13,
                                color: "#1e293b",
                                marginTop: 6,
                                fontWeight: 500,
                              }}
                            >
                              📍 <strong>{p.destination}</strong>{" "}
                              <span style={{ color: "#64748b" }}>
                                — {p.purpose}
                              </span>
                            </div>

                            <div
                              style={{
                                fontSize: 12,
                                color: "#475569",
                                marginTop: 6,
                                display: "flex",
                                gap: 12,
                                flexWrap: "wrap",
                              }}
                            >
                              <span>
                                🕒 Out:{" "}
                                <strong>
                                  {new Date(p.permittedFrom).toLocaleTimeString(
                                    "en-IN",
                                    {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    }
                                  )}
                                </strong>
                              </span>
                              <span>
                                ⏳ Due:{" "}
                                <strong>
                                  {new Date(p.permittedTo).toLocaleString(
                                    "en-IN",
                                    {
                                      day: "2-digit",
                                      month: "short",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    }
                                  )}
                                </strong>
                              </span>
                            </div>

                            {p.status === "OUTSIDE" && (
                              <div
                                style={{
                                  marginTop: 6,
                                  fontSize: 12,
                                  fontWeight: 700,
                                  color: isOverdue ? "#dc2626" : "#d97706",
                                }}
                              >
                                ⏱️ {getRemainingTimeText(p.permittedTo)}
                              </div>
                            )}

                            {p.actualReturnTime && (
                              <div
                                style={{
                                  fontSize: 12,
                                  color: "#059669",
                                  marginTop: 6,
                                  fontWeight: 700,
                                }}
                              >
                                ✓ Returned at:{" "}
                                {new Date(p.actualReturnTime).toLocaleString(
                                  "en-IN",
                                  {
                                    day: "2-digit",
                                    month: "short",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  }
                                )}
                              </div>
                            )}
                          </div>

                          {/* Right Actions Column */}
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "flex-end",
                              gap: 8,
                            }}
                          >
                            <span
                              style={getStatusBadgeStyle(
                                p.status,
                                p.permittedTo,
                                now
                              )}
                            >
                              {p.status === "OUTSIDE" && isOverdue
                                ? "🚨 OVERDUE / LATE"
                                : p.status === "OUTSIDE"
                                ? "🟠 OUTSIDE CAMPUS"
                                : p.status === "RETURNED"
                                ? "🟢 RETURNED"
                                : p.status}
                            </span>

                            {p.status === "OUTSIDE" && (
                              <button
                                type="button"
                                onClick={() => handleConfirmReturn(p)}
                                style={styles.markReturnedBtn}
                              >
                                ✓ Mark Returned
                              </button>
                            )}

                            {(p.status === "APPROVED" ||
                              p.status === "OUTSIDE") && (
                              <button
                                type="button"
                                onClick={() => handleCancelPass(p)}
                                style={styles.cancelPassBtn}
                              >
                                Cancel Pass
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
            TAB 3: ADMIN LIVE PORTAL (STRICTLY FOR ADMIN ONLY)
           ========================================================= */}
        {activeTab === "admin" && isAdmin && (
          <div>
            {/* 4 Interactive KPI Summary Cards */}
            <div style={styles.kpiGrid}>
              <div
                onClick={() => setAdminViewMode("OUTSIDE")}
                style={{
                  ...styles.kpiCard,
                  borderTop: "4px solid #f59e0b",
                  outline:
                    adminViewMode === "OUTSIDE" ? "2px solid #f59e0b" : "none",
                }}
              >
                <div style={styles.kpiTopRow}>
                  <span style={styles.kpiLabel}>CURRENTLY OUTSIDE</span>
                  <span style={styles.kpiIconBox("#fef3c7", "#d97706")}>
                    🟠
                  </span>
                </div>
                <div style={{ ...styles.kpiNumber, color: "#d97706" }}>
                  {currentlyOutsidePasses.length}
                </div>
                <div style={styles.kpiFooter}>
                  Active students off-campus right now
                </div>
              </div>

              <div
                onClick={() => setAdminViewMode("OUTSIDE")}
                style={{
                  ...styles.kpiCard,
                  borderTop: "4px solid #dc2626",
                }}
              >
                <div style={styles.kpiTopRow}>
                  <span style={styles.kpiLabel}>OVERDUE / LATE</span>
                  <span style={styles.kpiIconBox("#fee2e2", "#dc2626")}>
                    🚨
                  </span>
                </div>
                <div style={{ ...styles.kpiNumber, color: "#dc2626" }}>
                  {overduePasses.length}
                </div>
                <div style={styles.kpiFooter}>
                  Exceeded permitted return time
                </div>
              </div>

              <div
                onClick={() => setAdminViewMode("INSIDE")}
                style={{
                  ...styles.kpiCard,
                  borderTop: "4px solid #10b981",
                  outline:
                    adminViewMode === "INSIDE" ? "2px solid #10b981" : "none",
                }}
              >
                <div style={styles.kpiTopRow}>
                  <span style={styles.kpiLabel}>INSIDE CAMPUS</span>
                  <span style={styles.kpiIconBox("#d1fae5", "#059669")}>
                    🟢
                  </span>
                </div>
                <div style={{ ...styles.kpiNumber, color: "#059669" }}>
                  {insideStudents.length}
                </div>
                <div style={styles.kpiFooter}>
                  Students currently present inside
                </div>
              </div>

              <div
                onClick={() => setAdminViewMode("HISTORY")}
                style={{
                  ...styles.kpiCard,
                  borderTop: "4px solid #0284c7",
                  outline:
                    adminViewMode === "HISTORY" ? "2px solid #0284c7" : "none",
                }}
              >
                <div style={styles.kpiTopRow}>
                  <span style={styles.kpiLabel}>TOTAL MOVEMENTS</span>
                  <span style={styles.kpiIconBox("#e0f2fe", "#0284c7")}>
                    📜
                  </span>
                </div>
                <div style={{ ...styles.kpiNumber, color: "#0284c7" }}>
                  {passes.length}
                </div>
                <div style={styles.kpiFooter}>
                  Complete historical out-pass log
                </div>
              </div>
            </div>

            {/* Admin Control & Filter Bar */}
            <div style={styles.adminToolbarCard}>
              {/* Left: View Switcher Segmented Buttons */}
              <div style={styles.segmentedBarAdmin}>
                {[
                  {
                    id: "OUTSIDE",
                    label: "🟠 Currently Outside",
                    count: currentlyOutsidePasses.length,
                  },
                  {
                    id: "INSIDE",
                    label: "🟢 Inside Students",
                    count: insideStudents.length,
                  },
                  {
                    id: "HISTORY",
                    label: "📜 All Pass History",
                    count: passes.length,
                  },
                ].map((tab) => {
                  const active = adminViewMode === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setAdminViewMode(tab.id)}
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

              {/* Right: Search, Class Filter, Teacher Filter, CSV Export */}
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <div style={{ position: "relative", minWidth: 220 }}>
                  <input
                    type="text"
                    placeholder="Search student, Ad.No, reason..."
                    value={adminSearch}
                    onChange={(e) => setAdminSearch(e.target.value)}
                    style={styles.filterInput}
                  />
                  {adminSearch && (
                    <button
                      type="button"
                      onClick={() => setAdminSearch("")}
                      style={styles.searchClearIconBtn}
                    >
                      ✕
                    </button>
                  )}
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

                {adminViewMode !== "INSIDE" && (
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
                )}

                <button
                  type="button"
                  onClick={handleExportCSV}
                  style={styles.exportCsvBtn}
                >
                  ⬇️ Export CSV
                </button>
              </div>
            </div>

            {/* Admin Data Table */}
            <div style={styles.tableContainer}>
              {adminViewMode === "INSIDE" ? (
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Ad.No</th>
                      <th style={styles.th}>Student Name</th>
                      <th style={styles.th}>Class</th>
                      <th style={styles.th}>Campus Status</th>
                      <th style={styles.th}>Outings This Month</th>
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
                      .slice(0, 100)
                      .map((s) => (
                        <tr key={s.id} style={styles.tr}>
                          <td style={styles.td}>
                            <span style={styles.adNoBadge}>#{s.adNo}</span>
                          </td>
                          <td
                            style={{
                              ...styles.td,
                              fontWeight: 700,
                              color: "#0f172a",
                            }}
                          >
                            {s.name}
                          </td>
                          <td style={styles.td}>
                            <span style={styles.classPill}>
                              Class {s.studentClass}
                            </span>
                          </td>
                          <td style={styles.td}>
                            <span style={styles.insideStatusBadge}>
                              🟢 Inside Campus
                            </span>
                          </td>
                          <td
                            style={{
                              ...styles.td,
                              fontWeight: 700,
                              color: "#334155",
                            }}
                          >
                            {getMonthlyOutCount(s.adNo)} outings
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              ) : (
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Student Details</th>
                      <th style={styles.th}>Destination &amp; Reason</th>
                      <th style={styles.th}>Permitted Teacher</th>
                      <th style={styles.th}>Permitted Time Window</th>
                      <th style={styles.th}>Actual Out / Return</th>
                      <th style={styles.th}>Live Status &amp; Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {passes
                      .filter((p) => {
                        if (
                          adminViewMode === "OUTSIDE" &&
                          p.status !== "OUTSIDE"
                        )
                          return false;
                        if (
                          classFilter !== "ALL" &&
                          p.studentClass !== classFilter
                        )
                          return false;
                        if (
                          teacherFilter !== "ALL" &&
                          p.teacherName !== teacherFilter
                        )
                          return false;
                        if (adminSearch.trim()) {
                          const q = adminSearch.toLowerCase();
                          return (
                            p.studentName?.toLowerCase().includes(q) ||
                            String(p.adNo).toLowerCase().includes(q) ||
                            p.destination?.toLowerCase().includes(q) ||
                            p.purpose?.toLowerCase().includes(q)
                          );
                        }
                        return true;
                      })
                      .slice(0, 100)
                      .map((p) => {
                        const isOverdue =
                          p.status === "OUTSIDE" &&
                          new Date(p.permittedTo) < now;
                        return (
                          <tr key={p.id} style={styles.tr}>
                            <td style={styles.td}>
                              <div
                                style={{
                                  fontWeight: 800,
                                  color: "#0f172a",
                                  fontSize: 15,
                                }}
                              >
                                {p.studentName}
                              </div>
                              <div
                                style={{
                                  display: "flex",
                                  gap: 6,
                                  marginTop: 4,
                                  alignItems: "center",
                                }}
                              >
                                <span style={styles.adNoBadge}>#{p.adNo}</span>
                                <span style={styles.classPill}>
                                  Class {p.studentClass}
                                </span>
                              </div>
                            </td>

                            <td style={styles.td}>
                              <div
                                style={{
                                  fontWeight: 700,
                                  color: "#0f172a",
                                }}
                              >
                                📍 {p.destination}
                              </div>
                              <div
                                style={{
                                  fontSize: 13,
                                  color: "#475569",
                                  marginTop: 2,
                                }}
                              >
                                {p.purpose}
                              </div>
                            </td>

                            <td style={styles.td}>
                              <div
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 6,
                                  background: "#f1f5f9",
                                  padding: "5px 10px",
                                  borderRadius: 8,
                                  fontWeight: 700,
                                  color: "#1e293b",
                                  fontSize: 13,
                                }}
                              >
                                👨‍🏫 {p.teacherName}
                              </div>
                            </td>

                            <td style={styles.td}>
                              <div style={{ fontSize: 12, color: "#475569" }}>
                                From:{" "}
                                <strong style={{ color: "#0f172a" }}>
                                  {new Date(p.permittedFrom).toLocaleString(
                                    "en-IN",
                                    {
                                      dateStyle: "short",
                                      timeStyle: "short",
                                    }
                                  )}
                                </strong>
                              </div>
                              <div
                                style={{
                                  fontSize: 12,
                                  color: "#475569",
                                  marginTop: 3,
                                }}
                              >
                                Due:{" "}
                                <strong style={{ color: "#0f172a" }}>
                                  {new Date(p.permittedTo).toLocaleString(
                                    "en-IN",
                                    {
                                      dateStyle: "short",
                                      timeStyle: "short",
                                    }
                                  )}
                                </strong>
                              </div>
                              {p.status === "OUTSIDE" && (
                                <div
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 700,
                                    color: isOverdue ? "#dc2626" : "#d97706",
                                    marginTop: 4,
                                  }}
                                >
                                  ⏱️ {getRemainingTimeText(p.permittedTo)}
                                </div>
                              )}
                            </td>

                            <td style={styles.td}>
                              <div style={{ fontSize: 12, color: "#334155" }}>
                                Out:{" "}
                                <strong>
                                  {p.actualDepartureTime
                                    ? new Date(
                                        p.actualDepartureTime
                                      ).toLocaleTimeString("en-IN", {
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      })
                                    : "—"}
                                </strong>
                              </div>
                              <div
                                style={{
                                  fontSize: 12,
                                  color: p.actualReturnTime
                                    ? "#059669"
                                    : "#d97706",
                                  fontWeight: 600,
                                  marginTop: 3,
                                }}
                              >
                                In:{" "}
                                {p.actualReturnTime
                                  ? new Date(
                                      p.actualReturnTime
                                    ).toLocaleTimeString("en-IN", {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })
                                  : "Still Outside"}
                              </div>
                            </td>

                            <td style={styles.td}>
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                  flexWrap: "wrap",
                                }}
                              >
                                <span
                                  style={getStatusBadgeStyle(
                                    p.status,
                                    p.permittedTo,
                                    now
                                  )}
                                >
                                  {p.status === "OUTSIDE" && isOverdue
                                    ? "🚨 OVERDUE"
                                    : p.status === "OUTSIDE"
                                    ? "🟠 OUTSIDE"
                                    : p.status === "RETURNED"
                                    ? "🟢 RETURNED"
                                    : p.status}
                                </span>

                                {p.status === "OUTSIDE" && (
                                  <button
                                    type="button"
                                    onClick={() => handleConfirmReturn(p)}
                                    style={styles.markReturnedBtnSmall}
                                  >
                                    ✓ Mark Returned
                                  </button>
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
      </div>
    </div>
  );
}

// High-Contrast Status Pill Helper
function getStatusBadgeStyle(status, permittedTo, now) {
  const isOverdue = status === "OUTSIDE" && new Date(permittedTo) < now;
  if (isOverdue) {
    return {
      background: "#fef2f2",
      color: "#b91c1c",
      border: "1px solid #fecaca",
      padding: "5px 10px",
      borderRadius: "999px",
      fontSize: "11px",
      fontWeight: 800,
      letterSpacing: "0.3px",
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
      letterSpacing: "0.3px",
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
      letterSpacing: "0.3px",
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

// ============================================================================
// 🎨 HIGH-CONTRAST PROFESSIONAL DESIGN SYSTEM
// Every button, badge, and input explicitly defines both `background` and `color`
// ============================================================================
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
  logoCircle: {
    width: "48px",
    height: "48px",
    borderRadius: "12px",
    background: "rgba(255, 255, 255, 0.15)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "24px",
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
  slipDatePill: {
    background: "rgba(255,255,255,0.16)",
    color: "#ffffff",
    padding: "6px 12px",
    borderRadius: "8px",
    fontSize: "12px",
    fontWeight: 700,
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
    marginBottom: "4px",
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
  studentAvatarMini: {
    width: "34px",
    height: "34px",
    borderRadius: "8px",
    background: "#ccfbf1",
    color: "#0f766e",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 800,
    fontSize: "15px",
  },
  studentAvatarLarge: {
    width: "48px",
    height: "48px",
    borderRadius: "12px",
    background: "#0f766e",
    color: "#ffffff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 800,
    fontSize: "20px",
  },
  noMatchBox: {
    marginTop: "6px",
    padding: "12px",
    background: "#fff1f2",
    border: "1px solid #fecdd3",
    color: "#be123c",
    borderRadius: "10px",
    fontSize: "13px",
    fontWeight: 600,
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
    lineHeight: 1.5,
  },
  textInput: {
    width: "100%",
    padding: "11px 14px",
    borderRadius: "10px",
    border: "1.5px solid #cbd5e1",
    fontSize: "14px",
    color: "#0f172a",
    background: "#ffffff",
  },
  chipGroup: {
    display: "flex",
    gap: "6px",
    flexWrap: "wrap",
    marginTop: "8px",
  },
  quickChip: {
    background: "#f8fafc",
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
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
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
  segmentedBarAdmin: {
    display: "flex",
    gap: "6px",
    background: "#f1f5f9",
    padding: "5px",
    borderRadius: "12px",
    border: "1px solid #e2e8f0",
    flexWrap: "wrap",
  },
  segmentBtnActive: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    padding: "9px 14px",
    borderRadius: "8px",
    border: "none",
    background: "#0f766e",
    color: "#ffffff",
    fontSize: "13px",
    fontWeight: 800,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  segmentBtnInactive: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    padding: "9px 14px",
    borderRadius: "8px",
    border: "none",
    background: "transparent",
    color: "#334155",
    fontSize: "13px",
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
    maxHeight: "620px",
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
  markReturnedBtn: {
    background: "#059669",
    color: "#ffffff",
    border: "none",
    borderRadius: "8px",
    padding: "8px 14px",
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
    fontSize: "12px",
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
    fontSize: "34px",
    fontWeight: 900,
    margin: "6px 0 4px",
  },
  kpiFooter: {
    fontSize: "12px",
    color: "#64748b",
    fontWeight: 500,
  },
  adminToolbarCard: {
    background: "#ffffff",
    padding: "14px 18px",
    borderRadius: "14px",
    border: "1px solid #cbd5e1",
    marginBottom: "16px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "14px",
  },
  filterInput: {
    width: "100%",
    padding: "9px 36px 9px 12px",
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