#!/bin/sh
# NEXUS NEXT: SHA-256 manifest of the deployable files (Host runtime + Sentinel + task templates + gateway src). Tests excluded.
cd "$(dirname "$0")/.." || exit 1
{ ls windows-pc-agent-lab/nexus-host/*.mjs windows-pc-agent-lab/nexus-host/NexusRobot.java windows-pc-agent-lab/nexus-host/sentinel/*.mjs windows-pc-agent-lab/nexus-host/install/*.xml windows-pc-agent-lab/nexus-gateway/src/*.mjs windows-pc-agent-lab/v3/actions.mjs | grep -v '\.test\.mjs$'; } \
  | sort | xargs sha256sum > windows-pc-agent-lab/MANIFEST-NEXT-0.6.1.sha256
wc -l windows-pc-agent-lab/MANIFEST-NEXT-0.6.1.sha256
