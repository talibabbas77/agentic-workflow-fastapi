// Launcher and panel styles. Applied inside a closed shadow root through a
// constructable stylesheet, so a strict host CSP (no 'unsafe-inline' styles)
// does not block them. Falls back to a <style> element on old browsers.
export const CSS = `:host{all:initial;--paper:#F5F0E6;--line:#DDD5C8;--ink:#1B1916;--rust:#B5431F;--rh:#9A3818;--on:#FBF8F2}
@media (prefers-color-scheme:dark){:host{--paper:#161412;--line:#2E2A26;--ink:#F1EBE0;--rust:#E0673F;--rh:#EA7C57;--on:#161412}}
.l,.f{position:fixed;z-index:2147483000;box-sizing:border-box;margin:0;padding:0}
.l{right:20px;bottom:20px;width:56px;height:56px;border:0;border-radius:50%;background:var(--rust);color:var(--on);cursor:pointer;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent}
.l:hover{background:var(--rh)}
.l:focus-visible{outline:2px solid var(--ink);outline-offset:3px}
.l svg{pointer-events:none}
.m{display:block;width:24px;height:33px}
.b{fill:var(--on)}
.r{fill:var(--rust)}
.c{display:none;width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
.o .m{display:none}
.o .c{display:block}
.d{position:absolute;top:1px;right:1px;width:14px;height:14px;box-sizing:border-box;border-radius:50%;background:var(--rust);border:2px solid var(--paper)}
.d[hidden]{display:none}
.f{right:20px;bottom:88px;width:380px;height:600px;max-width:calc(100vw - 40px);max-height:calc(100vh - 108px);border:1px solid var(--line);border-radius:12px;background:var(--paper);display:block}
.f[hidden]{display:none}
@media (max-width:479px){.f{top:0;right:0;bottom:0;left:0;width:100%;height:100%;max-width:none;max-height:none;border:0;border-radius:0}}
@media (prefers-reduced-motion:no-preference){.l{transition:background-color .15s}.f{animation:i .18s ease-out}}
@keyframes i{from{opacity:0;transform:translateY(8px)}}`;
