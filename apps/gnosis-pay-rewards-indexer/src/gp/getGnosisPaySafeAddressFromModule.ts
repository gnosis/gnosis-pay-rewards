import { Address, PublicClient, Transport } from 'viem';
import { gnosis } from 'viem/chains';
import { gnosisPaySafeAvatarFunctionAbiItem } from './commons.ts';

export async function getGnosisPaySafeAddressFromModule({
  rolesModuleAddress,
  client,
  blockNumber,
}: {
  rolesModuleAddress: Address;
  client: PublicClient<Transport, typeof gnosis>;
  blockNumber: bigint;
}) {
  const gnosisPaySafeAddress = (await client.readContract({
    abi: [gnosisPaySafeAvatarFunctionAbiItem],
    functionName: 'avatar',
    address: rolesModuleAddress,
    blockNumber,
  })) as Address;

  return gnosisPaySafeAddress;
}
