import { Model, Mongoose, Schema } from 'mongoose';

import { mongooseSchemaAddressField, mongooseSchemaHashField } from './sharedSchemaFields';
import { Address, isAddress, isHash } from 'viem';
import { isValidWeekId, WeekIdFormatType } from '../week-functions';

export const gnosisPayRewardDistributionModelName = 'GnosisPayRewardDistribution' as const;

type DocumentIdType = `${`0x${string}`}`;

export type GnosisPayRewardDistributionDocumentFieldsType = {
  /**
   * The document ID is either the transaction hash or the transaction hash and the address and transaction log index.
   * This is used to ensure that the document is unique and to allow for efficient querying.
   */
  _id: DocumentIdType;
  transactionHash: `0x${string}`;
  blockNumber: number;
  amount: number;
  safe: Address;
  week: WeekIdFormatType | null;
};

export const gnosisPayRewardDistributionSchema = new Schema<GnosisPayRewardDistributionDocumentFieldsType>({
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
  blockNumber: { type: Number, required: true },
  amount: { type: Number, required: true },
  safe: mongooseSchemaAddressField,
  week: {
    type: String,
    required: false,
    validate: {
      validator: (value: string) => isValidWeekId(value),
      message: '{VALUE} is not a valid week ID. Expected format: YYYY-MM-DD',
    },
    default: null,
  },
})
  // Critical indexes for performance
  .index({ safe: 1, blockNumber: -1 })
  .index({ week: 1 })
  .index({ transactionHash: 1 });

export type GnosisPayRewardDistributionModelType = Model<GnosisPayRewardDistributionDocumentFieldsType> & {
  /**
   * Create a document ID from a transaction hash and address.
   * @param transactionHash - The transaction hash.
   * @param address - The address.
   * @param transactionLogIndex - The transaction log index.
   * @returns The document ID.
   */
  createDocumentId(transactionHash: `0x${string}`, address: Address, transactionLogIndex?: number): DocumentIdType;
};

gnosisPayRewardDistributionSchema.statics.createDocumentId = function createDocumentId(
  transactionHash: `0x${string}`,
  address: Address,
  transactionLogIndex?: number,
) {
  const parts = [transactionHash, address.toLowerCase()];
  if (transactionLogIndex !== undefined) {
    parts.push(transactionLogIndex.toString());
  }

  return parts.join('/') as DocumentIdType;
};

/**
 * Create a model for the GnosisPayRewardDistribution collection.
 * @param mongooseConnection - The mongoose connection.
 * @returns The model for the GnosisPayRewardDistribution collection.
 */
export function createGnosisPayRewardDistributionModel(
  mongooseConnection: Mongoose,
): GnosisPayRewardDistributionModelType {
  // Return cached model if it exists
  if (mongooseConnection.models[gnosisPayRewardDistributionModelName]) {
    return mongooseConnection.models[gnosisPayRewardDistributionModelName] as GnosisPayRewardDistributionModelType;
  }

  return mongooseConnection.model<GnosisPayRewardDistributionDocumentFieldsType, GnosisPayRewardDistributionModelType>(
    gnosisPayRewardDistributionModelName,
    gnosisPayRewardDistributionSchema,
  );
}
