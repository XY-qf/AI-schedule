import { useCallback, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'

/** 课程表 / 日程截图：粘贴、拖拽、选择文件三条路统一收口到这里。 */
export interface AiImage {
  dataUrl: string
  name: string
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024

export interface UseAiImageResult {
  image: AiImage | null
  setImage: (value: AiImage | null) => void
  fileRef: React.RefObject<HTMLInputElement | null>
  pickFiles: (files: ArrayLike<File> | null | undefined) => void
  handlePaste: (event: ClipboardEvent<HTMLElement>) => void
  handleDrop: (event: DragEvent<HTMLElement>) => void
  openPicker: () => void
}

export function useAiImage(onError: (message: string) => void): UseAiImageResult {
  const [image, setImage] = useState<AiImage | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const pickFiles = useCallback(
    (files: ArrayLike<File> | null | undefined) => {
      const file = Array.from(files ?? []).find((item) => item.type.startsWith('image/'))
      if (!file) return
      if (file.size > MAX_IMAGE_BYTES) {
        onError('截图太大了（超过 8 MB），请先压缩或裁剪后再试')
        return
      }
      onError('')
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = String(reader.result ?? '')
        if (dataUrl.startsWith('data:image/')) {
          setImage({ dataUrl, name: file.name || '截图' })
        } else {
          onError('这张图片读不出来，换一张试试')
        }
      }
      reader.onerror = () => onError('读取图片失败，换一张试试')
      reader.readAsDataURL(file)
    },
    [onError],
  )

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLElement>) => {
      const items = event.clipboardData?.items
      if (!items) return
      const files: File[] = []
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index]
        if (item.kind !== 'file') continue
        const file = item.getAsFile()
        if (file && file.type.startsWith('image/')) files.push(file)
      }
      if (files.length > 0) {
        event.preventDefault()
        pickFiles(files)
      }
    },
    [pickFiles],
  )

  const handleDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      event.preventDefault()
      if (event.dataTransfer?.files?.length) pickFiles(event.dataTransfer.files)
    },
    [pickFiles],
  )

  return {
    image,
    setImage,
    fileRef,
    pickFiles,
    handlePaste,
    handleDrop,
    openPicker: () => fileRef.current?.click(),
  }
}
