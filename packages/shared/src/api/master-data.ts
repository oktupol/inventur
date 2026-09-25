/** An article of the master data as the overview lists it. */
export interface MasterDataArticle {
  id: number;
  description: string;
  ean: string | null;
  articleNumbers: string[];
  category: string | null;
  priceNet: string;
  priceGross: string;
  expectedQuantity: number | null;
}

/** Target quantity and its value, e.g. of a category. */
export interface ExpectedStock {
  articles: number;
  /** Sum of the target quantities. */
  quantity: number;
  /** Value of the target quantities in EUR. */
  net: string;
  gross: string;
}

/** A check of the master data that finds articles worth a look. */
export type MasterDataCheckKind =
  | 'duplicate_ean'
  | 'duplicate_article_number'
  | 'without_code'
  | 'invalid_ean'
  | 'zero_price'
  | 'gross_below_net';

export interface MasterDataIssue {
  article: MasterDataArticle;
  /** The code the issue concerns, e.g. the duplicate EAN. */
  code: string | null;
}

export interface MasterDataCheck {
  kind: MasterDataCheckKind;
  /** Number of affected articles. */
  count: number;
  /** At most 500 affected articles, duplicates grouped by code. */
  issues: MasterDataIssue[];
  truncated: boolean;
}

/** `GET /api/admin/master-data/overview` */
export interface MasterDataOverview {
  articleCount: number;
  withEan: number;
  withArticleNumber: number;
  withoutExpectedQuantity: number;
  /** Articles with a target quantity and its value. */
  expected: ExpectedStock;
  byCategory: (ExpectedStock & { category: string | null; articleCount: number })[];
  checks: MasterDataCheck[];
}

/** `GET /api/admin/master-data/articles?q=&offset=`: one page of the article list. */
export interface MasterDataArticlePage {
  articles: MasterDataArticle[];
  offset: number;
  /** Number of articles in the list (at most 500 with a search). */
  total: number;
  /** A search found more articles than it lists. */
  hasMore: boolean;
}
