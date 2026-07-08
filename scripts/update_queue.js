/**
 * update_queue.js — advances a benchmark request's per-competitor queue stage.
 *
 * This is the hook a benchmarking session calls at each phase boundary (see
 * "Queue Integration" in Benchmark_Workflow.md) so the dashboard Queue page
 * reflects real progress instead of requiring someone to click through it by
 * hand. Works standalone — does not need the dashboard server running.
 *
 * Usage:
 *   node scripts/update_queue.js <requestId> <slug> <stage>
 *
 * Example:
 *   node scripts/update_queue.js req_20260707_001 mindtrip capturing_screenshots
 *
 * Valid stages: queued, preparing, opening_website, capturing_screenshots,
 *               analyzing_ux, extracting_patterns, updating_matrix,
 *               generating_dashboard, completed
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { setStage, STAGES } from '../10_Dashboard/lib/requestsStore.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const [requestId, slug, stage] = process.argv.slice(2);

if (!requestId || !slug || !stage) {
  console.error('Usage: node scripts/update_queue.js <requestId> <slug> <stage>');
  console.error(`Valid stages: ${STAGES.join(', ')}`);
  process.exit(1);
}

try {
  const request = setStage(ROOT, requestId, slug, stage);
  const item = request.items.find(i => i.slug === slug);
  console.log(`✅ ${request.id} / ${item.name} → ${item.stage} (batch status: ${request.status})`);
} catch (err) {
  console.error(`❌ ${err.message}`);
  process.exit(1);
}
