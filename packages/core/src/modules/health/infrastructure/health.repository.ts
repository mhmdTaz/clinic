import { inspectTopology, ping } from '@clinic/db'

/** The only file in this module that knows a database driver exists. */
export const healthRepository = {
  async pingDatabase(): Promise<{ latencyMs: number; topology: string; isReplicaSet: boolean }> {
    const latencyMs = await ping()
    const topology = await inspectTopology()
    return { latencyMs, topology: topology.topology, isReplicaSet: topology.isReplicaSet }
  },
}
