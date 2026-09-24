import type { Db } from '../db/connection.ts';
import type { SheetArticle } from './selection.ts';

/** Loads the current master data for the test sheet, ordered by id for reproducible selection. */
export async function loadSheetArticles(db: Db): Promise<SheetArticle[]> {
  const [articles, numbers] = await Promise.all([
    db
      .selectFrom('master_data.article')
      .select(['id', 'description', 'ean', 'price_gross'])
      .orderBy('id')
      .execute(),
    db
      .selectFrom('master_data.article_number')
      .select(['article_id', 'number'])
      .orderBy('article_id')
      .orderBy('number')
      .execute(),
  ]);
  const numbersById = new Map<number, string[]>();
  for (const { article_id, number } of numbers) {
    let list = numbersById.get(article_id);
    if (!list) numbersById.set(article_id, (list = []));
    list.push(number);
  }
  return articles.map((a) => ({
    id: a.id,
    description: a.description,
    ean: a.ean,
    priceGross: a.price_gross,
    articleNumbers: numbersById.get(a.id) ?? [],
  }));
}
