import { NextResponse } from 'next/server';
import { GoogleGenerativeAI, FunctionDeclarationSchemaType } from '@google/generative-ai';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../../lib/firebase'; // Ensure this path matches your project structure

// Initialize the standard stable Google Gen AI SDK
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Define the tool Gemini can use to search your database
const queryStudentDatabaseDeclaration = {
  name: "queryStudentDatabase",
  description: "Searches the school database for students and their marks. Use this whenever the user asks about student performance, specific classes, departments, or grades.",
  parameters: {
    type: FunctionDeclarationSchemaType.OBJECT,
    properties: {
      department: { 
        type: FunctionDeclarationSchemaType.STRING, 
        description: "Optional filter for department (e.g., QURAN, HADITH, FIQH, CIVIL, LANGUAGE, AQIDAH)" 
      },
      classGroup: { 
        type: FunctionDeclarationSchemaType.STRING, 
        description: "Optional filter for class group (e.g., HFC3, QH1, AL1, QLA3)" 
      },
      class: { 
        type: FunctionDeclarationSchemaType.STRING, 
        description: "Alternative class identifier (e.g., HFC3, QLA3)" 
      }
    }
  }
};

export async function POST(request) {
  try {
    const { prompt } = await request.json();

    // 1. Initialize the model with the CORRECT model name and system instructions
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash", // Replaced the non-existent 3.5 model
      systemInstruction: "You are an AI assistant for a school administrator managing student records and marks stored in Firebase Firestore. You have full authorized access to the school database through the queryStudentDatabase tool. Always use this tool when asked about students, classes, departments, or marks. Never output raw JSON text; always execute the tool and reply with a natural language summary.",
      tools: [{ functionDeclarations: [queryStudentDatabaseDeclaration] }],
    });

    // 2. Start a chat session (this manages the back-and-forth history for function calling)
    const chat = model.startChat();
    
    // 3. Send the user's prompt to Gemini
    const result = await chat.sendMessage(prompt);
    
    // Check if Gemini decided it needs to use the database tool
    const call = result.response.functionCalls()?.[0];

    if (call && call.name === 'queryStudentDatabase') {
      const args = call.args;
      const department = args.department;
      const targetClass = args.classGroup || args.class;
      
      // Fetch students from Firestore
      const sSnap = await getDocs(collection(db, 'students'));
      let studentsList = [];
      sSnap.forEach(doc => studentsList.push(doc.data()));
      
      if (department) {
        studentsList = studentsList.filter(s => (s.department || '').toUpperCase() === department.toUpperCase());
      }
      if (targetClass) {
        studentsList = studentsList.filter(s => (s.classes || []).includes(targetClass));
      }

      // Fetch marks from Firestore
      const mSnap = await getDocs(collection(db, 'marks'));
      const allMarks = {};
      mSnap.forEach(doc => allMarks[doc.id] = doc.data());

      // Combine the data
      const databaseResults = studentsList.map(s => ({
        name: s.firstName,
        admissionNumber: s.adNo,
        department: s.department,
        enrolledClasses: s.classes,
        marks: allMarks[s.regNo] || null
      }));

      // 4. Send the database results back to Gemini so it can read them and write a summary
      const finalResult = await chat.sendMessage([{
        functionResponse: {
          name: 'queryStudentDatabase',
          response: { result: databaseResults }
        }
      }]);

      return NextResponse.json({ reply: finalResult.response.text() });
    }

    // If no database search was needed, just return Gemini's normal reply
    return NextResponse.json({ reply: result.response.text() });

  } catch (error) {
    console.error("Chat API Error:", error);
    
    if (String(error).includes('503') || error.status === 503) {
      return NextResponse.json({ 
        error: "The AI service is experiencing heavy traffic (503). Please click 'Ask AI' again." 
      }, { status: 503 });
    }
    
    return NextResponse.json({ error: "Failed to process AI request. Check server logs." }, { status: 500 });
  }
}