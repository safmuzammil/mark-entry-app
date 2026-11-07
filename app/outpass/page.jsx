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
  onSnapshot,
} from "firebase/firestore";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from "firebase/auth";
import {
  compressImageFileToDataUrl,
  openDirectWhatsApp,
  StudentPortfolioModal,
} from "../components/ErpExtensions";
import { DHIU_LOGO_URL } from "../components/erpConstants";

import {
  SECURITY_KIOSK_PIN,
  DEFAULT_GATE_WORKFLOW,
  REALTIME_PASS_LIMIT,
  ADMIN_EMAILS,
  LEAVE_CATEGORIES,
  PRESET_DESTINATIONS,
  getLocalDateString,
  dateTo12HourParts,
  partsToISOString,
  formatTime12Hour,
  formatDateTime12Hour,
  playBeep,
  styles,
} from "./components/outpassHelpers";

import OutpassModals from "./components/OutpassModals";
import OutpassTeacherDesk from "./components/OutpassTeacherDesk";
import OutpassSecurityKiosk from "./components/OutpassSecurityKiosk";
import OutpassAdminReports from "./components/OutpassAdminReports";
import OutpassSettingsTab from "./components/OutpassSettingsTab";

export default function OutPassPortal({
  initialTab = null,
  embeddedMode = false,
  preloadedStudents = [],
  preloadedTeachers = [],
  preloadedTeacherUser = null,
  isAdminProp = false,
}) {
  const [currentUser, setCurrentUser] = useState(null);
  const [loggedUsername, setLoggedUsername] = useState(
    preloadedTeacherUser?.username || (isAdminProp ? "admin" : "")
  );
  const [staffName, setStaffName] = useState(
    preloadedTeacherUser?.fullName || (isAdminProp ? "Admin" : "")
  );
  const [isAdmin, setIsAdmin] = useState(Boolean(isAdminProp));
  const [isSecurityKiosk, setIsSecurityKiosk] = useState(false);
  const [securityPinInput, setSecurityPinInput] = useState("");
  const [authChecking, setAuthChecking] = useState(!embeddedMode);
  const [activeTab, setActiveTab] = useState(initialTab || (isAdminProp ? "admin" : "teacher"));

  const [useGatekeeperFlow, setUseGatekeeperFlow] = useState(
    DEFAULT_GATE_WORKFLOW
  );

  const [students, setStudents] = useState([]);
  const [passes, setPasses] = useState([]);
  const [unapprovedLogs, setUnapprovedLogs] = useState([]);
  const [teachersMap, setTeachersMap] = useState({});
  const [teachersDataMap, setTeachersDataMap] = useState({});
  const [teachersList, setTeachersList] = useState([]);
  const [loadingOlderHistory, setLoadingOlderHistory] = useState(false);

  const [isGroupMode, setIsGroupMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [selectedGroupStudents, setSelectedGroupStudents] = useState([]);
  const [leaveCategory, setLeaveCategory] = useState("");
  const [destination, setDestination] = useState("");
  const [purpose, setPurpose] = useState("");
  const [selectedTeacherOverride, setSelectedTeacherOverride] = useState("");

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

  const [gateBarcodeInput, setGateBarcodeInput] = useState("");
  const [gateScanResult, setGateScanResult] = useState(null);
  const gateInputRef = useRef(null);

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
  const [editExtensionReason, setEditExtensionReason] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const [autoOpenParentWA, setAutoOpenParentWA] = useState(true);
  const [autoNotifyParentOnGateScan, setAutoNotifyParentOnGateScan] =
    useState(true);

  const [receiptPass, setReceiptPass] = useState(null);
  const [zoomPhotoStudent, setZoomPhotoStudent] = useState(null);
  const [portfolioModalStudent, setPortfolioModalStudent] = useState(null);

  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerMode, setScannerMode] = useState("teacher");
  const scannerRef = useRef(null);

  const [adminReportType, setAdminReportType] = useState("OUTSIDE");
  const [reportStartDate, setReportStartDate] = useState("");
  const [reportEndDate, setReportEndDate] = useState("");
  const [classFilter, setClassFilter] = useState("ALL");
  const [deptFilter, setDeptFilter] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [teacherFilter, setTeacherFilter] = useState("ALL");
  const [mentorFilter, setMentorFilter] = useState("ALL");
  const [stateFilter, setStateFilter] = useState("ALL");
  const [districtFilter, setDistrictFilter] = useState("ALL");
  const [destinationFilter, setDestinationFilter] = useState("ALL");
  const [adminSearch, setAdminSearch] = useState("");
  const [now, setNow] = useState(new Date());

  const [mealCheckDate, setMealCheckDate] = useState(
    getLocalDateString(new Date())
  );
  const [mealCheckHour, setMealCheckHour] = useState("12");
  const [mealCheckMinute, setMealCheckMinute] = useState("30");
  const [mealCheckAmpm, setMealCheckAmpm] = useState("PM");

  const [settingsSearch, setSettingsSearch] = useState("");
  const [editingStudentSettings, setEditingStudentSettings] = useState(null);
  const [studentPhotoInput, setStudentPhotoInput] = useState("");
  const [studentBlockedCategories, setStudentBlockedCategories] = useState([]);
  const [studentBlockReason, setStudentBlockReason] = useState("");
  const [studentPrincipalLock, setStudentPrincipalLock] = useState(false);
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

  const normalizeStudentDoc = (data, docId) => ({
    id: docId || data.regNo || data.id,
    regNo: String(data.regNo || docId || "").trim(),
    adNo: String(data.adNo || data.regNo || data.rollNo || "").trim(),
    name: data.firstName || data.name || "Unknown Student",
    firstName: data.firstName || data.name || "Unknown Student",
    classes: Array.isArray(data.classes)
      ? data.classes
      : [data.class || "General"],
    studentClass: Array.isArray(data.classes)
      ? data.classes[0] || "General"
      : data.class || "General",
    department: data.department || "GENERAL",
    madhab: data.madhab || "Hanafi",
    state: data.state || "Kerala",
    district: data.district || "Malappuram",
    email: data.email || "",
    mobileNumber: data.mobileNumber || "",
    whatsappNumber: data.whatsappNumber || "",
    parentMobile: data.parentMobile || "",
    parentWhatsapp: data.parentWhatsapp || "",
    mentorUsername: String(data.mentorUsername || "").toLowerCase().trim(),
    classTeacherUsername: String(data.classTeacherUsername || "")
      .toLowerCase()
      .trim(),
    requiresPrincipalApproval: Boolean(data.requiresPrincipalApproval),
    photoUrl:
      data.photoUrl || data.photo || data.imageUrl || data.avatar || null,
    skills: Array.isArray(data.skills) ? data.skills : [],
    achievements: Array.isArray(data.achievements) ? data.achievements : [],
    blockedCategories: Array.isArray(data.blockedLeaveCategories)
      ? data.blockedLeaveCategories
      : [],
    blockReason: data.leaveBlockReason || "",
    raw: data,
  });

  useEffect(() => {
    let teacherLookupCache = {};

    const hydrateTeachersList = (rawTeachers) => {
      const map = {};
      const fullDataMap = {};
      const tArr = [];
      rawTeachers.forEach((t) => {
        const uname = String(t.username || t.id || "").toLowerCase().trim();
        const officialName = (
          t.fullName ||
          t.name ||
          t.firstName ||
          uname
        ).trim();
        if (officialName) {
          const record = {
            ...t,
            username: uname,
            fullName: officialName,
            phone: t.whatsappNumber || t.mobileNumber || t.phone || "",
            designation: t.designation || "Faculty",
            outpassPrivileges: t.outpassPrivileges || {
              isPrincipal: t.roleCategory === "Principal" || uname === "yusuf",
              isNiicsCoordinator: false,
              classTeacherOf: [],
              allowedCategories: ["Friday", "Evening"],
              canApproveWeekend: uname === "yusuf",
              canApproveOutreach: false,
              canViewReports: false,
            },
          };
          tArr.push(record);
          fullDataMap[uname] = record;
          map[uname] = officialName;
          map[uname.split("@")[0]] = officialName;
          map[officialName.toLowerCase()] = officialName;
          if (t.email) {
            const em = String(t.email).toLowerCase().trim();
            map[em] = officialName;
            map[em.split("@")[0]] = officialName;
            fullDataMap[em.split("@")[0]] = record;
          }
        }
      });
      tArr.sort((a, b) => a.fullName.localeCompare(b.fullName));
      setTeachersList(tArr);
      setTeachersDataMap(fullDataMap);
      teacherLookupCache = map;
      setTeachersMap(map);
    };

    const loadTeachersAndStudents = async () => {
      if (preloadedTeachers && preloadedTeachers.length > 0) {
        hydrateTeachersList(preloadedTeachers);
      } else {
        try {
          const teacherSnap = await getDocs(collection(db, "teachers"));
          hydrateTeachersList(
            teacherSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
          );
        } catch (err) {
          console.error("Error loading teachers:", err);
        }
      }

      if (preloadedStudents && preloadedStudents.length > 0) {
        setStudents(
          preloadedStudents.map((s) => normalizeStudentDoc(s, s.regNo || s.id))
        );
      } else {
        try {
          const snap = await getDocs(collection(db, "students"));
          setStudents(
            snap.docs.map((d) => normalizeStudentDoc(d.data(), d.id))
          );
        } catch (err) {
          console.error("Error loading students:", err);
        }
      }
    };

    loadTeachersAndStudents();

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (embeddedMode && (preloadedTeacherUser || isAdminProp)) {
        if (isAdminProp) {
          setIsAdmin(true);
          setLoggedUsername("admin");
          setStaffName("Admin");
          setCurrentUser(user || { uid: "admin", email: "admin@school.com" });
        } else if (preloadedTeacherUser) {
          setLoggedUsername(preloadedTeacherUser.username);
          setStaffName(preloadedTeacherUser.fullName);
          setCurrentUser(
            user || {
              uid: preloadedTeacherUser.username,
              email: `${preloadedTeacherUser.username}@school.com`,
            }
          );
        }
        setAuthChecking(false);
        return;
      }

      if (!user || !user.email) {
        setCurrentUser(null);
        setIsAdmin(false);
        setAuthChecking(false);
        return;
      }

      const emailLower = user.email.toLowerCase().trim();
      const emailPrefix = emailLower.split("@")[0];

      if (emailLower.endsWith("@student.school.com")) {
        setCurrentUser(null);
        setIsAdmin(false);
        setAuthChecking(false);
        return;
      }

      if (emailLower === "kiosk@school.com") {
        setCurrentUser(user);
        setIsSecurityKiosk(true);
        setStaffName("Security Gate");
        setActiveTab("security");
        setAuthChecking(false);
        return;
      }

      const emailIsAdmin = ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(
        emailLower
      );
      setIsAdmin(Boolean(emailIsAdmin));
      setCurrentUser(user);
      setLoggedUsername(emailPrefix);

      let resolvedName =
        teacherLookupCache[emailLower] ||
        teacherLookupCache[emailPrefix] ||
        user.displayName ||
        emailPrefix ||
        "Teacher";

      setStaffName(emailIsAdmin ? "Admin" : resolvedName);
      if (initialTab) {
        setActiveTab(initialTab);
      } else {
        setActiveTab(emailIsAdmin ? "admin" : "teacher");
      }
      setAuthChecking(false);
    });

    const qPasses = query(
      collection(db, "out_passes"),
      orderBy("createdAt", "desc"),
      limit(REALTIME_PASS_LIMIT)
    );
    const unsubPasses = onSnapshot(
      qPasses,
      (snapshot) => {
        setPasses(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      () => {}
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
  }, [
    embeddedMode,
    isAdminProp,
    preloadedTeacherUser,
    preloadedStudents.length,
    preloadedTeachers.length,
  ]);

  const myTeacherRecord =
    preloadedTeacherUser || teachersDataMap[loggedUsername] || null;
  const myPrivileges = myTeacherRecord?.outpassPrivileges || {
    isPrincipal: loggedUsername === "yusuf",
    isNiicsCoordinator: false,
    classTeacherOf: [],
    allowedCategories: ["Friday", "Evening"],
    canApproveWeekend: loggedUsername === "yusuf",
    canApproveOutreach: false,
    canViewReports: false,
  };
  const hasPrincipalPower = Boolean(isAdmin || myPrivileges.isPrincipal);
  const canSeeReportsTab = Boolean(
    isAdmin ||
      myPrivileges.isPrincipal ||
      myPrivileges.isNiicsCoordinator ||
      myPrivileges.isOfficeSecretary ||
      myPrivileges.canViewReports
  );

  useEffect(() => {
    if (!canSeeReportsTab && !isSecurityKiosk && activeTab !== "teacher" && activeTab !== "security") {
      setActiveTab("teacher");
    }
  }, [canSeeReportsTab, isSecurityKiosk, activeTab]);

  // 🌟 Sync initialTab dynamically when opened as embedded Gate Security Kiosk or via URL hash
  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
      if (initialTab === "security") {
        setTimeout(() => gateInputRef.current?.focus(), 250);
      }
      return;
    }

    if (typeof window !== "undefined") {
      const hash = window.location.hash.replace("#", "").toLowerCase().trim();
      const searchParams = new URLSearchParams(window.location.search);
      const tabParam = searchParams.get("tab")?.toLowerCase().trim();
      if (hash === "security" || hash === "gate_security" || tabParam === "security") {
        setActiveTab("security");
        setIsSecurityKiosk(true);
        setTimeout(() => gateInputRef.current?.focus(), 250);
      }
    }
  }, [initialTab]);

  useEffect(() => {
    if (activeTab === "security") {
      setTimeout(() => gateInputRef.current?.focus(), 200);
    }
  }, [activeTab]);

  const evaluateLeavePermission = (
    studentObj,
    categoryToCheck,
    fromISO,
    toISO
  ) => {
    if (!studentObj) return { allowed: true, reason: "" };

    const blockedList = studentObj.blockedCategories || [];
    if (blockedList.includes("ALL") || blockedList.includes(categoryToCheck)) {
      return {
        allowed: false,
        reason: `🚫 DISCIPLINARY BLOCK: ${studentObj.name} (#${studentObj.adNo}) is blocked from taking "${categoryToCheck}" leave.\nReason: ${
          studentObj.blockReason || "Disciplinary restriction by Admin"
        }`,
      };
    }

    const isUrduStudent = String(studentObj.adNo || "")
      .trim()
      .toUpperCase()
      .startsWith("U");

    if (
      hasPrincipalPower ||
      (myPrivileges.isNiicsCoordinator && isUrduStudent)
    ) {
      return {
        allowed: true,
        reason: myPrivileges.isNiicsCoordinator
          ? "🎓 NIICS Coordinator (Urdu Principal Authority)"
          : "👑 Principal / Admin Authority",
      };
    }

    if (studentObj.requiresPrincipalApproval) {
      return {
        allowed: false,
        reason: `👑 Restricted Student: Leave for ${studentObj.name} (#${
          studentObj.adNo
        }) can ONLY be approved by the ${
          isUrduStudent ? "Principal or NIICS Coordinator" : "Principal"
        }.`,
      };
    }

    const stClasses = Array.isArray(studentObj.classes)
      ? studentObj.classes
      : [studentObj.studentClass];
    const isClassTeacherOfStudent =
      (studentObj.classTeacherUsername &&
        studentObj.classTeacherUsername === loggedUsername) ||
      (myPrivileges.classTeacherOf || []).some((c) => stClasses.includes(c));

    const isMentorOfStudent =
      studentObj.mentorUsername &&
      studentObj.mentorUsername === loggedUsername;

    if (categoryToCheck === "Monthly_Home") {
      if (isClassTeacherOfStudent || myPrivileges.canApproveWeekend) {
        return {
          allowed: true,
          reason: `🏠 Monthly Home Leave (Class Teacher of ${studentObj.studentClass})`,
        };
      }
      return {
        allowed: false,
        reason: `🏠 Monthly Home Leave for Class ${studentObj.studentClass} is managed by their Class Teacher, NIICS Coordinator, or Principal.`,
      };
    }

    let isThuToFriSatSchedule = categoryToCheck === "Weekend_Thu_Sat";
    if (fromISO && toISO && categoryToCheck !== "Monthly_Home") {
      const fD = new Date(fromISO);
      const tD = new Date(toISO);
      const diffHours = (tD - fD) / (1000 * 60 * 60);
      if (fD.getDay() === 4 && fD.getHours() >= 15 && diffHours > 18) {
        isThuToFriSatSchedule = true;
      }
    }

    if (isThuToFriSatSchedule) {
      if (myPrivileges.canApproveWeekend) {
        return { allowed: true, reason: "🗓️ Weekend Authority" };
      }
      return {
        allowed: false,
        reason:
          "🗓️ Restricted Schedule: Thursday Evening to Friday Evening / Saturday leaves can only be approved by the Principal (or NIICS Coordinator for Urdu students).",
      };
    }

    if (categoryToCheck === "Outreach") {
      if (myPrivileges.canApproveOutreach || myPrivileges.isOutreachCoordinator) {
        return { allowed: true, reason: "🌍 Outreach Usthad Authority" };
      }
      return {
        allowed: false,
        reason:
          "🌍 Restricted Category: Outreach leaves can only be permitted by designated Outreach Usthads.",
      };
    }

    if (categoryToCheck === "Friday") {
      return { allowed: true, reason: "🕌 Friday Leave (All Faculty)" };
    }

    if (categoryToCheck === "Evening") {
      if (
        isMentorOfStudent ||
        isClassTeacherOfStudent ||
        (myPrivileges.allowedCategories || []).includes("Evening")
      ) {
        return {
          allowed: true,
          reason: isMentorOfStudent
            ? "👨‍🏫 Assigned Mentor Authority"
            : "🌇 Evening Leave Permitted",
        };
      }
      return {
        allowed: false,
        reason: `🌇 Evening Leave for ${studentObj.name} requires their Assigned Mentor (${studentObj.mentorUsername || "Unassigned"}) or Class Teacher.`,
      };
    }

    if (
      categoryToCheck === "General" ||
      categoryToCheck === "Medical" ||
      categoryToCheck === "Official"
    ) {
      if (isClassTeacherOfStudent) {
        return {
          allowed: true,
          reason: `🏫 Class Teacher of ${studentObj.studentClass}`,
        };
      }
      return {
        allowed: false,
        reason: `🏫 Class Teacher Restriction: "${categoryToCheck}" leaves for Class ${studentObj.studentClass} are handled by the Class Teacher or Principal.`,
      };
    }

    return { allowed: true, reason: "" };
  };

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

  const handleBulkPhotoUploadByAdNo = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setBulkUploadProgress(`Processing 0 / ${files.length} photos...`);
    let matchedCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const rawFileName = file.name.replace(/\.[^/.]+$/, "").trim();
      setBulkUploadProgress(
        `Compressing & Uploading (${i + 1} / ${files.length}): ${file.name}...`
      );

      const matchedStudent = students.find(
        (s) =>
          s.adNo.toLowerCase() === rawFileName.toLowerCase() ||
          s.regNo.toLowerCase() === rawFileName.toLowerCase()
      );
      if (!matchedStudent) continue;

      try {
        const compressedDataUrl = await compressImageFileToDataUrl(
          file,
          180,
          0.78
        );
        await setDoc(
          doc(db, "students", matchedStudent.id),
          { photoUrl: compressedDataUrl },
          { merge: true }
        );
        matchedCount++;
        setStudents((prev) =>
          prev.map((st) =>
            st.id === matchedStudent.id
              ? { ...st, photoUrl: compressedDataUrl }
              : st
          )
        );
      } catch (err) {}
    }

    setBulkUploadProgress("");
    e.target.value = null;
    alert(`✅ Uploaded and linked ${matchedCount} student photo(s)!`);
  };

  const handleSingleStudentPhotoFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressedDataUrl = await compressImageFileToDataUrl(
        file,
        180,
        0.8
      );
      setStudentPhotoInput(compressedDataUrl);
    } catch (err) {
      alert("Failed to process image file.");
    }
    e.target.value = null;
  };

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

      const isHomePass =
        String(matchingPass.destination || "").toLowerCase().includes("home") ||
        matchingPass.leaveCategory === "Monthly_Home";
      const parentPhone = [
        matchingPass.parentWhatsapp,
        studentObj?.parentWhatsapp,
        studentObj?.parentMobile,
        "",
      ].find(Boolean);
      const exitHomeMsg = [
        `*DARUL HUDA ISLAMIC UNIVERSITY (DEGREE SECTION)*`,
        `*🏠 HOME LEAVE DEPARTURE UPDATE*`,
        `--------------------------------`,
        `Assalamu Alaikum,`,
        `Your son *${matchingPass.studentName}* (Ad.No: #${matchingPass.adNo}, Class ${matchingPass.studentClass}) has checked out at the college gate at *${formatDateTime12Hour(scanTimeISO)}* to come *Home*.`,
        `⏳ *Must Return By:* ${formatDateTime12Hour(matchingPass.permittedTo, matchingPass.isOpenReturn)}`,
        `👨‍🏫 *Permitted By:* ${getOfficialTeacherName(matchingPass.teacherName)}`,
      ].join("\n");

      if (isHomePass && autoNotifyParentOnGateScan && parentPhone) {
        openDirectWhatsApp(parentPhone, exitHomeMsg);
      }

      setGateScanResult({
        allowed: true,
        actionType: "EXIT",
        parentPhone,
        parentWhatsAppMessage: isHomePass ? exitHomeMsg : null,
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
        message: "✅ GREEN SIGNAL — DEGREE SECTION STUDENT PERMITTED TO EXIT",
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

      const isHomePass =
        String(matchingPass.destination || "").toLowerCase().includes("home") ||
        matchingPass.leaveCategory === "Monthly_Home";
      const parentPhone = [
        matchingPass.parentWhatsapp,
        studentObj?.parentWhatsapp,
        studentObj?.parentMobile,
        "",
      ].find(Boolean);
      const safeReturnMsg = [
        `*DARUL HUDA ISLAMIC UNIVERSITY (DEGREE SECTION)*`,
        `*✅ SAFE CAMPUS ARRIVAL NOTIFICATION*`,
        `--------------------------------`,
        `Assalamu Alaikum,`,
        `Your son *${matchingPass.studentName}* (Ad.No: #${matchingPass.adNo}, Class ${matchingPass.studentClass}) has safely returned and checked in at the college gate at *${formatDateTime12Hour(scanTimeISO)}*.`,
      ].join("\n");

      if (isHomePass && autoNotifyParentOnGateScan && parentPhone) {
        openDirectWhatsApp(parentPhone, safeReturnMsg);
      }

      setGateScanResult({
        allowed: true,
        actionType: "ENTRY",
        parentPhone,
        parentWhatsAppMessage: isHomePass ? safeReturnMsg : null,
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
          : "✅ ARRIVAL RECORDED AT GATE — Student Safely Reached College",
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
          (p.status === "OUTSIDE" || p.status === "ARRIVED_AT_GATE")
      );
      if (activePass) {
        handleTeacherVerifyArrival(activePass);
        alert(
          `✅ Verified return of ${activePass.studentName} (#${activePass.adNo})!`
        );
      } else {
        alert(`No active pass found for scanned ID: ${code}`);
      }
    }
  };

  const handleUndoGateVerification = async (passToUndo) => {
    if (!passToUndo || !passToUndo.id) return;
    const confirmMsg = `Are you sure you want to undo the gate verification for ${passToUndo.studentName || 'student'} (#${passToUndo.adNo})?`;
    if (typeof window !== "undefined" && !window.confirm(confirmMsg)) return;

    try {
      const prevStatus = passToUndo.status;
      const passRef = doc(db, "out_passes", passToUndo.id);

      if (prevStatus === "ARRIVED_AT_GATE" || prevStatus === "RETURNED") {
        // Revert return -> student is back outside
        await updateDoc(passRef, {
          status: "OUTSIDE",
          gateArrivalTime: null,
          actualReturnTime: null,
          wasLateReturn: false,
          verifiedReturnedAt: null,
          verifiedReturnedBy: null,
        });
        setPasses(prev => prev.map(p => p.id === passToUndo.id ? {
          ...p,
          status: "OUTSIDE",
          gateArrivalTime: null,
          actualReturnTime: null,
          wasLateReturn: false
        } : p));
        alert(`↩️ Undone return verification! ${passToUndo.studentName} (#${passToUndo.adNo}) status reverted to OUTSIDE.`);
      } else if (prevStatus === "OUTSIDE") {
        // Revert exit -> student is back to approved (ready to exit)
        await updateDoc(passRef, {
          status: "APPROVED",
          gateDepartureTime: null,
          actualDepartureTime: null,
        });
        setPasses(prev => prev.map(p => p.id === passToUndo.id ? {
          ...p,
          status: "APPROVED",
          gateDepartureTime: null,
          actualDepartureTime: null
        } : p));
        alert(`↩️ Undone gate exit! ${passToUndo.studentName} (#${passToUndo.adNo}) status reverted to APPROVED (Ready to Exit).`);
      }

      if (gateScanResult && gateScanResult.pass?.id === passToUndo.id) {
        setGateScanResult(null);
      }
    } catch (err) {
      console.error("Undo error:", err);
      alert("Error undoing verification: " + err.message);
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
    if (!leaveCategory) {
      return alert("⚠️ Mandatory Step: Please select a Leave Category.");
    }
    if (!destination || !destination.trim()) {
      return alert("⚠️ Mandatory Step: Please select or enter a Destination.");
    }
    if (!purpose || !purpose.trim()) {
      return alert("⚠️ Mandatory Step: Please select or enter a Purpose / Reason for Leave.");
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
      const permCheck = evaluateLeavePermission(st, leaveCategory, fromISO, toISO);
      if (!permCheck.allowed) {
        return alert(permCheck.reason);
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

      const teacherPhoneStr = [
        myTeacherRecord?.whatsappNumber,
        myTeacherRecord?.mobileNumber,
        myTeacherRecord?.phone,
        "",
      ].find(Boolean);

      const groupBatchId =
        targetStudents.length > 1 ? `GRP-${Date.now()}` : null;

      let lastCreatedPass = null;

      for (const st of targetStudents) {
        const newPassData = {
          section: "DEGREE SECTION",
          teacherPhone: teacherPhoneStr,
          adNo: st.adNo,
          studentName: st.name,
          studentClass: st.studentClass,
          department: st.department || "GENERAL",
          state: st.state || "Kerala",
          district: st.district || "Malappuram",
          mentorUsername: st.mentorUsername || "",
          parentWhatsapp: [st.parentWhatsapp, st.parentMobile, ""].find(
            Boolean
          ) || "",
          studentEmail: st.email || "",
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
          teacherUsername: loggedUsername,
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
          extensionReason: "",
          createdAt: nowISO,
        };

        const docRef = await addDoc(collection(db, "out_passes"), newPassData);
        lastCreatedPass = { id: docRef.id, ...newPassData };
      }

      playBeep(false);
      setReceiptPass(lastCreatedPass);

      if (
        autoOpenParentWA &&
        targetStudents.length === 1 &&
        lastCreatedPass &&
        (lastCreatedPass.destination.toLowerCase().includes("home") ||
          lastCreatedPass.leaveCategory === "Monthly_Home")
      ) {
        const pPhone = [
          lastCreatedPass.parentWhatsapp,
          targetStudents[0].parentWhatsapp,
          targetStudents[0].parentMobile,
          "",
        ].find(Boolean);
        if (pPhone) {
          const homeMsg = [
            `*DARUL HUDA ISLAMIC UNIVERSITY (DEGREE SECTION)*`,
            `*🏠 HOME LEAVE NOTIFICATION FOR PARENTS*`,
            `--------------------------------`,
            `Assalamu Alaikum,`,
            `Your son *${lastCreatedPass.studentName}* (Ad.No: #${lastCreatedPass.adNo}, Class ${lastCreatedPass.studentClass}) has been permitted leave to come *Home*.`,
            `🚶‍♂️ *Leaving Campus:* ${formatDateTime12Hour(
              lastCreatedPass.permittedFrom
            )}`,
            `⏳ *Must Return By:* ${formatDateTime12Hour(
              lastCreatedPass.permittedTo,
              lastCreatedPass.isOpenReturn
            )}`,
            `👨‍🏫 *Permitted By:* ${officialTeacher}${
              teacherPhoneStr ? ` (${teacherPhoneStr})` : ""
            }`,
          ].join("\n");
          openDirectWhatsApp(pPhone, homeMsg);
        }
      }

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
    setEditExtensionReason(pass.extensionReason || "");

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
        extensionReason: editExtensionReason.trim(),
        isExtendedByClassTeacher: Boolean(editExtensionReason.trim()),
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

  // One-Click Bulk Return for Class Teacher's Monthly Home Leave
  const handleBulkVerifyClassReturn = async () => {
    const myClasses = hasPrincipalPower
      ? classFilter !== "ALL"
        ? [classFilter]
        : ["QH1", "AL1", "FC1", "QH2", "AL2", "FC2", "QLA3", "HFC3"]
      : myPrivileges.classTeacherOf || [];

    const activeToReturn = passes.filter(
      (p) =>
        (myClasses.includes(p.studentClass) ||
          (myPrivileges.isNiicsCoordinator &&
            String(p.adNo || "")
              .toUpperCase()
              .startsWith("U"))) &&
        (p.status === "OUTSIDE" ||
          p.status === "ARRIVED_AT_GATE" ||
          p.status === "APPROVED")
    );

    if (activeToReturn.length === 0) {
      return alert("No active out-passes found for your class.");
    }
    if (
      !window.confirm(
        `Mark all ${activeToReturn.length} active students in your scope as RETURNED?`
      )
    ) {
      return;
    }

    const verifyISO = new Date().toISOString();
    await Promise.all(
      activeToReturn.map((p) =>
        updateDoc(doc(db, "out_passes", p.id), {
          status: "RETURNED",
          actualReturnTime: p.gateArrivalTime || verifyISO,
          teacherVerifiedTime: verifyISO,
          returnClerkName: getOfficialTeacherName(staffName) || "Teacher",
        })
      )
    );
    playBeep(false);
    alert(`✅ Marked ${activeToReturn.length} students as Returned!`);
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
          requiresPrincipalApproval: Boolean(studentPrincipalLock),
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
                requiresPrincipalApproval: Boolean(studentPrincipalLock),
              }
            : s
        )
      );
      setEditingStudentSettings(null);
      alert("✅ Student photo, Principal lock & disciplinary leave settings updated!");
    } catch (err) {
      alert("Failed to save settings: " + err.message);
    } finally {
      setSavingStudentSettings(false);
    }
  };

  const buildPassWhatsAppText = (pass) =>
    [
      `*DARUL HUDA ISLAMIC UNIVERSITY (DEGREE SECTION)*`,
      `*STUDENTS' DIGITAL OUT-PASS (SMS)*`,
      `--------------------------------`,
      `👤 *Student:* ${pass.studentName}`,
      `🆔 *Ad.No:* #${pass.adNo} | *Class:* ${pass.studentClass} (Degree Section)`,
      `🏷️ *Category:* ${pass.leaveCategory || "General"}`,
      `📍 *Destination:* ${pass.destination}`,
      `📝 *Reason:* ${pass.purpose}`,
      `🚶‍♂️ *Permitted From:* ${formatDateTime12Hour(pass.permittedFrom)}`,
      `⏳ *Return By:* ${formatDateTime12Hour(
        pass.permittedTo,
        pass.isOpenReturn
      )}`,
      `👨‍🏫 *Permitted By:* ${getOfficialTeacherName(pass.teacherName)}${
        pass.teacherPhone ? ` (📞 ${pass.teacherPhone})` : ""
      }`,
      `📌 *Status:* ${pass.status}`,
    ].join("\n");

  const handleShareWhatsApp = (pass) => {
    const st = getStudentByAdNo(pass.adNo);
    const parentPhone = [
      pass.parentWhatsapp,
      st?.parentWhatsapp,
      st?.parentMobile,
      "",
    ].find(Boolean);
    openDirectWhatsApp(parentPhone, buildPassWhatsAppText(pass));
  };

  const handleExportCSV = (rowsToExport) => {
    const listToUse = rowsToExport ? rowsToExport : passes;
    const headers = [
      "Section",
      "Ad.No",
      "Student Name",
      "Class",
      "Department",
      "District",
      "State",
      "Mentor",
      "Leave Category",
      "Destination",
      "Reason",
      "Permitted Teacher",
      "Teacher Phone",
      "Permitted From",
      "Permitted To",
      "Gate Exit Time",
      "Gate Return Time",
      "Teacher Verified Time",
      "Extension Note",
      "Status",
    ];
    const rows = listToUse.map((p) => {
      const st = getStudentByAdNo(p.adNo);
      const destStr = p.destination ? p.destination : "";
      const purpStr = p.purpose ? p.purpose : "";
      const gateExit = p.gateDepartureTime
        ? p.gateDepartureTime
        : p.actualDepartureTime;
      const gateReturn = p.gateArrivalTime
        ? p.gateArrivalTime
        : p.actualReturnTime;
      return [
        "DEGREE SECTION",
        p.adNo,
        `"${(p.studentName ? p.studentName : "").replace(/"/g, '""')}"`,
        p.studentClass,
        p.department ? p.department : st?.department ? st.department : "",
        p.district ? p.district : st?.district ? st.district : "",
        p.state ? p.state : st?.state ? st.state : "",
        p.mentorUsername
          ? p.mentorUsername
          : st?.mentorUsername
          ? st.mentorUsername
          : "",
        p.leaveCategory ? p.leaveCategory : "General",
        `"${destStr.replace(/"/g, '""')}"`,
        `"${purpStr.replace(/"/g, '""')}"`,
        `"${getOfficialTeacherName(p.teacherName).replace(/"/g, '""')}"`,
        p.teacherPhone || "",
        `"${formatDateTime12Hour(p.permittedFrom)}"`,
        `"${formatDateTime12Hour(p.permittedTo, p.isOpenReturn)}"`,
        `"${formatDateTime12Hour(gateExit)}"`,
        `"${formatDateTime12Hour(gateReturn)}"`,
        `"${formatDateTime12Hour(p.teacherVerifiedTime)}"`,
        `"${(p.extensionReason || "").replace(/"/g, '""')}"`,
        p.status,
      ];
    });
    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute(
      "download",
      `DHIU_Degree_OutPass_${adminReportType}_${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Scope passes for Teacher Desk (includes Class Teacher's class & NIICS Coordinator's Urdu students)
  const myPermittedPasses = passes.filter((p) => {
    if (currentUser?.uid && p.teacherId === currentUser.uid) return true;
    if (p.teacherUsername && p.teacherUsername === loggedUsername) return true;
    if (
      (myPrivileges.classTeacherOf || []).length > 0 &&
      myPrivileges.classTeacherOf.includes(p.studentClass)
    ) {
      return true;
    }
    if (
      myPrivileges.isNiicsCoordinator &&
      String(p.adNo || "")
        .toUpperCase()
        .startsWith("U")
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
      const st = getStudentByAdNo(p.adNo);
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
        deptFilter !== "ALL" &&
        (p.department || st?.department || "GENERAL") !== deptFilter
      )
        return false;
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
      if (
        mentorFilter !== "ALL" &&
        (p.mentorUsername || st?.mentorUsername || "") !== mentorFilter
      )
        return false;
      if (
        stateFilter !== "ALL" &&
        (p.state || st?.state || "Kerala") !== stateFilter
      )
        return false;
      if (
        districtFilter !== "ALL" &&
        (p.district || st?.district || "Malappuram") !== districtFilter
      )
        return false;
      if (
        destinationFilter !== "ALL" &&
        (p.destination || "").toLowerCase() !== destinationFilter.toLowerCase()
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

  const allDepartments = [
    "ALL",
    ...Array.from(new Set(students.map((s) => s.department))).filter(Boolean),
  ];

  const allTeachers = [
    "ALL",
    ...Array.from(
      new Set(passes.map((p) => getOfficialTeacherName(p.teacherName)))
    ).filter(Boolean),
  ];

  const allDestinations = [
    "ALL",
    ...Array.from(
      new Set([...PRESET_DESTINATIONS, ...passes.map((p) => p.destination)])
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

  const activePermissionCheck = selectedStudent
    ? evaluateLeavePermission(
        selectedStudent,
        leaveCategory,
        partsToISOString(fromDate, fromHour, fromMinute, fromAmpm),
        isOpenReturn
          ? null
          : partsToISOString(toDate, toHour, toMinute, toAmpm)
      )
    : { allowed: true, reason: "" };

  if (!embeddedMode && !authChecking && !currentUser && !isAdmin && !isSecurityKiosk) {
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
            Out-Pass Portal Access (Degree Section)
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
                onClick={async () => {
                  if (securityPinInput === SECURITY_KIOSK_PIN) {
                    const kioskPass = `Kiosk#${SECURITY_KIOSK_PIN}!`;
                    try {
                      await signInWithEmailAndPassword(
                        auth,
                        "kiosk@school.com",
                        kioskPass
                      );
                    } catch (e) {
                      try {
                        await createUserWithEmailAndPassword(
                          auth,
                          "kiosk@school.com",
                          kioskPass
                        );
                      } catch (err) {}
                    }
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

  return (
    <div
      className="op-root"
      style={
        embeddedMode
          ? { fontFamily: "inherit", color: "#0f172a" }
          : styles.pageWrapper
      }
    >
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

      {portfolioModalStudent && (
        <StudentPortfolioModal
          student={portfolioModalStudent}
          canEditSkills={Boolean(
            isAdmin ||
              hasPrincipalPower ||
              myPrivileges.isNiicsCoordinator ||
              portfolioModalStudent.mentorUsername === loggedUsername ||
              (myPrivileges.classTeacherOf || []).includes(
                portfolioModalStudent.studentClass
              )
          )}
          canViewConfidential={Boolean(
            isAdmin ||
              hasPrincipalPower ||
              myPrivileges.isNiicsCoordinator ||
              myPrivileges.isOutreachCoordinator ||
              portfolioModalStudent.mentorUsername === loggedUsername ||
              (myPrivileges.classTeacherOf || []).includes(
                portfolioModalStudent.studentClass
              )
          )}
          editorName={getOfficialTeacherName(staffName)}
          onClose={() => setPortfolioModalStudent(null)}
          onSaved={(updatedSt) =>
            setStudents((prev) =>
              prev.map((s) => (s.regNo === updatedSt.regNo ? updatedSt : s))
            )
          }
        />
      )}

      <OutpassModals
        scannerOpen={scannerOpen}
        setScannerOpen={setScannerOpen}
        zoomPhotoStudent={zoomPhotoStudent}
        setZoomPhotoStudent={setZoomPhotoStudent}
        receiptPass={receiptPass}
        setReceiptPass={setReceiptPass}
        getStudentPhotoByAdNo={getStudentPhotoByAdNo}
        getOfficialTeacherName={getOfficialTeacherName}
        handleShareWhatsApp={handleShareWhatsApp}
        getStudentByAdNo={getStudentByAdNo}
        buildPassWhatsAppText={buildPassWhatsAppText}
        editingPass={editingPass}
        setEditingPass={setEditingPass}
        handleSaveEditedPass={handleSaveEditedPass}
        editLeaveCategory={editLeaveCategory}
        setEditLeaveCategory={setEditLeaveCategory}
        editDestination={editDestination}
        setEditDestination={setEditDestination}
        editPurpose={editPurpose}
        setEditPurpose={setEditPurpose}
        editExtensionReason={editExtensionReason}
        setEditExtensionReason={setEditExtensionReason}
        editFromDate={editFromDate}
        setEditFromDate={setEditFromDate}
        editFromHour={editFromHour}
        setEditFromHour={setEditFromHour}
        editFromMinute={editFromMinute}
        setEditFromMinute={setEditFromMinute}
        editFromAmpm={editFromAmpm}
        setEditFromAmpm={setEditFromAmpm}
        editIsOpenReturn={editIsOpenReturn}
        setEditIsOpenReturn={setEditIsOpenReturn}
        editToDate={editToDate}
        setEditToDate={setEditToDate}
        editToHour={editToHour}
        setEditToHour={setEditToHour}
        editToMinute={editToMinute}
        setEditToMinute={setEditToMinute}
        editToAmpm={editToAmpm}
        setEditToAmpm={setEditToAmpm}
        savingEdit={savingEdit}
      />

      <div style={embeddedMode ? {} : styles.container}>
        {/* Only render standalone dark-green header if NOT embedded inside Main App */}
        {!embeddedMode && (
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
                  DARUL HUDA ISLAMIC UNIVERSITY • DEGREE SECTION
                </div>
                <h1 style={styles.title}>
                  {isAdmin
                    ? "Degree Section Out-Pass Command & Reports"
                    : isSecurityKiosk
                    ? "Degree Section Gate Verification Kiosk"
                    : "Degree Section Leave Permission Desk"}
                </h1>
              </div>
            </div>

            <div style={styles.headerRight}>
              <div style={styles.userPill}>
                <span style={styles.roleDot(hasPrincipalPower)} />
                <strong style={{ color: "#ffffff", fontSize: 13 }}>
                  {getOfficialTeacherName(staffName)}
                </strong>
              </div>
              <Link href="/" style={styles.backBtn}>
                ← Main ERP Portal
              </Link>
            </div>
          </header>
        )}

        {/* COMPACT SUB-NAVIGATION BAR */}
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
                <span>👨‍🏫 Permit Student Leave Desk</span>
                <span
                  style={
                    activeTab === "teacher"
                      ? styles.tabCounterActive
                      : styles.tabCounterInactive
                  }
                >
                  {myOutsideCount} Active
                </span>
              </button>
            )}

            {canSeeReportsTab && (
              <button
                type="button"
                onClick={() => setActiveTab("admin")}
                style={
                  activeTab === "admin"
                    ? styles.mainTabActive
                    : styles.mainTabInactive
                }
              >
                <span>📊 Live Campus &amp; 14 Reports</span>
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

            {isAdmin && (
              <>
                <button
                  type="button"
                  onClick={() => setActiveTab("settings")}
                  style={
                    activeTab === "settings"
                      ? styles.mainTabActive
                      : styles.mainTabInactive
                  }
                >
                  <span>📸 Photos (Ad.No) &amp; Leave Locks</span>
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
                  <span>🛡️ Security Gate Kiosk</span>
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

        {/* TAB 1: TEACHER DESK + MONTHLY HOME LEAVE */}
        {activeTab === "teacher" && (
          <OutpassTeacherDesk
            myPrivileges={myPrivileges}
            hasPrincipalPower={hasPrincipalPower}
            classFilter={classFilter}
            students={students}
            passes={passes}
            isGroupMode={isGroupMode}
            setIsGroupMode={setIsGroupMode}
            selectedStudent={selectedStudent}
            setSelectedStudent={setSelectedStudent}
            selectedGroupStudents={selectedGroupStudents}
            setSelectedGroupStudents={setSelectedGroupStudents}
            leaveCategory={leaveCategory}
            setLeaveCategory={setLeaveCategory}
            destination={destination}
            setDestination={setDestination}
            purpose={purpose}
            setPurpose={setPurpose}
            applyDaysDuration={applyDaysDuration}
            applyHoursDuration={applyHoursDuration}
            applyUntilEvening={applyUntilEvening}
            isPassOverdue={isPassOverdue}
            getOfficialTeacherName={getOfficialTeacherName}
            staffName={staffName}
            handleBulkVerifyClassReturn={handleBulkVerifyClassReturn}
            autoOpenParentWA={autoOpenParentWA}
            setAutoOpenParentWA={setAutoOpenParentWA}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            setScannerMode={setScannerMode}
            setScannerOpen={setScannerOpen}
            matchingStudents={matchingStudents}
            getActivePassForStudent={getActivePassForStudent}
            setZoomPhotoStudent={setZoomPhotoStudent}
            setPortfolioModalStudent={setPortfolioModalStudent}
            getMonthlyOutCount={getMonthlyOutCount}
            activePermissionCheck={activePermissionCheck}
            handleIssuePass={handleIssuePass}
            activeDurationChip={activeDurationChip}
            isOpenReturn={isOpenReturn}
            setIsOpenReturn={setIsOpenReturn}
            fromDate={fromDate}
            setFromDate={setFromDate}
            fromHour={fromHour}
            setFromHour={setFromHour}
            fromMinute={fromMinute}
            setFromMinute={setFromMinute}
            onMinuteChange={setFromMinute}
            fromAmpm={fromAmpm}
            setFromAmpm={setFromAmpm}
            toDate={toDate}
            setToDate={setToDate}
            toHour={toHour}
            setToHour={setToHour}
            toMinute={toMinute}
            setToMinute={setToMinute}
            toAmpm={toAmpm}
            setToAmpm={setToAmpm}
            isAdmin={isAdmin}
            selectedTeacherOverride={selectedTeacherOverride}
            setSelectedTeacherOverride={setSelectedTeacherOverride}
            teachersList={teachersList}
            submitting={submitting}
            myPermittedPasses={myPermittedPasses}
            myOutsideCount={myOutsideCount}
            myUnverifiedCount={myUnverifiedCount}
            myReturnedCount={myReturnedCount}
            teacherStatusFilter={teacherStatusFilter}
            setTeacherStatusFilter={setTeacherStatusFilter}
            teacherSearch={teacherSearch}
            setTeacherSearch={setTeacherSearch}
            filteredTeacherPasses={filteredTeacherPasses}
            getStudentPhotoByAdNo={getStudentPhotoByAdNo}
            getStudentByAdNo={getStudentByAdNo}
            getRemainingTimeText={getRemainingTimeText}
            now={now}
            handleShareWhatsApp={handleShareWhatsApp}
            setReceiptPass={setReceiptPass}
            openEditPassModal={openEditPassModal}
            handleTeacherVerifyArrival={handleTeacherVerifyArrival}
            handleCancelPass={handleCancelPass}
          />
        )}

        {/* TAB 2: SECURITY GATE SCANNER KIOSK */}
        {activeTab === "security" && (isAdmin || isSecurityKiosk) && (
          <OutpassSecurityKiosk
            gateInputRef={gateInputRef}
            gateBarcodeInput={gateBarcodeInput}
            setGateBarcodeInput={setGateBarcodeInput}
            processSecurityGateScan={processSecurityGateScan}
            handleUndoGateVerification={handleUndoGateVerification}
            setScannerMode={setScannerMode}
            setScannerOpen={setScannerOpen}
            gateScanResult={gateScanResult}
            getStudentPhotoByAdNo={getStudentPhotoByAdNo}
            getOfficialTeacherName={getOfficialTeacherName}
            passes={passes}
            setZoomPhotoStudent={setZoomPhotoStudent}
            autoNotifyParentOnGateScan={autoNotifyParentOnGateScan}
            setAutoNotifyParentOnGateScan={setAutoNotifyParentOnGateScan}
          />
        )}

        {/* TAB 3: ADMIN LIVE DASHBOARD & 14 COMPREHENSIVE REPORTS */}
        {activeTab === "admin" && canSeeReportsTab && (
          <OutpassAdminReports
            students={students}
            insideStudents={insideStudents}
            currentlyOutsidePasses={currentlyOutsidePasses}
            overduePasses={overduePasses}
            unverifiedArrivalPasses={unverifiedArrivalPasses}
            longLeave5DaysPasses={longLeave5DaysPasses}
            unapprovedLogs={unapprovedLogs}
            passes={passes}
            adminReportType={adminReportType}
            setAdminReportType={setAdminReportType}
            handleLoadFullHistoryForAdmin={handleLoadFullHistoryForAdmin}
            loadingOlderHistory={loadingOlderHistory}
            handleExportCSV={handleExportCSV}
            getFilteredAdminPasses={getFilteredAdminPasses}
            adminSearch={adminSearch}
            setAdminSearch={setAdminSearch}
            reportStartDate={reportStartDate}
            setReportStartDate={setReportStartDate}
            reportEndDate={reportEndDate}
            setReportEndDate={setReportEndDate}
            classFilter={classFilter}
            setClassFilter={setClassFilter}
            allClasses={allClasses}
            deptFilter={deptFilter}
            setDeptFilter={setDeptFilter}
            allDepartments={allDepartments}
            categoryFilter={categoryFilter}
            setCategoryFilter={setCategoryFilter}
            teacherFilter={teacherFilter}
            setTeacherFilter={setTeacherFilter}
            allTeachers={allTeachers}
            mentorFilter={mentorFilter}
            setMentorFilter={setMentorFilter}
            teachersList={teachersList}
            stateFilter={stateFilter}
            setStateFilter={setStateFilter}
            districtFilter={districtFilter}
            setDistrictFilter={setDistrictFilter}
            destinationFilter={destinationFilter}
            setDestinationFilter={setDestinationFilter}
            allDestinations={allDestinations}
            mealCheckDate={mealCheckDate}
            setMealCheckDate={setMealCheckDate}
            mealCheckHour={mealCheckHour}
            setMealCheckHour={setMealCheckHour}
            mealCheckMinute={mealCheckMinute}
            setMealCheckMinute={setMealCheckMinute}
            mealCheckAmpm={mealCheckAmpm}
            setMealCheckAmpm={setMealCheckAmpm}
            mealCheckTargetISO={mealCheckTargetISO}
            mealTimeAbsentPasses={mealTimeAbsentPasses}
            getFrequentAnalysis={getFrequentAnalysis}
            getStudentPhotoByAdNo={getStudentPhotoByAdNo}
            getStudentByAdNo={getStudentByAdNo}
            setZoomPhotoStudent={setZoomPhotoStudent}
            getMonthlyOutCount={getMonthlyOutCount}
            setPortfolioModalStudent={setPortfolioModalStudent}
            getOfficialTeacherName={getOfficialTeacherName}
            now={now}
            handleShareWhatsApp={handleShareWhatsApp}
            openEditPassModal={openEditPassModal}
            handleTeacherVerifyArrival={handleTeacherVerifyArrival}
          />
        )}

        {/* TAB 4: ADMIN PHOTO UPLOAD (BY AD.NO) & DISCIPLINARY BLOCKS */}
        {activeTab === "settings" && isAdmin && (
          <OutpassSettingsTab
            bulkUploadProgress={bulkUploadProgress}
            handleBulkPhotoUploadByAdNo={handleBulkPhotoUploadByAdNo}
            settingsSearch={settingsSearch}
            setSettingsSearch={setSettingsSearch}
            editingStudentSettings={editingStudentSettings}
            setEditingStudentSettings={setEditingStudentSettings}
            handleSaveStudentDisciplinarySettings={
              handleSaveStudentDisciplinarySettings
            }
            studentPhotoInput={studentPhotoInput}
            setStudentPhotoInput={setStudentPhotoInput}
            handleSingleStudentPhotoFile={handleSingleStudentPhotoFile}
            studentPrincipalLock={studentPrincipalLock}
            setStudentPrincipalLock={setStudentPrincipalLock}
            studentBlockedCategories={studentBlockedCategories}
            setStudentBlockedCategories={setStudentBlockedCategories}
            studentBlockReason={studentBlockReason}
            setStudentBlockReason={setStudentBlockReason}
            savingStudentSettings={savingStudentSettings}
            students={students}
          />
        )}
      </div>
    </div>
  );
}