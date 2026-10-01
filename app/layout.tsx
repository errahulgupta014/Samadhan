import type { Metadata } from "next";
import "./globals.css";
import "./product.css";
import "./tiranga.css";

export const metadata: Metadata = {
  title: "SAMADHAN · Ward Operations",
  description: "Report, track, resolve. SAMADHAN civic services pilot workspace.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/samadhan-logo.png",
    shortcut: "/samadhan-logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
