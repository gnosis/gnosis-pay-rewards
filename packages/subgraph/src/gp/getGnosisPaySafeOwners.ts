import { Address, BigInt, ethereum } from '@graphprotocol/graph-ts';
import { SafeModule } from '../../generated/GnosisPaySpender/SafeModule';

const sentientAddress = Address.fromString('0x0000000000000000000000000000000000000001');

/**
 * Get the owners of the Gnosis Pay Safe
 */
export function getGnosisPaySafeOwners(safe: Address): Address[] | null {
  // The first module is the Delay module
  const safeModuleResult = getGnosisPaySafeModules(safe);

  // If there are no modules, return an empty array
  if (safeModuleResult.reverted) {
    return null;
  }

  if (safeModuleResult.modules.length === 0) {
    return null;
  }

  // Always the first module is the Delay module
  const delayModuleAddress = safeModuleResult.modules[0];

  // The list of owners are stored in the Delay module
  const safeOwnersResult = SafeModule.bind(delayModuleAddress).try_getModulesPaginated(
    sentientAddress,
    BigInt.fromI32(100)
  );

  if (safeOwnersResult.reverted) {
    return null;
  }

  return safeOwnersResult.value.getArray();
}

class SafeModuleResult {
  modules: Address[];
  reverted: boolean;

  constructor(modules: Address[], reverted: boolean) {
    this.modules = modules;
    this.reverted = reverted;
  }
}

export function getGnosisPaySafeModules(safeAddress: Address): SafeModuleResult {
  // No code, not a safe
  if (!ethereum.hasCode(safeAddress)) {
    return new SafeModuleResult([], true);
  }

  // Find the Delay
  const result = SafeModule.bind(safeAddress).try_getModulesPaginated(sentientAddress, BigInt.fromI32(100));

  if (result.reverted) {
    return new SafeModuleResult([], true);
  }

  return new SafeModuleResult(result.value.getArray(), false);
}
