import { NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth/require-user';

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json(user);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
