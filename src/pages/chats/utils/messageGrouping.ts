import {getMillisecondTimestamp} from "nostr-double-ratchet"
import {SortedMap} from "@/utils/SortedMap/SortedMap"
import {MessageType} from "../message/Message"
import {KIND_CHANNEL_CREATE} from "@/utils/constants"

export const groupingThreshold = 60 * 1000 // 60 seconds = 1 minute

export const comparator = (a: [string, MessageType], b: [string, MessageType]) =>
  getMillisecondTimestamp(a[1]) - getMillisecondTimestamp(b[1])

export const groupMessages = (
  messages: SortedMap<string, MessageType>,
  timeThreshold: number = groupingThreshold,
  isPublicChat: boolean = false
) => {
  const groups: MessageType[][] = []
  let currentGroup: MessageType[] = []
  let lastDate: string | null = null

  for (const [, message] of messages) {
    const messageDate = new Date(getMillisecondTimestamp(message)).toDateString()

    // Check if this is a reply to another message
    const isReply = isPublicChat
      ? message.tags?.some((tag) => tag[0] === "e" && tag[3] === "reply")
      : message.tags?.some((tag) => tag[0] === "e")

    const isDisplayedAsMessage = message.kind !== KIND_CHANNEL_CREATE

    const hasReactions = message.reactions && Object.keys(message.reactions).length > 0

    // If this message is a reply or has reactions, finish the current group
    if (!isDisplayedAsMessage || isReply || hasReactions) {
      if (currentGroup.length > 0) {
        groups.push(currentGroup)
      }
      // Add this message as its own group
      groups.push([message])
      currentGroup = []
      lastDate = messageDate
      continue
    }

    if (lastDate !== messageDate) {
      if (currentGroup.length > 0) {
        groups.push(currentGroup)
      }
      currentGroup = [message]
      lastDate = messageDate
    } else {
      if (currentGroup.length === 0) {
        currentGroup.push(message)
      } else {
        const lastMessage = currentGroup[currentGroup.length - 1]
        const timeDiff =
          getMillisecondTimestamp(message) - getMillisecondTimestamp(lastMessage)

        // For public chats, we need to handle undefined sender values
        // Messages with the same pubkey should be grouped together
        const isSameSender = message.pubkey === lastMessage.pubkey

        if (isSameSender && timeDiff <= timeThreshold) {
          currentGroup.push(message)
        } else {
          groups.push(currentGroup)
          currentGroup = [message]
        }
      }
    }
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup)
  }

  return groups
}
