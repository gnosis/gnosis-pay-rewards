import type { Address } from 'viem';
import type { TokenDocumentFieldsType } from './gnosisPayToken';
import type { WeekIdFormatType } from '../week-functions';

// https://niftyfair.io/gnosis/collection/0x88997988a6a5aaf29ba973d298d276fe75fb69ab/
// this is where you can mint the OG NFT

export enum GnosisPayTransactionType {
  Spend = 'Spend',
  Refund = 'Refund',
}

export type GnosisPayTransactionFieldsType<SpentTokenFieldType> = {
  _id: string;
  /**
   * The type of the transaction
   */
  type: GnosisPayTransactionType;
  /**
   * The number of the block
   */
  blockNumber: number;
  /**
   * The week that this transaction belongs to
   */
  weekId: WeekIdFormatType;
  /**
   * The timestamp of the block
   */
  blockTimestamp: number;
  /**
   * The hash of the transaction
   */
  transactionHash: `0x${string}`;
  /**
   * The balance of the GNO in this snapshot
   */
  gnoBalanceRaw: string;
  /**
   * The balance of the GNO in this snapshot
   */
  gnoBalance: number;
  /**
   * The USD price of the GNO token, fetched at the blockNumber
   */
  gnoUsdPrice: number;
  /**
   * The amount of the GNO token that the Safe avatar received
   */
  estiamtedGnoRewardAmount: number;
  /**
   * The original Safe avatar that spend the money
   */
  safeAddress: Address;
  /**
   * The amount of the token that the Safe avatar spent
   */
  amountRaw: string;
  /**
   * Use this as the value to display to the user
   */
  amount: number;
  /**
   * The amount of the token that the Safe avatar spent in USD, this is converted at the exchange rate of the token
   */
  amountUsd: number;
  /**
   * The token that the Safe avatar spent or received
   */
  amountToken: SpentTokenFieldType;
};

export type GnosisPayTransactionFieldsType_Unpopulated = GnosisPayTransactionFieldsType<Address>;
export type GnosisPayTransactionFieldsType_Populated = GnosisPayTransactionFieldsType<TokenDocumentFieldsType>;
