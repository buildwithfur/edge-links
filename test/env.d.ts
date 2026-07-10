import type {} from "@cloudflare/vitest-pool-workers/types";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}
