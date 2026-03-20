import { useEffect, useMemo, useState } from 'react';

export type UIVariant = 'desktop' | 'mobile';

const MOBILE_MAX_WIDTH = 900;
const COARSE_QUERY = '(hover: none) and (pointer: coarse)';

function getOverrideFromSearch(search: string): UIVariant | null {
  const value = new URLSearchParams(search).get('ui');
  if (value === 'mobile' || value === 'desktop') return value;
  return null;
}

function detectFromEnvironment(): UIVariant {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'desktop';
  }

  const coarse = window.matchMedia(COARSE_QUERY).matches;
  return coarse && window.innerWidth <= MOBILE_MAX_WIDTH ? 'mobile' : 'desktop';
}

export function getUIVariant(): UIVariant {
  if (typeof window === 'undefined') return 'desktop';
  return getOverrideFromSearch(window.location.search) ?? detectFromEnvironment();
}

export function useUIVariant(): UIVariant {
  const [variant, setVariant] = useState<UIVariant>(() => getUIVariant());

  const override = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return getOverrideFromSearch(window.location.search);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (override) {
      setVariant(override);
      return;
    }

    const mql = window.matchMedia(COARSE_QUERY);
    const legacyMql = mql as MediaQueryList & {
      addListener?: (listener: (this: MediaQueryList, ev: MediaQueryListEvent) => void) => void;
      removeListener?: (listener: (this: MediaQueryList, ev: MediaQueryListEvent) => void) => void;
    };
    const update = () => setVariant(detectFromEnvironment());

    update();
    window.addEventListener('resize', update);
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', update);
      return () => {
        window.removeEventListener('resize', update);
        mql.removeEventListener('change', update);
      };
    }

    // Safari fallback
    legacyMql.addListener?.(update as (this: MediaQueryList, ev: MediaQueryListEvent) => void);
    return () => {
      window.removeEventListener('resize', update);
      legacyMql.removeListener?.(update as (this: MediaQueryList, ev: MediaQueryListEvent) => void);
    };
  }, [override]);

  return override ?? variant;
}
