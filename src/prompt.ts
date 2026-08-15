export const MINIMAL_PERSONA = "You are a helpful software engineer assistant."

export function replaceWithBootstrapSystem(system: string[], explicitUserSystem?: string): void {
  const next = explicitUserSystem ? [MINIMAL_PERSONA, explicitUserSystem] : [MINIMAL_PERSONA]
  system.splice(0, system.length, ...next)
}

/**
 * OpenCode currently exposes the assembled system string, not separate persona
 * and dynamic-context segments. Prefixing is the only non-destructive way to
 * retain AGENTS/workspace/skill context after promotion while keeping the
 * Minimal persona authoritative and visible first.
 */
export function prefixMinimalPersona(system: string[]): void {
  if (system.length === 0) {
    system.push(MINIMAL_PERSONA)
    return
  }
  if (system[0] === MINIMAL_PERSONA || system[0]?.startsWith(`${MINIMAL_PERSONA}\n`)) return
  system[0] = `${MINIMAL_PERSONA}\n\n${system[0]}`
}
