# Reports capability

The contract for AI-generated benchmark deliverables (executive summaries, journey
narratives, UX analysis prose).

**No default provider this sprint.** `11_Benchmark_Engine/modules/reports/homepageReport.js`
already produces the Homepage Benchmark report today, but it does so via deterministic
Markdown templating over Discovery's + Vision's structured output — it makes no AI
vendor call of its own (the only AI in that pipeline is Vision, consumed as an input).
There is nothing existing to wrap into a `ClaudeReportProvider` or `GPTReportProvider`
without writing new generation logic, which Sprint 15 explicitly excludes ("do not
implement all providers"). The interface exists so a future sprint that *does* add an
AI-generated report step has a contract ready to implement.
