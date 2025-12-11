import { ClientSession, HydratedDocument, Mongoose, PaginateModel, Schema } from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';
import { Address } from 'viem';
import { BaseSafeDocumentFieldsType, baseSafeSchema } from './base-safe-address.js';
import {
  gnosisPaySafeModelName,
  metriSafeCollectionName as collectionName,
  metriSafeModelName as modelName,
} from './model-config.js';

type MetriSafeDocumentFieldsType = BaseSafeDocumentFieldsType & {
  /**
   * The Gnosis Pay safe address that this Metri safe address is associated with
   */
  gnosisPaySafe: string | null;
};

const metriSafeSchema = new Schema<MetriSafeDocumentFieldsType>(
  {
    gnosisPaySafe: {
      type: String,
      ref: gnosisPaySafeModelName,
      set: (value: string | null) => (value ? value.toLowerCase() : null),
    },
  },
  {
    collection: collectionName,
    timestamps: true,
  },
)
  .add(baseSafeSchema)
  .plugin(mongoosePaginate)
  .pre('save', function (next) {
    this.gnosisPaySafe = this.gnosisPaySafe?.toLowerCase() as Address | null;
    next();
  });

export type MetriSafeModelType = PaginateModel<MetriSafeDocumentFieldsType>;

export function createMetriSafeModel(mongooseConnection: Mongoose): MetriSafeModelType {
  // Return cached model if it exists
  return (mongooseConnection.models[modelName] ??
    mongooseConnection.model(modelName, metriSafeSchema)) as unknown as MetriSafeModelType;
}

export async function createMetriSafeDocument(
  model: MetriSafeModelType,
  initialData: {
    safeAddress: Address;
    owners: Address[];
    gnosisPaySafe: Address | null;
  },
  mongooseSession?: ClientSession,
): Promise<HydratedDocument<MetriSafeDocumentFieldsType>> {
  const safeAddress = initialData.safeAddress.toLowerCase() as Address;

  const metriSafeAddressDocument = await model.findById(
    safeAddress,
    {},
    {
      session: mongooseSession,
    },
  );

  if (metriSafeAddressDocument !== null) {
    return metriSafeAddressDocument;
  }

  return new model<MetriSafeDocumentFieldsType>({
    _id: safeAddress,
    address: safeAddress,
    owners: initialData.owners,
    gnosisPaySafe: initialData.gnosisPaySafe ? (initialData.gnosisPaySafe.toLowerCase() as Address) : null,
    tokenBalanceSnapshots: [],
    isOG: false,
  }).save({ session: mongooseSession });
}
