#!/bin/sh
# Review and run ONLY inside a newly provisioned, dedicated QEMU Alpine base.
# This removes the operator's browser state and locks root. Not a secret scanner.
set -eu
[ "$(id -u)" = 0 ] || exit 1
[ -f /etc/alpine-release ] || exit 1
grep -qi qemu /sys/class/dmi/id/sys_vendor || exit 1
id operator >/dev/null
mkdir -p /etc/init.d
cat > /etc/init.d/starlidigital-firstboot <<'EOF'
#!/sbin/openrc-run
description="Ensure a new guest machine identity exists before the desktop"
depend() {
    need localmount
    after seedrng
    before dbus lightdm
}
start() {
    ebegin "Ensuring guest machine identity"
    /usr/bin/dbus-uuidgen --ensure=/etc/machine-id || return 1
    mkdir -p /var/lib/dbus
    ln -sf /etc/machine-id /var/lib/dbus/machine-id
    eend $?
}
EOF
chmod 755 /etc/init.d/starlidigital-firstboot
rc-update add starlidigital-firstboot default
rc-update add seedrng boot
# Exercise missing-ID regeneration before the final reset below.
old_id=$(cat /etc/machine-id)
rm -f /etc/machine-id /var/lib/dbus/machine-id
rc-service starlidigital-firstboot start
new_id=$(cat /etc/machine-id)
[ "$old_id" != "$new_id" ]
grep -Eq '^[0-9a-f]{32}$' /etc/machine-id
echo 'Identity regeneration test: PASS'
rc-service lightdm stop
pkill -u operator 2>/dev/null || true
rc-service dbus stop
rc-service starlidigital-firstboot stop || true
rc-service seedrng stop || true
rm -rf /home/operator/.mozilla /home/operator/.config/mozilla \
    /home/operator/.cache /home/operator/.dbus /home/operator/.ssh /root/.cache /root/.ssh
rm -f /home/operator/.Xauthority /home/operator/.ICEauthority \
    /home/operator/.ash_history /home/operator/.xsession-errors* /root/.ash_history \
    /root/desktop-alpine.sh /root/desktop-install.log /root/desktop.b64 \
    /etc/machine-id /var/lib/dbus/machine-id /etc/random-seed /var/lib/misc/random-seed
rm -rf /var/lib/seedrng
rm -f /etc/ssh/ssh_host_*
find /var/log -type f -exec sh -c ': > "$1"' _ {} \;
passwd -l root
awk -F: '$1=="root" || $1=="operator" { if ($2 !~ /^[!*]/) exit 1; print $1 ": locked" }' /etc/shadow
test ! -e /etc/machine-id
test ! -e /var/lib/dbus/machine-id
test ! -d /home/operator/.config/mozilla
test ! -d /home/operator/.mozilla
test ! -d /var/lib/cloud
test ! -e /etc/init.d/sshd
echo 'Listening TCP/UDP sockets (must be empty after headers):'
netstat -lntup
# Overwrite free filesystem blocks so deleted test profile/log data is not kept
# as allocated nonzero sectors in the compressed review image.
echo 'Zeroing guest free space; this can take a few minutes.'
dd if=/dev/zero of=/var/tmp/starlidigital-zero bs=1M 2>/dev/null || true
sync
rm -f /var/tmp/starlidigital-zero
sync
rm -f /root/clean-base.sh /root/transfer.b64
echo 'Clean-base preparation finished. Shut down gracefully and review before export.'
