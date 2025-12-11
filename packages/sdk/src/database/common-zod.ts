import { z } from 'zod';
import { Address, isAddress } from 'viem';
import { isValidWeekId } from '../week-functions.js';

import dayjs from 'dayjs';
import dayjsUtcPlugin from 'dayjs/plugin/utc.js';

dayjs.extend(dayjsUtcPlugin);

const addressZodSchema = z
  .string()
  .refine(isAddress, {
    message: 'Invalid EVM address',
  })
  .transform((value) => value.toLowerCase() as Address);

const weekIdZodSchema = z
  .string()
  .refine((value: string) => isValidWeekId(value), {
    message: 'Invalid week date format',
  })
  .refine(
    (value: string) => {
      const isSunday = dayjs(value).day() === 0;
      return isSunday;
    },
    {
      message: 'Week date must be a Sunday',
    },
  );

export { addressZodSchema, weekIdZodSchema };
