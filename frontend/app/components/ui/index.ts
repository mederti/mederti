/**
 * Tuned design-system primitives. Import surfaces from here:
 *   import { Card, ListRow, Pill, Section, IconTile } from "@/app/components/ui";
 *
 * Motion/state signatures live in primitives.css (imported via globals.css).
 * Tokens live in globals.css (:root) and are wired into Tailwind utilities
 * (bg-surf, text-tx-3, border-border-2, rounded-card, shadow-card, …).
 */
export { Icon, IconTile, type IconName } from "./Icon";
export { Pill, SeverityLabel, type PillTone, type SeverityLevel } from "./Pill";
export { Card, Panel } from "./Card";
export { ListRow } from "./ListRow";
export { Section } from "./Section";
export { Button, type ButtonVariant } from "./Button";
