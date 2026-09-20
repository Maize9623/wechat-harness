import { useEffect, useRef, useState } from 'react'
import type { ChatImageView } from './types.ts'

function singlePreviewSize(image: ChatImageView): { width: number; height: number } {
  if (image.width === undefined || image.height === undefined || image.width <= 0 || image.height <= 0) {
    return { width: 260, height: 180 }
  }
  const ratio = Math.min(3, Math.max(0.34, image.width / image.height))
  const box = ratio >= 1 ? { width: 280, height: 280 / ratio } : { width: 280 * ratio, height: 280 }
  const scale = Math.min(1, image.width / box.width, image.height / box.height)
  return {
    width: Math.max(96, Math.round(box.width * scale)),
    height: Math.max(96, Math.round(box.height * scale)),
  }
}

function LoadedImage({
  image,
  single,
  onLoadImage,
  onOpen,
}: {
  image: ChatImageView
  single: boolean
  onLoadImage?: (image: ChatImageView) => Promise<string>
  onOpen: (image: ChatImageView, src: string) => void
}) {
  const [src, setSrc] = useState<string | null>(image.src ?? null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const size = single ? singlePreviewSize(image) : undefined
  const loadImageRef = useRef(onLoadImage)
  const canLoadImage = onLoadImage !== undefined

  // The collaboration shell refreshes while countdowns and Agent progress are
  // moving. Its loader closure may therefore get a new identity even though it
  // still points at the same room. Keep the latest closure in a ref so those
  // harmless renders do not revoke and refetch an already displayed Blob URL.
  useEffect(() => { loadImageRef.current = onLoadImage }, [onLoadImage])

  useEffect(() => {
    if (image.src !== undefined) {
      setSrc(image.src)
      setFailed(false)
      return
    }
    const loadImage = loadImageRef.current
    if (loadImage === undefined) {
      setFailed(true)
      return
    }
    let live = true
    let ownedUrl: string | null = null
    setSrc(null)
    setFailed(false)
    void loadImage(image).then((url) => {
      ownedUrl = url.startsWith('blob:') ? url : null
      if (live) setSrc(url)
      else if (ownedUrl !== null) URL.revokeObjectURL(ownedUrl)
    }).catch(() => { if (live) setFailed(true) })
    return () => {
      live = false
      if (ownedUrl !== null) URL.revokeObjectURL(ownedUrl)
    }
  }, [attempt, canLoadImage, image.id, image.src])

  const label = image.name ?? '图片'
  if (failed) {
    return (
      <button
        className="diywx-message-image-failed"
        type="button"
        onClick={() => { setAttempt(value => value + 1) }}
      >加载失败，点击重试</button>
    )
  }
  return (
    <button
      className="diywx-message-image"
      data-single={single || undefined}
      style={size}
      type="button"
      title={`查看大图：${label}`}
      aria-label={`查看大图：${label}`}
      disabled={src === null}
      onClick={() => { if (src !== null) onOpen(image, src) }}
    >
      {src === null ? <span className="diywx-image-loading" /> : <img src={src} alt={label} />}
    </button>
  )
}

export function MessageImageGallery({
  images,
  align,
  onLoadImage,
}: {
  images: readonly ChatImageView[]
  align: 'start' | 'end'
  onLoadImage?: (image: ChatImageView) => Promise<string>
}) {
  const [open, setOpen] = useState<{ image: ChatImageView; src: string } | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (open === null) return
    const previousOverflow = document.body.style.overflow
    const onKeyDown = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpen(null) }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    window.setTimeout(() => { closeRef.current?.focus() }, 0)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (images.length === 0) return null
  const single = images.length === 1
  return (
    <>
      <div className="diywx-message-images" data-align={align} data-single={single || undefined} data-count={Math.min(images.length, 9)}>
        {images.map(image => (
          <LoadedImage
            key={image.id}
            image={image}
            single={single}
            {...onLoadImage === undefined ? {} : { onLoadImage }}
            onOpen={(selected, src) => { setOpen({ image: selected, src }) }}
          />
        ))}
      </div>
      {open !== null && (
        <div className="diywx-image-lightbox" role="dialog" aria-modal="true" aria-label="图片大图预览">
          <button className="diywx-image-lightbox-mask" type="button" aria-label="关闭图片预览" onClick={() => { setOpen(null) }} />
          <figure>
            <img src={open.src} alt={open.image.name ?? '图片'} />
            <figcaption>
              <strong>{open.image.name ?? '图片'}</strong>
              {open.image.width !== undefined && open.image.height !== undefined && <span>{open.image.width} × {open.image.height}</span>}
            </figcaption>
          </figure>
          <button ref={closeRef} className="diywx-image-lightbox-close" type="button" aria-label="关闭图片预览" onClick={() => { setOpen(null) }}>×</button>
        </div>
      )}
    </>
  )
}
