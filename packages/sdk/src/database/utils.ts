import { GnosisPayTransactionFieldsType, GnosisPayTransactionType } from './gnosis-pay-transaction-zod.js';

export function calculateNetVolumeUSD(transactions: Pick<GnosisPayTransactionFieldsType, 'type' | 'valueUSD'>[]) {
  return transactions.reduce((acc, transaction) => {
    if (transaction.type === GnosisPayTransactionType.Spend) {
      return acc + transaction.valueUSD;
    } else {
      return acc - transaction.valueUSD;
    }
  }, 0);
}
