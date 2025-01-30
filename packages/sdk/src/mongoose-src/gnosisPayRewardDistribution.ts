import { Model, Mongoose, Schema } from 'mongoose';

import { mongooseSchemaAddressField, mongooseSchemaHashField } from './sharedSchemaFields';
import { Address, isAddress, isHash } from 'viem';
import { isValidWeekId, WeekIdFormatType } from '../week-functions';

export const gnosisPayRewardDistributionModelName = 'GnosisPayRewardDistribution' as const;

export type GnosisPayRewardDistributionDocumentFieldsType = {
  _id: `0x${string}`;
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
        const [transactionHash, address] = value.split('/');
        return isHash(transactionHash) && isAddress(address);
      },
      message: '{VALUE} is not a valid hash. Expected format: 0x.../0x...',
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
});

export type GnosisPayRewardDistributionModelType = Model<GnosisPayRewardDistributionDocumentFieldsType>;

/**
 * Create a document ID for the GnosisPayRewardDistribution collection.
 * @param transactionHash - The transaction hash.
 * @param address - The address.
 * @returns The document ID.
 */
export function toGnosisPayRewardDistributionDocumentId(transactionHash: `0x${string}`, address: Address) {
  return `${transactionHash}/${address.toLowerCase()}` as `${`0x${string}`}/${Address}`;
}

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
    return mongooseConnection.models[gnosisPayRewardDistributionModelName];
  }

  return mongooseConnection.model<GnosisPayRewardDistributionDocumentFieldsType>(
    gnosisPayRewardDistributionModelName,
    gnosisPayRewardDistributionSchema,
  );
}
