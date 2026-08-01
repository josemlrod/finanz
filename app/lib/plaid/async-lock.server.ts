export function createKeyedLock<Key>() {
  const tails = new Map<Key, Promise<void>>();

  return async function withLock<Result>(
    key: Key,
    operation: () => Promise<Result>,
  ): Promise<Result> {
    const previous = tails.get(key) ?? Promise.resolve();
    let release = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    tails.set(key, tail);

    await previous;

    try {
      return await operation();
    } finally {
      release();
      if (tails.get(key) === tail) {
        tails.delete(key);
      }
    }
  };
}
