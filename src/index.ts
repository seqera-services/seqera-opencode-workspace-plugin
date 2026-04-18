import { createStudioAdaptor } from './backends/studio-adaptor.js'
import { loadSeqeraPluginConfig } from './seqera/config.js'
import type { Plugin, SeqeraPluginConfig } from './types.js'

export function createSeqeraWorkspacePlugin(overrides: Partial<SeqeraPluginConfig> = {}): Plugin {
  return async (input) => {
    const config = loadSeqeraPluginConfig(overrides)
    input.experimental_workspace.register('seqera-studio', createStudioAdaptor(config))
    return {}
  }
}

export default createSeqeraWorkspacePlugin
