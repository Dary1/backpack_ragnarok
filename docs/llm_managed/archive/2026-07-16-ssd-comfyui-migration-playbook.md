# SSD-day playbook -- move models + cap ComfyUI RAM (prepared 2026-07-16, REQ-0197 companion)

Measured context (2026-07-16, via SSH read-only survey):
- ALL storage, including every ComfyUI model AND the docker/Postgres volumes,
  sits on the Crucial X6 (the root disk) attached at USB 2.0: 41 MB/s read
  measured (`dd` on qwen_3_4b.safetensors). The machine has three idle 10 Gb
  USB buses. This -- not compute -- is the 450-540 s cold load and the
  30-170 s prompt-change swap in art_route.py.
- i7-9700 = PCIe 3.0 only. A "10 GB/s" (Gen4/5) NVMe will link at Gen3 x4:
  expect ~3.3-3.5 GB/s. Still ~85x today.
- ComfyUI 0.26.0 already runs on GPU (cuda:0, NORMAL_VRAM). What eats shared
  RAM is model offload/caching: async weight offload with a pinned-memory
  pool allowed up to ~21 GB of the 23.7 GB total, MemoryMax=infinity, on the
  box that also serves the alpha web+DB stack.
- torch 2.4.1+cu121: ComfyUI logs "DynamicVRAM support requires Pytorch
  version 2.8" -- the --fast-disk path underdelivers until torch is upgraded.

NOTHING below is applied yet. Apply on SSD day, in order, one step at a time.
Steps 2-3 restart the art pipeline: coordinate with the user (HANDS-OFF policy).

## 0. Sanity before touching anything
    nvidia-smi; free -h; df -h /
    systemctl --user status comfyui comfyui-idle-free

## 1. Install NVMe, partition, mount (verify the device name first!)
    lsblk -o NAME,SIZE,MODEL          # find the new disk, e.g. nvme1n1
    sudo parted /dev/nvmeXn1 -- mklabel gpt mkpart primary ext4 0% 100%
    sudo mkfs.ext4 -L fastnvme /dev/nvmeXn1p1
    sudo mkdir -p /mnt/fastnvme && sudo mount /dev/nvmeXn1p1 /mnt/fastnvme
    echo 'LABEL=fastnvme /mnt/fastnvme ext4 defaults,noatime 0 2' | sudo tee -a /etc/fstab
    # bench -- expect >= 3 GB/s:
    sudo dd if=/dev/nvmeXn1p1 of=/dev/null bs=1M count=4096 iflag=direct

## 2. Move ComfyUI models (queue idle; ~27 GB, ~11 min read at 41 MB/s)
    rsync -a --info=progress2 ~/ComfyUI/models/ /mnt/fastnvme/comfyui-models/
    systemctl --user stop comfyui
    mv ~/ComfyUI/models ~/ComfyUI/models.usb-old
    ln -s /mnt/fastnvme/comfyui-models ~/ComfyUI/models
    systemctl --user start comfyui
    # symlink, not extra_model_paths.yaml: input/ output/ stay put, zero config drift.
    # keep models.usb-old until one full generation passes; then delete it.

## 3. Cap ComfyUI RAM + prefer disk offload (systemd drop-in, not the unit)
    systemctl --user edit comfyui     # opens override.conf
        [Service]
        # hard ceiling so web/DB can never be starved; High = early reclaim
        MemoryHigh=6G
        MemoryMax=8G
        ExecStart=
        ExecStart=%h/ComfyUI/venv/bin/python main.py --cache-ram 2 4 --disable-pinned-memory --fast-disk
    systemctl --user restart comfyui
    journalctl --user -u comfyui -n 40   # expect: NO "Enabled pinned memory 21333"

  Flag notes:
  - --cache-ram 2 4 (small headrooms) FIRST, not --cache-none: cache-none
    re-executes every node each run, which throws away the same-prompt
    conditioning reuse REQ-0197's batch sort exists to exploit. Ratchet down
    to --cache-none only if RSS stays too high in step 4.
  - --disable-pinned-memory kills the ~21 GB pinned pool (pinned pages are
    unswappable -- the worst neighbor for Postgres). Slight streaming-speed
    cost; acceptable once weights come off a ~3 GB/s disk.
  - --fast-disk = "prefer disk-backed dynamic loading and offload over
    unpinned RAM" -- exactly the goal. Fully effective only with DynamicVRAM
    (torch >= 2.8, step 5); harmless to pass meanwhile.
  - If a job dies to the MemoryMax OOM-kill: raise 8G -> 10G before blaming
    flags. The job runner marks the render failed and the queue advances
    (REQ-0151/0156 semantics); nothing wedges.
  - Optional: Environment=ART_QUEUE_HOLD=1 on the backpack-api service (NOT
    comfyui) starts the REQ-0197 art queue in hold mode by default.
    backpack-api is a live service -- coordinate before touching.

## 4. Verify + measure (the numbers that justify all this)
    # via art admin: hold ON -> queue 2 artworks x 2 seeds -> Execute batch
    # record: cold load / same-prompt repeat / prompt change / peak RSS
    systemctl --user show comfyui -p MemoryPeak
    Targets: cold 450-540 s -> tens of s; prompt change 30-170 s -> seconds;
    ComfyUI RSS bounded by the cap the whole run; web/DB latency flat during
    generation (spot-check an API endpoint while a batch runs).

## 5. Second pass -- bigger wins, more risk (separate day, own decisions)
  - torch 2.4.1 -> >= 2.8 (cu126 wheel; Turing sm_75 still in the support
    matrix -- verify on the wheel index before running) inside ~/ComfyUI/venv,
    then restart and regenerate one known-good artwork. Sampler settings are
    RATIFIED (art_route.py): any output drift = stop, roll the venv back.
    This removes the DynamicVRAM warning and makes --fast-disk fully real.
  - Migrate / (root -- including docker/Postgres serving the 300-user alpha)
    off the USB-2 X6. That DB reads at 41 MB/s today; the NVMe has the space.
    Bigger surgery (new rootfs, or at minimum docker data-root + pg volumes).
    Plan separately; do NOT bundle with model day.
  - Cheap intermediate if root stays on the X6: at the next shutdown replug
    it into one of the three idle 10 Gb USB ports -- ~10x for everything on /.

## Rollback (any step)
    rm ~/ComfyUI/models && mv ~/ComfyUI/models.usb-old ~/ComfyUI/models
    systemctl --user revert comfyui && systemctl --user restart comfyui
