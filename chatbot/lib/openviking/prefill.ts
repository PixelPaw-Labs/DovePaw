/**
 * Path to the user's global OpenViking config (outside DovePaw).
 *
 * The chatbot uses this file ONLY for prefill defaults the very first time a
 * user opens the OpenViking settings — it's never written to. See
 * `app/api/openviking/config/route.ts` GET handler.
 */
import { join } from "node:path";

export const USER_GLOBAL_OV_CONF = join(process.env.HOME ?? "", ".openviking", "ov.conf");
