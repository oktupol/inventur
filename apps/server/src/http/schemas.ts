/** JSON schema for routes with a numeric `:id` parameter. */
export const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER } },
} as const;

export interface IdParams {
  id: number;
}
