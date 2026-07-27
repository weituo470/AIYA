# Moderation and Risk

Moderation and risk framework for Aiya China-first consumer launch.

## Scope
Applies to:
- user-generated text
- user-uploaded images and files
- agent-generated text
- agent-generated media
- agent tool invocation proposals and results

## Core Controls
- Sensitive keyword and pattern screening
- Image and file moderation workflow
- User report flow for messages, principals, groups, and agents
- Block and mute controls at principal level
- Conversation restriction and freeze actions
- Agent disable and capability suspension actions

## Moderation States
- clean
- flagged
- blocked
- needs_review
- removed

## Policy Layers
- inline synchronous checks for high-risk categories
- asynchronous review for lower-risk or media-heavy content
- agent action safety policy separate from content policy
- admin override actions recorded with audit reason

## Risk Operations
- Moderation queue with priority classes
- Appeal path for account or content restriction
- Internal reviewer notes and resolution codes
- Repeat offender signals for spam, fraud, abuse, or malicious automation

## Agent-Specific Controls
- Agents cannot bypass moderation because they are first-party runtime actors
- Agent outputs must carry traceable origin metadata
- Agent proactive outreach limited by grant policy, quota, and trust score
- High-risk capabilities can be globally disabled at control-plane level

## Escalation Rules
- suspected fraud or scam behavior escalates to risk review
- repeated unsafe tool requests trigger agent suspension
- mass-report spikes trigger temporary visibility throttling
