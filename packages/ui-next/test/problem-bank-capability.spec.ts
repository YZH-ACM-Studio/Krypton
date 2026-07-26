import { beforeEach, describe, expect, it, vi } from 'vitest';

let resolution: (user: any) => boolean = () => false;
const ProblemModel = {
  canBrowseProblemBank(user: any) {
    return resolution(user);
  },
};

vi.mock('hydrooj', () => ({
  Context: class {},
  PERM: {},
  PRIV: {},
  ProblemModel,
}));
vi.mock('@hydrooj/framework', () => ({ serializer: () => undefined }));
vi.mock('koa2-connect', () => ({ default: () => undefined }));
vi.mock('../rankboard-capabilities', () => ({
  resolveRankboardCapabilities: () => ({
    canImportRankboard: false,
    canManageRankboard: false,
  }),
}));

// A non-literal specifier keeps tsc from chasing index.ts into the backend
// 'hydrooj' sources (they are typechecked by the root tsconfig.check.json
// project, not this one); vitest still resolves it at runtime.
const indexModuleId = '../index.ts';
const { resolveProblemBankCapability } = (await import(/* @vite-ignore */ indexModuleId)) as {
  resolveProblemBankCapability: (user: unknown, report: (error: unknown) => void) => boolean;
};

beforeEach(() => {
  resolution = () => false;
});

describe('ui-next problem-bank bootstrap capability', () => {
  it('publishes the canonical server result without client-side permission reconstruction', () => {
    const user = { _id: 42 };
    const observed: unknown[] = [];
    resolution = (candidate) => candidate === user;

    expect(resolveProblemBankCapability(user, (error) => observed.push(error))).to.equal(true);
    expect(observed).to.deep.equal([]);
  });

  it('fails closed and reports the original capability-resolution error', () => {
    const failure = new Error('ACL preload failed');
    const observed: unknown[] = [];
    resolution = () => {
      throw failure;
    };

    expect(resolveProblemBankCapability({ _id: 42 }, (error) => observed.push(error))).to.equal(false);
    expect(observed).to.deep.equal([failure]);
  });

  it('fails closed and reports when handler user context is missing', () => {
    const observed: unknown[] = [];

    expect(resolveProblemBankCapability(undefined, (error) => observed.push(error))).to.equal(false);
    expect(observed).to.have.length(1);
    expect((observed[0] as Error).message).to.equal('handler user is unavailable');
  });
});
