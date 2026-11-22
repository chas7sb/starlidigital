import { defaultToolRegistry } from './registry.js';
import { registerUniversalTools } from './universal/index.js';

// Auto-register default universal tools in the singleton default registry
registerUniversalTools(defaultToolRegistry);

export * from './types.js';
export * from './registry.js';
export * from './adapter.js';
export * from './universal/index.js';
export * from './audit.js';
