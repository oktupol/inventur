import { ean13 } from '@inventur/shared';
import { Random } from './random.ts';

export interface GeneratedArticle {
  id: number;
  description: string;
  ean: string | null;
  /** Amount with two decimal places, e.g. "1234.50" */
  priceNet: string;
  priceGross: string;
  category: string;
  articleNumbers: string[];
  /** Target quantity; null for articles without one. */
  expectedQuantity: number | null;
}

export interface GeneratorOptions {
  count: number;
  seed: number;
}

interface Draft {
  category: string;
  /** Brand, type and material; similar articles share the same base. */
  base: string;
  variant: string;
  minPrice: number;
  maxPrice: number;
}

// The generated data is shown in the German UI, so its content is German.
const WATCH_BRANDS = [
  'Aurelis',
  'Nordhavn',
  'Montclair',
  'Sternwerk',
  'Valmont',
  'Kessler & Söhne',
  'Brenner',
  'Lindqvist',
];
const JEWELLERY_BRANDS = [
  'Juwelia',
  'Goldmanufaktur Weiß',
  'Perlenhaus',
  'Castell',
  'Amara',
  'Lumen',
];
const GOLD = ['Gelbgold 585', 'Gelbgold 750', 'Weißgold 585', 'Weißgold 750', 'Roségold 585'];
const PRECIOUS_METALS = [...GOLD, 'Platin 950', 'Silber 925', 'Silber 925 rhodiniert'];
const STONES = [
  'Brillant 0,05 ct',
  'Brillant 0,10 ct',
  'Brillant 0,25 ct',
  'Brillant 0,50 ct',
  'Saphir',
  'Rubin',
  'Smaragd',
  'Zirkonia',
  'Süßwasserperle',
  'Akoya-Perle',
  'Topas blau',
  'Amethyst',
];

interface Category {
  name: string;
  weight: number;
  draft: (r: Random) => Draft;
}

const CATEGORIES: Category[] = [
  {
    name: 'Armbanduhren',
    weight: 20,
    draft: (r) => {
      const material = r.pick(['Edelstahl', 'Titan', 'Bicolor', 'Keramik', ...GOLD.slice(1)]);
      const isGold = GOLD.includes(material);
      const type = r.pick([
        'Automatik',
        'Chronograph',
        'Taucheruhr',
        'Fliegeruhr',
        'Dresswatch',
        'Damenuhr Quarz',
        'Herrenuhr Quarz',
        'GMT',
      ]);
      const size = r.pick(['28', '32', '36', '38', '40', '41', '42', '44']);
      const dial = r.pick(['schwarz', 'blau', 'silber', 'weiß', 'grün', 'anthrazit']);
      const strap = r.pick([
        'Gliederband',
        'Lederband braun',
        'Lederband schwarz',
        'Milanaiseband',
        'Kautschukband',
      ]);
      return {
        category: 'Armbanduhren',
        base: `${r.pick(WATCH_BRANDS)} ${type} ${material}`,
        variant: `${size} mm, Zifferblatt ${dial}, ${strap}`,
        minPrice: isGold ? 4000 : 150,
        maxPrice: isGold ? 15000 : 4500,
      };
    },
  },
  {
    name: 'Ringe',
    weight: 20,
    draft: (r) => {
      const type = r.pick([
        'Solitärring',
        'Eternityring',
        'Siegelring',
        'Trauring',
        'Vorsteckring',
        'Cocktailring',
      ]);
      const stone = r.chance(0.6) ? ` mit ${r.pick(STONES)}` : '';
      return {
        category: 'Ringe',
        base: `${r.pick(JEWELLERY_BRANDS)} ${type} ${r.pick(PRECIOUS_METALS)}${stone}`,
        variant: `Gr. ${r.int(48, 64)}`,
        minPrice: 40,
        maxPrice: 8000,
      };
    },
  },
  {
    name: 'Ketten',
    weight: 15,
    draft: (r) => {
      const type = r.pick([
        'Ankerkette',
        'Panzerkette',
        'Venezianerkette',
        'Königskette',
        'Collier',
        'Kette mit Anhänger',
      ]);
      return {
        category: 'Ketten',
        base: `${r.pick(JEWELLERY_BRANDS)} ${type} ${r.pick(PRECIOUS_METALS)}`,
        variant: `${r.pick(['38', '40', '42', '45', '50', '55', '60'])} cm`,
        minPrice: 30,
        maxPrice: 5000,
      };
    },
  },
  {
    name: 'Ohrschmuck',
    weight: 15,
    draft: (r) => {
      const type = r.pick(['Ohrstecker', 'Creolen', 'Ohrhänger', 'Ear Cuff', 'Klappcreolen']);
      return {
        category: 'Ohrschmuck',
        base: `${r.pick(JEWELLERY_BRANDS)} ${type} ${r.pick(PRECIOUS_METALS)}`,
        variant: r.chance(0.6) ? `mit ${r.pick(STONES)}` : `${r.int(6, 30)} mm`,
        minPrice: 20,
        maxPrice: 3000,
      };
    },
  },
  {
    name: 'Armbänder',
    weight: 15,
    draft: (r) => {
      const type = r.pick([
        'Tennisarmband',
        'Gliederarmband',
        'Armreif',
        'Bettelarmband',
        'Perlenarmband',
      ]);
      return {
        category: 'Armbänder',
        base: `${r.pick(JEWELLERY_BRANDS)} ${type} ${r.pick(PRECIOUS_METALS)}`,
        variant: `${r.int(16, 21)} cm`,
        minPrice: 25,
        maxPrice: 6000,
      };
    },
  },
  {
    name: 'Zubehör',
    weight: 15,
    draft: (r) => {
      const type = r.pick([
        'Uhrenbatterie',
        'Uhrenarmband Leder',
        'Uhrenarmband Edelstahl',
        'Uhrenbox',
        'Uhrenbeweger',
        'Schmuckkästchen',
        'Schmuckreinigungstuch',
        'Silberpflegebad',
      ]);
      let variant: string;
      if (type === 'Uhrenbatterie') {
        variant = r.pick(['SR626SW', 'SR621SW', 'SR920SW', 'CR2016', 'CR2025', 'CR2032']);
      } else if (type.startsWith('Uhrenarmband')) {
        variant = `${r.pick(['16', '18', '20', '22', '24'])} mm ${r.pick(['schwarz', 'braun', 'blau', 'silber'])}`;
      } else {
        variant = r.pick(['klein', 'mittel', 'groß', 'Reiseformat']);
      }
      const isExpensive = type === 'Uhrenbeweger' || type === 'Uhrenbox';
      return {
        category: 'Zubehör',
        base: type,
        variant,
        minPrice: 5,
        maxPrice: isExpensive ? 800 : 60,
      };
    },
  },
];

const TOTAL_WEIGHT = CATEGORIES.reduce((sum, c) => sum + c.weight, 0);

const MIN_PRICE_CENTS = 5_00;
const MAX_PRICE_CENTS = 15_000_00;

/** Share of articles without an EAN. */
const SHARE_WITHOUT_EAN = 0.15;
/** Share of articles that deliberately share an EAN or article number with another one. */
const SHARE_DUPLICATES = 0.005;
/** Share of articles created as a variant of an earlier article. */
const SHARE_SIMILAR = 0.1;
/** Share of articles with a target quantity of 0, e.g. sold but still listed. */
const SHARE_EXPECTED_ZERO = 0.02;
/** Share of articles without a target quantity. */
const SHARE_WITHOUT_EXPECTED = 0.02;
/** Accessories kept in stock in several pieces rather than as single items. */
const BULK_ARTICLES = ['Uhrenbatterie', 'Uhrenarmband', 'Schmuckreinigungstuch', 'Silberpflegebad'];

function randomCategory(r: Random): Category {
  let value = r.next() * TOTAL_WEIGHT;
  for (const category of CATEGORIES) {
    value -= category.weight;
    if (value < 0) return category;
  }
  return CATEGORIES[CATEGORIES.length - 1]!;
}

/** Formats cents as an amount with two decimal places. */
export function formatCents(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/** Gross price = net × 1.19, rounded half up to whole cents. */
export function grossFromNetCents(netCents: number): number {
  // netCents * 119 is an integer, so the division is exact except for x.5.
  return Math.round((netCents * 119) / 100);
}

function priceCents(r: Random, minEuro: number, maxEuro: number): number {
  // Log-uniform: cheap articles are more common than expensive ones.
  const euro = Math.exp(Math.log(minEuro) + r.next() * (Math.log(maxEuro) - Math.log(minEuro)));
  return Math.min(MAX_PRICE_CENTS, Math.max(MIN_PRICE_CENTS, Math.round(euro * 100)));
}

function articleNumberCount(r: Random): number {
  const n = r.next();
  if (n < 0.15) return 0;
  if (n < 0.65) return 1;
  if (n < 0.9) return 2;
  return 3;
}

function articleNumber(r: Random): string {
  switch (r.int(0, 2)) {
    case 0:
      return `A-${r.digits(6)}`; // internal number
    case 1:
      return `L${r.int(10, 99)}-${r.digits(5)}`; // supplier number
    default:
      // manufacturer number
      return `${r.pick(['AU', 'NH', 'MC', 'SW', 'VM', 'KS', 'JW', 'CA'])}${r.digits(4)}.${r.digits(2)}`;
  }
}

function unique(r: Random, taken: Set<string>, create: (r: Random) => string): string {
  for (;;) {
    const candidate = create(r);
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

/** German GS1 prefixes 400–440. */
function eanCandidate(r: Random): string {
  return ean13(`${r.int(400, 440)}${r.digits(9)}`);
}

/**
 * Generates dummy master data; the same seed yields the same data. EANs and
 * article numbers are unique, except for deliberate duplicates that exercise
 * the "ambiguous" case of the lookup.
 */
export function generateMasterData({ count, seed }: GeneratorOptions): GeneratedArticle[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`Invalid count: ${count}`);
  }
  const r = new Random(seed);
  const eans = new Set<string>();
  const numbers = new Set<string>();
  const drafts: Draft[] = [];
  const articles: GeneratedArticle[] = [];

  for (let i = 0; i < count; i++) {
    let draft = randomCategory(r).draft(r);
    const model = drafts.length > 0 && r.chance(SHARE_SIMILAR) ? r.pick(drafts) : undefined;
    if (model) {
      // Same brand, type and material; different variant.
      const category = CATEGORIES.find((c) => c.name === model.category)!;
      draft = { ...model, variant: category.draft(r).variant };
    }
    drafts.push(draft);

    const netCents = priceCents(r, draft.minPrice, draft.maxPrice);
    articles.push({
      id: i + 1,
      description: `${draft.base}, ${draft.variant}`,
      ean: r.chance(SHARE_WITHOUT_EAN) ? null : unique(r, eans, eanCandidate),
      priceNet: formatCents(netCents),
      priceGross: formatCents(grossFromNetCents(netCents)),
      category: draft.category,
      articleNumbers: Array.from({ length: articleNumberCount(r) }, () =>
        unique(r, numbers, articleNumber),
      ),
      expectedQuantity: 1,
    });
  }

  addDuplicates(r, articles);
  addExpectedQuantities(new Random(seed ^ EXPECTED_SEED), articles);
  return articles;
}

/**
 * Target quantities come from a separate sequence, so the other data of a
 * seed stays the same: mostly single items, accessories in several pieces,
 * and a few articles with a target of 0 or none.
 */
const EXPECTED_SEED = 0x5011;

function addExpectedQuantities(r: Random, articles: GeneratedArticle[]): void {
  for (const article of articles) {
    const n = r.next();
    if (n < SHARE_WITHOUT_EXPECTED) article.expectedQuantity = null;
    else if (n < SHARE_WITHOUT_EXPECTED + SHARE_EXPECTED_ZERO) article.expectedQuantity = 0;
    else if (BULK_ARTICLES.some((type) => article.description.startsWith(type))) {
      article.expectedQuantity = r.int(2, 30);
    }
  }
}

function addDuplicates(r: Random, articles: GeneratedArticle[]): void {
  if (articles.length < 4) return;
  const pairs = Math.max(2, Math.round(articles.length * SHARE_DUPLICATES));
  const shuffled = r.shuffle(articles);

  // Duplicate EANs: one article takes over the EAN of another.
  const withEan = shuffled.filter((a) => a.ean !== null);
  for (let i = 0; i + 1 < withEan.length && i < pairs * 2; i += 2) {
    withEan[i + 1]!.ean = withEan[i]!.ean;
  }

  // Duplicate article numbers: an article with room for another number takes
  // over the number of another article.
  const used = new Set<number>();
  let added = 0;
  for (const source of shuffled) {
    if (added >= pairs) break;
    if (source.articleNumbers.length === 0 || used.has(source.id)) continue;
    const target = shuffled.find(
      (a) => a.id !== source.id && a.articleNumbers.length < 3 && !used.has(a.id),
    );
    if (!target) break;
    target.articleNumbers.push(source.articleNumbers[0]!);
    used.add(source.id);
    used.add(target.id);
    added++;
  }
}
