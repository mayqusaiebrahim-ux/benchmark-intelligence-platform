/**
 * Stage — the contract every Runtime step must satisfy: an id, a human
 * name, and one function, execute(context). A Stage does NOT know about
 * providers or capabilities directly — concrete stages (13_Orchestrator/
 * stages/) import whatever they need themselves; the Runtime driving them
 * only ever calls execute().
 *
 * execute(context) must either resolve with the stage's output, or throw —
 * that is the ONLY way a stage reports failure to the Runtime. A stage
 * wrapping something that "logically fails" via a resolved value (e.g. a
 * Provider's {status:'failed', error} shape, which never rejects) MUST
 * translate that into a thrown Error itself — see stages/reasoningStage.js.
 */
export class Stage {
  /**
   * @param {string} id - stable machine identifier, e.g. 'reasoning'
   * @param {string} name - human label, e.g. 'Reasoning (Claude)'
   * @param {(context: object) => Promise<any>} execute
   */
  constructor(id, name, execute) {
    this.id = id;
    this.name = name;
    this.execute = execute;
  }
}
