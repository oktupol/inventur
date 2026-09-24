import type { ColumnType, Generated } from 'kysely';

/** Money amounts come from `NUMERIC` as strings to avoid rounding errors. */
export type Amount = string;

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type NullableTimestamp = ColumnType<
  Date | null,
  Date | string | null | undefined,
  Date | string | null
>;

export interface ArticleTable {
  id: Generated<number>;
  description: string;
  ean: string | null;
  price_net: Amount;
  price_gross: Amount;
  category: string | null;
}

export interface ArticleNumberTable {
  article_id: number;
  number: string;
}

export type StocktakeStatus = 'active' | 'finished';

export interface StocktakeTable {
  id: Generated<number>;
  name: string;
  status: ColumnType<StocktakeStatus, StocktakeStatus | undefined>;
  started_at: Timestamp;
  finished_at: NullableTimestamp;
}

export interface EmployeeTable {
  id: Generated<number>;
  stocktake_id: number;
  name: string;
  workstation_id: number | null;
}

export interface WorkstationTable {
  id: Generated<number>;
  name: string;
  token: string;
  work_area_id: number | null;
  last_seen_at: NullableTimestamp;
}

export type WorkAreaStatus = 'open' | 'in_progress' | 'closed';

export interface WorkAreaTable {
  id: Generated<number>;
  stocktake_id: number;
  name: string;
  description: string | null;
  status: ColumnType<WorkAreaStatus, WorkAreaStatus | undefined>;
  closed_at: NullableTimestamp;
}

export interface EntryTable {
  id: Generated<number>;
  stocktake_id: number;
  work_area_id: number;
  article_id: number | null;
  is_manual: boolean;
  input: string;
  description: string;
  ean: string | null;
  category: string | null;
  price_net: Amount | null;
  price_gross: Amount;
  serial_number: string | null;
  quantity: ColumnType<number, number | undefined>;
  workstation_id: number;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface EntryEmployeeTable {
  entry_id: number;
  employee_id: number;
}

export interface CheckpointTable {
  id: Generated<number>;
  work_area_id: number;
  number: number;
  workstation_id: number | null;
  created_at: Timestamp;
}

export interface PairingTable {
  id: Generated<number>;
  workstation_id: number;
  one_time_code: string;
  qr_token: string;
  valid_until: Date;
  device_token: string | null;
  paired_at: NullableTimestamp;
}

export interface Database {
  'master_data.article': ArticleTable;
  'master_data.article_number': ArticleNumberTable;
  'inventory.stocktake': StocktakeTable;
  'inventory.employee': EmployeeTable;
  'inventory.workstation': WorkstationTable;
  'inventory.work_area': WorkAreaTable;
  'inventory.entry': EntryTable;
  'inventory.entry_employee': EntryEmployeeTable;
  'inventory.checkpoint': CheckpointTable;
  'inventory.pairing': PairingTable;
}
