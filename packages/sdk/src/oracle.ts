import {
  Address,
  PublicClient,
  Transport,
  formatUnits,
  getContract,
  isAddress,
  isAddressEqual,
  zeroAddress,
} from 'viem';
import { gnosis } from 'viem/chains';
import type { ConditionalReturnType } from './utils';

type TokenOraclePriceDataType = {
  price: number;
  decimals: number;
  round: {
    roundId: bigint;
    answer: bigint;
    startedAt: bigint;
    updatedAt: bigint;
    answeredInRound: bigint;
  };
};

export async function getOraclePriceAtBlockNumber({
  client,
  blockNumber,
  oracle,
}: {
  client: PublicClient<Transport, typeof gnosis>;
  blockNumber: bigint;
  oracle: Address;
}): Promise<ConditionalReturnType<true, TokenOraclePriceDataType, Error> | ConditionalReturnType<false, null, Error>> {
  try {
    if (!isAddress(oracle)) {
      throw new Error(`Oracle address (${oracle}) is not valid`);
    }

    if (isAddressEqual(oracle, zeroAddress)) {
      throw new Error(`Oracle address (${oracle}) is zero`);
    }

    const oracleContract = getContract({
      abi: chornicleOracleAbi,
      address: oracle,
      client,
    });

    const [roundId, answer, startedAt, updatedAt, answeredInRound] = await oracleContract.read.latestRoundData({
      blockNumber,
      account: zeroAddress,
    });

    const decimals = await oracleContract.read.decimals();
    const price = Number(formatUnits(answer, decimals));

    return {
      error: null,
      data: {
        price,
        decimals,
        round: {
          roundId,
          answer,
          startedAt,
          updatedAt,
          answeredInRound,
        },
      },
    };
  } catch (error) {
    return {
      error: error as Error,
      data: null,
    };
  }
}

const chornicleOracleAbi = [
  // ... other ABI definitions ...
  {
    inputs: [],
    name: 'latestRoundData',
    outputs: [
      { internalType: 'uint80', name: 'roundId', type: 'uint80' },
      { internalType: 'int256', name: 'answer', type: 'int256' },
      { internalType: 'uint256', name: 'startedAt', type: 'uint256' },
      { internalType: 'uint256', name: 'updatedAt', type: 'uint256' },
      { internalType: 'uint80', name: 'answeredInRound', type: 'uint80' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  // decimals
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ internalType: 'uint8', name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
  // ... other ABI definitions ...
] as const;
