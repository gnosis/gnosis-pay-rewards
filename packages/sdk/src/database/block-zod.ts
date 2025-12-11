import { z } from 'zod';

import { weekIdZodSchema } from './common-zod.js';

export const blockDocumentZodSchema = z.object({
  _id: z.coerce.number().positive(),
  number: z.coerce.number().positive(),
  hash: z.string(),
  timestamp: z.coerce.number(),
  week: weekIdZodSchema,
});

export type BlockDocumentFieldsType = z.infer<typeof blockDocumentZodSchema>;
