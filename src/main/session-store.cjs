const { randomBytes } = require('node:crypto');
const { join } = require('node:path');

function persistenceMode(safeStorage) {
  if (!safeStorage.isEncryptionAvailable()) return 'memory-only';
  try {
    return safeStorage.getSelectedStorageBackend?.() === 'basic_text' ? 'memory-only' : 'secure';
  } catch { return 'memory-only'; }
}

async function saveSession(directory, session, safeStorage, fs) {
  if (persistenceMode(safeStorage) !== 'secure') return false;
  await fs.mkdir(directory, { recursive: true });
  const encrypted = safeStorage.encryptString(JSON.stringify(session));
  const temporary = join(directory, `session-${randomBytes(8).toString('hex')}.tmp`);
  try {
    await fs.writeFile(temporary, encrypted, { mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, join(directory, 'session.enc'));
    return true;
  } finally {
    await fs.unlink(temporary).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

async function loadSession(directory, safeStorage, fs) {
  if (persistenceMode(safeStorage) !== 'secure') return null;
  try {
    const encrypted = await fs.readFile(join(directory, 'session.enc'));
    const data = JSON.parse(safeStorage.decryptString(encrypted));
    if (data.version !== 1 || typeof data.music?.token !== 'string' || !data.music.token) return null;
    // The optional oauth block keeps only a well-formed refresh token; anything else is dropped
    // so callers can trust the shape without a second validation pass.
    const refreshToken = data?.oauth?.refreshToken;
    if (typeof refreshToken === 'string' && refreshToken) data.oauth = { refreshToken };
    else delete data.oauth;
    return data;
  } catch { return null; }
}

async function clearSession(directory, fs) {
  await fs.unlink(join(directory, 'session.enc')).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
}

module.exports = { clearSession, loadSession, persistenceMode, saveSession };
