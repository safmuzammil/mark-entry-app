/**
 * DHIU Mark Entry Google Apps Script Sync Engine
 * Optimized for O(1) Class Routing, Formula Protection, and Curricular Disambiguation
 * Sheets: QH1, AL1, FC1, QH2, AL2, FC2, QLA3, HFC3
 *
 * Instructions:
 * 1. Open your Google Spreadsheet (e.g. CCE Marklist).
 * 2. Go to Extensions > Apps Script.
 * 3. Replace all existing code in Code.gs with this code.
 * 4. Click Deploy > New deployment > Select type: Web app.
 * 5. Set "Execute as: Me" and "Who has access: Anyone".
 * 6. Click Deploy, copy the Web app URL, and ensure it is saved in your .env as GOOGLE_SCRIPT_WEB_APP_URL.
 */

function doPost(e) {
  var lock = LockService.getScriptLock();
  var hasLock = false;
  try {
    // Acquire lock for up to 6 seconds to prevent write collision under concurrent submissions
    hasLock = lock.tryLock(6000);
    if (!hasLock) {
      return responseJSON({ status: 'error', message: 'Sheet busy: Concurrent write in progress. Please retry.' });
    }

    var startTime = new Date().getTime();
    var data = JSON.parse(e.postData.contents);
    var marksList = data.marks || [];

    if (!marksList.length) {
      return responseJSON({ status: 'error', message: 'Payload contains no mark entries.' });
    }

    // Extract batch-level metadata
    var batchSubject = String(data.subject || marksList[0].subject || '').trim();
    var batchMaxMarks = String(data.maxMarks || marksList[0].maxMarks || '').trim();
    var targetClass = String(data.targetClass || marksList[0].targetClass || marksList[0].class || '').trim().toUpperCase();

    // 1. Skip Specialization (Takassus / 30 max) from Google Sheets sync
    if (batchSubject.toUpperCase().includes('SPECIALIZATION') || batchMaxMarks === '30') {
      return responseJSON({
        status: 'success',
        message: 'Specialization marks preserved in Firebase (Sheet write skipped by design).'
      });
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = targetClass ? ss.getSheetByName(targetClass) : null;

    // Fallback: If targetClass is not supplied or invalid, resolve by scanning known sheets
    var KNOWN_CLASSES = ['QH1', 'AL1', 'FC1', 'QH2', 'AL2', 'FC2', 'QLA3', 'HFC3'];
    if (!sheet) {
      for (var k = 0; k < KNOWN_CLASSES.length; k++) {
        var s = ss.getSheetByName(KNOWN_CLASSES[k]);
        if (s) {
          sheet = s;
          break;
        }
      }
    }

    if (!sheet) {
      return responseJSON({ status: 'error', message: 'Target class sheet not found: "' + targetClass + '"' });
    }

    // 2. Single-Pass Ingestion: Ingest values and formulas once (2 RPCs total)
    var dataRange = sheet.getDataRange();
    var values = dataRange.getValues();
    var formulas = dataRange.getFormulas();
    var numRows = values.length;
    var numCols = values[0].length;

    if (numRows < 4) {
      return responseJSON({ status: 'error', message: 'Sheet format invalid: Fewer than 4 rows found.' });
    }

    // Row Index Mapping:
    // Row 1 (Index 0): Merged subject group numbers (1, 2, 3...)
    // Row 2 (Index 1): Subject names (THAFSEER, HADITH, FIQH, U :FIQH, etc.)
    // Row 3 (Index 2): Sub-levels (15, 20, 25, 40, 100, 30, Current Status)
    // Row 4+ (Index 3+): Student data rows
    var subjectRow = values[1];
    var maxMarkRow = values[2];
    var targetColIndex = -1;
    var currentSubject = '';

    for (var c = 5; c < numCols; c++) {
      var topCell = String(subjectRow[c] || '').trim();
      if (topCell !== '') {
        currentSubject = topCell;
      }

      var subHeader = String(maxMarkRow[c] || '').trim();

      if (isMatchingSubject(currentSubject, batchSubject) && isMatchingLevel(subHeader, batchMaxMarks)) {
        targetColIndex = c;
        break;
      }
    }

    if (targetColIndex === -1) {
      return responseJSON({
        status: 'error',
        message: 'Column not found for Subject: "' + batchSubject + '" and Level: "' + batchMaxMarks + '" in sheet ' + sheet.getName()
      });
    }

    // 3. Formula Shielding: Confirm target column does not contain formula cells
    for (var r = 3; r < numRows; r++) {
      if (formulas[r][targetColIndex] !== '') {
        return responseJSON({
          status: 'error',
          message: 'Safety Abort: Target column index ' + (targetColIndex + 1) + ' contains a formula at Row ' + (r + 1) + '. Overwrite prevented.'
        });
      }
    }

    // 4. In-Memory Student Indexing (Col B [1]: Reg.no, Col C [2]: Ad.No)
    var regMap = {};
    var adMap = {};
    for (var r = 3; r < numRows; r++) {
      var rReg = normalizeId(values[r][1]);
      var rAd = normalizeId(values[r][2]);
      if (rReg) regMap[rReg] = r;
      if (rAd) adMap[rAd] = r;
    }

    // 5. Targeted Cell Updates
    var updatedCount = 0;
    for (var i = 0; i < marksList.length; i++) {
      var item = marksList[i];
      var sReg = normalizeId(item.regNo || item.studentId);
      var sAd = normalizeId(item.adNo);

      var targetRow = (sReg && regMap[sReg] !== undefined)
        ? regMap[sReg]
        : (sAd && adMap[sAd] !== undefined ? adMap[sAd] : -1);

      if (targetRow !== -1) {
        var rawScore = item.score !== undefined ? item.score : item.marksObtained;
        var cellVal = (rawScore === '' || rawScore === null || rawScore === undefined)
          ? ''
          : (isNaN(Number(rawScore)) ? rawScore : Number(rawScore));

        sheet.getRange(targetRow + 1, targetColIndex + 1).setValue(cellVal);
        updatedCount++;
      }
    }

    var elapsed = new Date().getTime() - startTime;
    return responseJSON({
      status: 'success',
      sheet: sheet.getName(),
      updatedCount: updatedCount,
      executionTimeMs: elapsed
    });

  } catch (err) {
    return responseJSON({ status: 'error', message: err.toString() });
  } finally {
    if (hasLock) {
      lock.releaseLock();
    }
  }
}

// === Normalization & Matching Logic ===

function normalizeId(id) {
  if (!id) return '';
  return String(id).replace(/[^0-9A-Z]/gi, '').toUpperCase();
}

function isMatchingSubject(sheetSubRaw, payloadSubRaw) {
  var s = String(sheetSubRaw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  var p = String(payloadSubRaw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  // 1. Strict Fiqh vs Usulul Fiqh separation
  var isPayloadUsul = p.indexOf('UFIQH') !== -1 || p.indexOf('USUL') !== -1;
  var isSheetUsul = s.indexOf('UFIQH') !== -1 || s.indexOf('USUL') !== -1;

  if (isPayloadUsul || isSheetUsul) {
    return isPayloadUsul && isSheetUsul;
  }
  if (p === 'FIQH') {
    return s === 'FIQH';
  }

  // 2. Logic vs Mantiq aliasing
  if (p === 'LOGIC' || p === 'MANTIQ') {
    return s === 'LOGIC' || s === 'MANTIQ';
  }

  // 3. Social Science normalization
  if (p.indexOf('SOCIAL') !== -1 || p.indexOf('SOC') !== -1) {
    return s.indexOf('SOCIAL') !== -1 || s.indexOf('SOC') !== -1 || s.indexOf('SCIENCE') !== -1;
  }

  return s === p;
}

function isMatchingLevel(sheetLevelRaw, payloadLevelRaw) {
  var s = String(sheetLevelRaw || '').trim().replace(/[^0-9_]/g, '');
  var p = String(payloadLevelRaw || '').trim().replace(/[^0-9_]/g, '');

  // 1. Hifz Multi-Part Handling (50_1 and 50_2)
  if (p === '50_1' || p === '501') {
    return s === '50_1' || s === '501' || s === '50';
  }
  if (p === '50_2' || p === '502') {
    return s === '50_2' || s === '502';
  }

  // 2. Standard CCE Levels (15, 20, 25, 40)
  return s === p && s !== '';
}

function responseJSON(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// === Preserved Master GET Action Handlers ===

function doGet(e) {
  var action = e.parameter.action;
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // ==========================================
  // ACTION 1: Get Marks for Teacher Portal
  // ==========================================
  if (action === 'getClassMarks') {
    var subject = String(e.parameter.subject || '');
    var maxMarks = String(e.parameter.maxMarks || '');
    var marksMap = {};
    var sheets = ss.getSheets();

    for (var s = 0; s < sheets.length; s++) {
      var sheet = sheets[s];
      if (sheet.getName() === "Marks") continue;
      var grid = sheet.getDataRange().getValues();
      if (grid.length < 4) continue;

      var subjectRow = grid[1];
      var maxMarkRow = grid[2];
      var targetCol = -1;
      var currentSubject = "";

      for (var c = 5; c < maxMarkRow.length; c++) {
        if (subjectRow[c] && String(subjectRow[c]).trim() !== "") {
          currentSubject = String(subjectRow[c]).replace(/[\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
        }
        var cleanMaxMark = String(maxMarkRow[c]).replace(/[\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
        if (isMatchingSubject(currentSubject, subject) && isMatchingLevel(cleanMaxMark, maxMarks)) {
          targetCol = c;
          break;
        }
      }

      if (targetCol === -1) continue;

      for (var r = 3; r < grid.length; r++) {
        var studentId = String(grid[r][1] || grid[r][2] || '').trim();
        if (studentId !== "") marksMap[studentId] = grid[r][targetCol];
      }
    }
    return responseJSON({ status: 'success', data: marksMap });
  }

  // ==========================================
  // ACTION 2: Get Detailed Marks for Student Portal
  // ==========================================
  if (action === 'getStudentMarks') {
    var studentId = normalizeId(e.parameter.studentId);
    var subjectList = [];
    var overallData = { total1400: "-", total490: "-", rank: "-", overallStatus: "-" };
    var sheets = ss.getSheets();

    for (var s = 0; s < sheets.length; s++) {
      var sheet = sheets[s];
      if (sheet.getName() === "Marks") continue;
      var data = sheet.getDataRange().getDisplayValues();
      if (data.length < 4) continue;

      var subjectRow = data[1];
      var taskRow = data[2];

      for (var r = 3; r < data.length; r++) {
        var rowRegNo = normalizeId(data[r][1]);
        var rowAdNo = normalizeId(data[r][2]);
        if (rowRegNo === studentId || rowAdNo === studentId) {
          var currentSubject = "Unknown";
          var subjectDataMap = {};

          for (var c = 5; c < taskRow.length; c++) {
            if (subjectRow[c] && String(subjectRow[c]).trim() !== "") {
              currentSubject = String(subjectRow[c]).replace(/[\n\r]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
              if (!currentSubject.includes("TOTAL") && !subjectDataMap[currentSubject]) {
                subjectDataMap[currentSubject] = { assessments: {}, total100: "-", total30: "-", status: "-" };
              }
            }

            var colHeader = String(taskRow[c]).replace(/[\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
            var colHeaderUpper = colHeader.toUpperCase();
            var obtainedMark = data[r][c].trim();
            if (colHeader === "") continue;

            if (currentSubject.includes("TOTAL")) {
              if (colHeaderUpper.includes("1400")) overallData.total1400 = obtainedMark !== "" ? obtainedMark : "-";
              else if (colHeaderUpper.includes("490") || colHeaderUpper.includes("420")) overallData.total490 = obtainedMark !== "" ? obtainedMark : "-";
              else if (colHeaderUpper.includes("RANK")) overallData.rank = obtainedMark !== "" ? obtainedMark : "-";
              else if (colHeaderUpper.includes("STATUS")) overallData.overallStatus = obtainedMark !== "" ? obtainedMark : "-";
            } else {
              if (colHeader === "100") subjectDataMap[currentSubject].total100 = obtainedMark !== "" ? obtainedMark : "-";
              else if (colHeader === "30") subjectDataMap[currentSubject].total30 = obtainedMark !== "" ? obtainedMark : "-";
              else if (colHeaderUpper.includes("STATUS")) subjectDataMap[currentSubject].status = obtainedMark !== "" ? obtainedMark : "-";
              else subjectDataMap[currentSubject].assessments[colHeader] = obtainedMark !== "" ? obtainedMark : "-";
            }
          }

          Object.keys(subjectDataMap).forEach(function(sub) {
            subjectList.push(Object.assign({ subject: sub }, subjectDataMap[sub]));
          });
          break;
        }
      }
    }
    return responseJSON({ status: 'success', data: { subjects: subjectList, overall: overallData } });
  }

  // ==========================================
  // ACTION 3: Get Master Report Data (For Admin Advanced Export)
  // ==========================================
  if (action === 'getAllAdminReportData') {
    var reportData = {};
    var sheets = ss.getSheets();

    for (var s = 0; s < sheets.length; s++) {
      var sheet = sheets[s];
      if (sheet.getName() === "Marks") continue;
      var data = sheet.getDataRange().getDisplayValues();
      if (data.length < 4) continue;

      var subjectRow = data[1];
      var taskRow = data[2];

      var colMap = { subjects: {}, totals: {} };
      var currentSub = "";

      for (var c = 5; c < taskRow.length; c++) {
        if (subjectRow[c] && String(subjectRow[c]).trim() !== "") {
          currentSub = String(subjectRow[c]).replace(/[\n\r]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
        }
        var header = String(taskRow[c]).replace(/[\n\r]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
        if (!header) continue;

        if (currentSub.includes("TOTAL")) {
          if (header.includes("1400")) colMap.totals["1400"] = c;
          else if (header.includes("490") || header.includes("420")) colMap.totals["490"] = c;
          else if (header.includes("STATUS")) colMap.totals["STATUS"] = c;
        } else {
          if (header === "100") colMap.subjects[currentSub] = c;
        }
      }

      for (var r = 3; r < data.length; r++) {
        var regNo = String(data[r][1] || '').trim();
        var adNo = String(data[r][2] || '').trim();
        var studentKey = regNo || adNo;
        if (studentKey !== "") {
          var scores = { overall: {}, subjects: {} };
          if (colMap.totals["1400"]) scores.overall["1400"] = data[r][colMap.totals["1400"]];
          if (colMap.totals["490"]) scores.overall["490"] = data[r][colMap.totals["490"]];
          if (colMap.totals["STATUS"]) scores.overall["STATUS"] = data[r][colMap.totals["STATUS"]];

          Object.keys(colMap.subjects).forEach(function(sub) {
            scores.subjects[sub] = data[r][colMap.subjects[sub]];
          });
          if (regNo) reportData[regNo] = scores;
          if (adNo) reportData[adNo] = scores;
        }
      }
    }
    return responseJSON({ status: 'success', data: reportData });
  }

  return responseJSON({ status: 'error', message: 'Invalid action parameter' });
}
