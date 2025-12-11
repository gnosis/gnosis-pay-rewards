import { CreateModelsReturnType } from '@kpk/gnosis-pay-rewards-sdk/mongoose';
import {
  GnoisPayTokenType,
  TokenBalanceSnapshotFieldsType,
  tokenBalanceSnapshotTokens,
  TokenFieldsType,
} from '@kpk/gnosis-pay-rewards-sdk';
import { Address, isAddressEqual, PublicClient, Transport } from 'viem';
import { gnosis } from 'viem/chains';
import { BlockInfoProvider } from '../lib/block-info-provider.ts';
import { takeTokenBalanceSnapshot } from '../process/token-transfer.ts';
import { Logger } from 'winston';

/**
 * Takes token balance snapshots for tokens that have less than three snapshots
 */
export async function ensureTokenBalanceSnapshots(
  deps: {
    tokenBalanceSnapshotModel: CreateModelsReturnType['tokenBalanceSnapshotModel'];
    safeModel: CreateModelsReturnType['gnosisPaySafeModel'] | CreateModelsReturnType['metriSafeModel'];
    safeWeekRewardsSnapshotModel: CreateModelsReturnType['safeWeekRewardsSnapshotModel'];
    client: PublicClient<Transport, typeof gnosis>;
    blockInfoProvider: BlockInfoProvider;
    logger?: Logger;
  },
  params: {
    safeAddress: Address;
    tokenBalanceSnapshots:
      | TokenBalanceSnapshotFieldsType[]
      | (Omit<TokenBalanceSnapshotFieldsType, 'token'> & { token: TokenFieldsType })[];
    snapshotTokens?: GnoisPayTokenType[];
  },
): Promise<void> {
  const snapshotTokens = params.snapshotTokens ?? tokenBalanceSnapshotTokens;

  const REQUIRED_SNAPSHOTS = 1;
  let allTokensHaveSnapshots = true;
  const tokensNeedingSnapshots: GnoisPayTokenType[] = [];

  for (const token of snapshotTokens) {
    const snapshotCount = params.tokenBalanceSnapshots.filter((snapshot) => {
      const tokenAddress = typeof snapshot.token === 'string'
        ? snapshot.token.toLowerCase()
        : snapshot.token.address.toLowerCase();
      return isAddressEqual(tokenAddress, token.address.toLowerCase());
    }).length;

    if (snapshotCount < REQUIRED_SNAPSHOTS) {
      allTokensHaveSnapshots = false;
      tokensNeedingSnapshots.push(token);
    }
  }

  if (allTokensHaveSnapshots) {
    deps.logger?.info(
      'All token (',
      snapshotTokens.map((token) => token.symbol).join(', '),
      ') have at least ',
      REQUIRED_SNAPSHOTS,
      ' snapshots for ',
      params.safeAddress,
    );
    return;
  }

  // Take snapshots only for tokens that have less than 3 snapshots
  await Promise.all(
    tokensNeedingSnapshots.map((token) =>
      takeTokenBalanceSnapshot(
        {
          tokenBalanceSnapshotModel: deps.tokenBalanceSnapshotModel,
          safeModel: deps.safeModel,
          safeWeekRewardsSnapshotModel: deps.safeWeekRewardsSnapshotModel,
          client: deps.client,
          blockInfoProvider: deps.blockInfoProvider,
        },
        {
          address: params.safeAddress,
          token,
        },
      ).catch((error) => {
        // Log error but don't throw - snapshot failures for individual tokens shouldn't break the flow
        deps.logger?.error(`Failed to take token snapshot for ${params.safeAddress} token ${token.symbol}:`, error);
      })
    ),
  );
}
