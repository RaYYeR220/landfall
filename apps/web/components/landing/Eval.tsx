import fs from "node:fs";
import path from "node:path";
import { Reveal } from "./Reveal";

type Outcome = { landed: boolean; error: string | null };
type EvalRow = { id: string; scenario: string; landfall: Outcome; docs_recipe: Outcome };
export type EvalData = { scenarios: number; landfall_landed: number; docs_recipe_landed: number; bridged_usdc?: number; results: EvalRow[] };

/** Reads the landing eval at build time. Returns null when the file is missing or malformed. */
export function readEval(): EvalData | null {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), "..", "..", "eval", "results", "landing.json"), "utf8");
    const j = JSON.parse(raw) as Partial<EvalData>;
    if (typeof j.scenarios !== "number" || typeof j.landfall_landed !== "number" || typeof j.docs_recipe_landed !== "number" || !Array.isArray(j.results)) return null;
    const results = j.results.filter(
      (r): r is EvalRow => !!r && typeof r.id === "string" && typeof r.scenario === "string" && typeof r.landfall?.landed === "boolean" && typeof r.docs_recipe?.landed === "boolean",
    );
    if (!results.length) return null;
    return { scenarios: j.scenarios, landfall_landed: j.landfall_landed, docs_recipe_landed: j.docs_recipe_landed, bridged_usdc: j.bridged_usdc, results };
  } catch {
    return null;
  }
}

const isControl = (r: EvalRow) => r.id === "healthy" || /negative control/i.test(r.scenario);

/** "Program … failed: custom program error: 0x17ca" → "error 0x17ca". */
const errCode = (e: string | null) => {
  if (!e) return null;
  const hex = /custom program error: (0x[0-9a-f]+)/i.exec(e);
  if (hex) return `error ${hex[1]}`;
  if (/panicked/i.test(e)) return "program panicked";
  return "reverted";
};

function Mark({ o, ours }: { o: Outcome; ours?: boolean }) {
  if (o.landed) return <span className={`lf-mark ${ours ? "lf-mark-ours" : "lf-mark-ok"}`}>LANDED</span>;
  return (
    <span className="lf-mark lf-mark-bad" title={o.error ?? undefined}>
      REVERTED
      <small>{errCode(o.error)}</small>
    </span>
  );
}

export function EvalSection({ data }: { data: EvalData }) {
  const adverse = data.results.filter((r) => !isControl(r));
  const both = adverse.filter((r) => r.docs_recipe.landed);
  const usdc = data.bridged_usdc ? data.bridged_usdc / 1e6 : null;

  return (
    <section className="lf-sec lf-eval" id="landing" aria-labelledby="lf-eval-h">
      <div className="wrap">
        <Reveal className="lf-sec-head">
          <div>
            <p className="eyebrow">Landing under stress</p>
            <h2 className="lf-h2" id="lf-eval-h">
              No deposit gets stuck.
            </h2>
          </div>
          <p className="lf-lede">
            The same {usdc ? `${usdc.toLocaleString("en-US")} USDC ` : ""}bridge-in, replayed against {adverse.length} adverse lending-market conditions and one normal control. Landfall’s landing never
            calls the lending market: it mints vault shares first, and the vault allocates afterwards.
          </p>
        </Reveal>

        <Reveal className="lf-eval-body" delay=".08s">
          <div className="lf-score">
            <div className="lf-score-cell">
              <p className="lf-big">
                {adverse.filter((r) => r.landfall.landed).length} <span>/</span> {adverse.length}
              </p>
              <p className="lf-score-t">
                adverse cases <b>land</b> with Landfall
              </p>
            </div>
            <div className="lf-score-cell lf-score-dim">
              <p className="lf-big">
                {both.length} <span>/</span> {adverse.length}
              </p>
              <p className="lf-score-t">for the documented Kamino bridge-in recipe</p>
            </div>
          </div>

          <div className="lf-cases-wrap">
            <table className="lf-cases">
              <thead>
                <tr>
                  <th scope="col">Condition when the bridged USDC arrives</th>
                  <th scope="col">Landfall</th>
                  <th scope="col">Documented recipe</th>
                </tr>
              </thead>
              <tbody>
                {data.results.map((r) => (
                  <tr key={r.id} className={isControl(r) ? "lf-case-control" : r.docs_recipe.landed ? "lf-case-both" : undefined}>
                    <th scope="row">
                      {r.scenario}
                      {isControl(r) ? <span className="lf-tag">control</span> : null}
                    </th>
                    <td data-label="Landfall">
                      <Mark o={r.landfall} ours />
                    </td>
                    <td data-label="Documented recipe">
                      <Mark o={r.docs_recipe} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {both.length ? (
            <p className="lf-honest">
              <b>Where the recipe also lands.</b> Besides normal conditions, the documented recipe lands in {both.length} of the {adverse.length} adverse cases:{" "}
              {both.map((r, i) => (
                <span key={r.id}>
                  {i ? (i === both.length - 1 ? " and " : ", ") : ""}“{r.scenario.replace(/\s*\(.*\)\s*$/, "")}”
                </span>
              ))}
              . The gap is the hard stops, where a revert strands the deposit.
            </p>
          ) : null}
          <p className="lf-caption">Mainnet snapshot, LiteSVM. A reverted bridge-in burns its durable nonce and leaves the user’s USDC in the intermediary.</p>
        </Reveal>
      </div>
    </section>
  );
}
