import {InviteList, DeviceEntry} from "nostr-double-ratchet"

export interface DeviceInfo {
  id: string
  isCurrent: boolean
  createdAt: number
}

export const formatDeviceId = (id: string): string => {
  if (id.length <= 12) return id
  return `${id.slice(0, 8)}...${id.slice(-4)}`
}

export const formatDeviceFoundDate = (timestamp?: number): string | null => {
  if (!timestamp) return null
  const normalized = timestamp > 1e12 ? timestamp : timestamp * 1000
  return new Date(normalized).toLocaleString()
}

export const buildDeviceList = (
  inviteList: InviteList,
  currentId: string | null
): DeviceInfo[] => {
  const activeDevices = inviteList.getAllDevices()

  const activeList: DeviceInfo[] = activeDevices.map((device: DeviceEntry) => ({
    id: device.identityPubkey,
    isCurrent: device.identityPubkey === currentId,
    createdAt: device.createdAt,
  }))

  // Sort: current device first, then by createdAt descending
  return activeList.sort((a, b) => {
    if (a.isCurrent) return -1
    if (b.isCurrent) return 1
    return b.createdAt - a.createdAt
  })
}
