export function AuroraBackground() {
  return (
    <>
      <div className="aurora" aria-hidden>
        <span style={{ width: '46vw', height: '46vw', left: '-8vw', top: '-14vw', background: 'var(--accent)' }} />
        <span style={{ width: '38vw', height: '38vw', right: '-6vw', top: '-8vw', background: 'var(--accent-2)', animationDelay: '-7s' }} />
        <span style={{ width: '34vw', height: '34vw', left: '30vw', top: '28vh', background: 'var(--accent-3)', opacity: 0.25, animationDelay: '-14s' }} />
      </div>
      <div className="grid-overlay" aria-hidden />
    </>
  );
}
