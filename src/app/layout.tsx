// frontend/src/app/layout.tsx
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css'; // Global CSS for Tailwind and Leaflet
import Navbar from '../components/Navbar'; // Import your Navbar

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'CivicScan',
  description: 'AI-powered pavement defect detection and mapping',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Navbar /> {/* Your Navbar will appear on all pages */}
        {children} {/* This is where your page content will be rendered */}
      </body>
    </html>
  );
}