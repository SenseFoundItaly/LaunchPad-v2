import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { cookies } from 'next/headers';
import './globals.css';
import '../styles/design-tokens.css';
import AppHeader from '@/components/layout/AppHeader';
import QueryProvider from '@/components/providers/QueryProvider';
import TourController from '@/components/onboarding/TourController';
import { LocaleProvider } from '@/components/providers/LocaleProvider';
import { asLocale, LOCALE_COOKIE } from '@/lib/i18n/locales';
import { THEME_COOKIE } from '@/lib/theme';

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

  // theme-ink = dark variant of the design tokens (:root is the LIGHT palette).
  // Read the theme from a cookie so SSR renders the SAME classes the client
  // will have — no hydration mismatch, no FOUC, no boot script. Default is dark
  // (the app's established look) when the cookie is absent. The NavRail
  // ThemeToggle writes the cookie + flips the classes live.
  const isLight = cookieStore.get(THEME_COOKIE)?.value === 'light';
  const themeClass = isLight ? '' : 'theme-ink dark';
  return (
    <html
      lang={locale}
      className={`${inter.variable} ${jetbrainsMono.variable} ${themeClass} h-full antialiased`}
    >
      <body className="h-full flex flex-col bg-paper text-ink">
        <LocaleProvider initialLocale={locale}>
          <QueryProvider>
            <AppHeader />
            <main className="flex-1 overflow-hidden">{children}</main>
            {/* Cross-page onboarding walkthrough — mounted here (not the
                project layout) so it covers the workspace dashboard too.
                Self-gates on users.onboarded, renders nothing otherwise. */}
            <TourController />
          </QueryProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
