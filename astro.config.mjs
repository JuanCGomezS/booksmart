import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

const publicBusinessRouteFallback = {
	name: 'booksmart-public-business-route-fallback',
	enforce: 'pre',
	apply: 'serve',
	configureServer(server) {
		server.middlewares.use((request, _response, next) => {
			const pathname = request.url?.split('?')[0];
			if (request.method === 'GET' && pathname?.startsWith('/b/') && pathname !== '/b/') {
				request.url = '/b/';
			}
			next();
		});
	},
};

// https://astro.build/config
export default defineConfig({
	site: 'https://juancgomezs.github.io',
	base: process.env.NODE_ENV === 'production' ? '/booksmart/' : '/',
	vite: {
		plugins: [publicBusinessRouteFallback, tailwindcss()],
	},
	integrations: [react()],
});
