import type { ArticleMatch } from '@inventur/shared';

/** The text the matching field of a suggestion shows for the input. */
export function matchedText(match: ArticleMatch): string {
  switch (match.matchedBy) {
    case 'ean':
      return match.ean ?? '';
    case 'article_number':
      return match.matchedNumber ?? '';
    case 'description':
      return match.description;
  }
}

/**
 * The code shown next to a suggestion: the matched EAN or article number, and
 * for matches by description the EAN or first article number, as the
 * description is shown anyway.
 */
export function suggestionCode(match: ArticleMatch): string {
  if (match.matchedBy !== 'description') return matchedText(match);
  return match.ean ?? match.articleNumbers[0] ?? '';
}

/**
 * With exactly one suggestion whose matched text starts with the input, the
 * full text is offered as completion (shown grey, accepted with Tab).
 */
export function completionFor(input: string, suggestions: readonly ArticleMatch[]): string | null {
  if (suggestions.length !== 1 || input === '') return null;
  const text = matchedText(suggestions[0]!);
  if (text.length <= input.length) return null;
  return text.toLowerCase().startsWith(input.toLowerCase())
    ? input + text.slice(input.length)
    : null;
}

/** Moves a selection by `delta` within `length` items, wrapping around. */
export function moveSelection(index: number, delta: number, length: number): number {
  if (length === 0) return 0;
  return (((index + delta) % length) + length) % length;
}
