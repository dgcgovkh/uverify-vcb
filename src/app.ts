import express, { type Express } from "express";
import helmet from "helmet";
import { asyncHandler, errorHandler } from "./errors.js";
import { configInfoHandler } from "./routes/config-info.js";
import { decryptHandler } from "./routes/decrypt.js";
import { encryptHandler } from "./routes/encrypt.js";
import { qrcodeHandler } from "./routes/qrcode.js";
import type { ApiVersion } from "./routes/version.js";
import type { AppContext } from "./config.js";

const MAX_PAYLOAD_SIZE = "50mb";

const V0: ApiVersion = 0;
const V1: ApiVersion = 1;

export function createApp(ctx: AppContext): Express {
	const app = express();

	app.use(helmet());
	app.use(express.json({ limit: MAX_PAYLOAD_SIZE }));
	app.use(express.urlencoded({ extended: false, limit: MAX_PAYLOAD_SIZE }));
	app.disable("x-powered-by");

	app.post(
		"/api/encrypt-document",
		asyncHandler((req, res) => encryptHandler(ctx, V0, req, res)),
	);
	app.post(
		"/api/decrypt-document",
		asyncHandler((req, res) => decryptHandler(V0, req, res)),
	);
	app.post(
		"/api/qrcode",
		asyncHandler((req, res) => qrcodeHandler(ctx, req, res)),
	);

	app.get("/api/v1/config-info", (req, res) => configInfoHandler(ctx, req, res));

	app.post(
		"/api/v1/encrypt-document",
		asyncHandler((req, res) => encryptHandler(ctx, V1, req, res)),
	);
	app.post(
		"/api/v1/decrypt-document",
		asyncHandler((req, res) => decryptHandler(V1, req, res)),
	);
	app.post(
		"/api/v1/qrcode",
		asyncHandler((req, res) => qrcodeHandler(ctx, req, res)),
	);

	app.use(errorHandler);

	return app;
}
