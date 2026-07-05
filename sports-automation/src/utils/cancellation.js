/** A signal that aborts when either the timeout elapses or an external (e.g. user-cancel) signal fires. */
export function timeoutSignal(ms, externalSignal) {
  const timeout = AbortSignal.timeout(ms);
  return externalSignal ? AbortSignal.any([timeout, externalSignal]) : timeout;
}

export class CancelledError extends Error {
  constructor(message = "Cancelled by user") {
    super(message);
    this.name = "CancelledError";
    this.code = "cancelled";
  }
}

export function throwIfCancelled(signal) {
  if (signal?.aborted) throw new CancelledError();
}
