// Static demo catalog. A real merchant would ingest a product feed;
// this sandbox skips that entirely and just gives testers known item
// IDs to reference in their checkout_sessions requests.
export type CatalogItem = {
  id: string;
  name: string;
  unit_amount: number; // minor currency units (cents)
};

export const CATALOG: CatalogItem[] = [
  { id: "item_demo_mug", name: "Demo Mug", unit_amount: 1299 },
  { id: "item_demo_tshirt", name: "Demo T-Shirt", unit_amount: 2499 },
  { id: "item_demo_headphones", name: "Demo Wireless Headphones", unit_amount: 7999 },
  { id: "item_demo_notebook", name: "Demo Notebook", unit_amount: 899 },
];

export function findCatalogItem(id: string): CatalogItem | undefined {
  return CATALOG.find((item) => item.id === id);
}
