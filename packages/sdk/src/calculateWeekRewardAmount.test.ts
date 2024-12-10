import { describe, expect, test } from '@jest/globals';

import {
  calculateEligibleUsdVolume,
  calculateWeekRewardAmount,
  CalculateWeekRewardReturnType,
} from './calculateWeekRewardAmount';

describe('calculateEligibleUsdVolume', () => {
  test('custom cases', () => {
    const initial: Parameters<typeof calculateEligibleUsdVolume>[0] = {
      fourWeeksUsdVolumeThreshold: 22_000,
      weekUsdVolume: 8747.802407,
      fourWeeksUsdVolume: 30417.16707,
    };

    const result = calculateEligibleUsdVolume(initial);
    expect(result).toMatchObject({
      eligibleUsdVolume: 330.6353369999997,
    });

    const result2 = calculateEligibleUsdVolume({ ...initial, fourWeeksUsdVolume: 2000 });
    expect(result2).toMatchObject({
      eligibleUsdVolume: initial.weekUsdVolume,
    });
  });

  test('throws error if fourWeeksUsdVolumeThreshold is not greater than 0', () => {
    expect(() =>
      calculateEligibleUsdVolume({ fourWeeksUsdVolumeThreshold: 0, weekUsdVolume: 1000, fourWeeksUsdVolume: 1000 }),
    ).toThrow('fourWeeksUsdVolumeThreshold must be greater than 0');
  });

  test('eligibleUsdVolume is 0 if fourWeeksUsdVolume is greater than threshold', () => {
    const result = calculateEligibleUsdVolume({
      fourWeeksUsdVolumeThreshold: 1_000,
      weekUsdVolume: 1_000,
      fourWeeksUsdVolume: 3_000,
    });
    expect(result).toMatchObject({
      eligibleUsdVolume: 0,
    });
  });

  test('eligibleUsdVolume is weekUsdVolume if fourWeeksUsdVolume is less than threshold', () => {
    const result = calculateEligibleUsdVolume({
      fourWeeksUsdVolumeThreshold: 1000,
      weekUsdVolume: 1000,
      fourWeeksUsdVolume: 900,
    });
    expect(result).toMatchObject({ eligibleUsdVolume: 1000 });
  });

  test('eligibleUsdVolume is 0 if weekUsdVolume is greater than threshold', () => {
    const result = calculateEligibleUsdVolume({
      fourWeeksUsdVolumeThreshold: 1000,
      weekUsdVolume: 1001,
      fourWeeksUsdVolume: 1000,
    });
    expect(result).toMatchObject({ eligibleUsdVolume: 1001 });
  });

  test('eligibleUsdVolume is 1000 if weekUsdVolume and fourWeeksUsdVolume are 1000 each', () => {
    const result = calculateEligibleUsdVolume({
      fourWeeksUsdVolumeThreshold: 1000,
      weekUsdVolume: 1000,
      fourWeeksUsdVolume: 1000,
    });
    expect(result).toMatchObject({ eligibleUsdVolume: 1000 });
  });
});

describe('calculateWeekRewardAmount', () => {
  const fourWeeksUsdVolumeThreshold = 22_000 as const; // using the USDC threshold for tests
  const gnoUsdPrice = 200 as const;

  const cases = [
    { gnoBalance: 100, expectedRewardPercentage: 4 },
    { gnoBalance: 10, expectedRewardPercentage: 3 },
    { gnoBalance: 1, expectedRewardPercentage: 2 },
    { gnoBalance: 0.1, expectedRewardPercentage: 1 },
  ];

  for (const { gnoBalance, expectedRewardPercentage } of cases) {
    const weekUsdVolume = 7_000;
    const fourWeeksUsdVolume = 22_000;

    test(`${gnoBalance} GNO balance: ${expectedRewardPercentage}% for non-OG NFT holders`, () => {
      const result = calculateWeekRewardAmount({
        gnoUsdPrice,
        fourWeeksUsdVolumeThreshold,
        gnoBalance,
        isOgNftHolder: false,
        fourWeeksUsdVolume,
        weekUsdVolume,
      });
      const expected: Partial<CalculateWeekRewardReturnType> = {
        rewardAmountPercentage: expectedRewardPercentage,
        eligibleUsdVolume: weekUsdVolume,
      };
      expect(result).toMatchObject(expected);
    });

    test(`${gnoBalance} GNO balance: ${expectedRewardPercentage}+1% for OG NFT holders `, () => {
      const result = calculateWeekRewardAmount({
        gnoUsdPrice,
        fourWeeksUsdVolumeThreshold,
        gnoBalance,
        isOgNftHolder: true,
        weekUsdVolume,
        fourWeeksUsdVolume,
      });
      const expected: Partial<CalculateWeekRewardReturnType> = {
        rewardAmountPercentage: expectedRewardPercentage + 1,
        eligibleUsdVolume: weekUsdVolume,
      };
      expect(result).toMatchObject(expected);
    });
  }

  {
    const weekUsdVolume = 22_000.1;
    const fourWeeksUsdVolume = weekUsdVolume;
    const testName = `same 1-week and 4-weeks volumes (${weekUsdVolume}) above threshold (${fourWeeksUsdVolumeThreshold}), 100 GNO balance: 0%`;
    test(testName, () => {
      const result = calculateWeekRewardAmount({
        gnoUsdPrice,
        fourWeeksUsdVolumeThreshold,
        gnoBalance: 100,
        isOgNftHolder: false,
        weekUsdVolume,
        fourWeeksUsdVolume,
      });
      expect(result).toMatchObject({
        ...calculateEligibleUsdVolume({
          weekUsdVolume,
          fourWeeksUsdVolume,
          fourWeeksUsdVolumeThreshold,
        }),
        rewardAmountPercentage: 4,
      });
    });
  }

  test('same 1-week and 4-weeks volumes below threshold ($22,000), 10 GNO balance with OG NFT: 3+1%', () => {
    const weekUsdVolume = 1000;
    const { rewardAmountPercentage: actualRewardPercentage } = calculateWeekRewardAmount({
      gnoUsdPrice,
      fourWeeksUsdVolumeThreshold,
      gnoBalance: 10,
      isOgNftHolder: true,
      weekUsdVolume,
      fourWeeksUsdVolume: weekUsdVolume,
    });
    expect(actualRewardPercentage).toBe(4);
  });

  test('1-week volume $1,000, 4-weeks volume $5,100 and 10 GNO balance: 3%', () => {
    const weekUsdVolume = 1000;
    const { rewardAmountPercentage: actualRewardPercentage } = calculateWeekRewardAmount({
      gnoUsdPrice,
      fourWeeksUsdVolumeThreshold,
      gnoBalance: 10,
      isOgNftHolder: false,
      weekUsdVolume,
      fourWeeksUsdVolume: 5100,
    });
    expect(actualRewardPercentage).toBe(3);
  });

  test('1-week volume ($32,000), 4-weeks volume ($32,000) and 10 GNO balance: 3%', () => {
    const weekUsdVolume = 32_000;
    const result = calculateWeekRewardAmount({
      gnoUsdPrice,
      fourWeeksUsdVolumeThreshold,
      gnoBalance: 10,
      isOgNftHolder: false,
      weekUsdVolume,
      fourWeeksUsdVolume: weekUsdVolume,
    });
    expect(result).toMatchObject({
      rewardAmountPercentage: 3,
      eligibleUsdVolume: 22_000, // they already maxed out, hence the eligibleUsdVolume is the threshold
    });
  });

  test('gnoUsdPrice <= 0: throws error', () => {
    expect(() =>
      calculateWeekRewardAmount({
        fourWeeksUsdVolumeThreshold,
        gnoUsdPrice: 0,
        gnoBalance: 100,
        isOgNftHolder: false,
        weekUsdVolume: 1000,
        fourWeeksUsdVolume: 1000,
      }),
    ).toThrow('gnoUsdPrice must be greater than 0');
  });

  test('fourWeeksUsdVolumeThreshold <= 0: throws error', () => {
    expect(() =>
      calculateWeekRewardAmount({
        fourWeeksUsdVolumeThreshold: 0,
        gnoUsdPrice,
        gnoBalance: 100,
        isOgNftHolder: false,
        weekUsdVolume: 1000,
        fourWeeksUsdVolume: 1000,
      }),
    ).toThrow('fourWeeksUsdVolumeThreshold must be greater than 0');
  });

  describe('higher spenders', () => {
    const testName = 'weekUsdVolume (21.9k), 4-weeks volume (27k), threshold (22k): 4%';
    test(testName, () => {
      const weekUsdVolume = 21_900;
      const fourWeeksUsdVolume = 27_000;
      const result = calculateWeekRewardAmount({
        gnoUsdPrice,
        gnoBalance: 10,
        isOgNftHolder: true,
        weekUsdVolume,
        fourWeeksUsdVolume,
        fourWeeksUsdVolumeThreshold,
      });
      const expected: Partial<CalculateWeekRewardReturnType> = {
        rewardAmountPercentage: 4,
        ...calculateEligibleUsdVolume({
          weekUsdVolume,
          fourWeeksUsdVolume,
          fourWeeksUsdVolumeThreshold,
        }),
      };

      console.log(testName, result);
      expect(result).toMatchObject(expected);
    });
  });
});
