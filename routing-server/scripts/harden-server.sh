#!/bin/bash
###############################################################################
#  Basic Server Hardening Script
#  Run on fresh Ubuntu 22.04/24.04 LTS
#  Usage: sudo ./scripts/harden-server.sh
###############################################################################

set -euo pipefail

echo "═══════════════════════════════════════════════"
echo "  Server Hardening — WeKonnek Routing Server"
echo "═══════════════════════════════════════════════"

# ─── Update system ────────────────────────────
echo "📦 Updating system packages..."
apt-get update && apt-get upgrade -y

# ─── Install essentials ───────────────────────
echo "📦 Installing essentials..."
apt-get install -y \
    curl wget git htop \
    ufw fail2ban \
    unattended-upgrades

# ─── Configure UFW Firewall ───────────────────
echo "🔥 Configuring firewall..."
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw --force enable

echo "   ✅ Firewall enabled (SSH + HTTP + HTTPS only)"

# ─── Configure fail2ban ───────────────────────
echo "🛡️  Configuring fail2ban..."
systemctl enable fail2ban
systemctl start fail2ban

# ─── Disable password auth (SSH keys only) ────
echo "🔑 Securing SSH..."
if grep -q "^PasswordAuthentication" /etc/ssh/sshd_config; then
    sed -i 's/^PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
else
    echo "PasswordAuthentication no" >> /etc/ssh/sshd_config
fi

if grep -q "^PermitRootLogin" /etc/ssh/sshd_config; then
    sed -i 's/^PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
else
    echo "PermitRootLogin prohibit-password" >> /etc/ssh/sshd_config
fi

systemctl restart sshd

# ─── Enable automatic security updates ────────
echo "🔄 Enabling automatic security updates..."
dpkg-reconfigure -plow unattended-upgrades

# ─── Install Docker ───────────────────────────
echo "🐳 Installing Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | sh
    usermod -aG docker $SUDO_USER 2>/dev/null || true
fi

# Install Docker Compose plugin
if ! docker compose version &> /dev/null; then
    apt-get install -y docker-compose-plugin
fi

echo ""
echo "═══════════════════════════════════════════════"
echo "  ✅ Server hardening complete!"
echo ""
echo "  Firewall: UFW (SSH + HTTP + HTTPS)"
echo "  SSH: Key-based only, no password login"
echo "  Updates: Automatic security patches"
echo "  Docker: Installed and ready"
echo ""
echo "  ⚠️  IMPORTANT: Ensure you have SSH key access"
echo "     before logging out!"
echo "═══════════════════════════════════════════════"
