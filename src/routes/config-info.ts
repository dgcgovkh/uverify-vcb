import type { Request, Response } from "express";
import type { AppContext } from "../config.js";

export function configInfoHandler(
	ctx: AppContext,
	_req: Request,
	res: Response,
): void {
	res.json({
		project_id: ctx.binding?.project_id ?? ctx.config.project_id ?? null,
		template_name: ctx.config.template.$template
			? (ctx.config.template.$template as { name?: string }).name
			: null,
		environment: ctx.binding?.iss ?? null,
		config_hash: ctx.binding?.config_hash ?? null,
		bound: ctx.binding != null,
	});
}
