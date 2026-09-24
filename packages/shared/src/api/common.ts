/** Reference to another record by id and display name. */
export interface NamedRef {
  id: number;
  name: string;
}

/** Response of the import from the previous stocktake. */
export interface ImportResponse<T> {
  /** Name of the stocktake the records were copied from. */
  source: NamedRef;
  /** Newly created records; names that already exist are skipped. */
  created: T[];
}
