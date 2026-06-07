# Slice 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the NestJS HTTP+worker walking-skeleton on a Docker Compose dev environment (Postgres, Redis, Bugsink, VictoriaLogs) with typed config, structured logging shipped to VictoriaLogs, Bugsink error reporting, a health endpoint, migrations, and Biome+Jest tooling.

**Architecture:** One codebase, two bootstraps — `main.ts` (HTTP) and `worker.ts` (Nest application context, no HTTP). Hexagonal + vertical-slice layout: cross-cutting concerns in `src/shared/*`, feature modules in `src/modules/*`. Domain stays framework-free; adapters (Postgres via Drizzle/postgres.js, Redis via ioredis, observability) live in infrastructure.

**Tech Stack:** NestJS 11 (CommonJS build), `@nestjs/config` + Zod, `nestjs-pino`/pino, `@sentry/nestjs`, `@nestjs/terminus`, Drizzle ORM + drizzle-kit + postgres.js, ioredis, Jest + `@nestjs/testing`, Biome, pnpm, Docker Compose.

**Reference spec:** `docs/superpowers/specs/2026-06-07-slice-1-foundation-design.md`

---

## File Structure

```
.
├─ docker-compose.yml          # postgres, redis, victorialogs, bugsink, app, worker
├─ Dockerfile                  # Node 26 + corepack/pnpm image for app & worker
├─ .dockerignore
├─ .env.example                # host-oriented defaults (localhost URLs)
├─ package.json                # rewritten: CJS, new deps, scripts
├─ tsconfig.json               # CommonJS + decorators + strict
├─ tsconfig.build.json
├─ nest-cli.json
├─ biome.json                  # lint/format (replaces ESLint/Prettier)
├─ jest.config.ts              # ts-jest, decorator metadata
├─ drizzle.config.ts           # drizzle-kit config
├─ src/
│  ├─ main.ts                  # HTTP bootstrap
│  ├─ worker.ts                # worker bootstrap (no HTTP, no processors yet)
│  ├─ app.module.ts            # HTTP root: CoreModule + HealthModule + DebugModule
│  ├─ worker.module.ts         # worker root: CoreModule only
│  ├─ core.module.ts           # global: config, logging, sentry, database, redis
│  ├─ shared/
│  │  ├─ config/
│  │  │  ├─ env.schema.ts       # Zod schema + parse + warn-not-fatal API keys
│  │  │  ├─ config.module.ts    # @nestjs/config wired to env.schema
│  │  │  ├─ app-config.service.ts # typed accessor
│  │  │  └─ env.schema.spec.ts
│  │  ├─ observability/
│  │  │  ├─ logging.module.ts   # nestjs-pino LoggerModule.forRootAsync
│  │  │  ├─ victoria-logs.transport.ts # pino transport -> /insert/jsonline (fail-open)
│  │  │  ├─ victoria-logs.transport.spec.ts
│  │  │  └─ sentry.ts           # initSentry() (Bugsink DSN, no-op if unset)
│  │  ├─ database/
│  │  │  ├─ schema.ts           # drizzle schema: app_meta (baseline)
│  │  │  ├─ database.module.ts  # postgres.js pool + drizzle provider (global)
│  │  │  ├─ database.tokens.ts  # DI tokens
│  │  │  └─ migrate.ts          # standalone migrate runner (db:migrate)
│  │  └─ redis/
│  │     ├─ redis.module.ts     # ioredis connection provider (global)
│  │     └─ redis.tokens.ts
│  └─ modules/
│     ├─ health/
│     │  ├─ health.controller.ts
│     │  ├─ database.health.ts  # custom Terminus indicator (SELECT 1)
│     │  ├─ redis.health.ts     # custom Terminus indicator (PING)
│     │  ├─ health.module.ts
│     │  └─ health.controller.spec.ts
│     └─ debug/
│        ├─ debug.controller.ts # GET /debug/error (non-prod guard)
│        └─ debug.module.ts
└─ migrations/                  # drizzle-kit output (baseline SQL + meta)
```

---

## Task 1: Reset to a clean NestJS-shaped repo (package, tsconfig, tooling)

**Files:**
- Delete: `src/**` (v1 Express/SQLite app — preserved on `main`; Slice 2 ports pure logic via `git show main:src/...`), `public/`, `data/`
- Modify: `package.json`, `.gitignore`
- Create: `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`, `jest.config.ts`, `biome.json` (if absent)

- [ ] **Step 1: Remove v1 source**

```bash
git rm -r --quiet src public 2>/dev/null || true
rm -rf data dist
```
Note: v1 lives on `main`; do not lose it — it is the port source for Slice 2.

- [ ] **Step 2: Rewrite `package.json`**

```json
{
  "name": "@kerihenare/breakbeat",
  "description": "Breakbeat is a tool for finding content about a company",
  "author": "Keri Henare <keri@henare.co.nz>",
  "private": true,
  "license": "MIT",
  "version": "0.1.0",
  "main": "dist/main.js",
  "scripts": {
    "build": "nest build",
    "dev": "nest start --watch",
    "start": "node dist/main.js",
    "worker": "nest start --entryFile worker --watch",
    "worker:start": "node dist/worker.js",
    "test": "jest",
    "test:watch": "jest --watch",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "node -r ts-node/register src/shared/database/migrate.ts",
    "db:reset": "node -r ts-node/register src/shared/database/reset.ts && pnpm db:migrate",
    "compose:up": "docker compose up",
    "compose:down": "docker compose down"
  },
  "dependencies": {
    "@nestjs/common": "^11.0.0",
    "@nestjs/config": "^4.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "@nestjs/terminus": "^11.0.0",
    "@sentry/nestjs": "^9.0.0",
    "drizzle-orm": "^0.38.0",
    "ioredis": "^5.4.0",
    "nestjs-pino": "^4.1.0",
    "pino": "^9.5.0",
    "pino-abstract-transport": "^2.0.0",
    "pino-http": "^10.3.0",
    "postgres": "^3.4.5",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.4.16",
    "@nestjs/cli": "^11.0.0",
    "@nestjs/schematics": "^11.0.0",
    "@nestjs/testing": "^11.0.0",
    "@types/jest": "^29.5.14",
    "@types/node": "^25.9.1",
    "drizzle-kit": "^0.30.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.2.5",
    "ts-node": "^10.9.2",
    "typescript": "^6.0.3"
  },
  "packageManager": "pnpm@11.5.1+sha512.93f7b57422ea7068257235b4c16eb60762eb68e1dc23723199cc739043ea9be2c4143274a399d8c6defa2b1176226d9ca1c4b63482d6200c1a8fbaa78c1d1485"
}
```
Note: drop `"type": "module"` (NestJS builds to CommonJS). Versions are floors; `pnpm install` resolves current 2026 releases. If a `^11` Nest line resolves to a newer major at install, align the `@nestjs/*` set to one major.

- [ ] **Step 3: `tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "moduleResolution": "node",
    "target": "ES2023",
    "lib": ["ES2023"],
    "declaration": false,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strict": true,
    "strictNullChecks": true,
    "noImplicitAny": true,
    "forceConsistentCasingInFileNames": true,
    "noFallthroughCasesInSwitch": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*", "drizzle.config.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: `tsconfig.build.json`**

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "dist", "**/*.spec.ts", "test", "drizzle.config.ts"]
}
```

- [ ] **Step 5: `nest-cli.json`** (declare both entrypoints)

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "entryFile": "main",
  "compilerOptions": { "deleteOutDir": true, "tsConfigPath": "tsconfig.build.json" }
}
```

- [ ] **Step 6: `jest.config.ts`**

```ts
import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }] },
  collectCoverageFrom: ['**/*.ts'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  setupFiles: ['reflect-metadata'],
};
export default config;
```

- [ ] **Step 7: `biome.json`** (only if not already present/adequate; keep existing if it lints TS)

```json
{
  "$schema": "https://biomejs.dev/schemas/2.4.16/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": { "ignoreUnknown": true, "includes": ["src/**/*.ts", "*.ts", "*.json"] },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "linter": { "enabled": true, "rules": { "recommended": true, "suspicious": { "noExplicitAny": "warn" } } },
  "assist": { "enabled": true }
}
```

- [ ] **Step 8: `.gitignore`** — ensure these lines exist

```
node_modules/
dist/
coverage/
.env
*.tsbuildinfo
```

- [ ] **Step 9: Install and verify toolchain**

```bash
corepack enable
pnpm install
pnpm exec tsc --noEmit
pnpm lint
```
Expected: install succeeds; `tsc --noEmit` passes (no source yet → no errors); biome runs clean.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "Slice 1: reset repo to NestJS CommonJS toolchain (package, tsconfig, jest, biome)"
```

---

## Task 2: Typed config with Zod (warn-not-fatal API keys)

**Files:**
- Create: `src/shared/config/env.schema.ts`, `src/shared/config/config.module.ts`, `src/shared/config/app-config.service.ts`
- Test: `src/shared/config/env.schema.spec.ts`

- [ ] **Step 1: Write the failing test** — `src/shared/config/env.schema.spec.ts`

```ts
import { parseEnv } from './env.schema';

const base = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgres://breakbeat:breakbeat@localhost:5432/breakbeat',
  REDIS_URL: 'redis://localhost:6379',
  VICTORIALOGS_URL: 'http://localhost:9428',
};

describe('parseEnv', () => {
  it('parses a valid environment with infra defaults', () => {
    const { env } = parseEnv(base);
    expect(env.PORT).toBe(3000);
    expect(env.DATABASE_URL).toContain('postgres://');
  });

  it('throws with the offending variable named when a required infra var is malformed', () => {
    expect(() => parseEnv({ ...base, DATABASE_URL: 'not-a-url' })).toThrow(/DATABASE_URL/);
  });

  it('warns (does not throw) when external API keys are absent', () => {
    const { env, warnings } = parseEnv(base);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(warnings.some((w) => w.includes('ANTHROPIC_API_KEY'))).toBe(true);
    expect(warnings.some((w) => w.includes('SENTRY_DSN'))).toBe(true);
  });

  it('applies defaults for PORT and NODE_ENV when omitted', () => {
    const { env } = parseEnv({ DATABASE_URL: base.DATABASE_URL, REDIS_URL: base.REDIS_URL, VICTORIALOGS_URL: base.VICTORIALOGS_URL });
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- env.schema`
Expected: FAIL — cannot find module `./env.schema`.

- [ ] **Step 3: Implement `src/shared/config/env.schema.ts`**

```ts
import { z } from 'zod';

const urlString = z.string().url();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: urlString,
  REDIS_URL: urlString,
  VICTORIALOGS_URL: urlString.optional(),
  // External integrations — optional so a keyless clone still boots.
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  TAVILY_API_KEY: z.string().min(1).optional(),
  BRANDFETCH_API_KEY: z.string().min(1).optional(),
  BRANDFETCH_CLIENT_ID: z.string().min(1).optional(),
  SENTRY_DSN: z.string().min(1).optional(),
});

export type Env = z.infer<typeof schema>;

const OPTIONAL_INTEGRATIONS: (keyof Env)[] = [
  'ANTHROPIC_API_KEY',
  'TAVILY_API_KEY',
  'BRANDFETCH_API_KEY',
  'BRANDFETCH_CLIENT_ID',
  'SENTRY_DSN',
];

export function parseEnv(raw: Record<string, unknown>): { env: Env; warnings: string[] } {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const env = result.data;
  const warnings = OPTIONAL_INTEGRATIONS.filter((k) => !env[k]).map(
    (k) => `${k} is not set — the feature that depends on it is disabled.`,
  );
  return { env, warnings };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- env.schema`
Expected: PASS (4 tests).

- [ ] **Step 5: Implement `src/shared/config/config.module.ts`**

```ts
import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { parseEnv } from './env.schema';
import { AppConfigService } from './app-config.service';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: (raw) => {
        const { env, warnings } = parseEnv(raw);
        for (const w of warnings) {
          // eslint-disable-next-line no-console -- logger not yet constructed at config-validation time
          console.warn(`[config] ${w}`);
        }
        return env;
      },
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class ConfigModule {}
```

- [ ] **Step 6: Implement `src/shared/config/app-config.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.schema';

@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  get isProduction(): boolean {
    return this.get('NODE_ENV') === 'production';
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add src/shared/config
git commit -m "Slice 1: typed Zod config with warn-not-fatal API keys"
```

---

## Task 3: VictoriaLogs pino transport (fail-open) + logging module

**Files:**
- Create: `src/shared/observability/victoria-logs.transport.ts`, `src/shared/observability/logging.module.ts`
- Test: `src/shared/observability/victoria-logs.transport.spec.ts`

- [ ] **Step 1: Write the failing test** — `victoria-logs.transport.spec.ts`

```ts
import { shipBatch } from './victoria-logs.transport';

describe('shipBatch (VictoriaLogs jsonline)', () => {
  it('POSTs newline-delimited JSON to the jsonline endpoint', async () => {
    const calls: { url: string; body: string }[] = [];
    const fakeFetch = async (url: string, init: { body: string }) => {
      calls.push({ url, body: init.body });
      return { ok: true, status: 204 } as Response;
    };
    await shipBatch('http://vl:9428', [{ msg: 'a', time: 1 }, { msg: 'b', time: 2 }], fakeFetch as typeof fetch);
    expect(calls[0].url).toContain('/insert/jsonline');
    expect(calls[0].body.trim().split('\n')).toHaveLength(2);
  });

  it('does not throw when the endpoint errors (fail-open) and reports once', async () => {
    let warns = 0;
    const failing = async () => { throw new Error('connrefused'); };
    await expect(
      shipBatch('http://vl:9428', [{ msg: 'x', time: 1 }], failing as unknown as typeof fetch, () => { warns++; }),
    ).resolves.toBeUndefined();
    expect(warns).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- victoria-logs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `victoria-logs.transport.ts`**

```ts
import build from 'pino-abstract-transport';

type Json = Record<string, unknown>;

export async function shipBatch(
  baseUrl: string,
  lines: Json[],
  fetchImpl: typeof fetch = fetch,
  onError: (err: unknown) => void = defaultWarn,
): Promise<void> {
  if (lines.length === 0) return;
  const body = `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`;
  const url = `${baseUrl.replace(/\/$/, '')}/insert/jsonline?_stream_fields=service&_msg_field=msg&_time_field=time`;
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-ndjson' },
      body,
    });
    if (!res.ok) onError(new Error(`VictoriaLogs responded ${res.status}`));
  } catch (err) {
    onError(err); // fail-open: never rethrow
  }
}

let warned = false;
function defaultWarn(err: unknown): void {
  if (warned) return; // throttle: one warning per process
  warned = true;
  process.stderr.write(`[victoria-logs] log shipping failing, continuing on stdout only: ${String(err)}\n`);
}

// pino transport entrypoint: batches lines and flushes them to VictoriaLogs.
export default async function (opts: { url: string; batchSize?: number }) {
  const batchSize = opts.batchSize ?? 50;
  let buffer: Json[] = [];
  return build(
    async (source) => {
      for await (const obj of source) {
        buffer.push(obj as Json);
        if (buffer.length >= batchSize) {
          const batch = buffer;
          buffer = [];
          await shipBatch(opts.url, batch);
        }
      }
    },
    {
      async close() {
        const batch = buffer;
        buffer = [];
        await shipBatch(opts.url, batch);
      },
    },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- victoria-logs`
Expected: PASS (2 tests).

- [ ] **Step 5: Implement `logging.module.ts`** (stdout source of truth + optional VL target)

```ts
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigService } from '../config/app-config.service';
import { ConfigModule } from '../config/config.module';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        const vlUrl = config.get('VICTORIALOGS_URL');
        const stdout = { target: 'pino/file', options: { destination: 1 } };
        const targets = vlUrl
          ? [stdout, { target: require.resolve('./victoria-logs.transport'), options: { url: vlUrl } }]
          : [stdout];
        return {
          pinoHttp: {
            base: { service: 'breakbeat' },
            timestamp: () => `,"time":${Date.now()}`,
            transport: { targets },
            autoLogging: true,
            genReqId: (req) => (req.headers['x-request-id'] as string) ?? cryptoRandomId(),
          },
        };
      },
    }),
  ],
})
export class LoggingModule {}

function cryptoRandomId(): string {
  return require('node:crypto').randomUUID();
}
```

- [ ] **Step 6: Commit**

```bash
git add src/shared/observability/victoria-logs.transport.ts src/shared/observability/victoria-logs.transport.spec.ts src/shared/observability/logging.module.ts
git commit -m "Slice 1: pino logging with fail-open VictoriaLogs transport"
```

---

## Task 4: Sentry/Bugsink error reporting

**Files:**
- Create: `src/shared/observability/sentry.ts`

- [ ] **Step 1: Implement `sentry.ts`** (no test — thin SDK init; verified by acceptance `/debug/error`)

```ts
import * as Sentry from '@sentry/nestjs';

/**
 * Initialise Sentry pointed at the Bugsink DSN. No-op when SENTRY_DSN is unset,
 * so a keyless clone still boots. MUST run before the Nest app is created
 * (import side-effect ordering) — called from an instrument file imported first.
 */
export function initSentry(dsn: string | undefined, environment: string): void {
  if (!dsn) {
    process.stdout.write('[sentry] SENTRY_DSN not set — error reporting disabled.\n');
    return;
  }
  Sentry.init({ dsn, environment, tracesSampleRate: 0 });
}
```

- [ ] **Step 2: Create `src/instrument.ts`** (imported first by both entrypoints)

```ts
import 'reflect-metadata';
import { parseEnv } from './shared/config/env.schema';
import { initSentry } from './shared/observability/sentry';

const { env } = parseEnv(process.env);
initSentry(env.SENTRY_DSN, env.NODE_ENV);
```

- [ ] **Step 3: Commit**

```bash
git add src/shared/observability/sentry.ts src/instrument.ts
git commit -m "Slice 1: Sentry/Bugsink error reporting init (no-op without DSN)"
```

---

## Task 5: Database (postgres.js + Drizzle) + Redis providers + baseline migration

**Files:**
- Create: `src/shared/database/schema.ts`, `database.tokens.ts`, `database.module.ts`, `migrate.ts`, `drizzle.config.ts`, `src/shared/redis/redis.tokens.ts`, `redis.module.ts`

- [ ] **Step 1: `src/shared/database/schema.ts`** (baseline `app_meta` — proves the migration pipeline)

```ts
import { pgTable, text } from 'drizzle-orm/pg-core';

// Baseline table: exists only to prove migrations apply. Real jobs/results schema = Slice 2.
export const appMeta = pgTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
```

- [ ] **Step 2: `drizzle.config.ts`**

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/shared/database/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://breakbeat:breakbeat@localhost:5432/breakbeat' },
});
```

- [ ] **Step 3: `src/shared/database/database.tokens.ts`**

```ts
export const DRIZZLE = Symbol('DRIZZLE');
export const PG_SQL = Symbol('PG_SQL');
```

- [ ] **Step 4: `src/shared/database/database.module.ts`**

```ts
import { Global, Module, type OnModuleDestroy, Inject } from '@nestjs/common';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { AppConfigService } from '../config/app-config.service';
import { DRIZZLE, PG_SQL } from './database.tokens';
import * as schema from './schema';

const sqlProvider = {
  provide: PG_SQL,
  inject: [AppConfigService],
  useFactory: (config: AppConfigService) => postgres(config.get('DATABASE_URL'), { max: 10 }),
};

const drizzleProvider = {
  provide: DRIZZLE,
  inject: [PG_SQL],
  useFactory: (sql: postgres.Sql) => drizzle(sql, { schema }),
};

@Global()
@Module({
  providers: [sqlProvider, drizzleProvider],
  exports: [DRIZZLE, PG_SQL],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(@Inject(PG_SQL) private readonly sql: postgres.Sql) {}
  async onModuleDestroy(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
```

- [ ] **Step 5: `src/shared/database/migrate.ts`** (standalone runner for `db:migrate`)

```ts
import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { parseEnv } from '../config/env.schema';

async function main(): Promise<void> {
  const { env } = parseEnv(process.env);
  const sql = postgres(env.DATABASE_URL, { max: 1 });
  try {
    await migrate(drizzle(sql), { migrationsFolder: './migrations' });
    process.stdout.write('[migrate] migrations applied\n');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  process.stderr.write(`[migrate] failed: ${String(err)}\n`);
  process.exit(1);
});
```

- [ ] **Step 5b: `src/shared/database/reset.ts`** (real DB reset, grill-fix #2 — drops the schema, then `db:migrate` reapplies)

```ts
import 'reflect-metadata';
import postgres from 'postgres';
import { parseEnv } from '../config/env.schema';

async function main(): Promise<void> {
  const { env } = parseEnv(process.env);
  if (env.NODE_ENV === 'production') throw new Error('db:reset is refused in production');
  const sql = postgres(env.DATABASE_URL, { max: 1 });
  try {
    await sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    process.stdout.write('[reset] public schema dropped and recreated\n');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  process.stderr.write(`[reset] failed: ${String(err)}\n`);
  process.exit(1);
});
```

- [ ] **Step 6: `src/shared/redis/redis.tokens.ts`**

```ts
export const REDIS = Symbol('REDIS');
```

- [ ] **Step 7: `src/shared/redis/redis.module.ts`**

```ts
import { Global, Module, type OnModuleDestroy, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfigService } from '../config/app-config.service';
import { REDIS } from './redis.tokens';

const redisProvider = {
  provide: REDIS,
  inject: [AppConfigService],
  useFactory: (config: AppConfigService) =>
    new Redis(config.get('REDIS_URL'), { maxRetriesPerRequest: null, lazyConnect: false }),
};

@Global()
@Module({ providers: [redisProvider], exports: [REDIS] })
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}
  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
```

- [ ] **Step 8: Generate the baseline migration**

```bash
pnpm db:generate
```
Expected: a `migrations/0000_*.sql` creating `app_meta`, plus `migrations/meta/`.

- [ ] **Step 9: Commit**

```bash
git add src/shared/database src/shared/redis drizzle.config.ts migrations package.json
git commit -m "Slice 1: Postgres (Drizzle/postgres.js) + Redis providers + baseline migration + db:reset"
```

---

## Task 6: Health slice (Terminus) — `GET /health`

**Files:**
- Create: `src/modules/health/database.health.ts`, `redis.health.ts`, `health.controller.ts`, `health.module.ts`
- Test: `src/modules/health/health.controller.spec.ts`

- [ ] **Step 1: Write the failing test** — `health.controller.spec.ts`

```ts
import { Test } from '@nestjs/testing';
import { TerminusModule, HealthCheckService } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { DatabaseHealthIndicator } from './database.health';
import { RedisHealthIndicator } from './redis.health';

describe('HealthController', () => {
  it('reports overall ok when db and redis are up', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
      providers: [
        { provide: DatabaseHealthIndicator, useValue: { isHealthy: async () => ({ database: { status: 'up' } }) } },
        { provide: RedisHealthIndicator, useValue: { isHealthy: async () => ({ redis: { status: 'up' } }) } },
      ],
    }).compile();

    const controller = moduleRef.get(HealthController);
    const result = await controller.check();
    expect(result.status).toBe('ok');
    expect(result.info?.database.status).toBe('up');
    expect(result.info?.redis.status).toBe('up');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- health.controller`
Expected: FAIL — modules not found.

- [ ] **Step 3: `database.health.ts`**

```ts
import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';
import type postgres from 'postgres';
import { PG_SQL } from '../../shared/database/database.tokens';

@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    @Inject(PG_SQL) private readonly sql: postgres.Sql,
  ) {}

  async isHealthy(key = 'database'): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    try {
      await this.sql`SELECT 1`;
      return indicator.up();
    } catch (err) {
      return indicator.down({ message: String(err) });
    }
  }
}
```

- [ ] **Step 4: `redis.health.ts`**

```ts
import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';
import type Redis from 'ioredis';
import { REDIS } from '../../shared/redis/redis.tokens';

@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async isHealthy(key = 'redis'): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    try {
      const pong = await this.redis.ping();
      return pong === 'PONG' ? indicator.up() : indicator.down({ pong });
    } catch (err) {
      return indicator.down({ message: String(err) });
    }
  }
}
```

- [ ] **Step 5: `health.controller.ts`**

```ts
import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, type HealthCheckResult } from '@nestjs/terminus';
import { DatabaseHealthIndicator } from './database.health';
import { RedisHealthIndicator } from './redis.health';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: DatabaseHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.health.check([() => this.db.isHealthy(), () => this.redis.isHealthy()]);
  }
}
```

- [ ] **Step 6: `health.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { DatabaseHealthIndicator } from './database.health';
import { RedisHealthIndicator } from './redis.health';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [DatabaseHealthIndicator, RedisHealthIndicator],
})
export class HealthModule {}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm test -- health.controller`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/modules/health
git commit -m "Slice 1: /health with Postgres + Redis Terminus indicators"
```

---

## Task 7: Debug slice — `GET /debug/error` (non-prod)

**Files:**
- Create: `src/modules/debug/debug.controller.ts`, `debug.module.ts`

- [ ] **Step 1: `debug.controller.ts`**

```ts
import { Controller, ForbiddenException, Get } from '@nestjs/common';
import { AppConfigService } from '../../shared/config/app-config.service';

@Controller('debug')
export class DebugController {
  constructor(private readonly config: AppConfigService) {}

  // Verification aid for Bugsink capture. Guarded off in production.
  @Get('error')
  boom(): never {
    if (this.config.isProduction) throw new ForbiddenException('disabled in production');
    throw new Error('Breakbeat debug error — verifying Bugsink capture');
  }
}
```

- [ ] **Step 2: `debug.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { DebugController } from './debug.controller';

@Module({ controllers: [DebugController] })
export class DebugModule {}
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/debug
git commit -m "Slice 1: /debug/error endpoint to verify Bugsink capture"
```

---

## Task 8: Module wiring + bootstraps (`main.ts`, `worker.ts`)

**Files:**
- Create: `src/core.module.ts`, `src/app.module.ts`, `src/worker.module.ts`, `src/main.ts`, `src/worker.ts`

- [ ] **Step 1: `src/core.module.ts`** (cross-cutting, shared by HTTP + worker)

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from './shared/config/config.module';
import { LoggingModule } from './shared/observability/logging.module';
import { DatabaseModule } from './shared/database/database.module';
import { RedisModule } from './shared/redis/redis.module';

@Module({
  imports: [ConfigModule, LoggingModule, DatabaseModule, RedisModule],
  exports: [ConfigModule, LoggingModule, DatabaseModule, RedisModule],
})
export class CoreModule {}
```

- [ ] **Step 2: `src/app.module.ts`** (HTTP — Sentry global filter registered explicitly, grill-fix #1)

```ts
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { SentryModule, SentryGlobalFilter } from '@sentry/nestjs/setup';
import { CoreModule } from './core.module';
import { HealthModule } from './modules/health/health.module';
import { DebugModule } from './modules/debug/debug.module';

@Module({
  imports: [SentryModule.forRoot(), CoreModule, HealthModule, DebugModule],
  providers: [{ provide: APP_FILTER, useClass: SentryGlobalFilter }],
})
export class AppModule {}
```

- [ ] **Step 3: `src/worker.module.ts`** (worker — core only; Sentry covered by `instrument.ts` global handlers, grill-fix #1)

```ts
import { Module } from '@nestjs/common';
import { CoreModule } from './core.module';

@Module({ imports: [CoreModule] })
export class WorkerModule {}
```

- [ ] **Step 4: `src/main.ts`** (HTTP bootstrap)

```ts
import './instrument';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AppConfigService } from './shared/config/app-config.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  const config = app.get(AppConfigService);
  const port = config.get('PORT');
  await app.listen(port);
  app.get(Logger).log(`Breakbeat HTTP service started on :${port}`, 'Bootstrap');
}

bootstrap();
```

- [ ] **Step 5: `src/worker.ts`** (worker bootstrap — no HTTP, no processors yet)

```ts
import './instrument';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.get(Logger).log('Breakbeat worker started (no processors yet — Slice 3)', 'Worker');
}

bootstrap();
```

- [ ] **Step 6: Build + boot smoke test (host, needs Postgres+Redis reachable)**

```bash
pnpm exec tsc --noEmit
pnpm build
```
Expected: compiles clean. (Full boot is verified in Task 10 once compose is up.)

- [ ] **Step 7: Commit**

```bash
git add src/core.module.ts src/app.module.ts src/worker.module.ts src/main.ts src/worker.ts
git commit -m "Slice 1: module wiring + HTTP/worker bootstraps"
```

---

## Task 9: Docker — Dockerfile, compose, env example

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `.env.example` (overwrite)

- [ ] **Step 1: `Dockerfile`**

```dockerfile
FROM node:26-bookworm-slim
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
EXPOSE 3000
CMD ["pnpm", "dev"]
```
Note (grill-fix #3): `--frozen-lockfile` requires `pnpm-lock.yaml` to be committed (created by Task 1 Step 9). Ensure it is staged before the first `docker compose build`.

- [ ] **Step 2: `.dockerignore`**

```
node_modules
dist
coverage
.git
.env
```

- [ ] **Step 3: `.env.example`** (host-oriented defaults — compose overrides service URLs)

```bash
# --- App ---
NODE_ENV=development
PORT=3000

# --- Backing services (host defaults; docker-compose overrides with service names) ---
DATABASE_URL=postgres://breakbeat:breakbeat@localhost:5432/breakbeat
REDIS_URL=redis://localhost:6379
VICTORIALOGS_URL=http://localhost:9428

# --- Error reporting (Bugsink) ---
# Create a project in Bugsink (http://localhost:8000), then paste its DSN here.
SENTRY_DSN=

# --- External APIs (optional; clone still boots without them) ---
ANTHROPIC_API_KEY=
TAVILY_API_KEY=
BRANDFETCH_API_KEY=
BRANDFETCH_CLIENT_ID=
```

- [ ] **Step 4: `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: breakbeat
      POSTGRES_PASSWORD: breakbeat
      POSTGRES_DB: breakbeat
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U breakbeat"]
      interval: 5s
      timeout: 3s
      retries: 10

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

  victorialogs:
    image: victoriametrics/victoria-logs:latest
    command: ["--storageDataPath=/vlogs"]
    ports: ["9428:9428"]
    volumes: ["vldata:/vlogs"]

  bugsink:
    image: bugsink/bugsink:latest
    environment:
      SECRET_KEY: dev-only-insecure-secret-change-me
      CREATE_SUPERUSER: "admin:admin"
      BEHIND_HTTPS: "false"
    ports: ["8000:8000"]
    volumes: ["bugsinkdata:/data"]

  app:
    build: .
    command: sh -c "pnpm db:migrate && pnpm dev"
    environment:
      DATABASE_URL: postgres://breakbeat:breakbeat@postgres:5432/breakbeat
      REDIS_URL: redis://redis:6379
      VICTORIALOGS_URL: http://victorialogs:9428
    env_file: [.env]
    ports: ["3000:3000"]
    volumes: ["./:/app", "/app/node_modules"]
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }

  worker:
    build: .
    command: pnpm worker
    environment:
      DATABASE_URL: postgres://breakbeat:breakbeat@postgres:5432/breakbeat
      REDIS_URL: redis://redis:6379
      VICTORIALOGS_URL: http://victorialogs:9428
    env_file: [.env]
    volumes: ["./:/app", "/app/node_modules"]
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }

volumes:
  pgdata:
  vldata:
  bugsinkdata:
```
Note: the `environment:` blocks override `.env` service URLs with in-network service names (self-grill #1). Exact Bugsink/VictoriaLogs env keys + flags are confirmed against current docs at implementation (spec §8).

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore docker-compose.yml .env.example
git commit -m "Slice 1: Docker Compose dev env (postgres, redis, victorialogs, bugsink, app, worker)"
```

---

## Task 10: README setup + acceptance run

**Files:**
- Modify: `README.md` (dev-setup section)

- [ ] **Step 1: Add a "Local development" section to `README.md`** documenting:
  - `cp .env.example .env`
  - `docker compose up` (full) **or** `docker compose up postgres redis victorialogs bugsink` + `pnpm install && pnpm db:migrate && pnpm dev` / `pnpm worker` (host fast loop)
  - Create a Bugsink project at `http://localhost:8000` (admin/admin) → copy DSN into `.env` → restart `app`
  - Verify: `curl localhost:3000/health`, `curl localhost:3000/debug/error`, query VictoriaLogs at `http://localhost:9428`
  - Note: NestJS compiles (CommonJS); the v1 "erasable syntax only" note is superseded (reconciled in Slice 9).

- [ ] **Step 2: Run the acceptance checklist** (spec §7). Where Docker is unavailable in the working environment, run all host-checkable items and record live-service items as manually verified or deferred (do not claim unverified passes).

```bash
pnpm lint
pnpm test
pnpm exec tsc --noEmit
docker compose up -d postgres redis victorialogs bugsink   # if Docker available
pnpm db:migrate
pnpm dev &   # then:
curl -s localhost:3000/health
curl -s localhost:3000/debug/error
```
Expected: lint+tests+typecheck pass; `/health` returns `status: ok` with db+redis up; `/debug/error` 500s and (with DSN set) appears in Bugsink; the "service started" log line is queryable in VictoriaLogs.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Slice 1: document local dev setup and acceptance run"
```

---

## Self-Review

**1. Spec coverage:**
- §3.1 two bootstraps → Task 8 (`main.ts`, `worker.ts`); minimal worker → Task 8 Step 5. ✓
- §3.2 hexagonal/vertical-slice layout → File Structure + Tasks 2–8. ✓
- §3.3 CJS build, drop erasable-only → Task 1 (tsconfig, package). ✓
- §3.4 Zod config, warn-not-fatal → Task 2. ✓
- §3.5 Drizzle/postgres.js, explicit migrate → Task 5 + compose `app` command (Task 9). ✓
- §3.6 pino stdout + fail-open VL transport → Task 3. ✓
- §3.7 Sentry/Bugsink no-op without DSN → Task 4. ✓
- §3.8 Terminus health → Task 6. ✓
- §3.9 Biome + Jest + scripts → Task 1. ✓
- §3.10 compose topology + dual-context env + Bugsink own SQLite → Task 9. ✓
- §7 acceptance → Task 10. ✓

**2. Placeholder scan:** No "TBD/TODO/handle edge cases". Version floors are explicit; the only deferrals are version-specific Bugsink/VictoriaLogs env keys, flagged in spec §8 and Task 9 with a concrete fallback (verify against docs). ✓

**3. Type consistency:** `parseEnv` returns `{ env, warnings }` — used consistently in config.module, instrument.ts, migrate.ts. DI tokens `DRIZZLE/PG_SQL/REDIS` consistent across database/redis modules and health indicators. `isHealthy()` indicator method name matches the test double and controller usage. ✓

**Spec gap found & noted:** the spec's "migrations applied before process start" is realised by the compose `app` command (`pnpm db:migrate && pnpm dev`) rather than a separate entrypoint script — simpler, same guarantee. Recorded here so the spec and plan agree.
