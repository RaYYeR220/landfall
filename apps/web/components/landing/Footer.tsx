import Link from "next/link";
import { Logo } from "./Logo";
import { DOCS_URL, REPO_LABEL, REPO_URL, VAULT_URL } from "./links";

export function Footer() {
  return (
    <footer className="lf-footer">
      <div className="wrap lf-footer-in">
        <Link className="lf-brand" href="/" aria-label="Landfall home">
          <Logo size={18} />
          Landfall
        </Link>
        <p className="lf-footer-built">Built on Aurora Intents (Intents Deposits, Intents Connect, Swap API) · Kamino · Jupiter Lend · Solana</p>
        <nav className="lf-footer-links" aria-label="Footer">
          <Link href={VAULT_URL}>Vault</Link>
          <a href={DOCS_URL} target="_blank" rel="noreferrer">
            Docs
          </a>
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            {REPO_LABEL}
          </a>
        </nav>
      </div>
    </footer>
  );
}
