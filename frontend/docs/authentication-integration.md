# Reconcile MCP — Enterprise Authentication Architecture & Integration Report

This document records the definitive authentication architecture discovered in the **Reconcile MCP** backend and establishes the design, contracts, and limitations governing the frontend authentication experience.

---

## 1. Discovered Backend Authentication Architecture

Inspection of the Python backend source code (`src/reconcile_mcp/`) reveals that Reconcile MCP is architected strictly as an **OAuth 2.1 / RFC 9728 Resource Server**, not an Identity Provider (IdP).

### 1.1 Protocol & Authentication Standard
- **Architecture**: OAuth 2.1 Resource Server with Bearer Token Authentication (RFC 6749, RFC 6750).
- **Metadata Discovery**: Advertises OAuth protected-resource metadata at `/.well-known/oauth-protected-resource/mcp` (RFC 9728).
- **Transport**: Stateless HTTP Header: `Authorization: Bearer <token>`.
- **Browser Cookies**: **Not supported by backend**. No `Set-Cookie`, session store, or cookie-based CSRF tokens exist in the FastAPI backend.
- **Traceability**: Supports an optional correlation trace header `X-Correlation-ID: <string>` (up to 64 chars) propagated into logging, principal context, and audit events.

### 1.2 Token Verification Implementation (`src/reconcile_mcp/security/tokens.py`)
The backend provides a unified `JWTTokenVerifier` implementing the official MCP `TokenVerifier` interface.

```
                      ┌────────────────────────────────────────┐
                      │    Incoming Request (FastAPI / MCP)    │
                      │   Authorization: Bearer <JWT Token>    │
                      └──────────────────┬─────────────────────┘
                                         │
                                         ▼
                      ┌────────────────────────────────────────┐
                      │            JWTTokenVerifier            │
                      └──────────────────┬─────────────────────┘
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 │                                               │
        (Production Mode)                                (Dev / Test Mode)
                 │                                               │
                 ▼                                               ▼
   ┌───────────────────────────┐                   ┌───────────────────────────┐
   │       Customer IdP        │                   │     Shared Secret         │
   │  RECONCILE_JWT_JWKS_URL   │                   │   RECONCILE_JWT_SECRET    │
   │  (Asymmetric: RS256/ES256)│                   │      (Symmetric: HS256)   │
   └─────────────┬─────────────┘                   └─────────────┬─────────────┘
                 │                                               │
                 └───────────────────────┬───────────────────────┘
                                         │
                                         ▼
                      ┌────────────────────────────────────────┐
                      │         Claims Verification:           │
                      │   - iss == RECONCILE_JWT_ISSUER        │
                      │   - aud == RECONCILE_JWT_AUDIENCE      │
                      │   - exp > current_timestamp            │
                      │   - sub present                        │
                      └──────────────────┬─────────────────────┘
                                         │
                                         ▼
                      ┌────────────────────────────────────────┐
                      │       Principal Extraction:            │
                      │  - tenant_slug := claims[tenant_claim] │
                      │  - SELECT id FROM tenants WHERE slug   │
                      │  - scopes := claims['scope']           │
                      │  - subject := claims['sub']            │
                      └────────────────────────────────────────┘
```

1. **Production Mode (`RECONCILE_ENV=prod`)**:
   - Asymmetric signature verification using PyJWKClient against `RECONCILE_JWT_JWKS_URL`.
   - Supported algorithms: `RS256`, `RS384`, `RS512`, `ES256`, `ES384`, `PS256`.
   - Refuses to start if `RECONCILE_JWT_SECRET` is set in production.
2. **Development / Test Mode (`RECONCILE_ENV=dev|test`)**:
   - Symmetric signature verification using HS256 with `RECONCILE_JWT_SECRET` (minimum 32 bytes).
   - Supports local token minting via the CLI:
     ```bash
     uv run python -m reconcile_mcp.cli token --tenant <slug> --subject <email> --scopes "<scopes>"
     ```
3. **Mandatory Claims**:
   - `iss`: Issuer URL matching `RECONCILE_JWT_ISSUER` (default: `https://auth.reconcile.local`).
   - `aud`: Audience string matching `RECONCILE_JWT_AUDIENCE` (default: `reconcile-mcp`).
   - `exp`: Expiration UNIX timestamp (strictly enforced).
   - `sub`: Subject identifier (user identity, service account, or agent identifier).
   - `tenant` (or configured `RECONCILE_JWT_TENANT_CLAIM`): The tenant slug. Must match an existing, provisioned tenant in the PostgreSQL database (`tenants` table), otherwise the backend returns HTTP 403 Forbidden (`"the authenticated tenant is not provisioned"`).

### 1.3 Role-Based Access Control (RBAC) & Scope Matrix
Permissions are conveyed via the `scope` or `scp` claim in the verified access token (space-separated or array of strings).

| Scope | Category | Backend Enforcement Points | Frontend Purpose |
|---|---|---|---|
| `recon:read` | Read-only | `GET /stats`<br>`GET /types`<br>`GET /runs/**`<br>`GET /discrepancies/**`<br>`GET /evidence/**`<br>`GET /audit/**`<br>`GET /proposals/**`<br>MCP tools `get_*`, `list_*`, `explain_*` | Allows viewing operational dashboard, historical runs, exception details, evidence documents, and audit logs. |
| `recon:run` | Execution | `POST /runs`<br>MCP tool `start_reconciliation` | Allows triggering new single-record or batch reconciliation executions. |
| `recon:propose` | AI Agent | MCP tools `propose_resolution`, `validate_resolution` | Intended for autonomous agent identities to generate proposed corrections. |
| `recon:approve` | Human Gate | `POST /proposals/{id}/decision` | Granted **exclusively to human approvers** in the customer IdP. Backend enforces four-eyes principle: a caller whose subject matches the proposal's author is rejected with 403 Forbidden. |
| `recon:apply` | Remediation | MCP tool `apply_resolution` | Allows executing approved changes into external source systems. |
| `recon:admin` | Governance | `POST /admin/types/**`<br>`PUT /admin/drafts/**`<br>`POST /admin/drafts/**` | Allows modifying customer reconciliation definitions, rules, drafts, and activations. |

---

## 2. Documented Backend Limitations & Missing Endpoints

The backend does **not** implement identity provider capabilities. The following endpoints do **not** exist in the Python backend:

| Capability | Backend Status | Architectural Reason & Frontend Handling |
|---|---|---|
| `POST /auth/login` | **Unavailable** | The backend is a stateless API/MCP resource server. User credential verification is delegated to the enterprise IdP (e.g. Okta, Entra ID, Ping) or local development token minting. |
| `POST /auth/logout` | **Unavailable** | Session tokens are stateless JWTs. Logout is handled client-side by invalidating the token from browser storage and terminating active timers. |
| `POST /auth/refresh` | **Unavailable** | Refresh token exchange must occur against the external IdP's token endpoint (RFC 6749 §6). |
| `POST /auth/forgot-password` | **Unavailable** | User credentials and password hashes do not exist in the Reconcile database. Password resets are handled by the customer's enterprise directory or SSO provider. |
| `GET /auth/me` / `/userinfo` | **Unavailable** | User claims (`sub`, `tenant`, `client_id`, `scopes`) are extracted directly from the verified JWT payload. |
| `Set-Cookie` session cookies | **Unavailable** | The backend requires `Authorization: Bearer <token>` on all requests. |

---

## 3. Frontend Authentication Architecture & Security Strategy

To provide a secure, production-grade enterprise experience without modifying the backend or inventing mock endpoints:

### 3.1 Centralized Auth Architecture (`frontend/src/lib/auth/`)
```
frontend/src/lib/auth/
├── auth-types.ts        # Typed UserClaims, Scope, AuthStatus, LoginCredentials
├── auth-client.ts       # Secure token decoding, storage abstraction, expiry timers
├── auth-context.ts      # AuthContext definition
├── auth-provider.tsx    # AuthProvider state manager & OIDC redirect processor
├── protected-route.tsx  # ProtectedRoute & PublicOnlyRoute guards
└── use-auth.ts          # useAuth() consumer hook with RBAC helpers
```

### 3.2 Token and Storage Security Strategy
1. **Zero Secret Exposure**:
   - `RECONCILE_JWT_SECRET` is a backend verification secret and is **never** included in `VITE_` variables or frontend source files.
   - The frontend decodes only public JWT headers and payload claims using standard base64url parsing.
2. **Storage Partitioning**:
   - **Default (`sessionStorage`)**: Access tokens are stored in `sessionStorage` by default. When the browser tab or window is closed, the session terminates immediately. This is the recommended posture for enterprise financial operations.
   - **Opt-in Remember Me (`localStorage`)**: Only when the user explicitly checks "Remember this device" is the token persisted to `localStorage`.
3. **Session Expiry Handling**:
   - The expiration timestamp (`exp`) is read from the decoded JWT.
   - A proactive background timer monitors remaining validity.
   - When the token expires, the session transitions to `expired` status and the user is redirected to `/session-expired`.
4. **401 Unauthorized Interception**:
   - The API client (`ReconcileApiClient`) intercepts HTTP 401 responses and triggers `auth.expireSession()`, preventing stale UI execution.
5. **403 Forbidden Handling**:
   - HTTP 403 responses trigger clear access-denied warnings indicating which required scope (`recon:approve`, `recon:admin`, etc.) was missing.

### 3.3 Supported Sign-In Flows in the UI
1. **Enterprise Token / Verified Bearer Authentication**:
   - Allows operations analysts, compliance auditors, and administrators to sign in using their issued enterprise token.
   - Features real-time client-side claims inspection (subject, tenant, scopes, and expiration) *before* authentication.
   - Includes a development helper in dev mode showing the exact CLI command to mint tokens.
2. **Enterprise SSO / OIDC Flow**:
   - Provides a dedicated SSO configuration interface where an enterprise user can enter their IdP SSO URL.
   - Initiates an authorization redirect with PKCE state.
   - Handles the callback at `/auth/callback` to extract and validate returned tokens.

---

## 4. Route Protection Matrix

| Route | Classification | Access Rule | Behavior if Unauthorized |
|---|---|---|---|
| `/login` | Public | Unauthenticated only | If authenticated, redirects to `/` or intended destination (`from`). |
| `/auth/callback` | Public | Open | Extracts OAuth tokens from callback query/fragment; redirects to destination. |
| `/session-expired` | Public | Open | Informs user that the JWT has expired with a 1-click re-authentication action. |
| `/access-denied` | Public | Open | Displays 403 details, missing scopes, and security administrator contact instructions. |
| `/` (Overview) | **Protected** | Requires authenticated session with `recon:read` | Redirects to `/login?from=/`. Loading skeleton rendered during verification. |
| `/runs/**` | **Protected** | Requires authenticated session with `recon:read` | Redirects to `/login`. Run creation requires `recon:run`. |
| `/exceptions/**` | **Protected** | Requires authenticated session with `recon:read` | Redirects to `/login`. |
| `/evidence` | **Protected** | Requires authenticated session with `recon:read` | Redirects to `/login`. |
| `/approvals` | **Protected** | Requires authenticated session with `recon:read` | Decision action strictly guarded by `recon:approve` scope. |
| `/connections` | **Protected** | Requires authenticated session with `recon:read` | Redirects to `/login`. |
| `/rules` | **Protected** | Requires authenticated session with `recon:read` | Draft modification & activation strictly guarded by `recon:admin` scope. |
| `/audit` | **Protected** | Requires authenticated session with `recon:read` | Redirects to `/login`. |
| `/developer` | **Protected** | Requires authenticated session with `recon:read` | Redirects to `/login`. |
| `/settings` | **Protected** | Requires authenticated session | Redirects to `/login`. |

