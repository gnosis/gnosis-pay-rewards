import { moneriumEureToken, moneriumGbpToken, usdcBridgeToken, circleUsdcToken } from './gnoisPayTokens';
import { Address, getAddress } from 'viem';

/**
 * The month-to-date USD volume threshold for each currency.
 * A maximum of EUR 20,000, USD 22,000, or GBP 18,000 will be eligible to accrue rewards per month for every user.
 */
const FOUR_WEEK_VOLUME_THRESHOLD = {
  // USDC can be either circle's native USDC or bridged from Ethereum
  [getAddress(circleUsdcToken.address)]: 22_000,
  [getAddress(usdcBridgeToken.address)]: 22_000,
  [getAddress(moneriumGbpToken.address)]: 18_000,
  [getAddress(moneriumEureToken.address)]: 20_000,
};

/**
 * The weekly USD volume threshold for each currency.
 * These are derived by dividing the four-week thresholds by 4.
 * A maximum of EUR 5,000, USD 5,500, or GBP 4,500 will be eligible to accrue rewards per week for every user.
 */
const WEEKLY_VOLUME_THRESHOLD = Object.fromEntries(
  Object.entries(FOUR_WEEK_VOLUME_THRESHOLD).map(([address, threshold]) => [address, threshold / 4]),
);

/**
 * Get the four week volume threshold for a given safe token address.
 * @param safeToken - The safe token address to get the threshold for.
 * @returns The four week volume threshold for the given safe token address.
 * The threshold is in the same currency as the safe token, and must be converted to USD before using it in the reward calculation.
 */
export function getFourWeekVolumeThreshold(safeToken: Address): number {
  const safeTokenAddress = getAddress(safeToken);
  const volumeThreshold = FOUR_WEEK_VOLUME_THRESHOLD[safeTokenAddress];
  if (volumeThreshold === undefined) {
    throw new Error(`Invalid safe token address: ${safeTokenAddress}`);
  }
  return volumeThreshold;
}

/**
 * Get the weekly volume threshold for a given safe token address.
 * @param safeToken - The safe token address to get the threshold for.
 * @returns The weekly volume threshold for the given safe token address.
 * The threshold is in the same currency as the safe token, and must be converted to USD before using it in the reward calculation.
 */
export function getWeeklyVolumeThreshold(safeToken: Address): number {
  const safeTokenAddress = getAddress(safeToken);
  const volumeThreshold = WEEKLY_VOLUME_THRESHOLD[safeTokenAddress];
  if (volumeThreshold === undefined) {
    throw new Error(`Invalid safe token address: ${safeTokenAddress}`);
  }
  return volumeThreshold;
}

type CalculateEligibleUsdVolumeParamsType = {
  /**
   * The net USD volume for the week
   */
  weekUsdVolume: number;
  /**
   * Four weeks USD volume
   */
  fourWeeksUsdVolume: number;
  /**
   * The four week USD volume threshold for the safe token.
   * Use `getFourWeekVolumeThreshold` and convert that to USD before passing it in here.
   */
  fourWeeksUsdVolumeThreshold: number;
};

export type CalculateEligibleUsdVolumeReturnType = {
  /**
   * The eligible volume, which is the week's volume but reduced if threshold conditions are met
   */
  eligibleUsdVolume: number;
  /**
   * The remainder volume to reach the threshold, if any
   */
  remainderVolumeToThreshold: number;
};

/**
 * Calculate the eligible USD volume and the remainder to reach the threshold.
 * If the four weeks volume is greater than the threshold, the eligible volume is reduced to the remainder.
 * If the week's volume is greater than the threshold, the eligible volume is 0.
 * @param weekUsdVolume - The net USD volume for the week
 * @param fourWeeksUsdVolume - Four weeks USD volume
 * @param fourWeeksUsdVolumeThreshold - The four week USD volume threshold for the safe token.
 * Use `getFourWeekVolumeThreshold` and convert that to USD before passing it in here.
 * @throws if the four weeks volume threshold is not greater than 0
 */
export function calculateEligibleUsdVolume({
  weekUsdVolume,
  fourWeeksUsdVolume,
  fourWeeksUsdVolumeThreshold,
}: CalculateEligibleUsdVolumeParamsType): CalculateEligibleUsdVolumeReturnType {
  if (fourWeeksUsdVolumeThreshold <= 0) {
    throw new Error('fourWeeksUsdVolumeThreshold must be greater than 0');
  }

  // Calculate the adjusted total volume including the current week's volume
  const previousFourWeeksVolume = fourWeeksUsdVolume - weekUsdVolume;

  // Calculate remainder considering the week's volume is already accounted for
  const remainderVolumeToThreshold = Math.max(fourWeeksUsdVolumeThreshold - previousFourWeeksVolume, 0);

  let eligibleUsdVolume = 0;

  // Determine eligibility
  if (weekUsdVolume <= remainderVolumeToThreshold) {
    eligibleUsdVolume = weekUsdVolume;
  } else {
    eligibleUsdVolume = Math.max(remainderVolumeToThreshold, 0);
  }

  return {
    eligibleUsdVolume,
    remainderVolumeToThreshold,
  };
}

type CalculateEligibleWeeklyUsdVolumeParamsType = {
  /**
   * The net USD volume for the week
   */
  weekUsdVolume: number;
  /**
   * The weekly USD volume threshold for the safe token.
   * Use `getWeeklyVolumeThreshold` and convert that to USD before passing it in here.
   */
  weeklyUsdVolumeThreshold: number;
};

/**
 * Calculate the eligible USD volume using a weekly cap.
 * This simply caps the week's volume at the weekly threshold.
 * @param weekUsdVolume - The net USD volume for the week
 * @param weeklyUsdVolumeThreshold - The weekly USD volume threshold for the safe token.
 * Use `getWeeklyVolumeThreshold` and convert that to USD before passing it in here.
 * @throws if the weekly volume threshold is not greater than 0
 */
export function calculateEligibleWeeklyUsdVolume({
  weekUsdVolume,
  weeklyUsdVolumeThreshold,
}: CalculateEligibleWeeklyUsdVolumeParamsType): CalculateEligibleUsdVolumeReturnType {
  if (weeklyUsdVolumeThreshold <= 0) {
    throw new Error('weeklyUsdVolumeThreshold must be greater than 0');
  }

  // Calculate eligible volume - capped at weekly threshold
  const eligibleUsdVolume = Math.min(weekUsdVolume, weeklyUsdVolumeThreshold);

  // Calculate remainder - if we're under threshold, there's still room, otherwise 0
  const remainderVolumeToThreshold = Math.max(weeklyUsdVolumeThreshold - weekUsdVolume, 0);

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

type CalculateWeekRewardParamsType = CalculateEligibleUsdVolumeParamsType & CalculateWeekRewardCommonParamsType;

/**
 * Calculate the rewards for a given week given the net USD volume and GNO balance.
 * Negative USD volumes are ignored as they don't contribute to the rewards.
 */
export function calculateWeekRewardAmount(params: CalculateWeekRewardParamsType): CalculateWeekRewardReturnType {
  const { weekUsdVolume, fourWeeksUsdVolume, fourWeeksUsdVolumeThreshold } = params;

  const { eligibleUsdVolume, remainderVolumeToThreshold } = calculateEligibleUsdVolume({
    weekUsdVolume,
    fourWeeksUsdVolume,
    fourWeeksUsdVolumeThreshold,
  });

  return toReturnValue({
    ...params,
    eligibleUsdVolume,
    remainderVolumeToThreshold,
  });
}

function calculateRewardAmountPercentageTier(gnoBalance: number, isOgNftHolder: boolean): number {
  // Calculate base reward percentage based on GNO holdings
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

type CalculateWeeklyRewardParamsType = CalculateEligibleWeeklyUsdVolumeParamsType & CalculateWeekRewardCommonParamsType;

/**
 * Calculate the rewards for a given week using a weekly cap approach.
 * This ignores the four-week threshold and only considers the weekly cap.
 * Negative USD volumes are ignored as they don't contribute to the rewards.
 */
export function calculateWeeklyRewardAmount(params: CalculateWeeklyRewardParamsType): CalculateWeekRewardReturnType {
  const { weekUsdVolume, weeklyUsdVolumeThreshold } = params;

  const { eligibleUsdVolume, remainderVolumeToThreshold } = calculateEligibleWeeklyUsdVolume({
    weekUsdVolume,
    weeklyUsdVolumeThreshold,
  });

  return toReturnValue({
    ...params,
    eligibleUsdVolume,
    remainderVolumeToThreshold,
  });
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
