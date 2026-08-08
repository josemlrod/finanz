export function requireInternalSecret(secret: string | undefined): void {
  const expected = process.env.CONVEX_INTERNAL_SECRET;
  if (!expected || !secret || secret !== expected) {
    throw new Error("Unauthorized: invalid internal secret");
  }
}
