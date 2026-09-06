export interface TaskComment {
  id: string
  authorUid: string
  authorEmail: string
  authorName: string
  text: string
  /** Set when the message carries an image (uploaded to Storage). */
  imageUrl?: string
  imagePath?: string
  createdAt?: unknown
}
