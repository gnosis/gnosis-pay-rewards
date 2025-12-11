import { GnosisPaySafeModelType } from '@kpk/gnosis-pay-rewards-sdk/mongoose';
import { Address, ContractFunctionZeroDataError, getContract, isAddressEqual, PublicClient, Transport } from 'viem';
import { gnosis } from 'viem/chains';

import { gnosisPaySafeAvatarFunctionAbiItem } from './commons.ts';
import { getGnosisPaySafeModules } from './getGnosisPaySafeOwners.ts';

type IsGnosisPaySafeAddressReturnType_Database = {
  isGnosisPaySafe: true;
  source: 'database';
  error: null;
};

type IsGnosisPaySafeAddressReturnType_Chain = {
  isGnosisPaySafe: boolean;
  source: 'chain';
  error: Error | null;
  safeModules: Address[] | null;
};

type IsGnosisPaySafeAddressReturnType =
  | IsGnosisPaySafeAddressReturnType_Database
  | IsGnosisPaySafeAddressReturnType_Chain;

type Code =
  | 'HAS_NO_BYTECODE'
  | 'HAS_NO_GNOSIS_PAY_SAFE_MODULES'
  | 'IS_NOT_GNOSIS_PAY_SAFE_ADDRESS'
  | 'MODULE_AVATAR_NOT_EQUAL_TO_ADDRESS'
  | 'CONTRACT_FUNCTION_ZERO_DATA_ERROR'
  | 'UNKNOWN_ERROR';

class IsNotGnosisPaySafeAddressError extends Error {
  errorCode: Code;
  override name = 'IsNotGnosisPaySafeAddressError';

  constructor(address: Address, errorCode: Code) {
    super(`Address ${address} is not a Gnosis Pay Safe address`, {
      cause: errorCode,
    });
    this.errorCode = errorCode;
  }
}

/**
 * Check if an address is a Gnosis Safe address.
 * Warning: This function is not 100% accurate.
 * It may return false positives due to the fact that anyone can deploy a contract that mimics a Gnosis Pay Safe.
 *
 * @returns Whether the address is a Gnosis Safe address.
 */
export async function isGnosisPaySafeAddress(params: {
  address: Address;
  /**
   * The public client to use to do onchain checks
   */
  client: PublicClient<Transport, typeof gnosis>;
  /**
   * The mongoose model to use to check if the address is a Gnosis Safe address in the database
   */
  gnosisPaySafeModel: GnosisPaySafeModelType;
}): Promise<IsGnosisPaySafeAddressReturnType> {
  const { address, client, gnosisPaySafeModel } = params;
  // Priority 1: Check if the address is a Gnosis Safe address in the database
  const safeAddressEntity = await gnosisPaySafeModel.exists({
    address: address.toLowerCase(),
  });

  // A Record exists in the database means it's a Gnosis Safe address
  if (safeAddressEntity !== null) {
    const returnValueDatabase: IsGnosisPaySafeAddressReturnType_Database = {
      isGnosisPaySafe: true,
      source: 'database',
      error: null,
    };

    return returnValueDatabase;
  }

  // After the database check, we can be sure that the address is not a Gnosis Safe address
  const returnValueChain: IsGnosisPaySafeAddressReturnType_Chain = {
    isGnosisPaySafe: false,
    source: 'chain',
    error: null,
    safeModules: null,
  };

  const contractBytecode = await client.getBytecode({
    address,
  });

  // Not bytecode means it's not a contract
  if (!contractBytecode) {
    returnValueChain.error = new IsNotGnosisPaySafeAddressError(
      address,
      'HAS_NO_BYTECODE',
    );
    return returnValueChain;
  }

  try {
    // Check the chain if the address is a Gnosis Safe
    const safeModules = await getGnosisPaySafeModules({
      client,
      safeAddress: address,
    });

    if (safeModules.length === 0) {
      returnValueChain.error = new IsNotGnosisPaySafeAddressError(
        address,
        'HAS_NO_GNOSIS_PAY_SAFE_MODULES',
      );
      return returnValueChain;
    }

    // First module is the delay module
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

      const isDelayModuleAvatarEqualSafeAddress = isAddressEqual(
        await delayModuleContract.read.avatar(),
        address,
      );
      const isRolesModuleAvatarEqualSafeAddress = isAddressEqual(
        await rolesModuleContract.read.avatar(),
        address,
      );

      if (
        isDelayModuleAvatarEqualSafeAddress &&
        isRolesModuleAvatarEqualSafeAddress
      ) {
        returnValueChain.isGnosisPaySafe = true;
      } else {
        returnValueChain.error = new IsNotGnosisPaySafeAddressError(
          address,
          'MODULE_AVATAR_NOT_EQUAL_TO_ADDRESS',
        );
        return returnValueChain;
      }
    }
  } catch (e) {
    if (e instanceof ContractFunctionZeroDataError) {
      // Not a Gnosis Safe
      returnValueChain.error = new IsNotGnosisPaySafeAddressError(
        address,
        'CONTRACT_FUNCTION_ZERO_DATA_ERROR',
      );
      return returnValueChain;
    }

    returnValueChain.error = new IsNotGnosisPaySafeAddressError(
      address,
      'UNKNOWN_ERROR',
    );
    return returnValueChain;
  }

  return returnValueChain;
}
