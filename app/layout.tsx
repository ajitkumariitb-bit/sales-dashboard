import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";
import { getOptionalCurrentUser } from "@/lib/store";
import { LogoutButton } from "./components/LogoutButton";

export const metadata: Metadata = {
  title: "Bliss & Birch Lead Recovery",
  description: "Bliss & Birch abandoned checkout and sales follow-up dashboard"
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const currentUser = await getOptionalCurrentUser();

  if (!currentUser) {
    return (
      <html lang="en">
        <body>{children}</body>
      </html>
    );
  }

  return (
    <html lang="en">
      <body>
        <div className="shell">
          <aside className="sidebar">
            <div className="brand">Bliss & Birch</div>
            <div className="brand-sub">Lead recovery for lighting, fans, and premium home decor enquiries.</div>
            <nav className="nav">
              {currentUser.role === "admin" ? <Link href="/admin">Admin Dashboard</Link> : null}
              <Link href="/sales">Salesperson Dashboard</Link>
              <Link href="/leads">Lead List</Link>
              {currentUser.role === "admin" ? <Link href="/manual-leads">Manual Lead</Link> : null}
              {currentUser.role === "admin" ? <Link href="/import">CSV Import</Link> : null}
              {currentUser.role === "admin" ? <Link href="/users">Users</Link> : null}
            </nav>
            <div className="user-box">
              <div>
                <strong>{currentUser.name}</strong>
                <div className="subtle">{currentUser.role}</div>
              </div>
              <LogoutButton />
            </div>
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
