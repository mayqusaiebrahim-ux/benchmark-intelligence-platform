/**
 * JobQueue — a plain FIFO queue of benchmark jobs.
 * No concurrency logic lives here on purpose: the queue only knows how to
 * hold jobs and hand them out one at a time. BenchmarkScheduler decides how
 * many can be in flight simultaneously; JobQueue has no opinion about that,
 * which keeps it trivially testable in isolation.
 */

export class JobQueue {
  #items = [];

  /** @param {Array<object>} [initialJobs] */
  constructor(initialJobs = []) {
    for (const job of initialJobs) this.enqueue(job);
  }

  /** Adds a job to the back of the queue. Returns the queue size after adding. */
  enqueue(job) {
    if (!job || typeof job !== 'object') {
      throw new TypeError('JobQueue.enqueue requires a job object.');
    }
    this.#items.push(job);
    return this.#items.length;
  }

  /** Re-queues a job at the FRONT — used for retries, so a retried job is the
   * next one picked up rather than waiting behind every job queued after it. */
  requeueFront(job) {
    this.#items.unshift(job);
    return this.#items.length;
  }

  /** Removes and returns the next job, or undefined if the queue is empty. */
  dequeue() {
    return this.#items.shift();
  }

  get size() {
    return this.#items.length;
  }

  get isEmpty() {
    return this.#items.length === 0;
  }

  /** Read-only snapshot, for status reporting — never mutate the result. */
  peekAll() {
    return [...this.#items];
  }
}
