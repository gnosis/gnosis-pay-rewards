import { Mongoose, PaginateModel, Schema } from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';
import { Address, isAddress, isHash } from 'viem';

import { mongooseSchemaAddressField, mongooseSchemaHashField } from './shared-schema-fields.js';
import { isValidWeekId } from '../../week-functions.js';
import { RewardTransactionFieldsType } from '../../database/reward-transaction-zod.js';
import { blockModelName } from './block.js';
import { tokenModelName } from './token.js';

export const rewardTransactionModelName = 'RewardTransaction' as const;
export const rewardTransactionCollectionName = 'reward_transactions' as const;

export const rewardTransactionSchema = new Schema<RewardTransactionFieldsType>(
  {
    _id: {
      type: String,
      required: true,
      validate: {
        validator: (value: string) => {
          const [transactionHash, address, transactionLogIndex] = value.split('/');
          return (
            isHash(transactionHash) &&
            isAddress(address) &&
            (transactionLogIndex === undefined || !isNaN(Number(transactionLogIndex)))
          );
        },
        message: '{VALUE} is not a valid hash. Expected format: transactionHash/address[/transactionLogIndex]',
      },
    },
    transactionHash: mongooseSchemaHashField,
    block: { type: Number, required: true, ref: blockModelName },
    amount: { type: Number, required: true },
    valueUSD: { type: Number, required: true },
    valueEUR: { type: Number, required: true },
    valueGBP: { type: Number, required: true },
    from: { ...mongooseSchemaAddressField, required: true },
    recipient: { ...mongooseSchemaAddressField, required: true },
    token: {
      ...mongooseSchemaAddressField,
      ref: tokenModelName,
      required: true,
    },
    week: {
      type: String,
      required: false,
      validate: {
        validator: (value: string) => isValidWeekId(value),
        message: '{VALUE} is not a valid week ID. Expected format: YYYY-MM-DD',
      },
      default: null,
    },
  },
  {
    collection: rewardTransactionCollectionName,
  },
)
  // Critical indexes for performance
  .index({ from: 1, block: -1 })
  .index({ week: 1 })
  .index({ token: 1, week: 1 })
  .index({ recipient: 1, week: 1 })
  .plugin(mongoosePaginate)
  .pre('save', function (next) {
    this.from = this.from.toLowerCase() as Address;
    this.recipient = this.recipient.toLowerCase() as Address;
    this.token = this.token.toLowerCase() as Address;
    this.transactionHash = this.transactionHash.toLowerCase() as `0x${string}`;
    next();
  });

export type RewardTransactionModelType = PaginateModel<RewardTransactionFieldsType> & {
  /**
   * Create a document ID from a transaction hash and address.
   * @param transactionHash - The transaction hash.
   * @param address - The address.
   * @param transactionLogIndex - The transaction log index.
   * @returns The document ID.
   */
  createDocumentId(transactionHash: `0x${string}`, address: Address, transactionLogIndex?: number): string;
};

rewardTransactionSchema.statics.createDocumentId = function createDocumentId(
  transactionHash: `0x${string}`,
  address: Address,
  transactionLogIndex?: number,
) {
  const parts = [transactionHash, address.toLowerCase()];
  if (transactionLogIndex !== undefined) {
    parts.push(transactionLogIndex.toString());
  }

  return parts.join('/') as string;
};

/**
 * Create a model for the GnosisPayRewardDistribution collection.
 * @param mongooseConnection - The mongoose connection.
 * @returns The model for the GnosisPayRewardDistribution collection.
 */
export function createGnosisPayRewardDistributionModel(mongoose: Mongoose): RewardTransactionModelType {
  return (mongoose.models[rewardTransactionModelName] ??
    mongoose.model(rewardTransactionModelName, rewardTransactionSchema)) as unknown as RewardTransactionModelType;
}
