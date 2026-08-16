import { data } from 'react-router';
import type { Route } from './+types/category';
import { requireApiAuth } from '~/lib/auth.server';
import { isPlaidPrimaryCategory } from '~/lib/plaid/categories';
import { getTransactionStore } from '~/lib/plaid/wiring.server';

export async function action(args: Route.ActionArgs) {
  const { userId } = await requireApiAuth(args);
  const formData = await args.request.formData();
  const transactionId = formData.get('transactionId');
  const submittedPrimary = formData.get('primary');

  if (typeof transactionId !== 'string' || transactionId.length === 0) {
    return data({ error: 'Missing transactionId' }, { status: 400 });
  }
  if (typeof submittedPrimary !== 'string') {
    return data({ error: 'Missing primary category' }, { status: 400 });
  }

  const primary = submittedPrimary === '' ? null : submittedPrimary;
  if (primary !== null && !isPlaidPrimaryCategory(primary)) {
    return data({ error: 'Invalid primary category' }, { status: 400 });
  }

  try {
    await getTransactionStore().setCategoryOverride(
      userId,
      transactionId,
      primary,
    );
    return data({ transactionId, primary });
  } catch (error) {
    return data(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to update Transaction category',
      },
      { status: 500 },
    );
  }
}
