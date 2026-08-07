# NixOS module: services.niceeval.dockerProfiles.<alias>
#
# Deploys a managed-rootless Docker execution profile:
#   dedicated system user + subids + access group
#   root-owned callback-free descriptor
#   bounded loop-ext4 data root (or admin-provided mount)
#   aggregate systemd resource slice
#   rootless dockerd service (dockerd-rootless)
#   watchdog service + control socket entry
#
# capacity = allocatable; aggregate = cgroup hard limits.
{
  config,
  lib,
  pkgs,
  ...
}:
let
  inherit (lib)
    mkEnableOption
    mkOption
    mkIf
    types
    concatStringsSep
    optional
    listToAttrs
    nameValuePair
    ;

  cfg = config.services.niceeval.dockerProfiles;
  capacityLib = import ../lib/capacity.nix { inherit lib; };
  pathsFor = name: import ../lib/paths.nix { inherit name; };

  hostPackage = pkgs.callPackage ../packages/docker-profile-host.nix { };

  profileType = types.submodule (
    { name, ... }:
    {
      options = {
        enable = mkEnableOption "NiceEval managed-rootless docker profile ${name}";

        accessUsers = mkOption {
          type = types.listOf types.str;
          default = [ ];
          description = "Daily UIDs granted access-group membership for outer/control sockets.";
        };

        capacity = mkOption {
          type = types.submodule {
            options = {
              cpus = mkOption {
                type = types.either types.ints.positive types.str;
                description = "Allocatable CPU count (after daemon/build/watchdog headroom already deducted).";
              };
              memory = mkOption {
                type = types.either types.ints.positive types.str;
                description = "Allocatable memory (e.g. \"28G\").";
              };
              pids = mkOption {
                type = types.ints.positive;
                description = "Allocatable PID budget.";
              };
              maxContainers = mkOption {
                type = types.ints.positive;
                description = "Max concurrent outer containers across all Invocations.";
              };
              maxBuilds = mkOption {
                type = types.ints.positive;
                description = "Max concurrent managed builds across all Invocations.";
              };
              memorySwapBytes = mkOption {
                type = types.ints.unsigned;
                default = 0;
                description = "Must remain 0 under managed policy.";
              };
            };
          };
          description = "Allocatable capacity published in the descriptor (not the cgroup hard limit).";
        };

        aggregate = mkOption {
          type = types.submodule {
            options = {
              cpus = mkOption {
                type = types.either types.ints.positive types.str;
                description = "Aggregate cgroup hard CPU limit (must be >= capacity.cpus).";
              };
              memory = mkOption {
                type = types.either types.ints.positive types.str;
                description = "Aggregate cgroup MemoryMax (must be >= capacity.memory).";
              };
              pids = mkOption {
                type = types.ints.positive;
                description = "Aggregate cgroup TasksMax (must be >= capacity.pids).";
              };
              memorySwapBytes = mkOption {
                type = types.ints.unsigned;
                default = 0;
                description = "Must remain 0 (MemorySwapMax=0).";
              };
            };
          };
          description = "systemd aggregate slice hard limits (capacity.aggregate in the descriptor).";
        };

        storage = mkOption {
          type = types.submodule {
            options = {
              size = mkOption {
                type = types.either types.ints.positive types.str;
                description = "Hard capacity of the data filesystem (e.g. \"30G\").";
              };
              backing = mkOption {
                type = types.enum [
                  "loop-ext4"
                  "existing-mount"
                ];
                default = "loop-ext4";
                description = ''
                  loop-ext4: module creates a sparse image and mounts it.
                  existing-mount: admin pre-mounts a bounded filesystem at the data path.
                '';
              };
            };
          };
          description = "Bounded data-root filesystem. Backing kind is host packaging only.";
        };

        network = mkOption {
          type = types.submodule {
            options = {
              dnsServers = mkOption {
                type = types.nonEmptyListOf types.str;
                default = [ "1.1.1.1" "9.9.9.9" ];
                description = "Public IP-literal resolvers pinned by descriptor and child-netns policy.";
              };
              blockedCidrs = mkOption {
                type = types.nonEmptyListOf types.str;
                default = [
                  "0.0.0.0/8"
                  "10.0.0.0/8"
                  "100.64.0.0/10"
                  "127.0.0.0/8"
                  "169.254.0.0/16"
                  "172.16.0.0/12"
                  "192.0.0.0/24"
                  "192.0.2.0/24"
                  "192.168.0.0/16"
                  "198.18.0.0/15"
                  "198.51.100.0/24"
                  "203.0.113.0/24"
                  "224.0.0.0/4"
                  "240.0.0.0/4"
                  "::/0"
                ];
                description = "IPv4 destinations rejected in the RootlessKit child network namespace.";
              };
            };
          };
          default = { };
          description = "Fail-closed managed egress policy; IPv6 remains disabled in v1.";
        };

        package = mkOption {
          type = types.package;
          default = pkgs.docker;
          defaultText = "pkgs.docker";
          description = "Docker/moby package providing dockerd-rootless.";
        };

        extraPackages = mkOption {
          type = types.listOf types.package;
          default = [ ];
          description = "Extra packages on dockerd PATH (e.g. custom runtimes).";
        };

        watchdogPackage = mkOption {
          type = types.package;
          default = hostPackage;
          defaultText = "niceeval-docker-profile-host";
          description = "Package providing the durable docker-profile watchdog/admission service.";
        };
      };
    }
  );

  profileNames = builtins.attrNames cfg;

  # Per-profile helpers (only forced when a concrete option value is needed).
  profileContext = name:
    let
      profile = cfg.${name};
      p = pathsFor name;
      validated = capacityLib.validateCapacityVsAggregate {
        capacity = profile.capacity;
        aggregate = profile.aggregate;
        profileName = name;
      };
      storageBytes = capacityLib.parseBytes profile.storage.size;
      daemonSettings = {
        hosts = [ "unix://${p.dockerSocket}" ];
        data-root = p.dockerRootDir;
        exec-opts = [ "native.cgroupdriver=systemd" ];
        # No default bridge: managed Attempts use exclusive user-defined networks only.
        bridge = "none";
        iptables = true;
        ip-forward = true;
        ip6tables = false;
        ipv6 = false;
        dns = profile.network.dnsServers;
        live-restore = false;
        userland-proxy = false;
        default-address-pools = [
          {
            base = "172.31.0.0/16";
            size = 28;
          }
        ];
        features.containerd-snapshotter = true;
      };
      daemonFile = pkgs.writeText "niceeval-dp-${name}-daemon.json" (
        builtins.toJSON daemonSettings
      );
      hostConfig = {
        inherit name;
        userName = p.userName;
        userGroup = p.userGroup;
        accessGroup = p.accessGroup;
        dockerSocket = p.dockerSocket;
        controlSocket = p.controlSocket;
        dataMount = p.dataMount;
        dockerRootDir = p.dockerRootDir;
        journalDir = p.journalDir;
        aggregateCgroupPath = p.aggregateCgroupPath;
        capacity = {
          cpus = validated.capacity.cpus;
          memory = profile.capacity.memory;
          memoryBytes = validated.capacity.memoryBytes;
          pids = validated.capacity.pids;
          maxContainers = validated.capacity.maxContainers;
          maxBuilds = validated.capacity.maxBuilds;
          memorySwapBytes = 0;
        };
        aggregate = {
          cpus = validated.aggregate.cpus;
          memory = profile.aggregate.memory;
          memoryBytes = validated.aggregate.memoryBytes;
          pids = validated.aggregate.pids;
          memorySwapBytes = 0;
        };
        storage = {
          size = profile.storage.size;
          sizeBytes = storageBytes;
          backing = profile.storage.backing;
        };
        policy = {
          hostLoopback = false;
          tcpDockerEndpoint = false;
        };
        # Host-local network hard policy (not a descriptor schema extension).
        networkPolicy = {
          rootlessPortDriver = "none";
          dnsServers = profile.network.dnsServers;
          blockedCidrs = profile.network.blockedCidrs;
          ipv6 = "disabled";
          defaultBridge = "none";
          exclusiveAttemptNetwork = true;
          interContainerCommunication = false;
        };
      };
      hostConfigFile = pkgs.writeText "niceeval-dp-${name}.host.json" (
        builtins.toJSON hostConfig
      );
      resolvFile = pkgs.writeText "niceeval-dp-${name}-resolv.conf" (
        concatStringsSep "\n" (map (server: "nameserver ${server}") profile.network.dnsServers) + "\noptions edns0"
      );
      dockerPath = lib.makeBinPath (
        [
          profile.package
          pkgs.rootlesskit
          pkgs.slirp4netns
          pkgs.fuse-overlayfs
          pkgs.iptables
          pkgs.iproute2
          pkgs.procps
          pkgs.util-linux
          pkgs.coreutils
          pkgs.bash
        ]
        ++ profile.extraPackages
      );
      mountUnit =
        "${lib.replaceStrings [ "/" ] [ "-" ] (lib.removePrefix "/" p.dataMount)}.mount";
    in
    {
      inherit
        profile
        p
        validated
        storageBytes
        daemonFile
        hostConfigFile
        resolvFile
        dockerPath
        mountUnit
        ;
    };

in
{
  options.services.niceeval.dockerProfiles = mkOption {
    type = types.attrsOf profileType;
    default = { };
    description = ''
      Managed-rootless Docker execution profiles.
      Each enabled alias installs dedicated UID/subids, aggregate cgroup slice,
      bounded data-root, rootless dockerd, watchdog/control socket, and a
      root-owned callback-free descriptor under /etc/niceeval/docker-profiles/.
    '';
    example = {
      default = {
        enable = true;
        accessUsers = [ "alice" ];
        capacity = {
          cpus = 16;
          memory = "28G";
          pids = 8192;
          maxContainers = 4;
          maxBuilds = 2;
        };
        aggregate = {
          cpus = 20;
          memory = "32G";
          pids = 12288;
        };
        storage = {
          size = "30G";
          backing = "loop-ext4";
        };
      };
    };
  };

  # Assign concrete option attrsets (listToAttrs over attrNames). Avoid
  # `config = mkMerge (mapAttrsToList ... cfg)` which hits a fixed-point loop on
  # some nixpkgs eval-config paths when the attrs option is the loop variable.
  config = {
    assertions = map (
      name:
      let
        c = profileContext name;
      in
      {
        assertion =
          (!c.profile.enable)
          || (c.validated.aggregate.cpus >= c.validated.capacity.cpus);
        message = "docker profile ${name}: aggregate must be >= allocatable capacity";
      }
    ) profileNames;

    users.users = listToAttrs (
      map (
        name:
        let
          c = profileContext name;
        in
        nameValuePair c.p.userName (mkIf c.profile.enable {
          isSystemUser = true;
          group = c.p.userGroup;
          home = c.p.homeDir;
          createHome = true;
          description = "NiceEval docker profile ${name}";
          autoSubUidGidRange = true;
        })
      ) profileNames
    );

    users.groups = listToAttrs (
      lib.concatMap (
        name:
        let
          c = profileContext name;
        in
        [
          (nameValuePair c.p.userGroup (mkIf c.profile.enable { }))
          (nameValuePair c.p.accessGroup (mkIf c.profile.enable {
            # The root-owned runtime directory is traversable only by this group;
            # the dedicated daemon UID needs it for both sockets and state.
            members = [ c.p.userName ] ++ c.profile.accessUsers;
          }))
        ]
      ) profileNames
    );

    environment.systemPackages = lib.flatten (
      map (
        name:
        let
          c = profileContext name;
        in
        lib.optional c.profile.enable [
          hostPackage
          c.profile.package
        ]
      ) profileNames
    );

    systemd.tmpfiles.rules = lib.flatten (
      map (
        name:
        let
          c = profileContext name;
          p = c.p;
        in
        lib.optionals c.profile.enable [
          "d /etc/niceeval 0755 root root - -"
          "d ${p.registryDir} 0755 root root - -"
          "d /run/niceeval 0755 root root - -"
          "d /run/niceeval/docker-profiles 0755 root root - -"
          "d ${p.runtimeDir} 0750 root ${p.accessGroup} - -"
          "d /var/lib/niceeval 0755 root root - -"
          "d /var/lib/niceeval/docker-profiles 0755 root root - -"
          "d ${p.stateDir} 0755 root root - -"
          "d ${p.homeDir} 0750 ${p.userName} ${p.userGroup} - -"
          "d ${p.journalDir} 0750 ${p.userName} ${p.userGroup} - -"
          "d ${p.dataMount} 0755 root root - -"
          "C ${p.registryDir}/${name}.host.json 0640 root ${p.accessGroup} - ${c.hostConfigFile}"
          "C ${p.registryDir}/${name}.daemon.json 0644 root root - ${c.daemonFile}"
        ]
      ) profileNames
    );

    systemd.slices = listToAttrs (
      map (
        name:
        let
          c = profileContext name;
        in
        nameValuePair "niceeval-docker-profile-${name}" (mkIf c.profile.enable {
          description = "NiceEval docker profile aggregate (${name})";
          sliceConfig = {
            CPUQuota = "${toString c.validated.aggregate.cpuQuotaPercent}%";
            MemoryMax = toString c.validated.aggregate.memoryBytes;
            MemorySwapMax = 0;
            TasksMax = c.validated.aggregate.pids;
          };
        })
      ) profileNames
    );

    fileSystems = listToAttrs (
      map (
        name:
        let
          c = profileContext name;
        in
        nameValuePair c.p.dataMount (
          mkIf (c.profile.enable && c.profile.storage.backing == "loop-ext4") {
            device = c.p.loopImage;
            fsType = "ext4";
            options = [
              "loop"
              "noatime"
              "nodev"
              "nosuid"
            ];
            neededForBoot = false;
          }
        )
      ) profileNames
    );

    systemd.services = listToAttrs (
      lib.concatMap (
        name:
        let
          c = profileContext name;
          p = c.p;
          profile = c.profile;
          enabled = profile.enable;
          loop = profile.storage.backing == "loop-ext4";
        in
        [
          (nameValuePair "niceeval-docker-profile-storage-${name}" (mkIf (enabled && loop) {
            description = "NiceEval docker profile loop-ext4 image (${name})";
            wantedBy = [ "multi-user.target" ];
            before = [
              "niceeval-docker-profile-${name}.service"
              c.mountUnit
            ];
            unitConfig.DefaultDependencies = "no";
            after = [ "local-fs-pre.target" ];
            serviceConfig = {
              Type = "oneshot";
              RemainAfterExit = true;
              ExecStart = concatStringsSep " " [
                "${hostPackage}/libexec/niceeval/prepare-loop-storage"
                "--image ${p.loopImage}"
                "--size ${toString c.storageBytes}"
                "--mount ${p.dataMount}"
              ];
            };
          }))
          (nameValuePair c.mountUnit (mkIf (enabled && loop) {
            requires = [ "niceeval-docker-profile-storage-${name}.service" ];
            after = [ "niceeval-docker-profile-storage-${name}.service" ];
          }))
          (nameValuePair "niceeval-docker-profile-descriptor-${name}" (mkIf enabled {
            description = "NiceEval docker profile descriptor (${name})";
            wantedBy = [ "multi-user.target" ];
            after = [
              "local-fs.target"
              "systemd-tmpfiles-setup.service"
            ]
            ++ optional loop "niceeval-docker-profile-storage-${name}.service"
            ++ optional loop c.mountUnit;
            before = [
              "niceeval-docker-profile-${name}.service"
              "niceeval-docker-profile-watchdog-${name}.service"
            ];
            serviceConfig = {
              Type = "oneshot";
              RemainAfterExit = true;
              ExecStart = concatStringsSep " " [
                "${hostPackage}/libexec/niceeval/generate-descriptor"
                "--host-config ${p.registryDir}/${name}.host.json"
                "--output ${p.descriptorPath}"
                "--access-group ${p.accessGroup}"
              ];
            };
          }))
          (nameValuePair "niceeval-docker-profile-${name}" (mkIf enabled {
            description = "NiceEval managed rootless dockerd (${name})";
            wantedBy = [ "multi-user.target" ];
            after = [
              "network-online.target"
              "local-fs.target"
              "niceeval-docker-profile-descriptor-${name}.service"
            ]
            ++ optional loop "niceeval-docker-profile-storage-${name}.service"
            ++ optional loop c.mountUnit;
            wants = [ "network-online.target" ];
            requires = [ "niceeval-docker-profile-${name}.slice" ];
            path = [
              "/run/wrappers"
              profile.package
              pkgs.rootlesskit
              pkgs.slirp4netns
              pkgs.fuse-overlayfs
            ]
            ++ profile.extraPackages;
            environment = {
              HOME = p.homeDir;
              XDG_RUNTIME_DIR = p.runtimeDir;
              DOCKERD_ROOTLESS_ROOTLESSKIT_STATE_DIR = "${p.runtimeDir}/dockerd-rootless";
              # Fail-closed: port driver must be none (no 198.18/15 synthetic publish path).
              DOCKERD_ROOTLESS_ROOTLESSKIT_DISABLE_HOST_LOOPBACK = "true";
              DOCKERD_ROOTLESS_ROOTLESSKIT_PORT_DRIVER = "none";
              DOCKERD_ROOTLESS_ROOTLESSKIT_NET = "slirp4netns";
              DOCKERD_ROOTLESS_ROOTLESSKIT_DETACH_NETNS = "true";
            };
            serviceConfig = {
              Type = "notify";
              NotifyAccess = "all";
              User = p.userName;
              Group = p.userGroup;
              Slice = "niceeval-docker-profile-${name}.slice";
              Delegate = true;
              WorkingDirectory = p.homeDir;
              ExecStartPre = [
                "+${pkgs.coreutils}/bin/mkdir -p ${p.runtimeDir} ${p.homeDir} ${p.dockerRootDir}"
                "+${pkgs.coreutils}/bin/chown ${p.userName}:${p.userGroup} ${p.homeDir} ${p.dockerRootDir}"
              ];
              ExecStart = concatStringsSep " " [
                "${profile.package}/bin/dockerd-rootless"
                "--config-file=${p.registryDir}/${name}.daemon.json"
                "-H"
                "unix://${p.dockerSocket}"
              ];
              ExecStartPost = [
                "${pkgs.bash}/bin/bash -c ${lib.escapeShellArg ''
                  for i in $(seq 1 30); do
                    if [ -S ${p.dockerSocket} ]; then break; fi
                    sleep 0.5
                  done
                  chmod 660 ${p.dockerSocket}
                  chgrp ${p.accessGroup} ${p.dockerSocket}
                ''}"
                (concatStringsSep " " ([
                  "${hostPackage}/libexec/niceeval/apply-rootless-network-policy"
                  "--profile ${name}"
                  "--state-dir ${p.runtimeDir}/dockerd-rootless"
                  "--runtime-dir ${p.runtimeDir}"
                ]
                ++ map (server: "--dns-server ${lib.escapeShellArg server}") profile.network.dnsServers
                ++ map (cidr: "--blocked-cidr ${lib.escapeShellArg cidr}") profile.network.blockedCidrs))
              ];
              ExecReload = "${pkgs.procps}/bin/kill -s HUP $MAINPID";
              Restart = "always";
              RestartSec = 2;
              TimeoutStartSec = 0;
              TimeoutStopSec = 120;
              LimitNOFILE = "infinity";
              LimitNPROC = "infinity";
              LimitCORE = "infinity";
              TasksMax = "infinity";
              OOMScoreAdjust = -500;
              KillMode = "mixed";
              UMask = "0007";
              BindReadOnlyPaths = [ "${c.resolvFile}:/etc/resolv.conf" ];
            };
            unitConfig = {
              StartLimitIntervalSec = 60;
              StartLimitBurst = 3;
              RequiresMountsFor = [
                p.dataMount
                p.homeDir
              ];
            };
          }))
          (nameValuePair "niceeval-docker-profile-watchdog-${name}" (mkIf enabled {
            description = "NiceEval docker profile watchdog (${name})";
            wantedBy = [ "multi-user.target" ];
            after = [
              "niceeval-docker-profile-${name}.service"
              "niceeval-docker-profile-descriptor-${name}.service"
            ];
            wants = [ "niceeval-docker-profile-${name}.service" ];
            requires = [ "niceeval-docker-profile-${name}.slice" ];
            path = [ profile.package ];
            environment = {
              HOME = p.homeDir;
              XDG_RUNTIME_DIR = p.runtimeDir;
            };
            serviceConfig = {
              Type = "simple";
              User = p.userName;
              Group = p.userGroup;
              Slice = "niceeval-docker-profile-${name}.slice";
              Delegate = true;
              WorkingDirectory = p.journalDir;
              ExecStart = pkgs.writeShellScript "niceeval-dp-watchdog-${name}" ''
                set -euo pipefail
                exec ${profile.watchdogPackage}/libexec/niceeval/docker-profile-watchdog \
                  --control-socket=${p.controlSocket} \
                  --descriptor=${p.descriptorPath} \
                  --docker-socket=${p.dockerSocket} \
                  --journal=${p.journalDir}/events.ndjson \
                  --socket-mode=0o660 \
                  --ready-file=${p.runtimeDir}/watchdog.ready
              '';
              ExecStartPost = "${pkgs.bash}/bin/bash -c ${lib.escapeShellArg ''
                for i in $(seq 1 30); do
                  if [ -S ${p.controlSocket} ]; then break; fi
                  sleep 0.2
                done
                chmod 660 ${p.controlSocket}
                chgrp ${p.accessGroup} ${p.controlSocket}
              ''}";
              Restart = "always";
              RestartSec = 1;
              TimeoutStopSec = 30;
              KillMode = "mixed";
              UMask = "0007";
            };
          }))
        ]
      ) profileNames
    );
  };
}
