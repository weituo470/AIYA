import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createTheatreModelModes, type CreateTheatreModelMode } from './_admin-settings';

export const modelSelectionCookie = 'aiya_web_model';
export const modelSelectionMaxAge = 30 * 24 * 60 * 60;
const ephemeralKey = randomBytes(32).toString('hex');
const signingKey = () => process.env.CREATE_THEATRE_SETTINGS_ENCRYPTION_KEY
  || process.env.CREATE_THEATRE_ADMIN_TOKEN || process.env.AIYA_ADMIN_TOKEN || ephemeralKey;
const sign = (value: string) => createHmac('sha256', signingKey()).update(value).digest('base64url');
const equal = (a: string, b: string) => {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
export const validModelPassword = (value: unknown) => {
  const password = process.env.CREATE_THEATRE_MODEL_OPERATION_PASSWORD?.trim();
  return Boolean(password) && typeof value === 'string' && value.length <= 128 && equal(value, password!);
};

export function encodeModelSelection(mode: CreateTheatreModelMode, now = Date.now()) {
  const payload = `${mode}.${Math.floor(now / 1000) + modelSelectionMaxAge}`;
  return `${payload}.${sign(payload)}`;
}

export function readModelSelection(request: Request, now = Date.now()): CreateTheatreModelMode | undefined {
  const token = (request.headers.get('cookie') || '').split(';')
    .map((part) => part.trim()).find((part) => part.startsWith(`${modelSelectionCookie}=`))
    ?.slice(modelSelectionCookie.length + 1);
  if (!token || token.length > 200) return undefined;
  const [mode, expiry, signature, extra] = token.split('.');
  if (extra || !signature || !createTheatreModelModes.includes(mode as CreateTheatreModelMode)
    || !/^\d+$/.test(expiry) || Number(expiry) <= now / 1000
    || !equal(signature, sign(`${mode}.${expiry}`))) return undefined;
  return mode as CreateTheatreModelMode;
}
