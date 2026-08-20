/**
 * EmbeddingsProvider — the contract for turning text into vector
 * embeddings (e.g. for pattern-library similarity search across
 * benchmarks).
 *
 * Interface only this sprint — no default implementation, because nothing
 * in the platform uses embeddings today. Exists so the capability has a
 * name and a place to register a provider (OpenAI, Voyage, Gemini) once
 * something needs one.
 */
export class EmbeddingsProvider {
  /**
   * @param {string|string[]} textOrTexts
   * @returns {Promise<number[]|number[][]>}
   */
  async embed(textOrTexts) {
    throw new Error(`${this.constructor.name} must implement embed(textOrTexts)`);
  }
}
