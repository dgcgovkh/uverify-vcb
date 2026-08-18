import crypto from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadContext } from "../src/config.js";
import { startServer, type TestServer } from "./helpers.js";

const { privateKey } = crypto.generateKeyPairSync("ed25519");

const BASE = {
	id_field: "id",
	schema: {
		type: "object",
		properties: { id: { type: "string" } },
		required: ["id"],
	},
	template: {
		$template: { name: "RUPP_BACHELOR", url: "https://renderer.test/RUPP" },
		issuers: [{ name: "RUPP", url: "https://rupp.test", documentStore: "0xAAAA" }],
	},
};

function canonicalize(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;

	if (value !== null && typeof value === "object") {
		const record = value as Record<string, unknown>;
		return `{${Object.keys(record)
			.sort()
			.filter((key) => record[key] !== undefined)
			.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
			.join(",")}}`;
	}

	return JSON.stringify(value === undefined ? null : value);
}

function base(): Record<string, unknown> {
	return structuredClone(BASE);
}

function sign(
	config: Record<string, unknown>,
	overrides = {},
): Record<string, unknown> {
	const hash = crypto
		.createHash("sha256")
		.update(canonicalize(config))
		.digest("hex");

	const header = Buffer.from(
		JSON.stringify({ alg: "EdDSA", typ: "JWT", kid: "test" }),
	).toString("base64url");

	const payload = Buffer.from(
		JSON.stringify({
			iss: "service.verify.gov.kh",
			project_id: 42,
			config_hash: hash,
			document_store: "0xAAAA",
			template_url: "https://renderer.test/RUPP",
			...overrides,
		}),
	).toString("base64url");

	const signature = crypto
		.sign(null, Buffer.from(`${header}.${payload}`), privateKey)
		.toString("base64url");

	return { ...config, config_token: `${header}.${payload}.${signature}` };
}

async function writeConfig(config: unknown): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "binding-"));
	const file = join(dir, "server-config.json");
	await writeFile(file, JSON.stringify(config));
	return file;
}

describe("config binding at startup", () => {
	it("loads a signed config and exposes its project", async () => {
		const ctx = await loadContext(
			await writeConfig(sign({ ...base(), project_id: 42 })),
		);

		expect(ctx.binding?.project_id).toBe(42);
		expect(ctx.binding?.iss).toBe("service.verify.gov.kh");
	});

	it("refuses to start when the config was edited after signing", async () => {
		const signed = sign({ ...base(), project_id: 42 });
		(signed.template as typeof BASE.template).issuers[0].documentStore =
			"0xBBBB";

		await expect(loadContext(await writeConfig(signed))).rejects.toThrow(
			/has been modified/,
		);
	});

	it("refuses to start when project_id was edited to match another project", async () => {
		const signed = sign({ ...base(), project_id: 42 });
		signed.project_id = 77;

		await expect(loadContext(await writeConfig(signed))).rejects.toThrow(
			/has been modified/,
		);
	});

	it("refuses to start on a malformed token", async () => {
		await expect(
			loadContext(await writeConfig({ ...BASE, config_token: "nope" })),
		).rejects.toThrow(/malformed/);
	});

	it("still loads an unsigned config", async () => {
		const ctx = await loadContext(await writeConfig(base()));

		expect(ctx.binding).toBeNull();
	});
});

describe("config binding over the API", () => {
	const servers: TestServer[] = [];

	afterAll(() => Promise.all(servers.map((s) => s.close())));

	async function start(config: unknown) {
		const server = await startServer(await writeConfig(config));
		servers.push(server);
		return server;
	}

	it("returns the binding from /api/v1/config-info", async () => {
		const server = await start(sign({ ...base(), project_id: 42 }));
		const res = await server.get("/api/v1/config-info");

		expect(res.status).toBe(200);
		expect(res.body).toMatchObject({
			project_id: 42,
			template_name: "RUPP_BACHELOR",
			environment: "service.verify.gov.kh",
			bound: true,
		});
	});

	it("reports an unsigned config as unbound", async () => {
		const server = await start(base());
		const res = await server.get("/api/v1/config-info");

		expect(res.body).toMatchObject({ project_id: null, bound: false });
	});

	it("passes the token and manifest with an encrypted document", async () => {
		const signed = sign({ ...base(), project_id: 42 });
		const server = await start(signed);

		const res = await server.post("/api/v1/encrypt-document", {
			data: { id: "A-1" },
		});

		expect(res.status).toBe(200);
		expect(res.body.config_token).toBe(signed.config_token);
		expect(res.body.config_manifest).toEqual({
			project_id: 42,
			document_store: "0xAAAA",
			template_url: "https://renderer.test/RUPP",
		});
	});

	it("omits both for an unsigned config", async () => {
		const server = await start(base());
		const res = await server.post("/api/encrypt-document", {
			data: { id: "A-1" },
		});

		expect(res.status).toBe(200);
		expect(res.body.config_token).toBeUndefined();
		expect(res.body.config_manifest).toBeUndefined();
	});
});
