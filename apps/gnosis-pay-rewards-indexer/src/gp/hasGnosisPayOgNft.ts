import { gnosisPayOgNftAddress, gnosisPayOgNftV2Address } from '@karpatkey/gnosis-pay-rewards-sdk';
import { Address, PublicClient, Transport, erc721Abi } from 'viem';
import { gnosis } from 'viem/chains';

export async function hasGnosisPayOgNft(
  client: PublicClient<Transport, typeof gnosis>,
  userAddressArray: Address[],
): Promise<boolean[]> {
  const mcResult = await client.multicall({
    allowFailure: false,
    contracts: userAddressArray.map((address) => ({
      abi: erc721Abi,
      address: gnosisPayOgNftAddress,
      functionName: 'balanceOf',
      args: [address],
    })),
  });

  const returnValue = mcResult.map((result) => {
    if (typeof result === 'bigint' && result > 0n) {
      return true;
    }

    return false;
  });

  return returnValue;
}

export async function hasGnosisPayOgNftV2(
  client: PublicClient<Transport, typeof gnosis>,
  safeAddresses: Address[],
): Promise<boolean[]> {
  const mcResult = await client.multicall({
    allowFailure: false,
    contracts: safeAddresses.map((address) => ({
      abi: erc721Abi,
      address: gnosisPayOgNftV2Address,
      functionName: 'balanceOf',
      args: [address],
    })),
  });

  return mcResult.map((result) => {
    if (typeof result === 'bigint' && result > 0n) {
      return true;
    }

    return false;
  });
}
