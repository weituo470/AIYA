# System Requirements

Commercial non-functional requirements for the Aiya China-first launch.

## Service Objectives
- Availability target: 99.9% monthly for public APIs and realtime delivery.
- Recovery time objective (RTO): 30 minutes for sev-1 incidents.
- Recovery point objective (RPO): 5 minutes for critical transactional data.
- Primary launch traffic profile:
  - 100k registered users in first 6 months
  - 10k daily active users
  - 1k peak concurrent websocket sessions
  - 150 messages per second write burst capacity

## Latency Targets
- P50 REST read: < 120ms
- P95 REST read: < 300ms
- P95 message write ack: < 250ms
- P95 websocket fanout inside same region: < 500ms
- P95 approval state propagation: < 800ms
- P95 agent action request creation after model result: < 3s, excluding external tool latency

## Capacity Assumptions
- Message retention: 3 years hot + archive strategy after 180 days
- Media retention: configurable by user policy; default 1 year for inactive objects
- Audit retention: 3 years minimum
- Model execution logs: 180 days searchable + longer cold storage archive

## Deployment Environments
- local: single-machine development
- dev: shared integration environment
- staging: production-like pre-release validation
- prod: multi-instance regional deployment

## High Availability Requirements
- PostgreSQL primary with automated backups and read replica plan
- Redis deployment with failover support
- Queue broker deployed with durable persistence
- Object storage configured with versioning and lifecycle policies
- Web and API deployed across at least 2 availability zones in production

## Scalability Requirements
- All stateless HTTP services horizontally scalable
- Realtime gateway supports sticky sessions or broker-based fanout
- Background jobs designed for at-least-once delivery with idempotent handlers
- Search indexing and moderation pipelines must degrade independently from core messaging

## Data Lifecycle
- Hot-path OLTP data in PostgreSQL
- Search projections in OpenSearch
- Analytics events in ClickHouse or managed analytics warehouse
- Cold archive strategy for historical audit logs and model traces

## Business Continuity
- Daily restore drill for database backups in staging
- Quarterly disaster recovery exercise
- Runbooks required for auth outage, broker lag, websocket fanout degradation, moderation backlog, and LLM provider outage
