import { BigDecimal, BigInt, Bytes, log } from '@graphprotocol/graph-ts';
import { Transfer } from '../generated/templates/GnosisPayToken/Erc20';
import { GnosisPayTransaction, GnosisPayRewardDistribution } from '../generated/schema';

import { getOrCreateGnosisTokenBalanceSnapshot } from './gnosisTokenBalanceSnapshot';
import { gnosisPayRewardDistributionSafeAddress, gnosisPaySpenderModuleAddress, gnoToken } from './constants';
import { updateSafeAddressWeekSnapshot } from './updateSafeAddressWeekSnapshot';
import { timestampToWeekId } from './timestampToWeekId';
import { createTokenEntity, formatUnits, isTokenSupported, tokenEntityToTokenAddressWithOracle } from './tokens';

export function handleTransfer(event: Transfer): void {
  // Not a token supported by the subgraph
  if (!isTokenSupported(event.address)) {
    return;
  }

  // Might be a refund by the GP team
  handleRefund(event);

  // GNO transfer, just get the balance snapshot
  if (event.address.equals(gnoToken.address)) {
    // GNO reward distribution
    handleRewardDistribution(event);
    getOrCreateGnosisTokenBalanceSnapshot(event.block.number, event.block.timestamp, event.params.to);
  }
}

function handleRefund(event: Transfer): void {
  // Refunds are only from the Gnosis Pay Spender Module
  if (!event.params.from.equals(gnosisPaySpenderModuleAddress)) {
    return;
  }

  const tokenAddress = event.address;
  const tokenEntity = createTokenEntity(tokenAddress);
  const tokenAddressWithOracle = tokenEntityToTokenAddressWithOracle(tokenEntity);
  const tokenUsdPrice = tokenAddressWithOracle.getTokenUsdPrice();

  const gnosisPaySafeAddress = event.params.to;
  // Get the current gno balance of the safe
  const gnoBalanceSnapshot = getOrCreateGnosisTokenBalanceSnapshot(
    event.block.number,
    event.block.timestamp,
    gnosisPaySafeAddress
  );

  if (gnoBalanceSnapshot == null) {
    log.warning('handleRefund: could not get Gnosis token balance snapshot', [gnosisPaySafeAddress.toHexString()]);
    return;
  }

  // Refund value
  const valueRaw = event.params.value;
  const value = formatUnits(valueRaw, tokenEntity.decimals);
  const valueUsd = tokenUsdPrice !== null ? value.times(tokenUsdPrice) : BigDecimal.fromString('0');

  const gnosisPayTransactionEntity = new GnosisPayTransaction(event.transaction.hash);
  gnosisPayTransactionEntity.token = tokenEntity.id;

  // Convert to the token's decimals
  gnosisPayTransactionEntity.valueRaw = valueRaw;
  gnosisPayTransactionEntity.value = value;
  gnosisPayTransactionEntity.valueUsd = valueUsd;
  gnosisPayTransactionEntity.blockNumber = event.block.number.toI32();
  gnosisPayTransactionEntity.blockTimestamp = event.block.timestamp.toI32();
  gnosisPayTransactionEntity.safe = gnosisPaySafeAddress.toHexString();
  gnosisPayTransactionEntity.type = 'REFUND';
  gnosisPayTransactionEntity.gnoBalance = gnoBalanceSnapshot.balance;
  gnosisPayTransactionEntity.save();
  updateSafeAddressWeekSnapshot(gnosisPaySafeAddress, gnosisPayTransactionEntity);
}

function handleRewardDistribution(event: Transfer): void {
  const tokenAddress = event.address;
  const safeAddress = event.params.to;
  const sender = event.params.from;

  // Token must be a GNO
  if (!tokenAddress.equals(gnoToken.address)) {
    return;
  }

  // The sender is the Gnosis Pay Distributor
  if (!sender.equals(gnosisPayRewardDistributionSafeAddress)) {
    return;
  }

  const gnoTokenEntity = createTokenEntity(tokenAddress);

  // Create a unique identifier for the distribution
  const entityId = `${event.transaction.hash.toHexString()}/${safeAddress.toHexString()}`;

  const distributionEntity = new GnosisPayRewardDistribution(Bytes.fromUTF8(entityId));
  distributionEntity.week = timestampToWeekId(event.block.timestamp);
  distributionEntity.safe = safeAddress.toHexString();
  distributionEntity.amountRaw = event.params.value;
  distributionEntity.amount = formatUnits(event.params.value, gnoTokenEntity.decimals);
  distributionEntity.transactionHash = event.transaction.hash;
  // Block info
  distributionEntity.blockNumber = event.block.number.toI32();
  distributionEntity.blockTimestamp = event.block.timestamp.toI32();
  distributionEntity.save();
}
