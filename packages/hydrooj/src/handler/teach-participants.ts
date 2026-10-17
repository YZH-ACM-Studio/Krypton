import { ObjectId } from 'mongodb';
import { loadTeachParticipants } from '../lib/teach-participants';
import { Handler, param, Types } from '../service/server';

class TeachParticipantsHandler extends Handler {
    @param('type', Types.String)
    @param('id', Types.ObjectId)
    async get(_domainId: string, type: string, id: ObjectId) {
        const domainId = String(this.domain?._id);
        this.response.template = null;
        this.response.body = await loadTeachParticipants(domainId, this.user, type, id);
    }
}

export async function apply(ctx) {
    ctx.Route('teach_participants', '/teach/:type/:id/participants', TeachParticipantsHandler);
}
