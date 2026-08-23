/**
 * featureDiscoveryStage — Sprint Reset: wraps the existing, unmodified
 * Discovery module (11_Benchmark_Engine/modules/discovery) via
 * NavigationProvider.discover(), the same capability call
 * PlaywrightNavigationProvider.js already exposes. No Discovery code is
 * changed here — this only connects it to the Orchestrator, which it was
 * never wired into before.
 *
 * First stage in the Feature Benchmark pipeline: its output (a Discovery
 * Report, consumed as-is) becomes the next stage's previousOutput.
 */
import { getNavigationProvider } from '../../12_Provider_Layer/registry/ProviderRegistry.js';
import { Stage } from '../runtime/Stage.js';

export const featureDiscoveryStage = new Stage(
  'feature_discovery',
  'Discovery',
  async ({ url, company, jobId }) => {
    const companySlug = typeof jobId === 'string' ? jobId.split(':')[1] : undefined;
    const discoveryReport = await getNavigationProvider().discover({ url, companySlug, companyName: company || null });
    return discoveryReport;
  },
);
