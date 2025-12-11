import { isAddress } from 'viem';
import { z } from 'zod';
import { addressZodSchema, weekIdZodSchema } from './common-zod.js';

export const tokenBalanceSnapshotFieldsZodSchema = z.object({
  _id: z.string().refine((value) => {
    const [blockNumber, safeAddress, tokenAddress] = value.split('/');
    return isAddress(safeAddress) && isAddress(tokenAddress) && !isNaN(Number(blockNumber));
  }),
  week: weekIdZodSchema,
  address: addressZodSchema,
  balanceRaw: z.string(),
  balance: z.number(),
  block: z.number(),
  token: z.string(),
  transactionHash: z.string().optional().nullable(),
});

export type TokenBalanceSnapshotFieldsType = z.infer<typeof tokenBalanceSnapshotFieldsZodSchema>;
