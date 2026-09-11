import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import AppHeader from '@/components/layout/AppHeader';

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
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} theme-ink h-full antialiased dark`}
    >
      <body className="h-full flex flex-col bg-paper text-ink">
        <AppHeader />
        <main className="flex-1 overflow-hidden">{children}</main>
      </body>
    </html>
  );
}
