import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";

type EncryptedEnvelope = {
  v: 1;
  iv: string;
  tag: string;
  data: string;
};

function deriveKey(secret: string) {
  return createHash("sha256").update(secret, "utf8").digest();
}

export function encryptJson(value: unknown, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, deriveKey(secret), iv);
  const serialized = JSON.stringify(value);
  const encrypted = Buffer.concat([cipher.update(serialized, "utf8"), cipher.final()]);
  const envelope: EncryptedEnvelope = {
    v: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64")
  };

  return JSON.stringify(envelope);
}

export function decryptJson<T>(payload: string, secret: string): T {
  const envelope = JSON.parse(payload) as Partial<EncryptedEnvelope>;

  if (envelope.v !== 1 || !envelope.iv || !envelope.tag || !envelope.data) {
    throw new Error("Invalid encrypted payload envelope");
  }

  const decipher = createDecipheriv(ALGORITHM, deriveKey(secret), Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, "base64")),
    decipher.final()
  ]).toString("utf8");

  return JSON.parse(decrypted) as T;
}
