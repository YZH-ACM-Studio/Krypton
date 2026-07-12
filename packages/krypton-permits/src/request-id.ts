/** Stable HTTP fallback id so an identical retry can resume a durable fence. */
export function deriveAclRequestId(supplied: string | undefined, operation: string, ...identity: unknown[]): string {
    if (supplied?.trim()) return supplied.trim();
    if (!operation.trim()) throw new Error('ACL requestId operation is required');
    const encoded = identity.map((value) => encodeURIComponent(String(value))).join(':');
    return `acl:${encodeURIComponent(operation)}:${encoded}`;
}
