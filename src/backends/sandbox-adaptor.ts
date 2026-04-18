import type { WorkspaceAdaptor, WorkspaceInfo, WorkspaceTargetValue } from '../types.js'

export function createSandboxAdaptor(): WorkspaceAdaptor {
  return {
    name: 'Seqera Sandbox',
    description: 'Placeholder for the future Seqera Scheduler sandbox backend',
    async configure(info: WorkspaceInfo): Promise<WorkspaceInfo> {
      return info
    },
    async create(): Promise<void> {
      throw new Error('Seqera Scheduler sandboxes are not implemented in V1')
    },
    async remove(): Promise<void> {
      return
    },
    target(): WorkspaceTargetValue {
      throw new Error('Seqera Scheduler sandboxes are not implemented in V1')
    },
  }
}
