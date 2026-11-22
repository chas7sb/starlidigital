# Runtime entry points

See `../docs/runtime.md` for prerequisites, isolation limits and validation.

- `python runtime/vm.py doctor|init|start|status|stop`
- `python runtime/console.py screenshot FILE.ppm`
- Pipe guest keyboard text to `python runtime/console.py type`.
- `python -m unittest discover -s runtime/tests -v`

No service runs automatically and no system-level container privileges are required. Install QEMU and supply a verified Linux ISO before initialization. VM state and downloaded vendor binaries remain local and ignored by Git.
