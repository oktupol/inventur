const id = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER } as const;

/** JSON schema for routes with a numeric `:id` parameter. */
export const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id },
} as const;

export interface IdParams {
  id: number;
}

/** JSON schema for routes below a stocktake with a numeric `:id` and `:itemId`. */
export const itemParams = {
  type: 'object',
  required: ['id', 'itemId'],
  properties: { id, itemId: id },
} as const;

export interface ItemParams {
  id: number;
  itemId: number;
}

export const nameBody = {
  type: 'object',
  required: ['name'],
  properties: { name: { type: 'string' } },
  additionalProperties: false,
} as const;
