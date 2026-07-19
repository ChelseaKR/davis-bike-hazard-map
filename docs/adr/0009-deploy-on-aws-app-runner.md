# Deploy the private beta on AWS App Runner

- Status: Accepted
- Date: 2026-07-11
- Deciders: Chelsea Reif

## Context

The private beta needs managed HTTPS compute, private PostgreSQL connectivity,
durable photo storage, and production secret injection. The repository retains a
Fly.io deployment path, but the live service now runs on AWS.

## Decision

Run the container on App Runner in `us-west-2`, connect to private RDS PostgreSQL
through a VPC connector with `sslmode=verify-full`, store photos in S3 through a
gateway endpoint, and inject runtime secrets from SSM Parameter Store. Add the
Amazon RDS CA bundle to the runtime image while retaining Node's public roots.

## Consequences

The live deployment gains managed TLS and private database traffic. The image
build depends on Amazon's CA-bundle endpoint, AWS resources require an explicit
recovery runbook, and the dormant Fly workflow must not be mistaken for the live
deployment path.
