import { expect } from 'chai';
import { describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import { param, Types, ValidationError } from '@hydrooj/framework';

/** The `@param` decorator rewrites the method to accept the raw args object. */
function invokeDecoratedPost(handler: { post: unknown }, args: Record<string, unknown>): Promise<unknown> {
    const post = handler.post as (payload: Record<string, unknown>) => Promise<unknown>;
    return post.call(handler, args);
}

describe('course assign HTTP dispatch', () => {
    const assignArgs = {
        domainId: 'system',
        tid: new ObjectId().toHexString(),
        operation: 'assign',
        expectedOwner: '7',
        owner: '42',
    };

    it('rejects assign-shaped POSTs when title is still a required post field', async () => {
        class RequiredTitlePost {
            @param('tid', Types.ObjectId, true)
            @param('title', Types.Title)
            @param('content', Types.Content)
            @param('chapters', Types.Content)
            async post(_domainId: string, _tid: ObjectId, title: string) {
                return title;
            }
        }
        const handler = new RequiredTitlePost();
        try {
            await invokeDecoratedPost(handler, assignArgs);
            throw new Error('expected ValidationError');
        } catch (error) {
            expect(error).to.be.instanceOf(ValidationError);
            expect((error as InstanceType<typeof ValidationError>).params[0]).to.equal('title');
        }
    });

    it('accepts assign-shaped POSTs when save fields are optional and post returns on operation', async () => {
        class OptionalTitlePost {
            args = assignArgs;
            request = { body: assignArgs };

            @param('tid', Types.ObjectId, true)
            @param('title', Types.Title, true)
            @param('content', Types.Content, true)
            @param('chapters', Types.Content, true)
            async post(_domainId: string, _tid: ObjectId, title?: string, content?: string, chapters?: string) {
                if (this.args?.operation || this.request.body?.operation) return 'skipped';
                if (title === undefined) throw new ValidationError('title');
                if (content === undefined) throw new ValidationError('content');
                if (chapters === undefined) throw new ValidationError('chapters');
                return title;
            }
        }
        const handler = new OptionalTitlePost();
        expect(await invokeDecoratedPost(handler, assignArgs)).to.equal('skipped');
    });
});
