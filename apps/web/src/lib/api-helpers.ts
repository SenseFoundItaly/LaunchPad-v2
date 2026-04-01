import { NextResponse } from 'next/server';

export function json(data: unknown, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

export function error(msg: string, status = 400) {
  return NextResponse.json({ success: false, error: msg }, { status });
}

// Map DB row { id } to frontend { project_id } for projects
export function mapProject(row: Record<string, unknown>): Record<string, unknown> {
  const { id, ...rest } = row;
  return { project_id: id, ...rest };
}

export function generateId(prefix: string): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = `${prefix}_`;
  for (let i = 0; i < 12; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}
