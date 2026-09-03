/**
 * autonomous_navigator/evidenceCapture — screenshots + page text from the
 * agent's live session. One mandatory capture at the terminal state (target /
 * safety / blocker / budget); up to a few milestone captures during the run.
 *
 * The autonomous navigator drives its OWN browser session, so these files are
 * written to a temp dir and handed back to the Navigation Runner, which copies
 * the terminal screenshot into the canonical evidence path (see
 * navigation_runner/capture.js `evidenceOverride`).
 */
import { mkdtempSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { logInfo, logError } from '../../../shared/logger.mjs';

export function makeEvidenceStore(slug = 'agent') {
  const dir = mkdtempSync(join(tmpdir(), `agentnav-${String(slug).replace(/[^a-z0-9_-]/gi, '')}-`));
  const milestones = [];
  let terminal = null;

  async function shot(page, label) {
    const safeLabel = String(label).replace(/[^a-z0-9_-]/gi, '_').slice(0, 40);
    const path = join(dir, `${milestones.length.toString().padStart(2, '0')}_${safeLabel}.png`);
    let url = null; let title = null; let html = '';
    try { url = page.url(); } catch { /* ignore */ }
    try { title = await page.title(); } catch { /* ignore */ }
    try {
      await page.screenshot({ path });
    } catch (err) {
      logError('agent_nav evidence screenshot failed', err, { label });
      return null;
    }
    try { html = await page.content ? await page.content() : ''; } catch { /* understudy Page may lack content() */ }
    if (!html) {
      try { html = await page.evaluate(() => document.documentElement.outerHTML); } catch { /* ignore */ }
    }
    const rec = { path, url, title, label, html, at: new Date().toISOString() };
    logInfo('agent_nav_evidence', { label, url, path });
    return rec;
  }

  return {
    dir,
    async milestone(page, label) {
      if (milestones.length >= 4) return null;
      const rec = await shot(page, `milestone_${label}`);
      if (rec) milestones.push(rec);
      return rec;
    },
    async captureTerminal(page, label) {
      terminal = await shot(page, `terminal_${label}`);
      return terminal;
    },
    result() {
      return {
        dir,
        milestones: milestones.map((m) => ({ path: m.path, url: m.url, label: m.label })),
        terminal: terminal
          ? { screenshotPath: terminal.path, pageUrl: terminal.url, pageTitle: terminal.title, pageHtml: terminal.html, exists: existsSync(terminal.path) }
          : null,
      };
    },
  };
}
