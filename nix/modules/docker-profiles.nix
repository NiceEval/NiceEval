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
  pathsFor = name: import ../lib/paths.nix { inherit lib name; };

  hostPackage = pkgs.callPackage ../packages/docker-profile-host.nix { };

  profileType = types.submodule (
    { name, ... }:
    {
      options = {
        enable = mkEnableOption "NiceEval docker profile ${name}";

        securityLevel = mkOption {
          type = types.enum [
            "managed-rootless/v1"
            "raw-dind-storage/v1"
          ];
          default = "managed-rootless/v1";
          description = "Security capability published by this host profile.";
        };

        rawDockerSocket = mkOption {
          type = types.nullOr types.str;
          default = null;
          description = "Existing rootful Docker Unix socket; required only for raw-dind-storage/v1.";
        };

        rawDockerRootDir = mkOption {
          type = types.nullOr types.str;
          default = null;
          description = "DockerRootDir reported by the existing raw daemon; required only for raw-dind-storage/v1.";
        };

        rawDaemonService = mkOption {
          type = types.str;
          default = "docker.service";
          description = "systemd service owning the existing raw Docker socket.";
        };

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
              ephemeralDiskBytes = mkOption {
                type = types.either types.ints.positive types.str;
                description = "Per-container Docker data allocation hard limit.";
              };
              dockerDataAllocationCount = mkOption {
                type = types.ints.positive;
                default = 1;
                description = "Number of Docker data allocations prebuilt at deployment time.";
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
                  "fixed-image-ext4"
                ];
                default = "loop-ext4";
                description = ''
                  loop-ext4: module creates a sparse image and mounts it.
                  existing-mount: admin pre-mounts a bounded filesystem at the data path.
                  fixed-image-ext4: raw profiles use a fully allocated outer ext4
                  store containing independent fully allocated ext4 slot/seed images.
                '';
              };
              rootDir = mkOption {
                type = types.nullOr (types.addCheck types.str (value:
                  lib.hasPrefix "/" value
                  && value != "/"
                  && !lib.hasInfix "/../" value
                  && !lib.hasInfix "/./" value
                  && !lib.hasSuffix "/.." value
                  && !lib.hasSuffix "/." value
                  && !lib.hasInfix "//" value));
                default = null;
                description = ''
                  Optional absolute host directory for the versioned fixed-image
                  outer store. Null keeps the profile state directory default.
                '';
              };
            };
          };
          description = "Bounded data-root filesystem. Backing kind is host packaging only.";
        };

        setupPrefix = mkOption {
          type = types.submodule {
            options = {
              enable = mkEnableOption "Docker-data Setup Prefix cache for this raw profile";
              seedCount = mkOption {
                type = types.ints.positive;
                default = 10;
                description = "Bounded immutable seed pool; published seeds have no automatic GC.";
              };
            };
          };
          default = { };
          description = "Setup Prefix policy inputs; protocol, paths, identity, and limits are product-derived.";
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
      managed = profile.securityLevel == "managed-rootless/v1";
      fixed = profile.storage.backing == "fixed-image-ext4";
      storageRoot = if profile.storage.rootDir == null then p.stateDir else profile.storage.rootDir;
      fixedRoot = "${storageRoot}/fixed-image-v1";
      fixedOuterImage = "${fixedRoot}/store.img";
      activeHostConfigPath = if fixed
        then "${p.registryDir}/${name}.fixed-image-v1.host.json"
        else "${p.registryDir}/${name}.host.json";
      dockerSocket = if managed then p.dockerSocket else profile.rawDockerSocket;
      dockerRootDir = if managed then p.dockerRootDir else profile.rawDockerRootDir;
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
        securityLevel = profile.securityLevel;
        userName = p.userName;
        userGroup = p.userGroup;
        accessGroup = p.accessGroup;
        inherit dockerSocket;
        controlSocket = p.controlSocket;
        dataMount = p.dataMount;
        inherit dockerRootDir;
        journalDir = p.journalDir;
        aggregateCgroupPath = p.aggregateCgroupPath;
        activationDependency = {
          class = "systemd-profile-slice/v1";
          cgroupPath = p.aggregateCgroupPath;
        };
        capacity = {
          cpus = validated.capacity.cpus;
          memory = profile.capacity.memory;
          memoryBytes = validated.capacity.memoryBytes;
          pids = validated.capacity.pids;
          maxContainers = validated.capacity.maxContainers;
          maxBuilds = validated.capacity.maxBuilds;
          memorySwapBytes = 0;
          ephemeralDiskBytes = capacityLib.parseBytes profile.capacity.ephemeralDiskBytes;
          dockerDataAllocationCount = profile.capacity.dockerDataAllocationCount;
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
          outerImagePath = if fixed then fixedOuterImage else p.loopImage;
          legacyOuterImagePath = p.loopImage;
          rootDir = storageRoot;
        } // lib.optionalAttrs (!fixed) {
          slotRootPath = "${p.dataMount}/quota-slots";
          slotRegistryPath = "${p.journalDir}/quota-slots.json";
        };
        setupPrefix = {
          enable = profile.setupPrefix.enable;
          seedCount = profile.setupPrefix.seedCount;
        };
        policy = {
          hostLoopback = false;
          tcpDockerEndpoint = false;
        };
        # Host-local network hard policy (not a descriptor schema extension).
        networkPolicy = lib.optionalAttrs managed {
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
        managed
        fixed
        fixedOuterImage
        storageRoot
        activeHostConfigPath
        dockerSocket
        dockerRootDir
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
      Docker execution profiles. Managed profiles install a dedicated rootless
      daemon; raw profiles bind an explicitly configured existing Unix socket.
      Both install quota storage, admission/recovery, and a root-owned descriptor.
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
          ephemeralDiskBytes = "6G";
          dockerDataAllocationCount = 4;
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
          || ((c.validated.aggregate.cpus >= c.validated.capacity.cpus)
            && (c.profile.capacity.dockerDataAllocationCount >= c.profile.capacity.maxContainers)
            && (if c.fixed then
              c.profile.setupPrefix.enable
              && !c.managed
              && lib.hasPrefix "/" c.storageRoot
              && c.storageRoot != "/"
              && c.storageRoot != c.p.loopImage
              && c.storageRoot != c.p.dataMount
              && c.fixedOuterImage != c.p.loopImage
              && (((2 * c.profile.capacity.dockerDataAllocationCount + c.profile.setupPrefix.seedCount)
                * (capacityLib.parseBytes c.profile.capacity.ephemeralDiskBytes) * 8) <= (c.storageBytes * 7))
            else
              (!c.profile.setupPrefix.enable
                && ((capacityLib.parseBytes c.profile.capacity.ephemeralDiskBytes) * c.profile.capacity.dockerDataAllocationCount <= c.storageBytes)))
            && (c.managed || (c.profile.rawDockerSocket != null
              && lib.hasPrefix "/" c.profile.rawDockerSocket
              && c.profile.rawDockerRootDir != null
              && lib.hasPrefix "/" c.profile.rawDockerRootDir
              && c.profile.rawDaemonService != "")));
        message = "docker profile ${name}: capacity/backing is invalid; fixed-image-ext4 requires raw mode, setupPrefix.enable, a non-root absolute storage.rootDir distinct from the legacy store, slots + seeds + slot-count temporary clones, and 1/8 physical headroom; raw mode also requires absolute socket/root paths and daemon service";
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
        lib.optionals c.profile.enable ([
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
          "C ${p.registryDir}/${name}.daemon.json 0644 root root - ${c.daemonFile}"
        ] ++ lib.optional c.fixed "d ${c.storageRoot} 0700 root root - -" ++ [
          "C ${c.activeHostConfigPath} 0640 root ${p.accessGroup} - ${c.hostConfigFile}"
        ])
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
              "prjquota"
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
          fixed = c.fixed;
          moduleStore = loop;
          watchdogSocketReady = pkgs.writeShellScript "niceeval-dp-watchdog-socket-ready-${name}" ''
            for i in $(seq 1 30); do
              if [ -S ${p.controlSocket} ]; then break; fi
              sleep 0.2
            done
            chmod 660 ${p.controlSocket}
            chgrp ${p.accessGroup} ${p.controlSocket}
          '';
        in
        [
          (nameValuePair "niceeval-docker-profile-storage-${name}" (mkIf (enabled && moduleStore) {
            description = "NiceEval docker profile ext4 store (${name})";
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
              ExecStart = concatStringsSep " " ([
                "${hostPackage}/libexec/niceeval/prepare-loop-storage"
                "--image ${if fixed then c.fixedOuterImage else p.loopImage}"
                "--size ${toString c.storageBytes}"
                "--mount ${p.dataMount}"
              ] ++ lib.optional fixed "--fully-allocate");
            };
          }))
          (nameValuePair c.mountUnit (mkIf (enabled && moduleStore) {
            requires = [ "niceeval-docker-profile-storage-${name}.service" ];
            after = [ "niceeval-docker-profile-storage-${name}.service" ];
          }))
          (nameValuePair "niceeval-docker-profile-fixed-activation-${name}" (mkIf (enabled && fixed) {
            description = "NiceEval exclusive fixed-image activation (${name})";
            after = [
              profile.rawDaemonService
            ];
            requires = [
              profile.rawDaemonService
              "niceeval-docker-profile-${name}.slice"
            ];
            before = [
              "niceeval-docker-profile-fixed-images-${name}.service"
              "niceeval-docker-profile-descriptor-${name}.service"
              "niceeval-docker-profile-fixed-watchdog-${name}.service"
            ];
            conflicts = [
              "niceeval-docker-profile-watchdog-${name}.service"
              "niceeval-docker-profile-fixed-watchdog-${name}.service"
            ];
            path = [ profile.package pkgs.util-linux pkgs.e2fsprogs pkgs.coreutils ];
            unitConfig.RequiresMountsFor = [ c.storageRoot ];
            serviceConfig = {
              Type = "oneshot";
              ExecStart = concatStringsSep " " [
                "${hostPackage}/libexec/niceeval/activate-fixed-images"
                "--host-config ${c.activeHostConfigPath}"
                "--source-host-config ${c.hostConfigFile}"
                "--descriptor ${p.descriptorPath}"
                "--access-group ${p.accessGroup}"
                "--inactive-unit niceeval-docker-profile-watchdog-${name}.service"
                "--inactive-unit niceeval-docker-profile-fixed-watchdog-${name}.service"
                "--prepare-store"
                "--prepare-helper ${hostPackage}/libexec/niceeval/prepare-loop-storage"
                "--systemd-drop-in-root /run/systemd/system"
                "--systemd-watchdog-unit niceeval-docker-profile-fixed-watchdog-${name}.service"
                "--reload-systemd"
              ];
            };
          }))
          (nameValuePair "niceeval-docker-profile-fixed-images-${name}" (mkIf (enabled && fixed) {
            description = "NiceEval fixed-image backing attestation (${name})";
            wantedBy = [ "multi-user.target" ];
            after = [
              profile.rawDaemonService
            ];
            requires = [
              profile.rawDaemonService
              "niceeval-docker-profile-${name}.slice"
            ];
            before = [
              "niceeval-docker-profile-descriptor-${name}.service"
              "niceeval-docker-profile-fixed-watchdog-${name}.service"
            ];
            path = [ profile.package pkgs.util-linux pkgs.e2fsprogs pkgs.coreutils ];
            unitConfig.RequiresMountsFor = [ c.storageRoot ];
            serviceConfig = {
              Type = "oneshot";
              RemainAfterExit = true;
              ExecStart = concatStringsSep " " [
                "${hostPackage}/libexec/niceeval/activate-fixed-images"
                "--host-config ${c.activeHostConfigPath}"
                "--descriptor ${p.descriptorPath}"
                "--boot-restore"
                "--systemd-drop-in-root /run/systemd/system"
                "--systemd-watchdog-unit niceeval-docker-profile-fixed-watchdog-${name}.service"
                "--reload-systemd"
              ];
            };
          }))
          (nameValuePair "niceeval-docker-profile-descriptor-${name}" (mkIf enabled {
            description = "NiceEval docker profile descriptor (${name})";
            wantedBy = [ "multi-user.target" ];
            after = [
              "local-fs.target"
              "systemd-tmpfiles-setup.service"
            ]
            ++ optional moduleStore "niceeval-docker-profile-storage-${name}.service"
            ++ optional moduleStore c.mountUnit
            ++ optional fixed "niceeval-docker-profile-fixed-images-${name}.service"
            ++ optional (!fixed) "niceeval-docker-profile-quota-slots-${name}.service"
            ++ optional (!c.managed) profile.rawDaemonService;
            requires = optional fixed "niceeval-docker-profile-fixed-images-${name}.service"
              ++ optional (!fixed) "niceeval-docker-profile-quota-slots-${name}.service"
              ++ optional (!c.managed) profile.rawDaemonService;
            before = [
              "niceeval-docker-profile-${name}.service"
              "niceeval-docker-profile-watchdog-${name}.service"
              "niceeval-docker-profile-fixed-watchdog-${name}.service"
            ];
            serviceConfig = {
              Type = "oneshot";
              RemainAfterExit = true;
              ExecStart = if fixed then concatStringsSep " " [
                "${hostPackage}/libexec/niceeval/activate-fixed-images"
                "--host-config ${c.activeHostConfigPath}"
                "--descriptor ${p.descriptorPath}"
                "--verify-only"
              ] else concatStringsSep " " [
                "${hostPackage}/libexec/niceeval/generate-descriptor"
                "--host-config ${c.activeHostConfigPath}"
                "--output ${p.descriptorPath}"
                "--access-group ${p.accessGroup}"
              ];
            };
          }))
          (nameValuePair "niceeval-docker-profile-quota-slots-${name}" (mkIf (enabled && !fixed) {
            description = "NiceEval project-quota slots (${name})";
            after = [ "local-fs.target" ]
              ++ optional loop c.mountUnit;
            before = [
              "niceeval-docker-profile-descriptor-${name}.service"
              "niceeval-docker-profile-watchdog-${name}.service"
            ];
            requiredBy = [ "niceeval-docker-profile-watchdog-${name}.service" ];
            conflicts = [ "niceeval-docker-profile-fixed-watchdog-${name}.service" ];
            serviceConfig = {
              Type = "oneshot";
              RemainAfterExit = true;
              ExecStart = concatStringsSep " " [
                "${hostPackage}/libexec/niceeval/install-quota-slots"
                "--host-config ${c.activeHostConfigPath}"
              ];
            };
          }))
          (nameValuePair "niceeval-docker-profile-${name}" (mkIf (enabled && c.managed) {
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
          (nameValuePair "niceeval-docker-profile-watchdog-${name}" (mkIf (enabled && !fixed) {
            description = "NiceEval docker profile watchdog (${name})";
            wantedBy = [ "multi-user.target" ];
            after = [
              "niceeval-docker-profile-descriptor-${name}.service"
            ] ++ [ "niceeval-docker-profile-quota-slots-${name}.service" ]
              ++ [ (if c.managed then "niceeval-docker-profile-${name}.service" else profile.rawDaemonService) ];
            wants = [ (if c.managed then "niceeval-docker-profile-${name}.service" else profile.rawDaemonService) ];
            requires = [
              "niceeval-docker-profile-${name}.slice"
              "niceeval-docker-profile-descriptor-${name}.service"
              "niceeval-docker-profile-quota-slots-${name}.service"
            ];
            path = [ profile.package ];
            environment = {
              HOME = p.homeDir;
              XDG_RUNTIME_DIR = p.runtimeDir;
            };
            serviceConfig = {
              Type = "simple";
              User = "root";
              Group = "root";
              Slice = "niceeval-docker-profile-${name}.slice";
              Delegate = true;
              WorkingDirectory = p.journalDir;
              ExecStart = pkgs.writeShellScript "niceeval-dp-watchdog-${name}" ''
                set -euo pipefail
                exec ${profile.watchdogPackage}/libexec/niceeval/docker-profile-watchdog \
                  --control-socket=${p.controlSocket} \
                  --descriptor=${p.descriptorPath} \
                  --host-config=${c.activeHostConfigPath} \
                  --docker-socket=${c.dockerSocket} \
                  --journal=${p.journalDir}/events.ndjson \
                  --socket-mode=0o660 \
                  --ready-file=${p.runtimeDir}/watchdog.ready
              '';
              ExecStartPost = watchdogSocketReady;
              Restart = "always";
              RestartSec = 1;
              TimeoutStopSec = 30;
              KillMode = "mixed";
              UMask = "0007";
              ReadWritePaths = [
                "${p.dataMount}/quota-slots"
                p.journalDir
                p.runtimeDir
              ];
            };
          }))
          (nameValuePair "niceeval-docker-profile-fixed-watchdog-${name}" (mkIf (enabled && fixed) {
            description = "NiceEval fixed-image docker profile watchdog (${name})";
            wantedBy = [ "multi-user.target" ];
            after = [
              "niceeval-docker-profile-descriptor-${name}.service"
              profile.rawDaemonService
            ];
            wants = [ profile.rawDaemonService ];
            requires = [
              "niceeval-docker-profile-${name}.slice"
              "niceeval-docker-profile-descriptor-${name}.service"
            ];
            conflicts = [ "niceeval-docker-profile-watchdog-${name}.service" ];
            path = [ profile.package ];
            environment = {
              HOME = p.homeDir;
              XDG_RUNTIME_DIR = p.runtimeDir;
              NICEEVAL_ACTIVATION_MANIFEST_DIGEST = "uncommitted";
              NICEEVAL_ACTIVATION_EPOCH = "uncommitted";
            };
            serviceConfig = {
              Type = "simple";
              User = "root";
              Group = "root";
              Slice = "niceeval-docker-profile-${name}.slice";
              Delegate = true;
              WorkingDirectory = "${p.journalDir}/fixed-image-v1";
              ExecStart = pkgs.writeShellScript "niceeval-dp-fixed-watchdog-${name}" ''
                set -euo pipefail
                exec ${profile.watchdogPackage}/libexec/niceeval/docker-profile-watchdog \
                  --control-socket=${p.controlSocket} \
                  --descriptor=${p.descriptorPath} \
                  --host-config=${c.activeHostConfigPath} \
                  --docker-socket=${c.dockerSocket} \
                  --journal=${p.journalDir}/fixed-image-v1/events.ndjson \
                  --socket-mode=0o660 \
                  --ready-file=${p.runtimeDir}/watchdog.ready \
                  --activation-manifest-digest="$NICEEVAL_ACTIVATION_MANIFEST_DIGEST"
              '';
              ExecStartPost = watchdogSocketReady;
              Restart = "always";
              RestartSec = 1;
              TimeoutStopSec = 30;
              KillMode = "mixed";
              UMask = "0007";
              ReadWritePaths = [
                "${p.dataMount}/fixed-image-v1"
                "${p.journalDir}/fixed-image-v1"
                p.runtimeDir
              ];
            };
            unitConfig.RequiresMountsFor = [ c.storageRoot ];
          }))
        ]
      ) profileNames
    );
  };
}
