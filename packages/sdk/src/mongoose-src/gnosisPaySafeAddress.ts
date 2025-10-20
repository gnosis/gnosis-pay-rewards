import { ClientSession, HydratedDocument, Model, Mongoose, Schema } from 'mongoose';
import { Address, isHash } from 'viem';
import { GnosisPayTransactionFieldsType_Unpopulated } from '../database/spendTransaction';
import { mongooseSchemaAddressField } from './sharedSchemaFields';
import { gnosisPayTransactionModelName } from './gnosisPayTransaction';
import { gnosisTokenBalanceSnapshotModelName } from './gnosisTokenBalanceSnapshot';

export const gnosisPaySafeAddressModelName = 'GnosisPaySafeAddress' as const;

type GnosisPaySafeAddressDocumentFieldsType = {
  _id: Address;
  address: Address;
  netUsdVolume: number;
  gnoBalance: number;
  owners: Address[];
  /**
   * If the safe is an original Gnosis Pay Safe
   */
  isOg: boolean;
  transactions: string[];
  gnoBalanceSnapshots: string[];
};

export type GnosisPaySafeAddressDocumentFieldsType_Unpopulated = GnosisPaySafeAddressDocumentFieldsType;

export type GnosisPaySafeAddressDocumentFieldsType_WithTransactionsPopulated =
  GnosisPaySafeAddressDocumentFieldsType & {
    transactions: GnosisPayTransactionFieldsType_Unpopulated[];
  };

const gnosisPaySafeAddressSchema = new Schema<GnosisPaySafeAddressDocumentFieldsType>({
  _id: mongooseSchemaAddressField,
  netUsdVolume: {
    type: Number,
    required: true,
  },
  gnoBalance: {
    type: Number,
    required: true,
  },
  address: mongooseSchemaAddressField,
  owners: [mongooseSchemaAddressField],
  isOg: {
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
  gnoBalanceSnapshots: [
    {
      ref: gnosisTokenBalanceSnapshotModelName,
      type: String,
      required: true,
    },
  ],
})
  // Critical indexes for performance
  .index({ owners: 1 })
  .index({ isOg: 1 });

export type GnosisPaySafeAddressModelType = Model<GnosisPaySafeAddressDocumentFieldsType>;

export function createGnosisPaySafeAddressModel(mongooseConnection: Mongoose): GnosisPaySafeAddressModelType {
  // Return cached model if it exists
  if (mongooseConnection.models[gnosisPaySafeAddressModelName]) {
    return mongooseConnection.models[gnosisPaySafeAddressModelName];
  }

  return mongooseConnection.model(gnosisPaySafeAddressModelName, gnosisPaySafeAddressSchema);
}

export async function createGnosisPaySafeAddressDocument(
  payload: {
    safeAddress: Address;
    owners: Address[];
    isOg: boolean;
  },
  gnosisPaySafeAddressModel: GnosisPaySafeAddressModelType,
  mongooseSession?: ClientSession,
): Promise<HydratedDocument<GnosisPaySafeAddressDocumentFieldsType>> {
  const safeAddress = payload.safeAddress.toLowerCase() as Address;

  const gnosisPaySafeAddressDocument = await gnosisPaySafeAddressModel.findById(
    safeAddress,
    {},
    { session: mongooseSession },
  );

  if (gnosisPaySafeAddressDocument !== null) {
    return gnosisPaySafeAddressDocument;
  }

  return new gnosisPaySafeAddressModel<GnosisPaySafeAddressDocumentFieldsType>({
    _id: safeAddress,
    address: safeAddress,
    netUsdVolume: 0,
    gnoBalance: 0,
    owners: payload.owners,
    isOg: payload.isOg,
    transactions: [],
    gnoBalanceSnapshots: [],
  }).save({ session: mongooseSession });
}
