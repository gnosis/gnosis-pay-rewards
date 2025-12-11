/**
 * Calculate rewards for Metri safes using CRC tokens instead of GNO.
 * Metri safes have different tier structure and weekly caps.
 *
 * Rules:
 * - 0 GNO: 1 CRC per EUR, weekly cap 1000 CRC
 * - ≥0.1 GNO: 2 CRC per EUR, weekly cap 2000 CRC (continuous scale starts)
 * - ≥1 GNO: 3 CRC per EUR, weekly cap 3000 CRC
 * - ≥10 GNO: 4 CRC per EUR, weekly cap 4000 CRC (continuous scale capped)
 * - Gnosis NFT holders get an extra 1 CRC per EUR (applied to CRC per EUR rate)
 *
 * Continuous scale:
 * - 0.1-1 GNO: Linear interpolation from 2 to 3 CRC per EUR, 2000 to 3000 CRC cap
 * - 1-10 GNO: Linear interpolation from 3 to 4 CRC per EUR, 3000 to 4000 CRC cap
 */

type CalculateMetriEligibleEurVolumeParamsType = {
  /**
   * The net volume for the week (in EUR)
   */
  weekVolumeEUR: number;
  /**
   * The GNO balance to determine the tier-based weekly spending limit
   */
  gnoBalance: number;
};

export type CalculateMetriEligibleEurVolumeReturnType = {
  /**
   * The eligible volume for rewards after applying the tier-based weekly cap (in EUR, max 1000 EUR)
   */
  eligibleVolume: number;
  /**
   * The remaining volume to reach the tier-based weekly cap, if any
   */
  remainderVolumeToThreshold: number;
};

/**
 * Metri rewards tier configuration.
 * Tiers are ordered from highest to lowest GNO balance threshold.
 */
const METRI_TIERS = [
  { minGnoBalance: 10, crcPerEur: 4, weeklyCrcCap: 4_000, maxWeeklySpending: 1_000 },
  { minGnoBalance: 1, crcPerEur: 3, weeklyCrcCap: 3_000, maxWeeklySpending: 1_000 },
  { minGnoBalance: 0.1, crcPerEur: 2, weeklyCrcCap: 2_000, maxWeeklySpending: 1_000 },
  { minGnoBalance: 0, crcPerEur: 1, weeklyCrcCap: 1_000, maxWeeklySpending: 1_000 },
] as const;

/**
 * Get the tier configuration for a given GNO balance.
 * @param gnoBalance - The GNO balance to determine the tier
 * @returns The tier configuration matching the GNO balance
 */
function getMetriTier(gnoBalance: number): (typeof METRI_TIERS)[number] {
  return METRI_TIERS.find((tier) => gnoBalance >= tier.minGnoBalance) ?? METRI_TIERS[METRI_TIERS.length - 1];
}

/**
 * Get the maximum weekly spending eligible for cashback based on GNO balance tier for Metri safes.
 * @param gnoBalance - The GNO balance to determine the tier
 * @returns The maximum weekly spending in EUR eligible for cashback (1000 EUR for all tiers)
 */
export function getMetriMaxWeeklySpending(gnoBalance: number): number {
  return getMetriTier(gnoBalance).maxWeeklySpending;
}

/**
 * Calculate the eligible volume using only the tier-based weekly cap derived from GNO balance for Metri safes.
 * The max weekly spending limit is 1000 EUR for all tiers.
 * @param weekVolumeEUR - The net volume for the week (in EUR)
 * @param gnoBalance - The GNO balance to determine the tier-based weekly spending limit
 */
export function calculateMetriEligibleEurVolumeByGnoBalance({
  weekVolumeEUR,
  gnoBalance,
}: CalculateMetriEligibleEurVolumeParamsType): CalculateMetriEligibleEurVolumeReturnType {
  const maxWeeklySpendingLimit = getMetriMaxWeeklySpending(gnoBalance);

  if (weekVolumeEUR <= 0) {
    return {
      eligibleVolume: 0,
      remainderVolumeToThreshold: maxWeeklySpendingLimit,
    };
  }

  const eligibleVolume = Math.min(weekVolumeEUR, maxWeeklySpendingLimit);
  const remainderVolumeToThreshold = Math.max(maxWeeklySpendingLimit - weekVolumeEUR, 0);

  return {
    eligibleVolume,
    remainderVolumeToThreshold,
  };
}

type CalculateMetriWeekRewardCommonParamsType = {
  /**
   * Whether the user is a Gnosis NFT holder. This adds 1 extra CRC per EUR to the reward rate (does not affect weekly cap).
   */
  isOgNftHolder: boolean;
  /**
   * The GNO balance for the week
   */
  gnoBalance: number;
};

export type CalculateMetriWeekRewardReturnType = CalculateMetriEligibleEurVolumeReturnType & {
  /**
   * The reward amount percentage
   */
  rewardAmountPercentage: number;
  /**
   * The reward amount in CRC
   */
  rewardAmountCrc: number;
  /**
   * The reward amount in EUR (calculated from CRC, 1:1 assumption)
   */
  rewardAmountEur: number;
  /**
   * The CRC per EUR rate based on the GNO balance tier
   */
  crcPerEur: number;
};

type CalculateMetriWeekRewardParamsType = CalculateMetriEligibleEurVolumeParamsType &
  CalculateMetriWeekRewardCommonParamsType;

/**
 * Calculate the CRC per EUR rate based on GNO balance tier for Metri safes.
 * Uses linear interpolation between tier boundaries for continuous scaling.
 * @param gnoBalance - The GNO balance to determine the tier
 * @param isGnosisNftHolder - Whether the user is a Gnosis NFT holder (adds 1 extra CRC per EUR)
 * @returns The CRC per EUR rate
 */
export function calculateMetriCrcPerEur(gnoBalance: number, isGnosisNftHolder: boolean): number {
  const currentTier = getMetriTier(gnoBalance);
  const currentTierIndex = METRI_TIERS.findIndex((tier) => tier.minGnoBalance === currentTier.minGnoBalance);

  let crcPerEur: number;

  // If we're at the highest tier (index 0), return the base value
  if (currentTierIndex === 0) {
    crcPerEur = currentTier.crcPerEur;
  } else {
    // Find the next higher tier for interpolation
    const nextTier = METRI_TIERS[currentTierIndex - 1];
    const range = nextTier.minGnoBalance - currentTier.minGnoBalance;
    const progress = (gnoBalance - currentTier.minGnoBalance) / range;

    // Linear interpolation between current and next tier
    crcPerEur = currentTier.crcPerEur + progress * (nextTier.crcPerEur - currentTier.crcPerEur);
  }

  // Add Gnosis NFT holder boost if applicable (adds 1 extra CRC per EUR)
  if (isGnosisNftHolder) {
    crcPerEur = crcPerEur + 1;
  }

  return crcPerEur;
}

/**
 * Calculate the weekly cap in CRC based on GNO balance tier for Metri safes.
 * Uses linear interpolation between tier boundaries for continuous scaling.
 * Note: NFT holders do not get a boost to the weekly cap - it remains the same regardless of NFT status.
 * @param gnoBalance - The GNO balance to determine the tier
 * @param isGnosisNftHolder - Whether the user is a Gnosis NFT holder (not used for cap calculation, kept for API consistency)
 * @returns The weekly cap in CRC
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getMetriWeeklyCrcCap(gnoBalance: number, _isGnosisNftHolder: boolean): number {
  const currentTier = getMetriTier(gnoBalance);
  const currentTierIndex = METRI_TIERS.findIndex((tier) => tier.minGnoBalance === currentTier.minGnoBalance);

  // If we're at the highest tier (index 0), return the base value
  if (currentTierIndex === 0) {
    return currentTier.weeklyCrcCap;
  }

  // Find the next higher tier for interpolation
  const nextTier = METRI_TIERS[currentTierIndex - 1];
  const range = nextTier.minGnoBalance - currentTier.minGnoBalance;
  const progress = (gnoBalance - currentTier.minGnoBalance) / range;

  // Linear interpolation between current and next tier
  return currentTier.weeklyCrcCap + progress * (nextTier.weeklyCrcCap - currentTier.weeklyCrcCap);
}

/**
 * Calculate the rewards for a Metri safe for a given week given the net volume and GNO balance.
 * Rewards are paid in CRC instead of GNO.
 * Max weekly spending is 1000 EUR for all tiers.
 *
 * Negative volumes are ignored as they don't contribute to the rewards.
 */
export function calculateMetriWeekRewardAmount(
  params: CalculateMetriWeekRewardParamsType,
): CalculateMetriWeekRewardReturnType {
  const { weekVolumeEUR, gnoBalance } = params;

  const { eligibleVolume, remainderVolumeToThreshold } = calculateMetriEligibleEurVolumeByGnoBalance({
    weekVolumeEUR,
    gnoBalance,
  });

  return toMetriReturnValue({
    ...params,
    eligibleVolume,
    remainderVolumeToThreshold,
  });
}

function toMetriReturnValue(
  params: CalculateMetriWeekRewardCommonParamsType & CalculateMetriEligibleEurVolumeReturnType,
): CalculateMetriWeekRewardReturnType {
  const { isOgNftHolder, gnoBalance, eligibleVolume, remainderVolumeToThreshold } = params;

  const crcPerEur = calculateMetriCrcPerEur(gnoBalance, isOgNftHolder);
  const weeklyCrcCap = getMetriWeeklyCrcCap(gnoBalance, isOgNftHolder);

  // Calculate CRC rewards: eligible volume * CRC per EUR, capped at weekly cap
  const rewardAmountCrc = Math.min(eligibleVolume * crcPerEur, weeklyCrcCap);

  // Calculate EUR value (assuming 1 CRC = 1 EUR, 1:1 assumption)
  const rewardAmountEur = rewardAmountCrc; // 1:1 assumption (1 CRC = 1 EUR)

  // The reward percentage is the reward amount divided by the eligible volume
  const rewardAmountPercentage = eligibleVolume > 0 ? Number(((rewardAmountEur / eligibleVolume) * 100).toFixed(2)) : 0;

  return {
    rewardAmountCrc,
    rewardAmountEur,
    rewardAmountPercentage,
    crcPerEur,
    eligibleVolume,
    remainderVolumeToThreshold,
  };
}
