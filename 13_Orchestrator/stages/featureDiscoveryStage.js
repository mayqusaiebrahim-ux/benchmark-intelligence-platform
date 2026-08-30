/**
 * featureDiscoveryStage — wraps the existing, unmodified Discovery module
 * via NavigationProvider.discover(). No Discovery code is changed.
 *
 * Correctness additions (target integrity):
 *  - logs the five benchmark_target_* fields before Discovery runs;
 *  - discovers the TARGET's own official URL (never a URL from elsewhere);
 *  - FAILS the run if Discovery's resolved_url leaves the target's
 *    registrable domain (a redirect off the company's own site is exactly
 *    the kind of silent drift that produced a wrong-company report).
 */
import { getNavigationProvider } from '../../12_Provider_Layer/registry/ProviderRegistry.js';
import { Stage } from '../runtime/Stage.js';
import { assertObservedUrl, targetLogFields } from '../runtime/benchmarkTarget.js';
import { withLogContext, logInfo, logError } from '../../shared/logger.mjs';

export const featureDiscoveryStage = new Stage(
  'feature_discovery',
  'Discovery',
  async ({ target }) => {
    return withLogContext({ stage: 'feature_discovery' }, async () => {
      if (!target) throw new Error('featureDiscoveryStage requires a benchmark target.');
      logInfo('Discovery starting', targetLogFields(target));

      let discoveryReport;
      try {
        discoveryReport = await getNavigationProvider().discover({
          url: target.url,
          companySlug: target.slug,
          companyName: target.company,
        });
      } catch (err) {
        logError('Discovery threw', err);
        throw err; // rethrow unchanged
      }

      logInfo('Discovery finished', {
        ...targetLogFields(target),
        resolvedUrl: discoveryReport?.resolved_url,
        websiteType: discoveryReport?.website_type,
      });

      // Target integrity: the site we discovered must still be the target's.
      assertObservedUrl(target, discoveryReport?.resolved_url, 'Discovery');

      return discoveryReport;
    });
  },
);
