import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "./landing/Logo";
import { DOCS_URL } from "./landing/links";

/** Header for the app and vault pages; the landing page has its own over the hero. */
export default function SiteHeader({ current, children }: { current: "app" | "vault"; children?: ReactNode }) {
  const item = (href: string, label: string, key?: string) => (
    <Link href={href} className={key === current ? "text-ink" : "hover:text-ink"}>
      {label}
    </Link>
  );
  return (
    <header className="wrap flex h-[72px] items-center justify-between gap-4">
      <Link href="/" className="flex items-center gap-2.5 text-[17px] font-medium tracking-tight" aria-label="Landfall home">
        <Logo />
        Landfall
      </Link>
      <nav className="hidden gap-7 text-sm text-ink-2 md:flex" aria-label="Primary">
        {item("/app", "App", "app")}
        {item("/vault", "Vault", "vault")}
        {item("/#how", "How it works")}
        <a href={DOCS_URL} className="hover:text-ink" target={DOCS_URL.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
          Docs
        </a>
      </nav>
      {children}
    </header>
  );
}
