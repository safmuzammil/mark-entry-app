import { NextResponse } from 'next/server';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../../lib/firebase'; // Ensure this matches your file structure

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
    // Immediate check for the API key to prevent silent failures
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is missing in Vercel Environment Variables.");
    }

    const { prompt } = await request.json();

    // Initialize the model with the latest supported version
    const model = genAI.getGenerativeModel({
      model: "gemini-3.8-flash", // Updated to resolve the 404 error
      systemInstruction: "You are an AI assistant for a school administrator managing student records and marks. You have authorized access to the school database through the queryStudentDatabase tool. Always use this tool when asked about students, classes, or marks. Keep your final answers concise and helpful.",
      tools: [{ functionDeclarations: [queryStudentDatabaseDeclaration] }],
    });

    const chat = model.startChat();
    const result = await chat.sendMessage(prompt);
    const call = result.response.functionCalls()?.[0];

    // Handle Database Tool Call if Gemini requests it
    if (call && call.name === 'queryStudentDatabase') {
      const args = call.args;
      const targetClass = args.classGroup || '';
      const department = args.department || '';
      
      // Fetch students from Firestore
      const sSnap = await getDocs(collection(db, 'students'));
      let studentsList = [];
      sSnap.forEach(doc => studentsList.push(doc.data()));
      
      // Filter the students aggressively
      if (department) {
        studentsList = studentsList.filter(s => (s.department || '').toUpperCase() === department.toUpperCase());
      }
      if (targetClass) {
        studentsList = studentsList.filter(s => (s.classes || []).includes(targetClass.toUpperCase()));
      }

      // SAFEGUARD: Limit the results to 40 students to prevent Vercel timeouts and payload crashes
      if (studentsList.length > 40) {
        studentsList = studentsList.slice(0, 40);
      }

      // Fetch marks from Firestore
      const mSnap = await getDocs(collection(db, 'marks'));
      const allMarks = {};
      mSnap.forEach(doc => { allMarks[doc.id] = doc.data(); });

      // Build a lightweight summary for the AI
      const databaseResults = studentsList.map(s => ({
        name: s.firstName,
        admissionNumber: s.adNo,
        marks: allMarks[s.regNo] || 'No marks recorded'
      }));

      // Send the optimized data back to Gemini
      const finalResult = await chat.sendMessage([{
        functionResponse: {
          name: 'queryStudentDatabase',
          response: { result: databaseResults }
        }
      }]);

      return NextResponse.json({ reply: finalResult.response.text() });
    }

    // Return normal chat response if no tool was used
    return NextResponse.json({ reply: result.response.text() });

  } catch (error) {
    console.error("Chat API Error:", error);
    
    // Send the EXACT error message straight to your chat window for easy debugging
    return NextResponse.json(
      { error: error.message || "Unknown server error occurred." }, 
      { status: 500 }
    );
  }
}