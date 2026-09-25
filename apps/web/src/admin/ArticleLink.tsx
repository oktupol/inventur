import { createContext, useContext, type ReactNode } from 'react';
import { Link } from 'react-router';

/** Path of the article search the statistics link to; null shows plain text. */
export const ArticleSearchPath = createContext<string | null>(null);

/** An article that opens in the article search of the stocktake. */
export function ArticleLink({ articleId, children }: { articleId: number; children: ReactNode }) {
  const path = useContext(ArticleSearchPath);
  if (path === null) return <>{children}</>;
  return <Link to={`${path}?artikel=${articleId}`}>{children}</Link>;
}
