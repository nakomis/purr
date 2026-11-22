import { useState } from 'react';

const hue = (text: string) => [...text].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7);

/** A project's sticker icon, or a lettered placeholder from its prefix when it has none (or it fails to load). */
export function ProjectIcon({ prefix, icon, size = 28 }: { prefix: string; icon?: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (icon && !failed) {
    return (
      <img
        src={icon}
        alt={`${prefix} icon`}
        width={size}
        height={size}
        loading="lazy"
        onError={() => setFailed(true)}
        className="shrink-0 rounded-md object-contain"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      role="img"
      aria-label={`${prefix} placeholder icon`}
      className="inline-flex shrink-0 items-center justify-center rounded-md font-bold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: `hsl(${hue(prefix)} 38% 38%)`,
      }}
    >
      {prefix.slice(0, 2).toUpperCase()}
    </span>
  );
}

/** Epics have no sticker: a ginger diamond marks them. */
export function EpicIcon({ size = 28 }: { size?: number }) {
  return (
    <span
      role="img"
      aria-label="Epic"
      className="inline-flex shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent"
      style={{ width: size, height: size, fontSize: size * 0.6 }}
    >
      ◆
    </span>
  );
}
