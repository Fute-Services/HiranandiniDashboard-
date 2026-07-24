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
};

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
  },
  {
    slug: "elena",
    name: "Elena",
    location: "Hiranandani Fortune City",
    href: "https://elena.futeservices.in",
    image: "https://elena.futeservices.in/assets/ph_building-DAq7keFj.webp",
  },
  {
    slug: "ebony",
    name: "Ebony",
    location: "Hiranandani Fortune City",
    href: "https://ebony.futeservices.in",
    image: "https://ebony.futeservices.in/assets/towerImage-pzeoWkNL.jpg",
  },
  {
    slug: "golden-willows",
    name: "Golden Willows",
    location: "Hiranandani Fortune City",
    href: "https://hiranandanigoldenwillows.com",
  },
  {
    slug: "club-house",
    name: "Club House",
    location: "Hiranandani Fortune City",
    href: "https://hiranandanifortunecity.com/club-house",
    image: "https://hiranandanifortunecity.com/assets/club1-CKwV8fQl.webp",
  },
  {
    slug: "quality",
    name: "Quality",
    location: "Hiranandani Fortune City",
    href: "https://hiranandanifortunecity.com/quality",
  },
];
