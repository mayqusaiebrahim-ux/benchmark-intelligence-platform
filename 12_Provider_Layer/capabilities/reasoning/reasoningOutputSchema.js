/**
 * reasoningOutputSchema — the JSON Schema from ADR 0002
 * (docs/adr/0002-reasoning-output-contract.md §5), transcribed verbatim so
 * it has exactly one source of truth instead of drifting between the ADR
 * document and whatever a Reasoning Provider actually requests from the
 * model.
 *
 * This is a capability-level contract, not an Anthropic-specific one — ADR
 * 0002 states it "becomes the contract for all future Reasoning
 * Providers," which is why it lives here in 12_Provider_Layer/capabilities/
 * reasoning/ next to ReasoningProvider.js, not inside
 * 10_Dashboard/lib/providers/ClaudeProvider.js itself. Any future Reasoning
 * Provider (OpenAI, Gemini, a re-introduced agentic CLI) requests this same
 * schema via whatever structured-output mechanism it supports.
 *
 * Constraints respected throughout (Anthropic's structured-outputs JSON
 * Schema subset): no `minimum`/`maximum`/`multipleOf`, no `minLength`/
 * `maxLength`, no recursive schemas, every object sets
 * `additionalProperties: false` with an explicit `required` list. Bounded
 * numeric ranges (1–5 scores) are expressed as integer `enum` instead of
 * `minimum`/`maximum` for exactly this reason.
 */
export const REASONING_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'meta',
    'executive_summary',
    'journey_steps',
    'ux_analysis',
    'innovation_scores',
    'emerging_patterns',
    'innovation_opportunities',
    'saudia_opportunities_markdown',
    'figma_annotations',
    'matrix_updates',
  ],
  properties: {
    meta: {
      type: 'object',
      additionalProperties: false,
      required: ['company_name', 'company_slug', 'category', 'url', 'benchmark_date'],
      properties: {
        company_name: { type: 'string', description: "Display name, e.g. 'Mindtrip'" },
        company_slug: { type: 'string', description: "Filesystem-safe key matching Master_Benchmark_Matrix.json's companies[] key" },
        category: { type: 'string', enum: ['Airlines', 'OTAs', 'AI_First_Products', 'Super_Apps', 'Big_Tech'] },
        url: { type: 'string', description: 'Primary URL benchmarked, or empty string for a feature-only/URL-less request' },
        benchmark_date: { type: 'string', description: 'ISO 8601 date this benchmark was run' },
      },
    },

    executive_summary: {
      type: 'string',
      description: 'Full markdown content for 01_executive_summary.md. One page, answers the 5 mandatory questions at the product level.',
    },

    journey_steps: {
      type: 'array',
      description: 'Exactly 12 entries, one per CLAUDE.md journey step, in step order.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['step_number', 'step_name', 'ai_involved', 'evidence_source', 'narrative_markdown'],
        properties: {
          step_number: { type: 'integer', enum: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
          step_name: {
            type: 'string',
            enum: [
              'Entry', 'Discovery', 'Search', 'AI Interaction', 'Recommendations',
              'Maps', 'Booking', 'Ancillaries', 'Payment', 'Trip Management',
              'Check-in', 'Loyalty',
            ],
          },
          ai_involved: { type: 'boolean', description: 'False → this step gets a one-paragraph note only, per the Innovation Filter' },
          evidence_source: {
            type: 'string',
            enum: [
              'OBSERVED', 'RESEARCHED-WEB', 'RESEARCHED-REVIEW', 'RESEARCHED-VIDEO',
              'INFERRED', 'LOGIN-GATED', 'APP-ONLY', 'NOT FOUND',
            ],
          },
          narrative_markdown: {
            type: 'string',
            description: "Full markdown content for this step's file in 02_user_journey/. One paragraph if ai_involved is false.",
          },
          screenshot_refs: {
            type: 'array',
            description: 'Paths (already written by screenshotStage) this step\'s narrative references, for Artifact Generator to cross-link — not new writes.',
            items: { type: 'string' },
          },
        },
      },
    },

    ux_analysis: {
      type: 'string',
      description: 'Full markdown content for 03_ux_analysis.md — design quality, AI maturity, interaction patterns.',
    },

    innovation_scores: {
      type: 'object',
      additionalProperties: false,
      required: ['overall_score', 'step_scores', 'innovation_count', 'ai_maturity_level'],
      properties: {
        overall_score: { type: 'number', description: 'Mean of all step scores' },
        ai_maturity_level: {
          type: 'string',
          enum: ['Absent', 'Basic', 'Assistive', 'Conversational', 'Autonomous'],
        },
        innovation_count: { type: 'integer', description: 'Number of steps scoring 4+ on the Innovation dimension' },
        step_scores: {
          type: 'array',
          description: 'One entry per journey step scored (ai_involved steps only need full scoring).',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['step_number', 'clarity', 'ai_sophistication', 'personalization', 'delight', 'innovation'],
            properties: {
              step_number: { type: 'integer', enum: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
              clarity: { type: 'integer', enum: [1, 2, 3, 4, 5] },
              ai_sophistication: { type: 'integer', enum: [1, 2, 3, 4, 5] },
              personalization: { type: 'integer', enum: [1, 2, 3, 4, 5] },
              delight: { type: 'integer', enum: [1, 2, 3, 4, 5] },
              innovation: { type: 'integer', enum: [1, 2, 3, 4, 5] },
            },
          },
        },
      },
    },

    emerging_patterns: {
      type: 'array',
      description: 'Full content for 04_emerging_patterns.md, and the source list Matrix Update reconciles against pattern_library.json.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['pattern_name', 'description_markdown', 'saudia_relevance', 'industry_position', 'expected_position_12_24mo'],
        properties: {
          pattern_name: { type: 'string' },
          description_markdown: { type: 'string' },
          saudia_relevance: { type: 'integer', enum: [1, 2, 3, 4, 5] },
          industry_position: {
            type: 'string',
            enum: ['Table Stakes', 'Emerging Trend', 'Unique Differentiator', 'Experimental', 'Ahead of Its Time'],
          },
          expected_position_12_24mo: {
            type: 'string',
            enum: ['Table Stakes', 'Emerging Trend', 'Unique Differentiator', 'Experimental', 'Ahead of Its Time'],
          },
          product_type_fit: {
            type: 'string',
            enum: ['Airline-Native', 'OTA-Adjacent', 'Platform-Level', 'AI-Native Only'],
          },
          saudia_timeline: {
            type: 'string',
            enum: ['Now (0-6 months)', 'Short-term (6-18 months)', 'Medium-term (18-36 months)', 'Long-term (3-5 years)', 'Not for Saudia'],
          },
        },
      },
    },

    innovation_opportunities: {
      type: 'object',
      additionalProperties: false,
      required: ['adopt', 'evolve', 'avoid', 'saudia_brief_tiers'],
      description: 'Full content for 05_innovation_opportunities.md',
      properties: {
        adopt: { type: 'array', items: { type: 'string' }, description: 'Ideas Worth Adopting — as-is or minimal adaptation' },
        evolve: { type: 'array', items: { type: 'string' }, description: "Ideas Worth Evolving — good but could go further with Saudia's context" },
        avoid: { type: 'array', items: { type: 'string' }, description: 'Ideas to Avoid — friction, confusion, or brand mismatch, with reason' },
        saudia_brief_tiers: {
          type: 'object',
          additionalProperties: false,
          required: ['quick_wins', 'medium_term', 'long_term_vision', 'moonshot_ideas'],
          properties: {
            quick_wins: { type: 'array', items: { type: 'string' } },
            medium_term: { type: 'array', items: { type: 'string' } },
            long_term_vision: { type: 'array', items: { type: 'string' } },
            moonshot_ideas: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },

    saudia_opportunities_markdown: {
      type: 'string',
      description: 'Full markdown content for 07_Saudia_Opportunities/[Company]_opportunities.md — the synthesized strategic brief, built from innovation_opportunities.saudia_brief_tiers.',
    },

    figma_annotations: {
      type: 'object',
      additionalProperties: false,
      required: ['journey_map', 'innovation_callouts', 'pattern_cards', 'opportunity_notes'],
      description: 'Full content for 08_Figma/[Company]/annotations.json',
      properties: {
        journey_map: { type: 'array', items: { type: 'string' } },
        innovation_callouts: { type: 'array', items: { type: 'string' } },
        pattern_cards: { type: 'array', items: { type: 'string' } },
        opportunity_notes: { type: 'array', items: { type: 'string' } },
      },
    },

    matrix_updates: {
      type: 'object',
      additionalProperties: false,
      required: ['overview', 'ai_capabilities', 'ux_patterns', 'pattern_tracker_entries', 'key_insight', 'beats_best_in_class'],
      description: "Everything Matrix Update needs to write Master_Benchmark_Matrix.json's companies[company_slug] entry and related top-level sections. company meta comes from the top-level `meta` object; journey_scores/innovation_scores come from `innovation_scores` above.",
      properties: {
        overview: { type: 'string', description: 'Short company/product overview for the matrix entry' },
        ai_capabilities: { type: 'array', items: { type: 'string' }, description: 'Notable AI capabilities, for the matrix companies[].ai_capabilities list' },
        ux_patterns: { type: 'array', items: { type: 'string' }, description: 'Pattern names present, for the matrix companies[].ux_patterns list' },
        pattern_tracker_entries: {
          type: 'array',
          description: 'One entry per pattern in emerging_patterns, telling Matrix Update how to reconcile against pattern_library.json.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['pattern_name', 'is_new_to_library'],
            properties: {
              pattern_name: { type: 'string' },
              is_new_to_library: { type: 'boolean', description: 'True if this pattern was not already in pattern_library.json before this benchmark' },
            },
          },
        },
        key_insight: {
          type: 'object',
          additionalProperties: false,
          required: ['synthesis', 'saudia_imperative', 'watch_for_questions'],
          description: "The new entry for Master_Benchmark_Matrix.json's key_insights array",
          properties: {
            synthesis: { type: 'string' },
            saudia_imperative: { type: 'string' },
            watch_for_questions: { type: 'array', items: { type: 'string' } },
          },
        },
        beats_best_in_class: {
          type: 'boolean',
          description: "True if this benchmark's overall_score beats the matrix's current saudia_gap.best_score — tells Matrix Update whether to update best_in_class/best_score",
        },
      },
    },
  },
};
