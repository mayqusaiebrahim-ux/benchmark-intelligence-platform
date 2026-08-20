/**
 * ClaudeProvider — Phase 1's only AgentProvider implementation. Runs a
 * benchmark's existing trigger prompt through the `claude` CLI, headlessly,
 * so nobody has to copy it into an interactive session by hand.
 *
 * Deliberately minimal: no stream-json parsing, no sub-stage inference, no
 * timeout, no retries — those are Phase 2+ once this foundation is proven.
 * The only thing this reports is whether the process exited cleanly.
 *
 * Permission mode — a real, visible tradeoff, not an oversight:
 * A headless run has no human to answer a tool-permission prompt, and an
 * unanswered prompt hangs the process forever. `acceptEdits` alone doesn't
 * guarantee that — other tool categories (WebFetch, MCP tools) can still
 * prompt. This uses `bypassPermissions` so the run actually completes
 * end-to-end, on the same trust basis a human already extends today by
 * manually running this same trigger prompt in an interactive Claude Code
 * session with full tool access. Scoping this down (an --allowedTools
 * allowlist, a bounded timeout) is exactly the kind of hardening called out
 * as a risk in the Sprint V1.5 investigation — intentionally deferred to a
 * later phase, not forgotten.
 */

import { spawn } from 'child_process';
import { AgentProvider } from './AgentProvider.js';

export class ClaudeProvider extends AgentProvider {
  async run({ prompt, cwd, jobId }) {
    return new Promise((resolve) => {
      let child;
      try {
        child = spawn('claude', [
          '-p',
          '--output-format', 'text',
          '--permission-mode', 'bypassPermissions',
          // Deliberately no prompt text here — see stdin.write() below.
        ], {
          cwd,
          stdio: ['pipe', 'pipe', 'pipe'],
          // The globally-installed `claude` command resolves to claude.cmd/
          // claude.ps1 on Windows, not a raw .exe — spawn() without a shell
          // can't launch those directly (confirmed: fails with ENOENT/EINVAL
          // otherwise). A shell is what a human typing `claude ...` in a
          // terminal already goes through, so this doesn't add new trust.
          shell: process.platform === 'win32',
        });
      } catch (err) {
        resolve({ status: 'failed', error: err.message });
        return;
      }

      // The prompt is piped via stdin rather than passed as a CLI argument.
      // Confirmed by hand: with shell:true, Node concatenates args into a
      // single command-line string without escaping them (Node's own
      // DEP0190 warning) — a multi-word prompt gets mangled by cmd.exe and
      // `claude` never sees it, even though the process still exits 0. `-p`
      // with no positional prompt reads from stdin instead, which sidesteps
      // shell quoting entirely since only short, argument-safe flags ever
      // reach the shell's command line.
      child.stdin.write(prompt);
      child.stdin.end();

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });

      child.on('error', (err) => {
        // e.g. `claude` isn't on PATH — a real failure, not a benchmark-domain one.
        resolve({ status: 'failed', error: `Could not start claude CLI: ${err.message}` });
      });

      child.on('exit', (code) => {
        if (code === 0) {
          resolve({ status: 'completed', raw: stdout });
        } else {
          resolve({ status: 'failed', error: stderr.trim() || `claude exited with code ${code}`, raw: stdout });
        }
      });
    });
  }
}
