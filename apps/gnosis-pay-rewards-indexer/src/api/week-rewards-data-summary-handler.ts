import { gnoToken, WeekIdFormatType } from '@kpk/gnosis-pay-rewards-sdk';
import { CreateModelsReturnType } from '@kpk/gnosis-pay-rewards-sdk/mongoose';
import { Address, PublicClient, Transport } from 'viem';
import { gnosis } from 'viem/chains';
import { ensureTokenBalanceSnapshots } from './ensure-token-balance-snapshots.ts';
import { findLowestMetriWalletGnoBalance, TokenBalanceSnapshotWithTokenFieldsType } from './min-balance-functions.ts';
import type { BlockInfoProvider } from '../lib/block-info-provider.ts';
import type { Logger } from 'winston';

type Deps = {
  logger?: Logger;
  mongooseModels: CreateModelsReturnType;
  blockInfoProvider: BlockInfoProvider;
  client: PublicClient<Transport, typeof gnosis>;
};
type Params = {
  addresses: Address[];
  week: WeekIdFormatType;
};

export type MetriSafesWeekRewardsDataSummaryResult = {
  metriAddress: Address;
  gnosisPayAddress: Address | null;
  minGnoBalance: number;
  isOG: boolean;
  tokenBalanceSnapshots: TokenBalanceSnapshotWithTokenFieldsType[];
};

/**
 * Core function to get week rewards data summary for metri safes
 * Returns array of results with metri address, gnosis pay address, minimum GNO balance, and isOG status
 */
export async function getMetriSafesWeekRewardsDataSummary(
  deps: Deps,
  params: Params,
): Promise<MetriSafesWeekRewardsDataSummaryResult[]> {
  const { mongooseModels, blockInfoProvider, client, logger } = deps;
  const { addresses, week } = params;

  // Normalize addresses to lowercase for querying (addresses are stored in lowercase)
  const metriAddresses = addresses.map((addr) => addr.toLowerCase() as Address);

  // Get metri safes for the specified addresses with populated gnosisPaySafe
  const metriSafes = await mongooseModels.metriSafeModel
    .find({
      address: { $in: metriAddresses },
    })
    .select('address isOG gnosisPaySafe')
    .lean();

  // Create a map of found addresses for quick lookup
  const foundMetriAddressesMap = new Map(metriSafes.map((safe) => [safe.address.toLowerCase() as Address, safe]));

  // For each requested address, calculate minimum GNO balance
  const results = await Promise.all(
    metriAddresses.map(
      async (metriAddress): Promise<MetriSafesWeekRewardsDataSummaryResult> => {
        const metriSafe = foundMetriAddressesMap.get(metriAddress);
        const gnosisPaySafeAddress = metriSafe?.gnosisPaySafe as Address | null;
        const isOG = metriSafe?.isOG ?? false;

        let minGnoBalance = 0;

        await ensureTokenBalanceSnapshots({
          logger,
          blockInfoProvider,
          client,
          tokenBalanceSnapshotModel: mongooseModels.tokenBalanceSnapshotModel,
          safeModel: mongooseModels.metriSafeModel,
          safeWeekRewardsSnapshotModel: mongooseModels.safeWeekRewardsSnapshotModel,
        }, {
          safeAddress: metriAddress,
          tokenBalanceSnapshots: [],
          snapshotTokens: [gnoToken], // just GNO for now
        });

        // For Gnosis pay too
        if (gnosisPaySafeAddress) {
          await ensureTokenBalanceSnapshots({
            blockInfoProvider,
            client,
            tokenBalanceSnapshotModel: mongooseModels.tokenBalanceSnapshotModel,
            safeModel: mongooseModels.gnosisPaySafeModel,
            safeWeekRewardsSnapshotModel: mongooseModels.safeWeekRewardsSnapshotModel,
          }, {
            safeAddress: gnosisPaySafeAddress,
            tokenBalanceSnapshots: [],
            snapshotTokens: [gnoToken],
          });
        }

        const lowestGnoBalance = await findLowestMetriWalletGnoBalance({
          metriSafeAddress: metriAddress,
          gnosisPaySafeAddress,
          week,
          tokenBalanceSnapshotModel: mongooseModels.tokenBalanceSnapshotModel,
        });

        minGnoBalance = lowestGnoBalance;

        return {
          metriAddress,
          gnosisPayAddress: gnosisPaySafeAddress ?? null,
          minGnoBalance,
          isOG,
          tokenBalanceSnapshots: [], // Empty since we're using the calculated minimum balance
        };
      },
    ),
  );

  return results;
}
