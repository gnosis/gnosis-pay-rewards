import {
  gnoToken,
  TokenBalanceSnapshotFieldsType,
  TokenFieldsType,
  WeekIdFormatType,
} from '@kpk/gnosis-pay-rewards-sdk';
import { CreateModelsReturnType } from '@kpk/gnosis-pay-rewards-sdk/mongoose';
import { type Address } from 'viem';

export type TokenBalanceSnapshotWithTokenFieldsType = Omit<TokenBalanceSnapshotFieldsType, 'token'> & {
  token: TokenFieldsType;
};

/**
 * Fetches GNO token balance snapshots for both Metri safe and Gnosis Pay safe for a given week
 */
async function fetchGnoSnapshotsForBothSafes(
  params: {
    addresses: Address[];
    week: WeekIdFormatType;
    tokenBalanceSnapshotModel: CreateModelsReturnType['tokenBalanceSnapshotModel'];
  },
): Promise<TokenBalanceSnapshotWithTokenFieldsType[][]> {
  const {
    addresses,
    week,
    tokenBalanceSnapshotModel,
  } = params;

  const gnoTokenAddress = gnoToken.address.toLowerCase() as Address;

  const fetchSnapshots = (address: Address) => {
    return tokenBalanceSnapshotModel
      .find({
        address,
        week,
        token: gnoTokenAddress,
      })
      .populate<{ token: TokenFieldsType }>({
        path: 'token',
        select: 'address decimals symbol name',
      })
      .sort({ block: 1 }) // Sort by block number ascending (oldest first)
      .lean();
  };

  const snapshots = await Promise.all(addresses.map(fetchSnapshots));

  return snapshots as unknown as TokenBalanceSnapshotWithTokenFieldsType[][];
}

/**
 * Finds the lowest GNO balance for a Metri wallet, considering GNO movement from Pay safe to Metri safe.
 * Accounts for GNO being in one safe or the other, and handles intermediate transfers (Pay → intermediate → Metri).
 * For each block, takes the maximum of the two balances to ensure users don't get zero balance
 * when they move GNO from Gnosis Pay safe to Metri safe.
 * @param params - Parameters for finding the lowest balance
 * @returns The lowest balance (number), returns 0 if no snapshots exist
 */
export async function findLowestMetriWalletGnoBalance(
  params: {
    metriSafeAddress: Address;
    gnosisPaySafeAddress: Address | null;
    week: WeekIdFormatType;
    tokenBalanceSnapshotModel: CreateModelsReturnType['tokenBalanceSnapshotModel'];
  },
): Promise<number> {
  const {
    metriSafeAddress,
    gnosisPaySafeAddress,
    week,
    tokenBalanceSnapshotModel,
  } = params;

  // Fetch GNO snapshots for both safes for the week
  const [metriSnapshots, gnosisPaySnapshots] = await fetchGnoSnapshotsForBothSafes({
    addresses: [metriSafeAddress, gnosisPaySafeAddress ?? 'NULL_ADDRESS' as Address],
    week,
    tokenBalanceSnapshotModel,
  });

  // If Metri safe has no snapshots, return 0
  if (metriSnapshots.length === 0) {
    return 0;
  }

  // If Metri safe balance stayed the same throughout the week, return that balance
  if (metriSnapshots.length > 0) {
    const firstBalance = metriSnapshots[0].balance;
    const allBalancesSame = metriSnapshots.every((snapshot) => snapshot.balance === firstBalance);
    if (allBalancesSame) {
      return firstBalance;
    }
  }

  // No gnosispay snapshots, return minimum of metri snapshots
  if (gnosisPaySnapshots.length === 0) {
    return Math.min(...metriSnapshots.map((s) => s.balance));
  }

  // Group snapshots by block number
  const metriSnapshotsByBlock = new Map<
    number,
    TokenBalanceSnapshotWithTokenFieldsType
  >();
  const gnosisPaySnapshotsByBlock = new Map<
    number,
    TokenBalanceSnapshotWithTokenFieldsType
  >();

  for (const snapshot of metriSnapshots) {
    const block = snapshot.block as number;
    metriSnapshotsByBlock.set(block, snapshot);
  }

  for (const snapshot of gnosisPaySnapshots) {
    const block = snapshot.block as number;
    gnosisPaySnapshotsByBlock.set(block, snapshot);
  }

  // Get all unique block numbers from both sets and sort them
  const allBlocks = Array.from(
    new Set([
      ...metriSnapshotsByBlock.keys(),
      ...gnosisPaySnapshotsByBlock.keys(),
    ]),
  ).sort((a, b) => a - b);

  // Find the maximum Pay safe balance, final Metri balance, and Metri balance before Pay safe appears
  const maxPaySafeBalance = Math.max(
    0,
    ...Array.from(gnosisPaySnapshotsByBlock.values()).map((s) => s.balance),
  );
  const firstPaySafeBlock = Array.from(gnosisPaySnapshotsByBlock.entries())
    .filter(([, snapshot]) => snapshot.balance > 0)
    .map(([block]) => block)
    .sort((a, b) => a - b)[0];

  // Find maximum Metri balance before Pay safe balance appeared
  const maxMetriBeforePay = firstPaySafeBlock !== undefined
    ? Math.max(
      0,
      ...Array.from(metriSnapshotsByBlock.entries())
        .filter(([block]) => block < firstPaySafeBlock)
        .map(([, snapshot]) => snapshot.balance),
    )
    : 0;

  const lastBlock = allBlocks[allBlocks.length - 1];
  const finalMetriBalance = metriSnapshotsByBlock.get(lastBlock)?.balance ?? 0;

  // If final Metri balance is higher than Pay safe balance AND early Metri balance was lower than Pay safe,
  // use final Metri balance as floor. This handles cases where GNO moves from Pay safe to Metri safe
  // and ends up higher, and the early Metri balance was insignificant.
  // Only apply if Pay safe actually had a balance (transfer happened)
  const balanceFloor = maxPaySafeBalance > 0 &&
      finalMetriBalance > maxPaySafeBalance &&
      maxMetriBeforePay < maxPaySafeBalance
    ? finalMetriBalance
    : 0;

  // Track the effective balance to handle intermediate transfers
  // We only care about GNO moving from Pay safe → Metri safe (one direction)
  // So we only carry forward balance when GNO was previously in Pay safe
  let lastEffectiveBalance = 0;
  let lastPaySafeBalance = 0; // Track Pay safe balance to determine if we should carry forward
  let minBalance: number = Infinity;

  for (const block of allBlocks) {
    const metriSnapshot = metriSnapshotsByBlock.get(block);
    const gnosisPaySnapshot = gnosisPaySnapshotsByBlock.get(block);

    // Get current balances (0 if snapshot doesn't exist)
    const metriBalance = metriSnapshot?.balance ?? 0;
    const gnosisPayBalance = gnosisPaySnapshot?.balance ?? 0;

    // Take the maximum of the two balances at this block
    const currentMaxBalance = Math.max(metriBalance, gnosisPayBalance);

    // Only carry forward balance if GNO was previously in Pay safe
    // This ensures we maintain balance during intermediate transfers (Pay → intermediate → Metri)
    // but don't carry forward if GNO moves from Metri safe elsewhere
    const shouldCarryForward = lastPaySafeBalance > 0;
    let effectiveBalance = shouldCarryForward ? Math.max(currentMaxBalance, lastEffectiveBalance) : currentMaxBalance;

    // Apply the balance floor if Metri balance is higher than Pay safe balance
    if (balanceFloor > 0) {
      effectiveBalance = Math.max(effectiveBalance, balanceFloor);
    }

    // Track the minimum balance
    if (effectiveBalance < minBalance) {
      minBalance = effectiveBalance;
    }

    lastEffectiveBalance = effectiveBalance;
    lastPaySafeBalance = gnosisPayBalance;
  }

  // Return 0 if we never found any balance (shouldn't happen, but safety check)
  return minBalance === Infinity ? 0 : minBalance;
}
