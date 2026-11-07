import { NextResponse } from 'next/server';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../../lib/firebase'; 

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Official current Gemini Flash models on the Google AI Studio Free Tier
// Free Tier Limits: 15 Requests Per Minute (RPM), 1,000,000 TPM, 1,500 Requests Per Day (RPD)
// 50-100 chats a day uses < 7% of the free quota!
const PRIMARY_MODEL = "gemini-2.5-flash";
const FALLBACK_MODEL = "gemini-1.5-flash";

const queryStudentDatabaseDeclaration = {
  name: "queryStudentDatabase",
  description: "Analyzes the school database for student marks, attendance shortage, period attendance, teacher status, and performance rankings.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      classGroup: { 
        type: SchemaType.STRING, 
        description: "Optional specific class group (e.g., QLA3, HFC3, FC1, FC2)" 
      },
      analysisCategory: {
        type: SchemaType.STRING,
        description: "Category to analyze: 'attendance_shortage' (<85% attendance and chronic absenteeism), 'attendance_overview' (overall attendance stats, full attendance, absent >= 5 days), 'teacher_status' (marks completion by teacher), 'class_status' (marks completion by class), 'student_performance' (top and bottom academic performers), or 'general' (summary list)."
      }
    }
  }
};

async function generateWithRetry(model, requestPayload, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await model.generateContent(requestPayload);
    } catch (error) {
      const errorStr = String(error);
      const isRateLimit = error.status === 429 || errorStr.includes('429') || errorStr.includes('quota');
      const isDailyLimit = errorStr.includes('GenerateRequestsPerDay') || errorStr.includes('Retry in 7h');

      if (isDailyLimit) {
        throw new Error("Daily Gemini API quota reached (1,500 requests/day). The quota will reset tomorrow.");
      }

      if (isRateLimit && attempt < maxRetries) {
        console.log(`API Rate limit hit. Pausing 5s before retry ${attempt + 1}...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      } else {
        throw error; 
      }
    }
  }
}

function getGenerativeModelWithFallback(modelName, systemInstruction, tools) {
  return genAI.getGenerativeModel({
    model: modelName,
    systemInstruction,
    tools
  });
}

export async function POST(request) {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({
        reply: "⚠️ GEMINI_API_KEY is not configured yet in your environment variables. Please add GEMINI_API_KEY to your Vercel/local .env to activate the AI Assistant with 1,500 free queries/day."
      });
    }

    const { prompt } = await request.json();
    if (!prompt || !prompt.trim()) {
      return NextResponse.json({ error: "Prompt is required." }, { status: 400 });
    }

    const systemInstruction = 
      "You are the DHIU Campus Intelligent AI Assistant for school administrators and teachers. " +
      "You have direct database access to analyze student attendance, shortage alerts (<85%), " +
      "period statistics, marks, and teacher enrollments. " +
      "Format tabular data strictly in clean Markdown tables. Deliver concise, professional answers. " +
      "If the user asks for a WhatsApp message or notice, draft a polite, well-structured message.";

    let model = getGenerativeModelWithFallback(
      PRIMARY_MODEL,
      systemInstruction,
      [{ functionDeclarations: [queryStudentDatabaseDeclaration] }]
    );

    let initialResponse;
    try {
      initialResponse = await generateWithRetry(model, prompt);
    } catch (primaryErr) {
      console.warn(`Primary model ${PRIMARY_MODEL} failed, attempting fallback ${FALLBACK_MODEL}:`, primaryErr.message);
      model = getGenerativeModelWithFallback(
        FALLBACK_MODEL,
        systemInstruction,
        [{ functionDeclarations: [queryStudentDatabaseDeclaration] }]
      );
      initialResponse = await generateWithRetry(model, prompt);
    }

    const call = initialResponse.response.functionCalls()?.[0];
    const exactModelContent = initialResponse.response.candidates?.[0]?.content;

    if (call && call.name === 'queryStudentDatabase') {
      const args = call.args || {};
      const targetClass = (args.classGroup || '').toLowerCase().trim();
      const category = args.analysisCategory || 'general';

      // Fetch Core Database Collections
      const [sSnap, mSnap, tSnap] = await Promise.all([
        getDocs(collection(db, 'students')),
        getDocs(collection(db, 'marks')),
        getDocs(collection(db, 'teachers'))
      ]);

      let studentsList = [];
      sSnap.forEach(doc => studentsList.push({ id: doc.id, ...doc.data() }));

      const allMarks = {};
      mSnap.forEach(doc => { allMarks[doc.id] = doc.data(); });

      const teachersList = [];
      tSnap.forEach(t => teachersList.push({ id: t.id, ...t.data() }));

      if (targetClass) {
        studentsList = studentsList.filter(s =>
          (s.classes || []).some(c => String(c).toLowerCase().includes(targetClass)) ||
          String(s.class || '').toLowerCase().includes(targetClass)
        );
      }

      let analyticsPayload = {};

      if (category === 'attendance_shortage' || category === 'attendance_overview') {
        const attRecords = studentsList.map(st => {
          const stat = st.periodAttendance || {};
          const totalP = Number(stat.totalPeriods) || 0;
          const presP = Number(stat.presentCount) || 0;
          const minP = Number(stat.minusCount) || 0;
          const netP = Math.max(0, presP - minP);
          const pct = totalP > 0 ? ((netP / totalP) * 100).toFixed(1) : '100.0';
          const isShortage = Number(pct) < 85 && totalP > 0;
          return {
            name: st.firstName,
            adNo: st.adNo,
            classes: (st.classes || []).join(', '),
            totalPeriods: totalP,
            netPresent: netP,
            minusCount: minP,
            attendancePct: `${pct}%`,
            isShortage
          };
        });

        if (category === 'attendance_shortage') {
          const shortageList = attRecords.filter(r => r.isShortage).sort((a, b) => parseFloat(a.attendancePct) - parseFloat(b.attendancePct));
          analyticsPayload = {
            totalStudentsExamined: attRecords.length,
            totalShortageCount: shortageList.length,
            shortageStudents: shortageList.slice(0, 30)
          };
        } else {
          const fullAttendance = attRecords.filter(r => parseFloat(r.attendancePct) === 100 && r.totalPeriods > 0);
          analyticsPayload = {
            totalStudents: attRecords.length,
            fullAttendanceCount: fullAttendance.length,
            fullAttendanceSample: fullAttendance.slice(0, 15),
            lowAttendanceSample: attRecords.filter(r => r.isShortage).slice(0, 15)
          };
        }
      }
      else if (category === 'student_performance') {
        const ranked = studentsList.map(s => {
          const sMarks = allMarks[s.regNo || s.id] || {};
          const total = Object.values(sMarks).reduce((sum, val) => sum + (Number(val) || 0), 0);
          return { name: s.firstName, adNo: s.adNo, classes: (s.classes || []).join(', '), totalMarks: total };
        }).sort((a, b) => b.totalMarks - a.totalMarks);

        analyticsPayload = {
          bestPerforming: ranked.slice(0, 10),
          worstPerforming: ranked.slice(-10)
        };
      }
      else if (category === 'teacher_status' || category === 'class_status') {
        const trackingMap = {};
        studentsList.forEach(s => {
          const sMarks = allMarks[s.regNo || s.id] || {};
          teachersList.forEach(teacher => {
            const teacherName = teacher.fullName || teacher.username;
            (teacher.enrollments || []).forEach(env => {
              const subj = (env.subject || '').trim();
              if (!subj) return;
              const key = `${teacherName}|${subj}`;
              if (!trackingMap[key]) {
                trackingMap[key] = { teacher: teacherName, subject: subj, expected: 0, uploaded: 0 };
              }
              trackingMap[key].expected++;
              if (sMarks[subj] !== undefined && sMarks[subj] !== '') {
                trackingMap[key].uploaded++;
              }
            });
          });
        });

        analyticsPayload = { statusReport: Object.values(trackingMap).slice(0, 40) };
      }
      else {
        analyticsPayload = {
          studentsCount: studentsList.length,
          teachersCount: teachersList.length,
          sample: studentsList.slice(0, 20).map(s => ({ name: s.firstName, adNo: s.adNo, classes: s.classes }))
        };
      }

      const contents = [
        { role: 'user', parts: [{ text: prompt }] },
        exactModelContent,
        {
          role: 'user',
          parts: [{ functionResponse: { name: call.name, response: { result: analyticsPayload } } }]
        }
      ];

      const finalResult = await generateWithRetry(model, { contents });
      return NextResponse.json({ reply: finalResult.response.text() });
    }

    return NextResponse.json({ reply: initialResponse.response.text() });
  } catch (error) {
    console.error("Chat API Error:", error);
    return NextResponse.json({ error: error.message || "An unexpected error occurred while communicating with Gemini." }, { status: 500 });
  }
}
