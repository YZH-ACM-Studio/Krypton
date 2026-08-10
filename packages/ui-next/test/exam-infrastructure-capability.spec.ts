import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { resolveExamInfrastructureCapability } from '../exam-infrastructure-capabilities.ts';

const EDIT_SYSTEM = 1;
const CREATE_EVENT = 2n;
const MANAGE_INFRASTRUCTURE = 4n;

function resolve(user: unknown, observed: unknown[] = []) {
  return resolveExamInfrastructureCapability({
    user: user as never,
    editSystemPriv: EDIT_SYSTEM,
    createExamEventPerm: CREATE_EVENT,
    manageExamInfrastructurePerm: MANAGE_INFRASTRUCTURE,
    onError: (error) => observed.push(error),
  });
}

describe('exam infrastructure bootstrap capability', () => {
  it('allows infrastructure administrators and school-scoped event creators', () => {
    expect(resolve({ hasPriv: () => true, hasPerm: () => false })).to.equal(true);
    expect(resolve({ hasPriv: () => false, hasPerm: (permission: bigint) => permission === MANAGE_INFRASTRUCTURE })).to.equal(true);
    expect(resolve({ hasPriv: () => false, hasPerm: (permission: bigint) => permission === CREATE_EVENT })).to.equal(true);
    expect(resolve({ hasPriv: () => false, hasPerm: () => false })).to.equal(false);
  });

  it('fails closed and reports malformed permission objects', () => {
    const observed: unknown[] = [];
    expect(resolve({}, observed)).to.equal(false);
    expect(observed[0]).to.be.instanceOf(TypeError);
    const failure = new Error('permission backend unavailable');
    expect(
      resolve(
        {
          hasPriv: () => {
            throw failure;
          },
          hasPerm: () => true,
        },
        observed,
      ),
    ).to.equal(false);
    expect(observed[1]).to.equal(failure);
  });

  it('is computed by the server bootstrap and remains only an affordance', () => {
    const root = resolvePath(import.meta.dirname, '../../..');
    const bootstrap = readFileSync(resolvePath(root, 'packages/ui-next/index.ts'), 'utf8');
    const types = readFileSync(resolvePath(root, 'packages/ui-next/src/lib/bootstrap.tsx'), 'utf8');
    expect(bootstrap).to.include('resolveExamInfrastructureCapability');
    expect(bootstrap).to.include('createExamEventPerm: PERM.PERM_CREATE_EXAM_EVENT');
    expect(bootstrap).to.include('manageExamInfrastructurePerm: PERM.PERM_MANAGE_EXAM_INFRASTRUCTURE');
    expect(bootstrap).to.include('canManageExamInfrastructure,');
    expect(types).to.include('canManageExamInfrastructure?: boolean');
  });
});
