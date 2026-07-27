# Data Retention

Retention policy guidance for Aiya commercial operation.

## Message Data
- active conversation message data retained for 3 years by default
- archival tier after 180 days for low-access history where supported
- deleted messages soft-deleted immediately and physically purged according to policy window

## Audit Data
- authorization, approval, tool invocation, and moderation audit records retained minimum 3 years
- immutable audit events replicated to separate storage target where feasible

## Media Objects
- avatars retained until replaced or account deletion flow completes
- chat media retained 1 year by default unless legal or product policy requires extension
- orphaned uploads purged automatically

## Session and Presence Data
- realtime presence data retained only for operational TTL windows
- device session history retained for security review and fraud analysis according to policy

## Model and Safety Data
- model prompts, responses, tool traces, and safety decisions retained 180 days hot by default
- longer retention only for legal, fraud, or audit purposes

## Search and Analytics Projections
- search indexes treated as derived data and rebuildable
- analytics event retention based on warehouse cost policy and privacy requirements

## Deletion and Compliance Operations
- account deletion workflow must define immediate disable, delayed purge, and audit preservation boundaries
- retention jobs must be observable and retryable
