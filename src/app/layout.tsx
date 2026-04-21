import type { Metadata } from 'next';
import { Geist, Geist_Mono, Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import '../styles/design-tokens.css';
import AppHeader from '@/components/layout/AppHeader';

// Legacy fonts (Tailwind-styled pages still reference --font-geist-*).
// Keeping both so migration is gradual — see src/components/design/* for the
// new Inter/JetBrains-backed design system.
const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

// New design system fonts — tokens.css expects Inter + JetBrains Mono.
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
  title: 'LaunchPad - Startup OS',
  description: 'Shape, evaluate, and launch your startup idea',
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
      className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} ${jetbrainsMono.variable} theme-ink h-full antialiased dark`}
    >
      <body className="h-full flex flex-col bg-zinc-950 text-zinc-100">
        <AppHeader />
        <main className="flex-1 overflow-hidden">{children}</main>
      </body>
    </html>
  );
}
