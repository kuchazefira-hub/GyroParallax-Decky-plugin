// Required by the classic "react" JSX transform (see index.tsx for details).
import * as React from 'react';
import { VFC, useEffect, useRef } from 'react';
import { overscanScaleFor } from '../profiles/presets';

export interface ParallaxOverlayHandle {
  background: HTMLDivElement | null;
  middle: HTMLDivElement | null;
  foreground: HTMLDivElement | null;
  logo: HTMLDivElement | null;
}

interface Props {
  visible: boolean;
  images: { background: string | null; foreground: string | null; logo: string | null };
  logoOpacity: number;
  maxDisplacement: number;
  onRefsReady: (handle: ParallaxOverlayHandle) => void;
}

// Rendered into a standalone container appended to document.body (see
// index.tsx), *not* injected into Steam's own React tree. This keeps the
// plugin resilient to Steam client UI changes (there is nothing here that
// depends on the shape of Valve's components) at the cost of relying on
// simple z-index/opacity layering rather than a true DOM-parent
// relationship with the Play button, title, etc.
export const ParallaxOverlay: VFC<Props> = ({ visible, images, logoOpacity, maxDisplacement, onRefsReady }) => {
  const backgroundRef = useRef<HTMLDivElement | null>(null);
  const middleRef = useRef<HTMLDivElement | null>(null);
  const foregroundRef = useRef<HTMLDivElement | null>(null);
  const logoRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    onRefsReady({
      background: backgroundRef.current,
      middle: middleRef.current,
      foreground: foregroundRef.current,
      logo: logoRef.current,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const overscan = overscanScaleFor(maxDisplacement);

  return (
    <div
      className="gyroparallax-root"
      style={{
        opacity: visible ? 1 : 0,
        pointerEvents: 'none',
      }}
    >
      <div
        ref={backgroundRef}
        className="gyroparallax-layer gyroparallax-background"
        style={{
          backgroundImage: images.background ? `url(${images.background})` : undefined,
          transform: `scale(${overscan})`,
        }}
      />
      <div ref={middleRef} className="gyroparallax-layer gyroparallax-middle" />
      <div
        ref={foregroundRef}
        className="gyroparallax-layer gyroparallax-foreground"
        style={{
          backgroundImage: images.foreground ? `url(${images.foreground})` : undefined,
          transform: `scale(${overscan})`,
        }}
      />
      {images.logo && (
        <div
          ref={logoRef}
          className="gyroparallax-layer gyroparallax-logo"
          style={{ backgroundImage: `url(${images.logo})`, opacity: logoOpacity }}
        />
      )}
    </div>
  );
};
