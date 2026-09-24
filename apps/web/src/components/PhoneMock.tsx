export interface PhoneMockProps {
  /** Title bar of the illustrated screen. */
  title: string;
  /** Menu entries; the highlighted one is the entry to tap. */
  items: readonly string[];
  highlight?: number;
  /** A switch next to the highlighted entry, e.g. for certificate trust settings. */
  toggle?: boolean;
  caption: string;
}

/** A simplified phone screen that shows which entry to tap. */
export function PhoneMock({ title, items, highlight, toggle, caption }: PhoneMockProps) {
  return (
    <figure className="phone-mock">
      <div className="phone-frame" aria-hidden>
        <div className="phone-title">{title}</div>
        <ul>
          {items.map((item, index) => (
            <li key={item} className={index === highlight ? 'highlight' : undefined}>
              <span>{item}</span>
              {index === highlight &&
                (toggle ? <span className="phone-toggle" /> : <span className="phone-tap">›</span>)}
            </li>
          ))}
        </ul>
      </div>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}
