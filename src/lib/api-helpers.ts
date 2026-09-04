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

// Moved to ./ids so code that runs OUTSIDE Next (the grants background
// function) can generate ids without importing next/server. Re-exported here
// because this module is where the rest of the app already imports it from.
export { generateId } from './ids';
