import { NextResponse } from 'next/server';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../../lib/firebase'; 

// Initialize the SDK securely
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

const queryStudentDatabaseDeclaration = {
  name: "queryStudentDatabase",
  description: "Searches the school database for students and their marks. Use this whenever the user asks about student performance, specific classes, departments, or grades.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      department: { 
        type: SchemaType.STRING, 
        description: "Optional filter for department (e.g., QURAN, HADITH)" 
      },
      classGroup: { 
        type: SchemaType.STRING, 
        description: "Optional filter for class group (e.g., HFC3, QLA3)" 
      }
    }
  }
};

export async function POST(request) {
  try {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is missing in Vercel Environment Variables.");
    }

    const { prompt } = await request.json();

    const model = genAI.getGenerativeModel({
      model: "gemini-3.8-flash", 
      systemInstruction: "You are an AI assistant for a school administrator managing student records and marks. You have authorized access to the school database through the queryStudentDatabase tool. Always use this tool when asked about students, classes, or marks. Keep your final answers concise and helpful.",
      tools: [{ functionDeclarations: [queryStudentDatabaseDeclaration] }],
    });

    // 1. Send the initial user prompt
    const initialResponse = await model.generateContent(prompt);
    const call = initialResponse.response.functionCalls()?.[0];
    
    // Extract the EXACT model response to preserve the thought_signature and hidden fields
    const exactModelContent = initialResponse.response.candidates[0].content;

    // 2. Handle Database Tool Call if Gemini requests it
    if (call && call.name === 'queryStudentDatabase') {
      const args = call.args;
      const targetClass = args.classGroup || '';
      const department = args.department || '';
      
      const sSnap = await getDocs(collection(db, 'students'));
      let studentsList = [];
      sSnap.forEach(doc => studentsList.push(doc.data()));
      
      if (department) {
        studentsList = studentsList.filter(s => (s.department || '').toUpperCase() === department.toUpperCase());
      }
      if (targetClass) {
        studentsList = studentsList.filter(s => (s.classes || []).includes(targetClass.toUpperCase()));
      }

      if (studentsList.length > 40) {
        studentsList = studentsList.slice(0, 40);
      }

      const mSnap = await getDocs(collection(db, 'marks'));
      const allMarks = {};
      mSnap.forEach(doc => { allMarks[doc.id] = doc.data(); });

      const databaseResults = studentsList.map(s => ({
        name: s.firstName,
        admissionNumber: s.adNo,
        marks: allMarks[s.regNo] || 'No marks recorded'
      }));

      // 3. Construct history using the untouched exactModelContent
      const contents = [
        {
          role: 'user',
          parts: [{ text: prompt }]
        },
        exactModelContent, // Placed directly into the array to keep the signature intact
        {
          role: 'user',
          parts: [{
            functionResponse: {
              name: call.name,
              response: { result: databaseResults }
            }
          }]
        }
      ];

      // 4. Send the explicitly formatted history back to Gemini
      const finalResult = await model.generateContent({ contents });
      return NextResponse.json({ reply: finalResult.response.text() });
    }

    return NextResponse.json({ reply: initialResponse.response.text() });

  } catch (error) {
    console.error("Chat API Error:", error);
    return NextResponse.json(
      { error: error.message || "Unknown server error occurred." }, 
      { status: 500 }
    );
  }
}