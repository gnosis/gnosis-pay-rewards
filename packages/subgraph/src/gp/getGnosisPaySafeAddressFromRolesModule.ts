import { Address } from '@graphprotocol/graph-ts';
import { SafeModule as SafeModuleContract } from '../../generated/GnosisPaySpender/SafeModule';
import { addressZero } from '../constants';

export function getGnosisPaySafeAddressFromRolesModule(rolesModuleAddress: Address): Address {
  const safeModuleContract = SafeModuleContract.bind(rolesModuleAddress).try_avatar();

  if (safeModuleContract.reverted) {
    return addressZero;
  }

  return safeModuleContract.value;
}
