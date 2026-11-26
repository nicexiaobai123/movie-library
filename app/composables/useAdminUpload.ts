export interface AdminFileTransfer<T> {
  promise: Promise<T>
  cancel: () => void
}

interface AdminFileProgress {
  loaded: number
  total: number
}

export function startAdminFileTransfer<T>(
  endpoint: '/api/admin/upload' | '/api/admin/posters',
  file: File,
  options: { contentType?: string; onProgress?: (progress: AdminFileProgress) => void } = {},
): AdminFileTransfer<T> {
  const xhr = new XMLHttpRequest()
  let rejectAsCancelled: (() => void) | undefined

  const promise = new Promise<T>((resolve, reject) => {
    rejectAsCancelled = () => reject(new DOMException('上传已取消。', 'AbortError'))
    xhr.upload.addEventListener('progress', (event) => {
      options.onProgress?.({ loaded: event.loaded, total: event.lengthComputable ? event.total : file.size })
    })
    xhr.upload.addEventListener('load', () => options.onProgress?.({ loaded: file.size, total: file.size }))
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300 && xhr.response && typeof xhr.response === 'object') {
        resolve(xhr.response as T)
      } else {
        reject({ statusCode: xhr.status, data: xhr.response })
      }
    })
    xhr.addEventListener('error', () => reject({ data: { message: '上传连接中断，请检查网络后重试。' } }))
    xhr.addEventListener('abort', () => rejectAsCancelled?.())

    xhr.open('POST', `${endpoint}?name=${encodeURIComponent(file.name)}`)
    xhr.responseType = 'json'
    xhr.setRequestHeader('Content-Type', options.contentType ?? 'application/octet-stream')
    // The browser sends the original File as the entire request body, without a multipart wrapper or reading it into JS memory.
    xhr.send(file)
  })

  return {
    promise,
    cancel() {
      rejectAsCancelled?.()
      xhr.abort()
    },
  }
}

export function adminTransferWasCancelled(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
