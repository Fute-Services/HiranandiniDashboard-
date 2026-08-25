export type Property = {
  /** Stable slug, will become the API/route key once the backend lands. */
  slug: string;
  /** Shown on the card face. */
  name: string;
  /**
   * Shown in the footer list, where entries read as a set. Defaults to `name`.
   */
  listName?: string;
  location: string;
  /** External site for the property, if it has one (PRD §2). */
  href: string;
  image?: string;
  /** Generic amenity list, standing in for real per-project specs until
   * the CRM/content API lands (same mock-data pattern as leads.ts/users.ts).
   * Every Hiranandani Fortune City tower shares this base amenity set. */
  amenities?: string[];
};

const FORTUNE_CITY_AMENITIES = [
  "Clubhouse",
  "Swimming Pool",
  "Gymnasium",
  "Landscaped Gardens",
  "Kids' Play Area",
  "24x7 Security",
];

const ALIBAUG_AMENITIES = [
  "Private Beach Access",
  "Infinity Pool",
  "Wellness Spa",
  "Landscaped Estate",
  "Concierge",
  "24x7 Security",
];

/**
 * The 6 top-level destinations on hiranandanifortunecity.com's own VR-tour
 * menu (The Arena, Elena, Ebony, Golden Willows, Club House, Quality). Name,
 * link and image are pulled from that site's (and its two linked microsites',
 * Elena/Ebony) own bundled data/assets.
 *
 * These are no longer the shelf itself — the showcase shows one card per
 * portfolio (see `showcaseProjects`) and these hang underneath Fortune City
 * as its tower list. Adding or removing entries is safe.
 */
export const properties: Property[] = [
  {
    slug: "the-arena",
    name: "The Arena",
    location: "Hiranandani Fortune City",
    href: "https://hiranandanifortunecity.com/arena",
    image: "https://hiranandanifortunecity.com/assets/arena_masterplan4-DGJk5HNY.png",
    amenities: FORTUNE_CITY_AMENITIES,
  },
  {
    slug: "elena",
    name: "Elena",
    location: "Hiranandani Fortune City",
    href: "https://elena.futeservices.in",
    image: "https://elena.futeservices.in/assets/ph_building-DAq7keFj.webp",
    amenities: FORTUNE_CITY_AMENITIES,
  },
  {
    slug: "ebony",
    name: "Ebony",
    location: "Hiranandani Fortune City",
    href: "https://ebony.futeservices.in",
    image: "https://ebony.futeservices.in/assets/towerImage-pzeoWkNL.jpg",
    amenities: FORTUNE_CITY_AMENITIES,
  },
  {
    slug: "golden-willows",
    name: "Golden Willows",
    location: "Hiranandani Fortune City",
    href: "https://hiranandanigoldenwillows.com",
    image: "https://hiranandanigoldenwillows.com/assets/galleryy/Zenia01.webp",
    amenities: FORTUNE_CITY_AMENITIES,
  },
  {
    slug: "club-house",
    name: "Club House",
    location: "Hiranandani Fortune City",
    href: "https://hiranandanifortunecity.com/club-house",
    image: "https://hiranandanifortunecity.com/assets/club1-CKwV8fQl.webp",
    amenities: FORTUNE_CITY_AMENITIES,
  },
  {
    slug: "quality",
    name: "Quality",
    location: "Hiranandani Fortune City",
    href: "https://hiranandanifortunecity.com/quality",
    // "Quality"'s own page is a construction-standards video with no static
    // photo asset at all; using a real Fortune City tower render instead of
    // a placeholder, since there's nothing project-specific to point to.
    image: "https://hiranandanigoldenwillows.com/assets/galleryy/aster%201.webp",
    amenities: FORTUNE_CITY_AMENITIES,
  },
];

/**
 * A top-level destination in the portfolio: one location, one website, and
 * (sometimes) a set of projects inside it.
 *
 * A group is itself openable — `href` is the portfolio's own site, which is
 * what the showcase's full-screen viewer loads. That is the difference from
 * before: Fortune City used to exist only as its six towers, so
 * hiranandanifortunecity.com itself was never something a staff member could
 * put on screen, and nothing about "showed them Fortune City" reached the
 * activity log. Now it opens in the app like Alibaug does, and is recorded
 * the same way.
 */
export type PortfolioGroup = {
  slug: string;
  name: string;
  location: string;
  /** The portfolio's own site, opened in the in-app viewer. */
  href: string;
  image?: string;
  amenities?: string[];
  /** One line under the name on the card. */
  blurb?: string;
  /** The individual projects inside, listed in the details panel. Empty for a
   * portfolio that is a single project. */
  projects: Property[];
};

export const portfolioGroups: PortfolioGroup[] = [
  {
    slug: "alibaug",
    name: "Alibaug",
    location: "Alibaug, Maharashtra",
    href: "https://hiranandanisands.in/",
    // Their own site is a fully client-rendered app with no discoverable
    // static photo asset, so this is a locally-hosted brand card (title +
    // tagline) rather than a project photo — the same "no CRM/content API
    // yet" gap the amenities comment above notes.
    image: "/brand/alibaug-sands.png",
    blurb: "Hiranandani Sands · coastal estate",
    amenities: ALIBAUG_AMENITIES,
    projects: [],
  },
  {
    slug: "fortune-city",
    name: "Fortune City",
    location: "Hiranandani Fortune City",
    href: "https://hiranandanifortunecity.com",
    image: "https://hiranandanigoldenwillows.com/assets/galleryy/Zenia01.webp",
    blurb: "Integrated township · 6 projects",
    amenities: FORTUNE_CITY_AMENITIES,
    projects: properties,
  },
];

/**
 * What the showcase shelf actually offers, and the single source of truth for
 * "what can a staff member put in front of a customer" — which is why the
 * admin block list and the unit-availability grid read from this too. When
 * those read the tower list instead, blocking "Elena" hid nothing, because
 * Elena was never a card on the shelf.
 */
export const showcaseProjects: Property[] = portfolioGroups.map((g) => ({
  slug: g.slug,
  name: g.name,
  location: g.location,
  href: g.href,
  image: g.image,
  amenities: g.amenities,
}));

/** The projects inside a portfolio, by the portfolio's slug. */
export function projectsIn(slug: string): Property[] {
  return portfolioGroups.find((g) => g.slug === slug)?.projects ?? [];
}
