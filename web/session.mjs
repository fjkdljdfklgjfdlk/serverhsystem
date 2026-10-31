const KEY = 'serverh.staff.session.v1';
export function createSessionStore(storage, service, now = Date.now) {
  const clear = () => { try { storage.removeItem(KEY); } catch {} };
  const valid = value => value?.service === service && /^[A-Za-z0-9_-]{43}$/.test(value.token || '') && Number.isSafeInteger(value.expires) && value.expires > now();
  return {
    clear,
    read() {
      try { const value = JSON.parse(storage.getItem(KEY)); if (valid(value)) return value; } catch {}
      clear(); return null;
    },
    save(token, expires) {
      const value = { service, token, expires };
      if (!valid(value)) { clear(); return false; }
      try { storage.setItem(KEY, JSON.stringify(value)); return true; } catch { return false; }
    }
  };
}
