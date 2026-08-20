/**
 * Journey Mapper — entry point.
 * Given a Discovery Report, an optional UI Map, and a homepage screenshot
 * path, produce a JourneyPlan (contracts/journey_plan.schema.json). Planning
 * only — no Playwright, no navigation, no clicking. Not wired into the
 * orchestrator yet; see README.md for how Sprint 10 connects it.
 */

import { buildJourneyPlan } from './planner.js';

/**
 * planJourney — accepts { discoveryReport, uiMap?, screenshotPath? },
 * returns a JourneyPlanOutput. Synchronous: pure computation, no I/O.
 */
export function planJourney({ discoveryReport, uiMap = [], screenshotPath = null }) {
  if (!discoveryReport) {
    throw new Error('planJourney requires a discoveryReport (Discovery Report output).');
  }

  const plan = buildJourneyPlan({ discoveryReport, uiMap, screenshotPath });

  return {
    schema_version: '0.1.0',
    company_slug: discoveryReport.company_slug || null,
    company_name: discoveryReport.company_name || null,
    planned_at: new Date().toISOString(),
    ...plan,
  };
}
