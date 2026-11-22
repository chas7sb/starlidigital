#!/bin/sh
# Run INSIDE the installed Alpine VM, as root. Never runs on the host.
set -eu
[ "$(id -u)" = 0 ] || { echo 'Guest root required' >&2; exit 1; }
[ -f /etc/alpine-release ] || { echo 'Alpine guest required' >&2; exit 1; }
grep -qi qemu /sys/class/dmi/id/sys_vendor || { echo 'QEMU guest required' >&2; exit 1; }
release=$(cut -d. -f1,2 /etc/alpine-release)
printf 'https://dl-cdn.alpinelinux.org/alpine/v%s/main\nhttps://dl-cdn.alpinelinux.org/alpine/v%s/community\n' "$release" "$release" > /etc/apk/repositories
# Standard VGA uses VESA; keep the explicit desktop package set small.
apk add xorg-server xf86-video-vesa xf86-input-libinput xinit openbox xterm \
    firefox dbus dbus-x11 eudev font-dejavu lightdm lightdm-gtk-greeter acpid
setup-devd udev
rc-update add dbus default
rc-update add lightdm default
rc-update add acpid default
id operator >/dev/null 2>&1 || adduser -D operator
for group in video input audio; do
    id -nG operator | grep -qw "$group" || addgroup operator "$group"
done
grep -q '^autologin:' /etc/group || addgroup autologin
id -nG operator | grep -qw autologin || addgroup operator autologin
mkdir -p /etc/lightdm/lightdm.conf.d /home/operator/.config/openbox
cat > /etc/lightdm/lightdm.conf.d/10-starlidigital.conf <<'EOF'
[Seat:*]
autologin-user=operator
autologin-user-timeout=0
autologin-session=openbox
user-session=openbox
EOF
cat > /home/operator/.config/openbox/autostart <<'EOF'
xterm -title 'StarliDigital isolated Linux VM' &
firefox about:blank &
EOF
chown -R operator:operator /home/operator/.config
# No password is assigned to operator; its password remains locked. Only the
# local graphical autologin is enabled. No SSH server or host forwarding added.
echo 'Desktop installed; start dbus and lightdm or reboot the guest.'
