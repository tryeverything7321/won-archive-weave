export async function importWithReload<T>(
  loader: () => Promise<T>,
  routeKey: string,
): Promise<T> {
  const retryKey = `weave:chunk-retry:${routeKey}`;

  try {
    const module = await loader();
    sessionStorage.removeItem(retryKey);
    return module;
  } catch (error) {
    if (!sessionStorage.getItem(retryKey)) {
      sessionStorage.setItem(retryKey, "1");
      window.location.reload();
      return new Promise<T>(() => undefined);
    }

    sessionStorage.removeItem(retryKey);
    throw error;
  }
}
