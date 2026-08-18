import type { Request, Response } from "express";
import { nanoid } from "nanoid";
import snakecaseKeys from "snakecase-keys";
import { encrypt } from "objectcipher";
import { encryptString } from "../encryption.js";
import { badRequest } from "../errors.js";
import {
	buildDocumentData,
	createCustomUrl,
	DEFAULT_KEY_LENGTH,
	KEY_TYPE_GOV_KH,
	KEY_TYPE_OA_1,
	MAX_KEY_LENGTH,
	MIN_KEY_LENGTH,
	SUPPORTED_KEY_TYPES,
	wrap,
} from "../document.js";
import type { AppContext } from "../config.js";
import type { ApiVersion } from "./version.js";

interface EncryptBody {
	data?: unknown;
	document_key?: unknown;
	document_key_length?: unknown;
	document_key_type?: unknown;
}

interface ValidatedRequest {
	data: Record<string, unknown>;
	documentKey?: string;
	documentKeyLength: number;
	documentKeyType: string;
}

const AES_KEY_HEX_LENGTHS = new Set([32, 48, 64]);

function isAesKey(key: string): boolean {
	return AES_KEY_HEX_LENGTHS.has(key.length) && /^[0-9a-fA-F]+$/.test(key);
}

function parseBody(body: EncryptBody): ValidatedRequest {
	const documentKey = body.document_key;
	const documentKeyLength = body.document_key_length || DEFAULT_KEY_LENGTH;
	const documentKeyType = body.document_key_type || KEY_TYPE_OA_1;

	if (typeof body.data !== "object" || body.data == null) {
		throw badRequest("INVALID_DATA");
	}

	if (documentKey != null && typeof documentKey !== "string") {
		throw badRequest("INVALID_DOCUMENT_KEY");
	}

	if (
		typeof documentKeyType !== "string" ||
		!SUPPORTED_KEY_TYPES.has(documentKeyType)
	) {
		throw badRequest("INVALID_DOCUMENT_KEY_TYPE");
	}

	if (
		documentKeyType === KEY_TYPE_GOV_KH &&
		(typeof documentKeyLength !== "number" ||
			documentKeyLength < MIN_KEY_LENGTH ||
			documentKeyLength > MAX_KEY_LENGTH)
	) {
		throw badRequest("INVALID_DOCUMENT_KEY_LENGTH");
	}

	if (
		documentKeyType === KEY_TYPE_OA_1 &&
		typeof documentKey === "string" &&
		!isAesKey(documentKey)
	) {
		throw badRequest("INVALID_DOCUMENT_KEY");
	}

	return {
		data: body.data as Record<string, unknown>,
		documentKey: documentKey ?? undefined,
		documentKeyLength: documentKeyLength as number,
		documentKeyType,
	};
}

function configBinding(ctx: AppContext): Record<string, unknown> {
	if (ctx.binding == null) return {};

	return {
		config_token: ctx.config.config_token,
		config_manifest: {
			project_id: ctx.binding.project_id,
			document_store: ctx.config.template.issuers[0]?.documentStore,
			template_url: (ctx.config.template.$template as { url?: string })?.url,
		},
	};
}

function forVersion(
	version: ApiVersion,
	value: object,
): Record<string, unknown> {
	const record = value as Record<string, unknown>;
	return version === 1 ? snakecaseKeys(record) : record;
}

export async function encryptHandler(
	ctx: AppContext,
	version: ApiVersion,
	req: Request,
	res: Response,
): Promise<void> {
	const { data, documentKey, documentKeyLength, documentKeyType } = parseBody(
		req.body as EncryptBody,
	);

	if (!ctx.validate(data)) {
		throw badRequest("INVALID_DATA", { errors: ctx.validate.errors });
	}

	const documentData = buildDocumentData(ctx, data);
	const wrappedDocument = wrap(documentData);
	const signature = wrappedDocument.signature;
	const documentId = data[ctx.config.id_field];

	if (documentKeyType === KEY_TYPE_GOV_KH) {
		const key = documentKey || nanoid(documentKeyLength);

		if (key.length < MIN_KEY_LENGTH) {
			throw badRequest("INVALID_DOCUMENT_KEY_LENGTH");
		}

		res.json({
			document_id: documentId,
			document_signature: signature,
			document_key: key,
			encrypted_document: {
				cipherText: Buffer.from(encrypt(wrappedDocument, key)).toString(
					"base64",
				),
				type: documentKeyType,
			},
			...configBinding(ctx),
			...createCustomUrl(ctx, documentData, key),
		});
		return;
	}

	const { key, ...parts } = encryptString(
		JSON.stringify(wrappedDocument),
		documentKey,
	);

	res.json({
		document_id: documentId,
		document_signature: forVersion(version, signature),
		document_key: key,
		encrypted_document: forVersion(version, parts),
		...configBinding(ctx),
		...createCustomUrl(ctx, documentData, key),
	});
}
