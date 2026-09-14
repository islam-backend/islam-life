export interface TaskComment {
  id: string
  authorUid: string
  authorEmail: string
  authorName: string
  text: string
  /** Set when the message carries an image. */
  imageUrl?: string
  imagePath?: string
  /** Set when the message carries a non-image file attachment. */
  fileUrl?: string
  fileName?: string
  fileType?: string
  /** Set when the message carries a voice recording (base64 data URL). */
  audioUrl?: string
  audioDuration?: number
  /** uids of team members @-mentioned in `text`. */
  mentions?: string[]
  createdAt?: unknown
  /** Set when the owner edits the message. */
  editedAt?: unknown
}
