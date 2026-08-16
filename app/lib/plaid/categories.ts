export const PLAID_PRIMARY_CATEGORIES = [
  'INCOME',
  'LOAN_DISBURSEMENTS',
  'LOAN_PAYMENTS',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'BANK_FEES',
  'ENTERTAINMENT',
  'FOOD_AND_DRINK',
  'GENERAL_MERCHANDISE',
  'HOME_IMPROVEMENT',
  'MEDICAL',
  'PERSONAL_CARE',
  'GENERAL_SERVICES',
  'GOVERNMENT_AND_NON_PROFIT',
  'TRANSPORTATION',
  'TRAVEL',
  'RENT_AND_UTILITIES',
  'OTHER',
] as const;

export type PlaidPrimaryCategory = (typeof PLAID_PRIMARY_CATEGORIES)[number];

export function isPlaidPrimaryCategory(
  value: string,
): value is PlaidPrimaryCategory {
  return PLAID_PRIMARY_CATEGORIES.includes(value as PlaidPrimaryCategory);
}
