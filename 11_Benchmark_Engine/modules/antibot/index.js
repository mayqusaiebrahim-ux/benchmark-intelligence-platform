/**
 * Anti-Bot Layer — public entry point. Mirrors the other modules' own
 * index.js convention (discovery, vision, analysis, reports, navigation_runner).
 */

export { probeUrl } from './probe.js';
export { writeProtectionReport } from './protectionReport.js';
export { classifyNetworkError, classifyResponse } from './detectors.js';
