import { describe, expect, test } from '@jest/globals';

import { calculateWeekRewardAmount } from './calculateWeekRewardAmount';

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
    const fourWeeksUsdVolume = 23_000;

    test(`${gnoBalance} GNO balance: ${expectedRewardPercentage}% for non-OG NFT holders`, () => {
      const rewardAmount = calculateWeekRewardAmount({
        gnoUsdPrice,
        fourWeeksUsdVolumeThreshold,
        gnoBalance,
        isOgNftHolder: false,
        fourWeeksUsdVolume,
        weekUsdVolume,
      });
      const actualRewardPercentage = (rewardAmount * 100 * gnoUsdPrice) / weekUsdVolume;
      expect(actualRewardPercentage).toBe(expectedRewardPercentage);
    });

    test(`${gnoBalance} GNO balance: ${expectedRewardPercentage}+1% for OG NFT holders `, () => {
      const rewardAmount = calculateWeekRewardAmount({
        gnoUsdPrice,
        fourWeeksUsdVolumeThreshold,
        gnoBalance,
        isOgNftHolder: true,
        weekUsdVolume,
        fourWeeksUsdVolume,
      });
      const actualRewardPercentage = (rewardAmount * 100 * gnoUsdPrice) / weekUsdVolume;
      console.log(actualRewardPercentage);
      expect(actualRewardPercentage).toBe(expectedRewardPercentage + 1);
    });
  }

  test('1-week volume above 4-weeks threshold ($22,000): 0%', () => {
    const rewardAmount = calculateWeekRewardAmount({
      gnoUsdPrice,
      fourWeeksUsdVolumeThreshold,
      gnoBalance: 100,
      isOgNftHolder: false,
      weekUsdVolume: 22_000.1,
      fourWeeksUsdVolume: 22_000,
    });
    expect(rewardAmount).toBe(0);
  });

  test('same 1-week and 4-weeks volumes ($22,000.1) above threshold ($22,000), 100 GNO balance: 0%', () => {
    const rewardAmount = calculateWeekRewardAmount({
      gnoUsdPrice,
      fourWeeksUsdVolumeThreshold,
      gnoBalance: 100,
      isOgNftHolder: false,
      weekUsdVolume: 22_000.1,
      fourWeeksUsdVolume: 22_000.1,
    });
    expect(rewardAmount).toBe(0);
  });

  test('same 1-week and 4-weeks volumes below threshold ($22,000), 10 GNO balance with OG NFT: 3+1%', () => {
    const weekUsdVolume = 1000;
    const rewardAmount = calculateWeekRewardAmount({
      gnoUsdPrice,
      fourWeeksUsdVolumeThreshold,
      gnoBalance: 10,
      isOgNftHolder: true,
      weekUsdVolume,
      fourWeeksUsdVolume: weekUsdVolume,
    });
    const actualRewardPercentage = (rewardAmount * 100 * gnoUsdPrice) / weekUsdVolume;
    expect(actualRewardPercentage).toBe(4);
  });

  test('1-week volume $1,000, 4-weeks volume $5,100 and 10 GNO balance: 3%', () => {
    const weekUsdVolume = 1000;
    const rewardAmount = calculateWeekRewardAmount({
      gnoUsdPrice,
      fourWeeksUsdVolumeThreshold,
      gnoBalance: 10,
      isOgNftHolder: false,
      weekUsdVolume,
      fourWeeksUsdVolume: 5100,
    });
    const actualRewardPercentage = (rewardAmount * 100 * gnoUsdPrice) / weekUsdVolume;
    expect(actualRewardPercentage).toBe(3);
  });

  test('1-week volume ($32,000), 4-weeks volume ($32,000) and 10 GNO balance: 0%', () => {
    const weekUsdVolume = 32_000;
    const rewardAmount = calculateWeekRewardAmount({
      gnoUsdPrice,
      fourWeeksUsdVolumeThreshold,
      gnoBalance: 10,
      isOgNftHolder: false,
      weekUsdVolume,
      fourWeeksUsdVolume: weekUsdVolume,
    });
    expect(rewardAmount).toBe(0);
  });

  test('1-week volume ($32,000), 4-weeks volume ($31,000) and 10 GNO balance: 0%', () => {
    const weekUsdVolume = 32_000;
    const rewardAmount = calculateWeekRewardAmount({
      gnoUsdPrice,
      fourWeeksUsdVolumeThreshold,
      gnoBalance: 10,
      isOgNftHolder: false,
      weekUsdVolume,
      fourWeeksUsdVolume: weekUsdVolume - 1000,
    });
    expect(rewardAmount).toBe(0);
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
      })
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
      })
    ).toThrow('fourWeeksUsdVolumeThreshold must be greater than 0');
  });
});
