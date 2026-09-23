# omp-sub-alias

Subscription provider aliases for Oh My Pi / OMP.

`omp-sub-alias` is an independent community extension. It is not an official
Oh My Pi project.

The first supported source provider is OMP's built-in `openai-codex`. An alias
such as `openai-codex-pro` is registered as a real OMP provider with its own
OAuth provider id, so OMP stores, refreshes, resolves, and removes its
credentials independently from `openai-codex`.

## Why this exists

A single OMP process can keep multiple ChatGPT/Codex subscription accounts
available without named profiles, credential snapshots, automatic credential
rotation, a proxy, or an external account switcher:

```text
/login openai-codex
/login openai-codex-pro

/model openai-codex/<model>
/model openai-codex-pro/<model>
```

The provider namespace is the isolation boundary:

```text
openai-codex      -> credential namespace A
openai-codex-pro  -> credential namespace B
openai-codex-work -> credential namespace C
```

## Compatibility

The implementation targets the OMP 18.x extension API and is developed against
OMP 18.2.7. It uses the OMP-native two-argument provider API:

```ts
pi.registerProvider(name, config)
```

It imports only current OMP packages (`@oh-my-pi/pi-ai`,
`@oh-my-pi/pi-catalog`, and `@oh-my-pi/pi-coding-agent`). It does not depend
on the legacy `@earendil-works/*` package names and does not use
`readStoredCredential`.

OMP 18.2.7 maps canonical `@oh-my-pi/pi-ai` and
`@oh-my-pi/pi-coding-agent` imports back to the host runtime, preserving one
provider/auth registry. `@oh-my-pi/pi-catalog` is not host-remapped by the
compiled extension loader, so this package pins that pure catalog/discovery
dependency to 18.2.7 instead of allowing a Git/npm install to silently resolve a
newer 18.x catalog against an older OMP binary. Live model metadata is still
refreshed from OMP's active `ModelRegistry` after startup.

## Why this is a native OMP implementation

This project is implemented from scratch for OMP and does not depend on an
upstream alias plugin or its runtime architecture.

The older Pi-oriented approach relies on APIs such as
`readStoredCredential` from historical coding-agent packages. OMP 18.x owns
credential persistence in `@oh-my-pi/pi-ai`'s `AuthStorage`, and its legacy
compatibility surface is not a stable contract for directly reading stored
credentials. Reaching into that store from an extension would also make the
alias responsible for refresh/writeback semantics that OMP already implements.

Instead, `omp-sub-alias` registers the built-in Codex OAuth implementation
again under a new provider id. OMP then performs login, storage, token refresh,
API-key resolution, and logout using that alias id as the namespace. No
credential-reader shim or internal database access is required.

The implementation also uses OMP 18.x's actual
`pi.registerProvider(name, config)` API rather than the newer one-object Pi
provider registration form.

## Installation

### GitHub

OMP 18.2.7 natively accepts GitHub/git plugin sources. After publishing this
repository, install the default branch with:

```bash
omp install github:<owner>/omp-sub-alias
```

Pin a release tag, branch, or commit with a ref:

```bash
omp install github:<owner>/omp-sub-alias#v0.1.0
```

A full GitHub URL is also accepted:

```bash
omp install https://github.com/<owner>/omp-sub-alias#v0.1.0
```

The package manifest points OMP at `./src/index.ts`, so a GitHub install does
not depend on a pre-generated `dist/` directory or a package build lifecycle
hook.

### Local development

Install development dependencies and link the repository through OMP's plugin
manager:

```bash
bun install
omp plugin link /absolute/path/to/omp-sub-alias
```

For build verification:

```bash
bun run build
omp --extension /absolute/path/to/omp-sub-alias/src/index.ts
```

### npm

Once this package is published to npm, OMP 18.x accepts normal npm package
specs:

```bash
omp install omp-sub-alias
```

## Configuration

Configuration is JSON. The extension reads the user file first and then the
project file; a project alias with the same generated provider id overrides the
user entry.

User configuration:

```text
~/.omp/agent/omp-sub-alias.json
```

Project configuration:

```text
<project>/.omp/omp-sub-alias.json
```

Example:

```json
{
  "aliases": [
    {
      "provider": "openai-codex",
      "slug": "pro",
      "label": "Codex Pro"
    },
    {
      "provider": "openai-codex",
      "slug": "work",
      "label": "Codex Work"
    }
  ]
}
```

This registers:

```text
openai-codex-pro
openai-codex-work
```

Slugs are lowercase ASCII words separated by hyphens
(`^[a-z0-9]+(?:-[a-z0-9]+)*$`).

## Login

Start OMP normally and authenticate each provider separately:

```text
/login openai-codex
/login openai-codex-pro
/login openai-codex-work
```

OMP's own `AuthStorage` owns the credentials. The extension delegates login
and refresh to OMP's built-in Codex OAuth implementation but registers that
implementation under the alias provider id. It does not copy or read OMP's
credential database.

Consequently:

- logging into `openai-codex-pro` does not replace `openai-codex`;
- refreshing `openai-codex-pro` updates only that provider namespace;
- `/logout openai-codex-pro` removes only that provider namespace;
- there is no cross-provider credential pool or automatic account rotation.

## Model selection

After login:

```text
/model openai-codex/<model>
/model openai-codex-pro/<model>
/model openai-codex-work/<model>
```

The alias does not maintain a hard-coded Codex model catalog. It starts from
OMP 18.2.7's bundled `openai-codex` models so the provider is resolvable before
`session_start`, then refreshes from the live host model registry on
`session_start` and again before agent turns. OMP's public
`fetchDynamicModels(apiKey)` hook also runs Codex account-scoped discovery with
the alias provider's own resolved OAuth access token.

Full source-model metadata is rehydrated through OMP's public
`oauth.modifyModels` hook so fields that are richer than the public
`ProviderModelConfig` surface remain available at runtime.

## Codex-native behavior

Alias models keep the native `openai-codex-responses` API. Requests therefore
continue through OMP's built-in Codex Responses transport rather than an
OpenAI-compatible reimplementation. That preserves OMP-owned behavior such as
Codex request headers, ChatGPT account-id extraction from the alias access
token, Responses protocol handling, WebSocket/SSE transport selection,
attestation, native history payloads, and current model compatibility metadata.

The plugin does not set `OPENAI_CODEX_*` environment variables and does not
write account ids or access tokens itself.

## Multi-account example

```text
openai-codex
    -> Personal ChatGPT account

openai-codex-pro
    -> Pro ChatGPT account

openai-codex-work
    -> Work ChatGPT account
```

All three can exist in the same normal OMP profile and the same OMP process.

## Security

OAuth credentials are sensitive.

Do not:

- commit OMP credential files or databases;
- upload credential databases;
- sync credentials into a public repository;
- print OAuth access tokens;
- log refresh tokens;
- add access tokens or ChatGPT account ids to this plugin's config.

This extension's config contains provider aliases only. Credentials remain under
OMP's credential-storage ownership.

## Known limitations

- Version 0.1.x implements `openai-codex` aliases first. The config schema is
  intentionally provider-generic, but other OAuth providers need an explicit
  adapter before they are accepted.
- OMP 18.2.7's public extension API lets an extension supply dynamic models but
  does not expose the built-in Codex model manager's
  `dynamicModelsAuthoritative` switch. Alias discovery is account-scoped, but
  bundled fallback models may remain visible even when a particular account
  does not advertise them.
- A real OAuth acceptance test requires interactive browser authentication and
  is intentionally not automated by the test suite.
- This repository has no bundled credentials, no credential migration logic,
  and no credential rotation logic.

## Development

```bash
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

The test suite covers provider registration, multiple aliases, credential
namespace behavior, refresh/logout isolation, live model metadata cloning, and
alias-account model discovery.
