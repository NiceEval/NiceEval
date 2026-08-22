{
  description = "NiceEval managed-rootless docker profile host surface (NixOS module + systemd package assets)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems =
        f: nixpkgs.lib.genAttrs systems (system: f (import nixpkgs { inherit system; }));
    in
    {
      nixosModules.docker-profiles = import ./nix/modules/docker-profiles.nix;
      nixosModules.default = self.nixosModules.docker-profiles;

      packages = forAllSystems (
        pkgs: {
          docker-profile-host = pkgs.callPackage ./nix/packages/docker-profile-host.nix { };
          default = pkgs.callPackage ./nix/packages/docker-profile-host.nix { };
        }
      );

      checks = forAllSystems (
        pkgs:
        let
          lib = pkgs.lib;
          capacityLib = import ./nix/lib/capacity.nix { inherit lib; };

          # Pure capacity arithmetic check (throws on failure).
          capacityOk =
            let
              v = capacityLib.validateCapacityVsAggregate {
                profileName = "default";
                capacity = {
                  cpus = 16;
                  memory = "28G";
                  pids = 8192;
                  maxContainers = 4;
                  maxBuilds = 2;
                  memorySwapBytes = 0;
                };
                aggregate = {
                  cpus = 20;
                  memory = "32G";
                  pids = 12288;
                  memorySwapBytes = 0;
                };
              };
            in
            assert v.capacity.cpus == 16;
            assert v.aggregate.cpus == 20;
            assert v.headroom.cpus == 4;
            assert v.capacity.memorySwapBytes == 0;
            assert v.aggregate.cpuQuotaPercent == 2000;
            pkgs.runCommand "docker-profile-capacity-ok" { } ''
              echo "capacity ok: allocatable=${toString v.capacity.cpus} aggregate=${toString v.aggregate.cpus}" > $out
            '';

          capacityReject =
            let
              result = builtins.tryEval (
                capacityLib.validateCapacityVsAggregate {
                  profileName = "bad";
                  capacity = {
                    cpus = 20;
                    memory = "32G";
                    pids = 100;
                    maxContainers = 4;
                    maxBuilds = 2;
                    memorySwapBytes = 0;
                  };
                  aggregate = {
                    cpus = 16;
                    memory = "32G";
                    pids = 100;
                    memorySwapBytes = 0;
                  };
                }
              );
            in
            assert !result.success;
            pkgs.runCommand "docker-profile-capacity-reject" { } ''
              echo "reject ok" > "$out"
            '';

          hostPackage = self.packages.${pkgs.stdenv.hostPlatform.system}.docker-profile-host;

          assetsOk = pkgs.runCommand "docker-profile-host-assets" {
            nativeBuildInputs = [
              hostPackage
              pkgs.python3
            ];
          } ''
            set -euo pipefail
            test -x ${hostPackage}/libexec/niceeval/validate-capacity
            test -x ${hostPackage}/libexec/niceeval/generate-descriptor
            test -x ${hostPackage}/libexec/niceeval/docker-profile-watchdog
            test -x ${hostPackage}/libexec/niceeval/prepare-loop-storage
            test -x ${hostPackage}/libexec/niceeval/install-quota-slots
            test -x ${hostPackage}/libexec/niceeval/apply-rootless-network-policy
            test -x ${hostPackage}/libexec/niceeval/verify-sibling-isolation
            test -f ${hostPackage}/lib/systemd/system/niceeval-docker-profile@.service
            test -f ${hostPackage}/lib/systemd/system/niceeval-docker-profile-watchdog@.service
            test -f ${hostPackage}/lib/systemd/system/niceeval-docker-profile-quota-slots@.service
            test -f ${hostPackage}/lib/systemd/system/niceeval-docker-profile-watchdog@.socket
            test -f ${hostPackage}/lib/sysusers.d/niceeval-docker-profile.conf
            test -f ${hostPackage}/lib/tmpfiles.d/niceeval-docker-profile.conf
            grep -q 'PORT_DRIVER=none' ${hostPackage}/lib/systemd/system/niceeval-docker-profile@.service
            grep -q 'apply-rootless-network-policy' ${hostPackage}/lib/systemd/system/niceeval-docker-profile@.service
            grep -q '198.18.0.0/15' ${hostPackage}/libexec/niceeval/apply-rootless-network-policy
            grep -q 'Durable admission' ${hostPackage}/libexec/niceeval/.docker-profile-watchdog-wrapped

            ${hostPackage}/bin/niceeval-docker-profile-validate-capacity \
              ${./packaging/docker-profile-host/config/default.host.json.example} --json > $out
            grep -q '"cpus": 16' $out
            grep -q '"cpus": 20' $out
          '';

          # Evaluate a minimal NixOS config with the module (no build/activation).
          nixosEval =
            let
              eval = import (pkgs.path + "/nixos/lib/eval-config.nix") {
                system = pkgs.stdenv.hostPlatform.system;
                modules = [
                  self.nixosModules.docker-profiles
                  {
                    # Minimal stubs so module eval does not need a full install image.
                    boot.isContainer = true;
                    networking.hostName = "niceeval-dp-eval";
                    system.stateVersion = "25.11";
                    nixpkgs.pkgs = pkgs;
                    services.niceeval.dockerProfiles.default = {
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
                    users.users.alice.isNormalUser = true;
                  }
                ];
              };
              slice = eval.config.systemd.slices."niceeval-docker-profile-default".sliceConfig;
              user = eval.config.users.users."niceeval-dp-default";
            in
            assert user.isSystemUser;
            assert user.autoSubUidGidRange;
            assert slice.MemorySwapMax == 0;
            assert slice.CPUQuota == "2000%";
            assert eval.config.systemd.services ? "niceeval-docker-profile-default";
            assert eval.config.systemd.services ? "niceeval-docker-profile-watchdog-default";
            assert eval.config.systemd.services ? "niceeval-docker-profile-storage-default";
            assert eval.config.systemd.services ? "niceeval-docker-profile-descriptor-default";
            assert builtins.elem "alice" eval.config.users.groups."niceeval-dp-default-access".members;
            assert
              eval.config.systemd.services."niceeval-docker-profile-default".environment.DOCKERD_ROOTLESS_ROOTLESSKIT_PORT_DRIVER
              == "none";
            assert
              eval.config.systemd.services."niceeval-docker-profile-default".environment.DOCKERD_ROOTLESS_ROOTLESSKIT_DISABLE_HOST_LOOPBACK
              == "true";
            pkgs.runCommand "docker-profile-nixos-eval" { } ''
              echo "nixos module eval ok" > $out
              echo "slice CPUQuota=${slice.CPUQuota}" >> $out
              echo "user=${user.name}" >> $out
              echo "port_driver=none" >> $out
            '';
        in
        {
          capacity-ok = capacityOk;
          capacity-reject = capacityReject;
          host-assets = assetsOk;
          nixos-eval = nixosEval;
        }
      );

      # Expose a convenience app for install notes (no host mutation).
      apps = forAllSystems (
        pkgs: {
          install-notes = {
            type = "app";
            program = "${
              self.packages.${pkgs.stdenv.hostPlatform.system}.docker-profile-host
            }/bin/niceeval-docker-profile-host-install-notes";
          };
        }
      );
    };
}
