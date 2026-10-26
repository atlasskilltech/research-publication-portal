import "./globals.css";

export const metadata = {
  title: "Research Publication Portal — ATLAS SkillTech University",
  description:
    "ATLAS SkillTech University — Research Publication Portal (2025–26). Submit, review and publish research across ISDI, ISME, uGDX and LAW.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#2e2a6b",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
