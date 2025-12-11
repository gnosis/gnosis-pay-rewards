import { ClientSession, HydratedDocument, Mongoose, PaginateModel, Schema } from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';
import { Address, isHash } from 'viem';
import { GnosisPayTransactionFieldsType } from '../../database/gnosis-pay-transaction-zod.js';
import { BaseSafeDocumentFieldsType, baseSafeSchema } from './base-safe-address.js';
import {
  gnosisPaySafeCollectionName as collectionName,
  gnosisPaySafeModelName as modelName,
  gnosisPayTransactionModelName,
} from './model-config.js';

type GnosisPaySafeDocumentFieldsType = BaseSafeDocumentFieldsType & {
  netVolumeUSD: number;
  transactions: string[];
};

export type GnosisPaySafeDocumentFieldsType_Unpopulated = GnosisPaySafeDocumentFieldsType;

export type GnosisPaySafeDocumentFieldsType_WithTransactionsPopulated = GnosisPaySafeDocumentFieldsType & {
  transactions: GnosisPayTransactionFieldsType[];
};

const gnosisPaySafeSchema = new Schema<GnosisPaySafeDocumentFieldsType>(
  {
    netVolumeUSD: {
      type: Number,
      required: true,
    },
    isOG: {
      type: Boolean,
      required: true,
    },
    transactions: [
      {
        ref: gnosisPayTransactionModelName,
        type: String,
        required: true,
        validate: {
          validator: (value: string) => isHash(value),
          message: '{VALUE} is not a valid hash',
        },
      },
    ],
  },
  {
    collection: collectionName,
    timestamps: true,
  },
)
  .add(baseSafeSchema)
  // Critical indexes for performance
  .index({ isOG: 1 })
  .plugin(mongoosePaginate);

export type GnosisPaySafeModelType = PaginateModel<GnosisPaySafeDocumentFieldsType>;

export function createGnosisPaySafeModel(mongoose: Mongoose): GnosisPaySafeModelType {
  // Return cached model if it exists
  return (mongoose.models[modelName] ??
    mongoose.model(modelName, gnosisPaySafeSchema)) as unknown as GnosisPaySafeModelType;
}

export async function createGnosisPaySafeDocument(
  model: GnosisPaySafeModelType,
  payload: {
    safeAddress: Address;
    owners: Address[];
    isOG: boolean;
  },
  mongooseSession?: ClientSession,
): Promise<HydratedDocument<GnosisPaySafeDocumentFieldsType>> {
  const safeAddress = payload.safeAddress.toLowerCase() as Address;

  const gnosisPaySafeDocument = await model.findById(
    safeAddress,
    {},
    {
      session: mongooseSession,
    },
  );

  if (gnosisPaySafeDocument !== null) {
    return gnosisPaySafeDocument;
  }

  return new model<GnosisPaySafeDocumentFieldsType>({
    _id: safeAddress,
    address: safeAddress,
    netVolumeUSD: 0,
    owners: payload.owners,
    isOG: payload.isOG,
    transactions: [],
    tokenBalanceSnapshots: [],
  }).save({ session: mongooseSession });
}
