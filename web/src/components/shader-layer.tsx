import { FlowingGradient, Fog, MeshGradient, Shader, SimplexNoise } from "shaders/react";

/** Colours for the field, already mixed from the theme tokens (see shader-bg.tsx). */
export type Field = { base: string; cool: string; warm: string; soft: string };

export type Variant = "mesh" | "flow" | "noise" | "fog";

/**
 * One calm field per variant, all in the page's own colours. They are the shortlist the owner can
 * switch between by changing `BACKDROP` in shader-bg.tsx. Speeds are low on purpose; `still` freezes
 * the clock for reduced motion.
 */
export default function ShaderLayer({
  variant,
  field,
  still,
  onReady,
  onUnavailable,
}: {
  variant: Variant;
  field: Field;
  still: boolean;
  onReady: () => void;
  onUnavailable: () => void;
}) {
  const speed = (v: number) => (still ? 0 : v);
  return (
    <Shader
      className="size-full"
      colorSpace="srgb"
      disableTelemetry
      onReady={onReady}
      onUnavailable={onUnavailable}
    >
      {variant === "mesh" && (
        <MeshGradient
          stops={[
            { color: field.base, position: 0 },
            { color: field.cool, position: 0.55 },
            { color: field.warm, position: 1 },
          ]}
          count={5} smoothness={3} swirl={0.15} drift={0.5} speed={speed(0.35)} />
      )}
      {variant === "flow" && (
        <FlowingGradient colorA={field.base} colorB={field.cool} colorC={field.soft} colorD={field.warm} distortion={0.35} speed={speed(0.2)} />
      )}
      {variant === "noise" && (
        <SimplexNoise colorA={field.base} colorB={field.cool} stops={null} scale={1.4} speed={speed(0.12)} />
      )}
      {variant === "fog" && (
        <Fog colorA={field.base} colorB={field.cool} turbulence={0.5} detail={8} blending={0.5} mouseInfluence={0} speed={speed(0.2)} />
      )}
    </Shader>
  );
}
