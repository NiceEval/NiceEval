import {
  defineComponent,
  type ComponentFaces,
  type ReportComponent,
} from "../components.ts";

/**
 * The extension facade is the same dual-face primitive contract used by core.
 * It intentionally accepts semantic faces rather than DOM, raw HTML, CSS, or
 * scripts, so a no-JS static site stays complete by construction.
 */
export type ClassicRendererFaces<Props extends object, Resolved = Props> = ComponentFaces<Props, Resolved>;
/** The current generic name; classic is a package-owned renderer family. */
export type RendererFaces<Props extends object, Resolved = Props> = ClassicRendererFaces<Props, Resolved>;

export function defineClassicRenderer<Props extends object, Resolved = Props>(
  faces: ClassicRendererFaces<Props, Resolved>,
): ReportComponent<Props> {
  return defineComponent(faces);
}

/** A neutral extension renderer has the same dual-face, closed-data contract. */
export const defineRenderer = defineClassicRenderer;
