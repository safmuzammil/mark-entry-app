import { NextResponse } from 'next/server';
import { GoogleGenAI, Type } from '@google/genai';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../../lib/firebase';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const queryStudentDatabaseDeclaration = {
  name: "queryStudentDatabase",
  description: "Searches the school database for students and their marks. Use this whenever the user asks about student performance, specific classes, departments, or grades.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      department: { 
        type: Type.STRING, 
        description: "Optional filter for department (e.g., QURAN, HADITH, FIQH, CIVIL, LANGUAGE, AQIDAH)" 
      },
      classGroup: { 
        type: Type.STRING, 
        description: "Optional filter for class group (e.g., HFC3, QH1, AL1, QLA3)" 
      },
      class: { 
        type: Type.STRING, 
        description: "Alternative class identifier (e.g., HFC3, QLA3)" 
      }
    }
  }
};

async function callGeminiWithRetry(options, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await ai.models.generateContent(options);
    } catch (err) {
      const is503 = err.status === 503 || String(err).includes('503') || String(err).includes('UNAVAILABLE');
      if (is503 && attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, attempt * 1500));
        continue;
      }
      throw err;
    }
  }
}

export async function POST(request) {
  try {
    const { prompt } = await request.json();

    const systemInstructionText = "You are an AI assistant for a school administrator managing student records and marks stored in Firebase Firestore. You have full authorized access to the school database through the queryStudentDatabase tool. Always use this tool when asked about students, classes, departments, or marks. Never output raw JSON text; always execute the tool and reply with a natural language summary.";

    // Using gemini-3.5-flash for high availability and low latency
    const response = await callGeminiWithRetry({
      model: 'gemini-3.5-flash',
      contents: prompt,
      config: { systemInstruction: systemInstructionText },
      tools: [{ functionDeclarations: [queryStudentDatabaseDeclaration] }],
    });

    if (response.functionCalls && response.functionCalls.length > 0) {
      const call = response.functionCalls[0];
      
      if (call.name === 'queryStudentDatabase') {
        const { department, classGroup, class: altClass } = call.args;
        const targetClass = classGroup || altClass;
        
        const sSnap = await getDocs(collection(db, 'students'));
        let studentsList = [];
        sSnap.forEach(doc => studentsList.push(doc.data()));
        
        if (department) {
          studentsList = studentsList.filter(s => (s.department || '').toUpperCase() === department.toUpperCase());
        }
        if (targetClass) {
          studentsList = studentsList.filter(s => (s.classes || []).includes(targetClass));
        }

        const mSnap = await getDocs(collection(db, 'marks'));
        const allMarks = {};
        mSnap.forEach(doc => allMarks[doc.id] = doc.data());

        const databaseResults = studentsList.map(s => ({
          name: s.firstName,
          admissionNumber: s.adNo,
          department: s.department,
          enrolledClasses: s.classes,
          marks: allMarks[s.regNo] || null
        }));

        const finalResponse = await callGeminiWithRetry({
          model: 'gemini-3.5-flash',
          contents: [
            { role: 'user', parts: [{ text: prompt }] },
            { role: 'model', parts: [{ functionCall: call }] },
            { 
              role: 'user', 
              parts: [{ 
                functionResponse: { 
                  name: call.name, 
                  response: { result: databaseResults } 
                } 
              }] 
            }
          ],
        });

        return NextResponse.json({ reply: finalResponse.text });
      }
    }

    return NextResponse.json({ reply: response.text });

  } catch (error) {
    console.error("Chat API Error:", error);
    
    if (String(error).includes('503') || error.status === 503) {
      return NextResponse.json({ 
        error: "The AI service is experiencing heavy traffic (503). Please click 'Ask AI' again." 
      }, { status: 503 });
    }
    
    return NextResponse.json({ error: "Failed to process AI request." }, { status: 500 });
  }
}