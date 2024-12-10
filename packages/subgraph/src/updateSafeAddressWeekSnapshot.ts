import {  GnosisPaySafeWeekSnapshot } from '../generated/schema';

import { BigInt, Address, BigDecimal, log } from '@graphprotocol/graph-ts';
import { GnosisPayTransaction } from '../generated/schema';
import { GnosisTokenBalanceSnapshot } from '../generated/schema';
import { getOrCreateGnosisTokenBalanceSnapshot } from './gnosisTokenBalanceSnapshot';
import { timestampToWeekId } from './timestampToWeekId';
import { getOrCreateGnosisPaySafe } from './getOrCreateGnosisPaySafe';

export function updateSafeAddressWeekSnapshot(
  safeAddress: Address,
  recentGnosisPayTransaction: GnosisPayTransaction
): void {
  const weekId = timestampToWeekId(BigInt.fromI64(recentGnosisPayTransaction.blockTimestamp));
  const entityId = toGnosisSafeWeeklySnapshotEntityId(weekId, safeAddress);
  const safeEntity = getOrCreateGnosisPaySafe(safeAddress);

  if (safeEntity == null) {
    log.warning('updateSafeAddressWeekSnapshot: could not create Gnosis Pay Safe', [safeAddress.toHexString()]);
    return;
  }

  let safeAddressWeekSnapshot = GnosisPaySafeWeekSnapshot.load(entityId);

  if (safeAddressWeekSnapshot == null) {
    safeAddressWeekSnapshot = new GnosisPaySafeWeekSnapshot(entityId);
    safeAddressWeekSnapshot.safe = safeAddress.toHexString();
    safeAddressWeekSnapshot.transactions = [];
    safeAddressWeekSnapshot.transactionCount = 0;
    safeAddressWeekSnapshot.gnoBalanceSnapshots = [];
    safeAddressWeekSnapshot.minGnoBalance = BigDecimal.fromString('0');
    safeAddressWeekSnapshot.maxGnoBalance = BigDecimal.fromString('0');
    safeAddressWeekSnapshot.netUsdVolume = BigDecimal.fromString('0');
    safeAddressWeekSnapshot.week = weekId;
  }

  safeAddressWeekSnapshot.transactions.push(recentGnosisPayTransaction.id);
  safeAddressWeekSnapshot.transactionCount = safeAddressWeekSnapshot.transactionCount + 1;

  if (recentGnosisPayTransaction.type == 'SPEND') {
    safeAddressWeekSnapshot.netUsdVolume = safeAddressWeekSnapshot.netUsdVolume.plus(
      recentGnosisPayTransaction.valueUsd
    );
  } else {
    safeAddressWeekSnapshot.netUsdVolume = safeAddressWeekSnapshot.netUsdVolume.minus(
      recentGnosisPayTransaction.valueUsd
    );
  }

  const gnosisTokenBalanceSnapshot = getOrCreateGnosisTokenBalanceSnapshot(
    BigInt.fromI64(recentGnosisPayTransaction.blockNumber),
    BigInt.fromI64(recentGnosisPayTransaction.blockTimestamp),
    safeAddress
  );

  if (gnosisTokenBalanceSnapshot == null) {
    log.warning('updateSafeAddressWeekSnapshot: could not get Gnosis token balance snapshot', [
      safeAddress.toHexString(),
    ]);
    return;
  }

  // Push the snapshot to the array if it's not already there
  if (safeAddressWeekSnapshot.gnoBalanceSnapshots.indexOf(gnosisTokenBalanceSnapshot.id) === -1) {
    safeAddressWeekSnapshot.gnoBalanceSnapshots.push(gnosisTokenBalanceSnapshot.id);
  }

  let minGnoBalance = safeAddressWeekSnapshot.minGnoBalance;
  let maxGnoBalance = safeAddressWeekSnapshot.maxGnoBalance;

  // Among the snapshots, find the min and max GNO balance
  for (let i = 0; i < safeAddressWeekSnapshot.gnoBalanceSnapshots.length; i++) {
    const snapshot = GnosisTokenBalanceSnapshot.load(safeAddressWeekSnapshot.gnoBalanceSnapshots[i]);
    if (snapshot != null && snapshot.balance.lt(minGnoBalance)) {
      minGnoBalance = snapshot.balance;
    }
    if (snapshot != null && snapshot.balance.gt(maxGnoBalance)) {
      maxGnoBalance = snapshot.balance;
    }
  }

  safeAddressWeekSnapshot.save();
}

function toGnosisSafeWeeklySnapshotEntityId(week: string, safe: Address): string {
  return `${week}/${safe.toHexString().toLowerCase()}`;
}
