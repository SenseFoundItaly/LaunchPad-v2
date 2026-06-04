import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import '../styles/design-tokens.css';
import AppHeader from '@/components/layout/AppHeader';
import QueryProvider from '@/components/providers/QueryProvider';

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
  title: 'SenseFound — Courage Through Clarity',
  description: 'Validate your startup idea with evidence. Find fatal flaws early — when pivoting is still possible, not painful.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // theme-ink = dark variant of the paperclip-adjacent design tokens.
  // Matches the existing dark aesthetic while exposing CSS vars like
  // --paper, --ink, --accent so design-system components can style without
  // Tailwind (the two coexist cleanly).
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} theme-ink h-full antialiased dark`}
    >
      <body className="h-full flex flex-col bg-paper text-ink">
        <QueryProvider>
          <AppHeader />
          <main className="flex-1 overflow-hidden">{children}</main>
        </QueryProvider>
      </body>
    </html>
  );
}
