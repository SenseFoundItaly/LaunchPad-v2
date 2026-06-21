import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { cookies } from 'next/headers';
import './globals.css';
import '../styles/design-tokens.css';
import AppHeader from '@/components/layout/AppHeader';
import QueryProvider from '@/components/providers/QueryProvider';
import { LocaleProvider } from '@/components/providers/LocaleProvider';
import { asLocale, LOCALE_COOKIE } from '@/lib/i18n/locales';

// Design system fonts — tokens.css expects Inter + JetBrains Mono.
// next/font injects proper preloads, self-hosts the files, no FOIT.
const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
});

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin'],
  weight: ['400', '500'],
});

export const metadata: Metadata = {
  title: 'LaunchPad — Courage Through Clarity',
  description: 'Validate your startup idea with evidence. Find fatal flaws early — when pivoting is still possible, not painful.',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Read the active locale from the cookie synchronously here so SSR and the
  // first client render agree. The cookie is the fast path; the durable record
  // is users.locale, synced into the cookie when the language switch is used.
  const cookieStore = await cookies();
  const locale = asLocale(cookieStore.get(LOCALE_COOKIE)?.value);

  // theme-ink = dark variant of the paperclip-adjacent design tokens.
  // Matches the existing dark aesthetic while exposing CSS vars like
  // --paper, --ink, --accent so design-system components can style without
  // Tailwind (the two coexist cleanly).
  return (
    <html
      lang={locale}
      className={`${inter.variable} ${jetbrainsMono.variable} theme-ink h-full antialiased dark`}
    >
      <body className="h-full flex flex-col bg-paper text-ink">
        <LocaleProvider initialLocale={locale}>
          <QueryProvider>
            <AppHeader />
            <main className="flex-1 overflow-hidden">{children}</main>
          </QueryProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
