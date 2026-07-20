export type Property = {
  /** Stable slug — will become the API/route key once the backend lands. */
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
 * Blank slots for the new project — six cubes so the carousel rotates as a ring.
 * The carousel derives its geometry from this list's length, so adding or
 * removing entries is safe. Fill in name / location / href / image per slot.
 */
export const properties: Property[] = [
  { slug: "slot-1", name: "", location: "", href: "#" },
  { slug: "slot-2", name: "", location: "", href: "#" },
  { slug: "slot-3", name: "", location: "", href: "#" },
  { slug: "slot-4", name: "", location: "", href: "#" },
  { slug: "slot-5", name: "", location: "", href: "#" },
  { slug: "slot-6", name: "", location: "", href: "#" },
];
