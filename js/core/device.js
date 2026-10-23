// Device detection and per-device feature flags.
// Features that only make sense with a mouse/keyboard (split view, hover, shortcuts, right-click menu,
// drag from library) are desktop-only; touch-specific ones (bottom sheets, two-finger rotation, haptics)
// are mobile-only. Users can force a mode in Settings.

export function detectDevice() {
  const mm = (q) => typeof matchMedia === 'function' && matchMedia(q).matches;
  const coarse = mm('(pointer: coarse)');
  const noHover = mm('(hover: none)');
  const small = Math.min(window.innerWidth, window.innerHeight) < 600 || window.innerWidth < 760;
  return (coarse && noHover) || (coarse && small) || (small && !mm('(pointer: fine)')) ? 'mobile' : 'desktop';
}

export function featureFlags(kind, quality = 'auto') {
  const mobile = kind === 'mobile';
  const lowPower = (navigator.hardwareConcurrency || 4) <= 4 || (navigator.deviceMemory || 4) <= 3;
  const q = quality === 'auto' ? (mobile && lowPower ? 'low' : 'high') : quality;
  return {
    kind, mobile, desktop: !mobile, quality: q,
    // desktop only
    splitView: !mobile, keyboard: !mobile, hover: !mobile, contextMenu: !mobile, dragFromLibrary: !mobile, statusBar: !mobile, codeEditorTabs: !mobile,
    // mobile only
    bottomSheet: mobile, twoFingerRotate: mobile, haptics: mobile && 'vibrate' in navigator,
    // rendering
    shadowMap: q === 'low' ? 1024 : 2048,
    maxPixelRatio: q === 'low' ? 1.25 : mobile ? 1.75 : 2,
  };
}

/** Table used by the help dialog so users can see what changes between devices. */
export const FEATURE_TABLE = [
  ['splitView', 'desktop'], ['keyboard', 'desktop'], ['hover', 'desktop'], ['contextMenu', 'desktop'], ['dragFromLibrary', 'desktop'],
  ['bottomSheet', 'mobile'], ['twoFingerRotate', 'mobile'], ['haptics', 'mobile'],
];
