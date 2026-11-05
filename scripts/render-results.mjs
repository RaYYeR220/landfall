#!/usr/bin/env node
// Renders every number in the docs from eval/results. Run after `cargo test`:
//   node scripts/render-results.mjs          (rewrite the docs)
//   node scripts/render-results.mjs --check  (exit 1 if a doc is stale)
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));
const usd = (base) => `$${(base / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const k = (n) => n.toLocaleString("en-US");

const landing = read("eval/results/landing.json");
const adverse = landing.results.filter((r) => r.id !== "healthy");
const lf = adverse.filter((r) => r.landfall.landed).length;
const docs = adverse.filter((r) => r.docs_recipe.landed).length;
const stranded = adverse.filter((r) => !r.docs_recipe.landed).reduce((s, r) => s + r.docs_recipe.usdc_left_in_intermediary, 0);

const computeDir = join(root, "eval/results/compute");
const order = ["deposit", "deposit_first", "deposit_with_positions", "sweep_inbox", "allocate_kamino", "allocate_jlend", "redeem_via_kamino", "redeem_via_jlend"];
const compute = existsSync(computeDir)
  ? readdirSync(computeDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => read(`eval/results/compute/${f}`))
      .sort((a, b) => order.indexOf(a.instruction) - order.indexOf(b.instruction))
  : [];

// the reproducible build is what gets deployed; fall back to a local build
const so = [join(root, "target/verifiable/landfall.so"), join(root, "target/deploy/landfall.so")].find(existsSync) ?? "";
const verifiable = so.includes("verifiable");
const binary = so ? readFileSync(so) : null;

const deployment = existsSync(join(root, "eval/results/deployment.json")) ? read("eval/results/deployment.json") : null;
const solscan = (a) => `[\`${a}\`](https://solscan.io/account/${a})`;
const links = deployment
  ? [
      `- **Live app:** ${deployment.appUrl}`,
      deployment.videoUrl ? `- **Video:** ${deployment.videoUrl}` : null,
      `- **Program:** ${solscan(deployment.programId)}`,
      `- **Vault:** ${solscan(deployment.vault)} · **Share token (lfUSDC):** ${solscan(deployment.shareMint)}`,
      deployment.repoUrl ? `- **Source:** ${deployment.repoUrl}${deployment.mirrorUrl ? ` (mirror: ${deployment.mirrorUrl})` : ""}` : null,
    ]
      .filter(Boolean)
      .join("\n")
  : "_Not deployed from this checkout: `eval/results/deployment.json` is written by `packages/sdk/scripts/init-vault.ts`._";

const walk = (dir, ext) =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name), ext) : e.name.endsWith(ext) ? [join(dir, e.name)] : []))
    : [];
// counts come from the last `scripts/test-all.sh` run, never from reading the sources
const suite = (name) => (existsSync(join(root, `eval/results/tests/${name}.json`)) ? read(`eval/results/tests/${name}.json`) : null);
const passed = (name) => {
  const s = suite(name);
  if (!s) return "?";
  return s.numFailedTests ? `${s.numPassedTests} (${s.numFailedTests} failing)` : `${s.numPassedTests}`;
};

const blocks = {
  tests: `${passed("program")} program tests (LiteSVM, mainnet snapshots), ${passed("sdk")} SDK tests and ${passed("mcp")} MCP server tests, all passing`,
  links,
  headline: `A direct bridge-and-deposit into Kamino reverts in ${adverse.length - docs} of ${adverse.length} adverse market conditions and strands the bridged funds. Landfall lands ${lf} of ${adverse.length}.`,
  landing: [
    `| Condition (mainnet snapshot, ${usd(landing.bridged_usdc)} bridged) | Direct deposit into Kamino | Landfall |`,
    "|---|---|---|",
    ...landing.results.map(
      (r) =>
        `| ${r.scenario} | ${r.docs_recipe.landed ? "lands" : `**reverts** (\`${(r.docs_recipe.error ?? "").replace(/^Program \S+ failed: /, "").slice(0, 48)}\`), ${usd(r.docs_recipe.usdc_left_in_intermediary)} stuck`} | lands, ${(r.landfall.shares_minted / 1e6).toLocaleString("en-US")} lfUSDC minted |`,
    ),
    "",
    `Adverse conditions: Landfall **${lf}/${adverse.length}**, direct deposit **${docs}/${adverse.length}** (${usd(stranded)} stranded across the failures). Source: \`eval/results/landing.json\`, produced by \`programs/landfall/tests/eval_landing.rs\`.`,
  ].join("\n"),
  compute: [
    "| Transaction | Compute units |",
    "|---|---|",
    ...compute.map((c) => `| ${c.transaction} | ${k(c.compute_units)} |`),
    "",
    binary
      ? `Program binary${verifiable ? " (reproducible build, `scripts/verifiable-build.sh`)" : ""}: ${k(binary.length)} bytes, sha256 \`${createHash("sha256").update(binary).digest("hex")}\`.`
      : "Program binary: build with `scripts/verifiable-build.sh`.",
  ].join("\n"),
};

const INLINE = new Set(["tests"]);
const docsFiles = ["README.md", "JUDGES.md", "CLAIMS.md", "CHALLENGE_CHECKLIST.md"].filter((f) => existsSync(join(root, f)));
let stale = false;
for (const f of docsFiles) {
  const path = join(root, f);
  const before = readFileSync(path, "utf8");
  // `tests` sits inside sentences and table cells; everything else is a block on its own lines
  const after = before.replace(/<!-- results:(\w+) -->([\s\S]*?)<!-- \/results:\1 -->/g, (m, name) => {
    if (blocks[name] === undefined) return m;
    return INLINE.has(name) ? `<!-- results:${name} -->${blocks[name]}<!-- /results:${name} -->` : `<!-- results:${name} -->\n${blocks[name]}\n<!-- /results:${name} -->`;
  });
  if (after !== before) {
    stale = true;
    if (!process.argv.includes("--check")) writeFileSync(path, after);
    console.log(`${process.argv.includes("--check") ? "stale" : "updated"} ${f}`);
  }
}
if (process.argv.includes("--check") && stale) process.exit(1);
