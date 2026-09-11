import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/auth/supabase-server';

export async function POST() {
  const supabase = await getSupabaseServer();
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
