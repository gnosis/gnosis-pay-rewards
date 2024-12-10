import { BigInt, Address, log } from '@graphprotocol/graph-ts';
import { GnosisTokenBalanceSnapshot } from '../generated/schema';
import { Erc20 } from '../generated/templates/GnosisPayToken/Erc20';
import { timestampToWeekId } from './timestampToWeekId';
import { gnoToken } from './constants';
import { createTokenEntity, formatUnits } from './tokens';
import { getOrCreateGnosisPaySafe } from './getOrCreateGnosisPaySafe';

/**
 * Get or create a Gnosis token balance snapshot.
 *
 * @param blockNumber - The block number.
 * @param blockTimestamp - The block timestamp.
 * @param safe - The Gnosis Pay safe address.
 * @returns The Gnosis token balance snapshot.
 */
export function getOrCreateGnosisTokenBalanceSnapshot(
  // eslint-disable-next-line @typescript-eslint/ban-types
  blockNumber: BigInt,
  // eslint-disable-next-line @typescript-eslint/ban-types
  blockTimestamp: BigInt,
  safe: Address
): GnosisTokenBalanceSnapshot | null {
  const week = timestampToWeekId(blockTimestamp);
  const entityId = `${blockNumber.toString()}/${safe.toHexString().toLowerCase()}`;
  let gnosisTokenBalanceSnapshot = GnosisTokenBalanceSnapshot.load(entityId);
  const safeEntity = getOrCreateGnosisPaySafe(safe);

  if (safeEntity == null) {
    log.warning('getOrCreateGnosisTokenBalanceSnapshot: could not create Gnosis Pay Safe for ({})', [
      safe.toHexString(),
    ]);
    return null;
  }

  if (gnosisTokenBalanceSnapshot == null) {
    const balanceRaw = getGnoTokenBalance(safe);
    const gnoTokenEntity = createTokenEntity(gnoToken.address);

    gnosisTokenBalanceSnapshot = new GnosisTokenBalanceSnapshot(entityId);
    gnosisTokenBalanceSnapshot.safe = safe.toHexString();
    gnosisTokenBalanceSnapshot.week = week;
    gnosisTokenBalanceSnapshot.balanceRaw = balanceRaw;
    gnosisTokenBalanceSnapshot.balance = formatUnits(balanceRaw, gnoTokenEntity.decimals);
    // block number and timestamp
    gnosisTokenBalanceSnapshot.blockNumber = blockNumber.toI32();
    gnosisTokenBalanceSnapshot.blockTimestamp = blockTimestamp.toI32();
    gnosisTokenBalanceSnapshot.save();
  }

  return gnosisTokenBalanceSnapshot;
}

/**
 * Get the GNO token balance for a Gnosis Pay safe address.
 *
 * @param gnosisPaySafeAddress - The Gnosis Pay safe address.
 * @returns The GNO token balance.
 */
// eslint-disable-next-line @typescript-eslint/ban-types
export function getGnoTokenBalance(gnosisPaySafeAddress: Address): BigInt {
  const gnoTokenContract = Erc20.bind(gnoToken.address);

  return gnoTokenContract.balanceOf(gnosisPaySafeAddress);
}
