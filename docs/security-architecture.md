# Security Architecture

Security design for Aiya commercial deployment.

## Identity and Authentication
- Supported launch methods:
  - Mainland China mobile phone sign-in
  - Password-based sign-in
  - Email sign-in as secondary path
- Access token: short-lived JWT, 15 minutes
- Refresh token: rotating, bound to device session, stored in httpOnly secure cookie where supported
- Device session record required for every login
- Session revocation must propagate to websocket sessions

## Authorization Model
- Principal-level identity remains unified across human and agent participants.
- Authorization checks split into:
  - identity authentication
  - conversation membership authorization
  - capability authorization for agent actions
- Agent actions require both capability grant validation and runtime policy enforcement.

## Secrets and Key Management
- No secrets committed to repo
- Separate secrets per environment
- Application secrets stored in managed secret manager
- JWT signing keys versioned and rotatable
- External provider keys scoped by environment and service

## Data Protection
- TLS required end-to-end at ingress
- Encryption at rest required for databases, object storage, backups, and analytics stores
- Sensitive fields must be classified and minimized
- Password hashes stored with Argon2id or bcrypt with strong work factor
- Phone numbers and emails indexed with privacy-aware handling and masking in admin tools

## Abuse and Account Protection
- Rate limiting for login, registration, message send, and approval response
- CAPTCHA or equivalent challenge for suspicious auth flows
- IP and device anomaly detection for login risk scoring
- Device management UI required for session review and forced logout

## Content and Model Safety
- Human and agent output both pass content safety controls
- Text, image, and file moderation pipelines supported
- Agent tool calls checked before execution and after result generation
- High-risk actions always require approval
- Prompt and tool injection defenses required in agent runtime

## Audit and Forensics
- Immutable audit event stream for:
  - sign-in and sign-out
  - authorization grant and revoke
  - approval create/respond/expire
  - tool invocation start/success/failure
  - agent proactive conversation initiation
  - admin moderation actions
- Admin access actions must also be audited

## Admin and Internal Access
- Role-based admin console
- Least privilege for operational staff
- Production access protected by SSO and MFA where available
- Break-glass procedure documented and audited
