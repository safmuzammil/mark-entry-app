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
  const [submitting, setSubmitting] = useState(false);
  const [teacherStatusFilter, setTeacherStatusFilter] = useState("ALL"); // "ALL" | "OUTSIDE" | "RETURNED"

  // Barcode Scanner State
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerMode, setScannerMode] = useState("teacher"); // "teacher" | "return" | "gate"
  const [gateScanResult, setGateScanResult] = useState(null);
  const scannerRef = useRef(null);

  // Admin Filter State
  const [adminViewMode, setAdminViewMode] = useState("OUTSIDE"); // "OUTSIDE" | "APPROVED" | "INSIDE" | "HISTORY"
  const [classFilter, setClassFilter] = useState("ALL");
  const [teacherFilter, setTeacherFilter] = useState("ALL");
  const [adminSearch, setAdminSearch] = useState("");
  const [now, setNow] = useState(new Date());

  // Live clock for overdue calculation every 30 seconds
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
  };

  useEffect(() => {
    resetDefaultTimes();
  }, []);

  // 1. Check Auth, Verify Admin vs Teacher Role, & Load Data
  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      // Check if logged in via main app's Admin session (`isAdminAuth` in localStorage)
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

        // Try to match teacher's real name from `teachers` collection in Firestore
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
          // Ignore if teachers collection is structured differently
        }

        setStaffName(userHasAdminAccess && !user ? "Administrator" : resolvedName);
      } else if (localAdminFlag) {
        // Admin logged in via custom admin/admin123 login without Firebase user
        setCurrentUser({ uid: "admin", email: "admin" });
        setStaffName("Administrator");
        setActiveTab("admin"); // Default Admin straight to the Admin dashboard
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
              ? data.classes[0] || "N/A"
              : data.class || data.department || "N/A",
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

  // Security guard: Prevent non-admins from ever switching to the "admin" tab
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
      // Quick Scan to Return Student (Teachers can only return their own passes; Admins can return any)
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

  // Helper: Check if student already has an active pass (APPROVED or OUTSIDE) across the school
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

  // Quick Duration Setter for Teacher
  const applyDuration = (hours) => {
    const start = permittedFrom ? new Date(permittedFrom) : new Date();
    const end = new Date(start.getTime() + hours * 60 * 60 * 1000);
    setPermittedTo(formatDateTimeLocal(end));
  };

  const applyUntilEvening = () => {
    const end = new Date();
    end.setHours(18, 0, 0, 0); // 6:00 PM
    setPermittedTo(formatDateTimeLocal(end));
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

      alert(
        USE_STRICT_GATEKEEPER
          ? `Out-Pass Approved for ${selectedStudent.name}! Waiting for Gatekeeper verification.`
          : `✅ Out-Pass Issued! ${selectedStudent.name} is now marked as OUTSIDE.`
      );
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

  // ============================================================================
  // STRICT DATA SEPARATION:
  // 1. `myPermittedPasses`: ONLY passes approved by the currently logged-in Teacher
  // 2. Global counts: Used strictly inside the Admin Portal
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

  const filteredTeacherPasses = myPermittedPasses.filter((p) => {
    if (teacherStatusFilter === "OUTSIDE") return p.status === "OUTSIDE";
    if (teacherStatusFilter === "RETURNED") return p.status === "RETURNED";
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
      <div style={styles.pageWrapper}>
        <div
          style={{
            ...styles.card,
            maxWidth: 460,
            margin: "80px auto",
            textAlign: "center",
          }}
        >
          <h2>🔒 Login Required</h2>
          <p style={{ color: "#64748b", fontSize: 14 }}>
            Please log in with your Teacher or Admin account on the main portal
            to access the Students&apos; Out-Pass system.
          </p>
          <Link
            href="/"
            style={{
              ...styles.submitBtn,
              display: "inline-block",
              textDecoration: "none",
              marginTop: 12,
            }}
          >
            ← Go to Login Page
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.pageWrapper}>
      {/* Top Header */}
      <header style={styles.header}>
        <div>
          <div style={styles.uniBadge}>DARUL HUDA ISLAMIC UNIVERSITY</div>
          <h1 style={styles.title}>Digital Students&apos; Out-Pass (SMS)</h1>
        </div>
        <div style={styles.headerRight}>
          <div style={styles.staffBadge}>
            {isAdmin ? "🛡️ Admin:" : "👨‍🏫 Teacher:"}{" "}
            <strong>{staffName || "Staff"}</strong>
          </div>
          <Link href="/" style={styles.backLink}>
            ← Back to Main Portal
          </Link>
        </div>
      </header>

      {/* Role Switcher Navigation (Admin Tab is STRICTLY hidden for non-admins) */}
      <div style={styles.tabBar}>
        <button
          onClick={() => setActiveTab("teacher")}
          style={{
            ...styles.tabBtn,
            ...(activeTab === "teacher" ? styles.tabBtnActive : {}),
          }}
        >
          👨‍🏫 Teacher Pass Portal (My Active Outside: {myOutsideCount})
        </button>

        {USE_STRICT_GATEKEEPER && (
          <button
            onClick={() => setActiveTab("gatekeeper")}
            style={{
              ...styles.tabBtn,
              ...(activeTab === "gatekeeper" ? styles.tabBtnActive : {}),
            }}
          >
            🛂 Gatekeeper Verification
          </button>
        )}

        {/* STRICT ADMIN CHECK: Only rendered if logged-in user is Admin */}
        {isAdmin && (
          <button
            onClick={() => setActiveTab("admin")}
            style={{
              ...styles.tabBtn,
              ...(activeTab === "admin" ? styles.tabBtnActive : {}),
            }}
          >
            📊 Admin Live Portal (Outside: {currentlyOutsidePasses.length} |
            Inside: {insideStudents.length})
          </button>
        )}
      </div>

      {/* Camera Barcode Modal */}
      {scannerOpen && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCard}>
            <h3 style={{ marginTop: 0, marginBottom: 8 }}>
              {scannerMode === "return"
                ? "📷 Scan Returning Student ID"
                : "📷 Scan Student ID Barcode"}
            </h3>
            <p style={{ fontSize: 13, color: "#64748b", marginTop: 0 }}>
              Hold the Student ID card barcode steady in front of the camera.
            </p>
            <div
              id="barcode-reader-region"
              style={{
                width: "100%",
                minHeight: "240px",
                background: "#000",
                borderRadius: "8px",
                overflow: "hidden",
              }}
            />
            <button
              onClick={() => setScannerOpen(false)}
              style={styles.closeModalBtn}
            >
              Close Camera
            </button>
          </div>
        </div>
      )}

      {/* =========================================================
          TAB 1: TEACHER PORTAL
          - Issue Leave Pass
          - View ONLY students approved by THIS logged-in teacher
         ========================================================= */}
      {activeTab === "teacher" && (
        <div style={styles.gridTwoCol}>
          {/* Left: Issue Pass Digital Slip */}
          <div style={styles.slipCard}>
            <div style={styles.slipHeader}>
              <h2 style={{ margin: 0, fontSize: 18 }}>
                STUDENTS&apos; OUT PASS PERMISSION SLIP
              </h2>
              <span style={{ fontSize: 12, opacity: 0.9 }}>
                Date: {new Date().toLocaleDateString("en-IN")}
              </span>
            </div>

            {/* Step 1: Scan or Search Student */}
            <div style={{ marginBottom: 16 }}>
              <label style={styles.label}>
                1. Find Student (Scan Barcode or Search Ad.No / Name)
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="text"
                  placeholder="Type Ad.No or Student Name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={styles.input}
                />
                <button
                  type="button"
                  onClick={() => {
                    setScannerMode("teacher");
                    setScannerOpen(true);
                  }}
                  style={styles.scanBtn}
                >
                  📷 Scan ID
                </button>
              </div>

              {/* Search Dropdown Results */}
              {matchingStudents.length > 0 && (
                <div style={styles.dropdownList}>
                  {matchingStudents.map((st) => (
                    <div
                      key={st.id}
                      onClick={() => {
                        setSelectedStudent(st);
                        setSearchQuery("");
                      }}
                      style={styles.dropdownItem}
                    >
                      <strong>#{st.adNo}</strong> — {st.name}{" "}
                      <span style={styles.classBadge}>{st.studentClass}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Selected Student Banner */}
            {selectedStudent && (
              <div style={styles.selectedStudentBox}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "#0f766e",
                        fontWeight: 700,
                      }}
                    >
                      SELECTED STUDENT
                    </div>
                    <div
                      style={{
                        fontSize: 18,
                        fontWeight: 700,
                        color: "#0f172a",
                      }}
                    >
                      {selectedStudent.name}
                    </div>
                    <div style={{ fontSize: 13, color: "#334155" }}>
                      Ad.No: <strong>{selectedStudent.adNo}</strong> | Class:{" "}
                      <strong>{selectedStudent.studentClass}</strong>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={styles.outingCountBadge}>
                      Outings this month:{" "}
                      {getMonthlyOutCount(selectedStudent.adNo)}
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedStudent(null)}
                      style={styles.clearBtn}
                    >
                      Change Student
                    </button>
                  </div>
                </div>

                {/* Duplicate Active Pass Warning */}
                {getActivePassForStudent(selectedStudent.adNo) && (
                  <div style={styles.warningAlert}>
                    ⚠️ <strong>Warning:</strong> This student is already marked
                    as{" "}
                    <strong>
                      {getActivePassForStudent(selectedStudent.adNo).status}
                    </strong>{" "}
                    (Permitted by{" "}
                    {getActivePassForStudent(selectedStudent.adNo).teacherName}
                    ). They must return before a new pass can be issued.
                  </div>
                )}
              </div>
            )}

            {/* Step 2: Out Pass Form */}
            <form onSubmit={handleIssuePass}>
              <div style={{ marginBottom: 14 }}>
                <label style={styles.label}>Destination</label>
                <input
                  type="text"
                  placeholder="e.g. Chemmad Town, Hospital, Bank, Home..."
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  style={styles.input}
                  required
                />
                <div style={styles.chipRow}>
                  {[
                    "Chemmad Town",
                    "Tirurangadi Hospital",
                    "Bank / ATM",
                    "Barber Shop",
                    "Home",
                  ].map((place) => (
                    <button
                      type="button"
                      key={place}
                      onClick={() => setDestination(place)}
                      style={styles.quickChip}
                    >
                      {place}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={styles.label}>Purpose / Reason</label>
                <input
                  type="text"
                  placeholder="Enter reason for going outside..."
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  style={styles.input}
                  required
                />
                <div style={styles.chipRow}>
                  {[
                    "Medical / Clinic",
                    "Personal Purchase",
                    "Official / Dept Work",
                    "Emergency Home Leave",
                  ].map((rsn) => (
                    <button
                      type="button"
                      key={rsn}
                      onClick={() => setPurpose(rsn)}
                      style={styles.quickChip}
                    >
                      {rsn}
                    </button>
                  ))}
                </div>
              </div>

              <div style={styles.twoInputRow}>
                <div style={{ flex: 1 }}>
                  <label style={styles.label}>
                    Permitted From (Date & Time)
                  </label>
                  <input
                    type="datetime-local"
                    value={permittedFrom}
                    onChange={(e) => setPermittedFrom(e.target.value)}
                    style={styles.input}
                    required
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={styles.label}>
                    Permitted To (Return Deadline)
                  </label>
                  <input
                    type="datetime-local"
                    value={permittedTo}
                    onChange={(e) => setPermittedTo(e.target.value)}
                    style={styles.input}
                    required
                  />
                </div>
              </div>

              {/* Quick Duration Buttons */}
              <div style={{ ...styles.chipRow, marginBottom: 16 }}>
                <span
                  style={{
                    fontSize: 12,
                    color: "#64748b",
                    alignSelf: "center",
                  }}
                >
                  Quick Duration:
                </span>
                <button
                  type="button"
                  onClick={() => applyDuration(1)}
                  style={styles.quickChip}
                >
                  +1 Hour
                </button>
                <button
                  type="button"
                  onClick={() => applyDuration(2)}
                  style={styles.quickChip}
                >
                  +2 Hours
                </button>
                <button
                  type="button"
                  onClick={() => applyDuration(4)}
                  style={styles.quickChip}
                >
                  +4 Hours
                </button>
                <button
                  type="button"
                  onClick={applyUntilEvening}
                  style={styles.quickChip}
                >
                  Until 6:00 PM
                </button>
              </div>

              {/* Strictly Locked Teacher Name */}
              <div style={{ marginBottom: 18 }}>
                <label style={styles.label}>
                  Permitted Teacher (Locked to Logged-in Account)
                </label>
                <input
                  type="text"
                  value={staffName}
                  readOnly
                  style={{
                    ...styles.input,
                    background: "#e2e8f0",
                    color: "#0f172a",
                    fontWeight: 700,
                    cursor: "not-allowed",
                  }}
                />
              </div>

              <button
                type="submit"
                disabled={submitting || !selectedStudent}
                style={{
                  ...styles.submitBtn,
                  opacity: submitting || !selectedStudent ? 0.6 : 1,
                }}
              >
                {submitting
                  ? "Issuing Digital Pass..."
                  : USE_STRICT_GATEKEEPER
                  ? "✅ Approve & Send to Gatekeeper"
                  : "✅ Approve & Mark Student OUTSIDE"}
              </button>
            </form>
          </div>

          {/* Right: ONLY Students Approved by This Logged-in Teacher */}
          <div style={styles.card}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 8,
                marginBottom: 12,
              }}
            >
              <div>
                <h3 style={{ margin: 0 }}>
                  📋 My Approved Students ({myPermittedPasses.length})
                </h3>
                <p style={{ fontSize: 12, color: "#64748b", margin: "2px 0 0" }}>
                  Showing only students permitted by{" "}
                  <strong>{staffName}</strong>.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setScannerMode("return");
                  setScannerOpen(true);
                }}
                style={styles.returnActionBtn}
              >
                📷 Scan ID to Return
              </button>
            </div>

            {/* Filter pills for Teacher's own list */}
            <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
              {[
                { id: "ALL", label: `All My Passes (${myPermittedPasses.length})` },
                { id: "OUTSIDE", label: `Currently Outside (${myOutsideCount})` },
                {
                  id: "RETURNED",
                  label: `Returned (${
                    myPermittedPasses.filter((p) => p.status === "RETURNED")
                      .length
                  })`,
                },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setTeacherStatusFilter(f.id)}
                  style={{
                    ...styles.subTabBtn,
                    padding: "6px 10px",
                    fontSize: "12px",
                    ...(teacherStatusFilter === f.id
                      ? styles.subTabBtnActive
                      : {}),
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {filteredTeacherPasses.length === 0 ? (
              <div
                style={{
                  padding: "30px 16px",
                  textAlign: "center",
                  color: "#64748b",
                  fontSize: 14,
                  background: "#f8fafc",
                  borderRadius: 8,
                }}
              >
                No student passes found under your account for this filter.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {filteredTeacherPasses.map((p) => {
                  const isOverdue =
                    p.status === "OUTSIDE" && new Date(p.permittedTo) < now;
                  return (
                    <div
                      key={p.id}
                      style={{
                        ...styles.passRowItem,
                        borderLeft:
                          p.status === "OUTSIDE"
                            ? isOverdue
                              ? "4px solid #dc2626"
                              : "4px solid #ea580c"
                            : "4px solid #16a34a",
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>
                          {p.studentName}{" "}
                          <span style={{ fontWeight: 400, color: "#64748b" }}>
                            (#{p.adNo} • Class {p.studentClass})
                          </span>
                        </div>
                        <div
                          style={{
                            fontSize: 13,
                            color: "#334155",
                            marginTop: 2,
                          }}
                        >
                          📍 <strong>{p.destination}</strong> — Reason:{" "}
                          {p.purpose}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: "#64748b",
                            marginTop: 4,
                          }}
                        >
                          Permitted:{" "}
                          {new Date(p.permittedFrom).toLocaleTimeString(
                            "en-IN",
                            {
                              hour: "2-digit",
                              minute: "2-digit",
                            }
                          )}{" "}
                          →{" "}
                          <strong>
                            {new Date(p.permittedTo).toLocaleString("en-IN", {
                              dateStyle: "short",
                              timeStyle: "short",
                            })}
                          </strong>
                        </div>
                        {p.actualReturnTime && (
                          <div
                            style={{
                              fontSize: 12,
                              color: "#15803d",
                              marginTop: 2,
                              fontWeight: 600,
                            }}
                          >
                            ✓ Returned at:{" "}
                            {new Date(p.actualReturnTime).toLocaleString(
                              "en-IN",
                              {
                                dateStyle: "short",
                                timeStyle: "short",
                              }
                            )}
                          </div>
                        )}
                      </div>

                      <div
                        style={{
                          textAlign: "right",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-end",
                          gap: 6,
                        }}
                      >
                        <span
                          style={getStatusBadgeStyle(
                            p.status,
                            p.permittedTo,
                            now
                          )}
                        >
                          {p.status === "APPROVED"
                            ? "WAITING AT GATE"
                            : isOverdue
                            ? "LATE / OVERDUE"
                            : p.status}
                        </span>

                        {p.status === "OUTSIDE" && (
                          <button
                            onClick={() => handleConfirmReturn(p)}
                            style={{
                              ...styles.returnActionBtn,
                              padding: "6px 10px",
                              fontSize: "12px",
                            }}
                          >
                            ✓ Mark Returned
                          </button>
                        )}

                        {(p.status === "APPROVED" ||
                          p.status === "OUTSIDE") && (
                          <button
                            onClick={() => handleCancelPass(p)}
                            style={styles.cancelLinkBtn}
                          >
                            Cancel Pass
                          </button>
                        )}
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
          TAB 2: STRICT GATEKEEPER PORTAL
         ========================================================= */}
      {activeTab === "gatekeeper" && USE_STRICT_GATEKEEPER && (
        <div>
          <div style={styles.gateScannerHero}>
            <div>
              <h2 style={{ margin: 0, fontSize: 20 }}>
                🛂 Strict Gatekeeper Verification Desk
              </h2>
              <p style={{ margin: "4px 0 0", fontSize: 13, opacity: 0.9 }}>
                Scan Student ID Barcode at the Gate to verify teacher approval
                and log exact Departure & Return times.
              </p>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input
                type="text"
                placeholder="Enter Ad.No + Press Enter"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.target.value.trim()) {
                    handleGateLookupByAdNo(e.target.value.trim());
                    e.target.value = "";
                  }
                }}
                style={{ ...styles.input, width: 210, background: "#fff" }}
              />
              <button
                onClick={() => {
                  setScannerMode("gate");
                  setScannerOpen(true);
                }}
                style={styles.gateBigScanBtn}
              >
                📷 Scan ID at Gate
              </button>
            </div>
          </div>

          {gateScanResult && (
            <div style={styles.gateVerifyModal}>
              <div>
                <div
                  style={{ fontSize: 12, fontWeight: 700, color: "#0369a1" }}
                >
                  VERIFIED PASS FOUND
                </div>
                <h3 style={{ margin: "4px 0", fontSize: 22 }}>
                  {gateScanResult.studentName} (#{gateScanResult.adNo} •{" "}
                  {gateScanResult.studentClass})
                </h3>
                <p style={{ margin: 0, fontSize: 14 }}>
                  📍 <strong>{gateScanResult.destination}</strong> (
                  {gateScanResult.purpose}) | Permitted by:{" "}
                  <strong>{gateScanResult.teacherName}</strong>
                </p>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                {gateScanResult.status === "APPROVED" && (
                  <button
                    onClick={() => handleConfirmDeparture(gateScanResult)}
                    style={styles.departActionBtn}
                  >
                    🚶‍♂️ Verify & Mark GOING OUT Now
                  </button>
                )}
                {gateScanResult.status === "OUTSIDE" && (
                  <button
                    onClick={() => handleConfirmReturn(gateScanResult)}
                    style={styles.returnActionBtn}
                  >
                    ✅ Verify & Mark RETURNED Now
                  </button>
                )}
                <button
                  onClick={() => setGateScanResult(null)}
                  style={styles.clearBtn}
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* =========================================================
          TAB 3: ADMIN PORTAL (STRICTLY FOR ADMIN ONLY)
         ========================================================= */}
      {activeTab === "admin" && isAdmin && (
        <div>
          {/* Summary KPI Cards */}
          <div style={styles.kpiGrid}>
            <div
              onClick={() => setAdminViewMode("INSIDE")}
              style={{
                ...styles.kpiCard,
                borderBottom: "4px solid #16a34a",
                cursor: "pointer",
              }}
            >
              <div style={styles.kpiLabel}>🟢 INSIDE CAMPUS</div>
              <div style={styles.kpiValue}>{insideStudents.length}</div>
              <div style={styles.kpiSub}>Click to view all inside students</div>
            </div>

            <div
              onClick={() => setAdminViewMode("OUTSIDE")}
              style={{
                ...styles.kpiCard,
                borderBottom: "4px solid #ea580c",
                cursor: "pointer",
              }}
            >
              <div style={styles.kpiLabel}>🟠 CURRENTLY OUTSIDE</div>
              <div style={styles.kpiValue}>{currentlyOutsidePasses.length}</div>
              <div style={styles.kpiSub}>Click to view outside students</div>
            </div>

            <div
              onClick={() => setAdminViewMode("OUTSIDE")}
              style={{
                ...styles.kpiCard,
                borderBottom: "4px solid #dc2626",
                cursor: "pointer",
              }}
            >
              <div style={styles.kpiLabel}>🔴 OVERDUE / LATE</div>
              <div style={{ ...styles.kpiValue, color: "#dc2626" }}>
                {overduePasses.length}
              </div>
              <div style={styles.kpiSub}>Exceeded permitted time</div>
            </div>

            <div
              onClick={() => setAdminViewMode("HISTORY")}
              style={{
                ...styles.kpiCard,
                borderBottom: "4px solid #0284c7",
                cursor: "pointer",
              }}
            >
              <div style={styles.kpiLabel}>📜 TOTAL PASSES LOGGED</div>
              <div style={styles.kpiValue}>{passes.length}</div>
              <div style={styles.kpiSub}>Click to view complete history</div>
            </div>
          </div>

          {/* Filter & View Switcher Bar */}
          <div style={styles.filterBar}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[
                {
                  id: "OUTSIDE",
                  label: `🟠 Outside Students (${currentlyOutsidePasses.length})`,
                },
                {
                  id: "INSIDE",
                  label: `🟢 Inside Students (${insideStudents.length})`,
                },
                {
                  id: "HISTORY",
                  label: `📜 All Pass History (${passes.length})`,
                },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setAdminViewMode(tab.id)}
                  style={{
                    ...styles.subTabBtn,
                    ...(adminViewMode === tab.id ? styles.subTabBtnActive : {}),
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                type="text"
                placeholder="Search name, Ad.No, reason..."
                value={adminSearch}
                onChange={(e) => setAdminSearch(e.target.value)}
                style={{ ...styles.input, width: 200 }}
              />
              <select
                value={classFilter}
                onChange={(e) => setClassFilter(e.target.value)}
                style={{ ...styles.input, width: 130 }}
              >
                {allClasses.map((c) => (
                  <option key={c} value={c}>
                    Class: {c}
                  </option>
                ))}
              </select>
              {adminViewMode !== "INSIDE" && (
                <select
                  value={teacherFilter}
                  onChange={(e) => setTeacherFilter(e.target.value)}
                  style={{ ...styles.input, width: 160 }}
                >
                  {allTeachers.map((t) => (
                    <option key={t} value={t}>
                      Teacher: {t}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Admin Data Table */}
          <div style={styles.tableCard}>
            {adminViewMode === "INSIDE" ? (
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Ad.No</th>
                    <th style={styles.th}>Student Name</th>
                    <th style={styles.th}>Class</th>
                    <th style={styles.th}>Current Status</th>
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
                          <strong>#{s.adNo}</strong>
                        </td>
                        <td style={styles.td}>{s.name}</td>
                        <td style={styles.td}>{s.studentClass}</td>
                        <td style={styles.td}>
                          <span style={styles.insideBadge}>
                            🟢 INSIDE CAMPUS
                          </span>
                        </td>
                        <td style={styles.td}>{getMonthlyOutCount(s.adNo)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            ) : (
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Student (Ad.No / Class)</th>
                    <th style={styles.th}>Destination & Reason</th>
                    <th style={styles.th}>Permitted Teacher</th>
                    <th style={styles.th}>Allowed Time Window</th>
                    <th style={styles.th}>Departure / Return</th>
                    <th style={styles.th}>Status / Action</th>
                  </tr>
                </thead>
                <tbody>
                  {passes
                    .filter((p) => {
                      if (adminViewMode === "OUTSIDE" && p.status !== "OUTSIDE")
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
                    .map((p) => (
                      <tr key={p.id} style={styles.tr}>
                        <td style={styles.td}>
                          <div style={{ fontWeight: 700 }}>{p.studentName}</div>
                          <div style={{ fontSize: 12, color: "#64748b" }}>
                            #{p.adNo} • Class {p.studentClass}
                          </div>
                        </td>
                        <td style={styles.td}>
                          <div style={{ fontWeight: 600 }}>
                            📍 {p.destination}
                          </div>
                          <div style={{ fontSize: 12, color: "#475569" }}>
                            Reason: {p.purpose}
                          </div>
                        </td>
                        <td style={styles.td}>
                          <strong>{p.teacherName}</strong>
                        </td>
                        <td style={styles.td}>
                          <div style={{ fontSize: 12 }}>
                            From:{" "}
                            {new Date(p.permittedFrom).toLocaleString("en-IN", {
                              dateStyle: "short",
                              timeStyle: "short",
                            })}
                          </div>
                          <div style={{ fontSize: 12, fontWeight: 700 }}>
                            To:{" "}
                            {new Date(p.permittedTo).toLocaleString("en-IN", {
                              dateStyle: "short",
                              timeStyle: "short",
                            })}
                          </div>
                        </td>
                        <td style={styles.td}>
                          <div style={{ fontSize: 12 }}>
                            Out:{" "}
                            {p.actualDepartureTime
                              ? new Date(
                                  p.actualDepartureTime
                                ).toLocaleTimeString("en-IN", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : "—"}
                          </div>
                          <div style={{ fontSize: 12 }}>
                            In:{" "}
                            {p.actualReturnTime
                              ? new Date(p.actualReturnTime).toLocaleTimeString(
                                  "en-IN",
                                  {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  }
                                )
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
                              {p.status === "OUTSIDE" &&
                              new Date(p.permittedTo) < now
                                ? "OVERDUE / LATE"
                                : p.status}
                            </span>

                            {p.status === "OUTSIDE" && (
                              <button
                                onClick={() => handleConfirmReturn(p)}
                                style={{
                                  ...styles.returnActionBtn,
                                  padding: "5px 10px",
                                  fontSize: "11px",
                                }}
                              >
                                ✓ Mark Returned
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Helper for status pill colors
function getStatusBadgeStyle(status, permittedTo, now) {
  const isOverdue = status === "OUTSIDE" && new Date(permittedTo) < now;
  if (isOverdue) {
    return {
      background: "#fee2e2",
      color: "#b91c1c",
      padding: "4px 10px",
      borderRadius: "999px",
      fontSize: "11px",
      fontWeight: 700,
    };
  }
  if (status === "OUTSIDE") {
    return {
      background: "#ffedd5",
      color: "#c2410c",
      padding: "4px 10px",
      borderRadius: "999px",
      fontSize: "11px",
      fontWeight: 700,
    };
  }
  if (status === "APPROVED") {
    return {
      background: "#fef9c3",
      color: "#a16207",
      padding: "4px 10px",
      borderRadius: "999px",
      fontSize: "11px",
      fontWeight: 700,
    };
  }
  if (status === "RETURNED") {
    return {
      background: "#dcfce7",
      color: "#15803d",
      padding: "4px 10px",
      borderRadius: "999px",
      fontSize: "11px",
      fontWeight: 700,
    };
  }
  return {
    background: "#e2e8f0",
    color: "#475569",
    padding: "4px 10px",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: 700,
  };
}

const styles = {
  pageWrapper: {
    minHeight: "100vh",
    background: "#f1f5f9",
    padding: "20px",
    fontFamily: "system-ui, -apple-system, sans-serif",
    color: "#0f172a",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "12px",
    background: "#0f3d3e",
    color: "#ffffff",
    padding: "16px 22px",
    borderRadius: "12px",
    marginBottom: "18px",
  },
  uniBadge: {
    fontSize: "11px",
    letterSpacing: "1.2px",
    color: "#99f6e4",
    fontWeight: 700,
  },
  title: {
    margin: "2px 0 0",
    fontSize: "22px",
    fontWeight: 800,
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    flexWrap: "wrap",
  },
  staffBadge: {
    background: "rgba(255,255,255,0.12)",
    padding: "6px 12px",
    borderRadius: "8px",
    fontSize: "13px",
  },
  backLink: {
    background: "#ffffff",
    color: "#0f3d3e",
    padding: "7px 14px",
    borderRadius: "8px",
    fontSize: "13px",
    fontWeight: 700,
    textDecoration: "none",
  },
  tabBar: {
    display: "flex",
    gap: "10px",
    marginBottom: "20px",
    flexWrap: "wrap",
  },
  tabBtn: {
    padding: "11px 18px",
    borderRadius: "10px",
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#334155",
    fontWeight: 700,
    fontSize: "14px",
    cursor: "pointer",
  },
  tabBtnActive: {
    background: "#0f766e",
    color: "#ffffff",
    borderColor: "#0f766e",
  },
  gridTwoCol: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
    gap: "20px",
  },
  slipCard: {
    background: "#ecfeff",
    border: "2px solid #0f766e",
    borderRadius: "12px",
    padding: "20px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
  },
  slipHeader: {
    background: "#0f766e",
    color: "#fff",
    padding: "10px 14px",
    borderRadius: "8px",
    marginBottom: "16px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  card: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "12px",
    padding: "20px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.03)",
  },
  label: {
    display: "block",
    fontSize: "13px",
    fontWeight: 700,
    color: "#1e293b",
    marginBottom: "6px",
  },
  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: "8px",
    border: "1px solid #cbd5e1",
    fontSize: "14px",
    boxSizing: "border-box",
  },
  scanBtn: {
    background: "#0f172a",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    padding: "0 16px",
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  dropdownList: {
    background: "#fff",
    border: "1px solid #cbd5e1",
    borderRadius: "8px",
    marginTop: "4px",
    maxHeight: "200px",
    overflowY: "auto",
  },
  dropdownItem: {
    padding: "10px 12px",
    borderBottom: "1px solid #f1f5f9",
    cursor: "pointer",
    fontSize: "14px",
  },
  classBadge: {
    background: "#e2e8f0",
    color: "#334155",
    padding: "2px 8px",
    borderRadius: "6px",
    fontSize: "12px",
    marginLeft: "6px",
  },
  selectedStudentBox: {
    background: "#ffffff",
    border: "2px solid #14b8a6",
    borderRadius: "10px",
    padding: "12px 14px",
    marginBottom: "16px",
  },
  outingCountBadge: {
    background: "#f0fdf4",
    color: "#166534",
    border: "1px solid #bbf7d0",
    padding: "3px 8px",
    borderRadius: "6px",
    fontSize: "12px",
    fontWeight: 700,
    marginBottom: "6px",
  },
  warningAlert: {
    marginTop: "10px",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#991b1b",
    padding: "8px 10px",
    borderRadius: "6px",
    fontSize: "12px",
  },
  chipRow: {
    display: "flex",
    gap: "6px",
    flexWrap: "wrap",
    marginTop: "6px",
  },
  quickChip: {
    background: "#ffffff",
    border: "1px solid #94a3b8",
    borderRadius: "999px",
    padding: "4px 10px",
    fontSize: "12px",
    cursor: "pointer",
    color: "#334155",
  },
  twoInputRow: {
    display: "flex",
    gap: "12px",
    flexWrap: "wrap",
    marginBottom: "8px",
  },
  submitBtn: {
    width: "100%",
    padding: "13px",
    background: "#0f766e",
    color: "#ffffff",
    border: "none",
    borderRadius: "8px",
    fontSize: "15px",
    fontWeight: 700,
    cursor: "pointer",
  },
  passRowItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px",
    borderRadius: "8px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
  },
  gateScannerHero: {
    background: "#1e293b",
    color: "#fff",
    padding: "18px 22px",
    borderRadius: "12px",
    marginBottom: "18px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "12px",
  },
  gateBigScanBtn: {
    background: "#14b8a6",
    color: "#0f172a",
    border: "none",
    padding: "11px 18px",
    borderRadius: "8px",
    fontWeight: 800,
    fontSize: "14px",
    cursor: "pointer",
  },
  gateVerifyModal: {
    background: "#e0f2fe",
    border: "2px solid #0284c7",
    borderRadius: "12px",
    padding: "16px 20px",
    marginBottom: "18px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "14px",
  },
  departActionBtn: {
    background: "#ea580c",
    color: "#fff",
    border: "none",
    padding: "10px 14px",
    borderRadius: "8px",
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  returnActionBtn: {
    background: "#16a34a",
    color: "#fff",
    border: "none",
    padding: "10px 14px",
    borderRadius: "8px",
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: "14px",
    marginBottom: "18px",
  },
  kpiCard: {
    background: "#ffffff",
    padding: "16px",
    borderRadius: "12px",
    boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
  },
  kpiLabel: {
    fontSize: "12px",
    fontWeight: 800,
    color: "#64748b",
  },
  kpiValue: {
    fontSize: "30px",
    fontWeight: 800,
    margin: "4px 0",
  },
  kpiSub: {
    fontSize: "11px",
    color: "#94a3b8",
  },
  filterBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "12px",
    marginBottom: "14px",
  },
  subTabBtn: {
    padding: "8px 14px",
    borderRadius: "8px",
    border: "1px solid #cbd5e1",
    background: "#fff",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
  },
  subTabBtnActive: {
    background: "#0f172a",
    color: "#fff",
    borderColor: "#0f172a",
  },
  tableCard: {
    background: "#ffffff",
    borderRadius: "12px",
    border: "1px solid #e2e8f0",
    overflowX: "auto",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    textAlign: "left",
    fontSize: "14px",
  },
  th: {
    padding: "12px 16px",
    background: "#f8fafc",
    borderBottom: "1px solid #e2e8f0",
    fontSize: "12px",
    textTransform: "uppercase",
    color: "#475569",
  },
  tr: {
    borderBottom: "1px solid #f1f5f9",
  },
  td: {
    padding: "12px 16px",
    verticalAlign: "top",
  },
  insideBadge: {
    background: "#dcfce7",
    color: "#166534",
    padding: "4px 10px",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: 700,
  },
  clearBtn: {
    background: "transparent",
    border: "1px solid #94a3b8",
    borderRadius: "6px",
    padding: "4px 8px",
    fontSize: "12px",
    cursor: "pointer",
  },
  cancelLinkBtn: {
    background: "none",
    border: "none",
    color: "#dc2626",
    fontSize: "11px",
    cursor: "pointer",
    textDecoration: "underline",
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.65)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    padding: "16px",
  },
  modalCard: {
    background: "#fff",
    padding: "20px",
    borderRadius: "12px",
    maxWidth: "400px",
    width: "100%",
    textAlign: "center",
  },
  closeModalBtn: {
    marginTop: "14px",
    width: "100%",
    padding: "10px",
    background: "#ef4444",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    fontWeight: 700,
    cursor: "pointer",
  },
};