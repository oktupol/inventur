/** Suggestions appear from this many characters on. */
export const MIN_SUGGESTION_LENGTH = 2;
/** Maximum number of suggestions or choices returned by a search. */
export const MAX_SEARCH_RESULTS = 20;

/** An article of the master data. Prices are decimal strings in EUR, e.g. "1190.00". */
export interface Article {
  id: number;
  description: string;
  ean: string | null;
  articleNumbers: string[];
  category: string | null;
  priceNet: string;
  priceGross: string;
}

export type MatchField = 'ean' | 'article_number' | 'description';

export interface ArticleMatch extends Article {
  /** How the article matched the input. */
  matchedBy: MatchField;
  /** The article number that matched, if `matchedBy` is `article_number`. */
  matchedNumber: string | null;
}

/** `GET /api/station/articles/search?q=` */
export interface ArticleSearchResponse {
  articles: ArticleMatch[];
  /**
   * True if the input equals an EAN or article number. Only those exact
   * matches are returned then, even if other articles match as a prefix.
   */
  exact: boolean;
  /** More articles match than were returned. */
  hasMore: boolean;
}

/** Result of confirming an input with Enter: green, yellow or red. */
export type ResolutionResult = 'unique' | 'ambiguous' | 'not_found';

/** `GET /api/station/articles/resolve?q=` */
export interface ArticleResolution extends ArticleSearchResponse {
  result: ResolutionResult;
}
