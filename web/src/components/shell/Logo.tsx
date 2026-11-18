/** Usama CRM mark: a roof over a "U" (home + Usama). Same drawing as app/icon.svg. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" className="shrink-0">
      <rect width="512" height="512" rx="128" fill="#10107f" />
      <g fill="none" stroke="#fff" strokeWidth="46" strokeLinecap="round" strokeLinejoin="round">
        <path d="M112 232 L256 114 L400 232" />
        <path d="M180 260 V318 a76 76 0 0 0 152 0 V260" />
      </g>
    </svg>
  );
}
