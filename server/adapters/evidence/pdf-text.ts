import { spawn } from 'node:child_process'

/** Local Poppler only, stdin bytes, no shell or network, bounded time/output and minimal environment. */
export async function extractPdfPages(bytes: Uint8Array, bin = 'pdftotext'): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['-layout', '-enc', 'UTF-8', '-', '-'], {
      env: {
        PATH: process.env.PATH ?? '',
        LANG: 'en_US.UTF-8',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let text = ''
    let exceeded = false
    const timer = setTimeout(() => {
      exceeded = true
      child.kill('SIGKILL')
    }, 20_000)
    child.stdout.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8')
      if (text.length > 2_000_000) {
        exceeded = true
        child.kill('SIGKILL')
      }
    })
    child.stderr.resume()
    child.stdin.on('error', () => {})
    child.once('error', () => {
      clearTimeout(timer)
      reject(new Error('Local pdftotext is unavailable'))
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      const pages = text.split('\f').filter(page => page.trim())
      if (code !== 0 || exceeded || !pages.length || pages.length > 200) {
        reject(new Error('PDF extraction failed or exceeded limits'))
      } else {
        resolve(pages)
      }
    })
    child.stdin.end(bytes)
  })
}
