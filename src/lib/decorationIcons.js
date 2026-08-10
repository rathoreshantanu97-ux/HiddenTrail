// Re-export point -- the actual icon library lives in decorationIcons.jsx
// (it needs JSX syntax, which requires the .jsx extension so Vite's
// default esbuild loader parses it correctly). This file exists only so
// an accidental `.js` import path doesn't silently 404 -- prefer
// importing "./decorationIcons.jsx" directly in new code.
export * from "./decorationIcons.jsx";
