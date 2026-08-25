import { PropertyShowcase } from "@/components/PropertyShowcase";
import { showcaseProjects } from "@/data/properties";

export default function Dashboard() {
  return <PropertyShowcase properties={showcaseProjects} />;
}
