import { Address, BigDecimal, BigInt, ethereum, log } from '@graphprotocol/graph-ts';
import { Spend } from '../generated/GnosisPaySpender/GnosisPaySpender';
import { areTokensMigrated, createTokenEntity, formatUnits, getTokenUsdPrice, migrateTokens } from './tokens';
import { getOrCreateGnosisTokenBalanceSnapshot } from './gnosisTokenBalanceSnapshot';
import { GlobalState, GnosisPayTransaction } from '../generated/schema';
import { getGnosisPaySafeAddressFromRolesModule } from './gp/getGnosisPaySafeAddressFromRolesModule';
import { updateSafeAddressWeekSnapshot } from './updateSafeAddressWeekSnapshot';
import { getOrCreateGnosisPaySafe } from './getOrCreateGnosisPaySafe';
import { timestampToWeekId } from './timestampToWeekId';
import { addressZero } from './constants';

const BI_18 = BigInt.fromI32(18);

export function handleSpend(event: Spend): void {
  const tokenAddress = event.params.asset;
  const tokenEntity = createTokenEntity(tokenAddress);
  const tokenUsdPrice = getTokenUsdPrice(Address.fromBytes(tokenEntity.oracle));

  const valueRaw = event.params.amount; // 18 decimals
  const value = formatUnits(valueRaw, tokenEntity.decimals);
  const valueUsd = value.times(tokenUsdPrice);

  // Get the safe address from the its module
  const gnosisPaySafeAddress = getGnosisPaySafeAddressFromRolesModule(event.params.account);

  if (gnosisPaySafeAddress.equals(addressZero)) {
    log.warning('handleSpend: could not get Safe address from Roles module. Account: {}', [
      event.params.account.toHexString(),
    ]);
    return;
  }

  const gnosisPaySafe = getOrCreateGnosisPaySafe(gnosisPaySafeAddress);

  if (gnosisPaySafe === null) {
    log.warning('handleSpend: could not create Gnosis Pay Safe. Safe address: {}', [
      gnosisPaySafeAddress.toHexString(),
    ]);
    return;
  }

  // Get the balance snapshot for the safe address
  const gnoBalanceSnapshot = getOrCreateGnosisTokenBalanceSnapshot(
    event.block.number,
    event.block.timestamp,
    gnosisPaySafeAddress
  );

  if (gnoBalanceSnapshot === null) {
    log.warning('handleSpend: could not get Gnosis token balance snapshot', [gnosisPaySafeAddress.toHexString()]);
    return;
  }

  // Create the transaction entity
  const gnosisPayTransactionEntity = new GnosisPayTransaction(event.transaction.hash);
  gnosisPayTransactionEntity.token = tokenEntity.id;

  gnosisPayTransactionEntity.valueRaw = valueRaw;
  gnosisPayTransactionEntity.value = value;
  gnosisPayTransactionEntity.valueUsd = valueUsd;

  gnosisPayTransactionEntity.blockNumber = event.block.number.toI32();
  gnosisPayTransactionEntity.blockTimestamp = event.block.timestamp.toI32();
  gnosisPayTransactionEntity.safe = gnosisPaySafe.id;
  gnosisPayTransactionEntity.type = 'SPEND';
  gnosisPayTransactionEntity.gnoBalance = gnoBalanceSnapshot.balance;
  gnosisPayTransactionEntity.estimatedReward = BigDecimal.fromString('0');
  gnosisPayTransactionEntity.save();
  updateSafeAddressWeekSnapshot(gnosisPaySafeAddress, gnosisPayTransactionEntity);
}

/**
 * Handle the block event
 * This function is called once when the subgraph is deployed,
 * It migrates all the tokens to the database and starts the indexing for token Transfer events
 * @param block
 */
export function handleOnce(block: ethereum.Block): void {
  // Save global state
  const globalState = new GlobalState('GLOBAL_STATE');
  globalState.startWeek = timestampToWeekId(block.timestamp);
  globalState.isInitialized = true;
  globalState.save();

  if (areTokensMigrated()) {
    return;
  }

  migrateTokens();
}
