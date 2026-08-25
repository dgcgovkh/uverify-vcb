import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "../src/app.js";
import { loadContext, type AppContext } from "../src/config.js";

export const FULL_CONFIG = "test/fixtures/full-config.json";
export const MINIMAL_CONFIG = "test/fixtures/minimal-config.json";

export function context(configFile = FULL_CONFIG): Promise<AppContext> {
	return loadContext(configFile);
}

export interface TestResponse {
	status: number;
	body: any;
	text: string;
}

export interface TestServer {
	get(path: string): Promise<TestResponse>;
	post(path: string, body: unknown): Promise<TestResponse>;
	postRaw(
		path: string,
		body: string,
		contentType?: string,
	): Promise<TestResponse>;
	close(): Promise<void>;
}

export async function startServer(
	configFile = FULL_CONFIG,
): Promise<TestServer> {
	const app = createApp(await loadContext(configFile));
	const server: Server = await new Promise((resolve) => {
		const s = app.listen(0, () => resolve(s));
	});
	const { port } = server.address() as AddressInfo;
	const base = `http://127.0.0.1:${port}`;

	async function send(path: string, init: RequestInit) {
		const res = await fetch(base + path, init);
		const text = await res.text();
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			parsed = undefined;
		}
		return { status: res.status, body: parsed as any, text };
	}

	return {
		get: (path) => send(path, { method: "GET" }),
		post: (path, body) =>
			send(path, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			}),
		postRaw: (path, body, contentType = "application/json") =>
			send(path, {
				method: "POST",
				headers: { "content-type": contentType },
				body,
			}),
		close: () =>
			new Promise((resolve, reject) =>
				server.close((err) => (err ? reject(err) : resolve())),
			),
	};
}

/** Salted values look like `<uuid>:<type>:<value>`; this recovers the value. */
export function unsalt(value: string): string {
	return value.split(":").slice(2).join(":");
}
