export interface DispatchLatencySnapshot {
  readonly count: number;
  readonly sumMs: number;
  readonly minMs: number;
  readonly maxMs: number;
}

export interface WorkerMetricsSnapshot {
  readonly claimed: number;
  readonly delivered: number;
  readonly failed: number;
  readonly retried: number;
  readonly deadLettered: number;
  readonly staleClaimsReleased: number;
  readonly dispatchLatency: DispatchLatencySnapshot;
}

/** In-process counters for the dispatcher runtime. Exported only for health/ops tooling. */
export class WorkerMetrics {
  private claimed = 0;
  private delivered = 0;
  private failed = 0;
  private retried = 0;
  private deadLettered = 0;
  private staleClaimsReleased = 0;
  private dispatchCount = 0;
  private dispatchSumMs = 0;
  private dispatchMinMs = Number.POSITIVE_INFINITY;
  private dispatchMaxMs = 0;

  recordClaimed(count: number): void {
    this.claimed += count;
  }

  recordDelivered(): void {
    this.delivered += 1;
  }

  recordFailed(): void {
    this.failed += 1;
  }

  recordRetried(): void {
    this.retried += 1;
  }

  recordDeadLettered(): void {
    this.deadLettered += 1;
  }

  recordStaleClaimsReleased(count: number): void {
    this.staleClaimsReleased += count;
  }

  recordDispatchLatency(latencyMs: number): void {
    this.dispatchCount += 1;
    this.dispatchSumMs += latencyMs;
    this.dispatchMinMs = Math.min(this.dispatchMinMs, latencyMs);
    this.dispatchMaxMs = Math.max(this.dispatchMaxMs, latencyMs);
  }

  getSnapshot(): WorkerMetricsSnapshot {
    return {
      claimed: this.claimed,
      delivered: this.delivered,
      failed: this.failed,
      retried: this.retried,
      deadLettered: this.deadLettered,
      staleClaimsReleased: this.staleClaimsReleased,
      dispatchLatency: {
        count: this.dispatchCount,
        sumMs: this.dispatchSumMs,
        minMs: this.dispatchCount === 0 ? 0 : this.dispatchMinMs,
        maxMs: this.dispatchMaxMs,
      },
    };
  }
}
