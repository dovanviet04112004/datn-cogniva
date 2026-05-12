/**
 * Type declarations cho side-effect CSS imports (vd `import './globals.css'`
 * hoặc `import '@excalidraw/excalidraw/index.css'`).
 *
 * Next.js types built-in chỉ khai báo `*.module.css` (CSS Modules) — plain
 * CSS imports không có type → TS2882 "Cannot find module or type
 * declarations for side-effect import".
 *
 * Khai báo wildcard `*.css` ở đây fix cho cả app. Runtime vẫn hoạt động
 * vì Next.js webpack/Turbopack handle CSS qua loader, không cần TS type.
 */
declare module '*.css';
