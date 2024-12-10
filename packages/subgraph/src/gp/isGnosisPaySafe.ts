import { Address } from '@graphprotocol/graph-ts';
import { GnosisPaySafe } from '../../generated/schema';
import { getGnosisPaySafeModules } from './getGnosisPaySafeOwners';

export function isGnosisPaySafe(safeAddress: Address): boolean {
  // Load the safe entity
  const safeEntity = GnosisPaySafe.load(safeAddress.toHexString());

  if (safeEntity == null) {
      const safeModuleResult = getGnosisPaySafeModules(safeAddress);

    if (safeModuleResult.reverted || safeModuleResult.modules.length === 0) {
      return false;
    }

    return false;
  }

  return true;
}
