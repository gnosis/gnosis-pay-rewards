import { z } from 'zod';
import { isAddress, isHash } from 'viem';
import { addressZodSchema, weekIdZodSchema } from './common-zod';

export const rewardTransactionFieldsZodSchema = z.object({
  _id: z.string().refine(
    (value) => {
      const [transactionHash, address, transactionLogIndex] = value.split('/');
      return (
        isHash(transactionHash) &&
        isAddress(address) &&
        (transactionLogIndex === undefined || !isNaN(Number(transactionLogIndex)))
      );
    },
    {
      message: 'INVALID_REWARD_TRANSACTION_ID',
    },
  ),
  transactionHash: z.string().describe('The transaction hash of the reward transaction.'),
  block: z.number().positive().describe('The block number of the reward transaction.'),
  amount: z.number().positive().describe('The amount of the reward transaction.'),
  valueUSD: z.number().positive().describe('The USD value of the reward transaction.'),
  valueEUR: z.number().positive().describe('The EUR value of the reward transaction.'),
  valueGBP: z.number().positive().describe('The GBP value of the reward transaction.'),
  from: addressZodSchema.describe('The Safe that distributed the reward.'),
  recipient: addressZodSchema.describe('The address that received the cashback.'),
  token: addressZodSchema.describe('The token address of the reward transaction.'),
  week: weekIdZodSchema
    .nullable()
    .describe(
      'The week that the cashback transaction belongs to. This value is null for reward transactions that are yet obe tagged.',
    ),
});

export type RewardTransactionFieldsType = z.infer<typeof rewardTransactionFieldsZodSchema>;
