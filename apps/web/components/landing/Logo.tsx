export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 2.2a7.8 7.8 0 1 1-7.4 10.2" stroke="#e9ebee" strokeOpacity=".9" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M10 5.8a4.2 4.2 0 1 1-4 5.5" stroke="#e9ebee" strokeOpacity=".55" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="10" cy="10" r="1.9" fill="#5fd4f4" />
    </svg>
  );
}

export function Arrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2 7h9M7.5 3.5 11 7l-3.5 3.5" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
