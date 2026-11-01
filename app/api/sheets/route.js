import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const body = await request.json();

    // Optional Kiosk PIN verification on the server
    if (body.action === 'verifyKioskPin') {
      const isValid = body.pin === process.env.SECURITY_GATE_PIN;
      return NextResponse.json({ status: isValid ? 'success' : 'invalid' });
    }

    const scriptUrl = process.env.GOOGLE_SCRIPT_WEB_APP_URL;
    if (!scriptUrl) {
      return NextResponse.json({ status: 'error', message: 'Server URL not configured' }, { status: 500 });
    }

    const res = await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ status: 'error', message: err.message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const scriptUrl = process.env.GOOGLE_SCRIPT_WEB_APP_URL;
    const res = await fetch(`${scriptUrl}?action=getAllAdminReportData`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ status: 'error', message: err.message }, { status: 500 });
  }
}