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
  const [teachersMap, setTeachersMap] = useState({});
  const [loading, setLoading] = useState(true);

  // Teacher Issue Form State (Separate Date & Time for smooth editing!)
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [destination, setDestination] = useState("");
  const [purpose, setPurpose] = useState("");

  const [fromDate, setFromDate] = useState("");
  const [fromTime, setFromTime] = useState("");
  const [toDate, setToDate] = useState("");
  const [toTime, setToTime] = useState("");
  const [isOpenReturn, setIsOpenReturn] = useState(false); // Medical / No specific return time
  const [activeDurationChip, setActiveDurationChip] = useState("2h");

  const [submitting, setSubmitting] = useState(false);
  const [teacherStatusFilter, setTeacherStatusFilter] = useState("ALL"); // "ALL" | "OUTSIDE" | "RETURNED"
  const [teacherSearch, setTeacherSearch] = useState("");

  // Edit Existing Pass Modal State (So Teacher/Admin can edit Departure/Return Date & Time anytime)
  const [editingPass, setEditingPass] = useState(null);
  const [editFromDate, setEditFromDate] = useState("");
  const [editFromTime, setEditFromTime] = useState("");
  const [editToDate, setEditToDate] = useState("");
  const [editToTime, setEditToTime] = useState("");
  const [editIsOpenReturn, setEditIsOpenReturn] = useState(false);
  const [editDestination, setEditDestination] = useState("");
  const [editPurpose, setEditPurpose] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

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

  // ============================================================================
  // 🕒 DATE & 12-HOUR CLOCK (AM/PM) HELPERS
  // ============================================================================
  const toLocalDateStr = (d) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const toLocalTimeStr = (d) => {
    const hours = String(d.getHours()).padStart(2, "0");
    const mins = String(d.getMinutes()).padStart(2, "0");
    return `${hours}:${mins}`;
  };

  const combineDateAndTimeToISO = (dateStr, timeStr) => {
    if (!dateStr) return null;
    const safeTime = timeStr || "00:00";
    const combined = new Date(`${dateStr}T${safeTime}:00`);
    return isNaN(combined.getTime()) ? null : combined.toISOString();
  };

  const formatTime12Hour = (isoString) => {
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
  };

  const formatDateTime12Hour = (isoString, openReturnFlag = false) => {
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
  };

  // Resolves any saved username/email to the Official Teacher Name (fullName with Hudawi/Sir)
  const getOfficialTeacherName = (rawNameOrUsername) => {
    if (!rawNameOrUsername) return "Teacher";
    const cleaned = String(rawNameOrUsername)
      .replace(/\s*\(Direct\)\s*$/i, "")
      .trim();
    const key = cleaned.toLowerCase();
    const prefix = key.split("@")[0];
    return teachersMap[key] || teachersMap[prefix] || cleaned;
  };

  // Initialize Default Times (+2 hours by default)
  const resetDefaultTimes = () => {
    const current = new Date();
    const twoHoursLater = new Date(current.getTime() + 2 * 60 * 60 * 1000);
    setFromDate(toLocalDateStr(current));
    setFromTime(toLocalTimeStr(current));
    setToDate(toLocalDateStr(twoHoursLater));
    setToTime(toLocalTimeStr(twoHoursLater));
    setIsOpenReturn(false);
    setActiveDurationChip("2h");
  };

  useEffect(() => {
    resetDefaultTimes();
  }, []);

  // 1. Check Auth, Load Official Teacher Names (`fullName`), & Load Students/Passes
  useEffect(() => {
    let teacherLookupCache = {};

    const loadTeachersAndStudents = async () => {
      try {
        const teacherSnap = await getDocs(collection(db, "teachers"));
        const map = {};
        teacherSnap.docs.forEach((d) => {
          const t = d.data();
          const officialName = (
            t.fullName ||
            t.name ||
            t.firstName ||
            ""
          ).trim();
          if (officialName) {
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
        teacherLookupCache = map;
        setTeachersMap(map);

        if (auth.currentUser) {
          const email = (auth.currentUser.email || "").toLowerCase().trim();
          const prefix = email.split("@")[0];
          if (map[email] || map[prefix]) {
            setStaffName(map[email] || map[prefix]);
          }
        }
      } catch (err) {
        console.error("Error loading teachers collection:", err);
      }

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

      if (user) {
        setCurrentUser(user);
        const emailLower = (user.email || "").toLowerCase().trim();
        const emailPrefix = emailLower.split("@")[0];

        let resolvedName =
          teacherLookupCache[emailLower] ||
          teacherLookupCache[emailPrefix] ||
          user.displayName ||
          emailPrefix ||
          "Teacher";

        if (
          !teacherLookupCache[emailLower] &&
          !teacherLookupCache[emailPrefix]
        ) {
          try {
            const teacherSnap = await getDocs(collection(db, "teachers"));
            const map = {};
            teacherSnap.docs.forEach((d) => {
              const t = d.data();
              const officialName = (
                t.fullName ||
                t.name ||
                t.firstName ||
                ""
              ).trim();
              if (officialName) {
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
            setTeachersMap(map);
            if (map[emailLower] || map[emailPrefix]) {
              resolvedName = map[emailLower] || map[emailPrefix];
            }
          } catch (e) {
            console.error("Error matching teacher fullName:", e);
          }
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
            getOfficialTeacherName(p.teacherName).toLowerCase() ===
              staffName.toLowerCase())
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

  // Helper: Check if a pass is currently Overdue (Never overdue if isOpenReturn is true!)
  const isPassOverdue = (pass) => {
    if (!pass || pass.status !== "OUTSIDE") return false;
    if (pass.isOpenReturn || !pass.permittedTo) return false;
    return new Date(pass.permittedTo) < now;
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

  // Helper: Format live remaining time or multi-day / open medical status
  const getRemainingTimeText = (pass) => {
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

  // ============================================================================
  // ⏱️ QUICK DURATION & MULTI-DAY HELPERS FOR TEACHER FORM
  // ============================================================================
  const getBaseDepartureDate = () => {
    const iso = combineDateAndTimeToISO(fromDate, fromTime);
    return iso ? new Date(iso) : new Date();
  };

  const applyHoursDuration = (hours, chipId) => {
    setIsOpenReturn(false);
    const start = getBaseDepartureDate();
    const end = new Date(start.getTime() + hours * 60 * 60 * 1000);
    setToDate(toLocalDateStr(end));
    setToTime(toLocalTimeStr(end));
    setActiveDurationChip(chipId);
  };

  const applyUntilEvening = () => {
    setIsOpenReturn(false);
    const start = getBaseDepartureDate();
    const end = new Date(start);
    end.setHours(18, 0, 0, 0);
    if (end <= start) {
      end.setDate(end.getDate() + 1);
    }
    setToDate(toLocalDateStr(end));
    setToTime(toLocalTimeStr(end));
    setActiveDurationChip("6pm");
  };

  const applyDaysDuration = (days, chipId) => {
    setIsOpenReturn(false);
    const start = getBaseDepartureDate();
    const end = new Date(start);
    end.setDate(end.getDate() + days);
    // Default return time on multi-day leave to 6:00 PM (editable by teacher)
    end.setHours(18, 0, 0, 0);
    setToDate(toLocalDateStr(end));
    setToTime(toLocalTimeStr(end));
    setActiveDurationChip(chipId);
  };

  const toggleOpenReturnMode = () => {
    const nextVal = !isOpenReturn;
    setIsOpenReturn(nextVal);
    setActiveDurationChip(nextVal ? "open" : "custom");
  };

  // 3. Teacher Submit: Issue Out-Pass
  const handleIssuePass = async (e) => {
    e.preventDefault();
    if (!selectedStudent) return alert("Please select or scan a student first.");
    if (!destination.trim() || !purpose.trim()) {
      return alert("Please enter both Destination and Purpose.");
    }

    const fromISO = combineDateAndTimeToISO(fromDate, fromTime);
    if (!fromISO) {
      return alert("Please select a valid Departure Date and Time.");
    }

    let toISO = null;
    if (!isOpenReturn) {
      toISO = combineDateAndTimeToISO(toDate, toTime);
      if (!toISO) {
        return alert(
          "Please select a Return Date & Time, or enable 'No Specific Return Time (Medical / Open)'."
        );
      }
      if (new Date(toISO) <= new Date(fromISO)) {
        return alert(
          "Return Date & Time must be after the Departure Date & Time!"
        );
      }
    }

    const existingActive = getActivePassForStudent(selectedStudent.adNo);
    if (existingActive) {
      return alert(
        `Cannot issue pass! ${selectedStudent.name} is already marked as ${
          existingActive.status
        } (Permitted by ${getOfficialTeacherName(existingActive.teacherName)}).`
      );
    }

    setSubmitting(true);
    try {
      const nowISO = new Date().toISOString();
      const initialStatus = USE_STRICT_GATEKEEPER ? "APPROVED" : "OUTSIDE";
      const officialTeacher = getOfficialTeacherName(staffName);

      await addDoc(collection(db, "out_passes"), {
        adNo: selectedStudent.adNo,
        studentName: selectedStudent.name,
        studentClass: selectedStudent.studentClass,
        destination: destination.trim(),
        purpose: purpose.trim(),
        permittedFrom: fromISO,
        permittedTo: isOpenReturn ? null : toISO,
        isOpenReturn: Boolean(isOpenReturn),
        teacherId: currentUser?.uid || "staff",
        teacherEmail: currentUser?.email || "",
        teacherName: officialTeacher,
        status: initialStatus,
        actualDepartureTime: USE_STRICT_GATEKEEPER ? null : fromISO,
        actualReturnTime: null,
        departureClerkName: USE_STRICT_GATEKEEPER ? null : officialTeacher,
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

  // ============================================================================
  // ✏️ EDIT ACTIVE PASS MODAL HANDLERS (Update Departure/Return Date & Time)
  // ============================================================================
  const openEditPassModal = (pass) => {
    const fDate = pass.permittedFrom ? new Date(pass.permittedFrom) : new Date();
    const tDate = pass.permittedTo
      ? new Date(pass.permittedTo)
      : new Date(fDate.getTime() + 2 * 60 * 60 * 1000);

    setEditingPass(pass);
    setEditDestination(pass.destination || "");
    setEditPurpose(pass.purpose || "");
    setEditFromDate(toLocalDateStr(fDate));
    setEditFromTime(toLocalTimeStr(fDate));
    setEditToDate(toLocalDateStr(tDate));
    setEditToTime(toLocalTimeStr(tDate));
    setEditIsOpenReturn(Boolean(pass.isOpenReturn || !pass.permittedTo));
  };

  const handleSaveEditedPass = async (e) => {
    e.preventDefault();
    if (!editingPass) return;

    const updatedFromISO = combineDateAndTimeToISO(editFromDate, editFromTime);
    if (!updatedFromISO) {
      return alert("Please enter a valid Departure Date & Time.");
    }

    let updatedToISO = null;
    if (!editIsOpenReturn) {
      updatedToISO = combineDateAndTimeToISO(editToDate, editToTime);
      if (!updatedToISO) {
        return alert("Please enter a valid Return Date & Time.");
      }
      if (new Date(updatedToISO) <= new Date(updatedFromISO)) {
        return alert("Return Date & Time must be after Departure Date & Time.");
      }
    }

    setSavingEdit(true);
    try {
      const passRef = doc(db, "out_passes", editingPass.id);
      await updateDoc(passRef, {
        destination: editDestination.trim(),
        purpose: editPurpose.trim(),
        permittedFrom: updatedFromISO,
        actualDepartureTime: updatedFromISO,
        permittedTo: editIsOpenReturn ? null : updatedToISO,
        isOpenReturn: Boolean(editIsOpenReturn),
      });
      setEditingPass(null);
    } catch (err) {
      console.error("Error updating pass:", err);
      alert("Failed to update out-pass details.");
    } finally {
      setSavingEdit(false);
    }
  };

  // 4. Return & Cancel Actions
  const handleConfirmReturn = async (pass) => {
    try {
      const returnTime = new Date();
      const isLate =
        !pass.isOpenReturn &&
        pass.permittedTo &&
        returnTime > new Date(pass.permittedTo);

      const passRef = doc(db, "out_passes", pass.id);
      await updateDoc(passRef, {
        status: "RETURNED",
        actualReturnTime: returnTime.toISOString(),
        returnClerkName: getOfficialTeacherName(staffName) || "Staff",
        wasLateReturn: Boolean(isLate),
      });
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
      "Permitted From (12h)",
      "Permitted To (12h)",
      "Actual Departure (12h)",
      "Actual Return (12h)",
      "Status",
    ];
    const rows = passes.map((p) => [
      p.adNo,
      `"${(p.studentName || "").replace(/"/g, '""')}"`,
      p.studentClass,
      `"${(p.destination || "").replace(/"/g, '""')}"`,
      `"${(p.purpose || "").replace(/"/g, '""')}"`,
      `"${getOfficialTeacherName(p.teacherName).replace(/"/g, '""')}"`,
      `"${formatDateTime12Hour(p.permittedFrom)}"`,
      `"${formatDateTime12Hour(p.permittedTo, p.isOpenReturn)}"`,
      `"${formatDateTime12Hour(p.actualDepartureTime)}"`,
      `"${formatDateTime12Hour(p.actualReturnTime)}"`,
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
      getOfficialTeacherName(p.teacherName).toLowerCase() ===
        getOfficialTeacherName(staffName).toLowerCase()
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

  // Global Lists (Strictly for Admin)
  const currentlyOutsidePasses = passes.filter((p) => p.status === "OUTSIDE");
  const overduePasses = currentlyOutsidePasses.filter((p) => isPassOverdue(p));

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
                {getOfficialTeacherName(staffName)}
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
            MODAL 1: BARCODE CAMERA SCANNER
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
            MODAL 2: EDIT EXISTING OUT-PASS (DATE / TIME / MEDICAL OPEN RETURN)
           ========================================================= */}
        {editingPass && (
          <div style={styles.modalOverlay}>
            <div style={{ ...styles.modalCard, maxWidth: "540px" }}>
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
                    Modify Active Out-Pass
                  </div>
                  <h3 style={{ margin: "2px 0 0", color: "#0f172a", fontSize: 18 }}>
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

                {/* Edit Departure Date & Time */}
                <div style={styles.timePickerCard}>
                  <div style={styles.timeSectionTitle}>
                    🚶‍♂️ Departure Date &amp; Time
                  </div>
                  <div style={styles.dateRowGrid}>
                    <div>
                      <span style={styles.subFieldLabel}>Departure Date</span>
                      <input
                        type="date"
                        value={editFromDate}
                        onChange={(e) => setEditFromDate(e.target.value)}
                        style={styles.textInput}
                        required
                      />
                    </div>
                    <div>
                      <span style={styles.subFieldLabel}>Departure Time</span>
                      <input
                        type="time"
                        value={editFromTime}
                        onChange={(e) => setEditFromTime(e.target.value)}
                        style={styles.textInput}
                        required
                      />
                    </div>
                  </div>
                  <div style={styles.timePreview12h}>
                    🕒 Selected:{" "}
                    {formatDateTime12Hour(
                      combineDateAndTimeToISO(editFromDate, editFromTime)
                    )}
                  </div>
                </div>

                {/* Edit Return Date & Time OR Medical Open Return */}
                <div style={{ ...styles.timePickerCard, marginTop: 12 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: 8,
                      marginBottom: 8,
                    }}
                  >
                    <div style={styles.timeSectionTitle}>
                      ⏳ Expected Return Date &amp; Time
                    </div>
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
                        ? "✓ 🏥 No Specific Return Time (Active)"
                        : "🏥 Set No Specific Return Time (Medical)"}
                    </button>
                  </div>

                  {!editIsOpenReturn ? (
                    <>
                      <div style={styles.dateRowGrid}>
                        <div>
                          <span style={styles.subFieldLabel}>Return Date</span>
                          <input
                            type="date"
                            value={editToDate}
                            min={editFromDate}
                            onChange={(e) => setEditToDate(e.target.value)}
                            style={styles.textInput}
                            required
                          />
                        </div>
                        <div>
                          <span style={styles.subFieldLabel}>Return Time</span>
                          <input
                            type="time"
                            value={editToTime}
                            onChange={(e) => setEditToTime(e.target.value)}
                            style={styles.textInput}
                            required
                          />
                        </div>
                      </div>
                      <div style={styles.timePreview12h}>
                        ⏳ Return Deadline:{" "}
                        {formatDateTime12Hour(
                          combineDateAndTimeToISO(editToDate, editToTime)
                        )}
                      </div>
                    </>
                  ) : (
                    <div style={styles.openMedicalBanner}>
                      🏥 <strong>Open-Ended / Medical Leave:</strong> No fixed
                      return time is required. This student will not be marked
                      overdue until they return.
                    </div>
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
                    {savingEdit ? "Saving Changes..." : "💾 Save Updated Pass"}
                  </button>
                </div>
              </form>
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
                  })}{" "}
                  • {formatTime12Hour(now.toISOString())}
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
                          {getOfficialTeacherName(
                            getActivePassForStudent(selectedStudent.adNo)
                              .teacherName
                          )}
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
                        "Medical / Hospital Case",
                        "Personal Purchase",
                        "Department / Official Work",
                        "Multi-Day Home Leave",
                        "Emergency Leave",
                      ].map((rsn) => {
                        const isSelected = purpose === rsn;
                        return (
                          <button
                            type="button"
                            key={rsn}
                            onClick={() => {
                              setPurpose(rsn);
                              // Automatically suggest Open Return if teacher clicks Medical Case
                              if (rsn === "Medical / Hospital Case") {
                                setIsOpenReturn(true);
                                setActiveDurationChip("open");
                              }
                            }}
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

                  {/* =========================================================
                      STEP 4: EDITABLE DEPARTURE & RETURN DATE/TIME + MEDICAL OPEN LEAVE
                     ========================================================= */}
                  <div style={{ marginBottom: 18 }}>
                    <label style={styles.fieldLabel}>
                      4. Permitted Departure &amp; Return Schedule (Single Day,
                      Multi-Day, or Open Medical)
                    </label>

                    {/* Quick Presets Bar: Hours, Days, & Medical Open Return */}
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
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 800,
                          color: "#475569",
                          textTransform: "uppercase",
                          width: "100%",
                          marginBottom: 2,
                        }}
                      >
                        Quick Return Presets (Or edit Date &amp; Time manually below):
                      </span>

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
                        📅 +1 Day (Tomorrow)
                      </button>
                      <button
                        type="button"
                        onClick={() => applyDaysDuration(2, "2d")}
                        style={
                          activeDurationChip === "2d" && !isOpenReturn
                            ? styles.quickChipActive
                            : styles.quickChip
                        }
                      >
                        📅 +2 Days
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

                      {/* Medical / No Specific Return Time Toggle */}
                      <button
                        type="button"
                        onClick={toggleOpenReturnMode}
                        style={
                          isOpenReturn
                            ? styles.medicalOpenBtnActive
                            : styles.medicalOpenBtnInactive
                        }
                      >
                        {isOpenReturn
                          ? "✓ 🏥 No Specific Return Time (Medical / Open)"
                          : "🏥 No Specific Return Time (Medical / Open)"}
                      </button>
                    </div>

                    {/* Box A: Departure Date & Time (Fully Editable) */}
                    <div style={styles.timePickerCard}>
                      <div style={styles.timeSectionTitle}>
                        🚶‍♂️ Permitted Departure (Date &amp; Time)
                      </div>
                      <div style={styles.dateRowGrid}>
                        <div>
                          <span style={styles.subFieldLabel}>
                            📅 Departure Date:
                          </span>
                          <input
                            type="date"
                            value={fromDate}
                            onChange={(e) => {
                              setFromDate(e.target.value);
                              if (toDate && e.target.value > toDate) {
                                setToDate(e.target.value);
                              }
                            }}
                            style={styles.textInput}
                            required
                          />
                        </div>
                        <div>
                          <span style={styles.subFieldLabel}>
                            🕒 Departure Time:
                          </span>
                          <input
                            type="time"
                            value={fromTime}
                            onChange={(e) => setFromTime(e.target.value)}
                            style={styles.textInput}
                            required
                          />
                        </div>
                      </div>
                      <div style={styles.timePreview12h}>
                        🕒 Leaving Campus:{" "}
                        <strong>
                          {formatDateTime12Hour(
                            combineDateAndTimeToISO(fromDate, fromTime)
                          )}
                        </strong>
                      </div>
                    </div>

                    {/* Box B: Return Date & Time OR Open Medical Banner */}
                    <div style={{ ...styles.timePickerCard, marginTop: 12 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          flexWrap: "wrap",
                          gap: 8,
                          marginBottom: 8,
                        }}
                      >
                        <div style={styles.timeSectionTitle}>
                          ⏳ Permitted Return Deadline (Date &amp; Time)
                        </div>
                        {isOpenReturn && (
                          <button
                            type="button"
                            onClick={() => {
                              setIsOpenReturn(false);
                              setActiveDurationChip("custom");
                            }}
                            style={styles.setFixedTimeLinkBtn}
                          >
                            Set Fixed Return Time Instead
                          </button>
                        )}
                      </div>

                      {!isOpenReturn ? (
                        <>
                          <div style={styles.dateRowGrid}>
                            <div>
                              <span style={styles.subFieldLabel}>
                                📅 Return Date (Can be 2+ days later):
                              </span>
                              <input
                                type="date"
                                value={toDate}
                                min={fromDate}
                                onChange={(e) => {
                                  setToDate(e.target.value);
                                  setActiveDurationChip("custom");
                                }}
                                style={styles.textInput}
                                required
                              />
                            </div>
                            <div>
                              <span style={styles.subFieldLabel}>
                                🕒 Return Time:
                              </span>
                              <input
                                type="time"
                                value={toTime}
                                onChange={(e) => {
                                  setToTime(e.target.value);
                                  setActiveDurationChip("custom");
                                }}
                                style={styles.textInput}
                                required
                              />
                            </div>
                          </div>
                          <div style={styles.timePreview12h}>
                            ⏳ Must Return By:{" "}
                            <strong>
                              {formatDateTime12Hour(
                                combineDateAndTimeToISO(toDate, toTime)
                              )}
                            </strong>
                          </div>
                        </>
                      ) : (
                        <div style={styles.openMedicalBanner}>
                          🏥{" "}
                          <strong>
                            No Specific Return Time (Medical / Open Leave):
                          </strong>{" "}
                          The student is permitted to stay out without a fixed
                          deadline. Return time will be recorded when they scan
                          back in.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* STEP 5: LOCKED OFFICIAL TEACHER SIGNATURE */}
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
                        Permitted By Teacher (Official Name)
                      </div>
                      <div
                        style={{
                          fontSize: 16,
                          fontWeight: 800,
                          color: "#0f172a",
                          marginTop: 2,
                        }}
                      >
                        👨‍🏫 {getOfficialTeacherName(staffName)}
                      </div>
                    </div>
                    <span style={styles.verifiedAccountBadge}>
                      ✓ Verified Staff
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
                  <h3 style={styles.cardTitle}>📋 My Permitted Students</h3>
                  <p style={styles.cardSubtitle}>
                    Live status of students permitted by{" "}
                    <strong style={{ color: "#0f172a" }}>
                      {getOfficialTeacherName(staffName)}
                    </strong>
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

              {/* Segmented Filter Control */}
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
                    const isOverdue = isPassOverdue(p);
                    return (
                      <div
                        key={p.id}
                        style={{
                          ...styles.passCardItem,
                          borderLeft:
                            p.status === "OUTSIDE"
                              ? isOverdue
                                ? "5px solid #dc2626"
                                : p.isOpenReturn
                                ? "5px solid #0284c7"
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
                          <div style={{ flex: 1, minWidth: 210 }}>
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
                                flexDirection: "column",
                                gap: 3,
                              }}
                            >
                              <span>
                                🕒 Departure:{" "}
                                <strong>
                                  {formatDateTime12Hour(p.permittedFrom)}
                                </strong>
                              </span>
                              <span>
                                ⏳ Permitted Return:{" "}
                                <strong
                                  style={{
                                    color: p.isOpenReturn
                                      ? "#0369a1"
                                      : "#0f172a",
                                  }}
                                >
                                  {formatDateTime12Hour(
                                    p.permittedTo,
                                    p.isOpenReturn
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
                                  color: isOverdue
                                    ? "#dc2626"
                                    : p.isOpenReturn
                                    ? "#0284c7"
                                    : "#d97706",
                                }}
                              >
                                ⏱️ {getRemainingTimeText(p)}
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
                                {formatDateTime12Hour(p.actualReturnTime)}
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
                            <span style={getStatusBadgeStyle(p, now)}>
                              {p.status === "OUTSIDE" && isOverdue
                                ? "🚨 OVERDUE / LATE"
                                : p.status === "OUTSIDE" && p.isOpenReturn
                                ? "🏥 MEDICAL / OPEN OUT"
                                : p.status === "OUTSIDE"
                                ? "🟠 OUTSIDE CAMPUS"
                                : p.status === "RETURNED"
                                ? "🟢 RETURNED"
                                : p.status}
                            </span>

                            {p.status === "OUTSIDE" && (
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
                                  onClick={() => openEditPassModal(p)}
                                  style={styles.editPassBtn}
                                >
                                  ✏️ Edit Time/Date
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleConfirmReturn(p)}
                                  style={styles.markReturnedBtn}
                                >
                                  ✓ Mark Returned
                                </button>
                              </div>
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
                      <th style={styles.th}>Permitted Schedule (12h)</th>
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
                          getOfficialTeacherName(p.teacherName) !==
                            teacherFilter
                        )
                          return false;
                        if (adminSearch.trim()) {
                          const q = adminSearch.toLowerCase();
                          return (
                            p.studentName?.toLowerCase().includes(q) ||
                            String(p.adNo).toLowerCase().includes(q) ||
                            p.destination?.toLowerCase().includes(q) ||
                            p.purpose?.toLowerCase().includes(q) ||
                            getOfficialTeacherName(p.teacherName)
                              .toLowerCase()
                              .includes(q)
                          );
                        }
                        return true;
                      })
                      .slice(0, 100)
                      .map((p) => {
                        const isOverdue = isPassOverdue(p);
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
                                  background: "#f0fdfa",
                                  border: "1px solid #99f6e4",
                                  padding: "6px 12px",
                                  borderRadius: 8,
                                  fontWeight: 800,
                                  color: "#0f766e",
                                  fontSize: 13,
                                }}
                              >
                                👨‍🏫 {getOfficialTeacherName(p.teacherName)}
                              </div>
                            </td>

                            <td style={styles.td}>
                              <div style={{ fontSize: 12, color: "#475569" }}>
                                From:{" "}
                                <strong style={{ color: "#0f172a" }}>
                                  {formatDateTime12Hour(p.permittedFrom)}
                                </strong>
                              </div>
                              <div
                                style={{
                                  fontSize: 12,
                                  color: "#475569",
                                  marginTop: 3,
                                }}
                              >
                                Return:{" "}
                                <strong
                                  style={{
                                    color: p.isOpenReturn
                                      ? "#0369a1"
                                      : "#0f172a",
                                  }}
                                >
                                  {formatDateTime12Hour(
                                    p.permittedTo,
                                    p.isOpenReturn
                                  )}
                                </strong>
                              </div>
                              {p.status === "OUTSIDE" && (
                                <div
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 700,
                                    color: isOverdue
                                      ? "#dc2626"
                                      : p.isOpenReturn
                                      ? "#0284c7"
                                      : "#d97706",
                                    marginTop: 4,
                                  }}
                                >
                                  ⏱️ {getRemainingTimeText(p)}
                                </div>
                              )}
                            </td>

                            <td style={styles.td}>
                              <div style={{ fontSize: 12, color: "#334155" }}>
                                Out:{" "}
                                <strong>
                                  {formatDateTime12Hour(p.actualDepartureTime)}
                                </strong>
                              </div>
                              <div
                                style={{
                                  fontSize: 12,
                                  color: p.actualReturnTime
                                    ? "#059669"
                                    : "#d97706",
                                  fontWeight: 700,
                                  marginTop: 3,
                                }}
                              >
                                In:{" "}
                                {p.actualReturnTime
                                  ? formatDateTime12Hour(p.actualReturnTime)
                                  : "Still Outside"}
                              </div>
                            </td>

                            <td style={styles.td}>
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 6,
                                  flexWrap: "wrap",
                                }}
                              >
                                <span style={getStatusBadgeStyle(p, now)}>
                                  {p.status === "OUTSIDE" && isOverdue
                                    ? "🚨 OVERDUE"
                                    : p.status === "OUTSIDE" && p.isOpenReturn
                                    ? "🏥 MEDICAL / OPEN"
                                    : p.status === "OUTSIDE"
                                    ? "🟠 OUTSIDE"
                                    : p.status === "RETURNED"
                                    ? "🟢 RETURNED"
                                    : p.status}
                                </span>

                                {p.status === "OUTSIDE" && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => openEditPassModal(p)}
                                      style={styles.editPassBtnSmall}
                                    >
                                      ✏️ Edit
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleConfirmReturn(p)}
                                      style={styles.markReturnedBtnSmall}
                                    >
                                      ✓ Returned
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
      </div>
    </div>
  );
}

// High-Contrast Status Pill Helper
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
      letterSpacing: "0.3px",
      display: "inline-block",
    };
  }
  if (status === "OUTSIDE" && pass.isOpenReturn) {
    return {
      background: "#e0f2fe",
      color: "#0369a1",
      border: "1px solid #bae6fd",
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
    marginBottom: "8px",
    textTransform: "uppercase",
    letterSpacing: "0.4px",
  },
  timePreview12h: {
    marginTop: "8px",
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
    boxShadow: "0 2px 8px rgba(2, 132, 199, 0.3)",
  },
  openMedicalBanner: {
    background: "#e0f2fe",
    border: "1px solid #7dd3fc",
    color: "#0c4a6e",
    padding: "12px 14px",
    borderRadius: "10px",
    fontSize: "13px",
    lineHeight: 1.5,
  },
  setFixedTimeLinkBtn: {
    background: "#ffffff",
    color: "#0369a1",
    border: "1px solid #7dd3fc",
    borderRadius: "6px",
    padding: "4px 10px",
    fontSize: "11px",
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
    padding: "8px 12px",
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