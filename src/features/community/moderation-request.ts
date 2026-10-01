export function createModerationRequestTracker(makeId: () => string = () => crypto.randomUUID()) {
  let pending: { key: string; id: string } | undefined;
  return {
    idFor(key: string) {
      if (!pending || pending.key !== key) pending = { key, id: makeId() };
      return pending.id;
    },
    clear() { pending = undefined; },
  };
}
