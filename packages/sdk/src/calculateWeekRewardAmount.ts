/**
 * Get the maximum weekly spending eligible for cashback based on GNO balance tier.
 * @param gnoBalance - The GNO balance to determine the tier
 * @returns The maximum weekly spending in USD eligible for cashback
 */
export function getMaxWeeklySpending(gnoBalance: number): number {
  if (gnoBalance >= 100) {
    // Tier 4: 100+ GNO → $1,250 max weekly spending
    return 1_250;
  } else if (gnoBalance >= 10) {
    // Tier 3: 10+ GNO → $500 max weekly spending
    return 500;
  } else if (gnoBalance >= 1) {
    // Tier 2: 1+ GNO → $375 max weekly spending
    return 375;
  } else if (gnoBalance >= 0.1) {
    // Tier 1: 0.1+ GNO → $250 max weekly spending
    return 250;
  } else {
    // Not eligible for rewards
    return 0;
  }
}

type CalculateEligibleUsdVolumeByGnoBalanceParamsType = {
  /**
   * The net USD volume for the week
   */
  weekUsdVolume: number;
  /**
   * The GNO balance to determine the tier-based weekly spending limit
   */
  gnoBalance: number;
};

export type CalculateEligibleUsdVolumeReturnType = {
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
 * Calculate the eligible USD volume using only the tier-based weekly cap derived from GNO balance.
 * @param weekUsdVolume - The net USD volume for the week
 * @param gnoBalance - The GNO balance to determine the tier-based weekly spending limit
 */
export function calculateEligibleUsdVolumeByGnoBalance({
  weekUsdVolume,
  gnoBalance,
}: CalculateEligibleUsdVolumeByGnoBalanceParamsType): CalculateEligibleUsdVolumeReturnType {
  const maxWeeklySpendingLimit = getMaxWeeklySpending(gnoBalance);

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

type CalculateWeekRewardCommonParamsType = {
  /**
   * The GNO USD price reference to use when calculating rewards
   */
  gnoUsdPrice: number;
  /**
   * Whether the user is an Gnois Pay OG NFT holder. This adds 1% to the reward percentage.
   * See [https://gnosispay.niftyfair.io/](https://gnosispay.niftyfair.io/)
   */
  isOgNftHolder: boolean;
  /**
   * The GNO balance for the week
   */
  gnoBalance: number;
};

export type CalculateWeekRewardReturnType = CalculateEligibleUsdVolumeReturnType & {
  /**
   * The reward amount percentage
   */
  rewardAmountPercentage: number;
  /**
   * The reward amount in GNO
   */
  rewardAmountGno: number;
  /**
   * The reward amount in USD
   */
  rewardAmountUsd: number;
  /**
   * The reward percentage tier based on the GNO balance and OG NFT holder status
   */
  rewardAmountPercentageTier: number;
};

type CalculateWeekRewardParamsType = CalculateEligibleUsdVolumeByGnoBalanceParamsType &
  CalculateWeekRewardCommonParamsType;

/**
 * Calculate the rewards for a given week given the net USD volume and GNO balance.
 *
 * Negative USD volumes are ignored as they don't contribute to the rewards.
 */
export function calculateWeekRewardAmount(params: CalculateWeekRewardParamsType): CalculateWeekRewardReturnType {
  const { weekUsdVolume, gnoBalance } = params;

  const { eligibleUsdVolume, remainderVolumeToThreshold } = calculateEligibleUsdVolumeByGnoBalance({
    weekUsdVolume,
    gnoBalance,
  });

  return toReturnValue({
    ...params,
    eligibleUsdVolume,
    remainderVolumeToThreshold,
  });
}

function calculateRewardAmountPercentageTier(gnoBalance: number, isOgNftHolder: boolean): number {
  // Calculate base reward percentage based on GNO holdings with linear progression
  let rewardAmountPercentageTier = 0;
  if (gnoBalance >= 100) {
    rewardAmountPercentageTier = 4;
  } else if (gnoBalance >= 10) {
    rewardAmountPercentageTier = 3 + (gnoBalance - 10) / 90;
  } else if (gnoBalance >= 1) {
    rewardAmountPercentageTier = 2 + (gnoBalance - 1) / 9;
  } else if (gnoBalance >= 0.1) {
    rewardAmountPercentageTier = 1 + (gnoBalance - 0.1) / 0.9;
  } else {
    rewardAmountPercentageTier = 0; // Not eligible for rewards
  }

  // Add OG GP NFT holder boost if applicable
  if (isOgNftHolder && gnoBalance >= 0.1) {
    rewardAmountPercentageTier += 1;
  }

  return rewardAmountPercentageTier;
}

function toReturnValue(
  params: CalculateWeekRewardCommonParamsType & CalculateEligibleUsdVolumeReturnType,
): CalculateWeekRewardReturnType {
  const { gnoUsdPrice, isOgNftHolder, gnoBalance, eligibleUsdVolume, remainderVolumeToThreshold } = params;

  validateParams(params);
  const rewardAmountPercentageTier = calculateRewardAmountPercentageTier(gnoBalance, isOgNftHolder);
  // Calculate GNO rewards, then convert to USD
  const rewardAmountGno = ((rewardAmountPercentageTier / 100) * eligibleUsdVolume) / gnoUsdPrice;
  const rewardAmountUsd = rewardAmountGno * gnoUsdPrice;
  // The reward percentage is the reward amount in USD divided by the eligible volume
  const rewardAmountPercentage =
    eligibleUsdVolume > 0 ? Number(((rewardAmountUsd / eligibleUsdVolume) * 100).toFixed(2)) : 0;

  return {
    rewardAmountGno,
    rewardAmountUsd,
    rewardAmountPercentageTier,
    rewardAmountPercentage,
    eligibleUsdVolume,
    remainderVolumeToThreshold,
  };
}

function validateParams(params: { gnoUsdPrice: number }): void {
  if (params.gnoUsdPrice <= 0) {
    throw new Error('gnoUsdPrice must be greater than 0');
  }
}
