/**
 * Accept Finder / Explorer file drags on the Desktop document.
 * Electron only fills `dataTransfer.files` when dragover calls preventDefault;
 * item.kind === 'file' is often empty during dragover, so trust the Files type.
 * @param event - A document or element drag event.
 * @returns The transfer when it carries files, otherwise null.
 */
export function fileDataTransfer(event: { dataTransfer: DataTransfer | null }): DataTransfer | null {
  const data = event.dataTransfer
  if (data === null || ![...data.types].includes('Files')) return null
  return data
}

/**
 * Install document-level file drop so files land even when the pointer is
 * over the transcript, titlebar, or a child that does not handle drop.
 * @param onFiles - Files from a completed drop.
 * @returns Listener disposer.
 */
export function installDocumentFileDrop(onFiles: (files: readonly File[]) => void): () => void {
  const onDragOver = (event: DragEvent): void => {
    const data = fileDataTransfer(event)
    if (data === null) return
    event.preventDefault()
    data.dropEffect = 'copy'
  }
  const onDrop = (event: DragEvent): void => {
    const data = fileDataTransfer(event)
    if (data === null) return
    event.preventDefault()
    onFiles([...data.files])
  }
  document.addEventListener('dragover', onDragOver)
  document.addEventListener('drop', onDrop)
  return () => {
    document.removeEventListener('dragover', onDragOver)
    document.removeEventListener('drop', onDrop)
  }
}
