import { describe, expect, test } from '@jest/globals';
import { calculateMetriCrcPerEur, calculateMetriWeekRewardAmount } from './metri-rewards';

describe('Metri Rewards Boost', () => {
  describe('boost adds one extra CRC per euro spent', () => {
    const testCases = [
      { gnoBalance: 0, baseCrcPerEur: 1, description: '0 GNO tier' },
      { gnoBalance: 0.1, baseCrcPerEur: 2, description: '0.1 GNO tier (start of continuous scale)' },
      { gnoBalance: 0.55, baseCrcPerEur: 2.5, description: '0.55 GNO (midpoint of 0.1-1 range)' },
      { gnoBalance: 1, baseCrcPerEur: 3, description: '1 GNO tier' },
      { gnoBalance: 5.5, baseCrcPerEur: 3.5, description: '5.5 GNO (midpoint of 1-10 range)' },
      { gnoBalance: 10, baseCrcPerEur: 4, description: '10 GNO tier (max tier)' },
      { gnoBalance: 100, baseCrcPerEur: 4, description: '100 GNO (above max tier)' },
    ];

    for (const { gnoBalance, baseCrcPerEur, description } of testCases) {
      test(`${description}: NFT holders get +1 CRC per EUR boost`, () => {
        const crcPerEurWithoutBoost = calculateMetriCrcPerEur(gnoBalance, false);
        const crcPerEurWithBoost = calculateMetriCrcPerEur(gnoBalance, true);

        // Verify base rate matches expected tier
        expect(crcPerEurWithoutBoost).toBeCloseTo(baseCrcPerEur, 2);

        // Verify boost adds exactly 1 CRC per EUR
        const boostAmount = crcPerEurWithBoost - crcPerEurWithoutBoost;
        expect(boostAmount).toBeCloseTo(1, 2);
      });
    }

    test('boost applies correctly in reward calculation', () => {
      const gnoBalance = 1;
      const weekVolumeEUR = 100; // 100 EUR spent

      const rewardWithoutBoost = calculateMetriWeekRewardAmount({
        weekVolumeEUR,
        gnoBalance,
        isOgNftHolder: false,
      });

      const rewardWithBoost = calculateMetriWeekRewardAmount({
        weekVolumeEUR,
        gnoBalance,
        isOgNftHolder: true,
      });

      // Base rate: 3 CRC per EUR for 1 GNO
      // Without boost: 100 EUR * 3 CRC/EUR = 300 CRC
      // With boost: 100 EUR * (3 + 1) CRC/EUR = 400 CRC
      const expectedBoost = weekVolumeEUR * 1; // 1 extra CRC per EUR

      expect(rewardWithBoost.rewardAmountCrc - rewardWithoutBoost.rewardAmountCrc).toBeCloseTo(expectedBoost, 2);
    });

    test('boost applies correctly at different spending levels', () => {
      const gnoBalance = 0;
      const spendingLevels = [10, 50, 100, 500, 1000];

      for (const weekVolumeEUR of spendingLevels) {
        const rewardWithoutBoost = calculateMetriWeekRewardAmount({
          weekVolumeEUR,
          gnoBalance,
          isOgNftHolder: false,
        });

        const rewardWithBoost = calculateMetriWeekRewardAmount({
          weekVolumeEUR,
          gnoBalance,
          isOgNftHolder: true,
        });

        // Boost should be exactly 1 CRC per EUR spent (up to eligible volume)
        // But the actual boost may be limited by the weekly cap (which does NOT get boosted)
        const eligibleVolume = Math.min(weekVolumeEUR, 1000); // Max weekly spending: 1000 EUR for all tiers
        const baseReward = Math.min(eligibleVolume * 1, 1000); // Base rate: 1 CRC/EUR, cap: 1000 CRC
        const boostedReward = Math.min(eligibleVolume * 2, 1000); // Boosted rate: 2 CRC/EUR, cap: still 1000 CRC (no cap boost)
        const expectedBoost = boostedReward - baseReward;

        expect(rewardWithBoost.rewardAmountCrc - rewardWithoutBoost.rewardAmountCrc).toBeCloseTo(expectedBoost, 2);
      }
    });
  });
});
