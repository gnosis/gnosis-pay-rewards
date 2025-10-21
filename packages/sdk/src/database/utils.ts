import { GnosisPayTransactionType } from './spendTransaction';

type GnosisPayTransactionLeanFieldsType = {
  type: GnosisPayTransactionType;
  amountUsd: number;
};

export function calculateNetUsdVolume(transactions: GnosisPayTransactionLeanFieldsType[]) {
  return transactions.reduce((acc, transaction) => {
    if (transaction.type === GnosisPayTransactionType.Spend) {
      return acc + transaction.amountUsd;
    } else {
      return acc - transaction.amountUsd;
    }
  }, 0);
}
