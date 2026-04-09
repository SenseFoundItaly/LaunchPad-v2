import { NextResponse } from 'next/server';

export function json(data: unknown, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

export function error(msg: string, status = 400) {
  return NextResponse.json({ success: false, error: msg }, { status });
}

export function unauthorized() {
  return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
}

// Map DB row { id } to frontend { project_id } for projects
export function mapProject(row: Record<string, unknown>): Record<string, unknown> {
  const { id, ...rest } = row;
  return { project_id: id, ...rest };
}

/** Generate a UUID via the Web Crypto API (works in Edge + Node) */
export function generateId(): string {
  return crypto.randomUUID();
}
