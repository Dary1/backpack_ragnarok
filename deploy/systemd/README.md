# deploy/systemd

Tracked copies of the systemd units that back the art/GPU pipeline. The repo is
the source of truth; these are installed to the box by hand (see per-unit notes).

## comfyui.service / comfyui-idle-free.service (REQ-0158)
`--user` services (owner: qtie). Installed under
`~/.config/systemd/user/`. ComfyUI backend on 127.0.0.1:8188 plus its idle VRAM
watchdog.

## gpu-fullpower.service + gpu-fullpower.service.d/ (REQ-0274 drop-in)
System service (root) in `/etc/systemd/system/`. At boot it sets NVIDIA
persistence mode and the Alienware ACPI `platform_profile`. `gpu-fullpower.service`
here is a provenance copy of the shipped unit; do not reinstall it blindly.

The REQ-0274 drop-in `req-0274-no-perf-pin.conf` stops the old boot-time
`platform_profile=performance` pin (which left the fans howling on an idle box)
and boots to the quiet `balanced` baseline instead. Install:

    sudo install -D -m644 deploy/systemd/gpu-fullpower.service.d/req-0274-no-perf-pin.conf \
        /etc/systemd/system/gpu-fullpower.service.d/req-0274-no-perf-pin.conf
    sudo systemctl daemon-reload

## gpu-profile-follow.service (REQ-0274)
System service (root). Governs `platform_profile` dynamically: `performance`
(aggressive fan curve, needed to sustain 180 W) only while the GPU is busy
(ComfyUI queue non-empty OR GPU util >= threshold), dropping back to `balanced`
after a cooldown of idle. Canonical script: `tools/gpu_profile_follow.py`.
Install:

    sudo install -m755 tools/gpu_profile_follow.py \
        /usr/local/sbin/backpack_gpu_profile_follow.py
    sudo install -m644 deploy/systemd/gpu-profile-follow.service \
        /etc/systemd/system/gpu-profile-follow.service
    sudo systemctl daemon-reload
    sudo systemctl enable --now gpu-profile-follow.service

Tunables live in the unit `Environment=` lines: `COOLDOWN_SECONDS` (idle wait
before quiet, default 120), `UTIL_THRESHOLD` (%, default 20), `POLL_SECONDS`,
`IDLE_PROFILE`, `PERF_PROFILE`.
