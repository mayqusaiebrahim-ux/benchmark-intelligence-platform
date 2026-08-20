/**
 * reasoningStage — wraps getReasoningProvider().run() and translates a
 * resolved 'failed' status into a THROWN Error, the only signal
 * BenchmarkRuntime (and, above it, BenchmarkOrchestrator) understands as a
 * failure.
 *
 * Sprint 21: reads previousOutput (when present) and augments the prompt
 * with the automated capture context — URL reached, page title, screenshot
 * paths, and Vision's structural findings — ahead of the original trigger
 * prompt text, so Reasoning is context-driven instead of relying only on
 * the plain prompt. Falls back to the plain prompt exactly as before when
 * previousOutput is absent (url-less requests never run Navigation/
 * Screenshot/Vision — see pipelines/fullPipeline.js), preserving existing
 * behavior for those requests unchanged.
 */
import { getReasoningProvider } from '../../12_Provider_Layer/registry/ProviderRegistry.js';
import { Stage } from '../runtime/Stage.js';

function buildAugmentedPrompt({ prompt, previousOutput }) {
  const { url, title, screenshots, visionFindings } = previousOutput || {};
  if (!url && !title && !screenshots && !visionFindings) return prompt;

  const lines = ['## Automated Capture Context', ''];
  if (url) lines.push(`- URL reached: ${url}`);
  if (title) lines.push(`- Page title: ${title}`);
  if (screenshots?.fullPage?.path) lines.push(`- Full-page screenshot: ${screenshots.fullPage.path}`);
  if (screenshots?.viewport?.path) lines.push(`- Viewport screenshot: ${screenshots.viewport.path}`);
  if (visionFindings) {
    lines.push('- Vision findings (structural detection only, no recommendations):');
    lines.push('```json');
    lines.push(JSON.stringify(visionFindings, null, 2));
    lines.push('```');
  }
  lines.push('', '---', '');

  return `${lines.join('\n')}${prompt}`;
}

export const reasoningStage = new Stage(
  'reasoning',
  'Reasoning (Claude)',
  async ({ prompt, cwd, jobId, previousOutput }) => {
    const augmentedPrompt = buildAugmentedPrompt({ prompt, previousOutput });
    const result = await getReasoningProvider().run({ prompt: augmentedPrompt, cwd, jobId });
    if (result.status !== 'completed') {
      throw new Error(result.error || 'claude exited with a non-zero status');
    }
    return result; // { status: 'completed', raw }
  },
);
