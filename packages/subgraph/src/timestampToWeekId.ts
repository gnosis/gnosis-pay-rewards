/* eslint-disable @typescript-eslint/ban-types */
import { BigInt } from '@graphprotocol/graph-ts';

const SECONDS_IN_A_DAY = BigInt.fromI32(86400);
const DAYS_IN_A_WEEK = BigInt.fromI32(7);

const ONE = BigInt.fromI32(1);
const FOUR = BigInt.fromI32(4);
const SIX = BigInt.fromI32(6);
const HUNDRED = BigInt.fromI32(100);
const FOUR_HUNDRED = BigInt.fromI32(400);

// Days in each month (January to December)
const DAYS_IN_MONTH = [
  BigInt.fromI32(31),
  BigInt.fromI32(28),
  BigInt.fromI32(31),
  BigInt.fromI32(30),
  BigInt.fromI32(31),
  BigInt.fromI32(30),
  BigInt.fromI32(31),
  BigInt.fromI32(31),
  BigInt.fromI32(30),
  BigInt.fromI32(31),
  BigInt.fromI32(30),
  BigInt.fromI32(31),
];

/**
 * Converts a timestamp to a week ID in the format of YYYY-MM-DD where MM is the Sunday of the week.
 * @param timestamp - The timestamp to convert.
 * @returns The week ID in the format of YYYY-MM-DD.
 */
export function timestampToWeekId(timestamp: BigInt): string {
  // Calculate the number of days since the Unix epoch (January 1, 1970)
  let daysSinceEpoch = mathFloor(timestamp.div(SECONDS_IN_A_DAY));

  // Determine the day of the week (0 is Thursday, 6 is Wednesday)
  const dayOfWeek = daysSinceEpoch.plus(FOUR).mod(DAYS_IN_A_WEEK);

  // Calculate the number of days to subtract to reach the previous Sunday
  const daysToSunday = dayOfWeek;

  // Calculate the total days to reach the previous Sunday
  daysSinceEpoch = daysSinceEpoch.minus(daysToSunday);

  // List of days in each month
  const daysInMonth = DAYS_IN_MONTH;

  // Calculate the year, month, and day from the total days
  let year = BigInt.fromI32(1970);
  while (true) {
    // Check if the year is a leap year
    const daysInYear = isLeapYear(year) ? BigInt.fromI32(366) : BigInt.fromI32(365);

    if (daysSinceEpoch.lt(daysInYear)) {
      break;
    }

    daysSinceEpoch = daysSinceEpoch.minus(daysInYear);
    year = year.plus(ONE);
  }

  // Adjust February for leap years
  if (isLeapYear(year)) {
    daysInMonth[1] = BigInt.fromI32(29);
  }

  let month = 1;
  while (daysSinceEpoch.ge(daysInMonth[month - 1])) {
    daysSinceEpoch = daysSinceEpoch.minus(daysInMonth[month - 1]);
    month++;
  }

  const day = daysSinceEpoch.plus(BigInt.fromI32(1));

  // Format as YYYY-MM-DD
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function mathFloor(value: BigInt): BigInt {
  return value.div(BigInt.fromI32(1));
}

function isLeapYear(year: BigInt): boolean {
  return year.mod(FOUR).isZero() &&
         (!year.mod(HUNDRED).isZero() || year.mod(FOUR_HUNDRED).isZero());
}
