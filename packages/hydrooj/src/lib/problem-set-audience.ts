import { ObjectId } from 'mongodb';
import type { TrainingDoc } from '../interface';

function canonicalGroupId(value: unknown): string {
    if (typeof value === 'string' && ObjectId.isValid(value) && new ObjectId(value).toHexString() === value.toLowerCase()) {
        return value.toLowerCase();
    }
    if (value instanceof ObjectId) return value.toHexString();
    throw new TypeError('problem set audience group id must be an ObjectId');
}

export function canonicalProblemSetAudience(input: unknown): { public: boolean; groupIds: ObjectId[] } {
    if (input === undefined || input === null) return { public: true, groupIds: [] };
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('problemSetAudience must be an object');
    const unknown = Object.keys(input as Record<string, unknown>).filter((key) => !['public', 'groupIds'].includes(key));
    if (unknown.length) throw new TypeError(`unknown problemSetAudience field: ${unknown[0]}`);
    const publicValue = (input as { public?: unknown }).public;
    if (typeof publicValue !== 'boolean') throw new TypeError('problemSetAudience.public must be a boolean');
    const rawGroups = (input as { groupIds?: unknown }).groupIds;
    if (rawGroups === undefined) return { public: publicValue, groupIds: [] };
    if (!Array.isArray(rawGroups)) throw new TypeError('problemSetAudience.groupIds must be an array');
    return { public: publicValue, groupIds: rawGroups.map((groupId) => new ObjectId(canonicalGroupId(groupId))) };
}

export function isLegacyPublicProblemSet(tdoc: Pick<TrainingDoc, 'problemSetAudience'>): boolean {
    return tdoc.problemSetAudience === undefined;
}

export function problemSetAudienceOf(tdoc: Pick<TrainingDoc, 'problemSetAudience'>): { public: boolean; groupIds: string[] } {
    if (isLegacyPublicProblemSet(tdoc)) return { public: true, groupIds: [] };
    const audience = canonicalProblemSetAudience(tdoc.problemSetAudience);
    return { public: audience.public, groupIds: audience.groupIds.map((id) => id.toHexString()) };
}
