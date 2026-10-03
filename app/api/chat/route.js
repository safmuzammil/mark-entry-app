import { NextResponse } from 'next/server';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../../lib/firebase'; 

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

const queryStudentDatabaseDeclaration = {
  name: "queryStudentDatabase",
  description: "Analyzes the school database for student marks, teacher completion statuses, pending subjects, and performance rankings.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      classGroup: { 
        type: SchemaType.STRING, 
        description: "Optional specific class group (e.g., QLA3, HFC3)" 
      },
      analysisCategory: {
        type: SchemaType.STRING,
        description: "CRITICAL: Choose 'teacher_status' (for completed/pending teachers and subjects), 'class_status' (for fully uploaded vs pending classes), 'student_performance' (for best/worst students), or 'general' (for basic lists)."
      }
    }
  }
};

// HELPER: Safely retries the API call if the 429 rate limit is hit
async function generateWithRetry(model, requestPayload, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await model.generateContent(requestPayload);
    } catch (error) {
      const isRateLimit = error.status === 429 || String(error).includes('429') || String(error).includes('quota');
      
      if (isRateLimit && attempt < maxRetries) {
        console.log(`API Rate limit hit. Pausing for 12 seconds before retry ${attempt + 1}...`);
        await new Promise(resolve => setTimeout(resolve, 12000)); // Wait 12 seconds
      } else {
        throw error; // If it's not a rate limit, or we are out of retries, throw the error
      }
    }
  }
}

export async function POST(request) {
  try {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is missing in Vercel Environment Variables.");
    }

    const { prompt } = await request.json();

    const model = genAI.getGenerativeModel({
      model: "gemini-3.8-flash", 
       systemInstruction: "You are an AI assistant for a school administrator. You have access to a database analytics tool. When presenting tabular data, format it using clean markdown tables. Do not use raw HTML like <br> tags inside cells; use separate table rows or bullet lists instead. Deliver concise, clear reports based on the data returned.",
      tools: [{ functionDeclarations: [queryStudentDatabaseDeclaration] }],
    });

    // 1. Send initial prompt using the secure retry wrapper
    const initialResponse = await generateWithRetry(model, prompt);
    const call = initialResponse.response.functionCalls()?.[0];
    const exactModelContent = initialResponse.response.candidates[0].content;

    if (call && call.name === 'queryStudentDatabase') {
      const args = call.args;
      const targetClass = (args.classGroup || '').toLowerCase();
      const category = args.analysisCategory || 'general';
      
      // Fetch Core Data
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

      // Build Detailed Student Records with Teacher Mapping
      let detailedStudents = studentsList.map(student => {
        const studentMarks = allMarks[student.regNo || student.id] || {};
        const assignedTeachers = {};
        const isUrdu = String(student.adNo || '').toUpperCase().startsWith('U');
        const studentClassesLower = (student.classes || []).map(c => String(c).trim().toLowerCase());

        teachersList.forEach(teacher => {
          const teacherName = teacher.fullName || teacher.id;
          (teacher.enrollments || []).forEach(env => {
            const subj = (env.subject || '').trim();
            if (!subj) return;

            let isMatch = false;
            if (env.studentIds && Array.isArray(env.studentIds)) {
              const savedIds = env.studentIds.map(id => String(id).trim());
              if (savedIds.includes(String(student.regNo)) || savedIds.includes(String(student.adNo))) isMatch = true;
            }

            if (!isMatch) {
              const envAlias = String(env.alias || '').trim().toLowerCase();
              if (studentClassesLower.includes(envAlias) || envAlias.includes(targetClass)) {
                const envLang = (env.langTag || '').toLowerCase();
                if (envLang.includes('urdu') && !envLang.includes('non')) isMatch = isUrdu;
                else if (envLang.includes('gen') || envLang.includes('non') || envLang === '') isMatch = !isUrdu;
                else isMatch = true;
              }
            }
            if (isMatch) assignedTeachers[subj] = teacherName;
          });
        });

        return {
          id: student.id,
          name: student.firstName,
          classes: studentClassesLower,
          marks: studentMarks,
          teachers: assignedTeachers
        };
      });

      if (targetClass) {
        detailedStudents = detailedStudents.filter(s => s.classes.some(c => c.includes(targetClass) || targetClass.includes(c)));
      }

      // Process Requested Analytics
      let analyticsPayload = {};

      if (category === 'student_performance') {
        const ranked = detailedStudents.map(s => {
          const total = Object.values(s.marks).reduce((sum, val) => sum + (Number(val) || 0), 0);
          return { name: s.name, classes: s.classes.join(', '), totalMarks: total };
        }).sort((a, b) => b.totalMarks - a.totalMarks);

        analyticsPayload = {
          bestPerforming: ranked.slice(0, 10),
          worstPerforming: ranked.slice(-10)
        };
      } 
      else if (category === 'teacher_status' || category === 'class_status') {
        const trackingMap = {}; 

        detailedStudents.forEach(s => {
          Object.entries(s.teachers).forEach(([subject, teacherName]) => {
            const key = `${teacherName}|${subject}`;
            if (!trackingMap[key]) {
              trackingMap[key] = { teacher: teacherName, subject: subject, expected: 0, uploaded: 0, affectedClasses: new Set() };
            }
            trackingMap[key].expected++;
            s.classes.forEach(c => trackingMap[key].affectedClasses.add(c));
            
            if (s.marks[subject] !== undefined && s.marks[subject] !== "") {
              trackingMap[key].uploaded++;
            }
          });
        });

        const teacherCompletion = {}; 
        const classCompletion = {};

        Object.values(trackingMap).forEach(entry => {
          const isComplete = entry.expected === entry.uploaded;
          const statusString = `${entry.subject} (${entry.uploaded}/${entry.expected} uploaded)`;

          if (!teacherCompletion[entry.teacher]) teacherCompletion[entry.teacher] = { isFullyComplete: true, pendingSubjects: [] };
          if (!isComplete) {
            teacherCompletion[entry.teacher].isFullyComplete = false;
            teacherCompletion[entry.teacher].pendingSubjects.push(statusString);
          }

          entry.affectedClasses.forEach(cls => {
            if (!classCompletion[cls]) classCompletion[cls] = { isFullyComplete: true, pendingSubjects: [] };
            if (!isComplete) {
              classCompletion[cls].isFullyComplete = false;
              classCompletion[cls].pendingSubjects.push(`${statusString} by ${entry.teacher}`);
            }
          });
        });

        analyticsPayload = category === 'teacher_status' ? { teachers: teacherCompletion } : { classes: classCompletion };
      } 
      else {
        analyticsPayload = { students: detailedStudents.slice(0, 40) };
      }

      const contents = [
        { role: 'user', parts: [{ text: prompt }] },
        exactModelContent, 
        {
          role: 'user',
          parts: [{ functionResponse: { name: call.name, response: { result: analyticsPayload } } }]
        }
      ];

      // 2. Send final payload using the secure retry wrapper
      const finalResult = await generateWithRetry(model, { contents });
      return NextResponse.json({ reply: finalResult.response.text() });
    }

    return NextResponse.json({ reply: initialResponse.response.text() });

  } catch (error) {
    console.error("Chat API Error:", error);
    return NextResponse.json({ error: error.message || "Unknown server error occurred." }, { status: 500 });
  }
}