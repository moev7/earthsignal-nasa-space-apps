import type { Metadata } from "next";
import "./globals.css";
import "./public-fonts.css";
import "@/features/science/radar-inspection.css";

export const metadata: Metadata = {
  title: "Earthsignal — The ground beneath Tehran",
  description:
    "Explore why Tehran’s ground sinks through satellite observations, interactive 3D neighbourhoods and clearly labelled teaching simulations. Scientific tools remain available in the advanced workspace.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}
