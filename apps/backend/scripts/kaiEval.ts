/* Prints KAI's score on the evaluation set: npm run kai:eval */
import { runIntentEval } from "../src/kai/eval/runEval";

const report = runIntentEval();
// eslint-disable-next-line no-console
console.log(`KAI intent eval: ${report.passed}/${report.total} (${(report.accuracy * 100).toFixed(1)}%)`);
for (const f of report.failures) {
  // eslint-disable-next-line no-console
  console.log(`  ✗ ${JSON.stringify(f.case.text)} expected ${JSON.stringify(f.case)} got ${JSON.stringify(f.got)}`);
}
process.exit(report.failures.length === 0 ? 0 : 1);
