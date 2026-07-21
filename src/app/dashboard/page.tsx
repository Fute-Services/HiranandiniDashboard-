import { PropertyShowcase } from "@/components/PropertyShowcase";
import { properties } from "@/data/properties";

export default function Dashboard() {
  return <PropertyShowcase properties={properties} />;
}
