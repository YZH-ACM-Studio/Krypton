import { createHash, randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { BSON, Collection, Filter, ObjectId } from 'mongodb';
import { Context } from '../context';
import db from '../service/db';
import { ExamClassroomService, examClassroomService } from './exam-classroom';
import { endpointEnrollmentBatchColl } from './endpoint-enrollment';
import { examEventColl } from './exam-event';
import { ExamEventNetworkConfigDoc, ExamTargetAssignmentDoc, examEventNetworkConfigColl, examTargetAssignmentColl } from './exam-network-config';
import { ExamNetworkExecutionDoc, examNetworkExecutionColl } from './exam-network-execution';
import { settleDomainCleanupOperations } from './domain-lifecycle-boundary';
import {
    withEndpointSeatMutationBoundary,
    withEndpointSeatWindowDocumentBoundary,
    withEndpointSeatWindowTransitionBoundary,
} from './endpoint-seat-binding-boundary';

export type EndpointSeatBindingStatus = 'active' | 'unbound';
export type EndpointSeatPairingEntryStatus = 'open' | 'claimed' | 'bound' | 'cancelled';
export type EndpointSeatPairingMode = 'bind' | 'replace';

export interface EndpointSeatReferenceFact {
    kind: 'network-config' | 'network-execution';
    domainId: string;
    endpointId: string;
    eventId: ObjectId;
    eventTitle: string;
    eventState: 'active' | 'future';
    startAt: Date;
    endAt: Date;
    targetId: ObjectId;
    targetRevision: number;
    targetFingerprint: string;
}

export interface EndpointSeatBindHistoryEntry {
    revision: number;
    action: 'bind';
    endpointId: string;
    requestId: string;
    actorUid: number;
    at: Date;
    pairingWindowId: ObjectId;
}

export interface EndpointSeatReplaceHistoryEntry {
    revision: number;
    action: 'replace';
    previousEndpointId: string;
    endpointId: string;
    requestId: string;
    endpointRequestId: string;
    actorUid: number;
    at: Date;
    pairingWindowId: ObjectId;
    referenceFingerprint: string;
}

export interface EndpointSeatUnbindHistoryEntry {
    revision: number;
    action: 'unbind';
    previousEndpointId: string;
    requestId: string;
    actorUid: number;
    at: Date;
    referenceFingerprint: string;
}

export type EndpointSeatBindingHistoryEntry = EndpointSeatBindHistoryEntry | EndpointSeatReplaceHistoryEntry | EndpointSeatUnbindHistoryEntry;

export interface EndpointSeatBindingDoc {
    _id: ObjectId;
    domainId: string;
    schoolId: ObjectId;
    classroomId: ObjectId;
    sourceSeatId: string;
    status: EndpointSeatBindingStatus;
    endpointId?: string;
    revision: number;
    history: EndpointSeatBindingHistoryEntry[];
    createdBy: number;
    createdAt: Date;
    updatedBy: number;
    updatedAt: Date;
}

export interface EndpointSeatPairingEntry {
    sourceSeatId: string;
    mode: EndpointSeatPairingMode;
    status: EndpointSeatPairingEntryStatus;
    revision: number;
    codeDigest: string;
    codeHint: string;
    expectedBindingRevision: number;
    claimedEndpointId?: string;
    claimRequestId?: string;
    claimedAt?: Date;
    bindingRevision?: number;
    completedAt?: Date;
    decisionRequestId?: string;
    decidedBy?: number;
}

export interface EndpointSeatMutationActor {
    kind: 'user' | 'endpoint';
    uid?: number;
    endpointId?: string;
}

export interface EndpointSeatPairingWindowDoc {
    _id: string;
    windowId: ObjectId;
    domainId: string;
    schoolId: ObjectId;
    classroomId: ObjectId;
    status: 'open' | 'closed';
    revision: number;
    requestId: string;
    expiresAt: Date;
    entries: EndpointSeatPairingEntry[];
    createdBy: number;
    createdAt: Date;
    updatedActor: EndpointSeatMutationActor;
    updatedAt: Date;
    closedBy?: number;
    closedAt?: Date;
    closedRequestId?: string;
}

interface EndpointSeatLocation {
    domainId: string;
    schoolId: ObjectId;
    classroomId: ObjectId;
    sourceSeatId: string;
}

interface EndpointSeatClassroomLocation {
    domainId: string;
    schoolId: ObjectId;
    classroomId: ObjectId;
    sourceSeatIds: string[];
}

interface EndpointOwnership {
    domainId: string;
    replacesEndpointId?: string;
}

type BindingCollection = Pick<Collection<EndpointSeatBindingDoc>, 'createIndex' | 'deleteMany' | 'find' | 'findOne' | 'insertOne' | 'replaceOne'>;
type WindowCollection = Pick<Collection<EndpointSeatPairingWindowDoc>, 'createIndex' | 'deleteMany' | 'findOne' | 'insertOne' | 'replaceOne'>;

interface EndpointSeatBindingServiceOptions {
    bindings: BindingCollection;
    windows: WindowCollection;
    domainExists: (domainId: string) => Promise<boolean>;
    loadClassroomSeats: (domainId: string, classroomId: ObjectId) => Promise<EndpointSeatClassroomLocation | null>;
    loadEndpointOwnership: (endpointId: string, observedAt: Date) => Promise<EndpointOwnership | null>;
    resolveActivityReferences: (domainId: string, endpointIds: string[], schoolId: ObjectId, now: Date) => Promise<EndpointSeatReferenceFact[]>;
    now?: () => Date;
    codeFactory?: () => string;
    idFactory?: () => ObjectId;
    windowIdFactory?: () => ObjectId;
}

interface OpenPairingWindowInput {
    domainId: string;
    classroomId: ObjectId;
    sourceSeatIds: string[];
    replacementSeatIds?: string[];
    expectedRevision: number;
    requestId: string;
    actorUid: number;
    expiresAt: Date;
}

interface RedeemPairingCodeInput {
    endpointId: string;
    pairingCode: string;
    requestId: string;
}

export interface EndpointSeatMutationOutcome<T> {
    value: T;
    replayed: boolean;
    canonicalActorUid: number;
}

interface ClosePairingWindowInput {
    domainId: string;
    classroomId: ObjectId;
    expectedRevision: number;
    actorUid: number;
    requestId: string;
}

interface CancelPairingClaimInput {
    domainId: string;
    classroomId: ObjectId;
    windowId: ObjectId;
    sourceSeatId: string;
    expectedEntryRevision: number;
    actorUid: number;
    requestId: string;
}

interface ConfirmReplacementInput {
    domainId: string;
    classroomId: ObjectId;
    windowId: ObjectId;
    sourceSeatId: string;
    expectedEntryRevision: number;
    expectedBindingRevision: number;
    confirmationFingerprint: string;
    actorUid: number;
    requestId: string;
}

interface UnbindInput {
    domainId: string;
    classroomId: ObjectId;
    sourceSeatId: string;
    expectedBindingRevision: number;
    confirmationFingerprint: string;
    actorUid: number;
    requestId: string;
}

export type EndpointSeatPairingRedemption =
    | { status: 'bound'; binding: EndpointSeatBindingDoc; entryRevision: number }
    | {
          status: 'replacement_confirmation_required';
          windowId: ObjectId;
          classroomId: ObjectId;
          sourceSeatId: string;
          entryRevision: number;
      };

export interface EndpointSeatReplacementPreview {
    windowId: ObjectId;
    classroomId: ObjectId;
    sourceSeatId: string;
    entryRevision: number;
    bindingRevision: number;
    oldEndpointId: string;
    newEndpointId: string;
    references: EndpointSeatReferenceFact[];
    confirmationFingerprint: string;
}

export interface EndpointSeatUnbindPreview {
    bindingRevision: number;
    endpointId: string;
    references: EndpointSeatReferenceFact[];
    confirmationFingerprint: string;
}

export interface EndpointSeatClassroomState {
    bindings: EndpointSeatBindingDoc[];
    pairingWindow: EndpointSeatPairingWindowDoc | null;
    references: EndpointSeatReferenceFact[];
}

const ENDPOINT_PATTERN = /^ep_[A-Za-z0-9_-]{12,80}$/;
const REQUEST_PATTERN = /^[A-Za-z0-9_-]{16,96}$/;
const CODE_PATTERN = /^KSP1-[0-9A-F]{10}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_WINDOW_LIFETIME_MS = 10 * 60 * 1000;
const MIN_WINDOW_LIFETIME_MS = 10 * 1000;
const MAX_WINDOW_SEATS = 500;
const MAX_CAS_ATTEMPTS = 16;

export class EndpointSeatBindingError extends Error {
    constructor(
        public readonly reason: string,
        options?: ErrorOptions,
    ) {
        super(reason, options);
        this.name = 'EndpointSeatBindingError';
    }
}

function exactObject(value: unknown, keys: string[], reason = 'canonical_invalid'): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new EndpointSeatBindingError(reason);
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== keys.length || keys.some((key) => !Object.hasOwn(record, key))) {
        throw new EndpointSeatBindingError(reason);
    }
    return record;
}

function canonicalDomainId(value: unknown): string {
    if (
        typeof value !== 'string' ||
        !value ||
        value !== value.trim() ||
        value.length > 64 ||
        [...value].some((character) => {
            const code = character.codePointAt(0)!;
            return code < 32 || code === 127;
        })
    ) {
        throw new EndpointSeatBindingError('domain_invalid');
    }
    return value;
}

function canonicalText(value: unknown, field: string, maximum = 256): string {
    if (
        typeof value !== 'string' ||
        !value ||
        value !== value.trim() ||
        value.length > maximum ||
        [...value].some((character) => {
            const code = character.codePointAt(0)!;
            return code < 32 || code === 127;
        })
    ) {
        throw new EndpointSeatBindingError(`${field}_invalid`);
    }
    return value;
}

function canonicalEndpointId(value: unknown): string {
    const endpointId = canonicalText(value, 'endpoint', 83);
    if (!ENDPOINT_PATTERN.test(endpointId)) throw new EndpointSeatBindingError('endpoint_invalid');
    return endpointId;
}

function canonicalRequestId(value: unknown): string {
    const requestId = canonicalText(value, 'request', 96);
    if (!REQUEST_PATTERN.test(requestId)) throw new EndpointSeatBindingError('request_invalid');
    return requestId;
}

function canonicalCode(value: unknown): string {
    if (typeof value !== 'string' || !CODE_PATTERN.test(value)) throw new EndpointSeatBindingError('pairing_code_invalid');
    return value;
}

function assertSha256(value: unknown, reason: string): asserts value is string {
    if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) throw new EndpointSeatBindingError(reason);
}

function assertObjectId(value: unknown, field: string): asserts value is ObjectId {
    if (!(value instanceof ObjectId)) throw new EndpointSeatBindingError(`${field}_invalid`);
}

function assertDate(value: unknown, field: string): asserts value is Date {
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new EndpointSeatBindingError(`${field}_invalid`);
}

function assertPositiveInteger(value: unknown, field: string, allowZero = false): asserts value is number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
        throw new EndpointSeatBindingError(`${field}_invalid`);
    }
}

function assertUid(value: unknown): asserts value is number {
    assertPositiveInteger(value, 'actor_uid');
}

function sha256(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}

function windowDocumentId(windowId: ObjectId): string {
    return `endpoint-seat:${windowId.toHexString()}`;
}

function userActor(uid: number): EndpointSeatMutationActor {
    return { kind: 'user', uid };
}

function endpointActor(endpointId: string): EndpointSeatMutationActor {
    return { kind: 'endpoint', endpointId };
}

function assertActor(value: unknown): asserts value is EndpointSeatMutationActor {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new EndpointSeatBindingError('actor_invalid');
    const actor = value as Record<string, unknown>;
    if (actor.kind === 'user') {
        exactObject(actor, ['kind', 'uid'], 'actor_invalid');
        assertUid(actor.uid);
        return;
    }
    if (actor.kind === 'endpoint') {
        exactObject(actor, ['endpointId', 'kind'], 'actor_invalid');
        canonicalEndpointId(actor.endpointId);
        return;
    }
    throw new EndpointSeatBindingError('actor_invalid');
}

function assertHistoryEntry(value: unknown, expectedRevision: number): asserts value is EndpointSeatBindingHistoryEntry {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new EndpointSeatBindingError('binding_history_invalid');
    const entry = value as Record<string, unknown>;
    if (entry.action === 'bind') {
        exactObject(entry, ['action', 'actorUid', 'at', 'endpointId', 'pairingWindowId', 'requestId', 'revision'], 'binding_history_invalid');
        canonicalEndpointId(entry.endpointId);
        assertObjectId(entry.pairingWindowId, 'pairing_window_id');
    } else if (entry.action === 'replace') {
        exactObject(
            entry,
            [
                'action',
                'actorUid',
                'at',
                'endpointId',
                'endpointRequestId',
                'pairingWindowId',
                'previousEndpointId',
                'referenceFingerprint',
                'requestId',
                'revision',
            ],
            'binding_history_invalid',
        );
        canonicalEndpointId(entry.endpointId);
        canonicalEndpointId(entry.previousEndpointId);
        canonicalRequestId(entry.endpointRequestId);
        assertObjectId(entry.pairingWindowId, 'pairing_window_id');
        assertSha256(entry.referenceFingerprint, 'binding_history_invalid');
    } else if (entry.action === 'unbind') {
        exactObject(
            entry,
            ['action', 'actorUid', 'at', 'previousEndpointId', 'referenceFingerprint', 'requestId', 'revision'],
            'binding_history_invalid',
        );
        canonicalEndpointId(entry.previousEndpointId);
        assertSha256(entry.referenceFingerprint, 'binding_history_invalid');
    } else {
        throw new EndpointSeatBindingError('binding_history_invalid');
    }
    if (entry.revision !== expectedRevision) throw new EndpointSeatBindingError('binding_history_invalid');
    canonicalRequestId(entry.requestId);
    assertUid(entry.actorUid);
    assertDate(entry.at, 'binding_history_at');
}

export function assertEndpointSeatBindingIntegrity(value: unknown): asserts value is EndpointSeatBindingDoc {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new EndpointSeatBindingError('binding_canonical_invalid');
    const binding = value as Record<string, unknown>;
    const active = binding.status === 'active';
    if (!active && binding.status !== 'unbound') throw new EndpointSeatBindingError('binding_canonical_invalid');
    exactObject(
        binding,
        [
            '_id',
            'classroomId',
            'createdAt',
            'createdBy',
            'domainId',
            ...(active ? ['endpointId'] : []),
            'history',
            'revision',
            'schoolId',
            'sourceSeatId',
            'status',
            'updatedAt',
            'updatedBy',
        ],
        'binding_canonical_invalid',
    );
    assertObjectId(binding._id, 'binding_id');
    canonicalDomainId(binding.domainId);
    assertObjectId(binding.schoolId, 'school_id');
    assertObjectId(binding.classroomId, 'classroom_id');
    canonicalText(binding.sourceSeatId, 'source_seat');
    if (active) canonicalEndpointId(binding.endpointId);
    assertPositiveInteger(binding.revision, 'binding_revision');
    assertUid(binding.createdBy);
    assertUid(binding.updatedBy);
    assertDate(binding.createdAt, 'binding_created_at');
    assertDate(binding.updatedAt, 'binding_updated_at');
    if (binding.updatedAt.getTime() < binding.createdAt.getTime()) throw new EndpointSeatBindingError('binding_time_invalid');
    if (!Array.isArray(binding.history) || binding.history.length !== binding.revision) {
        throw new EndpointSeatBindingError('binding_history_invalid');
    }
    const requestIds = new Set<string>();
    let previousAt = Number.NEGATIVE_INFINITY;
    let derivedEndpointId: string | undefined;
    for (const [index, entry] of binding.history.entries()) {
        assertHistoryEntry(entry, index + 1);
        if (entry.at.getTime() < previousAt) throw new EndpointSeatBindingError('binding_history_invalid');
        previousAt = entry.at.getTime();
        if (requestIds.has(entry.requestId)) throw new EndpointSeatBindingError('binding_history_invalid');
        requestIds.add(entry.requestId);
        if (entry.action === 'bind') {
            if (derivedEndpointId !== undefined) throw new EndpointSeatBindingError('binding_history_invalid');
            derivedEndpointId = entry.endpointId;
        } else if (entry.action === 'replace') {
            if (derivedEndpointId === undefined || entry.previousEndpointId !== derivedEndpointId || entry.endpointId === entry.previousEndpointId) {
                throw new EndpointSeatBindingError('binding_history_invalid');
            }
            derivedEndpointId = entry.endpointId;
        } else {
            if (derivedEndpointId === undefined || entry.previousEndpointId !== derivedEndpointId) {
                throw new EndpointSeatBindingError('binding_history_invalid');
            }
            derivedEndpointId = undefined;
        }
    }
    const first = binding.history[0] as EndpointSeatBindingHistoryEntry;
    const last = binding.history.at(-1) as EndpointSeatBindingHistoryEntry;
    if (
        first.action !== 'bind' ||
        binding.createdBy !== first.actorUid ||
        binding.createdAt.getTime() !== first.at.getTime() ||
        binding.updatedBy !== last.actorUid ||
        binding.updatedAt.getTime() !== last.at.getTime()
    ) {
        throw new EndpointSeatBindingError('binding_history_invalid');
    }
    if (active) {
        if (last.action === 'unbind' || binding.endpointId !== derivedEndpointId) {
            throw new EndpointSeatBindingError('binding_history_invalid');
        }
    } else if (last.action !== 'unbind' || derivedEndpointId !== undefined) {
        throw new EndpointSeatBindingError('binding_history_invalid');
    }
}

function assertPairingEntry(value: unknown): asserts value is EndpointSeatPairingEntry {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new EndpointSeatBindingError('pairing_entry_invalid');
    const entry = value as Record<string, unknown>;
    if (
        (entry.mode !== 'bind' && entry.mode !== 'replace') ||
        (entry.status !== 'open' && entry.status !== 'claimed' && entry.status !== 'bound' && entry.status !== 'cancelled')
    ) {
        throw new EndpointSeatBindingError('pairing_entry_invalid');
    }
    const claimed = entry.status !== 'open';
    const completed = entry.status === 'bound' || entry.status === 'cancelled';
    exactObject(
        entry,
        [
            ...(entry.status === 'bound' ? ['bindingRevision'] : []),
            ...(claimed ? ['claimedAt', 'claimedEndpointId', 'claimRequestId'] : []),
            'codeDigest',
            'codeHint',
            ...(completed ? ['completedAt'] : []),
            ...(entry.status === 'cancelled' ? ['decidedBy', 'decisionRequestId'] : []),
            'expectedBindingRevision',
            'mode',
            'revision',
            'sourceSeatId',
            'status',
        ],
        'pairing_entry_invalid',
    );
    canonicalText(entry.sourceSeatId, 'source_seat');
    assertPositiveInteger(entry.revision, 'pairing_entry_revision');
    assertPositiveInteger(entry.expectedBindingRevision, 'expected_binding_revision', true);
    if (
        typeof entry.codeDigest !== 'string' ||
        !SHA256_PATTERN.test(entry.codeDigest) ||
        typeof entry.codeHint !== 'string' ||
        !/^[0-9A-F]{2}$/.test(entry.codeHint)
    ) {
        throw new EndpointSeatBindingError('pairing_entry_invalid');
    }
    if (claimed) {
        canonicalEndpointId(entry.claimedEndpointId);
        canonicalRequestId(entry.claimRequestId);
        assertDate(entry.claimedAt, 'pairing_claimed_at');
    }
    if (completed) {
        assertDate(entry.completedAt, 'pairing_completed_at');
        if ((entry.completedAt as Date).getTime() < (entry.claimedAt as Date).getTime()) {
            throw new EndpointSeatBindingError('pairing_entry_invalid');
        }
    }
    if (entry.status === 'bound') {
        assertPositiveInteger(entry.bindingRevision, 'binding_revision');
        if (entry.bindingRevision !== (entry.expectedBindingRevision as number) + 1) {
            throw new EndpointSeatBindingError('pairing_entry_invalid');
        }
    }
    if (entry.status === 'cancelled') {
        assertUid(entry.decidedBy);
        canonicalRequestId(entry.decisionRequestId);
    }
    const expectedRevision = entry.status === 'open' ? 1 : entry.status === 'claimed' ? 2 : 3;
    if (entry.revision !== expectedRevision) throw new EndpointSeatBindingError('pairing_entry_invalid');
    if (entry.mode === 'replace' && entry.expectedBindingRevision < 1) {
        throw new EndpointSeatBindingError('pairing_entry_invalid');
    }
}

export function assertEndpointSeatPairingWindowIntegrity(value: unknown): asserts value is EndpointSeatPairingWindowDoc {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new EndpointSeatBindingError('pairing_window_invalid');
    const window = value as Record<string, unknown>;
    if (window.status !== 'open' && window.status !== 'closed') throw new EndpointSeatBindingError('pairing_window_invalid');
    exactObject(
        window,
        [
            '_id',
            'classroomId',
            ...(window.status === 'closed' ? ['closedAt', 'closedBy', 'closedRequestId'] : []),
            'createdAt',
            'createdBy',
            'domainId',
            'entries',
            'expiresAt',
            'requestId',
            'revision',
            'schoolId',
            'status',
            'updatedActor',
            'updatedAt',
            'windowId',
        ],
        'pairing_window_invalid',
    );
    const documentId = canonicalText(window._id, 'pairing_window_document_id', 128);
    assertObjectId(window.windowId, 'pairing_window_id');
    canonicalDomainId(window.domainId);
    assertObjectId(window.schoolId, 'school_id');
    assertObjectId(window.classroomId, 'classroom_id');
    assertPositiveInteger(window.revision, 'pairing_window_revision');
    canonicalRequestId(window.requestId);
    assertUid(window.createdBy);
    assertDate(window.createdAt, 'pairing_window_created_at');
    assertDate(window.updatedAt, 'pairing_window_updated_at');
    assertDate(window.expiresAt, 'pairing_window_expires_at');
    assertActor(window.updatedActor);
    if (
        documentId !== windowDocumentId(window.windowId as ObjectId) ||
        window.updatedAt.getTime() < window.createdAt.getTime() ||
        window.expiresAt.getTime() - window.createdAt.getTime() < MIN_WINDOW_LIFETIME_MS ||
        window.expiresAt.getTime() - window.createdAt.getTime() > MAX_WINDOW_LIFETIME_MS
    ) {
        throw new EndpointSeatBindingError('pairing_window_time_invalid');
    }
    if (!Array.isArray(window.entries) || !window.entries.length || window.entries.length > MAX_WINDOW_SEATS) {
        throw new EndpointSeatBindingError('pairing_window_invalid');
    }
    const seatIds = new Set<string>();
    const digests = new Set<string>();
    for (const entry of window.entries) {
        assertPairingEntry(entry);
        if (
            (entry.claimedAt && (entry.claimedAt < window.createdAt || entry.claimedAt >= window.expiresAt || entry.claimedAt > window.updatedAt)) ||
            (entry.completedAt && (entry.completedAt < window.createdAt || entry.completedAt > window.updatedAt))
        ) {
            throw new EndpointSeatBindingError('pairing_window_time_invalid');
        }
        if (seatIds.has(entry.sourceSeatId) || digests.has(entry.codeDigest)) throw new EndpointSeatBindingError('pairing_window_invalid');
        seatIds.add(entry.sourceSeatId);
        digests.add(entry.codeDigest);
    }
    if (window.status === 'closed') {
        assertUid(window.closedBy);
        assertDate(window.closedAt, 'pairing_window_closed_at');
        canonicalRequestId(window.closedRequestId);
        if (
            window.closedAt.getTime() !== window.updatedAt.getTime() ||
            window.updatedActor.kind !== 'user' ||
            window.updatedActor.uid !== window.closedBy ||
            window.entries.some((entry) => entry.status === 'claimed')
        ) {
            throw new EndpointSeatBindingError('pairing_window_time_invalid');
        }
    }
}

function exactRootFilter<T extends object>(identity: Record<string, unknown>, expected: T): Filter<T> {
    return { ...identity, $expr: { $eq: ['$$ROOT', { $literal: expected }] } } as unknown as Filter<T>;
}

function duplicateKey(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 11000);
}

function cloneBinding(binding: EndpointSeatBindingDoc): EndpointSeatBindingDoc {
    return BSON.deserialize(BSON.serialize(binding)) as EndpointSeatBindingDoc;
}

function cloneWindow(window: EndpointSeatPairingWindowDoc): EndpointSeatPairingWindowDoc {
    return BSON.deserialize(BSON.serialize(window)) as EndpointSeatPairingWindowDoc;
}

function canonicalReferences(value: EndpointSeatReferenceFact[]): EndpointSeatReferenceFact[] {
    const facts = value.map((fact) => {
        exactObject(
            fact,
            [
                'domainId',
                'endAt',
                'endpointId',
                'eventId',
                'eventState',
                'eventTitle',
                'kind',
                'startAt',
                'targetFingerprint',
                'targetId',
                'targetRevision',
            ],
            'reference_state_invalid',
        );
        if (!['network-config', 'network-execution'].includes(fact.kind)) throw new EndpointSeatBindingError('reference_state_invalid');
        canonicalDomainId(fact.domainId);
        canonicalEndpointId(fact.endpointId);
        assertObjectId(fact.eventId, 'reference_event_id');
        canonicalText(fact.eventTitle, 'reference_event_title', 120);
        if (!['active', 'future'].includes(fact.eventState)) throw new EndpointSeatBindingError('reference_state_invalid');
        assertDate(fact.startAt, 'reference_start_at');
        assertDate(fact.endAt, 'reference_end_at');
        if (fact.startAt >= fact.endAt) throw new EndpointSeatBindingError('reference_state_invalid');
        assertObjectId(fact.targetId, 'reference_target_id');
        assertPositiveInteger(fact.targetRevision, 'reference_target_revision');
        assertSha256(fact.targetFingerprint, 'reference_state_invalid');
        return BSON.deserialize(BSON.serialize(fact)) as EndpointSeatReferenceFact;
    });
    facts.sort((left, right) =>
        [left.kind, left.eventId.toHexString(), left.targetId.toHexString(), left.targetRevision, left.endpointId]
            .join('\0')
            .localeCompare(
                [right.kind, right.eventId.toHexString(), right.targetId.toHexString(), right.targetRevision, right.endpointId].join('\0'),
            ),
    );
    const identities = facts.map((fact) =>
        [fact.kind, fact.eventId.toHexString(), fact.targetId.toHexString(), fact.targetRevision, fact.endpointId].join('\0'),
    );
    if (new Set(identities).size !== identities.length) throw new EndpointSeatBindingError('reference_state_invalid');
    return facts;
}

function referencesJson(references: EndpointSeatReferenceFact[]) {
    return references.map((reference) => ({
        ...reference,
        eventId: reference.eventId.toHexString(),
        startAt: reference.startAt.toISOString(),
        endAt: reference.endAt.toISOString(),
        targetId: reference.targetId.toHexString(),
    }));
}

function confirmationFingerprint(value: Record<string, unknown>): string {
    return sha256(JSON.stringify(value));
}

export class EndpointSeatBindingService {
    private readonly bindings: BindingCollection;
    private readonly windows: WindowCollection;
    private readonly domainExists: EndpointSeatBindingServiceOptions['domainExists'];
    private readonly loadClassroomSeats: EndpointSeatBindingServiceOptions['loadClassroomSeats'];
    private readonly loadEndpointOwnership: EndpointSeatBindingServiceOptions['loadEndpointOwnership'];
    private readonly resolveActivityReferences: EndpointSeatBindingServiceOptions['resolveActivityReferences'];
    private readonly now: () => Date;
    private readonly codeFactory: () => string;
    private readonly idFactory: () => ObjectId;
    private readonly windowIdFactory: () => ObjectId;
    private indexesPromise?: Promise<void>;

    constructor(options: EndpointSeatBindingServiceOptions) {
        this.bindings = options.bindings;
        this.windows = options.windows;
        this.domainExists = options.domainExists;
        this.loadClassroomSeats = options.loadClassroomSeats;
        this.loadEndpointOwnership = options.loadEndpointOwnership;
        this.resolveActivityReferences = options.resolveActivityReferences;
        this.now = options.now || (() => new Date());
        this.codeFactory = options.codeFactory || (() => `KSP1-${randomBytes(5).toString('hex').toUpperCase()}`);
        this.idFactory = options.idFactory || (() => new ObjectId());
        this.windowIdFactory = options.windowIdFactory || (() => new ObjectId());
    }

    ensureIndexes(): Promise<void> {
        this.indexesPromise ||= Promise.all([
            this.bindings.createIndex({ domainId: 1, classroomId: 1, sourceSeatId: 1 }, { name: 'endpointSeatPhysicalIdentity', unique: true }),
            this.bindings.createIndex(
                { domainId: 1, endpointId: 1 },
                { name: 'endpointSeatActiveEndpoint', unique: true, partialFilterExpression: { status: 'active' } },
            ),
            this.bindings.createIndex({ 'history.requestId': 1 }, { name: 'endpointSeatMutationRequest', unique: true }),
            this.bindings.createIndex({ domainId: 1, schoolId: 1, classroomId: 1, status: 1 }, { name: 'endpointSeatClassroomList' }),
            this.windows.createIndex({ domainId: 1, classroomId: 1, revision: 1 }, { name: 'endpointSeatPairingClassroomRevision', unique: true }),
            this.windows.createIndex({ windowId: 1 }, { name: 'endpointSeatPairingWindowIdentity', unique: true }),
            this.windows.createIndex({ requestId: 1 }, { name: 'endpointSeatPairingOpenRequest', unique: true }),
            this.windows.createIndex({ 'entries.codeDigest': 1 }, { name: 'endpointSeatPairingCode', unique: true }),
            this.windows.createIndex({ domainId: 1, status: 1, expiresAt: 1 }, { name: 'endpointSeatPairingExpiry' }),
        ]).then(() => undefined);
        return this.indexesPromise;
    }

    private async requireClassroomSeats(domainId: string, classroomId: ObjectId): Promise<EndpointSeatClassroomLocation> {
        canonicalDomainId(domainId);
        assertObjectId(classroomId, 'classroom_id');
        if (!(await this.domainExists(domainId))) throw new EndpointSeatBindingError('domain_not_found');
        const classroom = await this.loadClassroomSeats(domainId, classroomId);
        if (!classroom) throw new EndpointSeatBindingError('seat_not_found');
        if (
            classroom.domainId !== domainId ||
            !(classroom.classroomId instanceof ObjectId) ||
            !classroom.classroomId.equals(classroomId) ||
            !(classroom.schoolId instanceof ObjectId) ||
            !Array.isArray(classroom.sourceSeatIds)
        ) {
            throw new EndpointSeatBindingError('seat_identity_mismatch');
        }
        const sourceSeatIds = classroom.sourceSeatIds.map((sourceSeatId) => canonicalText(sourceSeatId, 'source_seat'));
        if (new Set(sourceSeatIds).size !== sourceSeatIds.length) throw new EndpointSeatBindingError('seat_identity_mismatch');
        return {
            ...classroom,
            schoolId: new ObjectId(classroom.schoolId),
            classroomId: new ObjectId(classroom.classroomId),
            sourceSeatIds,
        };
    }

    private async assertSeatReferences(
        domainId: string,
        classroomId: ObjectId,
        references: Array<{ schoolId: ObjectId; sourceSeatId: string }>,
    ): Promise<EndpointSeatClassroomLocation> {
        const classroom = await this.requireClassroomSeats(domainId, classroomId);
        const currentSeatIds = new Set(classroom.sourceSeatIds);
        for (const reference of references) {
            if (!reference.schoolId.equals(classroom.schoolId)) throw new EndpointSeatBindingError('seat_school_mismatch');
            if (!currentSeatIds.has(reference.sourceSeatId)) throw new EndpointSeatBindingError('seat_not_found');
        }
        return classroom;
    }

    private async requireSeat(domainId: string, classroomId: ObjectId, sourceSeatId: string): Promise<EndpointSeatLocation> {
        canonicalText(sourceSeatId, 'source_seat');
        const classroom = await this.requireClassroomSeats(domainId, classroomId);
        if (!classroom.sourceSeatIds.includes(sourceSeatId)) throw new EndpointSeatBindingError('seat_not_found');
        return {
            domainId: classroom.domainId,
            schoolId: new ObjectId(classroom.schoolId),
            classroomId: new ObjectId(classroom.classroomId),
            sourceSeatId,
        };
    }

    private async requireSeatInSchool(
        domainId: string,
        schoolId: ObjectId,
        classroomId: ObjectId,
        sourceSeatId: string,
    ): Promise<EndpointSeatLocation> {
        const classroom = await this.assertSeatReferences(domainId, classroomId, [{ schoolId, sourceSeatId }]);
        return { domainId, schoolId: new ObjectId(classroom.schoolId), classroomId: new ObjectId(classroomId), sourceSeatId };
    }

    private async assertBindingReference(binding: EndpointSeatBindingDoc): Promise<void> {
        await this.requireSeatInSchool(binding.domainId, binding.schoolId, binding.classroomId, binding.sourceSeatId);
    }

    private async assertWindowReferences(window: EndpointSeatPairingWindowDoc): Promise<void> {
        await this.assertSeatReferences(
            window.domainId,
            window.classroomId,
            window.entries.map((entry) => ({ schoolId: window.schoolId, sourceSeatId: entry.sourceSeatId })),
        );
    }

    private async requireOwnership(endpointId: string, observedAt = this.now()): Promise<EndpointOwnership> {
        canonicalEndpointId(endpointId);
        assertDate(observedAt, 'now');
        const ownership = await this.loadEndpointOwnership(endpointId, observedAt);
        if (!ownership) throw new EndpointSeatBindingError('endpoint_not_owned');
        canonicalDomainId(ownership.domainId);
        if (ownership.replacesEndpointId) canonicalEndpointId(ownership.replacesEndpointId);
        return ownership;
    }

    private async loadBinding(domainId: string, classroomId: ObjectId, sourceSeatId: string): Promise<EndpointSeatBindingDoc | null> {
        const binding = await this.bindings.findOne({ domainId, classroomId, sourceSeatId });
        if (binding) {
            assertEndpointSeatBindingIntegrity(binding);
            await this.assertBindingReference(binding);
        }
        return binding;
    }

    private async loadActiveEndpointBinding(domainId: string, endpointId: string): Promise<EndpointSeatBindingDoc | null> {
        const binding = await this.bindings.findOne({ domainId, endpointId, status: 'active' });
        if (binding) {
            assertEndpointSeatBindingIntegrity(binding);
            await this.assertBindingReference(binding);
        }
        return binding;
    }

    private async replaceBinding(expected: EndpointSeatBindingDoc, target: EndpointSeatBindingDoc): Promise<void> {
        assertEndpointSeatBindingIntegrity(expected);
        assertEndpointSeatBindingIntegrity(target);
        await this.assertBindingReference(target);
        const current = await this.bindings.findOne({ _id: expected._id });
        if (current && isDeepStrictEqual(current, target)) return;
        const result = await this.bindings.replaceOne(exactRootFilter({ _id: expected._id }, expected), target);
        if (result.matchedCount === 1) return;
        const raced = await this.bindings.findOne({ _id: expected._id });
        if (raced && isDeepStrictEqual(raced, target)) return;
        throw new EndpointSeatBindingError('binding_revision_conflict');
    }

    private async insertBinding(target: EndpointSeatBindingDoc): Promise<void> {
        assertEndpointSeatBindingIntegrity(target);
        await this.assertBindingReference(target);
        try {
            await this.bindings.insertOne(target);
        } catch (error) {
            const current = await this.bindings.findOne({
                domainId: target.domainId,
                classroomId: target.classroomId,
                sourceSeatId: target.sourceSeatId,
            });
            if (current && isDeepStrictEqual(current, target)) return;
            if (duplicateKey(error)) throw new EndpointSeatBindingError('binding_uniqueness_conflict', { cause: error });
            throw error;
        }
    }

    private async loadWindowByCodeDigest(codeDigest: string): Promise<EndpointSeatPairingWindowDoc | null> {
        const window = await this.windows.findOne({ 'entries.codeDigest': codeDigest });
        if (window) {
            assertEndpointSeatPairingWindowIntegrity(window);
            await this.assertWindowReferences(window);
        }
        return window;
    }

    private async loadWindow(domainId: string, classroomId: ObjectId): Promise<EndpointSeatPairingWindowDoc | null> {
        const window = await this.windows.findOne({ domainId, classroomId }, { sort: { revision: -1 } });
        if (window) {
            assertEndpointSeatPairingWindowIntegrity(window);
            await this.assertWindowReferences(window);
        }
        return window;
    }

    private async loadWindowById(domainId: string, classroomId: ObjectId, windowId: ObjectId): Promise<EndpointSeatPairingWindowDoc | null> {
        const window = await this.windows.findOne({ domainId, classroomId, windowId });
        if (window) {
            assertEndpointSeatPairingWindowIntegrity(window);
            await this.assertWindowReferences(window);
        }
        return window;
    }

    private async loadWindowByOpenRequest(domainId: string, classroomId: ObjectId, requestId: string): Promise<EndpointSeatPairingWindowDoc | null> {
        const window = await this.windows.findOne({ domainId, classroomId, requestId });
        if (window) {
            assertEndpointSeatPairingWindowIntegrity(window);
            await this.assertWindowReferences(window);
        }
        return window;
    }

    private async loadWindowByCloseRequest(domainId: string, classroomId: ObjectId, requestId: string): Promise<EndpointSeatPairingWindowDoc | null> {
        const window = await this.windows.findOne({ domainId, classroomId, closedRequestId: requestId });
        if (window) {
            assertEndpointSeatPairingWindowIntegrity(window);
            await this.assertWindowReferences(window);
        }
        return window;
    }

    private async replaceWindow(expected: EndpointSeatPairingWindowDoc, target: EndpointSeatPairingWindowDoc): Promise<boolean> {
        assertEndpointSeatPairingWindowIntegrity(expected);
        assertEndpointSeatPairingWindowIntegrity(target);
        await this.assertWindowReferences(target);
        const current = await this.windows.findOne({ _id: expected._id });
        if (current && isDeepStrictEqual(current, target)) return true;
        try {
            const result = await this.windows.replaceOne(exactRootFilter({ _id: expected._id }, expected), target);
            if (result.matchedCount === 1) return true;
        } catch (error) {
            if (duplicateKey(error)) return false;
            throw error;
        }
        const raced = await this.windows.findOne({ _id: expected._id });
        return Boolean(raced && isDeepStrictEqual(raced, target));
    }

    async openPairingWindow(input: OpenPairingWindowInput): Promise<{
        window: EndpointSeatPairingWindowDoc;
        codes: Array<{ sourceSeatId: string; code: string }>;
    }> {
        canonicalDomainId(input.domainId);
        assertObjectId(input.classroomId, 'classroom_id');
        assertPositiveInteger(input.expectedRevision, 'pairing_window_revision', true);
        canonicalRequestId(input.requestId);
        assertUid(input.actorUid);
        assertDate(input.expiresAt, 'pairing_window_expires_at');
        if (!Array.isArray(input.sourceSeatIds) || !input.sourceSeatIds.length || input.sourceSeatIds.length > MAX_WINDOW_SEATS) {
            throw new EndpointSeatBindingError('pairing_window_seats_invalid');
        }
        const sourceSeatIds = input.sourceSeatIds.map((seatId) => canonicalText(seatId, 'source_seat')).sort();
        if (new Set(sourceSeatIds).size !== sourceSeatIds.length) throw new EndpointSeatBindingError('pairing_window_seats_invalid');
        const replacementSeatIds = (input.replacementSeatIds || []).map((seatId) => canonicalText(seatId, 'source_seat')).sort();
        if (new Set(replacementSeatIds).size !== replacementSeatIds.length || replacementSeatIds.some((seatId) => !sourceSeatIds.includes(seatId))) {
            throw new EndpointSeatBindingError('replacement_seats_invalid');
        }
        return withEndpointSeatWindowTransitionBoundary(input.domainId, input.classroomId, () =>
            this.openPairingWindowWhileGuarded(input, sourceSeatIds, replacementSeatIds),
        );
    }

    private async openPairingWindowWhileGuarded(
        input: OpenPairingWindowInput,
        sourceSeatIds: string[],
        replacementSeatIds: string[],
    ): Promise<{
        window: EndpointSeatPairingWindowDoc;
        codes: Array<{ sourceSeatId: string; code: string }>;
    }> {
        const now = this.now();
        assertDate(now, 'now');
        const lifetime = input.expiresAt.getTime() - now.getTime();
        if (lifetime < MIN_WINDOW_LIFETIME_MS || lifetime > MAX_WINDOW_LIFETIME_MS) {
            throw new EndpointSeatBindingError('pairing_window_expiry_invalid');
        }
        const classroom = await this.requireClassroomSeats(input.domainId, input.classroomId);
        const currentSeatIds = new Set(classroom.sourceSeatIds);
        if (sourceSeatIds.some((sourceSeatId) => !currentSeatIds.has(sourceSeatId))) throw new EndpointSeatBindingError('seat_not_found');
        if (await this.loadWindowByOpenRequest(input.domainId, input.classroomId, input.requestId)) {
            throw new EndpointSeatBindingError('pairing_window_response_not_recoverable');
        }
        const current = await this.loadWindow(input.domainId, input.classroomId);
        const observedRevision = current?.revision || 0;
        if (observedRevision !== input.expectedRevision) throw new EndpointSeatBindingError('pairing_window_revision_conflict');
        if (current) {
            if (now < current.updatedAt) throw new EndpointSeatBindingError('clock_rollback');
            if (current.entries.some((entry) => entry.status === 'claimed')) throw new EndpointSeatBindingError('pairing_claim_pending');
            if (current.status === 'open' && current.expiresAt > now) throw new EndpointSeatBindingError('pairing_window_open');
        }
        const codes: Array<{ sourceSeatId: string; code: string }> = [];
        const entries: EndpointSeatPairingEntry[] = [];
        const digests = new Set<string>();
        const bindingsBySeat = new Map(
            (await this.listClassroomBindings(input.domainId, input.classroomId)).map((binding) => [binding.sourceSeatId, binding]),
        );
        for (const sourceSeatId of sourceSeatIds) {
            const binding = bindingsBySeat.get(sourceSeatId);
            if (binding && now < binding.updatedAt) throw new EndpointSeatBindingError('clock_rollback');
            const replacement = replacementSeatIds.includes(sourceSeatId);
            if (replacement) {
                if (!binding || binding.status !== 'active') throw new EndpointSeatBindingError('seat_not_bound');
            } else if (binding?.status === 'active') {
                throw new EndpointSeatBindingError('seat_already_bound');
            }
            const code = canonicalCode(this.codeFactory());
            const codeDigest = sha256(code);
            if (digests.has(codeDigest)) throw new EndpointSeatBindingError('pairing_code_collision');
            digests.add(codeDigest);
            codes.push({ sourceSeatId, code });
            entries.push({
                sourceSeatId,
                mode: replacement ? 'replace' : 'bind',
                status: 'open',
                revision: 1,
                codeDigest,
                codeHint: code.slice(-2),
                expectedBindingRevision: binding?.revision || 0,
            });
        }
        const windowId = this.windowIdFactory();
        const target: EndpointSeatPairingWindowDoc = {
            _id: windowDocumentId(windowId),
            windowId,
            domainId: input.domainId,
            schoolId: new ObjectId(classroom.schoolId),
            classroomId: new ObjectId(input.classroomId),
            status: 'open',
            revision: observedRevision + 1,
            requestId: input.requestId,
            expiresAt: new Date(input.expiresAt),
            entries,
            createdBy: input.actorUid,
            createdAt: now,
            updatedActor: userActor(input.actorUid),
            updatedAt: now,
        };
        assertEndpointSeatPairingWindowIntegrity(target);
        await this.assertWindowReferences(target);
        try {
            await this.windows.insertOne(target);
        } catch (error) {
            const exact = await this.windows.findOne({ _id: target._id });
            if (exact && isDeepStrictEqual(exact, target)) return { window: cloneWindow(target), codes };
            if (!duplicateKey(error)) throw error;
            if (await this.loadWindowByOpenRequest(input.domainId, input.classroomId, input.requestId)) {
                throw new EndpointSeatBindingError('pairing_window_response_not_recoverable', { cause: error });
            }
            const raced = await this.loadWindow(input.domainId, input.classroomId);
            if (raced && raced.revision >= target.revision) {
                throw new EndpointSeatBindingError('pairing_window_revision_conflict', { cause: error });
            }
            throw new EndpointSeatBindingError('pairing_code_collision', { cause: error });
        }
        return { window: cloneWindow(target), codes };
    }

    async closePairingWindow(input: ClosePairingWindowInput): Promise<EndpointSeatPairingWindowDoc> {
        return (await this.closePairingWindowWithOutcome(input)).value;
    }

    async closePairingWindowWithOutcome(input: ClosePairingWindowInput): Promise<EndpointSeatMutationOutcome<EndpointSeatPairingWindowDoc>> {
        canonicalDomainId(input.domainId);
        assertObjectId(input.classroomId, 'classroom_id');
        assertPositiveInteger(input.expectedRevision, 'pairing_window_revision');
        assertUid(input.actorUid);
        canonicalRequestId(input.requestId);
        return withEndpointSeatWindowTransitionBoundary(input.domainId, input.classroomId, async () => {
            const replay = await this.loadWindowByCloseRequest(input.domainId, input.classroomId, input.requestId);
            if (replay) {
                if (replay.revision !== input.expectedRevision + 1) throw new EndpointSeatBindingError('request_replay_conflict');
                return { value: replay, replayed: true, canonicalActorUid: replay.closedBy! };
            }
            const current = await this.loadWindow(input.domainId, input.classroomId);
            if (!current) throw new EndpointSeatBindingError('pairing_window_not_found');
            if (current.status !== 'open' || current.revision !== input.expectedRevision) {
                throw new EndpointSeatBindingError('pairing_window_revision_conflict');
            }
            if (current.entries.some((entry) => entry.status === 'claimed')) throw new EndpointSeatBindingError('pairing_claim_pending');
            const now = this.now();
            if (now < current.updatedAt) throw new EndpointSeatBindingError('clock_rollback');
            const target: EndpointSeatPairingWindowDoc = {
                ...cloneWindow(current),
                status: 'closed',
                revision: current.revision + 1,
                updatedActor: userActor(input.actorUid),
                updatedAt: now,
                closedBy: input.actorUid,
                closedAt: now,
                closedRequestId: input.requestId,
            };
            if (!(await this.replaceWindow(current, target))) throw new EndpointSeatBindingError('pairing_window_revision_conflict');
            return { value: target, replayed: false, canonicalActorUid: input.actorUid };
        });
    }

    async cancelPairingClaim(input: CancelPairingClaimInput): Promise<EndpointSeatPairingWindowDoc> {
        return (await this.cancelPairingClaimWithOutcome(input)).value;
    }

    async cancelPairingClaimWithOutcome(input: CancelPairingClaimInput): Promise<EndpointSeatMutationOutcome<EndpointSeatPairingWindowDoc>> {
        canonicalDomainId(input.domainId);
        assertObjectId(input.classroomId, 'classroom_id');
        assertObjectId(input.windowId, 'pairing_window_id');
        canonicalText(input.sourceSeatId, 'source_seat');
        assertPositiveInteger(input.expectedEntryRevision, 'pairing_entry_revision');
        assertUid(input.actorUid);
        canonicalRequestId(input.requestId);
        return withEndpointSeatMutationBoundary(input.domainId, input.classroomId, input.sourceSeatId, async () => {
            await this.reconcileCompletedClaim(input.domainId, input.classroomId, input.sourceSeatId);
            return withEndpointSeatWindowDocumentBoundary(input.windowId, async () => {
                for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
                    const current = await this.loadWindowById(input.domainId, input.classroomId, input.windowId);
                    if (!current || !current.windowId.equals(input.windowId)) throw new EndpointSeatBindingError('pairing_window_changed');
                    const index = current.entries.findIndex((entry) => entry.sourceSeatId === input.sourceSeatId);
                    const entry = current.entries[index];
                    if (!entry) throw new EndpointSeatBindingError('pairing_claim_changed');
                    if (entry.status === 'cancelled' && entry.decisionRequestId === input.requestId) {
                        return { value: current, replayed: true, canonicalActorUid: entry.decidedBy! };
                    }
                    if (entry.status !== 'claimed' || entry.revision !== input.expectedEntryRevision || !entry.claimRequestId) {
                        throw new EndpointSeatBindingError('pairing_claim_changed');
                    }
                    const latest = await this.loadWindow(input.domainId, input.classroomId);
                    if (!latest || latest._id !== current._id) throw new EndpointSeatBindingError('pairing_window_changed');
                    const now = this.now();
                    if (now < current.updatedAt || now < entry.claimedAt!) throw new EndpointSeatBindingError('clock_rollback');
                    const target = cloneWindow(current);
                    target.revision++;
                    target.updatedActor = userActor(input.actorUid);
                    target.updatedAt = now;
                    target.entries[index] = {
                        ...target.entries[index],
                        status: 'cancelled',
                        revision: target.entries[index].revision + 1,
                        completedAt: now,
                        decisionRequestId: input.requestId,
                        decidedBy: input.actorUid,
                    };
                    if (await this.replaceWindow(current, target)) {
                        return { value: target, replayed: false, canonicalActorUid: input.actorUid };
                    }
                }
                throw new EndpointSeatBindingError('pairing_window_revision_conflict');
            });
        });
    }

    private async claimCode(
        codeDigest: string,
        endpointId: string,
        requestId: string,
        expectedWindowId: ObjectId,
        expectedSourceSeatId: string,
    ): Promise<{ window: EndpointSeatPairingWindowDoc; entry: EndpointSeatPairingEntry }> {
        return withEndpointSeatWindowDocumentBoundary(expectedWindowId, async () => {
            for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
                const current = await this.loadWindowByCodeDigest(codeDigest);
                if (!current) throw new EndpointSeatBindingError('pairing_code_invalid');
                const index = current.entries.findIndex((entry) => entry.codeDigest === codeDigest);
                const entry = current.entries[index];
                if (!entry) throw new EndpointSeatBindingError('pairing_code_invalid');
                if (!current.windowId.equals(expectedWindowId) || entry.sourceSeatId !== expectedSourceSeatId) {
                    throw new EndpointSeatBindingError('pairing_window_changed');
                }
                if (entry.claimedEndpointId === endpointId && entry.status !== 'open') return { window: current, entry };
                if (entry.status !== 'open') throw new EndpointSeatBindingError('pairing_code_used');
                const now = this.now();
                if (current.status !== 'open' || current.expiresAt <= now) throw new EndpointSeatBindingError('pairing_code_expired');
                if (now < current.updatedAt) throw new EndpointSeatBindingError('clock_rollback');
                const seat = await this.requireSeat(current.domainId, current.classroomId, entry.sourceSeatId);
                if (!seat.schoolId.equals(current.schoolId)) throw new EndpointSeatBindingError('seat_school_mismatch');
                const ownership = await this.requireOwnership(endpointId, now);
                if (ownership.domainId !== current.domainId) throw new EndpointSeatBindingError('endpoint_domain_mismatch');
                const endpointBinding = await this.loadActiveEndpointBinding(current.domainId, endpointId);
                if (endpointBinding) {
                    if (!endpointBinding.schoolId.equals(current.schoolId)) throw new EndpointSeatBindingError('cross_school_endpoint');
                    throw new EndpointSeatBindingError('endpoint_already_bound');
                }
                const binding = await this.loadBinding(current.domainId, current.classroomId, entry.sourceSeatId);
                if ((binding?.revision || 0) !== entry.expectedBindingRevision) throw new EndpointSeatBindingError('binding_revision_conflict');
                if (entry.mode === 'replace') {
                    if (!binding || binding.status !== 'active') throw new EndpointSeatBindingError('seat_not_bound');
                    if (ownership.replacesEndpointId !== binding.endpointId) throw new EndpointSeatBindingError('endpoint_not_replacement');
                } else if (binding?.status === 'active') {
                    throw new EndpointSeatBindingError('seat_already_bound');
                }
                const target = cloneWindow(current);
                target.revision++;
                target.updatedActor = endpointActor(endpointId);
                target.updatedAt = now;
                target.entries[index] = {
                    ...target.entries[index],
                    status: 'claimed',
                    revision: target.entries[index].revision + 1,
                    claimedEndpointId: endpointId,
                    claimRequestId: requestId,
                    claimedAt: now,
                };
                if (await this.replaceWindow(current, target)) return { window: target, entry: target.entries[index] };
            }
            throw new EndpointSeatBindingError('pairing_window_revision_conflict');
        });
    }

    private async reconcileCompletedClaim(domainId: string, classroomId: ObjectId, sourceSeatId: string, windowId?: ObjectId): Promise<void> {
        const window = windowId ? await this.loadWindowById(domainId, classroomId, windowId) : await this.loadWindow(domainId, classroomId);
        const entry = window?.entries.find((candidate) => candidate.sourceSeatId === sourceSeatId);
        if (!window || !entry || entry.status !== 'claimed' || !entry.claimRequestId || !entry.claimedEndpointId) return;
        const binding = await this.loadBinding(domainId, classroomId, sourceSeatId);
        const operation = binding?.history.find((history) =>
            entry.mode === 'bind'
                ? history.action === 'bind' && history.requestId === entry.claimRequestId && history.endpointId === entry.claimedEndpointId
                : history.action === 'replace' &&
                  history.endpointRequestId === entry.claimRequestId &&
                  history.endpointId === entry.claimedEndpointId,
        );
        if (!operation) return;
        if (!binding || binding.status !== 'active' || binding.endpointId !== entry.claimedEndpointId || binding.history.at(-1) !== operation) {
            throw new EndpointSeatBindingError('pairing_binding_drift');
        }
        await this.markEntry(
            window.windowId,
            domainId,
            classroomId,
            sourceSeatId,
            entry.claimRequestId,
            entry.claimedEndpointId,
            binding.revision,
            binding.updatedAt,
            operation.action === 'replace' ? userActor(operation.actorUid) : endpointActor(entry.claimedEndpointId),
        );
    }

    private async markEntry(
        windowId: ObjectId,
        domainId: string,
        classroomId: ObjectId,
        sourceSeatId: string,
        claimRequestId: string,
        endpointId: string,
        bindingRevision: number,
        bindingUpdatedAt: Date,
        actor: EndpointSeatMutationActor,
    ): Promise<number> {
        assertDate(bindingUpdatedAt, 'binding_updated_at');
        return withEndpointSeatWindowDocumentBoundary(windowId, async () => {
            for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
                const current = await this.loadWindowById(domainId, classroomId, windowId);
                if (!current || !current.windowId.equals(windowId)) throw new EndpointSeatBindingError('pairing_window_changed');
                const index = current.entries.findIndex((entry) => entry.sourceSeatId === sourceSeatId);
                const entry = current.entries[index];
                if (!entry || entry.claimRequestId !== claimRequestId || entry.claimedEndpointId !== endpointId) {
                    throw new EndpointSeatBindingError('pairing_claim_changed');
                }
                if (entry.status === 'bound') {
                    if (entry.bindingRevision !== bindingRevision || entry.completedAt! < bindingUpdatedAt) {
                        throw new EndpointSeatBindingError('pairing_claim_changed');
                    }
                    return entry.revision;
                }
                if (entry.status !== 'claimed') throw new EndpointSeatBindingError('pairing_claim_changed');
                const latest = await this.loadWindow(domainId, classroomId);
                if (!latest || latest._id !== current._id) throw new EndpointSeatBindingError('pairing_window_changed');
                const now = this.now();
                if (now < current.updatedAt || now < entry.claimedAt! || now < bindingUpdatedAt) {
                    throw new EndpointSeatBindingError('clock_rollback');
                }
                const target = cloneWindow(current);
                target.revision++;
                target.updatedActor = actor;
                target.updatedAt = now;
                target.entries[index] = {
                    ...target.entries[index],
                    status: 'bound',
                    revision: target.entries[index].revision + 1,
                    bindingRevision,
                    completedAt: now,
                };
                if (await this.replaceWindow(current, target)) return target.entries[index].revision;
            }
            throw new EndpointSeatBindingError('pairing_window_revision_conflict');
        });
    }

    private async finishInitialBinding(
        window: EndpointSeatPairingWindowDoc,
        entry: EndpointSeatPairingEntry,
    ): Promise<EndpointSeatPairingRedemption> {
        if (entry.mode !== 'bind' || !entry.claimedEndpointId || !entry.claimRequestId || !entry.claimedAt) {
            throw new EndpointSeatBindingError('pairing_claim_changed');
        }
        const existing = await this.loadBinding(window.domainId, window.classroomId, entry.sourceSeatId);
        const operation = existing?.history.find((item) => item.requestId === entry.claimRequestId);
        let target: EndpointSeatBindingDoc;
        if (operation) {
            if (existing?.status !== 'active' || existing.endpointId !== entry.claimedEndpointId || operation.action !== 'bind') {
                throw new EndpointSeatBindingError('request_replay_conflict');
            }
            target = existing;
        } else {
            if ((existing?.revision || 0) !== entry.expectedBindingRevision) throw new EndpointSeatBindingError('binding_revision_conflict');
            if (existing?.status === 'active') throw new EndpointSeatBindingError('seat_already_bound');
            const endpointBinding = await this.loadActiveEndpointBinding(window.domainId, entry.claimedEndpointId);
            if (endpointBinding) {
                if (!endpointBinding.schoolId.equals(window.schoolId)) throw new EndpointSeatBindingError('cross_school_endpoint');
                throw new EndpointSeatBindingError('endpoint_already_bound');
            }
            const now = this.now();
            if (now < entry.claimedAt || (existing && now < existing.updatedAt)) throw new EndpointSeatBindingError('clock_rollback');
            const revision = (existing?.revision || 0) + 1;
            const historyEntry: EndpointSeatBindHistoryEntry = {
                revision,
                action: 'bind',
                endpointId: entry.claimedEndpointId,
                requestId: entry.claimRequestId,
                actorUid: window.createdBy,
                at: now,
                pairingWindowId: new ObjectId(window.windowId),
            };
            target = {
                _id: existing?._id || this.idFactory(),
                domainId: window.domainId,
                schoolId: new ObjectId(window.schoolId),
                classroomId: new ObjectId(window.classroomId),
                sourceSeatId: entry.sourceSeatId,
                status: 'active',
                endpointId: entry.claimedEndpointId,
                revision,
                history: [...(existing?.history || []), historyEntry],
                createdBy: existing?.createdBy || window.createdBy,
                createdAt: existing?.createdAt || now,
                updatedBy: window.createdBy,
                updatedAt: now,
            };
            try {
                if (existing) await this.replaceBinding(existing, target);
                else await this.insertBinding(target);
            } catch (error) {
                if (!(error instanceof EndpointSeatBindingError) || error.reason !== 'binding_uniqueness_conflict') throw error;
                const racedSeat = await this.loadBinding(window.domainId, window.classroomId, entry.sourceSeatId);
                if (
                    racedSeat?.status === 'active' &&
                    racedSeat.endpointId === entry.claimedEndpointId &&
                    racedSeat.history.some((item) => item.requestId === entry.claimRequestId && item.action === 'bind')
                ) {
                    target = racedSeat;
                } else {
                    const racedEndpoint = await this.loadActiveEndpointBinding(window.domainId, entry.claimedEndpointId);
                    if (racedEndpoint && !racedEndpoint.schoolId.equals(window.schoolId)) {
                        throw new EndpointSeatBindingError('cross_school_endpoint');
                    }
                    if (racedEndpoint) throw new EndpointSeatBindingError('endpoint_already_bound');
                    throw new EndpointSeatBindingError('seat_already_bound');
                }
            }
        }
        const entryRevision = await this.markEntry(
            window.windowId,
            window.domainId,
            window.classroomId,
            entry.sourceSeatId,
            entry.claimRequestId,
            entry.claimedEndpointId,
            target.revision,
            target.updatedAt,
            endpointActor(entry.claimedEndpointId),
        );
        return { status: 'bound', binding: cloneBinding(target), entryRevision };
    }

    async redeemPairingCode(input: RedeemPairingCodeInput): Promise<EndpointSeatPairingRedemption> {
        const endpointId = canonicalEndpointId(input.endpointId);
        const requestId = canonicalRequestId(input.requestId);
        const code = canonicalCode(input.pairingCode);
        const codeDigest = sha256(code);
        const observedWindow = await this.loadWindowByCodeDigest(codeDigest);
        const observedEntry = observedWindow?.entries.find((entry) => entry.codeDigest === codeDigest);
        if (!observedWindow || !observedEntry) throw new EndpointSeatBindingError('pairing_code_invalid');
        return withEndpointSeatMutationBoundary(observedWindow.domainId, observedWindow.classroomId, observedEntry.sourceSeatId, async () => {
            await this.reconcileCompletedClaim(
                observedWindow.domainId,
                observedWindow.classroomId,
                observedEntry.sourceSeatId,
                observedWindow.windowId,
            );
            const claimed = await this.claimCode(codeDigest, endpointId, requestId, observedWindow.windowId, observedEntry.sourceSeatId);
            if (claimed.entry.status === 'bound') {
                const binding = await this.loadBinding(claimed.window.domainId, claimed.window.classroomId, claimed.entry.sourceSeatId);
                if (
                    !binding ||
                    binding.status !== 'active' ||
                    binding.endpointId !== endpointId ||
                    binding.revision !== claimed.entry.bindingRevision
                ) {
                    throw new EndpointSeatBindingError('pairing_binding_drift');
                }
                return { status: 'bound', binding, entryRevision: claimed.entry.revision };
            }
            if (claimed.entry.status === 'cancelled') throw new EndpointSeatBindingError('pairing_cancelled');
            if (claimed.entry.mode === 'replace') {
                return {
                    status: 'replacement_confirmation_required',
                    windowId: new ObjectId(claimed.window.windowId),
                    classroomId: new ObjectId(claimed.window.classroomId),
                    sourceSeatId: claimed.entry.sourceSeatId,
                    entryRevision: claimed.entry.revision,
                };
            }
            return this.finishInitialBinding(claimed.window, claimed.entry);
        });
    }

    private async referencesFor(binding: EndpointSeatBindingDoc, endpointIds: string[]): Promise<EndpointSeatReferenceFact[]> {
        const references = await this.resolveActivityReferences(binding.domainId, [...endpointIds].sort(), binding.schoolId, this.now());
        const canonical = canonicalReferences(references);
        if (canonical.some((reference) => reference.domainId !== binding.domainId || !endpointIds.includes(reference.endpointId))) {
            throw new EndpointSeatBindingError('reference_state_invalid');
        }
        return canonical;
    }

    async previewReplacement(input: {
        domainId: string;
        classroomId: ObjectId;
        windowId: ObjectId;
        sourceSeatId: string;
    }): Promise<EndpointSeatReplacementPreview> {
        canonicalDomainId(input.domainId);
        assertObjectId(input.classroomId, 'classroom_id');
        assertObjectId(input.windowId, 'pairing_window_id');
        canonicalText(input.sourceSeatId, 'source_seat');
        const window = await this.loadWindowById(input.domainId, input.classroomId, input.windowId);
        if (!window || !window.windowId.equals(input.windowId)) throw new EndpointSeatBindingError('pairing_window_changed');
        const entry = window.entries.find((item) => item.sourceSeatId === input.sourceSeatId);
        if (!entry || entry.mode !== 'replace' || entry.status !== 'claimed' || !entry.claimedEndpointId || !entry.claimRequestId) {
            throw new EndpointSeatBindingError('replacement_not_claimed');
        }
        const latest = await this.loadWindow(input.domainId, input.classroomId);
        if (!latest || latest._id !== window._id) throw new EndpointSeatBindingError('pairing_window_changed');
        const seat = await this.requireSeat(input.domainId, input.classroomId, input.sourceSeatId);
        if (!seat.schoolId.equals(window.schoolId)) throw new EndpointSeatBindingError('seat_school_mismatch');
        const binding = await this.loadBinding(input.domainId, input.classroomId, input.sourceSeatId);
        if (!binding || binding.status !== 'active' || binding.revision !== entry.expectedBindingRevision || !binding.endpointId) {
            throw new EndpointSeatBindingError('binding_revision_conflict');
        }
        const ownership = await this.requireOwnership(entry.claimedEndpointId);
        if (ownership.domainId !== input.domainId) throw new EndpointSeatBindingError('endpoint_domain_mismatch');
        if (ownership.replacesEndpointId !== binding.endpointId) throw new EndpointSeatBindingError('endpoint_not_replacement');
        const references = await this.referencesFor(binding, [binding.endpointId, entry.claimedEndpointId]);
        const fingerprint = confirmationFingerprint({
            action: 'replace',
            windowId: window.windowId.toHexString(),
            classroomId: window.classroomId.toHexString(),
            sourceSeatId: entry.sourceSeatId,
            entryRevision: entry.revision,
            bindingRevision: binding.revision,
            oldEndpointId: binding.endpointId,
            newEndpointId: entry.claimedEndpointId,
            references: referencesJson(references),
        });
        return {
            windowId: new ObjectId(window.windowId),
            classroomId: new ObjectId(window.classroomId),
            sourceSeatId: entry.sourceSeatId,
            entryRevision: entry.revision,
            bindingRevision: binding.revision,
            oldEndpointId: binding.endpointId,
            newEndpointId: entry.claimedEndpointId,
            references,
            confirmationFingerprint: fingerprint,
        };
    }

    async confirmReplacement(input: ConfirmReplacementInput): Promise<EndpointSeatBindingDoc> {
        return (await this.confirmReplacementWithOutcome(input)).value;
    }

    async confirmReplacementWithOutcome(input: ConfirmReplacementInput): Promise<EndpointSeatMutationOutcome<EndpointSeatBindingDoc>> {
        canonicalDomainId(input.domainId);
        assertObjectId(input.classroomId, 'classroom_id');
        assertObjectId(input.windowId, 'pairing_window_id');
        canonicalText(input.sourceSeatId, 'source_seat');
        assertPositiveInteger(input.expectedEntryRevision, 'pairing_entry_revision');
        assertPositiveInteger(input.expectedBindingRevision, 'binding_revision');
        assertUid(input.actorUid);
        canonicalRequestId(input.requestId);
        assertSha256(input.confirmationFingerprint, 'replacement_confirmation_invalid');
        return withEndpointSeatMutationBoundary(input.domainId, input.classroomId, input.sourceSeatId, async () => {
            const current = await this.loadBinding(input.domainId, input.classroomId, input.sourceSeatId);
            const replay = current?.history.find((entry) => entry.requestId === input.requestId);
            if (replay) {
                if (current?.status !== 'active' || replay.action !== 'replace' || current.endpointId !== replay.endpointId) {
                    throw new EndpointSeatBindingError('request_replay_conflict');
                }
                await this.markEntry(
                    input.windowId,
                    input.domainId,
                    input.classroomId,
                    input.sourceSeatId,
                    replay.endpointRequestId,
                    replay.endpointId,
                    current.revision,
                    current.updatedAt,
                    userActor(replay.actorUid),
                );
                return { value: current, replayed: true, canonicalActorUid: replay.actorUid };
            }
            const preview = await this.previewReplacement(input);
            if (preview.entryRevision !== input.expectedEntryRevision || preview.bindingRevision !== input.expectedBindingRevision) {
                throw new EndpointSeatBindingError('binding_revision_conflict');
            }
            if (preview.confirmationFingerprint !== input.confirmationFingerprint) {
                throw new EndpointSeatBindingError('replacement_confirmation_stale');
            }
            const window = await this.loadWindowById(input.domainId, input.classroomId, input.windowId);
            if (!window || !window.windowId.equals(input.windowId)) throw new EndpointSeatBindingError('pairing_window_changed');
            const entry = window.entries.find((item) => item.sourceSeatId === input.sourceSeatId);
            if (
                !entry ||
                entry.mode !== 'replace' ||
                entry.status !== 'claimed' ||
                entry.revision !== input.expectedEntryRevision ||
                !entry.claimRequestId ||
                entry.claimedEndpointId !== preview.newEndpointId
            ) {
                throw new EndpointSeatBindingError('replacement_not_claimed');
            }
            const now = this.now();
            if (window.status !== 'open' || window.expiresAt <= now) throw new EndpointSeatBindingError('pairing_code_expired');
            const binding = await this.loadBinding(input.domainId, input.classroomId, input.sourceSeatId);
            if (
                !binding ||
                binding.status !== 'active' ||
                binding.revision !== input.expectedBindingRevision ||
                binding.endpointId !== preview.oldEndpointId
            ) {
                throw new EndpointSeatBindingError('binding_revision_conflict');
            }
            if (now < binding.updatedAt || now < window.updatedAt) throw new EndpointSeatBindingError('clock_rollback');
            const occupied = await this.loadActiveEndpointBinding(input.domainId, preview.newEndpointId);
            if (occupied) {
                if (!occupied.schoolId.equals(binding.schoolId)) throw new EndpointSeatBindingError('cross_school_endpoint');
                throw new EndpointSeatBindingError('endpoint_already_bound');
            }
            const revision = binding.revision + 1;
            const target: EndpointSeatBindingDoc = {
                ...cloneBinding(binding),
                status: 'active',
                endpointId: preview.newEndpointId,
                revision,
                history: [
                    ...binding.history,
                    {
                        revision,
                        action: 'replace',
                        previousEndpointId: preview.oldEndpointId,
                        endpointId: preview.newEndpointId,
                        requestId: input.requestId,
                        endpointRequestId: entry.claimRequestId,
                        actorUid: input.actorUid,
                        at: now,
                        pairingWindowId: new ObjectId(window.windowId),
                        referenceFingerprint: preview.confirmationFingerprint,
                    },
                ],
                updatedBy: input.actorUid,
                updatedAt: now,
            };
            try {
                await this.replaceBinding(binding, target);
            } catch (error) {
                if (error instanceof EndpointSeatBindingError && error.reason === 'binding_revision_conflict') {
                    const raced = await this.loadActiveEndpointBinding(input.domainId, preview.newEndpointId);
                    const racedOperation = raced?.history.find((item) => item.action === 'replace' && item.requestId === input.requestId);
                    if (raced?.status === 'active' && raced.endpointId === preview.newEndpointId && racedOperation?.action === 'replace') {
                        await this.markEntry(
                            input.windowId,
                            input.domainId,
                            input.classroomId,
                            input.sourceSeatId,
                            racedOperation.endpointRequestId,
                            racedOperation.endpointId,
                            raced.revision,
                            raced.updatedAt,
                            userActor(racedOperation.actorUid),
                        );
                        return { value: raced, replayed: true, canonicalActorUid: racedOperation.actorUid };
                    }
                }
                if (duplicateKey(error)) throw new EndpointSeatBindingError('endpoint_already_bound', { cause: error });
                throw error;
            }
            await this.markEntry(
                window.windowId,
                window.domainId,
                window.classroomId,
                entry.sourceSeatId,
                entry.claimRequestId,
                preview.newEndpointId,
                target.revision,
                target.updatedAt,
                userActor(input.actorUid),
            );
            return { value: target, replayed: false, canonicalActorUid: input.actorUid };
        });
    }

    async previewUnbind(input: { domainId: string; classroomId: ObjectId; sourceSeatId: string }): Promise<EndpointSeatUnbindPreview> {
        const seat = await this.requireSeat(input.domainId, input.classroomId, input.sourceSeatId);
        const binding = await this.loadBinding(input.domainId, input.classroomId, input.sourceSeatId);
        if (!binding || binding.status !== 'active' || !binding.endpointId) throw new EndpointSeatBindingError('seat_not_bound');
        if (!binding.schoolId.equals(seat.schoolId)) throw new EndpointSeatBindingError('seat_school_mismatch');
        const references = await this.referencesFor(binding, [binding.endpointId]);
        return {
            bindingRevision: binding.revision,
            endpointId: binding.endpointId,
            references,
            confirmationFingerprint: confirmationFingerprint({
                action: 'unbind',
                bindingId: binding._id.toHexString(),
                bindingRevision: binding.revision,
                endpointId: binding.endpointId,
                references: referencesJson(references),
            }),
        };
    }

    async unbind(input: UnbindInput): Promise<EndpointSeatBindingDoc> {
        return (await this.unbindWithOutcome(input)).value;
    }

    async unbindWithOutcome(input: UnbindInput): Promise<EndpointSeatMutationOutcome<EndpointSeatBindingDoc>> {
        canonicalDomainId(input.domainId);
        assertObjectId(input.classroomId, 'classroom_id');
        canonicalText(input.sourceSeatId, 'source_seat');
        assertPositiveInteger(input.expectedBindingRevision, 'binding_revision');
        assertUid(input.actorUid);
        canonicalRequestId(input.requestId);
        assertSha256(input.confirmationFingerprint, 'unbind_confirmation_invalid');
        return withEndpointSeatMutationBoundary(input.domainId, input.classroomId, input.sourceSeatId, async () => {
            await this.reconcileCompletedClaim(input.domainId, input.classroomId, input.sourceSeatId);
            const current = await this.loadBinding(input.domainId, input.classroomId, input.sourceSeatId);
            const replay = current?.history.find((entry) => entry.requestId === input.requestId);
            if (replay) {
                if (current?.status !== 'unbound' || replay.action !== 'unbind' || current.history.at(-1)?.requestId !== input.requestId) {
                    throw new EndpointSeatBindingError('request_replay_conflict');
                }
                return { value: current, replayed: true, canonicalActorUid: replay.actorUid };
            }
            const preview = await this.previewUnbind(input);
            if (preview.bindingRevision !== input.expectedBindingRevision) throw new EndpointSeatBindingError('binding_revision_conflict');
            if (preview.confirmationFingerprint !== input.confirmationFingerprint) throw new EndpointSeatBindingError('unbind_confirmation_stale');
            const binding = await this.loadBinding(input.domainId, input.classroomId, input.sourceSeatId);
            if (!binding || binding.status !== 'active' || !binding.endpointId || binding.revision !== input.expectedBindingRevision) {
                throw new EndpointSeatBindingError('binding_revision_conflict');
            }
            const now = this.now();
            if (now < binding.updatedAt) throw new EndpointSeatBindingError('clock_rollback');
            const revision = binding.revision + 1;
            const { endpointId: previousEndpointId, ...withoutEndpoint } = binding;
            const target: EndpointSeatBindingDoc = {
                ...cloneBinding(withoutEndpoint as EndpointSeatBindingDoc),
                status: 'unbound',
                revision,
                history: [
                    ...binding.history,
                    {
                        revision,
                        action: 'unbind',
                        previousEndpointId,
                        requestId: input.requestId,
                        actorUid: input.actorUid,
                        at: now,
                        referenceFingerprint: preview.confirmationFingerprint,
                    },
                ],
                updatedBy: input.actorUid,
                updatedAt: now,
            };
            await this.replaceBinding(binding, target);
            return { value: target, replayed: false, canonicalActorUid: input.actorUid };
        });
    }

    async listClassroomBindings(domainId: string, classroomId: ObjectId): Promise<EndpointSeatBindingDoc[]> {
        canonicalDomainId(domainId);
        assertObjectId(classroomId, 'classroom_id');
        const rows = await this.bindings.find({ domainId, classroomId }).toArray();
        rows.forEach(assertEndpointSeatBindingIntegrity);
        if (rows.length) {
            await this.assertSeatReferences(
                domainId,
                classroomId,
                rows.map((binding) => ({ schoolId: binding.schoolId, sourceSeatId: binding.sourceSeatId })),
            );
        }
        rows.sort((left, right) => left.sourceSeatId.localeCompare(right.sourceSeatId));
        return rows;
    }

    async getBindingById(domainId: string, bindingId: ObjectId): Promise<EndpointSeatBindingDoc | null> {
        canonicalDomainId(domainId);
        assertObjectId(bindingId, 'binding_id');
        const binding = await this.bindings.findOne({ domainId, _id: bindingId });
        if (binding) {
            assertEndpointSeatBindingIntegrity(binding);
            await this.assertBindingReference(binding);
        }
        return binding;
    }

    async getPairingWindow(domainId: string, classroomId: ObjectId): Promise<EndpointSeatPairingWindowDoc | null> {
        canonicalDomainId(domainId);
        assertObjectId(classroomId, 'classroom_id');
        return this.loadWindow(domainId, classroomId);
    }

    async getClassroomState(domainId: string, classroomId: ObjectId): Promise<EndpointSeatClassroomState> {
        const [bindings, pairingWindow] = await Promise.all([
            this.listClassroomBindings(domainId, classroomId),
            this.getPairingWindow(domainId, classroomId),
        ]);
        const active = bindings.filter(
            (binding): binding is EndpointSeatBindingDoc & { endpointId: string } => binding.status === 'active' && Boolean(binding.endpointId),
        );
        if (!active.length) return { bindings, pairingWindow, references: [] };
        const schoolIds = new Set(active.map((binding) => binding.schoolId.toHexString()));
        if (schoolIds.size !== 1) throw new EndpointSeatBindingError('reference_state_invalid');
        const endpointIds = active.map((binding) => binding.endpointId).sort();
        const references = canonicalReferences(await this.resolveActivityReferences(domainId, endpointIds, active[0].schoolId, this.now()));
        if (references.some((reference) => reference.domainId !== domainId || !endpointIds.includes(reference.endpointId))) {
            throw new EndpointSeatBindingError('reference_state_invalid');
        }
        return { bindings, pairingWindow, references };
    }
}

async function loadProductionClassroomSeats(
    classrooms: ExamClassroomService,
    domainId: string,
    classroomId: ObjectId,
): Promise<EndpointSeatClassroomLocation | null> {
    const classroom = await classrooms.get(domainId, classroomId);
    if (!classroom) return null;
    return {
        domainId: classroom.domainId,
        schoolId: new ObjectId(classroom.schoolId),
        classroomId: new ObjectId(classroom._id),
        sourceSeatIds: classrooms.layout(classroom, classroom.layoutRevision).snapshot.seats.map((seat) => seat.sourceSeatId),
    };
}

async function loadProductionEndpointOwnership(endpointId: string, observedAt: Date): Promise<EndpointOwnership | null> {
    const batches = await endpointEnrollmentBatchColl.find({ 'claims.endpointId': endpointId }).toArray();
    const facts = batches.flatMap((batch) => batch.claims.filter((claim) => claim.endpointId === endpointId).map((claim) => ({ batch, claim })));
    if (!facts.length) return null;
    if (facts.length !== 1) throw new EndpointSeatBindingError('endpoint_ownership_invalid');
    const { batch, claim } = facts[0];
    if (!(claim.finalizedAt instanceof Date) || !Number.isFinite(claim.finalizedAt.getTime()) || claim.finalizedAt > observedAt) {
        throw new EndpointSeatBindingError('endpoint_ownership_invalid');
    }
    canonicalDomainId(batch.domainId);
    if (batch.replacesEndpointId) canonicalEndpointId(batch.replacesEndpointId);
    return { domainId: batch.domainId, ...(batch.replacesEndpointId ? { replacesEndpointId: batch.replacesEndpointId } : {}) };
}

interface TargetReference {
    kind: EndpointSeatReferenceFact['kind'];
    eventId: ObjectId;
    schoolId?: ObjectId;
    target: { id: ObjectId; revision: number; fingerprint: string };
}

function targetReferenceFromConfig(config: ExamEventNetworkConfigDoc): TargetReference | null {
    return config.target ? { kind: 'network-config', eventId: config.eventId, target: config.target } : null;
}

function targetReferenceFromExecution(execution: ExamNetworkExecutionDoc): TargetReference {
    return { kind: 'network-execution', eventId: execution.eventId, schoolId: execution.schoolId, target: execution.targetRef };
}

async function resolveProductionActivityReferences(
    domainId: string,
    endpointIds: string[],
    schoolId: ObjectId,
    now: Date,
): Promise<EndpointSeatReferenceFact[]> {
    const [configs, executions] = await Promise.all([
        examEventNetworkConfigColl.find({ domainId, target: { $exists: true } }).toArray(),
        examNetworkExecutionColl.find({ domainId }).toArray(),
    ]);
    const references = [
        ...configs.map(targetReferenceFromConfig).filter((item): item is TargetReference => item !== null),
        ...executions.map(targetReferenceFromExecution),
    ];
    const targetIds = Array.from(new Map(references.map((reference) => [reference.target.id.toHexString(), reference.target.id])).values());
    const eventIds = Array.from(new Map(references.map((reference) => [reference.eventId.toHexString(), reference.eventId])).values());
    const [assignments, events] = await Promise.all([
        targetIds.length
            ? examTargetAssignmentColl.find({ domainId, _id: { $in: targetIds } }).toArray()
            : Promise.resolve([] as ExamTargetAssignmentDoc[]),
        eventIds.length ? examEventColl.find({ domainId, _id: { $in: eventIds } }).toArray() : Promise.resolve([]),
    ]);
    const assignmentsById = new Map(assignments.map((assignment) => [assignment._id.toHexString(), assignment]));
    const eventsById = new Map(events.map((event) => [event._id.toHexString(), event]));
    const output: EndpointSeatReferenceFact[] = [];
    for (const reference of references) {
        const event = eventsById.get(reference.eventId.toHexString());
        const assignment = assignmentsById.get(reference.target.id.toHexString());
        if (!event || !assignment) throw new EndpointSeatBindingError('reference_state_invalid');
        if (!assignment.eventId.equals(event._id) || !assignment.schoolId.equals(event.schoolId)) {
            throw new EndpointSeatBindingError('reference_state_invalid');
        }
        const revision = assignment.revisions.find((item) => item.revision === reference.target.revision);
        if (!revision || revision.targetFingerprint !== reference.target.fingerprint) {
            throw new EndpointSeatBindingError('reference_state_invalid');
        }
        const referencedEndpointIds = endpointIds.filter((endpointId) => revision.endpointIds.includes(endpointId));
        if (!referencedEndpointIds.length || event.lifecycle === 'archived' || event.endAt <= now) continue;
        if (
            !event.schoolId.equals(schoolId) ||
            !assignment.schoolId.equals(schoolId) ||
            (reference.schoolId && !reference.schoolId.equals(schoolId))
        ) {
            throw new EndpointSeatBindingError('reference_state_invalid');
        }
        for (const endpointId of referencedEndpointIds) {
            output.push({
                kind: reference.kind,
                domainId,
                endpointId,
                eventId: new ObjectId(event._id),
                eventTitle: event.title,
                eventState: event.startAt <= now ? 'active' : 'future',
                startAt: new Date(event.startAt),
                endAt: new Date(event.endAt),
                targetId: new ObjectId(assignment._id),
                targetRevision: revision.revision,
                targetFingerprint: revision.targetFingerprint,
            });
        }
    }
    return output;
}

export const endpointSeatBindingColl = db.collection<EndpointSeatBindingDoc>('exam.endpointSeatBindings');
export const endpointSeatPairingWindowColl = db.collection<EndpointSeatPairingWindowDoc>('exam.endpointSeatPairingWindows');
const domainColl = db.collection<{ _id: string }>('domain');
export const endpointSeatBindingService = new EndpointSeatBindingService({
    bindings: endpointSeatBindingColl,
    windows: endpointSeatPairingWindowColl,
    domainExists: async (domainId) => Boolean(await domainColl.findOne({ _id: domainId }, { projection: { _id: 1 } })),
    loadClassroomSeats: (domainId, classroomId) => loadProductionClassroomSeats(examClassroomService, domainId, classroomId),
    loadEndpointOwnership: loadProductionEndpointOwnership,
    resolveActivityReferences: resolveProductionActivityReferences,
});

export async function deleteEndpointSeatBindingDomainFacts(
    domainId: string,
    stores: {
        bindings: Pick<BindingCollection, 'deleteMany'>;
        windows: Pick<WindowCollection, 'deleteMany'>;
    } = { bindings: endpointSeatBindingColl, windows: endpointSeatPairingWindowColl },
): Promise<void> {
    canonicalDomainId(domainId);
    await settleDomainCleanupOperations(domainId, [() => stores.bindings.deleteMany({ domainId }), () => stores.windows.deleteMany({ domainId })]);
}

export async function apply(ctx: Context): Promise<void> {
    await endpointSeatBindingService.ensureIndexes();
    ctx.on('domain/delete', async (domainId: string) => {
        await deleteEndpointSeatBindingDomainFacts(domainId);
    });
}

global.Hydro.model.endpointSeatBinding = {
    endpointSeatBindingColl,
    endpointSeatPairingWindowColl,
    endpointSeatBindingService,
};
