import { Address, BigInt } from '@graphprotocol/graph-ts';
import { Erc20 } from '../../generated/templates/GnosisPayToken/Erc20';

const gnosisPayOgNftAddress = Address.fromString('0x88997988a6A5aAF29BA973d298D276FE75fb69ab');

/**
 * Check if the address has a Gnosis Pay OG NFT, returns true if any of the addresses has an OG NFT
 * @param addresses The addresses to check
 * @returns True if the address has a Gnosis Pay OG NFT, false otherwise
 */
export function hasGnosisPayOgNft(addresses: Address[]): boolean {
  const ogNftContract = Erc20.bind(gnosisPayOgNftAddress);

  for (let i = 0; i < addresses.length; i++) {
    const address = addresses[i];

    const balance = ogNftContract.balanceOf(address);
    if (balance.gt(BigInt.fromI32(0))) {
      return true;
    }
  }

  return false;
}
