import {
  MIN_SUGGESTION_LENGTH,
  type ArticleMatch,
  type ArticleSearchResponse,
} from '@inventur/shared';
import { useEffect, useState } from 'react';
import type { Api } from '../api/client.ts';

/** Pause after the last key press before searching; scanners type faster and trigger no search. */
const DEBOUNCE_MS = 80;

/** Search suggestions for the current input, from two characters on. */
export function useSuggestions(api: Api, text: string): ArticleMatch[] {
  const query = text.trim();
  const [result, setResult] = useState<{ query: string; articles: ArticleMatch[] }>({
    query: '',
    articles: [],
  });

  useEffect(() => {
    if (query.length < MIN_SUGGESTION_LENGTH) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .get<ArticleSearchResponse>(`/api/station/articles/search?q=${encodeURIComponent(query)}`)
        .then(
          (response) => !cancelled && setResult({ query, articles: response.articles }),
          () => {
            // Suggestions are optional; errors show up when the input is confirmed.
          },
        );
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, query]);

  return query.length >= MIN_SUGGESTION_LENGTH && result.query === query ? result.articles : [];
}
