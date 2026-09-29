import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MNSUAM Thesis Management System",
  description:
    "Thesis Management System for MNS University of Agriculture, Multan — ideas, GEC, meetings, defences, and e-signatures.",
  icons: {
    icon: "/mnsuam-logo.png",
    apple: "/mnsuam-logo.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
