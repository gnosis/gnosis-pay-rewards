import type { CreateModelsReturnType } from '@kpk/gnosis-pay-rewards-sdk/mongoose';
import type { Block } from 'viem';
import type { BlockInfoProvider } from '../lib/block-info-provider.ts';

type HandleSaveBlockDependencies = {
  mongooseModels: CreateModelsReturnType;
  blockInfoProvider: BlockInfoProvider;
};

export async function handleSaveBlock(
  { mongooseModels, blockInfoProvider }: HandleSaveBlockDependencies,
  block: Block | number,
) {
  const blockInfo = await blockInfoProvider.getBlockInfo(block);
  const existingBlock = await mongooseModels.blockModel.findOne({
    number: blockInfo.number,
  });
  if (existingBlock) {
    return;
  }

  return new mongooseModels.blockModel({
    ...blockInfo,
    _id: blockInfo.number,
  }).save();
}
