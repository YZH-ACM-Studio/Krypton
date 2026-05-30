/**
 * Migration scripts for krypton-vigilguard.
 *
 * Channel: `vigilguard`. Tracked by `system.db.ver-vigilguard`.
 *
 * Migration list:
 *   v1 — Backfill existing `rule:'exam'` contests with vigilEnabled=true,
 *        entryMode='client_required', and sensible defaults for the
 *        approval / lockout / screenshot fields. Other rules are left
 *        with `vigilEnabled:false, entryMode:'open'` (no change to runtime
 *        behavior until an admin explicitly opts in via the editor).
 *
 * See /Users/motricseven/Krypton/CLIENT_REQUIRED_CONTEST_DESIGN.md §16
 * (impl order) and §17 (confirmed decisions) — Q1 specifically: "exam
 * contests get auto-promoted to client_required so the existing Vigil
 * flow keeps working without re-config".
 */
import { Logger } from '@hydrooj/utils';
import type { Context } from 'hydrooj';
import { oncePerSetting } from 'hydrooj/src/lib/migration-helpers';
import * as document from 'hydrooj/src/model/document';

const logger = new Logger('vigilguard:migration');

/**
 * V1: backfill `vigilEnabled`/`entryMode`/lockout-window defaults on every
 * `rule:'exam'` contest. Pre-existing fields (`approvalMode`, `lockdownMode`
 * etc.) are preserved — we only fill in what's missing.
 *
 * Non-exam contests get *no* changes here; their default `vigilEnabled=false`
 * is implicit (read as `undefined === false` at use sites).
 */
async function migrateV1(_ctx: Context): Promise<void> {
    const V1_FLAG = 'vigilguard.migration_v1_done';
    await oncePerSetting(V1_FLAG, async () => {
        const cursor = document.coll.find({
            docType: document.TYPE_CONTEST,
            rule: 'exam',
        } as any);

        let upgraded = 0;
        let scopeFromGroups = 0;
        let scopeFromSchools = 0;

        for await (const tdoc of cursor) {
            const update: Record<string, any> = {};

            if ((tdoc as any).vigilEnabled !== true) update.vigilEnabled = true;
            if ((tdoc as any).entryMode !== 'client_required') update.entryMode = 'client_required';
            if (!(tdoc as any).approvalMode) update.approvalMode = 'strict';
            if (!Number.isFinite((tdoc as any).screenshotIntervalMs)) update.screenshotIntervalMs = 60000;
            if ((tdoc as any).lockdownMode === undefined) update.lockdownMode = false;
            if ((tdoc as any).pauseOnDisconnect === undefined) update.pauseOnDisconnect = false;
            if ((tdoc as any).exclusive === undefined) update.exclusive = false;
            if (!Number.isFinite((tdoc as any).clientLoginBlockBeforeMinutes)) {
                update.clientLoginBlockBeforeMinutes = 60;
            }
            if (!Number.isFinite((tdoc as any).clientLoginBlockAfterMinutes)) {
                update.clientLoginBlockAfterMinutes = 30;
            }

            // Participant scope inference: if the legacy `participantGroupIds`
            // or `participantSchoolIds` arrays are non-empty (pre-design code
            // landed early but never gated by a scopeMode), pick the mode
            // accordingly. Otherwise default to 'none'.
            if (!(tdoc as any).participantScopeMode) {
                const gIds = (tdoc as any).participantGroupIds;
                const sIds = (tdoc as any).participantSchoolIds;
                if (Array.isArray(sIds) && sIds.length > 0) {
                    update.participantScopeMode = 'schools';
                    scopeFromSchools++;
                } else if (Array.isArray(gIds) && gIds.length > 0) {
                    update.participantScopeMode = 'groups';
                    scopeFromGroups++;
                } else {
                    update.participantScopeMode = 'none';
                }
            }

            if (Object.keys(update).length) {
                await document.coll.updateOne({ _id: (tdoc as any)._id }, { $set: update });
                upgraded++;
            }
        }

        logger.info(
            'v1 backfill: %d exam contests upgraded (scope inferred from schools=%d, groups=%d)',
            upgraded, scopeFromSchools, scopeFromGroups,
        );
    });
}

/**
 * V2: backfill live media + jitter defaults on contests already migrated
 * by V1. New columns:
 *   - liveEnabled (default true)
 *   - recordEnabled (default false)
 *   - cameraEnabled (default true)
 *   - screenshotJitterMs (default 30000)
 *   - vigilProcessWhitelist (default [])
 *
 * Touches `rule:'exam'` contests + any contest with vigilEnabled=true.
 * Existing fields are preserved — V2 only fills in missing values.
 *
 * See CLIENT_PROCTOR_MONITORING_DESIGN.md §3.
 */
async function migrateV2(_ctx: Context): Promise<void> {
    const V2_FLAG = 'vigilguard.migration_v2_media_defaults';
    await oncePerSetting(V2_FLAG, async () => {
        const cursor = document.coll.find({
            docType: document.TYPE_CONTEST,
            $or: [{ rule: 'exam' }, { vigilEnabled: true }],
        } as any);
        let upgraded = 0;
        for await (const tdoc of cursor) {
            const update: Record<string, any> = {};
            if ((tdoc as any).liveEnabled === undefined) update.liveEnabled = true;
            if ((tdoc as any).recordEnabled === undefined) update.recordEnabled = false;
            if ((tdoc as any).cameraEnabled === undefined) update.cameraEnabled = true;
            if (!Number.isFinite((tdoc as any).screenshotJitterMs)) {
                update.screenshotJitterMs = 30000;
            }
            if (!Array.isArray((tdoc as any).vigilProcessWhitelist)) {
                update.vigilProcessWhitelist = [];
            }
            if (Object.keys(update).length) {
                await document.coll.updateOne({ _id: (tdoc as any)._id }, { $set: update });
                upgraded++;
            }
        }
        logger.info('v2 media defaults backfilled on %d contests', upgraded);
    });
}

/**
 * Migration channel script list — index = target dbVer. Append new
 * migrations; don't reorder existing ones.
 */
export const migrationScripts = [
    // Version 0 → 1: backfill vigilEnabled / entryMode on existing exam contests
    migrateV1,
    // Version 1 → 2: live media + jitter + process whitelist defaults
    migrateV2,
];
