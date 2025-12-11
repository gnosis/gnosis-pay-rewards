import { createGnosisPaySafeDocument, GnosisPaySafeModelType } from '@kpk/gnosis-pay-rewards-sdk/mongoose';
import { Address, isAddress } from 'viem';

import { getGnosisPayClaimOgNftLogs } from '../gp/getGnosisPayClaimOgNftLogs.ts';
import { getGnosisPaySafeOwners } from '../gp/getGnosisPaySafeOwners.ts';
import { isGnosisPaySafeAddress } from '../gp/isGnosisPaySafeAddress.ts';
import { GnosisChainPublicClient } from './types.ts';

type MongooseModels = {
  gnosisPaySafeModel: GnosisPaySafeModelType;
};

type CommonParams = {
  log: Awaited<ReturnType<typeof getGnosisPayClaimOgNftLogs>>[number];
  mongooseModels: MongooseModels;
  client: GnosisChainPublicClient;
};

export async function processGnosisPayClaimOgNftLog(params: CommonParams) {
  try {
    const nftReceiver = params.log.args.to?.toLowerCase() as Address;

    const { isGnosisPaySafe } = await isGnosisPaySafeAddress({
      address: nftReceiver,
      client: params.client,
      gnosisPaySafeModel: params.mongooseModels.gnosisPaySafeModel,
    });

    const data = isGnosisPaySafe
      ? await handleNftMintedToGnosisPaySafe(params)
      : await handleNftMintedToSafeOwner(params);

    return {
      data,
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error: error as Error,
    };
  }
}

/**
 * This logic is no longer needed, because the OG NFT is no longer minted to the safe owner.
 * @param params
 * @returns
 */
async function handleNftMintedToSafeOwner(params: CommonParams) {
  const { log, mongooseModels, client } = params;
  const { gnosisPaySafeModel } = mongooseModels;
  const { blockNumber } = log;

  // The OF NFT is minted to the safe owner
  const safeOwner = log.args.to?.toLowerCase() as Address;

  // to address must exist
  if (!isAddress(safeOwner)) {
    throw new Error(`Invalid to address: ${safeOwner}`);
  }

  const safesWithOwner = await gnosisPaySafeModel.find({
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
  safe.isOG = true;

  // While at it, if the owners are different, we need to update the safe
  // TODO: Create a new event handler on the Delay module for this
  if (JSON.stringify(safe.owners.sort()) !== JSON.stringify(newOwners.sort())) {
    safe.owners = newOwners;
  }

  const updatedSafe = await safe.save();
  return updatedSafe.toJSON();
}

/**
 * Handles NFT minted to the Gnosis Pay Safe directly.
 * @param params
 */
async function handleNftMintedToGnosisPaySafe(params: CommonParams) {
  const { log, mongooseModels } = params;
  // The OF NFT is minted to the safe owner
  const safeAddress = log.args.to?.toLowerCase() as Address;
  const { gnosisPaySafeModel } = mongooseModels;
  const safe = await gnosisPaySafeModel.findOne({
    address: safeAddress,
  });

  // If a Safe document doesn't exist, we have to create it
  if (safe === null) {
    const { data: owners, error } = await getGnosisPaySafeOwners({
      client: params.client,
      safeAddress,
      blockNumber: log.blockNumber,
    });

    if (error) {
      throw error;
    }

    const newGnosisPaySafeDocument = await createGnosisPaySafeDocument(
      gnosisPaySafeModel,
      {
        safeAddress,
        owners,
        isOG: true, // The OF NFT is minted to the safe owner
      },
    );

    return newGnosisPaySafeDocument.toJSON();
  }

  // The safe already exists, so we need to update the isOg field
  safe.isOG = true;
  const updatedSafe = await safe.save();
  return updatedSafe.toJSON();
}
