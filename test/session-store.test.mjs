import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { clearSession, loadSession, persistenceMode, saveSession } = require('../src/main/session-store.cjs');

const fs = await import('node:fs/promises');

test('production session store encrypts a minimal payload and restores it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'music-production-session-'));
  const key = Buffer.from('test-only-encryption-key');
  const safeStorage = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: value => Buffer.concat([Buffer.from('cipher:'), Buffer.from(value).map((byte, index) => byte ^ key[index % key.length])]),
    decryptString: value => Buffer.from(value.subarray(7).map((byte, index) => byte ^ key[index % key.length])).toString(),
  };
  try {
    const candidate = { version: 1, music: { token: 'TEST-ONLY', snsUserID: 'TEST-USER' } };
    assert.equal(persistenceMode(safeStorage), 'secure');
    assert.equal(await saveSession(directory, candidate, safeStorage, fs), true);
    const [stored, metadata, files] = await Promise.all([
      readFile(join(directory, 'session.enc')),
      stat(join(directory, 'session.enc')),
      readdir(directory),
    ]);
    assert.equal(stored.includes(Buffer.from('TEST-ONLY')), false);
    assert.deepEqual(files, ['session.enc']);
    if (process.platform !== 'win32') assert.equal(metadata.mode & 0o777, 0o600);
    assert.deepEqual(await loadSession(directory, safeStorage, fs), candidate);
    await clearSession(directory, fs);
    assert.deepEqual(await readdir(directory), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('oauth refresh token round-trips and is normalized to the trusted shape', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'music-session-oauth-'));
  const key = Buffer.from('test-only-encryption-key');
  const safeStorage = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: value => Buffer.concat([Buffer.from('cipher:'), Buffer.from(value).map((byte, index) => byte ^ key[index % key.length])]),
    decryptString: value => Buffer.from(value.subarray(7).map((byte, index) => byte ^ key[index % key.length])).toString(),
  };
  try {
    const stored = { version: 1, music: { token: 'TEST-ONLY' }, oauth: { refreshToken: 'TEST-RT', junk: 'drop-me' } };
    await saveSession(directory, stored, safeStorage, fs);
    assert.deepEqual(await loadSession(directory, safeStorage, fs),
      { version: 1, music: { token: 'TEST-ONLY' }, oauth: { refreshToken: 'TEST-RT' } });
    for (const oauth of ['x', {}, { refreshToken: 5 }, { refreshToken: '' }]) {
      await saveSession(directory, { version: 1, music: { token: 'TEST-ONLY' }, oauth }, safeStorage, fs);
      assert.deepEqual(await loadSession(directory, safeStorage, fs), { version: 1, music: { token: 'TEST-ONLY' } });
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('unavailable or basic_text safe storage never writes a session file', async () => {
  for (const safeStorage of [
    { isEncryptionAvailable: () => false },
    { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'basic_text' },
  ]) {
    const directory = await mkdtemp(join(tmpdir(), 'music-session-memory-only-'));
    try {
      assert.equal(persistenceMode(safeStorage), 'memory-only');
      assert.equal(await saveSession(directory, { version: 1, music: { token: 'TEST-ONLY' } }, safeStorage, fs), false);
      assert.deepEqual(await readdir(directory), []);
      assert.equal(await loadSession(directory, safeStorage, fs), null);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});
