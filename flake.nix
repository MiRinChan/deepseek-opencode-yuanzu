{
  description = "Deepseek Opencode 元祖版 — OpenCode DeepSeek V4 anchor plugin and llm-agents.nix overlay";

  inputs = {
    llm-agents.url = "github:numtide/llm-agents.nix/b4a645976fff76ef94dd60b7d4f9deaa216f40bd";
    nixpkgs.follows = "llm-agents/nixpkgs";
  };

  outputs =
    inputs@{
      self,
      nixpkgs,
      llm-agents,
      ...
    }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
      pkgsFor = forAllSystems (
        system:
        import nixpkgs {
          inherit system;
          overlays = [
            llm-agents.overlays.shared-nixpkgs
            self.overlays.default
          ];
        }
      );
    in
    {
      overlays.default = import ./nix/overlay.nix;

      packages = forAllSystems (system: {
        default = pkgsFor.${system}.llm-agents.opencode;
        opencode = pkgsFor.${system}.llm-agents.opencode;
        plugin = pkgsFor.${system}.opencode-deepseek-v4-anchor;
      });

      devShells = forAllSystems (system: {
        default = pkgsFor.${system}.mkShell {
          packages = [ pkgsFor.${system}.nodejs_22 ];
        };
      });
    };
}
