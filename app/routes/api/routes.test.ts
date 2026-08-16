import { beforeEach, describe, expect, mock, test } from 'bun:test';

const userId = 'user_non_default';
const createLinkToken = mock(async () => 'link-token');
const setCategoryOverride = mock(async () => {});

mock.module('@clerk/react-router/server', () => ({
  getAuth: async () => ({ isAuthenticated: true, userId }),
}));

mock.module('~/lib/plaid/wiring.server', () => ({
  getPlaidService: () => ({ createLinkToken }),
  getTransactionStore: () => ({ setCategoryOverride }),
}));

mock.module('~/lib/convex.server', () => ({
  upsertUser: mock(async () => {}),
}));

beforeEach(() => {
  createLinkToken.mockClear();
  setCategoryOverride.mockClear();
});

describe('POST /api/plaid/link-token', () => {
  test('forwards the authenticated Clerk userId to Plaid', async () => {
    const { action } = await import('./plaid/link-token');
    const request = new Request('http://localhost/api/plaid/link-token', {
      method: 'POST',
      body: new FormData(),
    });

    await action({ request } as Parameters<typeof action>[0]);

    expect(createLinkToken).toHaveBeenCalledWith({
      userId,
      itemId: undefined,
    });
  });
});

function categoryRequest(primary: string) {
  const formData = new FormData();
  formData.set('transactionId', 'tx_1');
  formData.set('primary', primary);
  return new Request('http://localhost/api/transactions/category', {
    method: 'POST',
    body: formData,
  });
}

describe('POST /api/transactions/category', () => {
  test('persists a valid Plaid primary category for the authenticated user', async () => {
    const { action } = await import('./transactions/category');
    await action({
      request: categoryRequest('FOOD_AND_DRINK'),
    } as Parameters<typeof action>[0]);

    expect(setCategoryOverride).toHaveBeenCalledWith(
      userId,
      'tx_1',
      'FOOD_AND_DRINK',
    );
  });

  test('uses an empty primary category to reset the override', async () => {
    const { action } = await import('./transactions/category');
    await action({
      request: categoryRequest(''),
    } as Parameters<typeof action>[0]);

    expect(setCategoryOverride).toHaveBeenCalledWith(userId, 'tx_1', null);
  });

  test('rejects categories outside the Plaid PFC v2 taxonomy', async () => {
    const { action } = await import('./transactions/category');
    const response = await action({
      request: categoryRequest('CUSTOM_CATEGORY'),
    } as Parameters<typeof action>[0]);

    expect(response.init?.status).toBe(400);
    expect(setCategoryOverride).not.toHaveBeenCalled();
  });

  test('returns persistence failures to the client', async () => {
    setCategoryOverride.mockImplementationOnce(async () => {
      throw new Error('Database unavailable');
    });
    const { action } = await import('./transactions/category');
    const response = await action({
      request: categoryRequest('FOOD_AND_DRINK'),
    } as Parameters<typeof action>[0]);

    expect(response.init?.status).toBe(500);
    expect(response.data).toEqual({ error: 'Database unavailable' });
  });
});
