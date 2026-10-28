/**
 * Bounded execution for analysis operations: one process-wide concurrency
 * gate, a per-operation deadline, and cooperative cancellation (including
 * Ctrl+C for CLI use). Failures are returned as structured errors.
 */
import { ConcurrencyGate, resolveLimits, withTimeout } from "./limits.mjs";
import { NexoraError, ErrorCodes, toErrorObject } from "./errors.mjs";

let gate;
function sharedGate(limits) {
  if (!gate) gate = new ConcurrencyGate({ concurrency: limits.concurrency, maxQueue: limits.maxQueue });
  return gate;
}

/**
 * Run `task({signal, limits})` under limits.
 * @template T
 * @param {string} label
 * @param {(ctx: {signal: AbortSignal, limits: ReturnType<typeof resolveLimits>}) => Promise<T>} task
 * @param {{limits?: object, signal?: AbortSignal}} [opts]
 * @returns {Promise<T>}
 */
export async function runBounded(label, task, opts = {}) {
  const limits = resolveLimits(opts.limits);
  return sharedGate(limits).run(
    () => withTimeout((signal) => task({ signal, limits }), { timeoutMs: limits.timeoutMs, signal: opts.signal, label }),
    opts.signal,
  );
}

/**
 * CLI helper: wire SIGINT/SIGTERM to an AbortController, run `main`, print a
 * structured error on failure and set an exit code (2 usage, 1 failure,
 * 130 interrupted). Never calls process.exit() abruptly, so streams flush.
 */
export async function runCli(main) {
  const controller = new AbortController();
  let interrupts = 0;
  const onSignal = (sig) => {
    interrupts++;
    if (interrupts > 1) process.exit(130);
    process.stderr.write(`\nReceived ${sig}; cancelling (press Ctrl+C again to force)...\n`);
    controller.abort(new NexoraError(ErrorCodes.CANCELLED, `Interrupted by ${sig}`));
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  try {
    await main(controller.signal);
  } catch (error) {
    const e = toErrorObject(error);
    process.stderr.write(`nexora: ${e.code}: ${e.message}${e.hint ? `\n  hint: ${e.hint}` : ""}\n`);
    process.exitCode = e.code === ErrorCodes.INVALID_ARGUMENT ? 2 : e.code === ErrorCodes.CANCELLED ? 130 : 1;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}
