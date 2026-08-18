import crypto from "node:crypto";
import fs from "node:fs/promises";
import { Ajv, type ValidateFunction } from "ajv";
// ajv-formats is CJS with `module.exports = plugin`; the shipped types expose it
// as a namespace, so the default import needs a cast under NodeNext resolution.
import addFormatsModule, { type FormatsPlugin } from "ajv-formats";

const addFormats = addFormatsModule as unknown as FormatsPlugin;
import { loadImage, type Image } from "@napi-rs/canvas";
import { getQuickJS, type QuickJSWASMModule } from "quickjs-emscripten";
import type { SomeJSONSchema } from "ajv/dist/types/json-schema.js";

export const CONFIG_FILE = "server-config.json";

export interface ServerConfig {
	schema: SomeJSONSchema;
	project_id?: number;
	config_token?: string;
	template: {
		issuers: Array<{ url: string; [key: string]: unknown }>;
		[key: string]: unknown;
	};
	id_field: string;
	qrcode?: string;
	custom_url?: string;
	identity?: { factory: string };
}

export interface AppContext {
	config: ServerConfig;
	binding: ConfigBinding | null;
	validate: ValidateFunction;
	quickJS: QuickJSWASMModule;
	qrcodeBackground: Image | null;
}

export interface ConfigBinding {
	project_id: number;
	iss: string;
	document_store: string;
	template_url: string;
	config_hash: string;
}

function canonicalize(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;

	if (value !== null && typeof value === "object") {
		const record = value as Record<string, unknown>;
		const entries = Object.keys(record)
			.sort()
			.filter((key) => record[key] !== undefined)
			.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`);
		return `{${entries.join(",")}}`;
	}

	return JSON.stringify(value === undefined ? null : value);
}

function hashConfig(config: ServerConfig): string {
	const { config_token, ...rest } = config;
	return crypto.createHash("sha256").update(canonicalize(rest)).digest("hex");
}

function readBinding(config: ServerConfig): ConfigBinding | null {
	if (config.config_token == null) return null;

	const parts = config.config_token.split(".");

	if (parts.length !== 3) {
		throw new Error(`${CONFIG_FILE} has a malformed "config_token"`);
	}

	let claims: ConfigBinding & { config_hash: string };

	try {
		claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
	} catch {
		throw new Error(`${CONFIG_FILE} has an unreadable "config_token"`);
	}

	if (claims.config_hash !== hashConfig(config)) {
		throw new Error(
			`${CONFIG_FILE} has been modified since it was downloaded from ${claims.iss} — download a fresh copy for project ${claims.project_id}`,
		);
	}

	return claims;
}

function assertValid(config: ServerConfig): void {
	const missing = (["schema", "template", "id_field"] as const).filter(
		(key) => config[key] == null,
	);

	if (missing.length > 0) {
		throw new Error(`${CONFIG_FILE} is missing: ${missing.join(", ")}`);
	}

	if (!Array.isArray(config.template.issuers) || !config.template.issuers[0]) {
		throw new Error(`${CONFIG_FILE} requires at least one template issuer`);
	}

	if (!URL.canParse(config.template.issuers[0].url ?? "")) {
		throw new Error(
			`${CONFIG_FILE} requires a valid url on the first template issuer`,
		);
	}
}

export async function loadContext(
	configFile = CONFIG_FILE,
): Promise<AppContext> {
	const config: ServerConfig = JSON.parse(
		await fs.readFile(configFile, "utf8"),
	);
	assertValid(config);

	if (config.custom_url != null && config.qrcode == null) {
		throw new Error(
			`${CONFIG_FILE} sets "custom_url" but no "qrcode" background image`,
		);
	}

	const binding = readBinding(config);

	if (binding == null && process.env.REQUIRE_CONFIG_BINDING === "true") {
		throw new Error(
			`${CONFIG_FILE} has no "config_token" — download a fresh copy from the Verify portal`,
		);
	}

	return {
		config,
		binding,
		validate: addFormats(new Ajv()).compile(config.schema),
		quickJS: await getQuickJS(),
		qrcodeBackground: config.qrcode ? await loadImage(config.qrcode) : null,
	};
}
