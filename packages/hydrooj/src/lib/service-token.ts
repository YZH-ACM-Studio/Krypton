/**
 * Service-token primitives for inter-service auth between hydrooj and external
 * trusted services (Vigil server in particular).
 *
 * ## Conventions
 *
 * - **Two directions, two tokens.** OJ→Vigil uses `KVS_OJ_TOKEN` (Vigil validates).
 *   Vigil→OJ uses `KVS_VIGIL_TOKEN` (OJ validates). They rotate independently.
 *
 * - **Accepted lists, not single values.** Each side stores its expected tokens as
 *   an array (system setting key `serviceToken.<channel>.accepted`, value:
 *   `string[]`). During rotation: append the new token, deploy, rotate the issuer,
 *   then remove the old token. No outage.
 *
 * - **Logging.** First 8 chars of the presented token are logged on each call
 *   (success and failure). Full token never logged.
 *
 * - **Constant-time compare.** Using `crypto.timingSafeEqual` to avoid leaking
 *   token length / prefix via timing side-channels.
 *
 * @see docs/service-tokens.md for rotation runbook
 */

import { timingSafeEqual } from 'node:crypto';
import { Logger } from '@hydrooj/utils';
import { Handler } from '../service/server';
import system from '../model/system';

const logger = new Logger('service-token');

/** Header inspected on incoming requests. Lower-cased to match koa normalization. */
const HEADER = 'x-service-token';

export class ServiceTokenError extends Error {
    code = 401;
    constructor(public reason: 'missing' | 'invalid' | 'no-accepted-list') {
        super(`Service token ${reason}`);
        this.name = 'ServiceTokenError';
    }
}

/** Returns the configured list of accepted tokens for a channel, or [] if none. */
export function getAcceptedTokens(channel: string): string[] {
    const list = system.get(`serviceToken.${channel}.accepted`);
    if (!Array.isArray(list)) return [];
    return list.filter((s) => typeof s === 'string' && s.length > 0);
}

/** Append a new token to the accepted list for a channel. */
export async function addAcceptedToken(channel: string, token: string): Promise<void> {
    const list = getAcceptedTokens(channel);
    if (!list.includes(token)) list.push(token);
    await system.set(`serviceToken.${channel}.accepted`, list);
    logger.info('added token to %s accepted list (prefix=%s)', channel, token.slice(0, 8));
}

/** Remove a token from the accepted list. */
export async function removeAcceptedToken(channel: string, token: string): Promise<void> {
    const list = getAcceptedTokens(channel).filter((t) => t !== token);
    await system.set(`serviceToken.${channel}.accepted`, list);
    logger.info('removed token from %s accepted list (prefix=%s)', channel, token.slice(0, 8));
}

function safeEqual(a: string, b: string): boolean {
    const aBuf = Buffer.from(a, 'utf8');
    const bBuf = Buffer.from(b, 'utf8');
    if (aBuf.length !== bBuf.length) return false;
    return timingSafeEqual(aBuf, bBuf);
}

/**
 * Validate `X-Service-Token` from request headers against the configured accepted
 * list for the given channel. Throws ServiceTokenError on failure.
 *
 * Intended to be called from inside a Handler's `prepare` method:
 *
 * ```ts
 * class MyHandler extends Handler {
 *   noCheckPermView = true;  // skip the normal view-permission gate
 *
 *   async prepare() {
 *     requireServiceToken(this, 'vigil');
 *   }
 *
 *   async post(...) { ... }
 * }
 * ```
 */
export function requireServiceToken(handler: Handler, channel: string): void {
    const accepted = getAcceptedTokens(channel);
    if (accepted.length === 0) {
        logger.warn('service-token check on channel "%s" rejected: no accepted tokens configured', channel);
        throw new ServiceTokenError('no-accepted-list');
    }
    const presented = handler.request.headers[HEADER];
    const token = Array.isArray(presented) ? presented[0] : presented;
    if (!token) {
        logger.warn('service-token check on channel "%s" rejected: missing header', channel);
        throw new ServiceTokenError('missing');
    }
    const matched = accepted.find((accept) => safeEqual(accept, token));
    if (!matched) {
        logger.warn(
            'service-token check on channel "%s" rejected: token prefix=%s not in accepted list',
            channel,
            token.slice(0, 8),
        );
        throw new ServiceTokenError('invalid');
    }
    logger.debug('service-token check on channel "%s" passed (prefix=%s)', channel, token.slice(0, 8));
}

/**
 * Decorator factory variant: place above a Handler method to gate it.
 *
 * ```ts
 * class MyHandler extends Handler {
 *   noCheckPermView = true;
 *
 *   @withServiceToken('vigil')
 *   async post(...) { ... }
 * }
 * ```
 */
export function withServiceToken(channel: string) {
    return function (target: any, _funcName: string, descriptor: PropertyDescriptor) {
        const originalMethod = descriptor.value;
        descriptor.value = function gated(this: Handler, ...args: any[]) {
            requireServiceToken(this, channel);
            return originalMethod.apply(this, args);
        };
        return descriptor;
    };
}
