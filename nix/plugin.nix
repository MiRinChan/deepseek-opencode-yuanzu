{
  lib,
  buildNpmPackage,
  importNpmLock
}:

let
  source = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../package.json
      ../package-lock.json
      ../tsconfig.json
      ../src
    ];
  };
in
buildNpmPackage {
  pname = "opencode-deepseek-v4-anchor";
  version = "0.1.0";

  src = source;

  npmDeps = importNpmLock { npmRoot = source; };
  npmConfigHook = importNpmLock.npmConfigHook;
  npmInstallFlags = [ "--ignore-scripts" ];
  npmBuildScript = "build";

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/lib/opencode-deepseek-v4-anchor"
    cp -R dist/src/. "$out/lib/opencode-deepseek-v4-anchor/"

    runHook postInstall
  '';

  meta = {
    description = "DSH/RL-aligned bootstrap scaffold plugin for DeepSeek V4 Pro in OpenCode";
    homepage = "https://github.com/MiRinChan/deepseek-opencode-yuanzu";
    license = lib.licenses.mit;
    platforms = lib.platforms.unix;
  };
}
