// Grabs a frame from a video in the browser so a poster can be generated without
// an FFmpeg dependency on the server. Same-origin media keeps the canvas clean.
export interface CapturedFrame {
  blob: Blob
  width: number
  height: number
}

const posterWidth = 600
// A little past zero avoids the black frame many encoders start with.
const seekSeconds = 0.5
const captureTimeout = 15_000

export function captureFirstFrame(source: string, signal?: AbortSignal): Promise<CapturedFrame> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    let settled = false
    video.preload = 'auto'
    video.muted = true
    video.playsInline = true
    video.crossOrigin = 'same-origin'

    const cleanup = () => {
      video.removeAttribute('src')
      video.load()
      signal?.removeEventListener('abort', onAbort)
      clearTimeout(timer)
    }
    const finish = (run: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      run()
    }
    const fail = (message: string) => finish(() => reject(new Error(message)))
    const onAbort = () => fail('已取消生成封面。')
    const timer = setTimeout(() => fail('读取视频画面超时。'), captureTimeout)
    signal?.addEventListener('abort', onAbort)

    video.addEventListener('error', () => fail('无法读取这个视频的画面。'))
    video.addEventListener('loadedmetadata', () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) {
        fail('视频信息不完整，无法取帧。')
        return
      }
      video.currentTime = Math.min(seekSeconds, video.duration / 2)
    }, { once: true })
    video.addEventListener('seeked', () => {
      try {
        const width = video.videoWidth
        const height = video.videoHeight
        if (!width || !height) {
          fail('视频没有可用的画面。')
          return
        }
        const canvas = document.createElement('canvas')
        canvas.width = Math.min(posterWidth, width)
        canvas.height = Math.round(canvas.width * (height / width))
        const context = canvas.getContext('2d')
        if (!context) {
          fail('浏览器无法生成图片。')
          return
        }
        context.drawImage(video, 0, 0, canvas.width, canvas.height)
        canvas.toBlob((blob) => {
          if (!blob) {
            fail('浏览器无法生成图片。')
            return
          }
          finish(() => resolve({ blob, width: canvas.width, height: canvas.height }))
        }, 'image/jpeg', 0.86)
      } catch {
        fail('无法从这个视频取帧。')
      }
    }, { once: true })

    video.src = source
  })
}

export function frameFileName(title: string): string {
  const safe = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').slice(0, 60) || '封面'
  return `${safe}.jpg`
}
