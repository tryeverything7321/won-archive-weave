import type { ArchiveMaterial } from "../../data/archive-repository";
import type { Material } from "../../content";

export const primaryResourceTypes = ["전체", "TEXT", "PDF", "DOCUMENT", "PPTX", "IMAGE"] as const;
export const secondaryResourceTypes = ["XLSX", "TXT", "CSV", "FILE", "LINK"] as const;

export function materialMatchesType(material: ArchiveMaterial | Material, activeType: string) {
  if (activeType === "전체") return true;
  if (activeType === "DOCUMENT") return ["DOCX", "HWP", "HWPX"].includes(material.type);
  return material.type === activeType;
}

export function materialMatchesQuery(material: ArchiveMaterial | Material, query: string) {
  const normalized = query.trim().toLocaleLowerCase("ko-KR");
  if (!normalized) return true;
  return [material.title, material.description]
    .join(" ")
    .toLocaleLowerCase("ko-KR")
    .includes(normalized);
}

export function filterLoadedMaterials<T extends ArchiveMaterial | Material>(
  materials: T[],
  activeType: string,
  query: string,
) {
  return materials.filter(
    (material) => materialMatchesType(material, activeType) && materialMatchesQuery(material, query),
  );
}

export function resetResourceDiscovery(current: URLSearchParams) {
  const next = new URLSearchParams(current);
  next.delete("type");
  next.delete("q");
  return next;
}

export type MaterialFormatCount = {
  type: Material["type"];
  count: number;
};

export function countLoadedMaterialFormats(materials: Array<ArchiveMaterial | Material>): MaterialFormatCount[] {
  const counts = new Map<Material["type"], number>();
  materials.forEach((material) => counts.set(material.type, (counts.get(material.type) ?? 0) + 1));
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((left, right) => right.count - left.count || left.type.localeCompare(right.type));
}
