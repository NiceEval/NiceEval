import "./globals.css";

export const metadata = {
  title: "Page not found",
  description: "The requested page does not exist.",
};

export default function GlobalNotFound() {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <main className="shell" style={{ paddingTop: "6rem", paddingBottom: "6rem" }}>
          <h1>Page not found</h1>
          <p>The requested page does not exist.</p>
        </main>
      </body>
    </html>
  );
}
