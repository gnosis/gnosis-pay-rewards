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

type CalculateWeekRewardCommonParams = CalculateEligibleUsdVolumeParamsType & {
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
/**
 * Calculate the rewards for a given week given the net USD volume and GNO balance.
 * Negative USD volumes are ignored as they don't contribute to the rewards.
 */
export function calculateWeekRewardAmount({
  gnoUsdPrice,
  isOgNftHolder,
  gnoBalance,
  weekUsdVolume,
  fourWeeksUsdVolume,
  fourWeeksUsdVolumeThreshold,
}: CalculateWeekRewardCommonParams): CalculateWeekRewardReturnType {
  if (gnoUsdPrice <= 0) {
    throw new Error('gnoUsdPrice must be greater than 0');
  }

  const { eligibleUsdVolume, remainderVolumeToThreshold } = calculateEligibleUsdVolume({
    weekUsdVolume,
    fourWeeksUsdVolume,
    fourWeeksUsdVolumeThreshold,
  });

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
