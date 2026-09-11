import { NextRequest, NextResponse } from 'next/server';
import { renderMagicLinkHtml } from '@/lib/email';

/**
 * Dev-only: preview the magic-link email template.
 *   GET /api/preview-email?locale=it
 */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 404 });
  }
  const locale = request.nextUrl.searchParams.get('locale') || 'en';
  const html = renderMagicLinkHtml('https://example.com/magic-link-preview', locale);
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
