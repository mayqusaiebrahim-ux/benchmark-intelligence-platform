/**
 * providers.config.js — the single file that decides which registered
 * provider name backs each capability. This is the seam a future Settings
 * UI would read from and write to; today it's just these hardcoded
 * defaults, each one matching what actually runs in production already
 * (see each capability's README.md for why).
 */
export const providerConfig = {
  navigation: 'playwright',
  vision: 'openai',
  reasoning: 'claude',
  screenshot: 'playwright',
  reports: null,     // no provider registered yet
  embeddings: null,  // no provider registered yet
};
