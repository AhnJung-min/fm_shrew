import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { TRAY_ICON, TRAY_ICON_BLACK, trayIconFor } from '../src/main/trayIcon'

const bytesOf = (dataUrl: string): Buffer => Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64')

describe('트레이 아이콘(D-10)', () => {
  it('화면 색에 맞는 아이콘을 준다: 블랙이면 블랙용, 그 밖에는 남색용', () => {
    expect(trayIconFor('black')).toBe(TRAY_ICON_BLACK)
    expect(trayIconFor('blue')).toBe(TRAY_ICON)
    expect(trayIconFor('')).toBe(TRAY_ICON)
    expect(TRAY_ICON_BLACK).not.toBe(TRAY_ICON)
  })

  it('둘 다 32x32 RGBA PNG다', () => {
    for (const icon of [TRAY_ICON, TRAY_ICON_BLACK]) {
      const png = bytesOf(icon)
      expect(png.subarray(1, 4).toString()).toBe('PNG')
      expect(png.readUInt32BE(16)).toBe(32)
      expect(png.readUInt32BE(20)).toBe(32)
      expect(png[24]).toBe(8)
      expect(png[25]).toBe(6)
    }
  })

  it('블랙용은 타일이 블랙 테마의 면(#181b20)이고, 남색 타일(#16243f)이 남아 있지 않다', () => {
    const png = bytesOf(TRAY_ICON_BLACK)
    // 압축 조각을 모아 풀고, 줄마다 앞의 필터 바이트(0)를 건너뛴다
    let at = 8
    const parts: Buffer[] = []
    while (at < png.length) {
      const length = png.readUInt32BE(at)
      if (png.subarray(at + 4, at + 8).toString() === 'IDAT') parts.push(png.subarray(at + 8, at + 8 + length))
      at += 12 + length
    }
    const raw = inflateSync(Buffer.concat(parts))
    const pixel = (x: number, y: number): string => {
      const start = y * (1 + 32 * 4) + 1 + x * 4
      expect(raw[start - 1 - (x * 4)]).toBe(0)
      return [...raw.subarray(start, start + 4)].map((value) => value.toString(16).padStart(2, '0')).join('')
    }
    expect(pixel(4, 16)).toBe('181b20ff')
    expect(pixel(28, 4)).toBe('181b20ff')
    const colors = new Set<string>()
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) colors.add(pixel(x, y).slice(0, 6))
    expect(colors.has('16243f')).toBe(false)
  })
})
