import { expect } from 'chai';
import { describe, it } from 'node:test';
import { migrationScripts } from '../src/migration';

describe('krypton-permits migration channel', () => {
    it('preserves the deployed v1 channel without automatic ACL writes', async () => {
        expect(migrationScripts).to.have.lengthOf(1);
        expect(await migrationScripts[0]()).to.equal(undefined);
    });
});
