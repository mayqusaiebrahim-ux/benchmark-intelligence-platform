/**
 * ProviderRegistry — resolves a capability name to a concrete provider
 * instance, per config/providers.config.js. This is the only place the
 * platform maps a capability to a vendor; every capability's getter falls
 * back to providerConfig's default, so a future caller only ever needs to
 * know the capability name, not which class implements it.
 *
 * Not yet imported by any live call site (see 12_Provider_Layer/README.md
 * "Scope of this sprint") — 11_Benchmark_Engine and 10_Dashboard still
 * call their concrete OpenAI/Claude/Playwright code directly. This
 * registry exists, is fully wired to real default classes, and is
 * independently usable/testable ahead of that follow-up wiring sprint.
 */
import { providerConfig } from '../config/providers.config.js';
import { PlaywrightNavigationProvider } from '../capabilities/navigation/PlaywrightNavigationProvider.js';
import { OpenAIVisionProvider } from '../capabilities/vision/OpenAIVisionProvider.js';
import { ClaudeReasoningProvider } from '../capabilities/reasoning/ClaudeReasoningProvider.js';
import { PlaywrightScreenshotProvider } from '../capabilities/screenshot/PlaywrightScreenshotProvider.js';

const NAVIGATION_PROVIDERS = { playwright: PlaywrightNavigationProvider };
const VISION_PROVIDERS = { openai: OpenAIVisionProvider };
const REASONING_PROVIDERS = { claude: ClaudeReasoningProvider };
const SCREENSHOT_PROVIDERS = { playwright: PlaywrightScreenshotProvider };
const REPORT_PROVIDERS = {};    // intentionally empty — no ReportProvider implemented yet
const EMBEDDINGS_PROVIDERS = {}; // intentionally empty — no EmbeddingsProvider implemented yet

function resolve(providers, name, capabilityLabel) {
  const ProviderClass = providers[name];
  if (!ProviderClass) {
    throw new Error(`No ${capabilityLabel} provider registered for "${name}".`);
  }
  return new ProviderClass();
}

export function getNavigationProvider(name = providerConfig.navigation) {
  return resolve(NAVIGATION_PROVIDERS, name, 'Navigation');
}

export function getVisionProvider(name = providerConfig.vision) {
  return resolve(VISION_PROVIDERS, name, 'Vision');
}

export function getReasoningProvider(name = providerConfig.reasoning) {
  return resolve(REASONING_PROVIDERS, name, 'Reasoning');
}

export function getScreenshotProvider(name = providerConfig.screenshot) {
  return resolve(SCREENSHOT_PROVIDERS, name, 'Screenshot');
}

export function getReportProvider(name = providerConfig.reports) {
  return resolve(REPORT_PROVIDERS, name, 'Report');
}

export function getEmbeddingsProvider(name = providerConfig.embeddings) {
  return resolve(EMBEDDINGS_PROVIDERS, name, 'Embeddings');
}
