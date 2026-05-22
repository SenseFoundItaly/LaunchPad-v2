import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const inter = Inter({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'LaunchPad - Your AI Co-Pilot for Building AI-Native Startups',
  description: 'The intelligence platform that guides founders through their journey of building AI-native startups. From idea validation to fundraising.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased bg-background`}
    >
      <body className="h-full flex flex-col font-sans">
        {children}
      </body>
    </html>
  );
}
