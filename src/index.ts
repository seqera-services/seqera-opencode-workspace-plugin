import type { Plugin as OpencodePlugin, PluginInput as OpencodePluginInput, PluginOptions } from '@opencode-ai/plugin'
import { createStudioAdaptor } from './backends/studio-adaptor.js'
import { loadSeqeraPluginConfig } from './seqera/config.js'
import type { ExperimentalWorkspaceRegistry, SeqeraPluginConfig } from './types.js'

type WorkspacePluginInput = OpencodePluginInput & {
  experimental_workspace?: ExperimentalWorkspaceRegistry
}

function requireExperimentalWorkspace(input: OpencodePluginInput): asserts input is WorkspacePluginInput & {
  experimental_workspace: ExperimentalWorkspaceRegistry
} {
  const workspaceInput = input as WorkspacePluginInput
  if (!workspaceInput.experimental_workspace?.register) {
    throw new Error(
      'OpenCode runtime did not provide experimental_workspace.register(). Upgrade the CLI/runtime before loading this plugin.',
    )
  }
}

export function createSeqeraWorkspacePlugin(overrides: Partial<SeqeraPluginConfig> = {}): OpencodePlugin {
  return async (input, options?: PluginOptions) => {
    const config = loadSeqeraPluginConfig({
      ...overrides,
      ...((options ?? {}) as Partial<SeqeraPluginConfig>),
    })

    requireExperimentalWorkspace(input)
    input.experimental_workspace.register('seqera-studio', createStudioAdaptor(config))
    return {}
  }
}

export const server: OpencodePlugin = createSeqeraWorkspacePlugin()

export default server
