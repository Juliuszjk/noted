const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Obserwacja głównego katalogu monorepo
config.watchFolders = [workspaceRoot];

// Ścieżki do node_modules (lokalnego i głównego)
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// USUNIĘTO: disableHierarchicalLookup
// Metro musi mieć domyślne rozwiązywanie ścieżek, żeby poprawnie czytać wirtualny magazyn pnpm.

module.exports = config;
