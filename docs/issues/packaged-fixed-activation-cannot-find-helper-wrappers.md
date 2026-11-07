---
relations:
  - role: root-cause
    target: memory/fixed-activation-source-vs-packaged-helper-paths.md
---

# Packaged fixed activation looks for source helper filenames

After the 96 GiB fixed store was fully allocated, activation failed because it tried to open libexec/niceeval/provision-fixed-images.py. The Nix package installs provision-fixed-images and generate-descriptor as wrapped extensionless executables.

## Impact

The packaged production activation can prepare storage but cannot provision slots or publish a descriptor, so no fixed watchdog can start.

Source-tree helper filenames and packaged wrapper filenames diverged at the activation subprocess boundary.
