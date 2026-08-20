/**
 * Pipeline — an ordered, named list of Stage instances. No execution logic
 * lives here (that's Runtime.js) — a Pipeline is just data the Runtime
 * consumes, kept separate so a stage list can be described without
 * touching the executor.
 */
export class Pipeline {
  /**
   * @param {string} id - e.g. 'full'
   * @param {import('./Stage.js').Stage[]} stages
   */
  constructor(id, stages) {
    this.id = id;
    this.stages = stages;
  }
}
