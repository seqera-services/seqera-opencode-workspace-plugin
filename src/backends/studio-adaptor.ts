import type { WorkspaceAdaptor, WorkspaceInfo, SeqeraPluginConfig, WorkspaceTargetValue } from '../types.js'
import { buildWorkspaceName } from '../git.js'
import { createSeqeraClient } from '../seqera/client.js'
import { createStudio, deleteStudio, describeStudio } from '../seqera/studios.js'

export function createStudioAdaptor(config: SeqeraPluginConfig): WorkspaceAdaptor {
  const client = createSeqeraClient(config)

  return {
    name: 'Seqera Studio',
    description: 'Provision a Seqera Platform Studio-backed OpenCode workspace',
    async configure(info: WorkspaceInfo): Promise<WorkspaceInfo> {
      const branch = info.branch ?? 'detached'
      const workspaceName = buildWorkspaceName(info.name, branch, info.id)
      return {
        ...info,
        name: workspaceName,
      }
    },
    async create(_info: WorkspaceInfo, _env: Record<string, string | undefined>): Promise<void> {
      void client
      void createStudio
      void describeStudio
      throw new Error('Seqera Studio adaptor scaffold not implemented yet')
    },
    async remove(_info: WorkspaceInfo): Promise<void> {
      void deleteStudio
      throw new Error('Seqera Studio adaptor scaffold not implemented yet')
    },
    target(_info: WorkspaceInfo): WorkspaceTargetValue {
      throw new Error('Seqera Studio adaptor scaffold not implemented yet')
    },
  }
}
