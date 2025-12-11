import { describe, expect, test } from '@jest/globals';

import {
  calculateEligibleUsdVolumeByGnoBalance,
  calculateWeekRewardAmount,
  CalculateWeekRewardReturnType,
  getMaxWeeklySpending,
} from '../calculateWeekRewardAmount';
// currency threshold imports removed as they are no longer used

describe('calculateEligibleUsdVolume', () => {
  test('caps eligible volume by tier-based weekly limit', () => {
    const result = calculateEligibleUsdVolumeByGnoBalance({
      weekUsdVolume: 1000,
      gnoBalance: 0.1,
    });
    expect(result).toMatchObject({
      eligibleUsdVolume: 250,
      remainderVolumeToThreshold: 0,
    });
  });

  test('under cap returns full week volume with positive remainder', () => {
    const result = calculateEligibleUsdVolumeByGnoBalance({
      weekUsdVolume: 200,
      gnoBalance: 0.1,
    });
    expect(result).toMatchObject({
      eligibleUsdVolume: 200,
      remainderVolumeToThreshold: 50,
    });
  });
});

describe('calculateWeekRewardAmount', () => {
  const gnoUsdPrice = 200 as const;

  const cases = [
    { gnoBalance: 200, expectedRewardPercentage: 4 },
    { gnoBalance: 100, expectedRewardPercentage: 4 },
    { gnoBalance: 10, expectedRewardPercentage: 3 },
    { gnoBalance: 1, expectedRewardPercentage: 2 },
    { gnoBalance: 0.1, expectedRewardPercentage: 1 },
  ];

  for (const { gnoBalance, expectedRewardPercentage } of cases) {
    const weekUsdVolume = 7_000;

    test(`${gnoBalance} GNO balance: ${expectedRewardPercentage}% for non-OG NFT holders`, () => {
      const result = calculateWeekRewardAmount({
        gnoUsdPrice,
        gnoBalance,
        isOgNftHolder: false,
        weekUsdVolume,
      });
      const expected: Partial<CalculateWeekRewardReturnType> = {
        rewardAmountPercentage: expectedRewardPercentage,
        eligibleUsdVolume: Math.min(weekUsdVolume, getMaxWeeklySpending(gnoBalance)),
      };
      expect(result).toMatchObject(expected);
    });

    test(`${gnoBalance} GNO balance: ${expectedRewardPercentage}+1% for OG NFT holders `, () => {
      const result = calculateWeekRewardAmount({
        gnoUsdPrice,
        gnoBalance,
        isOgNftHolder: true,
        weekUsdVolume,
      });
      const expected: Partial<CalculateWeekRewardReturnType> = {
        rewardAmountPercentage: expectedRewardPercentage + 1,
        eligibleUsdVolume: Math.min(weekUsdVolume, getMaxWeeklySpending(gnoBalance)),
      };
      expect(result).toMatchObject(expected);
    });
  }

  test('1-week volume ($32,000) and 10 GNO balance: eligible capped by tier', () => {
    const weekUsdVolume = 32_000;
    const result = calculateWeekRewardAmount({
      gnoUsdPrice,
      gnoBalance: 10,
      isOgNftHolder: false,
      weekUsdVolume,
    });
    expect(result).toMatchObject({
      rewardAmountPercentage: 3,
      eligibleUsdVolume: 500,
    });
  });

  test('gnoUsdPrice <= 0: throws error', () => {
    expect(() =>
      calculateWeekRewardAmount({
        gnoUsdPrice: 0,
        gnoBalance: 100,
        isOgNftHolder: false,
        weekUsdVolume: 1000,
      }),
    ).toThrow('gnoUsdPrice must be greater than 0');
  });

  describe('higher spenders', () => {
    const testName = 'weekUsdVolume (21.9k); gnoBalance (10); OG holder + tier cap produces 4%';
    test(testName, () => {
      const weekUsdVolume = 21_900;
      const result = calculateWeekRewardAmount({
        gnoUsdPrice,
        gnoBalance: 10,
        isOgNftHolder: true,
        weekUsdVolume,
      });
      const expected: Partial<CalculateWeekRewardReturnType> = {
        rewardAmountPercentage: 4,
        ...calculateEligibleUsdVolumeByGnoBalance({
          weekUsdVolume,
          gnoBalance: 10,
        }),
      };

      console.log(testName, result);
      expect(result).toMatchObject(expected);
    });
  });

  test('above weekly threshold is capped', () => {
    const actual = calculateWeekRewardAmount({
      gnoUsdPrice: 100,
      weekUsdVolume: 8000,
      gnoBalance: 1,
      isOgNftHolder: false,
    });

    const expected: Partial<CalculateWeekRewardReturnType> = {
      rewardAmountPercentage: 2,
      eligibleUsdVolume: 375,
      remainderVolumeToThreshold: 0,
      rewardAmountUsd: 7.5,
      rewardAmountGno: 0.075, // 0.075 GNO * $100/GNO = $7.5
    };

    expect(actual).toMatchObject(expected);
  });
});

// Removed currency thresholds tests as four-week thresholds are no longer used in reward logic

describe('getMaxWeeklySpending', () => {
  test('returns correct spending limits with linear interpolation', () => {
    // Tier boundaries (exact values)
    expect(getMaxWeeklySpending(100)).toBe(1_250); // Tier 4 boundary
    expect(getMaxWeeklySpending(10)).toBe(500); // Tier 3 boundary
    expect(getMaxWeeklySpending(1)).toBe(375); // Tier 2 boundary
    expect(getMaxWeeklySpending(0.1)).toBe(250); // Tier 1 boundary
    expect(getMaxWeeklySpending(0.05)).toBe(0); // Not eligible

    // Mid-tier values (linear interpolation)
    // Tier 3: 50 GNO (midpoint between 10 and 100)
    // 500 + ((50 - 10) / 90) * (1_250 - 500) = 500 + (40/90) * 750 = 500 + 333.33... = 833.33...
    expect(getMaxWeeklySpending(50)).toBeCloseTo(833.33, 1);

    // Tier 2: 5 GNO (midpoint between 1 and 10)
    // 375 + ((5 - 1) / 9) * (500 - 375) = 375 + (4/9) * 125 = 375 + 55.56... = 430.56...
    expect(getMaxWeeklySpending(5)).toBeCloseTo(430.56, 1);

    // Tier 1: 0.5 GNO (midpoint between 0.1 and 1)
    // 250 + ((0.5 - 0.1) / 0.9) * (375 - 250) = 250 + (0.4/0.9) * 125 = 250 + 55.56... = 305.56...
    expect(getMaxWeeklySpending(0.5)).toBeCloseTo(305.56, 1);
  });
});

describe('calculateEligibleUsdVolume with GNO balance tiers', () => {
  test('applies tier-based weekly spending limits', () => {
    const result = calculateEligibleUsdVolumeByGnoBalance({
      weekUsdVolume: 1000,
      gnoBalance: 0.1,
    });

    expect(result.eligibleUsdVolume).toBe(250); // Limited by tier-based limit
  });

  test('GNO balance tier limit is applied when gnoBalance is provided', () => {
    const result = calculateEligibleUsdVolumeByGnoBalance({
      weekUsdVolume: 1000,
      gnoBalance: 0.1,
    });

    expect(result.eligibleUsdVolume).toBe(250); // Limited by tier-based limit
  });
});
