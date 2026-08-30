/**
 * featureReportSchema — the `output_config.format` contract for the Feature
 * Benchmark pipeline's Reasoning stage only. Deliberately unrelated to
 * REASONING_OUTPUT_SCHEMA (the Complete Journey / ADR 0002 contract, whose
 * grammar is empirically too large for Anthropic's structured-output
 * compiler) and to ADR 0003's stage schemas — this is the Sprint Reset's
 * own, much smaller shape: "one concise report for one feature."
 *
 * Kept intentionally minimal, matching CLAUDE.md's evidence-source
 * vocabulary (Hard Rule 16) so a Feature Benchmark can honestly say it
 * found nothing, rather than inventing content.
 */
export const FEATURE_REPORT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['analyzed_company', 'feature_found', 'evidence_source', 'summary_markdown'],
  properties: {
    analyzed_company: {
      type: 'string',
      description: 'The exact name of the company / product this report analyses. This MUST be the company named in the context you were given — never a different travel brand. If the evidence appears to show a different company, say so in summary_markdown and still put the requested company name here.',
    },
    feature_found: {
      type: 'boolean',
      description: 'True if the captured page/screenshot actually shows the requested feature; false if the crawler could only reach a related or fallback page.',
    },
    evidence_source: {
      type: 'string',
      enum: [
        'OBSERVED', 'RESEARCHED-WEB', 'RESEARCHED-REVIEW', 'RESEARCHED-VIDEO',
        'INFERRED', 'LOGIN-GATED', 'APP-ONLY', 'NOT FOUND',
      ],
    },
    summary_markdown: {
      type: 'string',
      description: 'The full, concise benchmark report for this one feature — the only content written to the Feature Benchmark Library.',
    },
  },
};

export const FEATURE_REPORT_EVIDENCE_SOURCES = [
  'OBSERVED', 'RESEARCHED-WEB', 'RESEARCHED-REVIEW', 'RESEARCHED-VIDEO',
  'INFERRED', 'LOGIN-GATED', 'APP-ONLY', 'NOT FOUND',
];
