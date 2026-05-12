// Metro config — Expo + pnpm monorepo.
//
// Vấn đề pnpm: symlink strict isolation → Metro KHÔNG resolve được transitive
// deps (vd @expo/metro-runtime mà expo-router import nội bộ).
//
// Fix combo:
//   1. watchFolders = monorepo root → Metro watch packages/shared
//   2. nodeModulesPaths = [apps/mobile, root] → ưu tiên local nhưng fallback root
//   3. GIỮ HIERARCHICAL LOOKUP (default true) → Node module resolution walk-up
//      qua các parent node_modules → tìm được package hoist tại root
//      (xem .npmrc public-hoist-pattern)
//   4. resolver.unstable_enableSymlinks = true → Metro follow pnpm symlinks
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Theo dõi file trong toàn monorepo (HMR khi sửa packages/shared).
config.watchFolders = [monorepoRoot];

// Thứ tự resolve node_modules: workspace local → monorepo root (hoist target).
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// Follow symlink (pnpm dùng symlink để link store → workspace).
config.resolver.unstable_enableSymlinks = true;

// Required cho package có hoisted dep (default: false trong Expo 54).
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
