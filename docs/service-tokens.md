# Service tokens — runbook

Two tokens authenticate Krypton OJ ↔ Vigil server traffic:

| Token name              | Issuer | Validator | Used for |
|-------------------------|--------|-----------|----------|
| `KVS_OJ_TOKEN`          | hydrooj | Vigil server | OJ calls Vigil (e.g. push exam, notify session-closed) |
| `KVS_VIGIL_TOKEN`       | Vigil server | hydrooj | Vigil calls OJ (e.g. lookup-student, exchange-access-token) |

Both are sent as the `X-Service-Token` HTTP header.

## Storage

**On Vigil server** (env vars):

```bash
# Accepted OJ→Vigil tokens (comma-separated for rotation; usually one value)
KVS_ACCEPTED_OJ_TOKENS=t_oj_abc...,t_oj_xyz...

# Outbound Vigil→OJ token presented when Vigil calls OJ
KVS_VIGIL_TOKEN=t_vigil_abc...
```

**On hydrooj** (system settings, set via admin UI / DB):

```js
system.set('serviceToken.vigil.accepted', ['t_vigil_abc...', 't_vigil_xyz...'])
system.set('serviceToken.oj.outbound', 't_oj_abc...')
```

Wrap reads through `getAcceptedTokens('vigil')` (see `packages/hydrooj/src/lib/service-token.ts`).

## Generating a new token

Any 32+-byte random hex string:

```bash
openssl rand -hex 32
```

Prefix recommended: `t_vigil_` or `t_oj_` so it's obvious which direction the token is for.

## Rotation procedure (OJ → Vigil token)

Done without downtime by leveraging the accepted-list pattern (each side accepts ≥2 tokens during the rotation window).

1. **Generate new token** `T_NEW`.
2. **Add to Vigil's accepted list**: edit `KVS_ACCEPTED_OJ_TOKENS=T_OLD,T_NEW` → restart Vigil.
3. **Verify**: confirm Vigil logs that both tokens are accepted (`logger.info('added token to oj accepted list ...')`).
4. **Switch OJ outbound**: `system.set('serviceToken.oj.outbound', T_NEW)` → hydrooj picks up on next call (no restart needed; reads from system settings).
5. **Verify**: confirm OJ → Vigil traffic uses new token (look for prefix in Vigil logs).
6. **Remove old token from Vigil**: edit `KVS_ACCEPTED_OJ_TOKENS=T_NEW` → restart Vigil.

Reverse direction (Vigil → OJ) is symmetric: add new token to OJ's `serviceToken.vigil.accepted`, switch Vigil's outbound (env var → restart), remove old.

## Monitoring

- Both sides log first 8 chars of presented token on every check (success and failure).
- 401-rate spike on either side indicates the rotation got stuck mid-procedure.
- A reasonable alert: `>10 401s per minute on /api/integrations/oj/* or /api/vigil/*`.

## Emergency revocation

If a token is leaked:

1. Generate replacement.
2. Add replacement to validator's accepted list.
3. Switch issuer to new token.
4. **Remove leaked token from validator's accepted list immediately** (no rotation grace).
5. Audit logs around the leak window.
