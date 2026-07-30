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

/**
 * The 6 top-level destinations on hiranandanifortunecity.com's own VR-tour
 * menu (The Arena, Elena, Ebony, Golden Willows, Club House, Quality). Name,
 * link and image are pulled from that site's (and its two linked microsites',
 * Elena/Ebony) own bundled data/assets. The carousel derives its geometry
 * from this list's length, so adding or removing entries is safe.
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
 * Top-level portfolio groups the space/Earth-approach screen (EarthPortal)
 * browses: pick a location first, then a project within it — rather than
 * every project from every location in one flat list.
 */
export type PortfolioGroup = {
  slug: string;
  name: string;
  location: string;
  projects: Property[];
};

export const portfolioGroups: PortfolioGroup[] = [
  {
    slug: "alibaug",
    name: "Alibaug",
    location: "Alibaug, Maharashtra",
    projects: [
      {
        slug: "hiranandani-sands",
        name: "Hiranandani Sands",
        location: "Alibaug, Maharashtra",
        href: "https://hiranandanisands.in/",
        // Their own site is a fully client-rendered app with no
        // discoverable static photo asset, so this is a locally-hosted
        // brand card (title + tagline) rather than a project photo — same
        // "no CRM/content API yet" gap the amenities comment above notes.
        image: "/brand/alibaug-sands.png",
      },
    ],
  },
  {
    slug: "fortune-city",
    name: "Fortune City",
    location: "Hiranandani Fortune City",
    projects: properties,
  },
];
