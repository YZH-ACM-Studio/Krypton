import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { expect } from 'chai';

const source = readFileSync(resolve(__dirname, '../src/handler/endpoint-seat-binding.ts'), 'utf8');

function routeRegistration(name: string): string {
    const nameIndex = source.indexOf(`'${name}'`);
    expect(nameIndex).to.be.greaterThan(-1);
    const start = source.lastIndexOf('ctx.Route(', nameIndex);
    const end = source.indexOf(');', nameIndex);
    expect(start).to.be.greaterThan(-1);
    expect(end).to.be.greaterThan(nameIndex);
    return source.slice(start, end + 2);
}

describe('P2.2 endpoint seat binding HTTP boundary', () => {
    it('registers only OJ-owned administrator and Vigil service-token routes', () => {
        expect(routeRegistration('endpoint_seat_classroom_state')).to.include(
            "'/api/admin/exam-infrastructure/classrooms/:classroomId/seat-bindings'",
        );
        expect(routeRegistration('endpoint_seat_classroom_collection')).to.include("'/api/admin/exam-infrastructure/classrooms'");
        expect(routeRegistration('endpoint_seat_classroom_page')).to.include("'/admin/exam-infrastructure/classrooms/:classroomId'");
        expect(routeRegistration('endpoint_seat_pairing_window')).to.include(
            "'/api/admin/exam-infrastructure/classrooms/:classroomId/seat-pairing-window'",
        );
        expect(routeRegistration('endpoint_seat_binding_detail')).to.include(
            "'/api/admin/exam-infrastructure/classrooms/:classroomId/seat-bindings/:sourceSeatId'",
        );
        expect(routeRegistration('vigil_endpoint_seat_pairing_redeem')).to.include("'/api/vigil/endpoint-seat-pairing/redeem'");
        expect(source).to.include('isExamInfrastructureAdmin(this.user)');
        expect(source).to.include("requireServiceToken(this, 'vigil')");
        expect(source).to.include('await endpointSeatBindingService.ensureIndexes()');
        expect(source).to.include("this.response.template = 'admin_exam_classroom.html'");
    });

    it('makes every administrator mutation carry explicit request and CAS identities', () => {
        expect(source).to.include("@param('expectedRevision', Types.UnsignedInt)");
        expect(source).to.include("@param('expectedEntryRevision', Types.PositiveInt");
        expect(source).to.include("@param('expectedBindingRevision', Types.PositiveInt");
        expect(source.match(/@param\('requestId', Types\.String\)/g)?.length).to.be.greaterThanOrEqual(2);
        expect(source).to.include("Types.Range(['open', 'close'])");
        expect(source).to.include("Types.Range(['previewUnbind', 'unbind', 'previewReplacement', 'confirmReplacement', 'cancelPairing'])");
    });

    it('never serializes stored code digests or records the one-time code in logs or oplog', () => {
        expect(source).not.to.include('codeDigest:');
        expect(source).not.to.match(/logger\.[a-z]+\([^\n]*(pairingCode|codeDigest)/);
        expect(source).to.include('Endpoint seat pairing rejected stage=redeem reason=%s');
        for (const statement of source.split('OplogModel.log(').slice(1)) {
            expect(statement.slice(0, statement.indexOf(');'))).not.to.include('pairingCode');
            expect(statement.slice(0, statement.indexOf(');'))).not.to.include('codeDigest');
        }
    });

    it('redacts pairing codes from generic slow-request oplog args and JSON', async () => {
        const dbPath = require.resolve('../src/service/db.ts');
        const busPath = require.resolve('../src/service/bus.ts');
        const oplogPath = require.resolve('../src/model/oplog.ts');
        const previousDb = require.cache[dbPath];
        const previousBus = require.cache[busPath];
        const previousOplog = require.cache[oplogPath];
        const inserted: Array<Record<string, unknown>> = [];
        const hydroGlobal = global as unknown as { Hydro?: { model?: Record<string, unknown> } };
        hydroGlobal.Hydro ||= {};
        hydroGlobal.Hydro.model ||= {};
        require.cache[dbPath] = {
            id: dbPath,
            filename: dbPath,
            loaded: true,
            exports: {
                __esModule: true,
                default: {
                    collection: () => ({
                        insertOne: async (document: Record<string, unknown>) => {
                            inserted.push(document);
                            return { insertedId: document._id };
                        },
                    }),
                },
            },
        } as NodeModule;
        require.cache[busPath] = {
            id: busPath,
            filename: busPath,
            loaded: true,
            exports: { __esModule: true, default: { parallel: async () => undefined } },
        } as NodeModule;

        try {
            delete require.cache[oplogPath];
            const { log } = require(oplogPath) as typeof import('../src/model/oplog');
            await log(
                {
                    args: { pairingCode: 'KSP1-AAAAAAAAAA', requestId: 'endpoint_pairing_test_001' },
                    request: {
                        headers: {},
                        ip: '127.0.0.1',
                        json: { nested: { pairingCode: 'KSP1-BBBBBBBBBB', ticket: 'KPT1.secret' }, safe: 'visible' },
                        path: '/api/vigil/endpoint-seat-pairing/redeem',
                    },
                    user: null,
                } as never,
                'slow_request',
                { method: 'POST', processtime: 5001 },
            );
            expect(inserted).to.have.length(1);
            expect(inserted[0].args).to.deep.equal({ requestId: 'endpoint_pairing_test_001' });
            expect(inserted[0].json).to.deep.equal({ nested: {}, safe: 'visible' });
            expect(JSON.stringify(inserted[0])).not.to.include('KSP1-');
            expect(JSON.stringify(inserted[0])).not.to.include('KPT1.secret');
        } finally {
            if (previousDb) require.cache[dbPath] = previousDb;
            else delete require.cache[dbPath];
            if (previousBus) require.cache[busPath] = previousBus;
            else delete require.cache[busPath];
            if (previousOplog) require.cache[oplogPath] = previousOplog;
            else delete require.cache[oplogPath];
        }
    });

    it('logs retries as replay observations with the original canonical actor', () => {
        expect(source).to.include('canonicalActorUid: outcome.canonicalActorUid');
        expect(source).to.include('endpoint.seat_pairing_window.close.replay');
        expect(source).to.include('endpoint.seat_binding.unbind.replay');
        expect(source).to.include('endpoint.seat_pairing.cancel.replay');
        expect(source).to.include('endpoint.seat_binding.replace.replay');
        expect(source).to.include('replayed: outcome.replayed');
    });

    it('does not enable or call the legacy Vigil seat-label subsystem', () => {
        expect(source).not.to.include('/api/admin/vigil/seats');
        expect(source).not.to.include('seat_label');
        expect(source).not.to.include('machine_id');
    });

    it('serves one pure read model with canonical layout, references, and explicit Vigil availability', () => {
        expect(source).to.include('endpointSeatBindingService.getClassroomState');
        expect(source).to.include('layout: serializeLayout(classroom)');
        expect(source).to.include('references: state.references.map(serializeReference)');
        expect(source).to.include("state: 'unavailable'");
        expect(source).not.to.include('setInterval');
    });
});
