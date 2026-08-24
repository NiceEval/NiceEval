# Derivation installing portable host assets for non-NixOS systemd Linux.
{
  lib,
  stdenvNoCC,
  python3,
  bash,
  util-linux,
  e2fsprogs,
  quota,
  coreutils,
  makeWrapper,
}:
stdenvNoCC.mkDerivation {
  pname = "niceeval-docker-profile-host";
  version = "0.1.0";

  src = ../../packaging/docker-profile-host;

  dontBuild = true;
  nativeBuildInputs = [ makeWrapper ];

  installPhase = ''
    runHook preInstall
    mkdir -p \
      $out/lib/systemd/system \
      $out/lib/sysusers.d \
      $out/lib/tmpfiles.d \
      $out/share/niceeval/docker-profile-host/config \
      $out/libexec/niceeval \
      $out/bin

    cp -a systemd/. $out/lib/systemd/system/
    cp -a sysusers.d/. $out/lib/sysusers.d/
    cp -a tmpfiles.d/. $out/lib/tmpfiles.d/
    cp -a config/. $out/share/niceeval/docker-profile-host/config/

    # Python helpers with store shebang (no /usr/bin/env in sandbox).
    for pair in \
      generate-descriptor.py:generate-descriptor \
      validate-capacity.py:validate-capacity \
      preload-verify-assets.py:preload-verify-assets \
      watchdog.py:docker-profile-watchdog \
      install-quota-slots.py:install-quota-slots \
      provision-fixed-images.py:provision-fixed-images \
      activate-fixed-images.py:activate-fixed-images
    do
      src_name=''${pair%%:*}
      dst_name=''${pair##*:}
      {
        echo '#!${python3}/bin/python3'
        tail -n +2 "scripts/$src_name"
      } > "$out/libexec/niceeval/$dst_name"
      chmod 0755 "$out/libexec/niceeval/$dst_name"
    done

    # Shell helpers with store bash shebang.
    for pair in \
      prepare-loop-storage.sh:prepare-loop-storage \
      host-doctor.sh:docker-profile-host-doctor \
      apply-rootless-network-policy.sh:apply-rootless-network-policy \
      verify-sibling-isolation.sh:verify-sibling-isolation \
      install-notes.sh:niceeval-docker-profile-host-install-notes
    do
      src_name=''${pair%%:*}
      dst_name=''${pair##*:}
      target="$out/libexec/niceeval/$dst_name"
      if [ "$dst_name" = niceeval-docker-profile-host-install-notes ]; then
        target="$out/bin/$dst_name"
      fi
      {
        echo '#!${bash}/bin/bash'
        tail -n +2 "scripts/$src_name"
      } > "$target"
      chmod 0755 "$target"
    done

    ln -s $out/libexec/niceeval/validate-capacity $out/bin/niceeval-docker-profile-validate-capacity
    ln -s $out/libexec/niceeval/generate-descriptor $out/bin/niceeval-docker-profile-generate-descriptor
    ln -s $out/libexec/niceeval/docker-profile-host-doctor $out/bin/niceeval-docker-profile-host-doctor
    ln -s $out/libexec/niceeval/preload-verify-assets $out/bin/niceeval-docker-profile-preload-verify-assets
    ln -s $out/libexec/niceeval/apply-rootless-network-policy $out/bin/niceeval-docker-profile-apply-network-policy
    ln -s $out/libexec/niceeval/verify-sibling-isolation $out/bin/niceeval-docker-profile-verify-sibling-isolation

    wrapProgram $out/libexec/niceeval/install-quota-slots \
      --prefix PATH : ${lib.makeBinPath [ util-linux e2fsprogs quota ]}
    wrapProgram $out/libexec/niceeval/provision-fixed-images \
      --prefix PATH : ${lib.makeBinPath [ util-linux e2fsprogs coreutils ]}
    wrapProgram $out/libexec/niceeval/activate-fixed-images \
      --prefix PATH : ${lib.makeBinPath [ util-linux e2fsprogs coreutils ]}
    wrapProgram $out/libexec/niceeval/docker-profile-watchdog \
      --prefix PATH : ${lib.makeBinPath [ coreutils util-linux e2fsprogs quota ]}

    runHook postInstall
  '';

  meta = {
    description = "NiceEval managed-rootless docker profile host package assets";
    license = lib.licenses.mit;
    platforms = lib.platforms.linux;
  };
}
