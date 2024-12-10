import { GnosisPaySafeAddressModelType } from '@karpatkey/gnosis-pay-rewards-sdk/mongoose';
import { Address, ContractFunctionZeroDataError, getContract, isAddressEqual, PublicClient, Transport } from 'viem';
import { gnosis } from 'viem/chains';

import { gnosisPaySafeAvatarFunctionAbiItem } from './commons.js';
import { getGnosisPaySafeModules } from './getGnosisPaySafeOwners.js';

/**
 * Check if an address is a Gnosis Safe address.
 * Warning: This function is not 100% accurate.
 * It may return false positives due to the fact that anyone can deploy a contract that mimics a Gnosis Pay Safe.
 *
 * @returns Whether the address is a Gnosis Safe address.
 */
export async function isGnosisPaySafeAddress({
  address,
  client,
  gnosisPaySafeAddressModel,
}: {
  address: Address;
  /**
   * The public client to use to do onchain checks
   */
  client: PublicClient<Transport, typeof gnosis>;
  /**
   * The mongoose model to use to check if the address is a Gnosis Safe address in the database
   */
  gnosisPaySafeAddressModel: GnosisPaySafeAddressModelType;
}): Promise<{
  isGnosisPaySafe: boolean;
  source: 'chain' | 'database';
}> {
  // Priority 1: Check if the address is a Gnosis Safe address in the database
  const safeAddressEntity = await gnosisPaySafeAddressModel.exists({
    address: address.toLowerCase(),
  });

  if (safeAddressEntity !== null) {
    return {
      isGnosisPaySafe: true,
      source: 'database',
    };
  }

  let isGnosisPaySafe = false;

  const contractBytecode = await client.getBytecode({
    address,
  });

  // Not bytecode means it's not a contract
  if (!contractBytecode) {
    return {
      isGnosisPaySafe,
      source: 'chain',
    };
  }

  try {
    // Check the chain if the address is a Gnosis Safe
    const safeModules = await getGnosisPaySafeModules({
      client,
      safeAddress: address,
    });

    // First module is the delay module
    const [delayModuleBytecode, rolesModuleBytecode] = await Promise.all([
      client.getBytecode({
        address: safeModules[0],
      }),
      client.getBytecode({
        address: safeModules[1],
      }),
    ]);

    if (delayModuleBytecode && rolesModuleBytecode) {
      const delayModuleContract = getContract({
        address: safeModules[0],
        abi: [gnosisPaySafeAvatarFunctionAbiItem],
        client,
      });

      const rolesModuleContract = getContract({
        address: safeModules[1],
        abi: [gnosisPaySafeAvatarFunctionAbiItem],
        client,
      });

      const isDelayModuleAvatarEqualSafeAddress = isAddressEqual(await delayModuleContract.read.avatar(), address);
      const isRolesModuleAvatarEqualSafeAddress = isAddressEqual(await rolesModuleContract.read.avatar(), address);

      if (isDelayModuleAvatarEqualSafeAddress && isRolesModuleAvatarEqualSafeAddress) {
        isGnosisPaySafe = true;
      }
    }
  } catch (e) {
    if (e instanceof ContractFunctionZeroDataError) {
      // Not a Gnosis Safe
      return {
        isGnosisPaySafe: false,
        source: 'chain',
      };
    }
  }

  return {
    isGnosisPaySafe,
    source: 'chain',
  };
}
