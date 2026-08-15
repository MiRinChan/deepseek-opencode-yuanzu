final: prev:

let
  lib = final.lib;
  llmAgents =
    if builtins.hasAttr "llm-agents" prev then
      prev."llm-agents"
    else
      throw "deepseek-opencode-yuanzu: apply llm-agents.overlays.shared-nixpkgs before this overlay";

  supportedOpenCodeVersion = "1.18.18";
  targetOpenCodeVersion = llmAgents.opencode.version;
  baseOpenCode =
    if !(builtins.hasAttr "opencode" prev) then
      throw "deepseek-opencode-yuanzu: the selected nixpkgs does not provide a source-built opencode package"
    else if targetOpenCodeVersion != supportedOpenCodeVersion then
      throw ''
        deepseek-opencode-yuanzu: unsupported llm-agents.nix OpenCode ${targetOpenCodeVersion};
        this overlay and its request-hook patch are pinned to ${supportedOpenCodeVersion}.
      ''
    else
      prev.opencode;

  openCodeSource = final.fetchFromGitHub {
    owner = "anomalyco";
    repo = "opencode";
    tag = "v${supportedOpenCodeVersion}";
    hash = "sha256-rDVcv8j9KghTDwooPYriTloOMgTyVutud7xKLG2mTmk=";
  };

  openCodeNodeModules = baseOpenCode.passthru.node_modules.overrideAttrs (_: {
    version = supportedOpenCodeVersion;
    src = openCodeSource;
    outputHash = "sha256-oU7qWOsY2TtVE+Gp2DhSXffm9OghTHcNhzDwwAovwZI=";
  });

  sourceOpenCode = baseOpenCode.overrideAttrs (old: {
    version = supportedOpenCodeVersion;
    src = openCodeSource;
    configurePhase = ''
      runHook preConfigure

      cp -R ${openCodeNodeModules}/. .
      patchShebangs node_modules
      patchShebangs packages/*/node_modules

      runHook postConfigure
    '';
    passthru = (old.passthru or { }) // {
      node_modules = openCodeNodeModules;
    };
  });

  anchorPlugin = final.callPackage ./plugin.nix { };
  pluginSpecifier = "file://${anchorPlugin}/lib/opencode-deepseek-v4-anchor/index.js";
  pluginConfig = builtins.toJSON {
    plugin = [
      [
        pluginSpecifier
        {
          enabled = true;
          models = [ "deepseek-v4-pro" ];
          bootstrapTools = [
            "bash"
            "read"
          ];
          personaAfterPromotion = "minimal";
          promoteOn = "either";
          debug = false;
        }
      ]
    ];
  };

  patchedOpenCode = sourceOpenCode.overrideAttrs (old: {
    patches = (old.patches or [ ]) ++ [ ../patches/opencode-tools-transform.patch ];
    passthru = (old.passthru or { }) // {
      anchorPlugin = anchorPlugin;
      anchorPluginSpecifier = pluginSpecifier;
      unpatched = sourceOpenCode;
    };
  });

  anchoredOpenCode = final.symlinkJoin {
    name = "opencode-deepseek-v4-anchor-${sourceOpenCode.version}";
    paths = [ patchedOpenCode ];
    nativeBuildInputs = [ final.makeWrapper ];
    postBuild = ''
      rm "$out/bin/opencode"
      makeWrapper ${patchedOpenCode}/bin/opencode "$out/bin/opencode" \
        --set-default OPENCODE_CONFIG_CONTENT ${lib.escapeShellArg pluginConfig}
    '';
    passthru = (patchedOpenCode.passthru or { }) // {
      inherit anchorPlugin pluginSpecifier;
      patched = patchedOpenCode;
      llmAgentsOriginal = llmAgents.opencode;
    };
    meta = patchedOpenCode.meta // {
      description = "OpenCode with the DeepSeek V4 Pro anchor request hook and plugin";
      mainProgram = "opencode";
    };
  };
in
{
  "llm-agents" = llmAgents // {
    opencode = anchoredOpenCode;
  };

  opencode-deepseek-v4-anchor = anchorPlugin;
}
