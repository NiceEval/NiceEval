# Stable host path layout for one docker execution profile.
{ lib, name }:
let
  baseName = "niceeval/docker-profiles/${name}";
  nameParts = lib.splitString "-" name;
  profileSliceHierarchy = [
    "niceeval.slice"
    "niceeval-docker.slice"
    "niceeval-docker-profile.slice"
  ] ++ lib.imap1 (
    index: _: "niceeval-docker-profile-${lib.concatStringsSep "-" (lib.take index nameParts)}.slice"
  ) nameParts;
in
{
  # Dedicated system account / groups
  userName = "niceeval-dp-${name}";
  userGroup = "niceeval-dp-${name}";
  accessGroup = "niceeval-dp-${name}-access";

  # Root-owned registry + pure-data descriptor (alias = filename stem)
  registryDir = "/etc/niceeval/docker-profiles";
  descriptorPath = "/etc/niceeval/docker-profiles/${name}.json";
  hostConfigPath = "/etc/niceeval/docker-profiles/${name}.host.json";

  # Runtime (sockets live here; parent root-owned, access group traverse/read)
  runtimeDir = "/run/${baseName}";
  dockerSocket = "/run/${baseName}/docker.sock";
  controlSocket = "/run/${baseName}/control.sock";

  # Persistent state
  stateDir = "/var/lib/${baseName}";
  homeDir = "/var/lib/${baseName}/home";
  dataMount = "/var/lib/${baseName}/data";
  dockerRootDir = "/var/lib/${baseName}/data/docker";
  journalDir = "/var/lib/${baseName}/journal";
  # loop-ext4 backing image (optional)
  loopImage = "/var/lib/${baseName}.img";

  # systemd names
  sliceName = "niceeval-docker-profile-${name}.slice";
  dockerdService = "niceeval-docker-profile-${name}.service";
  watchdogService = "niceeval-docker-profile-watchdog-${name}.service";
  watchdogSocket = "niceeval-docker-profile-watchdog-${name}.socket";
  storageService = "niceeval-docker-profile-storage-${name}.service";
  descriptorService = "niceeval-docker-profile-descriptor-${name}.service";
  aggregateCgroupPath = "/sys/fs/cgroup/${lib.concatStringsSep "/" profileSliceHierarchy}";
}
