import Schema from 'schemastery';
import type { Context } from '../context';
import { initializeSourceTemplates } from '../model/problem-source-template';

export function apply(ctx: Context) {
    ctx.addScript(
        'problemSourceTemplates',
        'Plan or initialize the source template catalog',
        Schema.object({
            domainId: Schema.string().required(),
            fingerprint: Schema.string(),
            backupConfirmed: Schema.string(),
            reconcileCustomSelfNamespaces: Schema.array(Schema.string()),
            serviceStopped: Schema.string(),
        }),
        async ({ domainId, fingerprint, backupConfirmed, reconcileCustomSelfNamespaces, serviceStopped }, report) => {
            if (fingerprint && backupConfirmed !== fingerprint) throw new Error('Confirm the completed backup with the exact plan fingerprint');
            if (fingerprint && reconcileCustomSelfNamespaces?.length && serviceStopped !== fingerprint) {
                throw new Error('Confirm Hydro is stopped with the exact reconciliation plan fingerprint');
            }
            report({ message: JSON.stringify(await initializeSourceTemplates(domainId, fingerprint, reconcileCustomSelfNamespaces)) });
            return true;
        },
    );
}
