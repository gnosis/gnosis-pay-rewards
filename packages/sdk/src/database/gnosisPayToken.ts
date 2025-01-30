import type { SerializableErc20TokenType } from '../gnoisPayTokens';

export type TokenDocumentFieldsType = SerializableErc20TokenType & {
  _id: SerializableErc20TokenType['address'];
};
