import { expect } from 'chai';
import { describe, it } from 'node:test';
import { sha256Text } from '../src/lib/sha256';

describe('browser-safe source hashing', () => {
  it('matches SHA-256 vectors for ASCII, UTF-8, and empty source', () => {
    expect(sha256Text('')).to.equal('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Text('abc')).to.equal('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Text('程序填空')).to.equal('6923d147c7b8a95ee7933ea243ff7cb4aef2f6d3f4deac296c2729a53e5a3fbe');
  });
});
