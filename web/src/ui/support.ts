/** Определение среды: мобильные устройства и недостающие возможности браузера. */

export interface Support {
  /** Можно ли запускать игру вообще. */
  game: boolean;
  /** Можно ли играть онлайн (нужен RTCPeerConnection). */
  online: boolean;
  /** Есть File System Access API (showDirectoryPicker). */
  directoryPicker: boolean;
  mobile: boolean;
  wasm: boolean;
  webgl2: boolean;
}

let cached: Support | null = null;

function isMobile(): boolean {
  const coarseOnly = matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
  const touch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
  const mobileUA = /Android|iPhone|iPad|iPod|Mobile|Silk|Opera Mini|IEMobile/i.test(navigator.userAgent);
  return (coarseOnly && touch) || mobileUA;
}

function hasWebGL2(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export function detectSupport(): Support {
  if (cached) return cached;
  const wasm = typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function';
  const webgl2 = hasWebGL2();
  const mobile = isMobile();
  const game = wasm && webgl2 && !mobile;
  cached = {
    game,
    online: game && typeof RTCPeerConnection === 'function',
    directoryPicker: typeof window.showDirectoryPicker === 'function',
    mobile,
    wasm,
    webgl2,
  };
  return cached;
}
