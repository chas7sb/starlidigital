import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { realpathSync } from 'node:fs';

import { viteStaticCopy } from 'vite-plugin-static-copy';

// /** @type {import('vite').Plugin} */
// const viteServerConfig = {
// 	name: 'log-request-middleware',
// 	configureServer(server) {
// 		server.middlewares.use((req, res, next) => {
// 			res.setHeader('Access-Control-Allow-Origin', '*');
// 			res.setHeader('Access-Control-Allow-Methods', 'GET');
// 			res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
// 			res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
// 			next();
// 		});
// 	}
// };

export default defineConfig({
	cacheDir: '.vite-cache',
	plugins: [
sveltekit(),
		viteStaticCopy({
			targets: [
				{
					src: 'node_modules/onnxruntime-web/dist/*.jsep.*',

					dest: 'wasm'
				}
			]
		})
	],
	define: {
		APP_VERSION: JSON.stringify(process.env.npm_package_version || '0.6.5'),
		APP_BUILD_HASH: JSON.stringify(process.env.APP_BUILD_HASH || 'dev-build')
	},
	build: {
		sourcemap: process.env.STARLI_BUILD_SOURCEMAPS === 'true',
        ...(process.env.STARLI_PREVIEW_BUILD === 'true' ? {minify:false as const,cssMinify:false as const} : {})
	},

    server: {
        host: '127.0.0.1', port: 5180, strictPort: true,
        fs: { allow: ['.', realpathSync('node_modules')] },
        proxy: Object.fromEntries(['/api','/openai','/ollama','/ws','/health'].map(prefix => [prefix, {
            target: process.env.STARLI_BACKEND_URL || 'http://127.0.0.1:18381',
            changeOrigin: true, ws: true
        }]))
    },
	worker: {
		format: 'es'
	}
});
