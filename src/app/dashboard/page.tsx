import { PropertyShowcase } from "@/components/PropertyShowcase";
import { railProjects } from "@/data/properties";

/**
 * The presentation screen, and the first thing a customer sees once the
 * staff member has picked them and their device.
 *
 * `railProjects` rather than `showcaseProjects`: the screen offers every
 * project directly (Fortune City's six towers, plus Alibaug) instead of two
 * portfolio cards to drill through, so tapping Elena opens Elena — and
 * starts Elena's timer — in one tap. See the note on `railProjects`.
 */
export default function Dashboard() {
  return <PropertyShowcase properties={railProjects} />;
}
