import { ObjectId } from 'mongodb';
import { ApiError } from './http.js';

/** Parse a path/query id into an ObjectId, returning a 400 ApiError if malformed. */
export function objectId(value: string, code = 'INVALID_ID'): ObjectId {
  if (!ObjectId.isValid(value)) throw new ApiError(400, code, 'Invalid id');
  return new ObjectId(value);
}
