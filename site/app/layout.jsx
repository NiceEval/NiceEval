import "./globals.css";

export const metadata = {
  title: {
    default: "NiceEval",
    template: "%s | NiceEval",
  },
  description: "NiceEval is a lightweight, agent-native TypeScript eval tool for AI agents and coding-agent workflows.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}

