import { z } from 'zod';
import { addressZodSchema, weekIdZodSchema } from './common-zod';
import { tokenFieldsZodSchema } from './token-zod.js';

// https://niftyfair.io/gnosis/collection/0x88997988a6a5aaf29ba973d298d276fe75fb69ab/
// this is where you can mint the OG NFT

export enum GnosisPayTransactionType {
  Spend = 'Spend',
  Refund = 'Refund',
}

export const gnosisPayTransactionFieldsZodSchema = z.object({
  _id: z.string(),
  type: z.enum([GnosisPayTransactionType.Spend, GnosisPayTransactionType.Refund]),
  block: z.coerce.number().positive(),
  week: weekIdZodSchema,
  transactionHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  safe: addressZodSchema,
  amountRaw: z.string(),
  amount: z.coerce.number().positive(),
  valueUSD: z.coerce.number().positive(),
  token: addressZodSchema.or(tokenFieldsZodSchema),
});

export type GnosisPayTransactionFieldsType = z.infer<typeof gnosisPayTransactionFieldsZodSchema>;
