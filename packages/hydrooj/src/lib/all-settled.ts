/** Starts every operation, waits for all of them, then preserves the exact failure set. */
export async function allSettledOrThrow(operations: ReadonlyArray<() => unknown>, aggregateMessage: string): Promise<void> {
    const results = await Promise.allSettled(operations.map((operation) => Promise.resolve().then(operation)));
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failures.length === 1) throw failures[0].reason;
    if (failures.length > 1) {
        throw new AggregateError(
            failures.map((failure) => failure.reason),
            aggregateMessage,
        );
    }
}
