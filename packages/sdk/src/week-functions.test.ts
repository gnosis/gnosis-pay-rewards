import dayjs from 'dayjs';
import utcPlugin from 'dayjs/plugin/utc.js';
import { describe, expect, test } from '@jest/globals';
import { findWeekId, getCurrentWeekId, isValidWeekId, toWeekId } from './week-functions';

dayjs.extend(utcPlugin);

describe('week functions', () => {
  describe('toWeekId', () => {
    test('should return the correct week id', () => {
      const week_2024_11_24_timestamp = 1732406400;
      const actual_week_id = toWeekId(week_2024_11_24_timestamp);
      expect(actual_week_id).toBe('2024-11-24');
    });

    test('should return the correct week id for a timestamp in the past', () => {
      expect(toWeekId(1717152000, 1)).toBe('2024-05-19');
    });
  });

  describe('getCurrentWeekId', () => {
    const now = dayjs().utc();
    const expectedWeekId = now.startOf('week').format('YYYY-MM-DD');
    test(`should return the correct week id (${expectedWeekId})`, () => {
      const actualWeekId = getCurrentWeekId();
      expect(actualWeekId).toBe(expectedWeekId);
    });
  });

  describe('findWeekId', () => {
    test('should find valid week ID among random strings', () => {
      const validWeekId = '2024-11-24';

      const randomStrings = ['aaaaa-2024-11-24', '2024-11-24', '2024-11-24', '2024-11-24', '2024-11-24 -4t543'];

      for (const randomString of randomStrings) {
        expect(findWeekId(randomString)).toBe(validWeekId);
      }
    });
  });

  describe('isValidWeekId', () => {
    test('should return true for a valid week ID', () => {
      expect(isValidWeekId('2024-11-24')).toBe(true);
    });

    test('should return false for an invalid week ID', () => {
      expect(isValidWeekId('2024-11-23')).toBe(false);
    });
  });
});
