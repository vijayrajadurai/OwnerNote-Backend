/* Scores KAI on a whole owner dataset file: npm run kai:dataset -- <file.json> [intents|topics] */
import { readFileSync } from "fs";
import { scoreDataset, type DatasetRow } from "../src/kai/eval/datasetEval";

const [file, kind = "intents"] = process.argv.slice(2);
if (!file) {
  // eslint-disable-next-line no-console
  console.error("usage: npm run kai:dataset -- <file.json> [intents|topics]");
  process.exit(2);
}
const rows = JSON.parse(readFileSync(file, "utf8")) as DatasetRow[];
const report = scoreDataset(rows, kind === "topics" ? "topics" : "intents");
const pct = (ok: number, total: number) => `${ok}/${total} (${((100 * ok) / Math.max(1, total)).toFixed(2)}%)`;
// eslint-disable-next-line no-console
console.log(`lines scored: ${report.lines}`);
for (const [lang, r] of Object.entries(report.byLang)) {
  // eslint-disable-next-line no-console
  console.log(`  ${lang === "th" ? "typed Tanglish" : lang === "ta" ? "mic Tamil     " : "English       "}: ${pct(r.ok, r.total)}`);
}
// eslint-disable-next-line no-console
console.log(`  typed = mic    : ${pct(report.sameTypedAndMic, report.lines)}`);
for (const f of report.failures.slice(0, 40)) {
  // eslint-disable-next-line no-console
  console.log(`  ✗ [${f.lang}] ${f.intent} (${f.why}) ${f.text} => ${f.got}`);
}
