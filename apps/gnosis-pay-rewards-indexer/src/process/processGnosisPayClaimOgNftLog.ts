import { GnosisPaySafeAddressModelType } from '@karpatkey/gnosis-pay-rewards-sdk/mongoose';
import { Address, isAddress } from 'viem';

import { getGnosisPayClaimOgNftLogs } from '../gp/getGnosisPayClaimOgNftLogs.js';
import { getGnosisPaySafeOwners } from '../gp/getGnosisPaySafeOwners.js';
import { GnosisChainPublicClient } from './types.js';

type MongooseModels = {
  gnosisPaySafeAddressModel: GnosisPaySafeAddressModelType;
};

export async function processGnosisPayClaimOgNftLog({
  log,
  mongooseModels,
  client,
}: {
  log: Awaited<ReturnType<typeof getGnosisPayClaimOgNftLogs>>[number];
  mongooseModels: MongooseModels;
  client: GnosisChainPublicClient;
}) {
  try {
    const { blockNumber } = log;
    const { gnosisPaySafeAddressModel } = mongooseModels;

    // The OF NFT is minted to the safe owner
    const safeOwner = log.args.to?.toLowerCase() as Address;

    // to address must exist
    if (!isAddress(safeOwner)) {
      throw new Error(`Invalid to address: ${safeOwner}`);
    }

    const safesWithOwner = await gnosisPaySafeAddressModel.find({
      owners: { $in: [safeOwner] },
    });

    if (safesWithOwner.length === 0) {
      throw new Error(`Safe does not exist: ${safeOwner}`, {
        cause: 'SAFE_DOES_NOT_EXIST',
      });
    }

    // Exact one safe must be found
    if (safesWithOwner.length !== 1) {
      throw new Error(`Multiple safe found for ${safeOwner}`, {
        cause: 'MULTIPLE_SAFE_FOUND',
      });
    }

    const [safe] = safesWithOwner;

    const { data: newOwners, error } = await getGnosisPaySafeOwners({
      client,
      safeAddress: safe.address,
      blockNumber,
    });

    if (error) {
      throw error;
    }

    if (newOwners.length === 0) {
      throw new Error(`No new owners found for ${safe.address}`, {
        cause: 'NO_NEW_OWNERS_FOUND',
      });
    }

    // Update the safe
    safe.isOg = true;

    // While at it, if the owners are different, we need to update the safe
    // TODO: Create a new event handler on the Delay module for this
    if (JSON.stringify(safe.owners.sort()) !== JSON.stringify(newOwners.sort())) {
      safe.owners = newOwners;
    }

    const updatedSafe = await safe.save();
    const updatedSafeJson = updatedSafe.toJSON();

    return {
      data: updatedSafeJson,
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error: error as Error,
    };
  }
}
