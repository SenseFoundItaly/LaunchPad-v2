import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { cookies } from 'next/headers';
import './globals.css';
import '../styles/design-tokens.css';
import AppHeader from '@/components/layout/AppHeader';
import QueryProvider from '@/components/providers/QueryProvider';
import TourControllerLazy from '@/components/onboarding/TourControllerLazy';
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

/**
 * Share metadata.
 *
 * The app shipped with a title and a description and nothing else — no
 * OpenGraph, no Twitter card, no image. Every link pasted anywhere unfurled as
 * a bare grey box, which for a product distributed founder-to-founder by link
 * is the first impression every single time.
 *
 * `metadataBase` is required for Next to emit ABSOLUTE og:image URLs. Without
 * it the tag is relative and most unfurlers (Slack, WhatsApp, LinkedIn) simply
 * drop the image — the failure looks exactly like having no image at all,
 * which is why it is easy to ship broken and believe it works.
 *
 * Deliberately NOT per-project: a project page is private, and generating an
 * og:image containing a founder's problem statement would render their idea
 * for any crawler or chat client that touches the URL. Auth-gated routes
 * inherit this generic card on purpose.
 */
export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? 'https://launchpad.sensefound.io',
  ),
  title: {
    default: 'LaunchPad — Courage Through Clarity',
    template: '%s — LaunchPad',
  },
  description:
    'Validate your startup idea with evidence. Find fatal flaws early — when pivoting is still possible, not painful.',
  applicationName: 'LaunchPad',
  openGraph: {
    type: 'website',
    siteName: 'LaunchPad',
    title: 'LaunchPad — Courage Through Clarity',
    description:
      'Answer three questions. Get your whole plan back — with every assumption named.',
    url: '/',
    locale: 'en',
    alternateLocale: ['it'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'LaunchPad — Courage Through Clarity',
    description:
      'Answer three questions. Get your whole plan back — with every assumption named.',
  },
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
            <TourControllerLazy />
          </QueryProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
