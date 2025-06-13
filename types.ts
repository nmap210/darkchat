
export enum MessageType {
  SENT = 'sent',
  RECEIVED = 'received',
  SYSTEM = 'system',
  ERROR = 'error',
}

export interface ChatMessageItem {
  id: string;
  text: string;
  type: MessageType;
  timestamp: number;
}

export interface CryptoKeyPairParts {
  publicKeyB64: string;
  privateKeyB64: string;
}
