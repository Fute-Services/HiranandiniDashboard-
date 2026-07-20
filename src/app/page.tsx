import { PropertyCarousel } from "@/components/PropertyCarousel";
import { properties } from "@/data/properties";

export default function Home() {
  return <PropertyCarousel properties={properties} />;
}
