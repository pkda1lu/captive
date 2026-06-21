#!/usr/bin/env bash
set -euo pipefail

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 1812/udp
ufw allow 1813/udp
ufw --force enable
ufw status verbose
