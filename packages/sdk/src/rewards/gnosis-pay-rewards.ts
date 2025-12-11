/**
 * Calculate rewards for Metri safes using CRC tokens instead of GNO.
 * Metri safes have different tier structure and weekly caps.
 */

type CalculateMetriEligibleUsdVolumeParamsType = {
  /**
   * The net USD volume for the week
   */
  weekUsdVolume: number;
  /**
   * The GNO balance to determine the tier-based weekly spending limit
   */
  gnoBalance: number;
};

export type CalculateMetriEligibleUsdVolumeReturnType = {
  /**
   * The eligible volume for rewards after applying the tier-based weekly cap
   */
  eligibleUsdVolume: number;
  /**
   * The remaining volume to reach the tier-based weekly cap, if any
   */
  remainderVolumeToThreshold: number;
};

/**
 * Get the maximum weekly spending eligible for cashback based on GNO balance tier for Metri safes.
 * @param gnoBalance - The GNO balance to determine the tier
 * @returns The maximum weekly spending in USD eligible for cashback
 */
export function getMetriMaxWeeklySpending(gnoBalance: number): number {
  if (gnoBalance >= 10) {
    // Tier 4: ≥10 GNO → $1,000 max weekly spending (4000 CRC cap / 4 CRC per EUR)
    return 1_000;
  } else if (gnoBalance >= 1) {
    // Tier 3: ≥1 GNO → $1,000 max weekly spending (3000 CRC cap / 3 CRC per EUR)
    return 1_000;
  } else if (gnoBalance >= 0.1) {
    // Tier 2: ≥0.1 GNO → $1,000 max weekly spending (2000 CRC cap / 2 CRC per EUR)
    return 1_000;
  } else {
    // Tier 1: 0 GNO → $1,000 max weekly spending (1000 CRC cap / 1 CRC per EUR)
    return 1_000;
  }
}

/**
 * Calculate the eligible USD volume using only the tier-based weekly cap derived from GNO balance for Metri safes.
 * @param weekUsdVolume - The net USD volume for the week
 * @param gnoBalance - The GNO balance to determine the tier-based weekly spending limit
 */
export function calculateMetriEligibleUsdVolumeByGnoBalance({
  weekUsdVolume,
  gnoBalance,
}: CalculateMetriEligibleUsdVolumeParamsType): CalculateMetriEligibleUsdVolumeReturnType {
  const maxWeeklySpendingLimit = getMetriMaxWeeklySpending(gnoBalance);

  if (weekUsdVolume <= 0) {
    return {
      eligibleUsdVolume: 0,
      remainderVolumeToThreshold: maxWeeklySpendingLimit,
    };
  }

  const eligibleUsdVolume = Math.min(weekUsdVolume, maxWeeklySpendingLimit);
  const remainderVolumeToThreshold = Math.max(maxWeeklySpendingLimit - weekUsdVolume, 0);

  return {
    eligibleUsdVolume,
    remainderVolumeToThreshold,
  };
}

type CalculateMetriWeekRewardCommonParamsType = {
  /**
   * Whether the user is a dynamic NFT holder. This adds 1% to the reward.
   */
  isDynamicNftHolder: boolean;
  /**
   * The GNO balance for the week
   */
  gnoBalance: number;
};

export type CalculateMetriWeekRewardReturnType = CalculateMetriEligibleUsdVolumeReturnType & {
  /**
   * The reward amount percentage
   */
  rewardAmountPercentage: number;
  /**
   * The reward amount in CRC
   */
  rewardAmountCrc: number;
  /**
   * The reward amount in USD (calculated from CRC)
   */
  rewardAmountUsd: number;
  /**
   * The CRC per EUR rate based on the GNO balance tier
   */
  crcPerEur: number;
};

type CalculateMetriWeekRewardParamsType = CalculateMetriEligibleUsdVolumeParamsType &
  CalculateMetriWeekRewardCommonParamsType;

/**
 * Calculate the CRC per EUR rate based on GNO balance tier for Metri safes.
 * @param gnoBalance - The GNO balance to determine the tier
 * @param isDynamicNftHolder - Whether the user is a dynamic NFT holder (adds +1 CRC per EUR)
 * @returns The CRC per EUR rate
 */
export function calculateMetriCrcPerEur(gnoBalance: number, isDynamicNftHolder: boolean): number {
  let crcPerEur = 0;

  if (gnoBalance >= 10) {
    // Tier 4: ≥10 GNO → 4 CRC per EUR
    crcPerEur = 4;
  } else if (gnoBalance >= 1) {
    // Tier 3: ≥1 GNO → 3 CRC per EUR
    crcPerEur = 3;
  } else if (gnoBalance >= 0.1) {
    // Tier 2: ≥0.1 GNO → 2 CRC per EUR
    crcPerEur = 2;
  } else {
    // Tier 1: 0 GNO → 1 CRC per EUR
    crcPerEur = 1;
  }

  // Add dynamic NFT holder boost if applicable (adds 1% = 0.01 * base rate)
  if (isDynamicNftHolder) {
    crcPerEur = crcPerEur * 1.01;
  }

  return crcPerEur;
}

/**
 * Calculate the weekly cap in CRC based on GNO balance tier for Metri safes.
 * @param gnoBalance - The GNO balance to determine the tier
 * @returns The weekly cap in CRC
 */
export function getMetriWeeklyCrcCap(gnoBalance: number): number {
  if (gnoBalance >= 10) {
    // Tier 4: ≥10 GNO → 4000 CRC weekly cap
    return 4_000;
  } else if (gnoBalance >= 1) {
    // Tier 3: ≥1 GNO → 3000 CRC weekly cap
    return 3_000;
  } else if (gnoBalance >= 0.1) {
    // Tier 2: ≥0.1 GNO → 2000 CRC weekly cap
    return 2_000;
  } else {
    // Tier 1: 0 GNO → 1000 CRC weekly cap
    return 1_000;
  }
}

/**
 * Calculate the rewards for a Metri safe for a given week given the net USD volume and GNO balance.
 * Rewards are paid in CRC instead of GNO.
 *
 * Negative USD volumes are ignored as they don't contribute to the rewards.
 */
export function calculateMetriWeekRewardAmount(
  params: CalculateMetriWeekRewardParamsType,
): CalculateMetriWeekRewardReturnType {
  const { weekUsdVolume, gnoBalance } = params;

  const { eligibleUsdVolume, remainderVolumeToThreshold } = calculateMetriEligibleUsdVolumeByGnoBalance({
    weekUsdVolume,
    gnoBalance,
  });

  return toMetriReturnValue({
    ...params,
    eligibleUsdVolume,
    remainderVolumeToThreshold,
  });
}

function toMetriReturnValue(
  params: CalculateMetriWeekRewardCommonParamsType & CalculateMetriEligibleUsdVolumeReturnType,
): CalculateMetriWeekRewardReturnType {
  const { isDynamicNftHolder, gnoBalance, eligibleUsdVolume, remainderVolumeToThreshold } = params;

  const crcPerEur = calculateMetriCrcPerEur(gnoBalance, isDynamicNftHolder);
  const weeklyCrcCap = getMetriWeeklyCrcCap(gnoBalance);

  // Calculate CRC rewards: eligible volume * CRC per EUR, capped at weekly cap
  const rewardAmountCrc = Math.min(eligibleUsdVolume * crcPerEur, weeklyCrcCap);

  // Calculate USD value (assuming 1 CRC = 1 EUR for now, adjust if needed)
  // TODO: Get actual CRC/USD price if available
  const rewardAmountUsd = rewardAmountCrc; // 1:1 assumption, update if CRC has different USD value

  // The reward percentage is the reward amount in USD divided by the eligible volume
  const rewardAmountPercentage =
    eligibleUsdVolume > 0 ? Number(((rewardAmountUsd / eligibleUsdVolume) * 100).toFixed(2)) : 0;

  return {
    rewardAmountCrc,
    rewardAmountUsd,
    rewardAmountPercentage,
    crcPerEur,
    eligibleUsdVolume,
    remainderVolumeToThreshold,
  };
}
