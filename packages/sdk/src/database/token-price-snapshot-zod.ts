import { z } from 'zod';
import { addressZodSchema } from './common-zod';
import { isAddress } from 'viem';

export const tokenPriceSnapshotFieldsZodSchema = z.object({
  _id: z.string().refine(
    (value) => {
      const [blockNumber, tokenAddress] = value.split('/');
      return isAddress(tokenAddress) && !isNaN(Number(blockNumber));
    },
    {
      message: 'INVALID_GNOSIS_PAY_TOKEN_PRICE_SNAPSHOT_ID',
    },
  ),
  price: z.coerce.number().positive(),
  block: z.coerce.number().positive(),
  token: addressZodSchema,
});

export type TokenPriceSnapshotFieldsType = z.infer<typeof tokenPriceSnapshotFieldsZodSchema>;
