import { SerializableErc20TokenTypeSchema } from '@kpkpkg/apps-sdk/evm';
import { addressZodSchema } from './common-zod';
import z from 'zod';

export const tokenFieldsZodSchema = z.object({
  ...SerializableErc20TokenTypeSchema.shape,
  _id: addressZodSchema,
  deploymentBlock: z.coerce.number().positive().optional(),
  oracle: addressZodSchema.optional(),
});

export type TokenFieldsType = z.infer<typeof tokenFieldsZodSchema>;
