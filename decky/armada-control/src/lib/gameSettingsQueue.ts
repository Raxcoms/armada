let pending = Promise.resolve();

export function runGameSettingsMutation<T>(mutate: () => Promise<T>): Promise<T> {
  const result = pending.then(mutate);
  pending = result.then(() => undefined, () => undefined);
  return result;
}
