import { AddressCapsule } from "@/components/landing/AddressCapsule";
import { EvalSection, readEval } from "@/components/landing/Eval";
import { Footer } from "@/components/landing/Footer";
import { Hero } from "@/components/landing/Hero";
import { LiveDepositProvider } from "@/components/landing/LiveDeposit";
import { Reveal } from "@/components/landing/Reveal";
import { VaultLive } from "@/components/landing/VaultLive";

// The eval scorecard is read from the repo at build time; live numbers are fetched client-side.
export const dynamic = "force-static";

const VERBS = [
  {
    t: "Send",
    p: "From any chain, any wallet, any exchange. One permanent address per chain, and Ethereum and every EVM chain share one.",
  },
  {
    t: "Lands",
    p: "An Aurora Intents payout arrives in your inbox on Solana. A keeper sweeps it into the vault as lfUSDC shares, and anyone can run that sweep.",
  },
  {
    t: "Earns",
    p: "The vault lends on a curated split between Kamino and Jupiter Lend. Withdraw to any chain with one signature.",
  },
];

export default function Home() {
  const evalData = readEval();
  return (
    <LiveDepositProvider>
      <main className="lf-page">
        <Hero />

        <section className="lf-sec lf-how" id="how" aria-labelledby="lf-how-h">
          <div className="wrap">
            <Reveal className="lf-sec-head">
              <div>
                <p className="eyebrow">How it works</p>
                <h2 className="lf-h2" id="lf-how-h">
                  One permanent address per chain. Nothing to sign after that.
                </h2>
              </div>
              <p className="lf-lede">
                Pick the network you send from. The address never changes, so save it once and reuse it from any wallet or exchange. Each address shows its transfer
                requirement up front.
              </p>
            </Reveal>
            <Reveal delay=".06s">
              <AddressCapsule />
            </Reveal>
            <Reveal delay=".1s">
              <ol className="lf-verbs">
                {VERBS.map((v, i) => (
                  <li key={v.t}>
                    <span className="lf-vn">{i + 1}</span>
                    <h3>{v.t}</h3>
                    <p>{v.p}</p>
                  </li>
                ))}
              </ol>
            </Reveal>
          </div>
        </section>

        {evalData ? <EvalSection data={evalData} /> : null}

        <section className="lf-sec lf-vault" id="vault" aria-labelledby="lf-vault-h">
          <div className="wrap">
            <Reveal className="lf-sec-head">
              <div>
                <p className="eyebrow">The vault</p>
                <h2 className="lf-h2" id="lf-vault-h">
                  One curated USDC vault.
                </h2>
              </div>
              <p className="lf-lede">
                Every landing mints lfUSDC, a share of one vault on Solana. The curator splits its USDC between Kamino and Jupiter Lend, and your shares follow the
                blended yield.
              </p>
            </Reveal>
            <Reveal delay=".06s">
              <VaultLive />
            </Reveal>
          </div>
        </section>
      </main>
      <Footer />
    </LiveDepositProvider>
  );
}
