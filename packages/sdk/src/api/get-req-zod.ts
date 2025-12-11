import { z } from 'zod';
import dayjsUtc from 'dayjs';
import dayjsUtcPlugin from 'dayjs/plugin/utc.js';
import { addressZodSchema, weekIdZodSchema } from '../database/common-zod.js';
import { toWeekId } from '../week-functions.js';
dayjsUtc.extend(dayjsUtcPlugin);

const weekIdZodSchemaWithDefault = z.preprocess(
  (val) => {
    return val === '' || val === null ? undefined : val;
  },
  weekIdZodSchema.optional().default(toWeekId(dayjsUtc().unix())),
);

export { addressZodSchema, weekIdZodSchema, weekIdZodSchemaWithDefault };
