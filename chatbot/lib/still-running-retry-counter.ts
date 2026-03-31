/** Tracks still_running retries for one query. Lets the agent surface naturally
 *  every N calls (N is re-randomised after each release) so the chatbot shows
 *  organic progress instead of a silent forced-retry loop. */
export class StillRunningRetryCounter {
  private count = 0;
  private max = StillRunningRetryCounter.randomMax();

  private static randomMax(): number {
    return Math.floor(Math.random() * 10) + 6;
  }

  /** Returns true when the counter has hit its threshold — reset and re-randomise. */
  shouldRelease(): boolean {
    this.count++;
    if (this.count >= this.max) {
      this.count = 0;
      this.max = StillRunningRetryCounter.randomMax();
      return true;
    }
    return false;
  }
}
