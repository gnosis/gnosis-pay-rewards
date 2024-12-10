import { Address, log, Bytes } from '@graphprotocol/graph-ts';

import { getGnosisPaySafeOwners } from './gp/getGnosisPaySafeOwners';
import { GnosisPaySafe } from '../generated/schema';
import { hasGnosisPayOgNft } from './gp/hasGnosisPayOgNft';

export function getOrCreateGnosisPaySafe(safeAddress: Address): GnosisPaySafe | null {
  const entityId = safeAddress.toHexString();
  let safeEntity = GnosisPaySafe.load(entityId);
  const safeOwners = getGnosisPaySafeOwners(safeAddress);

  if (safeEntity != null) {
    if (safeOwners !== null && safeOwners.length) {
      debugSafeOwners(safeAddress, safeOwners);
      safeEntity.owners = changetype<Bytes[]>(safeOwners);
      safeEntity.save();
    }

    return safeEntity;
  }

  // Without owners, we can't create a safe
  if (safeOwners == null || safeOwners.length === 0) {
    return null;
  }

  debugSafeOwners(safeAddress, safeOwners);

  safeEntity = new GnosisPaySafe(entityId);
  safeEntity.address = safeAddress;
  safeEntity.owners = changetype<Bytes[]>(safeOwners);
  safeEntity.isOg = hasGnosisPayOgNft(safeOwners);
  safeEntity.save();

  return safeEntity;
}

function debugSafeOwners(safeAddress: Address, safeOwners: Address[] | null): void {
  const safeOwnersAsText: string[] = [];
  if (safeOwners != null) {
    for (let i = 0; i < safeOwners.length; i++) {
      safeOwnersAsText.push(safeOwners[i].toHexString());
    }
  }

  log.info('getOrCreateGnosisPaySafe_safeOwners: {} owners: {}', [
    safeAddress.toHexString(),
    safeOwnersAsText.join(', '),
  ]);
}
